import { devLog, safeLog } from '../utils/env';
import { buildApiUrl } from '../utils/backendUrl';

// Service pour les fonctionnalités propriétaire - ACCÈS RESTREINT
class OwnerService {
  constructor() {
    this.API_BASE = buildApiUrl('/owner');
  }

  getStoredUser() {
    try {
      const rawUser = localStorage.getItem('user');
      return rawUser ? JSON.parse(rawUser) : null;
    } catch (error) {
      safeLog.error('Impossible de lire la session utilisateur:', error);
      return null;
    }
  }

  hasActiveToken() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return false;
      const [, payloadSegment] = token.split('.');
      if (!payloadSegment) return false;

      const normalizedPayload = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
      const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=');
      const payload = JSON.parse(atob(paddedPayload));
      if (!payload?.exp) return true;
      return payload.exp * 1000 > Date.now();
    } catch (error) {
      safeLog.error('Impossible de vérifier le token propriétaire:', error);
      return false;
    }
  }

  isOwnerSessionValid(userCandidate = null) {
    const user = userCandidate || this.getStoredUser();
    if (!user || !this.hasActiveToken()) {
      return false;
    }

    return user.user_type === 'owner'
      || user.is_owner === true
      || (Array.isArray(user.permissions) && user.permissions.includes('admin_access'));
  }

  // Vérifier les headers d'autorisation
  getAuthHeaders() {
    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error("Token d'authentification manquant");
    }

    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  // Obtenir les statistiques de commission (propriétaire uniquement)
  async getCommissionStats() {
    try {
      devLog.info('🔐 Récupération stats commission (propriétaire)...');

      const response = await fetch(`${this.API_BASE}/commission-stats`, {
        method: 'GET',
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement');
        }
        throw new Error(`Erreur serveur: ${response.status}`);
      }

      const data = await response.json();
      devLog.info('✅ Stats commission récupérées:', data);
      return data;

    } catch (error) {
      safeLog.error('❌ Erreur stats commission:', error);
      throw error;
    }
  }

  // Obtenir les informations de debug (propriétaire uniquement)
  async getDebugInfo() {
    try {
      devLog.info('🔐 Récupération infos debug (propriétaire)...');

      const response = await fetch(`${this.API_BASE}/debug-info`, {
        method: 'GET',
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement');
        }
        throw new Error(`Erreur serveur: ${response.status}`);
      }

      const data = await response.json();
      devLog.info('✅ Infos debug récupérées:', data);
      return data;

    } catch (error) {
      safeLog.error('❌ Erreur infos debug:', error);
      throw error;
    }
  }

  // Obtenir la gestion des utilisateurs (propriétaire uniquement)
  async getUsersManagement() {
    try {
      devLog.info('🔐 Récupération gestion utilisateurs (propriétaire)...');

      const response = await fetch(`${this.API_BASE}/users-management`, {
        method: 'GET',
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement');
        }
        throw new Error(`Erreur serveur: ${response.status}`);
      }

      const data = await response.json();
      devLog.info('✅ Gestion utilisateurs récupérée:', data);
      return data;

    } catch (error) {
      safeLog.error('❌ Erreur gestion utilisateurs:', error);
      throw error;
    }
  }

  // Mettre à jour les paramètres de commission (propriétaire uniquement)
  async updateCommissionSettings(settings) {
    try {
      devLog.info('🔐 Mise à jour paramètres commission (propriétaire)...', settings);

      const response = await fetch(`${this.API_BASE}/update-commission-settings`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(settings)
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement');
        }
        throw new Error(`Erreur serveur: ${response.status}`);
      }

      const data = await response.json();
      devLog.info('✅ Paramètres commission mis à jour:', data);
      return data;

    } catch (error) {
      safeLog.error('❌ Erreur mise à jour commission:', error);
      throw error;
    }
  }

  // Vérifier si l'utilisateur actuel est le propriétaire
  async checkOwnerAccess() {
    try {
      await this.getDebugInfo();
      return true;
    } catch (error) {
      devLog.info('👤 Utilisateur normal détecté (pas propriétaire)');
      return false;
    }
  }

  // Compatibilité ascendante
  isFamakanLoggedIn(userCandidate = null) {
    return this.isOwnerSessionValid(userCandidate);
  }
}

export default new OwnerService();
