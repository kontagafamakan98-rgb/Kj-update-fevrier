#!/usr/bin/env node
/**
 * SONDE DE PRODUCTION — les pages servies par le BACKEND portent-elles la
 * typographie du site (Inter au corps, Cormorant Garamond aux titres) ?
 *
 * ── Le fait que cette sonde mesure, et pourquoi il n'était mesuré nulle part ──
 * Le 29/10/2026, les 45 pages ville, métier et guide — écrites par le backend,
 * servies sous les rewrites `/emplois/(.*)`, `/metiers/(.*)`, `/guides/(.*)` de
 * `frontend/vercel.json` — et la 404 peignaient `system-ui` : la police
 * d'AUCUNE autre page du site. Passer de `/jobs` à `/emplois/abidjan` changeait
 * de site sans changer d'URL.
 *
 * Ce défaut est corrigé (`backend/kojo_pages_metier.py` : `POLICES` + `STYLE`,
 * lus par les guides et par la 404), et il est tenu hors ligne des deux côtés :
 * `backend/tests/test_pages_metier_seo.py` (`TestLaTypographieDesPages`) exige
 * les deux familles et les deux préchargements dans le module Python ;
 * `frontend/scripts/__tests__/check-coquilles-equilibrees.test.js` fait de même
 * sur les trois cas de `404.html`. Ce que ces gardes ne peuvent PAS dire :
 *
 *   • que le DÉPLOIEMENT sert bien ces modules — un backend Fly dont la
 *     révision est en retard, ou un rewrite Vercel perdu, rend une autre page ;
 *   • que les FICHIERS cités existent sur l'origine du site. `font-display:
 *     swap` retombe en silence sur la police de l'hôte quand un `.woff2`
 *     répond 404 : la page paraîtrait correcte, ses `@font-face` seraient dans
 *     le document, et le visiteur lirait une autre police. C'est exactement ce
 *     qu'une sonde de production peut trancher et qu'un test hors ligne ne peut
 *     pas — d'où les requêtes sur les fichiers, pas seulement sur le HTML.
 *
 * ── Trois sorties, jamais deux ─────────────────────────────────────────────
 * 0 = chaque page déclarée et la 404 servent les deux familles, les emploient,
 *     préchargent leurs fichiers cités, et ces fichiers RÉPONDENT ;
 * 1 = refus nommé (statut inattendu, coquille React servie à la place de la
 *     page, famille absente, famille déclarée mais non employée, préchargement
 *     manquant ou sans `crossorigin`, fichier cité qui ne répond pas) ;
 * 2 = prémisse : aucune page n'a pu être LUE (liste de pages vide, origine
 *     injoignable, réseau) — la sonde n'a alors rien jugé, et une prémisse
 *     n'est jamais un vert.
 *
 * ── Ce qu'elle ne juge pas, et qui est écrit ──────────────────────────────
 *   • les faces de REPLI à `size-adjust` (`Inter repli Arial`, etc.) : elles
 *     restent propres au build de l'application, ces pages n'ayant ni budget de
 *     CLS ni élément LCP suivi (cf. `index.css`). La sonde le dit dans son
 *     rapport plutôt que de faire croire à une parité complète ;
 *   • la couleur, la mise en page, le contenu : c'est `check-seo-production.js`
 *     pour le document et les sondes e2e pour la peinture ;
 *   • la police RÉELLEMENT peinte par le navigateur : une sonde HTTP lit ce qui
 *     est SERVI. Le fichier qui répond et la déclaration qui l'emploie sont les
 *     deux faits mesurables ici ; le troisième (le moteur l'a-t-il chargé) vit
 *     dans une sonde de navigateur.
 *
 * Usage :
 *   node scripts/check-typo-pages-production.js                    # production
 *   node scripts/check-typo-pages-production.js --base https://…   # une preview
 *   node scripts/check-typo-pages-production.js --page /emplois/abidjan
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { GROUPES_LIENS_SEO } from '../src/config/liens-seo.js';
import { SITE_ORIGIN } from './site-meta.js';

export const DEFAULT_BASE = SITE_ORIGIN;

/** La famille de cette sonde — ce qu'un rouge prononcé ici veut dire. */
export const FAMILLE = 'Typographie des pages servies par le backend';

/** Le seul titre d'annotation que cette sonde publie. */
export const TITRE_ERREUR = 'Typographie pages production';

/** Marque des refus de PRÉMISSE : la sonde n'a pas pu juger — elle ne juge pas. */
export const MARQUE_PREMISSE = 'prémisse (aucun verdict rendu ici)';

/** Les deux familles du site, et le rôle de chacune. */
export const FAMILLES = { corps: 'Inter', titres: 'Cormorant Garamond' };

/**
 * L'adresse d'une page 404 : elle ne peut correspondre à aucun fichier ni
 * rewrite de `frontend/vercel.json`, donc Vercel sert `404.html` — le document
 * que `vite-plugins/prerender/not-found.js` écrit. Le nom dit qu'il vient d'une
 * sonde, pour qu'il ne soit pas pris pour un lien mort d'un visiteur.
 */
export const PAGE_INTROUVABLE = '/adresse-inconnue-sonde-typographie';

/** Le plus petit fichier de police crédible : un `.woff2` vide n'est pas une police. */
export const TAILLE_MINIMALE_POLICE = 1024;

const TIMEOUT_MS = 20000;

const strip = (valeur) => String(valeur ?? '').trim().replace(/\/+$/, '');

/**
 * Les pages à juger, DÉRIVÉES de la déclaration du maillage.
 *
 * Aucun slug n'est recopié : `src/config/liens-seo.js` est le propriétaire des
 * URL (`/emplois/{ville}`, `/metiers/{metier}`, `/guides/{guide}`) et le garde
 * serveur (`backend/tests/test_pages_seo_maillage.py`) l'a déjà confronté aux
 * déclarations du backend et au sitemap. Une ville ajoutée au référentiel
 * géographique arrive donc ici sans qu'on touche à cette sonde — et une page
 * annoncée que personne ne sert rougit au lieu de passer inaperçue.
 *
 * @returns {{famille: string, nom: string, href: string}[]}
 */
export function pagesAJuger() {
  return GROUPES_LIENS_SEO.flatMap(({ cle, liens }) =>
    liens.map(({ nom, href }) => ({ famille: cle, nom, href }))
  );
}

/** Le contenu de tous les `<style>` du document, dans l'ordre. */
export function feuillesDu(html) {
  const morceaux = [];
  const motif = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let trouve;
  while ((trouve = motif.exec(String(html || '')))) morceaux.push(trouve[1]);
  return morceaux;
}

/**
 * Les blocs `sélecteur { corps }` d'une feuille, imbrication comprise.
 *
 * Le scanner tient une PILE : ces feuilles portent des `@media(min-width:44rem)`
 * et leurs règles internes, qu'une expression régulière `[^{]+\{[^}]*\}` aurait
 * lues comme trois blocs inventés. Une règle interne garde son propre sélecteur
 * (le contexte `@media` n'est pas conservé : cette sonde juge des FAMILLES, pas
 * une cascade).
 *
 * @param {string} css
 * @returns {{selecteur: string, corps: string}[]}
 */
export function lireBlocs(css) {
  const blocs = [];
  const pile = [];
  let tampon = '';
  for (const caractere of String(css || '')) {
    if (caractere === '{') {
      pile.push(tampon.trim());
      tampon = '';
    } else if (caractere === '}') {
      const selecteur = pile.pop();
      if (selecteur !== undefined) blocs.push({ selecteur, corps: tampon.trim() });
      tampon = '';
    } else {
      tampon += caractere;
    }
  }
  return blocs;
}

/** Les variables CSS déclarées sur `:root` — `--police-titre` et ses sœurs. */
export function variablesDe(blocs) {
  const variables = {};
  for (const bloc of blocs) {
    if (!bloc.selecteur.includes(':root')) continue;
    const motif = /(--[\w-]+)\s*:\s*([^;]+)/g;
    let trouve;
    while ((trouve = motif.exec(bloc.corps))) variables[trouve[1]] = trouve[2].trim();
  }
  return variables;
}

/** La valeur d'une déclaration `font-family` d'un corps de règle, ou `''`. */
export function declarationDePolice(corps) {
  const trouve = /(?:^|;)\s*font-family\s*:\s*([^;]+)/i.exec(String(corps || ''));
  return trouve ? trouve[1].trim() : '';
}

/**
 * La PREMIÈRE famille d'une pile, `var(--…)` résolue.
 *
 * C'est la seule qui décide : une pile qui commence par `system-ui` peint la
 * police de l'hôte même si `'Inter'` figure plus loin — c'est précisément le
 * défaut que la sonde existe pour empêcher de revenir.
 *
 * @param {string} valeur Pile `font-family` telle qu'écrite.
 * @param {Record<string, string>} variables Variables `:root`.
 * @param {number} [profondeur] Garde-fou contre une variable qui se cite.
 * @returns {string} Le nom de la famille, ou `''`.
 */
export function premiereFamille(valeur, variables = {}, profondeur = 0) {
  const brut = String(valeur || '').trim();
  if (!brut) return '';
  const variable = /^var\(\s*(--[\w-]+)\s*\)$/.exec(brut.split(',')[0].trim());
  if (variable) {
    if (profondeur > 4) return '';
    return premiereFamille(variables[variable[1]] || '', variables, profondeur + 1);
  }
  return brut
    .split(',')[0]
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

/**
 * La famille qu'un SÉLECTEUR emploie, d'après les blocs de la feuille.
 *
 * @param {{selecteur: string, corps: string}[]} blocs
 * @param {string} selecteur Le sélecteur cherché (« body », « h1 »).
 * @param {Record<string, string>} variables
 * @returns {string} La première famille, ou `''` si aucune règle ne la déclare.
 */
export function familleDu(blocs, selecteur, variables) {
  for (const bloc of blocs) {
    const selecteurs = bloc.selecteur.split(',').map((s) => s.trim().toLowerCase());
    if (!selecteurs.includes(selecteur)) continue;
    const valeur = declarationDePolice(bloc.corps);
    if (!valeur) continue;
    return premiereFamille(valeur, variables);
  }
  return '';
}

/**
 * Les `@font-face` déclarées : famille → fichiers cités.
 *
 * @param {{selecteur: string, corps: string}[]} blocs
 * @returns {Map<string, string[]>}
 */
export function facesDeclarees(blocs) {
  const faces = new Map();
  for (const bloc of blocs) {
    if (!/^@font-face/i.test(bloc.selecteur)) continue;
    const famille = premiereFamille(declarationDePolice(bloc.corps), {}, 0);
    if (!famille) continue;
    const fichiers = [];
    const motif = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
    let trouve;
    while ((trouve = motif.exec(bloc.corps))) fichiers.push(trouve[1].trim());
    faces.set(famille, [...(faces.get(famille) || []), ...fichiers]);
  }
  return faces;
}

/**
 * Les `<link rel="preload" as="font">` du document, attributs lus.
 *
 * `crossorigin` est rendu à part : les polices se téléchargent TOUJOURS en mode
 * CORS, et sans l'attribut le navigateur ignore le préchargement en silence —
 * le fichier serait alors découvert à l'analyse du CSS, donc après le premier
 * paint. C'est un fait d'attribut, pas de valeur : `crossorigin` vide suffit.
 *
 * @param {string} html
 * @returns {{href: string, crossorigin: boolean}[]}
 */
export function preloadsDePolice(html) {
  const preloads = [];
  const motif = /<link\b[^>]*>/gi;
  let trouve;
  while ((trouve = motif.exec(String(html || '')))) {
    const balise = trouve[0];
    const attribut = (nom) => {
      const m = new RegExp(`\\b${nom}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(balise);
      return m ? (m[2] !== undefined ? m[2] : m[3]) : null;
    };
    if ((attribut('rel') || '').toLowerCase() !== 'preload') continue;
    if ((attribut('as') || '').toLowerCase() !== 'font') continue;
    preloads.push({ href: attribut('href') || '', crossorigin: /\bcrossorigin\b/i.test(balise) });
  }
  return preloads;
}

/**
 * Juge UN document. PUR : aucun réseau, donc chaque refus s'éprouve par un cas.
 *
 * @param {object} options
 * @param {string} options.nom Nom lisible de la page (« ville /emplois/abidjan »).
 * @param {string} options.url Adresse demandée.
 * @param {number} options.statut Statut HTTP reçu.
 * @param {number} options.attendu Statut attendu (200, ou 404 pour la 404).
 * @param {string} options.html Document servi.
 * @returns {string[]} Problèmes (vide = la page porte la typographie du site).
 */
export function jugerPage({ nom, url, statut, attendu = 200, html }) {
  const problemes = [];
  if (statut !== attendu) {
    problemes.push(
      `${nom} (${url}) répond HTTP ${statut} au lieu de ${attendu} : la page n'est pas servie, ` +
        `donc sa typographie ne peut pas être jugée (réécriture Vercel perdue ? page supprimée ?).`
    );
    return problemes;
  }

  // ── La COQUILLE de l'application n'est pas la page ──────────────────────
  // Sans cette lecture, un rewrite perdu servirait l'application React, qui
  // déclare bien les deux familles dans son bundle et dans `index.html` : la
  // sonde rendrait un vert sur le mauvais document. Les pages de ce dépôt sont
  // écrites par le backend, sans React, donc sans point de montage.
  if (/<div\b[^>]*\bid\s*=\s*["']root["']/i.test(html)) {
    problemes.push(
      `${nom} (${url}) sert la COQUILLE de l'application (point de montage React) au lieu de la ` +
        `page écrite par le backend : sa typographie viendrait du bundle, pas du document, et ` +
        `cette sonde jugerait le mauvais objet. Vérifier les rewrites de frontend/vercel.json.`
    );
    return problemes;
  }

  const feuilles = feuillesDu(html);
  if (!feuilles.length) {
    problemes.push(
      `${nom} (${url}) ne publie AUCUN <style> : la page n'a pas de feuille propre, donc sa ` +
        `typographie ne peut pas être celle du site (elle retombe sur la police de l'hôte).`
    );
    return problemes;
  }
  const blocs = feuilles.flatMap((css) => lireBlocs(css));
  const variables = variablesDe(blocs);
  const faces = facesDeclarees(blocs);

  // ── 1. Les deux familles sont DÉCLARÉES ────────────────────────────────
  for (const famille of Object.values(FAMILLES)) {
    if (!faces.has(famille)) {
      problemes.push(
        `${nom} (${url}) ne déclare aucun @font-face pour « ${famille} » : « font-display: swap » ` +
          `laisserait le texte dans la police de l'hôte, sans que rien ne le dise au visiteur.`
      );
    }
  }

  // ── 2. Les deux familles sont EMPLOYÉES ────────────────────────────────
  // Une face déclarée que rien n'emploie est du poids mort ; une page qui emploie
  // `system-ui` en PREMIER peint l'hôte même si `'Inter'` suit dans la pile.
  const corps = familleDu(blocs, 'body', variables);
  if (corps !== FAMILLES.corps) {
    problemes.push(
      `${nom} (${url}) peint son corps en « ${corps || 'aucune famille déclarée'} » au lieu de ` +
        `« ${FAMILLES.corps} » : la première famille d'une pile est celle qui est peinte.`
    );
  }
  const titres = familleDu(blocs, 'h1', variables);
  if (titres !== FAMILLES.titres) {
    problemes.push(
      `${nom} (${url}) peint ses titres (h1) en « ${titres || 'aucune famille déclarée'} » au lieu ` +
        `de « ${FAMILLES.titres} » : le titre serif est la moitié de la typographie du site.`
    );
  }

  // ── 3. Les fichiers cités sont PRÉCHARGÉS, `crossorigin` compris ───────
  const preloads = preloadsDePolice(html);
  for (const famille of Object.values(FAMILLES)) {
    const fichiers = faces.get(famille) || [];
    if (!fichiers.length) continue;
    const precharge = preloads.find((p) => fichiers.includes(p.href));
    if (!precharge) {
      problemes.push(
        `${nom} (${url}) ne précharge aucun fichier de « ${famille} » (cités : ${fichiers.join(', ')}) : ` +
          `le fichier ne serait découvert qu'à l'analyse du CSS, donc après le premier paint.`
      );
    } else if (!precharge.crossorigin) {
      problemes.push(
        `${nom} (${url}) précharge ${precharge.href} SANS « crossorigin » : le navigateur ignore ` +
          `ce préchargement en silence (les polices se téléchargent toujours en mode CORS).`
      );
    }
  }

  // ── 4. Les fichiers cités sont ceux du SITE ────────────────────────────
  // Un chemin absolu vers un autre hôte ne serait pas couvert par
  // `font-src 'self'` de la CSP ; un chemin relatif se résoudrait contre le
  // chemin de la page et répondrait 404.
  for (const [famille, fichiers] of faces) {
    for (const fichier of fichiers) {
      if (!fichier.startsWith('/fonts/')) {
        problemes.push(
          `${nom} (${url}) cite « ${famille} » depuis ${fichier} : les polices du site vivent sous ` +
            `/fonts/ (servies par le build Vercel, autorisées par font-src 'self').`
        );
      }
    }
  }

  return problemes;
}

/** Le libellé qui préfixe chaque refus : la famille, et l'origine jugée. */
export const libelleSonde = (base) =>
  `${FAMILLE} — ${strip(base)} sert-il Inter au corps et Cormorant Garamond aux titres`;

/**
 * Lit une page sans masquer un statut par une erreur de lecture.
 *
 * @returns {Promise<{statut: number, html: string, erreur: string}>}
 */
async function lirePage({ url, fetchImpl }) {
  try {
    const res = await fetchImpl(url, {
      headers: { 'user-agent': 'kojo-typo-pages-probe/1.0', accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const html = await res.text().catch(() => '');
    return { statut: res.status, html, erreur: '' };
  } catch (err) {
    return { statut: 0, html: '', erreur: err.message };
  }
}

/**
 * Lit un fichier de police et rend ce que le serveur en dit.
 *
 * On lit le CORPS, pas seulement l'en-tête : un serveur peut répondre 200 avec
 * une page d'erreur HTML sur le chemin d'une police. La taille et le type sont
 * donc confrontés à ce qu'est un `.woff2`.
 *
 * @returns {Promise<{statut: number, type: string, octets: number, erreur: string}>}
 */
async function lirePolice({ url, fetchImpl }) {
  try {
    const res = await fetchImpl(url, {
      headers: { 'user-agent': 'kojo-typo-pages-probe/1.0', accept: 'font/woff2,*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const corps = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
    return {
      statut: res.status,
      type: (res.headers.get('content-type') || '').toLowerCase(),
      octets: corps.byteLength || 0,
      erreur: '',
    };
  } catch (err) {
    return { statut: 0, type: '', octets: 0, erreur: err.message };
  }
}

/**
 * La sonde complète.
 *
 * @param {object} [options]
 * @param {string} [options.base] Origine du site (défaut : production).
 * @param {string[]} [options.pages] Chemins à juger à la place de la déclaration. `undefined`
 *   (le défaut) lit la déclaration ; `[]` ne juge AUCUNE page — c'est le cas du corpus
 *   vide, qui est une prémisse et se teste comme tel.
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @param {boolean} [options.quiet] Tait la progression.
 * @returns {Promise<{ok: boolean, premisse: boolean, errors: string[], notices: string[],
 *   checked: string[], pages: string[], polices: string[], cout: object}>}
 */
export async function runTypoProbe({
  base = process.env.KOJO_TYPO_BASE_URL || DEFAULT_BASE,
  pages,
  fetchImpl = fetch,
  quiet = false,
} = {}) {
  const BASE = strip(base);
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };
  const errors = [];
  const notices = [];
  const checked = [];
  const pagesLues = [];
  const policesJugees = [];
  // Les documents LUS sont gardés : l'étape des polices relit leur feuille au
  // lieu de re-télécharger 46 pages pour retrouver quatre chemins de fichiers.
  const documents = [];
  const debut = Date.now();
  let requetes = 0;
  const result = { ok: false, premisse: false, errors, notices, checked, pages: pagesLues, polices: policesJugees, cout: {} };
  const libelle = libelleSonde(BASE);

  const aJuger = Array.isArray(pages)
    ? pages.map((chemin) => ({ nom: chemin, href: chemin }))
    : pagesAJuger().map(({ famille, nom, href }) => ({ nom: `${famille} ${href}`, href }));

  // ── Le corpus VIDE ne vaut pas un vert ──────────────────────────────────
  // Une liste vide ne dit pas « aucune page » : elle dit que la DÉCLARATION n'a
  // pas été lue (module renommé, import cassé). Conclure serait le silence.
  if (!aJuger.length) {
    result.premisse = true;
    notices.push(
      `${MARQUE_PREMISSE} : aucune page à juger — la déclaration du maillage ` +
        `(src/config/liens-seo.js) n'a rendu aucune URL. Rien n'a été mesuré.`
    );
    log(`⚠️ ${notices[notices.length - 1]}`);
    return result;
  }

  // ── 1. Les pages déclarées, une par une ─────────────────────────────────
  for (const { nom, href } of aJuger) {
    const url = `${BASE}${href.startsWith('/') ? href : `/${href}`}`;
    requetes += 1;
    const page = await lirePage({ url, fetchImpl });
    if (page.erreur) {
      errors.push(`${nom} (${url}) n'a pas pu être lu (${page.erreur}) : sa typographie n'est pas jugée.`);
      continue;
    }
    pagesLues.push(url);
    documents.push({ url, html: page.html });
    const problemes = jugerPage({ nom, url, statut: page.statut, attendu: 200, html: page.html });
    errors.push(...problemes);
    if (!problemes.length) checked.push(`  ✓ ${nom} (${url})`);
  }

  // ── 2. La 404, qui est un document du build ─────────────────────────────
  const url404 = `${BASE}${PAGE_INTROUVABLE}`;
  requetes += 1;
  const page404 = await lirePage({ url: url404, fetchImpl });
  if (page404.erreur) {
    errors.push(`la 404 (${url404}) n'a pas pu être lue (${page404.erreur}) : sa typographie n'est pas jugée.`);
  } else {
    pagesLues.push(url404);
    documents.push({ url: url404, html: page404.html });
    const problemes = jugerPage({ nom: '404', url: url404, statut: page404.statut, attendu: 404, html: page404.html });
    errors.push(...problemes);
    if (!problemes.length) checked.push(`  ✓ 404 (${url404})`);
  }

  // ── Rien de lu = rien de jugé ───────────────────────────────────────────
  // Un réseau coupé ne fait pas de ces pages des pages cassées : il fait de
  // cette passe une passe sans mesure. Conclure « défaut » accuserait le code
  // pour l'état du réseau — et un vert n'est pas davantage permis.
  if (!pagesLues.length) {
    result.premisse = true;
    notices.push(
      `${MARQUE_PREMISSE} : aucune page de ${BASE} n'a pu être lue (${errors.length} erreur(s) ` +
        `de lecture) — la typographie des pages servies par le backend n'a pas été mesurée.`
    );
    log(`⚠️ ${notices[notices.length - 1]}`);
    return result;
  }

  // ── 3. Les fichiers de police CITÉS, une seule fois chacun ──────────────
  // Une page qui cite un fichier que le serveur n'a pas est le cas que
  // `font-display: swap` rend invisible : le document est conforme, le
  // visiteur lit une autre police. On ne demande donc pas « le chemin est-il
  // plausible », on demande « le serveur le rend-il ».
  const cites = new Set();
  for (const { html } of documents) {
    const faces = facesDeclarees(feuillesDu(html).flatMap((css) => lireBlocs(css)));
    for (const fichiers of faces.values()) {
      for (const chemin of fichiers) if (chemin.startsWith('/')) cites.add(chemin);
    }
  }
  for (const chemin of [...cites].sort()) {
    const url = `${BASE}${chemin}`;
    requetes += 1;
    const police = await lirePolice({ url, fetchImpl });
    if (!police.erreur && police.statut === 200 && police.octets >= TAILLE_MINIMALE_POLICE) {
      policesJugees.push(url);
      checked.push(`  ✓ police ${chemin} (${police.type || 'type non annoncé'}, ${police.octets} o)`);
      continue;
    }
    policesJugees.push(url);
    errors.push(
      police.erreur
        ? `le fichier de police ${url} n'a pas pu être lu (${police.erreur}) : les pages qui le citent ` +
            `retomberaient en silence sur la police de l'hôte.`
        : `le fichier de police ${url} répond HTTP ${police.statut} (${police.octets} o, type ` +
            `« ${police.type || 'aucun'} ») : un chemin recopié de travers ne casse RIEN de visible — ` +
            `« font-display: swap » fait retomber la page sur la police de l'hôte, en silence.`
    );
  }

  // ── 4. Le coût de la passe, publié même vert ────────────────────────────
  result.cout = {
    pages: pagesLues.length,
    polices: policesJugees.length,
    requetes,
    dureeMs: Date.now() - debut,
  };

  result.ok = errors.length === 0;
  if (result.ok) {
    log(
      `\n${libelle} : conforme (${pagesLues.length} page(s), ${policesJugees.length} fichier(s) de ` +
        `police, ${requetes} requête(s), ${result.cout.dureeMs} ms).`
    );
  }
  return result;
}

/** Les options de ligne de commande. */
export function parseArguments(argv = process.argv.slice(2)) {
  const options = { base: '', pages: [], quiet: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--base') options.base = argv[(index += 1)] || '';
    else if (argument === '--page') options.pages.push(argv[(index += 1)] || '');
    else if (argument === '--quiet') options.quiet = true;
  }
  return { ...options, pages: options.pages.filter(Boolean) };
}

/**
 * Le point d'entrée, séparé pour que le VERDICT (0/1/2) se juge sans réseau.
 *
 * @param {string[]} [argv] Arguments après `node script`.
 * @param {object} [deps] `run`, `log`, `error`.
 * @returns {Promise<number>} Code de sortie.
 */
export async function main(
  argv = process.argv.slice(2),
  { run = runTypoProbe, log = console.log, error = console.error } = {}
) {
  const options = parseArguments(argv);
  const resultat = await run({
    base: options.base || undefined,
    pages: options.pages.length ? options.pages : undefined,
    quiet: options.quiet,
  });

  log(`\n${libelleSonde(options.base || DEFAULT_BASE)}`);
  for (const ligne of resultat.checked) log(ligne);

  if (resultat.premisse) {
    error(`::error title=${TITRE_ERREUR}::${resultat.notices.join(' ') || MARQUE_PREMISSE}`);
    for (const notice of resultat.notices) error(`  • ${notice}`);
    return 2;
  }

  if (resultat.errors.length) {
    error(`\n❌ ${resultat.errors.length} défaut(s) — ${TITRE_ERREUR} :`);
    for (const message of resultat.errors) error(`  • ${message}`);
    error(
      `\n   → les deux familles sont déclarées UNE fois, dans backend/kojo_pages_metier.py (POLICES, ` +
        `importé par les guides) et pour la 404 dans vite-plugins/prerender/not-found.js ; les fichiers ` +
        `viennent de frontend/public/fonts. Un document muet se corrige dans ces deux modules, un ` +
        `fichier qui ne répond pas se corrige dans le build (le dossier public), et une COQUILLE servie ` +
        `à la place d'une page se corrige dans les rewrites de frontend/vercel.json.`
    );
    error(
      `::error title=${TITRE_ERREUR}::${resultat.errors.length} défaut(s) sur la typographie des pages ` +
        `servies par le backend`
    );
    return 1;
  }

  log(
    `\n✅ Les ${resultat.cout.pages} page(s) jugée(s) servent « ${FAMILLES.corps} » au corps et ` +
      `« ${FAMILLES.titres} » aux titres, préchargent leurs fichiers cités (crossorigin compris), et ` +
      `les ${resultat.cout.polices} fichier(s) de police RÉPONDENT — ${resultat.cout.requetes} requête(s) ` +
      `en ${resultat.cout.dureeMs} ms.`
  );
  log(
    `ℹ️  Ce que cette sonde ne dit pas, écrit plutôt que tu : les faces de REPLI à size-adjust restent ` +
      `propres au build de l'application (ces pages n'ont ni budget de CLS ni élément LCP suivi), et la ` +
      `police RÉELLEMENT peinte par le navigateur n'est pas lue ici — un fichier qui répond et une ` +
      `déclaration qui l'emploie sont les deux faits mesurés.`
  );
  return 0;
}

export const estAppelDirect =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (estAppelDirect) {
  process.exit(await main());
}
