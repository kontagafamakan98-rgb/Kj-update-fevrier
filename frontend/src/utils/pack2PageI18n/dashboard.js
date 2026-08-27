// Auto-généré depuis pack2PageI18n.js — dictionnaire du scope 'dashboard'.
import { createScopedTranslator } from './core';
const withBase = (base, overrides) => ({ ...base, ...overrides });
const dict = {
fr: {
  loading: 'Chargement du tableau de bord...',
  recentBudget: '{min} - {max} XOF',
  status_open: 'Ouvert',
  status_in_progress: 'En cours',
  status_completed: 'Complété',
  status_cancelled: 'Annulé'
},
en: {
  loading: 'Loading dashboard...',
  recentBudget: '{min} - {max} XOF',
  status_open: 'Open',
  status_in_progress: 'In progress',
  status_completed: 'Completed',
  status_cancelled: 'Cancelled'
}
};
dict.wo = withBase(dict.fr, {
loading: 'Mi ngi yebbi dashboard bi...',
  status_open: 'Ubbeeku',
  status_in_progress: 'Mi ngi dox',
  status_completed: 'Jeexna',
  status_cancelled: 'Neenal'
});
dict.bm = withBase(dict.fr, {
loading: 'Bɛ tableau de bord kalan...',
  status_open: 'Dayɛlɛn',
  status_in_progress: 'Bɛ sen',
  status_completed: 'Banbali',
  status_cancelled: 'Dabila'
});
dict.mos = withBase(dict.fr, {
loading: 'A kareng tableau de bord...',
  status_open: 'Yɔɔgda',
  status_in_progress: 'A tʋmda',
  status_completed: 'A séose',
  status_cancelled: 'A yãage'
});

export const makeScopedTranslator = (currentLanguage, fallbackT) =>
  createScopedTranslator(dict, currentLanguage, fallbackT);
