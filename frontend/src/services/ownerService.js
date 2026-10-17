import { devLog, safeLog } from '../utils/env';
import { api, hasSessionTrace } from './api';

// Service pour les fonctionnalités propriétaire - ACCÈS RESTREINT
//
// NOTE AUTH (web) : la session est le seul cookie httpOnly ; aucun jeton n'est
// stocké côté web. La vérification d'accès owner repose donc sur le profil
// chargé depuis /auth/me (user_type) ET sur la présence de la session, lue via
// hasSessionTrace (services/api.js) : le jeton du shell natif ou la trace de
// profil — jamais la lisibilité d'un cookie, le cookie de session étant
// httpOnly et son compagnon CSRF n'étant lisible que sur l'hôte qui l'a posé
// (en cross-site, c'est l'hôte de l'API : rien n'en est lisible depuis le
// frontend), ce qui rendait sinon le dashboard owner inaccessible en
// production. Tous les appels API passent par le client
// partagé `api` (credentials: 'include' + en-tête X-CSRFToken sur les
// mutations) — plus aucun fetch manuel.
class OwnerService {
  /** @returns {object|null} Utilisateur stocké en localStorage, ou null. */
  getStoredUser() {
    try {
      const rawUser = localStorage.getItem('user');
      return rawUser ? JSON.parse(rawUser) : null;
    } catch (error) {
      safeLog.error('Impossible de lire la session utilisateur:', error);
      return null;
    }
  }

  /** @returns {boolean} true si le profil a le rôle owner/admin. */
  isOwnerUser(userCandidate = null) {
    return Boolean(
      userCandidate?.user_type === 'owner'
      || userCandidate?.is_owner === true
      || (Array.isArray(userCandidate?.permissions) && userCandidate.permissions.includes('admin_access'))
    );
  }

  /** @returns {boolean} true si profil owner ET session active (trace de session). */
  isOwnerSessionValid(userCandidate = null) {
    // Deux conditions : le profil est bien un compte owner ET une session
    // active existe (sinon les appels /owner/* échoueraient en 401). Le jeton
    // n'existe que dans le shell natif ; sur le web, la session est le cookie
    // httpOnly, dont ni lui ni son compagnon CSRF ne sont lisibles depuis
    // l'origine frontend en cross-site. Le juge est donc hasSessionTrace
    // (jeton natif ou trace de profil), jamais la lisibilité d'un cookie.
    // S'il est expiré, /auth/me renverra 401 et le client purgera/redirigera —
    // pas de blocage ici.
    return this.isOwnerUser(userCandidate) && hasSessionTrace();
  }

  _translateOwnerError(error, fallback) {
    if (error?.response?.status === 403) {
      return new Error('Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement');
    }
    return error instanceof Error ? error : new Error(fallback);
  }

  /** @returns {Promise<object>} Stats commission (propriétaire uniquement). */
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

  /** @returns {Promise<object>} Journal métier d'une mission (propriétaire uniquement). */
  async getMissionBusinessEvents(jobId) {
    try {
      const data = await api.get(`/owner/missions/${encodeURIComponent(jobId)}/evenements`);
      return data;
    } catch (error) {
      safeLog.error('❌ Erreur journal de mission:', error);
      throw this._translateOwnerError(error, `Erreur serveur: ${error?.response?.status || 'inconnu'}`);
    }
  }

  /** @returns {Promise<object>} Infos de debug (propriétaire uniquement). */
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

  /** @returns {Promise<object>} Gestion des utilisateurs (propriétaire). */
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

  /** @returns {Promise<object>} Paramètres de commission mis à jour. */
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

  /** @returns {Promise<boolean>} true si l'accès owner est vérifié. */
  async checkOwnerAccess() {
    try {
      await this.getDebugInfo();
      return true;
    } catch (error) {
      devLog.info('👤 Utilisateur normal détecté (pas propriétaire)');
      return false;
    }
  }

  /** @returns {boolean} true si la session owner est valide (compat). */
  isFamakanLoggedIn(userCandidate = null) {
    return this.isOwnerSessionValid(userCandidate || this.getStoredUser());
  }
}

export default new OwnerService();
