import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { usePageMeta } from '../utils/seo';
import { PAGE_SECTIONS } from '../config/page-sections';

/**
 * Page « Politique de confidentialité ».
 *
 * Avant, ce lien menait à un .docx : un crawler n'en lisait rien, et un lecteur
 * devait télécharger un fichier Word. La page dit maintenant, en clair, quelles
 * données sont conservées, combien de temps, ce que la suppression de compte
 * efface et comment exercer ses droits.
 *
 * Les DURÉES qu'elle publie ne sont pas une seconde déclaration : elles sont
 * vérifiées contre `backend/kojo_retention.py` — le module dont la base crée ses
 * index TTL — par `.github/scripts/check-privacy-policy.py`, le même garde qui
 * tient déjà le tableau de PRIVACY.md. Une durée changée dans le code sans
 * l'être ici fait échouer la CI.
 *
 * Les SECTIONS, elles, sont déclarées dans src/config/page-sections.js, que lit
 * aussi vite.config.js : la coquille pré-rendue ne peut pas publier une autre
 * liste de sections que cette page.
 */
export default function Privacy() {
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
  } = PAGE_SECTIONS['/privacy'];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* La géométrie est LUE dans le plan, jamais recopiée. Sur cette page le
          plus grand texte peint n'est pas l'introduction mais le CORPS d'une
          section : c'est `sectionBodyClass` qui porte l'élément LCP, et
          `frameClass` qui décide de son retour à la ligne — voir le
          commentaire du plan, mesures à l'appui. */}
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
