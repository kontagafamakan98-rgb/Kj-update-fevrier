import { describe, it, expect } from 'vitest';
import {
  getWorkerLevel,
  getWorkerLevelLabel,
  haversineKm,
  getJobCoordinates,
} from '../workerTrustLevel';

describe('getWorkerLevel', () => {
  it('classifie Expert : vérifié + note >= 4.5 + >= 10 avis', () => {
    expect(getWorkerLevel({ rating: 4.8, total_reviews: 12, is_verified: true }).rank).toBe(4);
    expect(getWorkerLevelLabel({ rating: 4.8, total_reviews: 12, is_verified: true })).toBe('Expert');
  });

  it('classifie Confirmé : vérifié + note >= 4.0 (peu d\'avis)', () => {
    expect(getWorkerLevel({ rating: 4.2, total_reviews: 3, is_verified: true }).rank).toBe(3);
  });

  it('classifie Fiable : note >= 3.5 sans vérification', () => {
    expect(getWorkerLevel({ rating: 3.8, total_reviews: 5, is_verified: false }).rank).toBe(2);
  });

  it('classifie Nouveau : pas d\'avis / note basse', () => {
    expect(getWorkerLevel({ rating: 0, total_reviews: 0, is_verified: false }).rank).toBe(1);
    expect(getWorkerLevel({}).rank).toBe(1);
  });

  it('gère les valeurs manquantes / non numériques', () => {
    expect(getWorkerLevel({ rating: '4.6', total_reviews: '11', is_verified: true }).rank).toBe(4);
    expect(getWorkerLevel({ rating: null, total_reviews: undefined }).rank).toBe(1);
  });
});

describe('haversineKm', () => {
  it('renvoie ~0 pour deux points identiques', () => {
    expect(haversineKm(14.7167, -17.4677, 14.7167, -17.4677)).toBeCloseTo(0, 5);
  });

  it('calcule une distance de l\'ordre de ~1050 km entre Dakar et Bamako', () => {
    const distance = haversineKm(14.7167, -17.4677, 12.6392, -8.0029);
    expect(distance).toBeGreaterThan(950);
    expect(distance).toBeLessThan(1150);
  });
});

describe('getJobCoordinates', () => {
  it('extrait les coordonnées de location', () => {
    expect(getJobCoordinates({ location: { latitude: 14.7, longitude: -17.4 } })).toEqual({
      latitude: 14.7,
      longitude: -17.4,
    });
  });

  it('retombe sur shared_location', () => {
    expect(getJobCoordinates({ location: {}, shared_location: { latitude: 13.0, longitude: -7.0 } })).toEqual({
      latitude: 13,
      longitude: -7,
    });
  });

  it('renvoie null sans coordonnées', () => {
    expect(getJobCoordinates({ location: { city: 'Dakar' } })).toBeNull();
    expect(getJobCoordinates({})).toBeNull();
  });
});
