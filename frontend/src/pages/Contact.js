import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { usePageMeta } from '../utils/seo';
import { CONTACT } from '../config/contact';
import { PAGE_SECTIONS } from '../config/page-sections';
import MapEmbed from '../components/MapEmbed';

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

  const {
    titleKey, introKey, noteKey, actions, links,
    // La carte : un contrôle, pas un embed au premier écran (voir le commentaire
    // du plan). La page et la coquille publient les mêmes classes, donc la
    // bascule shell → React ne déplace rien.
    mapButtonKey, mapIconKey, mapFrameClass, mapControlClass,
    // La géométrie du plus grand texte peint — le paragraphe d'introduction,
    // élément LCP de cette page — et de son cadre. Deux propriétaires rendraient
    // les deux peintures divergentes, et une seconde peinture PLUS GRANDE que
    // celle de la coquille devient un nouvel élément LCP : toute la chaîne
    // JavaScript entrerait alors dans le LCP (voir le plan).
    frameClass, titleClass, introClass, noteClass,
  } = PAGE_SECTIONS['/contact'];
  const titreDeLaCarte = t('mapIframeTitle').replace('{address}', CONTACT.address);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className={frameClass}>
        <h1 className={titleClass}>{t(titleKey)}</h1>
        <p className={introClass}>{t(introKey)}</p>
        <p className={noteClass}>{t(noteKey)}</p>

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
            sur une page de contact. Le contrôle ci-dessous y mène même sans
            JavaScript, et ne monte la carte intégrée qu'à l'appui — l'embed
            tiers (~300 Ko) n'entre donc ni dans le premier écran ni dans le
            chemin critique du LCP. */}
        <MapEmbed
          src={CONTACT.mapsEmbedUrl}
          href={CONTACT.mapsUrl}
          title={titreDeLaCarte}
          label={t(mapButtonKey)}
          icon={t(mapIconKey)}
          frameClass={mapFrameClass}
          controlClass={mapControlClass}
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
