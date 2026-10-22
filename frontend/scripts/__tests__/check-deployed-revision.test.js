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

import { BUILD_REVISION_META, BUILD_TREE_META } from '../site-meta.js';
import {
  DOSSIER_FRONTEND,
  ETATS_EN_FILE,
  LONGUEUR_SHA_MIN,
  arbreFrontend,
  arbreServi,
  baseAutorisée,
  comparer,
  etatDeploiementProduction,
  interroger,
  lireOptions,
  main,
  normaliser,
  optionsVercel,
  qualifierRefus,
  revisionServie,
  revisionsAttendues,
  verifierServie,
  verdictDeRevision,
} from '../check-deployed-revision.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(FRONTEND_DIR, 'scripts', 'check-deployed-revision.js');

const POUSSÉ = 'e9a131c24694be1411268cda2d43f1be46e2432b';
const DERNIER_FRONTEND = '25df29611223344556677889900112233445566';

/**
 * HTML minimal tel qu'un client le reçoit : la révision, l'arbre publié par le
 * build, ou aucun des deux (artefact antérieur au mécanisme).
 */
export function page(révision, { arbre = '', ordreInverse = false, citation = '"' } = {}) {
  const balise = ordreInverse
    ? `<meta content=${citation}${révision}${citation} name=${citation}${BUILD_REVISION_META}${citation}>`
    : `<meta name=${citation}${BUILD_REVISION_META}${citation} content=${citation}${révision}${citation}>`;
  const baliseArbre = arbre
    ? `<meta name=${citation}${BUILD_TREE_META}${citation} content=${citation}${arbre}${citation}>`
    : '';
  return `<!doctype html><html><head><title>Kojo</title>${révision ? balise : ''}${baliseArbre}</head><body><div id="root"></div></body></html>`;
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

// Arbres fabriqués : la table dit ce que chaque révision contient dans
// `frontend/`. Aucun test ne lance git ni ne touche le réseau par ce chemin.
const ARBRE_A = 'a'.repeat(40);
const ARBRE_B = 'b'.repeat(40);
const arbreDeTable = (table) => vi.fn((rev) => (table[rev]
  ? { arbre: table[rev], erreur: null }
  : { arbre: '', erreur: `commit ${String(rev).slice(0, 12)} absent de ce clone` }));

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

  it('lit l’arbre PUBLIÉ par l’artefact, et refuse une valeur qui n’en a pas la forme', () => {
    expect(arbreServi(page(POUSSÉ, { arbre: ARBRE_A }))).toBe(ARBRE_A);
    expect(arbreServi(page(POUSSÉ, { arbre: ARBRE_A.toUpperCase() }))).toBe(ARBRE_A);
    // Un artefact antérieur au verdict par arbre n’en annonce aucun.
    expect(arbreServi(page(POUSSÉ))).toBe('');
    // Un arbre ABRÉGÉ n’est pas un arbre : deux contenus différents partagent
    // leurs douze premiers caractères souvent assez pour qu’un préfixe soit un
    // faux vert. Une valeur non hexadécimale non plus.
    expect(arbreServi(page(POUSSÉ, { arbre: ARBRE_A.slice(0, 12) }))).toBe('');
    expect(arbreServi(page(POUSSÉ, { arbre: 'z'.repeat(40) }))).toBe('');
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
      // 1re réponse : la révision précédente, avec SON arbre publié (déploiement
      // en cours) ; ensuite : la bonne.
      fetchImpl: fetchQui([
        () => réponse({ corps: page(DERNIER_FRONTEND, { arbre: ARBRE_B }) }),
        () => réponse({ corps: page(POUSSÉ) }),
      ]),
      arbreDe: arbreDeTable({ [POUSSÉ]: ARBRE_A }),
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
      fetchImpl: fetchQui([() => réponse({ corps: page(DERNIER_FRONTEND, { arbre: ARBRE_B }) })]),
      arbreDe: arbreDeTable({ [POUSSÉ]: ARBRE_A }),
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

describe('check-deployed-revision — le verdict porte sur l’arbre PUBLIÉ', () => {
  it('accepte une révision différente dont l’arbre publié est identique (fusion documentaire)', () => {
    // Le cas mesuré le 21/10/2026 : `main` avance d’un commit qui ne touche que
    // de la documentation, Vercel laisse la production sur le build précédent.
    // Le SHA diffère, le contenu servi est celui de main : succès, et il le dit.
    const arbreDe = arbreDeTable({ [POUSSÉ]: ARBRE_A });
    const verdict = verdictDeRevision(DERNIER_FRONTEND, [POUSSÉ], {
      arbrePublié: ARBRE_A,
      arbreDe,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.parArbre).toBe(true);
    expect(verdict.message).toContain(DERNIER_FRONTEND.slice(0, 12));
    expect(verdict.message).toContain(POUSSÉ.slice(0, 12));
    expect(verdict.message).toContain(`arbre ${DOSSIER_FRONTEND}/ publié par l'artefact est IDENTIQUE`);
    // Le commit SERVI n’est PLUS résolu dans le clone : c’est ce qui supprime le
    // cas « arbre incomparable ». Seuls les commits ATTENDUS y sont lus.
    expect(arbreDe.mock.calls.map(([rév]) => rév)).toEqual([POUSSÉ]);
  });

  it('refuse quand l’arbre publié diffère, en nommant les deux arbres', () => {
    // Un vrai retard (ou un build d’une autre branche) : le contenu frontend
    // servi n’est PAS celui de main, et les deux arbres le prouvent.
    const verdict = verdictDeRevision(DERNIER_FRONTEND, [POUSSÉ], {
      arbrePublié: ARBRE_B,
      arbreDe: arbreDeTable({ [POUSSÉ]: ARBRE_A }),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.premisse).toBe(false);
    expect(verdict.message).toContain(`arbre ${DOSSIER_FRONTEND}/ DIFFÈRE`);
    expect(verdict.message).toContain(ARBRE_A.slice(0, 12));
    expect(verdict.message).toContain(ARBRE_B.slice(0, 12));
    expect(verdict.message).toMatch(/build Vercel échoué/);
  });

  it('refuse un artefact antérieur qui n’annonce AUCUN arbre, et le nomme (code 1)', () => {
    // Ce cas était une prémisse tant que l’arbre servi se lisait dans le clone.
    // Il ne l’est plus : l’arbre vient du HTML, donc l’absence est un fait de
    // PRODUCTION (artefact antérieur, ou build hors dépôt git) — redéployer.
    const arbreDe = vi.fn();
    const verdict = verdictDeRevision(DERNIER_FRONTEND, [POUSSÉ], { arbreDe });
    expect(verdict.ok).toBe(false);
    expect(verdict.premisse).toBeUndefined();
    expect(verdict.message).toContain('AUCUN arbre');
    expect(verdict.message).toContain(BUILD_TREE_META);
    expect(verdict.message).toMatch(/Redéployer/);
    // Aucun clone interrogé : le refus ne dépend pas de ce qu’on a localement.
    expect(arbreDe).not.toHaveBeenCalled();
  });

  it('n’appelle pas git quand le SHA suffit (chemin rapide)', () => {
    const arbreDe = vi.fn();
    expect(verdictDeRevision(POUSSÉ, [POUSSÉ], { arbreDe }).ok).toBe(true);
    expect(arbreDe).not.toHaveBeenCalled();
  });

  it('laisse « aucune révision annoncée » en REFUS (code 1), pas en prémisse', () => {
    // Une production muette est un défaut de déploiement, pas un instrument
    // aveugle : la basculer en code 2 ferait chercher le clone au lieu du build.
    const arbreDe = vi.fn();
    const verdict = verdictDeRevision('', [POUSSÉ], { arbreDe });
    expect(verdict.ok).toBe(false);
    expect(verdict.premisse).toBeUndefined();
    expect(verdict.message).toContain('AUCUNE révision');
    expect(arbreDe).not.toHaveBeenCalled();
  });

  it('ne conclut pas quand l’arbre ATTENDU est illisible, et le dit (prémisse)', () => {
    // La seule prémisse qui reste : elle parle du CLONE, pas du déploiement.
    const verdict = verdictDeRevision(DERNIER_FRONTEND, [POUSSÉ], {
      arbrePublié: ARBRE_A,
      arbreDe: arbreDeTable({}),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.premisse).toBe(true);
    expect(verdict.message).toContain('prémisse (aucun verdict rendu ici)');
    expect(verdict.message).toContain('ATTENDU illisible');
    expect(verdict.message).toContain('le clone qui ne contient pas la révision attendue');
    expect(verdict.message).toContain('absent de ce clone');
  });

  it('sort en code 2 quand l’arbre attendu est illisible (prémisse tolérée), sans accuser le déploiement', async () => {
    // Le CODE 2 est le fait que ce garde TOLÈRE : une prémisse ne dit rien de la
    // production, donc la CI (et `livrer.py`) ne doivent pas lire « frontend en
    // retard ». Ce cas le nomme à la sortie du CLI, là où il est consommé : sans
    // lui, un `return 1` dans cette branche rendrait une prémisse rouge et la
    // suite resterait verte.
    // Les annotations de verdict sortent sur la SORTIE STANDARD (seule
    // l'invocation impossible va sur la sortie d'erreur) : c'est la stdout que lit
    // le résumé du run.
    const sorties = [];
    const sortie = vi.spyOn(console, 'log').mockImplementation((m) => sorties.push(String(m)));
    try {
      const code = await main(['--attendu', POUSSÉ, '--base', 'https://exemple.test'], {
        verifier: async () => ({
          ok: false,
          premisse: true,
          journal: ['tentative 1/9 : arbre frontend/ ATTENDU illisible — prémisse (aucun verdict rendu ici) : commit absent de ce clone'],
        }),
      });
      expect(code).toBe(2);
      expect(sorties.join('\n')).toContain('title=Arbre attendu illisible');
      // Le titre du VRAI retard doit être absent : c'est la confusion que ce
      // code 2 existe pour empêcher.
      expect(sorties.join('\n')).not.toContain('Révision du frontend ≠ attendue');
    } finally {
      sortie.mockRestore();
    }
  });

  it('sort en code 1 quand la prémisse est retirée (le même verdict redevient un retard)', async () => {
    // Contrôle POSITIF du cas précédent : sans `premisse`, le même verdict passe
    // par le refus ordinaire. Si les deux codes se ressemblaient, le code 2 ne
    // serait pas une tolérance mais un hasard.
    const sorties = [];
    const sortie = vi.spyOn(console, 'log').mockImplementation((m) => sorties.push(String(m)));
    try {
      const code = await main(['--attendu', POUSSÉ, '--base', 'https://exemple.test'], {
        verifier: async () => ({ ok: false, premisse: false, journal: ['tentative 1/9 : arbre DIFFÈRE'] }),
      });
      expect(code).toBe(1);
      expect(sorties.join('\n')).toContain('Révision du frontend ≠ attendue');
    } finally {
      sortie.mockRestore();
    }
  });

  it('propage la prémisse au lieu de faire échouer le déploiement', async () => {
    const { ok, premisse } = await verifierServie({
      base: 'https://exemple.test',
      attendues: [POUSSÉ],
      fetchImpl: fetchQui([() => réponse({ corps: page(DERNIER_FRONTEND, { arbre: ARBRE_A }) })]),
      arbreDe: arbreDeTable({}),
      tentatives: 2,
      dormir: async () => {},
      log: () => {},
    });
    expect(ok).toBe(false);
    expect(premisse).toBe(true);
  });
});

describe('check-deployed-revision — lire le vrai arbre frontend/', () => {
  it('rend l’arbre que git donne pour HEAD', () => {
    const tête = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: FRONTEND_DIR, encoding: 'utf8' });
    const attendu = spawnSync('git', ['rev-parse', 'HEAD:frontend'], { cwd: FRONTEND_DIR, encoding: 'utf8' });
    if (tête.status !== 0 || attendu.status !== 0) return; // pas un dépôt git ici
    const { arbre, erreur } = arbreFrontend(tête.stdout.trim(), { cwd: FRONTEND_DIR, récupérer: false });
    expect(erreur).toBeNull();
    expect(arbre).toBe(attendu.stdout.trim());
  });

  it('nomme l’absence d’un commit inconnu au lieu de rendre un arbre vide', () => {
    const { arbre, erreur } = arbreFrontend('0123456789abcdef0123456789abcdef01234567', {
      cwd: FRONTEND_DIR,
      récupérer: false,
    });
    expect(arbre).toBe('');
    expect(erreur).toMatch(/absent de ce clone/);
    expect(erreur).toMatch(/révision ATTENDUE/);
  });
});

describe('check-deployed-revision — « en file » n’est pas « en retard » (21/10/2026)', () => {
  // Le 21/10/2026, la fusion de #184 a laissé `main` rouge : la fenêtre de 3 min
  // du garde expirait à 15:21, Vercel n'a créé le déploiement de production
  // qu'à 15:40. Le garde mesurait VRAI, mais son message indistinguait un build
  // échoué, une file d'attente et un déploiement jamais déclenché — trois
  // corrections différentes. Ces cas ancrent la distinction.
  const refus = comparer('abc1234def', [POUSSÉ]);
  const apiQui = (charge) => vi.fn(async () => réponse({ corps: JSON.stringify(charge) }));
  const déploiement = { token: 'jeton-de-test', teamId: '', projet: 'kj-update-fevrier' };

  it('lit l’état du déploiement de PRODUCTION, et ignore une preview du même commit', async () => {
    const fetchImpl = apiQui({
      deployments: [
        { uid: 'dpl_preview', target: 'preview', readyState: 'READY', meta: { githubCommitSha: POUSSÉ } },
        { uid: 'dpl_prod', target: 'production', readyState: 'QUEUED', meta: { githubCommitSha: POUSSÉ } },
      ],
    });
    const état = await etatDeploiementProduction(POUSSÉ, { ...déploiement, fetchImpl });
    expect(état.trouve).toBe(true);
    expect(état.etat).toBe('QUEUED');
    expect(état.id).toBe('dpl_prod');
    expect(état.erreur).toBeNull();
  });

  it('ne prend pas la preview du même commit pour un déploiement de production', async () => {
    const état = await etatDeploiementProduction(POUSSÉ, {
      ...déploiement,
      fetchImpl: apiQui({
        deployments: [
          { uid: 'dpl_preview', target: 'preview', readyState: 'READY', meta: { githubCommitSha: POUSSÉ } },
        ],
      }),
    });
    expect(état.trouve).toBe(false);
    expect(état.erreur).toBeNull();
  });

  it('ne lit rien sans jeton, et le dit au lieu d’inventer une prémisse', async () => {
    const fetchImpl = vi.fn();
    const état = await etatDeploiementProduction(POUSSÉ, { token: '', fetchImpl });
    expect(état.trouve).toBe(false);
    expect(état.erreur).toMatch(/jeton Vercel absent/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lit les coordonnées Vercel dans l’environnement, jamais recopiées', () => {
    expect(optionsVercel({ VERCEL_TOKEN: ' t ', VERCEL_PROJECT_NAME: ' p ' })).toEqual({
      token: 't',
      teamId: '',
      projet: 'p',
    });
    const défaut = optionsVercel({});
    expect(défaut.token).toBe('');
    expect(défaut.projet).toBe('kj-update-fevrier');
  });

  it('rend une PRÉMISSE quand le déploiement est en vol, et le nomme', async () => {
    const verdict = await qualifierRefus(refus, [POUSSÉ], {
      deploiement: déploiement,
      etatDeploiement: async () => ({ trouve: true, etat: 'BUILDING', id: 'dpl_42', erreur: null }),
    });
    expect(verdict.ok).toBe(false);
    // Le point du lot : ni vert, ni rouge du code — une mesure qui n'a pas eu lieu.
    expect(verdict.premisse).toBe(true);
    expect(verdict.message).toContain('est en BUILDING');
    expect(verdict.message).toContain('dpl_42');
    expect(verdict.message).toContain('22 min');
    expect(ETATS_EN_FILE.has('QUEUED')).toBe(true);
  });

  it('garde le ROUGE quand le build Vercel a échoué, en nommant l’état', async () => {
    const verdict = await qualifierRefus(refus, [POUSSÉ], {
      deploiement: déploiement,
      etatDeploiement: async () => ({ trouve: true, etat: 'ERROR', id: 'dpl_43', erreur: null }),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.premisse).toBeFalsy();
    expect(verdict.message).toContain('est en ERROR');
    expect(verdict.message).toMatch(/build Vercel en échec/);
  });

  it('garde le ROUGE quand aucun déploiement n’existe, et le dit', async () => {
    const verdict = await qualifierRefus(refus, [POUSSÉ], {
      deploiement: déploiement,
      etatDeploiement: async () => ({ trouve: false, etat: '', id: '', erreur: null }),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.premisse).toBeFalsy();
    expect(verdict.message).toMatch(/Aucun déploiement/);
    expect(verdict.message).toMatch(/déploiement manquant/);
  });

  it('laisse le refus inchangé quand l’état n’a pas pu être lu, sans prémisse inventée', async () => {
    const verdict = await qualifierRefus(refus, [POUSSÉ], {
      deploiement: { token: '' },
    });
    expect(verdict.premisse).toBeFalsy();
    expect(verdict.message.startsWith(refus.message)).toBe(true);
    expect(verdict.message).toMatch(/État Vercel NON LU/);
  });

  it('ne qualifie ni une production muette, ni un site injoignable (l’API n’y dit rien)', async () => {
    const etatDeploiement = vi.fn();
    const muet = await qualifierRefus(comparer('', [POUSSÉ]), [POUSSÉ], { etatDeploiement });
    expect(muet.message).toBe(comparer('', [POUSSÉ]).message);
    expect(etatDeploiement).not.toHaveBeenCalled();
    const injoignable = await qualifierRefus(
      { ok: false, message: `aucune réponse exploitable de https://exemple.test : HTTP 503` },
      [POUSSÉ],
      { etatDeploiement }
    );
    expect(injoignable.message).toMatch(/aucune réponse exploitable/);
    expect(etatDeploiement).not.toHaveBeenCalled();
  });

  it('propage la prémisse du déploiement en vol au lieu de l’effacer', async () => {
    const { ok, premisse, motif } = await verifierServie({
      base: 'https://exemple.test',
      attendues: [POUSSÉ],
      fetchImpl: fetchQui([() => réponse({ corps: page(DERNIER_FRONTEND, { arbre: ARBRE_B }) })]),
      arbreDe: arbreDeTable({ [POUSSÉ]: ARBRE_A }),
      tentatives: 1,
      dormir: async () => {},
      log: () => {},
      deploiement: déploiement,
      etatDeploiement: async () => ({ trouve: true, etat: 'QUEUED', id: 'dpl_44', erreur: null }),
    });
    expect(ok).toBe(false);
    expect(premisse).toBe(true);
    expect(motif).toContain('est en QUEUED');
  });

  it('sort en code 2 avec un AVERTISSEMENT quand le déploiement est en file', async () => {
    // Le code de sortie est ce que la CI et `livrer.py` consomment : un 2 rendu
    // ici, avec un `::warning`, est la forme « aucun verdict » (à distinguer
    // d'un `::error`, qui se lit comme un retard du dépôt).
    const sorties = [];
    const sortie = vi.spyOn(console, 'log').mockImplementation((m) => sorties.push(String(m)));
    try {
      const code = await main(['--attendu', POUSSÉ, '--base', 'https://exemple.test'], {
        verifier: async () => ({
          ok: false,
          premisse: true,
          journal: ['tentative 9/9 : révision servie ≠ attendue'],
          motif: 'déploiement de e9a131c24694 (dpl_45) est en QUEUED : la production n’a pas ENCORE servi cette révision',
        }),
      });
      expect(code).toBe(2);
      expect(sorties.join('\n')).toContain('::warning title=Déploiement Vercel en file');
      expect(sorties.join('\n')).not.toContain('Révision du frontend ≠ attendue');
    } finally {
      sortie.mockRestore();
    }
  });
});
