import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { usePageMeta } from '../utils/seo';

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
 */
export default function Privacy() {
  const { t } = useLanguage();
  usePageMeta();

  const SECTIONS = [
    { title: t('privacyDataTitle'), body: t('privacyDataBody') },
    { title: t('privacyRetentionTitle'), body: t('privacyRetentionBody') },
    { title: t('privacyRightsTitle'), body: t('privacyRightsBody') },
    { title: t('privacyContactSectionTitle'), body: t('privacyContactBody') },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">{t('privacyTitle')}</h1>
        <p className="text-gray-600 mb-8">{t('privacyIntro')}</p>

        {SECTIONS.map((section) => (
          <section key={section.title} className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">{section.title}</h2>
            <p className="text-gray-600">{section.body}</p>
          </section>
        ))}

        <p className="text-sm text-gray-500">
          <Link to="/contact" className="text-orange-600 underline underline-offset-2">
            {t('contactTitle')}
          </Link>
          {' · '}
          <Link to="/about" className="text-orange-600 underline underline-offset-2">
            {t('aboutTitle')}
          </Link>
        </p>
      </div>
    </div>
  );
}
