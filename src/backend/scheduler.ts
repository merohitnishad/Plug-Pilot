'use strict';

import cron from 'node-cron';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { getBatteryInfo } from './battery';
import { sendCommand, sendSmartHomeAction, getSmartHomeDeviceState } from './alexa';
import { logAction } from './historydb';
import logger from './logger';

const LOCK_FILE = path.join(os.homedir(), 'Library', 'Application Support', 'PlugPilot', 'acting.lock');

let cronTask: cron.ScheduledTask | null = null;
let notifyFn: ((channel: string, data: any) => void) | null = null;
let getStoreFn: (() => any) | null = null;
let running = false;

// In-memory plug state — set immediately when action is decided (before async Alexa call)
// so concurrent checkAndAct calls see the updated state and don't double-send.
// Initialized from store on start(); reset to null when monitor is re-enabled.
let plugState: 'on' | 'off' | null = null;

// Mutex: only one checkAndAct runs at a time
let acting = false;
let checkCount = 0;

export function start(getStore: () => any, notify: (channel: string, data: any) => void): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }

  getStoreFn = getStore;
  notifyFn = notify;
  running = true;

  // Seed in-memory state from store (null means "unknown — act on first check")
  plugState = getStore().get('lastPlugState') ?? null;

  logger.info('Starting battery scheduler (every 60 seconds)');

  // Try to sync real state immediately when monitor starts
  syncDeviceState(getStore).then(() => {
    checkAndAct();
  });

  cronTask = cron.schedule('* * * * *', () => {
    checkAndAct();
  });

  if (notifyFn) {
    notifyFn('scheduler-status', { running: true });
  }
}

export function stop(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
  running = false;
  plugState = null;
  logger.info('Battery scheduler stopped');

  if (notifyFn) {
    notifyFn('scheduler-status', { running: false });
  }
}

/** Call this after a manual plug action so the in-memory state stays in sync. */
export function setPlugState(state: 'on' | 'off' | null): void {
  plugState = state;
}

async function syncDeviceState(getStore: () => any): Promise<void> {
  const targetDeviceId = getStore().get('targetDeviceId');
  if (!targetDeviceId) return;
  
  try {
    const res = await getSmartHomeDeviceState(targetDeviceId, getStore);
    if (res.success && res.result?.state) {
      logger.info(`Synced real plug state: ${res.result.state}`);
      plugState = res.result.state;
      getStore().set('lastPlugState', res.result.state);
    }
  } catch (err: any) {
    logger.warn('Failed to sync device state on start:', err.message);
  }
}

async function checkAndAct(): Promise<void> {
  if (!getStoreFn) return;

  // Prevent concurrent execution — skip if already acting
  if (acting) {
    logger.info('checkAndAct already in progress, skipping');
    return;
  }
  acting = true;
  checkCount++;
  try { fs.writeFileSync(LOCK_FILE, process.pid.toString()); } catch (e) {}

  try {
    const store = getStoreFn();

    if (!store.get('monitorEnabled')) {
      logger.info('Monitor disabled, skipping check');
      return;
    }

    const lowThreshold: number  = store.get('lowThreshold')  || 20;
    const highThreshold: number = store.get('highThreshold') || 80;
    const targetDeviceId: string | null = store.get('targetDeviceId');
    const onCommand: string  = store.get('onCommand')  || 'turn on Smart Plug Mac';
    const offCommand: string = store.get('offCommand') || 'turn off Smart Plug Mac';

    const info = await getBatteryInfo();
    const { percent, isCharging } = info;

    logger.info(`Battery check: ${percent}% | charging: ${isCharging} | plugState: ${plugState}`);

    if (notifyFn) {
      notifyFn('battery-update', { percent, isCharging });
    }

    // ─── Reconciliation Loop ──────────────────────────────────────────────────
    // Every 5 cycles (approx 5 mins), verify real state regardless of battery.
    // This handles manual overrides done via Alexa app or voice.
    const shouldReconcile = checkCount % 5 === 0;
    if (shouldReconcile && targetDeviceId) {
      logger.info('Performing periodic state reconciliation...');
      const res = await getSmartHomeDeviceState(targetDeviceId, getStoreFn);
      if (res.success && res.result?.state) {
        if (plugState !== res.result.state) {
          logger.info(`Reconciliation: Local state (${plugState}) out of sync with Alexa (${res.result.state}). Updating.`);
          plugState = res.result.state;
          store.set('lastPlugState', res.result.state);
        }
        if (notifyFn) {
          notifyFn('device-status-update', { state: res.result.state });
        }
      }
    }

    // Determine required action based on battery vs thresholds
    let action: 'turnOn' | 'turnOff' | null = null;
    let commandToSend: string | null = null;
    let newPlugState: 'on' | 'off' = 'off';

    if (percent <= lowThreshold && plugState !== 'on') {
      // Re-verify actual state before acting to be "intelligent"
      if (targetDeviceId) {
        const res = await getSmartHomeDeviceState(targetDeviceId, getStoreFn);
        if (res.success && res.result?.state === 'on') {
          logger.info('Plug is already ON according to Alexa, syncing and skipping action.');
          plugState = 'on';
          store.set('lastPlugState', 'on');
          if (notifyFn) notifyFn('device-status-update', { state: 'on' });
          return;
        }
      }
      action = 'turnOn';
      commandToSend = onCommand;
      newPlugState = 'on';
      logger.info(`Battery at ${percent}% <= ${lowThreshold}%. Turning on charger.`);
    } else if (percent >= highThreshold && plugState !== 'off') {
      // Re-verify actual state before acting
      if (targetDeviceId) {
        const res = await getSmartHomeDeviceState(targetDeviceId, getStoreFn);
        if (res.success && res.result?.state === 'off') {
          logger.info('Plug is already OFF according to Alexa, syncing and skipping action.');
          plugState = 'off';
          store.set('lastPlugState', 'off');
          if (notifyFn) notifyFn('device-status-update', { state: 'off' });
          return;
        }
      }
      action = 'turnOff';
      commandToSend = offCommand;
      newPlugState = 'off';
      logger.info(`Battery at ${percent}% >= ${highThreshold}%. Turning off charger.`);
    }

    if (!action && !commandToSend) return;

    // Lock in-memory state immediately — before the async call — so any
    // concurrent or back-to-back check sees the new state and won't re-fire.
    plugState = newPlugState;

    let result;
    let displayCommand = commandToSend;

    if (targetDeviceId && action) {
      result = await sendSmartHomeAction(targetDeviceId, action, getStoreFn);
      displayCommand = action === 'turnOn' ? 'Plug IN' : 'Plug OUT';
    } else if (commandToSend) {
      result = await sendCommand(commandToSend, getStoreFn);
    } else {
      return;
    }

    if (result.success) {
      // Persist to store so the state survives an app restart
      store.set('lastPlugState', newPlugState);
      store.set('lastCommand', displayCommand);
      store.set('lastCommandTime', new Date().toISOString());

      logger.info(`Action executed: "${displayCommand}"`);
      logAction({ action: displayCommand!, triggered: 'monitor', battery: percent, success: true });

      if (notifyFn) {
        notifyFn('command-executed', {
          command: displayCommand,
          time: new Date().toISOString(),
          batteryPercent: percent,
          plugState: newPlugState,
        });
      }
    } else {
      // Roll back in-memory state so the next check retries
      plugState = newPlugState === 'on' ? 'off' : 'on';
      logger.error(`Action failed: ${result.error}`);
      logAction({ action: displayCommand!, triggered: 'monitor', battery: percent, success: false, note: result.error });
    }
  } catch (err: any) {
    logger.error('Scheduler check error:', err.message);
    // Don't touch plugState on unexpected error — let next cycle retry
  } finally {
    acting = false;
    try { if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE); } catch (e) {}
  }
}

export function isRunning(): boolean {
  return running && cronTask !== null;
}

export async function manualCheck(): Promise<void> {
  return checkAndAct();
}
