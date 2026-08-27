// Auto-généré depuis pack2PageI18n.js — dictionnaire du scope 'photoTest'.
import { createScopedTranslator } from './core';
const withBase = (base, overrides) => ({ ...base, ...overrides });
const dict = {
fr: {
  title: '🧪 Test photo de profil',
  subtitle: 'Page de debug pour tester le système de photos',
  userInfo: 'Informations utilisateur',
  photoComponent: 'Test du composant photo',
  editableMode: 'Mode éditable',
  clickToEdit: 'Cliquez pour modifier',
  readMode: 'Mode lecture',
  readOnly: 'Lecture seule',
  smallFormat: 'Petit format',
  manualTests: 'Tests manuels',
  directFileTest: 'Test sélection fichier direct',
  addLog: 'Ajouter log test',
  clearLogs: 'Vider logs',
  testLogs: 'Logs de test',
  entriesCount: '{count} entrée(s)',
  browserInfo: 'Informations navigateur',
  userAgent: 'User Agent',
  fileApi: 'Support File API',
  canvas: 'Support Canvas',
  localStorage: 'Support LocalStorage',
  supported: '✅ Supporté',
  unsupported: '❌ Non supporté',
  noFileSelected: 'Aucun fichier sélectionné',
  fileInputTesting: 'Test de sélection manuelle de fichier...',
  manualLogEntry: 'Entrée de log manuelle'
},
en: {
  title: '🧪 Profile photo test',
  subtitle: 'Debug page to test the photo system',
  userInfo: 'User information',
  photoComponent: 'Photo component test',
  editableMode: 'Editable mode',
  clickToEdit: 'Click to edit',
  readMode: 'Read mode',
  readOnly: 'Read only',
  smallFormat: 'Small format',
  manualTests: 'Manual tests',
  directFileTest: 'Direct file selection test',
  addLog: 'Add test log',
  clearLogs: 'Clear logs',
  testLogs: 'Test logs',
  entriesCount: '{count} entry(ies)',
  browserInfo: 'Browser information',
  userAgent: 'User Agent',
  fileApi: 'File API support',
  canvas: 'Canvas support',
  localStorage: 'LocalStorage support',
  supported: '✅ Supported',
  unsupported: '❌ Not supported',
  noFileSelected: 'No file selected',
  fileInputTesting: 'Testing manual file input...',
  manualLogEntry: 'Manual log entry'
}
};
dict.wo = withBase(dict.fr, {
title: '🧪 Test nataalu profil',
  subtitle: 'Xët bu debug ngir seet sistem nataal bi',
  userInfo: 'Xibaaru jëfandikookat',
  photoComponent: 'Test bu kompozaŋ nataal',
  editableMode: 'Mode soppi',
  clickToEdit: 'Bësal ngir soppi',
  readMode: 'Mode jàng',
  manualTests: 'Test yu loxo',
  directFileTest: 'Test tann fichier bu jub',
  addLog: 'Yokk log',
  clearLogs: 'Far logs yi',
  testLogs: 'Logs yu test'
});
dict.bm = withBase(dict.fr, {
title: '🧪 Profil foto test',
  subtitle: 'Debug duw ka foto system filɛ',
  userInfo: 'Baarakɛla kibaru',
  photoComponent: 'Foto composant test',
  editableMode: 'Sopili mode',
  clickToEdit: 'A digi ka soppi',
  readMode: 'Kalan mode',
  manualTests: 'Bololabolo testw',
  directFileTest: 'Fichier sugandi test',
  addLog: 'Log fara',
  clearLogs: 'Logw bɔ',
  testLogs: 'Test logw'
});
dict.mos = withBase(dict.fr, {
title: '🧪 Profil pɩture test',
  subtitle: 'Debug page n ges pɩture system',
  userInfo: 'Ned kibare',
  photoComponent: 'Pɩture composant test',
  editableMode: 'Tek mode',
  clickToEdit: 'Pɩlg n tek',
  readMode: 'Kare mode',
  manualTests: 'Lɔɔm test',
  directFileTest: 'Fichier sugri test',
  addLog: 'Paas log',
  clearLogs: 'Moa logs',
  testLogs: 'Test logs'
});

export const makeScopedTranslator = (currentLanguage, fallbackT) =>
  createScopedTranslator(dict, currentLanguage, fallbackT);
