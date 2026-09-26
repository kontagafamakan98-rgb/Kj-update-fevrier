import { test, expect } from '@playwright/test';
import {
  ROUTES,
  TAILLES,
  MARQUEUR_DE_MONTAGE,
  attendreLaStabilite,
  comparerGeometrie,
  gelerLePremierRendu,
  ouvrirLaPage,
  RELEVE_GEOMETRIE,
} from './helpers/geometrie.js';

/**
 * LA garde de géométrie : pour chaque route pré-rendue et chaque taille, la
 * coquille et le premier rendu de React doivent poser les MÊMES textes aux
 * MÊMES endroits, avec le même alignement CALCULÉ et la même navbar.
 *
 * ── Pourquoi ce garde existe ────────────────────────────────────────────────
 * La garantie « la coquille gagne » tient à une ÉGALITÉ de géométrie : la
 * coquille peint avant le JavaScript, `createRoot()` efface `#root`, React
 * reconstruit la même page — et Chrome ne ré-élit un élément LCP que pour une
 * aire STRICTEMENT plus grande. Un remplacement plus grand, ou décalé, fait
 * entrer toute la chaîne JavaScript dans le graphe LCP simulé de Lantern.
 * C'était jusqu'ici prouvé par des mesures d'atelier, route par route (le
 * `.App { text-align: center }` hérité, les 65 px de navbar, les relevés de
 * /jobs et /contact) : une preuve qu'il fallait refaire à la main, donc qu'on
 * pouvait oublier de refaire. Ce parcours la rend AUTOMATIQUE et GÉNÉRALE, et
 * il a immédiatement trouvé ce qu'aucune mesure ponctuelle n'avait vu (voir le
 * journal de la dernière exécution : le pied de page absent des dix coquilles
 * qui ne l'avaient jamais publié, le `border-t` manquant à la section contact
 * de l'accueil, la bascule liste/carte absente de /jobs en mobile, cinq
 * commandes publiées en `<div>` alors que React les rend en `<button>`).
 *
 * ── Ce qui est comparé ─────────────────────────────────────────────────────
 *   1. l'ENCRE de chaque nœud de texte visible (un rectangle par ligne), et
 *      non la boîte de l'élément qui le porte : un `<div>` qui centre son texte
 *      et un `<span>` dans un `<button>` peignent la même encre avec des boîtes
 *      différentes (mesuré sur /login : 380×38 contre 68×30 pour le même texte
 *      au même pixel) ;
 *   2. le `text-align` CALCULÉ de son porteur — propriété à part entière depuis la
 *      refonte du 25/09/2026 (le site est aligné à gauche, chaque bloc centré le
 *      déclare), et le canal par lequel la centure par héritage déplaçait les
 *      bornes d'encre de l'élément LCP de /jobs avant qu'elle ne soit retirée ;
 *   3. la hauteur de la navbar (64 px au lieu de 65 = 1 px de décalage pour
 *      tout le contenu au montage).
 *
 * ── Le protocole ───────────────────────────────────────────────────────────
 * Deux navigations, sur des pages NEUVES : (1) « coquille », le bundle
 * d'entrée bloqué — React ne monte jamais ; (2) « réelle », avec le PREMIER
 * rendu figé (`gelerLePremierRendu` fige la géolocalisation, seul état
 * asynchrone qui déplace le haut de page) et une attente de stabilisation.
 *
 * ── Anti-faux-vert ─────────────────────────────────────────────────────────
 * Un test qui ne compare RIEN passerait : le nombre de textes effectivement
 * comparés est compté, publié et PLANCHERÉ, et le premier texte peint par la
 * coquille dans `main` (son en-tête de page, quel qu'il soit — jamais recopié)
 * doit faire partie des textes comparés. Les routes dont le premier rendu
 * REDIRIGE (page protégée) n'ont pas de peinture à comparer : elles sont
 * nommées dans le journal, jamais comptées comme un vert.
 */
test.describe('Garde de géométrie — la coquille et React peignent les mêmes textes', () => {
  // PAS de mode `serial` : un garde doit nommer TOUTES les routes en défaut en
  // un passage (le mode série s'arrête au premier échec, donc on corrige une
  // route, on relance, et on découvre la suivante).
  for (const route of ROUTES) {
    for (const { nom: taille, viewport } of TAILLES) {
      test(`${route} — ${taille}`, async ({ browser }) => {
        // ── 1. La coquille SEULE (bundle d'entrée bloqué) ────────────────
        const pageCoquille = await ouvrirLaPage(browser, 'coquille', viewport);
        let coquille;
        try {
          await pageCoquille.goto(route);
          await pageCoquille.waitForTimeout(200);
          coquille = await pageCoquille.evaluate(RELEVE_GEOMETRIE);
        } finally {
          await pageCoquille.close();
        }

        // ── 2. La même route, peinte par le PREMIER rendu de React ───────
        const pageReact = await ouvrirLaPage(browser, 'reelle', viewport);
        let react;
        try {
          await gelerLePremierRendu(pageReact);
          await pageReact.goto(route);
          // La navbar de l'app (avec ses liens) ne peut exister QUE si React a
          // monté : le chrome des coquilles publie une navbar vide.
          await pageReact.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });
          await attendreLaStabilite(pageReact);
          react = await pageReact.evaluate(RELEVE_GEOMETRIE);
        } finally {
          await pageReact.close();
        }

        // ── Une route PROTÉGÉE n'a pas de premier rendu à comparer ───────
        // ProtectedRoute redirige vers /login : comparer la coquille de
        // /payment à la peinture de /login n'aurait aucun sens. On le dit, on
        // ne le compte pas comme un vert.
        if (react.url !== coquille.url) {
          console.log(
            `⏭️  Géométrie ${route} (${taille}) : le premier rendu de React quitte la route ` +
              `(${coquille.url} → ${react.url}) — aucune peinture à comparer ` +
              '(page protégée : le visiteur est redirigé).'
          );
          return;
        }

        // ── L'ANCRE : le premier texte peint par la coquille dans `main` ──
        // Lu dans la coquille elle-même (donc jamais recopié ici, et
        // indépendant du nom des clés du plan) : quel que soit l'en-tête de la
        // page, il doit exister des deux côtés, sinon le garde ne prouve pas
        // que la coquille publie l'élément que le LCP élit.
        const premier = Object.entries(coquille.textes)
          .flatMap(([texte, instances]) => instances.map((instance) => ({ texte, instance })))
          .sort((a, b) => a.instance.boite[1] - b.instance.boite[1] || a.instance.boite[0] - b.instance.boite[0])[0];
        expect(
          premier,
          `${route} (${taille}) : la coquille ne peint AUCUN texte — le garde ne prouverait rien`
        ).toBeTruthy();
        expect(
          Object.keys(react.textes),
          `${route} (${taille}) : React ne peint pas le premier texte de la coquille ` +
            `« ${premier.texte} » — le garde ne prouverait rien`
        ).toContain(premier.texte);

        const {
          divergences,
          compares,
          absents,
          exemplesAbsents,
          horsZone,
          exemplesHorsZone,
          frontiere,
          texteFrontiere,
        } = comparerGeometrie(coquille, react);
        expect(
          divergences,
          `${route} (${taille}) : la coquille et React ne peignent pas la même géométrie ` +
            `(${compares} texte(s) comparé(s)) — corriger la GÉOMÉTRIE, pas le repaint : les classes ` +
            'doivent avoir un propriétaire lu par les deux canaux (src/config/page-sections.js, ' +
            'vite-plugins/prerender/app-chrome.js).'
        ).toEqual([]);
        // Un garde qui ne compare rien est un garde aveugle (règle du dépôt).
        expect(
          compares,
          `${route} (${taille}) : ${compares} texte(s) comparé(s) seulement — la géométrie n'a pas été vérifiée`
        ).toBeGreaterThanOrEqual(3);

        console.log(
          `ℹ️  Géométrie ${route} (${taille}) : ${compares} texte(s) peints au même endroit ` +
            `(encre + text-align), navbar ${react.hauteurNavbar} px des deux côtés` +
            (absents
              ? ` — ${absents} texte(s) de la coquille que React ne peint pas dans cet état ` +
                `(${exemplesAbsents.map((t) => `« ${t.slice(0, 24)} »`).join(', ')} — divergence de CONTENU, ` +
                'jugée mot pour mot par e2e/texte-coquille-react.spec.js)'
              : '') +
            (horsZone
              ? ` — ${horsZone} texte(s) NON comparés au-delà de la frontière de contenu : React peint ` +
                `« ${String(texteFrontiere).slice(0, 40)} » en y=${frontiere}, que la coquille ne peint pas ` +
                `(la hauteur de ce bloc lui est inconnue) ; exemples de textes sautés : ${exemplesHorsZone
                  .map((t) => `« ${t.slice(0, 20)} »`)
                  .join(', ')})`
              : '')
        );
      });
    }
  }
});
