/**
 * Environment configuration utility
 * Centralizes environment checks and provides clean development tools
 */

export const isDevelopment = process.env.NODE_ENV === 'development';
export const isProduction = process.env.NODE_ENV === 'production';

const noop = () => {};

const shouldLogToConsole = () => false;

/**
 * Console logger intentionally silenced for clean production-like usage
 */
export const devLog = {
  log: noop,
  error: noop,
  warn: noop,
  info: noop,
  debug: noop
};

/**
 * Safe logger also silenced to keep the app console clean
 */
export const safeLog = {
  error: noop,
  warn: noop,
  info: noop
};

export { shouldLogToConsole };
