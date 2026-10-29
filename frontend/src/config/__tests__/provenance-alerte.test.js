/**
 * La provenance d'une alerte emploi — le vocabulaire transmis au serveur.
 *
 * Ces cas tiennent une chose : ce que le client s'autorise à DÉCLARER. Le
 * serveur refuse toute valeur hors liste (`ORIGINES_ALERTE` côté
 * `kojo_job_alerts`, 422), donc une valeur relayée telle quelle depuis une URL
 * mal recopiée empêcherait un travailleur de créer son alerte — le contraire
 * du service rendu. Elle retombe donc sur `directe`, qui est un fait mesuré
 * (arrivée sur `/jobs` sans page d'origine), et jamais sur `inconnue`, qui est
 * la colonne « on ne sait pas » du serveur.
 */
import { describe, expect, it } from 'vitest';

import {
  ORIGINE_PAR_DEFAUT,
  ORIGINES_ALERTE,
  origineDepuisURL,
} from '../provenance-alerte';

describe('provenance d’une alerte emploi', () => {
  it('déclare exactement les trois pages d’origine, sans valeur fourre-tout', () => {
    expect(ORIGINES_ALERTE).toEqual(['ville', 'metier', 'directe']);
    // `inconnue` est une valeur de DOCUMENT (client muet), pas une déclaration :
    // l'accepter ici la rendrait déclarable, donc vide de sens.
    expect(ORIGINES_ALERTE).not.toContain('inconnue');
    expect(ORIGINE_PAR_DEFAUT).toBe('directe');
  });

  it('transmet les deux origines qu’une page ville ou métier déclare', () => {
    expect(origineDepuisURL('ville')).toBe('ville');
    expect(origineDepuisURL('metier')).toBe('metier');
  });

  it('sans paramètre, déclare une arrivée directe sur /jobs', () => {
    expect(origineDepuisURL(null)).toBe('directe');
    expect(origineDepuisURL(undefined)).toBe('directe');
    expect(origineDepuisURL('')).toBe('directe');
  });

  it('ne relaie JAMAIS une valeur inconnue : elle retombe sur le défaut', () => {
    for (const brut of ['facebook', 'inconnue', 'VILLE2', 'ville;metier', '../../x']) {
      expect(origineDepuisURL(brut)).toBe('directe');
    }
  });

  it('accepte la casse et les espaces d’un lien recopié à la main', () => {
    expect(origineDepuisURL(' Ville ')).toBe('ville');
    expect(origineDepuisURL('METIER')).toBe('metier');
  });
});
