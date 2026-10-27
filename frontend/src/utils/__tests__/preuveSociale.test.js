/**
 * LA PREUVE SOCIALE DE L'ACCUEIL : un seuil, un état d'attente, jamais un zéro.
 *
 * ── La classe de défaut que ce fichier ferme ───────────────────────────────
 * Le 26/10/2026, l'accueil publiait « 0 mission terminée · 0 avis » : le
 * compteur BRUT de `GET /api/public/stats`. Retirer les compteurs a corrigé le
 * mensonge mais a laissé la bande sans aucune preuve de ce que la plateforme a
 * fait. `utils/preuveSociale.js` rétablit la preuve à l'envers : un chiffre
 * n'est publié que s'il PROUVE quelque chose, et en dessous du seuil la page
 * publie l'état d'attente.
 *
 * ── Ce que ces cas mesurent ────────────────────────────────────────────────
 *   • les deux seuils sont NÉCESSAIRES : trois missions sans deux avis ne
 *     publient rien, deux avis sans trois missions non plus ;
 *   • zéro n'est JAMAIS un état « mesure » — c'est le défaut du 26/10, et il
 *     reviendrait par n'importe quelle régression de comparaison (`<=` au lieu
 *     de `<`, un seuil à 0, un `parseInt` oublié) ;
 *   • une valeur ILLISIBLE (absente, chaîne, `NaN`, négative, flottante) reste
 *     en attente et ne devient pas un zéro : une panne ne se lit pas comme une
 *     mesure ;
 *   • le séparateur de milliers appartient à la LANGUE, par `Intl`.
 *
 * Ce que ce fichier ne prouve pas : le RENDU de la ligne (les trois états sont
 * jugés dans `pages/__tests__/home-local-seo.test.jsx`) ni ce que la coquille
 * pré-rendue peint (`scripts/check-prerender-shells.js`).
 */
import { describe, it, expect } from 'vitest';
import {
  ETAT_ATTENTE,
  ETAT_MESURE,
  SEUIL_AVIS,
  SEUIL_MISSIONS_TERMINEES,
  formaterCompteur,
  preuvesDeLAccueil,
} from '../preuveSociale';

/** Une réponse d'API au-dessus des deux seuils. */
const AU_DESSUS = {
  completed_jobs: SEUIL_MISSIONS_TERMINEES,
  reviews: SEUIL_AVIS,
};

describe('preuve sociale — ce qui se publie, et ce qui attend', () => {
  it('les seuils sont DÉCLARÉS ici, et le pluriel est toujours juste', () => {
    // Un seuil n'est pas un réglage : il dit ce qu'on accepte d'appeler une
    // preuve. Il est donc verrouillé, avec sa raison.
    expect(SEUIL_MISSIONS_TERMINEES).toBe(3);
    expect(SEUIL_AVIS).toBe(2);
    // Les deux valeurs valent 2 ou plus : la phrase publiée est toujours au
    // PLURIEL, dans les cinq langues, et aucune forme singulière n'est à
    // écrire ni à traduire.
    expect(SEUIL_MISSIONS_TERMINEES).toBeGreaterThanOrEqual(2);
    expect(SEUIL_AVIS).toBeGreaterThanOrEqual(2);
  });

  it('aux seuils exactement, la mesure est publiable', () => {
    expect(preuvesDeLAccueil(AU_DESSUS)).toEqual({
      etat: ETAT_MESURE,
      missions: SEUIL_MISSIONS_TERMINEES,
      avis: SEUIL_AVIS,
    });
  });

  it('les DEUX seuils sont nécessaires : un seul franchi ne publie rien', () => {
    // Trois missions terminées mais un seul avis : le fait existe, la preuve
    // d'avis n'existe pas encore.
    expect(
      preuvesDeLAccueil({ completed_jobs: 40, reviews: SEUIL_AVIS - 1 }).etat
    ).toBe(ETAT_ATTENTE);
    // Deux avis mais deux missions terminées : le volume n'est pas encore là.
    expect(
      preuvesDeLAccueil({ completed_jobs: SEUIL_MISSIONS_TERMINEES - 1, reviews: 12 }).etat
    ).toBe(ETAT_ATTENTE);
  });

  it('un ZÉRO n’est jamais une mesure — c’est le défaut du 26/10/2026', () => {
    for (const stats of [
      { completed_jobs: 0, reviews: 0 },
      { completed_jobs: 0, reviews: 40 },
      { completed_jobs: 40, reviews: 0 },
    ]) {
      const verdict = preuvesDeLAccueil(stats);
      expect(
        verdict.etat,
        `« ${JSON.stringify(stats)} » a été jugé publiable : deux zéros alignés ` +
          'ne mesurent pas la plateforme, ils la décrivent comme vide'
      ).toBe(ETAT_ATTENTE);
    }
  });

  it('une lecture ILLISIBLE reste en attente, elle ne devient pas un zéro', () => {
    const illisibles = [
      undefined,
      null,
      {},
      { completed_jobs: 5 },
      { reviews: 5 },
      { completed_jobs: '5', reviews: 5 },
      { completed_jobs: NaN, reviews: 5 },
      { completed_jobs: -3, reviews: 5 },
      { completed_jobs: 5.5, reviews: 5 },
      'Erreur de connexion',
    ];

    for (const stats of illisibles) {
      const verdict = preuvesDeLAccueil(stats);
      expect(verdict.etat, `« ${JSON.stringify(stats)} » a été publié`).toBe(ETAT_ATTENTE);
      // Aucune valeur n'est FABRIQUÉE : ce qui n'a pas été lu reste `null` (le
      // rendu n'a alors rien à afficher), et un entier lu reste celui qu'on a
      // lu — jamais un zéro par défaut, jamais un `parseInt` qui aurait
      // transformé « 5 » en 5.
      const lu = (champ) =>
        Number.isInteger(stats?.[champ]) && stats[champ] >= 0 ? stats[champ] : null;
      expect(verdict.missions, `compteur retenu pour « ${JSON.stringify(stats)} »`).toBe(
        lu('completed_jobs')
      );
      expect(verdict.avis).toBe(lu('reviews'));
    }
  });

  it('sous le seuil, les compteurs LUS restent disponibles pour le diagnostic', () => {
    // Le fait est mesuré, il n'est simplement pas publié : c'est ce qui permet
    // de distinguer « pas encore de preuve » de « pas de lecture du tout ».
    expect(preuvesDeLAccueil({ completed_jobs: 2, reviews: 7 })).toEqual({
      etat: ETAT_ATTENTE,
      missions: 2,
      avis: 7,
    });
  });

  it('le séparateur de milliers appartient à la LANGUE, et jamais au code', () => {
    // `Intl` groupe selon les usages : le français met une espace insécable
    // fine, l'anglais une virgule. Une constante recopiée ici se tromperait
    // dans quatre langues sur cinq.
    expect(formaterCompteur(1234, 'fr')).not.toBe('1234');
    expect(formaterCompteur(1234, 'fr').replace(/\s/g, ' ')).toBe('1 234');
    expect(formaterCompteur(1234, 'en')).toBe('1,234');
    // Une valeur qui n'est pas un compteur n'est pas formatée en douce : elle
    // est rendue telle quelle (le rendu, lui, ne l'appelle jamais).
    expect(formaterCompteur(-1, 'fr')).toBe('-1');
    expect(formaterCompteur(2.5, 'fr')).toBe('2.5');
  });
});
