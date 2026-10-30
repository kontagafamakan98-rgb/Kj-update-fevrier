import React, { useCallback, useEffect, useState } from 'react';
import OwnerService from '../services/ownerService';

/**
 * Litige tracé — la FILE D'ARBITRAGE, côté propriétaire.
 *
 * ── Ce que ce panneau remplace ────────────────────────────────────────────
 * Rien : c'était le trou. Un désaccord n'existait que comme ticket support,
 * sans état ni échéance, et l'échéance de libération automatique payait le
 * travailleur sans qu'un arbitre ait lu la contestation. La file est le remède
 * à la CÉCITÉ de l'échéance : un litige dont la fenêtre se referme demain doit
 * se lire avant un litige déjà refermé, et le propriétaire ne peut pas dépendre
 * d'un identifiant de mission qu'il n'a pas sous les yeux.
 *
 * ── Ce que la décision ne fait pas ────────────────────────────────────────
 * Elle ne paie pas : `liberer_sequestre` et `execute_paydunya_refund` restent
 * les propriétaires UNIQUES de chaque chemin, avec leur verrou CAS et leur
 * anti-double-versement. Cette route décide, le backend exécute.
 *
 * ── Panneau non traduit, comme le journal de mission ──────────────────────
 * Il s'adresse au propriétaire, seul lecteur, et les deux panneaux owner du
 * tableau de bord parlent la même langue.
 */

const formaterDate = (valeur) => {
  if (!valeur) return '';
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? String(valeur) : date.toLocaleDateString('fr-FR');
};

const LIBELLES_ETAT = {
  open: 'À trancher',
  expired: 'Fenêtre échue — décision encore possible',
  decision_failed: 'Décision en échec — à relancer',
  resolved: 'Tranché',
  withdrawn: 'Retiré par une partie',
};

// Codes d'échec de la décision (backend, `kojo_job_disputes.REMEDES_ECHEC`) :
// une décision qui n'a pas payé ne doit pas se lire comme un litige tranché.
const LIBELLES_ECHEC = {
  sequestre_introuvable: 'Aucun paiement séquestré à mouvementer sur cette mission',
  deja_en_mouvement: 'L’argent est déjà en route',
  versement_refuse: 'Le versement au travailleur a été refusé',
  remboursement_refuse: 'Le remboursement du client a été refusé',
};

const LIBELLES_ROLE = { client: 'client', worker: 'travailleur' };

// La position emploie le vocabulaire de la DÉCISION : l'arbitre lit ce que
// chaque côté demande dans les termes exacts du bouton qu'il devra cliquer.
const LIBELLES_POSITION = {
  release_worker: 'verser au travailleur',
  refund_client: 'rembourser le client',
};

// Un délai en heures ne se lit pas en heures au-delà de deux jours.
const formaterDelai = (heures) => {
  if (heures === null || heures === undefined) return '—';
  if (heures < 48) return `${heures} h`;
  return `${(heures / 24).toFixed(1).replace('.', ',')} j`;
};

// Un taux sous le plancher n'est pas publié : l'écran DIT pourquoi, au lieu
// d'afficher un pourcentage calculé sur trois litiges.
const libelleTaux = (taux, plancher, n) => (
  taux === null || taux === undefined
    ? `taux non publié (moins de ${plancher} cas, n = ${n})`
    : `${Math.round(taux * 100)} %`
);

// Dates ILLISIBLES ou FUTURES écartées d'une fenêtre : hors période est normal
// (c'est la fenêtre qui travaille), une date impossible ne l'est pas. Le
// backend les compte au lieu de les recaser ; l'écran ne les tait pas.
const datesIgnorees = (fenetre) =>
  Number(fenetre?.decisions?.date_illisible || 0) +
  Number(fenetre?.decisions?.date_future || 0) +
  Number(fenetre?.reponses?.date_illisible || 0) +
  Number(fenetre?.reponses?.date_future || 0);

const OwnerDisputes = () => {
  const [litiges, setLitiges] = useState([]);
  const [fenetreJours, setFenetreJours] = useState(null);
  // Mesures de l'arbitrage : calculées par le serveur sur l'HISTORIQUE, pas
  // devinées à l'écran. Une lecture ratée ne retire rien à la file.
  const [mesures, setMesures] = useState(null);
  const [mesuresIndisponibles, setMesuresIndisponibles] = useState(false);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(false);
  const [notes, setNotes] = useState({});
  const [enCours, setEnCours] = useState('');
  const [message, setMessage] = useState('');
  const [avertissement, setAvertissement] = useState('');

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur('');
    try {
      const reponse = await OwnerService.getDisputes();
      setLitiges(Array.isArray(reponse?.litiges) ? reponse.litiges : []);
      setFenetreJours(reponse?.fenetre_jours ?? null);
    } catch (e) {
      setErreur(e?.message || 'Impossible de charger la file d’arbitrage.');
    } finally {
      setChargement(false);
    }
  }, []);

  const chargerMesures = useCallback(async () => {
    try {
      setMesures(await OwnerService.getDisputeMesures());
      setMesuresIndisponibles(false);
    } catch (_e) {
      setMesures(null);
      // Nommé, jamais silencieux : « aucune mesure » et « mesure en panne » ne
      // se lisent pas pareil.
      setMesuresIndisponibles(true);
    }
  }, []);

  useEffect(() => {
    charger();
    chargerMesures();
  }, [charger, chargerMesures]);

  const decider = async (jobId, decision) => {
    const note = String(notes[jobId] || '').trim();
    if (note.length < 10) {
      setErreur('La décision doit être motivée (10 caractères minimum) : les deux parties la liront.');
      return;
    }

    setEnCours(jobId);
    setErreur('');
    setMessage('');
    setAvertissement('');
    try {
      const reponse = await OwnerService.decideDispute(jobId, { decision, note });
      // Une décision NON exécutée répond sans erreur mais avec un code : le
      // message est une consigne (corriger, relancer), pas une bonne nouvelle.
      if (reponse?.echec) {
        setAvertissement(reponse.message || 'Décision non exécutée : le litige reste à trancher.');
      } else {
        setMessage(reponse?.message || 'Litige tranché.');
      }
      setNotes((previous) => ({ ...previous, [jobId]: '' }));
      // La file est relue : un litige tranché n'a plus à occuper une place
      // d'arbitrage, et c'est le serveur qui dit le nouvel état. Les mesures
      // aussi : une décision de plus change un taux.
      await charger();
      await chargerMesures();
    } catch (e) {
      setErreur(e?.message || 'Décision impossible.');
    } finally {
      setEnCours('');
    }
  };

  return (
    <section className="carte-editoriale p-6 mb-8" aria-labelledby="titre-litiges-arbitrage">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="titre-litiges-arbitrage" className="titre-entree">Litiges à trancher</h2>
          <p className="mt-1 text-sm text-stone-600">
            Le paiement est gelé tant qu’un litige est ouvert — et tant qu’une décision
            qui n’a rien payé n’est pas relancée.
            {fenetreJours ? ` Fenêtre d’arbitrage : ${fenetreJours} jours, puis la règle ordinaire reprend.` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={charger}
          disabled={chargement}
          className="px-4 py-2 bg-stone-100 text-stone-800 rounded-lg hover:bg-stone-200 disabled:opacity-50"
        >
          {chargement ? 'Chargement…' : 'Actualiser'}
        </button>
      </div>

      {/* MESURES DE L'ARBITRAGE — ce que la file ne montre pas : le désaccord
          reçoit-il sa réponse à temps, et l'arbitre tranche-t-il sans l'avoir
          lue ? Comptes TOUJOURS, taux seulement au-dessus du plancher. */}
      {mesures && (
        <section
          aria-labelledby="titre-mesures-arbitrage"
          className="mb-6 rounded-lg bg-stone-50 p-4"
        >
          <h3
            id="titre-mesures-arbitrage"
            className="text-sm font-semibold uppercase tracking-wide text-stone-600"
          >
            Mesures de l’arbitrage
          </h3>
          {mesures.litiges?.total === 0 ? (
            <p className="mt-1 text-sm text-stone-600">Aucun litige à mesurer pour l’instant.</p>
          ) : (
            <>
              <p className="mt-1 text-xs text-stone-500">
                {mesures.litiges?.total} litige(s)
                {mesures.depuis ? ` depuis le ${formaterDate(mesures.depuis)}` : ''}
                {mesures.litiges?.tronque ? ' — lecture bornée, chiffres partiels' : ''}
                {' — historique complet.'}
              </p>
              <dl className="mt-3 grid gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-stone-500">Réponse reçue avant l’échéance</dt>
                  <dd className="text-lg font-semibold text-stone-900">
                    {mesures.reponse?.avant_echeance} / {mesures.reponse?.avec_reponse}
                  </dd>
                  <dd className="text-xs text-stone-500">
                    {libelleTaux(
                      mesures.reponse?.taux_avant_echeance,
                      mesures.plancher,
                      mesures.reponse?.avec_reponse,
                    )}
                    {mesures.reponse?.apres_echeance
                      ? ` · ${mesures.reponse.apres_echeance} reçue(s) après l’échéance`
                      : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">Tranchés sans réponse</dt>
                  <dd className="text-lg font-semibold text-stone-900">
                    {mesures.tranches?.sans_reponse} / {mesures.tranches?.total}
                  </dd>
                  <dd className="text-xs text-stone-500">
                    {libelleTaux(
                      mesures.tranches?.taux_sans_reponse,
                      mesures.plancher,
                      mesures.tranches?.total,
                    )}
                    {' · décidés sur une seule version'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">Réponse → décision</dt>
                  <dd className="text-lg font-semibold text-stone-900">
                    {formaterDelai(mesures.delai_reponse_decision?.mediane_heures)}
                  </dd>
                  <dd className="text-xs text-stone-500">
                    {mesures.delai_reponse_decision?.n
                      ? `médiane · moyenne ${formaterDelai(mesures.delai_reponse_decision.moyenne_heures)} · pire ${formaterDelai(mesures.delai_reponse_decision.max_heures)} (n = ${mesures.delai_reponse_decision.n})`
                      : 'aucune décision précédée d’une réponse'}
                  </dd>
                </div>
              </dl>

              {/* FENÊTRES — l'historique entier mélange une décision d'il y a six
                  mois et celle d'hier : il ne dit pas si ça va mieux. Les mêmes
                  trois questions sur 30 et 90 jours, calculées par le serveur
                  sur les mêmes lignes lues. */}
              {Array.isArray(mesures.fenetres) && mesures.fenetres.length > 0 && (
                <div className="mt-4 border-t border-stone-200 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Sur une période — la santé actuelle, pas l’historique
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-stone-600">
                    {mesures.fenetres.map((fenetre) => {
                      const ignorees = datesIgnorees(fenetre);
                      return (
                        <li key={fenetre.fenetre_jours}>
                          <span className="font-medium text-stone-800">
                            {fenetre.fenetre_jours} derniers jours
                          </span>
                          {' — '}
                          {fenetre.reponses?.total
                            ? `${libelleTaux(fenetre.reponses.taux_avant_echeance, mesures.plancher, fenetre.reponses.total)} à temps (${fenetre.reponses.avant_echeance} / ${fenetre.reponses.total})`
                            : 'aucune réponse reçue'}
                          {' · '}
                          {fenetre.decisions?.total
                            ? `${libelleTaux(fenetre.decisions.taux_sans_reponse, mesures.plancher, fenetre.decisions.total)} sans réponse (${fenetre.decisions.sans_reponse} / ${fenetre.decisions.total})`
                            : 'aucune décision'}
                          {' · '}
                          {fenetre.delai_reponse_decision?.n
                            ? `réponse → décision ${formaterDelai(fenetre.delai_reponse_decision.mediane_heures)}`
                            : 'aucun délai mesuré'}
                          {ignorees > 0
                            ? ` · ${ignorees} date(s) ignorée(s) (illisible ou future)`
                            : ''}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      )}
      {mesuresIndisponibles && !mesures && (
        <p className="mb-4 text-xs text-stone-500">
          Mesures de l’arbitrage indisponibles : la file reste utilisable.
        </p>
      )}

      {erreur && <p role="alert" className="mb-4 text-red-700">{erreur}</p>}
      {avertissement && (
        <p role="alert" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
          {avertissement}
        </p>
      )}
      {message && <p className="mb-4 text-green-800">{message}</p>}

      {!chargement && litiges.length === 0 && !erreur && (
        <p className="text-stone-600">Aucun litige en attente d’arbitrage.</p>
      )}

      <ul className="space-y-4">
        {litiges.map((item) => {
          const litige = item.litige || {};
          const jobId = item.job_id;
          const occupe = enCours === jobId;
          return (
            <li key={jobId} className="rounded-lg border border-stone-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-stone-900">{item.title || jobId}</p>
                  <p className="text-xs text-stone-500">
                    {LIBELLES_ETAT[litige.state] || litige.state}
                    {litige.decision_deadline_at ? ` — échéance ${formaterDate(litige.decision_deadline_at)}` : ''}
                  </p>
                  {/* Une décision tentée qui n'a RIEN payé : le faire dire ici,
                      sinon le litige revient dans la file sans explication. */}
                  {litige.decision_failure && (
                    <p className="mt-1 text-xs text-amber-800">
                      {LIBELLES_ECHEC[litige.decision_failure] || litige.decision_failure}
                      {litige.decision_attempted_at ? ` — tentative du ${formaterDate(litige.decision_attempted_at)}` : ''}
                      {'. Corriger la cause, puis relancer la décision.'}
                    </p>
                  )}
                </div>
                <span className="text-xs text-stone-600">
                  Ouvert par le {LIBELLES_ROLE[litige.opened_by_role] || litige.opened_by_role}
                  {litige.opened_at ? ` le ${formaterDate(litige.opened_at)}` : ''}
                </span>
              </div>

              {/* Les DEUX versions : ce que l'ouvreur conteste, et ce que
                  l'autre partie demande. Le propriétaire tranche sur cet
                  ensemble — avec un seul texte à l'écran, il tranchait un son
                  de cloche. */}
              {litige.reason && (
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Ce que conteste le {LIBELLES_ROLE[litige.opened_by_role] || litige.opened_by_role}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm text-stone-700">{litige.reason}</p>
                </div>
              )}

              {litige.response ? (
                <div className="mt-3 rounded-lg bg-stone-50 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Réponse de l’autre partie — demande :
                    {' '}
                    {LIBELLES_POSITION[litige.response.position] || litige.response.position}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm text-stone-700">
                    {litige.response.note}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-stone-500">
                  Pas encore de réponse : la décision porterait sur une seule version.
                </p>
              )}

              <label
                htmlFor={`note-litige-${jobId}`}
                className="mt-4 block text-sm font-medium text-stone-800"
              >
                Motivation de la décision (lue par les deux parties)
              </label>
              <textarea
                id={`note-litige-${jobId}`}
                rows={2}
                value={notes[jobId] || ''}
                onChange={(event) => setNotes((previous) => ({ ...previous, [jobId]: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
              />

              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => decider(jobId, 'release_worker')}
                  disabled={occupe}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {occupe ? 'Traitement…' : 'Verser le travailleur'}
                </button>
                <button
                  type="button"
                  onClick={() => decider(jobId, 'refund_client')}
                  disabled={occupe}
                  className="px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50"
                >
                  {occupe ? 'Traitement…' : 'Rembourser le client'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default OwnerDisputes;
