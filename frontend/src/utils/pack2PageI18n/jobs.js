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
  allCategories: 'Toutes les catégories',
  allStatuses: 'Tous les statuts',
  loadingMore: 'Chargement…',
  loadMore: 'Afficher plus de missions',
  noApplicationsYet: 'Vous n\'avez pas encore postulé à une mission.',
  // États d'échec et de liste vide : chacun dit quoi faire ensuite (l'écran
  // ne laisse plus une liste vide passer pour une panne, ni l'inverse).
  retry: 'Réessayer',
  loadErrorNetwork: 'Pas de connexion. Vérifiez votre réseau, puis réessayez.',
  loadErrorServer: 'Le serveur n\'a pas répondu. Réessayez dans un instant.',
  emptyFiltered: 'Aucune mission ne correspond à ces filtres.',
  clearFilters: 'Effacer les filtres',
  emptyHint: 'Élargissez votre recherche ou revenez plus tard.'
},
en: {
  searchPlaceholder: 'Title or description...',
  tabDiscover: 'Discover',
  tabApplications: 'My applications',
  tabMissions: 'My jobs',
  myMissions: 'My jobs',
  availableJobs: 'Available jobs',
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
  emptyHint: 'Widen your search or come back later.'
}
};
dict.wo = withBase(dict.fr, {  searchPlaceholder: 'Tur walla melokaan...'
});
dict.bm = withBase(dict.fr, {  searchPlaceholder: 'Tɔgɔ walima fɔli...'
});
dict.mos = withBase(dict.fr, {  searchPlaceholder: 'Yʋʋr bɩ goama...'
});

export const makeScopedTranslator = (currentLanguage, fallbackT) =>
  createScopedTranslator(dict, currentLanguage, fallbackT);
