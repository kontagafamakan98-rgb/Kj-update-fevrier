/**
 * Litige tracé — la file d'arbitrage du propriétaire.
 *
 * Ce qui est prouvé ici, et pourquoi ça compte : sans cet écran, une
 * contestation restait ouverte sans que personne ne la voie, et l'échéance
 * tranchait à la place du propriétaire. Les cas jugent donc le geste :
 *   1. la file rend ce que le serveur publie (titre, motif, échéance) ;
 *   2. une décision SANS motivation ne part pas — les deux parties liront
 *      cette note, et une décision muette relancerait le désaccord ;
 *   3. une décision motivée appelle le bon chemin (verser / rembourser) puis
 *      RELIT la file : c'est le serveur qui dit le nouvel état.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OwnerDisputes from '../OwnerDisputes';
import OwnerService from '../../services/ownerService';

vi.mock('../../services/ownerService', () => ({
  default: {
    getDisputes: vi.fn(),
    decideDispute: vi.fn(),
    getDisputeMesures: vi.fn(),
  },
}));

const MESURES = {
  mesure_le: '2026-10-21T12:00:00+00:00',
  plancher: 10,
  depuis: '2026-09-01T00:00:00+00:00',
  litiges: { total: 6, lus: 6, tronque: false },
  etats: { open: 1, expired: 1, resolved: 2, withdrawn: 1, decision_failed: 1 },
  reponse: {
    avec_reponse: 3,
    avant_echeance: 2,
    apres_echeance: 1,
    echeance_illisible: 0,
    reponse_illisible: 0,
    // Sous le plancher : le serveur ne publie PAS de taux.
    taux_avant_echeance: null,
  },
  tranches: { total: 2, sans_reponse: 1, avec_reponse: 1, taux_sans_reponse: null },
  delai_reponse_decision: {
    n: 1,
    mediane_heures: 20,
    moyenne_heures: 20,
    max_heures: 20,
    incoherents: 0,
  },
};

const LITIGE = {
  job_id: 'job-1',
  title: 'Plomberie urgente Dakar',
  status: 'in_progress',
  client_id: 'client-1',
  worker_id: 'worker-1',
  litige: {
    state: 'open',
    reason: 'Le joint posé fuit au bout de deux jours.',
    opened_by: 'client-1',
    opened_by_role: 'client',
    opened_at: '2026-10-21T10:00:00+00:00',
    decision_deadline_at: '2026-10-26T10:00:00+00:00',
  },
};

beforeEach(() => {
  OwnerService.getDisputes.mockResolvedValue({
    count: 1,
    etats: ['open'],
    fenetre_jours: 5,
    litiges: [LITIGE],
  });
  OwnerService.decideDispute.mockResolvedValue({ message: 'Litige tranché.' });
  OwnerService.getDisputeMesures.mockResolvedValue(MESURES);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OwnerDisputes', () => {
  it('rend la file avec le motif et la fenêtre d’arbitrage', async () => {
    render(<OwnerDisputes />);

    expect(await screen.findByText('Plomberie urgente Dakar')).toBeInTheDocument();
    expect(screen.getByText(LITIGE.litige.reason)).toBeInTheDocument();
    expect(screen.getByText(/fenêtre d’arbitrage : 5 jours/i)).toBeInTheDocument();
    expect(screen.getByText(/ouvert par le client/i)).toBeInTheDocument();
    // Sans réponse, la file le DIT : une décision ne porterait que sur une version.
    expect(screen.getByText(/pas encore de réponse/i)).toBeInTheDocument();
  });

  it('rend les DEUX versions : le motif et la réponse avec sa demande', async () => {
    const REPONSE = 'Le joint a été changé et testé le jour même ; la fuite vient du siphon.';
    OwnerService.getDisputes.mockResolvedValue({
      count: 1,
      etats: ['open'],
      fenetre_jours: 5,
      litiges: [{
        ...LITIGE,
        litige: {
          ...LITIGE.litige,
          response: {
            position: 'release_worker',
            note: REPONSE,
            author_id: 'worker-1',
            author_role: 'worker',
            responded_at: '2026-10-22T09:00:00+00:00',
          },
        },
      }],
    });
    render(<OwnerDisputes />);

    expect(await screen.findByText(/ce que conteste le client/i)).toBeInTheDocument();
    expect(screen.getByText(LITIGE.litige.reason)).toBeInTheDocument();
    expect(screen.getByText(/réponse de l’autre partie — demande : verser au travailleur/i)).toBeInTheDocument();
    expect(screen.getByText(REPONSE)).toBeInTheDocument();
    expect(screen.queryByText(/pas encore de réponse/i)).not.toBeInTheDocument();
  });

  it('dit qu’aucun litige n’attend quand la file est vide', async () => {
    OwnerService.getDisputes.mockResolvedValue({ count: 0, litiges: [], fenetre_jours: 5 });
    render(<OwnerDisputes />);

    expect(await screen.findByText(/aucun litige en attente/i)).toBeInTheDocument();
  });

  it('une décision sans motivation ne part pas', async () => {
    render(<OwnerDisputes />);
    await screen.findByText('Plomberie urgente Dakar');

    await userEvent.click(screen.getByRole('button', { name: /verser le travailleur/i }));

    expect(OwnerService.decideDispute).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/10 caractères minimum/i);
  });

  it('une décision motivée appelle le bon chemin puis RELIT la file', async () => {
    render(<OwnerDisputes />);
    await screen.findByText('Plomberie urgente Dakar');

    await userEvent.type(
      screen.getByLabelText(/motivation de la décision/i),
      'Preuve photo conforme, travail achevé.',
    );
    await userEvent.click(screen.getByRole('button', { name: /rembourser le client/i }));

    await waitFor(() => expect(OwnerService.decideDispute).toHaveBeenCalledTimes(1));
    expect(OwnerService.decideDispute).toHaveBeenCalledWith('job-1', {
      decision: 'refund_client',
      note: 'Preuve photo conforme, travail achevé.',
    });
    // La file est relue : un litige tranché ne doit plus occuper une place.
    await waitFor(() => expect(OwnerService.getDisputes).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Litige tranché.')).toBeInTheDocument();
  });

  it('publie les trois mesures de l’arbitrage, avec leurs dénominateurs', async () => {
    render(<OwnerDisputes />);

    expect(await screen.findByText(/mesures de l’arbitrage/i)).toBeInTheDocument();
    expect(screen.getByText(/6 litige\(s\) depuis le 01\/09\/2026/i)).toBeInTheDocument();
    // « à temps » se lit sur les réponses reçues, jamais sur le total des litiges.
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByText(/1 reçue\(s\) après l’échéance/i)).toBeInTheDocument();
    // Tranché sans réponse : la mesure qui dit si l'arbitre a lu l'autre partie.
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText(/décidés sur une seule version/i)).toBeInTheDocument();
    // Délai réponse → décision : la médiane, pas une impression.
    expect(screen.getAllByText('20 h').length).toBeGreaterThan(0);
    expect(screen.getByText(/médiane · moyenne 20 h · pire 20 h \(n = 1\)/i)).toBeInTheDocument();
    // Sous le plancher, l'écran DIT que le taux n'est pas publié — il n'affiche
    // ni 0 % ni 100 %.
    expect(screen.getAllByText(/taux non publié \(moins de 10 cas, n = 3\)/i).length).toBe(1);
    expect(screen.getAllByText(/taux non publié \(moins de 10 cas, n = 2\)/i).length).toBe(1);
  });

  it('distingue la santé des 30 jours de l’historique', async () => {
    // L'historique entier mélange une décision d'il y a six mois et celle
    // d'hier : la période est ce qui dit si l'arbitrage va mieux.
    OwnerService.getDisputeMesures.mockResolvedValue({
      ...MESURES,
      litiges: { total: 24, lus: 24, tronque: false },
      fenetres: [
        {
          fenetre_jours: 30,
          depuis: '2026-09-21T12:00:00+00:00',
          decisions: {
            total: 12, sans_reponse: 3, avec_reponse: 9, reponse_illisible: 0,
            hors_fenetre: 12, date_illisible: 1, date_future: 0, taux_sans_reponse: 0.25,
          },
          // Six réponses seulement : sous le plancher, le taux n'est pas publié.
          reponses: {
            total: 6, avant_echeance: 4, apres_echeance: 2, echeance_illisible: 0,
            reponse_illisible: 0, hors_fenetre: 0, date_illisible: 0, date_future: 0,
            taux_avant_echeance: null,
          },
          delai_reponse_decision: { n: 4, mediane_heures: 20, moyenne_heures: 25, max_heures: 40, incoherents: 0 },
        },
        {
          fenetre_jours: 90,
          depuis: '2026-07-23T12:00:00+00:00',
          decisions: {
            total: 24, sans_reponse: 4, avec_reponse: 20, reponse_illisible: 0,
            hors_fenetre: 0, date_illisible: 1, date_future: 0, taux_sans_reponse: 0.167,
          },
          reponses: {
            total: 20, avant_echeance: 14, apres_echeance: 6, echeance_illisible: 0,
            reponse_illisible: 0, hors_fenetre: 0, date_illisible: 0, date_future: 0,
            taux_avant_echeance: 0.7,
          },
          delai_reponse_decision: { n: 14, mediane_heures: 30, moyenne_heures: 35, max_heures: 90, incoherents: 0 },
        },
      ],
    });

    render(<OwnerDisputes />);

    expect(await screen.findByText(/sur une période/i)).toBeInTheDocument();
    // Les deux périodes sont nommées, et l'historique reste nommé comme tel.
    expect(screen.getByText('30 derniers jours')).toBeInTheDocument();
    expect(screen.getByText('90 derniers jours')).toBeInTheDocument();
    expect(screen.getByText(/historique complet/i)).toBeInTheDocument();
    // 30 j : le taux des décisions est publié, celui des réponses non.
    expect(screen.getByText(/25 % sans réponse \(3 \/ 12\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/taux non publié \(moins de 10 cas, n = 6\) à temps \(4 \/ 6\)/),
    ).toBeInTheDocument();
    // 90 j : les mêmes questions, avec l'historique.
    expect(screen.getByText(/70 % à temps \(14 \/ 20\)/)).toBeInTheDocument();
    expect(screen.getByText(/17 % sans réponse \(4 \/ 24\)/)).toBeInTheDocument();
    // Une date impossible est écartée de CHAQUE fenêtre, et c'est DIT — jamais
    // silencieux.
    expect(
      screen.getAllByText(/1 date\(s\) ignorée\(s\) \(illisible ou future\)/).length,
    ).toBe(2);
  });

  it('publie les taux quand le plancher est franchi', async () => {
    OwnerService.getDisputeMesures.mockResolvedValue({
      ...MESURES,
      litiges: { total: 12, lus: 12, tronque: false },
      reponse: { ...MESURES.reponse, avec_reponse: 12, avant_echeance: 9, taux_avant_echeance: 0.75 },
      tranches: { total: 10, sans_reponse: 2, avec_reponse: 8, taux_sans_reponse: 0.2 },
    });

    render(<OwnerDisputes />);

    expect(await screen.findByText(/75 %/)).toBeInTheDocument();
    expect(screen.getByText(/20 % · décidés sur une seule version/)).toBeInTheDocument();
  });

  it('une mesure indisponible laisse la file utilisable et le DIT', async () => {
    OwnerService.getDisputeMesures.mockRejectedValue(new Error('Mesures indisponibles'));

    render(<OwnerDisputes />);

    expect(await screen.findByText('Plomberie urgente Dakar')).toBeInTheDocument();
    expect(screen.getByText(/mesures de l’arbitrage indisponibles/i)).toBeInTheDocument();
    // Aucun chiffre n'est affiché : une mesure qui n'a pas été lue ne s'invente pas.
    expect(screen.queryByText(/litige\(s\) depuis le/i)).not.toBeInTheDocument();
  });

  it('une décision dont le paiement échoue est une CONSIGNE, pas un litige tranché', async () => {
    // Le backend répond 200 avec un code d'échec : la décision n'a rien payé.
    // L'écran doit alors dire quoi corriger — et surtout pas « Litige tranché ».
    OwnerService.decideDispute.mockResolvedValue({
      message: 'Le versement au travailleur a été refusé (compte de décaissement ou fournisseur) : corriger la cause, puis relancer la décision.',
      decision: 'release_worker',
      payment_outcome: 'release_failed',
      dispute_state: 'decision_failed',
      echec: 'versement_refuse',
      relance: true,
    });

    render(<OwnerDisputes />);
    await screen.findByText('Plomberie urgente Dakar');
    await userEvent.type(
      screen.getByLabelText(/motivation de la décision/i),
      'Preuve photo conforme, travail achevé.',
    );
    await userEvent.click(screen.getByRole('button', { name: /verser le travailleur/i }));

    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent(/puis relancer la décision/i);
    expect(screen.queryByText('Litige tranché.')).not.toBeInTheDocument();
    // La file est relue : le litige en échec doit y revenir, pas disparaître.
    await waitFor(() => expect(OwnerService.getDisputes).toHaveBeenCalledTimes(2));
  });

  it('un litige dont la décision a échoué rend sa cause et reste relançable', async () => {
    OwnerService.getDisputes.mockResolvedValue({
      count: 1,
      etats: ['decision_failed'],
      fenetre_jours: 5,
      litiges: [{
        ...LITIGE,
        litige: {
          ...LITIGE.litige,
          state: 'decision_failed',
          decision_failure: 'versement_refuse',
          decision_attempted_at: '2026-10-22T09:00:00+00:00',
        },
      }],
    });

    render(<OwnerDisputes />);

    expect(await screen.findByText(/décision en échec — à relancer/i)).toBeInTheDocument();
    expect(screen.getByText(/le versement au travailleur a été refusé/i)).toBeInTheDocument();
    expect(screen.getByText(/corriger la cause, puis relancer la décision/i)).toBeInTheDocument();
    // Les deux boutons sont toujours là : la relance EST la décision rejouée.
    expect(screen.getByRole('button', { name: /verser le travailleur/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rembourser le client/i })).toBeInTheDocument();
  });

  it('une erreur du serveur est annoncée', async () => {
    OwnerService.getDisputes.mockRejectedValue(new Error('Accès interdit'));
    render(<OwnerDisputes />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Accès interdit');
  });
});
