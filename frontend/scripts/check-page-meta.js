#!/usr/bin/env node
/**
 * Garde : l'app et la coquille pré-rendue publient-elles les MÊMES métadonnées
 * pour une même URL — carte OG, titre, description ?
 *
 * ── Pourquoi ce garde ───────────────────────────────────────────────────────
 * Deux canaux publient les métadonnées d'une page : le HTML PRÉ-RENDU (écrit par
 * vite.config.js à partir de src/config/) et le RUNTIME (les pages, après
 * montage, via src/utils/seo.js). Tant que chacun déclarait ses textes et sa
 * carte de son côté, rien ne les empêchait de diverger : renommer un titre, une
 * description ou une carte d'un seul côté ne cassait aucun test, et un crawler
 * (qui lit le HTML pré-rendu) aurait annoncé autre chose qu'un navigateur (qui
 * exécute la page). Pire : /register, /forgot-password et /payment n'annonçaient
 * AUCUN texte au runtime — après une navigation interne, l'onglet gardait le
 * titre de la page précédente.
 *
 * ── Six règles, chacune capable d'échouer ───────────────────────────────────
 *   A. aucune déclaration hors table : un chemin de carte (/og-*.png) ou une clé
 *      i18n de src/config/page-meta.js écrit en dur dans src/ est une erreur —
 *      la seule déclaration vit dans les tables, que le build ET le runtime
 *      lisent. Un commentaire a le droit de nommer l'un et l'autre (contexte
 *      CHAÎNE), et les tables ont le droit d'écrire leurs propres valeurs.
 *   B. une page qui sert une route de la table n'appelle pas les hooks bas
 *      niveau (usePageTitle / usePageOpenGraph) : elle passe par usePageMeta().
 *      Les pages dont la route ne publie rien dans la table gardent la main
 *      (/jobs/:id tient son texte de la MISSION, /messages et /profile sont
 *      servies par le gabarit nu app.html) — le routage est LU dans src/App.js.
 *   C. chaque route de la table a une page qui appelle le hook — la table
 *      route → page vient d'App.js, jamais d'une liste recopiée ici (deux listes
 *      qui se comparent, c'est l'écart qui se répare au lieu de disparaître).
 *   D. chaque coquille du build annonce EXACTEMENT le titre, la description, ses
 *      variantes (og:, twitter:, name=title) ET la carte de la table, résolus
 *      dans src/i18n/fr.json (la langue des coquilles — <html lang="fr">).
 *   E. le périmètre n'est jamais vide : zéro coquille comparée est une ERREUR,
 *      jamais un vert (c'est le seul faux vert que ce garde peut produire).
 *   F. les cartes DÉDIÉES présentes dans public/ sont utilisées, et complètes :
 *      une carte ajoutée pour une page qui n'est pas pré-rendue (donc annoncée
 *      par aucune coquille) est une erreur, et une carte large SANS sa variante
 *      carrée aussi — sans quoi la page retomberait en silence sur la carte générique,
 *      c'est-à-dire exactement l'oubli que la déduction doit rendre impossible.
 *
 * ── Qui joue quoi, et quand ───────────────────────────────────────────────
 * A, B et C ne lisent QUE les sources (App.js, la table, les pages) : le BUILD
 * les joue lui-même (`assertPagesAnnounceTheirMeta`, appelée par vite.config.js),
 * donc `npm run build` échoue AVANT d'avoir écrit le premier octet. Sans cela, un
 * pré-déploiement dont une page n'annonce rien pouvait partir, la CI ne le voyant
 * qu'APRÈS le build. D, E et F comparent les coquilles écrites : elles n'ont de
 * sens qu'ici, une fois le build terminé.
 *
 * Quelles pages ont un visuel dédié n'est PAS une liste de ce fichier, ni du
 * code : la règle est le NOM du fichier (`public/og-<page>.png` + sa variante
 * carrée), et la liste des cartes présentes est le manifeste du générateur —
 * celui que check-og-assets.js confronte aux PNG versionnés. Le garde lit ce
 * manifeste par `fs`, le bundle l'inline par import : un seul fait, deux
 * chargeurs (comme src/i18n/fr.json), donc ajouter une carte ne peut plus être
 * oublié dans le code — relancer le générateur suffit.
 *
 * ── Limite assumée ────────────────────────────────────────────────────────
 * Les règles A et B lisent les SOURCES (expressions régulières), elles ne les
 * exécutent pas : une déclaration construite dynamiquement (`t('jobs' +
 * 'MetaTitle')`, un chemin de carte assemblé) leur échappe. La règle D, elle,
 * ne dépend d'aucun motif — elle compare le HTML écrit à ce que la table dit —
 * donc une telle déclaration resterait démasquée dès que le texte publié ne
 * serait plus celui de la table.
 *
 * Ce que ce garde ne compare pas, et pourquoi : les écrans clients servis par le
 * gabarit nu app.html (/dashboard, /profile — noindex) publient un titre neutre
 * VOLONTAIREMENT différent de celui de leur page ; ils sont NOMMÉS en notice
 * plutôt que passés sous silence. Les fiches /jobs/:id portent le texte de la
 * MISSION, qui n'existe pas avant la requête : elles n'ont donc pas de table à
 * confronter ici. Elles ont leur propre garde — scripts/check-job-og-contract.js
 * compare, sur une mission de référence et SANS serveur, le HTML du pré-rendu
 * (backend/kojo_job_og.py) à ce que l'application annonce (src/utils/jobSeo.js) —
 * et scripts/check-og-images.js vérifie en plus le déploiement réel en HTTP.
 *
 * Usage : node scripts/check-page-meta.js (le build, lui, n'en joue que A/B/C :
 * voir `assertPagesAnnounceTheirMeta`)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GENERIC_CARD, dedicatedCardsFrom } from '../src/config/og-cards.js';
import { PAGE_META, pageMetaKeys } from '../src/config/page-meta.js';
import { SITE_ORIGIN, metaContent, metaContents } from './site-meta.js';
import { ROUTES as AUDITED_ROUTES } from './check-og-images.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Les tables ont le droit d'écrire leurs chemins et leurs clés : c'est leur
// définition. Partout ailleurs, ce sont des déclarations concurrentes.
const TABLE_FILES = ['src/config/og-cards.js', 'src/config/page-meta.js'];
// Le module qui possède les métadonnées au runtime.
const HOOK_FILE = 'src/utils/seo.js';
const PRIMITIVES = ['usePageTitle', 'usePageOpenGraph'];
// Chemin de carte dans une CHAÎNE (guillemets ou backticks).
const CARD_LITERAL = /(?<=['"`])\/(og-[a-z0-9-]+\.png)/g;

const walk = (dir) => {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      found.push(...walk(full));
    } else if (['.js', '.jsx'].includes(path.extname(entry.name))) {
      found.push(full);
    }
  }
  return found;
};

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

/** Chemin d'un fichier relatif à `root`, en séparateurs POSIX (messages lisibles). */
const relativeOf = (root, file) => path.relative(root, file).split(path.sep).join('/');

/**
 * Table route → page, LUE dans src/App.js (jamais recopiée : deux listes qui se
 * comparent finissent par diverger). Un fichier peut servir plusieurs routes.
 *
 * @param {string} appSource Contenu de src/App.js ('' s'il est illisible).
 * @returns {{pageByRoute: Map<string, string>, routesByPage: Map<string, string[]>}}
 */
const readRouting = (appSource) => {
  const pageByRoute = new Map();
  const routesByPage = new Map();
  const pageModules = new Map();
  for (const match of appSource.matchAll(
    /const\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*['"](\.\/pages\/[^'"]+)['"]\s*\)/g
  )) {
    pageModules.set(match[1], `src/${match[2].replace(/^\.\//, '')}.js`);
  }
  // Chaque `<Route …>` jusqu'au suivant : le segment porte son path et sa page.
  for (const segment of appSource.split(/<Route\b/).slice(1)) {
    const routeMatch = segment.match(/path="([^"]*)"/);
    if (!routeMatch) continue;
    const name = [...pageModules.keys()].find((candidate) =>
      new RegExp(`<${candidate}\\s*/>`).test(segment)
    );
    if (!name) continue;
    const page = pageModules.get(name);
    pageByRoute.set(routeMatch[1], page);
    if (!routesByPage.has(page)) routesByPage.set(page, []);
    routesByPage.get(page).push(routeMatch[1]);
  }
  return { pageByRoute, routesByPage };
};

/**
 * Les règles qui ne lisent QUE les sources :
 *
 *   A. aucune déclaration hors table (carte ou clé i18n écrite en dur dans src/) ;
 *   B. une page qui sert une route de la table passe par usePageMeta(), pas par
 *      les hooks bas niveau ;
 *   C. chaque route de la table a une page qui l'annonce.
 *
 * Extraites du garde parce qu'elles ne dépendent d'AUCUN artefact de build : rien
 * ne justifiait de les découvrir après le build, donc `assertPagesAnnounceTheirMeta`
 * les joue DANS le build (vite.config.js) et `runPageMetaCheck` les rejoue en CI
 * avec les règles D/E/F, qui ont besoin des coquilles écrites.
 *
 * @returns {{errors: string[], pages: string[]}}
 */
const checkPageSources = ({ root, table }) => {
  const errors = [];
  const pages = [];
  const tableFiles = new Set(TABLE_FILES);

  // ── Le périmètre : sans src/, ces règles ne liraient rien ─────────────────
  const srcDir = path.join(root, 'src');
  if (!fs.existsSync(srcDir)) {
    errors.push(
      `src/ absent sous ${root} : ce garde lit les tables et les pages — sans elles il ne ` +
        'vérifierait rien (périmètre vide)'
    );
  }

  // ── Le routage (règle B et C) ─────────────────────────────────────────────
  const appPath = path.join(root, 'src', 'App.js');
  const appSource = fs.existsSync(appPath) ? fs.readFileSync(appPath, 'utf8') : '';
  const { pageByRoute, routesByPage } = readRouting(appSource);
  if (!appSource) {
    errors.push(
      'src/App.js introuvable : la table route → page ne peut pas être lue, donc les règles ' +
        '« une page de route passe par le hook » et « chaque route est annoncée » ne ' +
        'porteraient sur rien'
    );
  } else if (pageByRoute.size === 0) {
    errors.push(
      'aucune route reconnue dans src/App.js (motif « const X = lazy(() => ' +
        "import('./pages/X')) » puis « <Route path=\"/…\" element={<X />} />») : les règles B " +
        'et C ne porteraient sur aucune page'
    );
  }

  // ── Règle A + B : ce que le code applicatif a le droit d'écrire ───────────
  const declaredKeys = [
    ...new Set(
      Object.values(table)
        .flatMap((keys) => [keys.title, keys.description])
        .filter(Boolean)
    ),
  ];

  for (const file of fs.existsSync(srcDir) ? walk(srcDir) : []) {
    const relative = relativeOf(root, file);
    const source = fs.readFileSync(file, 'utf8');

    if (!tableFiles.has(relative)) {
      for (const match of source.matchAll(CARD_LITERAL)) {
        errors.push(
          `${relative}:${lineOf(source, match.index)} écrit la carte « /${match[1]} » en dur — ` +
            'la seule déclaration est src/config/og-cards.js, lue par le build ET par le ' +
            'runtime ; la page doit annoncer la sienne via usePageMeta()'
        );
      }
      for (const key of declaredKeys) {
        const occurrence = source.includes(`'${key}'`) ? `'${key}'` : `"${key}"`;
        const index = source.indexOf(occurrence);
        if (index >= 0) {
          errors.push(
            `${relative}:${lineOf(source, index)} écrit la clé « ${key} » en dur — le titre et ` +
              'la description d’une route sont déclarés UNE fois, dans src/config/page-meta.js ' +
              '(lue par le build ET par le runtime) ; la page doit appeler usePageMeta()'
          );
        }
      }
    }

    const routes = routesByPage.get(relative) || [];
    if (relative !== HOOK_FILE && routes.some((route) => Boolean(pageMetaKeys(route)))) {
      for (const primitive of PRIMITIVES) {
        const index = source.search(new RegExp(`\\b${primitive}\\b`));
        if (index >= 0) {
          errors.push(
            `${relative}:${lineOf(source, index)} utilise ${primitive}() alors que sa route ` +
              `publie son texte depuis la table (${routes.join(', ')}) — une page de route ` +
              'annonce ses métadonnées via usePageMeta(); les hooks bas niveau ne servent qu’à ' +
              'une page dont le texte vient d’une DONNÉE (voir src/utils/seo.js)'
          );
        }
      }
    }
  }

  // ── Règle C : chaque route de la table a une page qui l'annonce ───────────
  for (const route of Object.keys(table)) {
    const page = pageByRoute.get(route);
    if (!page) {
      if (!appSource) continue // déjà signalé : sans App.js, il n'y a pas de table de routage
      errors.push(
        `la route « ${route} » publie un titre/description (src/config/page-meta.js) mais aucune ` +
          'Route de src/App.js ne lui associe une page : la table et le routage ont divergé'
      );
      continue;
    }
    const full = path.join(root, page);
    if (!fs.existsSync(full)) {
      errors.push(`la page « ${page} », qui sert la route « ${route} », est introuvable`);
      continue;
    }
    if (!/usePageMeta\s*\(/.test(fs.readFileSync(full, 'utf8'))) {
      errors.push(
        `la page ${page} n’appelle pas usePageMeta() : au runtime la route « ${route} » annonce ` +
          'AUCUN texte alors que sa coquille en publie un — après une navigation interne, l’onglet ' +
          'garde le titre de la page précédente (c’était le cas de /register, /forgot-password ' +
          'et /payment)'
      );
      continue;
    }
    pages.push(`  ✓ ${route} → ${page}`);
  }

  return { errors, pages };
};

/**
 * Lève si une page de route PUBLIQUE n'annonce pas ses métadonnées.
 *
 * Appelée par le BUILD (`buildStart` du plugin require-page-meta dans
 * vite.config.js) : les règles A/B/C ne lisent que les sources, donc elles se
 * tranchent AVANT d'écrire le premier octet — là où la CI ne pouvait les voir
 * qu'APRÈS le build, c'est-à-dire après qu'un pré-déploiement à une page muette
 * aurait pu partir.
 *
 * @param {object} [options]
 * @param {string} [options.root] Racine du frontend (injectable pour les tests).
 * @param {object} [options.table] Table route → clés i18n (défaut : PAGE_META).
 * @throws {Error} Toutes les violations, nommées, en une fois.
 */
export function assertPagesAnnounceTheirMeta({ root = FRONTEND_DIR, table = PAGE_META } = {}) {
  const { errors } = checkPageSources({ root, table });
  if (errors.length === 0) return;
  throw new Error(
    `métadonnées de page : ${errors.length} problème(s), le build refuse de produire un bundle ` +
      'dans cet état (une page de route publique annonce ses métadonnées via usePageMeta(), et ' +
      'les tables de src/config/ sont la seule déclaration) :\n  - ' +
      errors.join('\n  - ')
  );
}

/**
 * Exécute le garde complet — les règles A/B/C (sources) puis D/E/F (coquilles).
 *
 * @param {object} [options]
 * @param {string} [options.root] Racine du frontend (injectable pour les tests).
 * @param {object} [options.table] Table route → clés i18n (défaut : PAGE_META,
 *   injectable pour éprouver le cas d'une table vide).
 * @param {boolean} [options.quiet] Tait la sortie de progression.
 * @returns {{ok: boolean, errors: string[], checked: string[], pages: string[],
 *   notices: string[]}}
 */
export function runPageMetaCheck({ root = FRONTEND_DIR, quiet = false, table = PAGE_META } = {}) {
  const errors = [];
  const checked = [];
  const pages = [];
  const notices = [];
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };

  // Les cartes réellement PRÉSENTES (manifeste du générateur) : c'est d'elles que
  // dérive « cette page a-t-elle un visuel dédié », pour le garde comme pour le
  // bundle. Un manifeste illisible viderait la comparaison de son sens.
  let dedicatedCards = {};
  let incompleteCards = [];
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'scripts', 'og-assets.manifest.json'), 'utf8')
    );
    ({ cards: dedicatedCards, incomplete: incompleteCards } = dedicatedCardsFrom(
      (manifest.assets || []).map((asset) => asset.file)
    ));
  } catch (error) {
    errors.push(
      `scripts/og-assets.manifest.json illisible (${error.message}) : les cartes attendues ne ` +
        'peuvent pas être déduites — relancer le générateur (scripts/gen-og-images.py)'
    );
  }

  // ── Règles A, B et C : les sources — les MÊMES que joue le build ──────────
  const source = checkPageSources({ root, table });
  errors.push(...source.errors);
  pages.push(...source.pages);

  // ── Règle D : les coquilles du build annoncent la table ───────────────────
  let fr = null;
  try {
    fr = JSON.parse(fs.readFileSync(path.join(root, 'src', 'i18n', 'fr.json'), 'utf8'));
  } catch (_err) {
    errors.push(
      'src/i18n/fr.json illisible : les textes attendus ne peuvent pas être résolus — la ' +
        'comparaison porterait sur du vide'
    );
  }

  const resolved = new Map();
  const textOf = (key) => {
    if (resolved.has(key)) return resolved.get(key);
    const value = fr ? fr[key] : null;
    let text = '';
    if (typeof value !== 'string' || !value.trim()) {
      errors.push(
        `src/i18n/fr.json : la clé « ${key} », déclarée dans src/config/page-meta.js, est absente ` +
          'ou vide — la coquille et la page publieraient un texte vide'
      );
    } else {
      text = value;
    }
    resolved.set(key, text);
    return text;
  };

  const buildDir = path.join(root, 'build');
  if (!fs.existsSync(buildDir)) {
    errors.push(
      `${relativeOf(root, buildDir) || 'build'}/ absent : aucune coquille pré-rendue à comparer. ` +
        'Lancer `npm run build` avant ce garde (sinon il serait vert sans avoir rien lu).'
    );
  } else {
    for (const [route, keys] of Object.entries(table)) {
      const shell = route === '/' ? 'index.html' : `${route.slice(1)}.html`;
      const full = path.join(buildDir, shell);
      if (!fs.existsSync(full)) {
        errors.push(
          `${shell} absent : la route « ${route} » est pré-rendue (elle publie un texte dans ` +
            'src/config/page-meta.js) mais son HTML n’a pas été écrit — elle serait servie par le ' +
            'gabarit nu, dont le titre neutre diffère de celui de l’app'
        );
        continue;
      }

      const html = fs.readFileSync(full, 'utf8');
      const title = textOf(keys.title);
      const description = keys.description ? textOf(keys.description) : '';
      const expected = {
        '<title>': title,
        'name=title': title,
        description,
        'og:title': title,
        'og:description': description,
        'twitter:title': title,
        'twitter:description': description,
      };
      const actual = {
        '<title>': (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '',
        'name=title': metaContent(html, 'title'),
        description: metaContent(html, 'description'),
        'og:title': metaContent(html, 'og:title'),
        'og:description': metaContent(html, 'og:description'),
        'twitter:title': metaContent(html, 'twitter:title'),
        'twitter:description': metaContent(html, 'twitter:description'),
      };
      for (const [label, want] of Object.entries(expected)) {
        if (actual[label] !== want) {
          errors.push(
            `${shell} : ${label} annonce « ${actual[label] || '(absent)'} », la table dit ` +
              `« ${want} » pour ${route} — l’app et la coquille publieraient deux textes différents`
          );
        }
      }

      // Carte OG (wide + variante carrée) : la coquille doit annoncer celles
      // DÉDUITES des cartes présentes, sinon le partage d'un lien montrerait une
      // autre image qu'un crawler ayant exécuté le JavaScript.
      const card = dedicatedCards[route] || GENERIC_CARD;
      const images = metaContents(html, 'og:image');
      const wide = images[0] || '';
      const square = images.find((url) => url.includes('square')) || '';
      const twitterImage = metaContent(html, 'twitter:image');
      const expectedWide = `${SITE_ORIGIN}${card.image}`;
      const expectedSquare = `${SITE_ORIGIN}${card.imageSquare}`;
      if (!wide.endsWith(expectedWide)) {
        errors.push(
          `${shell} : og:image annonce « ${wide || '(absent)'} », la table dit ` +
            `« ${expectedWide} » pour ${route} — deux cartes différentes`
        );
      }
      if (!square.endsWith(expectedSquare)) {
        errors.push(
          `${shell} : variante carrée « ${square || '(absente)'} », la table dit ` +
            `« ${expectedSquare} » pour ${route}`
        );
      }
      if (!twitterImage.endsWith(expectedWide)) {
        errors.push(
          `${shell} : twitter:image annonce « ${twitterImage || '(absent)'} », la table dit ` +
            `« ${expectedWide} » pour ${route}`
        );
      }

      checked.push(`  ✓ ${route} → « ${title} »`);
    }
  }

  // ── Règle F : les cartes dédiées présentes sont complètes ET utilisées ─────
  for (const file of incompleteCards) {
    errors.push(
      `public${file} n’a pas sa variante carrée (og-…-square.png) : la page servie par cette ` +
        'carte retomberait EN SILENCE sur la carte générique. Le nom du fichier EST la ' +
        'déclaration d’un visuel dédié — générer les deux formats d’un coup'
    );
  }
  for (const route of Object.keys(dedicatedCards)) {
    if (Object.hasOwn(table, route)) continue;
    errors.push(
      `la carte dédiée « ${dedicatedCards[route].image} » sert la route « ${route} », qui n’est ` +
        'pas pré-rendue (src/config/page-meta.js) : aucune coquille ne l’annonce, donc aucun ' +
        'crawler ne la voit. Ajouter la route à la table des textes (elle a alors sa coquille), ' +
        'ou retirer le visuel'
    );
  }

  // Ce qui n'est PAS comparable, dit explicitement : les pages auditées sans texte
  // par route sont servies par le gabarit nu (titre neutre voulu).
  if (table === PAGE_META) {
    for (const route of AUDITED_ROUTES) {
      if (pageMetaKeys(route.path)) continue;
      notices.push(
        `${route.path} : page auditée servie par le gabarit nu (app.html, noindex) — aucun ` +
          'texte de route à comparer ici (sa carte OG l’est par check-og-images.js)'
      );
    }
  }

  log(`Métadonnées de page : app et coquilles pré-rendues (${checked.length} route(s)) :`);
  log(checked.join('\n'));
  log(
    'Cartes dédiées déduites des fichiers présents : ' +
      (Object.entries(dedicatedCards)
        .map(([route, card]) => `${route} → ${card.image}`)
        .join(', ') || '(aucune) — toutes les pages reçoivent la carte générique')
  );
  if (pages.length) log(`Pages de route annonçant la table (${pages.length}) :\n${pages.join('\n')}`);
  for (const notice of notices) log(`  ⚠️ ${notice}`);

  // ── Règle E : un vert sans rien comparé ne prouve rien ────────────────────
  if (checked.length === 0 && errors.length === 0) {
    errors.push(
      'aucune métadonnée comparée : la table est vide ou le build ne contient aucune de ses ' +
        'routes — un vert dans cet état ne prouverait rien'
    );
  }

  return { ok: errors.length === 0, errors, checked, pages, notices };
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = runPageMetaCheck();
  for (const notice of result.notices) {
    console.log(`::notice title=Métadonnées non comparables::${notice}`);
  }
  if (!result.ok) {
    console.error(`\n❌ Métadonnées de page app/coquille — ${result.errors.length} problème(s) :`);
    for (const error of result.errors) console.error(`  ${error}`);
    process.exit(1);
  }
  console.log(
    `\n✅ Titre, description et carte cohérents : ${result.checked.length} coquille(s) ` +
      `pré-rendue(s) annoncent la table src/config/page-meta.js, et ${result.pages.length} page(s) ` +
      'de route annoncent la leur via usePageMeta().'
  );
}
