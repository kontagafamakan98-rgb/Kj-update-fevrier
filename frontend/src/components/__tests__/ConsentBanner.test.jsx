import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import ConsentBanner from '../ConsentBanner';
import {
  CONSENT_DENIED,
  CONSENT_GRANTED,
  CONSENT_STORAGE_KEY,
  readAnalyticsConsent,
} from '../../utils/consent';

// Le bandeau ne dépend que de deux choses : la configuration du fournisseur et
// la décision enregistrée. Les deux sont pilotées ici, pour ne pas dépendre des
// variables d'environnement du build de test.
//
// DEUX modules sont mockés, et c'est le point du 30/10/2026 : la CONFIGURATION
// se lit dans `utils/mesure-audience.js` (monté avec le shell) et l'INJECTION
// n'arrive que par `import()` au clic dans `utils/analytics.js`. Un seul mock
// sur l'ancien module unique ne verrait plus rien.
const etat = { configure: true, initAppele: 0 };

vi.mock('../../utils/mesure-audience', () => ({
  isAnalyticsConfigured: () => etat.configure,
}));

vi.mock('../../utils/analytics', () => ({
  initAnalytics: () => {
    etat.initAppele += 1;
  },
}));

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (cle) => cle, currentLanguage: 'fr' }),
}));

const monter = () =>
  render(
    <MemoryRouter>
      <ConsentBanner />
    </MemoryRouter>
  );

describe('ConsentBanner', () => {
  beforeEach(() => {
    etat.configure = true;
    etat.initAppele = 0;
    window.localStorage.clear();
  });

  it('sans fournisseur configuré : aucun bandeau (rien à demander)', () => {
    etat.configure = false;
    monter();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('fournisseur configuré et aucune décision : le bandeau s’affiche', () => {
    monter();
    expect(screen.getByRole('region', { name: 'cookiesConsentTitle' })).toBeTruthy();
  });

  it('« Accepter » enregistre l’accord et charge la mesure d’audience', async () => {
    monter();
    fireEvent.click(screen.getByRole('button', { name: 'cookiesConsentAccept' }));

    // La décision est enregistrée SYNCHRONEMENT (c'est elle qui fait foi) ;
    // l'injection, elle, arrive par `import()` — donc au tour suivant de la
    // boucle d'événements. Attendre son effet est le prix de l'avoir sortie du
    // JS initial, et ce cas le vérifie au lieu de le supposer.
    expect(readAnalyticsConsent()).toBe(CONSENT_GRANTED);
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe(CONSENT_GRANTED);
    await waitFor(() => expect(etat.initAppele).toBe(1));
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('« Refuser » enregistre le refus SANS charger la mesure d’audience', () => {
    monter();
    fireEvent.click(screen.getByRole('button', { name: 'cookiesConsentRefuse' }));

    expect(readAnalyticsConsent()).toBe(CONSENT_DENIED);
    expect(etat.initAppele).toBe(0);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('une décision déjà enregistrée masque le bandeau au chargement', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, CONSENT_DENIED);
    monter();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('les deux boutons ont le même dessin : aucun choix n’est mis en avant', () => {
    monter();
    const accepter = screen.getByRole('button', { name: 'cookiesConsentAccept' });
    const refuser = screen.getByRole('button', { name: 'cookiesConsentRefuse' });
    expect(accepter.className).toBe(refuser.className);
  });
});
