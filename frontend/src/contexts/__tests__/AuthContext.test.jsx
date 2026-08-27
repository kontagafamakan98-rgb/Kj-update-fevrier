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
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

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
}));

import { markSoftRedirectConsumed } from '../../services/api';

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
  const { user, loadUser } = useAuth();
  return (
    <div>
      <span data-testid="country">{user?.country || 'none'}</span>
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

  it('le signal kojo:unauthorized vide user (redirection SPA douce, sans rechargement)', async () => {
    // Session valide au départ : l'utilisateur est connecté côté React.
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
