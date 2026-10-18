import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
const etat = { configure: true, initAppele: 0 };

vi.mock('../../utils/analytics', () => ({
  isAnalyticsConfigured: () => etat.configure,
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

  it('« Accepter » enregistre l’accord et charge la mesure d’audience', () => {
    monter();
    fireEvent.click(screen.getByRole('button', { name: 'cookiesConsentAccept' }));

    expect(readAnalyticsConsent()).toBe(CONSENT_GRANTED);
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe(CONSENT_GRANTED);
    expect(etat.initAppele).toBe(1);
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
