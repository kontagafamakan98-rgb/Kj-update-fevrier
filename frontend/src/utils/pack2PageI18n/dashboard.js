// Auto-généré depuis pack2PageI18n.js — dictionnaire du scope 'dashboard'.
import { createScopedTranslator } from './core.js';
const withBase = (base, overrides) => ({ ...base, ...overrides });
const dict = {
fr: {
  loading: 'Chargement du tableau de bord...',
  recentBudget: '{min} - {max} XOF',
  status_open: 'Ouvert',
  status_in_progress: 'En cours',
  status_completed: 'Complété',
  status_cancelled: 'Annulé',
  addPaymentAccountHint: 'Tu n’as pas encore de compte de paiement. Ce n’est pas urgent : ajoute-le quand tu voudras être payé (ou payer une mission).',
  addPaymentAccountAction: 'Ajouter un compte de paiement'
},
en: {
  loading: 'Loading dashboard...',
  recentBudget: '{min} - {max} XOF',
  status_open: 'Open',
  status_in_progress: 'In progress',
  status_completed: 'Completed',
  status_cancelled: 'Cancelled',
  addPaymentAccountHint: 'You have no payment account yet. That is fine for now: add one whenever you want to get paid (or to pay for a mission).',
  addPaymentAccountAction: 'Add a payment account'
}
};
dict.wo = withBase(dict.fr, {
  loading: 'Mi ngi yebbi tablo bi…',
  status_open: 'Ubbeeku',
  status_in_progress: 'Mi ngi dox',
  status_completed: 'Jeexna',
  status_cancelled: 'Neenal',
  addPaymentAccountHint: 'Amoo kont bu man a fey. Yomb na: boole ko bépp bu bëggee ñu fey la (walla fey ab liggéey).',
  addPaymentAccountAction: 'Boole ab kont bu man a fey'
});
dict.bm = withBase(dict.fr, {
  loading: 'Tablo bi bɛ don…',
  status_open: 'Dayɛlɛn',
  status_in_progress: 'Bɛ sen',
  status_completed: 'Banbali',
  status_cancelled: 'Dabila',
  addPaymentAccountHint: 'I ma sara kontu sɔrɔ fɔlɔ. A ma gɛlɛn: i bɛ se ka a fara a kan waati min i bɛ sɔn ka sara sɔrɔ (walla ka baara sara).',
  addPaymentAccountAction: 'Sara kontu fara a kan'
});
dict.mos = withBase(dict.fr, {
  loading: 'Tablo wã n dogdi…',
  status_open: 'Yɔɔgda',
  status_in_progress: 'A tʋmda',
  status_completed: 'A séose',
  status_cancelled: 'A yãage',
  addPaymentAccountHint: 'F ka sara kont pa tar ye. Woto ka yalem: paas-a wakat ning f sẽn dat n paam sara (walla n yo sara tʋʋm).',
  addPaymentAccountAction: 'Paas sara kont'
});

export const makeScopedTranslator = (currentLanguage, fallbackT) =>
  createScopedTranslator(dict, currentLanguage, fallbackT);
