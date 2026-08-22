import { devLog, safeLog } from '../utils/env';
import { api, hasSessionCookie } from './api';

// Service pour les fonctionnalités propriétaire - ACCÈS RESTREINT
//
// NOTE AUTH (migration cookie) : la session vit désormais dans le cookie
// httpOnly kojo_session (plus aucun token en localStorage). La vérification
// d'accès owner repose donc sur le profil chargé depuis /auth/me (user_type)
// ET la présence du cookie de session (détectée via le cookie CSRF associé,
// lisible en JS). Tous les appels API passent par le client partagé `api`
// (credentials: 'include' + en-tête X-CSRFToken sur les mutations) — plus
// aucun fetch manuel avec Bearer localStorage.
class OwnerService {
  getStoredUser() {
    try {
      const rawUser = localStorage.getItem('user');
      return rawUser ? JSON.parse(rawUser) : null;
    } catch (error) {
      safeLog.error('Impossible de lire la session utilisateur:', error);
      return null;
    }
  }

  isOwnerUser(userCandidate = null) {
    return Boolean(
      userCandidate?.user_type === 'owner'
      || userCandidate?.is_owner === true
      || (Array.isArray(userCandidate?.permissions) && userCandidate.permissions.includes('admin_access'))
    );
  }

  isOwnerSessionValid(userCandidate = null) {
    // Deux conditions : le profil est bien un compte owner ET une session
    // cookie active existe (sinon les appels /owner/* échoueraient en 401).
    return this.isOwnerUser(userCandidate) && hasSessionCookie();
  }

  _translateOwnerError(error, fallback) {
    if (error?.response?.status === 403) {
      return new Error('Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement');
    }
    return error instanceof Error ? error : new Error(fallback);
  }

  // Obtenir les statistiques de commission (propriétaire uniquement)
  async getCommissionStats() {
    try {
      devLog.info('🔐 Récupération stats commission (propriétaire)...');
      const data = await api.get('/owner/commission-stats');
      devLog.info('✅ Stats commission récupérées:', data);
      return data;
    } catch (error) {
      safeLog.error('❌ Erreur stats commission:', error);
      throw this._translateOwnerError(error, `Erreur serveur: ${error?.response?.status || 'inconnu'}`);
    }
  }

  // Obtenir les informations de debug (propriétaire uniquement)
  async getDebugInfo() {
    try {
      devLog.info('🔐 Récupération infos debug (propriétaire)...');
      const data = await api.get('/owner/debug-info');
      devLog.info('✅ Infos debug récupérées:', data);
      return data;
    } catch (error) {
      safeLog.error('❌ Erreur infos debug:', error);
      throw this._translateOwnerError(error, `Erreur serveur: ${error?.response?.status || 'inconnu'}`);
    }
  }

  // Obtenir la gestion des utilisateurs (propriétaire uniquement)
  async getUsersManagement() {
    try {
      devLog.info('🔐 Récupération gestion utilisateurs (propriétaire)...');
      const data = await api.get('/owner/users-management');
      devLog.info('✅ Gestion utilisateurs récupérée:', data);
      return data;
    } catch (error) {
      safeLog.error('❌ Erreur gestion utilisateurs:', error);
      throw this._translateOwnerError(error, `Erreur serveur: ${error?.response?.status || 'inconnu'}`);
    }
  }

  // Mettre à jour les paramètres de commission (propriétaire uniquement)
  async updateCommissionSettings(settings) {
    try {
      devLog.info('🔐 Mise à jour paramètres commission (propriétaire)...', settings);
      const data = await api.post('/owner/update-commission-settings', settings);
      devLog.info('✅ Paramètres commission mis à jour:', data);
      return data;
    } catch (error) {
      safeLog.error('❌ Erreur mise à jour commission:', error);
      throw this._translateOwnerError(error, `Erreur serveur: ${error?.response?.status || 'inconnu'}`);
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

  // Compatibilité ascendante : sans argument, retombe sur le profil stocké
  // en localStorage (toujours écrit par establishSession au login).
  isFamakanLoggedIn(userCandidate = null) {
    return this.isOwnerSessionValid(userCandidate || this.getStoredUser());
  }
}

export default new OwnerService();
