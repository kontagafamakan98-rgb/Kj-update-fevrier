import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { usePageMeta } from '../utils/seo';
import { PAGE_SECTIONS } from '../config/page-sections';

/**
 * Page « À propos » — qui édite le site, et pourquoi il existe.
 *
 * Elle manquait : un audit de référencement la réclame, comme /contact et
 * /privacy, parce qu'un moteur (et une régie publicitaire) ne fait crédit qu'à
 * un site qui dit qui il est.
 *
 * Le CORPS de la page n'est pas écrit ici : il est déclaré dans
 * src/config/page-sections.js, la même déclaration que lit vite.config.js pour
 * écrire la coquille pré-rendue. Ajouter une promesse se fait donc à un seul
 * endroit — le HTML que lit un crawler sans JavaScript et la page que lit un
 * navigateur ne peuvent plus annoncer deux contenus différents, et les textes,
 * eux, restent dans src/i18n/*.json (la seule source de texte).
 */
export default function About() {
  const { t } = useLanguage();
  usePageMeta();

  const { titleKey, introKey, cards, highlight, links } = PAGE_SECTIONS['/about'];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">{t(titleKey)}</h1>
        <p className="text-gray-600 mb-8">{t(introKey)}</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {cards.map((card) => (
            <div
              key={card.titleKey}
              className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
            >
              <div className="text-2xl mb-3">{card.icon}</div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">
                {t(card.titleKey)}
              </h2>
              <p className="text-sm text-gray-600">{t(card.descriptionKey)}</p>
            </div>
          ))}
        </div>

        <div className="rounded-3xl border-2 border-emerald-200 bg-emerald-50 p-8 mb-10">
          <h2 className="text-xl font-bold text-emerald-900 mb-3">{t(highlight.titleKey)}</h2>
          <p className="text-emerald-800">{t(highlight.textKey)}</p>
          <p className="text-emerald-700 mt-3 text-sm">{t(highlight.bulletsKey)}</p>
        </div>

        <p className="text-sm text-gray-500">
          {links.map((link, index) => (
            <Fragment key={link.to}>
              {index > 0 && ' · '}
              <Link to={link.to} className="text-orange-600 underline underline-offset-2">
                {t(link.labelKey)}
              </Link>
            </Fragment>
          ))}
        </p>
      </div>
    </div>
  );
}
