import { Fragment } from 'react';
// Le lien interne AVEC la transition de vue native (components/LienVue.js).
import Link from '../components/LienVue';
import { useLanguage } from '../contexts/LanguageContext';
import { usePageMeta } from '../utils/seo';
import { CONTACT } from '../config/contact';
import { PAGE_SECTIONS } from '../config/page-sections';
import MapEmbed from '../components/MapEmbed';
import { IconePage, CLASSES_ICONE } from '../config/page-icons';

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
    // Le vocabulaire éditorial des quatre lignes de contact, DÉCLARÉ dans le
    // plan : la coquille pré-rendue lit les mêmes cinq chaînes, donc les deux
    // peintures ne peuvent pas diverger sur l'habillage d'une ligne.
    listeContactClass, pastilleContactClass, etiquetteContactClass, valeurContactClass,
    // La carte : un contrôle, pas un embed au premier écran (voir le commentaire
    // du plan). La page et la coquille publient les mêmes classes, donc la
    // bascule shell → React ne déplace rien.
    mapButtonKey, icone, mapFrameClass, mapControlClass,
    // La géométrie du plus grand texte peint — le paragraphe d'introduction,
    // élément LCP de cette page — et de son cadre. Deux propriétaires rendraient
    // les deux peintures divergentes, et une seconde peinture PLUS GRANDE que
    // celle de la coquille devient un nouvel élément LCP : toute la chaîne
    // JavaScript entrerait alors dans le LCP (voir le plan).
    frameClass, titleClass, introClass, noteClass,
  } = PAGE_SECTIONS['/contact'];
  const titreDeLaCarte = t('mapIframeTitle').replace('{address}', CONTACT.address);

  return (
    <div className="min-h-screen fond-papier">
      <div className={frameClass}>
        <h1 className={titleClass}>{t(titleKey)}</h1>
        <p className={introClass}>{t(introKey)}</p>
        <p className={noteClass}>{t(noteKey)}</p>

        {/* Les quatre moyens de contact : une LISTE EN LIGNES, comme les
            métiers de l'accueil — la pastille ronde (sable et orange du
            site), le libellé, la valeur, et la flèche qui dit que la ligne
            mène quelque part. La flèche est peinte pour TOUTES les lignes de
            cette page : la quatrième mène à la fiche Google (`mapsUrl`). */}
        <div className={listeContactClass}>
          {actions.map((action) => (
            <a
              key={action.labelKey}
              href={action.href}
              {...(action.external ? { target: '_blank', rel: 'noreferrer' } : {})}
              className={action.rowClass}
            >
              <span className={pastilleContactClass}>
                <IconePage nom={action.icone} classe={CLASSES_ICONE.ligne} />
              </span>
              <span>
                <span className={etiquetteContactClass}>{t(action.labelKey)}</span>
                <span className={`${valeurContactClass}${action.breakAll ? ' break-all' : ''}`}>
                  {action.value}
                </span>
              </span>
              <IconePage nom="flecheDroite" classe={CLASSES_ICONE.flecheLigne} />
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
          icone={icone}
          classeIcone={CLASSES_ICONE.carteContact}
          frameClass={mapFrameClass}
          controlClass={mapControlClass}
        />

        <p className="mt-6 text-sm text-stone-500">
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
