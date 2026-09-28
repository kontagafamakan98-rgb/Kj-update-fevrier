import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import ProfilePhoto from '../components/ProfilePhoto';
import { makeScopedTranslator } from '../utils/pack2PageI18n/photoTest';
import { devLog } from '../utils/env';
import { FlaskConical, CheckCircle2, XCircle } from 'lucide-react';

export default function PhotoTest() {
  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t);
  const [testResults, setTestResults] = useState([]);

  const testUser = user || {
    id: 'test_user_123',
    first_name: 'Jean',
    last_name: 'Dupont',
    email: 'jean.dupont@test.com',
    user_type: 'client'
  };

  const addTestResult = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setTestResults((prev) => [...prev, { timestamp, message, type }]);
    devLog.info(`[${timestamp}] ${message}`);
  };

  const handlePhotoChange = (result) => {
    addTestResult(`Photo change result: ${JSON.stringify(result)}`, 'success');
  };

  const testFileInput = () => {
    addTestResult(pageT('fileInputTesting'), 'info');

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        addTestResult(`File selected: ${file.name} (${file.size} bytes, ${file.type})`, 'success');
      } else {
        addTestResult(pageT('noFileSelected'), 'warning');
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
    <div className="min-h-full fond-sable py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="titre-page flex items-center gap-3">
            <FlaskConical className="h-7 w-7 text-orange-700" aria-hidden="true" />
            {pageT('title')}
          </h1>
          <p className="mt-3 text-stone-600">{pageT('subtitle')}</p>
        </div>

        <div className="carte-editoriale mb-6 p-6">
          <h2 className="titre-entree mb-4">{pageT('userInfo')}</h2>
          <div className="rounded-[3px] border border-stone-200 fond-papier p-4">
            <pre className="text-sm">{JSON.stringify(testUser, null, 2)}</pre>
          </div>
        </div>

        <div className="carte-editoriale mb-6 p-6">
          <h2 className="titre-entree mb-4">{pageT('photoComponent')}</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <h3 className="font-medium mb-4">{pageT('editableMode')}</h3>
              <ProfilePhoto
                user={testUser}
                size={150}
                editable={true}
                onPhotoChange={handlePhotoChange}
                showEditButton={true}
              />
              <p className="text-sm text-stone-500 mt-2">{pageT('clickToEdit')}</p>
            </div>

            <div className="text-center">
              <h3 className="font-medium mb-4">{pageT('readMode')}</h3>
              <ProfilePhoto user={testUser} size={150} editable={false} showEditButton={false} />
              <p className="text-sm text-stone-500 mt-2">{pageT('readOnly')}</p>
            </div>

            <div className="text-center">
              <h3 className="font-medium mb-4">{pageT('smallFormat')}</h3>
              <ProfilePhoto
                user={testUser}
                size={80}
                editable={true}
                onPhotoChange={handlePhotoChange}
                showEditButton={true}
              />
              <p className="text-sm text-stone-500 mt-2">80px</p>
            </div>
          </div>
        </div>

        <div className="carte-editoriale mb-6 p-6">
          <h2 className="titre-entree mb-4">{pageT('manualTests')}</h2>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={testFileInput} className="bouton bouton-encre">
              {pageT('directFileTest')}
            </button>

            <button onClick={() => addTestResult(pageT('manualLogEntry'), 'info')} className="bouton bouton-clair">
              {pageT('addLog')}
            </button>

            <button onClick={clearResults} className="bouton bouton-clair">
              {pageT('clearLogs')}
            </button>
          </div>
        </div>

        <div className="carte-editoriale p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="titre-entree">{pageT('testLogs')}</h2>
            <span className="text-sm text-stone-500">{pageT('entriesCount', { count: testResults.length })}</span>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {testResults.length === 0 ? (
              <p className="py-8 text-center text-stone-500">{t('noLogsYet')}</p>
            ) : (
              <div className="space-y-2">
                {testResults.map((result, index) => (
                  /* La gravité d'une ligne de journal se dit par l'INTENSITÉ et
                     non par la teinte : le site n'a ni vert ni jaune, et une
                     page de diagnostic qui emprunte ses couleurs à personne se
                     lit mal. Seule la ligne en échec porte une couleur, parce
                     que c'est la seule qui demande un geste. */
                  <div
                    key={index}
                    className={`rounded-[3px] border p-3 text-sm ${
                      result.type === 'error'
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : result.type === 'warning'
                          ? 'border-orange-200 bg-orange-50 text-orange-800'
                          : result.type === 'success'
                            ? 'border-stone-300 bg-stone-100 text-stone-900'
                            : 'border-stone-200 bg-stone-50 text-stone-700'
                    }`}
                  >
                    <span className="mr-2 font-mono text-xs text-stone-500">{result.timestamp}</span>
                    {result.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="carte-editoriale mt-6 p-6">
          <h2 className="titre-entree mb-4">{pageT('browserInfo')}</h2>
          <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            <div>
              <strong>{pageT('userAgent')}:</strong>
              <br />
              <span className="text-stone-600">{navigator.userAgent}</span>
            </div>
            <div>
              <strong>{pageT('fileApi')}:</strong>
              <br />
              <span className={window.File ? 'text-orange-700' : 'text-red-600'}>
                {window.File ? <>
                  <CheckCircle2 className="inline h-4 w-4 mr-1 align-[-0.15em]" aria-hidden="true" />
                  {pageT('supported')}
                </> : (
                  <>
                    <XCircle className="inline h-4 w-4 mr-1 align-[-0.15em]" aria-hidden="true" />
                    {pageT('unsupported')}
                  </>
                )}
              </span>
            </div>
            <div>
              <strong>{pageT('canvas')}:</strong>
              <br />
              <span className={document.createElement('canvas').getContext ? 'text-orange-700' : 'text-red-600'}>
                {document.createElement('canvas').getContext ? <>
                  <CheckCircle2 className="inline h-4 w-4 mr-1 align-[-0.15em]" aria-hidden="true" />
                  {pageT('supported')}
                </> : (
                  <>
                    <XCircle className="inline h-4 w-4 mr-1 align-[-0.15em]" aria-hidden="true" />
                    {pageT('unsupported')}
                  </>
                )}
              </span>
            </div>
            <div>
              <strong>{pageT('localStorage')}:</strong>
              <br />
              <span className={window.localStorage ? 'text-orange-700' : 'text-red-600'}>
                {window.localStorage ? <>
                  <CheckCircle2 className="inline h-4 w-4 mr-1 align-[-0.15em]" aria-hidden="true" />
                  {pageT('supported')}
                </> : (
                  <>
                    <XCircle className="inline h-4 w-4 mr-1 align-[-0.15em]" aria-hidden="true" />
                    {pageT('unsupported')}
                  </>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
