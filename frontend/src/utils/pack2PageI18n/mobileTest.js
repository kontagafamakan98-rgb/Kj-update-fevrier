// Auto-généré depuis pack2PageI18n.js — dictionnaire du scope 'mobileTest'.
import { createScopedTranslator } from './core';
const withBase = (base, overrides) => ({ ...base, ...overrides });
const dict = {
fr: {
  backToDashboard: 'Retour au tableau de bord',
  title: 'Test mobile Kojo',
  appInfo: '📱 Informations sur l\'application mobile',
  featuresImplemented: '✅ Fonctionnalités implémentées',
  screensIntegrated: '📱 Écrans intégrés',
  testOnMobile: '🚀 Pour tester sur mobile',
  troubleshooting: '🔧 Dépannage',
  feat1: '• Service de gestion d\'images complet (ImageService)',
  feat2: '• Composant ProfilePhoto réutilisable',
  feat3: '• Intégration expo-image-picker pour caméra/galerie',
  feat4: '• Validation et compression d\'images',
  feat5: '• Sauvegarde locale avec AsyncStorage',
  feat6: '• Upload simulé vers serveur',
  feat7: '• Gestion des permissions natives',
  screen1: '• ProfileScreen - Édition de photo avec boutons caméra',
  screen2: '• EditProfileScreen - Formulaire avec photo intégrée',
  screen3: '• DashboardScreen - Photo dans l\'en-tête',
  screen4: '• WorkerProfileScreen - Affichage photos des travailleurs',
  screen5: '• CameraScreen - Interface caméra native',
  step1: '1. Installer Expo Go sur votre téléphone (Android/iOS)',
  step2: '2. Démarrer l\'app mobile',
  step3: '3. Scanner le QR code avec Expo Go',
  step4: '4. Tester les photos dans Profil > Modifier photo',
  help1: '• Vérifier que l\'app mobile React Native fonctionne',
  help2: '• S\'assurer d\'avoir les permissions caméra/galerie',
  help3: '• Tester sur un vrai téléphone (pas navigateur)',
  help4: '• Vérifier la connexion Expo Go'
},
en: {
  backToDashboard: 'Back to dashboard',
  title: 'Kojo mobile test',
  appInfo: '📱 Mobile app information',
  featuresImplemented: '✅ Implemented features',
  screensIntegrated: '📱 Integrated screens',
  testOnMobile: '🚀 To test on mobile',
  troubleshooting: '🔧 Troubleshooting',
  feat1: '• Complete image management service (ImageService)',
  feat2: '• Reusable ProfilePhoto component',
  feat3: '• expo-image-picker integration for camera/gallery',
  feat4: '• Image validation and compression',
  feat5: '• Local save with AsyncStorage',
  feat6: '• Simulated upload to server',
  feat7: '• Native permissions handling',
  screen1: '• ProfileScreen - Photo editing with camera buttons',
  screen2: '• EditProfileScreen - Form with integrated photo',
  screen3: '• DashboardScreen - Photo in the header',
  screen4: '• WorkerProfileScreen - Worker photo display',
  screen5: '• CameraScreen - Native camera interface',
  step1: '1. Install Expo Go on your phone (Android/iOS)',
  step2: '2. Start the mobile app',
  step3: '3. Scan the QR code with Expo Go',
  step4: '4. Test photos in Profile > Edit photo',
  help1: '• Check that the React Native mobile app is running',
  help2: '• Make sure camera/gallery permissions are granted',
  help3: '• Test on a real phone (not a browser)',
  help4: '• Check the Expo Go connection'
}
};
dict.wo = withBase(dict.fr, {
backToDashboard: 'Dellu ci dashboard',
  title: 'Test mobile Kojo',
  appInfo: '📱 Xibaar ci app mobile bi',
  featuresImplemented: '✅ Fonkisiyon yu sampu',
  screensIntegrated: '📱 Ekran yi dugal nañu leen',
  testOnMobile: '🚀 Ngir test ci mobile',
  troubleshooting: '🔧 Defar njuumte'
});
dict.bm = withBase(dict.fr, {
backToDashboard: 'Segin ka taa dashboard la',
  title: 'Kojo mobile test',
  appInfo: '📱 Mobile app kibaru',
  featuresImplemented: '✅ Fɛɛrɛw minnu dafalen',
  screensIntegrated: '📱 Écran minnu don',
  testOnMobile: '🚀 Ka test kɛ mobile kan',
  troubleshooting: '🔧 Dɛpannage'
});
dict.mos = withBase(dict.fr, {
backToDashboard: 'Lebg n kẽ dashboard',
  title: 'Kojo mobile test',
  appInfo: '📱 Mobile app kibare',
  featuresImplemented: '✅ Noy sẽn ninge',
  screensIntegrated: '📱 Écran sẽn paase',
  testOnMobile: '🚀 N ges mobile pʋgẽ',
  troubleshooting: '🔧 Songre'
});

export const makeScopedTranslator = (currentLanguage, fallbackT) =>
  createScopedTranslator(dict, currentLanguage, fallbackT);
