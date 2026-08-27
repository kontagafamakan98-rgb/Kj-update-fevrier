// Auto-généré depuis pack2PageI18n.js — dictionnaire du scope 'commissionDashboard'.
import { createScopedTranslator } from './core';
const withBase = (base, overrides) => ({ ...base, ...overrides });
const dict = {
fr: {
  checkingAccess: 'Vérification des accès...',
  accessReserved: 'Accès réservé à Famakan Kontaga Master',
  accessMessage: 'Cette section est réservée exclusivement à Famakan Kontaga Master, le propriétaire de l\'application Kojo.',
  securityNote: 'Note de sécurité : le tableau de bord des commissions contient des informations financières sensibles et n\'est accessible qu\'avec l\'autorisation de Famakan Kontaga Master.',
  connectedUser: '👤 Utilisateur connecté',
  email: '📧 Email',
  accessLevel: '🔐 Niveau d\'accès',
  standardUser: 'Utilisateur standard',
  back: '← Retour',
  title: '💼 Tableau de bord - commissions propriétaire',
  subtitle: 'Suivi de vos commissions automatiques de 14 % sur tous les paiements',
  totalCommissions: 'Total commissions',
  totalVolume: 'Volume total',
  transactions: 'Transactions',
  today: 'Aujourd\'hui',
  receptionAccounts: '🏦 Vos comptes de réception',
  saveAccounts: '✅ Sauvegarder',
  editAccounts: '✏️ Modifier',
  updatedSuccess: '✅ Comptes mis à jour avec succès !',
  phoneNumber: 'Numéro de téléphone :',
  accountName: 'Nom du compte :',
  notConfigured: 'Non configuré',
  accountNumber: 'Numéro de compte :',
  bank: 'Banque :',
  history: '📋 Historique des commissions',
  refresh: '🔄 Actualiser',
  noTransactions: 'Aucune transaction avec commission pour le moment',
  noTransactionsHelp: 'Les commissions apparaîtront ici après les premiers paiements',
  transaction: 'Transaction',
  totalAmount: 'Montant total',
  yourCommission: 'Votre commission (14 %)',
  workerAmount: 'Travailleur (86 %)',
  method: 'Méthode',
  date: 'Date',
  bankCard: 'Carte bancaire'
},
en: {
  checkingAccess: 'Checking access...',
  accessReserved: 'Access reserved for Famakan Kontaga Master',
  accessMessage: 'This section is reserved exclusively for Famakan Kontaga Master, the owner of the Kojo application.',
  securityNote: 'Security note: the commission dashboard contains sensitive financial information and is only accessible with authorization from Famakan Kontaga Master.',
  connectedUser: '👤 Logged in user',
  email: '📧 Email',
  accessLevel: '🔐 Access level',
  standardUser: 'Standard user',
  back: '← Back',
  title: '💼 Dashboard - owner commissions',
  subtitle: 'Track your automatic 14% commissions on all payments',
  totalCommissions: 'Total commissions',
  totalVolume: 'Total volume',
  transactions: 'Transactions',
  today: 'Today',
  receptionAccounts: '🏦 Your receiving accounts',
  saveAccounts: '✅ Save',
  editAccounts: '✏️ Edit',
  updatedSuccess: '✅ Accounts updated successfully!',
  phoneNumber: 'Phone number:',
  accountName: 'Account name:',
  notConfigured: 'Not configured',
  accountNumber: 'Account number:',
  bank: 'Bank:',
  history: '📋 Commission history',
  refresh: '🔄 Refresh',
  noTransactions: 'No commission transactions yet',
  noTransactionsHelp: 'Commissions will appear here after the first payments',
  transaction: 'Transaction',
  totalAmount: 'Total amount',
  yourCommission: 'Your commission (14%)',
  workerAmount: 'Worker (86%)',
  method: 'Method',
  date: 'Date',
  bankCard: 'Bank card'
}
};
dict.wo = withBase(dict.fr, {
checkingAccess: 'Mi ngi seet sañ-sañ yi...',
  accessReserved: 'Famakan Kontaga Master rekk moo ko yelloo',
  title: '💼 Dashboard - komision propriétaire',
  subtitle: 'Toppaatal sa 14% komision ci fey yépp',
  receptionAccounts: '🏦 Say kontu jot',
  history: '📋 Jaar-jaaru komision yi',
  refresh: '🔄 Yeesal'
});
dict.bm = withBase(dict.fr, {
checkingAccess: 'Bɛ sira ɲini...',
  accessReserved: 'Famakan Kontaga Master dɔrɔn de ye',
  title: '💼 Tableau de bord - commissionw',
  subtitle: 'I ka commission automatique 14% filɛ sara bɛɛ kan',
  receptionAccounts: '🏦 I ka konto minnu bɛ sara sɔrɔ',
  history: '📋 Commission tariku',
  refresh: '🔄 Kura'
});
dict.mos = withBase(dict.fr, {
checkingAccess: 'A gese sañ-sañ...',
  accessReserved: 'Famakan Kontaga Master bal n tar sañ-sã',
  title: '💼 Tableau de bord - komision',
  subtitle: 'Gese f komision automatique 14% yaoolã bãmb',
  receptionAccounts: '🏦 F konto sẽn deeg yaool',
  history: '📋 Komision gulsgo',
  refresh: '🔄 Lebg n ges'
});

export const makeScopedTranslator = (currentLanguage, fallbackT) =>
  createScopedTranslator(dict, currentLanguage, fallbackT);
