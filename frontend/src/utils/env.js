/**
 * Environment configuration utility
 * Centralizes environment checks and provides clean development tools
 */

export const isDevelopment = process.env.NODE_ENV === 'development';
export const isProduction = process.env.NODE_ENV === 'production';

const devOnly = (fn) => (...args) => {
  if (isDevelopment) fn(...args);
};

/**
 * Logger de développement : les niveaux info/log/debug ne sortent qu'en
 * développement ; warn/error restent visibles partout pour ne pas masquer
 * les vrais problèmes en production.
 */
export const devLog = {
  log: devOnly(console.log),
  error: console.error,
  warn: console.warn,
  info: devOnly(console.info),
  debug: devOnly(console.debug),
};

/**
 * Logger de sécurité : warn/error toujours visibles (jamais de noop), pour
 * pouvoir diagnostiquer un incident en production depuis la console.
 */
export const safeLog = {
  error: console.error,
  warn: console.warn,
  info: devOnly(console.info),
};

export { shouldLogToConsole };
function shouldLogToConsole() {
  return isDevelopment;
}
