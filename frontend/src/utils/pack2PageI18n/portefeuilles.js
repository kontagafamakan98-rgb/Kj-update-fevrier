// Dictionnaire du scope 'portefeuilles' — la file des TITULAIRES de comptes
// mobile money, tenue par le propriétaire OU l’équipe support (kojo_kyc).
// Comme les autres scopes, il n’est importé que par son composant : les deux
// langues complètes tiennent ici, et wo/bm/mos héritent du français via
// `withBase` avec les quelques phrases qu’on sait vraiment écrire — même
// convention que `administration`, dont ce panneau est le voisin.
import { createScopedTranslator } from './core.js';
const withBase = (base, overrides) => ({ ...base, ...overrides });
const dict = {
fr: {
  eyebrow: 'Service clientèle',
  title: 'Titulaires des comptes mobile money',
  subtitle: 'Un versement ne part que si le compte mobile money est au nom du travailleur. Quand le nom déclaré diffère, validez ou refusez avec un motif : la décision vaut pour ce couple (nom, numéro), pas pour un seul paiement.',
  loading: 'Chargement des portefeuilles…',
  loadError: 'Impossible de charger les portefeuilles.',
  retry: 'Réessayer',
  refresh: 'Actualiser',
  filterAll: 'Tous',
  state_en_attente: 'À vérifier',
  state_verifie: 'Vérifié',
  state_non_declare: 'Nom manquant',
  state_refuse: 'Refusé',
  empty: 'Aucun portefeuille dans cet état.',
  truncated: 'Lecture bornée : seuls les deux mille comptes les plus récents sont couverts.',
  declaredName: 'Titulaire déclaré',
  accountName: 'Nom du compte',
  wallet: 'Wallet',
  noWallet: 'Aucun wallet',
  validate: 'Valider',
  refuse: 'Refuser',
  decisionTitle: 'Décision sur ce portefeuille',
  note: 'Motif de la décision',
  notePlaceholder: 'Ce que vous avez vérifié, en une phrase qu’un collègue comprendra.',
  noteRequired: 'Un motif d’au moins 10 caractères est exigé.',
  decisionError: 'La décision n’a pas été appliquée.',
  decisionSuccess: 'Décision appliquée et enregistrée.',
  cancel: 'Annuler',
  apply: 'Appliquer',
  close: 'Fermer',
  decidedBy: 'Décidé par',
  hintVerifier: 'Le travailleur peut être payé sur ce wallet. La vérification reste valable tant que le nom et le numéro ne changent pas.',
  hintRefuser: 'Aucun versement ne partira vers ce wallet tant que le travailleur n’enregistre pas un compte à son nom.'
},
en: {
  eyebrow: 'Customer support',
  title: 'Mobile money wallet holders',
  subtitle: 'A payout only leaves when the mobile money account belongs to the worker. When the declared name differs, approve or refuse with a reason: the decision covers that name and number pair, not a single payment.',
  loading: 'Loading wallets…',
  loadError: 'Could not load the wallets.',
  retry: 'Try again',
  refresh: 'Refresh',
  filterAll: 'All',
  state_en_attente: 'To review',
  state_verifie: 'Verified',
  state_non_declare: 'Name missing',
  state_refuse: 'Refused',
  empty: 'No wallet in this state.',
  truncated: 'Bounded read: only the two thousand most recent accounts are covered.',
  declaredName: 'Declared holder',
  accountName: 'Account name',
  wallet: 'Wallet',
  noWallet: 'No wallet',
  validate: 'Approve',
  refuse: 'Refuse',
  decisionTitle: 'Decision on this wallet',
  note: 'Reason for the decision',
  notePlaceholder: 'What you checked, in one sentence a colleague will understand.',
  noteRequired: 'A reason of at least 10 characters is required.',
  decisionError: 'The decision was not applied.',
  decisionSuccess: 'Decision applied and recorded.',
  cancel: 'Cancel',
  apply: 'Apply',
  close: 'Close',
  decidedBy: 'Decided by',
  hintVerifier: 'The worker can be paid on this wallet. The verification lasts as long as the name and number stay the same.',
  hintRefuser: 'No payout will leave for this wallet until the worker registers an account in their own name.'
}
};
dict.wo = withBase(dict.fr, {
  eyebrow: 'Ndimbal kiliyaŋ',
  title: 'Boroom kont mobile money yi',
  subtitle: 'Peye du génn ba kont mobile money bi doon boroom baara bi. Su tur bi ñu bind doon du sa tur, nangu ko walla tere ko ak ab motif : bare bi di na wax ci tur bi ak nimeero bi.',
  filterAll: 'Yépp',
  loading: 'Kont yi ngi ñu leen di yeb…',
  refresh: 'Yeesal',
  validate: 'Nangu',
  refuse: 'Tere'
});
dict.bm = withBase(dict.fr, {
  eyebrow: 'Kiliyan dɛmɛ',
  title: 'Mobile money jatebɔsɛbɛn tigiw',
  subtitle: 'Waribirili tɛ bɔ fɔ jatebɔsɛbɛn in ye baarakɛla tigi tɔgɔ ye. Nɔgɔndɔ tɔgɔ ma zan, a dafa walima a bali ni sababu ye : a bɛ kɛ tɔgɔ ni nimɔrɔ in ye.',
  filterAll: 'Bɛɛ',
  loading: 'Jatebɔsɛbɛnw bɛ don…',
  refresh: 'Kura',
  validate: 'Dafa',
  refuse: 'Bali'
});
dict.mos = withBase(dict.fr, {
  eyebrow: 'Kiliya sõngre',
  title: 'Mobile money konta soabã',
  subtitle: 'Ligd kõosg ka yɩ fɔ kontã yaa tʋʋm-neda naamã. Yaa naamã ka zems bɩ, n pʋʋs bɩ yãk ne sake : a yaa naamã la nimero wẽnna la.',
  filterAll: 'Fãa',
  loading: 'Kont dãmbã n dogdi…',
  refresh: 'Lebg n ges',
  validate: 'Pʋʋse',
  refuse: 'Zãbe'
});

export const makeScopedTranslator = (currentLanguage, fallbackT) =>
  createScopedTranslator(dict, currentLanguage, fallbackT);
