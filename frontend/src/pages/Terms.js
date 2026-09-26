import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { usePageMeta } from '../utils/seo';
import { PAGE_SECTIONS } from '../config/page-sections';

/**
 * Page « Conditions générales d’utilisation ».
 *
 * Le lien « Conditions d’utilisation » du pied de page menait à un .docx
 * fusionné (confidentialité + CGU) : un crawler n’en lisait rien et un lecteur
 * devait télécharger un fichier Word. Cette page publie les CGU en clair, à une
 * adresse citable, avec les MÊMES sections que sa coquille pré-rendue — les
 * deux canaux lisent `PAGE_SECTIONS['/terms']`, donc ni la page ni sa coquille
 * ne peuvent publier une autre liste (le refus est dans declared-body.js).
 *
 * La géométrie du plus grand texte peint est LUE dans le plan, jamais recopiée :
 * comme sur /privacy, l’élément LCP est le CORPS d’une section
 * (`sectionBodyClass`), pas l’introduction.
 */
export default function Terms() {
  const { t } = useLanguage();
  usePageMeta();

  const {
    titleKey,
    introKey,
    frameClass,
    titleClass,
    introClass,
    sectionTitleClass,
    sectionBodyClass,
    sections,
    links,
  } = PAGE_SECTIONS['/terms'];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className={frameClass}>
        <h1 className={titleClass}>{t(titleKey)}</h1>
        <p className={introClass}>{t(introKey)}</p>

        {sections.map((section) => (
          <section key={section.titleKey} className="mb-8">
            <h2 className={sectionTitleClass}>{t(section.titleKey)}</h2>
            <p className={sectionBodyClass}>{t(section.bodyKey)}</p>
          </section>
        ))}

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
