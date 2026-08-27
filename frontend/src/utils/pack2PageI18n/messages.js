// Auto-généré depuis pack2PageI18n.js — dictionnaire du scope 'messages'.
import { createScopedTranslator } from './core';
const withBase = (base, overrides) => ({ ...base, ...overrides });
const dict = {
fr: {
  otherUser: 'Utilisateur',
  placeholder: 'Tapez votre message...',
  sendMessageAria: 'Envoyer le message'
},
en: {
  otherUser: 'User',
  placeholder: 'Type your message...',
  sendMessageAria: 'Send message'
}
};
dict.wo = withBase(dict.fr, {
otherUser: 'Jëfandikookat',
  placeholder: 'Bind sa bataaxal...',
  sendMessageAria: 'Yónnee bataaxal bi'
});
dict.bm = withBase(dict.fr, {
otherUser: 'Baarakɛla',
  placeholder: 'I ka cikan sɛbɛn...',
  sendMessageAria: 'Cikan ci'
});
dict.mos = withBase(dict.fr, {
otherUser: 'Ned',
  placeholder: 'Gʋls f koeesã...',
  sendMessageAria: 'Tu koeesã'
});

export const makeScopedTranslator = (currentLanguage, fallbackT) =>
  createScopedTranslator(dict, currentLanguage, fallbackT);
