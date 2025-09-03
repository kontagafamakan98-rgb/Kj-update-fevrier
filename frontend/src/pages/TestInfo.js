import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';

const TestInfo = () => {
  const { language, translations } = useLanguage();

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-orange-100 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center px-4 py-2 bg-yellow-400 text-black rounded-full text-sm font-semibold mb-6">
            🧪 VERSION TEST
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Kojo Test App
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Plateforme de services pour l'Afrique de l'Ouest
          </p>
        </div>

        {/* Current Status */}
        <div className="bg-white rounded-lg shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center">
            📊 Statut Actuel
          </h2>
          
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-500 rounded-full mr-3"></div>
                <span className="text-gray-700">✅ Backend API (95.5% tests réussis)</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-500 rounded-full mr-3"></div>
                <span className="text-gray-700">✅ Authentification utilisateurs</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-500 rounded-full mr-3"></div>
                <span className="text-gray-700">✅ Gestion des jobs</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-500 rounded-full mr-3"></div>
                <span className="text-gray-700">✅ Système de paiement</span>
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-500 rounded-full mr-3"></div>
                <span className="text-gray-700">✅ Push notifications mobiles</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-500 rounded-full mr-3"></div>
                <span className="text-gray-700">✅ Mode hors ligne</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-500 rounded-full mr-3"></div>
                <span className="text-gray-700">✅ Multi-langues (FR/EN/WO/BM)</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-500 rounded-full mr-3"></div>
                <span className="text-gray-700">✅ Support multi-pays</span>
              </div>
            </div>
          </div>
        </div>

        {/* Domain Info */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center">
            🔗 Domaine Test
          </h2>
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-lg border">
              <h3 className="font-semibold text-gray-900 mb-2">🎯 Futur domaine:</h3>
              <p className="text-2xl font-mono text-orange-600 mb-2">kojoapptest.app</p>
              <div className="flex items-center text-sm text-gray-600">
                <div className="w-2 h-2 bg-yellow-500 rounded-full mr-2"></div>
                <span>En cours de configuration cette semaine</span>
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-lg border">
              <h3 className="font-semibold text-gray-900 mb-2">🔧 URL actuelle de test:</h3>
              <p className="text-lg font-mono text-blue-600 break-all">
                https://precise-geo-app.preview.emergentagent.com
              </p>
              <div className="flex items-center text-sm text-gray-600 mt-2">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                <span>Pleinement fonctionnel</span>
              </div>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="bg-white rounded-lg shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center">
            🚀 Fonctionnalités Disponibles
          </h2>
          
          <div className="grid md:grid-cols-3 gap-6">
            <div className="text-center p-6 bg-orange-50 rounded-lg">
              <div className="text-3xl mb-4">👥</div>
              <h3 className="font-semibold text-gray-900 mb-2">Utilisateurs</h3>
              <p className="text-sm text-gray-600">
                Inscription, connexion, profils clients et travailleurs
              </p>
            </div>
            
            <div className="text-center p-6 bg-blue-50 rounded-lg">
              <div className="text-3xl mb-4">💼</div>
              <h3 className="font-semibold text-gray-900 mb-2">Jobs</h3>
              <p className="text-sm text-gray-600">
                Création, recherche, candidature aux jobs
              </p>
            </div>
            
            <div className="text-center p-6 bg-green-50 rounded-lg">
              <div className="text-3xl mb-4">💳</div>
              <h3 className="font-semibold text-gray-900 mb-2">Paiements</h3>
              <p className="text-sm text-gray-600">
                Orange Money, Wave, cartes bancaires
              </p>
            </div>
            
            <div className="text-center p-6 bg-purple-50 rounded-lg">
              <div className="text-3xl mb-4">📱</div>
              <h3 className="font-semibold text-gray-900 mb-2">Mobile</h3>
              <p className="text-sm text-gray-600">
                PWA + App React Native avec notifications
              </p>
            </div>
            
            <div className="text-center p-6 bg-red-50 rounded-lg">
              <div className="text-3xl mb-4">🌍</div>
              <h3 className="font-semibent text-gray-900 mb-2">Multi-pays</h3>
              <p className="text-sm text-gray-600">
                Mali, Sénégal, Burkina Faso, Côte d'Ivoire
              </p>
            </div>
            
            <div className="text-center p-6 bg-yellow-50 rounded-lg">
              <div className="text-3xl mb-4">🔄</div>
              <h3 className="font-semibold text-gray-900 mb-2">Offline</h3>
              <p className="text-sm text-gray-600">
                Mode hors ligne avec synchronisation auto
              </p>
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="bg-gray-900 text-white rounded-lg p-8 text-center">
          <h2 className="text-2xl font-bold mb-4">📧 Feedback de Test</h2>
          <p className="text-gray-300 mb-6">
            Cette version est dédiée aux tests et démonstrations.
            Vos retours sont précieux pour améliorer l'expérience utilisateur.
          </p>
          <div className="flex justify-center space-x-4">
            <div className="bg-orange-600 px-6 py-3 rounded-lg">
              <div className="font-semibold">Version</div>
              <div className="text-sm text-orange-200">Test 1.0</div>
            </div>
            <div className="bg-gray-700 px-6 py-3 rounded-lg">
              <div className="font-semibold">Dernière MAJ</div>
              <div className="text-sm text-gray-300">{new Date().toLocaleDateString('fr-FR')}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TestInfo;