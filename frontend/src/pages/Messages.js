import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Send, MessageCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { messagesAPI, handleApiError } from '../services/api';
import { ListSkeleton } from '../components/SkeletonLoader';
import { getLocaleForLanguage, makeScopedTranslator } from '../utils/pack2PageI18n';
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
  const messagesEndRef = useRef(null);
  const lastMessageCountRef = useRef(0);

  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'messages');
  usePageTitle('Messages — Kojo');

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

  // Rafraîchissement automatique (polling) : sans ça, un message envoyé par
  // l'autre personne pendant que la conversation est ouverte n'apparaissait
  // jamais tant qu'on ne rechargeait pas la page manuellement.
  useEffect(() => {
    if (!activeConversation) return undefined;
    const intervalId = setInterval(() => {
      loadMessages(activeConversation, activeConversationData, { silent: true });
    }, 5000);
    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversation]);

  // Rafraîchit la liste des conversations (aperçus + ordre) même quand
  // aucune conversation n'est ouverte, pour voir arriver un nouveau message.
  useEffect(() => {
    const intervalId = setInterval(() => {
      loadConversations({ silent: true });
    }, 15000);
    return () => clearInterval(intervalId);
  }, []);

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

  const loadMessages = async (conversationId, conversationData, { silent = false } = {}) => {
    try {
      const data = await messagesAPI.getMessages(conversationId);
      if (!silent) {
        // Nouvelle conversation ouverte : on veut toujours défiler en bas au
        // premier chargement, quelle que soit la taille de la précédente.
        lastMessageCountRef.current = 0;
      }
      setMessages(data);
      if (!silent) {
        setActiveConversation(conversationId);
        setActiveConversationData(conversationData);
      }
    } catch (error) {
      safeLog.error('Error loading messages:', handleApiError(error));
    }
  };

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
      loadMessages(activeConversation, activeConversationData);
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

  const EmptyIcon = () => (
    <MessageCircle size={48} className="mx-auto text-gray-300" strokeWidth={1.5} />
  );

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden h-[70vh] flex">
          <div className="w-full sm:w-1/3 border-r border-gray-100 p-4">
            <div className="h-6 w-32 bg-gray-200 rounded animate-pulse mb-4"></div>
            <ListSkeleton count={4} type="message" />
          </div>
          <div className="hidden sm:flex flex-1 items-center justify-center">
            <div className="h-6 w-48 bg-gray-200 rounded animate-pulse mx-auto"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">{t('messages')}</h1>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden h-[75vh] flex">
        {/* Liste des conversations : plein ecran sur mobile tant qu'aucune n'est ouverte,
            colonne fixe a partir de sm. */}
        <div className={`w-full sm:w-[320px] sm:flex-shrink-0 border-r border-gray-100 flex-col ${activeConversation ? 'hidden sm:flex' : 'flex'}`}>
          <div className="px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{t('conversations')}</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {conversations.length > 0 ? (
              conversations.map((conversation) => (
                <button
                  key={conversation._id}
                  onClick={() => loadMessages(conversation._id, conversation)}
                  className={`w-full px-4 py-3 text-left border-b border-gray-50 transition-colors hover:bg-gray-50 ${
                    activeConversation === conversation._id ? 'bg-orange-50' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-full bg-gray-200 flex items-center justify-center">
                      {conversation.other_user?.profile_photo ? (
                        <img src={conversation.other_user.profile_photo} alt={conversation.other_user_name} className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-gray-600 font-semibold">{(conversation.other_user_name || getOtherPersonName()).charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 truncate">{conversation.other_user_name || getOtherPersonName()}</p>
                      <p className="text-xs text-gray-500 truncate">{stripJobMarkerFromMessage(conversation.last_message)}</p>
                    </div>
                    {Number(conversation.unread_count || 0) > 0 && (
                      <span className="flex-shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-orange-600 text-white text-xs font-bold">
                        {conversation.unread_count}
                      </span>
                    )}
                  </div>
                </button>
              ))
            ) : (
              <div className="px-4 py-12 text-center">
                <EmptyIcon />
                <p className="mt-3 text-sm font-medium text-gray-600">{t('noConversations')}</p>
                <p className="mt-1 text-xs text-gray-400">{t('startApplyingJobs')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Fil de discussion : plein ecran sur mobile des qu'une conversation est ouverte */}
        <div className={`flex-1 flex-col ${activeConversation ? 'flex' : 'hidden sm:flex'}`}>
          {activeConversation ? (
            <>
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50">
                <button
                  type="button"
                  onClick={() => setActiveConversation(null)}
                  className="sm:hidden text-gray-500 hover:text-gray-700"
                  aria-label={t('backToConversations')}
                >
                  <ArrowLeft size={20} />
                </button>
                <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-full bg-gray-200 flex items-center justify-center">
                  {activeConversationData?.other_user?.profile_photo ? (
                    <img src={activeConversationData.other_user.profile_photo} alt={getOtherPersonName()} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs text-gray-600 font-semibold">{getOtherPersonName().charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <h3 className="font-semibold text-gray-900">{getOtherPersonName()}</h3>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/50">
                {messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-gray-400">
                    {t('noMessagesYet')}
                  </div>
                ) : (
                  messages.map((message) => (
                    <div key={message.id} className={`flex ${message.sender_id === user?.id ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] sm:max-w-md px-4 py-2 rounded-2xl text-sm ${
                          message.sender_id === user?.id
                            ? 'bg-orange-600 text-white rounded-tr-sm'
                            : 'bg-white border border-gray-100 text-gray-900 rounded-tl-sm'
                        }`}
                      >
                        {/* stripJobMarkerFromMessage nettoie un éventuel
                            ancien marqueur "[KOJO_JOB:...]" présent sur des
                            messages historiques (le mécanisme d'origine
                            insérait ce texte directement dans le contenu ;
                            il est désormais stocké dans un champ séparé,
                            mais on garde ce nettoyage par sécurité). */}
                        <p className="whitespace-pre-line">{stripJobMarkerFromMessage(message.content)}</p>
                        <p className={`text-[11px] mt-1 flex items-center justify-end gap-1 ${message.sender_id === user?.id ? 'text-orange-100' : 'text-gray-400'}`}>
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

              <form onSubmit={sendMessage} className="p-3 border-t border-gray-100 bg-white">
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
                    className="flex-1 rounded-full border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  />
                  <button
                    aria-label={pageT('sendMessageAria')}
                    type="submit"
                    disabled={!newMessage.trim()}
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
                  >
                    <Send size={17} />
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex-1 items-center justify-center text-gray-400 hidden sm:flex">
              <div className="text-center">
                <EmptyIcon />
                <p className="mt-3 text-sm">{t('selectConversation')}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
