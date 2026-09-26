import { test, expect } from '@playwright/test';
// Le protocole à deux peintures (bundle d'entrée BLOQUÉ pour la coquille, page
// neuve à chaque relevé) et la liste des routes appartiennent au harnais
// partagé : la table unique `src/config/page-meta.js` en est la source.
import {
  ROUTES,
  TAILLES,
  MARQUEUR_DE_MONTAGE,
  attendreLaStabilite,
  gelerLePremierRendu,
  ouvrirLaPage,
} from './helpers/geometrie.js';
import { INVENTAIRE_PEINT, comparerTextes } from './helpers/texte-coquille.js';
import { shellFileFor } from '../scripts/site-meta.js';

/**
 * LA sonde de CONTENU : sans JavaScript, chaque coquille pré-rendue publie-t-elle
 * mot pour mot ce que React affiche — au même endroit ?
 *
 * ── Ce qu'elle mesure, et le trou qu'elle ferme ─────────────────────────────
 * Le bundle d'entrée est bloqué : React ne monte jamais, la page est celle que
 * lit un visiteur sans JavaScript, un crawler, une régie publicitaire — et
 * c'est aussi la peinture que le navigateur garde quand React reconstruit à
 * l'identique (l'égalité de géométrie que `e2e/lcp-geometrie.spec.js` mesure).
 * Ce que ces deux sondes ne jugeaient pas : le CONTENU. Un texte peint par la
 * coquille et absent chez React y était compté, publié dans le journal, et
 * laissé là (« divergence de CONTENU, couverte par le garde de provenance ») —
 * un garde qui lit le HTML du build, donc une CHAÎNE, pas une page peinte.
 * Entre les deux, une coquille peut publier une phrase que personne ne lit.
 *
 * ── La règle, en une phrase ────────────────────────────────────────────────
 * Tout texte VERBAL peint par la coquille doit se retrouver, DANS LA MÊME ZONE
 * (le corps `main` ou le chrome partagé) : dans la même BANDE verticale pour le
 * corps (dont la géométrie est stable), dans l'ORDRE des mots pour le chrome
 * (dont la hauteur dépend de celle du corps, donc du contenu asynchrone —
 * mesuré sur /jobs, cf. `helpers/texte-coquille.js`). Mêmes mots, dans l'ordre,
 * phrase entière (jamais un mot isolé). Tout GLYPHE publié (emoji, puce, flèche)
 * doit avoir un
 * pendant peint par React dans la même bande — texte identique si React en peint
 * un, SVG ou image sinon (les deux canaux n'ont pas le même vocabulaire de
 * glyphes, mais ils en peignent au même endroit). Les raisons, le cas des
 * chiffres de l'accueil et les écarts déclarés sont dans
 * `helpers/texte-coquille.js` : cette sonde exécute le harnais, elle ne
 * redéclare rien.
 *
 * ── Anti-faux-vert ─────────────────────────────────────────────────────────
 * Un test qui ne compare rien passerait : les VOLUMES comparés sont publiés et
 * PLANCHERÉS, zone par zone, et les routes dont le premier rendu REDIRIGE (page
 * protégée : /payment) sont NOMMÉES dans le journal, jamais comptées comme un
 * vert. Les écarts déclarés sont vérifiés DANS LES DEUX SENS : utilisés (sinon
 * ils sont périmés) et adossés à une contrepartie réellement peinte par React.
 */

/**
 * Les planchers de comparaison, par zone. Mesurés le 25/09/2026 sur les 11
 * routes pré-rendues (412×823 et 1350×940) : le corps le plus pauvre est celui
 * de /jobs (5 textes, 35 mots — la coquille d'une page dont React peint le
 * reste par-dessus), et le chrome en publie 9 textes pour 21 mots sur CHAQUE
 * route (adresse, téléphone, courriel, WhatsApp, itinéraire, trois liens
 * légaux : même pied de page partout, publié une fois par `app-chrome.js`).
 * Les planchers sont posés SOUS ces minima : ils attrapent une coquille vidée
 * ou un inventaire en panne, pas une retouche de contenu.
 */
const PLANCHERS = {
  'corps main': { items: 4, mots: 25 },
  chrome: { items: 6, mots: 8 },
};

test.describe('Parcours E2E — sans JavaScript, chaque coquille publie mot pour mot ce que React affiche', () => {
  // PAS de mode `serial` : un garde doit nommer TOUTES les routes en défaut en
  // un passage.
  for (const route of ROUTES) {
    for (const { nom: taille, viewport } of TAILLES) {
      test(`${route} — ${taille}`, async ({ browser }) => {
        // ── 1. La coquille SEULE : bundle d'entrée bloqué ────────────────
        const pageCoquille = await ouvrirLaPage(browser, 'coquille', viewport);
        let coquille;
        try {
          await pageCoquille.goto(route);
          await pageCoquille.waitForTimeout(200);
          coquille = await pageCoquille.evaluate(INVENTAIRE_PEINT);
        } finally {
          await pageCoquille.close();
        }

        // ── 2. La même route, peinte par le PREMIER rendu de React ───────
        const pageReact = await ouvrirLaPage(browser, 'reelle', viewport);
        let react;
        try {
          await gelerLePremierRendu(pageReact);
          await pageReact.goto(route);
          await pageReact.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });
          await attendreLaStabilite(pageReact);
          react = await pageReact.evaluate(INVENTAIRE_PEINT);
        } finally {
          await pageReact.close();
        }

        // ── Une route PROTÉGÉE n'a pas de contenu à comparer ─────────────
        if (react.url !== coquille.url) {
          console.log(
            `⏭️  Texte ${route} (${taille}) : le premier rendu de React quitte la route ` +
              `(${coquille.url} → ${react.url}) — contenu non comparable (page protégée).`
          );
          return;
        }

        const { manquants, glyphesSansPendant, glyphesDivergents, etatEcarts, ecartsPerimes, mesures } =
          comparerTextes({ route, coquille, react });

        // ── Les MOTS : la phrase entière, dans la bande et dans la zone ──
        expect(
          manquants,
          `${route} (${taille}) : ${manquants.length} texte(s) publié(s) par la coquille ` +
            `(${shellFileFor(route)}, JavaScript bloqué) que React ne peint pas mot pour mot au même endroit.\n` +
            manquants.map((texte) => `      ${texte}`).join('\n') +
            '\n      Corriger la COQUILLE ou la page : le texte d’une section a UN propriétaire ' +
            '(src/config/page-sections.js, vite-plugins/prerender/app-chrome.js), lu par les deux canaux.'
        ).toEqual([]);

        // ── Les GLYPHES : un pendant peint, et le même si c'est du texte ──
        expect(
          glyphesSansPendant,
          `${route} (${taille}) : ${glyphesSansPendant.length} glyphe(s) publié(s) par la coquille sans ` +
            `aucun glyphe peint par React dans la même bande.\n` +
            glyphesSansPendant.map((texte) => `      ${texte}`).join('\n')
        ).toEqual([]);
        expect(
          glyphesDivergents,
          `${route} (${taille}) : ${glyphesDivergents.length} glyphe(s) publié(s) par la coquille alors que React ` +
            `peint un AUTRE glyphe textuel au même endroit.\n` +
            glyphesDivergents.map((texte) => `      ${texte}`).join('\n')
        ).toEqual([]);

        // ── Les écarts déclarés : utilisés, et vérifiés ──────────────────
        expect(
          ecartsPerimes.map((ecart) => ecart.texte),
          `${route} (${taille}) : écart(s) DÉCLARÉ(s) dans helpers/texte-coquille.js que cette route n’utilise ` +
            'plus, ou dont la contrepartie n’est plus peinte par React — les retirer de ECARTS_DECLARES ' +
            '(une exception qu’on n’ose plus retirer est une exception qui mente).'
        ).toEqual([]);

        // ── Anti-faux-vert : ce qui a été comparé, avec ses planchers ────
        for (const [zone, plancher] of Object.entries(PLANCHERS)) {
          const volume = mesures.zones[zone];
          expect(
            volume,
            `${route} (${taille}) : la zone « ${zone} » est absente de l’inventaire — le contrôle ne peut rien ` +
              'comparer là (zone disparue, ou inventaire en panne).'
          ).toBeTruthy();
          expect(
            volume.items,
            `${route} (${taille}) : ${volume.items} texte(s) seulement dans la zone « ${zone} » — sous le plancher ` +
              `de ${plancher.items} (un contrôle qui ne lit presque rien ne prouve rien).`
          ).toBeGreaterThanOrEqual(plancher.items);
          expect(
            volume.mots,
            `${route} (${taille}) : ${volume.mots} mot(s) seulement dans la zone « ${zone} » — sous le plancher ` +
              `de ${plancher.mots}.`
          ).toBeGreaterThanOrEqual(plancher.mots);
        }

        // ── Le chrome ne publie aucun GLYPHE ─────────────────────────────
        // Mesuré : 0 sur les 11 routes (le pied de page est fait de texte).
        // Vérifié ici plutôt que supposé : un glyphe dans le chrome est un cas
        // que la règle du corps ne couvre pas (elle exige une bande) — le jour
        // où il apparaîtra, il faudra décider sa règle (l'ignorer en silence
        // serait le laisser passer sans juge).
        expect(
          mesures.zones.chrome.glyphes,
          `${route} (${taille}) : la coquille publie ${mesures.zones.chrome.glyphes} glyphe(s) dans le CHROME, ` +
            'que la règle du corps ne compare pas (elle exige une bande, et le chrome se compare dans l’ordre) — ' +
            'décider sa règle dans helpers/texte-coquille.js.'
        ).toBe(0);

        const ecartsUtilises = etatEcarts.filter((ecart) => ecart.utilise);
        const zones = Object.entries(mesures.zones)
          .map(
            ([zone, volume]) =>
              `${zone} ${volume.items} texte(s) / ${volume.mots} mot(s) face à ${volume.itemsReact} / ${volume.motsReact}`
          )
          .join(' · ');
        console.log(
          `ℹ️  Texte ${route} (${taille}) : ${mesures.glyphes} glyphe(s) publié(s) avec pendant peint ` +
            `(React : ${mesures.svgReact} SVG, ${mesures.imgReact} image(s)) — ${zones}` +
            (ecartsUtilises.length
              ? ` — ${ecartsUtilises.length} écart(s) déclaré(s) vérifié(s) : ${ecartsUtilises
                  .map((ecart) => `« ${ecart.texte} » (donnée de /public/stats contre repli statique)`)
                  .join(', ')}`
              : '')
        );
      });
    }
  }
});
