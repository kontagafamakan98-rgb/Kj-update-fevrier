// Coquille statique de l'ACCUEIL (index.html) : le corps de « / », écrit
// une fois pour le crawler et pour le premier paint, avec les classes de
// src/pages/Home.js — createRoot efface #root au montage et rend la même
// structure, donc la bascule est invisible.
//
// Pays, catégories, promesses, étapes et chiffres ne sont pas recopiés ici :
// la coquille lit les MÊMES listes que la page — les pays dans
// src/config/countries.js, le reste dans la déclaration du corps de
// l'accueil (src/config/page-sections.js, que lit src/pages/Home.js).

import { COUNTRIES } from '../../src/config/countries.js'
import { CLASSES_ICONE } from '../../src/config/page-icons.js'
import { nomDuDrapeau } from '../../src/config/flags.js'
// La COUPURE du titre du héros appartient au plan : la coquille peint les deux
// mêmes moitiés que src/pages/Home.js, sur les cinq langues, sans recopier la
// règle (voir `couperLeTitre`, src/config/page-sections.js).
import { couperLeTitre } from '../../src/config/page-sections.js'
// Les photos du héros : le chemin de la PREMIÈRE, et ses dimensions réelles.
// Le module est partagé avec src/components/PhotoDuHeros.js — la coquille peint
// donc la photo sur laquelle React ouvre son alternance, par construction, et
// changer la photo de tête se fait dans un seul fichier (voir le commentaire du
// module : les deux canaux publient le même `<img>`, sans quoi la bascule
// coquille → React remplacerait une boîte par une autre, et l'élément LCP de
// « / » serait ré-élu par le JavaScript).
import { PHOTOS_HEROS, PHOTO_HEROS_LARGEUR, PHOTO_HEROS_HAUTEUR } from '../../src/config/photos-heros.js'
import { svgDeLIcone, svgDuDrapeau } from './icons-serveur.js'

export function buildHomeShell({ esc, T, contact, socialLinks, pageSections }) {
  // ── Shell statique de l'ACCUEIL (index.html) ────────────────────
  // Mêmes sections et MÊMES classes que src/pages/Home.js, avec les
  // textes réels de src/i18n/fr.json : un crawler sans JavaScript voit
  // un titre h1, du contenu et des liens internes, et l'utilisateur
  // voit la page avant le boot de React (createRoot efface #root au
  // montage, les classes identiques rendent la bascule invisible).
  //
  // ⚠️ Les classes Tailwind utilisées ici doivent EXISTER ailleurs
  // dans les sources scannées (tailwind.config.cjs ne scanne pas ce
  // fichier) : elles sont donc copiées de Home.js / Support.js /
  // App.js, et check-home-shell.js échoue si l'une manque au CSS.
  //
  // Pays, catégories, promesses, étapes et chiffres ne sont plus
  // recopiés ici : la coquille lit les MÊMES listes que la page — les
  // pays dans src/config/countries.js, le reste dans la déclaration du
  // corps de l'accueil (src/config/page-sections.js, que lit
  // src/pages/Home.js). Ajouter un pays, une catégorie ou une promesse
  // laissait autrefois la coquille derrière, en silence.
  const homePlan = pageSections['/']

  // Le titre du héros, son sous-titre et leurs CLASSES DE GÉOMÉTRIE sortent du
  // plan (src/config/page-sections.js) : la coquille les lisait en littéral,
  // donc le texte que le premier paint publie et l'élément LCP que React
  // reconstruit pouvaient diverger — de texte comme de taille — sans que rien
  // ne rougisse. Même classes d'un côté et de l'autre : mesuré, un
  // remplacement de même taille ne ré-élit pas d'élément LCP (la peinture de la
  // coquille reste celle du navigateur), un remplacement plus grand si.
  // Le vocabulaire éditorial des sections sort du MÊME plan : les classes du
  // dessin (`headClass`, `cardClass`…) n'ont donc pas de porteur recopié ici,
  // et une retouche de la page ne peut pas laisser la coquille derrière elle.
  const {
    titleKey, subtitleKey, heroTitleClass, heroSubtitleClass,
    heroKickerClass, headClass, sectionIntroClass, cardClass, cardLinkClass, paperClass,
    sandClass,
    // ── La seconde passe éditoriale (27/09/2026) : le héros en deux colonnes,
    // le ruban des pays, les listes en lignes, le panneau du séquestre et la
    // clôture. Les noms sont lus dans le MÊME plan que la page — sans cette
    // liste, la coquille réécrirait la moitié du dessin en littéral, et une
    // retouche de la page la laisserait derrière elle.
    heroGrilleClass, heroCopieClass, heroActionsClass, heroBoutonClass,
    heroBoutonSecondClass, heroReperesClass, heroIllustrationClass,
    heroIllustrationFondClass, heroIllustrationImageClass, heroAccentClass,
    rubanClass, rubanInnerClass, rubanEtiquetteClass, rubanJetonsClass, rubanJetonClass,
    entreeSectionClass, listeClass, listeColonnesClass, ligneMetierClass, ligneEtapeClass,
    // Le RYTHME (28/09/2026) : le pas d'une section et celui d'une carte, les
    // mêmes qu'en React. Neuf sections et deux cartes portaient ici les
    // littéraux `py-12 md:py-16` et `p-6` — les recopier était la seule façon
    // de les tenir d'accord, et rien ne rougissait quand elles ne l'étaient
    // plus. Ils sont lus dans le plan comme le reste.
    sectionClass, carteClass,
    pastilleClass, pastilleCreuseClass, nomLigneClass, noteLigneClass, flecheLigneClass,
    panneauClass, panneauArtClass, panneauOrbeClass, panneauImageClass, panneauEstampilleClass,
    bandeClass, chiffreClass, ctaClass, ctaInnerClass, ctaActionsClass,
    lienFlecheClass, lienFlecheClairClass,
    galerieGrilleClass, galerieCarteClass, galerieLegendeClass,
    etapesGrilleClass, etapesTeteClass, cadrePhotoClass, photoEtapes,
  } = homePlan
  const champsEditoriaux = {
    heroKickerClass, headClass, sectionIntroClass, cardClass, cardLinkClass, paperClass, sandClass,
    heroGrilleClass, heroCopieClass, heroActionsClass, heroBoutonClass, heroBoutonSecondClass,
    heroReperesClass, heroIllustrationClass, heroIllustrationFondClass,
    heroIllustrationImageClass, heroAccentClass, rubanClass, rubanInnerClass,
    rubanEtiquetteClass, rubanJetonsClass, rubanJetonClass, entreeSectionClass, sectionClass,
    carteClass, listeClass,
    listeColonnesClass, ligneMetierClass, ligneEtapeClass, pastilleClass, pastilleCreuseClass,
    nomLigneClass, noteLigneClass, flecheLigneClass, panneauClass, panneauArtClass,
    panneauOrbeClass, panneauImageClass, panneauEstampilleClass, bandeClass, chiffreClass,
    ctaClass, ctaInnerClass, ctaActionsClass, lienFlecheClass, lienFlecheClairClass,
    galerieGrilleClass, galerieCarteClass, galerieLegendeClass,
    etapesGrilleClass, etapesTeteClass, cadrePhotoClass,
  }
  // Les quatre lignes de contact sont des LIENS : elles portent la carte
  // cliquable du vocabulaire éditorial (le même survol que les cartes de la
  // page), exactement comme src/pages/Home.js.
  const ligneDeContactClass = `${cardLinkClass} flex items-center gap-3 px-4 py-3`

  // Le titre du héros, coupé comme dans src/pages/Home.js : les deux moitiés
  // sont publiées par les deux canaux, ou par aucun (voir `couperLeTitre`).
  const [titreTete, titreQueue] = couperLeTitre(T(titleKey))
  if (!titleKey || !subtitleKey || !heroTitleClass || !heroSubtitleClass) {
    throw new Error(
      "prerender-shells : / ne déclare plus son héros (titleKey, subtitleKey, heroTitleClass, " +
        "heroSubtitleClass dans src/config/page-sections.js) — la coquille de l'accueil ne peut pas " +
        "le publier, et l'élément LCP de « / » repasserait au JavaScript."
    )
  }
  const champEditorialManquant = Object.keys(champsEditoriaux).find((nom) => !champsEditoriaux[nom])
  if (champEditorialManquant) {
    throw new Error(
      `prerender-shells : / ne déclare plus « ${champEditorialManquant} » (src/config/page-sections.js) — ` +
        "la coquille de l'accueil publierait un `undefined` littéral à la place d'une classe, et " +
        "les deux peintures divergeraient au montage de React."
    )
  }

  // La façade de la carte du bloc de contact est déclarée UNE fois, par
  // /contact (`mapFrameClass` / `mapControlClass` / `mapButtonKey` / `icone`,
  // le repère dessiné) : la coquille de l'accueil la recopiait en littéral,
  // donc rétrécir ou déplacer la boîte d'un côté faisait sauter le bloc au
  // montage de React (CLS), et une coquille vidée de son contrôle ne
  // rougissait nulle part. Une déclaration disparue de /contact CASSE le build
  // ici.
  const { mapButtonKey, icone: iconeDeLaCarte, mapFrameClass, mapControlClass } = pageSections['/contact']
  if (!mapButtonKey || !iconeDeLaCarte || !mapFrameClass || !mapControlClass) {
    throw new Error(
      "prerender-shells : /contact ne déclare plus sa carte (mapButtonKey, icone, mapFrameClass, " +
        "mapControlClass dans src/config/page-sections.js) — le bloc de contact de l'accueil publie la même façade."
    )
  }

  // Les quatre moyens de contact du bloc ci-dessous sont déclarés UNE fois,
  // par /contact (`actions` de src/config/page-sections.js) — la même
  // déclaration que lit src/pages/Contact.js ET que le composant MapEmbed. Ce
  // bloc lisait leurs glyphes en littéral, donc changer l'icône d'un moyen de
  // contact laissait derrière lui l'appel, WhatsApp, l'e-mail ou l'adresse. La
  // correspondance est explicite (le libellé de l'accueil dit « Appeler le
  // support », celui de /contact dit « Appeler ») et une ligne disparue de
  // /contact CASSE le build au lieu de peindre une pastille vide sans que
  // personne ne le voie.
  //
  // Le glyphe est DESSINÉ (`icone`, src/config/page-icons.js) : la coquille de
  // l'accueil et la page publiaient l'emoji `iconContact*` de la clé i18n ; le
  // dessin, lui, est le même que celui des lignes de /contact et de /support.
  const contactPlan = pageSections['/contact']
  const glypheDeContact = (labelKey) => {
    const action = contactPlan.actions.find((a) => a.labelKey === labelKey)
    if (!action) {
      throw new Error(
        `prerender-shells : /contact ne déclare plus la ligne « ${labelKey} » ` +
          "(src/config/page-sections.js) — le bloc de contact de l'accueil lit ses glyphes là-bas."
      )
    }
    return svgDeLIcone(action.icone, CLASSES_ICONE.ligne)
  }

  return [
    // La navbar et les conteneurs de l'app (`.App`, `.min-h-screen`,
    // `main.flex-1`) viennent de chromeDePage() : le corps commence ici.
    // `sections-differees` : les neuf sections sous la ligne de flottaison
    // passent en `content-visibility: auto` (src/App.css, tailles intrinsèques
    // exactes, héros exclu). La page porte la MÊME classe sur son conteneur.
    `<div class="min-h-screen sections-differees">`,

    // Hero : le héros porte l'élément LCP de l'accueil — l'ILLUSTRATION depuis
    // la refonte du 27/09/2026, le titre restant le plus grand bloc de texte
    // (les deux mesurés identiques à ceux de React, une seule candidate au
    // premier paint). La composition (deux
    // colonnes, illustration encadrée) et les classes sont celles de
    // src/pages/Home.js, lues dans le plan : la bascule coquille → React ne
    // déplace rien, et c'est cette égalité qui empêche Chrome de ré-élire un
    // second élément LCP plus tardif.
    `<section class="bg-gradient-to-br from-orange-600 via-orange-600 to-orange-700 text-white relative overflow-hidden">`,
    `<div class="absolute inset-0 bg-black bg-opacity-5"></div>`,
    `<div class="${heroGrilleClass}">`,
    `<div class="${heroCopieClass}">`,
    `<span class="${heroKickerClass} mb-6">`,
    svgDeLIcone('escrow', CLASSES_ICONE.heros),
    `${esc(T('escrowBannerTitle'))}`,
    `</span>`,
    `<h1 class="${heroTitleClass}">${esc(titreTete)}`,
    titreQueue ? `<br><em class="${heroAccentClass}">${esc(titreQueue)}</em>` : '',
    `</h1>`,
    `<p class="${heroSubtitleClass}">${esc(T(subtitleKey))}</p>`,
    `<div class="${heroActionsClass}">`,
    `<a href="/register" class="${heroBoutonClass}">${esc(T('getStarted'))}</a>`,
    `<a href="/jobs" class="${heroBoutonSecondClass}">${esc(T('viewJobs'))}</a>`,
    `</div>`,
    // Bandeau de confiance (mêmes clés i18n que src/pages/Home.js).
    `<div class="${heroReperesClass}">`,
    `<span>${svgDeLIcone('escrow', CLASSES_ICONE.heros)}${esc(T('escrowTrustTitle'))}</span>`,
    `<span>${svgDeLIcone('promiseSecurePayments', CLASSES_ICONE.heros)}${esc(T('securePayments'))}</span>`,
    `<a href="/how-it-works" class="${lienFlecheClairClass}">${esc(T('howItWorksLink'))}${svgDeLIcone('flecheDroite', CLASSES_ICONE.flecheLigne)}</a>`,
    `</div>`,
    `</div>`,
    // LA PHOTO DU HÉROS : la PREMIÈRE de la liste partagée, avec ses
    // dimensions réelles, les mêmes attributs et les mêmes classes que la page
    // (voir le commentaire de src/pages/Home.js). C'est elle que React peint à
    // son premier rendu — l'alternance ne commence qu'après — donc les deux
    // canaux peignent la même boîte, et l'élément LCP de « / » reste la peinture
    // du document. `alt=""` des deux côtés (la photo illustre le texte qui la
    // précède ; un texte de remplacement est un texte publié, donc il
    // appartiendrait au dictionnaire).
    `<div class="${heroIllustrationClass}">`,
    `<span class="${heroIllustrationFondClass}" aria-hidden="true"></span>`,
    `<img src="${esc(PHOTOS_HEROS[0])}" alt="" width="${PHOTO_HEROS_LARGEUR}" height="${PHOTO_HEROS_HAUTEUR}" fetchpriority="high" decoding="async" class="${heroIllustrationImageClass}">`,
    `</div>`,
    `</div>`,
    `</section>`,

    // Le RUBAN DES PAYS : les quatre noms du référentiel partagé, dans l'ordre
    // que la page publie, avec le MÊME dessin de drapeau et les MÊMES classes
    // des deux côtés — c'est la classe du drapeau qui fixe la hauteur du jeton,
    // donc la géométrie du ruban.
    `<section class="${rubanClass}">`,
    `<div class="${rubanInnerClass}">`,
    `<span class="${rubanEtiquetteClass}">${svgDeLIcone('countryGlobe', CLASSES_ICONE.pastille)}${esc(T('availableIn4Countries'))}</span>`,
    `<div class="${rubanJetonsClass}">`,
    ...COUNTRIES.map((country) => {
      // Le drapeau est DESSINÉ, comme chez React (`FlagIcon`, qui passe par le
      // même registre) : c'était le dernier emoji de cette coquille, et la seule
      // chose qui dépendît de la police du VISITEUR. Un pays sans dessin fait
      // ÉCHOUER le build — le HTML pré-rendu n'a pas le droit de peindre un
      // drapeau qu'il ne sait pas dessiner (il en publiait un blanc, « 🏳️ »).
      const drapeau = nomDuDrapeau(country.code)
      if (!drapeau) {
        throw new Error(
          `prerender-home : le pays « ${country.code} » (${country.name}) n’a pas de drapeau dessiné — ` +
            'déclarez-le dans src/config/flags.js (registre DRAPEAUX), sinon la coquille ' +
            'publierait un drapeau vide ou un emoji selon la police de l’hôte.'
        )
      }
      return (
        // LE JETON EST UN LIEN (même adresse que la page : `/jobs` filtré sur
        // le pays, `country` étant un paramètre que `GET /api/jobs` accepte
        // depuis toujours). Un crawler qui ne lit pas le JavaScript atteint
        // donc les offres de chaque pays sans passer par l'accueil React.
        `<a href="/jobs?country=${esc(country.code)}" class="${rubanJetonClass}">` +
        svgDuDrapeau(drapeau, 'h-4 w-6 rounded-sm') +
        `${esc(country.name)}` +
        `</a>`
      )
    }),
    `</div>`,
    `</div>`,
    `</section>`,

    // Catégories (liens INTERNES réels, avec le filtre de la liste) : des
    // LIGNES, comme la page.
    `<section class="${sectionClass} ${paperClass}">`,
    `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">`,
    `<div class="${entreeSectionClass}">`,
    `<h2 class="${headClass}">${esc(T('popularServices'))}</h2>`,
    `<p class="${sectionIntroClass}">${esc(T('findServiceYouNeed'))}</p>`,
    `</div>`,
    `<div class="${listeColonnesClass}">`,
    ...homePlan.categories.map(
      (category) =>
        `<a href="/jobs?category=${category.labelKey}" class="${ligneMetierClass}">` +
        `<span class="${pastilleClass}">${svgDeLIcone(category.icone, CLASSES_ICONE.pastille)}</span>` +
        `<span class="${nomLigneClass}">${esc(T(category.labelKey))}</span>` +
        svgDeLIcone('flecheDroite', `${CLASSES_ICONE.flecheLigne} ${flecheLigneClass}`) +
        `</a>`
    ),
    `</div>`,
    `</div>`,
    `</section>`,

    // La GALERIE : trois photos, chacune un lien vers la liste filtrée de son
    // métier. Les libellés sont les NOMS DE MÉTIER du dictionnaire (mêmes clés
    // que la liste ci-dessus) et les images sont déclarées par le plan — la
    // coquille publie donc exactement ce que React publie, y compris les
    // attributs de dimension qui réservent la boîte (aucun décalage au chargement).
    `<section class="${sectionClass} ${sandClass}">`,
    `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">`,
    `<div class="${galerieGrilleClass}">`,
    ...homePlan.galerie.map(
      ({ labelKey, image }) =>
        `<a href="/jobs?category=${labelKey}" class="${galerieCarteClass}">` +
        `<img src="${esc(image)}" alt="" width="800" height="1000" loading="lazy" decoding="async">` +
        `<span class="${galerieLegendeClass}">${esc(T(labelKey))}</span>` +
        `</a>`
    ),
    `</div>`,
    `</div>`,
    `</section>`,

    // Trois promesses
    `<section class="${sectionClass} ${paperClass}">`,
    `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">`,
    `<div class="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">`,
    ...homePlan.promises.map(
      ({ icone, titleKey, descriptionKey: textKey }) =>
        `<div class="${cardClass} ${carteClass}">` +
        `<span class="${pastilleClass} mb-5">${svgDeLIcone(icone, CLASSES_ICONE.pastille)}</span>` +
        `<h3 class="${nomLigneClass} mb-3">${esc(T(titleKey))}</h3>` +
        `<p class="${noteLigneClass}">${esc(T(textKey))}</p>` +
        `</div>`
    ),
    `</div>`,
    `</div>`,
    `</section>`,

    // Comment ça marche : trois LIGNES numérotées (le numéro vient du
    // dictionnaire, `numberKey` — jamais recompté par `index + 1`), sous
    // l'entête de la même grille — dont la première colonne porte la photo du
    // parcours, dont le chemin est lu dans le plan.
    `<section class="${sectionClass} ${sandClass}">`,
    `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">`,
    `<div class="${etapesGrilleClass}">`,
    `<div class="${etapesTeteClass}">`,
    `<h2 class="${headClass}">${esc(T('howItWorksTitle'))}</h2>`,
    `<p class="${sectionIntroClass}">${esc(T('homeHowItWorksSubtitle'))}</p>`,
    `<div class="${cadrePhotoClass}">`,
    `<img src="${esc(photoEtapes)}" alt="" width="800" height="1000" loading="lazy" decoding="async">`,
    `</div>`,
    `</div>`,
    `<div class="${listeClass}">`,
    ...homePlan.steps.map(
      ({ icone, numberKey, titleKey, descriptionKey: textKey }) =>
        // La ligne d'étape est un LIEN vers la page du parcours, comme chez
        // React : elle porte la classe des lignes cliquables (état de survol
        // compris), donc un `<div>` y peignait une affordance qui n'existait
        // pas. La flèche suit : à DROITE, puisqu'elle mène quelque part.
        `<a href="/how-it-works" class="${ligneEtapeClass}">` +
        `<span class="${pastilleCreuseClass}"><span class="text-lg font-bold">${esc(T(numberKey))}</span></span>` +
        `<span class="${pastilleClass}">${svgDeLIcone(icone, CLASSES_ICONE.pastille)}</span>` +
        `<div>` +
        `<h3 class="${nomLigneClass}">${esc(T(titleKey))}</h3>` +
        `<p class="${noteLigneClass}">${esc(T(textKey))}</p>` +
        `</div>` +
        svgDeLIcone('flecheDroite', `${CLASSES_ICONE.flecheLigne} ${flecheLigneClass}`) +
        `</a>`
    ),
    `</div>`,
    `</div>`,
    `</div>`,
    `</section>`,

    // Séquestre (confiance) : un PANNEAU en deux moitiés, l'illustration sur
    // son sol, l'estampille orange à l'angle.
    `<section class="${sectionClass} ${paperClass}">`,
    `<div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">`,
    `<div class="${panneauClass}">`,
    `<div class="${panneauArtClass}">`,
    `<span class="${panneauOrbeClass}" aria-hidden="true"></span>`,
    `<img src="/assets/kojo-paiement-securise.svg" alt="" width="620" height="500" loading="lazy" decoding="async" class="${panneauImageClass}">`,
    `<span class="${panneauEstampilleClass}">${svgDeLIcone(homePlan.icone, CLASSES_ICONE.heros)}${esc(T('securePayments'))}</span>`,
    `</div>`,
    `<div>`,
    `<h2 class="${headClass} mb-4">${esc(T('escrowTrustTitle'))}</h2>`,
    `<p class="${sectionIntroClass} mb-4">${esc(T('escrowTrustText'))}</p>`,
    `<p class="${noteLigneClass} mb-6">${esc(T('escrowTrustBullets'))}</p>`,
    `<a href="/how-it-works" class="bouton bouton-encre">${esc(T('learnMore'))}${svgDeLIcone('flecheDroite', CLASSES_ICONE.flecheLigne)}</a>`,
    `</div>`,
    `</div>`,
    `</div>`,
    `</section>`,

    // Appel à l'action : la clôture orange, deux anneaux qui débordent du cadre.
    `<section class="${ctaClass} bg-gradient-to-br from-orange-600 to-orange-700 text-white">`,
    `<div class="${ctaInnerClass}">`,
    `<h2 class="titre-section mb-6">${esc(T('joinThousands'))}</h2>`,
    `<p class="text-lg md:text-xl opacity-90">${esc(T('startConnectingToday'))}</p>`,
    `<div class="${ctaActionsClass}">`,
    `<a href="/register?type=client" class="bouton bouton-creme">${esc(T('lookingForServices'))}${svgDeLIcone('flecheDroite', CLASSES_ICONE.flecheLigne)}</a>`,
    `<a href="/register?type=worker" class="bouton bouton-contour">${esc(T('offerServices'))}${svgDeLIcone('flecheDroite', CLASSES_ICONE.flecheLigne)}</a>`,
    `</div>`,
    `</div>`,
    `</section>`,

    // Faits vérifiables (pays couverts, support) : la MÊME déclaration
    // (homePlan.stats) est lue par Home.js et par cette coquille — une seule
    // liste, deux rendus, et aucun compteur inventé (cf. page-sections.js).
    `<section class="${sectionClass} ${sandClass}">`,
    `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">`,
    `<div class="${bandeClass}">`,
    ...homePlan.stats.map(
      ({ labelKey, shellText }) =>
        `<div>` +
        `<div class="${chiffreClass} mb-2">${esc(shellText)}</div>` +
        `<div class="${noteLigneClass}">${esc(T(labelKey))}</div>` +
        `</div>`
    ),
    `</div>`,
    `</div>`,
    `</section>`,

    // Qui sommes-nous : le contenu de fond de l'accueil, ajouté après
    // un audit qui reprochait à la page ses 401 mots — un moteur n'y
    // trouvait pas de quoi comprendre QUI édite le site. Mêmes clés i18n
    // et mêmes classes que la section équivalente de src/pages/Home.js :
    // le crawler sans JavaScript et le navigateur lisent un seul texte.
    `<section class="${sectionClass} ${paperClass}">`,
    `<div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">`,
    `<div class="${entreeSectionClass}">`,
    `<h2 class="${headClass}">${esc(T('homeAboutTitle'))}</h2>`,
    `</div>`,
    `<p class="${sectionIntroClass} mb-4">${esc(T('homeAboutText1'))}</p>`,
    `<p class="${sectionIntroClass} mb-4">${esc(T('homeAboutText2'))}</p>`,
    // La phrase de couverture géographique : elle nommait les quatre pays dans
    // une section à part (les quatre cartes à drapeau) ; le ruban du héros les
    // nomme désormais un par un, et la phrase survit ici, où elle appartient.
    `<p class="${sectionIntroClass}">${esc(T('kojoConnectsDescription'))}</p>`,
    `<p class="mt-6 text-sm">`,
    `<a href="/about" class="${lienFlecheClass}">${esc(T('aboutTitle'))}</a>`,
    ` · `,
    `<a href="/contact" class="${lienFlecheClass}">${esc(T('contactTitle'))}</a>`,
    ` · `,
    `<a href="/privacy" class="${lienFlecheClass}">${esc(T('privacyTitle'))}</a>`,
    `</p>`,
    `</div>`,
    `</section>`,

    // Contact (N.A.P. + liens cliquables) : section réelle, pas un
    // bloc caché — elle est aussi dans le footer React, donc elle
    // survit au montage.
    //
    // `border-t border-gray-100` : la classe EXACTE de Home.js. Le `border-t`
    // vaut 1 px, et c'est 1 px de trop peu dans une page mise en boîte
    // (border-box) : sans lui, TOUT ce qui suit cette section était 1 px trop
    // haut dans la coquille (mesuré par la sonde de géométrie sur / et /contact
    // avant correction : le titre de la section « Nous contacter » à
    // y=5948,69 côté coquille contre 5949,69 côté React, puis les 60 textes
    // suivants au même écart). Une classe d'un seul token suffisait à décaler
    // la moitié basse de la page.
    `<section class="${sectionClass} ${sandClass} border-t border-stone-100">`,
    `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">`,
    `<div class="${entreeSectionClass}">`,
    `<h2 class="${headClass}">${esc(T('contactTitle'))}</h2>`,
    `<p class="${sectionIntroClass}">${esc(T('homeContactText'))}</p>`,
    `</div>`,
    `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl mx-auto">`,
    `<a href="tel:${esc(contact.phone)}" class="${ligneDeContactClass}">`,
    `<span class="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-orange-600">${glypheDeContact('contactCall')}</span>`,
    `<div><div class="text-sm font-semibold text-stone-900">${esc(T('homeContactCall'))}</div><div class="text-xs text-stone-500">${esc(contact.phoneDisplay)}</div></div>`,
    `</a>`,
    `<a href="${esc(contact.whatsappUrl)}" target="_blank" rel="noreferrer" class="${ligneDeContactClass}">`,
    `<span class="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">${glypheDeContact('contactWhatsapp')}</span>`,
    `<div><div class="text-sm font-semibold text-stone-900">${esc(T('contactWhatsapp'))}</div><div class="text-xs text-stone-500">${esc(contact.phoneDisplay)}</div></div>`,
    `</a>`,
    `<a href="mailto:${esc(contact.email)}?subject=Contact%20KOJO" class="${ligneDeContactClass}">`,
    `<span class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600">${glypheDeContact('contactSendEmail')}</span>`,
    `<div><div class="text-sm font-semibold text-stone-900">${esc(T('contactSendEmail'))}</div><div class="text-xs text-stone-500 break-all">${esc(contact.email)}</div></div>`,
    `</a>`,
    `<a href="${esc(contact.mapsUrl)}" target="_blank" rel="noreferrer" aria-label="Google Maps" title="Google Maps" class="${ligneDeContactClass}">`,
    `<span class="flex h-10 w-10 items-center justify-center rounded-full bg-stone-100 text-stone-600">${glypheDeContact('contactAddress')}</span>`,
    `<div><div class="text-sm font-semibold text-stone-900">${esc(T('contactAddress'))}</div><div class="text-xs text-stone-500">${esc(contact.address)}</div></div>`,
    `</a>`,
    `</div>`,
    // Bloc social : les MÊMES profils que le footer React et que le
    // `sameAs` du LocalBusiness — une seule source,
    // src/config/social-networks.json + VITE_SOCIAL_* (le tableau
    // `socialLinks` est celui du footer juste en dessous). Il est ici,
    // dans le corps de page, et pas seulement au pied de page : c'est
    // le corps qu'un audit « liens sociaux » lit, et un crawler sans
    // JavaScript n'a pas d'autre moyen de voir ces liens.
    ...(socialLinks.length
      ? [
          `<div class="mt-8 ${cardClass} bg-stone-50 ${carteClass} text-center">`,
          `<h3 class="text-lg font-semibold text-stone-900 mb-3">${esc(T('homeContactFollow'))}</h3>`,
          `<div class="flex flex-wrap items-center justify-center gap-4 text-sm text-orange-700">`,
          ...socialLinks.map(
            (social) =>
              `<a href="${esc(social.url)}" target="_blank" rel="me noreferrer" class="font-medium hover:text-orange-800 underline underline-offset-2">${esc(social.label)}</a>`
          ),
          `</div>`,
          `</div>`,
        ]
      : []),
    // La carte : un CONTRÔLE, pas un embed au premier écran — le MÊME que
    // /contact, lu dans la MÊME déclaration (mapButtonKey / icone /
    // mapFrameClass / mapControlClass de src/config/page-sections.js). La
    // coquille publiait l'iframe `output=embed` elle-même, en `loading="lazy"`
    // — et cela n'a rien empêché : mesuré (Lighthouse 12.6.1, pile de la CI,
    // Chrome 152), le navigateur charge une iframe dès qu'elle approche du
    // viewport, et sur desktop elle y est déjà. Le contrôle est un lien réel
    // vers la fiche Google (il fonctionne sans JavaScript, et c'est lui qu'un
    // audit « Google Business Profile » cherche), que React transforme en carte
    // intégrée à l'appui. Les deux canaux publiant les mêmes classes, la
    // bascule coquille → React ne déplace rien.
    `<div class="${contactPlan.mapFrameClass}">`,
    svgDeLIcone(contactPlan.icone, CLASSES_ICONE.carteContact),
    `<a href="${esc(contact.mapsUrl)}" target="_blank" rel="noreferrer" title="${esc(T('mapIframeTitle').replace('{address}', contact.address))}" class="${contactPlan.mapControlClass}">${esc(T(contactPlan.mapButtonKey))}</a>`,
    `</div>`,
    `</div>`,
    `</section>`,
    `</div>`,

    // Le PIED DE PAGE n'est PAS ici : il appartient au CHROME de
    // l'application (`piedDePage` d'app-chrome.js), qui le publie après
    // `</main>` pour toutes les routes — l'endroit exact où React le rend.
    // Écrit ici, il vivait DANS `main`, donc au-dessus du `pb-24` mobile :
    // mesuré à 412×823, ses liens étaient 97 px trop haut et son rang de
    // liens se répartissait autrement que celui de React.
  ].join('')
}

