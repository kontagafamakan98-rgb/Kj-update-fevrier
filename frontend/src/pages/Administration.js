import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import OwnerService from '../services/ownerService';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import { makeScopedTranslator } from '../utils/pack2PageI18n/administration';
import { safeLog } from '../utils/env';

// ── ADMINISTRATION : CE QUE LE PROPRIÉTAIRE NE POUVAIT PAS FAIRE ─────────────
// Il avait des chiffres (gains, commissions, litiges) et aucun COMPTE : pas un
// nom, pas un état, aucun moyen d'arrêter quelqu'un. Cet écran ouvre les trois
// choses qui manquaient — le répertoire, les deux sanctions, la lecture des
// fils — et rien de plus : il ne supprime rien, ne change aucun mot de passe et
// ne modifie aucun rôle.
//
// Les trois états ont TROIS effets distincts, et l'écran les écrit à côté du
// bouton plutôt que de laisser deviner :
//   actif     — le compte fonctionne normalement ;
//   restreint — lecture seule : plus publier, postuler ni écrire ;
//   banni     — connexion et API refusées, en nommant le motif.
// Un bannissement n'efface aucune donnée et se lève d'un clic : c'est une
// décision réversible, pas une suppression déguisée.

const ETATS = ['actif', 'restreint', 'banni'];
const ROLES = ['client', 'worker', 'owner', 'support'];
const MOTIF_MINIMUM = 10;

const CLASSE_ETAT = {
  actif: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  restreint: 'border-amber-200 bg-amber-50 text-amber-900',
  banni: 'border-rose-200 bg-rose-50 text-rose-800',
};

const formatDate = (valeur, langue) => {
  if (!valeur) return '—';
  try {
    return new Date(valeur).toLocaleDateString(langue === 'en' ? 'en-US' : 'fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
};

const formatDateHeure = (valeur, langue) => {
  if (!valeur) return '—';
  try {
    return new Date(valeur).toLocaleString(langue === 'en' ? 'en-US' : 'fr-FR', {
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

const nomAffiche = (compte) =>
  [compte?.first_name, compte?.last_name].filter(Boolean).join(' ').trim()
  || compte?.email
  || '—';

const initiales = (compte) => {
  const prenom = String(compte?.first_name || '').trim();
  const nom = String(compte?.last_name || '').trim();
  const lettres = `${prenom.charAt(0)}${nom.charAt(0)}`.trim();
  return (lettres || String(compte?.email || '?').charAt(0)).toUpperCase();
};

function Tuile({ libelle, valeur, icone }) {
  return (
    <div className="tuile-mesure">
      <p className="tuile-mesure-libelle flex items-center gap-2">
        <span className="text-orange-600">{icone}</span>
        {libelle}
      </p>
      <p className="tuile-mesure-chiffre">{valeur}</p>
    </div>
  );
}

function EtatPastille({ etat, pageT }) {
  return (
    <span className={`inline-flex items-center rounded-[3px] border px-2 py-0.5 text-xs font-semibold ${CLASSE_ETAT[etat] || CLASSE_ETAT.actif}`}>
      {pageT(`state_${etat}`)}
    </span>
  );
}

const Administration = () => {
  const { t, currentLanguage } = useLanguage();
  const toast = useToast();
  const pageT = makeScopedTranslator(currentLanguage, t);
  const vivant = useRef(true);
  useEffect(() => () => { vivant.current = false; }, []);

  const [onglet, setOnglet] = useState('comptes');

  // ── Répertoire ────────────────────────────────────────────────────────
  const [comptes, setComptes] = useState([]);
  const [mesures, setMesures] = useState({});
  const [tronque, setTronque] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [recherche, setRecherche] = useState('');
  const [rechercheAppliquee, setRechercheAppliquee] = useState('');
  const [role, setRole] = useState('');
  const [etat, setEtat] = useState('');

  // ── Fiche d'un compte ─────────────────────────────────────────────────
  const [selectionId, setSelectionId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailChargement, setDetailChargement] = useState(false);
  const [detailErreur, setDetailErreur] = useState('');

  // ── Décision (modale) ─────────────────────────────────────────────────
  const [decision, setDecision] = useState(null);
  const [motif, setMotif] = useState('');
  const [decisionErreur, setDecisionErreur] = useState('');
  const [decisionEnCours, setDecisionEnCours] = useState(false);

  // ── Conversations ─────────────────────────────────────────────────────
  const [conversations, setConversations] = useState([]);
  const [conversationsChargees, setConversationsChargees] = useState(false);
  const [conversationsErreur, setConversationsErreur] = useState('');
  const [conversationsTronque, setConversationsTronque] = useState(false);
  const [rechercheFils, setRechercheFils] = useState('');
  const [filId, setFilId] = useState(null);
  const [fil, setFil] = useState(null);
  const [filErreur, setFilErreur] = useState('');
  const [filChargement, setFilChargement] = useState(false);

  const chargerComptes = useCallback(async () => {
    setChargement(true);
    setErreur('');
    try {
      const reponse = await OwnerService.getAccounts({
        ...(rechercheAppliquee ? { recherche: rechercheAppliquee } : {}),
        ...(role ? { role } : {}),
        ...(etat ? { etat } : {}),
        limite: 100,
      });
      if (!vivant.current) return;
      setComptes(Array.isArray(reponse?.comptes) ? reponse.comptes : []);
      setMesures(reponse?.mesures || {});
      setTronque(Boolean(reponse?.tronque));
    } catch (err) {
      if (!vivant.current) return;
      safeLog.error('Répertoire des comptes indisponible:', err);
      setErreur(err?.message || pageT('loadError'));
      // Une lecture en panne n'affiche PAS l'état vide : « aucune demande » et
      // « je n'ai pas pu lire » sont deux faits différents, et les montrer
      // ensemble ferait croire à un répertoire vide.
      setComptes([]);
    } finally {
      if (vivant.current) setChargement(false);
    }
    // `pageT` n'est pas une dépendance : elle est recréée à chaque rendu (même
    // choix que `SupportAdmin`), la mettre relancerait la lecture à l'infini.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rechercheAppliquee, role, etat]);

  useEffect(() => {
    chargerComptes();
  }, [chargerComptes]);

  const chargerConversations = async (valeur = rechercheFils) => {
    try {
      setConversationsErreur('');
      const reponse = await OwnerService.getConversations(valeur.trim());
      if (!vivant.current) return;
      setConversations(Array.isArray(reponse?.conversations) ? reponse.conversations : []);
      setConversationsTronque(Boolean(reponse?.tronque));
    } catch (err) {
      if (!vivant.current) return;
      safeLog.error('Conversations indisponibles (modération):', err);
      setConversationsErreur(err?.message || pageT('loadError'));
      setConversations([]);
    } finally {
      if (vivant.current) setConversationsChargees(true);
    }
  };

  useEffect(() => {
    if (onglet === 'messages' && !conversationsChargees) chargerConversations('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onglet, conversationsChargees]);

  const ouvrirCompte = async (identifiant) => {
    setSelectionId(identifiant);
    setDetail(null);
    setDetailErreur('');
    setDetailChargement(true);
    try {
      const reponse = await OwnerService.getAccount(identifiant);
      if (!vivant.current) return;
      setDetail(reponse);
    } catch (err) {
      if (!vivant.current) return;
      safeLog.error('Fiche du compte indisponible:', err);
      setDetailErreur(err?.message || pageT('detailError'));
    } finally {
      if (vivant.current) setDetailChargement(false);
    }
  };

  const ouvrirFil = async (identifiant) => {
    setFilId(identifiant);
    setFil(null);
    setFilErreur('');
    setFilChargement(true);
    try {
      const reponse = await OwnerService.getConversation(identifiant);
      if (!vivant.current) return;
      setFil(reponse);
    } catch (err) {
      if (!vivant.current) return;
      safeLog.error('Fil de conversation indisponible:', err);
      setFilErreur(err?.message || pageT('threadError'));
    } finally {
      if (vivant.current) setFilChargement(false);
    }
  };

  const demanderDecision = (compte, nouvelEtat) => {
    setDecision({ compte, etat: nouvelEtat });
    setMotif('');
    setDecisionErreur('');
  };

  const appliquerDecision = async (evenement) => {
    evenement.preventDefault();
    if (!decision || decisionEnCours) return;
    const motifPropre = motif.trim();
    if (decision.etat !== 'actif' && motifPropre.length < MOTIF_MINIMUM) {
      setDecisionErreur(pageT('sanctionRequired'));
      return;
    }
    setDecisionEnCours(true);
    setDecisionErreur('');
    try {
      const reponse = await OwnerService.setAccountState(decision.compte.id, {
        etat: decision.etat,
        motif: motifPropre,
      });
      if (!vivant.current) return;
      const compteRelu = reponse?.compte;
      if (compteRelu) {
        setDetail((precedent) => (precedent ? compteRelu : precedent));
        setComptes((precedents) =>
          precedents.map((compte) => (compte.id === compteRelu.id ? { ...compte, ...compteRelu } : compte))
        );
      }
      toast.success(reponse?.message || pageT('sanctionSuccess'));
      setDecision(null);
      setMotif('');
      await chargerComptes();
    } catch (err) {
      if (!vivant.current) return;
      safeLog.error('Décision de modération refusée:', err);
      // Le refus du serveur dit QUOI corriger (motif trop court, compte
      // propriétaire…) : il est rendu tel quel, jamais remplacé par un
      // message générique qui effacerait le remède.
      setDecisionErreur(err?.message || pageT('sanctionError'));
    } finally {
      if (vivant.current) setDecisionEnCours(false);
    }
  };

  const etatsSanctionnes = (Number(mesures.restreints) || 0) + (Number(mesures.bannis) || 0);

  return (
    <div className="min-h-full cadre-page max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="space-y-6">
        <section className="bande-app" data-section="bande-administration">
          <span className="sur-titre">{pageT('eyebrow')}</span>
          <h1 className="titre-page mt-3">{pageT('title')}</h1>
          <p className="mt-2 text-sm text-stone-600 sm:max-w-2xl sm:text-base">{pageT('subtitle')}</p>
        </section>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Tuile
            libelle={pageT('tileTotal')}
            valeur={Number(mesures.total) || 0}
            icone={<Users className="h-4 w-4" aria-hidden="true" />}
          />
          <Tuile
            libelle={pageT('tileClients')}
            valeur={Number(mesures.clients) || 0}
            icone={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
          />
          <Tuile
            libelle={pageT('tileWorkers')}
            valeur={Number(mesures.travailleurs) || 0}
            icone={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          />
          <Tuile
            libelle={pageT('tileSanctioned')}
            valeur={etatsSanctionnes}
            icone={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
          />
        </div>

        <div role="tablist" aria-label={pageT('eyebrow')} className="flex flex-wrap gap-2">
          <button
            type="button"
            role="tab"
            aria-selected={onglet === 'comptes'}
            onClick={() => setOnglet('comptes')}
            className={`bouton ${onglet === 'comptes' ? 'bouton-encre' : 'bouton-clair'}`}
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            {pageT('tabAccounts')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={onglet === 'messages'}
            onClick={() => setOnglet('messages')}
            className={`bouton ${onglet === 'messages' ? 'bouton-encre' : 'bouton-clair'}`}
          >
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            {pageT('tabMessages')}
          </button>
        </div>

        {onglet === 'comptes' && (
          <>
            <section className="carte-editoriale carte-publique" data-section="repertoire-comptes">
              <form
                onSubmit={(evenement) => {
                  evenement.preventDefault();
                  setRechercheAppliquee(recherche.trim());
                }}
                className="flex flex-col gap-3 lg:flex-row lg:items-end"
              >
                <label className="flex-1" htmlFor="recherche-compte">
                  <span className="sur-titre">{pageT('search')}</span>
                  <div className="relative mt-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
                    <input
                      id="recherche-compte"
                      type="search"
                      value={recherche}
                      onChange={(evenement) => setRecherche(evenement.target.value)}
                      placeholder={pageT('searchPlaceholder')}
                      className="w-full rounded-[3px] border border-stone-300 py-2 pl-9 pr-3 text-sm text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                </label>
                <label htmlFor="filtre-role">
                  <span className="sur-titre">{pageT('filterRole')}</span>
                  <select
                    id="filtre-role"
                    value={role}
                    onChange={(evenement) => setRole(evenement.target.value)}
                    className="mt-1 w-full rounded-[3px] border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="">{pageT('filterAll')}</option>
                    {ROLES.map((valeur) => (
                      <option key={valeur} value={valeur}>{pageT(`role_${valeur}`)}</option>
                    ))}
                  </select>
                </label>
                <label htmlFor="filtre-etat">
                  <span className="sur-titre">{pageT('filterState')}</span>
                  <select
                    id="filtre-etat"
                    value={etat}
                    onChange={(evenement) => setEtat(evenement.target.value)}
                    className="mt-1 w-full rounded-[3px] border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="">{pageT('filterAll')}</option>
                    {ETATS.map((valeur) => (
                      <option key={valeur} value={valeur}>{pageT(`state_${valeur}`)}</option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-2">
                  <button type="submit" className="bouton bouton-encre shrink-0">
                    <Search className="h-4 w-4" aria-hidden="true" />
                    {pageT('search')}
                  </button>
                  <button
                    type="button"
                    onClick={chargerComptes}
                    aria-label={pageT('refresh')}
                    className="rounded-[3px] border border-stone-200 p-2 text-stone-600 transition-colors hover:border-orange-600 hover:text-orange-700"
                  >
                    <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </form>

              {tronque && (
                <p className="mt-4 rounded-[3px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {pageT('truncated')}
                </p>
              )}

              {erreur && (
                <div className="mt-4 rounded-[3px] border border-rose-200 bg-rose-50 px-4 py-3">
                  <p className="text-sm font-semibold text-rose-800">{erreur}</p>
                  <button type="button" onClick={chargerComptes} className="bouton bouton-clair mt-3">
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

              {!chargement && !erreur && comptes.length === 0 && (
                <p className="mt-6 rounded-[3px] border border-stone-200 fond-sable px-4 py-6 text-center text-sm text-stone-600">
                  {pageT('empty')}
                </p>
              )}

              {!chargement && comptes.length > 0 && (
                <ul className="mt-5 divide-y divide-stone-200">
                  {comptes.map((compte) => (
                    <li key={compte.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-600 text-xs font-bold text-white" aria-hidden="true">
                          {initiales(compte)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => ouvrirCompte(compte.id)}
                              className="truncate text-left text-sm font-semibold text-stone-900 hover:text-orange-700"
                            >
                              {nomAffiche(compte)}
                            </button>
                            <EtatPastille etat={compte.account_state || 'actif'} pageT={pageT} />
                            <span className="text-xs text-stone-500">{pageT(`role_${compte.user_type}`)}</span>
                          </div>
                          <p className="truncate text-xs text-stone-500">
                            {compte.email}
                            {compte.country ? ` · ${compte.country}` : ''}
                            {' · '}{formatDate(compte.created_at, currentLanguage)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {(compte.account_state || 'actif') !== 'actif' && (
                            <button
                              type="button"
                              onClick={() => demanderDecision(compte, 'actif')}
                              className="bouton bouton-clair"
                            >
                              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                              {pageT('reactivate')}
                            </button>
                          )}
                          {(compte.account_state || 'actif') === 'actif' && (
                            <>
                              <button
                                type="button"
                                onClick={() => demanderDecision(compte, 'restreint')}
                                className="bouton bouton-clair"
                              >
                                <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                                {pageT('restrict')}
                              </button>
                              <button
                                type="button"
                                onClick={() => demanderDecision(compte, 'banni')}
                                className="bouton bouton-clair"
                              >
                                <Ban className="h-4 w-4" aria-hidden="true" />
                                {pageT('ban')}
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => ouvrirCompte(compte.id)}
                            aria-label={pageT('openAccount')}
                            className="rounded-[3px] border border-stone-200 p-2 text-stone-600 transition-colors hover:border-orange-600 hover:text-orange-700"
                          >
                            <ChevronRight className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {selectionId && (
              <section className="carte-editoriale carte-publique" data-section="fiche-compte">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className="sur-titre">{pageT('openAccount')}</span>
                    <h2 className="titre-section mt-2">{detail ? nomAffiche(detail) : pageT('loading')}</h2>
                    {detail && <p className="mt-1 text-sm text-stone-500">{detail.email}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectionId(null); setDetail(null); }}
                    aria-label={pageT('close')}
                    className="rounded-[3px] border border-stone-200 p-2 text-stone-600 transition-colors hover:border-orange-600 hover:text-orange-700"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                {detailChargement && (
                  <p className="flex items-center gap-2 text-sm text-stone-500">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {pageT('loading')}
                  </p>
                )}
                {detailErreur && !detailChargement && (
                  <p className="rounded-[3px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    {detailErreur}
                  </p>
                )}

                {detail && !detailChargement && (
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <EtatPastille etat={detail.account_state || 'actif'} pageT={pageT} />
                      <span className="text-xs text-stone-500">{pageT(`role_${detail.user_type}`)}</span>
                      <span className="inline-flex items-center gap-1 text-xs text-stone-500">
                        <Mail className="h-3 w-3" aria-hidden="true" />
                        {detail.email_verified ? pageT('verified') : pageT('unverified')}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-stone-500">
                        <CalendarDays className="h-3 w-3" aria-hidden="true" />
                        {pageT('joined')} {formatDate(detail.created_at, currentLanguage)}
                      </span>
                      {detail.country && (
                        <span className="text-xs text-stone-500">{pageT('country')} : {detail.country}</span>
                      )}
                    </div>

                    <div>
                      <h3 className="titre-carte-app">{pageT('activity')}</h3>
                      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                        <Tuile libelle={pageT('statMissions')} valeur={Number(detail.activite?.missions_publiees) || 0} icone={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />} />
                        <Tuile libelle={pageT('statProposals')} valeur={Number(detail.activite?.propositions) || 0} icone={<Users className="h-4 w-4" aria-hidden="true" />} />
                        <Tuile libelle={pageT('statMessages')} valeur={Number(detail.activite?.messages) || 0} icone={<MessageSquare className="h-4 w-4" aria-hidden="true" />} />
                        <Tuile libelle={pageT('statReviews')} valeur={Number(detail.activite?.avis_recus) || 0} icone={<ShieldCheck className="h-4 w-4" aria-hidden="true" />} />
                      </div>
                    </div>

                    <div>
                      <h3 className="titre-carte-app">{pageT('history')}</h3>
                      {(detail.historique || []).length === 0 ? (
                        <p className="mt-2 text-sm text-stone-600">{pageT('historyEmpty')}</p>
                      ) : (
                        <ol className="mt-3 space-y-2">
                          {detail.historique.map((entree, index) => (
                            <li key={`${entree.at}-${index}`} className="rounded-[3px] border border-stone-200 px-3 py-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <EtatPastille etat={entree.etat} pageT={pageT} />
                                <span className="text-xs text-stone-500">{formatDateHeure(entree.at, currentLanguage)}</span>
                                {entree.by && <span className="text-xs text-stone-400">{pageT('decisionBy')} {entree.by}</span>}
                              </div>
                              {entree.motif && (
                                <p className="mt-1 text-sm text-stone-700">{pageT('motif')} : {entree.motif}</p>
                              )}
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {(detail.account_state || 'actif') === 'actif' ? (
                        <>
                          <button type="button" onClick={() => demanderDecision(detail, 'restreint')} className="bouton bouton-clair">
                            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                            {pageT('restrict')}
                          </button>
                          <button type="button" onClick={() => demanderDecision(detail, 'banni')} className="bouton bouton-clair">
                            <Ban className="h-4 w-4" aria-hidden="true" />
                            {pageT('ban')}
                          </button>
                        </>
                      ) : (
                        <button type="button" onClick={() => demanderDecision(detail, 'actif')} className="bouton bouton-encre">
                          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                          {pageT('reactivate')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {onglet === 'messages' && (
          <section className="carte-editoriale carte-publique" data-section="conversations-moderation">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="titre-section">{pageT('conversationsTitle')}</h2>
                <p className="mt-2 text-sm text-stone-600">{pageT('conversationsSubtitle')}</p>
              </div>
              <form
                onSubmit={(evenement) => {
                  evenement.preventDefault();
                  chargerConversations(rechercheFils);
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="search"
                  value={rechercheFils}
                  onChange={(evenement) => setRechercheFils(evenement.target.value)}
                  placeholder={pageT('searchConversations')}
                  aria-label={pageT('searchConversations')}
                  className="w-full rounded-[3px] border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-orange-500 sm:w-72"
                />
                <button type="submit" className="bouton bouton-clair shrink-0">
                  <Search className="h-4 w-4" aria-hidden="true" />
                  {pageT('search')}
                </button>
              </form>
            </div>

            {conversationsTronque && (
              <p className="mb-3 rounded-[3px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {pageT('truncated')}
              </p>
            )}
            {conversationsErreur && (
              <p className="rounded-[3px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {conversationsErreur}
              </p>
            )}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
              <ul className="max-h-[32rem] divide-y divide-stone-200 overflow-y-auto rounded-[3px] border border-stone-200">
                {conversations.length === 0 && (
                  <li className="px-4 py-6 text-center text-sm text-stone-600">{pageT('noConversations')}</li>
                )}
                {conversations.map((conversation) => (
                  <li key={conversation.conversation_id}>
                    <button
                      type="button"
                      onClick={() => ouvrirFil(conversation.conversation_id)}
                      aria-pressed={filId === conversation.conversation_id}
                      className={`w-full px-3 py-3 text-left transition-colors hover:bg-stone-50 ${filId === conversation.conversation_id ? 'bg-stone-100' : ''}`}
                    >
                      <p className="truncate text-sm font-semibold text-stone-900">
                        {(conversation.participants || []).map((participant) => participant.nom).join(' ↔ ')}
                      </p>
                      <p className="truncate text-xs text-stone-500">{conversation.dernier_message}</p>
                      <p className="mt-1 text-xs text-stone-400">
                        {pageT('messagesCount', { count: conversation.messages })} · {formatDateHeure(conversation.dernier_at, currentLanguage)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="rounded-[3px] border border-stone-200 p-4">
                {!filId && <p className="text-sm text-stone-600">{pageT('pickConversation')}</p>}
                {filChargement && (
                  <p className="flex items-center gap-2 text-sm text-stone-500">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {pageT('loading')}
                  </p>
                )}
                {filErreur && !filChargement && <p className="text-sm text-rose-800">{filErreur}</p>}
                {fil && !filChargement && (
                  <div className="space-y-4">
                    <div className="rounded-[3px] border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-xs font-semibold text-amber-900">{pageT('readOnlyNotice')}</p>
                      <p className="mt-1 text-xs text-amber-900">
                        {(fil.participants || []).map((participant) => participant.email || participant.nom).join(' · ')}
                      </p>
                    </div>
                    {(fil.messages || []).length === 0 ? (
                      <p className="text-sm text-stone-600">{pageT('threadEmpty')}</p>
                    ) : (
                      <ol className="max-h-[28rem] space-y-3 overflow-y-auto">
                        {(fil.messages || []).map((message) => (
                          <li key={message.id} className="rounded-[3px] border border-stone-200 px-3 py-2">
                            <p className="text-xs font-semibold text-stone-700">{message.sender_name}</p>
                            <p className="mt-1 whitespace-pre-line text-sm text-stone-900">{message.content}</p>
                            <p className="mt-1 text-xs text-stone-400">{formatDateHeure(message.timestamp, currentLanguage)}</p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>

      {decision && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 px-4">
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="titre-decision"
            onSubmit={appliquerDecision}
            className="w-full max-w-lg rounded-[3px] border border-stone-200 bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="sur-titre">{pageT('sanctionTitle')}</span>
                <h2 id="titre-decision" className="titre-carte-app mt-2">{nomAffiche(decision.compte)}</h2>
                <p className="mt-1 text-xs text-stone-500">{decision.compte.email}</p>
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

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <EtatPastille etat={decision.etat} pageT={pageT} />
              <span className="text-xs text-stone-600">
                {decision.etat === 'restreint' && pageT('hintRestrict')}
                {decision.etat === 'banni' && pageT('hintBan')}
                {decision.etat === 'actif' && pageT('reactivate')}
              </span>
            </div>

            {decision.etat !== 'actif' && (
              <label htmlFor="motif-decision" className="mt-4 block">
                <span className="sur-titre">{pageT('sanctionReason')}</span>
                <textarea
                  id="motif-decision"
                  value={motif}
                  onChange={(evenement) => setMotif(evenement.target.value)}
                  placeholder={pageT('sanctionReasonPlaceholder')}
                  rows={3}
                  maxLength={500}
                  className="mt-1 w-full rounded-[3px] border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-orange-500"
                />
                <span className="mt-1 block text-xs text-stone-500">
                  {motif.trim().length}/{MOTIF_MINIMUM}
                </span>
              </label>
            )}

            {decisionErreur && (
              <p className="mt-3 rounded-[3px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {decisionErreur}
              </p>
            )}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setDecision(null)} className="bouton bouton-clair">
                {pageT('sanctionCancel')}
              </button>
              <button
                type="submit"
                disabled={decisionEnCours || (decision.etat !== 'actif' && motif.trim().length < MOTIF_MINIMUM)}
                className="bouton bouton-encre disabled:cursor-not-allowed disabled:opacity-60"
              >
                {decisionEnCours ? pageT('loading') : pageT('sanctionSubmit')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Administration;
