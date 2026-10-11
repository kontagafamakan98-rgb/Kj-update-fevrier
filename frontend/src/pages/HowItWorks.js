import { IconePage } from '../config/page-icons';
import { useEffect } from 'react';
// Le lien interne AVEC la transition de vue native (components/LienVue.js).
import Link from '../components/LienVue';
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
  const STEPS = plan.steps.map(({ icone, numberKey, titleKey, descriptionKey }) => ({
    // Le glyphe est une icône DESSINÉE (src/config/page-icons.js), comme le
    // texte qui vient d'une clé i18n : les deux canaux lisent le même nom, donc
    // ils publient le même dessin (l'emoji de la clé `iconHowStep*` a été
    // remplacé — voir page-icons.js pour la mesure).
    icone,
    // Le NUMÉRO de la marche, lu dans le dictionnaire comme sur l'accueil
    // (`stepNumber1`…`3`) : il n'est pas recompté par `index + 1`, donc les deux
    // canaux publient le même chiffre et un numéro n'est jamais écrit ici.
    numero: t(numberKey),
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
      {/* ── LA BANDE DE TÊTE ────────────────────────────────────────────────
          La géométrie est LUE dans le plan, jamais recopiée : le sous-titre est
          le plus grand texte peint de la page, donc son élément LCP (voir le
          commentaire du plan, mesures à l'appui). Ce qui change ici est le
          FOND : la bande du site (`.bande-page`) au lieu d'un dégradé
          orange → rouge que seule cette page portait. */}
      <section className={plan.bandePageClass}>
        <div className={plan.heroFrameClass}>
          <h1 className={plan.heroTitleClass}>{t(plan.titleKey)}</h1>
          <p className={plan.heroSubtitleClass}>
            {t(plan.heroKey)}
          </p>
        </div>
      </section>

      {/* ── LES TROIS ÉTAPES, EN LIGNES ─────────────────────────────────────
          Trois cartes côte à côte disaient « trois produits » ; trois lignes
          numérotées disent « une marche à suivre, et voici son ordre ». C'est
          la MÊME liste que celle de l'accueil, avec ses classes déclarées : le
          numéro vient du dictionnaire (`numberKey`) et non d'un `index + 1`. */}
      <section className={`${plan.sectionClass} ${plan.paperClass}`}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={plan.listeClass}>
            {STEPS.map((step) => (
              <div key={step.title} className={plan.ligneEtapeClass}>
                <span className={plan.pastilleCreuseClass}>
                  <span className="text-lg font-bold">{step.numero}</span>
                </span>
                <span className={plan.pastilleClass}>
                  <IconePage nom={step.icone} role="pastille" />
                </span>
                <div>
                  <h2 className={plan.nomLigneClass}>{step.title}</h2>
                  <p className={plan.noteLigneClass}>{step.description}</p>
                </div>
                <IconePage
                  nom="flecheBas"
                  role="flecheLigne"
                  enPlus={plan.flecheLigneClass}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── LE SÉQUESTRE, EN PANNEAU ────────────────────────────────────────
          Ce bloc était la SEULE tache verte du site : un panneau `emerald` au
          milieu d'un site orange, avec quatre garanties en liste à puces. Il
          devient le panneau à deux moitiés de l'accueil (l'illustration sur son
          propre sol, le texte à droite) et les garanties deviennent des LIGNES
          à filet, repérées par une icône dessinée — jamais un caractère. */}
      <section className={`${plan.sectionClass} ${plan.sandClass}`}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={plan.panneauClass}>
            <div className={plan.panneauArtClass}>
              <span className={plan.panneauOrbeClass} aria-hidden="true"></span>
              <img
                src={plan.panneauImageSrc}
                alt=""
                width="620"
                height="500"
                loading="lazy"
                decoding="async"
                className={plan.panneauImageClass}
              />
              <span className={plan.panneauEstampilleClass}>
                <IconePage nom={plan.icone} role="heros" />
                {t(plan.estampilleKey)}
              </span>
            </div>
            <div>
              <h2 className={`${plan.headClass} mb-4`}>{t(plan.escrowTitleKey)}</h2>
              <p className={`${plan.sectionIntroClass} mb-4`}>{t(plan.escrowTextKey)}</p>
              <ul className={plan.listeGarantiesClass}>
                {plan.guaranteeKeys.map((key) => (
                  <li key={key}>
                    <IconePage nom={plan.garantieIcon} role="pastille" />
                    {t(key)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── LA FAQ, EN LIGNES ───────────────────────────────────────────────
          Cinq cartes à ombre disaient « cinq produits » ; cinq lignes à filet
          disent « cinq questions, dans cet ordre ». Le dépliant reste un
          `<details>` natif : la question s'ouvre au clavier, et sans
          JavaScript. Le marqueur est DÉCORATIF (`aria-hidden`) : il ne dit rien
          que le dépliant ne dise déjà. */}
      <section className={`${plan.sectionClass} ${plan.paperClass}`}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={plan.entreeSectionClass}>
            <h2 className={plan.headClass}>{t(plan.faqTitleKey)}</h2>
          </div>
          <div className={plan.faqListeClass}>
            {FAQ.map((item) => (
              <details key={item.q} className={plan.faqLigneClass}>
                <summary>
                  {item.q}
                  <span className={plan.faqMarqueClass} aria-hidden="true">{t(plan.faqMarkerKey)}</span>
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── LA CLÔTURE ──────────────────────────────────────────────────────
          La clôture de l'accueil, au même fond orange (le dégradé rouge de
          cette page est retiré) et avec les mêmes boutons : une action
          principale crème, une action secondaire en contour. */}
      <section className={`${plan.ctaClass} bg-gradient-to-br from-orange-600 to-orange-700 text-white`}>
        <div className={plan.ctaInnerClass}>
          <h2 className="titre-section mb-6">{t(plan.readyTitleKey)}</h2>
          <div className={plan.ctaActionsClass}>
            <Link to="/register?type=client" className={plan.boutonClass}>
              {t(plan.lookingKey)}
              <IconePage nom="flecheDroite" role="flecheLigne" />
            </Link>
            <Link to="/register?type=worker" className={plan.boutonSecondClass}>
              {t(plan.offerKey)}
              <IconePage nom="flecheDroite" role="flecheLigne" />
            </Link>
          </div>
          {/* Maillage interne : depuis cette page de contenu, un crawler (et
              un visiteur) atteint la liste des missions et le support. Le
              shell statique (vite.config.js) rend EXACTEMENT le même bloc —
              sinon la ligne disparaîtrait au montage React. */}
          <p className="mt-6 text-sm">
            <Link to="/jobs" className={plan.lienFlecheClairClass}>
              {t(plan.links[0].labelKey)}
            </Link>
            {' · '}
            <Link to="/support" className={plan.lienFlecheClairClass}>
              {t(plan.links[1].labelKey)}
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
