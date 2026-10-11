import { test, expect } from '@playwright/test';
import { ROUTES, TAILLES } from './helpers/geometrie.js';
import {
  CAPTURE_CLASSES,
  DIVERGENCES_DECLAREES,
  MARQUEUR_DE_MONTAGE,
  apparier,
  attendreLaStabilite,
  classesDivergentes,
  declareeDivergence,
  estApplicable,
  estDeclaree,
  gelerLePremierRendu,
  nommerBoite,
  ouvrirLaPage,
} from './helpers/classes-calculees.js';
import { CLASSES_PROPRES_AUX_COQUILLES } from '../scripts/classes-coquilles.js';

/**
 * Plancher anti-faux-vert : une route dont l'appariement ne retrouve presque
 * aucun élément ne prouve rien (un lecteur cassé rendrait zéro paire, et le
 * test passerait sur une liste vide). Relevé du 09/10/2026 sur les 24 cas : le
 * plus petit appariement est /jobs (13 paires, la liste des missions étant
 * asynchrone), puis /forgot-password, /privacy, /terms (38 à 39). Le plancher
 * est donc 10 : assez bas pour ne pas rougir sur une page sobre, assez haut pour
 * qu'un lecteur cassé (quelques paires au hasard) ne passe pas.
 */
const MIN_PAIRES_PAR_ROUTE = 10;

/**
 * LA sonde de classes calculées : pour chaque route pré-rendue et chaque taille,
 * les éléments rendus qui occupent la même boîte dans la coquille et chez React
 * doivent porter les mêmes classes. Une divergence non déclarée rougit, et son
 * nom donne la paire (balise, boîte, classes de chaque côté, classes propres).
 *
 * Le protocole est celui de `geometrie-coquille-react.spec.js` : coquille avec le
 * bundle bloqué, puis React au premier rendu figé. Une route protégée qui
 * redirige n'a pas de peinture à comparer : elle est nommée, jamais comptée
 * comme un vert.
 */
test.describe('Sonde de classes calculées — la coquille et React portent les mêmes classes', () => {
  for (const route of ROUTES) {
    for (const { nom: taille, viewport } of TAILLES) {
      test(`${route} — ${taille}`, async ({ browser }) => {
        // ── 1. La coquille SEULE ─────────────────────────────────────────
        const pageCoquille = await ouvrirLaPage(browser, 'coquille', viewport);
        let coquille;
        let urlCoquille;
        try {
          await pageCoquille.goto(route);
          await attendreLaStabilite(pageCoquille);
          coquille = await pageCoquille.evaluate(CAPTURE_CLASSES);
          urlCoquille = await pageCoquille.evaluate(() => location.pathname);
        } finally {
          await pageCoquille.close();
        }

        // ── 2. La même route, peinte par le PREMIER rendu de React ───────
        const pageReact = await ouvrirLaPage(browser, 'reelle', viewport);
        let react;
        let urlReact;
        try {
          await gelerLePremierRendu(pageReact);
          await pageReact.goto(route);
          await pageReact.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });
          await attendreLaStabilite(pageReact);
          react = await pageReact.evaluate(CAPTURE_CLASSES);
          urlReact = await pageReact.evaluate(() => location.pathname);
        } finally {
          await pageReact.close();
        }

        if (urlReact !== urlCoquille) {
          console.log(
            `⏭️  Classes ${route} (${taille}) : le premier rendu de React quitte la route ` +
              `(${urlCoquille} → ${urlReact}) — aucune peinture à comparer (page protégée).`
          );
          return;
        }

        const { paires, nonAppariesCoquille, nonAppariesReact } = apparier(coquille, react);
        // Anti-faux-vert : sans assez de paires, la comparaison ne dit rien.
        expect(
          paires.length,
          `${route} (${taille}) : ${paires.length} élément(s) apparié(s) seulement — la comparaison ne prouve rien`
        ).toBeGreaterThanOrEqual(MIN_PAIRES_PAR_ROUTE);

        // ── Les divergences : propres (déclarées par le garde statique), déclarées
        // ici (même boîte, contrepartie peinte), ou NON DÉCLARÉES (le rouge).
        const divergentes = classesDivergentes(paires);
        const declareesUtilisees = new Set();
        const nonDeclarees = [];
        let propres = 0;
        for (const d of divergentes) {
          if (estDeclaree(d.coquille, CLASSES_PROPRES_AUX_COQUILLES)) {
            propres += 1;
            continue;
          }
          const entree = declareeDivergence(d, route, react);
          if (entree) {
            declareesUtilisees.add(entree);
            continue;
          }
          nonDeclarees.push(d);
        }
        // Un écart déclaré pour cette route qui n'apparaît plus rougit : une
        // exception qu'on n'ose plus retirer est une exception qui ment.
        const perimees = DIVERGENCES_DECLAREES.filter(
          (entree) => estApplicable(entree, route) && !declareesUtilisees.has(entree)
        ).map((entree) => entree.motif);
        expect(
          perimees,
          `${route} (${taille}) : écart(s) DÉCLARÉ(S) absent(s) de cette route — la déclaration est périmée`
        ).toEqual([]);

        const nommer = (d) =>
          `<${d.tag}> ${nommerBoite(d.boite)} : coquille « ${d.coquille.join(' ')} » ≠ React « ${d.react.join(' ')} »` +
          (d.seulementCoquille.length ? ` ; seulement coquille : ${d.seulementCoquille.join(' ')}` : '') +
          (d.seulementReact.length ? ` ; seulement React : ${d.seulementReact.join(' ')}` : '');

        expect(
          nonDeclarees.map(nommer),
          `${route} (${taille}) : ${nonDeclarees.length} paire(s) d'éléments dont les classes diffèrent ` +
            '(corriger le PROPRIÉTAIRE de la classe — src/config/* lu par les deux canaux — pas le repaint).'
        ).toEqual([]);

        console.log(
          `ℹ️  Classes ${route} (${taille}) : ${paires.length} élément(s) apparié(s), ` +
            `${nonAppariesCoquille} non apparié(s) côté coquille, ${nonAppariesReact} côté React, ` +
            `${divergentes.length} paire(s) divergente(s) : ${propres} propre(s) à la coquille, ` +
            `${declareesUtilisees.size} entrée(s) déclarée(s) utilisée(s), ${nonDeclarees.length} NON déclarée(s).`
        );
      });
    }
  }
});
