import { test } from '@playwright/test';
// Le protocole et les deux tailles viennent du harnais partagé, comme la page
// « coquille » (bundle d'entrée bloqué).
import { TAILLES, ouvrirLaPage } from './helpers/geometrie.js';
// LE PARCOURS LUI-MÊME EST PARTAGÉ : un seul protocole, rejoué sur chaque route
// qui publie la façade (`ROUTES_A_FACADE`). La copie par route est ce que ce
// dépôt refuse — elle divergerait au premier correctif.
import {
  COMPTES_DE_LA_FIXTURE,
  ROUTES_A_CARTE_DIFFEREE,
  ROUTES_A_FACADE,
  verifierLaCarteDifferee,
  verifierLaFacadeDeCarte,
  verifierLaFacadeEnCoquille,
} from './helpers/parcours-carte.js';

/**
 * PARCOURS E2E — LA FAÇADE DE CARTE NE PART QU'À L'APPUI.
 *
 * Chaque route qui publie la façade (`MapEmbed` : / et /contact) est parcourue
 * DEUX fois par taille — la peinture RÉELLE de React, puis la COQUILLE
 * pré-rendue sans JavaScript — soit 2 routes × 2 tailles × 2 peintures = 8 cas.
 *
 * Les quatre faits prouvés (zéro requête de carte AVANT l'appui, y compris la
 * façade DANS le viewport ; la façade réellement à l'écran quand on le mesure ;
 * la carte montée à l'appui ; le bloc qui ne bouge pas) sont décrits, avec ce
 * qu'ils ne peuvent pas voir, dans `helpers/parcours-carte.js` — leur seul
 * propriétaire.
 *
 * ── La SECONDE mécanique du dépôt : la carte DIFFÉRÉE ────────────────────────
 * `/profile` ne publie pas de façade mais une carte qui se monte quand son bloc
 * entre dans le viewport. Elle a son propre `describe` plus bas, et son propre
 * protocole dans le même harnais, parce que la question n'est pas la même :
 * « rien tant que personne n'a appuyé » d'un côté, « rien tant que le bloc est
 * hors de l'écran, la carte dès qu'il y entre » de l'autre. La route est
 * PROTÉGÉE : le parcours se connecte d'abord (compte de la fixture d'API).
 */
test.describe('Parcours E2E — la façade de carte ne part qu’à l’appui', () => {
  for (const route of ROUTES_A_FACADE) {
    for (const { nom: taille, viewport } of TAILLES) {
      // Le doigt et la souris ne produisent PAS la même séquence d'événements
      // (`tap()` envoie `pointerdown → touchstart → touchend → mousedown →
      // mouseup → click`) : sur un profil tactile, c'est l'appui tactile qui
      // est mesuré, pas un clic de souris qui n'existe pas sur un téléphone.
      const tactile = taille === 'mobile';

      test(`${route} — ${taille} : aucun octet de carte avant l’appui, la carte s’ouvre à l’appui`, async ({
        browser,
      }) => {
        const page = await browser.newPage({ viewport, hasTouch: tactile, isMobile: tactile });
        const requetes = [];
        page.on('request', (requete) => requetes.push(requete.url()));
        try {
          await verifierLaFacadeDeCarte(page, requetes, { route, taille, tactile });
        } finally {
          await page.close();
        }
      });

      test(`${route} — ${taille} (coquille, JavaScript bloqué) : le contrôle est publié sans un octet de carte`, async ({
        browser,
      }) => {
        const page = await ouvrirLaPage(browser, 'coquille', viewport);
        const requetes = [];
        page.on('request', (requete) => requetes.push(requete.url()));
        try {
          await verifierLaFacadeEnCoquille(page, requetes, { route, taille });
        } finally {
          await page.close();
        }
      });
    }
  }
});

/**
 * PARCOURS E2E — LA CARTE DIFFÉRÉE NE PART QU'UNE FOIS À L'ÉCRAN.
 *
 * `/profile` (2 tailles × 2 comptes = 4 cas) : la carte du pays déclaré reste
 * hors du viewport au chargement — donc AUCUNE requête tierce —, le repli est
 * publié et mène à la même carte, puis le bloc amené dans la vue SE MONTE
 * (iframe dont l'`src` est celui que la page calcule, document réellement
 * chargé, boîte inchangée). Les DEUX comptes de la fixture sont parcourus : la
 * page d'un CLIENT est plus courte que celle d'un travailleur, et c'est
 * exactement ce que le placement doit supporter — c'est le compte client qui a
 * révélé, le 27/09/2026, qu'un bloc jugé « hors de l'écran » à la fin du
 * chargement pouvait être transitoirement dedans (voir l'en-tête de
 * `DeferredMap.js`).
 *
 * Pas de cas « coquille » ici, et ce n'est pas un oubli : `/profile` est une
 * route PROTÉGÉE, absente de `src/config/page-meta.js`, donc sans HTML
 * pré-rendu à mesurer — un crawler n'y voit rien du tout, ce qui est la
 * propriété (pas de page privée dans le HTML publié).
 */
test.describe('Parcours E2E — la carte différée ne part qu’une fois à l’écran', () => {
  for (const route of ROUTES_A_CARTE_DIFFEREE) {
    for (const { nom: taille, viewport } of TAILLES) {
      for (const compte of COMPTES_DE_LA_FIXTURE) {
        test(`${route} — ${taille} (${compte.nom}) : aucune requête de carte hors du viewport, la carte se monte dedans`, async ({
          browser,
        }) => {
          const page = await browser.newPage({ viewport });
          const requetes = [];
          page.on('request', (requete) => requetes.push(requete.url()));
          try {
            await verifierLaCarteDifferee(page, requetes, { route, taille, compte });
          } finally {
            await page.close();
          }
        });
      }
    }
  }
});
