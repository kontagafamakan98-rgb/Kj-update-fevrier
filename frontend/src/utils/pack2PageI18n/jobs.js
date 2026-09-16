// Auto-généré depuis pack2PageI18n.js — dictionnaire du scope 'jobs'.
import { createScopedTranslator } from './core';
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
  noApplicationsYet: 'Vous n\'avez pas encore postulé à une mission.'
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
  noApplicationsYet: 'You have not applied to a job yet.'
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
