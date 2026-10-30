import { useState } from 'react';

// `isAnalyticsConfigured` vient de `utils/mesure-audience.js` : ce bandeau est
// monté par `App.js`, donc dans le JS initial, et il n'a besoin que de LIRE la
// configuration. Importer `utils/analytics.js` ici entraînerait tout le code
// d'injection des fournisseurs dans le chargement de chaque visiteur — y compris
// celui qui refusera. L'injection, elle, arrive au clic (voir `accepter`).
import { isAnalyticsConfigured } from '../utils/mesure-audience';
import {
  CONSENT_DENIED,
  CONSENT_GRANTED,
  readAnalyticsConsent,
  writeAnalyticsConsent,
} from '../utils/consent';
import { useLanguage } from '../contexts/LanguageContext';
import LienVue from './LienVue';

/**
 * Bandeau de consentement à la mesure d'audience.
 *
 * Quand s'affiche-t-il : SEULEMENT si l'éditeur a configuré un fournisseur
 * (`isAnalyticsConfigured()`) ET qu'aucune décision n'est enregistrée. Sans
 * fournisseur, il n'y a rien à demander : le bandeau ne s'affiche pas, et
 * aucun script n'est chargé de toute façon (`index.js` n'initialise
 * l'analytics que sur un accord explicite).
 *
 * Ce que le bandeau ne fait PAS : fermer au clic extérieur, se cacher après un
 * délai, ou considérer le silence comme un accord. La décision est un des deux
 * boutons, rien d'autre — c'est la définition d'un consentement.
 *
 * Les deux boutons ont le MÊME poids visuel (pas de « Accepter » en bouton
 * plein et « Refuser » en lien discret) : un choix déséquilibré n'est pas un
 * choix libre.
 */
export default function ConsentBanner() {
  const { t } = useLanguage();
  const [decision, setDecision] = useState(() => readAnalyticsConsent());

  if (!isAnalyticsConfigured() || decision) return null;

  const accepter = () => {
    const retenu = writeAnalyticsConsent(CONSENT_GRANTED);
    setDecision(retenu);
    // `import()` : le module d'injection n'a de sens qu'ici, une fois le
    // consentement donné. Un échec de chargement ne doit pas casser la page —
    // la décision est enregistrée, la mesure démarrera à la prochaine visite.
    import('../utils/analytics').then(
      (module) => module.initAnalytics(),
      () => {}
    );
  };

  const refuser = () => {
    setDecision(writeAnalyticsConsent(CONSENT_DENIED));
  };

  return (
    <section
      role="region"
      aria-label={t('cookiesConsentTitle')}
      className="fixed inset-x-0 bottom-0 z-50 border-t px-4 py-4 verre-barre md:bottom-6 md:left-auto md:right-6 md:max-w-sm md:rounded-[3px] md:border"
    >
      <h2 className="text-sm font-semibold text-stone-900">{t('cookiesConsentTitle')}</h2>
      <p className="mt-1 text-sm text-stone-600">{t('cookiesConsentBody')}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={accepter}
          className="rounded-[3px] border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 transition-colors hover:bg-stone-100"
        >
          {t('cookiesConsentAccept')}
        </button>
        <button
          type="button"
          onClick={refuser}
          className="rounded-[3px] border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 transition-colors hover:bg-stone-100"
        >
          {t('cookiesConsentRefuse')}
        </button>
        <LienVue to="/terms" className="text-sm text-orange-600 underline underline-offset-2">
          {t('cookiesConsentPolicy')}
        </LienVue>
      </div>
    </section>
  );
}
