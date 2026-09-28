import { test, expect } from '@playwright/test';
// Le protocole de la peinture « coquille » (bundle d'entrée bloqué) vient du
// harnais partagé, comme les deux tailles mesurées.
import { TAILLES, MARQUEUR_DE_MONTAGE, attendreLaStabilite, ouvrirLaPage } from './helpers/geometrie.js';
// Les attentes de CONDITION (et la durée qu'elles mesurent) : ce parcours
// n'attend plus un nombre de millisecondes, il attend un fait — c'est ce fait
// qui se publie, moteur par moteur.
import { attendreLeSilenceDesRequetes, surveillerLesRequetes } from './helpers/attentes.js';
// La PUBLICATION par moteur : ce fichier est rejoué sur Firefox et WebKit
// (voir playwright.config.js), et ce qu'il mesure alors n'est plus une
// curiosité — c'est l'écart entre moteurs, publié avec eux.
// La PUBLICATION par moteur : les écarts entre moteurs sont publiés une fois la
// suite finie (e2e/global-teardown-moteurs.js) — chaque projet a son propre
// processus de travail, donc un `afterAll` de fichier ne voit qu'un moteur.
import { publier } from './helpers/moteurs.js';
// LES DEUX URL ET LE LIBELLÉ VIENNENT DE LEURS PROPRIÉTAIRES : `contact.json`
// porte les adresses (et `contact.js` les dérive), `page-sections.js` la clé du
// contrôle, `fr.json` son texte. Aucune n'est recopiée ici — deux copies
// divergeraient en silence, et c'est exactement ce que cette sonde surveille.
import { CONTACT } from '../src/config/contact.js';
import { PAGE_SECTIONS } from '../src/config/page-sections.js';
// Node n'exécute plus un import JSON sans attribut de type, et c'est la
// convention du dépôt (voir src/config/contact.js).
import fr from '../src/i18n/fr.json' with { type: 'json' };

/**
 * LE PARCOURS DE LA CARTE DE L'ACCUEIL : aucun octet de carte tierce ne part
 * avant l'appui, et la carte intégrée apparaît à l'appui.
 *
 * ── Pourquoi en navigateur, alors qu'un test jsdom existe ──────────────────
 * `src/pages/__tests__/home-local-seo.test.jsx` vérifie déjà, en jsdom, qu'aucun
 * `iframe` n'est rendu avant l'appui et qu'il l'est après. Il ne peut pas voir
 * ce qui compte ici : **jsdom ne fait AUCUNE requête réseau**. Un composant qui
 * rendrait l'iframe en `display:none`, ou qui la monterait puis la retirerait,
 * ou qui poserait l'`src` d'une iframe cachée, passerait tous les gardes jsdom
 * pendant que le premier écran tirerait les ~300 Ko de l'embed. C'est le même
 * partage des rôles que partout ailleurs dans ce dépôt : jsdom pour le
 * COMPORTEMENT, Chromium pour le FAIT mesurable (ici : le réseau et la boîte
 * peinte).
 *
 * ── Les trois faits prouvés, par taille ───────────────────────────────────
 *   1. ZÉRO REQUÊTE DE CARTE avant l'appui : le journal des requêtes de la page
 *      est relu après stabilisation, et aucune URL ne correspond aux hôtes de
 *      carte tiers — vérifié DEUX fois, par le motif des hôtes ET par la marque
 *      `output=embed` de l'URL d'embed elle-même (`CONTACT.mapsEmbedUrl`), parce
 *      qu'un motif peut se tromper d'hôte alors que la marque, non ;
 *   2. LA CARTE APPARAÎT À L'APPUI : le contrôle devient une `iframe` dont
 *      l'`src` est EXACTEMENT `CONTACT.mapsEmbedUrl`, le document du cadre est
 *      réellement chargé (le contenu de la réponse interceptée est visible), et
 *      la requête tierce part à ce moment-là — pas avant ;
 *   3. LE BLOC NE BOUGE PAS en devenant une carte : la boîte du contrôle et
 *      celle de l'iframe ont la même taille et la même position (1 px de
 *      tolérance). C'est la garantie « hauteur réservée » que les deux canaux
 *      doivent au pixel, et c'est ce qui empêche l'appui de créer un décalage
 *      (la sonde CLS, `e2e/cls-coquille-react.spec.js`, le mesurerait).
 *
 * ── Ce qui est intercepté, et pourquoi ────────────────────────────────────
 * La requête vers Google Maps est REMPLACÉE (une réponse minimale de la sonde)
 * dès qu'elle part : ce qui est prouvé est qu'elle PART au bon moment, pas que
 * Google réponde — faire dépendre la CI d'un tiers rendrait le verdict
 * irreproductible (`scripts/lhci-cls-budgets.cjs` a la même règle pour le LCP).
 * Les requêtes d'AVANT l'appui, elles, ne sont jamais interceptées : elles
 * doivent rester visibles dans le journal, sinon la sonde se cacherait ce
 * qu'elle mesure.
 *
 * ── La coquille sans JavaScript, et ce qu'elle prouve ─────────────────────
 * Avec le bundle d'entrée BLOQUÉ (un visiteur sans JavaScript, un crawler, une
 * régie), le contrôle est publié quand même — c'est un VRAI lien vers la fiche
 * Google, qui fonctionne sans JavaScript. Le parcours vérifie qu'il est là, avec
 * la bonne destination, sans un octet de carte. Il n'appuie PAS : sans
 * JavaScript, l'appui mènerait légitimement sur la fiche Google (le lien fait
 * son travail), ce qui n'est pas la propriété mesurée ici.
 */

/** Le libellé du contrôle, lu au propriétaire du plan et du dictionnaire. */
const LIBELLE = fr[PAGE_SECTIONS['/contact'].mapButtonKey];
/** Le titre de l'iframe, construit comme la page le construit. */
const TITRE_CARTE = fr.mapIframeTitle.replace('{address}', CONTACT.address);

/**
 * Les hôtes d'une carte TIERCE. Le motif est large exprès (un sous-domaine
 * oublié ferait passer une requête) : ce qui le borne, c'est le second contrôle,
 * la marque `output=embed` de l'URL d'embed réelle.
 */
const CARTE_TIERS = /google\.com\/maps|maps\.googleapis\.com|googleusercontent\.com|(^|\.)openstreetmap\.org|tile\.openstreetmap/;

/** Le marqueur du document de carte servi par la sonde à la place du tiers. */
const REPONSE_CARTE = '<!doctype html><title>carte de test</title><p>carte de test</p>';

/**
 * La boîte d'un élément en coordonnées de DOCUMENT, pas de viewport.
 *
 * La distinction n'est pas cosmétique : `click()`/`tap()` amène l'élément dans
 * la vue (c'est ce qu'un doigt ferait), donc une mesure de viewport compare la
 * position d'AVANT (page non défilée, `y` ≈ 6 470 px sur l'accueil) à celle
 * d'APRÈS (page défilée sur la carte, `y` ≈ 229 px) : deux origines différentes,
 * un écart de 6 km de page, et un garde qui rougirait sur du vide. Mesuré, et
 * c'est ce qui a imposé cette forme.
 */
const BOITE_EN_DOCUMENT = (element) => {
  const r = element.getBoundingClientRect();
  return {
    gaucheDocument: r.left + window.scrollX,
    hautDocument: r.top + window.scrollY,
    largeur: r.width,
    hauteur: r.height,
  };
};

test.describe('Parcours E2E — la carte de l’accueil ne part qu’à l’appui', () => {
  for (const { nom: taille, viewport } of TAILLES) {
    // Le doigt et la souris ne produisent PAS la même séquence d'événements
    // (`tap()` envoie `pointerdown → touchstart → touchend → mousedown →
    // mouseup → click`) : sur un profil tactile, c'est l'appui tactile qui est
    // mesuré, pas un clic de souris qui n'existe pas sur un téléphone.
    const tactile = taille === 'mobile';

    test(`/ — ${taille} : aucun octet de carte avant l’appui, la carte s’ouvre à l’appui`, async ({ browser }) => {
      const page = await browser.newPage({ viewport, hasTouch: tactile, isMobile: tactile });
      // Le journal des requêtes sert DEUX fois : aux assertions (ses URL) et à
      // l'attente de CONDITION qui remplace l'ancienne attente fixe — la durée
      // de calme se lit sur l'instant de la dernière requête, pas sur une
      // horloge parallèle.
      const journal = surveillerLesRequetes(page);
      const requetes = journal.urls;
      try {
        await page.goto('/');
        await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });
        await attendreLaStabilite(page);
        // Le chargement doit être FINI : une iframe montée par un `useEffect`
        // tardif doit tomber dans cette fenêtre, sinon le parcours ne mesurerait
        // que les premières centaines de millisecondes. C'était un
        // `waitForTimeout(700)` : la fenêtre est maintenant un FAIT (plus aucune
        // requête nouvelle), donc elle s'élargit d'elle-même sur un moteur plus
        // lent au lieu de le faire échouer.
        const silence = await attendreLeSilenceDesRequetes(journal);
        expect(
          silence.silence,
          'la page n’a jamais cessé de demander ses ressources : le relevé d’avant l’appui porterait sur un ' +
            `chargement inachevé (${silence.requetes} requête(s) en ${silence.ms} ms)`
        ).toBe(true);

        // ── 1. Rien du tiers avant l'appui ───────────────────────────────
        expect(
          requetes.filter((url) => CARTE_TIERS.test(url)),
          `avant l’appui, une requête de carte tierce est PARTIE :\n` +
            requetes
              .filter((url) => CARTE_TIERS.test(url))
              .map((url) => `      ${url}`)
              .join('\n') +
            '\n      Une iframe montée en `loading="lazy"` tire dès qu’elle approche du viewport — et sur desktop elle y est déjà.'
        ).toEqual([]);
        expect(
          requetes.filter((url) => url.includes('output=embed')),
          'avant l’appui, l’URL d’EMBED elle-même a été demandée (le motif des hôtes aurait pu se tromper d’hôte, cette marque-là non).'
        ).toEqual([]);
        expect(
          await page.locator('iframe').count(),
          'avant l’appui, un `<iframe>` existe dans la page : le premier écran tirerait le tiers.'
        ).toBe(0);
        // Un journal de requêtes vide ne prouverait rien : la page doit avoir
        // demandé ses propres ressources.
        expect(
          requetes.length,
          'aucune requête journalisée : le contrôle ne lit rien (la page n’aurait pas chargé).'
        ).toBeGreaterThan(0);

        // ── Le contrôle publié, et sa boîte réservée ──────────────────────
        const controle = page.getByRole('link', { name: LIBELLE, exact: true });
        await expect(
          controle,
          `le contrôle de carte « ${LIBELLE} » n’est pas publié (ou la page n’est pas rendue en français : ` +
            'la sonde lit son libellé dans fr.json).'
        ).toHaveCount(1);
        expect(await controle.getAttribute('href')).toBe(CONTACT.mapsUrl);
        const cadre = controle.locator('xpath=..');
        const boiteAvant = await cadre.evaluate(BOITE_EN_DOCUMENT);
        expect(boiteAvant.hauteur, 'le contrôle n’a pas de hauteur : il n’est pas peint').toBeGreaterThan(0);

        // ── 2. L'appui monte la carte ─────────────────────────────────────
        // Le tiers est remplacé À PARTIR D'ICI seulement : ce qui est prouvé est
        // que la requête part à l'appui, pas que Google réponde.
        let requetesDeCarte = 0;
        await page.route(CARTE_TIERS, async (route) => {
          requetesDeCarte += 1;
          await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: REPONSE_CARTE });
        });

        // ── 2 bis. Le GESTE est chronométré : c'est cette durée qui se compare
        // d'un moteur à l'autre (un moteur qui préchargerait l'iframe la
        // ramènerait près de zéro, et c'est justement ce qu'on refuse).
        const debutDuGeste = Date.now();
        if (tactile) await controle.tap();
        else await controle.click();

        const carte = page.locator('iframe');
        await expect(carte, 'la carte n’est pas montée à l’appui').toHaveCount(1);
        const delaiDuGeste = Date.now() - debutDuGeste;
        expect(
          await carte.getAttribute('src'),
          'la carte montée n’est pas l’embed attendu'
        ).toBe(CONTACT.mapsEmbedUrl);
        expect(await carte.getAttribute('title'), 'l’iframe n’a pas le titre du dictionnaire').toBe(TITRE_CARTE);
        // Le document du cadre est RÉELLEMENT chargé : une iframe vide ne
        // prouverait rien de plus qu’un `<iframe>` dans l’arbre.
        await expect(
          page.frameLocator('iframe').getByText('carte de test'),
          'le document de la carte n’a pas chargé (la requête n’est pas partie, ou la réponse n’est pas arrivée)'
        ).toBeVisible();
        expect(
          requetesDeCarte,
          'aucune requête vers le tiers n’est partie à l’appui : la carte ne charge pas'
        ).toBeGreaterThanOrEqual(1);
        await expect(
          page.getByRole('link', { name: LIBELLE, exact: true }),
          'le contrôle est encore là après l’appui : la bascule n’a pas eu lieu'
        ).toHaveCount(0);

        // ── 3. Le bloc n'a pas bougé ──────────────────────────────────────
        const boiteApres = await carte.evaluate(BOITE_EN_DOCUMENT);
        expect(boiteApres.hauteur, 'la carte n’a pas de hauteur : elle n’est pas peinte').toBeGreaterThan(0);
        for (const [nom, avant, apres] of [
          ['largeur', boiteAvant.largeur, boiteApres.largeur],
          ['hauteur', boiteAvant.hauteur, boiteApres.hauteur],
          ['position verticale', boiteAvant.hautDocument, boiteApres.hautDocument],
        ]) {
          expect(
            Math.abs(avant - apres),
            `à l’appui, la ${nom} du bloc change (${avant.toFixed(1)} → ${apres.toFixed(1)} px) : la hauteur ` +
              'réservée par les deux canaux n’est plus la même, et l’appui crée un décalage.'
          ).toBeLessThanOrEqual(1);
        }

        // Publié MOTEUR PAR MOTEUR : les cinq chiffres que ce parcours mesure,
        // et dont deux se comparent (le délai du geste, la boîte peinte).
        publier(test, `/ ${taille} — requêtes avant l’appui`, requetes.length);
        publier(test, `/ ${taille} — requêtes de carte avant l’appui`, 0);
        publier(test, `/ ${taille} — ${tactile ? 'appui' : 'clic'} → carte montée`, delaiDuGeste, 'ms');
        publier(test, `/ ${taille} — largeur de la carte`, Math.round(boiteApres.largeur), 'px');
        publier(test, `/ ${taille} — écart de position du bloc`, +Math.abs(boiteAvant.hautDocument - boiteApres.hautDocument).toFixed(2), 'px');
      } finally {
        await page.close();
      }
    });

    test(`/ — ${taille} (coquille, JavaScript bloqué) : le contrôle est publié sans un octet de carte`, async ({ browser }) => {
      const page = await ouvrirLaPage(browser, 'coquille', viewport);
      const journal = surveillerLesRequetes(page);
      const requetes = journal.urls;
      try {
        await page.goto('/');
        await attendreLeSilenceDesRequetes(journal);

        expect(
          requetes.filter((url) => CARTE_TIERS.test(url) || url.includes('output=embed')),
          'la COQUILLE pré-rendue demande déjà une ressource de carte : un crawler (ou une régie) paierait ces ' +
            'octets dans le premier écran, avant même React.'
        ).toEqual([]);
        expect(await page.locator('iframe').count(), 'la coquille publie un `<iframe>` de carte').toBe(0);

        // Le contrôle est publié par la coquille elle-même, avec la vraie
        // destination : c'est ce qui le rend utile SANS JavaScript (le lien
        // s'ouvre sur la fiche Google).
        const controle = page.getByRole('link', { name: LIBELLE, exact: true });
        await expect(controle, `la coquille ne publie pas le contrôle « ${LIBELLE} »`).toHaveCount(1);
        expect(await controle.getAttribute('href')).toBe(CONTACT.mapsUrl);

        publier(test, `/ ${taille} (coquille) — requêtes au total`, requetes.length);
        publier(test, `/ ${taille} (coquille) — requêtes de carte`, 0);
      } finally {
        await page.close();
      }
    });
  }
});
