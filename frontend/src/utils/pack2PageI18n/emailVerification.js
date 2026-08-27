// Auto-généré depuis pack2PageI18n.js — dictionnaire du scope 'emailVerification'.
import { createScopedTranslator } from './core';
const withBase = (base, overrides) => ({ ...base, ...overrides });
const dict = {
fr: {
  redirecting: 'Préparation de la vérification email...',
  title: 'Vérification Gmail de votre compte',
  subtitle: 'On confirme d’abord ton email, puis on passe aux moyens de paiement.',
  sentTo: 'Code envoyé à {email}',
  otpLabel: 'Code à 6 chiffres',
  otpHelp: 'Entre le code reçu dans Gmail. Il expire rapidement pour protéger ton compte.',
  sendInProgress: 'Envoi du code Gmail...',
  resend: 'Renvoyer le code',
  resendIn: 'Nouveau code dans {time}',
  expiresIn: 'Code valable encore {time}',
  verifyButton: 'Vérifier mon email',
  verifying: 'Vérification du code...',
  invalidOtpLength: 'Entre le code complet à 6 chiffres.',
  backToPayments: '← Retour aux comptes de paiement',
  backToRegister: 'Changer l\'email / revenir à l\'inscription',
  securityTitle: 'Sécurité email KOJO',
  security1: '• Un seul code actif par email',
  security2: '• Expiration automatique et tentative limitée',
  security3: '• Le code n\'est jamais stocké en clair côté backend',
  genericError: 'Impossible de terminer la vérification email.',
  codeSentToast: 'Code Gmail envoyé ✅',
  codeResentToast: 'Nouveau code Gmail envoyé ✅',
  emailVerified: 'Email vérifié. Passage aux moyens de paiement...',
  welcomeToast: 'Bienvenue {firstName} ! Ton email et tes paiements sont validés 🎉',
  dashboardMessage: 'Bienvenue {firstName} ! Email confirmé et {count} moyen(s) de paiement validé(s).',
  stepPersonal: 'Informations personnelles',
  stepPayments: 'Comptes de paiement',
  stepEmail: 'Vérification email',
  duplicateEmailError: 'Cette adresse email est déjà utilisée'
},
en: {
  redirecting: 'Preparing email verification...',
  title: 'Gmail verification for your account',
  subtitle: 'We verify your email first, then move to payment methods.',
  sentTo: 'Code sent to {email}',
  otpLabel: '6-digit code',
  otpHelp: 'Enter the code received in Gmail. It expires quickly to protect your account.',
  sendInProgress: 'Sending Gmail code...',
  resend: 'Resend code',
  resendIn: 'New code in {time}',
  expiresIn: 'Code valid for {time}',
  verifyButton: 'Verify my email',
  verifying: 'Verifying code...',
  invalidOtpLength: 'Enter the full 6-digit code.',
  backToPayments: '← Back to payment accounts',
  backToRegister: 'Change email / back to registration',
  securityTitle: 'KOJO email security',
  security1: '• Only one active code per email',
  security2: '• Automatic expiry and limited attempts',
  security3: '• The code is never stored in plain text on the backend',
  genericError: 'Unable to complete email verification.',
  codeSentToast: 'Gmail code sent ✅',
  codeResentToast: 'New Gmail code sent ✅',
  emailVerified: 'Email verified. Moving to payment methods...',
  welcomeToast: 'Welcome {firstName}! Your email and payment setup are validated 🎉',
  dashboardMessage: 'Welcome {firstName}! Email confirmed and {count} payment method(s) validated.',
  stepPersonal: 'Personal information',
  stepPayments: 'Payment accounts',
  stepEmail: 'Email verification',
  duplicateEmailError: 'This email address is already in use'
}
};
dict.wo = withBase(dict.fr, {
title: 'Gmail saytu konto bi',
  subtitle: 'Nu ngi jeexal bind gi ba noppi bala dashboard bi ubbeeku.',
  otpLabel: 'Code bu 6 chiffres',
  verifyButton: 'Saytu te sos sama konto',
  verifying: 'Mi ngi saytu code bi te sos konto bi...',
  backToPayments: '← Dellu ci kontu pey yi',
  stepEmail: 'Saytu email',
  duplicateEmailError: 'Adresse email bii jëfandikoo nañu ko ba noppi'
});
dict.bm = withBase(dict.fr, {
title: 'Gmail lakɔlɔsili i ka konto ye',
  subtitle: 'An bɛ inscription laban ka dashboard da yɔrɔ la ka dafa.',
  otpLabel: 'Chiffre 6 code',
  verifyButton: "A y'a lakɔlɔsi k'a ka konto da",
  verifying: 'Bɛ code lakɔlɔsi ni konto dafalen...',
  backToPayments: '← Segin ka taa sara kontow la',
  stepEmail: 'Email lakɔlɔsili',
  duplicateEmailError: 'Email adɛrɛsi nin bɛ baara kɛ ka bɔyen'
});
dict.mos = withBase(dict.fr, {
title: 'Gmail pʋgẽ konto wã gesgo',
  subtitle: 'D bɛ pid bindgre wã n da dashboard wã yẽ.',
  otpLabel: 'Code 6 chiffres',
  verifyButton: 'Gesgo n na ninge m konto',
  verifying: 'A gese code wã la a ninge konto wã...',
  backToPayments: '← Lebg n kẽ yaool konto-rãmba',
  stepEmail: 'Email gesgo',
  duplicateEmailError: 'Email adres-kãngã yaa n beoogame'
});

export const makeScopedTranslator = (currentLanguage, fallbackT) =>
  createScopedTranslator(dict, currentLanguage, fallbackT);
