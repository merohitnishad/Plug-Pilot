'use strict';

import si from 'systeminformation';
import logger from './logger';

export interface BatteryInfo {
  percent: number;
  isCharging: boolean;
  hasBattery: boolean;
  acConnected: boolean;
  timeRemaining: number;
}

export async function getBatteryInfo(): Promise<BatteryInfo> {
  try {
    const data = await si.battery();
    return {
      percent: Math.round(data.percent || 0),
      isCharging: data.isCharging || false,
      hasBattery: data.hasBattery !== false,
      acConnected: data.acConnected || false,
      timeRemaining: data.timeRemaining || -1,
    };
  } catch (err: any) {
    logger.error('Failed to get battery info:', err.message);
    throw err;
  }
}

export function pollBattery(
  callback: (err: Error | null, info: BatteryInfo | null) => void,
  intervalMs = 30000
): NodeJS.Timeout {
  const poll = async () => {
    try {
      const info = await getBatteryInfo();
      callback(null, info);
    } catch (err: any) {
      callback(err, null);
    }
  };

  poll();
  return setInterval(poll, intervalMs);
}
