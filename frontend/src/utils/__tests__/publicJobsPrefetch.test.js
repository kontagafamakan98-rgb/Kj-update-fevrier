import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { makePublicJobsPrefetch, canUseNetworkPrefetch } from '../publicJobsPrefetch';

// Tests du préchargement parallèle de la liste publique (LCP de /jobs).
//
// Cette optimisation n'avait AUCUN test : rien n'empêchait sa déduplication de
// casser (deux requêtes concurrentes au lieu d'une), sa consommation de
// disparaître (préchargement payé mais jamais réutilisé → deux fetch), ou son
// garde jsdom de sauter. Les tests pilotent la fabrique avec des stubs : ni
// navigateur, ni réseau.

const PAGE_SIZE = 12;
const DEFAULT_PARAMS = { limit: PAGE_SIZE, page: 1, status: 'open' };

const jobsOf = (count) => Array.from({ length: count }, (_, i) => ({ id: `job-${i + 1}`, title: `Mission ${i + 1}` }));

const setup = ({ items = jobsOf(12), fail = false, enabled = true } = {}) => {
  const calls = [];
  const jobsAPI = {
    getAll: vi.fn((params) => {
      calls.push(params);
      return fail ? Promise.reject(new Error('réseau indisponible')) : Promise.resolve(items);
    }),
  };
  const normalizeJobList = vi.fn((list) => (Array.isArray(list) ? list.filter((job) => job.id) : []));
  const safeLog = { warn: vi.fn() };
  const prefetch = makePublicJobsPrefetch({
    jobsAPI,
    normalizeJobList,
    safeLog,
    pageSize: PAGE_SIZE,
    enabled,
  });
  return { prefetch, jobsAPI, normalizeJobList, safeLog, calls };
};

describe('publicJobsPrefetch — déduplication du déclenchement', () => {
  it('ne lance qu’UNE requête même si kick est appelé plusieurs fois', async () => {
    const { prefetch, jobsAPI, calls } = setup();

    prefetch.kick();
    prefetch.kick();
    prefetch.kick();

    expect(jobsAPI.getAll).toHaveBeenCalledTimes(1);
    expect(calls[0]).toEqual(DEFAULT_PARAMS);

    await prefetch.pending.promise;
  });

  it('redémarre une requête après consommation (pas de résultat périmé réutilisé)', async () => {
    const { prefetch, jobsAPI } = setup();

    prefetch.kick();
    await prefetch.consume(DEFAULT_PARAMS);
    prefetch.kick();

    expect(jobsAPI.getAll).toHaveBeenCalledTimes(2);
    await prefetch.pending.promise;
  });
});

describe('publicJobsPrefetch — consommation par la liste', () => {
  it('réutilise la requête déjà en vol : aucune seconde requête, hasMore calculé', async () => {
    const { prefetch, jobsAPI } = setup({ items: jobsOf(PAGE_SIZE) });

    prefetch.kick();
    const result = await prefetch.consume(DEFAULT_PARAMS);

    expect(jobsAPI.getAll).toHaveBeenCalledTimes(1);
    expect(result.jobs).toHaveLength(PAGE_SIZE);
    expect(result.hasMore).toBe(true);
  });

  it('hasMore est faux quand la page renvoyée est incomplète', async () => {
    const { prefetch } = setup({ items: jobsOf(5) });

    prefetch.kick();
    const result = await prefetch.consume(DEFAULT_PARAMS);

    expect(result.jobs).toHaveLength(5);
    expect(result.hasMore).toBe(false);
  });

  it('le cache est réinitialisé après consommation (une seule réutilisation possible)', async () => {
    const { prefetch, jobsAPI } = setup();

    prefetch.kick();
    await prefetch.consume(DEFAULT_PARAMS);
    const second = await prefetch.consume(DEFAULT_PARAMS);

    expect(second).toBeNull();
    expect(prefetch.pending).toBeNull();
    expect(jobsAPI.getAll).toHaveBeenCalledTimes(1);
  });

  it('nettoie les entrées sans id (normalisation) avant de calculer hasMore', async () => {
    const { prefetch } = setup({ items: [...jobsOf(11), { title: 'sans id' }] });

    prefetch.kick();
    const result = await prefetch.consume(DEFAULT_PARAMS);

    expect(result.jobs).toHaveLength(11);
    expect(result.hasMore).toBe(false);
  });
});

describe('publicJobsPrefetch — la requête doit correspondre exactement', () => {
  const NON_MATCHING = [
    ['page 2', { ...DEFAULT_PARAMS, page: 2 }],
    ['limit différent', { ...DEFAULT_PARAMS, limit: 6 }],
    ['statut filtré', { ...DEFAULT_PARAMS, status: 'completed' }],
    ['recherche plein texte', { ...DEFAULT_PARAMS, q: 'plomberie' }],
    ['catégorie', { ...DEFAULT_PARAMS, category: 'plumbing' }],
    ['onglet « mes missions »', { ...DEFAULT_PARAMS, mine: 'posted' }],
    ['ids explicites', { ...DEFAULT_PARAMS, ids: 'a,b' }],
  ];

  for (const [label, params] of NON_MATCHING) {
    it(`ne réutilise pas le préchargement pour : ${label}`, async () => {
      const { prefetch, jobsAPI } = setup();

      prefetch.kick();
      const result = await prefetch.consume(params);

      expect(result).toBeNull();
      // Le préchargement reste disponible pour la vue découverte.
      expect(prefetch.pending).not.toBeNull();
      expect(jobsAPI.getAll).toHaveBeenCalledTimes(1);
      await prefetch.pending.promise;
    });
  }

  it('accepte exactement la requête de découverte par défaut', () => {
    const { prefetch } = setup();
    expect(prefetch.matches(DEFAULT_PARAMS)).toBe(true);
    expect(prefetch.matches({ ...DEFAULT_PARAMS, status: undefined })).toBe(false);
  });
});

describe('publicJobsPrefetch — un échec est bénin', () => {
  it('renvoie null et libère le cache pour laisser la liste recharger', async () => {
    const { prefetch, safeLog } = setup({ fail: true });

    prefetch.kick();
    const result = await prefetch.consume(DEFAULT_PARAMS);

    expect(result).toBeNull();
    expect(prefetch.pending).toBeNull();
    expect(safeLog.warn).toHaveBeenCalledTimes(1);
    expect(safeLog.warn.mock.calls[0][0]).toMatch(/prefetch failed/);
  });
});

describe('publicJobsPrefetch — environnements sans réseau', () => {
  it('ne déclenche rien quand le préchargement est désactivé (jsdom, pré-rendu)', async () => {
    const { prefetch, jobsAPI } = setup({ enabled: false });

    expect(prefetch.kick()).toBeNull();
    expect(jobsAPI.getAll).not.toHaveBeenCalled();
    await expect(prefetch.consume(DEFAULT_PARAMS)).resolves.toBeNull();
  });

  it('canUseNetworkPrefetch() est faux sous jsdom (garde de l’environnement de test)', () => {
    expect(canUseNetworkPrefetch()).toBe(false);
  });
});

describe('publicJobsPrefetch — Jobs.js garde le déclenchement à l’étape module', () => {
  const JOBS_SRC = fs.readFileSync(path.resolve(__dirname, '../../pages/Jobs.js'), 'utf8');

  it('instancie la fabrique et appelle kick AU NIVEAU MODULE (avant tout composant)', () => {
    expect(JOBS_SRC).toMatch(/makePublicJobsPrefetch\(\{/);
    // L'appel doit être hors du composant : avant `export default function Jobs`.
    const kickIndex = JOBS_SRC.indexOf('\nkickPublicJobsPrefetch();');
    const componentIndex = JOBS_SRC.indexOf('export default function Jobs');
    expect(kickIndex).toBeGreaterThan(-1);
    expect(componentIndex).toBeGreaterThan(-1);
    expect(kickIndex).toBeLessThan(componentIndex);
    // Aucune implémentation locale revenue dans la page (source unique).
    expect(JOBS_SRC).not.toMatch(/const kickPublicJobsPrefetch = \(\) =>/);
    expect(JOBS_SRC).not.toMatch(/let publicJobsPrefetch = null/);
  });

  it('expose le préchargement ENTIER au hook de chargement de la liste', () => {
    // L'objet, pas seulement `consume` : le hook lit `snapshot` pendant le
    // rendu pour démarrer la page SEEDÉE quand la liste est déjà en main (la
    // requête part à l'évaluation du chunk, l'effet arrive après le commit).
    expect(JOBS_SRC).toMatch(/prefetch:\s*publicJobsPrefetch/);
    expect(JOBS_SRC).not.toMatch(/consumePrefetch:\s*consumePublicJobsPrefetch/);
  });
});

describe('publicJobsPrefetch — lecture pendant le rendu (snapshot)', () => {
  it('requête EN VOL : rien à seeder, la page peint son propre écran de chargement', async () => {
    const { prefetch } = setup();
    prefetch.kick();

    // Une requête en vol ne donne AUCUNE liste : la page part en chargement et
    // peint tout de suite son texte réel (titre, intro) + son squelette de
    // liste, au lieu d'être suspendue le temps de la réponse (mesuré : 2,1 s
    // sans le plus grand texte de la page sur /jobs desktop).
    expect(prefetch.snapshot(DEFAULT_PARAMS)).toEqual({ applicable: true, value: null });
    await prefetch.pending.promise;
  });

  it('n’expose PLUS la promesse en vol : aucun appelant ne peut suspendre la page', async () => {
    const { prefetch } = setup();
    prefetch.kick();

    const state = prefetch.snapshot(DEFAULT_PARAMS);

    // Le contrat « je jette la promesse » a été retiré avec son appelant : ni
    // `pending`, ni `promise` — un champ inerte laisserait croire à une
    // suspension que plus personne ne fait.
    expect(state).not.toHaveProperty('pending');
    expect(state).not.toHaveProperty('promise');
    await prefetch.pending.promise;
  });

  it('ne consomme RIEN : la liste peut se seeder au rendu puis consommer dans l’effet', async () => {
    const { prefetch, jobsAPI } = setup({ items: jobsOf(2) });
    prefetch.kick();
    await prefetch.pending.promise;

    const state = prefetch.snapshot(DEFAULT_PARAMS);

    expect(state).toEqual({
      applicable: true,
      value: expect.any(Array),
    });
    expect(state.value).toHaveLength(2);
    expect(prefetch.pending).not.toBeNull();
    // Le seed au rendu PUIS la consommation dans l'effet = une seule requête.
    const consumed = await prefetch.consume(DEFAULT_PARAMS);
    expect(consumed.jobs).toHaveLength(2);
    expect(jobsAPI.getAll).toHaveBeenCalledTimes(1);
  });

  it('ne s’applique pas à une requête que le préchargement ne couvre pas', () => {
    const { prefetch } = setup();
    prefetch.kick();

    // Toute divergence doit renvoyer `applicable: false` : sans cela la page se
    // seederait avec le résultat d'une AUTRE requête.
    for (const divergent of [
      { ...DEFAULT_PARAMS, q: 'plombier' },
      { ...DEFAULT_PARAMS, category: 'btp' },
      { ...DEFAULT_PARAMS, status: 'closed' },
      { ...DEFAULT_PARAMS, page: 2 },
      { ...DEFAULT_PARAMS, mine: 'posted' },
      { ...DEFAULT_PARAMS, ids: 'applications' },
      { limit: PAGE_SIZE - 1, page: 1, status: 'open' },
    ]) {
      expect(prefetch.snapshot(divergent).applicable, JSON.stringify(divergent)).toBe(false);
    }
  });

  it('désactivé (jsdom, pré-rendu, SSR) : jamais applicable, donc aucun seed', () => {
    const { prefetch } = setup({ enabled: false });
    prefetch.kick();

    expect(prefetch.snapshot(DEFAULT_PARAMS)).toEqual({ applicable: false });
  });

  it('un échec est bénin : valeur nulle, la page recharge par son propre chemin', async () => {
    const { prefetch, safeLog } = setup({ fail: true });
    prefetch.kick();
    await prefetch.pending.promise;

    expect(prefetch.snapshot(DEFAULT_PARAMS)).toEqual({
      applicable: true,
      value: null,
    });
    expect(safeLog.warn).toHaveBeenCalled();
  });

  it('après consommation, plus rien à lire (aucun résultat périmé resservi)', async () => {
    const { prefetch } = setup();
    prefetch.kick();
    await prefetch.consume(DEFAULT_PARAMS);

    expect(prefetch.snapshot(DEFAULT_PARAMS)).toEqual({
      applicable: true,
      value: null,
    });
  });
});
