// Auto-généré depuis pack2PageI18n.js — dictionnaire du scope 'emailVerification'.
import { createScopedTranslator } from './core.js';
const withBase = (base, overrides) => ({ ...base, ...overrides });
const dict = {
fr: {
  redirecting: 'Préparation de la vérification email...',
  title: 'Vérification Gmail de votre compte',
  subtitle: 'On confirme ton email, et ton compte est créé dans la foulée.',
  sentTo: 'Code envoyé à {email}',
  otpLabel: 'Code à 6 chiffres',
  otpHelp: 'Entre le code reçu dans Gmail. Il expire rapidement pour protéger ton compte.',
  sendInProgress: 'Envoi du code Gmail...',
  resend: 'Renvoyer le code',
  resendIn: 'Nouveau code dans {time}',
  expiresIn: 'Code valable encore {time}',
  verifyButton: 'Vérifier mon email',
  verifying: 'Création de ton compte...',
  invalidOtpLength: 'Entre le code complet à 6 chiffres.',
  backToRegister: 'Changer l’email / revenir à l’inscription',
  securityTitle: 'Sécurité email KOJO',
  security1: '• Un seul code actif par email',
  security2: '• Expiration automatique et tentative limitée',
  security3: '• Le code n’est jamais stocké en clair côté backend',
  genericError: 'Impossible de terminer la vérification email.',
  codeSentToast: 'Code Gmail envoyé',
  codeResentToast: 'Nouveau code Gmail envoyé',
  autoLoginError: 'Erreur lors de la connexion automatique',
  welcomeToast: 'Bienvenue {firstName} ! Ton compte est créé',
  dashboardMessage: 'Bienvenue {firstName} ! Ton compte est créé. Ajoute un compte de paiement quand tu veux être payé.',
  referralAppliedToast: 'Code de parrainage appliqué avec succès !',
  referralAppliedWithBonusToast: 'Code de parrainage appliqué ! +{amount} FCFA de bonus de bienvenue crédités.',
  stepPersonal: 'Informations personnelles',
  stepEmail: 'Vérification email',
  stepDone: 'Compte créé',
  duplicateEmailError: 'Cette adresse email est déjà utilisée'
},
en: {
  redirecting: 'Preparing email verification...',
  title: 'Gmail verification for your account',
  subtitle: 'We verify your email, and your account is created right away.',
  sentTo: 'Code sent to {email}',
  otpLabel: '6-digit code',
  otpHelp: 'Enter the code received in Gmail. It expires quickly to protect your account.',
  sendInProgress: 'Sending Gmail code...',
  resend: 'Resend code',
  resendIn: 'New code in {time}',
  expiresIn: 'Code valid for {time}',
  verifyButton: 'Verify my email',
  verifying: 'Creating your account...',
  invalidOtpLength: 'Enter the full 6-digit code.',
  backToRegister: 'Change email / back to registration',
  securityTitle: 'KOJO email security',
  security1: '• Only one active code per email',
  security2: '• Automatic expiry and limited attempts',
  security3: '• The code is never stored in plain text on the backend',
  genericError: 'Unable to complete email verification.',
  codeSentToast: 'Gmail code sent',
  codeResentToast: 'New Gmail code sent',
  autoLoginError: 'Error during automatic login',
  welcomeToast: 'Welcome {firstName}! Your account is created',
  dashboardMessage: 'Welcome {firstName}! Your account is created. Add a payment account whenever you want to get paid.',
  referralAppliedToast: 'Referral code applied successfully!',
  referralAppliedWithBonusToast: 'Referral code applied! +{amount} FCFA welcome bonus credited.',
  stepPersonal: 'Personal information',
  stepEmail: 'Email verification',
  stepDone: 'Account created',
  duplicateEmailError: 'This email address is already in use'
}
};
dict.wo = withBase(dict.fr, {
title: 'Gmail saytu konto bi',
  subtitle: 'Nu ngi jeexal bind gi ba noppi bala dashboard bi ubbeeku.',
  otpLabel: 'Code bu 6 chiffres',
  verifyButton: 'Saytu te sos sama konto',
  verifying: 'Mi ngi sos sa konto...',
  stepEmail: 'Saytu email',
  duplicateEmailError: 'Adresse email bii jëfandikoo nañu ko ba noppi'
});
dict.bm = withBase(dict.fr, {
title: 'Gmail lakɔlɔsili i ka konto ye',
  subtitle: 'An bɛ inscription laban ka dashboard da yɔrɔ la ka dafa.',
  otpLabel: 'Chiffre 6 code',
  verifyButton: "A y’a lakɔlɔsi k’a ka konto da",
  verifying: 'Bɛ konto da...',
  stepEmail: 'Email lakɔlɔsili',
  duplicateEmailError: 'Email adɛrɛsi nin bɛ baara kɛ ka bɔyen'
});
dict.mos = withBase(dict.fr, {
title: 'Gmail pʋgẽ konto wã gesgo',
  subtitle: 'D bɛ pid bindgre wã n da dashboard wã yẽ.',
  otpLabel: 'Code 6 chiffres',
  verifyButton: 'Gesgo n na ninge m konto',
  verifying: 'A gese code wã la a ninge konto wã...',
  stepEmail: 'Email gesgo',
  duplicateEmailError: 'Email adres-kãngã yaa n beoogame'
});

export const makeScopedTranslator = (currentLanguage, fallbackT) =>
  createScopedTranslator(dict, currentLanguage, fallbackT);
