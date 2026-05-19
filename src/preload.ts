'use strict';

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (key: string, value: any) => ipcRenderer.invoke('set-config', key, value),
  setMultiConfig: (obj: Record<string, any>) => ipcRenderer.invoke('set-multi-config', obj),

  // Alexa Auth
  startProxyLogin: (email: string) => ipcRenderer.invoke('start-proxy-login', email),
  stopProxyLogin: () => ipcRenderer.invoke('stop-proxy-login'),
  validateSession: () => ipcRenderer.invoke('validate-session'),
  clearSession: () => ipcRenderer.invoke('clear-session'),

  // Devices
  getAlexaDevices: () => ipcRenderer.invoke('get-alexa-devices'),
  getSmartHomeDevices: () => ipcRenderer.invoke('get-smart-home-devices'),
  getSmartHomeDeviceState: (entityId: string) => ipcRenderer.invoke('get-smart-home-device-state', entityId),
  sendSmartHomeAction: (entityId: string, action: string) => ipcRenderer.invoke('send-smart-home-action', entityId, action),
  debugSmartHome: () => ipcRenderer.invoke('debug-smart-home'),

  // Commands
  sendAlexaCommand: (command: string) => ipcRenderer.invoke('send-alexa-command', command),
  testOnCommand: () => ipcRenderer.invoke('test-on-command'),
  testOffCommand: () => ipcRenderer.invoke('test-off-command'),

  // Battery
  getBattery: () => ipcRenderer.invoke('get-battery'),

  // Monitor & Startup
  setMonitor: (enabled: boolean) => ipcRenderer.invoke('set-monitor', enabled),
  setStartup: (enabled: boolean) => ipcRenderer.invoke('set-startup', enabled),

  // Navigation
  navigateTo: (page: string) => ipcRenderer.invoke('navigate-to', page),
  openUrl: (url: string) => ipcRenderer.invoke('open-url', url),
  openLogsDir: () => ipcRenderer.invoke('open-logs-dir'),

  // History
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),

  // Notifications
  showNotification: (title: string, body: string) => ipcRenderer.invoke('show-notification', title, body),

  // App control
  quitApp: () => ipcRenderer.invoke('quit-app'),
  minimizeApp: () => ipcRenderer.invoke('minimize-app'),
  deleteAllData: () => ipcRenderer.invoke('delete-all-data'),

  // Events from main
  on: (channel: string, callback: (...args: any[]) => void) => {
    const validChannels = [
      'battery-update',
      'scheduler-status',
      'command-executed',
      'auth-success',
      'auth-error',
      'open-preferences',
      'open-about',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    }
  },

  off: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
  },
});
