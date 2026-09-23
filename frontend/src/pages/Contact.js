import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { usePageMeta } from '../utils/seo';
import { CONTACT } from '../config/contact';
import { PAGE_SECTIONS } from '../config/page-sections';

/**
 * Page « Nous contacter ».
 *
 * « Contact » renvoyait à /support — une page de SUIVI de ticket, pas une page
 * de contact : un crawler (et un visiteur pressé) n'y trouvait ni adresse, ni
 * téléphone en clair, ni moyen d'écrire à l'éditeur du site.
 *
 * Les quatre lignes de contact ne sont pas écrites ici : elles sont déclarées
 * dans src/config/page-sections.js, la même déclaration que lit vite.config.js
 * pour écrire la coquille pré-rendue. Les destinations (`tel:`, `mailto:` avec
 * son sujet, WhatsApp, fiche Google) viennent de src/config/contact.js, la source
 * unique du N.A.P. — le site ne peut donc publier ni deux adresses, ni deux liens
 * différents selon le canal qui les rend.
 *
 * Les libellés, eux, sont des clés i18n que cette page résout (`t(labelKey)`)
 * comme les quatre autres pages : les quatre moyens de contact portent les mêmes
 * clés que les lignes équivalentes de /support. Écrits en français ici, ils
 * restaient français dans les cinq langues du site.
 */
export default function Contact() {
  const { t } = useLanguage();
  usePageMeta();

  const { titleKey, introKey, noteKey, actions, links } = PAGE_SECTIONS['/contact'];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{t(titleKey)}</h1>
        <p className="text-gray-600 mb-3">{t(introKey)}</p>
        <p className="text-sm text-gray-500 mb-6">{t(noteKey)}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {actions.map((action) => (
            <a
              key={action.labelKey}
              href={action.href}
              {...(action.external ? { target: '_blank', rel: 'noreferrer' } : {})}
              className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-full ${action.badgeClass}`}
              >
                {t(action.iconKey)}
              </span>
              <div>
                <div className="text-sm font-semibold text-gray-900">{t(action.labelKey)}</div>
                <div className={`text-xs text-gray-500${action.breakAll ? ' break-all' : ''}`}>
                  {action.value}
                </div>
              </div>
            </a>
          ))}
        </div>

        {/* La fiche Google (adresse + itinéraire) est aussi le lien de présence
            locale : c'est elle qu'un audit « Google Business Profile » cherche
            sur une page de contact, et elle est servie par la carte ci-dessous. */}
        <iframe
          src={CONTACT.mapsEmbedUrl}
          title={t('mapIframeTitle').replace('{address}', CONTACT.address)}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="mt-6 w-full rounded-xl border border-gray-200"
          style={{ height: 320, border: 0 }}
        />

        <p className="mt-6 text-sm text-gray-500">
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
