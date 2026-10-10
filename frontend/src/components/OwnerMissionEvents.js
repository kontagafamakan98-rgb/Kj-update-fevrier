import React, { useState } from 'react';
import OwnerService from '../services/ownerService';

// Libellés des quatre jalons de `kojo_business_events` (backend). Un type inconnu
// garde son nom brut : il ne doit jamais disparaître de la liste.
const LIBELLES_JALONS = {
  mission_created: 'Mission créée',
  proposal_accepted: 'Proposition acceptée',
  payment_confirmed: 'Paiement confirmé',
  mission_completed: 'Mission terminée',
};

const formaterDate = (valeur) => {
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? String(valeur) : date.toLocaleString('fr-FR');
};

// Panneau propriétaire : journal métier d'une mission, lecture seule.
const OwnerMissionEvents = () => {
  const [identifiant, setIdentifiant] = useState('');
  const [evenements, setEvenements] = useState(null);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(false);

  const charger = async (event) => {
    event.preventDefault();
    const jobId = identifiant.trim();
    if (!jobId) return;

    setChargement(true);
    setErreur('');
    setEvenements(null);
    try {
      const reponse = await OwnerService.getMissionBusinessEvents(jobId);
      setEvenements(reponse.evenements || []);
    } catch (e) {
      setErreur(e?.message || 'Impossible de charger le journal de cette mission.');
    } finally {
      setChargement(false);
    }
  };

  return (
    <section className="carte-editoriale p-6 mb-8" aria-labelledby="titre-journal-mission">
      <h2 id="titre-journal-mission" className="titre-entree mb-4">Journal d'une mission</h2>

      <form onSubmit={charger} className="flex gap-3 flex-wrap mb-4">
        <label htmlFor="identifiant-mission" className="sr-only">Identifiant de la mission</label>
        <input
          id="identifiant-mission"
          type="text"
          value={identifiant}
          onChange={(event) => setIdentifiant(event.target.value)}
          placeholder="Identifiant de la mission"
          className="border border-gray-300 rounded-lg px-3 py-2 flex-1 min-w-[16rem]"
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
        <p className="text-gray-600">Aucun événement enregistré pour cette mission.</p>
      )}

      {evenements && evenements.length > 0 && (
        <ol className="space-y-2">
          {evenements.map((evenement) => (
            <li key={evenement.id} className="flex justify-between gap-4 border-b border-gray-200 pb-2">
              <span className="font-medium text-gray-900">
                {LIBELLES_JALONS[evenement.type] || evenement.type}
              </span>
              <time dateTime={evenement.created_at} className="text-gray-600">
                {formaterDate(evenement.created_at)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

export default OwnerMissionEvents;
