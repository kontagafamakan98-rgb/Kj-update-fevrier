import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Send, MessageCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { messagesAPI } from '../services/apiEndpoints';
import { handleApiError } from '../services/api';
import { openLiveStream } from '../services/liveStream';
import { MessagesSkeleton } from '../components/SkeletonLoader';
import Link from '../components/LienVue';
// Le cadre de page (largeur, gouttière, pas) a UN propriétaire —
// `src/config/app-cadres.js` — et cette page le LIT : deux chaînes recopiées
// divergeraient au premier correctif, en silence.
import CadrePage from '../components/CadrePage';
import { getLocaleForLanguage } from '../utils/pack2PageI18n/core';
import { makeScopedTranslator } from '../utils/pack2PageI18n/messages';
import { safeLog } from '../utils/env';
import { stripJobMarkerFromMessage } from '../utils/jobProposalWorkflow';
import { usePageTitle } from '../utils/seo';

export default function Messages() {
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [activeConversationData, setActiveConversationData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  // Pagination du fil : les 50 messages les plus récents d'abord, puis les
  // pages plus anciennes sont insérées au début sans casser l'ordre visuel.
  const MESSAGE_PAGE_SIZE = 50;
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [moreError, setMoreError] = useState('');
  const messagesEndRef = useRef(null);
  const lastMessageCountRef = useRef(0);
  const messagesCountRef = useRef(0);
  // Lu par l'écouteur du flux SSE : un événement peut arriver n'importe quand,
  // et il doit voir l'état du DERNIER rendu (fil ouvert, liste chargée), pas
  // celui du rendu où le flux a été ouvert.
  const activeConversationRef = useRef(null);
  const activeConversationDataRef = useRef(null);
  const conversationsRef = useRef([]);
  const operationsRef = useRef({});

  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t);
  usePageTitle(t('messagesMetaTitle'));

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    // Ne fait défiler vers le bas que si de VRAIS nouveaux messages sont
    // arrivés (pas à chaque poll silencieux qui ne change rien) - sinon un
    // utilisateur remonté lire d'anciens messages serait ramené en bas
    // toutes les 5 secondes.
    if (messages.length > lastMessageCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    lastMessageCountRef.current = messages.length;
  }, [messages]);

  const loadConversations = async ({ silent = false } = {}) => {
    try {
      const data = await messagesAPI.getConversations();
      setConversations(data);
    } catch (error) {
      safeLog.error('Error loading conversations:', handleApiError(error));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadMessages = async (conversationId, conversationData, {
    silent = false,
    offset = 0,
    order = 'desc',
    append = false,
    refresh = false
  } = {}) => {
    try {
      const data = await messagesAPI.getMessages(conversationId, { limit: MESSAGE_PAGE_SIZE, offset, order });
      if (append) {
        // La page ancienne est renvoyée chronologiquement après reverse côté
        // backend : elle se place donc avant le contenu déjà affiché.
        setMessages((prev) => [...data, ...prev]);
      } else if (refresh) {
        // Le polling fusionne les nouveaux messages sans effacer les pages
        // anciennes déjà chargées ni dupliquer un élément existant.
        setMessages((prev) => {
          const knownIds = new Set(prev.map((message) => message.id));
          const fresh = data.filter((message) => !knownIds.has(message.id));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      } else {
        setMessages(data);
      }
      if (!refresh) {
        setHasMoreMessages(data.length === MESSAGE_PAGE_SIZE);
      }
      if (!silent) {
        // Nouvelle conversation ouverte : on veut toujours défiler en bas au
        // premier chargement, quelle que soit la taille de la précédente.
        lastMessageCountRef.current = 0;
        setActiveConversation(conversationId);
        setActiveConversationData(conversationData);
      }
    } catch (error) {
      safeLog.error('Error loading messages:', handleApiError(error));
      if (append) setMoreError(pageT('loadOlderFailed') || 'Impossible de charger les messages plus anciens.');
    } finally {
      setLoadingOlder(false);
    }
  };

  const loadOlderMessages = async () => {
    if (!activeConversation || loadingOlder) return;
    setLoadingOlder(true);
    setMoreError('');
    await loadMessages(activeConversation, activeConversationData, { silent: true, offset: messages.length, order: 'desc', append: true });
  };

  // ── PUSH (SSE) : le fil et la liste ne sont plus relus à l'horloge ────────
  // Avant : le fil ouvert toutes les 5 s (12 requêtes/min) et la liste des
  // conversations toutes les 15 s (4/min), pour un utilisateur qui lit ses
  // messages — jusqu'à 16 requêtes par minute pour ne rien apprendre
  // (`SCALING.md` §5). Le serveur pousse maintenant chaque message
  // (`/messages/stream`, voir `kojo_live.py`) : le client ne paie que ce qui
  // arrive.
  //
  // FALLBACK_POLL_MS n'existe que pour le cas où le flux ne passe pas (proxy
  // qui tamponne, plafond de connexions, réseau) : le produit doit continuer de
  // fonctionner, à basse fréquence, sans redevenir bavard.
  const FALLBACK_POLL_MS = 60_000;

  // Le registre des chargements suit chaque rendu : un écouteur d'événement lit
  // TOUJOURS la version à jour, sans recréer le flux à chaque changement d'état
  // (une reconnexion par événement serait pire que l'ancien sondage).
  useEffect(() => {
    operationsRef.current = { loadConversations, loadMessages };
  });

  useEffect(() => {
    activeConversationRef.current = activeConversation;
    activeConversationDataRef.current = activeConversationData;
  }, [activeConversation, activeConversationData]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  /**
   * Un message poussé : soit le fil est ouvert (on le relit — c'est CETTE
   * lecture qui marque les messages lus, donc le badge de l'interlocuteur se
   * met à jour), soit la liste se met à jour SUR PLACE (aperçu, ordre,
   * non-lus).
   *
   * L'événement part aussi à l'EXPÉDITEUR (autres appareils du même compte) :
   * là, l'aperçu se met à jour mais le compteur non-lus NE BOUGE PAS — un
   * message qu'on a écrit n'est pas un message reçu.
   *
   * Une conversation encore inconnue (premier message d'une nouvelle relation)
   * n'a pas d'interlocuteur à afficher localement : la liste se relit une fois,
   * à ce moment-là seulement.
   */
  const appliquerMessage = (message) => {
    const ouvert = activeConversationRef.current;
    if (ouvert && ouvert === message.conversation_id) {
      operationsRef.current.loadMessages(
        ouvert,
        activeConversationDataRef.current,
        { silent: true, order: 'desc', refresh: true }
      );
      return;
    }

    const recu = message.receiver_id === user.id;
    const connue = (conversationsRef.current || []).some(
      (conversation) => conversation._id === message.conversation_id
    );
    if (!connue) {
      operationsRef.current.loadConversations({ silent: true });
      return;
    }

    setConversations((prev) => {
      const cible = prev.find((conversation) => conversation._id === message.conversation_id);
      if (!cible) return prev;
      const misAJour = {
        ...cible,
        last_message: message.content,
        last_timestamp: message.timestamp,
        unread_count: recu ? Number(cible.unread_count || 0) + 1 : Number(cible.unread_count || 0),
      };
      // La conversation qui vient de parler remonte en tête, comme le fait le
      // serveur (`GET /messages/conversations` trie par activité) : sans ça, la
      // liste cesserait d'être triée jusqu'au prochain rechargement.
      return [misAJour, ...prev.filter((conversation) => conversation._id !== message.conversation_id)];
    });
  };

  useEffect(() => {
    if (!user) return undefined;

    let demonte = false;
    let repli = null;

    const arreterRepli = () => {
      if (repli !== null) {
        clearInterval(repli);
        repli = null;
      }
    };

    const relireTout = () => {
      operationsRef.current.loadConversations({ silent: true });
      const ouvert = activeConversationRef.current;
      if (ouvert) {
        operationsRef.current.loadMessages(
          ouvert,
          activeConversationDataRef.current,
          { silent: true, order: 'desc', refresh: true }
        );
      }
    };

    const demarrerRepli = () => {
      if (repli !== null || demonte) return;
      relireTout(); // tout de suite : l'utilisateur ne voit pas de trou
      repli = setInterval(relireTout, FALLBACK_POLL_MS);
    };

    const fermer = openLiveStream('/messages/stream', {
      onStatus: (statut) => {
        if (demonte) return;
        if (statut === 'open') arreterRepli();
        else if (statut === 'down') demarrerRepli();
        else if (statut === 'closed') arreterRepli();
      },
      onEvent: (nom, data) => {
        if (demonte) return;
        if (nom === 'resync') {
          relireTout();
          return;
        }
        if (nom !== 'message' || !data?.conversation_id) return;
        // Le message peut venir d'un AUTRE appareil du même compte :
        // `appliquerMessage` distingue reçu et envoyé pour le compteur.
        appliquerMessage(data);
      },
    });

    return () => {
      demonte = true;
      arreterRepli();
      fermer();
    };
    // `appliquerMessage` ne lit que des refs et des setters stables : il
    // n'est PAS une dépendance, et l'ajouter rouvrirait le flux à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Conserve la taille affichée pour calculer l'offset de la prochaine page
  // de messages plus anciens.
  useEffect(() => {
    messagesCountRef.current = messages.length;
  }, [messages]);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeConversation) return;

    try {
      const ids = activeConversation.split('_');
      const receiverId = ids.find((id) => id !== user?.id);

      await messagesAPI.sendMessage({
        receiver_id: receiverId,
        content: newMessage
      });

      setNewMessage('');
      loadMessages(activeConversation, activeConversationData, { order: 'desc' });
    } catch (error) {
      safeLog.error('Error sending message:', handleApiError(error));
    }
  };

  const formatMessageTime = (timestamp) =>
    new Date(timestamp).toLocaleTimeString(getLocaleForLanguage(currentLanguage), {
      hour: '2-digit',
      minute: '2-digit'
    });

  const getOtherPersonName = () => activeConversationData?.other_user_name || pageT('otherUser');

  // L'ÉTAT VIDE est un écran à part entière, pas un manque : la pastille en
  // crème et le titre serif le traitent comme un commencement, et le lien mène
  // à la seule action qui puisse ouvrir une conversation (postuler à une
  // mission). Sans lui, l'écran vide n'offrait RIEN à faire.
  const EmptyIcon = () => (
    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-orange-50 morphe">
      <MessageCircle size={36} className="text-orange-500" strokeWidth={1.5} aria-hidden="true" />
    </div>
  );

  if (loading) {
    // Même squelette que le fallback Suspense de /messages (MessagesSkeleton) :
    // les deux phases (chargement du chunk puis des conversations) affichent
    // donc la même structure, h1 compris — le titre n'apparaît plus après coup.
    return <MessagesSkeleton />;
  }

  // AUCUNE CONVERSATION : l'écran n'a rien à montrer, donc il n'ouvre pas un
  // panneau vide de 75 vh avec une colonne de liste elle aussi vide — deux
  // cadres qui ne disent rien. Une carte, une phrase, une action : c'est la
  // règle déjà appliquée aux listes vides du site.
  if (conversations.length === 0) {
    return (
      <CadrePage chemin="/messages" titre={t('messages')} classeCorps="">
        {/* La HAUTEUR est celle que le squelette réserve (`h-[75vh]`, la même
            que le panneau de `MessagesSkeleton`) : sans elle, l'écran vide
            laissait le pied de page remonter de 400 px à l'arrivée des données
            (CLS 0,0504 mesuré par `e2e/cadres-app.spec.js` pour un plafond de
            0,02). Le rembourrage, lui, se LIT (`carte-publique`) : un rembourrage
            vertical fixe s'écarterait du jeton d'autant plus que la fenêtre
            grandit. */}
        <div className="carte-editoriale carte-publique flex h-[75vh] flex-col items-center justify-center text-center">
          <EmptyIcon />
          {/* L'échelle est celle d'un titre de CARTE (`.titre-carte-app`), pas
              d'un titre de section : l'élément LCP de `/messages` est le `<h1>`
              du cadre (« Messages »), et un titre de section dans la carte
              prenait sa place (mesuré : 4 256 → 6 390 px², `e2e/lcp-app.spec.js`).
              La hiérarchie voulue est aussi celle-là : le titre de la page
              domine, l'état vide se lit en dessous. */}
          <h2 className="titre-carte-app mt-6">{t('noConversations')}</h2>
          <p className="mt-3 max-w-md text-stone-600">{t('startApplyingJobs')}</p>
          {/* DEUX suites possibles, et c'est ce que l'écran vide doit offrir :
              une mission à proposer (la conversation naît de là) et la marche à
              suivre pour qui ne sait pas encore comment ça se passe. Un seul
              bouton laissait le visiteur qui hésite sans rien. */}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/jobs" className="bouton bouton-encre">
              {t('searchJobs')}
            </Link>
            <Link to="/how-it-works" className="bouton bouton-clair">
              {t('howItWorksTitle')}
            </Link>
          </div>
        </div>
      </CadrePage>
    );
  }

  return (
    <CadrePage chemin="/messages" titre={t('messages')} classeCorps="">
      <div className="carte-editoriale flex h-[75vh] overflow-hidden">
        {/* Liste des conversations : plein ecran sur mobile tant qu'aucune n'est ouverte,
            colonne fixe a partir de sm. */}
        <div className={`w-full flex-col border-r border-stone-200 bg-stone-50/60 sm:w-[320px] sm:shrink-0 ${activeConversation ? 'hidden sm:flex' : 'flex'}`}>
          <div className="border-b border-stone-200 px-4 py-3">
            <span className="sur-titre">{t('conversations')}</span>
          </div>

          {/* Une conversation existe FORCÉMENT : l'écran sans aucune
              conversation est rendu plus haut, en une seule carte. */}
          <div className="flex-1 overflow-y-auto">
            {conversations.map((conversation) => (
                <button
                  key={conversation._id}
                  onClick={() => loadMessages(conversation._id, conversation)}
                  className={`ligne-app w-full border-b border-stone-100 text-left ${
                    activeConversation === conversation._id ? 'ligne-app-active' : ''
                  }`}
                >
                  <div className="avatar-app">
                    {conversation.other_user?.profile_photo ? (
                      <img src={conversation.other_user.profile_photo} alt={conversation.other_user_name} className="h-full w-full object-cover" />
                    ) : (
                      (conversation.other_user_name || getOtherPersonName()).charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-stone-900">{conversation.other_user_name || getOtherPersonName()}</p>
                    <p className="truncate text-xs text-stone-500">{stripJobMarkerFromMessage(conversation.last_message)}</p>
                  </div>
                  {Number(conversation.unread_count || 0) > 0 && (
                    <span className="inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-[3px] bg-orange-700 px-1.5 text-xs font-bold text-white">
                      {conversation.unread_count}
                    </span>
                  )}
                </button>
            ))}
          </div>
        </div>

        {/* Fil de discussion : plein ecran sur mobile des qu'une conversation est ouverte */}
        <div className={`flex-1 flex-col ${activeConversation ? 'flex' : 'hidden sm:flex'}`}>
          {activeConversation ? (
            <>
              {/* L'EN-TÊTE DU FIL : sable et filet, la même teinte que la
                  colonne des conversations — le fil et sa liste sont deux
                  panneaux du même écran, pas deux pages voisines. */}
              <div className="flex items-center gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setActiveConversation(null)}
                  className="text-stone-500 hover:text-stone-800 sm:hidden"
                  aria-label={t('backToConversations')}
                >
                  <ArrowLeft size={20} />
                </button>
                <div className="avatar-app">
                  {activeConversationData?.other_user?.profile_photo ? (
                    <img src={activeConversationData.other_user.profile_photo} alt={getOtherPersonName()} className="h-full w-full object-cover" />
                  ) : (
                    getOtherPersonName().charAt(0).toUpperCase()
                  )}
                </div>
                <h3 className="titre-carte-app truncate">{getOtherPersonName()}</h3>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto bg-stone-50/40 p-4">
                {hasMoreMessages && (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={loadOlderMessages}
                      disabled={loadingOlder}
                      className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {loadingOlder ? (pageT('loadingOlder') || 'Chargement…') : (pageT('loadOlderExists') || 'Afficher les messages plus anciens')}
                    </button>
                  </div>
                )}
                {moreError && (
                  <p className="text-center text-xs text-red-600">{moreError}</p>
                )}
                {messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-gray-400">
                    {t('noMessagesYet')}
                  </div>
                ) : (
                  messages.map((message) => (
                    <div key={message.id} className={`flex ${message.sender_id === user?.id ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] rounded-xl px-4 py-2 text-sm sm:max-w-md ${
                          message.sender_id === user?.id
                            ? 'bulle-ecrite rounded-tr-sm'
                            : 'bulle-recue rounded-tl-sm'
                        }`}
                      >
                        {/* stripJobMarkerFromMessage nettoie un éventuel
                            ancien marqueur "[KOJO_JOB:...]" présent sur des
                            messages historiques (le mécanisme d'origine
                            insérait ce texte directement dans le contenu ;
                            il est désormais stocké dans un champ séparé,
                            mais on garde ce nettoyage par sécurité). */}
                        <p className="whitespace-pre-line">{stripJobMarkerFromMessage(message.content)}</p>
                        <p className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${message.sender_id === user?.id ? 'text-orange-100' : 'text-stone-500'}`}>
                          {formatMessageTime(message.timestamp)}
                          {message.sender_id === user?.id && (
                            <span title={message.read_at ? t('readReceiptReadAt').replace('{time}', formatMessageTime(message.read_at)) : (message.read ? t('readReceiptRead') : t('readReceiptSent'))}>
                              {message.read_at || message.read ? '✓✓' : '✓'}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={sendMessage} className="border-t border-stone-200 bg-white p-3">
                <div className="flex items-center gap-2">
                  <label htmlFor="message_input" className="sr-only">{pageT('placeholder')}</label>
                  <input
                    id="message_input"
                    name="message_input"
                    type="text"
                    autoComplete="off"
                    aria-label={pageT('placeholder')}
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder={pageT('placeholder')}
                    className="flex-1 px-4 py-2.5 text-sm outline-hidden focus:ring-2 focus:ring-orange-500"
                  />
                  <button
                    aria-label={pageT('sendMessageAria')}
                    type="submit"
                    disabled={!newMessage.trim()}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[3px] bg-orange-700 text-white hover:bg-orange-800 disabled:opacity-50"
                  >
                    <Send size={17} />
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="hidden flex-1 items-center justify-center text-stone-500 sm:flex">
              <div className="text-center">
                <EmptyIcon />
                <p className="mt-5 text-sm">{t('selectConversation')}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </CadrePage>
  );
}
