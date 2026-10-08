import { Fragment } from 'react';
// Le lien interne AVEC la transition de vue native (components/LienVue.js) : le
// `Link` brut de React Router change la page d'un coup, sans raccord.
import Link from '../components/LienVue';
import { useLanguage } from '../contexts/LanguageContext';
import { usePageMeta } from '../utils/seo';
import { PAGE_SECTIONS } from '../config/page-sections';
import { IconePage, CLASSES_ICONE } from '../config/page-icons';

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

  const { titleKey, introKey, frameClass, titleClass, introClass, carteClass, cards, highlight, links } =
    PAGE_SECTIONS['/about'];

  return (
    <div className="min-h-screen fond-papier">
      {/* La géométrie est LUE dans le plan, jamais recopiée : le plus grand
          texte peint de cette page est le paragraphe d'introduction, donc son
          élément LCP, et une divergence d'un seul côté ré-élit un élément LCP
          (voir le commentaire du plan, mesures à l'appui). */}
      <div className={frameClass}>
        <h1 className={titleClass}>{t(titleKey)}</h1>
        <p className={introClass}>{t(introKey)}</p>

        {/* Les trois promesses : la carte à filet du vocabulaire éditorial
            (src/index.css), avec le glyphe dans la pastille ronde des autres
            listes du site et le titre au dessin serif. Ce qui remplace une
            carte `rounded-2xl` à ombre large et un titre sans — c'est-à-dire
            une boîte qui ne disait pas à quelle famille de page elle
            appartenait. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {cards.map((card) => (
            <div key={card.titleKey} className={carteClass}>
              <span className="pastille-rond mb-4">
                <IconePage nom={card.icone} classe={CLASSES_ICONE.pastille} />
              </span>
              <h2 className="nom-de-ligne mb-2">
                {t(card.titleKey)}
              </h2>
              <p className="note-de-ligne">{t(card.descriptionKey)}</p>
            </div>
          ))}
        </div>

        {/* Le bloc de confiance : c'était la DEUXIÈME tache verte du site (le
            vert d'eau « emerald », la seule teinte qui n'appartenait à aucune
            gamme de la marque), après celle de /how-it-works. Il prend le
            panneau du vocabulaire éditorial : fond sable, filet, titre serif,
            et l'accent orange en bordure plutôt qu'en fond. */}
        <div className="encart mb-10">
          <h2 className="titre-section mb-3">{t(highlight.titleKey)}</h2>
          <p className="text-stone-600">{t(highlight.textKey)}</p>
          <p className="note-de-ligne mt-3">{t(highlight.bulletsKey)}</p>
        </div>

        <p className="text-sm text-stone-500">
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
