#!/usr/bin/env node
/**
 * Garde : l'app et la coquille pré-rendue annoncent-elles la MÊME carte OG ?
 *
 * Pourquoi ce garde
 * -----------------
 * Deux canaux publient og:image pour la même URL : le HTML PRÉ-RENDU (écrit par
 * vite.config.js à partir de la table, vérifié en HTTP par check-og-images.js)
 * et le RUNTIME (les pages, après montage, via src/utils/seo.js). Tant que
 * chacun déclarait la carte de son côté (c'était le cas de /login : un chemin
 * dans src/pages/Login.js, un autre dans la table des coquilles), rien ne les
 * empêchait de diverger : changer une image d'un seul côté ne cassait aucun
 * test, et un crawler (HTML pré-rendu) aurait annoncé une autre carte qu'un
 * navigateur (page exécutée).
 *
 * Trois règles, chacune capable d'échouer :
 *   A. aucun chemin de carte (`/og-*.png`) écrit en dur dans src/ — la seule
 *      déclaration vit dans src/config/og-cards.js, que le build lit aussi ;
 *   B. dans src/pages, `ogCardUrl()` est appelé SANS argument : la carte suit
 *      l'URL courante, donc une page ne peut pas annoncer la carte d'une autre
 *      route (le shell, lui, est écrit pour SON fichier de route) ;
 *   C. pour chaque route qui a une coquille dans build/, l'og:image servi est
 *      EXACTEMENT la carte de la table (wide + variante carrée).
 *
 * Une route sans coquille (/dashboard, /profile — servies par app.html) ne peut
 * pas être comparée : elle est NOMMÉE dans la sortie plutôt que passée sous
 * silence, et l'absence totale de coquille est une erreur (le garde ne doit pas
 * pouvoir être vert en n'ayant rien lu).
 *
 * Usage : node scripts/check-og-runtime-cards.js [--root .]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ogCardFor } from '../src/config/og-cards.js';
import { ROUTES } from './check-og-images.js';
import { SITE_ORIGIN, metaContents } from './site-meta.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// La table elle-même a le droit d'écrire les chemins : c'est SA définition.
const TABLE_FILE = path.join('src', 'config', 'og-cards.js');
// Chemin de carte dans une CHAÎNE (guillemets ou backticks). Le contexte "chaîne"
// compte : un commentaire a le droit de nommer /og-jobs.png pour expliquer une
// règle — seule une valeur annoncée au crawler crée la divergence.
const CARD_LITERAL = /(?<=['"`])\/(og-[a-z0-9-]+\.png)/g;
// `ogCardUrl()` sans argument, ou `ogCardUrl(autre chose)` : on veut le premier.
const OG_CARD_CALL = /ogCardUrl\(\s*([^)]*)\)/g;
// Arguments d’un appel `usePageOpenGraph({ ... })` (objet à plat dans ce dépôt).
const OG_ANNOUNCEMENT = /usePageOpenGraph\(\s*\{([\s\S]*?)\}\s*\)/g;

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

/**
 * Exécute le garde.
 *
 * @param {object} [options]
 * @param {string} [options.root] Racine du frontend (injectable pour les tests).
 * @param {boolean} [options.quiet] Tait la sortie de progression.
 * @returns {{ok: boolean, errors: string[], checked: string[], notices: string[]}}
 */
export function runOgRuntimeCardsCheck({ root = FRONTEND_DIR, quiet = false } = {}) {
  const errors = [];
  const checked = [];
  const notices = [];
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };

  // ── Règle A + B : ce que l'app a le droit d'écrire ──────────────────────
  const srcDir = path.join(root, 'src');
  if (!fs.existsSync(srcDir)) {
    errors.push(
      `src/ absent sous ${root} : ce garde lit les pages pour y chercher une carte écrite en ` +
        'dur — sans elles il ne vérifierait rien'
    );
  }
  for (const file of fs.existsSync(srcDir) ? walk(srcDir) : []) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const source = fs.readFileSync(file, 'utf8');

    if (relative !== TABLE_FILE.split(path.sep).join('/')) {
      for (const match of source.matchAll(CARD_LITERAL)) {
        errors.push(
          `${relative}:${lineOf(source, match.index)} écrit la carte « /${match[1]} » en dur — ` +
            'la seule déclaration est src/config/og-cards.js, lue par le build ET par le ' +
            'runtime ; utiliser ogCardUrl(), sinon l’app et la coquille peuvent diverger'
        );
      }
    }

    if (relative.startsWith('src/pages/')) {
      for (const match of source.matchAll(OG_CARD_CALL)) {
        const argument = match[1].trim();
        if (argument) {
          errors.push(
            `${relative}:${lineOf(source, match.index)} appelle ogCardUrl(${argument}) : la carte ` +
              'doit suivre l’URL COURANTE (ogCardUrl() sans argument), sinon la page peut ' +
              'annoncer la carte d’une autre route'
          );
        }
      }

      // Une page qui annonce des méta OG DOIT passer une carte : sans `image:`,
      // le hook retombe sur le favicon et le runtime cesse d’annoncer ce que la
      // coquille annonce — précisément la divergence que ce garde interdit.
      // Deux formes sont légitimes : la carte de la route (ogCardUrl()) ou la
      // carte DYNAMIQUE d’une mission (/api/og/jobs/<id>.png, servie par le
      // backend), qui n’appartient pas à la table des routes statiques.
      for (const match of source.matchAll(OG_ANNOUNCEMENT)) {
        const annonce = match[1];
        if (!annonce.includes('ogCardUrl(') && !annonce.includes('/api/og/jobs/')) {
          errors.push(
            `${relative}:${lineOf(source, match.index)} annonce des méta OG sans carte dérivée de ` +
              'la table : passer `ogCardUrl()` (carte de la route courante) ou la carte dynamique ' +
              'd’une mission (/api/og/jobs/<id>.png), sinon le runtime annonce le favicon'
          );
        }
      }
    }
  }

  // ── Règle C : la coquille servie porte bien la carte de la table ────────
  const buildDir = path.join(root, 'build');
  if (!fs.existsSync(buildDir)) {
    errors.push(
      `${path.relative(root, buildDir) || 'build'}/ absent : aucune coquille pré-rendue à comparer. ` +
        'Lancer `npm run build` avant ce garde (sinon il serait vert sans avoir rien lu).'
    );
  } else {
    for (const route of ROUTES) {
      const shell = route.path === '/' ? 'index.html' : `${route.path.slice(1)}.html`;
      const full = path.join(buildDir, shell);
      if (!fs.existsSync(full)) {
        notices.push(
          `${route.path} : pas de coquille « ${shell} » (route servie par app.html) — carte non comparable ici`
        );
        log(`  ⚠️ ${notices[notices.length - 1]}`);
        continue;
      }
      const html = fs.readFileSync(full, 'utf8');
      const card = ogCardFor(route.path);
      const images = metaContents(html, 'og:image');
      const wide = images[0] || '';
      const square = images.find((url) => url.includes('square')) || '';
      const expectedWide = `${SITE_ORIGIN}${card.image}`;
      const expectedSquare = `${SITE_ORIGIN}${card.imageSquare}`;

      if (!wide.endsWith(expectedWide)) {
        errors.push(
          `${shell} : og:image annonce « ${wide || '(absent)'} », la table dit « ${expectedWide} » pour ` +
            `${route.path} — le runtime et la coquille publieraient deux cartes différentes`
        );
      }
      if (!square.endsWith(expectedSquare)) {
        errors.push(
          `${shell} : variante carrée « ${square || '(absente)'} », la table dit « ${expectedSquare} »`
        );
      }
      checked.push(`  ✓ ${route.path} → ${expectedWide} (+ ${expectedSquare})`);
    }
  }

  log(`Cartes OG : app et coquilles pré-rendues (${checked.length} route(s) comparée(s)) :`);
  log(checked.join('\n'));

  if (checked.length === 0 && errors.length === 0) {
    errors.push(
      'aucune coquille comparée : le garde n’a rien lu (build incomplet, table vide) — un vert ' +
        'dans cet état ne prouverait rien'
    );
  }

  return { ok: errors.length === 0, errors, checked, notices };
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg > -1 ? process.argv[rootArg + 1] : FRONTEND_DIR;
  const result = runOgRuntimeCardsCheck({ root: path.resolve(root) });
  for (const notice of result.notices) {
    console.log(`::notice title=Cartes OG non comparables::${notice}`);
  }
  if (!result.ok) {
    console.error(`\n❌ Cartes OG app/coquille — ${result.errors.length} problème(s) :`);
    for (const error of result.errors) console.error(`  ${error}`);
    process.exit(1);
  }
  console.log(
    `\n✅ Cartes OG cohérentes : l’app dérive ses cartes de src/config/og-cards.js (aucun chemin ` +
      `en dur) et ${result.checked.length} coquille(s) pré-rendue(s) annoncent exactement ces cartes.`
  );
}
