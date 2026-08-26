/**
 * Test de bout en bout de la page Profil : détection IP en échec.
 *
 * RÉGRESSION COUVERTE : quand detectUserCountry() échoue, elle renvoie un
 * objet pays NEUTRE (`detected:false`, plus jamais null — voir
 * geolocationService.js). La page Profil doit alors :
 *  - se rendre SANS planter — l'ancien crash « Cannot read properties of null
 *    (reading 'nameFrench') » survenait dans PaymentAccountsManager, monté sur
 *    cette page (chunk Profile) ;
 *  - NE PAS auto-sélectionner de pays — le sélecteur de pays du formulaire
 *    garde le pays du profil, et les exemples (numéro de téléphone, banques)
 *    de la section comptes restent ceux par défaut.
 *
 * On rend la VRAIE page Profile (MemoryRouter + LanguageProvider), avec les
 * services réseau mockés pour rester hermétique. Seule la détection est
 * espionnée sur le module réel : elle renvoie l'objet neutre.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// --- Mocks : isole la page Profile des providers lourds et du réseau ----

vi.mock('../../contexts/AuthContext', () => {
  // Utilisateur CLIENT : évite les sections travailleur (worker profile,
  // portfolio, parrainage) qui appellent d'autres endpoints.
  const user = {
    id: 'user-1',
    first_name: 'Jean',
    last_name: 'Dupont',
    email: 'jean@example.com',
    user_type: 'client',
    country: 'senegal',
    phone: '+221771234567',
    is_verified: false,
    rating: 4.5,
    total_reviews: 2,
    preferred_language: 'fr',
  };
  return {
    useAuth: () => ({
      user,
      loadUser: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
    }),
  };
});

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ show: vi.fn(), error: vi.fn(), success: vi.fn() }),
}));

// Photos de profil : aucun appel réseau (endpoint backend absent en test).
vi.mock('../../services/ProfilePhotoService', () => ({
  default: {
    getCurrentUserPhotoUrl: vi.fn().mockResolvedValue(null),
    getPhotoUrl: vi.fn().mockResolvedValue(null),
    revokePreviewUrl: vi.fn(),
    generateDefaultAvatar: vi.fn().mockReturnValue('data:image/svg+xml;base64,test'),
  },
}));

// API centralisée : users/reviews/workerProfile résolus localement. Le
// module `api` lui-même est fourni car geolocationService (réel, espionné)
// en importe une référence — jamais appelée dans ce scénario.
vi.mock('../../services/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
  usersAPI: {
    updateProfile: vi.fn().mockResolvedValue({}),
    deleteAccount: vi.fn().mockResolvedValue({}),
    getReferral: vi.fn().mockResolvedValue(null),
    getReferralFilleuls: vi.fn().mockResolvedValue({ filleuls: [] }),
    getPortfolio: vi.fn().mockResolvedValue({ portfolio_images: [] }),
    addPortfolioImage: vi.fn().mockResolvedValue({ portfolio_images: [] }),
    removePortfolioImage: vi.fn().mockResolvedValue({ portfolio_images: [] }),
  },
  reviewAPI: {
    getUserReviews: vi.fn().mockResolvedValue({ reviews: [] }),
  },
  workerProfileAPI: {
    get: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
  },
}));

// Section « Comptes de paiement » de la page : comptes vides, pas de réseau.
vi.mock('../../services/paymentAccountService', () => ({
  default: {
    getUserPaymentAccounts: vi.fn().mockResolvedValue({ success: true, data: { payment_accounts: {} } }),
    updatePaymentAccounts: vi.fn().mockResolvedValue({ success: true }),
  },
}));

// --- Imports réels (après les vi.mock, hoistés par Vitest) ---------------

import { LanguageProvider } from '../../contexts/LanguageContext';
import * as geolocationService from '../../services/geolocationService';
import Profile from '../Profile';

// Objet pays neutre exactement comme le renvoie detectUserCountry en échec.
const NEUTRAL_COUNTRY = Object.freeze({
  detected: false,
  code: '',
  name: 'Detected country',
  nameFrench: 'Pays détecté',
  flag: '🌍',
  phonePrefix: '',
  currency: 'XOF',
  language: 'fr',
});

const renderProfile = () =>
  render(
    <MemoryRouter>
      <LanguageProvider>
        <Profile />
      </LanguageProvider>
    </MemoryRouter>
  );

describe('Page Profil — détection IP en échec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Détection IP → échec (objet neutre). Détection téléphone → échec aussi
    // (numéro inconnu) : les deux gardes de la page sont exercées.
    vi.spyOn(geolocationService, 'detectUserCountry').mockResolvedValue({ ...NEUTRAL_COUNTRY });
    vi.spyOn(geolocationService, 'detectCountryFromPhone').mockReturnValue({ ...NEUTRAL_COUNTRY });
  });

  it('se rend sans crash quand la détection IP échoue (objet neutre, jamais null)', async () => {
    renderProfile();

    // La page finit de charger : section comptes de paiement + identité affichées.
    expect(await screen.findByText('Comptes de paiement')).toBeInTheDocument();
    expect(screen.getByText('Jean Dupont')).toBeInTheDocument();

    // La détection IP a bien été tentée au montage (et a échoué → neutre).
    expect(geolocationService.detectUserCountry).toHaveBeenCalled();

    // Aucune erreur affichée (l'ancien crash aurait fait planter le rendu).
    expect(screen.queryByText(/Erreur/i)).not.toBeInTheDocument();
  });

  it("n'applique aucun pays détecté : exemples de téléphone et banques par défaut", async () => {
    renderProfile();

    const section = await screen
      .findByText('Comptes de paiement')
      .then((el) => el.closest('.bg-white.rounded-lg.shadow-md'));
    fireEvent.click(within(section).getByRole('button', { name: 'Modifier' }));

    // Exemple de numéro : celui PAR DÉFAUT (Sénégal), pas celui d'un pays détecté.
    const omInput = screen.getByLabelText('Orange Money');
    expect(omInput).toHaveAttribute('placeholder', 'Ex: +221 70 12 34 56');

    // Aucun pays détecté (ex: Mali) n'a désactivé Wave.
    expect(screen.getByLabelText('Wave')).toBeInTheDocument();

    // Liste de banques : aucune liste pays appliquée, juste vide + « Autre banque ».
    const bankSelect = screen.getByLabelText(/Nom de la banque/);
    const options = Array.from(bankSelect.options).map((o) => o.textContent.trim());
    expect(options).toEqual(['Sélectionner une banque', 'Autre banque']);
  });

  it('affiche le sélecteur de pays avec le pays du profil, sans auto-sélection', async () => {
    renderProfile();

    await screen.findByText('Comptes de paiement');

    // Ouvrir le formulaire d'édition (section « Informations personnelles »).
    const personalSection = screen
      .getByText('Informations personnelles')
      .closest('.px-6.py-6.border-b.border-gray-200');
    fireEvent.click(within(personalSection).getByRole('button', { name: 'Modifier' }));

    // Le sélecteur de pays s'affiche (étiqueté « Pays » via le label associé)
    // et garde le pays du profil : Sénégal.
    const countrySelector = screen.getByLabelText('Pays');
    expect(countrySelector).toBeInTheDocument();
    expect(countrySelector.textContent).toContain('Sénégal');
    expect(document.querySelector('input[name="country"]')).toHaveValue('senegal');

    // Saisie d'un numéro non détectable (détection → neutre) : le pays n'est
    // PAS écrasé par un code vide — l'auto-sélection est bloquée par la garde.
    fireEvent.change(screen.getByLabelText('Téléphone'), { target: { value: '12345678' } });

    expect(countrySelector.textContent).toContain('Sénégal');
    expect(document.querySelector('input[name="country"]')).toHaveValue('senegal');
  });
});
