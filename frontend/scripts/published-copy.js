#!/usr/bin/env node
/**
 * L'APOSTROPHE de la copie publiée : UN caractère, pour les DEUX vues.
 *
 * Le site publiait deux conventions en même temps — l'apostrophe droite `'`
 * (U+0027) dans la copie, la typographique `’` (U+2019) dans quelques valeurs —
 * et la page et la coquille d'une même route pouvaient publier deux octets pour
 * le même mot.
 *
 * Le caractère qui survit est l'apostrophe TYPOGRAPHIQUE (U+2019), et ce module
 * est son unique propriétaire :
 *
 *   • c'est le caractère du français publié — l'apostrophe courbe `’` — et un
 *     crawler doit lire le même mot que l'utilisateur ;
 *   • le dictionnaire fait foi, et une migration de la copie publiée se fait en
 *     UN caractère, jamais en deux ;
 *   • coût mesuré — 298 occurrences dans 35 fichiers (`src/` et `index.html`),
 *     dont 81 écrites `\'` qui perdent au passage leur barre oblique ; et deux
 *     cartes OG dont le TEXTE DESSINÉ change d'octet (`homeMetaTitle`,
 *     `homeMetaDescription`, `jobsMetaDescription`) : les 4 PNG concernés ont
 *     été RÉGÉNÉRÉS (Pillow vit dans `backend/.venv`, et
 *     `check-og-reproducible.js` recompose les lignes dessinées pour exiger
 *     l'égalité avec le dictionnaire) ;
 *   • mise en page — MESURÉE avant/après sur le build servi, dans un navigateur
 *     réel (11 routes, 442 nœuds de texte, build de chaque côté du changement
 *     et arbre par ailleurs identique) : 0 changement de STRUCTURE, 0 retour à
 *     la ligne, et 59 nœuds dont la géométrie bouge de 0,031 px au plus (l'avance
 *     du glyphe `’` en Arial/Segoe : 0,016 px par apostrophe). Le rendu ne bouge
 *     pas ; seul le dessin du glyphe change.
 *
 * ── Le caractère REFUSÉ, précisément ───────────────────────────────────────
 * L'apostrophe de copie est celle qui JOINT DEUX LETTRES : `l'emploi`,
 * `d'Ivoire`, `n'est`, `aujourd'hui`, `Kojo's`, `Don't`, `t'a` (bambara,
 * mossi). C'est la seule que le site PUBLIE comme apostrophe.
 *
 * Partout ailleurs `'` n'est pas une apostrophe mais le DÉLIMITEUR d'une chaîne
 * de code : `\`... ${actif ? 'text-white' : 'text-black'}\`` en porte quatre sans
 * publier une seule apostrophe. Mesuré sur l'arbre : le contrôle « tout `'` d'un
 * littéral » signalait 350 littéraux là où 296 occurrences seulement étaient de
 * la copie — un garde qui refuse les délimiteurs du code ne peut pas être vert
 * et ne dit rien de la copie. La règle est donc celle-ci, et elle vaut pour les
 * deux vues : **une apostrophe droite qui joint deux lettres est refusée**.
 *
 * Ce que ce contrôle NE couvre pas, et qu'il faut savoir : dans un littéral, une
 * apostrophe droite NON jointive (une citation isolée, `"'"`) n'est pas
 * distinguable d'un délimiteur, donc elle passe ; dans un TEXTE HTML, où aucune
 * apostrophe n'est un délimiteur, la même règle s'applique et laisse donc passer
 * une citation droite isolée.
 *
 * Ce que le contrôle vérifie : aucune de ces surfaces ne publie d'apostrophe
 * droite jointive dans sa COPIE.
 *
 *   1. les SOURCES de la copie publiée — dictionnaires `src/i18n/*.json`,
 *      scopes `src/utils/pack2PageI18n/*.js`, littéraux publiés de `src/`
 *      (hors tests), NŒUDS DE TEXTE JSX de `src/` (la copie écrite entre deux
 *      balises n'est pas un littéral : elle le devient dans le bundle, où le
 *      fichier fautif porterait un nom de chunk — elle se lit donc dans la
 *      source, par `textesJsx`) et `index.html` ;
 *   2. la VUE PAGE — les chunks applicatifs du build (`build/assets/*.js`),
 *      les chunks `vendor*` étant exclus : le français publié vient de
 *      l'application, pas des dépendances ;
 *   3. la VUE CRAWLER — toutes les coquilles HTML du build.
 *
 * ── Pourquoi la détection lit les LITTÉRAUX, et non les lignes ──────────────
 * L'apostrophe droite est le DÉLIMITEUR de chaîne de JavaScript : la chercher
 * ligne à ligne signalerait chaque chaîne du dépôt. La règle est donc lue là où
 * la copie vit — dans les littéraux (commentaires, expressions régulières et
 * délimiteurs écartés) et dans le TEXTE VISIBLE des coquilles. Un test, un
 * commentaire ou un message de garde ne publient rien ; les fichiers de test sont
 * hors surface par construction.
 *
 * La lecture des littéraux, son lecteur (`litterauxLocalises`) et ses pièges
 * mesurés appartiennent à scripts/shell-text-provenance.js : ce module l'importe,
 * il ne la réécrit pas.
 *
 * Les appelants (le garde `check-prerender-shells.js` sur l'arbre réel, son test
 * sur des fixtures) passent leurs chemins : une seule logique, jamais recopiée.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { litterauxLocalises, normaliser, textesJsx } from './shell-text-provenance.js';

/** Le caractère qui survit — celui que les deux vues doivent publier. */
export const APOSTROPHE_PUBLIEE = '\u2019';

/** La convention qui perd, nommée pour que le refus soit lisible. */
export const APOSTROPHE_REFUSEE = "'";

const EXTENSIONS_SOURCE = ['.js', '.jsx', '.json'];
const DOSSIERS_HORS_SURFACE = new Set(['__tests__', 'node_modules', 'build', 'dist']);

/** Une lettre au sens Unicode : accents, `ɩ`, `ɛ`, `ɔ`, `ʋ`, `ŋ` compris. */
const estLettre = (caractere) => Boolean(caractere) && /\p{L}/u.test(caractere);

/**
 * Les positions de l'apostrophe DE COPIE d'un texte publié : celles qui joignent
 * deux lettres. Une apostrophe droite ailleurs est un délimiteur de code ou une
 * citation, jamais l'apostrophe du site.
 *
 * @param texte une copie publiée — la VALEUR d'un littéral (échappements déjà
 *   interprétés par le lecteur) ou une portion de HTML.
 * @returns {number[]} les index des apostrophes refusées.
 */
export const apostrophesDeCopie = (texte) => {
  const positions = [];
  for (let i = 0; i < texte.length; i += 1) {
    if (texte[i] !== APOSTROPHE_REFUSEE) continue;
    if (estLettre(texte[i - 1]) && estLettre(texte[i + 1])) positions.push(i);
  }
  return positions;
};

/** Le texte publie-t-il une apostrophe refusée ? */
const publieUneApostropheRefusee = (texte) => apostrophesDeCopie(texte).length > 0;

/**
 * Les portions de copie d'un fichier de code : ses LITTÉRAUX, et ses nœuds de
 * texte JSX (publiés autant, mais écrits hors littéral). Un `.json` n'a que des
 * littéraux.
 */
const portionsDeCode = (fichier, contenu) => {
  const portions = litterauxLocalises(contenu);
  if (!fichier.endsWith('.js') && !fichier.endsWith('.jsx')) return portions;
  return [...portions, ...textesJsx(contenu)];
};

/** Les chunks applicatifs de la vue page — les `vendor*` viennent d'ailleurs. */
const estChunkApplicatif = (nom) =>
  nom.endsWith('.js') && !nom.startsWith('vendor') && !nom.endsWith('.map');

/** Les fichiers SOURCES qui portent la copie publiée (hors tests). */
export const fichiersDeCopie = (frontendDir) => {
  const fichiers = [];
  const parcourir = (dossier) => {
    const entrees = readdirSync(dossier, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const entree of entrees) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) {
        if (!DOSSIERS_HORS_SURFACE.has(entree.name)) parcourir(chemin);
      } else if (EXTENSIONS_SOURCE.includes(path.extname(entree.name))) {
        fichiers.push(chemin);
      }
    }
  };
  parcourir(path.join(frontendDir, 'src'));
  fichiers.push(path.join(frontendDir, 'index.html'));
  return fichiers;
};

/** La vue CRAWLER : toutes les coquilles HTML écrites par le build. */
export const coquillesPubliees = (buildDir) =>
  readdirSync(buildDir)
    .filter((nom) => nom.endsWith('.html'))
    .sort()
    .map((nom) => path.join(buildDir, nom));

/** La vue PAGE : les chunks applicatifs du build. */
export const chunksPublies = (buildDir) => {
  const assets = path.join(buildDir, 'assets');
  return readdirSync(assets)
    .filter(estChunkApplicatif)
    .sort()
    .map((nom) => path.join(assets, nom));
};

/**
 * Les portions PUBLIÉES d'un fichier HTML : le texte visible (hors balises et
 * hors commentaires), la valeur des attributs (`content="…"`, `alt="…"`) et les
 * littéraux des scripts en ligne (JSON-LD) — le titre et la description d'une
 * page vivent dans des attributs, et le JSON-LD publie aussi de la copie.
 * Chacune avec sa ligne.
 */
const portionsHtml = (source) => {
  const portions = [];
  const sansCommentaires = source.replace(/<!--[\s\S]*?-->/g, (bloc) => ' '.repeat(bloc.length));
  const ligneDe = (position) => sansCommentaires.slice(0, position).split('\n').length;
  for (const m of sansCommentaires.matchAll(/="([^"]*)"/g)) {
    portions.push({ valeur: m[1], ligne: ligneDe(m.index) });
  }
  const texte = sansCommentaires
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '\n');
  const aPlat = sansCommentaires
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (bloc) => ' '.repeat(bloc.length))
    .replace(/<[^>]+>/g, (bloc) => ' '.repeat(bloc.length));
  for (const fragment of texte.split('\n')) {
    const propre = normaliser(fragment);
    if (!propre) continue;
    const position = aPlat.indexOf(propre.split(' ')[0]);
    portions.push({ valeur: propre, ligne: ligneDe(Math.max(position, 0)) });
  }
  // Le JSON-LD et les scripts portent aussi de la copie : leurs littéraux sont
  // lus comme ceux d'un fichier JS.
  for (const m of sansCommentaires.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const { valeur, ligne } of litterauxLocalises(m[1])) {
      portions.push({ valeur, ligne: ligneDe(m.index) + ligne - 1 });
    }
  }
  return portions;
};

/**
 * Les apostrophes REFUSÉES publiées, nommées une par une.
 *
 * @param fichiers chemins ABSOLUS à contrôler (sources, coquilles, chunks).
 * @returns {Array<{fichier: string, ligne: number, extrait: string}>} une
 *   violation par portion fautive (plafonnée pour rester lisible).
 */
export const apostrophesHorsConvention = (fichiers, { parFichier = 5 } = {}) => {
  const violations = [];
  for (const fichier of fichiers) {
    let contenu;
    try {
      contenu = readFileSync(fichier, 'utf8');
    } catch (err) {
      violations.push({ fichier, ligne: 0, extrait: `illisible : ${err.message}` });
      continue;
    }
    const portions = (fichier.endsWith('.html') ? portionsHtml(contenu) : portionsDeCode(fichier, contenu)).filter(
      ({ valeur }) => publieUneApostropheRefusee(valeur)
    );
    let relevees = 0;
    for (const { valeur, ligne } of portions) {
      if (relevees >= parFichier) break;
      const position = apostrophesDeCopie(valeur)[0];
      const extrait = valeur
        .slice(Math.max(0, position - 60), position + 40)
        .trim()
        .replace(/\s+/g, ' ');
      violations.push({ fichier, ligne, extrait });
      relevees += 1;
    }
  }
  return violations;
};
