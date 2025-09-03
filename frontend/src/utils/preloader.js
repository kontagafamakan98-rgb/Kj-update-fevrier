/**
 * Intelligent Preloader for Kojo - West African Optimized
 * Preloads critical data based on user patterns and network conditions
 */

import { authAPI, jobsAPI, usersAPI } from '../services/api';
import kojoCache, { CACHE_KEYS } from './cache';
import networkOptimizer from './networkOptimizer';
import { devLog } from './env';

class KojoPreloader {
  constructor() {
    this.preloadQueue = new Set();
    this.isPreloading = false;
    this.userPreferences = this.getUserPreferences();
  }

  /**
   * Get user preferences from cache/localStorage
   */
  getUserPreferences() {
    const cached = kojoCache.get('user_preferences');
    if (cached) return cached;

    // Default preferences for West African users
    const defaults = {
      preferredCategories: ['mécanique', 'plomberie', 'électricité', 'tutorat'],
      maxPreloadItems: 20,
      preloadImages: true,
      preloadOnWifi: true,
      preloadOnMobile: false // Conservative for data usage
    };

    kojoCache.set('user_preferences', defaults, 24 * 60 * 60 * 1000); // 24 hours
    return defaults;
  }

  /**
   * Start preloading based on current context
   */
  async startPreloading(context = {}) {
    if (this.isPreloading) return;
    
    const networkConfig = networkOptimizer.getConfig();
    if (!networkConfig.preloadContent) {
      devLog.info('📊 Preloading skipped due to network conditions');
      return;
    }

    this.isPreloading = true;
    devLog.info('🚀 Starting intelligent preloading...');

    try {
      // Preload based on user type and context
      if (context.userType === 'client') {
        await this.preloadForClient(context);
      } else if (context.userType === 'worker') {
        await this.preloadForWorker(context);
      }

      // Preload common data
      await this.preloadCommonData();

      devLog.info('✅ Preloading completed successfully');
    } catch (error) {
      devLog.warn('⚠️ Preloading failed:', error);
    } finally {
      this.isPreloading = false;
    }
  }

  /**
   * Preload data for clients
   */
  async preloadForClient(context) {
    const tasks = [
      this.preloadAvailableWorkers(),
      this.preloadPopularServices(),
      this.preloadUserJobs(),
    ];

    // Location-based preloading
    if (context.location) {
      tasks.push(this.preloadNearbyWorkers(context.location));
    }

    await this.executeTasks(tasks, 'Client preloading');
  }

  /**
   * Preload data for workers
   */
  async preloadForWorker(context) {
    const tasks = [
      this.preloadAvailableJobs(),
      this.preloadWorkerProfile(),
      this.preloadJobHistory(),
    ];

    // Skill-based preloading
    if (context.skills && context.skills.length > 0) {
      tasks.push(this.preloadJobsBySkills(context.skills));
    }

    await this.executeTasks(tasks, 'Worker preloading');
  }

  /**
   * Preload common data for all users
   */
  async preloadCommonData() {
    const tasks = [
      this.preloadUserProfile(),
      this.preloadAppConfig(),
      this.preloadConversations(),
    ];

    await this.executeTasks(tasks, 'Common data preloading');
  }

  /**
   * Execute preloading tasks with error handling
   */
  async executeTasks(tasks, taskGroup) {
    const results = await Promise.allSettled(tasks);
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    devLog.info(`📊 ${taskGroup}: ${successful} succeeded, ${failed} failed`);
    
    if (failed > 0) {
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          devLog.warn(`Task ${index} failed:`, result.reason);
        }
      });
    }
  }

  /**
   * Preload user profile
   */
  async preloadUserProfile() {
    try {
      await authAPI.getProfile();
      devLog.info('👤 User profile preloaded');
    } catch (error) {
      devLog.warn('Failed to preload user profile:', error);
    }
  }

  /**
   * Preload available jobs
   */
  async preloadAvailableJobs() {
    try {
      const batchSize = networkOptimizer.getBatchSize();
      await jobsAPI.getAll({ limit: batchSize, status: 'open' });
      devLog.info(`💼 Available jobs preloaded (${batchSize} items)`);
    } catch (error) {
      devLog.warn('Failed to preload available jobs:', error);
    }
  }

  /**
   * Preload available workers
   */
  async preloadAvailableWorkers() {
    try {
      // This would be a workers API endpoint
      const cachedWorkers = kojoCache.get(CACHE_KEYS.AVAILABLE_WORKERS);
      if (!cachedWorkers) {
        // Simulate workers API call
        const mockWorkers = this.generateMockWorkers();
        kojoCache.set(CACHE_KEYS.AVAILABLE_WORKERS, mockWorkers);
        devLog.info('👷 Available workers preloaded');
      }
    } catch (error) {
      devLog.warn('Failed to preload available workers:', error);
    }
  }

  /**
   * Preload user's jobs
   */
  async preloadUserJobs() {
    try {
      const batchSize = networkOptimizer.getBatchSize();
      await jobsAPI.getAll({ limit: batchSize, my_jobs: true });
      devLog.info(`📋 User jobs preloaded (${batchSize} items)`);
    } catch (error) {
      devLog.warn('Failed to preload user jobs:', error);
    }
  }

  /**
   * Preload conversations
   */
  async preloadConversations() {
    try {
      // This would use messagesAPI when available
      const cachedConversations = kojoCache.get(CACHE_KEYS.CONVERSATIONS);
      if (!cachedConversations) {
        const mockConversations = [];
        kojoCache.set(CACHE_KEYS.CONVERSATIONS, mockConversations);
        devLog.info('💬 Conversations preloaded');
      }
    } catch (error) {
      devLog.warn('Failed to preload conversations:', error);
    }
  }

  /**
   * Preload worker profile
   */
  async preloadWorkerProfile() {
    try {
      await usersAPI.getProfile();
      devLog.info('👨‍🔧 Worker profile preloaded');
    } catch (error) {
      devLog.warn('Failed to preload worker profile:', error);
    }
  }

  /**
   * Preload app configuration
   */
  async preloadAppConfig() {
    try {
      const cachedConfig = kojoCache.get(CACHE_KEYS.APP_CONFIG);
      if (!cachedConfig) {
        const config = {
          supportedCountries: ['senegal', 'mali', 'ivory_coast', 'burkina_faso'],
          supportedLanguages: ['fr', 'en', 'wo', 'bm'],
          paymentMethods: ['orange_money', 'wave', 'bank_account'],
          commissionRate: 0.14,
          version: '1.0.0'
        };
        kojoCache.set(CACHE_KEYS.APP_CONFIG, config, 24 * 60 * 60 * 1000); // 24 hours
        devLog.info('⚙️ App config preloaded');
      }
    } catch (error) {
      devLog.warn('Failed to preload app config:', error);
    }
  }

  /**
   * Preload jobs by skills
   */
  async preloadJobsBySkills(skills) {
    try {
      const batchSize = Math.floor(networkOptimizer.getBatchSize() / 2);
      for (const skill of skills.slice(0, 3)) { // Limit to top 3 skills
        await jobsAPI.getAll({ 
          limit: batchSize, 
          skill: skill,
          status: 'open' 
        });
      }
      devLog.info(`🎯 Jobs by skills preloaded for ${skills.length} skills`);
    } catch (error) {
      devLog.warn('Failed to preload jobs by skills:', error);
    }
  }

  /**
   * Preload nearby workers (location-based)
   */
  async preloadNearbyWorkers(location) {
    try {
      // This would use a geolocation-based worker search
      const mockNearbyWorkers = this.generateMockWorkers(location);
      kojoCache.set(`nearby_workers_${location.city}`, mockNearbyWorkers);
      devLog.info(`📍 Nearby workers preloaded for ${location.city}`);
    } catch (error) {
      devLog.warn('Failed to preload nearby workers:', error);
    }
  }

  /**
   * Preload popular services
   */
  async preloadPopularServices() {
    try {
      const popularServices = [
        'Réparation smartphone',
        'Plomberie urgence', 
        'Électricité résidentielle',
        'Mécanique auto',
        'Cours particuliers',
        'Nettoyage domicile'
      ];
      
      kojoCache.set('popular_services', popularServices);
      devLog.info('⭐ Popular services preloaded');
    } catch (error) {
      devLog.warn('Failed to preload popular services:', error);
    }
  }

  /**
   * Preload job history
   */
  async preloadJobHistory() {
    try {
      const batchSize = Math.floor(networkOptimizer.getBatchSize() / 2);
      await jobsAPI.getAll({ 
        limit: batchSize, 
        my_jobs: true,
        status: 'completed' 
      });
      devLog.info(`📚 Job history preloaded (${batchSize} items)`);
    } catch (error) {
      devLog.warn('Failed to preload job history:', error);
    }
  }

  /**
   * Generate mock workers for testing
   */
  generateMockWorkers(location = null) {
    const workers = [
      {
        id: 'worker_1',
        name: 'Mamadou Diallo',
        skills: ['mécanique', 'électricité'],
        rating: 4.8,
        location: location?.city || 'Dakar',
        available: true
      },
      {
        id: 'worker_2', 
        name: 'Aminata Traoré',
        skills: ['tutorat', 'français'],
        rating: 4.9,
        location: location?.city || 'Bamako',
        available: true
      }
    ];
    
    return workers;
  }

  /**
   * Schedule preloading based on user activity
   */
  schedulePreloading(context) {
    // Delay preloading to avoid interfering with user actions
    setTimeout(() => {
      this.startPreloading(context);
    }, 2000);
  }

  /**
   * Clear preloading queue
   */
  clearQueue() {
    this.preloadQueue.clear();
    this.isPreloading = false;
  }

  /**
   * Get preloading status
   */
  getStatus() {
    return {
      isPreloading: this.isPreloading,
      queueSize: this.preloadQueue.size,
      networkQuality: networkOptimizer.getQuality(),
      cacheStats: kojoCache.getStats()
    };
  }
}

// Create singleton instance
const kojoPreloader = new KojoPreloader();

export default kojoPreloader;