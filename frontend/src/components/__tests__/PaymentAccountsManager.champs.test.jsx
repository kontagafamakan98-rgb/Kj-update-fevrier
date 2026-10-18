/**
 * Les champs du bloc « Comptes de paiement » lisent-ils le dessin PARTAGÉ ?
 *
 * ── La régression que ce cas ferme (17/10/2026) ─────────────────────────────
 * La refonte a donné UN propriétaire au champ du site
 * (`src/config/classes-champ.js`, lu par /login, /register et /profile), mais
 * ce bloc-ci écrivait encore le field d'AVANT, et trois fois de suite :
 * `border-gray-300` (filet froid), `rounded-md` (rayon qu'aucune carte ne
 * porte), et un anneau de focus PLEIN — orange pour Orange Money, BLEU pour
 * Wave, GRIS pour la banque. Dans une même carte, trois dessins de champ, et
 * deux couleurs de focus qui n'existent nulle part ailleurs sur le site.
 *
 * Le cas juge donc deux choses, et pas le dessin pour lui-même :
 *   1. chaque champ porte EXACTEMENT la chaîne du propriétaire (une copie
 *      divergerait au premier changement du propriétaire) ;
 *   2. le focus est ORANGE — y compris quand le champ est en erreur, où seul
 *      le filet change (`border-red-500`), jamais l'anneau.
 *
 * Ce n'est pas une sonde de navigateur : jsdom ne calcule pas Tailwind. Ce qui
 * se mesure ici est la LECTURE du propriétaire (une chaîne de classes), pas le
 * pixel — le dessin servi a ses sondes (`e2e/cadres-app.spec.js`).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { CHAMP } from '../../config/classes-champ';

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', user_type: 'client', country: 'senegal' },
    loadUser: vi.fn(),
    logout: vi.fn(),
  }),
}));

// Comptes vides : aucune écriture, aucun réseau.
vi.mock('../../services/paymentAccountService', () => ({
  default: {
    getUserPaymentAccounts: vi.fn().mockResolvedValue({ success: true, data: { payment_accounts: {} } }),
    updatePaymentAccounts: vi.fn().mockResolvedValue({ success: true }),
  },
}));

// Détection neutre (`detected:false`) : Wave reste proposé, exemples par défaut.
vi.mock('../../services/geolocationService', () => ({
  detectUserCountry: vi.fn().mockResolvedValue({ detected: false, code: '' }),
  getPhoneExampleForCountry: vi.fn().mockReturnValue('+221 70 12 34 56'),
  getPhonePrefixByCountry: vi.fn().mockReturnValue('+221'),
  getPopularBanksByCountry: vi.fn().mockReturnValue([]),
}));

import { LanguageProvider } from '../../contexts/LanguageContext';
import PaymentAccountsManager from '../PaymentAccountsManager';

// Les cinq champs du bloc, par leur id (le contrat des formulaires du site).
const CHAMPS = [
  'payment_accounts_orange_money',
  'payment_accounts_wave',
  'payment_accounts_bank_account_number',
  'payment_accounts_bank_name',
  'payment_accounts_bank_account_holder',
  'payment_accounts_bank_code',
  'payment_accounts_bank_branch',
];

const ouvrirEdition = async () => {
  render(
    <LanguageProvider>
      <PaymentAccountsManager />
    </LanguageProvider>
  );
  // Le repère de la carte est DÉCLARÉ (`data-section`), jamais ses classes de
  // présentation : un dessin qui change ne doit pas faire rougir ce cas.
  const carte = await screen.findByText('Comptes de paiement')
    .then((el) => el.closest('[data-section="comptes-paiement"]'));
  fireEvent.click(carte.querySelector('button'));
  return carte;
};

describe('Comptes de paiement — les champs lisent le dessin de la carte', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('donne à chaque champ EXACTEMENT la chaîne du propriétaire partagé', async () => {
    await ouvrirEdition();

    for (const id of CHAMPS) {
      const champ = document.getElementById(id);
      expect(champ, `${id} absent du formulaire d'édition`).not.toBeNull();
      expect(champ.className, `${id} n'écrit pas le champ partagé`).toBe(CHAMP);
    }
  });

  it('porte le focus orange du site sur chaque champ', async () => {
    await ouvrirEdition();

    for (const id of CHAMPS) {
      const { className } = document.getElementById(id);
      expect(className, `${id} : filet de focus`).toContain('focus:border-orange-500');
      expect(className, `${id} : anneau de focus translucide`).toContain('focus:ring-orange-500/30');
      // Les anneaux pleins de trois couleurs différentes ont disparu.
      expect(className).not.toMatch(/ring-(blue|gray|stone)-500\b/);
    }
  });

  it('garde le focus orange quand le champ est en ERREUR (seul le filet change)', async () => {
    await ouvrirEdition();

    // Un numéro trop court : la validation de Orange Money refuse, l'erreur
    // s'affiche sous le champ, et le filet passe en rouge.
    const orange = document.getElementById('payment_accounts_orange_money');
    fireEvent.change(orange, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText(/Numéro Orange Money invalide/i)).toBeInTheDocument();

    const { className } = document.getElementById('payment_accounts_orange_money');
    expect(className).toContain('border-red-500');
    expect(className).toContain('focus:border-orange-500');
    expect(className).toContain('focus:ring-orange-500/30');
  });
});
