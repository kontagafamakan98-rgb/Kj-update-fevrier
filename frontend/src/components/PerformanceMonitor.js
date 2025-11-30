/**
 * Performance Monitor Component
 * Tracks and logs performance metrics for West Africa optimization
 */

import { useEffect } from 'react';
import { devLog } from '../utils/env';

const PerformanceMonitor = () => {
  useEffect(() => {
    // Wait for page to fully load
    if (typeof window === 'undefined') return;

    const logPerformanceMetrics = () => {
      // Check if Performance API is available
      if (!window.performance || !window.performance.timing) {
        devLog.warn('Performance API not available');
        return;
      }

      const timing = window.performance.timing;
      const navigation = window.performance.navigation;

      // Calculate key metrics
      const metrics = {
        // Page Load Time
        pageLoadTime: timing.loadEventEnd - timing.navigationStart,
        
        // DOM Content Loaded
        domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
        
        // DOM Interactive (when user can interact)
        domInteractive: timing.domInteractive - timing.navigationStart,
        
        // Time to First Byte (TTFB)
        ttfb: timing.responseStart - timing.navigationStart,
        
        // DNS Lookup Time
        dnsTime: timing.domainLookupEnd - timing.domainLookupStart,
        
        // TCP Connection Time
        tcpTime: timing.connectEnd - timing.connectStart,
        
        // Request Time
        requestTime: timing.responseEnd - timing.requestStart,
        
        // DOM Processing Time
        domProcessing: timing.domComplete - timing.domLoading,
        
        // Navigation Type
        navigationType: navigation.type === 0 ? 'navigate' : 
                       navigation.type === 1 ? 'reload' : 
                       navigation.type === 2 ? 'back_forward' : 'unknown'
      };

      // Log metrics in development
      devLog.info('📊 Performance Metrics:', {
        'Page Load': `${(metrics.pageLoadTime / 1000).toFixed(2)}s`,
        'DOM Interactive': `${(metrics.domInteractive / 1000).toFixed(2)}s`,
        'DOM Content Loaded': `${(metrics.domContentLoaded / 1000).toFixed(2)}s`,
        'Time to First Byte': `${(metrics.ttfb / 1000).toFixed(2)}s`,
        'DNS Lookup': `${metrics.dnsTime}ms`,
        'TCP Connection': `${metrics.tcpTime}ms`,
        'Request Time': `${metrics.requestTime}ms`,
        'Navigation Type': metrics.navigationType
      });

      // Check for slow load times (West Africa threshold)
      if (metrics.pageLoadTime > 5000) {
        devLog.warn('⚠️ Slow page load detected:', `${(metrics.pageLoadTime / 1000).toFixed(2)}s`);
      }

      // Check for slow TTFB (server response)
      if (metrics.ttfb > 2000) {
        devLog.warn('⚠️ Slow server response (TTFB):', `${(metrics.ttfb / 1000).toFixed(2)}s`);
      }

      // Log network information if available
      if (navigator.connection) {
        const connection = navigator.connection;
        devLog.info('🌐 Network Info:', {
          'Effective Type': connection.effectiveType,
          'Downlink': `${connection.downlink} Mbps`,
          'RTT': `${connection.rtt}ms`,
          'Save Data': connection.saveData
        });

        // Warn if on slow connection
        if (connection.effectiveType === '2g' || connection.effectiveType === 'slow-2g') {
          devLog.warn('⚠️ User is on a slow 2G connection');
        }
      }

      // Log memory usage if available
      if (performance.memory) {
        const memory = performance.memory;
        devLog.info('💾 Memory Usage:', {
          'Used': `${(memory.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB`,
          'Total': `${(memory.totalJSHeapSize / 1024 / 1024).toFixed(2)} MB`,
          'Limit': `${(memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2)} MB`
        });
      }

      // Log Paint Timing if available
      if (window.performance.getEntriesByType) {
        const paintEntries = window.performance.getEntriesByType('paint');
        if (paintEntries.length > 0) {
          devLog.info('🎨 Paint Timing:', paintEntries.reduce((acc, entry) => {
            acc[entry.name] = `${entry.startTime.toFixed(2)}ms`;
            return acc;
          }, {}));
        }
      }

      // Send metrics to backend for monitoring (optional)
      if (process.env.NODE_ENV === 'production') {
        sendMetricsToBackend(metrics);
      }
    };

    // Log metrics after page load
    if (document.readyState === 'complete') {
      logPerformanceMetrics();
    } else {
      window.addEventListener('load', logPerformanceMetrics);
    }

    // Monitor long tasks (tasks taking > 50ms)
    if ('PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > 50) {
              devLog.warn('⏱️ Long task detected:', {
                name: entry.name,
                duration: `${entry.duration.toFixed(2)}ms`
              });
            }
          }
        });

        observer.observe({ entryTypes: ['longtask', 'measure'] });

        return () => observer.disconnect();
      } catch (e) {
        devLog.warn('PerformanceObserver not supported:', e);
      }
    }

    return () => {
      window.removeEventListener('load', logPerformanceMetrics);
    };
  }, []);

  // This component doesn't render anything
  return null;
};

/**
 * Send performance metrics to backend for monitoring
 * @param {Object} metrics - Performance metrics
 */
function sendMetricsToBackend(metrics) {
  // Only send if metrics are significant (to reduce API calls)
  if (metrics.pageLoadTime > 3000 || metrics.ttfb > 1000) {
    try {
      // Use sendBeacon for reliability (doesn't block page unload)
      if (navigator.sendBeacon) {
        const data = JSON.stringify({
          type: 'performance',
          metrics,
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          url: window.location.href
        });

        navigator.sendBeacon('/api/analytics/performance', data);
      }
    } catch (e) {
      // Silently fail - metrics aren't critical
      devLog.warn('Failed to send metrics:', e);
    }
  }
}

/**
 * Hook to measure component render time
 * @param {string} componentName - Name of the component
 */
export function useRenderTime(componentName) {
  useEffect(() => {
    const startTime = performance.now();

    return () => {
      const renderTime = performance.now() - startTime;
      if (renderTime > 16) { // 16ms = 60fps threshold
        devLog.warn(`🐌 Slow render in ${componentName}:`, `${renderTime.toFixed(2)}ms`);
      }
    };
  });
}

/**
 * Measure function execution time
 * @param {Function} fn - Function to measure
 * @param {string} label - Label for the measurement
 */
export async function measureExecutionTime(fn, label) {
  const startTime = performance.now();
  const result = await fn();
  const executionTime = performance.now() - startTime;
  
  devLog.info(`⏱️ ${label}:`, `${executionTime.toFixed(2)}ms`);
  
  return result;
}

export default PerformanceMonitor;
