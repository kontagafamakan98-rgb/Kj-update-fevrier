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
dict.wo = withBase(dict.fr, {  searchPlaceholder: 'Tur walla melokaan...',
  premierArrivantsTitle: 'Jot liggéey yi njëkk',
  premierArrivantsLead: 'Amul liggéey bu ubbeeku tey. Feesal sa liggéey, jot yu bees ci email, walla bind nu ci WhatsApp.',
  premierArrivantsWatch: 'Jot liggéey yi ci email',
  premierArrivantsWhatsApp: 'Bind ci WhatsApp'
});
dict.bm = withBase(dict.fr, {  searchPlaceholder: 'Tɔgɔ walima fɔli...',
  premierArrivantsTitle: 'Baara sɔrɔ fɔlɔ',
  premierArrivantsLead: 'Baara si tɛ yen sisan. Baara bila, baara kuraw sɔrɔ email la, walima sɛbɛn an ma WhatsApp kan.',
  premierArrivantsWatch: 'Baara sɔrɔ email la',
  premierArrivantsWhatsApp: 'Sɛbɛn WhatsApp kan'
});
dict.mos = withBase(dict.fr, {  searchPlaceholder: 'Yʋʋr bɩ goama...',
  premierArrivantsTitle: 'Paam tʋʋm pipi',
  premierArrivantsLead: 'Tʋʋm ka be nɑɑ. Ning-y yãmb tʋʋmã, paam-y tʋʋm paal email la, walla gʋls-y tõnd WhatsApp zugu.',
  premierArrivantsWatch: 'Paam tʋʋm email la',
  premierArrivantsWhatsApp: 'Gʋls WhatsApp zugu'
});

export const makeScopedTranslator = (currentLanguage, fallbackT) =>
  createScopedTranslator(dict, currentLanguage, fallbackT);
