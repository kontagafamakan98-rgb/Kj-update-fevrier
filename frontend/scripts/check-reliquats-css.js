#!/usr/bin/env node
/**
 * GARDE : AUCUN JETON SANS LECTEUR, AUCUN MOT ÉTRANGER — dans les feuilles du
 * site et dans la configuration de Tailwind.
 *
 * ── Ce qu'il attrape, et que les autres gardes de CSS ne peuvent pas voir ────
 * `scripts/check-css-selecteurs-morts.js` juge des NOMS DE CLASSES : une classe
 * nommée par un sélecteur doit être POSÉE. Ce garde-ci juge des JETONS : une
 * variable déclarée (`--x: …`) doit être LUE, et une lecture (`var(--x)`) doit
 * avoir une déclaration. C'est un autre sujet, mesuré le 08/10/2026 : le `:root`
 * de `src/index.css` déclarait VINGT-TROIS jetons shadcn dont UN SEUL servait
 * (`--radius`, lu treize fois). Les vingt-deux autres étaient du poids mort
 * déguisé en système de design — un `--chart-5` violet, une palette froide
 * complète, une couleur de bordure et un fond que des règles plus tardives du
 * site battaient déjà. Aucun garde ne le voyait : les jetons ne sont pas des
 * classes.
 *
 * ── Les trois verdicts ───────────────────────────────────────────────────────
 *   1. JETON SANS LECTEUR — un jeton déclaré par une feuille du site
 *      (`src/**\/*.css`) et jamais lu par l'artefact livré (blocs `<style>` des
 *      pages, JavaScript servi, configuration de Tailwind). Le rapport nomme le
 *      fichier, la ligne et le jeton.
 *   2. LECTURE SANS DÉCLARATION — un `var(--x)` lu par la CONFIGURATION de
 *      Tailwind et déclaré par aucune feuille du site : la déclaration serait
 *      invalide à l'exécution. Le périmètre est la configuration, et non tout
 *      l'artefact : Tailwind lit ses propres `--tw-*`, qu'il déclare lui-même.
 *   3. MOT ÉTRANGER — la police du gabarit Create React App, un jeton de
 *      `@radix-ui` (paquet absent de `package.json`), une animation du
 *      `Accordion` de shadcn, un `@apply` d'une couleur du thème retiré. Chaque
 *      refus porte SA mesure dans `scripts/reliquats-css.js`.
 *
 * ── Les refus (un vert sans lecture est un faux vert) ────────────────────────
 * Le garde refuse de rendre un verdict si le dossier de build est absent, s'il lit
 * moins de 2 feuilles source, moins de 12 jetons déclarés, moins de 10 pages ou
 * moins de 10 fichiers JavaScript servis, ou si la configuration de Tailwind est
 * introuvable. Un lecteur cassé doit échouer, pas rassurer.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   cd frontend && npm run build && node scripts/check-reliquats-css.js
 *   node scripts/check-reliquats-css.js --root <build> --sources <src> --config <chemin>
 *
 * Les trois chemins sont RELATIFS AU RÉPERTOIRE COURANT (`frontend/`) : le garde
 * est lancé depuis là en CI comme à la main.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  MIN_FEUILLES,
  MIN_JETONS_DECLARES,
  MIN_LECTEURS,
  MIN_PAGES,
  arbrePropre,
  declarations,
  lectures,
  motsEtrangersDe,
  phraseDeReliquats,
  reliquatsDe,
  sansCommentairesCss,
  sansCommentairesJs,
} from './reliquats-css.js';

/** Le bloc `<style>` d'une page : `[^]` évite d'écrire `[\s\S]` (aucun antislash ici). */
const RE_FEUILLE = new RegExp('<style[^>]*>([^]*?)</style>', 'g');

/** Le contenu des blocs `<style>` d'un document HTML (une chaîne vide s'il n'y en a pas). */
export function feuillesDe(html) {
  return [...String(html).matchAll(RE_FEUILLE)].map((m) => m[1]);
}

/** Les options du garde, lues dans `argv` (aucune n'est obligatoire). */
export function lireOptions(argv = process.argv.slice(2)) {
  const lire = (nom, defaut) => {
    const index = argv.indexOf(`--${nom}`);
    return index > -1 && argv[index + 1] ? argv[index + 1] : defaut;
  };
  return {
    racine: lire('root', 'build'),
    sources: lire('sources', 'src'),
    config: lire('config', 'tailwind.config.cjs'),
  };
}

/** Toutes les feuilles `.css` d'un dossier source (récursif), triées. */
export function feuillesSource(dossier) {
  const trouvees = [];
  const parcourir = (courant) => {
    for (const entree of fs.readdirSync(courant, { withFileTypes: true })) {
      const chemin = path.join(courant, entree.name);
      if (entree.isDirectory()) { parcourir(chemin); continue; }
      if (entree.name.endsWith('.css')) trouvees.push(chemin);
    }
  };
  parcourir(dossier);
  return trouvees.sort();
}

/** Les fichiers servis qui peuvent LIRE un jeton : pages et JavaScript. */
function fichiersLivres(racine) {
  const trouves = [];
  const parcourir = (courant) => {
    for (const entree of fs.readdirSync(courant, { withFileTypes: true })) {
      const chemin = path.join(courant, entree.name);
      if (entree.isDirectory()) { parcourir(chemin); continue; }
      if (/[.](html|js|mjs)$/.test(entree.name)) trouves.push(chemin);
    }
  };
  parcourir(racine);
  return trouves.sort();
}

/**
 * Tout ce que le garde lit, et ses refus — séparés du verdict pour être
 * éprouvables : `mesurer` ne prononce rien, il rend la lecture.
 */
export function mesurer({ racine = 'build', sources = 'src', config = 'tailwind.config.cjs' } = {}) {
  if (!fs.existsSync(racine)) {
    throw new Error(
      `dossier de build introuvable (« ${racine} ») : lancer \`npm run build\` — un garde qui n'a rien lu n'a rien vérifié`
    );
  }
  if (!fs.existsSync(sources)) {
    throw new Error(`dossier de sources introuvable (« ${sources} ») : le lecteur n'a pas lu son sujet`);
  }
  if (!fs.existsSync(config)) {
    throw new Error(
      `configuration de Tailwind introuvable (« ${config} ») : elle est un des trois canaux jugés, un garde qui ne la lit pas ne prouve rien`
    );
  }

  const cheminFeuilles = feuillesSource(sources);
  const jetonsDeclares = new Map();
  const mots = [];
  let reglesLues = 0;
  for (const feuille of cheminFeuilles) {
    // Les COMMENTAIRES sont blanchis avant toute lecture : un commentaire qui
    // documente le retrait d'un jeton (le cas réel du 08/10/2026 — « --chart-4:
    // 280 65% 60% » écrit dans la prose du bloc `.dark` retiré) n'est ni une
    // déclaration ni un mot étranger.
    const css = sansCommentairesCss(fs.readFileSync(feuille, 'utf8'));
    reglesLues += (css.match(/\{/g) || []).length;
    for (const [nom, ligne] of declarations(css)) {
      if (!jetonsDeclares.has(nom)) jetonsDeclares.set(nom, { ligne, fichier: feuille });
    }
    for (const mot of motsEtrangersDe(css)) mots.push({ fichier: feuille, ...mot });
  }

  const configTexte = sansCommentairesJs(fs.readFileSync(config, 'utf8'));
  for (const mot of motsEtrangersDe(configTexte)) mots.push({ fichier: config, ...mot });

  const pages = fs.readdirSync(racine).filter((nom) => nom.endsWith('.html')).sort();
  const livre = fichiersLivres(racine);
  const jetonsLus = new Set();
  for (const fichier of livre) {
    const brut = fs.readFileSync(fichier, 'utf8');
    // Une page est lue par ses SEULS blocs `<style>` : le balisage d'une page ne
    // lit pas un jeton, et compter le fichier entier ferait lire la feuille par
    // elle-même (le même piège que le corpus des poseurs, côté sélecteurs).
    const textes = fichier.endsWith('.html')
      ? feuillesDe(brut).map(sansCommentairesCss)
      : [sansCommentairesJs(brut)];
    for (const texte of textes) for (const nom of lectures(texte).keys()) jetonsLus.add(nom);
  }
  for (const nom of lectures(configTexte).keys()) jetonsLus.add(nom);

  const lecturesConfig = lectures(configTexte);
  return { cheminFeuilles, reglesLues, jetonsDeclares, jetonsLus, lecturesConfig, pages, livre, mots };
}

function main() {
  const options = lireOptions();
  const { cheminFeuilles, reglesLues, jetonsDeclares, jetonsLus, lecturesConfig, pages, livre, mots } = mesurer(options);

  if (cheminFeuilles.length < MIN_FEUILLES) {
    throw new Error(
      `lecture incomplète des feuilles source (${cheminFeuilles.length} feuille(s)) — plancher ${MIN_FEUILLES} : ` +
        'le lecteur n’a pas lu son sujet'
    );
  }
  if (jetonsDeclares.size < MIN_JETONS_DECLARES) {
    throw new Error(
      `seulement ${jetonsDeclares.size} jeton(s) déclaré(s) — plancher ${MIN_JETONS_DECLARES} : juger un ` +
        'balayage qui n’a presque rien lu déclarerait propres des feuilles qu’il n’a pas vues'
    );
  }
  if (pages.length < MIN_PAGES || livre.length < MIN_LECTEURS) {
    throw new Error(
      `lecture incomplète de l’artefact livré (${pages.length} page(s), ${livre.length} fichier(s)) — ` +
        `planchers ${MIN_PAGES} et ${MIN_LECTEURS} : un jeton « sans lecteur » n’a de sens que si l’on a lu les lecteurs`
    );
  }

  const reliquats = reliquatsDe({
    jetonsDeclares: new Map([...jetonsDeclares].map(([nom, d]) => [nom, d.ligne])),
    jetonsLus,
    lecturesConfig,
    mots,
  });
  const propre = arbrePropre(reliquats);

  console.log(
    `::notice::aucun jeton sans lecteur — ${cheminFeuilles.length} feuille(s) source (${reglesLues} règle(s)), ` +
      `${jetonsDeclares.size} jeton(s) déclaré(s) ; ${pages.length} page(s) et ${livre.length} fichier(s) servi(s) ` +
      `comme lecteurs ; configuration « ${options.config} » lue ; ${reliquats.mots.length} mot(s) étranger(s)`
  );

  if (propre) {
    console.log(
      `✅ Aucun reliquat : les ${jetonsDeclares.size} jetons déclarés par ${cheminFeuilles.length} feuille(s) sont tous LUS ` +
        `par l’artefact livré, la configuration ne lit aucun jeton que personne ne déclare, et les ` +
        `${reliquats.mots.length} mot(s) refusés n’apparaissent nulle part.`
    );
    return;
  }

  for (const jeton of reliquats.sansLecteur) {
    const origine = jetonsDeclares.get(jeton.nom);
    console.error(
      `::error::${origine.fichier}:${origine.ligne} : « ${jeton.nom} » est DÉCLARÉ et lu par AUCUN artefact livré ` +
        `(${pages.length} page(s) et ${livre.length} fichier(s) lus) — un jeton que personne ne lit ne peint rien : ` +
        'le retirer, ou lui donner un lecteur'
    );
  }
  for (const lecture of reliquats.sansDeclaration) {
    console.error(
      `::error::${options.config}:${lecture.ligne} : « ${lecture.nom} » est LU par la configuration et DÉCLARÉ par ` +
        'aucune feuille du site — la déclaration serait invalide à l’exécution'
    );
  }
  for (const mot of reliquats.mots) {
    console.error(
      `::error::${mot.fichier}:${mot.ligne} : « ${mot.extrait} » — ${mot.quoi}. ${mot.mesure}`
    );
  }
  console.error(
    `\n❌ ${phraseDeReliquats(reliquats)}. Une feuille décrit le site qui existe : un jeton sans lecteur et un mot ` +
      'd’un système de design étranger y sont la même faute qu’une classe sans porteur.'
  );
  process.exitCode = 1;
}

// `--aide` : le garde se décrit sans juger (utile en CI quand un garde voisin a
// changé de nom). Aucun autre argument n'est interprété ici.
if (process.argv.includes('--aide') || process.argv.includes('--help')) {
  console.log('Usage : node scripts/check-reliquats-css.js [--root build] [--sources src] [--config tailwind.config.cjs]');
} else {
  try {
    main();
  } catch (erreur) {
    console.error(`::error::${erreur.message}`);
    process.exitCode = 1;
  }
}
