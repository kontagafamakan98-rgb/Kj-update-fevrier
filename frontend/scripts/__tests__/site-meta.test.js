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
import { isLoopbackUrl, shellFileFor } from '../site-meta';

const FRONTEND = path.resolve(__dirname, '..', '..');
// Le module qui POSSÈDE la correspondance, et le fichier qui porte les motifs
// ci-dessous (il ne se juge pas lui-même).
const EXCLUDED = ['scripts/site-meta.js', 'scripts/__tests__/site-meta.test.js'];
// Les deux écritures recopiées : la coupe du chemin, et le cas de la racine.
const COPIES = [/slice\(1\)\}\.html/, /=== '\/' \? 'index\.html'/];
// La règle d'adresse recopiée : un schéma http(s) suivi d'une alternance d'hôtes
// où `localhost` figure. C'est la FORME qui a existé trois fois (deux gardes et
// `lighthouserc.cjs`) ; la détection est donc celle-ci, et pas « la ligne parle
// de localhost », qui ferait échouer du code correct (`DEFAULT_BASE`).
const estRegleLoopbackRecopiee = (ligne) =>
  ligne.includes('http') && /localhost\s*\|/.test(ligne);

/**
 * Les sources qui PEUVENT porter une copie — le périmètre du build ET de ses
 * gardes. Il inclut `lighthouserc.cjs` et `vite-plugins/` parce que la
 * troisième copie de la règle d'adresse vivait là, hors du périmètre que
 * `scripts/` délimitait par accident : un périmètre choisi par commodité est un
 * périmètre qui laisse passer.
 */
const scannedSources = () => {
  const found = ['vite.config.js', 'lighthouserc.cjs'];
  const scripts = path.join(FRONTEND, 'scripts');
  for (const entry of fs.readdirSync(scripts, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.cjs'))) {
      found.push(`scripts/${entry.name}`);
    }
    if (entry.isDirectory() && entry.name === '__tests__') {
      for (const test of fs.readdirSync(path.join(scripts, entry.name))) {
        if (test.endsWith('.js')) found.push(`scripts/${entry.name}/${test}`);
      }
    }
  }
  for (const plugin of fs.readdirSync(path.join(FRONTEND, 'vite-plugins'))) {
    if (plugin.endsWith('.js')) found.push(`vite-plugins/${plugin}`);
  }
  return found.filter((relative) => !EXCLUDED.includes(relative));
};

// Les lignes de COMMENTAIRE ne sont pas jugées : un docstring a le droit de
// citer l'heuristique retirée pour expliquer pourquoi elle l'a été. Ce qui est
// refusé, c'est du CODE qui repose la question.
const estCommentaire = (ligne) => {
  const nu = ligne.trimStart();
  return nu.startsWith('//') || nu.startsWith('*') || nu.startsWith('/*');
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

describe('site-meta — la règle d’adresse « cette machine » est écrite une fois', () => {
  it('aucune source ne repose la question de l’adresse locale', () => {
    const offenders = [];
    for (const relative of scannedSources()) {
      const lines = fs.readFileSync(path.join(FRONTEND, relative), 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (!estCommentaire(line) && estRegleLoopbackRecopiee(line)) {
          offenders.push(`${relative}:${index + 1} — ${line.trim()}`);
        }
      });
    }

    // Non-vacuité : un périmètre vide ne prouverait rien.
    expect(scannedSources().length).toBeGreaterThan(10);
    expect(
      offenders,
      `règle « adresse locale » recopiée hors de son propriétaire (scripts/site-meta.js) : ${offenders.join(' ; ')}`,
    ).toEqual([]);
  });

  it('répond d’après l’HÔTE de l’URL, et arbitre les trois divergences', () => {
    // Ce que la règle reconnaît : les trois adresses par lesquelles un job se
    // parle à lui-même, port et casse libres, chemin indifférent.
    for (const ok of ['http://127.0.0.1:8000', 'http://localhost:4174', 'http://[::1]:8000', 'HTTP://LOCALHOST:8000', 'http://127.0.0.1:8000/api']) {
      expect(isLoopbackUrl(ok), ok).toBe(true);
    }

    // Les deux arbitrages, épinglés pour qu'ils ne dérivent pas en silence :
    // `0.0.0.0` est l'adresse d'ÉCOUTE, pas la nôtre (l'ancienne règle permissive
    // du garde SEO la disait locale) ; et un hôte qui IMITE une adresse locale
    // reste un hôte distant, parce que la décision se lit sur l'hôte analysé.
    expect(isLoopbackUrl('http://0.0.0.0:4174')).toBe(false);
    expect(isLoopbackUrl('http://127.0.0.1.evil.test')).toBe(false);

    // Ni une adresse distante, ni un hôte sans schéma, ni du vide : hors de
    // `http(s)`, il n'y a pas d'hôte à comparer — donc pas de « oui » par défaut.
    for (const ko of ['https://api.kojoforafrica.cc.cd', 'https://stub-backend.test', 'localhost:8000', '', null, undefined, 'ftp://localhost']) {
      expect(isLoopbackUrl(ko), String(ko)).toBe(false);
    }
  });
});
