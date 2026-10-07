/**
 * LE BALAYAGE DES SOURCES LIVRÉES — la marche récursive sur `src/`, partagée par
 * les gardes de FORME qui lisent tout le dépôt.
 *
 * ── Pourquoi ce module existe ───────────────────────────────────────────────
 * Deux gardes balaient les mêmes fichiers pour y refuser deux choses
 * différentes : `appuis-exterieurs.test.jsx` (une couche plein-bleed qui capte
 * l'appui) et `LienVue.test.jsx` (un second propriétaire du lien interne). La
 * population, elle, est la même, et c'est elle qui a un sens : les fichiers
 * LIVRÉS — pas les tests, pas le harnais, pas `setupTests.js`. Deux copies de
 * cette marche divergeraient au premier ajout de dossier, et l'un des deux
 * balayages jugerait alors un autre dépôt que l'autre.
 *
 * ── Ce que « livré » veut dire ici ──────────────────────────────────────────
 * `__tests__` est ÉCARTÉ : un balayage qui se juge lui-même rougirait sur ses
 * propres cas synthétiques (ils portent exprès les formes refusées), et le
 * dossier s'appelle maintenant `aide-…` plutôt que `*.test.js` pour que Vitest
 * ne le collecte pas comme un fichier de test — il n'en est pas un.
 */
import fs from 'fs';
import path from 'path';

/** La racine des sources livrées (`frontend/src`). */
export const RACINE_SRC = path.resolve(__dirname, '../..');

/**
 * Les fichiers `.js`/`.jsx` livrés d'un dossier, récursivement.
 *
 * @param {string} [dossier] Racine à balayer (par défaut `src/`).
 * @param {string[]} [accumule] Accumulateur interne.
 * @returns {string[]} Chemins ABSOLUS.
 */
export function fichiersSource(dossier = RACINE_SRC, accumule = []) {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const complet = path.join(dossier, entree.name);
    if (entree.isDirectory()) {
      if (entree.name === '__tests__') continue;
      fichiersSource(complet, accumule);
    } else if (/\.jsx?$/.test(entree.name) && entree.name !== 'setupTests.js') {
      accumule.push(complet);
    }
  }
  return accumule;
}

/**
 * Les sources livrées, prêtes à juger : chemin relatif à `src/` (en `/`, comme
 * dans les messages d'échec) et contenu.
 *
 * @param {string} [dossier] Racine à balayer (par défaut `src/`).
 * @returns {{relatif: string, contenu: string}[]}
 */
export function sourcesLivrees(dossier = RACINE_SRC) {
  return fichiersSource(dossier).map((fichier) => ({
    relatif: path.relative(RACINE_SRC, fichier).replace(/\\/g, '/'),
    contenu: fs.readFileSync(fichier, 'utf8'),
  }));
}
