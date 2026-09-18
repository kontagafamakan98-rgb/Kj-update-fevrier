/**
 * La correspondance route → fichier de coquille est-elle écrite UNE fois ?
 *
 * `scripts/site-meta.js` porte `shellFileFor` parce que cette correspondance
 * vivait dans SIX endroits : le build qui écrit les coquilles
 * (`vite.config.js`), les deux gardes qui les relisent (`check-page-meta.js`,
 * `check-prerender-shells.js`), la liste `PRERENDERED_PAGES` écrite à la main
 * (`check-home-shell.js`), le routage attendu (`check-spa-routes.js`) et la
 * fixture du test de `check-page-meta.js`.
 *
 * Ce que ce test refuse, c'est la copie SUIVANTE — celle qu'un ajout de page
 * ferait réapparaître. Il lit donc les sources réelles du build et des gardes et
 * cherche les deux écritures qui ont existé, au lieu d'affirmer que la fonction
 * exportée existe : une telle affirmation serait verte même si chaque appelant
 * recalculait sa valeur.
 *
 * Les motifs sont ceux de la correspondance telle qu'elle était écrite, pas une
 * détection générale de `« … ».html` : le dépôt manipule des noms de fichiers
 * dans plusieurs contextes légitimes (gabarit nu `app.html`, `404.html`, fichiers
 * trouvés sur le disque), et un motif large ferait échouer le test sur du code
 * correct — c'est-à-dire pousserait à le désactiver.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { PAGE_META } from '../../src/config/page-meta';
import { shellFileFor } from '../site-meta';

const FRONTEND = path.resolve(__dirname, '..', '..');
// Le module qui POSSÈDE la correspondance, et le fichier qui porte les motifs
// ci-dessous (il ne se juge pas lui-même).
const EXCLUDED = ['scripts/site-meta.js', 'scripts/__tests__/site-meta.test.js'];
// Les deux écritures recopiées : la coupe du chemin, et le cas de la racine.
const COPIES = [/slice\(1\)\}\.html/, /=== '\/' \? 'index\.html'/];

const scannedSources = () => {
  const found = ['vite.config.js'];
  const scripts = path.join(FRONTEND, 'scripts');
  for (const entry of fs.readdirSync(scripts, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) found.push(`scripts/${entry.name}`);
    if (entry.isDirectory() && entry.name === '__tests__') {
      for (const test of fs.readdirSync(path.join(scripts, entry.name))) {
        if (test.endsWith('.js')) found.push(`scripts/${entry.name}/${test}`);
      }
    }
  }
  return found.filter((relative) => !EXCLUDED.includes(relative));
};

describe('site-meta — la correspondance route → coquille est écrite une fois', () => {
  it('aucune source ne recalcule le nom de fichier d’une coquille', () => {
    const offenders = [];
    for (const relative of scannedSources()) {
      const lines = fs.readFileSync(path.join(FRONTEND, relative), 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (COPIES.some((pattern) => pattern.test(line))) {
          offenders.push(`${relative}:${index + 1} — ${line.trim()}`);
        }
      });
    }

    // Non-vacuité : un périmètre vide (chemins changés) ne prouverait rien.
    expect(scannedSources().length).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });

  it('donne un fichier DISTINCT à chaque page de la table', () => {
    // Deux routes qui désignent le même fichier, et l'une des deux pages
    // disparaît du build sans que rien ne le dise.
    const files = Object.keys(PAGE_META).map(shellFileFor);

    expect(new Set(files).size).toBe(files.length);
  });
});
