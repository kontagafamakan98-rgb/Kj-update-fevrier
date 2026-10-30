import React, { useState } from 'react';
import OwnerService from '../services/ownerService';

/**
 * JOURNAL D'UNE MISSION — la chronologie complète, désaccord compris.
 *
 * ── Le trou que cet écran fermait à moitié ────────────────────────────────
 * Le journal métier (`business_events`) enregistre DIX jalons : les quatre
 * d'avant le séquestre (mission créée, proposition acceptée, paiement
 * confirmé, mission terminée), les trois du séquestre à deux temps, et les
 * CINQ du litige tracé. Cet écran n'en nommait que les quatre premiers : les
 * jalons du désaccord s'affichaient sous leur nom brut (`mission_dispute_answered`),
 * sans position ni échéance, donc la chronologie ne se lisait pas — il fallait
 * ouvrir la file d'arbitrage pour comprendre ce que le journal racontait.
 *
 * ── Deux lectures, et pourquoi la note n'est pas dans le journal ──────────
 * Le journal ne porte que des FAITS ÉNUMÉRÉS (`details` : `decision`,
 * `paiement`, `echeance`, `position`). Ni le motif ni la note de réponse n'y
 * entrent : ils sont écrits par une partie et peuvent porter un nom ou une
 * adresse (`kojo_business_events.DETAILS_AUTORISES`). La réponse complète est
 * donc lue à sa source, chez le propriétaire seul
 * (`GET /owner/missions/:id/litige`), avec la MOTIVATION de la décision, et
 * posées SOUS leur jalon respectif — `mission_dispute_answered` pour la
 * réponse, `mission_dispute_decided` pour la décision : la chronologie tient
 * d'un seul tenant, et le journal append-only reste ce qu'il est.
 *
 * La seconde lecture est BEST-EFFORT : si elle échoue, le journal s'affiche
 * quand même (les jalons sont la vérité), seules les notes manquent — on ne
 * remplace pas une chronologie lisible par un écran vide.
 */

// Les jalons, nommés. Un type inconnu garde son nom brut : il ne doit jamais
// disparaître de la liste.
const LIBELLES_JALONS = {
  mission_created: 'Mission créée',
  proposal_accepted: 'Proposition acceptée',
  payment_confirmed: 'Paiement confirmé',
  mission_completed: 'Mission terminée',
  mission_completion_marked: 'Fin déclarée par le travailleur',
  mission_completion_confirmed: 'Fin validée par le client',
  mission_auto_released: 'Libération automatique du séquestre',
  mission_dispute_opened: 'Litige ouvert',
  mission_dispute_answered: 'Réponse de l’autre partie',
  mission_dispute_withdrawn: 'Litige retiré',
  mission_dispute_decided: 'Litige tranché',
  mission_dispute_decision_failed: 'Décision non exécutée — à relancer',
  mission_dispute_expired: 'Litige échu sans décision',
};

// Codes d'échec d'une décision (`kojo_job_disputes.REMEDES_ECHEC`) : le journal
// ne reçoit qu'un CODE énuméré, jamais la phrase du fournisseur.
const LIBELLES_ECHEC = {
  sequestre_introuvable: 'aucun paiement séquestré',
  deja_en_mouvement: 'argent déjà en route',
  versement_refuse: 'versement refusé',
  remboursement_refuse: 'remboursement refusé',
};

// La position et la décision emploient le MÊME vocabulaire (c'est voulu côté
// backend) : deux tables seraient deux occasions de diverger, et l'arbitre doit
// lire sa propre décision dans les termes qu'il a demandés.
const LIBELLES_POSITION = {
  release_worker: 'verser au travailleur',
  refund_client: 'rembourser le client',
};

// Issue du décaissement, telle que le backend la nomme.
const LIBELLES_PAIEMENT = {
  released: 'versement effectué',
  refunded: 'remboursement effectué',
  refunding: 'remboursement en cours',
  refund_failed: 'remboursement en échec',
  releasing: 'versement en cours',
  held: 'séquestre toujours retenu',
};

const formaterDate = (valeur) => {
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? String(valeur) : date.toLocaleString('fr-FR');
};

const formaterJour = (valeur) => {
  if (!valeur) return '';
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? String(valeur) : date.toLocaleDateString('fr-FR');
};

/**
 * Le détail lisible d'un jalon, ou `''` s'il n'en porte pas.
 *
 * Exporté pour être jugé sur des jalons injectés : c'est ici que la
 * chronologie devient lisible (une position en français, une échéance en
 * toutes lettres), et un libellé oublié ne se voit pas dans un rendu.
 *
 * @param {{type?: string, details?: object}} evenement Jalon du journal.
 * @returns {string}
 */
export const detailLisible = (evenement) => {
  const details = evenement?.details || {};
  const morceaux = [];
  const position = LIBELLES_POSITION[details.position] || details.position;
  const decision = LIBELLES_POSITION[details.decision] || details.decision;

  if (evenement?.type === 'mission_dispute_opened' && details.echeance) {
    morceaux.push(`Échéance d’arbitrage : ${formaterJour(details.echeance)}`);
  }
  if (evenement?.type === 'mission_dispute_answered' && position) {
    morceaux.push(`Demande : ${position}`);
  }
  if (evenement?.type === 'mission_dispute_expired' && details.echeance) {
    morceaux.push(`Échéance dépassée : ${formaterJour(details.echeance)}`);
  }
  if (evenement?.type === 'mission_dispute_decided') {
    if (decision) morceaux.push(`Décision : ${decision}`);
    if (details.paiement) {
      morceaux.push(`paiement : ${LIBELLES_PAIEMENT[details.paiement] || details.paiement}`);
    }
  }
  // Une décision qui n'a rien payé : la décision TENTÉE et sa cause nommée,
  // sinon le jalon se lirait comme un échec sans objet.
  if (evenement?.type === 'mission_dispute_decision_failed') {
    if (decision) morceaux.push(`décision tentée : ${decision}`);
    if (details.echec) {
      morceaux.push(LIBELLES_ECHEC[details.echec] || details.echec);
    }
  }
  return morceaux.join(' · ');
};

// Panneau propriétaire : journal métier d'une mission, lecture seule.
const OwnerMissionEvents = () => {
  const [identifiant, setIdentifiant] = useState('');
  const [evenements, setEvenements] = useState(null);
  // Le litige lu chez le propriétaire : il porte les DEUX proses (réponse de
  // l'autre partie et motivation de la décision), que le journal ne stocke pas.
  const [litige, setLitige] = useState(null);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(false);

  const charger = async (event) => {
    event.preventDefault();
    const jobId = identifiant.trim();
    if (!jobId) return;

    setChargement(true);
    setErreur('');
    setEvenements(null);
    setLitige(null);
    try {
      const journal = await OwnerService.getMissionBusinessEvents(jobId);
      setEvenements(journal.evenements || []);
    } catch (e) {
      setErreur(e?.message || 'Impossible de charger le journal de cette mission.');
      return;
    } finally {
      setChargement(false);
    }

    // Les deux notes vivent dans le litige, pas dans le journal (le journal ne
    // porte aucune prose). Une lecture ratée ne retire rien au journal déjà
    // affiché : seules les notes manquent, et elles manquent sans bruit.
    try {
      const lu = await OwnerService.getMissionDispute(jobId);
      setLitige(lu?.litige || null);
    } catch (_e) {
      setLitige(null);
    }
  };

  return (
    <section className="carte-editoriale p-6 mb-8" aria-labelledby="titre-journal-mission">
      <h2 id="titre-journal-mission" className="titre-entree mb-4">Journal d’une mission</h2>

      <form onSubmit={charger} className="flex gap-3 flex-wrap mb-4">
        <label htmlFor="identifiant-mission" className="sr-only">Identifiant de la mission</label>
        <input
          id="identifiant-mission"
          type="text"
          value={identifiant}
          onChange={(event) => setIdentifiant(event.target.value)}
          placeholder="Identifiant de la mission"
          className="border border-stone-300 rounded-lg px-3 py-2 flex-1 min-w-[16rem]"
        />
        <button
          type="submit"
          disabled={chargement || !identifiant.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {chargement ? 'Chargement…' : 'Afficher le journal'}
        </button>
      </form>

      {erreur && (
        <p role="alert" className="text-red-700">{erreur}</p>
      )}

      {evenements && evenements.length === 0 && (
        <p className="text-stone-600">Aucun événement enregistré pour cette mission.</p>
      )}

      {evenements && evenements.length > 0 && (
        <ol className="space-y-2">
          {evenements.map((evenement) => {
            const detail = detailLisible(evenement);
            const reponseDuJalon = evenement.type === 'mission_dispute_answered' ? litige?.response : null;
            // La motivation n'est écrite QUE sur une décision exécutée : un
            // essai raté n'en porte pas, et le backend ne l'écrit pas.
            const noteDecision = evenement.type === 'mission_dispute_decided' ? litige?.decision_note : null;
            return (
              <li
                key={evenement.id || `${evenement.type}-${evenement.created_at}`}
                className="border-b border-stone-200 pb-2"
              >
                <div className="flex justify-between gap-4">
                  <span className="font-medium text-stone-900">
                    {LIBELLES_JALONS[evenement.type] || evenement.type}
                    {detail ? ` — ${detail}` : ''}
                  </span>
                  <time dateTime={evenement.created_at} className="text-stone-600">
                    {formaterDate(evenement.created_at)}
                  </time>
                </div>

                {/* La réponse COMPLÈTE, sous son jalon : lue chez le
                    propriétaire seul, jamais réécrite dans le journal. */}
                {reponseDuJalon?.note && (
                  <p className="mt-1 whitespace-pre-line rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
                    {reponseDuJalon.note}
                  </p>
                )}

                {/* La MOTIVATION du propriétaire sous LE JALON DE LA DÉCISION.
                    Nommée : sans étiquette, elle se lirait comme la réponse de
                    l'autre partie, déjà posée sous le jalon précédent. */}
                {noteDecision && (
                  <p className="mt-1 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-stone-500">
                      Motivation de la décision (propriétaire)
                    </span>
                    <span className="mt-1 block whitespace-pre-line">{noteDecision}</span>
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};

export default OwnerMissionEvents;
