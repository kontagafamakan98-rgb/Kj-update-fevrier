import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import MobilePhotoTest from '../components/MobilePhotoTest';
import { makeScopedTranslator } from '../utils/pack2PageI18n';

export default function MobileTest() {
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'mobileTest');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-orange-600 text-white p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <Link to="/dashboard" className="flex items-center space-x-2">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
                  clipRule="evenodd"
                />
              </svg>
              <span>{pageT('backToDashboard')}</span>
            </Link>
          </div>
          <h1 className="text-xl font-bold">{pageT('title')}</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto py-8">
        <MobilePhotoTest />

        <div className="mt-12 bg-white rounded-lg shadow-md p-6">
          <h2 className="text-2xl font-bold text-orange-600 mb-4">{pageT('appInfo')}</h2>

          <div className="space-y-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="font-semibold text-blue-800 mb-2">{pageT('featuresImplemented')}</h3>
              <ul className="text-blue-700 space-y-1">
                <li>{pageT('feat1')}</li>
                <li>{pageT('feat2')}</li>
                <li>{pageT('feat3')}</li>
                <li>{pageT('feat4')}</li>
                <li>{pageT('feat5')}</li>
                <li>{pageT('feat6')}</li>
                <li>{pageT('feat7')}</li>
              </ul>
            </div>

            <div className="bg-green-50 p-4 rounded-lg">
              <h3 className="font-semibold text-green-800 mb-2">{pageT('screensIntegrated')}</h3>
              <ul className="text-green-700 space-y-1">
                <li>{pageT('screen1')}</li>
                <li>{pageT('screen2')}</li>
                <li>{pageT('screen3')}</li>
                <li>{pageT('screen4')}</li>
                <li>{pageT('screen5')}</li>
              </ul>
            </div>

            <div className="bg-orange-50 p-4 rounded-lg">
              <h3 className="font-semibold text-orange-800 mb-2">{pageT('testOnMobile')}</h3>
              <div className="text-orange-700 space-y-2">
                <p><strong>{pageT('step1')}</strong></p>
                <p><strong>{pageT('step2')}:</strong></p>
                <code className="bg-gray-100 px-2 py-1 rounded text-sm block w-fit">
                  cd /app/KojoMobile_FINAL && npx expo start
                </code>
                <p><strong>{pageT('step3')}</strong></p>
                <p><strong>{pageT('step4')}</strong></p>
              </div>
            </div>

            <div className="bg-purple-50 p-4 rounded-lg">
              <h3 className="font-semibold text-purple-800 mb-2">{pageT('troubleshooting')}</h3>
              <ul className="text-purple-700 space-y-1">
                <li>{pageT('help1')}</li>
                <li>{pageT('help2')}</li>
                <li>{pageT('help3')}</li>
                <li>{pageT('help4')}</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
