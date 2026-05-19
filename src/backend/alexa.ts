'use strict';

import * as net from 'net';
import logger from './logger';

const Alexa = require('alexa-remote2');

function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      // Port in use — try a random port
      const server2 = net.createServer();
      server2.listen(0, '127.0.0.1', () => {
        const port = (server2.address() as net.AddressInfo).port;
        server2.close(() => resolve(port));
      });
      server2.on('error', reject);
    });
  });
}

let alexaInstance: any = null;
let isInitialized = false;
let initializationPromise: Promise<any> | null = null;

// ─── Proxy Login Flow ─────────────────────────────────────────────────────────

let proxyAlexa: any = null;

/**
 * Start proxy server login. Returns the proxy URL immediately.
 * onSuccess fires when the user completes Amazon login in their browser.
 */
export function startProxyLogin(
  email: string,
  getStore: () => any,
  onSuccess: (cookieData: any) => void,
  onError: (err: Error) => void
): Promise<string> {
  stopProxyLogin();

  return findAvailablePort(3001).then(proxyPort => {
    const alexa = new Alexa();
    proxyAlexa = alexa;

    const store = getStore();
    const options: any = {
      email: email || '',
      password: '',
      alexaServiceHost: store.get('alexaServiceHost') || 'alexa.amazon.com',
      amazonPage: store.get('amazonPage') || 'amazon.com',
      acceptLanguage: store.get('acceptLanguage') || 'en-US',
      cookieRefreshInterval: 0,
      proxyOnly: false,
      proxyOwnIp: 'localhost',
      proxyPort,
      proxyLogLevel: 'warn',
      amazonPageProxyLanguage: 'en_US',
      proxyCloseWindowHTML: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Connected</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f7;}
.box{text-align:center;padding:32px 40px;border-radius:16px;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,.08);}
h2{margin:0 0 8px;font-size:20px;}p{margin:0;color:#666;font-size:14px;}</style></head>
<body><div class="box"><div style="font-size:40px;margin-bottom:12px;">✅</div>
<h2>Connected to Amazon</h2><p>You can close this tab — the app will continue automatically.</p></div>
<script>setTimeout(()=>window.close(),1500);</script></body></html>`,
      logger: (msg: string) => logger.info('[alexa-remote2] ' + msg),
      bluetooth: false,
      routines: false,
      useWsMqtt: false,
    };

    const proxyUrl = `http://localhost:${proxyPort}`;

    // Listen for cookie event — fires when proxy captures login successfully
    alexa.on('cookie', (_cookie: any, _csrf: string, _macDms: any) => {
      logger.info('Cookie captured via proxy');
      const cookieData = alexa.cookieData;
      proxyAlexa = null;

      if (!cookieData) {
        onError(new Error('Login completed but no cookie data received'));
        return;
      }

      // Save to store
      const store = getStore();
      store.set('alexaEmail', email);
      store.set('alexaCookies', cookieData);
      if (cookieData.macDms) {
        store.set('alexaRegistrationData', { ...cookieData, tokenDate: Date.now() });
      }

      // Now init with formerRegistrationData to get a working instance
      initWithRegistrationData(cookieData, getStore)
        .then(() => onSuccess(cookieData))
        .catch((err: Error) => {
          // Even if re-init fails, we have cookies saved — treat as success
          logger.warn('Re-init after proxy login failed, but cookies saved:', err.message);
          onSuccess(cookieData);
        });
    });

    alexa.init(options, (err: any) => {
      if (err) {
        proxyAlexa = null;
        // "Proxy Server" error or URL message = expected when proxy starts
        if (err.message && err.message.includes(proxyUrl)) {
          // This is expected — proxy is running, waiting for user to log in via browser
          logger.info(`Proxy server running at ${proxyUrl}`);
          return;
        }
        logger.error('Proxy login init error:', err.message);
        onError(err);
      }
      // No error = cookieJustCreated path completed (unlikely without browser)
    });

    return proxyUrl;
  });
}

export function stopProxyLogin(): void {
  if (proxyAlexa) {
    try {
      if (proxyAlexa.alexaCookie) proxyAlexa.alexaCookie.stopProxyServer();
    } catch (e) {}
    proxyAlexa = null;
  }
}

// ─── Init with saved registration data (no proxy, no auth check loop) ─────────

async function initWithRegistrationData(cookieData: any, getStore: () => any): Promise<any> {
  return new Promise((resolve, reject) => {
    const alexa = new Alexa();
    const store = getStore();

    const options: any = {
      cookie: cookieData,
      email: store.get('alexaEmail') || '',
      password: '',
      alexaServiceHost: store.get('alexaServiceHost') || 'alexa.amazon.com',
      amazonPage: store.get('amazonPage') || 'amazon.com',
      acceptLanguage: store.get('acceptLanguage') || 'en-US',
      cookieRefreshInterval: 0,
      proxyOnly: false,
      proxyOwnIp: 'localhost',
      proxyPort: 3001,
      logger: (msg: string) => logger.info('[alexa-remote2] ' + msg),
      bluetooth: false,
      routines: false,
      useWsMqtt: false,
      formerRegistrationData: { ...cookieData, tokenDate: Date.now() },
    };

    if (cookieData.macDms) {
      options.macDms = cookieData.macDms;
    }

    alexa.init(options, (err: any) => {
      if (err) {
        reject(new Error(err.message || 'Init failed'));
        return;
      }

      if (alexa.cookieData) {
        store.set('alexaCookies', alexa.cookieData);
        if (alexa.cookieData.macDms) {
          store.set('alexaRegistrationData', { ...alexa.cookieData, tokenDate: Date.now() });
        }
      }

      alexaInstance = alexa;
      isInitialized = true;
      logger.info('Alexa instance ready');
      resolve(alexa);
    });
  });
}

// ─── Init with saved cookies ──────────────────────────────────────────────────

async function initAlexa(getStore: () => any): Promise<any> {
  const store = getStore();
  const cookieData = store.get('alexaCookies');
  const session = store.get('alexaSession');
  const registrationData = store.get('alexaRegistrationData') || undefined;

  if (!cookieData && !session) {
    throw new Error('No Alexa session found. Please authenticate first.');
  }

  return new Promise((resolve, reject) => {
    const alexa = new Alexa();

    const options: any = {
      cookie: cookieData || session,
      email: store.get('alexaEmail') || '',
      password: '',
      alexaServiceHost: store.get('alexaServiceHost') || 'alexa.amazon.com',
      amazonPage: store.get('amazonPage') || 'amazon.com',
      acceptLanguage: store.get('acceptLanguage') || 'en-US',
      cookieRefreshInterval: 0,
      proxyOnly: false,
      proxyOwnIp: 'localhost',
      proxyPort: 3001,
      logger: (msg: string) => logger.info('[alexa-remote2] ' + msg),
      bluetooth: false,
      routines: false,
      useWsMqtt: false,
    };

    if (registrationData) {
      options.formerRegistrationData = registrationData;
      if (registrationData.macDms) {
        options.macDms = registrationData.macDms;
      }
    }

    alexa.init(options, (err: any) => {
      if (err) {
        logger.error('Alexa init error:', err.message || 'Unknown error');
        reject(new Error('Session expired. Please re-authenticate.'));
        return;
      }

      if (alexa.cookieData) {
        store.set('alexaCookies', alexa.cookieData);
        if (alexa.cookieData.macDms) {
          store.set('alexaRegistrationData', { ...alexa.cookieData, tokenDate: Date.now() });
        }
      }

      alexaInstance = alexa;
      isInitialized = true;
      logger.info('Alexa initialized successfully');
      resolve(alexa);
    });
  });
}

export async function getAlexa(getStore: () => any): Promise<any> {
  if (isInitialized && alexaInstance) return alexaInstance;

  if (initializationPromise) return initializationPromise;

  initializationPromise = initAlexa(getStore).finally(() => {
    initializationPromise = null;
  });

  return initializationPromise;
}

// ─── Session ──────────────────────────────────────────────────────────────────

export async function validateSession(
  getStore: () => any
): Promise<{ success: boolean; deviceCount?: number; error?: string }> {
  try {
    const alexa = await getAlexa(getStore);
    return new Promise((resolve) => {
      alexa.getDevices((err: any, result: any) => {
        if (err) {
          resolve({ success: false, error: err.message || 'Session invalid' });
          return;
        }
        const devices = Array.isArray(result) ? result : (result && result.devices) || [];
        resolve({ success: true, deviceCount: devices.length });
      });
    });
  } catch (err: any) {
    logger.error('Session validation failed:', err.message);
    return { success: false, error: err.message };
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function sendCommandOnce(alexa: any, command: string): Promise<{ method: string }> {
  return new Promise((resolve, reject) => {
    alexa.getDevices((err: any, result: any) => {
      if (err) {
        reject(new Error('Failed to get devices: ' + (err.message || err)));
        return;
      }

      // API returns either an array or { devices: [...] }
      const devices: any[] = Array.isArray(result) ? result : (result && result.devices) || [];

      if (!devices || devices.length === 0) {
        reject(new Error('No Alexa devices found'));
        return;
      }

      const device = devices.find((d: any) =>
        d.deviceFamily === 'ECHO' ||
        d.deviceFamily === 'KNIGHT' ||
        d.deviceFamily === 'FIRE_TV' ||
        (d.capabilities && d.capabilities.some((c: any) => c.interfaceName === 'Alexa.SpeechRecognizer'))
      ) || devices[0];

      logger.info(`Sending command to device: ${device.accountName || device.serialNumber}`);

      alexa.sendSequenceCommand(device.serialNumber, 'textCommand', command, (err2: any) => {
        if (err2) {
          alexa.executeAutomation(device, { value: { text: command } }, (err3: any) => {
            if (err3) {
              alexa.sendSequenceCommand(device.serialNumber, 'speak', command, (err4: any) => {
                if (err4) reject(new Error(err4.message || 'Command failed'));
                else resolve({ method: 'speak' });
              });
            } else {
              resolve({ method: 'automation' });
            }
          });
        } else {
          resolve({ method: 'textCommand' });
        }
      });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function sendCommand(
  command: string,
  getStore: () => any,
  retries = 3
): Promise<{ success: boolean; result?: any; error?: string }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`Sending Alexa command (attempt ${attempt}/${retries}): "${command}"`);
      const alexa = await getAlexa(getStore);
      const result = await sendCommandOnce(alexa, command);
      logger.info(`Command sent successfully: "${command}"`);
      return { success: true, result };
    } catch (err: any) {
      lastError = err;
      logger.warn(`Command attempt ${attempt} failed: ${err.message}`);

      if (err.message && (err.message.includes('auth') || err.message.includes('401') || err.message.includes('cookie') || err.message.includes('expired'))) {
        alexaInstance = null;
        isInitialized = false;
      }

      if (attempt < retries) await sleep(1000 * attempt);
    }
  }

  logger.error(`Command failed after ${retries} attempts: ${lastError!.message}`);
  return { success: false, error: lastError!.message };
}

export async function sendSmartHomeAction(
  entityId: string,
  action: string,
  getStore: () => any,
  retries = 3
): Promise<{ success: boolean; result?: any; error?: string }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`Sending Smart Home action (attempt ${attempt}/${retries}): ${action} for ${entityId}`);
      const alexa = await getAlexa(getStore);
      
      const result = await new Promise((resolve, reject) => {
        alexa.executeSmarthomeDeviceAction(entityId, { action }, (err: any, res: any) => {
          if (err) { reject(err); return; }
          const errors = res && res.errors;
          if (errors && errors.length > 0) {
            reject(new Error(errors[0].code || 'Action failed'));
          } else {
            resolve(res);
          }
        });
      });

      logger.info(`Smart Home action ${action} successful`);
      return { success: true, result };
    } catch (err: any) {
      lastError = err;
      logger.warn(`Action attempt ${attempt} failed: ${err.message}`);

      if (err.message && (err.message.includes('auth') || err.message.includes('401') || err.message.includes('cookie') || err.message.includes('expired'))) {
        alexaInstance = null;
        isInitialized = false;
      }

      if (attempt < retries) await sleep(1000 * attempt);
    }
  }

  logger.error(`Action failed after ${retries} attempts: ${lastError!.message}`);
  return { success: false, error: lastError!.message };
}

export async function getSmartHomeDeviceState(
  entityId: string,
  getStore: () => any
): Promise<{ success: boolean; state?: 'on' | 'off'; error?: string }> {
  try {
    const alexa = await getAlexa(getStore);
    return new Promise((resolve) => {
      alexa.querySmarthomeDevices([entityId], (err: any, res: any) => {
        if (err) {
          resolve({ success: false, error: err.message || String(err) });
          return;
        }

        // Response structure: { deviceStates: [ { entityId: '...', capabilityStates: [ '{"namespace":"...","name":"...","value":"..."}' ] } ] }
        const deviceState = res?.deviceStates?.find((s: any) => s.entityId === entityId);
        if (!deviceState || !deviceState.capabilityStates) {
          resolve({ success: false, error: 'Device state not found or incomplete' });
          return;
        }

        let state: 'on' | 'off' | undefined;
        for (const capStr of deviceState.capabilityStates) {
          try {
            const cap = JSON.parse(capStr);
            if (cap.namespace === 'Alexa.PowerController' && cap.name === 'powerState') {
              state = cap.value === 'ON' ? 'on' : 'off';
              break;
            }
          } catch (e) {
            // Ignore parse errors for individual capability strings
          }
        }

        if (state) {
          resolve({ success: true, state });
        } else {
          resolve({ success: false, error: 'Power state capability not found' });
        }
      });
    });
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export function resetInstance(): void {
  alexaInstance = null;
  isInitialized = false;
}
