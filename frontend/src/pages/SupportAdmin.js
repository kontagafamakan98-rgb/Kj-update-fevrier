import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MessageSquareText, RefreshCcw, Phone, Mail, UserPlus, Wallet, X } from 'lucide-react';
import { supportAPI } from '../services/apiEndpoints';
// Le TITULAIRE des comptes mobile money : une file du service clientèle, donc
// au même endroit que les demandes — et ouverte aux agents comme au
// propriétaire, parce qu'une file qu'une seule personne peut vider est un
// goulot d'étranglement.
import PortefeuillesPanel from '../components/PortefeuillesMobileMoney';
import { handleApiError } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { CHAMP } from '../config/classes-champ';

const STATUS_OPTIONS = ['Nouveau', 'En cours', 'Résolu'];

// Les trois états d'une demande GARDENT leur teinte : elles ne décorent pas,
// elles disent quelque chose (à traiter / en cours / clos), comme les statuts
// de /jobs/:id et du tableau de bord. Ce qui change avec la refonte, c'est le
// DESSIN : le badge était une PILULE (`rounded-full`, la forme interdite du
// site), il prend le rayon des boutons et des puces.
const STATUS_STYLES = {
  'Nouveau': 'bg-orange-50 text-orange-700 border-orange-200',
  'En cours': 'bg-blue-50 text-blue-700 border-blue-200',
  'Résolu': 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

/** Le rayon du site pour un contrôle : 3 px, jamais une pilule. */
const RAYON = 'rounded-[3px]';

const statusLabel = (status, t) => {
  const map = {
    'Nouveau': 'statusNew',
    'En cours': 'statusInProgress',
    'Résolu': 'statusResolved',
  };
  const key = map[status];
  return key ? t(key) : status;
};

const formatDate = (value) => {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(value);
  }
};

const SupportAdmin = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  // L'ÉQUIPE SUPPORT n'est composée QUE par le propriétaire : un agent traite
  // les demandes, il ne recrute pas (le backend le refuse aussi — la page ne
  // propose pas un geste que le serveur rejetterait).
  const estProprietaire = Boolean(user?.is_owner);
  const [equipe, setEquipe] = useState([]);
  const [equipeError, setEquipeError] = useState('');
  const [equipeMessage, setEquipeMessage] = useState('');
  const [emailAgent, setEmailAgent] = useState('');
  const [equipeEnCours, setEquipeEnCours] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // Deux métiers, deux onglets : les demandes clients, et les titulaires de
  // wallets à trancher. Séparés parce qu'ils ne se lisent pas ensemble — on
  // travaille une file à la fois, et tout empiler sur une seule page rendait
  // la seconde invisible sous la première.
  const [onglet, setOnglet] = useState('demandes');
  const [updatingId, setUpdatingId] = useState(null);
  // Une requête partie avant le démontage ne doit plus écrire d'état : c'est
  // ce qui faisait remonter « window is not defined » (React lit `window`
  // pour choisir la priorité d'une mise à jour) quand la réponse arrivait
  // après la fin de la page.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const reponse = await supportAPI.listTickets(statusFilter || undefined);
      if (!aliveRef.current) return;
      // CE QUE LA ROUTE REND VRAIMENT (24/10/2026) : `api.get` rend le CORPS
      // déjà analysé (cf. `request` dans services/api.js, qui retourne
      // `payload`), donc la LISTE elle-même — pas un objet `{ data: … }`. La
      // page lisait `response.data`, toujours `undefined`, et affichait donc
      // « 0 demande · Aucune demande de support » sur TOUS les filtres alors
      // que `GET /support/tickets` rendait cinq tickets : le seul écran qui
      // montre les demandes déclarait qu'il n'y en avait aucune, sans avoir
      // rien mesuré. Une forme INATTENDUE est désormais une erreur nommée,
      // jamais un faux vide (c'est le silence qui a coûté ce défaut).
      if (!Array.isArray(reponse)) {
        throw new Error(t('loadSupportError'));
      }
      setTickets(reponse);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(handleApiError(err, t('loadSupportError')));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // ── L'ÉQUIPE SUPPORT (propriétaire seulement) ─────────────────────────────
  // La liste est lue à sa route, séparément des tickets : une équipe vide n'est
  // pas une panne de tickets, et l'inverse non plus.
  const loadTeam = useCallback(async () => {
    if (!estProprietaire) return;
    setEquipeError('');
    try {
      const reponse = await supportAPI.listTeam();
      if (!aliveRef.current) return;
      const agents = Array.isArray(reponse) ? reponse : reponse?.agents;
      if (!Array.isArray(agents)) {
        // Une forme inattendue est une ERREUR NOMMÉE, jamais une équipe vide :
        // un « personne dans l'équipe » qui n'a rien mesuré ferait croire que
        // le propriétaire n'a ajouté personne.
        throw new Error(t('supportTeamError'));
      }
      setEquipe(agents);
    } catch (err) {
      if (!aliveRef.current) return;
      // 403 : le rôle propriétaire n'est pas celui de la session (ou elle a
      // expiré). La page le dit au lieu d'afficher un panneau vide.
      setEquipeError(handleApiError(err, t('supportTeamError')));
    }
    // `t` n'est pas une dépendance : elle est recréée à chaque rendu (le
    // fournisseur de langue ne la mémoïse pas), donc la mettre ici relancerait
    // l'effet à l'infini — chaque lecture de l'équipe provoque un rendu. Même
    // choix que `loadTickets` juste au-dessus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estProprietaire]);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  const ajouterAgent = async (evenement) => {
    evenement.preventDefault();
    const adresse = emailAgent.trim();
    if (!adresse || equipeEnCours) return;
    setEquipeEnCours(true);
    setEquipeError('');
    setEquipeMessage('');
    try {
      const reponse = await supportAPI.addAgent(adresse);
      if (!aliveRef.current) return;
      setEmailAgent('');
      setEquipeMessage(reponse?.message || t('supportTeamAdded'));
      await loadTeam();
    } catch (err) {
      if (!aliveRef.current) return;
      // Le refus du serveur dit QUOI FAIRE (compte à créer d'abord, compte
      // supprimé, propriétaire…) : il est rendu tel quel, pas remplacé par un
      // message générique qui effacerait le remède.
      setEquipeError(handleApiError(err, t('supportTeamError')));
    } finally {
      if (aliveRef.current) setEquipeEnCours(false);
    }
  };

  const retirerAgent = async (agent) => {
    if (equipeEnCours) return;
    setEquipeEnCours(true);
    setEquipeError('');
    setEquipeMessage('');
    try {
      const reponse = await supportAPI.removeAgent(agent.id);
      if (!aliveRef.current) return;
      setEquipeMessage(reponse?.message || t('supportTeamRemoved'));
      await loadTeam();
    } catch (err) {
      if (!aliveRef.current) return;
      setEquipeError(handleApiError(err, t('supportTeamError')));
    } finally {
      if (aliveRef.current) setEquipeEnCours(false);
    }
  };

  const handleStatusChange = async (ticketId, newStatus) => {
    setUpdatingId(ticketId);
    try {
      await supportAPI.updateTicketStatus(ticketId, newStatus);
      if (!aliveRef.current) return;
      setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, status: newStatus } : t)));
    } catch (err) {
      if (!aliveRef.current) return;
      setError(handleApiError(err, t('updateStatusError')));
    } finally {
      if (aliveRef.current) setUpdatingId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <span className="sur-titre">{t('supportRequestsTitle')}</span>
          <h1 className="titre-page mt-3 flex items-center gap-3">
            <MessageSquareText size={26} className="text-orange-600" aria-hidden="true" />
            {t('supportRequestsTitle')}
          </h1>
          <p className="mt-3 text-sm text-stone-500">{tickets.length} {tickets.length > 1 ? t('requestsPlural') : t('requestsSingular')}{statusFilter ? ` · ${statusLabel(statusFilter, t)}` : ''}</p>
        </div>
        <button onClick={loadTickets} className={`${RAYON} border border-stone-200 p-2 text-stone-600 transition-colors hover:border-orange-600 hover:text-orange-700`} aria-label={t('refresh')}>
          <RefreshCcw size={16} />
        </button>
      </div>

      <div role="tablist" aria-label={t('supportRequestsTitle')} className="mb-6 flex flex-wrap gap-2">
        <button
          type="button"
          role="tab"
          aria-selected={onglet === 'demandes'}
          onClick={() => setOnglet('demandes')}
          className={`bouton ${onglet === 'demandes' ? 'bouton-encre' : 'bouton-clair'}`}
        >
          <MessageSquareText className="h-4 w-4" aria-hidden="true" />
          {t('tabRequests')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={onglet === 'portefeuilles'}
          onClick={() => setOnglet('portefeuilles')}
          className={`bouton ${onglet === 'portefeuilles' ? 'bouton-encre' : 'bouton-clair'}`}
        >
          <Wallet className="h-4 w-4" aria-hidden="true" />
          {t('tabWallets')}
        </button>
      </div>

      {onglet === 'portefeuilles' && <PortefeuillesPanel />}

      {onglet === 'demandes' && (
        <>
      {/* ── L'ÉQUIPE SUPPORT : le propriétaire seul la compose ───────────────
          Le service clientèle était un goulot d'étranglement à une personne :
          ajouter quelqu'un demandait d'ouvrir la base. Ici, il donne un accès
          par l'ADRESSE du compte de la personne — aucun mot de passe ne
          circule — et retire cet accès d'un clic. Le panneau est au-dessus des
          tickets : c'est là qu'on décide QUI répond, avant de répondre. */}
      {estProprietaire && (
        <section className="carte-editoriale carte-cotes bloc-app mb-8">
          <span className="sur-titre">{t('supportTeamEyebrow')}</span>
          <h2 className="titre-section mt-2">{t('supportTeamTitle')}</h2>
          <p className="mt-2 text-sm text-stone-600">{t('supportTeamIntro')}</p>

          <form onSubmit={ajouterAgent} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1" htmlFor="email-agent-support">
              <span className="sur-titre">{t('supportTeamEmail')}</span>
              <input
                id="email-agent-support"
                type="email"
                autoComplete="email"
                required
                value={emailAgent}
                onChange={(evenement) => setEmailAgent(evenement.target.value)}
                placeholder={t('supportTeamEmailPlaceholder')}
                className={CHAMP}
              />
            </label>
            <button
              type="submit"
              disabled={equipeEnCours || !emailAgent.trim()}
              className="bouton bouton-encre shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {equipeEnCours ? t('supportTeamAdding') : t('supportTeamAdd')}
            </button>
          </form>

          {/* Une CONFIRMATION (`status`, annoncée poliment) et un REFUS
              (`alert`, annoncé tout de suite) ne sont pas la même chose. */}
          {equipeMessage && (
            <p role="status" className={`mt-4 ${RAYON} border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800`}>
              {equipeMessage}
            </p>
          )}
          {equipeError && (
            <p role="alert" className={`mt-4 ${RAYON} border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700`}>
              {equipeError}
            </p>
          )}

          {equipe.length === 0 ? (
            equipeError ? null : (
              <p className={`mt-4 ${RAYON} border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500`}>
                {t('supportTeamEmpty')}
              </p>
            )
          ) : (
            <ul className="mt-4 divide-y divide-stone-100">
              {equipe.map((agent) => (
                <li key={agent.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="titre-entree truncate">
                      {[agent.first_name, agent.last_name].filter(Boolean).join(' ') || agent.email}
                    </div>
                    <div className="mt-1 truncate text-xs text-stone-500">{agent.email}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => retirerAgent(agent)}
                    disabled={equipeEnCours}
                    className={`${RAYON} inline-flex items-center gap-1.5 border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 transition-colors hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60`}
                    aria-label={`${t('supportTeamRemove')} ${agent.email}`}
                  >
                    <X size={14} aria-hidden="true" />
                    {t('supportTeamRemove')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Le filtre d'état était un `<select>` nu à côté d'une pastille : il
          devient la rangée de PUCES CARRÉES de /jobs (`.puce-filtre`), qui dit
          l'état courant sans qu'on ait à ouvrir un menu — et qui se replie en
          desktop au lieu de défiler (`puces-defilantes`). */}
      <div className="puces-defilantes mb-6">
        <button
          type="button"
          onClick={() => setStatusFilter('')}
          className={`puce-filtre ${statusFilter === '' ? 'puce-filtre-active' : ''}`}
        >
          {t('allStatuses')}
        </button>
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`puce-filtre ${statusFilter === s ? 'puce-filtre-active' : ''}`}
          >
            {statusLabel(s, t)}
          </button>
        ))}
      </div>

      {error && (
        <div className={`mb-4 ${RAYON} border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700`}>{error}</div>
      )}

      {loading ? (
        <div className="py-12 text-center text-stone-500">{t('loading')}</div>
      ) : tickets.length === 0 ? (
        /* UNE LECTURE EN PANNE N'EST PAS « AUCUNE DEMANDE » (24/10/2026) :
           quand `error` est posé, le bandeau du dessus dit la panne et nomme
           le remède (le bouton de rafraîchissement) ; écrire en plus « aucune
           demande de support » ferait lire un FAIT que la page n'a pas
           mesuré — c'est exactement le défaut qui a caché cinq tickets. */
        error ? null : (
          <div className={`${RAYON} border border-dashed border-stone-300 px-4 py-12 text-center text-sm text-stone-500`}>
            {t('noSupportRequests')}
          </div>
        )
      ) : (
        <div className="liste-editoriale">
          {tickets.map((ticket) => (
            <div key={ticket.id} className="ligne-editoriale py-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="titre-entree">{ticket.full_name}</div>
                  <div className="mt-1 text-xs text-stone-500">{formatDate(ticket.created_at)} · {ticket.channel === 'direct' ? t('directContact') : ticket.channel === 'whatsapp' ? 'WhatsApp' : t('robotAssistant')}</div>
                </div>
                <select
                  value={ticket.status}
                  disabled={updatingId === ticket.id}
                  onChange={(e) => handleStatusChange(ticket.id, e.target.value)}
                  className={`${RAYON} border px-3 py-1.5 text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-orange-500 ${STATUS_STYLES[ticket.status] || 'bg-stone-50 text-stone-700 border-stone-200'}`}
                >
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusLabel(s, t)}</option>)}
                </select>
              </div>

              <div className="mt-3 flex flex-wrap gap-4 text-sm text-stone-600">
                <a href={`tel:${ticket.phone}`} className="flex items-center gap-1.5 transition-colors hover:text-orange-700">
                  <Phone size={14} aria-hidden="true" /> {ticket.phone}
                </a>
                {/* Un contact WhatsApp n'a pas d'adresse : `ticket.email` est
                    facultatif depuis l'ouverture du canal. Un lien `mailto:`
                    vers « undefined » serait un bouton qui ne mène nulle part. */}
                {ticket.email && (
                  <a href={`mailto:${ticket.email}`} className="flex items-center gap-1.5 transition-colors hover:text-orange-700">
                    <Mail size={14} aria-hidden="true" /> {ticket.email}
                  </a>
                )}
              </div>

              <div className="mt-4">
                <span className="sur-titre">{t('reason')}</span>
                <p className="mt-2 text-sm text-stone-700">{ticket.reason}</p>
              </div>
              <div className="mt-3">
                <span className="sur-titre">{t('message')}</span>
                <p className="mt-2 whitespace-pre-line text-sm text-stone-700">{ticket.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
};

export default SupportAdmin;
