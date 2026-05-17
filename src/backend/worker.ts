#!/usr/bin/env node
'use strict';

/**
 * PlugPilot Background Worker
 * Runs independently of the Electron UI, managed by macOS LaunchAgent.
 * Checks battery every 2 minutes.
 *
 * Reads config from ~/Library/Application Support/PlugPilot/config.json
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import si from 'systeminformation';

const APP_SUPPORT = path.join(os.homedir(), 'Library', 'Application Support', 'PlugPilot');
const LOG_DIR = path.join(APP_SUPPORT, 'logs');
const CONFIG_FILE = path.join(APP_SUPPORT, 'config.json');

const ELECTRON_STORE_FILE = path.join(
  os.homedir(), 'Library', 'Application Support', 'plugpilot',
  'plugpilot-config.json'
);

[APP_SUPPORT, LOG_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Logger ───────────────────────────────────────────────────────────────────

const LOG_FILE = path.join(LOG_DIR, 'worker.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024;

function log(level: string, ...args: any[]): void {
  const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
  const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  const line = `${timestamp} [${level}] ${message}\n`;

  process.stdout.write(line);

  try {
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        fs.renameSync(LOG_FILE, LOG_FILE + '.old');
      }
    }
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {
    // Ignore log write errors
  }
}

const logger = {
  info: (...args: any[]) => log('INFO', ...args),
  warn: (...args: any[]) => log('WARN', ...args),
  error: (...args: any[]) => log('ERROR', ...args),
};

// ─── Config ───────────────────────────────────────────────────────────────────

interface WorkerConfig {
  alexaSession: string | null;
  alexaCookies: string | null;
  alexaEmail: string;
  alexaServiceHost: string;
  amazonPage: string;
  acceptLanguage: string;
  onCommand: string;
  offCommand: string;
  lowThreshold: number;
  highThreshold: number;
  targetDeviceId: string | null;
  targetDeviceName: string | null;
  monitorEnabled: boolean;
  lastPlugState: 'on' | 'off' | null;
  lastCommandTime: string | null;
  lastCommand: string | null;
}

const DEFAULTS: WorkerConfig = {
  alexaSession: null,
  alexaCookies: null,
  alexaEmail: '',
  alexaServiceHost: 'alexa.amazon.com',
  amazonPage: 'amazon.com',
  acceptLanguage: 'en-US',
  onCommand: 'turn on Smart Plug Mac',
  offCommand: 'turn off Smart Plug Mac',
  lowThreshold: 20,
  highThreshold: 80,
  targetDeviceId: null,
  targetDeviceName: null,
  monitorEnabled: false,
  lastPlugState: null,
  lastCommandTime: null,
  lastCommand: null,
};

function readConfig(): WorkerConfig {
  for (const file of [ELECTRON_STORE_FILE, CONFIG_FILE]) {
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw);
        return { ...DEFAULTS, ...parsed };
      }
    } catch (e: any) {
      logger.warn(`Failed to read ${file}: ${e.message}`);
    }
  }
  return { ...DEFAULTS };
}

function writeConfig(updates: Partial<WorkerConfig>): void {
  try {
    const existing = readConfig();
    const merged = { ...existing, ...updates };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
  } catch (e: any) {
    logger.error('Failed to write config:', e.message);
  }

  try {
    if (fs.existsSync(ELECTRON_STORE_FILE)) {
      const raw = fs.readFileSync(ELECTRON_STORE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      const merged = { ...parsed, ...updates };
      fs.writeFileSync(ELECTRON_STORE_FILE, JSON.stringify(merged, null, 2), 'utf8');
    }
  } catch (e: any) {
    logger.warn('Failed to update electron-store file:', e.message);
  }
}

// ─── Battery ──────────────────────────────────────────────────────────────────

async function getBattery(): Promise<{ percent: number; isCharging: boolean; hasBattery: boolean }> {
  try {
    const data = await si.battery();
    return {
      percent: Math.round(data.percent || 0),
      isCharging: data.isCharging || false,
      hasBattery: data.hasBattery !== false,
    };
  } catch (err: any) {
    logger.error('Failed to get battery:', err.message);
    throw err;
  }
}

// ─── Alexa ────────────────────────────────────────────────────────────────────

let alexaInstance: any = null;
let alexaInitialized = false;

async function getAlexaInstance(config: WorkerConfig): Promise<any> {
  if (alexaInitialized && alexaInstance) return alexaInstance;

  const Alexa = require('alexa-remote2');
  const alexa = new Alexa();

  const cookies = config.alexaCookies || config.alexaSession;
  if (!cookies) {
    throw new Error('No Alexa cookies/session configured');
  }

  return new Promise((resolve, reject) => {
    alexa.init({
      cookie: cookies,
      email: config.alexaEmail || '',
      password: '',
      alexaServiceHost: config.alexaServiceHost || 'alexa.amazon.com',
      amazonPage: config.amazonPage || 'amazon.com',
      acceptLanguage: config.acceptLanguage || 'en-US',
      cookieRefreshInterval: 0,
      proxyOnly: false,
      proxyOwnIp: 'localhost',
      proxyPort: 3001,
      bluetooth: false,
      routines: false,
      useWsMqtt: false,
    }, (err: any) => {
      if (err) {
        reject(new Error('Alexa init failed: ' + (err.message || err)));
        return;
      }
      alexaInstance = alexa;
      alexaInitialized = true;
      resolve(alexa);
    });
  });
}

async function sendSmartHomeAction(entityId: string, action: string, config: WorkerConfig, retries = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`Sending Smart Home action (attempt ${attempt}): ${action} for ${entityId}`);
      const alexa = await getAlexaInstance(config);

      await new Promise<void>((resolve, reject) => {
        alexa.executeSmarthomeDeviceAction(entityId, { action }, (err: any, res: any) => {
          if (err) { reject(err); return; }
          const errors = res && res.errors;
          if (errors && errors.length > 0) {
            reject(new Error(errors[0].code || 'Action failed'));
          } else {
            resolve();
          }
        });
      });

      logger.info(`Smart Home action ${action} successful`);
      return true;
    } catch (err: any) {
      logger.warn(`Attempt ${attempt} failed: ${err.message}`);
      if (err.message.includes('auth') || err.message.includes('401')) {
        alexaInstance = null;
        alexaInitialized = false;
      }
      if (attempt < retries) await sleep(1000 * attempt);
    }
  }
  return false;
}

async function sendAlexaCommand(command: string, config: WorkerConfig, retries = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`Sending command (attempt ${attempt}): "${command}"`);
      const alexa = await getAlexaInstance(config);

      await new Promise<void>((resolve, reject) => {
        alexa.getDevices((err: any, devices: any[]) => {
          if (err || !devices || devices.length === 0) {
            reject(new Error(err ? err.message : 'No devices found'));
            return;
          }

          const device = devices.find((d: any) => d.deviceFamily === 'ECHO') || devices[0];

          alexa.sendSequenceCommand(device.serialNumber, 'textCommand', command, (err2: any) => {
            if (err2) {
              alexa.sendSequenceCommand(device.serialNumber, 'speak', command, (err3: any) => {
                if (err3) reject(new Error(err3.message || 'Command failed'));
                else resolve();
              });
            } else {
              resolve();
            }
          });
        });
      });

      logger.info(`Command sent successfully: "${command}"`);
      return true;
    } catch (err: any) {
      logger.warn(`Attempt ${attempt} failed: ${err.message}`);
      if (err.message.includes('auth') || err.message.includes('401')) {
        alexaInstance = null;
        alexaInitialized = false;
      }
      if (attempt < retries) {
        await sleep(1000 * attempt);
      }
    }
  }

  logger.error(`Command failed after ${retries} attempts`);
  return false;
}

// ─── Notification ─────────────────────────────────────────────────────────────

function notify(title: string, message: string): void {
  try {
    const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`;
    exec(`osascript -e '${script}'`, (err) => {
      if (err) logger.warn('Notification failed:', err.message);
    });
  } catch (e: any) {
    logger.warn('Failed to send notification:', e.message);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  logger.info('=== PlugPilot Worker Starting ===');

  const config = readConfig();

  if (!config.monitorEnabled) {
    logger.info('Monitoring is disabled. Exiting.');
    process.exit(0);
    return;
  }

  if (!config.alexaCookies && !config.alexaSession) {
    logger.warn('No Alexa session configured. Exiting.');
    process.exit(1);
    return;
  }

  try {
    const batteryInfo = await getBattery();
    const { percent, isCharging } = batteryInfo;

    logger.info(`Battery: ${percent}% | Charging: ${isCharging} | LastPlug: ${config.lastPlugState}`);
    logger.info(`Thresholds: Low=${config.lowThreshold}% | High=${config.highThreshold}%`);

    let commandToSend: string | null = null;
    let action: 'turnOn' | 'turnOff' | null = null;
    let newPlugState = config.lastPlugState;

    if (percent <= config.lowThreshold && config.lastPlugState !== 'on') {
      commandToSend = config.onCommand;
      action = 'turnOn';
      newPlugState = 'on';
      logger.info(`Battery ${percent}% <= ${config.lowThreshold}% → Turning ON charger`);
    } else if (percent >= config.highThreshold && config.lastPlugState !== 'off') {
      commandToSend = config.offCommand;
      action = 'turnOff';
      newPlugState = 'off';
      logger.info(`Battery ${percent}% >= ${config.highThreshold}% → Turning OFF charger`);
    } else {
      logger.info(`Battery ${percent}% is within range. No action needed.`);
    }

    if (action || commandToSend) {
      let success = false;
      let displayCommand = commandToSend;

      if (config.targetDeviceId && action) {
        success = await sendSmartHomeAction(config.targetDeviceId, action, config);
        displayCommand = `Smart Home ${action}`;
      } else if (commandToSend) {
        success = await sendAlexaCommand(commandToSend, config);
      }

      if (success) {
        writeConfig({
          lastPlugState: newPlugState as 'on' | 'off',
          lastCommand: displayCommand,
          lastCommandTime: new Date().toISOString(),
        });

        const status = newPlugState === 'on' ? 'plugged in' : 'unplugged';
        notify('PlugPilot', `Charger ${status} at ${percent}%`);
        logger.info(`State updated: plugState=${newPlugState}`);
      }
    }

    logger.info('=== Worker run complete ===');
    process.exit(0);
  } catch (err: any) {
    logger.error('Worker error:', err.message);
    process.exit(1);
  }
}

const TIMEOUT = 60000;
const timeout = setTimeout(() => {
  logger.error('Worker timed out after 60 seconds');
  process.exit(2);
}, TIMEOUT);
timeout.unref();

main().catch(err => {
  logger.error('Unhandled error in worker:', err.message);
  process.exit(1);
});
