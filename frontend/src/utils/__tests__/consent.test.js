import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONSENT_DENIED,
  CONSENT_GRANTED,
  CONSENT_STORAGE_KEY,
  hasAnalyticsConsent,
  readAnalyticsConsent,
  writeAnalyticsConsent,
} from '../consent';

describe('consentement à la mesure d’audience', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('aucune décision enregistrée → aucun consentement (jamais par défaut)', () => {
    expect(readAnalyticsConsent()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it('un accord explicite est mémorisé et vaut consentement', () => {
    expect(writeAnalyticsConsent(CONSENT_GRANTED)).toBe(CONSENT_GRANTED);
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe(CONSENT_GRANTED);
    expect(hasAnalyticsConsent()).toBe(true);
  });

  it('un refus est mémorisé et ne vaut PAS consentement', () => {
    writeAnalyticsConsent(CONSENT_DENIED);
    expect(readAnalyticsConsent()).toBe(CONSENT_DENIED);
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it('une valeur inconnue ne vaut pas un accord', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'oui-va-y');
    expect(readAnalyticsConsent()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it('toute valeur autre que « granted » est enregistrée comme refus', () => {
    expect(writeAnalyticsConsent('peut-être')).toBe(CONSENT_DENIED);
    expect(readAnalyticsConsent()).toBe(CONSENT_DENIED);
  });

  it('un stockage qui lève est traité comme « aucune décision », sans propager', () => {
    const espion = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('stockage indisponible');
    });
    expect(readAnalyticsConsent()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
    espion.mockRestore();
  });
});
