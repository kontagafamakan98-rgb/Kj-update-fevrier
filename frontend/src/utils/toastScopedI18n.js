/**
 * Dictionnaires i18n des toasts scoped — version LÉGÈRE dédiée au shell.
 *
 * Pourquoi ce fichier existe : `pack2PageI18n.js` embarque les dictionnaires
 * de TOUTES les pages (~68 kB) et `makeScopedTranslator` y accède via
 * `pages[scope]` (accès dynamique → le tree-shaking ne peut rien retirer).
 * `ToastContainer` (rendu dans le shell, donc dans le chunk initial) n'utilise
 * que 2 scopes de toasts (~7 kB) : le gros module alourdissait inutilement le
 * bundle initial de ~60 kB.
 *
 * Les pages restent sur `pack2PageI18n.js` (leurs dictionnaires sont dans des
 * chunks lazy, donc hors du chemin critique). Ce fichier ne contient QUE les
 * scopes consommés par les toasts : register, emailVerification et
 * paymentVerification.
 *
 * ── POURQUOI `register` EST ICI (23/10/2026) ────────────────────────────────
 * Il en était ABSENT, avec le raisonnement « scope inconnu → t(key) ». Or
 * `duplicateEmailError` n'existe PAS dans les dictionnaires globaux
 * (`src/i18n/*.json`) : il ne vit que dans le pack de la page
 * (`pack2PageI18n/register.js`). Le toast d'une adresse déjà prise affichait
 * donc la CLÉ, littéralement « duplicateEmailError », au lieu de la phrase —
 * mesuré en production sur le parcours d'inscription. Un scope consommé par un
 * toast doit être déclaré ICI, dans les cinq langues : une clé qui n'existe
 * qu'à un seul endroit ne peut pas être servie par le fallback.
 *
 * Garde : `src/utils/__tests__/toastScopedI18n.test.js` exige que CHAQUE clé de
 * CHAQUE scope soit servie dans les cinq langues, et que le résultat ne soit
 * jamais la clé elle-même.
 */

export const toastScopes = {
  register: {
    fr: {
      duplicateEmailError: 'Cette adresse email est déjà utilisée',
    },
    en: {
      duplicateEmailError: 'This email address is already in use',
    },
    wo: {
      duplicateEmailError: 'Adresse email bii jëfandikoo nañu ko ba noppi',
    },
    bm: {
      duplicateEmailError: 'Email adɛrɛsi nin bɛ baara kɛ ka bɔyen',
    },
    mos: {
      duplicateEmailError: 'Email adres-kãngã yaa n beoogame',
    },
  },
  paymentVerification: {
    fr: {
      welcomeToast: 'Bienvenue {firstName} ! Compte vérifié avec succès',
      dashboardMessage: 'Bienvenue {firstName} ! Votre compte est vérifié avec {count} moyen(s) de paiement.',
      referralAppliedToast: 'Code de parrainage appliqué avec succès !',
      referralAppliedWithBonusToast: 'Code de parrainage appliqué ! +{amount} FCFA de bonus de bienvenue crédités.',
      duplicateEmailError: 'Cette adresse email est déjà utilisée',
      step3DoneToast: 'Étape 3 terminée avec succès.',
      dashboardReadyMessage: 'Configuration des paiements terminée. Votre compte est maintenant prêt.',
      genericError: 'Erreur lors de la finalisation du compte',
      autoLoginError: 'Erreur lors de la connexion automatique',
    },
    en: {
      welcomeToast: 'Welcome {firstName}! Account verified successfully',
      dashboardMessage: 'Welcome {firstName}! Your account is verified with {count} payment method(s).',
      referralAppliedToast: 'Referral code applied successfully!',
      referralAppliedWithBonusToast: 'Referral code applied! +{amount} FCFA welcome bonus credited.',
      duplicateEmailError: 'This email address is already in use',
      step3DoneToast: 'Step 3 completed successfully.',
      dashboardReadyMessage: 'Payment setup complete. Your account is now ready.',
      genericError: 'Error while finalizing the account',
      autoLoginError: 'Error during automatic login',
    },
  },
  emailVerification: {
    fr: {
      codeSentToast: 'Code Gmail envoyé',
      codeResentToast: 'Nouveau code Gmail envoyé',
      emailVerified: 'Email vérifié. Passage aux moyens de paiement...',
      welcomeToast: 'Bienvenue {firstName} ! Ton email et tes paiements sont validés',
      dashboardMessage: 'Bienvenue {firstName} ! Email confirmé et {count} moyen(s) de paiement validé(s).',
      duplicateEmailError: 'Cette adresse email est déjà utilisée',
      genericError: 'Impossible de terminer la vérification email.',
    },
    en: {
      codeSentToast: 'Gmail code sent',
      codeResentToast: 'New Gmail code sent',
      emailVerified: 'Email verified. Moving to payment methods...',
      welcomeToast: 'Welcome {firstName}! Your email and payment setup are validated',
      dashboardMessage: 'Welcome {firstName}! Email confirmed and {count} payment method(s) validated.',
      duplicateEmailError: 'This email address is already in use',
      genericError: 'Unable to complete email verification.',
    },
  },
};

const interpolate = (value, vars = {}) =>
  value.replace(/\{(\w+)\}/g, (_, name) => {
    const replacement = vars[name];
    return replacement === undefined || replacement === null ? '' : String(replacement);
  });

/**
 * Traducteur de toast scoped, sans la chaîne de fallback fr/en du gros module
 * (les clés toast existent dans les deux langues ici ; en cas d'absence on
 * retombe sur fallbackT, comme makeScopedTranslator de pack2PageI18n).
 */
export const makeToastTranslator = (currentLanguage, fallbackT, scope) => {
  const section = toastScopes[scope] || {};
  const primary = section[currentLanguage] || {};
  const englishFallback = section.en || {};

  return (key, vars = {}) => {
    let value =
      primary[key] ??
      englishFallback[key] ??
      (typeof fallbackT === 'function' ? fallbackT(key) : key);
    return typeof value === 'string' ? interpolate(value, vars) : (value ?? key);
  };
};
