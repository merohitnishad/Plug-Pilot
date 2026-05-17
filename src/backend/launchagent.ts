'use strict';

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import logger from './logger';

const PLIST_NAME = 'com.plugpilot.worker.plist';
const LAUNCH_AGENTS_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const PLIST_DEST = path.join(LAUNCH_AGENTS_DIR, PLIST_NAME);

function getWorkerPath(app?: any): string {
  if (app) {
    const resourcesPath = process.resourcesPath || path.join(app.getAppPath(), '..', '..', 'Resources');
    const packedWorker = path.join(resourcesPath, 'backend', 'worker.js');
    if (fs.existsSync(packedWorker)) return packedWorker;
  }

  return path.join(__dirname, '..', 'backend', 'worker.js');
}

function generatePlist(workerPath: string): string {
  const logDir = path.join(os.homedir(), 'Library', 'Application Support', 'PlugPilot', 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Use the packaged Electron binary with ELECTRON_RUN_AS_NODE=1 so the worker
  // runs as a plain Node process without needing a system-installed Node.
  const electronBinary = process.execPath;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.plugpilot.worker</string>
    <key>ProgramArguments</key>
    <array>
        <string>${electronBinary}</string>
        <string>${workerPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>120</integer>
    <key>StandardOutPath</key>
    <string>${logDir}/worker.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/worker-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>ELECTRON_RUN_AS_NODE</key>
        <string>1</string>
        <key>HOME</key>
        <string>${os.homedir()}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>`;
}

function execCommand(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

export async function install(app?: any): Promise<{ success: boolean }> {
  try {
    if (!fs.existsSync(LAUNCH_AGENTS_DIR)) {
      fs.mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
    }

    const workerPath = getWorkerPath(app);
    if (!fs.existsSync(workerPath)) {
      throw new Error(`Worker script not found at: ${workerPath}`);
    }

    const plistContent = generatePlist(workerPath);
    fs.writeFileSync(PLIST_DEST, plistContent, { encoding: 'utf8', mode: 0o644 });
    logger.info(`LaunchAgent plist written to: ${PLIST_DEST}`);

    await execCommand(`launchctl unload "${PLIST_DEST}" 2>/dev/null || true`);
    await execCommand(`launchctl load "${PLIST_DEST}"`);
    logger.info('LaunchAgent installed and loaded');

    return { success: true };
  } catch (err: any) {
    logger.error('Failed to install LaunchAgent:', err.message);
    throw err;
  }
}

export async function uninstall(): Promise<{ success: boolean }> {
  try {
    if (fs.existsSync(PLIST_DEST)) {
      await execCommand(`launchctl unload "${PLIST_DEST}" 2>/dev/null || true`);
      fs.unlinkSync(PLIST_DEST);
      logger.info('LaunchAgent uninstalled');
    } else {
      logger.info('LaunchAgent not installed, nothing to remove');
    }

    return { success: true };
  } catch (err: any) {
    logger.error('Failed to uninstall LaunchAgent:', err.message);
    throw err;
  }
}

export function isInstalled(): boolean {
  return fs.existsSync(PLIST_DEST);
}
