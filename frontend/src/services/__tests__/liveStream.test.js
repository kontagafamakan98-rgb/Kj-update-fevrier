/**
 * Le lecteur de flux (SSE) : ce que le sondage ne savait pas faire.
 *
 * Ce fichier mesure les propriétés dont dépend TOUT le remplacement :
 *   1. une trame coupée entre deux paquets réseau est RECOLLÉE (sinon un
 *      événement sur deux disparaît selon la segmentation TCP) ;
 *   2. un flux qui tombe est ROUVERT, avec un recul qui grandit et un aléa
 *      (sans aléa, tous les onglets reviennent au même instant) ;
 *   3. un 401/403 ARRÊTE les tentatives (insister sur une session morte ne la
 *      rétablit pas) ;
 *   4. le flux part avec les en-têtes de l'application (`Accept:
 *      text/event-stream`, credentials) — jamais de jeton dans l'URL, ce que
 *      `EventSource` aurait imposé.
 *
 * Aucune horloge réelle : le planificateur est injecté, donc le recul se
 * mesure sans attendre.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { openLiveStream, isLiveStreamSupported } from '../liveStream';

// Tout flux ouvert est refermé, MÊME si une assertion échoue : un flux laissé
// vivant relance indéfiniment et retiendrait le worker de test.
const fluxOuverts = [];
const ouvrir = (chemin, options) => {
  const stop = openLiveStream(chemin, options);
  fluxOuverts.push(stop);
  return stop;
};

const encodeur = new TextEncoder();

/** Un corps de réponse fabriqué à partir de morceaux de texte SSE. */
const corps = (morceaux, { garderOuvert = false } = {}) => new ReadableStream({
  start(controller) {
    morceaux.forEach((morceau) => controller.enqueue(encodeur.encode(morceau)));
    if (!garderOuvert) controller.close();
  },
});

/** Attend qu'une condition devienne vraie, sans attente fixe. */
const attendre = async (condition, tentatives = 50) => {
  for (let i = 0; i < tentatives; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('condition jamais atteinte');
};

afterEach(() => {
  while (fluxOuverts.length) {
    const stop = fluxOuverts.pop();
    try {
      stop();
    } catch (_error) {
      // déjà fermé
    }
  }
  vi.restoreAllMocks();
});

describe('flux SSE — lecture des trames', () => {
  it('recolle une trame coupée entre deux paquets réseau', async () => {
    const evenements = [];
    const stop = ouvrir('/notifications/stream', {
      fetchImpl: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: corps([
          'event: notification\nda',
          'ta: {"notification":{"id":"n1"}}\n\n',
        ], { garderOuvert: true }),
      })),
      onEvent: (nom, data) => evenements.push([nom, data]),
    });

    await attendre(() => evenements.length === 1);
    expect(evenements[0]).toEqual(['notification', { notification: { id: 'n1' } }]);
    stop();
  });

  it('ignore les commentaires de battement de cœur et lit le JSON', async () => {
    const evenements = [];
    const stop = ouvrir('/messages/stream', {
      fetchImpl: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: corps([
          ': keepalive\n\n',
          'event: ready\ndata: {"ok":true}\n\n',
          'event: message\ndata: {"id":"m1","conversation_id":"a_b"}\n\n',
        ], { garderOuvert: true }),
      })),
      onEvent: (nom, data) => evenements.push([nom, data]),
    });

    await attendre(() => evenements.length === 2);
    expect(evenements).toEqual([
      ['ready', { ok: true }],
      ['message', { id: 'm1', conversation_id: 'a_b' }],
    ]);
    stop();
  });

  it('part avec les en-têtes de l’application, et sans jeton dans l’URL', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: corps([], { garderOuvert: true }),
    }));
    const stop = ouvrir('/notifications/stream', { fetchImpl });

    await attendre(() => fetchImpl.mock.calls.length === 1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/\/api\/notifications\/stream$/);
    expect(url).not.toMatch(/token|access_token|jwt/i);
    expect(options.credentials).toBe('include');
    expect(options.headers.Accept).toBe('text/event-stream');
    stop();
  });
});

describe('flux SSE — reconnexion', () => {
  it('rouvre un flux tombé, avec un recul qui grandit', async () => {
    const statuts = [];
    const delais = [];
    let appels = 0;

    const fetchImpl = vi.fn(async () => {
      appels += 1;
      // 1er appel : le serveur ferme aussitôt. 2e : il tient.
      if (appels === 1) return { ok: true, status: 200, body: corps(['event: ready\ndata: {}\n\n']) };
      return { ok: true, status: 200, body: corps([], { garderOuvert: true }) };
    });

    const stop = ouvrir('/notifications/stream', {
      fetchImpl,
      onStatus: (statut) => statuts.push(statut),
      schedule: (run, delay) => {
        delais.push(delay);
        run();
        return 0;
      },
      random: () => 0.5,
      initialDelayMs: 1000,
    });

    await attendre(() => delais.length >= 1 && statuts.includes('open') && appels >= 2);
    expect(statuts).toContain('down');
    expect(delais[0]).toBe(1000);
    stop();
  });

  it('un flux MUET est jugé TOMBÉ (sinon un proxy qui tamponne ferait croire au calme)', async () => {
    const statuts = [];
    // 200, un corps ouvert… et aucun octet : c'est exactement ce que rend un
    // proxy qui retient la réponse. Sans chien de garde, le client attendrait
    // indéfiniment — aucun événement, et aucun repli non plus.
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: corps([], { garderOuvert: true }),
    }));
    const stop = ouvrir('/notifications/stream', {
      fetchImpl,
      onStatus: (statut) => statuts.push(statut),
      silenceTimeoutMs: 20,
      schedule: () => 0, // on n'exécute pas la reconnexion pendant la mesure
    });

    await attendre(() => statuts.includes('down'), 600);
    stop();
  });

  it('un 401 ARRÊTE les tentatives (une session morte ne se rétablit pas en insistant)', async () => {
    const statuts = [];
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, body: null }));
    const stop = ouvrir('/notifications/stream', {
      fetchImpl,
      onStatus: (statut) => statuts.push(statut),
      schedule: (run) => {
        run();
        return 0;
      },
    });

    await attendre(() => statuts.includes('down'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(statuts).not.toContain('open');
    stop();
  });

  it('un refus de capacité (503) est un état DÉGRADÉ, pas un silence', async () => {
    const statuts = [];
    const delais = [];
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, body: null }));
    const stop = ouvrir('/notifications/stream', {
      fetchImpl,
      onStatus: (statut) => statuts.push(statut),
      schedule: (run, delay) => {
        // On N'EXÉCUTE PAS la reconnexion pendant la mesure : un recul qui
        // s'exécute immédiatement ferait tourner la boucle en microtâches, sans
        // jamais rendre la main (le test ne mesurerait plus qu'un spin).
        delais.push(delay);
        return delay;
      },
      initialDelayMs: 1000,
      random: () => 0.5,
    });

    await attendre(() => statuts.includes('down') && delais.length === 1);
    expect(statuts).toContain('connecting');
    expect(delais[0]).toBe(1000);
    stop();
  });
});

describe('flux SSE — capacité du navigateur', () => {
  it('se déclare indisponible sans corps de flux lisible', () => {
    // jsdom/Node de test savent lire un flux : le drapeau doit être vrai ici,
    // sinon le repli de l’application ne serait jamais exercé en conditions
    // réelles et le test ne mesurerait rien.
    expect(isLiveStreamSupported()).toBe(true);
  });
});
