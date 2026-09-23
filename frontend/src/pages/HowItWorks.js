import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { usePageMeta } from '../utils/seo';
// Le corps de cette page (étapes, garanties de séquestre, FAQ) est DÉCLARÉ une
// fois : src/config/page-sections.js, que le build lit pour écrire la coquille
// pré-rendue. Cette page en DÉRIVE au lieu de tenir ses propres listes — une
// question ajoutée ici paraît aussi dans le HTML que lit un crawler sans
// JavaScript, ou dans aucun des deux.
import { PAGE_SECTIONS } from '../config/page-sections';

export default function HowItWorks() {
  const { t } = useLanguage();
  usePageMeta();

  const plan = PAGE_SECTIONS['/how-it-works'];
  const STEPS = plan.steps.map(({ iconKey, titleKey, descriptionKey }) => ({
    // Le glyphe est une CLÉ i18n, comme le texte : la même clé sert à la page et
    // à la coquille, donc les deux canaux publient un seul glyphe (voir
    // `scripts/shell-text-provenance.js`, règle des marqueurs).
    icon: t(iconKey),
    title: t(titleKey),
    description: t(descriptionKey),
  }));
  const FAQ = plan.faq.map(({ questionKey, answerKey }) => ({
    q: t(questionKey),
    a: t(answerKey),
  }));

  // JSON-LD FAQPage injecté dynamiquement (les crawlers qui exécutent le JS,
  // comme Google, peuvent lire les données structurées injectées) — c'est le
  // format recommandé pour les pages FAQ en SEO long-tail.
  useEffect(() => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-kojo', 'faq');
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    });
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="bg-gradient-to-br from-orange-600 via-orange-700 to-red-600 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16 text-center">
          <h1 className="text-3xl md:text-4xl font-bold mb-4">{t(plan.titleKey)}</h1>
          <p className="text-lg opacity-90 max-w-2xl mx-auto">
            {t(plan.heroKey)}
          </p>
        </div>
      </section>

      {/* Étapes */}
      <section className="py-12 md:py-16 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map((step) => (
              <div key={step.title} className="rounded-2xl border border-gray-100 shadow-sm p-6">
                <div className="bg-orange-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">{step.icon}</span>
                </div>
                <h2 className="text-lg font-semibold text-gray-900 text-center mb-3">{step.title}</h2>
                <p className="text-gray-600 text-sm">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Escrow détaillé */}
      <section className="py-12 md:py-16 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl border-2 border-emerald-200 bg-emerald-50 p-8 md:p-10">
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="text-5xl">{t(plan.escrowIconKey)}</div>
              <div>
                <h2 className="text-2xl md:text-3xl font-bold text-emerald-900 mb-3">{t(plan.escrowTitleKey)}</h2>
                <p className="text-emerald-800">
                  {t(plan.escrowTextKey)}
                </p>
                <ul className="mt-4 space-y-2 text-emerald-800 text-sm">
                  {plan.guaranteeKeys.map((key) => (
                    <li key={key}>{t(key)}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-12 md:py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 text-center mb-8">{t(plan.faqTitleKey)}</h2>
          <div className="space-y-4">
            {FAQ.map((item) => (
              <details key={item.q} className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 group">
                <summary className="cursor-pointer font-semibold text-gray-900 list-none flex items-center justify-between gap-4">
                  {item.q}
                  <span className="text-orange-600 transition-transform group-open:rotate-45 text-xl leading-none">{t(plan.faqMarkerKey)}</span>
                </summary>
                <p className="mt-3 text-sm text-gray-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-12 md:py-16 bg-gradient-to-r from-orange-600 to-red-600 text-white">
        <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">{t(plan.readyTitleKey)}</h2>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register?type=client" className="bg-white text-orange-600 hover:bg-gray-100 px-8 py-4 rounded-xl font-semibold transition">
              {t(plan.lookingKey)}
            </Link>
            <Link to="/register?type=worker" className="border-2 border-white text-white hover:bg-white hover:text-orange-600 px-8 py-4 rounded-xl font-semibold transition">
              {t(plan.offerKey)}
            </Link>
          </div>
          {/* Maillage interne : depuis cette page de contenu, un crawler (et
              un visiteur) atteint la liste des missions et le support. Le
              shell statique (vite.config.js) rend EXACTEMENT le même bloc —
              sinon la ligne disparaîtrait au montage React. */}
          <p className="mt-6 text-sm opacity-90">
            <Link to="/jobs" className="underline underline-offset-2">
              {t(plan.links[0].labelKey)}
            </Link>
            {' · '}
            <Link to="/support" className="underline underline-offset-2">
              {t(plan.links[1].labelKey)}
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
