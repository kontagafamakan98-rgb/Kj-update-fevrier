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
  /** @returns {object|null} Profil stocké en localStorage, ou null.
   *
   *  Sur le WEB ce profil a été supprimé (20/10/2026, donnée personnelle au
   *  repos) : cette lecture rend `null` et ne doit jamais être la SEULE source
   *  d'un contrôle d'accès — le profil de session (`useAuth().user`) est la
   *  source vivante, le stockage ne sert plus qu'au shell natif. */
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

  /** @returns {boolean} true si le profil porte le rôle du SERVICE CLIENTÈLE.
   *
   *  `support_role` est posé par le propriétaire (`/support/team`) et publié par
   *  `/auth/me` : l'écran ne devine pas un droit, il lit un fait. Ce rôle
   *  n'ouvre RIEN d'autre que les demandes de support — aucun écran de gains,
   *  d'arbitrage ou de commission ne le reconnaît. */
  isSupportAgent(userCandidate = null) {
    return userCandidate?.support_role === 'agent';
  }

  /** @returns {boolean} true si ce compte peut ouvrir /support-admin.
   *
   *  Deux rôles, une page : le propriétaire (qui gère l'équipe) et les
   *  personnes qu'il a ajoutées (qui traitent les demandes). La session doit
   *  être active : sans elle, les routes de support répondraient 401/403 et
   *  l'écran serait un cadre vide. */
  canManageSupport(userCandidate = null) {
    if (!hasSessionTrace()) return false;
    return this.isOwnerUser(userCandidate) || this.isSupportAgent(userCandidate);
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

  /** Paliers de commission : configuration courante + taux de croisière.
   *  Les deux chiffres vont ensemble — « lancement 0 % » ne se lit pas sans le
   *  taux auquel il se compare.
   *  @returns {Promise<object>} {status, paliers, taux_standard_percent}. */
  async getCommissionTiers() {
    try {
      return await api.get('/owner/commission-paliers');
    } catch (error) {
      safeLog.error('❌ Erreur lecture paliers de commission:', error);
      throw this._translateOwnerError(error, `Erreur serveur: ${error?.response?.status || 'inconnu'}`);
    }
  }

  /** Enregistre les paliers de commission (propriétaire uniquement) et rend la
   *  configuration RÉELLEMENT relue par le serveur.
   *  @returns {Promise<object>} {status, message, paliers}. */
  async updateCommissionTiers(paliers) {
    try {
      return await api.post('/owner/commission-paliers', paliers);
    } catch (error) {
      safeLog.error('❌ Erreur écriture paliers de commission:', error);
      const detail = error?.response?.data?.detail;
      if (detail) throw new Error(detail);
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

  /** Litige COURANT d'une mission, ou `litige.response` absent s'il n'y en a pas.
   *  Lu par le journal de mission : la réponse de l'autre partie n'est pas dans
   *  le journal (aucune prose n'y entre), donc l'écran la demande à sa source.
   *  @returns {Promise<object>} {job_id, title, status, client_id, worker_id, litige}. */
  async getMissionDispute(jobId) {
    try {
      const data = await api.get(`/owner/missions/${encodeURIComponent(jobId)}/litige`);
      return data;
    } catch (error) {
      safeLog.error('❌ Erreur litige de mission:', error);
      throw this._translateOwnerError(error, `Erreur serveur: ${error?.response?.status || 'inconnu'}`);
    }
  }

  /** MESURES de l'arbitrage (propriétaire uniquement) : réponses avant échéance,
   *  décisions sans réponse, délai réponse → décision. Calculées à la demande
   *  sur l'historique des litiges, jamais recopiées.
   *  @returns {Promise<object>} {litiges, etats, reponse, tranches,
   *  delai_reponse_decision, plancher, fenetres (30 et 90 jours : decisions,
   *  reponses, delai)}. */
  async getDisputeMesures() {
    try {
      const data = await api.get('/owner/litiges/mesures');
      return data;
    } catch (error) {
      safeLog.error('❌ Erreur mesures d’arbitrage:', error);
      throw this._translateOwnerError(error, `Erreur serveur: ${error?.response?.status || 'inconnu'}`);
    }
  }

  /** File d'arbitrage des LITIGES (propriétaire uniquement).
   *  @returns {Promise<object>} {count, etats, fenetre_jours, litiges}. */
  async getDisputes() {
    try {
      const data = await api.get('/owner/litiges');
      return data;
    } catch (error) {
      safeLog.error('❌ Erreur file d’arbitrage:', error);
      throw this._translateOwnerError(error, `Erreur serveur: ${error?.response?.status || 'inconnu'}`);
    }
  }

  /** TRANCHER un litige — verser le travailleur ou rembourser le client.
   *  @returns {Promise<object>} {message, decision, payment_outcome}. */
  async decideDispute(jobId, { decision, note }) {
    try {
      const data = await api.post(
        `/owner/missions/${encodeURIComponent(jobId)}/litige/decision`,
        { decision, note },
      );
      return data;
    } catch (error) {
      safeLog.error('❌ Erreur décision de litige:', error);
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

  /** @returns {boolean} true si la session owner est valide (compat).
   *
   *  ⚠️ PASSER LE PROFIL DE SESSION (`useAuth().user`). Depuis le 20/10/2026 le
   *  web n'écrit plus le profil dans `localStorage` (il ne vit qu'en mémoire,
   *  cf. `AuthContext.purgerProfilWebPersistant`) : un appel SANS argument
   *  relisait donc `getStoredUser()` — toujours `null` sur le web — et rendait
   *  faux pour tout le monde, propriétaire compris (constaté en production le
   *  24/10/2026 sur `/commission-dashboard`). Le repli stockage ne vaut plus
   *  que pour le shell natif, qui garde son profil. */
  isFamakanLoggedIn(userCandidate = null) {
    return this.isOwnerSessionValid(userCandidate || this.getStoredUser());
  }
}

export default new OwnerService();
