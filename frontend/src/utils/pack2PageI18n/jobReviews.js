// Auto-généré depuis pack2PageI18n.js — dictionnaire du scope 'jobReviews'.
import { createScopedTranslator } from './core.js';
const withBase = (base, overrides) => ({ ...base, ...overrides });
const dict = {
fr: {
  title: 'Avis et notes',
  loading: 'Chargement des avis...',
  noReviews: 'Aucun avis pour le moment. Soyez le premier à noter !',
  yourRating: 'Votre note pour cette mission',
  commentPlaceholder: 'Partagez votre expérience (optionnel)...',
  submit: 'Publier mon avis',
  submitting: 'Publication...',
  success: 'Avis publié avec succès !',
  error: 'Impossible de publier l’avis',
  ratingRequired: 'Choisissez une note (1 à 5 étoiles)',
  delete: 'Supprimer',
  anonymous: 'Auteur anonyme'
},
en: {
  title: 'Reviews & ratings',
  loading: 'Loading reviews...',
  noReviews: 'No reviews yet. Be the first to rate!',
  yourRating: 'Your rating for this job',
  commentPlaceholder: 'Share your experience (optional)...',
  submit: 'Publish my review',
  submitting: 'Publishing...',
  success: 'Review published successfully!',
  error: 'Unable to publish the review',
  ratingRequired: 'Choose a rating (1 to 5 stars)',
  delete: 'Delete',
  anonymous: 'Anonymous reviewer'
}
};
dict.wo = withBase(dict.fr, {
  title: 'Avis ak nos',
  loading: 'Avis yi ngi ñu leen di yeb…',
  noReviews: 'Amul avis tey. Nga nag di ci ñeel jëmm!',
  yourRating: 'Sa nos ci liggéey bii',
  commentPlaceholder: 'Wax sa xibaar (doo ko def)…',
  submit: 'Yégle sama avis',
  submitting: 'Yégle…',
  success: 'Avis bi yégle na baax!',
  error: 'Manuñu yégle avis bi',
  ratingRequired: 'Tannal nos bu ci dig 1 ba 5 étoiles',
  delete: 'Moom',
  anonymous: 'Auteur bu ñu xamul'
});
dict.bm = withBase(dict.fr, {
  title: 'Hakɛ ni jatew',
  loading: 'Hakɛw bɛ don…',
  noReviews: 'Hakɛ si tɛ yen fɔlɔ. I ka kɛ fɔlɔ ye ka jate!',
  yourRating: 'I ka jate baara nin na',
  commentPlaceholder: 'I ka kuma fɔ (dɔɔnin)…',
  submit: 'N ka hakɛ bila',
  submitting: 'A bɛ bila…',
  success: 'Hakɛ bilalen don!',
  error: 'Hakɛ man se ka bila',
  ratingRequired: 'Jate sugandi (1 ka tɛmɛ 5 étoiles)',
  delete: 'Bɔ',
  anonymous: 'Tɔgɔ dogolen'
});
dict.mos = withBase(dict.fr, {
  title: 'Gomde la ningre',
  loading: 'Gomde n dogdi…',
  noReviews: 'Gomde ka be ye. F n yɩ sẽn na n ning f gomde!',
  yourRating: 'F ningre tʋʋmã yĩnga',
  commentPlaceholder: 'Togs f naba (bɩ f maan-a ye)…',
  submit: 'Ning m gomde',
  submitting: 'B ningr n maanda…',
  success: 'Gomde ningeme neere!',
  error: 'Gomde ka tõe n ning ye',
  ratingRequired: 'Ningre sugri (1 n tɩ tã 5)',
  delete: 'Yiis',
  anonymous: 'Yʋʋr sẽn yɩ solge'
});

export const makeScopedTranslator = (currentLanguage, fallbackT) =>
  createScopedTranslator(dict, currentLanguage, fallbackT);
