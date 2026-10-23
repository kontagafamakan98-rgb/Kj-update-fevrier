import React, { useCallback, useEffect, useState } from 'react';
import OwnerService from '../services/ownerService';
import { CHAMP } from '../config/classes-champ';

/**
 * Paliers de commission — le barème, piloté par le propriétaire.
 *
 * ── Pourquoi ce panneau existe ────────────────────────────────────────────
 * Le taux de commission était UN chiffre (`PAYMENT_COMMISSION_RATE`, réglable
 * en base) appliqué à tout le monde. Un travailleur qui n'a jamais été payé sur
 * Kojo compare ce taux à un bouche-à-oreille gratuit — et s'en va ; un habitué
 * qui a construit sa réputation ici peut payer moins. Le barème distingue donc
 * trois paliers (lancement, standard, fidélité), résolus sur les missions
 * TERMINÉES du travailleur (`backend/kojo_commission.py`), et ce panneau est le
 * seul endroit où ils se règlent.
 *
 * ── Ce que l'écran ne décide pas ──────────────────────────────────────────
 * Aucun taux n'est calculé ici : le serveur valide (bornes, seuils croissants)
 * et rend la configuration RÉELLEMENT stockée, que l'écran réaffiche. Un refus
 * nomme le champ fautif — corriger une valeur en silence ferait croire que le
 * barème saisi est appliqué.
 *
 * ── Panneau non traduit, comme la file d'arbitrage ────────────────────────
 * Il s'adresse au propriétaire, seul lecteur, et les panneaux owner du tableau
 * de bord parlent la même langue (cf. `OwnerDisputes`).
 */

const formaterTaux = (valeur) => {
  const nombre = Number(valeur);
  if (!Number.isFinite(nombre)) return '—';
  return `${nombre.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
};

const OwnerCommissionTiers = () => {
  const [paliers, setPaliers] = useState(null);
  const [tauxStandard, setTauxStandard] = useState(null);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  const [chargement, setChargement] = useState(true);
  const [enregistrement, setEnregistrement] = useState(false);

  const appliquer = useCallback((reponse) => {
    const configuration = reponse?.paliers || {};
    setPaliers({
      actif: Boolean(configuration.actif),
      lancement_missions: configuration.lancement_missions ?? 0,
      lancement_taux_percent: configuration.lancement_taux_percent ?? 0,
      recurrent_missions: configuration.recurrent_missions ?? 0,
      recurrent_taux_percent: configuration.recurrent_taux_percent ?? 0,
    });
    if (reponse?.taux_standard_percent !== undefined) {
      setTauxStandard(Number(reponse.taux_standard_percent));
    }
  }, []);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur('');
    try {
      appliquer(await OwnerService.getCommissionTiers());
    } catch (e) {
      setErreur(e?.message || 'Impossible de lire les paliers de commission.');
    } finally {
      setChargement(false);
    }
  }, [appliquer]);

  useEffect(() => {
    charger();
  }, [charger]);

  const modifier = (champ, valeur) => {
    setPaliers((courant) => ({ ...(courant || {}), [champ]: valeur }));
  };

  const nombre = (valeur) => {
    const converti = Number(valeur);
    return Number.isFinite(converti) ? converti : 0;
  };

  const enregistrer = async (evenement) => {
    evenement.preventDefault();
    if (!paliers) return;
    setEnregistrement(true);
    setErreur('');
    setMessage('');
    try {
      const reponse = await OwnerService.updateCommissionTiers({
        actif: paliers.actif,
        lancement_missions: nombre(paliers.lancement_missions),
        lancement_taux_percent: nombre(paliers.lancement_taux_percent),
        recurrent_missions: nombre(paliers.recurrent_missions),
        recurrent_taux_percent: nombre(paliers.recurrent_taux_percent),
      });
      appliquer(reponse);
      setMessage('Paliers enregistrés. Ils s’appliquent aux prochains devis.');
    } catch (e) {
      setErreur(e?.message || 'Impossible d’enregistrer les paliers.');
    } finally {
      setEnregistrement(false);
    }
  };

  return (
    <section className="carte-editoriale carte-publique mb-6" data-section="paliers-commission">
      <h2 className="text-lg font-semibold text-gray-900">Paliers de commission</h2>
      <p className="mt-1 text-sm text-gray-600">
        Le barème suit le travailleur, pas la mission : un travailleur sans mission
        terminée paie le tarif de lancement, un habitué paie le tarif de fidélité,
        les autres paient le taux standard
        {tauxStandard !== null ? ` (${formaterTaux(tauxStandard)})` : ''}.
      </p>

      {chargement && <p className="mt-4 text-sm text-gray-500">Chargement des paliers…</p>}
      {erreur && <p role="alert" className="mt-4 text-sm text-red-700">{erreur}</p>}
      {message && <p className="mt-4 text-sm text-green-800">{message}</p>}

      {paliers && !chargement && (
        <form onSubmit={enregistrer} className="mt-4 space-y-4">
          <label className="flex items-center gap-3 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={paliers.actif}
              onChange={(e) => modifier('actif', e.target.checked)}
            />
            Appliquer les paliers (désactivés, le taux standard s’applique à tout le monde)
          </label>

          <div className="flex flex-wrap items-end gap-3">
            <label className="grow text-sm text-gray-700">
              <span>Missions offertes au lancement</span>
              <input
                type="number"
                min="0"
                max="1000"
                step="1"
                className={CHAMP}
                value={paliers.lancement_missions}
                onChange={(e) => modifier('lancement_missions', e.target.value)}
              />
            </label>
            <label className="grow text-sm text-gray-700">
              <span>Commission de lancement (%)</span>
              <input
                type="number"
                min="0"
                max="50"
                step="0.5"
                className={CHAMP}
                value={paliers.lancement_taux_percent}
                onChange={(e) => modifier('lancement_taux_percent', e.target.value)}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="grow text-sm text-gray-700">
              <span>Seuil de fidélité (missions terminées)</span>
              <input
                type="number"
                min="1"
                max="1000"
                step="1"
                className={CHAMP}
                value={paliers.recurrent_missions}
                onChange={(e) => modifier('recurrent_missions', e.target.value)}
              />
            </label>
            <label className="grow text-sm text-gray-700">
              <span>Commission de fidélité (%)</span>
              <input
                type="number"
                min="0"
                max="50"
                step="0.5"
                className={CHAMP}
                value={paliers.recurrent_taux_percent}
                onChange={(e) => modifier('recurrent_taux_percent', e.target.value)}
              />
            </label>
          </div>

          <p className="text-xs text-gray-500">
            Barème appliqué : de 0 à {Math.max(nombre(paliers.lancement_missions) - 1, 0)} mission(s)
            terminée(s) → {formaterTaux(paliers.lancement_taux_percent)} · jusqu’à{' '}
            {Math.max(nombre(paliers.recurrent_missions) - 1, nombre(paliers.lancement_missions))} →
            taux standard · à partir de {nombre(paliers.recurrent_missions)} →{' '}
            {formaterTaux(paliers.recurrent_taux_percent)}.
          </p>

          <button type="submit" className="bouton-clair" disabled={enregistrement}>
            {enregistrement ? 'Enregistrement…' : 'Enregistrer les paliers'}
          </button>
        </form>
      )}
    </section>
  );
};

export default OwnerCommissionTiers;
