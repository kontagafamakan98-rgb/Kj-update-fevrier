/**
 * Tests d'AuthContext : cohérence du champ 'user' stocké en localStorage.
 *
 * RÉGRESSIONS COUVERTES :
 * - Après une mise à jour du profil (ex. pays changé via le formulaire —
 *   détecté par téléphone ou choisi manuellement), loadUser rafraîchit aussi
 *   le snapshot localStorage 'user' (il restait figé au pays d'origine
 *   jusqu'au prochain login : l'état React et le stockage divergeaient).
 * - Le snapshot ne contient JAMAIS le pays détecté par téléphone hors
 *   sauvegarde (l'unique source du 'user' stocké est la réponse backend) ni
 *   les numéros de paiement (sanitisation privacy).
 * - Un 401 au bootstrap ne laisse aucun utilisateur fantôme dans le stockage.
 * - Un VISITEUR ANONYME (ni jeton, ni cookie) ne sonde JAMAIS /auth/me : la
 *   requête était un 401 garanti à chaque chargement de page, visible dans la
 *   console du navigateur et payé par tous les visiteurs non connectés.
 * - CONTRÔLE P0.1 : sur le web, la session est le cookie httpOnly SEUL — ni
 *   'token' ni 'token_expires_at' ne sont écrits (login compris) ; le shell
 *   natif Capacitor, lui, a le droit d'écrire les deux (pas de cookie fiable).
 * - CROSS-ORIGIN (production) : le cookie est rangé sur l'hôte de l'API, donc
 *   AUCUN cookie de session n'est lisible depuis l'origine frontend. Sans la
 *   trace locale (hasSessionTrace : jeton natif ou profil en cache), l'app se
 *   déclarait anonyme au rechargement et renvoyait /login à un utilisateur
 *   connecté (mesuré en production). La lisibilité d'un cookie ne décide de
 *   RIEN : deux hôtes possibles pour les cookies, un seul verdict. La trace ne
 *   doit PAS, à elle seule, autoriser l'affichage du cache hors-ligne : elle ne
 *   vaut pas preuve de session.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

// --- Mocks : isole AuthProvider du réseau, du réseau-optimizer et du push ---

vi.mock('../../services/api', () => ({
  authAPI: {
    getProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  },
  handleApiError: (error) => (error?.message || 'Erreur'),
  // Le signal de redirection douce consommé par AuthContext (appelé dans le
  // listener 'kojo:unauthorized'). Export réel de api.js — mocké en no-op,
  // le comportement est couvert par le test dédié "kojo:unauthorized".
  markSoftRedirectConsumed: vi.fn(),
  // Détection de session réellement branchée sur le stockage : le court-circuit
  // anonyme de loadUser est ainsi testé sur son vrai critère (jeton présent ou
  // non), pas sur une doublure qui répondrait toujours la même chose.
  getAuthToken: vi.fn(() => localStorage.getItem('token') || ''),
  // Trace de session — le SEUL juge d'amorçage : branchée sur le stockage comme
  // getAuthToken, pour que le court-circuit soit jugé sur son vrai critère (une
  // trace est-elle là ?), pas sur une doublure à réponse fixe.
  //
  // Depuis le 20/10/2026 la trace est un MARQUEUR sans PII
  // (`kojo_session_trace`), avec un `'user'` laissé par une version antérieure
  // encore lu comme trace valable (le démarrage le remplace).
  SESSION_TRACE_KEY: 'kojo_session_trace',
  hasSessionTrace: vi.fn(() => Boolean(localStorage.getItem('token'))
    || Boolean(localStorage.getItem('user'))
    || Boolean(localStorage.getItem('kojo_session_trace'))),
  hasSessionArtifact: vi.fn(() => Boolean(localStorage.getItem('user'))
    || Boolean(localStorage.getItem('kojo_session_trace'))),
  // Les scénarios historiques modélisent une session portée par le jeton, donc
  // le shell natif. Le web (cookie seul) est couvert en fin de fichier.
  isNativeShell: vi.fn(() => true),
}));

import { markSoftRedirectConsumed, isNativeShell, hasSessionTrace, hasSessionArtifact } from '../../services/api';

// Réseau « bon » : loadUser doit appeler /auth/me (pas le chemin cache pauvre).
vi.mock('../../utils/networkOptimizer', () => ({
  default: { getQuality: () => 'good' },
}));

vi.mock('../../utils/pushRegistration', () => ({
  isPushSupported: () => false,
  registerPushSubscription: vi.fn(),
  unregisterPushSubscription: vi.fn(),
}));

vi.mock('../../utils/registrationFlowStorage', () => ({
  clearRegistrationFlow: vi.fn(),
}));

// --- Imports réels (après les vi.mock, hoistés par Vitest) ----------------

import { AuthProvider, useAuth } from '../AuthContext';
import { authAPI } from '../../services/api';

const FRESH_USER = {
  id: 'user-1',
  first_name: 'Jean',
  last_name: 'Dupont',
  user_type: 'client',
  country: 'mali',
  phone: '+223771234567',
};

// Sonde : expose le pays de l'utilisateur React ET le bouton de rechargement.
const Probe = () => {
  const { user, loadUser, loading } = useAuth();
  return (
    <div>
      <span data-testid="country">{user?.country || 'none'}</span>
      <span data-testid="loading">{String(loading)}</span>
      <button onClick={() => loadUser()}>reload</button>
    </div>
  );
};

const renderProvider = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );

const readStoredUser = () => JSON.parse(localStorage.getItem('user') || 'null');

// Sonde de CONNEXION : `login` est le seul chemin qui pourrait écrire un
// jeton (establishSession → persistSessionToken). C'est donc lui qu'il faut
// déclencher pour verrouiller l'écriture — pas le seul démarrage.
const LoginProbe = () => {
  const { user, login, loading } = useAuth();
  return (
    <div>
      <span data-testid="country">{user?.country || 'none'}</span>
      <span data-testid="loading">{String(loading)}</span>
      <button onClick={() => login('jean@example.com', 'motdepasse')}>connect</button>
    </div>
  );
};

const renderLogin = () =>
  render(
    <AuthProvider>
      <LoginProbe />
    </AuthProvider>
  );

// JWT minimal dont le payload porte un `exp` (base64url, sans padding comme un
// vrai jeton) : c'est cette valeur que readJwtExpiry décode pour poser
// 'token_expires_at'.
const EXP_SECONDES = 2000000000;
const JWT_SONDE = [
  'entete',
  btoa(JSON.stringify({ sub: 'user-1', exp: EXP_SECONDES }))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_'),
  'signature',
].join('.');

// Connexion puis attente de l'état connecté (le test ne poursuit qu'une fois
// la session établie).
const connecter = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'connect' }));
  await waitFor(() => expect(screen.getByTestId('country').textContent).toBe('mali'));
};

describe('AuthContext — cohérence du snapshot localStorage user', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('après une mise à jour du pays (loadUser), le snapshot localStorage suit le backend', async () => {
    // Session ouverte depuis longtemps : le snapshot stocké porte encore le
    // pays d'origine (Sénégal) alors que le backend renvoie désormais Mali
    // (pays mis à jour depuis le formulaire de profil).
    // Session ouverte : le jeton est la marque d'une session vivante — sans
    // lui, loadUser ne sonde plus (visiteur anonyme).
    localStorage.setItem('token', 'jeton-de-session');
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 'user-1', country: 'senegal', user_type: 'client' })
    );
    authAPI.getProfile.mockResolvedValue({ ...FRESH_USER });

    renderProvider();

    // L'état React est rafraîchi par le bootstrap /auth/me.
    await waitFor(() => expect(screen.getByTestId('country').textContent).toBe('mali'));

    // Le snapshot localStorage 'user' est rafraîchi avec la MÊME vérité
    // backend : plus de divergence pays React vs stockage.
    expect(readStoredUser().country).toBe('mali');
    expect(readStoredUser().id).toBe('user-1');
  });

  it('ne stocke jamais les numéros de paiement dans le snapshot (sanitisation conservée)', async () => {
    localStorage.setItem('token', 'jeton-de-session');
    authAPI.getProfile.mockResolvedValue({
      ...FRESH_USER,
      payment_accounts: { orange_money: '+22370000000' },
    });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('country').textContent).toBe('mali'));

    const stored = readStoredUser();
    expect(stored.country).toBe('mali');
    expect(stored.payment_accounts).toBeUndefined();
  });

  it('401 au bootstrap → aucun utilisateur fantôme stocké (snapshot purgé)', async () => {
    localStorage.setItem('token', 'jeton-de-session');
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 'user-1', country: 'senegal', user_type: 'client' })
    );
    authAPI.getProfile.mockRejectedValue(
      Object.assign(new Error('Non authentifié'), { response: { status: 401 } })
    );

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('country').textContent).toBe('none'));
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('visiteur anonyme (ni jeton, ni cookie) → aucune sonde /auth/me', async () => {
    // Cas dominant en production : la majorité des chargements de page sont des
    // visiteurs non connectés (accueil, /jobs, /login, crawlers). La sonde y
    // répondait 401 à coup sûr — un aller-retour cross-origin inutile et une
    // ligne rouge dans la console du navigateur, à chaque page vue.
    authAPI.getProfile.mockResolvedValue({ ...FRESH_USER });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('country').textContent).toBe('none'));
    expect(authAPI.getProfile).not.toHaveBeenCalled();
    // Et l'état d'amorçage se termine : l'app ne reste pas bloquée en loading.
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  it('jeton présent → la sonde /auth/me EST faite (et un 401 purge la session)', async () => {
    // Contre-épreuve du test précédent : le court-circuit ne doit pas rendre
    // l'app aveugle à une session réellement ouverte.
    localStorage.setItem('token', 'jeton-de-session');
    authAPI.getProfile.mockResolvedValue({ ...FRESH_USER });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('country').textContent).toBe('mali'));
    expect(authAPI.getProfile).toHaveBeenCalledTimes(1);
  });

  it('le signal kojo:unauthorized vide user (redirection SPA douce, sans rechargement)', async () => {
    // Session valide au départ : l'utilisateur est connecté côté React.
    localStorage.setItem('token', 'jeton-de-session');
    authAPI.getProfile.mockResolvedValue({ ...FRESH_USER });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('country').textContent).toBe('mali'));
    markSoftRedirectConsumed.mockClear();

    // api.js (handleUnauthorized) émet l'événement quand un 401 non métier
    // survient sans cookie de repli. Le listener d'AuthContext vider user=null
    // SYNCHRONEMENT → ProtectedRoute fera un <Navigate> SPA, pas un
    // rechargement complet (anti-flicker, URL finale stable pour LHCI).
    act(() => {
      window.dispatchEvent(new Event('kojo:unauthorized'));
    });

    await waitFor(() => expect(screen.getByTestId('country').textContent).toBe('none'));
    expect(markSoftRedirectConsumed).toHaveBeenCalled();
  });
});

describe('AuthContext — web : la session est le cookie httpOnly seul', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    isNativeShell.mockReturnValue(false);
    hasSessionTrace.mockClear();
  });

  afterEach(() => {
    isNativeShell.mockReturnValue(true);
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('un jeton laissé par une ancienne version est purgé au démarrage, sans sonde', async () => {
    localStorage.setItem('token', 'jeton-herite');
    sessionStorage.setItem('access_token', 'jeton-herite-session');
    authAPI.getProfile.mockResolvedValue({ ...FRESH_USER });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(localStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('access_token')).toBeNull();
    // Sans cookie de session lisible, le jeton hérité ne vaut plus rien : pas de sonde.
    expect(authAPI.getProfile).not.toHaveBeenCalled();
  });

  it('un cookie CSRF lisible ne vaut pas session : sans trace locale, aucune sonde', async () => {
    // Le cookie CSRF est lisible ici (même-origine) et invisible en cross-site.
    // En faire un signal d'amorçage donnait deux comportements pour un même
    // état serveur — c'est précisément ce qui a été retiré.
    document.cookie = 'kojo_csrf=csrf-visible; path=/';
    authAPI.getProfile.mockResolvedValue({ ...FRESH_USER });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(authAPI.getProfile).not.toHaveBeenCalled();
    expect(screen.getByTestId('country').textContent).toBe('none');
    expect(localStorage.getItem('token')).toBeNull();
    document.cookie = 'kojo_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('cross-origin (aucun cookie lisible sur l\'origine frontend) → la session est restaurée au rechargement', async () => {
    // Production : l'API est appelée directement sur son propre hôte, où le
    // navigateur range kojo_session ET kojo_csrf. `document.cookie` de
    // l'origine frontend n'en montre aucun — réel en cross-origin, ce n'est pas
    // une doublure, et c'est exactement pourquoi aucune décision de session ne
    // doit lire un cookie. Le seul vestige lisible est le profil laissé par la
    // connexion précédente ; /auth/me a le dernier mot.
    localStorage.setItem('user', JSON.stringify({ id: 'user-1', country: 'mali' }));
    expect(document.cookie).not.toContain('kojo_session');
    expect(hasSessionArtifact()).toBe(true);
    expect(hasSessionTrace()).toBe(true);
    authAPI.getProfile.mockResolvedValue({ ...FRESH_USER });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('country').textContent).toBe('mali'));
    // Une seule question posée au serveur, et c'est la bonne.
    expect(authAPI.getProfile).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('le vestige SEUL ne survit pas à un 401 (aucun utilisateur fantôme)', async () => {
    // Le serveur répond 401 : le profil en cache est le vestige d'une session
    // finie. Il ne doit NI s'afficher, NI ouvrir un chemin de cache hors-ligne :
    // tous les appels de cet utilisateur échoueraient. Il est purgé, donc le
    // chargement suivant ne repose même pas la question.
    localStorage.setItem('user', JSON.stringify({ id: 'user-1', country: 'mali' }));
    const erreur401 = new Error('401');
    erreur401.response = { status: 401 };
    authAPI.getProfile.mockRejectedValue(erreur401);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('country').textContent).toBe('none');
    expect(hasSessionArtifact()).toBe(false);
  });

  it('connexion web : ni token ni token_expires_at, dans AUCUN des deux stockages', async () => {
    // Le backend vient de poser le cookie httpOnly ; il renvoie aussi le jeton
    // dans le corps de la réponse (mode Bearer pour les intégrations). Le web
    // ne doit PAS le conserver : c'est ce corps de réponse qui était stocké
    // par les anciennes versions, puis relu et envoyé en en-tête.
    authAPI.login.mockResolvedValue({ user: { ...FRESH_USER }, access_token: JWT_SONDE });

    renderLogin();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    await connecter();

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('token_expires_at')).toBeNull();
    expect(sessionStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('token_expires_at')).toBeNull();
    // Le reste de la session a bien été établi (absence de jeton ≠ login raté).
    expect(screen.getByTestId('country').textContent).toBe('mali');
    // ── AUCUNE donnée personnelle en stockage (20/10/2026) ────────────────
    // Le profil était réécrit dans localStorage à chaque amorçage (nom, email,
    // téléphone) : un appareil partagé, une XSS ou une sauvegarde de navigateur
    // l'emportaient. Seul un marqueur sans PII reste, et il suffit à l'amorçage.
    expect(localStorage.getItem('user')).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain('Jean');
    expect(JSON.stringify(localStorage)).not.toContain('jean@example.com');
    expect(JSON.stringify(localStorage)).not.toContain('+223771234567');
    expect(localStorage.getItem('kojo_session_trace')).toBe('1');
    expect(hasSessionArtifact()).toBe(true);
    expect(authAPI.login).toHaveBeenCalledWith({ email: 'jean@example.com', password: 'motdepasse' });
  });
});

describe('AuthContext — shell natif : le jeton a le droit d\'être écrit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    // Capacitor : pas de cookie httpOnly fiable, le jeton reste le seul canal.
    isNativeShell.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('connexion native : le jeton ET son expiration sont persistés', async () => {
    authAPI.login.mockResolvedValue({ user: { ...FRESH_USER }, access_token: JWT_SONDE });

    renderLogin();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    await connecter();

    // Contre-épreuve du test web : la garde isNativeShell ne doit pas
    // interdire au shell natif la session qu'il n'a pas d'autre moyen de
    // retrouver après redémarrage.
    expect(localStorage.getItem('token')).toBe(JWT_SONDE);
    expect(localStorage.getItem('token_expires_at')).toBe(String(EXP_SECONDES * 1000));
  });

  it('démarrage natif : le jeton stocké est CONSERVÉ (purge réservée au web)', async () => {
    // purgeWebSessionTokens sort tôt sur isNativeShell : si elle cessait de
    // distinguer les deux shells, le shell natif perdrait sa session à chaque
    // lancement sans qu'aucun test web ne le voie.
    localStorage.setItem('token', JWT_SONDE);
    localStorage.setItem('token_expires_at', String(EXP_SECONDES * 1000));
    authAPI.getProfile.mockResolvedValue({ ...FRESH_USER });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('country').textContent).toBe('mali'));
    expect(localStorage.getItem('token')).toBe(JWT_SONDE);
    expect(authAPI.getProfile).toHaveBeenCalledTimes(1);
  });
});
