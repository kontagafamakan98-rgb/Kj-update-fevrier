/**
 * Moniteur de géolocalisation pour Kojo
 * Suit la qualité et la fiabilité de la détection de position
 */

import { devLog, isDevelopment } from './env';

class GeolocationMonitor {
  constructor() {
    this.detections = [];
    this.successRate = 0;
    this.averageAccuracy = 0;
    this.averageDetectionTime = 0;
    this.methodStats = {};
    this.loadStats();
  }

  /**
   * Charger les statistiques depuis localStorage
   */
  loadStats() {
    try {
      const stored = localStorage.getItem('kojo_geolocation_stats');
      if (stored) {
        const stats = JSON.parse(stored);
        this.detections = stats.detections || [];
        this.calculateStats();
      }
    } catch (e) {
      devLog.info('⚠️ Erreur chargement stats géolocalisation');
    }
  }

  /**
   * Sauvegarder les statistiques
   */
  saveStats() {
    try {
      // Garder seulement les 100 dernières détections
      const recentDetections = this.detections.slice(-100);
      localStorage.setItem('kojo_geolocation_stats', JSON.stringify({
        detections: recentDetections,
        lastUpdate: Date.now()
      }));
    } catch (e) {
      devLog.info('⚠️ Erreur sauvegarde stats géolocalisation');
    }
  }

  /**
   * Enregistrer une nouvelle détection
   */
  recordDetection(location, detectionTime, success = true) {
    const detection = {
      timestamp: Date.now(),
      success,
      method: location?.method || 'unknown',
      accuracy: location?.accuracy || 0,
      confidence: location?.confidence || 0,
      country: location?.countryCode || 'unknown',
      city: location?.city || 'unknown',
      detectionTime: detectionTime || 0,
      fromCache: location?.fromCache || false
    };

    this.detections.push(detection);
    this.calculateStats();
    this.saveStats();

    devLog.info('📊 Détection enregistrée:', detection);
  }

  /**
   * Calculer les statistiques globales
   */
  calculateStats() {
    if (this.detections.length === 0) return;

    // Taux de succès
    const successful = this.detections.filter(d => d.success).length;
    this.successRate = (successful / this.detections.length) * 100;

    // Précision moyenne (non-cache seulement)
    const nonCacheDetections = this.detections.filter(d => !d.fromCache && d.accuracy > 0);
    if (nonCacheDetections.length > 0) {
      const totalAccuracy = nonCacheDetections.reduce((sum, d) => sum + d.accuracy, 0);
      this.averageAccuracy = totalAccuracy / nonCacheDetections.length;
    }

    // Temps de détection moyen (non-cache seulement)
    if (nonCacheDetections.length > 0) {
      const totalTime = nonCacheDetections.reduce((sum, d) => sum + d.detectionTime, 0);
      this.averageDetectionTime = totalTime / nonCacheDetections.length;
    }

    // Statistiques par méthode
    this.methodStats = {};
    this.detections.forEach(d => {
      if (!this.methodStats[d.method]) {
        this.methodStats[d.method] = { count: 0, successCount: 0, totalAccuracy: 0, totalTime: 0 };
      }
      this.methodStats[d.method].count++;
      if (d.success) this.methodStats[d.method].successCount++;
      this.methodStats[d.method].totalAccuracy += d.accuracy;
      this.methodStats[d.method].totalTime += d.detectionTime;
    });

    // Calculer moyennes par méthode
    Object.keys(this.methodStats).forEach(method => {
      const stats = this.methodStats[method];
      stats.successRate = (stats.successCount / stats.count) * 100;
      stats.avgAccuracy = stats.totalAccuracy / stats.count;
      stats.avgTime = stats.totalTime / stats.count;
    });
  }

  /**
   * Obtenir un rapport détaillé
   */
  getReport() {
    return {
      totalDetections: this.detections.length,
      successRate: this.successRate.toFixed(1) + '%',
      averageAccuracy: this.averageAccuracy.toFixed(0) + '%',
      averageDetectionTime: (this.averageDetectionTime / 1000).toFixed(2) + 's',
      methodStats: Object.entries(this.methodStats).map(([method, stats]) => ({
        method,
        usage: `${stats.count} fois (${((stats.count / this.detections.length) * 100).toFixed(0)}%)`,
        successRate: stats.successRate.toFixed(0) + '%',
        avgAccuracy: stats.avgAccuracy.toFixed(0) + '%',
        avgTime: (stats.avgTime / 1000).toFixed(2) + 's'
      })),
      recentDetections: this.detections.slice(-10).map(d => ({
        date: new Date(d.timestamp).toLocaleString('fr-FR'),
        method: d.method,
        country: d.country,
        city: d.city,
        accuracy: d.accuracy + '%',
        time: (d.detectionTime / 1000).toFixed(2) + 's'
      }))
    };
  }

  /**
   * Afficher le rapport dans la console
   */
  logReport() {
    if (!isDevelopment) {
      return this.getReport();
    }

    const report = this.getReport();
    devLog.info('📊 RAPPORT GÉOLOCALISATION KOJO', report);
    return report;
  }

  /**
   * Réinitialiser les statistiques
   */
  reset() {
    this.detections = [];
    this.successRate = 0;
    this.averageAccuracy = 0;
    this.averageDetectionTime = 0;
    this.methodStats = {};
    localStorage.removeItem('kojo_geolocation_stats');
    devLog.info('🔄 Statistiques géolocalisation réinitialisées');
  }

  /**
   * Obtenir la santé du système de géolocalisation
   */
  getHealth() {
    if (this.detections.length < 5) {
      return {
        status: 'unknown',
        message: 'Pas assez de données',
        color: 'gray'
      };
    }

    if (this.successRate >= 95) {
      return {
        status: 'excellent',
        message: 'Géolocalisation fonctionne parfaitement',
        color: 'green'
      };
    } else if (this.successRate >= 85) {
      return {
        status: 'good',
        message: 'Géolocalisation fonctionne bien',
        color: 'lightgreen'
      };
    } else if (this.successRate >= 70) {
      return {
        status: 'fair',
        message: 'Géolocalisation acceptable',
        color: 'yellow'
      };
    } else {
      return {
        status: 'poor',
        message: 'Géolocalisation nécessite attention',
        color: 'red'
      };
    }
  }
}

// Singleton
const geolocationMonitor = new GeolocationMonitor();

// Exposer pour debug en console uniquement en développement
if (typeof window !== 'undefined' && isDevelopment) {
  window.kojoGeoMonitor = geolocationMonitor;
}

export default geolocationMonitor;

/**
 * Hook pour utiliser le moniteur dans les composants React
 */
export function useGeolocationMonitor() {
  return {
    record: (location, time, success) => geolocationMonitor.recordDetection(location, time, success),
    report: () => geolocationMonitor.getReport(),
    health: () => geolocationMonitor.getHealth(),
    log: () => geolocationMonitor.logReport()
  };
}
