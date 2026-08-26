import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI, handleApiError } from '../services/api';
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

  // NOTE AUTH : le JWT vit désormais dans un cookie httpOnly (kojo_session)
  // posé par le backend — il n'est plus stocké en localStorage (protection
  // XSS : un script injecté ne peut plus voler le token). Le navigateur
  // l'envoie automatiquement (credentials: 'include' dans api.js).
  // Le backend renvoie toujours access_token dans le corps (compat mobile /
  // legacy), mais on NE le persiste plus sur le web.
  //
  // Migration : un éventuel ancien token en localStorage reste envoyé via
  // l'en-tête Authorization (cf. getAuthToken dans api.js) tant qu'il n'est
  // pas purgé — l'auth dual-mode du backend l'accepte.

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
      devLog.info('✅ User profile loaded and cached');
      
    } catch (error) {
      safeLog.error('Error loading user:', error);

      // 401 = token expiré/révoqué : ne JAMAIS se rabattre sur le cache,
      // sinon l'app affiche un utilisateur fantôme dont tous les appels
      // API échouent. On purge la session (le redirect /login est géré
      // globalement par api.js).
      if (error?.response?.status === 401) {
        clearToken();
        setUser(null);
      } else {
        // Hors 401 (réseau, 5xx…) : cache autorisé en dernier recours
        const cachedUser = kojoCache.get(CACHE_KEYS.USER_PROFILE);
        if (cachedUser) {
          setUser(cachedUser);
          devLog.info('📱 User loaded from cache (API failed)');
        } else {
          clearToken();
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Établit la session après une auth réussie (cookie httpOnly posé par le
  // backend ; on ne stocke que le profil en localStorage, jamais le token).
  const establishSession = (user, cacheHours = 24) => {
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
      // Le token vit dans le cookie httpOnly posé par le backend (kojo_session).
      // On ne le persiste plus en localStorage (protection XSS).
      establishSession(user);
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
        establishSession(response.user);
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
      // Le token vit dans le cookie httpOnly posé par le backend sur
      // /auth/register-verified ; on ne le persiste plus en localStorage.
      // Le paramètre `token` est conservé pour la signature (compat).
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
      // Le token vit dans le cookie httpOnly posé par le backend ; on ne le
      // persiste plus en localStorage (protection XSS).
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