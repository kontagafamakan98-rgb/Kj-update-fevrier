/**
 * Environment configuration utility
 * Centralizes environment checks and provides clean development tools
 */

export const isDevelopment = process.env.NODE_ENV === 'development';
export const isProduction = process.env.NODE_ENV === 'production';

/**
 * Development-only console logger
 * Only logs in development environment
 */
export const devLog = {
  log: (...args) => {
    if (isDevelopment) {
      console.log(...args);
    }
  },
  
  error: (...args) => {
    if (isDevelopment) {
      console.error(...args);
    }
  },
  
  warn: (...args) => {
    if (isDevelopment) {
      console.warn(...args);
    }
  },
  
  info: (...args) => {
    if (isDevelopment) {
      console.info(...args);
    }
  },
  
  debug: (...args) => {
    if (isDevelopment) {
      console.debug(...args);
    }
  }
};

/**
 * Production-safe logger
 * Always logs errors, warnings only in development
 */
export const safeLog = {
  error: (...args) => {
    safeLog.error(...args);
  },
  
  warn: (...args) => {
    if (isDevelopment) {
      safeLog.warn(...args);
    }
  },
  
  info: (...args) => {
    if (isDevelopment) {
      console.info(...args);
    }
  }
};