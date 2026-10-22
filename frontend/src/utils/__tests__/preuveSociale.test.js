/**
 * LA PREUVE SOCIALE NE S'INVENTE PAS — la règle de la bande de faits.
 *
 * Trois défauts sont verrouillés ici, chacun mesuré un jour :
 *   1. un compteur FABRIQUÉ (« 1 000+ travailleurs ») a été publié jusqu'au
 *      07/10/2026 dans le HTML pré-rendu : une mesure absente doit laisser le
 *      texte déclaré, jamais un repli chiffré ;
 *   2. un ZÉRO mesuré est une mesure : le taire serait un mensonge par omission
 *      (même doctrine que les taux d'arbitrage du backend) ;
 *   3. le séparateur de milliers appartient à la LANGUE (`Intl`), pas à une
 *      chaîne recopiée — « 1 250 » en français, « 1,250 » en anglais.
 */
import { describe, it, expect } from 'vitest';
import {
  MESURES_DE_PREUVE,
  nombreLisible,
  valeurDePreuve,
} from '../preuveSociale';

const TRAVAILLEURS = { labelKey: 'measuredWorkers', fallback: '—' };
const PAYS = { labelKey: 'countriesCovered', fallback: '4' };

describe('preuve sociale — la valeur affichée', () => {
  it('affiche la mesure formatée quand elle existe', () => {
    expect(valeurDePreuve(TRAVAILLEURS, { workers: 1250 }, 'fr')).toBe(nombreLisible(1250, 'fr'));
  });

  it('publie un ZÉRO mesuré : une mesure absente et un zéro ne se confondent pas', () => {
    expect(valeurDePreuve(TRAVAILLEURS, { workers: 0 }, 'fr')).toBe('0');
  });

  it('laisse le texte déclaré quand la mesure manque (pas de repli chiffré)', () => {
    for (const mesures of [null, undefined, {}, { workers: null }, { workers: '1250' }, { workers: NaN }]) {
      expect(valeurDePreuve(TRAVAILLEURS, mesures, 'fr')).toBe('—');
    }
  });

  it('une entrée qui n’est pas une mesure garde son texte déclaré', () => {
    expect(valeurDePreuve(PAYS, { workers: 10 }, 'fr')).toBe('4');
  });

  it('un labelKey sans champ associé ne lit rien dans la réponse', () => {
    expect(MESURES_DE_PREUVE.countriesCovered).toBeUndefined();
    expect(valeurDePreuve({ labelKey: 'measuredReviews', fallback: '—' }, { reviews: 3 }, 'en'))
      .toBe(nombreLisible(3, 'en'));
  });
});

describe('preuve sociale — le nombre et sa langue', () => {
  it('sépare les milliers selon la langue, pas selon une chaîne recopiée', () => {
    expect(nombreLisible(1250, 'fr')).not.toBe(nombreLisible(1250, 'en'));
    expect(nombreLisible(1250, 'en')).toBe('1,250');
  });

  it('formate dans les cinq langues du site', () => {
    for (const langue of ['fr', 'en', 'wo', 'bm', 'mos']) {
      expect(nombreLisible(42, langue), langue).toBe('42');
    }
  });

  it('une langue inconnue retombe sur le français au lieu de faire tomber la bande', () => {
    expect(nombreLisible(1250, 'zz-inconnu')).toBe(nombreLisible(1250, 'fr'));
  });

  it('refuse un non-nombre plutôt que d’afficher « NaN »', () => {
    for (const valeur of [null, undefined, NaN, Infinity, '12', {}, []]) {
      expect(nombreLisible(valeur, 'fr')).toBeNull();
    }
  });
});
