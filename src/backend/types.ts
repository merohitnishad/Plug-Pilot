'use strict';

export enum AlexaErrorCode {
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  DEVICE_OFFLINE = 'DEVICE_OFFLINE',
  ACTION_FAILED = 'ACTION_FAILED',
  UNKNOWN = 'UNKNOWN',
}

export interface AlexaResponse<T = any> {
  success: boolean;
  result?: T;
  error?: string;
  errorCode?: AlexaErrorCode;
}
