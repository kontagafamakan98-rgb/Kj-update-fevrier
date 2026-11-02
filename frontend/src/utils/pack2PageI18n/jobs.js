// Auto-généré depuis pack2PageI18n.js — dictionnaire du scope 'jobs'.
import { createScopedTranslator } from './core.js';
const withBase = (base, overrides) => ({ ...base, ...overrides });
const dict = {
fr: {
  searchPlaceholder: 'Titre ou description...',
  // Onglets et libellés de la liste : sans ces clés, makeScopedTranslator
  // retombait sur la clé brute (ex. « tabDiscover ») — l'onglet s'affichait
  // littéralement « tabDiscover » quelle que soit la langue.
  tabDiscover: 'Découvrir',
  tabApplications: 'Mes candidatures',
  tabMissions: 'Mes missions',
  myMissions: 'Mes missions',
  availableJobs: 'Emplois disponibles',
  // Paragraphe d'introduction de la page : son plus grand bloc de texte, donc
  // l'élément LCP. Il est publié par la coquille (peinte au premier paint, avant
  // tout JavaScript) ET par la page — déclaré par son plan, résolu par les deux
  // canaux. Sans lui, le plus grand texte peint restait celui de l'état vide,
  // qui n'existe qu'après la réponse de /api/jobs.
  intro:
    'Retrouvez ici toutes les missions publiées sur Kojo : parcourez les offres ouvertes près de chez vous, postulez en quelques minutes et suivez vos candidatures au même endroit.',
  allCategories: 'Toutes les catégories',
  allStatuses: 'Tous les statuts',
  loadingMore: 'Chargement…',
  loadMore: 'Afficher plus de missions',
  noApplicationsYet: 'Vous n’avez pas encore postulé à une mission.',
  // États d'échec et de liste vide : chacun dit quoi faire ensuite (l'écran
  // ne laisse plus une liste vide passer pour une panne, ni l'inverse).
  retry: 'Réessayer',
  loadErrorNetwork: 'Pas de connexion. Vérifiez votre réseau, puis réessayez.',
  loadErrorServer: 'Le serveur n’a pas répondu. Réessayez dans un instant.',
  emptyFiltered: 'Aucune mission ne correspond à ces filtres.',
  clearFilters: 'Effacer les filtres',
  emptyHint: 'Élargissez votre recherche ou revenez plus tard.',
  // Le COMMTE mesuré (X-Total-Count), jamais la longueur de la page : « 12
  // missions » s'affiche alors que la page en montre 12 sur 300.
  resultsOne: '1 mission correspond à votre recherche',
  resultsMany: '{count} missions correspondent à votre recherche',
  sortLabel: 'Trier par',
  sortRecent: 'Plus récentes',
  sortBudget: 'Budget le plus élevé',
  // L'ordre ne s'applique qu'après la géolocalisation : le libellé le dit
  // (« au plus proche »), et le refus de position laisse l'ordre précédent.
  sortDistance: 'Au plus proche',
  // L'ÉTAT VIDE PUBLIC (24/10/2026) : ces trois clés vivent ICI et pas dans
  // `src/i18n/*.json` — elles ne servent qu'à cette page, et le dictionnaire
  // global part dans le bundle INITIAL (mesuré : 131,0 Ko gzip sur un budget
  // de 131,0, la version globale faisait déborder de 29 octets). Le scope de
  // page est chargé avec la page, qui est déjà différée.
  // L'ÉTAT VIDE PUBLIC PORTE LA PROMESSE DANS SON TITRE (28/10/2026). Le titre
  // était le fait seul (« Aucun job disponible pour le moment. »), et l'audit du
  // 28/10 l'a nommé comme la première phrase de la page la plus stratégique :
  // honnête, et décourageant. Le titre dit donc ce que la page OFFRE, et le
  // premier mot du paragraphe reste le FAIT — aucun chiffre, aucune mission
  // inventée : la promesse est une option, pas un stock.
  premierArrivantsTitle: 'Soyez prévenu avant les autres',
  premierArrivantsLead:
    'Aucune mission n’est ouverte aujourd’hui. Publiez la vôtre, recevez les nouvelles par email, ou écrivez-nous sur WhatsApp.',
  premierArrivantsWatch: 'Recevoir les missions par email',
  premierArrivantsWhatsApp: 'Écrire sur WhatsApp',
  // ── UN CLIENT NE PEUT PAS AVOIR DE VEILLE, ET LA PAGE LE DIT (31/10/2026)
  // Mesuré ce jour : un client connecté qui arrivait d'une page ville ou
  // métier (`/jobs?alerte=1&ville=Bamako`) ne voyait RIEN à l'endroit où le
  // bouton l'avait déposé — le bloc de promesse n'est peint que pour un
  // visiteur sans compte, la carte interactive que pour un travailleur. Le
  // lien avait donc menti sur sa destination, et l'écran laissait croire à une
  // panne. Ces trois clés disent la règle ET pourquoi elle existe.
  //
  // Deux règles de rédaction, celles des pages ville et métier : aucune offre
  // promise (la veille prévient, elle ne stocke rien), et le MÉCANISME est dit
  // — l'alerte s'active depuis un compte travailleur, et c'est elle qui
  // prévient les travailleurs quand un client publie.
  jobAlertReservedTitle: 'Les alertes emploi sont réservées aux travailleurs',
  jobAlertReservedLead:
    'Une veille envoie par email les missions qui correspondent à des critères. Sur un compte client, elle vous renverrait le catalogue que vous publiez vous-même — c’est pourquoi elle s’active depuis un compte travailleur. Quand vous publiez une mission, ce sont les travailleurs qui ont une veille qui sont prévenus.',
  jobAlertReservedAction: 'Publier une mission'
},
en: {
  searchPlaceholder: 'Title or description...',
  tabDiscover: 'Discover',
  tabApplications: 'My applications',
  tabMissions: 'My jobs',
  myMissions: 'My jobs',
  availableJobs: 'Available jobs',
  intro:
    'Find every mission published on Kojo here: browse the open jobs near you, apply in a few minutes and follow your applications in one place.',
  allCategories: 'All categories',
  allStatuses: 'All statuses',
  loadingMore: 'Loading…',
  loadMore: 'Show more jobs',
  noApplicationsYet: 'You have not applied to a job yet.',
  retry: 'Try again',
  loadErrorNetwork: 'No connection. Check your network, then try again.',
  loadErrorServer: 'The server did not answer. Try again in a moment.',
  emptyFiltered: 'No job matches these filters.',
  clearFilters: 'Clear filters',
  emptyHint: 'Widen your search or come back later.',
  resultsOne: '1 mission matches your search',
  resultsMany: '{count} missions match your search',
  sortLabel: 'Sort by',
  sortRecent: 'Most recent',
  sortBudget: 'Highest budget',
  sortDistance: 'Closest first',
  premierArrivantsTitle: 'Be the first to know',
  premierArrivantsLead:
    'No mission is open right now. Post yours, get new ones by email, or message us on WhatsApp.',
  premierArrivantsWatch: 'Get missions by email',
  premierArrivantsWhatsApp: 'Message us on WhatsApp',
  jobAlertReservedTitle: 'Job alerts are for workers',
  jobAlertReservedLead:
    'An alert emails the missions that match your criteria. On a client account it would send you back the catalogue you publish yourself, which is why it is enabled from a worker account. When you post a mission, the workers who set an alert are the ones notified.',
  jobAlertReservedAction: 'Post a mission'
}
};
// 02/11/2026 : le scope est traduit EN ENTIER en wo/bm/mos (26 clés manquaient
// ici, et la page /jobs restait à 67-78 % de français dans ces trois langues).
dict.wo = withBase(dict.fr, {
  searchPlaceholder: 'Tur walla melokaan...',
  tabDiscover: 'Seetal',
  tabApplications: 'Sa kandidaat yi',
  tabMissions: 'Sa liggéey yi',
  myMissions: 'Sa liggéey yi',
  availableJobs: 'Liggéey yu am',
  intro:
    'Fii nga di gis liggéey yépp yu ñu feeñal ci Kojo : seetal liggéey yi ubbeeku ci sa wet, laaj ci saa bu gaaw, te topp sa kandidaat yi fii.',
  allCategories: 'Xeetu liggéey yépp',
  allStatuses: 'Statut yépp',
  loadingMore: 'Mi ngi ñëw…',
  loadMore: 'Wone liggéey yu bari',
  noApplicationsYet: 'Amuloo kandidaat ci liggéey ba léegi.',
  retry: 'Jéemaat',
  loadErrorNetwork: 'Amul jokkoo. Seet sa reso, te jéemaat.',
  loadErrorServer: 'Serwer bi tontuwul. Jéemaat ci saa bu gaawe.',
  emptyFiltered: 'Amul liggéey bu zems ak filtre yii.',
  clearFilters: 'Far filtre yi',
  emptyHint: 'Yaatal sa seet walla dellu ci ginnaaw.',
  resultsOne: '1 liggéey zems na ak sa seet',
  resultsMany: '{count} liggéey zems nañu ak sa seet',
  sortLabel: 'Tëral ci',
  sortRecent: 'Yu bees',
  sortBudget: 'Bajat bu gëna mag',
  sortDistance: 'Yu gëna jege',
  premierArrivantsTitle: 'Jot liggéey yi njëkk',
  premierArrivantsLead: 'Amul liggéey bu ubbeeku tey. Feesal sa liggéey, jot yu bees ci email, walla bind nu ci WhatsApp.',
  premierArrivantsWatch: 'Jot liggéey yi ci email',
  premierArrivantsWhatsApp: 'Bind ci WhatsApp',
  jobAlertReservedTitle: 'Alerta yu liggéey, liggéeykat yi lañu',
  jobAlertReservedLead:
    'Alerta dafay yónnee ci email liggéey yi zems ak sa tànn yi. Ci konto kliyan, dina la delloo katalog bi nga boole ci sa bopp — moo tax ñu di ko doxal ci konto liggéeykat. Su nga boole liggéey, liggéeykat yi am alerta ñoo lañu di yéegle.',
  jobAlertReservedAction: 'Boole liggéey'
});
dict.bm = withBase(dict.fr, {
  searchPlaceholder: 'Tɔgɔ walima fɔli...',
  tabDiscover: 'A flɛ',
  tabApplications: 'N ka kandidatiw',
  tabMissions: 'N ka baaraw',
  myMissions: 'N ka baaraw',
  availableJobs: 'Baaraw minnu bɛ yen',
  intro:
    'Yan i bɛ baaraw bɛɛ ye minnu bɛ Kojo kan : baaraw minnu bɛ yen i ka yɔrɔ la flɛ, i ka i ɲini joona, ka i ka kandidatiw ɲɛnabɔ yan.',
  allCategories: 'Baara suguw bɛɛ',
  allStatuses: 'Statut bɛɛ',
  loadingMore: 'A bɛ na…',
  loadMore: 'Baaraw wɛrɛw jira',
  noApplicationsYet: 'I ma kandidati kɛ fɔlɔ.',
  retry: 'Ɲinɛ kokura',
  loadErrorNetwork: 'Jɔnni tɛ. I ka reso lajɛ, ka ɲinɛ kokura.',
  loadErrorServer: 'Sɛrvɛri ma jaabi. Ɲinɛ kokura joona.',
  emptyFiltered: 'Baara si ma zɛn ni filtiri ninw ye.',
  clearFilters: 'Filtiriw bɔ',
  emptyHint: 'I ka ɲinini yaala, walima i ka segin kɔfɛ.',
  resultsOne: 'Baara kelen bɛ i ka ɲinini kan',
  resultsMany: 'Baaraw {count} bɛ i ka ɲinini kan',
  sortLabel: 'Ka ɲɛnabɔ ni',
  sortRecent: 'Kuraw',
  sortBudget: 'Wari caya',
  sortDistance: 'Ka kɛ surun',
  premierArrivantsTitle: 'Baara sɔrɔ fɔlɔ',
  premierArrivantsLead: 'Baara si tɛ yen sisan. Baara bila, baara kuraw sɔrɔ email la, walima sɛbɛn an ma WhatsApp kan.',
  premierArrivantsWatch: 'Baara sɔrɔ email la',
  premierArrivantsWhatsApp: 'Sɛbɛn WhatsApp kan',
  jobAlertReservedTitle: 'Kumaseliw yɛ baarakɛlaw kama',
  jobAlertReservedLead:
    'Kumaseli bɛ email ci baaraw minnu bɛ zɛn ni i ka laɲiniw. Kiliyan konto kan, a bɛna i segin i yɛrɛ ka katalɔgi la — o de kɔsɔn a bɛ daminɛ baarakɛla konto kan. Ni i bɛ baara bila, baarakɛlaw minnu bɛ kumaseli, olu de bɛ kibarɔ.',
  jobAlertReservedAction: 'Baara bila'
});
dict.mos = withBase(dict.fr, {
  searchPlaceholder: 'Yʋʋr bɩ goama...',
  tabDiscover: 'Gese',
  tabApplications: 'M kandidat-rãmbã',
  tabMissions: 'M tʋʋm-rãmbã',
  myMissions: 'M tʋʋm-rãmbã',
  availableJobs: 'Tʋʋm sẽn be',
  intro:
    'Kẽnga pʋgẽ y na n yã tʋʋm fãa sẽn yi Kojo zugu : ges-y tʋʋm sẽn be f zĩigẽ, tʋm-y f sokrã taoore, la pʋg-y f kandidat-rãmbã zĩig a yembr.',
  allCategories: 'Tʋʋm buud fãa',
  allStatuses: 'Statut fãa',
  loadingMore: 'A wa n waa…',
  loadMore: 'Leb n ges tʋʋm a taab',
  noApplicationsYet: 'F kandidat ka be ye.',
  retry: 'Leb n lʋɩ',
  loadErrorNetwork: 'Internet ka be ye. Ges-y f reso wã la lebs n lʋɩ.',
  loadErrorServer: 'Sɛrvɛɛr wã ka leok ye. Leb n lʋɩ bilf.',
  emptyFiltered: 'Tʋʋm ka zems ne filtre-rãmbã ye.',
  clearFilters: 'Yiis-y filtre-rãmbã',
  emptyHint: 'Yals-y f baoobã walla lebs-y n wa sʋka.',
  resultsOne: 'Tʋʋm a yembr zemsa ne f baoobã',
  resultsMany: 'Tʋʋm {count} zemsa ne f baoobã',
  sortLabel: 'Pɩk-y ne',
  sortRecent: 'Paal-rãmbã',
  sortBudget: 'Ligdi sẽn yɩɩdga',
  sortDistance: 'Sẽn surga',
  premierArrivantsTitle: 'Paam tʋʋm pipi',
  premierArrivantsLead: 'Tʋʋm ka be nɑɑ. Ning-y yãmb tʋʋmã, paam-y tʋʋm paal email la, walla gʋls-y tõnd WhatsApp zugu.',
  premierArrivantsWatch: 'Paam tʋʋm email la',
  premierArrivantsWhatsApp: 'Gʋls WhatsApp zugu',
  jobAlertReservedTitle: 'Kibare-rãmbã yaa tʋʋm-nedba yĩnga',
  jobAlertReservedLead:
    'Kibarã tʋʋmda email la ne tʋʋm sẽn zems ne f sẽkã. Kiliyan konto zugu, a na n lebsa foom katalɔg ning f yɛrã sẽn ninge — rẽ n so tɩ b tʋʋmd a ne tʋʋm-neda konto. F sã n ning tʋʋm, yaa tʋʋm-nedba sẽn tar kibar la b na n toge.',
  jobAlertReservedAction: 'Ning-y tʋʋm'
});

export const makeScopedTranslator = (currentLanguage, fallbackT) =>
  createScopedTranslator(dict, currentLanguage, fallbackT);
