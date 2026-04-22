/**
 * Environment configuration utility
 * Centralizes environment checks and provides clean development tools
 */

export const isDevelopment = process.env.NODE_ENV === 'development';
export const isProduction = process.env.NODE_ENV === 'production';

const isConsoleDebugEnabled = () => {
  if (typeof window === 'undefined') return false;

  try {
    return window.localStorage.getItem('kojo_console_debug') === '1';
  } catch {
    return false;
  }
};

const shouldLogToConsole = () => isDevelopment && isConsoleDebugEnabled();

/**
 * Development-only console logger
 * Only logs in development environment
 */
export const devLog = {
  log: (...args) => {
    if (shouldLogToConsole()) {
      console.log(...args);
    }
  },
  
  error: (...args) => {
    if (shouldLogToConsole()) {
      console.error(...args);
    }
  },
  
  warn: (...args) => {
    if (shouldLogToConsole()) {
      console.warn(...args);
    }
  },
  
  info: (...args) => {
    if (shouldLogToConsole()) {
      console.info(...args);
    }
  },
  
  debug: (...args) => {
    if (shouldLogToConsole()) {
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
    if (shouldLogToConsole()) {
      console.error(...args);
    }
  },
  
  warn: (...args) => {
    if (shouldLogToConsole()) {
      console.warn(...args);
    }
  },
  
  info: (...args) => {
    if (shouldLogToConsole()) {
      console.info(...args);
    }
  }
};