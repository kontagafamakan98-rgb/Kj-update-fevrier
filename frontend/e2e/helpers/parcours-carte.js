/**
 * LE PARCOURS DE LA FAÇADE DE CARTE — un seul protocole, réutilisé par CHAQUE
 * route qui publie la façade (`MapEmbed`).
 *
 * ── Pourquoi un harnais partagé, et pas une copie par route ─────────────────
 * La propriété mesurée ne dépend PAS de la route : « aucun octet de carte
 * tierce ne part tant que le visiteur n'a pas appuyé sur la façade — MÊME une
 * fois la façade DANS le viewport ; la carte apparaît à l'appui, à la place
 * exacte du contrôle ». Une copie par route divergerait au premier correctif
 * (règle du dépôt : un seul propriétaire par mesure). Toutes les constantes
 * viennent donc d'ici — le libellé et le titre du dictionnaire, les URL de
 * `src/config/contact.js`, la géométrie de `src/config/page-sections.js` — et
 * aucune n'est recopiée dans un cas.
 *
 * ── Pourquoi en navigateur, alors qu'un test jsdom existe ──────────────────
 * `src/pages/__tests__/home-local-seo.test.jsx` et `Contact.test.jsx`
 * vérifient déjà, en jsdom, qu'aucun `<iframe>` n'est rendu avant l'appui et
 * qu'il l'est après. Mais jsdom ne fait AUCUNE requête réseau : un composant
 * qui rendrait l'iframe en `display:none`, qui la monterait puis la retirerait,
 * ou qui poserait l'`src` d'une iframe cachée passerait tous ces gardes pendant
 * que le premier écran tirerait les ~300 Ko de l'embed. Même partage des rôles
 * que partout ici : jsdom pour le COMPORTEMENT, Chromium pour le FAIT mesurable
 * (ici le réseau et la boîte peinte).
 *
 * ── Les quatre faits prouvés, par route et par taille ──────────────────────
 *   1. ZÉRO REQUÊTE DE CARTE AVANT L'APPUI, Y COMPRIS LA FAÇADE DANS LE
 *      VIEWPORT : le journal des requêtes est relu DEUX fois — juste après le
 *      montage, puis APRÈS avoir amené la façade dans la vue et attendu que la
 *      mise en page se stabilise. C'est le fait qui distingue une façade d'une
 *      `<iframe loading="lazy">` : le navigateur charge une iframe dès qu'elle
 *      approche du viewport, et sur desktop elle y est déjà. Vérifié DEUX fois
 *      (motif des hôtes tiers ET marque `output=embed`), parce qu'un motif peut
 *      se tromper d'hôte alors que la marque, non ; plus « aucun `<iframe>`
 *      dans la page » et un plancher sur le journal (un journal vide ne
 *      prouverait rien) ;
 *   2. LA FAÇADE EST RÉELLEMENT DANS LE VIEWPORT quand le point (1) est relu :
 *      sa boîte recouvre la fenêtre — sans quoi « aucune requête » serait vrai
 *      pour la MAUVAISE raison (un bloc jamais amené à l'écran) ;
 *   3. LA CARTE APPARAÎT À L'APPUI : le contrôle devient une `iframe` dont
 *      l'`src` est EXACTEMENT `CONTACT.mapsEmbedUrl`, le document du cadre est
 *      réellement chargé (le contenu de la réponse interceptée est visible), et
 *      la requête tierce part à ce moment-là ;
 *   4. LE BLOC NE BOUGE PAS en devenant une carte (largeur, hauteur, `y` de
 *      document identiques à 1 px) : la garantie « hauteur réservée » des deux
 *      canaux, celle qui empêche l'appui de créer un décalage.
 *
 * ── Ce qui est intercepté, et pourquoi ────────────────────────────────────
 * La requête vers Google Maps est REMPLACÉE (une réponse minimale de la sonde)
 * À PARTIR DE L'APPUI seulement : ce qui est prouvé est qu'elle PART au bon
 * moment, pas que Google réponde — faire dépendre la CI d'un tiers rendrait le
 * verdict irreproductible. Les requêtes d'AVANT l'appui ne sont JAMAIS
 * interceptées : elles doivent rester visibles dans le journal, sinon la sonde
 * se cacherait ce qu'elle mesure.
 */
import { expect } from '@playwright/test';
// LES URL VIENNENT DE LEUR PROPRIÉTAIRE : `contact.json` porte les adresses, et
// `page-sections.js` la déclaration de la façade (classes, libellé, glyphe).
// Aucune n'est recopiée ici — deux copies divergeraient en silence.
import { CONTACT } from '../../src/config/contact.js';
import { PAGE_SECTIONS } from '../../src/config/page-sections.js';
// La carte DIFFÉRÉE de /profile : le parcours demande l'URL attendue À LA
// FONCTION QUE LA PAGE APPELLE (`countryMapFor`), il ne recopie aucun cadrage —
// une seconde table de bornes divergerait du jour où la base géographique bouge.
import { countryMapFor } from '../../src/utils/countryMap.js';
// Node n'exécute plus un import JSON sans attribut de type (convention du dépôt).
import fr from '../../src/i18n/fr.json' with { type: 'json' };
import { MARQUEUR_DE_MONTAGE, attendreLaStabilite } from './geometrie.js';
// Les attentes de CONDITION : le silence du journal des requêtes remplace les
// deux `waitForTimeout(N)` qui espéraient « le chargement est fini ».
import { attendreLeSilenceDesRequetes } from './attentes.js';

/** Le libellé du contrôle, lu au propriétaire du plan et au dictionnaire. */
export const LIBELLE = fr[PAGE_SECTIONS['/contact'].mapButtonKey];
/** Le titre de l'iframe montée à l'appui, construit comme les pages le construisent. */
export const TITRE_CARTE = fr.mapIframeTitle.replace('{address}', CONTACT.address);

/**
 * Les hôtes d'une carte TIERCE. Le motif est large exprès (un sous-domaine
 * oublié ferait passer une requête) : ce qui le borne, c'est le second contrôle,
 * la marque `output=embed` de l'URL d'embed réelle.
 */
export const CARTE_TIERS =
  /google\.com\/maps|maps\.googleapis\.com|googleusercontent\.com|(^|\.)openstreetmap\.org|tile\.openstreetmap/;

/** Le marqueur du document de carte servi par la sonde à la place du tiers. */
export const REPONSE_CARTE = '<!doctype html><title>carte de test</title><p>carte de test</p>';

/**
 * La boîte d'un élément en coordonnées de DOCUMENT, pas de viewport.
 *
 * La distinction n'est pas cosmétique : `click()`/`tap()` amène l'élément dans
 * la vue (c'est ce qu'un doigt ferait), donc une mesure de viewport compare la
 * position d'AVANT (page non défilée) à celle d'APRÈS (page défilée sur la
 * carte) : deux origines différentes, et un garde qui rougirait sur du vide.
 * Mesuré, et c'est ce qui a imposé cette forme.
 */
export const BOITE_EN_DOCUMENT = (element) => {
  const r = element.getBoundingClientRect();
  return {
    gaucheDocument: r.left + window.scrollX,
    hautDocument: r.top + window.scrollY,
    largeur: r.width,
    hauteur: r.height,
  };
};

/**
 * La boîte de l'élément recouvre-t-elle la fenêtre ? C'est la condition qui
 * donne son sens à « aucune requête de carte AVANT l'appui » : un bloc hors de
 * l'écran ne prouverait rien, puisque même une `loading="lazy"` n'aurait rien
 * chargé. Le contrôle est réellement à l'écran quand son rectangle intersecte
 * la fenêtre sur les DEUX axes.
 */
export const EST_DANS_LE_VIEWPORT = (element) => {
  const r = element.getBoundingClientRect();
  return (
    r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth
  );
};

/**
 * LES ROUTES QUI PUBLIENT LA FAÇADE (`MapEmbed`) — et ce sont les SEULES.
 *
 * La déclaration de la façade a UN propriétaire (`PAGE_SECTIONS['/contact']`,
 * que `/` relit), mais le composant qui la rend est `MapEmbed` : deux pages
 * seulement l'importent, `src/pages/Home.js` et `src/pages/Contact.js`. Cette
 * liste est donc la carte des routes à parcourir, pas une préférence — une page
 * qui cesserait d'importer `MapEmbed` ferait rougir le cas de sa route (le
 * contrôle n'existe plus), et une page qui l'importerait sans être ici devrait
 * y être ajoutée.
 *
 * `/profile` n'y est PAS, et ce n'est pas la même mécanique : elle ne publie
 * aucune FAÇADE mais une CARTE DIFFÉRÉE (`DeferredMap`) — pas d'appui, l'iframe
 * est montée quand le bloc entre dans le viewport. Cette propriété-là a son
 * propre parcours plus bas (`verifierLaCarteDifferee`), parce qu'elle pose une
 * question différente : « rien tant que le bloc est hors de l'écran, et la carte
 * dès qu'il y entre » au lieu de « rien tant que personne n'a appuyé ».
 */
export const ROUTES_A_FACADE = ['/', '/contact'];

/**
 * LA SEULE ROUTE À CARTE DIFFÉRÉE, et la dépendance qui va avec : `/profile`
 * est une route PROTÉGÉE (`src/App.js` la garde derrière une session), donc son
 * parcours doit d'abord se connecter. Le compte vient de la fixture d'API
 * (`scripts/playtest-api-server.mjs`) — le même que tous les parcours qui
 * traversent une session (`e2e/appuis-exterieurs.spec.js`, `e2e/notifications.spec.js`).
 */
export const ROUTES_A_CARTE_DIFFEREE = ['/profile'];

/** Le compte de la fixture, et le PAYS qu'elle déclare (son `country`). */
export const MOT_DE_PASSE_DE_LA_FIXTURE = 'password';

/**
 * Les DEUX comptes de la fixture, et pourquoi les deux sont parcourus.
 *
 * Le PROFIL a une longueur qui dépend du compte : un travailleur porte ses
 * sections professionnelles, un client non. Le bloc de carte est placé SOUS la
 * ligne de flottaison dans les deux cas, et ce n'est pas une évidence de
 * placement mais une propriété MESURÉE : c'est le compte CLIENT qui l'a fait
 * tomber le 27/09/2026 — sur desktop, la page faisait 1 608 px au montage (bloc
 * visible à `top=859` dans une fenêtre de 940) puis 1 975 px après le rendu
 * asynchrone du panneau de paiement, laissant le bloc à `top=1 226`, HORS de
 * l'écran. Un seul compte n'aurait jamais montré ça.
 */
export const COMPTES_DE_LA_FIXTURE = [
  { nom: 'travailleur', email: 'demo@example.com' },
  { nom: 'client', email: 'client@example.com' },
];

/** Le pays que la fixture déclare aux DEUX comptes (`scripts/playtest-api-server.mjs`). */
export const PAYS_DE_LA_FIXTURE = 'senegal';

/**
 * La carte que /profile DOIT charger : demandée à la fonction de la page.
 *
 * `null` ferait échouer le parcours AVANT toute assertion utile (il n'y aurait
 * pas de bloc à observer) — c'est donc une garde de lecture, pas un cas de test.
 */
export const CARTE_DU_PROFIL = countryMapFor(PAYS_DE_LA_FIXTURE);

/**
 * Se connecte avec le compte de la fixture et attend le tableau de bord.
 *
 * L'attente porte sur l'URL et pas sur un délai : la redirection est ce qui
 * PROUVE que la session a été posée, et un parcours qui continuerait sans elle
 * mesurerait l'écran de connexion.
 */
export async function connexionALaFixture(page, email = COMPTES_DE_LA_FIXTURE[0].email) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(MOT_DE_PASSE_DE_LA_FIXTURE);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 15000 });
}

/** Les requêtes de carte TIERCE présentes dans le journal. */
const requetesDeCarte = (requetes) => requetes.filter((url) => CARTE_TIERS.test(url));
/** Les requêtes qui portent la marque de l'embed, indépendamment de l'hôte. */
const requetesDEmbed = (requetes) => requetes.filter((url) => url.includes('output=embed'));

/** Le rappel d'échec du point (1), réutilisé aux deux relectures du journal. */
function refuserTouteCarte(requetes, quand) {
  expect(
    requetesDeCarte(requetes),
    `carte : une requête de carte tierce est PARTIE ${quand} :\n` +
      requetesDeCarte(requetes)
        .map((url) => `      ${url}`)
        .join('\n') +
      '\n      Une iframe montée en `loading="lazy"` tire dès qu’elle approche du viewport — et sur desktop elle y est déjà.'
  ).toEqual([]);
  expect(
    requetesDEmbed(requetes),
    `carte : l’URL d’EMBED elle-même a été demandée ${quand} (le motif des hôtes aurait pu se tromper d’hôte, cette marque-là non).`
  ).toEqual([]);
}

/**
 * Le parcours sur la peinture RÉELLE (React monté) : charger, prouver l'absence
 * de requête de carte (au chargement PUIS façade dans le viewport), appuyer,
 * prouver la carte.
 *
 * @param {import('@playwright/test').Page} page Page neuve où l'on a DÉJÀ posé
 *   l'écouteur `page.on('request', …)` remplissant `requetes`.
 * @param {string[]} requetes Le journal des requêtes de la page (mutable).
 * @param {{ route: string, taille: string, tactile: boolean }} options
 * @returns {Promise<void>} Les assertions d'échec sont portées par `expect`.
 */
export async function verifierLaFacadeDeCarte(page, requetes, { route, taille, tactile }) {
  const etiquette = `${route} (${taille}, ${tactile ? 'appui tactile' : 'clic'})`;

  await page.goto(route);
  await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });
  await attendreLaStabilite(page);
  // Le chargement doit être FINI : une iframe montée par un `useEffect` tardif
  // doit tomber dans cette fenêtre, sinon le parcours ne mesurerait que les
  // premières centaines de millisecondes. La condition porte sur le JOURNAL que
  // le verdict utilise (silence des requêtes, plafonné), jamais sur une horloge.
  await attendreLeSilenceDesRequetes(() => requetes.length);

  // ── 1a. Rien du tiers AU CHARGEMENT ─────────────────────────────────────
  refuserTouteCarte(requetes, 'AU CHARGEMENT');
  expect(
    await page.locator('iframe').count(),
    'au chargement, un `<iframe>` existe dans la page : le premier écran tirerait le tiers.'
  ).toBe(0);
  // Un journal vide ne prouverait rien : la page doit avoir demandé ses propres
  // ressources.
  expect(
    requetes.length,
    'aucune requête journalisée : le contrôle ne lit rien (la page n’aurait pas chargé).'
  ).toBeGreaterThan(0);

  // ── Le contrôle publié, et sa boîte réservée ──────────────────────────────
  const controle = page.getByRole('link', { name: LIBELLE, exact: true });
  await expect(
    controle,
    `le contrôle de carte « ${LIBELLE} » n’est pas publié sur ${route} (ou la page n’est pas rendue en ` +
      'français : la sonde lit son libellé dans fr.json).'
  ).toHaveCount(1);
  expect(await controle.getAttribute('href')).toBe(CONTACT.mapsUrl);
  const cadre = controle.locator('xpath=..');
  const boiteAuChargement = await cadre.evaluate(BOITE_EN_DOCUMENT);
  expect(boiteAuChargement.hauteur, 'le contrôle n’a pas de hauteur : il n’est pas peint').toBeGreaterThan(0);

  // ── 1b. LA FAÇADE DANS LE VIEWPORT, TOUJOURS RIEN ──────────────────────
  // On amène le bloc dans la vue COMME le ferait le visiteur qui appuie dessus :
  // c'est le seul moyen d'affirmer « aucune requête tant que la façade est à
  // l'écran, sans appui ». Une `loading="lazy"` tirerait ici.
  await cadre.scrollIntoViewIfNeeded();
  await attendreLaStabilite(page);
  expect(
    await controle.evaluate(EST_DANS_LE_VIEWPORT),
    `la façade n’a pas pu être amenée dans le viewport sur ${route} : « aucune requête » ne prouverait ` +
      'alors rien (même une `loading="lazy"` n’aurait rien chargé).'
  ).toBe(true);
  refuserTouteCarte(requetes, 'FAÇADE DANS LE VIEWPORT (sans appui)');
  expect(
    await page.locator('iframe').count(),
    'façade dans le viewport, un `<iframe>` existe sans appui : le premier écran tirerait le tiers.'
  ).toBe(0);
  const boiteAvant = await cadre.evaluate(BOITE_EN_DOCUMENT);
  expect(boiteAvant.hauteur, 'le contrôle n’a pas de hauteur : il n’est pas peint').toBeGreaterThan(0);

  // ── 2. L'appui monte la carte ─────────────────────────────────────────────
  // Le tiers est remplacé À PARTIR D'ICI seulement : ce qui est prouvé est que
  // la requête part à l'appui, pas que Google réponde.
  let appelsAuTiers = 0;
  await page.route(CARTE_TIERS, async (routeInterceptee) => {
    appelsAuTiers += 1;
    await routeInterceptee.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: REPONSE_CARTE });
  });

  if (tactile) await controle.tap();
  else await controle.click();

  const carte = page.locator('iframe');
  await expect(carte, 'la carte n’est pas montée à l’appui').toHaveCount(1);
  expect(await carte.getAttribute('src'), 'la carte montée n’est pas l’embed attendu').toBe(CONTACT.mapsEmbedUrl);
  expect(await carte.getAttribute('title'), 'l’iframe n’a pas le titre du dictionnaire').toBe(TITRE_CARTE);
  // Le document du cadre est RÉELLEMENT chargé : une iframe vide ne prouverait
  // rien de plus qu'un `<iframe>` dans l'arbre.
  await expect(
    page.frameLocator('iframe').getByText('carte de test'),
    'le document de la carte n’a pas chargé (la requête n’est pas partie, ou la réponse n’est pas arrivée)'
  ).toBeVisible();
  expect(appelsAuTiers, 'aucune requête vers le tiers n’est partie à l’appui : la carte ne charge pas').toBeGreaterThanOrEqual(1);
  await expect(
    page.getByRole('link', { name: LIBELLE, exact: true }),
    'le contrôle est encore là après l’appui : la bascule n’a pas eu lieu'
  ).toHaveCount(0);

  // ── 4. Le bloc n'a pas bougé ──────────────────────────────────────────────
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

  console.log(
    `ℹ️  Carte ${etiquette} : ${requetes.length} requête(s) avant l’appui, 0 de carte (relu deux fois : au ` +
      `chargement, puis façade DANS le viewport) ; à l’appui, iframe ` +
      `${boiteApres.largeur.toFixed(0)}×${boiteApres.hauteur.toFixed(0)} px au document y=${boiteApres.hautDocument.toFixed(1)} — ` +
      `identique au contrôle (${boiteAvant.largeur.toFixed(0)}×${boiteAvant.hauteur.toFixed(0)} à y=${boiteAvant.hautDocument.toFixed(1)}) · ` +
      `${appelsAuTiers} requête(s) de carte partie(s) après l’appui · dérive amener-la-dans-la-vue (constantes de ` +
      `src/App.css contre les polices de cet hôte — publié, pas jugé) : ` +
      `${(boiteAvant.hautDocument - boiteAuChargement.hautDocument).toFixed(1)} px`
  );
}

/**
 * Le parcours sur la COQUILLE pré-rendue (bundle d'entrée bloqué) : le contrôle
 * est publié SANS un octet de carte, avec sa vraie destination.
 *
 * Il n'appuie PAS : sans JavaScript, l'appui mènerait légitimement sur la fiche
 * Google (le lien fait son travail), ce qui n'est pas la propriété mesurée ici.
 *
 * @param {import('@playwright/test').Page} page Page neuve ouverte avec le bundle bloqué.
 * @param {string[]} requetes Le journal des requêtes de la page (mutable).
 * @param {{ route: string, taille: string }} options
 * @returns {Promise<void>}
 */
export async function verifierLaFacadeEnCoquille(page, requetes, { route, taille }) {
  await page.goto(route);
  // Coquille SANS JavaScript : rien à monter, rien à charger au-delà du
  // document — la condition est donc que la mise en page soit posée (les
  // assertions qui suivent lisent des comptes, pas des attentes).
  await attendreLaStabilite(page);

  expect(
    requetes.filter((url) => CARTE_TIERS.test(url) || url.includes('output=embed')),
    `la COQUILLE pré-rendue de ${route} demande déjà une ressource de carte : un crawler (ou une régie) ` +
      'paierait ces octets dans le premier écran, avant même React.'
  ).toEqual([]);
  expect(await page.locator('iframe').count(), `la coquille de ${route} publie une iframe de carte`).toBe(0);

  // Le contrôle est publié par la coquille elle-même, avec la vraie
  // destination : c'est ce qui le rend utile SANS JavaScript (le lien s'ouvre
  // sur la fiche Google).
  const controle = page.getByRole('link', { name: LIBELLE, exact: true });
  await expect(controle, `la coquille de ${route} ne publie pas le contrôle « ${LIBELLE} »`).toHaveCount(1);
  expect(await controle.getAttribute('href')).toBe(CONTACT.mapsUrl);

  console.log(
    `ℹ️  Carte ${route} (${taille}, coquille sans JavaScript) : contrôle « ${LIBELLE} » publié vers la fiche ` +
      `Google, ${requetes.length} requête(s) au total, 0 de carte`
  );
}

/**
 * LE PARCOURS DE LA CARTE DIFFÉRÉE (`/profile`) : rien tant que le bloc est HORS
 * du viewport, la carte dès qu'il y entre.
 *
 * ── Ce que cette propriété a de différent des deux précédentes ─────────────
 * La façade ne charge JAMAIS toute seule (elle attend un appui) ; la coquille
 * ne charge rien DU TOUT. Ici la carte doit finir par charger, sans qu'on ait
 * touché à rien : ce qui est prouvé n'est pas « le tiers ne part pas », c'est
 * « le tiers part AU BON MOMENT ». Un `before` mal placé, un observateur qui
 * n'observe pas, un `useEffect` qui monte l'iframe au montage, une iframe
 * rendue en `display:none` puis révélée : tous ces défauts passeraient un garde
 * qui se contenterait de compter les requêtes à la fin.
 *
 * ── Les quatre faits, dans cet ordre ──────────────────────────────────────
 *   1. ZÉRO REQUÊTE DE CARTE AU CHARGEMENT, et aucun `<iframe>` dans la page ;
 *   2. LE BLOC EST RÉELLEMENT HORS DU VIEWPORT quand (1) est relu — sans quoi
 *      « rien » serait vrai pour la mauvaise raison, un bloc déjà à l'écran
 *      n'ayant rien à différer. C'est la MÊME condition que (1) mais elle est
 *      jugée séparément : (1) protège l'utilisateur, (2) protège la mesure ;
 *   3. LE REPLI EST PUBLIÉ et mène à la MÊME carte sur le site (`href` de
 *      `countryMapFor`, donc le même cadre que l'embed) : un visiteur sans
 *      observateur, ou qui n'attend pas, a un chemin réel ;
 *   4. DÈS QUE LE BLOC ENTRE DANS LE VIEWPORT : l'iframe est montée avec
 *      EXACTEMENT l'`src` que la page calcule, le document a RÉELLEMENT
 *      chargé, la requête tierce est partie, et la boîte du bloc n'a pas bougé
 *      d'un pixel (la hauteur est réservée des deux côtés).
 *
 * Le tiers est intercepté À PARTIR DE L'ENTRÉE dans le viewport seulement, et
 * jamais avant : sinon la sonde se cacherait ce qu'elle mesure (un `before`
 * cassé ne se verrait plus dans le journal).
 *
 * @param {import('@playwright/test').Page} page Page neuve où l'on a DÉJÀ posé
 *   l'écouteur `page.on('request', …)` remplissant `requetes`.
 * @param {string[]} requetes Le journal des requêtes de la page (mutable).
 * @param {{ route: string, taille: string }} options
 * @returns {Promise<void>}
 */
export async function verifierLaCarteDifferee(page, requetes, { route, taille, compte }) {
  const etiquette = `${route} (${taille}, ${compte.nom})`;

  // Garde de LECTURE : sans carte résoluble il n'y a pas de bloc à observer, et
  // le parcours échouerait sur une assertion trompeuse plutôt que sur la cause.
  expect(
    CARTE_DU_PROFIL,
    `la carte du pays « ${PAYS_DE_LA_FIXTURE} » n’est pas résoluble dans la base géographique : ` +
      'le parcours n’aurait aucun bloc à observer (voir src/utils/countryMap.js).'
  ).toBeTruthy();

  // /profile est protégée : sans session le parcours mesurerait l'écran de
  // connexion (ou le squelette du profil), donc rien de ce qu'il prétend juger.
  await connexionALaFixture(page, compte.email);
  await page.goto(route);
  await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });
  await attendreLaStabilite(page);
  // Puis le chargement doit être fini (même condition qu'au point 1 du parcours
  // de façade) : la carte différée doit avoir eu sa chance de partir.
  await attendreLeSilenceDesRequetes(() => requetes.length);

  // ── 1. Rien de la carte AU CHARGEMENT ────────────────────────────────────
  refuserTouteCarte(requetes, 'AU CHARGEMENT');
  expect(
    await page.locator('iframe').count(),
    'au chargement, un `<iframe>` existe dans la page : le profil tirerait la carte au premier écran.'
  ).toBe(0);
  expect(
    requetes.length,
    'aucune requête journalisée : le contrôle ne lit rien (la page n’aurait pas chargé).'
  ).toBeGreaterThan(0);

  const bloc = page.locator('[data-carte-differee]');
  await expect(
    bloc,
    `le bloc de carte différée n’est pas publié sur ${route} : la section de localisation a disparu ` +
      '(ou le pays de la fixture ne résout plus de carte).'
  ).toHaveCount(1);

  // ── 2. LE BLOC EST HORS DU VIEWPORT, et il y reste tant qu'on n'y va pas ──
  expect(
    await bloc.evaluate(EST_DANS_LE_VIEWPORT),
    `le bloc de carte de ${route} est DANS la fenêtre au chargement : il se chargerait donc au premier ` +
      'écran, ce que « différé » interdit. La section doit rester SOUS la ligne de flottaison — ou le ' +
      'composant ne fait plus ce que son nom dit.'
  ).toBe(false);
  refuserTouteCarte(requetes, 'BLOC HORS DU VIEWPORT');
  expect(
    await page.locator('iframe').count(),
    'bloc hors du viewport, un `<iframe>` existe pourtant : la carte a été montée sans observation.'
  ).toBe(0);

  // ── 3. Le repli, publié et réel ──────────────────────────────────────────
  const repli = bloc.getByRole('link', { name: fr.mapShowMap, exact: true });
  await expect(
    repli,
    `le bloc ne publie pas son repli « ${fr.mapShowMap} » : un visiteur sans observateur n’aurait aucun chemin.`
  ).toHaveCount(1);
  expect(
    await repli.getAttribute('href'),
    'le repli ne mène pas à la MÊME carte que l’embed attendu (deux cadrages divergeraient).'
  ).toBe(CARTE_DU_PROFIL.href);

  const boiteAvant = await bloc.evaluate(BOITE_EN_DOCUMENT);
  expect(boiteAvant.hauteur, 'le bloc de carte n’a pas de hauteur : il n’est pas peint').toBeGreaterThan(0);

  // ── 4. ON ENTRE DANS LE VIEWPORT : la carte se charge ────────────────────
  // Le tiers est remplacé À PARTIR D'ICI seulement (cf. l'en-tête) : si un
  // `before` était cassé, la requête resterait dans le journal et (1) rougirait.
  let appelsAuTiers = 0;
  await page.route(CARTE_TIERS, async (routeInterceptee) => {
    appelsAuTiers += 1;
    await routeInterceptee.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: REPONSE_CARTE,
    });
  });

  await bloc.scrollIntoViewIfNeeded();
  await attendreLaStabilite(page);
  expect(
    await bloc.evaluate(EST_DANS_LE_VIEWPORT),
    `le bloc de carte n’a pas pu être amené dans le viewport sur ${route} : la suite ne prouverait rien.`
  ).toBe(true);

  const carte = bloc.locator('iframe');
  await expect(
    carte,
    'la carte n’est pas montée une fois le bloc DANS le viewport : la carte différée ne charge jamais.'
  ).toHaveCount(1, { timeout: 5000 });
  expect(await carte.getAttribute('src'), 'la carte montée n’est pas le cadre attendu').toBe(
    CARTE_DU_PROFIL.src
  );
  expect(await carte.getAttribute('title'), 'l’iframe n’a pas le titre du dictionnaire').toBe(
    fr.mapIframeTitle.replace('{address}', CARTE_DU_PROFIL.nom)
  );
  // Le document du cadre est RÉELLEMENT chargé : une iframe vide ne prouverait
  // rien de plus qu'un `<iframe>` dans l'arbre.
  await expect(
    page.frameLocator('iframe').getByText('carte de test'),
    'le document de la carte n’a pas chargé (la requête n’est pas partie, ou la réponse n’est pas arrivée)'
  ).toBeVisible();
  expect(
    appelsAuTiers,
    'aucune requête vers le tiers n’est partie à l’entrée dans le viewport : la carte ne charge pas'
  ).toBeGreaterThanOrEqual(1);
  // Le repli a laissé la place : pas deux fois la même destination à l'écran.
  await expect(
    repli,
    'le repli est encore là après le montage de la carte : la bascule n’a pas eu lieu'
  ).toHaveCount(0);

  // ── La boîte n'a pas bougé (hauteur réservée des deux côtés) ─────────────
  // On remesure LE MÊME ÉLÉMENT qu'avant (`[data-carte-differee]`), pas
  // l'iframe : le cadre vit DANS la bordure du bloc, donc sa boîte vaut 2 px de
  // moins — comparer le bloc à l'iframe ferait rougir sur la bordure, c'est-à-
  // dire sur du vide. Mesuré (784,0 → 782,0 px) avant que la sonde soit
  // corrigée : le piège est réel, il n'est pas théorique.
  const boiteApres = await bloc.evaluate(BOITE_EN_DOCUMENT);
  expect(boiteApres.hauteur, 'le bloc de carte n’a plus de hauteur après le montage').toBeGreaterThan(0);
  const boiteDuCadre = await carte.evaluate(BOITE_EN_DOCUMENT);
  expect(boiteDuCadre.hauteur, 'la carte n’a pas de hauteur : elle n’est pas peinte').toBeGreaterThan(0);
  expect(boiteDuCadre.largeur, 'la carte n’a pas de largeur : elle n’est pas peinte').toBeGreaterThan(0);
  for (const [nom, avant, apres] of [
    ['largeur', boiteAvant.largeur, boiteApres.largeur],
    ['hauteur', boiteAvant.hauteur, boiteApres.hauteur],
    ['position verticale', boiteAvant.hautDocument, boiteApres.hautDocument],
  ]) {
    expect(
      Math.abs(avant - apres),
      `le montage de la carte change la ${nom} du bloc (${avant.toFixed(1)} → ${apres.toFixed(1)} px) : la ` +
        'hauteur n’est plus réservée, et l’apparition de la carte crée un décalage.'
    ).toBeLessThanOrEqual(1);
  }

  console.log(
    `ℹ️  Carte ${etiquette} : la carte DIFFÉRÉE du pays « ${CARTE_DU_PROFIL.nom} » reste hors du viewport ` +
      `au chargement (${requetes.length} requête(s), 0 de carte — relu deux fois : au chargement, puis bloc ` +
      `hors de l’écran), repli « ${fr.mapShowMap} » publié vers ${CARTE_DU_PROFIL.href} ; amenée dans la vue, ` +
      `elle se monte en ${boiteDuCadre.largeur.toFixed(0)}×${boiteDuCadre.hauteur.toFixed(0)} px au document ` +
      `y=${boiteDuCadre.hautDocument.toFixed(1)} (bloc identique au repli : ${boiteAvant.largeur.toFixed(0)}×` +
      `${boiteAvant.hauteur.toFixed(0)} à y=${boiteAvant.hautDocument.toFixed(1)}) · ${appelsAuTiers} requête(s) de ` +
      `carte partie(s) à ce moment-là`
  );
}
