'use strict';

import * as path from 'path';
import { BrowserWindow, Notification, IpcMain, App } from 'electron';
import * as battery from '../backend/battery';
import * as alexa from '../backend/alexa';
import * as scheduler from '../backend/scheduler';
import * as launchAgent from '../backend/launchagent';
import { logAction, getHistory, clearHistory, closeDb, DB_PATH, DB_DIR } from '../backend/historydb';
import logger from '../backend/logger';
import { encryptValue, decryptValue, setQuitting } from '../index';

function friendlySmartHomeError(code: string): string {
  switch (code) {
    case 'TargetApplianceUnreachableException':
    case 'ENDPOINT_UNREACHABLE':
    case 'BRIDGE_UNREACHABLE':
      return 'Device is offline or unreachable. Check your smart plug is powered on and connected.';
    case 'TARGET_FIRMWARE_OUTDATED':
      return 'Device firmware is outdated. Please update it in the Alexa app.';
    case 'INSUFFICIENT_PERMISSIONS':
    case 'NOT_SUPPORTED_IN_CURRENT_MODE':
      return 'Action not supported for this device.';
    case 'RATE_LIMIT_EXCEEDED':
      return 'Too many requests. Please wait a moment and try again.';
    case 'DEVICE_BUSY':
      return 'Device is busy. Try again in a moment.';
    case 'EXPIRED_AUTHORIZATION_CREDENTIAL':
    case 'INVALID_AUTHORIZATION_CREDENTIAL':
      return 'Session expired. Please log out and sign in again.';
    default:
      return `Device error: ${code}`;
  }
}

let storeGetter: (() => any) | null = null;
let appRef: App | null = null;

function getStore(): any {
  return storeGetter!();
}

// Wrap the store so cookie reads/writes are transparently encrypted
function makeSecureStore(raw: any) {
  return {
    get: (key: string) => {
      const val = raw.get(key);
      if ((key === 'alexaCookies' || key === 'alexaRegistrationData') && typeof val === 'string' && val) {
        return JSON.parse(decryptValue(val));
      }
      return val;
    },
    set: (key: string, value: any) => {
      if ((key === 'alexaCookies' || key === 'alexaRegistrationData') && value && typeof value === 'object') {
        raw.set(key, encryptValue(JSON.stringify(value)));
      } else {
        raw.set(key, value);
      }
    },
  };
}

function getSecureStore(): any {
  const raw = getStore();
  return makeSecureStore(raw);
}

function sendNotification(title: string, body: string): void {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

function notifyWindows(channel: string, data: any): void {
  const wins = BrowserWindow.getAllWindows();
  wins.forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  });
}

export function register(ipcMain: IpcMain, getStoreFn: () => any, app: App, win: BrowserWindow | null): void {
  storeGetter = getStoreFn;
  appRef = app;

  // ─── Config ────────────────────────────────────────────────────────────────

  ipcMain.handle('get-config', async () => {
    try {
      const store = getStore();
      return {
        success: true,
        config: {
          onCommand: store.get('onCommand'),
          offCommand: store.get('offCommand'),
          lowThreshold: store.get('lowThreshold'),
          highThreshold: store.get('highThreshold'),
          monitorEnabled: store.get('monitorEnabled'),
          runOnStartup: store.get('runOnStartup'),
          targetDeviceId: store.get('targetDeviceId'),
          targetDeviceName: store.get('targetDeviceName'),
          lastCommand: store.get('lastCommand'),
          lastCommandTime: store.get('lastCommandTime'),
          hasSession: store.get('alexaSession') !== null || store.get('alexaCookies') !== null,
          alexaEmail: store.get('alexaEmail'),
          alexaServiceHost: store.get('alexaServiceHost') || 'alexa.amazon.com',
          amazonPage: store.get('amazonPage') || 'amazon.com',
          acceptLanguage: store.get('acceptLanguage') || 'en-US',
        }
      };
    } catch (err: any) {
      logger.error('Handler error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('set-startup', async (_event: any, enabled: boolean) => {
    try {
      // Only works from a packaged app — in dev mode the exe is the raw
      // Electron binary which opens a blank window on login.
      if (!appRef!.isPackaged) {
        return { success: false, error: 'Run at Startup only works in the built app, not in dev mode.' };
      }
      const store = getStore();
      store.set('runOnStartup', enabled);
      appRef!.setLoginItemSettings({ openAtLogin: enabled });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('set-monitor', async (_event: any, enabled: boolean) => {
    try {
      const store = getStore();
      store.set('monitorEnabled', enabled);
      if (enabled) {
        // Reset plug state so the first check acts on real battery level,
        // not stale state from a previous session or manual toggle
        store.set('lastPlugState', null);
        scheduler.start(getSecureStore, notifyWindows);
        // LaunchAgent only works correctly from a packaged app — in dev mode
        // process.execPath points to the raw Electron binary which opens a window.
        if (appRef!.isPackaged) {
          await launchAgent.install(appRef);
        }
      } else {
        scheduler.stop();
        if (appRef!.isPackaged) {
          await launchAgent.uninstall();
        }
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('set-config', async (_event: any, key: string, value: any) => {
    try {
      const store = getStore();
      store.set(key, value);
      return { success: true };
    } catch (err: any) {
      logger.error('Handler error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('set-multi-config', async (_event: any, obj: Record<string, any>) => {
    try {
      const store = getStore();
      for (const [key, value] of Object.entries(obj)) {
        store.set(key, value);
      }
      // If thresholds changed and monitor is enabled, check immediately
      // Don't gate on isRunning() — the scheduler auto-starts on launch if monitorEnabled,
      // and checkAndAct() itself guards against monitorEnabled=false
      if ('lowThreshold' in obj || 'highThreshold' in obj) {
        if (scheduler.isRunning()) {
          scheduler.manualCheck().catch(() => {});
        } else if (getStore().get('monitorEnabled')) {
          // Scheduler not running yet (race on startup) — start it then check
          scheduler.start(getSecureStore, notifyWindows);
        }
      }
      return { success: true };
    } catch (err: any) {
      logger.error('Handler error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ─── Alexa Auth ─────────────────────────────────────────────────────────────

  ipcMain.handle('start-proxy-login', async (_event: any, email: string) => {
    try {
      logger.info('Starting proxy login for:', email);
      const proxyUrl = await alexa.startProxyLogin(
        email,
        getSecureStore,
        (_cookieData: any) => {
          // Notify wizard renderer so it can proceed to device selection step
          notifyWindows('auth-success', {});
        },
        (err: Error) => {
          logger.error('Proxy login failed:', err.message);
          notifyWindows('auth-error', { error: err.message });
        }
      );
      return { success: true, proxyUrl };
    } catch (err: any) {
      logger.error('Handler error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('stop-proxy-login', async () => {
    alexa.stopProxyLogin();
    return { success: true };
  });

  ipcMain.handle('validate-session', async () => {
    try {
      return await alexa.validateSession(getSecureStore);
    } catch (err: any) {
      logger.error('Handler error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('clear-session', async () => {
    try {
      const store = getStore();
      store.set('alexaSession', null);
      store.set('alexaCookies', null);
      store.set('alexaRegistrationData', null);
      store.set('alexaEmail', null);
      store.set('targetDeviceId', null);
      store.set('targetDeviceName', null);
      store.set('monitorEnabled', false);
      store.set('lastPlugState', null);
      store.set('lastCommand', null);
      store.set('lastCommandTime', null);
      alexa.stopProxyLogin();
      alexa.resetInstance();
      scheduler.stop();
      const wins = BrowserWindow.getAllWindows();
      if (wins.length > 0) {
        wins[0].loadFile(path.join(__dirname, '..', '..', 'src', 'frontend', 'wizard.html'));
      }
      return { success: true };
    } catch (err: any) {
      logger.error('Handler error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ─── Devices ─────────────────────────────────────────────────────────────────

  ipcMain.handle('get-alexa-devices', async () => {
    try {
      const alexaInst = await alexa.getAlexa(getSecureStore);
      return new Promise((resolve) => {
        alexaInst.getDevices((err: any, result: any) => {
          if (err) { resolve({ success: false, error: err.message || String(err) }); return; }
          const devices: any[] = Array.isArray(result) ? result : (result && result.devices) || [];
          resolve({ success: true, devices: devices.map((d: any) => ({
            name: d.accountName || d.serialNumber,
            serialNumber: d.serialNumber,
            deviceFamily: d.deviceFamily,
            deviceType: d.deviceType,
          }))});
        });
      });
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-smart-home-devices', async () => {
    try {
      const alexaInst = await alexa.getAlexa(getSecureStore);

      // Try getSmarthomeEntities first (behaviors/entities endpoint)
      const entitiesResult: any = await new Promise((resolve) => {
        alexaInst.getSmarthomeEntities((err: any, result: any) => {
          if (err) { resolve({ err: err.message || String(err) }); return; }
          resolve({ result });
        });
      });

      const entities: any[] = (!entitiesResult.err && Array.isArray(entitiesResult.result) && entitiesResult.result.length > 0)
        ? entitiesResult.result
        : [];

      if (entities.length > 0) {
        return { success: true, devices: entities.map((e: any) => ({
          name: e.displayName || e.name || e.entityId || e.id || 'Unknown Device',
          entityId: e.entityId || e.id || e.applianceId,
          type: e.entityType || 'APPLIANCE',
        }))};
      }

      // Fallback: try getSmarthomeDevices (phoenix endpoint)
      return new Promise((resolve) => {
        alexaInst.getSmarthomeDevices((err: any, locationDetails: any) => {
          if (err) { resolve({ success: false, error: err.message || String(err) }); return; }
          // locationDetails is a nested object — flatten all appliances
          const devices: any[] = [];
          try {
            for (const locKey of Object.keys(locationDetails || {})) {
              const loc = locationDetails[locKey];
              const groups = loc.locationDetails || {};
              for (const grpKey of Object.keys(groups)) {
                const grp = groups[grpKey];
                const appliances = grp.applianceDetails?.applianceDetails || {};
                for (const appKey of Object.keys(appliances)) {
                  const app = appliances[appKey];
                  devices.push({
                    name: app.friendlyName || app.applianceId,
                    entityId: app.applianceId,
                    type: 'APPLIANCE',
                    manufacturer: app.manufacturerName,
                  });
                }
              }
            }
          } catch (e) {
            resolve({ success: false, error: 'Failed to parse smart home devices: ' + (e as any).message });
            return;
          }
          resolve({ success: true, devices });
        });
      });
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('debug-smart-home', async () => {
    try {
      const alexaInst = await alexa.getAlexa(getSecureStore);
      const results: any = {};

      await new Promise<void>((resolve) => {
        alexaInst.getSmarthomeEntities((err: any, result: any) => {
          results.entities = { err: err?.message, result };
          resolve();
        });
      });

      await new Promise<void>((resolve) => {
        alexaInst.getSmarthomeDevices((err: any, result: any) => {
          results.phoenix = { err: err?.message, result };
          resolve();
        });
      });

      logger.info('Smart home debug:', JSON.stringify(results, null, 2));
      return { success: true, results };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('send-smart-home-action', async (_event: any, entityId: string, action: string) => {
    try {
      const alexaInst = await alexa.getAlexa(getSecureStore);
      return new Promise((resolve) => {
        const label = action === 'turnOn' ? 'Plug IN' : 'Plug OUT';
        alexaInst.executeSmarthomeDeviceAction(entityId, { action }, (err: any, result: any) => {
          if (err) {
            logAction({ action: label, triggered: 'manual', success: false, note: err.message });
            resolve({ success: false, error: err.message || String(err) }); return;
          }
          const errors = result && result.errors;
          if (errors && errors.length > 0) {
            const code = errors[0].code || 'Smart home action failed';
            const friendly = friendlySmartHomeError(code);
            logAction({ action: label, triggered: 'manual', success: false, note: friendly });
            resolve({ success: false, error: friendly, result });
          } else {
            logAction({ action: label, triggered: 'manual', success: true });
            const store = getStore();
            const newState = action === 'turnOn' ? 'on' : 'off';
            store.set('lastCommand', label);
            store.set('lastCommandTime', new Date().toISOString());
            store.set('lastPlugState', newState);
            // Sync scheduler's in-memory state so next auto-check doesn't re-fire
            scheduler.setPlugState(newState);
            resolve({ success: true, result });
          }
        });
      });
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-smart-home-device-state', async (_event: any, entityId: string) => {
    try {
      return await alexa.getSmartHomeDeviceState(entityId, getSecureStore);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ─── Commands ────────────────────────────────────────────────────────────────

  ipcMain.handle('send-alexa-command', async (_event: any, command: string) => {
    try {
      const result = await alexa.sendCommand(command, getSecureStore);
      if (result.success) {
        const store = getStore();
        store.set('lastCommand', command);
        store.set('lastCommandTime', new Date().toISOString());
        logAction({ action: command, triggered: 'manual', success: true });
      } else {
        logAction({ action: command, triggered: 'manual', success: false, note: result.error });
      }
      return result;
    } catch (err: any) {
      logger.error('Handler error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('test-on-command', async () => {
    try {
      const store = getStore();
      const command = store.get('onCommand');
      const result = await alexa.sendCommand(command, getSecureStore);
      if (result.success) {
        store.set('lastCommand', command);
        store.set('lastCommandTime', new Date().toISOString());
        sendNotification('PlugPilot', `Sent: "${command}"`);
        logAction({ action: command, triggered: 'manual', success: true });
      } else {
        logAction({ action: command, triggered: 'manual', success: false, note: result.error });
      }
      return result;
    } catch (err: any) {
      logger.error('Handler error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('test-off-command', async () => {
    try {
      const store = getStore();
      const command = store.get('offCommand');
      const result = await alexa.sendCommand(command, getSecureStore);
      if (result.success) {
        store.set('lastCommand', command);
        store.set('lastCommandTime', new Date().toISOString());
        sendNotification('PlugPilot', `Sent: "${command}"`);
        logAction({ action: command, triggered: 'manual', success: true });
      } else {
        logAction({ action: command, triggered: 'manual', success: false, note: result.error });
      }
      return result;
    } catch (err: any) {
      logger.error('Handler error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ─── History ──────────────────────────────────────────────────────────────────

  ipcMain.handle('get-history', async () => {
    try {
      return { success: true, rows: getHistory(200) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('clear-history', async () => {
    try {
      clearHistory();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('delete-all-data', async () => {
    try {
      // 1. Stop scheduler and LaunchAgent
      scheduler.stop();
      await launchAgent.uninstall().catch(() => {});

      // 2. Reset Alexa session
      alexa.stopProxyLogin();
      alexa.resetInstance();

      // 3. Clear all store keys
      const store = getStore();
      store.clear();

      // 4. Close and delete the SQLite history DB
      closeDb();
      const fsSync = require('fs');
      if (fsSync.existsSync(DB_PATH)) fsSync.unlinkSync(DB_PATH);

      // 5. Delete all log files
      const logsDir = require('path').join(DB_DIR, 'logs');
      if (fsSync.existsSync(logsDir)) {
        fsSync.readdirSync(logsDir).forEach((f: string) => {
          try { fsSync.unlinkSync(require('path').join(logsDir, f)); } catch (_) {}
        });
      }

      // 6. Navigate to wizard for fresh setup
      const wins = BrowserWindow.getAllWindows();
      if (wins.length > 0) {
        wins[0].loadFile(path.join(__dirname, '..', '..', 'src', 'frontend', 'wizard.html'));
      }

      return { success: true };
    } catch (err: any) {
      logger.error('delete-all-data error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ─── Battery ─────────────────────────────────────────────────────────────────

  ipcMain.handle('get-battery', async () => {
    try {
      const info = await battery.getBatteryInfo();
      return { success: true, ...info };
    } catch (err: any) {
      logger.error('Handler error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ─── Navigation ──────────────────────────────────────────────────────────────

  ipcMain.handle('navigate-to', async (_event: any, page: string) => {
    try {
      const wins = BrowserWindow.getAllWindows();
      if (wins.length > 0) {
        const filePath = path.join(__dirname, '..', '..', 'src', 'frontend', page);
        wins[0].loadFile(filePath);
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ─── Open external URL ───────────────────────────────────────────────────────

  ipcMain.handle('open-logs-dir', async () => {
    const { shell } = require('electron');
    const logDir = require('path').join(require('os').homedir(), 'Library', 'Application Support', 'PlugPilot', 'logs');
    const fs = require('fs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    await shell.openPath(logDir);
    return { success: true };
  });

  ipcMain.handle('open-url', async (_event: any, url: string) => {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: 'Invalid protocol' };
      }
      const { shell } = require('electron');
      await shell.openExternal(url);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ─── Notifications ───────────────────────────────────────────────────────────

  ipcMain.handle('show-notification', async (_event: any, title: string, body: string) => {
    sendNotification(title, body);
    return { success: true };
  });

  // ─── App Control ─────────────────────────────────────────────────────────────

  ipcMain.handle('quit-app', async () => {
    setQuitting();
    app.quit();
    return { success: true };
  });

  ipcMain.handle('minimize-app', async () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) wins[0].hide();
    return { success: true };
  });

  // ─── Auto-start scheduler if was enabled ─────────────────────────────────────

  const store = getStore();
  if (store.get('monitorEnabled')) {
    setTimeout(async () => {
      logger.info('Performing startup auth and state check...');
      
      // 1. Proactively validate session
      const auth = await alexa.validateSession(getSecureStore);
      if (!auth.success) {
        logger.warn('Startup auth validation failed:', auth.error);
        sendNotification('PlugPilot', 'Alexa session expired. Please open the app to re-authenticate.');
        // We still start the scheduler; it will handle errors gracefully during checks
      }

      // 2. Start scheduler (it will handle its own syncDeviceState)
      scheduler.start(getSecureStore, notifyWindows);
    }, 2000);
  }
}
