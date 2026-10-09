#!/usr/bin/env node
/**
 * BUDGET DE CSS INLINE PAR PAGE PRÉ-RENDUE — la feuille critique est recopiée
 * dans CHAQUE document, et rien ne la comptait page par page.
 *
 * ── Le trou qu'il ferme ────────────────────────────────────────────────────
 * `vite-plugins/inline-critical-css.js` inline la feuille render-blocking de
 * l'entrée dans le HTML du build, puis supprime le fichier `.css` : c'est le
 * gain mesuré du premier rendu (~140 ms, le `<link rel="stylesheet">` bloquait
 * le paint). Le prix est que ces octets sont recopiés dans TOUS les documents
 * servis, et qu'ils sont lus AVANT le premier paint — c'est la définition même
 * du CSS critique.
 *
 * `scripts/check-bundle-size.js` portait ce fait, mais seulement en PROSE, et
 * dans son budget le plus large (le build total), où il est noyé : « ~1,5 Mo de
 * la MÊME feuille de styles pré-rendue recopiée dans les 22 pages (69 Ko × 22) ».
 * Mesuré le 09/10/2026 sur le build réel : le compte de prose était FAUX — il y
 * a 14 documents HTML, dont 13 portent la même feuille, soit 900 980 o de CSS
 * inline (0,86 Mo), et non 1,5 Mo. Deux conséquences, et c'est le motif de ce
 * garde : un budget GLOBAL ne dit jamais QUELLE page a enflé, ni de combien ; et
 * un fait qui n'existe qu'en prose dérive sans que rien ne rougisse.
 *
 * ── Ce qui est mesuré (build réel, `npm run build`, 09/10/2026) ─────────────
 *
 *   document(s)                                  octets  blocs  règles  sha256(16)
 *   index.html + 12 autres (about, app, contact,
 *   forgot-password, how-it-works, jobs, login,
 *   payment, privacy, register, support, terms)   69 276      1     936  d8c74e2cb457a497
 *   404.html                                         392      1       6  8108c4546aacc8b6
 *
 *   gzip de la feuille partagée : 13 111 o. Total CSS inline du build : 900 980 o.
 *
 * ── Les six refus, chacun NOMMÉ ────────────────────────────────────────────
 *   1. DÉPASSEMENT — une page au-dessus de son budget, avec ses octets, son
 *      budget et l'excès en pourcentage. C'est le budget lui-même.
 *   2. PLANCHER — une page SOUS son plancher : la contrepartie sans laquelle ce
 *      garde serait un faux vert. Un document qui PERD sa feuille critique est
 *      plus léger, donc un budget plafond seul le déclarerait « meilleur » — or
 *      c'est exactement la régression que le plugin existe pour empêcher (le
 *      `<link>` render-blocking revient, ou la page peint sans styles).
 *   3. BLOCS — un nombre de `<style>` différent de celui déclaré : attrape la
 *      feuille partie dans un fichier (0 bloc) et une seconde feuille inlinée
 *      sans propriétaire (2).
 *   4. FEUILLE DIVERGENTE — les treize pages pré-rendues portent la MÊME
 *      feuille (c'est un seul objet recopié par construction). Une page qui en
 *      porte une autre doit le DÉCLARER (`feuille: son propre nom`) ; sinon le
 *      garde nomme les deux pages et leurs empreintes. Sans cette règle, deux
 *      coquilles pourraient peindre deux géométries différentes sans que rien
 *      ne le dise — la classe de défaut que le dépôt ferme partout ailleurs par
 *      un propriétaire unique.
 *   5. PAGE SANS LIGNE — un `build/*.html` absent de la table : une route
 *      pré-rendue ajoutée passe ici en étant NOMMÉE, au lieu d'entrer dans
 *      aucun budget.
 *   6. LIGNE PÉRIMÉE — une ligne de la table qu'aucun document du build ne
 *      porte. C'est l'exemption qui survit à son sujet : une page retirée du
 *      pré-rendu laisse sinon son budget dans la table pour toujours.
 *
 * Et deux PLANCHERS DE LECTURE : un build vide, ou un build dont on n'a lu
 * qu'une ou deux pages, fait REFUSER le verdict au lieu de le rendre vert sur
 * ce qu'il n'a pas regardé — la règle du dépôt pour tout garde qui balaie.
 *
 * ── Les valeurs sont MESURÉES, pas choisies ────────────────────────────────
 * 71 680 o (70 Ko) = relevé du jour + 2 404 o, soit +3,5 %. Le plancher,
 * 61 440 o (60 Ko), laisse 7 836 o sous le relevé : il attrape une feuille qui
 * DISPARAÎT, pas une feuille qui mincit d'un octet. `404.html` a son propre
 * couple (2 048 / 256 o) : c'est un document minimal, pas une page pré-rendue.
 * Une modification de ces nombres doit s'accompagner d'une mesure du build réel
 * et d'une explication — comme les budgets de `check-bundle-size.js`.
 *
 * ── Le périmètre, écrit plutôt qu'implicite ─────────────
 * Le balayage lit `build/*.html`, au premier niveau. C'est le périmètre mesuré :
 * les 14 documents du build y sont tous (aucun sous-dossier ne porte de HTML
 * aujourd'hui — les cartes OG vivent sous `build/og/` en `.png`). Un pré-rendu
 * qui publierait un jour `build/<dossier>/page.html` ne serait PAS vu : il
 * faudrait étendre la lecture, et c'est écrit ici pour que ce soit un choix et
 * non une surprise. Le budget porte sur les octets BRUTS (ce que le document
 * fait lire au parseur) ; le gzip de la feuille partagée est relevé dans le
 * commentaire de la table, il n'est pas borné.
 *
 * Usage : cd frontend && npm run build && node scripts/check-css-inline-budget.js
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KO = 1024;

/** Le propriétaire de la feuille partagée : celle que les douze autres recopient. */
export const FEUILLE_DE_REFERENCE = 'index.html';

/**
 * La table, une ligne PAR DOCUMENT du build.
 *
 * `budget` et `plancher` sont en OCTETS. `blocs` est le nombre de `<style>`
 * attendu dans le document. `feuille` dit QUELLE feuille la page doit porter :
 * son propre nom quand elle en est le propriétaire, celui d'une autre quand elle
 * la recopie. Une page qui divergerait doit donc changer sa ligne — c'est-à-dire
 * le dire — au lieu de dériver en silence.
 */
export const CSS_INLINE_BUDGETS = {
  // Relevé 09/10/2026 : 69 276 o / 13 111 o gzip / 936 règles / sha d8c74e2cb457a497.
  'index.html': { budget: 71680, plancher: 61440, blocs: 1, feuille: 'index.html' },
  'about.html': { budget: 71680, plancher: 61440, blocs: 1, feuille: 'index.html' },
  'app.html': { budget: 71680, plancher: 61440, blocs: 1, feuille: 'index.html' },
  'contact.html': { budget: 71680, plancher: 61440, blocs: 1, feuille: 'index.html' },
  'forgot-password.html': { budget: 71680, plancher: 61440, blocs: 1, feuille: 'index.html' },
  'how-it-works.html': { budget: 71680, plancher: 61440, blocs: 1, feuille: 'index.html' },
  'jobs.html': { budget: 71680, plancher: 61440, blocs: 1, feuille: 'index.html' },
  'login.html': { budget: 71680, plancher: 61440, blocs: 1, feuille: 'index.html' },
  'payment.html': { budget: 71680, plancher: 61440, blocs: 1, feuille: 'index.html' },
  'privacy.html': { budget: 71680, plancher: 61440, blocs: 1, feuille: 'index.html' },
  'register.html': { budget: 71680, plancher: 61440, blocs: 1, feuille: 'index.html' },
  'support.html': { budget: 71680, plancher: 61440, blocs: 1, feuille: 'index.html' },
  'terms.html': { budget: 71680, plancher: 61440, blocs: 1, feuille: 'index.html' },
  // Le document minimal n'a pas la feuille critique : il a la sienne, et courte.
  // Relevé 09/10/2026 : 392 o / 6 règles / sha 8108c4546aacc8b6.
  '404.html': { budget: 2048, plancher: 256, blocs: 1, feuille: '404.html' },
};

/**
 * En dessous, la lecture est réputée incomplète et le garde refuse de juger.
 * Mesuré : 14 documents, 12 174 règles au total (936 × 13 + 6).
 */
export const PLANCHERS_DE_LECTURE = { pages: 10, regles: 1000 };

const MOTIF_BLOC = /<style[^>]*>([\s\S]*?)<\/style>/g;

/**
 * La feuille inlinée d'un document : ses octets, ses blocs, ses règles, son
 * empreinte.
 *
 * La somme se fait sur les BLOCS concaténés (et non sur le premier trouvé) :
 * deux `<style>` dans un document sont alors comptés ensemble, et c'est le
 * nombre de blocs qui les dénonce — un garde qui ne lirait que le premier
 * laisserait une seconde feuille entrer sans budget.
 *
 * @param {string} html Le document tel qu'il est servi.
 * @returns {{ octets: number, blocs: number, regles: number, sha: string }}
 */
export const lireFeuilleInlinee = (html) => {
  const blocs = [...String(html).matchAll(MOTIF_BLOC)].map((m) => m[1]);
  const css = blocs.join('');
  return {
    octets: Buffer.byteLength(css, 'utf8'),
    blocs: blocs.length,
    regles: (css.match(/\{/g) || []).length,
    sha: createHash('sha256').update(css, 'utf8').digest('hex').slice(0, 16),
  };
};

const ko = (octets) => `${(octets / KO).toFixed(2)} Ko`;

/**
 * Le verdict du budget de CSS inline, sur des pages DÉJÀ LUES.
 *
 * Pure : elle ne touche pas au disque, donc elle se prouve avec des fixtures.
 *
 * @param {object} options
 * @param {Array<{nom: string, octets: number, blocs: number, regles: number, sha: string}>} options.pages
 * @param {Record<string, {budget: number, plancher: number, blocs: number, feuille: string}>} [options.budgets]
 * @param {string} [options.reference] La page propriétaire de la feuille partagée.
 * @param {{pages: number, regles: number}} [options.planchers]
 * @returns {{errors: string[], stats: object}}
 */
export const auditCssInline = ({
  pages,
  budgets = CSS_INLINE_BUDGETS,
  reference = FEUILLE_DE_REFERENCE,
  planchers = PLANCHERS_DE_LECTURE,
} = {}) => {
  const errors = [];
  const lues = Array.isArray(pages) ? pages : [];
  const totalRegles = lues.reduce((somme, p) => somme + (p.regles || 0), 0);

  // ── Les planchers de lecture, AVANT tout verdict ────────────────────────
  // Un build vide rendrait les six refus ci-dessous silencieux : c'est le faux
  // vert qu'un garde de balayage doit refuser explicitement.
  if (lues.length < planchers.pages) {
    errors.push(
      `lecture incomplète : ${lues.length} document(s) lu(s) pour un plancher de ` +
        `${planchers.pages} — le build est-il complet ?`
    );
  }
  if (totalRegles < planchers.regles) {
    errors.push(
      `lecture incomplète : ${totalRegles} règle(s) de CSS inline au total pour un ` +
        `plancher de ${planchers.regles} — la feuille lue n'est pas celle du site`
    );
  }

  const referenceLigne = budgets[reference];
  const referencePage = lues.find((p) => p.nom === reference);
  if (!referenceLigne || !referencePage) {
    // Sans la page de référence, chaque comparaison d'empreinte serait faite
    // contre `undefined` et passerait : le refus est ici, pas plus loin.
    errors.push(
      `la feuille de référence « ${reference} » est absente ` +
        `(${referenceLigne ? 'page absente du build' : 'aucune ligne dans la table'}) — ` +
        `les empreintes des autres pages ne peuvent pas être comparées`
    );
  }

  const noms = new Set(lues.map((p) => p.nom));
  const sansLigne = lues.filter((p) => !budgets[p.nom]);
  const perimees = Object.keys(budgets).filter((nom) => !noms.has(nom));

  if (sansLigne.length > 0) {
    errors.push(
      `page(s) pré-rendue(s) sans budget : ${sansLigne
        .map((p) => `${p.nom} (${p.octets} o)`)
        .join(', ')} — déclarer chacune dans CSS_INLINE_BUDGETS ` +
        `(scripts/check-css-inline-budget.js), avec sa mesure du build réel`
    );
  }
  if (perimees.length > 0) {
    errors.push(
      `ligne(s) PÉRIMÉE(S) : ${perimees.join(', ')} — aucun document du build ne les ` +
        `porte ; retirer la ligne ou rétablir la page (une exemption qui survit à son sujet)`
    );
  }

  for (const page of lues) {
    const ligne = budgets[page.nom];
    if (!ligne) continue;

    if (page.octets > ligne.budget) {
      const exces = page.octets - ligne.budget;
      errors.push(
        `${page.nom} : ${page.octets} o de CSS inline > budget ${ligne.budget} o ` +
          `(+${exces} o, +${((exces / ligne.budget) * 100).toFixed(1)} %) — ces octets sont ` +
          `lus AVANT le premier paint de cette page, et recopiés dans chaque document`
      );
    }
    if (page.octets < ligne.plancher) {
      errors.push(
        `${page.nom} : ${page.octets} o de CSS inline < plancher ${ligne.plancher} o — ` +
          `la feuille critique n'est plus inlinée : le <link rel="stylesheet"> ` +
          `render-blocking est revenu, ou la page peint sans styles`
      );
    }
    if (page.blocs !== ligne.blocs) {
      errors.push(
        `${page.nom} : ${page.blocs} bloc(s) <style> pour ${ligne.blocs} déclaré(s) — ` +
          (page.blocs === 0
            ? 'aucun CSS inline : le plugin d’inlining n’a rien fait sur ce document'
            : 'une seconde feuille est entrée sans propriétaire déclaré')
      );
    }
    if (referencePage && ligne.feuille === reference && page.nom !== reference) {
      if (page.sha !== referencePage.sha) {
        errors.push(
          `${page.nom} porte une feuille DIFFÉRENTE de celle de ${reference} ` +
            `(sha ${page.sha} contre ${referencePage.sha}, ${page.octets} o contre ` +
            `${referencePage.octets} o) — si la divergence est voulue, la DÉCLARER dans ` +
            `la table (une page, une ligne)`
        );
      }
    }
  }

  // Un propriétaire DÉCLARÉ mais absent de la table : la comparaison des
  // empreintes serait alors sautée page par page, en silence. Une seule fois,
  // et nommé.
  const proprietairesAbsents = [
    ...new Set(Object.values(budgets).map((l) => l.feuille)),
  ].filter((nom) => nom && !Object.hasOwn(budgets, nom));
  if (proprietairesAbsents.length > 0) {
    errors.push(
      `feuille(s) déclarée(s) propriétaire mais sans ligne dans la table : ` +
        `${proprietairesAbsents.join(', ')} — un propriétaire absent ne peut pas être comparé`
    );
  }

  const octetsTotal = lues.reduce((somme, p) => somme + p.octets, 0);
  return {
    errors,
    stats: { pages: lues, totalRegles, octetsTotal },
  };
};

/**
 * Le garde sur le build réel.
 *
 * @param {object} [options]
 * @param {string} [options.root] Racine frontend (contient build/).
 * @param {boolean} [options.quiet] Tait la sortie de progression (tests).
 * @returns {{ok: boolean, errors: string[], stats: object|null}}
 */
export const checkCssInlineBudget = ({ root, quiet = false } = {}) => {
  const ROOT = root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const BUILD = path.join(ROOT, 'build');
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };

  if (!existsSync(BUILD)) {
    return {
      ok: false,
      errors: [`build/ introuvable dans ${ROOT} — lancer \`npm run build\` avant ce check`],
      stats: null,
    };
  }

  const noms = readdirSync(BUILD)
    .filter((nom) => nom.endsWith('.html'))
    .sort();
  const pages = noms.map((nom) => ({
    nom,
    ...lireFeuilleInlinee(readFileSync(path.join(BUILD, nom), 'utf8')),
  }));

  const { errors, stats } = auditCssInline({ pages });

  log('Budget de CSS inline par page pré-rendue :');
  for (const page of pages) {
    const ligne = CSS_INLINE_BUDGETS[page.nom];
    const budget = ligne ? `budget ${ko(ligne.budget)}` : 'AUCUN BUDGET';
    log(
      `  ${page.nom.padEnd(22)} ${ko(page.octets).padStart(9)} · ` +
        `${page.blocs} bloc(s) · ${String(page.regles).padStart(4)} règles · ` +
        `sha ${page.sha} · ${budget}`
    );
  }
  const referencePage = pages.find((p) => p.nom === FEUILLE_DE_REFERENCE);
  const partagees = referencePage
    ? pages.filter((p) => p.nom !== referencePage.nom && p.sha === referencePage.sha).length
    : 0;
  log(
    `  total                : ${ko(stats ? stats.octetsTotal : 0)} ` +
      `(${pages.length} documents${partagees ? `, ${partagees + 1} portent la feuille de ${FEUILLE_DE_REFERENCE}` : ''})`
  );

  if (errors.length > 0) {
    console.error(`\n❌ Budget de CSS inline (${errors.length} problème(s)) :`);
    for (const message of errors) console.error(`   • ${message}`);
    return { ok: false, errors, stats };
  }

  log('\n✅ CSS inline dans les budgets (chaque page pré-rendue, page par page).');
  return { ok: true, errors, stats };
};

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = checkCssInlineBudget();
  if (!result.ok) process.exit(1);
}
