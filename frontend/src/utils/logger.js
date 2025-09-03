/**
 * Logger utility for Kojo application
 * Provides centralized logging with different levels and environments
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,  
  DEBUG: 3
};

const LOG_COLORS = {
  ERROR: '#ff4444',
  WARN: '#ffaa00', 
  INFO: '#0066cc',
  DEBUG: '#888888'
};

class Logger {
  constructor() {
    this.level = process.env.NODE_ENV === 'production' ? LOG_LEVELS.WARN : LOG_LEVELS.DEBUG;
    this.enabled = true;
  }

  setLevel(level) {
    this.level = level;
  }

  isEnabled(level) {
    return this.enabled && level <= this.level;
  }

  formatMessage(level, message, context = {}) {
    const timestamp = new Date().toISOString();
    const levelName = Object.keys(LOG_LEVELS)[level];
    
    return {
      timestamp,
      level: levelName,
      message,
      context,
      userAgent: navigator.userAgent,
      url: window.location.href
    };
  }

  log(level, message, context = {}) {
    if (!this.isEnabled(level)) return;

    const levelName = Object.keys(LOG_LEVELS)[level];
    const color = LOG_COLORS[levelName];
    const formattedMessage = this.formatMessage(level, message, context);

    // Console output with styling
    console.log(`%c[${levelName}] ${message}`, `color: ${color}; font-weight: bold`, context);

    // In production, you could send to logging service
    if (process.env.NODE_ENV === 'production' && level <= LOG_LEVELS.ERROR) {
      this.sendToLoggingService(formattedMessage);
    }
  }

  error(message, context = {}) {
    this.log(LOG_LEVELS.ERROR, message, context);
  }

  warn(message, context = {}) {
    this.log(LOG_LEVELS.WARN, message, context);
  }

  info(message, context = {}) {
    this.log(LOG_LEVELS.INFO, message, context);
  }

  debug(message, context = {}) {
    this.log(LOG_LEVELS.DEBUG, message, context);
  }

  // Track user actions for analytics
  trackAction(action, data = {}) {
    this.info(`User Action: ${action}`, {
      action,
      data,
      timestamp: new Date().toISOString()
    });
  }

  // Log API errors with detailed context
  logApiError(endpoint, error, requestData = {}) {
    this.error(`API Error: ${endpoint}`, {
      endpoint,
      error: error.message,
      status: error.response?.status,
      responseData: error.response?.data,
      requestData,
      stack: error.stack
    });
  }

  // Send logs to external service (placeholder for production)
  sendToLoggingService(logData) {
    // In production, implement sending logs to external service
    // e.g., LogRocket, Sentry, etc.
    console.log('Would send to logging service:', logData);
  }
}

// Create singleton instance
const logger = new Logger();

export default logger;