/**
 * @vitest-environment node
 *
 * Garde-fou de la RÉVISION du frontend servi (scripts/check-deployed-revision.js).
 *
 * ── Le faux-vert que ce test empêche ────────────────────────────────────────
 * Le déploiement de production du frontend est fait par Vercel depuis l'app
 * GitHub : aucun job ne le commande, donc rien, dans la CI, ne lisait le code
 * réellement servi. Un build Vercel échoué, annulé, ou en retard laissait `main`
 * vert — le site continuait de servir l'ancien bundle sans que personne ne le
 * sache, et c'est exactement la classe de défaut que F8 a fermée côté backend.
 *
 * Ce test pilote le VRAI script (importé, pas recopié) avec un `fetch` fabriqué
 * — aucun réseau — et vérifie les trois choses qui font qu'un tel garde vaut
 * quelque chose : chaque refus est NOMMÉ, l'attente d'un déploiement en cours ne
 * transforme jamais un refus en succès, et une invocation qui ne dit pas quoi
 * comparer échoue au lieu de passer.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { BUILD_REVISION_META } from '../site-meta.js';
import {
  LONGUEUR_SHA_MIN,
  baseAutorisée,
  comparer,
  interroger,
  lireOptions,
  normaliser,
  revisionServie,
  revisionsAttendues,
  verifierServie,
} from '../check-deployed-revision.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(FRONTEND_DIR, 'scripts', 'check-deployed-revision.js');

const POUSSÉ = 'e9a131c24694be1411268cda2d43f1be46e2432b';
const DERNIER_FRONTEND = '25df29611223344556677889900112233445566';

/** HTML minimal tel qu'un client le reçoit, avec (ou sans) la révision. */
export function page(révision, { ordreInverse = false, citation = '"' } = {}) {
  const balise = ordreInverse
    ? `<meta content=${citation}${révision}${citation} name=${citation}${BUILD_REVISION_META}${citation}>`
    : `<meta name=${citation}${BUILD_REVISION_META}${citation} content=${citation}${révision}${citation}>`;
  return `<!doctype html><html><head><title>Kojo</title>${révision ? balise : ''}</head><body><div id="root"></div></body></html>`;
}

/** `fetch` fabriqué : une réponse par appel, dans l'ordre fourni. */
function fetchQui(générateurs) {
  let appel = 0;
  return vi.fn(async () => {
    const générateur = générateurs[Math.min(appel, générateurs.length - 1)];
    appel += 1;
    return générateur(appel);
  });
}

function réponse({ status = 200, corps = '', enTêtes = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (nom) => enTêtes[nom.toLowerCase()] ?? null },
    text: async () => corps,
  };
}

describe('check-deployed-revision — lire la révision servie', () => {
  it('lit la meta du HTML servi, quel que soit l’ordre des attributs', () => {
    expect(revisionServie(page(POUSSÉ))).toBe(POUSSÉ);
    expect(revisionServie(page(POUSSÉ, { ordreInverse: true, citation: "'" }))).toBe(POUSSÉ);
  });

  it('ne prend PAS « inconnue » ni une balise muette pour une révision', () => {
    // Sans cette normalisation, une production qui répond « inconnue » serait
    // comparée à une attente « inconnue » et se déclarerait concordante.
    expect(revisionServie(page('inconnue'))).toBe('');
    expect(revisionServie(page(''))).toBe('');
    expect(revisionServie('<!doctype html><html></html>')).toBe('');
    expect(normaliser(null)).toBe('');
    expect(normaliser('  unknown ')).toBe('');
    expect(normaliser('  e9a131c  ')).toBe('e9a131c');
  });
});

describe('check-deployed-revision — le verdict, et ce qu’il nomme', () => {
  it('accepte la révision poussée', () => {
    const verdict = comparer(POUSSÉ, [POUSSÉ, DERNIER_FRONTEND]);
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toContain(POUSSÉ.slice(0, 12));
  });

  it('accepte la dernière révision ayant touché frontend/ (déploiement sauté)', () => {
    // Le cas « Vercel n'a pas redéployé un push sans changement de frontend » :
    // le contenu frontend servi est celui de main, donc c'est un succès — et non
    // un faux rouge qui apprendrait à ignorer ce garde.
    expect(comparer(DERNIER_FRONTEND, [POUSSÉ, DERNIER_FRONTEND]).ok).toBe(true);
  });

  it('refuse une production en retard en nommant les deux révisions', () => {
    const verdict = comparer('abc1234def', [POUSSÉ, DERNIER_FRONTEND]);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('abc1234def'.slice(0, 12));
    expect(verdict.message).toContain(POUSSÉ.slice(0, 12));
    expect(verdict.message).toMatch(/build Vercel échoué/);
  });

  it('refuse une production muette en nommant les sources de la révision', () => {
    const verdict = comparer('', [POUSSÉ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain(BUILD_REVISION_META);
    // Le refus doit dire OÙ chercher : les trois sources de la publication.
    expect(verdict.message).toContain('KOJO_GIT_SHA');
    expect(verdict.message).toMatch(/Redéployer/);
  });

  it('ne déclare jamais concordant un « inconnue » servi et un « inconnue » attendu', () => {
    // Le faux vert précis que la normalisation des DEUX côtés évite.
    expect(comparer('inconnue', ['inconnue']).ok).toBe(false);
  });
});

describe('check-deployed-revision — les valeurs à comparer', () => {
  it('refuse une valeur trop courte en la nommant, et dédoublonne', () => {
    const { valides, invalides } = revisionsAttendues([POUSSÉ, POUSSÉ, 'abc', '', null]);
    expect(valides).toEqual([POUSSÉ]);
    expect(invalides).toEqual(['abc']);
    expect(LONGUEUR_SHA_MIN).toBe(7);
  });

  it('échoue à l’invocation quand rien ne dit quoi comparer', () => {
    expect(() => lireOptions([])).toThrow(/--attendu manquant/);
    expect(() => lireOptions(['--attendu', 'abc'])).toThrow(/identifiants de commit/);
    expect(lireOptions(['--attendu', POUSSÉ]).attendues).toEqual([POUSSÉ]);
    // `--sinon` vide n'ajoute rien : la valeur absente ne devient pas une attente.
    expect(lireOptions(['--attendu', POUSSÉ, '--sinon', '']).attendues).toEqual([POUSSÉ]);
  });

  it('refuse de conclure sur une base locale', () => {
    // La question « cette adresse est-elle la nôtre ? » appartient à
    // `isLoopbackUrl` (scripts/site-meta.js) : on n'ajoute pas ici une seconde
    // règle. `0.0.0.0` n'en est pas une (c'est une adresse d'ÉCOUTE) et n'est
    // donc pas refusé d'office — il échouera en « injoignable », jamais en vert.
    for (const locale of ['http://localhost:4173', 'http://127.0.0.1:8000/', 'https://[::1]:4000']) {
      expect(baseAutorisée(locale).ok, locale).toBe(false);
    }
    expect(baseAutorisée('https://kojoforafrica.cc.cd/').ok).toBe(true);
  });

  it('sort en code 2 (invocation impossible), pas en vert, sans --attendu', () => {
    const résultat = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(résultat.status).toBe(2);
    // Le refus est écrit sur la sortie d'ERREUR, avec l'annotation GitHub qui le
    // rend lisible dans le résumé du run.
    expect(résultat.stderr).toContain('invocation impossible');
    expect(résultat.stdout).toBe('');
  });
});

describe('check-deployed-revision — lire la production', () => {
  it('nomme le défi de sécurité du CDN plutôt qu’un « frontend en retard »', async () => {
    const { html, erreur } = await interroger('https://exemple.test', {
      fetchImpl: fetchQui([() => réponse({ status: 403, enTêtes: { 'x-vercel-mitigated': 'challenge' } })]),
    });
    expect(html).toBeNull();
    expect(erreur).toContain('HTTP 403');
    expect(erreur).toContain('X-Vercel-Mitigated: challenge');
  });

  it('refuse une réponse qui n’est pas du HTML', async () => {
    const { html, erreur } = await interroger('https://exemple.test', {
      fetchImpl: fetchQui([() => réponse({ corps: '{"error":"gateway"}' })]),
    });
    expect(html).toBeNull();
    expect(erreur).toMatch(/pas du HTML/);
  });

  it('nomme une panne de transport', async () => {
    const { html, erreur } = await interroger('https://exemple.test', {
      fetchImpl: vi.fn(async () => {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { name: 'TypeError' });
      }),
    });
    expect(html).toBeNull();
    expect(erreur).toContain('TypeError: getaddrinfo ENOTFOUND');
  });
});

describe('check-deployed-revision — l’attente d’un déploiement en cours', () => {
  it('accepte dès que la production annonce la révision, sans attendre', async () => {
    const dormir = vi.fn(async () => {});
    const { ok, journal } = await verifierServie({
      base: 'https://exemple.test',
      attendues: [POUSSÉ],
      fetchImpl: fetchQui([() => réponse({ corps: page(POUSSÉ) })]),
      tentatives: 3,
      dormir,
      log: () => {},
    });
    expect(ok).toBe(true);
    expect(journal).toHaveLength(1);
    expect(dormir).not.toHaveBeenCalled();
  });

  it('attend qu’un déploiement se termine, puis accepte', async () => {
    const dormir = vi.fn(async () => {});
    const { ok, journal } = await verifierServie({
      base: 'https://exemple.test',
      attendues: [POUSSÉ],
      // 1re réponse : la révision précédente (déploiement en cours) ; ensuite : la bonne.
      fetchImpl: fetchQui([
        () => réponse({ corps: page(DERNIER_FRONTEND) }),
        () => réponse({ corps: page(POUSSÉ) }),
      ]),
      tentatives: 3,
      delai: 7,
      dormir,
      log: () => {},
    });
    expect(ok).toBe(true);
    expect(journal).toHaveLength(2);
    expect(dormir).toHaveBeenCalledWith(7);
  });

  it('refuse après la fenêtre d’attente, et l’attente n’a pas blanchi le refus', async () => {
    const dormir = vi.fn(async () => {});
    const { ok, journal } = await verifierServie({
      base: 'https://exemple.test',
      attendues: [POUSSÉ],
      fetchImpl: fetchQui([() => réponse({ corps: page(DERNIER_FRONTEND) })]),
      tentatives: 3,
      dormir,
      log: () => {},
    });
    expect(ok).toBe(false);
    expect(journal).toHaveLength(3);
    expect(dormir).toHaveBeenCalledTimes(2);
    expect(journal[2]).toMatch(/≠ attendue/);
  });

  it('ancre la production injoignable', async () => {
    const { ok, journal } = await verifierServie({
      base: 'https://exemple.test',
      attendues: [POUSSÉ],
      fetchImpl: fetchQui([() => réponse({ status: 503 })]),
      tentatives: 1,
      dormir: async () => {},
      log: () => {},
    });
    expect(ok).toBe(false);
    expect(journal[0]).toContain('aucune réponse exploitable');
    expect(journal[0]).toContain('HTTP 503');
  });
});
