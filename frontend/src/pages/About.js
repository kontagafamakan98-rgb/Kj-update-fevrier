import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { usePageMeta } from '../utils/seo';

/**
 * Page « À propos » — qui édite le site, et pourquoi il existe.
 *
 * Elle manquait : un audit de référencement la réclame, comme /contact et
 * /privacy, parce qu'un moteur (et une régie publicitaire) ne fait crédit qu'à
 * un site qui dit qui il est. Ses textes viennent des mêmes clés i18n que la
 * coquille pré-rendue écrite par vite.config.js : le HTML que lit un crawler
 * sans JavaScript et la page que lit un navigateur sortent donc d'une seule
 * déclaration, et ne peuvent pas se contredire.
 */
export default function About() {
  const { t } = useLanguage();
  usePageMeta();

  const PROMISES = [
    { icon: '💼', title: t('findWork'), description: t('findWorkDescription') },
    { icon: '🤝', title: t('connect'), description: t('connectDescription') },
    { icon: '💰', title: t('securePayments'), description: t('securePaymentsDescription') },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">{t('aboutTitle')}</h1>
        <p className="text-gray-600 mb-8">{t('aboutIntro')}</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {PROMISES.map((promise) => (
            <div
              key={promise.title}
              className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
            >
              <div className="text-2xl mb-3">{promise.icon}</div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">{promise.title}</h2>
              <p className="text-sm text-gray-600">{promise.description}</p>
            </div>
          ))}
        </div>

        <div className="rounded-3xl border-2 border-emerald-200 bg-emerald-50 p-8 mb-10">
          <h2 className="text-xl font-bold text-emerald-900 mb-3">{t('escrowTrustTitle')}</h2>
          <p className="text-emerald-800">{t('escrowTrustText')}</p>
          <p className="text-emerald-700 mt-3 text-sm">{t('escrowTrustBullets')}</p>
        </div>

        <p className="text-sm text-gray-500">
          <Link to="/contact" className="text-orange-600 underline underline-offset-2">
            {t('contactTitle')}
          </Link>
          {' · '}
          <Link to="/privacy" className="text-orange-600 underline underline-offset-2">
            {t('privacyTitle')}
          </Link>
          {' · '}
          <Link to="/how-it-works" className="text-orange-600 underline underline-offset-2">
            {t('howItWorksTitle')}
          </Link>
        </p>
      </div>
    </div>
  );
}
