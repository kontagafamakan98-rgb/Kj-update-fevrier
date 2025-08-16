import React from 'react';
import { Link } from 'react-router-dom';
import MobilePhotoTest from '../components/MobilePhotoTest';

export default function MobileTest() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-orange-600 text-white p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link to="/dashboard" className="flex items-center space-x-2">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
              <span>Retour au Dashboard</span>
            </Link>
          </div>
          <h1 className="text-xl font-bold">Test Mobile Kojo</h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto py-8">
        <MobilePhotoTest />
        
        {/* Info Section */}
        <div className="mt-12 bg-white rounded-lg shadow-md p-6">
          <h2 className="text-2xl font-bold text-orange-600 mb-4">
            📱 Information sur l'Application Mobile
          </h2>
          
          <div className="space-y-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="font-semibold text-blue-800 mb-2">✅ Fonctionnalités Implémentées</h3>
              <ul className="text-blue-700 space-y-1">
                <li>• Service de gestion d'images complet (ImageService)</li>
                <li>• Composant ProfilePhoto réutilisable</li>
                <li>• Intégration expo-image-picker pour caméra/galerie</li>
                <li>• Validation et compression d'images</li>
                <li>• Sauvegarde locale avec AsyncStorage</li>
                <li>• Upload simulé vers serveur</li>
                <li>• Gestion des permissions natives</li>
              </ul>
            </div>

            <div className="bg-green-50 p-4 rounded-lg">
              <h3 className="font-semibold text-green-800 mb-2">📱 Écrans Intégrés</h3>
              <ul className="text-green-700 space-y-1">
                <li>• ProfileScreen - Édition de photo avec boutons caméra</li>
                <li>• EditProfileScreen - Formulaire avec photo intégrée</li>
                <li>• DashboardScreen - Photo dans l'en-tête</li>
                <li>• WorkerProfileScreen - Affichage photos des travailleurs</li>
                <li>• CameraScreen - Interface caméra native</li>
              </ul>
            </div>

            <div className="bg-orange-50 p-4 rounded-lg">
              <h3 className="font-semibold text-orange-800 mb-2">🚀 Pour Tester sur Mobile</h3>
              <div className="text-orange-700 space-y-2">
                <p><strong>1. Installer Expo Go</strong> sur votre téléphone (Android/iOS)</p>
                <p><strong>2. Démarrer l'app mobile :</strong></p>
                <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                  cd /app/KojoMobile_FINAL && npx expo start
                </code>
                <p><strong>3. Scanner le QR code</strong> avec Expo Go</p>
                <p><strong>4. Tester les photos</strong> dans Profil > Modifier photo</p>
              </div>
            </div>

            <div className="bg-purple-50 p-4 rounded-lg">
              <h3 className="font-semibold text-purple-800 mb-2">🔧 Dépannage</h3>
              <ul className="text-purple-700 space-y-1">
                <li>• Vérifier que l'app mobile React Native fonctionne</li>
                <li>• S'assurer d'avoir les permissions caméra/galerie</li>
                <li>• Tester sur un vrai téléphone (pas navigateur)</li>
                <li>• Vérifier la connexion Expo Go</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}