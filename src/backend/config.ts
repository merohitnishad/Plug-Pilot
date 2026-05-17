'use strict';

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const CONFIG_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'PlugPilot');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface AppConfig {
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
  runOnStartup: boolean;
  lastPlugState: 'on' | 'off' | null;
  lastCommandTime: string | null;
  lastCommand: string | null;
}

export const DEFAULTS: AppConfig = {
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
  runOnStartup: false,
  lastPlugState: null,
  lastCommandTime: null,
  lastCommand: null,
};

function ensureDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function readConfig(): AppConfig {
  ensureDir();
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return { ...DEFAULTS };
    }
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch (err: any) {
    console.error('Failed to read config:', err.message);
    return { ...DEFAULTS };
  }
}

export function writeConfig(config: Partial<AppConfig>): boolean {
  ensureDir();
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (err: any) {
    console.error('Failed to write config:', err.message);
    return false;
  }
}

export function get<K extends keyof AppConfig>(key: K): AppConfig[K] {
  const config = readConfig();
  return config[key] !== undefined ? config[key] : DEFAULTS[key];
}

export function set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): boolean {
  const config = readConfig();
  config[key] = value;
  return writeConfig(config);
}

export function getConfigDir(): string { return CONFIG_DIR; }
export function getLogDir(): string { return path.join(CONFIG_DIR, 'logs'); }
