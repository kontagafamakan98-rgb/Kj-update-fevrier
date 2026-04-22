import { devLog, safeLog } from './env';

/**
 * Development Logger - Clean logging for Kojo production
 * Replaces console.log statements with production-safe alternatives
 */

const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * Development-only console logger
 */
export const devConsole = {
  log: (...args) => {
    if (isDevelopment) {
      devLog.info(...args);
    }
  },
  
  warn: (...args) => {
    if (isDevelopment) {
      safeLog.warn(...args);
    }
  },
  
  error: (...args) => {
    // Always log errors, even in production
    safeLog.error(...args);
  },
  
  info: (...args) => {
    if (isDevelopment) {
      devLog.info(...args);
    }
  },
  
  debug: (...args) => {
    if (isDevelopment) {
      devLog.debug(...args);
    }
  }
};

export default devConsole;