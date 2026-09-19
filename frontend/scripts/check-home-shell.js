#!/usr/bin/env node
/**
 * Garde-fou du shell statique de la PAGE D'ACCUEIL (build/index.html).
 *
 * ── Pourquoi ce garde existe ─────────────────────────────────────────────────
 * L'accueil est une SPA : sans pré-rendu, le HTML servi ne contenait que
 * `<div id="root"></div>` et un `<noscript>`. Un audit SEO (et un crawler sans
 * JavaScript) y voyait donc : aucun titre h1, aucun contenu (19 mots), aucun
 * lien interne, aucun lien de contact — alors que la page est parfaitement
 * remplie une fois React démarré. Le shell statique (plugin
 * `prerender-route-meta` de vite.config.js) corrige cela : il reproduit les
 * sections de Home.js avec les textes réels de src/i18n/fr.json.
 *
 * ── Ce que ce garde vérifie ─────────────────────────────────────────────────
 *   1. un seul h1, et c'est le titre du dictionnaire (structure de titres) ;
 *   2. title ≤ 60 et meta description ≤ 160 caractères (au-delà, les moteurs
 *      tronquent) ;
 *   3. du contenu réel (≥ 300 mots visibles) et des liens INTERNES ;
 *   4. des liens de contact cliquables (`tel:`, `mailto:`) ;
 *   5. un N.A.P. IDENTIQUE à src/config/contact.json (le footer React lit le
 *      même fichier : publier deux adresses serait pire que de n'en publier
 *      aucune) ;
 *   6. les pays du shell sont ceux de CountryDisplay.js (anti-dérive) ;
 *   7. un `LocalBusiness` complet et une carte intégrée (SEO local) ;
 *   8. chaque classe Tailwind du shell existe bien dans le CSS du build —
 *      Tailwind ne scanne PAS vite.config.js : une classe inventée dans le
 *      shell ne serait jamais stylée, et le premier rendu « sauterait » au
 *      montage de React (CLS) ;
 *   9. le shell de l'accueil ne fuit PAS dans les autres pages pré-rendues
 *      (jobs.html, login.html…) : chacune a le sien.
 *
 * ── Le piège que ce garde surveille en priorité ──────────────────────────────
 * Un shell silencieusement vidé (clé i18n renommée, plugin désactivé, retour au
 * `#root` vide) ne casse AUCUN test fonctionnel : la page fonctionne, elle
 * redevient simplement invisible pour les moteurs. C'est exactement le
 * faux-vert que ce garde transforme en échec.
 *
 * Usage : cd frontend && npm run build && node scripts/check-home-shell.js
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { metaContent, shellFileFor } from './site-meta.js';
// La liste des pages pré-rendues est DÉRIVÉE de la table des textes : c'était une
// seconde déclaration des mêmes pages que le build (voir PRERENDERED_PAGES).
import { PAGE_META } from '../src/config/page-meta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(FRONTEND_DIR, '..');

export const CONTACT_JSON = 'src/config/contact.json';
export const I18N_FR = 'src/i18n/fr.json';
export const COUNTRY_DISPLAY = 'src/components/CountryDisplay.js';
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;
// Plancher de contenu de l'accueil : 300 mots suffisaient à un crawler pour
// comprendre la page, 500 est le seuil qu'un audit de référencement réclame.
// Le garde avait le mauvais seuil — il ne pouvait donc pas voir le manque.
export const MIN_WORDS = 500;
// Pages pré-rendues qui ont leur PROPRE shell : le shell de l'accueil ne doit
// pas s'y retrouver (et inversement).
//
// ── DÉRIVÉE, et non recopiée ──────────────────────────────────────────────
// Cette liste était écrite à la main — sept noms de fichiers, une SECONDE
// déclaration des pages que le build pré-rend (src/config/page-meta.js). Une
// page ajoutée à la table et oubliée ici n'était donc pas comparée : son shell
// pouvait dupliquer celui de l'accueil (ou publier la description de l'accueil)
// sans qu'aucune règle ne le voie. La table est la source ; la correspondance
// route → fichier est celle de scripts/site-meta.js, partagée avec le build.
export const PRERENDERED_PAGES = Object.keys(PAGE_META)
  .filter((route) => route !== '/')
  .map(shellFileFor);

/**
 * Contenu de `<div id="root">…`, jusqu'au `</div>` qui FERME ce div.
 *
 * Le contenu est imbriqué (sections, cartes, grid…) : s'arrêter au premier
 * `</div>` rencontré tronquerait le shell, et prendre tout jusqu'à `</body>`
 * y incorporerait le script d'entrée — dans les deux cas la mesure du contenu
 * (nombre de mots, classes) porterait sur autre chose que le shell.
 */
export function extractRootHtml(html) {
  const marker = '<div id="root">';
  const start = html.indexOf(marker);
  if (start === -1) return '';
  const openTag = /<div\b/gi;
  const closeTag = /<\/div>/gi;
  openTag.lastIndex = start;
  closeTag.lastIndex = start;
  let depth = 0;
  let cursor = start;
  while (cursor < html.length) {
    openTag.lastIndex = cursor;
    closeTag.lastIndex = cursor;
    const nextOpen = openTag.exec(html);
    const nextClose = closeTag.exec(html);
    if (!nextClose) return '';
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + nextOpen[0].length;
      continue;
    }
    if (nextClose.index === -1) break;
    depth -= 1;
    cursor = nextClose.index + nextClose[0].length;
    if (depth === 0) {
      return html.slice(start + marker.length, nextClose.index);
    }
  }
  return '';
}

/** Texte visible d'un fragment HTML : balises, scripts et styles retirés. */
export function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countWords(text) {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Échappement d'un nom de classe tel que Tailwind l'écrit dans le CSS. */
export function cssEscapedClass(token) {
  return token.replace(/[.:/%#()[\]!]/g, (char) => `\\${char}`);
}

/**
 * Classes du HTML absentes du CSS fourni.
 *
 * `group` et `peer` sont des marqueurs de variantes Tailwind : ils n'ont pas de
 * règle propre, on les ignore.
 */
export function missingClasses(html, css, { ignore = ['group', 'peer'] } = {}) {
  const used = new Set();
  for (const match of html.matchAll(/class="([^"]*)"/g)) {
    for (const token of match[1].split(/\s+/)) {
      if (token) used.add(token);
    }
  }
  const missing = [];
  for (const token of used) {
    if (ignore.includes(token)) continue;
    if (token.includes('{{') || token.startsWith('$')) continue;
    if (!css.includes(`.${cssEscapedClass(token)}`)) missing.push(token);
  }
  return missing.sort();
}

/**
 * Contrôle le shell de l'accueil.
 *
 * @param {{frontendDir?: string, repoRoot?: string, buildDir?: string}} options
 * @returns {{ok: boolean, errors: string[], notices: string[], words: number}}
 */
export function runHomeShellCheck(options = {}) {
  const frontendDir = options.frontendDir || FRONTEND_DIR;
  const repoRoot = options.repoRoot || REPO_ROOT;
  const buildDir = options.buildDir || path.join(frontendDir, 'build');
  const errors = [];
  const notices = [];

  const indexPath = path.join(buildDir, 'index.html');
  if (!existsSync(indexPath)) {
    return {
      ok: false,
      errors: [`build/index.html introuvable (${indexPath}) : le build a-t-il tourné ?`],
      notices,
      words: 0,
    };
  }
  const html = readFileSync(indexPath, 'utf8');

  const readJson = (relative) => JSON.parse(readFileSync(path.join(frontendDir, relative), 'utf8'));
  let contact = null;
  let fr = null;
  try {
    contact = readJson(CONTACT_JSON);
    fr = readJson(I18N_FR);
  } catch (error) {
    errors.push(`fichiers partagés illisibles (${error.message})`);
  }

  const rootHtml = extractRootHtml(html);
  if (!rootHtml.trim()) {
    return {
      ok: false,
      errors: [
        'index.html : <div id="root"> est VIDE — le shell de l\'accueil a disparu ' +
          '(plugin prerender-route-meta désactivé ?). Sans lui, la page n\'a ni h1, ni contenu, ni lien pour un crawler.',
      ],
      notices,
      words: 0,
    };
  }

  // ── 1. Structure de titres : un seul h1, et c'est le titre du dictionnaire ─
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => visibleText(match[1]));
  if (h1s.length !== 1) {
    errors.push(`index.html doit contenir EXACTEMENT un h1 (trouvé : ${h1s.length})`);
  }
  if (fr && typeof fr.heroTitle === 'string') {
    if (!h1s.some((text) => text === fr.heroTitle)) {
      errors.push(
        `le h1 doit reprendre heroTitle du dictionnaire (« ${fr.heroTitle} ») — ` +
          `trouvé : ${h1s.map((text) => `« ${text} »`).join(', ') || 'aucun'}`
      );
    }
  }
  if (!/<h2[^>]*>/.test(html)) {
    errors.push('index.html : aucun h2 — la hiérarchie de titres s\'arrête au h1');
  }

  // ── 2. Longueurs de titre et de description ───────────────────────────────
  const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
  const description = metaContent(html, 'description');
  if (!title.trim()) {
    errors.push('index.html : <title> vide');
  } else if (title.length > TITLE_MAX) {
    errors.push(`<title> fait ${title.length} caractères (maximum ${TITLE_MAX}) : les moteurs le tronquent`);
  }
  if (!description.trim()) {
    errors.push('index.html : meta description absente');
  } else if (description.length > DESCRIPTION_MAX) {
    errors.push(
      `meta description fait ${description.length} caractères (maximum ${DESCRIPTION_MAX}) : les moteurs la tronquent`
    );
  }
  for (const property of ['og:title', 'og:description', 'twitter:title']) {
    if (!html.includes(`property="${property}"`) && !html.includes(`name="${property}"`)) {
      errors.push(`index.html : ${property} absent`);
    }
  }

  // ── 3. Contenu réel et liens internes ─────────────────────────────────────
  const text = visibleText(rootHtml);
  const words = countWords(text);
  if (words < MIN_WORDS) {
    errors.push(
      `le contenu statique de l'accueil ne fait que ${words} mots (minimum ${MIN_WORDS}) : ` +
        'un crawler sans JavaScript verrait une page vide'
    );
  }
  const internalLinks = [...rootHtml.matchAll(/<a\s+[^>]*href="\/(?!\/)/g)].length;
  if (internalLinks === 0) {
    errors.push('le shell de l\'accueil ne contient AUCUN lien interne — aucune page du site n\'est atteignable depuis /');
  }

  // ── 4. Liens de contact cliquables ────────────────────────────────────────
  if (!/href="tel:/.test(rootHtml)) errors.push('le shell ne contient aucun lien « tel: » (appel en un appui sur mobile)');
  if (!/href="mailto:/.test(rootHtml)) errors.push('le shell ne contient aucun lien « mailto: »');
  if (!/wa\.me\//.test(rootHtml)) errors.push('le shell ne contient aucun lien WhatsApp (wa.me)');

  // ── 5. N.A.P. identique à la source partagée ──────────────────────────────
  if (contact) {
    for (const [label, value] of [
      ['phone', contact.phone],
      ['phoneDisplay', contact.phoneDisplay],
      ['email', contact.email],
      ['address', contact.address],
    ]) {
      if (!String(value).trim()) {
        errors.push(`contact.json : « ${label} » est vide — le N.A.P. publié serait incomplet`);
      } else if (!rootHtml.includes(String(value)) && !html.includes(String(value))) {
        errors.push(`le HTML ne publie pas « ${label} » de contact.json (« ${value} ») : le N.A.P. diverge du footer`);
      }
    }
  }

  // ── 6. Les pays du shell sont ceux de CountryDisplay.js ───────────────────
  const countryPath = path.join(frontendDir, COUNTRY_DISPLAY);
  if (!existsSync(countryPath)) {
    errors.push(`${COUNTRY_DISPLAY} introuvable : impossible de vérifier les pays du shell`);
  } else {
    const source = readFileSync(countryPath, 'utf8');
    // Gère les apostrophes échappées (« Côte d\'Ivoire ») : un `[^']+` nu
    // tronquerait le nom à la première apostrophe.
    const names = [...source.matchAll(/^\s*name:\s*'((?:[^'\\]|\\.)*)'/gm)].map((match) =>
      match[1].replace(/\\'/g, "'")
    );
    if (names.length === 0) {
      errors.push(`${COUNTRY_DISPLAY} : aucune liste de pays extraite — le garde ne prouve rien`);
    }
    for (const name of names) {
      if (!rootHtml.includes(name)) {
        errors.push(`le shell ne mentionne pas le pays « ${name} » (liste de ${COUNTRY_DISPLAY} désynchronisée)`);
      }
    }
    if (names.length) notices.push(`${names.length} pays du référentiel présents dans le shell`);
  }

  // ── 7. SEO local : LocalBusiness + carte intégrée ─────────────────────────
  const ldJsonBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (match) => match[1]
  );
  let localBusiness = null;
  for (const block of ldJsonBlocks) {
    try {
      const parsed = JSON.parse(block);
      if (parsed && parsed['@type'] === 'LocalBusiness') localBusiness = parsed;
    } catch (error) {
      errors.push(`données structurées illisibles (JSON invalide) : ${error.message}`);
    }
  }
  if (!localBusiness) {
    errors.push('aucun LocalBusiness dans les données structurées (SEO local)');
  } else {
    for (const field of ['telephone', 'email', 'address', 'areaServed', 'sameAs']) {
      if (localBusiness[field] === undefined) errors.push(`LocalBusiness : champ « ${field} » manquant`);
    }
    if (localBusiness.telephone !== contact?.phone) {
      errors.push(`LocalBusiness.telephone (« ${localBusiness.telephone} ») doit être le téléphone de contact.json`);
    }
    if (localBusiness.address?.streetAddress !== contact?.streetAddress) {
      errors.push('LocalBusiness.address.streetAddress doit être l\'adresse de contact.json');
    }
    if (Array.isArray(localBusiness.sameAs) && localBusiness.sameAs.some((url) => !/^https:\/\//.test(url))) {
      errors.push('LocalBusiness.sameAs ne doit contenir que des URL absolues https');
    }
  }
  if (!/google\.com\/maps[^"]*output=embed/.test(html)) {
    errors.push('aucune carte Google Maps intégrée (iframe output=embed) — SEO local incomplet');
  } else if (!/loading="lazy"/.test(html)) {
    errors.push('la carte intégrée doit être en loading="lazy" (sinon elle concurrence le LCP de l\'accueil)');
  }

  // ── 8. Chaque classe du shell est stylée par le CSS du build ───────────────
  const cssMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!cssMatch) {
    errors.push('aucun CSS inliné dans index.html : le plugin inline-critical-css a-t-il tourné ?');
  } else {
    const missing = missingClasses(rootHtml, cssMatch[1]);
    if (missing.length > 0) {
      errors.push(
        `classes du shell ABSENTES du CSS du build (non stylées, layout instable au montage React) : ` +
          missing.slice(0, 12).join(', ') +
          (missing.length > 12 ? ` (+${missing.length - 12})` : '')
      );
    }
  }

  // ── 9. Le shell de l'accueil ne fuit pas dans les autres pages ────────────
  if (fr && typeof fr.heroTitle === 'string') {
    for (const page of PRERENDERED_PAGES) {
      const pagePath = path.join(buildDir, page);
      if (!existsSync(pagePath)) continue;
      const pageHtml = readFileSync(pagePath, 'utf8');
      const pageRoot = extractRootHtml(pageHtml);
      if (pageRoot.includes(fr.heroTitle)) {
        errors.push(`build/${page} contient le shell de l'ACCUEIL : chaque page pré-rendue a le sien`);
      }
    }
  }

  // ── 10. Chaque page pré-rendue publie sa PROPRE description ────────────────
  // Le plugin posait le titre, le canonical et les méta Open Graph par route,
  // mais PAS la meta description : les pages pré-rendues publiaient donc toutes
  // celle de l'accueil. Un moteur lisait la même description pour /jobs,
  // /login, /register… — la description déclarée par route n'existait que dans
  // og:description. Chaque page doit désormais avoir la sienne, bornée à 160
  // caractères (au-delà, les moteurs tronquent).
  const homeDescription = metaContent(html, 'description');
  const seen = new Map();
  if (homeDescription) seen.set(homeDescription, ['index.html']);
  for (const page of PRERENDERED_PAGES) {
    const pagePath = path.join(buildDir, page);
    if (!existsSync(pagePath)) continue;
    const pageHtml = readFileSync(pagePath, 'utf8');
    const pageDescription = metaContent(pageHtml, 'description');
    if (!pageDescription.trim()) {
      errors.push(`${page} : meta description absente (la page hérite de celle de l'accueil, ou n'en a aucune)`);
      continue;
    }
    if (pageDescription.length > DESCRIPTION_MAX) {
      errors.push(
        `${page} : description de ${pageDescription.length} caractères (maximum ${DESCRIPTION_MAX}) — les moteurs la tronquent`
      );
    }
    if (!seen.has(pageDescription)) seen.set(pageDescription, []);
    seen.get(pageDescription).push(page);
  }
  for (const [, pages] of seen) {
    if (pages.length > 1) {
      errors.push(
        `description DUPLIQUÉE entre ${pages.join(' et ')} : chaque page doit décrire son propre contenu ` +
          '(une description recopiée n\'est pas un signal de qualité)'
      );
    }
  }

  if (errors.length === 0) {
    notices.push(`shell d'accueil : 1 h1, ${words} mots, ${internalLinks} liens internes, N.A.P. et SEO local conformes`);
    notices.push(`descriptions uniques sur ${seen.size} page(s) pré-rendue(s)`);
  }

  return { ok: errors.length === 0, errors, notices, words };
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = runHomeShellCheck();
  if (!result.ok) {
    console.error(`❌ Shell de la page d'accueil non conforme (${result.errors.length} problème(s)) :`);
    for (const message of result.errors) console.error(`   • ${message}`);
    process.exit(1);
  }
  console.log('✅ Shell de la page d\'accueil verrouillé :');
  for (const message of result.notices) console.log(`   ℹ️  ${message}`);
}
