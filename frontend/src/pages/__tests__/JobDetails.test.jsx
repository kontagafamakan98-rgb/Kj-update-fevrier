/**
 * LA FICHE MISSION PRÉ-RENDUE DÉMARRE L'APPLICATION, ET GARDE SA TÊTE.
 *
 * ── Ce que ce fichier ferme ────────────────────────────────────────────────
 * Le document `/jobs/:id` était lisible et inerte : un lien partagé — le SEUL
 * chemin d'arrivée d'un visiteur à froid — ouvrait une page sans châssis, sans
 * navigation et sans propositions. Le backend publie donc la vue publique déjà
 * rendue (`kojo-job-data`) et cette page la reprend comme ÉTAT INITIAL : la
 * fiche s'affiche tout de suite, puis la relecture de l'API la rafraîchit.
 *
 * Ce fichier juge les deux moitiés de la promesse :
 *   • la fiche est peinte SANS squelette, et son titre, sa description et sa
 *     carte de partage sont ceux de la mission dès le premier rendu — la passe
 *     n'a rien retiré à ce que lit un crawler ;
 *   • les trois refus du bloc (identifiant d'une AUTRE mission, JSON illisible,
 *     relecture échouée) retombent sur le comportement d'avant, ou n'effacent
 *     pas ce qui est déjà juste.
 *
 * jsdom pour le COMPORTEMENT : le dessin, lui, appartient aux sondes navigateur.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../contexts/LanguageContext', async (importOriginal) => {
  const actual = await importOriginal();
  const { default: fr } = await vi.importActual('../../i18n/fr.json');
  return {
    ...actual,
    useLanguage: () => ({ currentLanguage: 'fr', changeLanguage: vi.fn(), t: (key) => fr[key] ?? key }),
  };
});

// Le visiteur à froid est ANONYME : c'est la vue publique que le document
// porte, et c'est cette identité-là que la page doit servir sans attendre.
// L'état est MUTABLE pour le cas du propriétaire (voir plus bas) : figer
// `user: null` rendrait ce cas inécrivable.
const etatUtilisateur = vi.hoisted(() => ({ user: null }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: etatUtilisateur.user }) }));
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
// Les avis et les propositions ont leurs propres tests : ici ils ne feraient
// qu'ajouter des requêtes à simuler pour un état de page que le cas ne juge pas.
vi.mock('../../components/JobReviews', () => ({ default: () => null }));

const { getById, getProposals } = vi.hoisted(() => ({ getById: vi.fn(), getProposals: vi.fn() }));
vi.mock('../../services/apiEndpoints', () => ({
  jobsAPI: { getById, getProposals },
  reviewAPI: { getJobReviews: vi.fn().mockResolvedValue([]) },
}));

const { default: JobDetails } = await import('../JobDetails.js');
const { APERCU_MISSION } = await import('../../config/apercu-mission.js');

const rendre = () =>
  render(
    <MemoryRouter initialEntries={['/jobs/j-1']}>
      <Routes>
        <Route path="/jobs/:id" element={<JobDetails />} />
      </Routes>
    </MemoryRouter>
  );

/** Vue publique d'une mission — la forme que porte le document pré-rendu. */
const MISSION = {
  id: 'j-1',
  title: 'Réparation d’une fuite à Dakar',
  description: 'Fuite lente sous l’évier de la cuisine, à réparer cette semaine.',
  category: 'plumbing',
  budget_min: 10000,
  budget_max: 30000,
  status: 'open',
  location: { address: 'Dakar Plateau, Sénégal' },
  posted_at: '2026-10-18T10:00:00+00:00',
};

/**
 * Pose le bloc de données que le document pré-rendu porte (`kojo_job_og.py`).
 *
 * Il vit HORS de `#root` dans le document servi : les tests le posent donc sur
 * `document.body`, comme le backend l'écrit.
 */
const poserApercu = (donnees, { id = APERCU_MISSION.SEED_ID } = {}) => {
  const noeud = document.createElement('script');
  noeud.type = 'application/json';
  noeud.id = id;
  noeud.textContent = typeof donnees === 'string' ? donnees : JSON.stringify(donnees);
  document.body.appendChild(noeud);
  return noeud;
};

const reponse = (corps, statut = 200) => ({
  ok: statut >= 200 && statut < 300,
  status: statut,
  data: corps,
  json: async () => corps,
});

beforeEach(() => {
  getById.mockReset();
  getProposals.mockReset();
});

afterEach(() => {
  cleanup();
  // Le bloc survit à `cleanup()` (il n'est pas dans le conteneur React) : sans
  // ce retrait, l'aperçu d'un cas serait lu par le suivant.
  document
    .querySelectorAll(`#${APERCU_MISSION.SEED_ID}`)
    .forEach((noeud) => noeud.remove());
  document.head.querySelectorAll('meta[property^="og:"], meta[name="description"]').forEach((m) => m.remove());
  vi.clearAllMocks();
});

describe('Fiche mission pré-rendue', () => {
  it('affiche la fiche TOUT DE SUITE, avec son titre, sa description et sa carte', async () => {
    poserApercu(MISSION);
    // La relecture de l'API arrive plus tard, avec une autre donnée : ce qui est
    // jugé ici est l'état AVANT elle.
    getById.mockResolvedValueOnce(reponse({ ...MISSION, title: 'Titre relu par l’API' }));

    rendre();

    // AVANT toute résolution de requête : le titre de la mission est peint.
    expect(screen.getByRole('heading', { name: MISSION.title })).toBeInTheDocument();
    // La tête du document est celle de la mission, pas le titre générique du
    // site : la passer à l'application ne l'a pas effacée.
    expect(document.title).toBe(`${MISSION.title} — Kojo`);
    expect(document.querySelector('meta[name="description"]').getAttribute('content')).toContain(
      'Fuite lente sous l’évier'
    );
    expect(document.querySelector('meta[property="og:title"]').getAttribute('content')).toBe(
      `${MISSION.title} — Kojo`
    );
    expect(document.querySelector('meta[property="og:image"]').getAttribute('content')).toMatch(
      /\/api\/og\/jobs\/j-1\.png$/
    );
    expect(
      document.querySelector('link[rel="canonical"]').getAttribute('href').endsWith('/jobs/j-1')
    ).toBe(true);

    // Puis la relecture rafraîchit sans effacer la fiche entre-temps.
    expect(await screen.findByRole('heading', { name: 'Titre relu par l’API' })).toBeInTheDocument();
    expect(getById).toHaveBeenCalledTimes(1);
  });

  it('ignore un aperçu d’une AUTRE mission', async () => {
    // Un cache de document peut servir le bloc d'une fiche pour une autre URL :
    // l'afficher montrerait la mauvaise mission, avec son budget et son adresse.
    poserApercu({ ...MISSION, id: 'j-autre', title: 'Mission d’une autre fiche' });
    getById.mockResolvedValueOnce(reponse(MISSION));

    rendre();

    expect(screen.queryByText('Mission d’une autre fiche')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: MISSION.title })).toBeInTheDocument();
  });

  it('un aperçu ILLISIBLE retombe sur le chargement normal', async () => {
    poserApercu('{"id":');
    getById.mockResolvedValueOnce(reponse(MISSION));

    rendre();

    expect(screen.queryByRole('heading', { name: MISSION.title })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: MISSION.title })).toBeInTheDocument();
  });

  it('une relecture RATÉE n’efface pas la fiche déjà rendue', async () => {
    // Le contenu vient du serveur il y a quelques secondes : une fiche valable
    // vaut mieux qu'un « mission introuvable » qui la remplace.
    poserApercu(MISSION);
    getById.mockRejectedValueOnce(new Error('réseau indisponible'));

    rendre();

    await waitFor(() => expect(getById).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('heading', { name: MISSION.title })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

/**
 * LES CANDIDATURES NE SE TAISENT PAS QUAND ELLES N'ONT PAS ÉTÉ LUES.
 *
 * Mesuré en production le 23/10/2026 sur le compte propriétaire : la route
 * répondait 403, la fiche affichait « Aucune proposition pour le moment » — un
 * vide qui n'avait rien mesuré — et la console se remplissait d'« Access
 * denied ». Le premier cas ferme ce mensonge ; le second prouve le chemin
 * normal, pour qu'une correction de l'erreur ne fige pas l'écran sur elle.
 */
describe('Fiche mission — les candidatures lues, ou l’échec DIT', () => {
  const CANDIDATURE = {
    id: 'p-1',
    job_id: 'j-1',
    worker_id: 'w-1',
    proposed_amount: 25000,
    estimated_completion_time: '2 jours',
    message: 'Je peux intervenir dès demain matin.',
    worker_name: 'Kojo Plomberie',
    status: 'pending',
  };

  afterEach(() => {
    etatUtilisateur.user = null;
  });

  it('une lecture refusée affiche l’échec et la relance, jamais « aucune proposition »', async () => {
    etatUtilisateur.user = { id: 'owner-1', is_owner: true, user_type: 'owner', first_name: 'Famakan' };
    getById.mockResolvedValueOnce(reponse({ ...MISSION, client_id: 'client-1' }));
    getProposals.mockRejectedValueOnce(Object.assign(new Error('Access denied'), { response: { status: 403 } }));

    rendre();

    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent('Les candidatures n’ont pas pu être chargées');
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    expect(screen.queryByText('Aucune proposition pour le moment')).not.toBeInTheDocument();
  });

  it('un propriétaire lit les candidatures que le serveur lui rend', async () => {
    etatUtilisateur.user = { id: 'owner-1', is_owner: true, user_type: 'owner', first_name: 'Famakan' };
    getById.mockResolvedValueOnce(reponse({ ...MISSION, client_id: 'client-1' }));
    getProposals.mockResolvedValueOnce(reponse([CANDIDATURE]));

    rendre();

    expect(await screen.findByText('Kojo Plomberie')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Aucune proposition pour le moment')).not.toBeInTheDocument();
  });
});

/**
 * LE PARTAGE N'ATTEND AUCUN COMPTE.
 *
 * Le visiteur à froid — celui qui arrive par un lien déjà partagé — est le seul
 * à pouvoir faire circuler une mission sans rien créer : le bouton est donc
 * rendu AVANT les actions qui dépendent d'un rôle, et il ne dépend d'aucun. Ce
 * qu'il envoie est le lien de la FICHE (`/jobs/:id`), la seule URL que le
 * backend pré-rend avec ses balises Open Graph, donc la seule qui affiche un
 * aperçu lisible chez le destinataire.
 */
describe('Fiche mission — le partage, pour un visiteur sans compte', () => {
  it('offre Partager et envoie le lien de la FICHE, avec son titre', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    getById.mockResolvedValueOnce(reponse(MISSION));

    rendre();

    const partage = await screen.findByRole('button', { name: /Partager/ });
    fireEvent.click(partage);

    expect(open).toHaveBeenCalledTimes(1);
    const [url] = open.mock.calls[0];
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    const message = decodeURIComponent(url);
    expect(message).toContain('/jobs/j-1');
    expect(message).toContain(MISSION.title);

    open.mockRestore();
  });
});
