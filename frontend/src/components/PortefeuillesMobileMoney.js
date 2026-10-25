import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCcw, ShieldAlert, X } from 'lucide-react';
import { supportAPI } from '../services/apiEndpoints';
import { handleApiError } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import { makeScopedTranslator } from '../utils/pack2PageI18n/portefeuilles';
import { CHAMP } from '../config/classes-champ';

// ── LA FILE DES TITULAIRES DE COMPTES MOBILE MONEY ──────────────────────────
//
// Le défaut fermé ici : un travailleur pouvait déclarer le wallet d'un TIERS et
// être payé dessus. Le serveur compare maintenant le titulaire déclaré au nom
// du compte Kojo ; quand les deux correspondent, l'argent part sans que
// personne n'intervienne. Ce panneau ne montre donc que les EXCEPTIONS — payer
// un proche est fréquent et parfois légitime — et une décision vaut pour le
// couple (nom, numéro) validé, jamais pour une transaction.
//
// Il vit dans /support-admin, ouvert au propriétaire ET à l'équipe support :
// une file qu'une seule personne peut vider est un goulot d'étranglement, et
// c'est le bureau qui reçoit l'appel du travailleur qui attend son argent.
// Il ne modifie ni le nom ni le numéro : il autorise, ou il ferme.

const ETATS = ['en_attente', 'verifie', 'non_declare', 'refuse'];
const NOTE_MINIMUM = 10;

const formatDateHeure = (valeur) => {
  if (!valeur) return '—';
  try {
    return new Date(valeur).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
};

const classeEtat = (etat) => {
  if (etat === 'verifie') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (etat === 'refuse') return 'border-rose-200 bg-rose-50 text-rose-800';
  return 'border-amber-200 bg-amber-50 text-amber-900';
};

const PortefeuillesPanel = () => {
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t);

  const vivant = useRef(true);
  useEffect(() => () => { vivant.current = false; }, []);

  const [etat, setEtat] = useState('');
  const [portefeuilles, setPortefeuilles] = useState([]);
  const [total, setTotal] = useState(0);
  const [tronque, setTronque] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  const [decision, setDecision] = useState(null);
  const [note, setNote] = useState('');
  const [decisionErreur, setDecisionErreur] = useState('');
  const [decisionEnCours, setDecisionEnCours] = useState(false);
  const [heureux, setHeureux] = useState('');

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur('');
    try {
      const reponse = await supportAPI.listWallets(etat || undefined);
      if (!vivant.current) return;
      // Une forme INATTENDUE est une erreur NOMMÉE, jamais une file vide : un
      // « rien à vérifier » qui n'a rien mesuré ferait croire que l'argent
      // part, alors qu'un wallet retenu attend une décision.
      if (!reponse || !Array.isArray(reponse.portefeuilles)) {
        throw new Error(pageT('loadError'));
      }
      setPortefeuilles(reponse.portefeuilles);
      setTotal(Number(reponse.total) || reponse.portefeuilles.length);
      setTronque(Boolean(reponse.tronque));
    } catch (err) {
      if (!vivant.current) return;
      setErreur(handleApiError(err, pageT('loadError')));
      setPortefeuilles([]);
    } finally {
      if (vivant.current) setChargement(false);
    }
    // `pageT` est recréée à chaque rendu (même choix que les autres écrans) :
    // l'ajouter ici relancerait la lecture à l'infini.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etat]);

  useEffect(() => {
    charger();
  }, [charger]);

  const demanderDecision = (portefeuille, sens) => {
    setDecision({ portefeuille, sens });
    setNote('');
    setDecisionErreur('');
  };

  const appliquer = async (evenement) => {
    evenement.preventDefault();
    if (!decision || decisionEnCours) return;
    const notePropre = note.trim();
    if (notePropre.length < NOTE_MINIMUM) {
      setDecisionErreur(pageT('noteRequired'));
      return;
    }
    setDecisionEnCours(true);
    setDecisionErreur('');
    try {
      const reponse = await supportAPI.decideWallet(decision.portefeuille.compte_id, {
        decision: decision.sens,
        note: notePropre,
      });
      if (!vivant.current) return;
      setHeureux(reponse?.message || pageT('decisionSuccess'));
      setDecision(null);
      setNote('');
      await charger();
    } catch (err) {
      if (!vivant.current) return;
      // Le refus du serveur dit QUOI corriger (motif, compte supprimé…) : il
      // est rendu tel quel, jamais remplacé par un message générique.
      setDecisionErreur(handleApiError(err, pageT('decisionError')));
    } finally {
      if (vivant.current) setDecisionEnCours(false);
    }
  };

  const nomAffiche = (portefeuille) => portefeuille?.nom || portefeuille?.email || '—';

  return (
    <section className="carte-editoriale carte-publique" data-section="portefeuilles-mobile-money">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="sur-titre">{pageT('eyebrow')}</span>
          <h2 className="titre-section mt-2">{pageT('title')}</h2>
          <p className="mt-2 text-sm text-stone-600 sm:max-w-2xl">{pageT('subtitle')}</p>
          <p className="mt-2 text-xs text-stone-500">
            {total} {tronque ? `· ${pageT('truncated')}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={charger}
          aria-label={pageT('refresh')}
          className="rounded-[3px] border border-stone-200 p-2 text-stone-600 transition-colors hover:border-orange-600 hover:text-orange-700"
        >
          <RefreshCcw className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="puces-defilantes mb-4">
        <button
          type="button"
          onClick={() => setEtat('')}
          className={`puce-filtre ${etat === '' ? 'puce-filtre-active' : ''}`}
        >
          {pageT('filterAll')}
        </button>
        {ETATS.map((valeur) => (
          <button
            key={valeur}
            type="button"
            onClick={() => setEtat(valeur)}
            className={`puce-filtre ${etat === valeur ? 'puce-filtre-active' : ''}`}
          >
            {pageT(`state_${valeur}`)}
          </button>
        ))}
      </div>

      {heureux && (
        <p role="status" className="mb-4 rounded-[3px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {heureux}
        </p>
      )}

      {erreur && (
        <div className="mb-4 rounded-[3px] border border-rose-200 bg-rose-50 px-4 py-3">
          <p role="alert" className="text-sm font-semibold text-rose-800">{erreur}</p>
          <button type="button" onClick={charger} className="bouton bouton-clair mt-3">
            {pageT('retry')}
          </button>
        </div>
      )}

      {chargement && (
        <p className="mt-6 flex items-center gap-2 text-sm text-stone-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {pageT('loading')}
        </p>
      )}

      {!chargement && !erreur && portefeuilles.length === 0 && (
        <p className="mt-6 rounded-[3px] border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-600">
          {pageT('empty')}
        </p>
      )}

      {!chargement && portefeuilles.length > 0 && (
        <ul className="mt-4 divide-y divide-stone-200">
          {portefeuilles.map((portefeuille) => (
            <li key={portefeuille.compte_id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-stone-900">
                      {nomAffiche(portefeuille)}
                    </span>
                    <span className={`inline-flex items-center rounded-[3px] border px-2 py-0.5 text-xs font-semibold ${classeEtat(portefeuille.etat)}`}>
                      {pageT(`state_${portefeuille.etat}`)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-stone-500">{portefeuille.email}</p>
                  <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-stone-700 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-stone-500">{pageT('declaredName')}</dt>
                      <dd>{portefeuille.nom_declare || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-stone-500">{pageT('accountName')}</dt>
                      <dd>{portefeuille.nom_compte || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-stone-500">{pageT('wallet')}</dt>
                      <dd>
                        {portefeuille.wallet_masque
                          ? `${portefeuille.wallet_methode === 'wave' ? 'Wave' : 'Orange Money'} ${portefeuille.wallet_masque}`
                          : pageT('noWallet')}
                      </dd>
                    </div>
                    {portefeuille.decide_le && (
                      <div>
                        <dt className="text-xs text-stone-500">{pageT('decidedBy')}</dt>
                        <dd>
                          {portefeuille.decide_par || '—'} · {formatDateHeure(portefeuille.decide_le)}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {portefeuille.note && (
                    <p className="mt-2 text-sm text-stone-600">{portefeuille.note}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => demanderDecision(portefeuille, 'verifier')}
                    className="bouton bouton-encre"
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    {pageT('validate')}
                  </button>
                  <button
                    type="button"
                    onClick={() => demanderDecision(portefeuille, 'refuser')}
                    className="bouton bouton-clair"
                  >
                    <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                    {pageT('refuse')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {decision && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 px-4">
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="titre-decision-portefeuille"
            onSubmit={appliquer}
            className="w-full max-w-lg rounded-[3px] border border-stone-200 bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="sur-titre">{pageT('decisionTitle')}</span>
                <h2 id="titre-decision-portefeuille" className="titre-carte-app mt-2">
                  {nomAffiche(decision.portefeuille)}
                </h2>
                <p className="mt-1 text-xs text-stone-500">
                  {pageT('declaredName')} : {decision.portefeuille.nom_declare || '—'}
                  {' · '}
                  {pageT('accountName')} : {decision.portefeuille.nom_compte || '—'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDecision(null)}
                aria-label={pageT('close')}
                className="rounded-[3px] border border-stone-200 p-2 text-stone-600 transition-colors hover:border-orange-600 hover:text-orange-700"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <p className="mt-3 rounded-[3px] border border-stone-200 fond-sable px-3 py-2 text-xs text-stone-700">
              {decision.sens === 'verifier' ? pageT('hintVerifier') : pageT('hintRefuser')}
            </p>

            <label htmlFor="note-portefeuille" className="mt-4 block">
              <span className="sur-titre">{pageT('note')}</span>
              <textarea
                id="note-portefeuille"
                value={note}
                onChange={(evenement) => setNote(evenement.target.value)}
                placeholder={pageT('notePlaceholder')}
                rows={3}
                maxLength={500}
                className={CHAMP}
              />
              <span className="mt-1 block text-xs text-stone-500">
                {note.trim().length}/{NOTE_MINIMUM}
              </span>
            </label>

            {decisionErreur && (
              <p role="alert" className="mt-3 rounded-[3px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {decisionErreur}
              </p>
            )}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setDecision(null)} className="bouton bouton-clair">
                {pageT('cancel')}
              </button>
              <button
                type="submit"
                disabled={decisionEnCours || note.trim().length < NOTE_MINIMUM}
                className="bouton bouton-encre disabled:cursor-not-allowed disabled:opacity-60"
              >
                {decisionEnCours ? pageT('loading') : pageT('apply')}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
};

export default PortefeuillesPanel;
