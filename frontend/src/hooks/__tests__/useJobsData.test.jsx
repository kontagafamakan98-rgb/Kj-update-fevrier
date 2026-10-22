import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Suspense } from 'react';
import { useJobsData, JOBS_PAGE_SIZE, JOB_TAB_DISCOVER, JOB_TAB_MISSIONS } from '../useJobsData';

// ── Pourquoi ces tests existent ─────────────────────────────────────────────
// L'état du préchargement est lu PENDANT LE RENDU, pas dans un effet : la
// requête part à l'évaluation du chunk, un effet arrive après le commit, et le
// premier rendu n'aurait alors rien à afficher.
//
// Ce que le hook en fait a changé, et c'est la mesure qui l'a tranché :
//   • il SUSPENDAIT en jetant la promesse en vol, pour garder monté le fallback
//     Suspense de la route au lieu de laisser la page monter son propre
//     squelette (un seul passage de mise en page de 12 cartes au lieu de deux).
//     Le calcul ne portait que sur le travail de rendu : mesuré sur /jobs en
//     desktop (Chrome 152, 3 runs), le fallback remplaçait le titre, la date et
//     le paragraphe d'intro — l'élément LCP — par des barres grises pendant
//     2,1 s, le temps de la réponse de l'API. Render Delay du LCP 1156–2345 ms,
//     `observedLastVisualChange` jusqu'à 9,6 s, Speed Index 3008–5246 : la seule
//     note sous 1,00 du profil (FCP, LCP, TBT, CLS parfaits).
//   • il ne suspend PLUS (cf. useJobsData.js) : la page peint son premier écran
//     tout de suite — texte réel + squelette de liste — et seule la liste
//     attend la réponse. Il reste la lecture SEEDÉE, qui évite le clignotement
//     du squelette quand la liste est déjà en main.
// Ces tests verrouillent les deux chemins, et l'absence de suspension.
vi.mock('../../services/apiEndpoints', () => ({
  jobsAPI: {
    getAll: vi.fn(() => Promise.resolve([])),
    getMyProposals: vi.fn(() => Promise.resolve([])),
  },
}));
vi.mock('../../services/api', () => ({
  handleApiError: (_error, fallback) => fallback,
}));

// eslint-disable-next-line import/first
import { jobsAPI } from '../../services/apiEndpoints';

const jobsOf = (count) => Array.from({ length: count }, (_, i) => ({ id: `job-${i + 1}` }));

const Probe = ({ prefetch, tab = JOB_TAB_DISCOVER, filters = { search: '', category: '', status: '' }, position }) => {
  const { jobs, loading, total } = useJobsData({
    effectiveTab: tab,
    filters,
    setFilters: () => {},
    searchParams: new URLSearchParams(''),
    user: null,
    errorMessages: { network: 'réseau', server: 'serveur' },
    prefetch,
    position,
  });
  return (
    <div>
      <span data-testid="etat">{loading ? 'squelette' : 'liste'}</span>
      <span data-testid="nombre">{jobs.length}</span>
      <span data-testid="total">{total === null ? 'aucun' : total}</span>
    </div>
  );
};

const Frame = ({ children }) => (
  <Suspense fallback={<span data-testid="fallback">squelette du fallback</span>}>
    {children}
  </Suspense>
);

beforeEach(() => {
  vi.clearAllMocks();
  jobsAPI.getAll.mockResolvedValue([]);
  jobsAPI.getMyProposals.mockResolvedValue([]);
});

describe('useJobsData — préchargement lu pendant le rendu', () => {
  it('ne SUSPEND PAS : la page peint son premier écran pendant que la requête est en vol', async () => {
    let resolveIt;
    const promise = new Promise((resolve) => { resolveIt = resolve; });
    const jobs = jobsOf(3);
    const prefetch = {
      // Une requête en vol ne donne aucune liste : `value` nulle.
      snapshot: vi.fn(() => ({ applicable: true, value: null })),
      consume: vi.fn(() => promise.then(() => ({ jobs, hasMore: false }))),
    };

    render(<Frame><Probe prefetch={prefetch} /></Frame>);

    // La page EST montée, dans son état de chargement : son texte réel (titre,
    // intro = élément LCP) et son squelette sont peints tout de suite, au lieu
    // d'attendre la réponse de l'API derrière le fallback Suspense — mesuré sur
    // /jobs desktop, ce fallback laissait la page sans son plus grand texte
    // pendant 2,1 s (Render Delay du LCP 1156–2345 ms, Speed Index 3008–5246).
    expect(screen.queryByTestId('fallback')).toBeNull();
    expect(screen.getByTestId('etat').textContent).toBe('squelette');

    await act(async () => { resolveIt(jobs); });

    // À l'arrivée, la liste remplace le squelette dans le MÊME rendu de page.
    expect(screen.getByTestId('etat').textContent).toBe('liste');
    expect(screen.getByTestId('nombre').textContent).toBe('3');
  });

  it('naît SEEDÉE quand le préchargement est déjà arrivé : jamais d’état squelette côté page', async () => {
    const jobs = jobsOf(4);
    const prefetch = {
      snapshot: vi.fn(() => ({ applicable: true, value: jobs })),
      consume: vi.fn(() => Promise.resolve({ jobs, hasMore: false })),
    };

    render(<Frame><Probe prefetch={prefetch} /></Frame>);

    // Premier rendu = liste réelle. L'état « squelette » ne doit jamais exister,
    // sinon il serait mis en page puis jeté.
    expect(screen.getByTestId('etat').textContent).toBe('liste');
    expect(screen.getByTestId('nombre').textContent).toBe('4');
    expect(screen.queryByTestId('fallback')).toBeNull();

    await act(async () => {});

    // L'effet consomme le préchargement (pour que le cache ne serve pas un
    // résultat périmé à la visite suivante) sans provoquer de nouveau rendu :
    // mêmes valeurs → React court-circuite.
    expect(prefetch.consume).toHaveBeenCalledTimes(1);
    expect(prefetch.consume).toHaveBeenCalledWith({ limit: JOBS_PAGE_SIZE, page: 1, status: 'open' });
    expect(screen.getByTestId('etat').textContent).toBe('liste');
  });

  it('hors params du préchargement : chemin normal, squelette puis liste (aucune suspension)', async () => {
    const prefetch = {
      snapshot: vi.fn(() => ({ applicable: false })),
      consume: vi.fn(),
    };
    jobsAPI.getAll.mockResolvedValue(jobsOf(2));

    render(<Frame><Probe prefetch={prefetch} /></Frame>);

    expect(screen.getByTestId('etat').textContent).toBe('squelette');
    expect(screen.queryByTestId('fallback')).toBeNull();

    await act(async () => {});

    expect(screen.getByTestId('nombre').textContent).toBe('2');
    // La requête est bien partie par le chemin normal (une seule fois), et le
    // consommateur appelé n'a rien pu servir : `consume` renvoie null quand les
    // params ne correspondent pas (cf. publicJobsPrefetch.test.js).
    expect(jobsAPI.getAll).toHaveBeenCalledTimes(1);
  });

  it('interroge le préchargement avec les params EXACTS de la requête', () => {
    const prefetch = { snapshot: vi.fn(() => ({ applicable: false })), consume: vi.fn() };

    // Onglet « Mes missions » : `mine` présent → la lecture ne peut pas confondre
    // cet onglet avec la découverte publique (elle se seederait avec les
    // mauvaises offres) — c'est la propriété que porte `matches()`.
    render(<Frame><Probe prefetch={prefetch} tab={JOB_TAB_MISSIONS} /></Frame>);

    expect(prefetch.snapshot).toHaveBeenCalledWith(expect.objectContaining({
      limit: JOBS_PAGE_SIZE,
      page: 1,
      mine: 'assigned',
    }));
  });

  it('interroge aussi le préchargement avec les filtres actifs', () => {
    const prefetch = { snapshot: vi.fn(() => ({ applicable: false })), consume: vi.fn() };

    render(
      <Frame>
        <Probe prefetch={prefetch} filters={{ search: 'plombier', category: 'btp', status: '' }} />
      </Frame>
    );

    expect(prefetch.snapshot).toHaveBeenCalledWith(expect.objectContaining({
      q: 'plombier',
      category: 'btp',
    }));
  });

  it('le tri demandé part au serveur, et le COMPTE mesuré remonte à la page', async () => {
    // Le tri : la page ne trie pas localement — elle demande l'ordre au
    // serveur, qui seul peut tenir un ordre exact sur TOUTES les pages.
    const prefetch = { snapshot: vi.fn(() => ({ applicable: false })), consume: vi.fn() };
    jobsAPI.getAll.mockResolvedValue({
      data: jobsOf(2),
      headers: { get: (nom) => (nom === 'X-Total-Count' ? '42' : null) },
    });

    render(
      <Frame>
        <Probe prefetch={prefetch} filters={{ search: '', category: '', status: '', sort: 'budget' }} />
      </Frame>
    );

    await act(async () => {});

    expect(jobsAPI.getAll).toHaveBeenCalledWith(
      expect.objectContaining({ tri: 'budget', status: 'open' }),
      { withHeaders: true }
    );
    expect(screen.getByTestId('total').textContent).toBe('42');
  });

  it('tri=distance porte le POINT depuis lequel la distance se mesure', async () => {
    // Une distance se mesure depuis un point : le serveur refuse
    // `tri=distance` sans lat/lng (400 nommé), donc les coordonnées partent
    // DANS la même requête que l'ordre, jamais dans une seconde.
    jobsAPI.getAll.mockResolvedValue(jobsOf(2));

    render(
      <Frame>
        <Probe
          prefetch={undefined}
          filters={{ search: '', category: '', status: '', sort: 'distance' }}
          position={{ latitude: 14.69, longitude: -17.44 }}
        />
      </Frame>
    );

    await act(async () => {});

    expect(jobsAPI.getAll).toHaveBeenCalledWith(
      expect.objectContaining({ tri: 'distance', lat: 14.69, lng: -17.44 }),
      { withHeaders: true }
    );
  });

  it('sans en-tête, le compte vaut AUCUN : la page n’affiche pas la taille de page', async () => {
    jobsAPI.getAll.mockResolvedValue(jobsOf(2));

    render(<Frame><Probe prefetch={undefined} /></Frame>);
    await act(async () => {});

    expect(screen.getByTestId('total').textContent).toBe('aucun');
  });

  it('sans préchargement fourni : chemin normal (ni suspension, ni erreur)', async () => {
    jobsAPI.getAll.mockResolvedValue(jobsOf(1));

    render(<Frame><Probe prefetch={undefined} /></Frame>);

    expect(screen.getByTestId('etat').textContent).toBe('squelette');
    await act(async () => {});
    expect(screen.getByTestId('nombre').textContent).toBe('1');
  });
});
