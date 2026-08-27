import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { authAPI, handleApiError, markSoftRedirectConsumed } from '../services/api';
import { devLog, safeLog } from '../utils/env';
import kojoCache, { CACHE_KEYS } from '../utils/cache';
import networkOptimizer from '../utils/networkOptimizer';
import { clearRegistrationFlow } from '../utils/registrationFlowStorage';
import { registerPushSubscription, unregisterPushSubscription, isPushSupported } from '../utils/pushRegistration';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // NOTE AUTH (mode HYBRIDE) : la session vit dans le cookie httpOnly
  // (kojo_session) posé par le backend POUR LES NAVIGATEURS qui acceptent les
  // cookies cross-site, ET le jeton access_token est AUSSI persisté en
  // localStorage (fallback en-tête Authorization: Bearer).
  //
  // Pourquoi ce retour en arrière assumé : le frontend Vercel appelle le
  // backend Fly en CROSS-ORIGINE → le cookie de session est un cookie TIERS,
  // rejeté par les navigateurs stricts (Chrome 2026, Safari/ITP, navigation
  // privée) : le login « réussissait » (le serveur posait le cookie) mais le
  // navigateur le jetait → session inexistante → 401 sur tous les appels
  // authentifiés → boucle vers /login. Le backend accepte les deux modes
  // (dual-mode) : api.js envoie Authorization: Bearer quand un token est
  // présent, le cookie sinon. Le cookie httpOnly reste posé (défense en
  // profondeur) là où il fonctionne ; le token localStorage garantit le
  // login partout. Compromis : le token est lisible par JS (risque XSS
  // assumé — c'est le standard des SPA de production).

  const clearToken = () => {
    const keys = [
      'token', 'token_expires_at', 'user', 'auth_token', 'access_token',
      'accessToken', 'kojo_token', 'jwt', 'bearer_token', 'auth',
      'auth_user', 'session_user', 'currentUser', 'kojo_user',
    ];
    for (const storage of [localStorage, sessionStorage]) {
      keys.forEach((key) => storage.removeItem(key));
    }
  };

  // PRIVACITÉ : avant de persister le profil en localStorage, on retire les
  // numéros de paiement complets (Orange Money/Wave, cartes, comptes
  // bancaires). Le frontend ne les lit jamais depuis le profil (ils sont
  // chargés à la demande via GET /users/payment-accounts) — les stocker en
  // clair dans localStorage les exposerait à un script XSS ou à un device
  // partagé sans aucun usage. Le backend ne les renvoie plus non plus dans
  // le profil (défense en profondeur) ; cette sanitisation couvre aussi les
  // données stockées par d'anciennes versions.
  const sanitizeUserForStorage = (user) => {
    if (!user || typeof user !== 'object') return user;
    const { payment_accounts, ...safeUser } = user;
    return safeUser;
  };

  // Purge les numéros de paiement éventuellement stockés par une ancienne
  // version du code dans le profil localStorage (migration propre) — à la
  // fois la clé 'user' et le cache hors-ligne kojo_cache_user_profile_*.
  const purgeStoredPaymentAccounts = () => {
    const stripPaymentAccounts = (value) => {
      if (value && typeof value === 'object' && value.payment_accounts !== undefined) {
        const { payment_accounts, ...safeValue } = value;
        return safeValue;
      }
      return value;
    };
    try {
      const raw = localStorage.getItem('user');
      if (raw) {
        const safe = stripPaymentAccounts(JSON.parse(raw));
        localStorage.setItem('user', JSON.stringify(safe));
      }
    } catch (_error) {
      // Profil corrompu/illisible : on laisse le localStorage tel quel.
    }
    // Nettoyage du cache hors-ligne (namespace kojo_cache_..._user_profile_...)
    try {
      Object.keys(localStorage)
        .filter((key) => key.includes('user_profile'))
        .forEach((key) => {
          try {
            const raw = localStorage.getItem(key);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            const safe = stripPaymentAccounts(parsed?.data);
            if (safe !== parsed?.data) {
              localStorage.setItem(key, JSON.stringify({ ...parsed, data: safe }));
            }
          } catch (_error) {
            // Entrée corrompue : on la laisse (le cache gère l'expiration).
          }
        });
    } catch (_error) {
      // localStorage indisponible (tests jsdom) : on ignore.
    }
  };

  const isTokenExpiredLocally = () => {
    const expiresAt = localStorage.getItem('token_expires_at');
    if (!expiresAt) return false; // token sans expiry stockée = ancien format, on laisse le serveur décider
    return Date.now() > Number(expiresAt);
  };

  // Référence vers la dernière version de loadUser pour le listener de
  // synchronisation multi-onglets (éviter une closure obsolète).
  // NOTE : l'assignation se fait APRÈS la déclaration de loadUser (voir plus
  // bas) — l'assigner ici, avant le `const loadUser`, levait un
  // ReferenceError (TDZ « Cannot access 'loadUser' before initialization »)
  // au premier rendu d'AuthProvider : écran blanc sur toute l'app.
  const loadUserRef = useRef();

  // Signal d'expiration de session émis par api.js (handleUnauthorized) pour
  // les 401 non métier sans cookie de repli. Au lieu d'un plein rechargement
  // vers /login (flicker + URL finale ambiguë pour Lighthouse), on vide
  // user=null ici : ProtectedRoute réalise alors une redirection SPA douce
  // (<Navigate> React) — l'état React est conservé et LHCI audite l'URL
  // initiale sans la voir basculer sur /login par un window.location hard.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onSessionExpired = () => {
      markSoftRedirectConsumed();
      setUser(null);
    };
    window.addEventListener('kojo:unauthorized', onSessionExpired);
    return () => window.removeEventListener('kojo:unauthorized', onSessionExpired);
  }, []);

  useEffect(() => {
    // Amorçage de session au démarrage de l'app.
    // Le cookie de session httpOnly n'est pas lisible depuis JavaScript,
    // surtout quand l'API est sur un autre domaine. On sonde donc /auth/me
    // systématiquement; un 401 silencieux signifie simplement visiteur anonyme.
    // Migration privacy : purge les numéros de paiement stockés par une
    // ancienne version du code dans le profil localStorage.
    purgeStoredPaymentAccounts();
    const token = localStorage.getItem('token');
    if (token && isTokenExpiredLocally()) {
      // Token expiré côté client : on nettoie sans appel réseau inutile,
      // mais on sonde tout de même le cookie httpOnly éventuel.
      clearToken();
    }
    loadUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Synchronisation multi-onglets : un changement de 'token' dans l'onglet A
  // (login, rotation, logout, purge 401) déclenche l'événement 'storage' dans
  // les AUTRES onglets → on re-sonde la session. loadUser relit localStorage
  // ET le cookie httpOnly : si une session valide survit (ex. purge
  // auto-guérison d'un token stale alors que le cookie est bon), /auth/me
  // 200 restaure le profil SANS rechargement ; si la session est réellement
  // morte, le 401 laisse user=null et ProtectedRoute redirige vers /login.
  //
  // Pas de redirection forcée ni de window.location.href : un rechargement
  // complet faisait clignoter /login et perdait l'état de l'app — la
  // navigation SPA (Navigate de ProtectedRoute) suffit, et re-sonder plutôt
  // que purger évite qu'un simple purge dans un onglet déconnecte les autres.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== 'token') return;
      // 'user' est toujours écrit/supprimé en même temps que 'token' (login,
      // register, logout) — réagir au seul 'token' suffit et évite les
      // double-déclenchements de clearToken (14 clés purgées → 2 événements).
      loadUserRef.current();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadUser = async () => {
    try {
      // Use cached profile if available for faster loading
      const cachedUser = kojoCache.get(CACHE_KEYS.USER_PROFILE);
      if (cachedUser && networkOptimizer.getQuality() === 'poor') {
        setUser(cachedUser);
        setLoading(false);
        devLog.info('🚀 User loaded from cache (poor network)');
        return;
      }
      
      // Le 401 attendu d'un visiteur ne doit pas déclencher la redirection
      // globale de api.js avant que ProtectedRoute ait décidé quoi faire.
      const userData = await authAPI.getProfile({ skipUnauthorizedRedirect: true });
      setUser(userData);
      
      // Cache user data for offline access (sans les numéros de paiement)
      kojoCache.set(CACHE_KEYS.USER_PROFILE, sanitizeUserForStorage(userData), 60 * 60 * 1000); // 1 hour

      // COHÉRENCE du snapshot localStorage 'user' : écrit au login/register, il
      // resterait sinon figé au pays d'origine après une mise à jour de profil
      // (ex. pays changé depuis le formulaire — détecté par téléphone ou choisi
      // manuellement) jusqu'au prochain login. loadUser rafraîchit donc aussi
      // ce snapshot avec la vérité backend. Aucun effet de bord multi-onglets
      // (le listener storage ne réagit qu'à la clé 'token'), et la
      // sanitisation privacy est identique à establishSession (jamais les
      // numéros de paiement).
      try {
        localStorage.setItem('user', JSON.stringify(sanitizeUserForStorage(userData)));
      } catch (_error) {
        // localStorage indisponible (tests jsdom / privé) : le cache kojoCache
        // reste la source hors-ligne.
      }
      devLog.info('✅ User profile loaded and cached');
      
    } catch (error) {
      // 401 = visiteur anonyme OU session expirée/révoquée : cas NORMAL au
      // bootstrap (l'app sonde /auth/me systématiquement, le cookie httpOnly
      // étant invisible cross-origin). Pas un log d'erreur — on purge la
      // session (ne JAMAIS se rabattre sur le cache, sinon l'app afficherait
      // un utilisateur fantôme dont tous les appels échouent ; le redirect
      // /login est géré globalement par api.js).
      if (error?.response?.status === 401) {
        clearToken();
        setUser(null);
      } else {
        safeLog.error('Error loading user:', error);
        // Hors 401 (réseau, 5xx…) : cache autorisé en dernier recours
        const cachedUser = kojoCache.get(CACHE_KEYS.USER_PROFILE);
        if (cachedUser) {
          setUser(cachedUser);
          devLog.info('📱 User loaded from cache (API failed)');
        } else {
          // On NE purge PAS le token : une panne réseau transitoire ne doit
          // pas détruire la session. Le token vit dans le localStorage
          // PARTAGÉ entre les onglets — un clearToken ici déconnecterait
          // TOUS les onglets via l'événement 'storage' (et, en navigateur
          // bloquant les cookies tiers, forcerait un re-login manuel). On
          // affiche simplement l'état non connecté : le prochain /auth/me
          // réussi restaurera le profil, et un VRAI 401 (session morte)
          // purgera proprement via handleUnauthorized.
          setUser(null);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Référence de loadUser pour le listener multi-onglets : mise à jour APRÈS
  // la déclaration (le `const loadUser` ci-dessus) — assignée avant, le rendu
  // d'AuthProvider levait une ReferenceError TDZ au premier rendu.
  loadUserRef.current = loadUser;

  // Établit la session après une auth réussie (cookie httpOnly posé par le
  // backend ; on ne stocke que le profil en localStorage, jamais le token).
  // Décode l'expiration du JWT (payload base64url) pour stocker
  // token_expires_at : au bootstrap, le token EXPIRÉ est alors purgé AVANT
  // tout appel (évite d'envoyer un header stale — avec une session cookie
  // valide, le backend retombe de toute façon sur le cookie, mais le header
  // expiré forçait un 401/403 CSRF inutile sur les mutations).
  const readJwtExpiry = (accessToken) => {
    try {
      const parts = String(accessToken || '').split('.');
      if (parts.length < 2) return null;
      const payload = JSON.parse(
        atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
      );
      return payload && payload.exp ? payload.exp * 1000 : null;
    } catch (_error) {
      return null;
    }
  };

  // Persiste le jeton en localStorage pour l'en-tête Authorization (mode
  // hybride) — le cookie httpOnly reste le canal primaire là où il est
  // accepté. Clé 'token' : lue par getAuthToken (api.js) et purgée par
  // clearToken / handleUnauthorized.
  const persistSessionToken = (accessToken) => {
    if (!accessToken) return;
    try {
      localStorage.setItem('token', accessToken);
      const expiry = readJwtExpiry(accessToken);
      if (expiry) localStorage.setItem('token_expires_at', String(expiry));
    } catch (_error) {
      // localStorage indisponible (tests jsdom / privé) : le cookie reste le
      // seul canal.
    }
  };

  const establishSession = (user, accessToken = null, cacheHours = 24) => {
    persistSessionToken(accessToken);
    // Ne persiste PAS les numéros de paiement en localStorage (privacy).
    localStorage.setItem('user', JSON.stringify(sanitizeUserForStorage(user)));
    setUser(user);
    kojoCache.set(CACHE_KEYS.USER_PROFILE, sanitizeUserForStorage(user), cacheHours * 60 * 60 * 1000);
    if (isPushSupported()) {
      registerPushSubscription(user.id).catch(() => {});
    }
  };

  const login = async (email, password) => {
    try {
      const response = await authAPI.login({ email, password });
      const { user } = response;
      // Mode hybride : on persiste le jeton (fallback en-tête Authorization) ;
      // le cookie httpOnly reste posé par le backend pour les navigateurs qui
      // l'acceptent.
      establishSession(user, response.access_token);
      devLog.info('✅ User logged in successfully');
      return { success: true, user };
    } catch (error) {
      const errorMessage = handleApiError(error);
      safeLog.error('Login failed:', errorMessage);

      // Le backend renvoie "Invalid credentials" en anglais, quelle que
      // soit la langue de l'utilisateur. On detecte precisement ce cas
      // (401 + ce message) pour afficher une version traduite au lieu du
      // texte brut du backend.
      const status = error?.response?.status;
      const rawDetail = typeof error?.response?.data?.detail === 'string' ? error.response.data.detail : '';
      const isInvalidCredentials = status === 401 && /invalid credentials/i.test(rawDetail);

      return {
        success: false,
        error: errorMessage,
        errorKey: isInvalidCredentials ? 'invalidCredentials' : ''
      };
    }
  };

  // Connexion / inscription via Google. `profile` contient les choix de
  // création (user_type, country, preferred_language, legal_documents_accepted)
  // utilisés uniquement si le compte est créé.
  const loginWithGoogle = async (profile = {}) => {
    try {
      const { getGoogleAuthCode } = await import('../utils/googleAuth');
      const code = await getGoogleAuthCode();
      if (!code) return { success: false, cancelled: true };

      const response = await authAPI.googleAuth({
        code,
        ...profile,
      });

      // Compte existant avec le même email (non lié à Google) : le frontend
      // doit proposer la fusion sécurisée (mot de passe).
      if (response.status === 'email_exists') {
        return { success: false, emailExists: true, email: response.email, message: response.message };
      }

      if (response.status === 'success' && response.user) {
        establishSession(response.user, response.access_token);
        return {
          success: true,
          user: response.user,
          needsOnboarding: Boolean(response.needs_onboarding),
        };
      }

      return { success: false, error: response.message || 'Échec de la connexion Google' };
    } catch (error) {
      const errorMessage = handleApiError(error);
      safeLog.error('Google login failed:', error);
      return { success: false, error: errorMessage };
    }
  };

  // Fusion : lie un compte Google au compte actuellement connecté, en
  // vérifiant le mot de passe (preuve de propriété).
  const linkGoogleAccount = async (password) => {
    try {
      const { getGoogleAuthCode } = await import('../utils/googleAuth');
      const code = await getGoogleAuthCode();
      if (!code) return { success: false, cancelled: true };
      await authAPI.googleLink({ code, password });
      return { success: true };
    } catch (error) {
      const errorMessage = handleApiError(error);
      safeLog.error('Google link failed:', error);
      return { success: false, error: errorMessage };
    }
  };

  // Nouvelle fonction pour connexion automatique après inscription
  const autoLoginAfterRegistration = (userData, token) => {
    try {
      // Mode hybride : on persiste le jeton (fallback en-tête Authorization),
      // le cookie httpOnly reste posé par le backend sur
      // /auth/register-verified.
      persistSessionToken(token);
      localStorage.setItem('user', JSON.stringify(sanitizeUserForStorage(userData)));
      setUser(userData);
      
      // Cache user data (sans les numéros de paiement)
      kojoCache.set(CACHE_KEYS.USER_PROFILE, sanitizeUserForStorage(userData), 24 * 60 * 60 * 1000); // 24 hours
      
      devLog.info('✅ User auto-logged in after registration');

      // Enregistrer la subscription push en arrière-plan (silencieux)
      if (isPushSupported()) {
        registerPushSubscription(userData.id).catch(() => {});
      }

      return { success: true };
      
    } catch (error) {
      safeLog.error('Auto-login after registration failed:', error);
      return { success: false, error: error.message };
    }
  };

  const register = async (userData) => {
    try {
      // Toute inscription passe par register-verified (vérification email OTP
      // obligatoire côté backend). userData doit contenir email_verification_token.
      const response = await authAPI.registerVerified(userData);
      const { user } = response;
      // Mode hybride : on persiste le jeton (fallback en-tête Authorization),
      // le cookie httpOnly reste posé par le backend.
      persistSessionToken(response.access_token);
      localStorage.setItem('user', JSON.stringify(sanitizeUserForStorage(user)));
      setUser(user);
      
      // Cache user data (sans les numéros de paiement)
      kojoCache.set(CACHE_KEYS.USER_PROFILE, sanitizeUserForStorage(user), 24 * 60 * 60 * 1000); // 24 hours
      
      devLog.info('✅ User registered successfully');
      return { success: true };
      
    } catch (error) {
      const errorMessage = handleApiError(error);
      safeLog.error('Registration failed:', errorMessage);

      return {
        success: false,
        error: errorMessage
      };
    }
  };

  const logout = async () => {
    try {
      // Révoquer la subscription push avant de se déconnecter
      if (isPushSupported()) {
        unregisterPushSubscription().catch(() => {});
      }
      // Attempt to notify server of logout
      await authAPI.logout();
    } catch (error) {
      devLog.warn('Server logout failed:', error);
    } finally {
      // Always clear local data
      clearToken();
      kojoCache.clear(); // Clear all cached data
      clearRegistrationFlow();
      setUser(null);
      
      devLog.info('✅ User logged out and cache cleared');
    }
  };

  const value = {
    user,
    loading,
    login,
    loginWithGoogle,
    linkGoogleAccount,
    register,
    logout,
    loadUser,
    autoLoginAfterRegistration
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}