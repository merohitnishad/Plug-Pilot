'use strict';

import { app, BrowserWindow, ipcMain, nativeTheme, Menu, Tray, shell, safeStorage, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// ─── macOS only ───────────────────────────────────────────────────────────────
if (process.platform !== 'darwin') {
  dialog.showErrorBox(
    'Unsupported Platform',
    'PlugPilot is a macOS-only application.\n\nWindows and Linux are not supported.'
  );
  app.exit(1);
}

// ─── Store ────────────────────────────────────────────────────────────────────

let _store: any = null;

function getStore(): any {
  if (!_store) {
    const Store = require('electron-store');
    _store = new Store({
      name: 'plugpilot-config',
      defaults: {
        alexaSession: null,
        alexaCookies: null,
        alexaEmail: '',
        onCommand: 'turn on Smart Plug Mac',
        offCommand: 'turn off Smart Plug Mac',
        lowThreshold: 20,
        highThreshold: 80,
        monitorEnabled: false,
        targetDeviceId: null,
        targetDeviceName: null,
        runOnStartup: false,
        alexaServiceHost: 'alexa.amazon.com',
        amazonPage: 'amazon.com',
        acceptLanguage: 'en-US',
        lastPlugState: null,
        lastCommandTime: null,
        lastCommand: null,
      }
    });
  }
  return _store;
}

// ─── Windows ──────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function createMainWindow(): BrowserWindow {
  const isDark = nativeTheme.shouldUseDarkColors;

  const win = new BrowserWindow({
    width: 520,
    height: 560,
    minWidth: 460,
    minHeight: 480,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: isDark ? '#1e1e2e' : '#f5f5f7',
    show: false,
    title: 'PlugPilot',
    trafficLightPosition: { x: 14, y: 14 },
    icon: path.join(__dirname, '..', 'src', 'icons', 'icon.png'),
  });

  const store = getStore();
  const hasSession = store.get('alexaSession') !== null || store.get('alexaCookies') !== null;
  const hasDevice = store.get('targetDeviceId') !== null;

  const frontendDir = path.join(__dirname, '..', 'src', 'frontend');
  if (hasSession && hasDevice) {
    win.loadFile(path.join(frontendDir, 'index.html'));
  } else {
    // Start with onboarding wizard
    win.loadFile(path.join(frontendDir, 'wizard.html'));
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  win.on('close', (event) => {
    if (isQuitting) return; // let it close cleanly

    const store = getStore();
    const hasSession = store.get('alexaSession') !== null || store.get('alexaCookies') !== null;
    const hasDevice = store.get('targetDeviceId') !== null;
    const setupComplete = hasSession && hasDevice;

    if (process.platform === 'darwin' && setupComplete) {
      // After setup: hide to tray, never quit on window close
      event.preventDefault();
      win.hide();
    }
    // During onboarding: let the window close → triggers window-all-closed → quits
  });

  return win;
}

function createTray(): void {
  // Prefer the small tray icon (22px); fall back to full icon
  const trayIcon  = path.join(__dirname, '..', 'src', 'icons', 'tray-icon.png');
  const fallback  = path.join(__dirname, '..', 'src', 'icons', 'icon.png');

  const iconToUse = fs.existsSync(trayIcon) ? trayIcon : fs.existsSync(fallback) ? fallback : null;
  if (!iconToUse) return;

  try {
    tray = new Tray(iconToUse);
    tray.setToolTip('PlugPilot');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show PlugPilot',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            mainWindow = createMainWindow();
          }
        }
      },
      { type: 'separator' },
      { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.focus();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
  } catch (e: any) {
    console.error('Failed to create tray:', e.message);
  }
}

function createAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'PlugPilot',
      submenu: [
        { label: 'About PlugPilot', role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences',
          accelerator: 'Cmd+,',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('open-preferences');
          }
        },
        { type: 'separator' },
        { label: 'Hide PlugPilot', role: 'hide' },
        { label: 'Hide Others', role: 'hideOthers' },
        { label: 'Show All', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit PlugPilot', click: () => { isQuitting = true; app.quit(); } }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About PlugPilot',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.show();
              mainWindow.webContents.send('open-about');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'View History',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.show();
              mainWindow.loadFile(path.join(__dirname, '..', 'src', 'frontend', 'logs.html'));
            }
          }
        },
        {
          label: 'Open Log Files',
          click: () => {
            const logDir = path.join(app.getPath('userData'), 'logs');
            if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
            shell.openPath(logDir);
          }
        },
        {
          label: 'Open Config Directory',
          click: () => {
            shell.openPath(app.getPath('userData'));
          }
        },
        { type: 'separator' },
        {
          label: 'Report a Bug…',
          click: () => { shell.openExternal('https://plugpilot.com/report-a-bug'); }
        },
        {
          label: 'Send Feedback…',
          click: () => { shell.openExternal('https://plugpilot.com/feedback'); }
        },
        {
          label: 'View on GitHub',
          click: () => { shell.openExternal('https://github.com/merohitnishad/Plug-Pilot'); }
        },
        { type: 'separator' },
        {
          label: 'Privacy Policy',
          click: () => { shell.openExternal('https://plugpilot.com/privacy'); }
        },
        {
          label: 'MIT License',
          click: () => { shell.openExternal('https://github.com/merohitnishad/Plug-Pilot/blob/main/LICENSE'); }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

export function setQuitting(): void { isQuitting = true; }

app.whenReady().then(() => {
  // Hide from Dock — this is a menu-bar utility, not a regular app
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  createAppMenu();
  mainWindow = createMainWindow();
  createTray();

  const { register } = require('./ipc/handlers');
  register(ipcMain, getStore, app, mainWindow);

  // activate fires when the user clicks the Dock icon or opens the app again
  // Always show the existing window — never create a second one
  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      mainWindow = createMainWindow();
    }
  });
});

// before-quit fires on Cmd+Q, system shutdown, restart, logout —
// set isQuitting so win.on('close') skips preventDefault and lets the OS proceed.
app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    return;
  }
  // On macOS: quit only during onboarding (setup not complete)
  // After setup, win.on('close') hides instead of closing, so this only
  // fires if the user is mid-onboarding and closes the window
  const store = getStore();
  const setupComplete = (store.get('alexaSession') !== null || store.get('alexaCookies') !== null)
    && store.get('targetDeviceId') !== null;
  if (!setupComplete) app.quit();
});


export { getStore };

// ─── Safe Storage helpers (encrypt/decrypt Alexa cookies) ─────────────────────

export function encryptValue(raw: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(raw).toString('base64');
  }
  return raw; // fallback: plaintext (dev mode / unsupported platform)
}

export function decryptValue(stored: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      return stored; // already plaintext (migrating from old version)
    }
  }
  return stored;
}
