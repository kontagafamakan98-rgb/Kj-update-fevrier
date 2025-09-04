import React, { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ProfilePhoto from '../components/ProfilePhoto';
import { devLog, safeLog } from '../utils/env';

export default function PhotoTest() {
  const { user } = useAuth();
  const [testResults, setTestResults] = useState([]);

  // Utilisateur de test pour le mode debug sans auth
  const testUser = user || {
    id: 'test_user_123',
    first_name: 'Jean',
    last_name: 'Dupont',
    email: 'jean.dupont@test.com',
    user_type: 'client'
  };

  const addTestResult = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setTestResults(prev => [...prev, { timestamp, message, type }]);
    devLog.info(`[${timestamp}] ${message}`);
  };

  const handlePhotoChange = (result) => {
    addTestResult(`Photo change result: ${JSON.stringify(result)}`, 'success');
  };

  const testFileInput = () => {
    addTestResult('Testing manual file input...', 'info');
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        addTestResult(`File selected: ${file.name} (${file.size} bytes, ${file.type})`, 'success');
      } else {
        addTestResult('No file selected', 'warning');
      }
    };
    
    input.onerror = (e) => {
      addTestResult(`File input error: ${e}`, 'error');
    };
    
    input.click();
  };

  const clearResults = () => {
    setTestResults([]);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            🧪 Test Photo de Profil
          </h1>
          <p className="text-gray-600">
            Page de debug pour tester le système de photos
          </p>
        </div>

        {/* User Info */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Informations Utilisateur</h2>
          <div className="bg-gray-100 p-4 rounded">
            <pre className="text-sm">
              {JSON.stringify(testUser, null, 2)}
            </pre>
          </div>
        </div>

        {/* Photo Component Test */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Test du Composant Photo</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Editable Photo */}
            <div className="text-center">
              <h3 className="font-medium mb-4">Mode Éditable</h3>
              <ProfilePhoto
                user={testUser}
                size={150}
                editable={true}
                onPhotoChange={handlePhotoChange}
                showEditButton={true}
              />
              <p className="text-sm text-gray-500 mt-2">Cliquez pour modifier</p>
            </div>

            {/* Non-editable Photo */}
            <div className="text-center">
              <h3 className="font-medium mb-4">Mode Lecture</h3>
              <ProfilePhoto
                user={testUser}
                size={150}
                editable={false}
                showEditButton={false}
              />
              <p className="text-sm text-gray-500 mt-2">Lecture seule</p>
            </div>

            {/* Small Photo */}
            <div className="text-center">
              <h3 className="font-medium mb-4">Petit Format</h3>
              <ProfilePhoto
                user={testUser}
                size={80}
                editable={true}
                onPhotoChange={handlePhotoChange}
                showEditButton={true}
              />
              <p className="text-sm text-gray-500 mt-2">80px</p>
            </div>
          </div>
        </div>

        {/* Manual Tests */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Tests Manuels</h2>
          
          <div className="space-y-4">
            <button
              onClick={testFileInput}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Test Sélection Fichier Direct
            </button>
            
            <button
              onClick={() => addTestResult('Manual test log entry', 'info')}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 ml-4"
            >
              Ajouter Log Test
            </button>
            
            <button
              onClick={clearResults}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 ml-4"
            >
              Vider Logs
            </button>
          </div>
        </div>

        {/* Test Results */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Logs de Test</h2>
            <span className="text-sm text-gray-500">
              {testResults.length} entrée(s)
            </span>
          </div>
          
          <div className="max-h-96 overflow-y-auto">
            {testResults.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                Aucun log pour le moment. Testez les fonctionnalités ci-dessus.
              </p>
            ) : (
              <div className="space-y-2">
                {testResults.map((result, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded text-sm ${
                      result.type === 'error' 
                        ? 'bg-red-100 text-red-800' 
                        : result.type === 'warning'
                        ? 'bg-yellow-100 text-yellow-800'
                        : result.type === 'success'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    <span className="font-mono text-xs text-gray-500 mr-2">
                      {result.timestamp}
                    </span>
                    {result.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Browser Info */}
        <div className="bg-white rounded-lg shadow-md p-6 mt-6">
          <h2 className="text-xl font-bold mb-4">Informations Navigateur</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <strong>User Agent:</strong>
              <br />
              <span className="text-gray-600">{navigator.userAgent}</span>
            </div>
            <div>
              <strong>Support File API:</strong>
              <br />
              <span className={window.File ? 'text-green-600' : 'text-red-600'}>
                {window.File ? '✅ Supporté' : '❌ Non supporté'}
              </span>
            </div>
            <div>
              <strong>Support Canvas:</strong>
              <br />
              <span className={document.createElement('canvas').getContext ? 'text-green-600' : 'text-red-600'}>
                {document.createElement('canvas').getContext ? '✅ Supporté' : '❌ Non supporté'}
              </span>
            </div>
            <div>
              <strong>Support LocalStorage:</strong>
              <br />
              <span className={window.localStorage ? 'text-green-600' : 'text-red-600'}>
                {window.localStorage ? '✅ Supporté' : '❌ Non supporté'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}