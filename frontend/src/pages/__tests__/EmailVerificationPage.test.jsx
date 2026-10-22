/**
 * L'INSCRIPTION ABOUTIT À LA VÉRIFICATION EMAIL, SANS COMPTES DE PAIEMENT.
 *
 * ── Le défaut que ce fichier ferme (22/10/2026) ─────────────────────────────
 * Cette page renvoyait vers /payment-verification, où `registerVerified`
 * exigeait UN compte mobile money (client) ou DEUX (travailleur) AVANT de
 * créer le compte. Un travailleur devait donc ouvrir deux numéros valides
 * avant d'avoir un identifiant — là où le canal réel du marché (un groupe
 * WhatsApp) ne demande rien, et alors que la garantie qui compte (« être
 * payé ») vit au décaissement, où le backend refuse sans compte.
 *
 * ── Ce que le cas exige, et pas seulement ce qu'il constate ─────────────────
 * Il ne suffit pas que `registerVerified` soit appelé : il doit l'être SANS
 * `payment_accounts` (sinon la porte serait toujours là, simplement déplacée
 * dans la page), avec le jeton de vérification OTP, et l'écran doit finir sur
 * /dashboard — jamais sur /payment-verification, qui redemanderait la même
 * chose. Le tableau de bord se charge ensuite de rappeler l'ajout, au bon
 * moment, avec un lien vers /profile.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const autoLoginAfterRegistration = vi.fn(() => ({ success: true }));

vi.mock('../../contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useAuth: () => ({ autoLoginAfterRegistration, user: null, loading: false }) };
});

// Le scope `emailVerification` porte ses propres libellés FR ; le contexte ne
// fournit que la langue courante.
vi.mock('../../contexts/LanguageContext', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useLanguage: () => ({ currentLanguage: 'fr', changeLanguage: vi.fn(), t: (key) => key }),
  };
});

vi.mock('../../contexts/ToastContext', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
  };
});

// Le seul réseau de cette page : OTP + création du compte.
vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    authAPI: {
      ...actual.authAPI,
      sendEmailOtp: vi.fn(async () => ({
        cooldown_seconds: 60,
        expires_in_seconds: 600,
        masked_email: 'a***@exemple.com',
      })),
      verifyEmailOtp: vi.fn(async () => ({ verification_token: 'jeton-otp' })),
      registerVerified: vi.fn(async () => ({
        access_token: 'jeton-session',
        user: { id: 'u-1', first_name: 'Awa', email_verified: true, is_verified: false },
      })),
    },
  };
});

const { default: EmailVerificationPage } = await import('../EmailVerificationPage.js');
const { authAPI } = await import('../../services/api');

const UTILISATEUR = {
  email: 'awa@exemple.com',
  password: 'motdepasse123',
  first_name: 'Awa',
  last_name: 'Diop',
  phone: '+221771234567',
  user_type: 'worker',
  country: 'senegal',
  legal_documents_accepted: true,
};

const rendre = () =>
  render(
    <MemoryRouter
      initialEntries={[{ pathname: '/email-verification', state: { userData: UTILISATEUR } }]}
    >
      <Routes>
        <Route path="/email-verification" element={<EmailVerificationPage />} />
        <Route path="/dashboard" element={<p>TABLEAU&nbsp;DE&nbsp;BORD</p>} />
        <Route path="/payment-verification" element={<p>MUR&nbsp;DE&nbsp;PAIEMENT</p>} />
        <Route path="/register" element={<p>INSCRIPTION</p>} />
      </Routes>
    </MemoryRouter>
  );

/** Saisit le code et soumet, comme un utilisateur : le formulaire est réel. */
const validerLeCode = async () => {
  await userEvent.type(await screen.findByLabelText('Code à 6 chiffres'), '123456');
  await userEvent.click(screen.getByRole('button', { name: 'Vérifier mon email' }));
};

beforeEach(() => {
  autoLoginAfterRegistration.mockClear();
  Object.values(authAPI).forEach((fn) => fn?.mockClear?.());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Vérification email — le compte est créé ici', () => {
  it('le code vérifié crée le compte SANS compte de paiement et mène au tableau de bord', async () => {
    rendre();

    await validerLeCode();

    // 1. Le compte est créé avec le jeton OTP, et RIEN d'autre.
    await waitFor(() => expect(authAPI.registerVerified).toHaveBeenCalledTimes(1));
    const charge = authAPI.registerVerified.mock.calls[0][0];
    expect(charge.email_verification_token).toBe('jeton-otp');
    expect(charge.email).toBe('awa@exemple.com');
    // La porte fermée : aucun compte mobile money n'est exigé pour naître.
    expect(charge.payment_accounts).toBeUndefined();

    // 2. La session s'établit sur le compte RENDU par le backend.
    expect(autoLoginAfterRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u-1' }),
      'jeton-session'
    );

    // 3. On arrive au tableau de bord, jamais au mur des comptes de paiement.
    expect(await screen.findByText(/TABLEAU/)).toBeInTheDocument();
    expect(screen.queryByText(/MUR/)).not.toBeInTheDocument();
  });

  it('un code refusé n’écrit rien : ni compte, ni session', async () => {
    authAPI.verifyEmailOtp.mockRejectedValueOnce(new Error('Code expiré'));

    rendre();
    await validerLeCode();

    await waitFor(() => expect(authAPI.verifyEmailOtp).toHaveBeenCalledTimes(1));
    expect(authAPI.registerVerified).not.toHaveBeenCalled();
    expect(autoLoginAfterRegistration).not.toHaveBeenCalled();
    expect(screen.queryByText(/TABLEAU/)).not.toBeInTheDocument();
  });
});
