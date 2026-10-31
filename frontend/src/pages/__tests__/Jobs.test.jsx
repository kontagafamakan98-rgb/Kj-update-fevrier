/**
 * États de la liste des missions.
 *
 * Une panne de chargement et une liste vide ne sont pas la même chose, et
 * chacune a sa prochaine étape : la panne dit quoi vérifier et propose de
 * REJOUER la requête (sans recharger l'onglet), la liste vide dit quoi faire
 * pour l'enrichir — élargir la recherche, ou lever le filtre qui la vide.
 * Ces cas sont verrouillés ici parce qu'une panne affichée comme « aucune
 * mission » fait croire qu'il n'y a rien à trouver, et qu'un état vide sans
 * action laisse l'utilisateur sans issue.
 *
 * Le rejeu, lui, doit porter EXACTEMENT la requête qui a échoué : une panne sur
 * la page suivante se répare en chargeant cette page-là, sans effacer ce qui
 * est déjà affiché — sinon « Réessayer » ne répare pas la panne qu'il annonce.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// Paramètres d'URL mutables d'un cas à l'autre (hoistés : les fabriques de
// vi.mock s'exécutent avant le corps du module).
const { SEARCH_PARAMS, TOASTS, AUTH, ALERTE } = vi.hoisted(() => ({
  SEARCH_PARAMS: { current: new URLSearchParams() },
  // Le refus de géolocalisation n'a que le toast pour le dire : sans un espion
  // STABLE d'un cas à l'autre, ce refus ne serait vérifiable nulle part.
  TOASTS: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  // Le compte : mutable, parce que la carte d'alerte n'est montée que pour un
  // TRAVAILLEUR — le cas de provenance a besoin de ce rôle-là, les autres de
  // personne du tout.
  AUTH: { current: { user: null } },
  // Ce que la page transmet à la carte : la provenance est un fait que `/jobs`
  // LIT dans l'URL, et c'est ce passage-là qu'on mesure ici.
  ALERTE: { current: [] },
}));

vi.mock('react-router-dom', () => ({
  Link: ({ children }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
  useSearchParams: () => [SEARCH_PARAMS.current],
}));

// Le vrai dictionnaire français, comme le fournisseur réel : les copies
// d'échec et d'état vide sont des clés i18n, pas des littéraux de page.
vi.mock('../../contexts/LanguageContext', async () => {
  const { default: fr } = await vi.importActual('../../i18n/fr.json');
  return { useLanguage: () => ({ currentLanguage: 'fr', t: (key) => fr[key] || key }) };
});

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => AUTH.current }));
vi.mock('../../components/AlerteEmploi', () => ({
  default: (props) => {
    ALERTE.current.push(props);
    return <div data-testid="alerte-emploi" />;
  },
}));
vi.mock('../../contexts/CountryContext', () => ({
  useCountry: () => ({ currentCountry: 'mali', changeUserCountry: vi.fn(), isOwner: false }),
}));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => TOASTS }));

// Le préchargement parallèle est un optim : neutralisé pour que chaque cas
// exerce le chemin de requête direct, dans un ordre déterministe.
vi.mock('../../utils/publicJobsPrefetch', () => ({
  makePublicJobsPrefetch: () => ({ kick: vi.fn(), consume: vi.fn().mockResolvedValue(null) }),
}));

// Leaflet n'a pas sa place dans jsdom, et la carte n'est pas l'objet du test.
vi.mock('../../components/JobsMap', () => ({ default: () => <div data-testid="carte" /> }));

vi.mock('../../services/apiEndpoints', () => ({
  jobsAPI: { getAll: vi.fn(), getMyProposals: vi.fn().mockResolvedValue([]) },
}));

// Import après les vi.mock (hoistés par Vitest).
import Jobs from '../Jobs';
import { jobsAPI } from '../../services/apiEndpoints';
// Les textes d'état ne sont PAS retapés ici : ils appartiennent au dictionnaire
// et au scope de la page — les réécrire laisse le test affirmer l'ancien mot.
import fr from '../../i18n/fr.json';
import { makeScopedTranslator as makeJobsTranslator } from '../../utils/pack2PageI18n/jobs.js';
import { CONTACT } from '../../config/contact.js';

const jobsT = makeJobsTranslator('fr', (cle) => fr[cle]);

const JOB_A = { id: 'job-1', title: 'Réparation de plomberie', status: 'open', category: 'plumbing' };
const JOB_B = { id: 'job-2', title: 'Peinture du salon', status: 'open', category: 'painting' };

// Une page pleine (JOBS_PAGE_SIZE = 12) : c'est ce qui fait apparaître
// « Afficher plus de missions », donc le seul chemin où la pagination existe.
const PAGE_PLEINE = (prefixe, n) => Array.from({ length: n }, (_, i) => ({
  id: `${prefixe}-${i}`,
  title: `${prefixe} mission ${i}`,
  status: 'open',
  category: 'plumbing',
}));

// Formes EXACTES produites par la frontière de l'API (services/api.js) : une
// panne sans message du serveur arrive marquée `hasServerMessage = false` et
// porte le message du produit. La page, elle, doit afficher SES mots.
const panneReseau = () => Object.assign(
  new Error('Erreur de connexion. Vérifiez votre connexion internet.'),
  { hasServerMessage: false }
);
const panneServeur = () => Object.assign(
  new Error("Une erreur inattendue s'est produite. Veuillez rafraîchir la page."),
  { hasServerMessage: false, response: { status: 502, data: { detail: 'Internal server error retrieving jobs' } } }
);

const RESEAU = jobsT('loadErrorNetwork');
const SERVEUR = jobsT('loadErrorServer');
// Le TITRE de l'état vide PUBLIC vit dans le scope `jobs` depuis le 28/10/2026
// (il porte la promesse, cf. `premierArrivantsTitle`) : le fait (« aucune mission
// ouverte ») est la première phrase du paragraphe, donc le cas qui l'exigeait
// dans le titre vise le même message, un cran plus bas.
const VIDE = jobsT('premierArrivantsTitle');
const VIDE_FAIT = jobsT('premierArrivantsLead');
const VIDE_FILTRE = 'Aucune mission ne correspond à ces filtres.';

beforeEach(() => {
  SEARCH_PARAMS.current = new URLSearchParams();
  AUTH.current = { user: null };
  ALERTE.current = [];
  TOASTS.success.mockReset();
  TOASTS.error.mockReset();
  TOASTS.info.mockReset();

  // La géolocalisation posée par un cas ne doit pas survivre au suivant :
  // un ordre « distance » appliqué par héritage ne testerait plus rien.
  afterEach(() => {
    delete global.navigator.geolocation;
  });
  // resetAllMocks (et pas clearAllMocks) : un mockResolvedValueOnce non
  // consommé par un cas fuirait dans le suivant et le ferait mentir.
  vi.resetAllMocks();
  jobsAPI.getMyProposals.mockResolvedValue([]);
});

describe('Jobs — la liste dit COMBIEN et dans quel ORDRE', () => {
  it('affiche le compte MESURÉ (X-Total-Count), pas la taille de la page', async () => {
    // 1 mission affichée, 37 qui correspondent : la page ne doit pas dire 1.
    jobsAPI.getAll.mockResolvedValue({
      data: [JOB_A],
      headers: { get: (nom) => (nom === 'X-Total-Count' ? '37' : null) },
    });

    render(<Jobs />);

    expect(await screen.findByText(jobsT('resultsMany', { count: 37 }))).toBeTruthy();
  });

  it('sans en-tête de compte, n’affiche AUCUN compte (jamais la taille de page)', async () => {
    jobsAPI.getAll.mockResolvedValue([JOB_A]);

    render(<Jobs />);

    expect(await screen.findByText('Réparation de plomberie')).toBeTruthy();
    expect(screen.queryByText(jobsT('resultsOne'))).toBeNull();
    expect(screen.queryByText(jobsT('resultsMany', { count: 1 }))).toBeNull();
  });

  it('choisir « Budget le plus élevé » demande l’ordre au SERVEUR', async () => {
    jobsAPI.getAll.mockResolvedValue([JOB_A]);
    render(<Jobs />);

    await screen.findByText('Réparation de plomberie');
    fireEvent.change(screen.getByLabelText(jobsT('sortLabel')), { target: { value: 'budget' } });

    // Un tri local ne tiendrait pas sur les pages suivantes : la page demande
    // l'ordre au serveur, qui seul voit toute la collection.
    await waitFor(() => expect(jobsAPI.getAll).toHaveBeenCalledWith(
      expect.objectContaining({ tri: 'budget' }),
      { withHeaders: true }
    ));
  });

  it('choisir « Au plus proche » demande la position PUIS l’ordre au serveur', async () => {
    jobsAPI.getAll.mockResolvedValue([JOB_A]);
    // jsdom n'a pas de géolocalisation : on pose celle que le navigateur
    // fournirait, pour vérifier la DEMANDE et les coordonnées transmises.
    const getCurrentPosition = vi.fn((reussi) =>
      reussi({ coords: { latitude: 14.69, longitude: -17.44 } })
    );
    Object.defineProperty(global.navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });

    render(<Jobs />);
    await screen.findByText('Réparation de plomberie');
    fireEvent.change(screen.getByLabelText(jobsT('sortLabel')), { target: { value: 'distance' } });

    expect(getCurrentPosition).toHaveBeenCalled();
    // Le point est celui qui vient d'être obtenu : c'est depuis LUI que la
    // distance se mesure, sinon le tri ne veut rien dire.
    await waitFor(() => expect(jobsAPI.getAll).toHaveBeenCalledWith(
      expect.objectContaining({ tri: 'distance', lat: 14.69, lng: -17.44 }),
      { withHeaders: true }
    ));
  });

  it('une position refusée n’annonce PAS un ordre qui n’a pas été appliqué', async () => {
    jobsAPI.getAll.mockResolvedValue([JOB_A]);
    const getCurrentPosition = vi.fn((_reussi, echoue) => echoue({ code: 1 }));
    Object.defineProperty(global.navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });

    render(<Jobs />);
    await screen.findByText('Réparation de plomberie');
    jobsAPI.getAll.mockClear();
    fireEvent.change(screen.getByLabelText(jobsT('sortLabel')), { target: { value: 'distance' } });

    expect(getCurrentPosition).toHaveBeenCalled();
    expect(TOASTS.error).toHaveBeenCalledWith(fr.geoPermissionDenied);
    // Le select reste sur l'ordre RÉELLEMENT appliqué, et aucune requête de
    // tri par distance n'est partie sans position.
    expect(screen.getByLabelText(jobsT('sortLabel')).value).toBe('recent');
    expect(jobsAPI.getAll).not.toHaveBeenCalled();
  });
});

describe('Jobs — une panne se répare, une liste vide se dit', () => {
  it('une coupure réseau affiche ses propres mots (pas le texte du navigateur) et propose de réessayer', async () => {
    jobsAPI.getAll.mockRejectedValue(panneReseau());
    render(<Jobs />);

    expect(await screen.findByText(RESEAU)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
    // Ni la copie générique de la frontière, ni le texte du navigateur : c'est
    // la page qui parle, et la panne ne se déguise pas en liste vide.
    expect(screen.queryByText('Erreur de connexion. Vérifiez votre connexion internet.')).toBeNull();
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();
    expect(screen.queryByText(VIDE)).toBeNull();
  });

  it('un serveur qui répond sans message utilisable dit de réessayer dans un instant', async () => {
    jobsAPI.getAll.mockRejectedValue(panneServeur());
    render(<Jobs />);

    expect(await screen.findByText(SERVEUR)).toBeTruthy();
    expect(screen.queryByText('Internal server error retrieving jobs')).toBeNull();
    expect(screen.queryByText(RESEAU)).toBeNull();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });

  it('« Réessayer » rejoue la requête et affiche les missions', async () => {
    jobsAPI.getAll
      .mockRejectedValueOnce(panneReseau())
      .mockResolvedValue([JOB_A, JOB_B]);
    render(<Jobs />);

    fireEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));

    expect(await screen.findByText('Réparation de plomberie')).toBeTruthy();
    expect(screen.getByText('Peinture du salon')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(RESEAU)).toBeNull());
    expect(jobsAPI.getAll).toHaveBeenCalledTimes(2);
  });

  it('une liste vide publique dit le vide et propose TROIS issues réelles, sans annonce inventée', async () => {
    // Le témoin de la mesure du 24/10/2026 : `/api/jobs?status=open` rendait
    // `[]` et la page affichait pourtant trois annonces « Exemple », avec
    // budget, ville et durée — un inventaire inventé sur la page de première
    // impression. Ce cas refuse donc à la fois le FAUX (aucune carte, aucun
    // badge « Exemple ») et le MUET (le vide est dit, et il dit quoi faire).
    jobsAPI.getAll.mockResolvedValue([]);
    render(<Jobs />);

    // Les trois textes viennent du SCOPE `jobs` (chargé avec la page), pas du
    // dictionnaire global : c'est ce qui les garde hors du bundle initial.
    const pageFr = makeJobsTranslator('fr', (key) => fr[key] || key);

    expect(await screen.findByText(VIDE)).toBeTruthy();
    // Le FAIT n'a pas disparu : la promesse est le titre, le vide est la
    // première phrase — et les deux textes viennent du scope de la page.
    expect(VIDE_FAIT.startsWith('Aucune mission')).toBe(true);
    expect(screen.getByText(pageFr('premierArrivantsLead'))).toBeTruthy();
    // Les deux liens internes passent par `LienVue` (transition de vue native) :
    // rendus HORS routeur, ils n'ont pas de `href` à lire — c'est leur TEXTE
    // qui prouve l'issue. Le lien WhatsApp est une vraie `<a>` : sa destination
    // se vérie, et c'est la source unique `contact.json` qui la fournit.
    expect(screen.getByText(fr.postJob)).toBeTruthy();
    expect(screen.getByText(pageFr('premierArrivantsWatch'))).toBeTruthy();
    expect(
      screen.getByRole('link', { name: pageFr('premierArrivantsWhatsApp') }).getAttribute('href')
    ).toBe(CONTACT.whatsappUrl);

    // Aucune annonce : ni carte de mission, ni pastille d'exemple, et surtout
    // aucun littéral français hors des dictionnaires.
    expect(screen.queryByText('Exemple')).toBeNull();
    expect(screen.queryByText('Commencer maintenant')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/d[ée]couvrez le type de missions/i);
  });

  it('conserve l’état vide guidant pour une recherche filtrée', async () => {
    SEARCH_PARAMS.current = new URLSearchParams('category=plumbing');
    jobsAPI.getAll.mockResolvedValue([]);
    render(<Jobs />);

    expect(await screen.findByText(VIDE_FILTRE)).toBeTruthy();
    expect(screen.queryByText('Réparer une fuite dans une cuisine')).toBeNull();
  });

  it('ignore une réponse ancienne quand un filtre plus récent est déjà chargé', async () => {
    let resolveFirst;
    let resolveSecond;
    jobsAPI.getAll
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    render(<Jobs />);

    await waitFor(() => expect(resolveFirst).toEqual(expect.any(Function)));
    const search = screen.getByPlaceholderText('Titre ou description...');
    fireEvent.change(search, { target: { value: 'récent' } });
    await waitFor(() => expect(resolveSecond).toEqual(expect.any(Function)));

    resolveSecond([JOB_B]);
    expect(await screen.findByText('Peinture du salon')).toBeTruthy();
    resolveFirst([JOB_A]);

    await waitFor(() => expect(screen.queryByText('Réparation de plomberie')).toBeNull());
    expect(screen.getByText('Peinture du salon')).toBeTruthy();
  });

  it('une panne sur « Afficher plus » garde les missions affichées et Réessayer charge la page manquante', async () => {
    const page1 = PAGE_PLEINE('page1', 12);
    const page2 = PAGE_PLEINE('page2', 3);
    jobsAPI.getAll
      .mockResolvedValueOnce(page1)
      .mockRejectedValueOnce(panneReseau())
      .mockResolvedValueOnce(page2);
    render(<Jobs />);

    fireEvent.click(await screen.findByRole('button', { name: 'Afficher plus de missions' }));

    // La panne de la page 2 ne doit pas effacer la page 1 déjà affichée.
    expect(await screen.findByText(RESEAU)).toBeTruthy();
    expect(screen.getByText('page1 mission 0')).toBeTruthy();
    expect(screen.getByText('page1 mission 11')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    // Le rejeu reprend LA PAGE QUI A ÉCHOUÉ, pas la première.
    await waitFor(() => expect(screen.getByText('page2 mission 0')).toBeTruthy());
    expect(screen.getByText('page1 mission 0')).toBeTruthy();
    expect(screen.queryByText(RESEAU)).toBeNull();
    expect(jobsAPI.getAll).toHaveBeenCalledTimes(3);
    const pages = jobsAPI.getAll.mock.calls.map(([params]) => params.page);
    expect(pages).toEqual([1, 2, 2]);
  });

  it('une panne sur la première page continue de se réparer en rechargeant cette page', async () => {
    jobsAPI.getAll
      .mockRejectedValueOnce(panneServeur())
      .mockResolvedValueOnce([JOB_A]);
    render(<Jobs />);

    fireEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));

    expect(await screen.findByText('Réparation de plomberie')).toBeTruthy();
    const pages = jobsAPI.getAll.mock.calls.map(([params]) => params.page);
    expect(pages).toEqual([1, 1]);
  });

  it('une liste vidée par un filtre propose de l’effacer, et la relance le charge', async () => {
    SEARCH_PARAMS.current = new URLSearchParams('category=plumbing');
    jobsAPI.getAll.mockResolvedValue([]);
    render(<Jobs />);

    const messageVide = await screen.findByText(VIDE_FILTRE);
    jobsAPI.getAll.mockResolvedValue([JOB_A]);
    // Deux boutons portent ce libellé depuis que la barre de filtres a le sien
    // (celui de la barre efface les filtres depuis n'importe quel état, celui-ci
    // est l'issue proposée PAR l'état vide) : on vise celui de la carte vide,
    // qui est le seul dont ce cas parle.
    fireEvent.click(within(messageVide.closest('div')).getByRole('button', { name: 'Effacer les filtres' }));

    expect(await screen.findByText('Réparation de plomberie')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(VIDE_FILTRE)).toBeNull());
  });
});

describe('Jobs — la carte n’est chargée qu’à son ouverture', () => {
  // Leaflet pèse 48,6 Ko gzip (bundle UMD ES5 non élagable) et sa vue n’est pas
  // celle par défaut : le chunk doit rester derrière un `import()` dynamique.
  // Ce cas verrouille les DEUX moitiés de la règle — absente tant qu’on ne
  // l’ouvre pas, rendue quand on l’ouvre — parce que supprimer le rendu de la
  // carte ferait aussi passer un test qui ne vérifierait que son absence.
  it('n’affiche pas la carte en vue liste, et la rend une fois la vue carte ouverte', async () => {
    jobsAPI.getAll.mockResolvedValue([JOB_A]);
    render(<Jobs />);

    expect(await screen.findByText('Réparation de plomberie')).toBeTruthy();
    expect(screen.queryByTestId('carte')).toBeNull();

    // Le libellé vient du dictionnaire publié, pas d’un littéral recopié.
    fireEvent.click(screen.getByRole('button', { name: fr.mapView }));

    expect(await screen.findByTestId('carte')).toBeTruthy();
  });
});

describe('Jobs — la carte de mission porte un bouton Partager, HORS de son lien', () => {
  // Ce cas verrouille la forme de la carte, pas le bouton (le partage a son
  // propre fichier) : la carte était ENTIÈREMENT un lien, et y poser un bouton
  // sans la défaire aurait produit un bouton DANS un lien — du HTML invalide,
  // et un piège au clavier (le bouton et le lien répondraient tous les deux à
  // Entrée). La carte est donc une boîte dont la colonne gauche est le lien.
  it('garde la carte cliquable et met Partager à côté, jamais dedans', async () => {
    jobsAPI.getAll.mockResolvedValue([JOB_A]);
    vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<Jobs />);

    const titre = await screen.findByText('Réparation de plomberie');
    // Le lien de la fiche existe toujours, et porte le titre.
    expect(titre.closest('a')).toBeTruthy();

    const partage = screen.getByRole('button', { name: /Partager/ });
    // Le bouton n'est PAS un descendant du lien. `closest('a')` remonterait au
    // lien ancêtre s'il y en avait un : c'est exactement ce qu'on refuse.
    expect(partage.closest('a')).toBeNull();

    // Et il partage réellement : wa.me avec le lien de la FICHE.
    fireEvent.click(partage);
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(window.open.mock.calls[0][0])).toContain('/jobs/job-1');
  });
});

describe('Jobs — le premier paint ne dépend pas de la réponse de l’API', () => {
  // Le plus grand texte de la page est son paragraphe d'intro : c'est lui
  // l'élément LCP. Il est déclaré par le plan, peint par la coquille
  // pré-rendue et rendu ici — donc il doit tenir dès le PREMIER rendu, la
  // requête encore en vol. Sinon le plus grand texte peint redevient celui de
  // l'état vide, qui n'existe qu'après la réponse, et le LCP recopie le temps
  // de réponse du backend (mesuré : 3,1 s de LCP mobile, dont 2,66 s de
  // `Render Delay` = l'attente de /api/jobs).
  it('affiche le paragraphe d’intro alors que la requête n’a pas encore répondu', () => {
    // Une requête qui ne se règle jamais : c'est l'état « en vol » que le
    // premier paint doit traverser.
    jobsAPI.getAll.mockReturnValue(new Promise(() => {}));
    render(<Jobs />);

    // Le texte vient du scope de la page, jamais d'un littéral recopié.
    expect(screen.getByText(jobsT('intro'))).toBeTruthy();
  });
});

describe('Jobs — la promesse d’alerte, dans le document pour un visiteur sans compte', () => {
  // Elle n'est PAS conditionnée par `?alerte=1` : mesuré le 30/10/2026, le
  // document pré-rendu de /jobs ne portait aucune occurrence de la promesse,
  // qui n'existait qu'après la réponse de l'API ou pour un travailleur
  // connecté. Un crawler et la première image ne savaient donc pas que cette
  // page OFFRE une veille — le seul chemin de retour du produit.
  it('peint la promesse SANS paramètre, avec les deux portes', async () => {
    SEARCH_PARAMS.current = new URLSearchParams('');
    jobsAPI.getAll.mockResolvedValue([JOB_A]);

    render(<Jobs />);

    expect(await screen.findByText(fr.jobAlertTitle)).toBeTruthy();
    // Le texte exact de la promesse : celui que la coquille pré-rendue publie.
    expect(screen.getByText(fr.jobAlertIntro)).toBeTruthy();
    // Les deux portes, et des clés existantes : aucune promesse sur l'offre.
    expect(screen.getByText(fr.createAccount)).toBeTruthy();
    expect(screen.getByText(fr.signIn)).toBeTruthy();
    // La carte INTERACTIVE n'est pas montée pour un visiteur sans compte :
    // les deux ne se peignent jamais ensemble (le titre serait deux fois là).
    expect(ALERTE.current).toEqual([]);
  });

  it('ne la peint pas pour un CLIENT connecté, qui publie ce catalogue', () => {
    SEARCH_PARAMS.current = new URLSearchParams('');
    AUTH.current = { user: { user_type: 'client', country: 'mali' } };
    jobsAPI.getAll.mockResolvedValue([]);

    render(<Jobs />);

    // Le bloc est STATIQUE : il est peint au premier rendu, ou pas du tout —
    // inutile d'attendre la réponse de l'API pour le constater.
    expect(screen.queryByText(fr.jobAlertTitle)).toBeNull();
    // Et la carte interactive ne lui est pas montée non plus : une veille lui
    // enverrait le catalogue qu'il publie lui-même.
    expect(ALERTE.current).toEqual([]);
    AUTH.current = { user: null };
  });
});

describe('Jobs — la PROVENANCE transmise à la carte d’alerte', () => {
  // `/jobs` est la page d'ARRIVÉE de tous les liens d'alerte : elle ne peut pas
  // deviner d'où vient le visiteur. C'est le lien qui le déclare (`&origine=`,
  // écrit par les pages ville et métier), et ce que la page en fait — le
  // transmettre, ou retomber sur « directe » — décide de ce qui sera enregistré
  // à la CRÉATION de la veille, donc de la seule mesure qui dira si ces pages
  // produisent des alertes.
  const monterPourUnTravailleur = () => {
    AUTH.current = { user: { id: 'worker-1', user_type: 'worker', country: 'mali' } };
    jobsAPI.getAll.mockResolvedValue([JOB_A]);
  };

  it('transmet l’origine déclarée par une page ville', async () => {
    monterPourUnTravailleur();
    SEARCH_PARAMS.current = new URLSearchParams('alerte=1&ville=Bamako&origine=ville');

    render(<Jobs />);

    await waitFor(() => expect(ALERTE.current.length).toBeGreaterThan(0));
    const props = ALERTE.current[ALERTE.current.length - 1];
    expect(props.origine).toBe('ville');
    // Les critères du lien continuent de passer : la provenance s'y AJOUTE.
    expect(props.villeInitiale).toBe('Bamako');
    expect(props.ouvrirAlerte).toBe(true);
  });

  it('transmet l’origine déclarée par une page métier', async () => {
    monterPourUnTravailleur();
    SEARCH_PARAMS.current = new URLSearchParams('alerte=1&category=plumbing&origine=metier');

    render(<Jobs />);

    await waitFor(() => expect(ALERTE.current.length).toBeGreaterThan(0));
    expect(ALERTE.current[ALERTE.current.length - 1].origine).toBe('metier');
  });

  it('sur /jobs sans lien, la provenance est « directe »', async () => {
    monterPourUnTravailleur();

    render(<Jobs />);

    await waitFor(() => expect(ALERTE.current.length).toBeGreaterThan(0));
    expect(ALERTE.current[ALERTE.current.length - 1].origine).toBe('directe');
  });

  it('une origine inconnue n’est pas relayée : le serveur refuserait la création', async () => {
    monterPourUnTravailleur();
    SEARCH_PARAMS.current = new URLSearchParams('alerte=1&ville=Bamako&origine=facebook');

    render(<Jobs />);

    await waitFor(() => expect(ALERTE.current.length).toBeGreaterThan(0));
    expect(ALERTE.current[ALERTE.current.length - 1].origine).toBe('directe');
  });
});
