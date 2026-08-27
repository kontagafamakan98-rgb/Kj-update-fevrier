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
 * scopes consommés par les toasts : emailVerification et paymentVerification.
 * Le scope 'register' n'existe pas dans `pages` (il retombe déjà sur le
 * fallback global t()) — on garde ce comportement : scope inconnu → t(key).
 */

const toastScopes = {
  paymentVerification: {
    fr: {
      welcomeToast: 'Bienvenue {firstName} ! Compte vérifié avec succès 🎉',
      dashboardMessage: 'Bienvenue {firstName} ! Votre compte est vérifié avec {count} moyen(s) de paiement.',
      referralAppliedToast: '🎁 Code de parrainage appliqué avec succès !',
      referralAppliedWithBonusToast: '🎁 Code de parrainage appliqué ! +{amount} FCFA de bonus de bienvenue crédités.',
      duplicateEmailError: 'Cette adresse email est déjà utilisée',
      step3DoneToast: 'Étape 3 terminée avec succès.',
      dashboardReadyMessage: 'Configuration des paiements terminée. Votre compte est maintenant prêt.',
      genericError: 'Erreur lors de la finalisation du compte',
      autoLoginError: 'Erreur lors de la connexion automatique',
    },
    en: {
      welcomeToast: 'Welcome {firstName}! Account verified successfully 🎉',
      dashboardMessage: 'Welcome {firstName}! Your account is verified with {count} payment method(s).',
      referralAppliedToast: '🎁 Referral code applied successfully!',
      referralAppliedWithBonusToast: '🎁 Referral code applied! +{amount} FCFA welcome bonus credited.',
      duplicateEmailError: 'This email address is already in use',
      step3DoneToast: 'Step 3 completed successfully.',
      dashboardReadyMessage: 'Payment setup complete. Your account is now ready.',
      genericError: 'Error while finalizing the account',
      autoLoginError: 'Error during automatic login',
    },
  },
  emailVerification: {
    fr: {
      codeSentToast: 'Code Gmail envoyé ✅',
      codeResentToast: 'Nouveau code Gmail envoyé ✅',
      emailVerified: 'Email vérifié. Passage aux moyens de paiement...',
      welcomeToast: 'Bienvenue {firstName} ! Ton email et tes paiements sont validés 🎉',
      dashboardMessage: 'Bienvenue {firstName} ! Email confirmé et {count} moyen(s) de paiement validé(s).',
      duplicateEmailError: 'Cette adresse email est déjà utilisée',
      genericError: 'Impossible de terminer la vérification email.',
    },
    en: {
      codeSentToast: 'Gmail code sent ✅',
      codeResentToast: 'New Gmail code sent ✅',
      emailVerified: 'Email verified. Moving to payment methods...',
      welcomeToast: 'Welcome {firstName}! Your email and payment setup are validated 🎉',
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
