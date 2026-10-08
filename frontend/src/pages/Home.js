// Le lien interne du site, PAS le `Link` de React Router : c'est lui qui ouvre
// la transition de vue native (`components/LienVue.js`). L'accueil portait
// jusque-là le `Link` brut, donc TOUS ses liens de contenu — les dix métiers,
// les trois photos, les deux appels du héros — changeaient de page d'un coup,
// sans le raccord que le chrome avait déjà. Le composant se comporte comme le
// `Link` d'origine (mêmes propriétés, même `<a href>` réel pour un crawler et
// pour « ouvrir dans un nouvel onglet »).
import Link from '../components/LienVue';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { getAllCountries } from '../components/CountryDisplay';
import FlagIcon from '../components/FlagIcon';
import { usePageMeta } from '../utils/seo';
// Le corps de l'accueil (catégories, promesses, étapes) est DÉCLARÉ une fois :
// src/config/page-sections.js, que le build lit pour écrire la coquille
// pré-rendue. Ce composant en DÉRIVE au lieu de tenir sa propre liste.
import { PAGE_SECTIONS, couperLeTitre } from '../config/page-sections';
import { CONTACT, SOCIAL_LINKS, mailtoHref, telHref } from '../config/contact';
import MapEmbed from '../components/MapEmbed';
// La photo du héros — et son alternance. Ses chemins, ses dimensions et son
// délai appartiennent à src/config/photos-heros.js, que la coquille pré-rendue
// lit AUSSI : les deux canaux ne peuvent pas peindre deux photos différentes au
// premier rendu (voir le commentaire du module).
import PhotoDuHeros from '../components/PhotoDuHeros';
import { IconePage, CLASSES_ICONE } from '../config/page-icons';

// Les quatre moyens de contact du bloc N.A.P. ci-dessous sont déclarés UNE
// fois, par /contact (`actions` de src/config/page-sections.js) — la même
// correspondance que la coquille de l'accueil
// (`glypheDeContact`, vite-plugins/prerender/shells-home.js) : le nom d'icône
// est LU dans la déclaration, jamais recopié ici. Une ligne disparue de
// /contact fait lever `IconePage` au montage au lieu de peindre une pastille
// vide en silence.
const ICONE_DE_CONTACT = Object.fromEntries(
  PAGE_SECTIONS['/contact'].actions.map(({ labelKey, icone }) => [labelKey, icone])
);

export default function Home() {
  const { t } = useLanguage();
  const { user } = useAuth();
  usePageMeta();

  // Catégories, promesses, étapes et chiffres : lus dans la déclaration du
  // corps de la page (src/config/page-sections.js) — la MÊME que le build
  // utilise pour écrire la coquille pré-rendue. Recopiées ici, elles pouvaient
  // diverger : une promesse ajoutée à la page ne paraissait pas pour un crawler
  // sans JavaScript, et rien ne rougissait. `labelKey` est aussi le code de
  // catégorie canonique du backend (kojo_routers_jobs.py) : le libellé affiché
  // et le filtre de /jobs sortent de la même valeur.
  const {
    categories, promises, steps, stats: STATS, icone: iconeSequestre,
    // Le héros : même clé i18n et mêmes classes que la coquille pré-rendue
    // (src/config/page-sections.js). Depuis la refonte éditoriale du 27/09/2026,
    // l'élément LCP de « / » est l'ILLUSTRATION du héros (re-mesuré le
    // 29/09/2026, photo 3/4 : 69 920 px² en mobile, 306 870 en desktop, contre
    // 37 400 et 110 500 pour ce titre à sa dernière mesure du 28/09/2026) — le
    // titre en reste le plus grand bloc de texte, et c'est sa géométrie qui
    // ancre la parité : la coquille le peint avant le JavaScript, React
    // reconstruit ensuite EXACTEMENT la même boîte, et c'est cette égalité qui
    // fait que Chrome ne ré-élit pas de seconde peinture, plus tardive,
    // déclenchée par le JavaScript (`e2e/lcp-geometrie.spec.js`, mesuré : une
    // seule candidate, la même aire des deux côtés, au premier paint).
    titleKey: heroTitleKey,
    subtitleKey: heroSubtitleKey,
    heroTitleClass,
    heroSubtitleClass,
    // Le vocabulaire éditorial des dix sections : les MÊMES classes que la
    // coquille (vite-plugins/prerender/shells-home.js) lit dans le plan. Rien
    // n'est recopié ici — c'est ce qui rend la bascule invisible.
    heroKickerClass,
    headClass,
    sectionIntroClass,
    cardClass,
    cardLinkClass,
    paperClass,
    sandClass,
    // ── La seconde passe éditoriale (27/09/2026) : le héros en deux colonnes,
    // le ruban des pays, les listes en lignes, le panneau du séquestre et la
    // clôture. Comme les sept champs ci-dessus, ce sont des classes de
    // src/index.css, déclarées une fois et lues par les deux canaux.
    heroGrilleClass,
    heroCopieClass,
    heroActionsClass,
    heroBoutonClass,
    heroBoutonSecondClass,
    heroReperesClass,
    heroIllustrationClass,
    heroIllustrationFondClass,
    heroIllustrationImageClass,
    heroAccentClass,
    rubanClass,
    rubanInnerClass,
    rubanEtiquetteClass,
    rubanJetonsClass,
    rubanJetonClass,
    entreeSectionClass,
    // ── Le RYTHME (28/09/2026) : le pas d'une section et celui d'une carte. ──
    // Les sections de cette page portaient leur rembourrage en littéral (dix
    // fois ici, neuf dans la coquille) et ses cartes `p-6` (deux fois de chaque
    // côté). Ces deux pas sont maintenant des classes de src/index.css, lues
    // par les deux canaux : retoucher le rythme de la page se fait à un seul
    // endroit, et les deux peintures ne peuvent plus diverger en silence.
    sectionClass,
    carteClass,
    listeClass,
    listeColonnesClass,
    ligneMetierClass,
    ligneEtapeClass,
    pastilleClass,
    pastilleCreuseClass,
    nomLigneClass,
    noteLigneClass,
    flecheLigneClass,
    panneauClass,
    panneauArtClass,
    panneauOrbeClass,
    panneauImageClass,
    panneauEstampilleClass,
    faitsClass,
    faitClass,
    faitFigureClass,
    faitLibelleClass,
    ctaClass,
    ctaInnerClass,
    ctaActionsClass,
    lienFlecheClass,
    lienFlecheClairClass,
    galerie,
    galerieGrilleClass,
    galerieCarteClass,
    galerieLegendeClass,
    etapesGrilleClass,
    etapesTeteClass,
    cadrePhotoClass,
    photoEtapes,
  } = PAGE_SECTIONS['/'];

  // Le titre du héros se lit en deux lignes, la seconde en italique — le seul
  // ornement typographique de la page. La coupure est DÉCLARÉE (`couperLeTitre`)
  // et non recopiée : la coquille pré-rendue publie les deux mêmes moitiés, et
  // une langue sans ponctuation forte reçoit le titre d'un seul tenant.
  const [titreTete, titreQueue] = couperLeTitre(t(heroTitleKey));

  // La FAÇADE de la carte : le MÊME contrôle que /contact, lu dans la MÊME
  // déclaration (les classes, le libellé et le glyphe de la carte n'ont qu'un
  // propriétaire, comme les glyphes du bloc de contact plus bas, qui viennent
  // déjà des `actions` de /contact). L'accueil publiait l'iframe
  // `output=embed` en `loading="lazy"` : mesuré (Lighthouse 12.6.1, pile de la
  // CI, Chrome 152), `loading="lazy"` n'empêche rien — le navigateur charge une
  // iframe dès qu'elle approche du viewport, et sur desktop elle y est déjà. Le
  // premier écran tire alors ~300 Ko de tiers et le LCP de la page (une de NOS
  // peintures) est repoussé, l'`elementRenderDelay` entrant dans le graphe LCP
  // simulé de Lantern. Le contrôle ci-dessous ne monte l'iframe qu'à l'appui.
  const {
    mapButtonKey, icone: iconeDeLaCarte, mapFrameClass, mapControlClass,
  } = PAGE_SECTIONS['/contact'];

  // Le titre de l'iframe montée à l'appui (même clé que /contact).
  const titreDeLaCarte = t('mapIframeTitle').replace('{address}', CONTACT.address);

  // LES CHIFFRES SONT DES FAITS VÉRIFIABLES, jamais des compteurs inventés :
  // les deux anciens replis fabriqués (« 1 000+ travailleurs », « 500+
  // projets ») et la promesse « 24/7 » sont retirés de la déclaration (voir
  // src/config/page-sections.js). Ce qui reste est publié tel quel par les deux
  // canaux — aucun appel réseau, aucun chiffre à remplacer au montage.

  // Les pays : la liste ET la couleur de carte viennent du référentiel partagé
  // (src/config/countries.js), que le build lit aussi pour écrire la coquille.
  const countries = getAllCountries();

  // Les quatre lignes de contact sont des LIENS : elles portent la carte
  // cliquable du vocabulaire éditorial — donc un seul survol pour les cartes
  // et les lignes, au lieu d'un `hover` réécrit sur chacune.
  const ligneDeContactClass = `${cardLinkClass} flex items-center gap-3 px-4 py-3`;

  return (
    // `sections-differees` : les neuf sections sous la ligne de flottaison
    // passent en `content-visibility: auto` (src/App.css, tailles intrinsèques
    // exactes). Le héros est exclu par la règle elle-même
    // (`:not(:first-of-type)`), et la coquille porte la MÊME classe sur le même
    // conteneur.
    <div className="min-h-screen sections-differees">
      {/* ── LE HÉROS ────────────────────────────────────────────────────────
          La composition est désormais en DEUX MOITIÉS : le texte tenu à gauche,
          l'illustration encadrée à droite. Le fond orange de Kojo est conservé
          — c'est l'identité du site — et ce qui change est la façon dont la
          page s'ouvre : un titre qui se lit en deux lignes, une phrase de
          lecture, deux actions de poids différent, et sous les deux, trois
          repères de confiance. */}
      <section className="bg-gradient-to-br from-orange-600 via-orange-600 to-orange-700 text-white relative overflow-hidden">
        {/* Le voile du héros — et sa seule règle : il PEINT, il ne capte
            jamais. MESURÉ (Chromium, 07/10/2026) : ce `<div>` est positionné
            (`absolute`), donc il se peint APRÈS les frères en flux normal, et
            la grille de contenu du héros est statique — le voile passait donc
            AU-DESSUS des deux appels à l'action. `document.elementFromPoint`
            au centre des deux boutons rendait `DIV.absolute.inset-0.bg-black
            .bg-opacity-5` : chaque appui sur « Commencer maintenant » et
            « Voir les emplois » était avalé par une teinte à 5 %, visible mais
            décorative. `pointer-events-none` dit la règle en un mot — une
            couche de PEINTURE n'est pas une cible — et il la dit pour les deux
            canaux : la coquille pré-rendue publie la même classe
            (vite-plugins/prerender/shells-home.js), sinon le HTML d'avant
            l'hydratation garderait deux boutons morts. */}
        <div className="absolute inset-0 bg-black bg-opacity-5 pointer-events-none"></div>
        <div className={heroGrilleClass}>
          <div className={heroCopieClass}>
            <span className={`${heroKickerClass} mb-6`}>
              <IconePage nom="escrow" classe={CLASSES_ICONE.heros} />
              {t('escrowBannerTitle')}
            </span>
            {/* Le titre est l'élément LCP de « / » : il est publié par la
                coquille pré-rendue avec les MÊMES classes, et React reconstruit
                la même boîte. Les deux moitiés sortent du même texte du
                dictionnaire (voir `couperLeTitre`). */}
            <h1 className={heroTitleClass}>
              {titreTete}
              {titreQueue ? (
                <>
                  <br />
                  <em className={heroAccentClass}>{titreQueue}</em>
                </>
              ) : null}
            </h1>
            <p className={heroSubtitleClass}>{t(heroSubtitleKey)}</p>
            <div className={heroActionsClass}>
              {!user ? (
                <>
                  <Link to="/register" className={heroBoutonClass}>
                    {t('getStarted')}
                  </Link>
                  <Link to="/jobs" className={heroBoutonSecondClass}>
                    {t('viewJobs')}
                  </Link>
                </>
              ) : (
                <Link to="/dashboard" className={heroBoutonClass}>
                  {t('myDashboard')}
                </Link>
              )}
            </div>

            {/* Bandeau de confiance : trois repères qui répondent aux deux
                questions d'un visiteur qui hésite (l'argent est-il protégé ?
                comment ça marche ?). Textes et glyphes viennent du dictionnaire,
                comme le reste de l'accueil. */}
            <div className={heroReperesClass}>
              <span>
                <IconePage nom="escrow" classe={CLASSES_ICONE.heros} />
                {t('escrowTrustTitle')}
              </span>
              <span>
                <IconePage nom="promiseSecurePayments" classe={CLASSES_ICONE.heros} />
                {t('securePayments')}
              </span>
              <Link to="/how-it-works" className={lienFlecheClairClass}>
                {t('howItWorksLink')}
                <IconePage nom="flecheDroite" classe={CLASSES_ICONE.flecheLigne} />
              </Link>
            </div>
          </div>

          {/* LA PHOTO DU HÉROS : des PHOTOGRAPHIES RÉELLES, servies par le site
              (SIX clichés Pexels — 8487367, 8487764, 20814721, 6790757,
              20853658, 8487345 — licence Pexels : usage commercial libre, sans
              attribution obligatoire), recadrées en 3/4 à la source, puis
              réduites ici à 720 px de large (62 à 126 ko chacune, 560 ko à
              six), publiées ENTIÈRES et à leur rapport (720 × 960, soit 3/4).

              Elles remplacent le DESSIN qui occupait cette place
              (`kojo-hero.svg`, deux personnages et une maison) : trois versions
              de ce dessin ont été refusées par le propriétaire du site (« ça a
              l'air trop générique », « c'est moche ») — un dessin plat ne dit
              pas qu'un artisan est un professionnel. Une photo dit ce qu'un
              dessin promet, et c'est la règle qui a déjà fait entrer les trois
              photos de la galerie dans la page.

              ── ENTIÈRES, PLUS GRANDES, ET ALTERNÉES (29/09/2026) ───────────────
              La première version les recadrait en 4/3 (960 × 720, `fit=crop`) —
              le rapport du dessin, donc la boîte du héros ne bougeait pas d'un
              pixel. Le propriétaire a tranché autrement : « j'aime l'image mais
              agrandis-la un peu plus, que toute l'image soit visible », puis
              « fais-les s'interchanger toutes les 15 secondes ». Le cadrage est
              donc RETIRÉ (le fichier est publié à son rapport d'origine), le
              cadre est ÉLARGI (30 rem au lieu de 27, voir `.cadre-illustration`,
              src/index.css) et la photo change toutes les 15 s
              (`src/components/PhotoDuHeros.js`).

              Ce qui ne change pas, c'est la règle de la parité : les DEUX canaux
              publient la même première photo, les mêmes attributs et les mêmes
              classes — la coquille peint le premier `<img>` en littéral
              (`shells-home.js`, qui lit la liste du MÊME module de
              configuration) et React reconstruit exactement la même boîte, donc
              le premier paint reste celui que le navigateur retient. Les six
              fichiers étant au même rapport, l'alternance seule ne déplace rien
              non plus : la boîte est réservée avant le chargement par
              `width`/`height` (les dimensions RÉELLES du fichier).

              `alt=""` : les photos ILLUSTRENT le texte qui les précède, elles ne
              disent rien qu'il faille lire — et un texte de remplacement est un
              texte publié, donc il appartient au dictionnaire, pas à une chaîne
              écrite ici (scripts/shell-text-provenance.js). */}
          <div className={heroIllustrationClass}>
            <span className={heroIllustrationFondClass} aria-hidden="true"></span>
            <PhotoDuHeros className={heroIllustrationImageClass} />
          </div>
        </div>
      </section>

      {/* ── LE RUBAN DES PAYS ───────────────────────────────────────────────
          Ces quatre pays étaient quatre cartes à drapeau sur fond papier : la
          même information, mais lue comme une grille de produits. Le ruban
          longe le héros, nomme les pays et se lit comme une portée. Les noms
          viennent du référentiel partagé (src/config/countries.js), que le
          build lit aussi pour la coquille : les deux canaux publient les mêmes
          quatre noms, dans le même ordre. */}
      <section className={rubanClass}>
        <div className={rubanInnerClass}>
          <span className={rubanEtiquetteClass}>
            <IconePage nom="countryGlobe" classe={CLASSES_ICONE.pastille} />
            {t('availableIn4Countries')}
          </span>
          <div className={rubanJetonsClass}>
            {countries.map((country) => (
              /* CES QUATRE JETONS SONT DES LIENS, et ils ne l'étaient pas : le
                 backend accepte `GET /jobs?country=mali` depuis toujours, mais
                 l'interface n'offrait aucun moyen de le poser — un visiteur qui
                 voulait les offres d'un autre pays que le sien n'avait aucun
                 chemin, et quatre pastilles colorées restaient inertes au
                 survol comme au doigt. Le lien porte la MÊME classe que le
                 jeton : la forme ne change pas, c'est l'affordance qui
                 apparaît (état de survol et de focus dans src/index.css). */
              <Link
                key={country.code}
                to={`/jobs?country=${country.code}`}
                className={rubanJetonClass}
              >
                <FlagIcon country={country.code} className="h-4 w-6 rounded-sm" />
                {country.name}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── LES MÉTIERS, EN LIGNES ──────────────────────────────────────────
          Dix cartes identiques disaient « dix produits » ; dix lignes disent
          « dix entrées, et voici leur ordre ». Chaque ligne est un lien réel
          vers /jobs avec le filtre de la catégorie. */}
      <section className={`${sectionClass} ${paperClass}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={entreeSectionClass}>
            <h2 className={headClass}>{t('popularServices')}</h2>
            <p className={sectionIntroClass}>{t('findServiceYouNeed')}</p>
          </div>

          <div className={listeColonnesClass}>
            {categories.map((category) => (
              <Link
                key={category.labelKey}
                to={`/jobs?category=${category.labelKey}`}
                className={ligneMetierClass}
              >
                <span className={pastilleClass}>
                  <IconePage nom={category.icone} classe={CLASSES_ICONE.pastille} />
                </span>
                <span className={nomLigneClass}>{t(category.labelKey)}</span>
                <IconePage
                  nom="flecheDroite"
                  classe={`${CLASSES_ICONE.flecheLigne} ${flecheLigneClass}`}
                />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── LA GALERIE DES MÉTIERS ─────────────────────────────────────────
          Trois photos, chacune un lien vers la liste filtrée de son métier :
          c'est le seul endroit de la page où l'on voit des GENS, et c'est ce
          qu'une page qui parle de travailleurs doit montrer. Les libellés sont
          les NOMS DE MÉTIER du dictionnaire (les mêmes que la liste
          ci-dessus) : aucune phrase n'a été inventée pour l'occasion. Elles
          sont sous la ligne de flottaison et chargées en `lazy`, donc hors du
          premier écran et hors du graphe du LCP. */}
      <section className={`${sectionClass} ${sandClass}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={galerieGrilleClass}>
            {galerie.map(({ labelKey, image }) => (
              <Link key={labelKey} to={`/jobs?category=${labelKey}`} className={galerieCarteClass}>
                <img src={image} alt="" width="800" height="1000" loading="lazy" decoding="async" />
                <span className={galerieLegendeClass}>{t(labelKey)}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── LES TROIS PROMESSES ────────────────────────────────────────────── */}
      <section className={`${sectionClass} ${paperClass}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {promises.map(({ icone, titleKey, descriptionKey }) => (
              <div key={titleKey} className={`${cardClass} ${carteClass}`}>
                <span className={`${pastilleClass} mb-5`}>
                  <IconePage nom={icone} classe={CLASSES_ICONE.pastille} />
                </span>
                <h3 className={`${nomLigneClass} mb-3`}>{t(titleKey)}</h3>
                <p className={noteLigneClass}>{t(descriptionKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── LES TROIS ÉTAPES, EN LIGNES ─────────────────────────────────────
          Une marche à suivre se lit de haut en bas : les trois étapes sont donc
          des lignes, avec leur numéro (lu dans le dictionnaire : `numberKey`),
          leur pastille dessinée et leur texte. Le numéro n'est pas recompté par
          `index + 1` — il appartient au dictionnaire, donc les deux canaux
          publient le même chiffre.

          L'entête et la liste sont les deux colonnes de la même grille, et la
          colonne de gauche porte la photo du parcours (chemin lu dans le plan).
          Elle est en `lazy`, sous la ligne de flottaison : le LCP de la page
          reste l'illustration du héros. */}
      <section className={`${sectionClass} ${sandClass}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={etapesGrilleClass}>
            <div className={etapesTeteClass}>
              <h2 className={headClass}>{t('howItWorksTitle')}</h2>
              <p className={sectionIntroClass}>{t('homeHowItWorksSubtitle')}</p>
              <div className={cadrePhotoClass}>
                <img
                  src={photoEtapes}
                  alt=""
                  width="800"
                  height="1000"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>

            <div className={listeClass}>
              {steps.map(({ icone, numberKey, titleKey, descriptionKey }) => (
                /* CHAQUE MARCHE EST UN LIEN. Ces lignes portent la classe des
                   lignes CLIQUABLES (`.ligne-editoriale` : c'est elle qui donne
                   le fond au survol, le décalage du rembourrage et la flèche
                   qui s'allume et se décale — voir src/index.css), mais
                   c'étaient des `<div>` : la page réagissait au survol comme si
                   l'on pouvait appuyer, et l'appui ne faisait rien. Elles
                   mènent à la page qui détaille le parcours, comme les lignes
                   de métier mènent à la liste filtrée. */
                <Link key={titleKey} to="/how-it-works" className={ligneEtapeClass}>
                  <span className={pastilleCreuseClass}>
                    <span className="text-lg font-bold">{t(numberKey)}</span>
                  </span>
                  <span className={pastilleClass}>
                    <IconePage nom={icone} classe={CLASSES_ICONE.pastille} />
                  </span>
                  <div>
                    <h3 className={nomLigneClass}>{t(titleKey)}</h3>
                    <p className={noteLigneClass}>{t(descriptionKey)}</p>
                  </div>
                  <IconePage
                    nom="flecheDroite"
                    classe={`${CLASSES_ICONE.flecheLigne} ${flecheLigneClass}`}
                  />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── LE SÉQUESTRE ────────────────────────────────────────────────────
          Le bloc « votre argent est protégé » était la seule tache verte d'une
          page orange. Il devient un panneau en deux moitiés — l'illustration du
          séquestre sur son propre sol, le texte à droite — et l'accent reste
          l'orange de la marque. */}
      <section className={`${sectionClass} ${paperClass}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={panneauClass}>
            <div className={panneauArtClass}>
              <span className={panneauOrbeClass} aria-hidden="true"></span>
              <img
                src="/assets/kojo-paiement-securise.svg"
                alt=""
                width="620"
                height="500"
                loading="lazy"
                decoding="async"
                className={panneauImageClass}
              />
              {/* L'estampille : un repère d'angle, pas une information nouvelle —
                  elle reprend un texte que la page publie déjà (`securePayments`)
                  plutôt que d'en inventer un. */}
              <span className={panneauEstampilleClass}>
                <IconePage nom={iconeSequestre} classe={CLASSES_ICONE.heros} />
                {t('securePayments')}
              </span>
            </div>
            <div>
              <h2 className={`${headClass} mb-4`}>{t('escrowTrustTitle')}</h2>
              <p className={`${sectionIntroClass} mb-4`}>{t('escrowTrustText')}</p>
              <p className={`${noteLigneClass} mb-6`}>{t('escrowTrustBullets')}</p>
              <Link to="/how-it-works" className="bouton bouton-encre">
                {t('learnMore')}
                <IconePage nom="flecheDroite" classe={CLASSES_ICONE.flecheLigne} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── LA CLÔTURE ──────────────────────────────────────────────────────
          Orange, pleine largeur, deux anneaux qui débordent du cadre : c'est le
          seul endroit de la page où le dessin sort de la marge. */}
      <section
        className={`${ctaClass} bg-gradient-to-br from-orange-600 to-orange-700 text-white`}
      >
        <div className={ctaInnerClass}>
          <h2 className="titre-section mb-6">{t('joinThousands')}</h2>
          <p className="text-lg md:text-xl opacity-90">{t('startConnectingToday')}</p>

          {!user && (
            <div className={ctaActionsClass}>
              <Link to="/register?type=client" className="bouton bouton-creme">
                {t('lookingForServices')}
                <IconePage nom="flecheDroite" classe={CLASSES_ICONE.flecheLigne} />
              </Link>
              <Link to="/register?type=worker" className="bouton bouton-contour">
                {t('offerServices')}
                <IconePage nom="flecheDroite" classe={CLASSES_ICONE.flecheLigne} />
              </Link>
            </div>
          )}

          {/* ── LES DEUX FAITS ───────────────────────────────────────────────
              Ils servaient de BANDEAU à filets, seuls sur toute une section,
              entre cette clôture et « Qui sommes-nous ». C'est leur EMPLACEMENT
              autant que leur espacement que le propriétaire du site a jugés laids
              (« pour application ») : 245 px de section pour 115 px de bande, et
              deux nombres centrés qui dominaient leur propre libellé. Ils sont
              ici — sous les deux boutons, à l'endroit exact où le visiteur
              hésite — et ils reprennent le pas du site depuis la refonte du
              25/09/2026 : alignés à GAUCHE (la clôture est centrée, donc cette
              rangée déclare son alignement), bornés en largeur, chiffre ramené
              à 1,5 rem pour ne pas disputer la hiérarchie au titre.

              Les deux valeurs et leurs deux dessins sortent de la DÉCLARATION
              du plan (PAGE_SECTIONS['/'].stats) : la même liste que la coquille
              pré-rendue publie, donc aucun compteur inventé, et le globe et le
              téléphone viennent du registre d'icônes — le MÊME dessin des deux
              côtés, jamais un emoji d'un côté et un SVG de l'autre. */}
          <div className={faitsClass}>
            {STATS.map((stat) => (
              <div key={stat.labelKey} className={faitClass}>
                <span className={faitFigureClass}>
                  <IconePage nom={stat.icone} classe={CLASSES_ICONE.heros} />
                  {stat.fallback}
                </span>
                <span className={faitLibelleClass}>{t(stat.labelKey)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── QUI SOMMES-NOUS ─────────────────────────────────────────────────
          Le contenu de fond de l'accueil. Un audit de référencement reprochait
          à la page ses 401 mots — un moteur n'y trouvait pas de quoi comprendre
          qui édite le site. Le même bloc est rendu par la coquille statique
          (vite.config.js), avec les mêmes clés i18n : un crawler sans
          JavaScript le lit aussi. */}
      <section className={`${sectionClass} ${paperClass}`}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={entreeSectionClass}>
            <h2 className={headClass}>{t('homeAboutTitle')}</h2>
          </div>
          <p className={`${sectionIntroClass} mb-4`}>{t('homeAboutText1')}</p>
          <p className={`${sectionIntroClass} mb-4`}>{t('homeAboutText2')}</p>
          {/* La phrase de couverture géographique : elle nommait les quatre pays
              dans une section à part ; le ruban du héros les nomme désormais un
              par un, et la phrase survit ici, où elle appartient (qui édite le
              site, et pour qui). */}
          <p className={sectionIntroClass}>{t('kojoConnectsDescription')}</p>
          <p className="mt-6 text-sm">
            <Link to="/about" className={lienFlecheClass}>
              {t('aboutTitle')}
            </Link>
            {' · '}
            <Link to="/contact" className={lienFlecheClass}>
              {t('contactTitle')}
            </Link>
            {' · '}
            <Link to="/privacy" className={lienFlecheClass}>
              {t('privacyTitle')}
            </Link>
          </p>
        </div>
      </section>

      {/* ── LE CONTACT ──────────────────────────────────────────────────────
          Section réelle, identique à la coquille statique de l'accueil pour le
          SEO local et l'accessibilité en un appui sur mobile. */}
      <section className={`${sectionClass} ${sandClass} border-t border-stone-100`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={entreeSectionClass}>
            <h2 className={headClass}>{t('contactTitle')}</h2>
            <p className={sectionIntroClass}>{t('homeContactText')}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl mx-auto">
            <a href={telHref} className={ligneDeContactClass}>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-orange-600">
                <IconePage nom={ICONE_DE_CONTACT.contactCall} classe={CLASSES_ICONE.ligne} />
              </span>
              <div>
                <div className="text-sm font-semibold text-stone-900">{t('homeContactCall')}</div>
                <div className="text-xs text-stone-500">{CONTACT.phoneDisplay}</div>
              </div>
            </a>
            <a href={CONTACT.whatsappUrl} target="_blank" rel="noreferrer" className={ligneDeContactClass}>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <IconePage nom={ICONE_DE_CONTACT.contactWhatsapp} classe={CLASSES_ICONE.ligne} />
              </span>
              <div>
                <div className="text-sm font-semibold text-stone-900">{t('contactWhatsapp')}</div>
                <div className="text-xs text-stone-500">{CONTACT.phoneDisplay}</div>
              </div>
            </a>
            <a href={mailtoHref} className={ligneDeContactClass}>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                <IconePage nom={ICONE_DE_CONTACT.contactSendEmail} classe={CLASSES_ICONE.ligne} />
              </span>
              <div>
                <div className="text-sm font-semibold text-stone-900">{t('contactSendEmail')}</div>
                <div className="text-xs text-stone-500 break-all">{CONTACT.email}</div>
              </div>
            </a>
            <a
              href={CONTACT.mapsUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Google Maps"
              title="Google Maps"
              className={ligneDeContactClass}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-100 text-stone-600">
                <IconePage nom={ICONE_DE_CONTACT.contactAddress} classe={CLASSES_ICONE.ligne} />
              </span>
              <div>
                <div className="text-sm font-semibold text-stone-900">{t('contactAddress')}</div>
                <div className="text-xs text-stone-500">{CONTACT.address}</div>
              </div>
            </a>
          </div>

          {SOCIAL_LINKS.length > 0 && (
            <div className={`mt-8 ${cardClass} bg-stone-50 ${carteClass} text-center`}>
              <h3 className="text-lg font-semibold text-stone-900 mb-3">{t('homeContactFollow')}</h3>
              <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-orange-700">
                {SOCIAL_LINKS.map((social) => (
                  <a
                    key={social.key}
                    href={social.url}
                    target="_blank"
                    rel="me noreferrer"
                    className="font-medium hover:text-orange-800 underline underline-offset-2"
                  >
                    {social.label}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* La carte : un CONTRÔLE d'abord, l'iframe à l'appui — le MÊME
              composant et les MÊMES classes que /contact, lues dans la même
              déclaration. Le feu vert d'un audit « carte intégrée » est
              préservé (le contrôle mène à la fiche Google, et l'iframe
              `output=embed` est montée à l'appui), mais aucun octet tiers
              n'entre plus dans le premier écran ni dans le LCP de l'accueil. */}
          <MapEmbed
            src={CONTACT.mapsEmbedUrl}
            href={CONTACT.mapsUrl}
            title={titreDeLaCarte}
            label={t(mapButtonKey)}
            icone={iconeDeLaCarte}
            classeIcone={CLASSES_ICONE.carteContact}
            frameClass={mapFrameClass}
            controlClass={mapControlClass}
          />
        </div>
      </section>
    </div>
  );
}
