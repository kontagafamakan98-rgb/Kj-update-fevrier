#!/usr/bin/env node
/**
 * L'APOSTROPHE de la copie publiée : UN caractère, pour les DEUX vues.
 *
 * Le site publiait deux conventions en même temps — l'apostrophe droite `'`
 * (U+0027) dans 192 valeurs, la typographique `’` (U+2019) dans 27 autres —
 * réparties de part et d'autre : le dictionnaire global penchait à droite
 * (185 contre 7), les scopes de page penchaient à typographique (27 contre 2).
 * Une même phrase pouvait même mélanger les deux (`L'acceptation … et des
 * conditions d’utilisation` dans le backend). La page et la coquille d'une
 * même route affichaient alors un octet différent pour le même mot.
 *
 * Le caractère qui survit est l'apostrophe DROITE (U+0027), et ce module est
 * son unique propriétaire :
 *
 *   • écriture — c'est déjà celle de l'écrasante majorité de la copie
 *     (192 valeurs contre 27), de `frontend/index.html` (28 contre 0), et elle
 *     est identique dans les 5 langues ;
 *   • coût mesuré — basculer vers U+2019 aurait changé les octets de trois
 *     textes DESSINÉS dans les cartes OG committées (`homeMetaTitle`,
 *     `homeMetaDescription`, `jobsMetaDescription`), donc exigé de régénérer
 *     des PNG ; c'est la migration la moins risquée qui laisse les images
 *     reproductibles par `check-og-reproducible.js` ;
 *   • portée — l'apostrophe droite est le seul caractère que rendent
 *     identiquement le WebView Android et les polices système, ce qui compte
 *     pour une app mobile servie à des connexions lentes.
 *
 * Ce que le contrôle vérifie : AUCUNE de ces surfaces ne porte U+2019.
 *
 *   1. les SOURCES de la copie publiée — dictionnaires `src/i18n/*.json`,
 *      scopes `src/utils/pack2PageI18n/*.js`, littéraux publiés de `src/`
 *      (hors tests) et `index.html` ;
 *   2. la VUE PAGE — les chunks applicatifs du build (`build/assets/*.js`),
 *      les chunks `vendor*` étant exclus : le français publié vient de
 *      l'application, pas des dépendances ;
 *   3. la VUE CRAWLER — toutes les coquilles HTML du build.
 *
 * Un test, un commentaire ou un message de garde ne publient rien : les lignes
 * de commentaire sont ignorées, comme dans la règle des glyphes du garde des
 * coquilles. Les fichiers de test sont hors surface par construction.
 *
 * Les appelants (le garde `check-prerender-shells.js` sur l'arbre réel, son
 * test sur des fixtures) passent leurs chemins : une seule logique, jamais
 * recopiée.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Le caractère qui survit — celui que les deux vues doivent publier. */
export const APOSTROPHE_PUBLIEE = "'";

/** La convention qui perd, nommée pour que le refus soit lisible. */
export const APOSTROPHE_TYPOGRAPHIQUE = '\u2019';

const EXTENSIONS_SOURCE = ['.js', '.jsx', '.json'];
const DOSSIERS_HORS_SURFACE = new Set(['__tests__', 'node_modules', 'build', 'dist']);

/** Un commentaire ne publie rien ; le premier caractère non blanc le dit. */
const DEBUT_DE_COMMENTAIRE = ['//', '/*', '*', '<!--'];

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
 * Les apostrophes typographiques publiées, nommées une par une.
 *
 * @param fichiers chemins ABSOLUS à contrôler (sources, coquilles, chunks).
 * @returns {Array<{fichier: string, ligne: number, extrait: string}>} une
 *   violation par occurrence (plafonnée pour rester lisible).
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
    let relevees = 0;
    contenu.split('\n').forEach((ligne, index) => {
      if (!ligne.includes(APOSTROPHE_TYPOGRAPHIQUE)) return;
      const debut = ligne.trim();
      if (DEBUT_DE_COMMENTAIRE.some((marque) => debut.startsWith(marque))) return;
      if (relevees >= parFichier) return;
      const position = ligne.indexOf(APOSTROPHE_TYPOGRAPHIQUE);
      const extrait = ligne
        .slice(Math.max(0, position - 60), position + 40)
        .trim()
        .replace(/\s+/g, ' ');
      violations.push({ fichier, ligne: index + 1, extrait });
      relevees += 1;
    });
  }
  return violations;
};
