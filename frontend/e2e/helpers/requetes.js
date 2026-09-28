/**
 * L'ÉCOUTE DES REQUÊTES D'UN PARCOURS — un seul propriétaire.
 *
 * Ces trois fonctions vivaient dans `e2e/aucun-tiers-avant-interaction.spec.js`,
 * où elles servaient une seule sonde. La sonde INVERSE
 * (`e2e/tiers-apres-interaction.spec.js`) a besoin EXACTEMENT des mêmes : deux
 * copies divergeraient au premier correctif — c'est la règle du dépôt, un seul
 * propriétaire par mesure. Le protocole est donc ici, une fois.
 *
 * ── Pourquoi le protocole (CDP), et pas `page.on('request')` ────────────────
 * Le listener de haut niveau ne porte PAS l'initiateur dans cette version de
 * Playwright (`request.initiator is not a function`, mesuré le 26/09/2026). Or
 * l'initiateur est la moitié utile d'un verdict : un rouge qui dit « une requête
 * tierce » sans dire QUI l'a lancée oblige à instrumenter à la main. On lit donc
 * `Network.requestWillBeSent` du CDP, qui porte `initiator`
 * (`{ type, url, lineNumber }`) ET le `type` de ressource (Document, Script,
 * Fetch…). La sonde est CHROMIUM par construction, comme celle du coût du
 * document (`e2e/style-layout-document.spec.js`).
 *
 * ── Le journal est VIVANT, et l'appelant le découpe ─────────────────────────
 * `requetes` est un tableau MUTABLE que l'appelant relit quand il veut : les
 * parcours s'en servent pour comparer AVANT / APRÈS un geste, ce qui est la
 * seule façon de dire « ce tiers-là est arrivé À CAUSE de ce geste ». Aucune
 * fonction de ce module ne juge : elles lisent, elles attendent, elles rendent.
 */
import { attendreLeSilenceDesRequetes } from './attentes.js';

/**
 * Branche l'écoute des requêtes au niveau du protocole. À APPELER AVANT `goto` :
 * une preuve qui commence à écouter après la première requête ne verrait pas le
 * document lui-même.
 *
 * ── Pourquoi on écoute AUSSI l'arbre des cadres (`Page`) ──────────────────
 * Mesuré le 28/09/2026 sur la façade de carte : pour une iframe (ou une image)
 * créée par un script, Chromium ne remplit RIEN — `initiator` vaut exactement
 * `{"type":"other"}`, sans URL ni pile. Un verdict qui ne peut nommer que ce
 * champ rend donc « une source non nommée » sur la requête la plus intéressante
 * du site. L'arbre des cadres, lui, répond à la question « quel DOCUMENT a
 * demandé ? » : le cadre principal (`Page.frameNavigated`, celui qui porte le
 * geste) et les cadres enfants (`Page.frameAttached`, qui portent leur parent).
 * Chaque requête du journal porte donc, en plus de son initiateur, le document
 * demandeur (`cadre`) — le sien s'il vit dans le document principal, celui de
 * son parent s'il vit dans un cadre (une carte, par exemple).
 *
 * @param {import('@playwright/test').Page} page Page neuve, pas encore naviguée.
 * @returns {Promise<{requetes: Array<{url: string, sorte: string, initiateur: object, cadre: string}>}>}
 *   Le journal vivant : chaque URL demandée, sa sorte de ressource, l'initiateur
 *   qui l'a lancée, et le document demandeur.
 */
export async function ecouterLesRequetes(page) {
  const requetes = [];
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Page.enable');

  /** L'URL d'un cadre, par son identifiant. */
  const urlDesCadres = new Map();
  /** Le parent d'un cadre, quand il en a un. */
  const parentDesCadres = new Map();
  /** Le document principal : le seul qui porte le geste de l'utilisateur. */
  let documentPrincipal = '';

  session.on('Page.frameAttached', (evenement) => {
    if (evenement.frameId && evenement.parentFrameId) {
      parentDesCadres.set(evenement.frameId, evenement.parentFrameId);
    }
  });
  session.on('Page.frameNavigated', (evenement) => {
    const cadre = evenement.frame;
    if (!cadre?.id) return;
    urlDesCadres.set(cadre.id, cadre.url || '');
    if (cadre.parentId) parentDesCadres.set(cadre.id, cadre.parentId);
    else documentPrincipal = cadre.url || documentPrincipal;
  });

  session.on('Network.requestWillBeSent', (evenement) => {
    // Le document demandeur : celui du cadre lui-même s'il est le document
    // principal, celui de son parent sinon (une requête de carte part « depuis »
    // la page qui l'a montée, pas depuis la page de Google).
    const parent = parentDesCadres.get(evenement.frameId);
    const cadre = parent ? urlDesCadres.get(parent) || documentPrincipal : urlDesCadres.get(evenement.frameId) || documentPrincipal;
    requetes.push({
      url: evenement.request?.url || '',
      sorte: evenement.type || 'Autre',
      initiateur: evenement.initiator,
      cadre: cadre || '',
    });
  });
  return { requetes };
}

/**
 * Laisse partir les requêtes du chargement SANS le moindre appui, et rend la main
 * quand le journal s'est tu.
 *
 * C'ÉTAIT une seconde fixe, et elle était choisie CONTRE `networkidle` :
 * l'application interroge son API, et une attente de « réseau au repos » qui ne
 * vient jamais serait un rouge sur la montre, pas sur le fond. Le remède n'était
 * donc pas de revenir à `networkidle`, mais d'écrire la condition sur le JOURNAL
 * QUE LE VERDICT UTILISE DÉJÀ : il se tait (plus une seule requête nouvelle
 * pendant la durée de calme du harnais), avec un plafond. Un chargement rapide
 * rend la main plus tôt ; une application qui interroge en boucle est attendue
 * jusqu'au plafond, au lieu d'être jugée sur une seconde qui ne veut rien dire.
 *
 * Le pas de sondage, la durée de calme et le plafond sont des paramètres NOMMÉS
 * de `e2e/helpers/attentes.js`, jamais des littéraux de spec (angle mort 19 de
 * CI-COVERAGE.md, refermé le 28/09/2026).
 *
 * @param {import('@playwright/test').Page} page Page en cours de chargement.
 * @param {Array<Object>} requetes Le journal vivant d'`ecouterLesRequetes`.
 * @returns {Promise<boolean>} Vrai si le silence a été observé.
 */
export async function laisserChargerSansAppuyer(page, requetes) {
  await page.waitForLoadState('load');
  return attendreLeSilenceDesRequetes(() => requetes.length);
}

/**
 * Attend que le journal se taise APRÈS un geste.
 *
 * Même condition que ci-dessus, et elle n'est pas facultative : le geste (un
 * appui sur la façade de carte, une recherche) déclenche une requête qui part
 * quelques dizaines de millisecondes plus tard. Juger le journal sans l'attendre
 * rendrait un verdict sur un instant du chargement — c'est-à-dire, souvent, un
 * vert sur du vide.
 *
 * @param {Array<Object>} requetes Le journal vivant d'`ecouterLesRequetes`.
 * @returns {Promise<boolean>} Vrai si le silence a été observé.
 */
export async function attendreLaFinDuGeste(requetes) {
  return attendreLeSilenceDesRequetes(() => requetes.length);
}
