// Extension explicite, et attribut sur l'import JSON : ce fichier est chargé par
// Node (vite.config.js écrit les coquilles pré-rendues avec lui) autant que par
// le bundle — Node n'exécute pas d'import relatif sans extension, ni d'import
// JSON sans `with { type: 'json' }`.
import { CONTACT, mailtoHref, telHref } from './contact.js';

// Plan UNIQUE du corps des six pages dont la coquille publie une LISTE :
// / (catégories, promesses, étapes, chiffres), /support (modes et lignes de
// contact), /how-it-works (étapes, garanties de séquestre, FAQ), et les pages
// de confiance /about, /contact, /privacy — celles qu'un moteur (et une régie
// publicitaire) exige avant de faire crédit au site.
//
// ── Ce que ce fichier supprime ──────────────────────────────────────────────
// Le corps de ces pages avait DEUX propriétaires : les listes de la page React
// (`PROMISES` dans About.js, `SECTIONS` dans Privacy.js, les quatre lignes de
// contact écrites à la main dans Contact.js, `HOME_COUNTRIES` et les replis de
// chiffres dans Home.js, les étapes et la FAQ de HowItWorks.js) et les mêmes
// listes recopiées en clés littérales dans les coquilles de vite.config.js. Les
// textes, eux, venaient déjà d'une seule source (src/i18n/*.json) ; ce qui
// divergeait, c'est l'ENSEMBLE : ajouter une quatrième promesse à /about ou une
// sixième question à /how-it-works ne touchait pas la coquille, et un crawler
// sans JavaScript lisait une page amputée sans qu'aucun test ne rougisse. C'est
// la classe de défaut que le dépôt a passé des semaines à supprimer (table des
// textes de page, cartes OG, bloc social) : elle est fermée ici pour les six
// pages pré-rendues qui tiennent une liste.
//
// Les clés i18n restent la SEULE source de texte (résolues dans
// src/i18n/fr.json au build, et dans la langue de l'utilisateur au runtime) : ce
// fichier déclare QUELLES clés une page publie, dans quel ordre, avec quelles
// données non textuelles (icônes, destination d'un lien, accent d'une ligne). Le
// build refuse une coquille qui ne porte pas tout ce qui est déclaré ici (voir
// `exigerCorpsDeclare` dans vite.config.js).
// Les deux formes de ligne du bloc de contact : une ligne cliquable (avec son
// survol) et une ligne de simple information. Elles servent aux DEUX canaux.
// Refonte éditoriale du 28/09/2026 : le gris froid cède la place au gris chaud
// (la gamme `stone` de Tailwind), pour que le filet d'une ligne de contact
// appartienne à la même famille que celui d'une carte.
const LIGNE_LIEN =
  'flex items-center gap-3 rounded-xl border border-stone-200 px-4 py-3 hover:bg-stone-50 transition-colors';
const LIGNE_INFO = 'flex items-center gap-3 rounded-xl border border-stone-200 px-4 py-3';

// ── La GÉOMÉTRIE du héros de l'accueil ────────────────────────────────────────
// L'ÉLÉMENT LCP DE « / » A CHANGÉ DE NATURE LE 27/09/2026, et c'est mesuré : la
// refonte éditoriale a donné au héros une ILLUSTRATION (`/assets/kojo-hero.svg`,
// 960 × 720) dont l'aire peinte dépasse celle du titre — **62 700 px² en mobile
// et 139 733 en desktop** contre 33 220 et 90 454 pour le `<h1>`, dans les DEUX
// canaux, une seule candidate, horodatée au premier paint (`e2e/
// lcp-geometrie.spec.js`, 40/40 ; le CLS de « / » reste 0,0000). Le LCP n'est
// donc plus un texte mais une image : l'invariant que la parité coquille/React
// doit tenir est le MÊME qu'avant — une seule candidate, la même aire des deux
// côtés, au premier paint — et il tient. Ce qui suit garde sa raison d'être
// pour le TITRE, qui reste le plus grand bloc de TEXTE de la page et dont la
// géométrie sert d'ancre :
//
// Le titre du héros est (avec l'illustration) l'élément LCP de « / », et la coquille pré-rendue le
// peint — mais createRoot() efface #root au montage : React reconstruit le même
// titre. Mesuré (Chrome 152, sonde LCP + trace) : un remplacement de MÊME
// TAILLE n'ajoute aucun entry LCP — la peinture de la coquille reste celle que
// le navigateur retient — alors qu'un remplacement PLUS GRAND en enregistre un
// nouveau, plus tardif, ce qui fait entrer toute la chaîne JavaScript dans le
// graphe LCP simulé de Lantern (LCP 3199 ms au lieu de 1254 ms, score 93 au
// lieu de 100). Ces deux chaînes de classes étaient recopiées face à face dans
// src/pages/Home.js et dans vite-plugins/prerender/shells-home.js : la moindre
// retouche d'un côté faisait diverger la géométrie des deux peintures EN
// SILENCE, et c'est exactement ce que le LCP ne pardonne pas. Elles ont
// maintenant UN propriétaire, ici, que les deux canaux lisent.
//
// Refonte éditoriale du 28/09/2026 : les trois paliers responsives écrits à la
// main cèdent la place à UNE classe fluide (`.titre-heros`, src/index.css) —
// les deux canaux la lisent donc par construction, et l'échelle n'a plus de
// marche à chacune des deux bornes.
//
// NOTE POUR QUI ÉCRIT UN COMMENTAIRE ICI : ne citez jamais un utilitaire
// Tailwind littéral (le nom exact, avec ses deux-points) dans cette prose.
// Tailwind lit AUSSI les commentaires : un utilitaire cité est GÉNÉRÉ dans la
// feuille servie, et s'il n'est posé nulle part, `check-css-selecteurs-morts.js`
// refuse le build pour une règle sans porteur. C'est arrivé le 28/09/2026 avec
// les trois paliers du titre du héros, cités ci-dessus avant d'être retirés.
const HERO_TITRE_CLASSES = 'titre-heros mb-5 md:mb-6';
const HERO_SOUS_TITRE_CLASSES = 'heros-lead';

// ── LA COUPURE DU TITRE DU HÉROS, DÉCLARÉE ICI ──────────────────────────────
// Le titre du héros est UNE chaîne du dictionnaire (« Trouvez un travailleur de
// confiance, payez en toute sécurité »). Le dessin veut deux lignes : la
// première en romain, la seconde en italique crème — c'est l'ornement
// typographique de la maquette de refonte. Couper la chaîne dans la page ET
// dans la coquille aurait donné deux découpages à tenir d'accord, sur CINQ
// langues ; le découpage est donc ici, à côté des classes, et les deux canaux
// lisent la MÊME fonction.
//
// La règle est celle qui marche sans connaître la langue : couper à la PREMIÈRE
// ponctuation forte, garder la ponctuation dans la première moitié. Une langue
// sans virgule (c'est le cas de plusieurs des cinq) rend une seconde moitié
// VIDE, et la page peint alors le titre d'un seul tenant — jamais une ligne
// fantôme, jamais un accent qui ne porte rien.
//
// Ce n'est pas un texte de plus : les deux moitiés sont le texte du
// dictionnaire, et le garde de provenance les retrouve des deux côtés (voir
// scripts/shell-text-provenance.js, cas « composition de textes entiers »).
export const couperLeTitre = (texte) => {
  const valeur = String(texte ?? '');
  const coupure = valeur.search(/[,;:]/);
  if (coupure === -1) return [valeur, ''];
  return [valeur.slice(0, coupure + 1), valeur.slice(coupure + 1).trim()];
};

// ── LE LANGAGE ÉDITORIAL DE L'ACCUEIL — DEUXIÈME PASSE (27/09/2026) ─────────
// Les sept champs d'`ACCUEIL` ci-dessus ont donné à la page son fond et son
// encre ; cette seconde passe lui donne son ÉCHELLE et son PAS : un héros en
// deux colonnes, des sections qui s'annoncent, des listes en lignes, un panneau
// de confiance et une clôture orange. Ce sont toujours des classes de
// src/index.css, donc les DEUX canaux les lisent par construction — et
// `exigerCorpsDeclare` refuse un build dont la coquille ne publie pas une
// déclaration.
//
// Ces noms sont ici, et pas dans les deux canaux : une retouche de dessin
// (largeur de la grille du héros, hauteur d'une ligne, fond d'un panneau) se
// fait dans la feuille, une seule fois. Les deux canaux ne portent plus que la
// STRUCTURE et les textes.
const EDITORIAL_ACCUEIL = {
  heroGrilleClass: 'heros-grille',
  heroCopieClass: 'heros-copie',
  heroActionsClass: 'heros-actions',
  heroBoutonClass: 'bouton bouton-creme',
  heroBoutonSecondClass: 'bouton bouton-contour',
  heroReperesClass: 'heros-reperes',
  heroIllustrationClass: 'cadre-illustration',
  heroIllustrationFondClass: 'cadre-fond',
  heroIllustrationImageClass: 'cadre-image',
  heroAccentClass: 'accent-heros',
  rubanClass: 'ruban-pays',
  rubanInnerClass: 'ruban-inner',
  rubanEtiquetteClass: 'ruban-etiquette',
  rubanJetonsClass: 'ruban-jetons',
  rubanJetonClass: 'ruban-jeton',
  entreeSectionClass: 'entree-section',
  listeClass: 'liste-editoriale',
  listeColonnesClass: 'liste-editoriale liste-editoriale-colonnes',
  ligneMetierClass: 'ligne-editoriale ligne-metier',
  ligneEtapeClass: 'ligne-editoriale ligne-etape',
  pastilleClass: 'pastille-rond',
  pastilleCreuseClass: 'pastille-rond pastille-rond-creuse',
  nomLigneClass: 'nom-de-ligne',
  noteLigneClass: 'note-de-ligne',
  flecheLigneClass: 'fleche-de-ligne',
  panneauClass: 'panneau-sequestre',
  panneauArtClass: 'panneau-art',
  panneauOrbeClass: 'panneau-orbe',
  panneauImageClass: 'panneau-image',
  panneauEstampilleClass: 'panneau-estampille',
  bandeClass: 'bande-chiffres',
  chiffreClass: 'chiffre',
  ctaClass: 'cta-final',
  ctaInnerClass: 'cta-final-inner',
  ctaActionsClass: 'cta-actions',
  lienFlecheClass: 'lien-fleche',
  lienFlecheClairClass: 'lien-fleche lien-fleche-clair',
  galerieGrilleClass: 'galerie-grille',
  galerieCarteClass: 'galerie-carte',
  galerieLegendeClass: 'galerie-legende',
  etapesGrilleClass: 'etapes-grille',
  etapesTeteClass: 'etapes-tete',
  cadrePhotoClass: 'cadre-photo',
};

// ── Le VOCABULAIRE ÉDITORIAL de l'accueil, déclaré une fois ──────────────────
// Les huit sections de l'accueil recopiaient chacune sa propre soupe
// d'utilitaires (taille, graisse, couleur et marge du titre, rayon, ombre et
// anneau de la carte…) dans src/pages/Home.js ET dans
// vite-plugins/prerender/shells-home.js. Changer le
// dessin d'une section demandait donc deux retouches accordées à la main, et
// rien ne rougissait quand elles divergeaient : la bascule coquille → React
// déplaçait alors la moitié de la page.
//
// Ce que déclarent les quatre champs ci-dessous, et pourquoi ce ne sont PAS des
// utilitaires : ce sont des classes de `src/index.css`, communes aux deux
// canaux. Une section AJOUTÉE demain hérite du même rythme sans que personne
// n'ait à recopier quoi que ce soit — et `exigerCorpsDeclare` (declared-body.js)
// refuse un build dont la coquille ne publie pas ces chaînes, donc une
// déclaration sans porteur CASSE le build au lieu de peindre une page muette.
// ── RE-MESURE DU 28/09/2026, APRÈS LA REFONTE ÉDITORIALE ─────────────────────
// Protocole : `cd frontend && npx playwright test e2e/lcp-geometrie.spec.js`,
// onze routes pré-rendues × deux tailles, bundle d'entrée bloqué pour la
// coquille et navigation réelle pour React. Ce que la passe a vérifié, et qui
// est l'invariant que tout ce fichier tient : sur CHAQUE route et CHAQUE taille,
// l'aire peinte est IDENTIQUE dans les deux canaux et UNE SEULE candidate est
// horodatée au premier paint. C'est cette égalité qui empêche Chrome de ré-élire
// une seconde peinture, plus tardive, déclenchée par le JavaScript.
//
// Ce que la refonte a DÉPLACÉ (et pourquoi c'est sans conséquence sur les
// planchers de `e2e/lcp-geometrie-declaree.spec.js`, calés à ≈ 70 % de la plus
// petite mesure connue) : le seul élément LCP dont la TYPOGRAPHIE a changé est
// le titre du héros de l'accueil (37 400 px² en mobile, 110 500 en desktop :
// il passe d'une échelle en paliers à `.titre-heros`), et l'en-tête de section
// de /privacy a grandi (son élément élu reste le CORPS d'une section :
// 91 140 px² en mobile, 103 896 en desktop).
//
// Les huit autres restent à moins de 4 % des valeurs écrites dans leurs
// commentaires respectifs ci-dessous : ces éléments-là n'ont reçu qu'une
// COULEUR (le gris froid devient `text-stone-*`), et une couleur ne change pas
// l'aire d'une boîte ni l'encre d'une ligne. Les valeurs des commentaires sont
// donc conservées TELLES QUELLES plutôt que réécrites d'un iota : elles datent
// d'une session de mesure précise, et les reécrire avec les chiffres d'une
// autre session ferait passer une variation d'hôte pour une variation de page.
const ACCUEIL = {
  // Le sur-titre du héros : il remplace la pastille `rounded-full` qui
  // étiquetait la page comme un produit. Pas de sur-titre sur les sections,
  // faute de texte : un chapeau demande une phrase, et la seule source de
  // texte du site est `src/i18n/*.json` — dont la parité est tenue sur cinq
  // langues par `i18nParity.test.js`. Inventer une clé ici publierait un
  // libellé français au milieu de quatre autres langues.
  heroKickerClass: 'sur-titre sur-titre-clair',
  // Les deux fonds du rythme : `papier` pour les sections claires, `sable`
  // pour celles qui alternent. Ils remplacent `bg-white` / `bg-gray-50`, dont
  // le gris froid jurait avec l'encre chaude du texte.
  paperClass: 'fond-papier',
  sandClass: 'fond-sable',
  // Le titre de section, et le paragraphe qui le suit.
  headClass: 'titre-section',
  introClass: 'text-stone-600',
  // La carte : un filet de 1 px au lieu d'une ombre large, et un rayon de 8 px
  // au lieu de 16. `-cliquable` n'est portée que par les cartes qui MÈNENT
  // quelque part (une carte informative n'a rien à promettre au survol).
  cardClass: 'carte-editoriale',
  cardLinkClass: 'carte-editoriale carte-editoriale-cliquable',
};

export const PAGE_SECTIONS = {
  // L'accueil : le corps du shell (trois promesses, trois étapes, catégories)
  // était recopié ici, liste par liste, face aux blocs de src/pages/Home.js —
  // ajouter une catégorie ou une promesse à la page laissait la coquille
  // derrière, sans que rien ne rougisse.
  '/': {
    // ── Le HÉROS : le titre, son sous-titre et leur géométrie ──────────────
    // C'était le dernier morceau du corps de l'accueil publié par la coquille
    // SANS déclaration : la coquille lisait `T('heroTitle')` en littéral, et
    // rien ne rougissait si cette ligne disparaissait — un crawler, et le
    // premier paint, perdaient alors le plus grand bloc de TEXTE de la page
    // sans qu'aucun garde ne le voie (son ILLUSTRATION est aujourd'hui l'élément
    // élu, voir plus haut — le titre reste celui dont la géométrie ancre la
    // parité des deux peintures). Déclaré ici, `exigerCorpsDeclare` refuse un build dont
    // la coquille ne porte plus le titre (le même refus que pour les
    // catégories, les promesses, les étapes et les chiffres).
    titleKey: 'heroTitle',
    subtitleKey: 'heroSubtitle',
    heroTitleClass: HERO_TITRE_CLASSES,
    heroSubtitleClass: HERO_SOUS_TITRE_CLASSES,
    // Le vocabulaire éditorial des dix sections (voir ACCUEIL et
    // EDITORIAL_ACCUEIL plus haut) : un seul propriétaire par classe, lu par
    // src/pages/Home.js ET par vite-plugins/prerender/shells-home.js.
    ...EDITORIAL_ACCUEIL,
    heroKickerClass: ACCUEIL.heroKickerClass,
    headClass: ACCUEIL.headClass,
    sectionIntroClass: ACCUEIL.introClass,
    cardClass: ACCUEIL.cardClass,
    cardLinkClass: ACCUEIL.cardLinkClass,
    paperClass: ACCUEIL.paperClass,
    sandClass: ACCUEIL.sandClass,
    categories: [
      // `labelKey` est AUSSI le code de catégorie canonique du backend : le
      // libellé affiché et le filtre de /jobs sortent donc de la même valeur.
      { labelKey: 'general', icone: 'categoryGeneral' },
      { labelKey: 'plumbing', icone: 'categoryPlumbing' },
      { labelKey: 'electrical', icone: 'categoryElectrical' },
      { labelKey: 'construction', icone: 'categoryConstruction' },
      { labelKey: 'cleaning', icone: 'categoryCleaning' },
      { labelKey: 'gardening', icone: 'categoryGardening' },
      { labelKey: 'tutoring', icone: 'categoryTutoring' },
      { labelKey: 'mechanics', icone: 'categoryMechanics' },
      { labelKey: 'carpentry', icone: 'categoryCarpentry' },
      { labelKey: 'computing', icone: 'categoryComputing' },
    ],
    promises: [
      { icone: 'promiseFindWork', titleKey: 'findWork', descriptionKey: 'findWorkDescription' },
      { icone: 'promiseConnect', titleKey: 'connect', descriptionKey: 'connectDescription' },
      { icone: 'promiseSecurePayments', titleKey: 'securePayments', descriptionKey: 'securePaymentsDescription' },
    ],
    // `numberKey` porte le NUMÉRO de l'étape (« 1 », « 2 », « 3 » du
    // dictionnaire) : la pastille qui en fait une marche à suivre est publiée
    // par la page ET par sa coquille, donc le numéro a un propriétaire unique
    // au lieu d'être recompté par `index + 1` de chaque côté.
    steps: [
      { icone: 'step1', numberKey: 'stepNumber1', titleKey: 'homeStep1Title', descriptionKey: 'homeStep1Desc' },
      { icone: 'step2', numberKey: 'stepNumber2', titleKey: 'homeStep2Title', descriptionKey: 'homeStep2Desc' },
      { icone: 'step3', numberKey: 'stepNumber3', titleKey: 'homeStep3Title', descriptionKey: 'homeStep3Desc' },
    ],
    // ── LA PHOTO DU PARCOURS ─────────────────────────────────────────────
    // La colonne de gauche de « comment ça marche » reçoit une photo, et son
    // CHEMIN est déclaré ici : les deux canaux la publient depuis le même
    // domicile, avec les mêmes dimensions réservées. Elle est sous la ligne de
    // flottaison et en `lazy`, donc hors du premier écran et hors du graphe du
    // LCP. Aucune légende : il n'existe pas de clé de dictionnaire pour une
    // phrase sous cette photo, et la seule source de texte du site est
    // src/i18n/*.json.
    photoEtapes: '/assets/kojo-jardinage.jpg',

    // ── LA GALERIE : trois métiers en photo ──────────────────────────────
    // La page parlait de travailleurs sans en montrer un seul. Les trois
    // libellés sont des CLÉS DU DICTIONNAIRE (les mêmes noms de métier que la
    // liste des catégories) : aucune phrase n'a été inventée pour l'occasion, et
    // chaque carte mène à la liste filtrée de son métier. Les images vivent dans
    // `public/assets/`, ré-échantillonnées à 800 × 1 000 et recompressées (voir
    // src/index.css) : elles sont SOUS la ligne de flottaison, en `lazy`, donc
    // hors du graphe du LCP.
    galerie: [
      { labelKey: 'plumbing', image: '/assets/kojo-metier-plomberie.jpg' },
      { labelKey: 'electrical', image: '/assets/kojo-metier-electricite.jpg' },
      { labelKey: 'carpentry', image: '/assets/kojo-metier-menuiserie.jpg' },
    ],
    // Les chiffres de l'accueil — des FAITS VÉRIFIABLES, jamais des compteurs
    // inventés. Les deux anciens (« 1 000+ travailleurs », « 500+ projets »)
    // étaient des replis FABRIQUÉS avant l'appel à /public/stats : le HTML
    // pré-rendu les publiait donc à un crawler, et le premier paint les
    // affichait à un visiteur, comme s'ils étaient mesurés. Ils sont RETIRÉS
    // (règle « pas de faux compteurs »). « 24/7 » l'était aussi : le support
    // répond du lundi au samedi (cf. contactIntro), donc la valeur dit « 6j/7 ».
    // `shellText` est le texte EXACT que la coquille écrit ; `fallback` la même
    // valeur côté page — les deux sortent d'ici, une seule liste.
    stats: [
      { labelKey: 'countriesCovered', fallback: '4', shellText: '4' },
      { labelKey: 'customerSupport', fallback: '6j/7', shellText: '6j/7' },
    ],
    // Le bloc « séquestre » de l'accueil ouvre sur un glyphe que la page
    // (src/pages/Home.js) et sa coquille publiaient chacune en littéral — le
    // même bouclier, deux domiciles. Comme les icônes des listes, il est
    // déclaré ici : `icone` nomme une icône DESSINÉE (src/config/page-icons.js),
    // que la page et la coquille rendent par le même composant — les deux
    // canaux ne peuvent pas publier deux dessins différents (ni un emoji d'un
    // côté et un SVG de l'autre, ce qui était le cas avant).
    icone: 'escrow',
  },

  // /how-it-works : la coquille répliquait TROIS listes de src/pages/HowItWorks.js
  // — les trois étapes, les quatre garanties de séquestre et les cinq questions
  // de la FAQ — écrites en littéraux au mauvais endroit. Ajouter une question à
  // la page laissait la coquille derrière, en silence : le même défaut que les
  // pages de confiance, sur une page de contenu.
  '/how-it-works': {
    // Les trois étapes publiaient l'emoji de leur clé (`iconHowStep1`,
    // `iconEscrow`, `iconHowStep3`). Elles déclarent maintenant des icônes
    // DESSINÉES (`icone`, src/config/page-icons.js) : le bouclier de l'étape 2
    // est le MÊME contenu que le séquestre de l'accueil et que le bloc de
    // séquestre de CETTE page (`icone: 'escrow'`, plus bas), donc un seul
    // dessin pour les trois emplacements — c'était déjà l'intention de la clé
    // partagée, mais la page et la coquille en publiaient encore un emoji.
    steps: [
      { icone: 'howStep1', titleKey: 'howStep1Title', descriptionKey: 'howStep1Desc' },
      { icone: 'escrow', titleKey: 'howStep2Title', descriptionKey: 'howStep2Desc' },
      { icone: 'howStep3', titleKey: 'howStep3Title', descriptionKey: 'howStep3Desc' },
    ],
    // Le glyphe du bloc « séquestre détaillé » (le même bouclier dessiné) et le
    // repère du dépliant de la FAQ : le repère reste une clé i18n, le glyphe est
    // une icône dessinée.
    icone: 'escrow',
    faqMarkerKey: 'faqMarker',
    // Les garanties sont des CLÉS i18n : le nom du champ finit par `Key`, donc
    // la coquille doit publier leur TEXTE résolu, pas la clé.
    guaranteeKeys: [
      'escrowGuarantee1',
      'escrowGuarantee2',
      'escrowGuarantee3',
      'escrowGuarantee4',
    ],
    faq: [
      { questionKey: 'faq1q', answerKey: 'faq1a' },
      { questionKey: 'faq2q', answerKey: 'faq2a' },
      { questionKey: 'faq3q', answerKey: 'faq3a' },
      { questionKey: 'faq4q', answerKey: 'faq4a' },
      { questionKey: 'faq5q', answerKey: 'faq5a' },
    ],
    titleKey: 'howItWorksTitle',
    heroKey: 'howItWorksHero',
    // ── La GÉOMÉTRIE du plus grand texte peint ────────────────────────────
    // L'élément LCP de /how-it-works est le SOUS-TITRE du héros (« Trouver un
    // travailleur ou une mission… »). Mesuré le 25/09/2026 comme sur /jobs
    // (deux canaux, deux tailles) : UNE SEULE candidate, au premier paint, sur
    // ce paragraphe, d'aire IDENTIQUE — 30 320 px² mobile, 32 656 px² desktop.
    // Re-mesuré le 26/09/2026 avec la police SERVIE PAR LE SITE : 26 334 /
    // 32 928 px² (voir /login — la police n'est plus celle de l'hôte).
    //
    // `heroFrameClass` porte la largeur du héros (donc le retour à la ligne du
    // sous-titre, qui porte lui-même son `max-w-2xl`), `heroSubtitleClass` sa
    // hauteur, et `heroTitleClass` le texte qui le précède et pourrait lui
    // prendre le LCP. Les trois étaient recopiées dans src/pages/HowItWorks.js
    // et vite-plugins/prerender/shells-routes.js.
    heroFrameClass: 'max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16 text-center',
    heroTitleClass: 'titre-page mb-4',
    heroSubtitleClass: 'text-lg text-stone-600 max-w-2xl mx-auto',
    escrowTitleKey: 'escrowWhatTitle',
    escrowTextKey: 'escrowWhatText',
    faqTitleKey: 'faqTitle',
    readyTitleKey: 'readyToStart',
    lookingKey: 'lookingForServices',
    offerKey: 'offerServices',
    links: [
      { to: '/jobs', labelKey: 'viewJobs' },
      { to: '/support', labelKey: 'support' },
    ],
  },

  // /jobs : le titre et le PARAGRAPHE D'INTRODUCTION. L'intro n'est pas un
  // ornement : c'est le plus grand bloc de texte de la page, donc son élément
  // LCP, et c'est la coquille qui le peint — avant tout JavaScript, à l'instant
  // du premier paint.
  //
  // Ce qu'elle corrige, mesuré (Lighthouse mobile, pile de la CI, 3 runs) :
  // sans elle, le plus grand texte peint était celui de l'état vide, qui
  // n'existe QU'APRÈS la réponse de /api/jobs. LCP 3111 / 3071 / 3106 ms, dont
  // 2657 / 2617 / 2656 ms de `Render Delay` — c'est-à-dire le temps de réponse
  // du backend, à la milliseconde près, dans le chemin critique du LCP. Le
  // premier paint, lui, était déjà à 1473 / 1459 / 1454 ms : la page avait 1,6 s
  // de marge qu'aucun bloc assez grand ne venait occuper.
  //
  // Déclarée ici, l'intro a UN propriétaire pour deux canaux : la page la rend
  // par `t()`, la coquille la peint par `jobsT()` (voir `exigerCorpsDeclare`),
  // donc aucune des deux ne peut la perdre en silence.
  '/jobs': {
    titleKey: 'availableJobs',
    introKey: 'intro',
    // ── La GÉOMÉTRIE du plus grand texte peint ────────────────────────────
    // L'élément LCP de /jobs est le paragraphe d'introduction, et c'est la
    // coquille qui le peint. Mesuré le 25/09/2026 (Chrome 152, sonde des
    // candidates `largest-contentful-paint`, bundle d'entrée BLOQUÉ pour le
    // canal coquille et navigation réelle pour l'autre, 412×823 et
    // 1350×940) : UNE SEULE candidate dans les deux canaux, horodatée au
    // premier paint (t = 112 ms mobile / 88 ms desktop pour la coquille,
    // 84 / 80 ms pour React), sur ce paragraphe, d'AIRE IDENTIQUE de part et
    // d'autre — 35 640 px² mobile et 36 002 px² desktop.
    // Re-mesuré le 26/09/2026 avec la police SERVIE PAR LE SITE : 36 750 /
    // 35 144 px² (voir /login — la police n'est plus celle de l'hôte).
    //
    // Ces chaînes étaient recopiées face à face dans src/pages/Jobs.js et
    // vite-plugins/prerender/shells-routes.js (le commentaire de la coquille
    // disait lui-même « ses classes sont celles de src/pages/Jobs.js, à
    // l'identique ») : la moindre retouche d'un côté faisait diverger les deux
    // peintures EN SILENCE, et c'est exactement ce que le LCP ne pardonne pas
    // (un remplacement PLUS GRAND ré-élit un élément, toute la chaîne
    // JavaScript entre alors dans le graphe LCP simulé — mesuré sur cette
    // page avant correctif : `elementRenderDelay` de 1156 à 2345 ms, score
    // desktop 92 au lieu de 100). Elles ont UN propriétaire, ici.
    //
    // `frameClass` porte la LARGEUR du paragraphe (donc son retour à la
    // ligne), `introClass` sa hauteur — dont les 104 px / 52 px RÉSERVÉS, que
    // le squelette de Suspense doit réserver à l'identique (voir
    // `antiClsSkeletons.test.jsx`) — et `titleClass` le seul autre texte
    // capable de prendre le LCP au paragraphe.
    // `min-h-screen` : la coquille de /jobs ne peint que l'en-tête et l'intro
    // (~794 px), donc avec `main.flex-1` le pied de page tombait EXACTEMENT au
    // bas de la viewport (mesuré 1350×940 : footer à y=859, hauteur 81 — soit
    // 81/940 = 0,0862, la valeur d'un CLS où il quitte l'écran ; idem 412×823).
    // React, lui, peint la liste : son pied de page naît hors écran (y≈2631).
    // Le pied de page était donc le SEUL élément à voyager du bas de la
    // viewport vers le hors-écran à la bascule coquille → React. Réserver la
    // viewport dans la coquille (comme les pages de contenu /about, /contact,
    // /privacy, /terms, dont le conteneur racine porte `min-h-screen`) le place
    // hors écran DÈS le premier paint des deux canaux : plus rien à déplacer.
    // Côté React la réserve est inerte (la page dépasse déjà la viewport aux
    // deux tailles mesurées), donc aucune peinture ne bouge.
    frameClass: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 min-h-screen',
    titleClass: 'titre-page',
    introClass: 'mb-6 max-w-3xl text-base leading-relaxed text-stone-600 min-h-[104px] md:min-h-[52px]',
  },

  '/login': {
    titleKey: 'login',
    emailLabelKey: 'email',
    passwordLabelKey: 'password',
    forgotPasswordLinkKey: 'forgotPasswordLink',
    submitKey: 'login',
    googleLoginKey: 'googleLogin',
    legalNoticeTitleKey: 'legalNoticeTitle',
    legalConsentLinkKey: 'legalConsentLink',
    legalContactLineKey: 'legalContactLine',
    // ── La GÉOMÉTRIE du plus grand texte peint ───────────────────────────
    // L'élément LCP de /login n'est ni le titre ni le bouton : c'est la LIGNE
    // LÉGALE de contact, en bas du formulaire. Mesuré le 26/09/2026 (Chrome
    // 152, sonde des candidates `largest-contentful-paint`, navigation réelle,
    // 412×823 et 1350×940) : UNE SEULE candidate par taille, horodatée au
    // premier paint — 15 040 px² mobile / 12 834 px² desktop. La même passe a
    // établi les trois autres routes de ce groupe :
    //   /register          notice d'étape (`stepNoticeClass`)    9 548 / 12 338
    //   /forgot-password   sous-titre (`subtitleClass`)         13 690 / 16 095
    //   /support           sous-titre (`subtitleClass`)         16 720 / 9 480
    // CES AIRES SONT CELLES DE LA POLICE SERVIE PAR LE SITE (src/index.css), et
    // c'est nouveau : tant que le texte était rendu par la police de l'hôte,
    // elles valaient jusqu'à 18 % de moins sur le runner Linux de la CI
    // (/support desktop 7 616 contre 9 324 ici, à boîte d'élément identique —
    // c'est l'encre qui change, pas le cadre), et les planchers de
    // `e2e/lcp-geometrie-declaree.spec.js` devaient se caler sur la plus petite
    // des DEUX machines. La même police pour tous les hôtes, mesurée telle
    // qu'elle est publiée : c'est ce que l'auto-hébergement a acheté.
    // La chaîne était recopiée face à face dans src/pages/Login.js et
    // vite-plugins/prerender/shells-routes.js : une retouche d'un seul côté
    // faisait diverger les deux peintures en silence, et une seconde peinture
    // PLUS GRANDE devient un nouvel élément LCP.
    legalContactClass: 'text-xs text-stone-600',
    // Le glyphe du bloc légal est DESSINÉ (page-icons.js) : le plan nomme une
    // icône, pas une clé i18n d'emoji (`iconLegalNotice` reste au dictionnaire
    // comme valeur interdite pour les coquilles, cf. check-prerender-shells).
    legalNoticeIcon: 'legalNotice',
    noAccountKey: 'noAccount',
    registerKey: 'register',
  },

  '/register': {
    titleKey: 'title',
    subtitleKey: 'subtitle',
    detectingLocationKey: 'detectingLocation',
    step1TitleKey: 'personalInformation',
    step2TitleKey: 'stepEmail',
    step3TitleKey: 'stepPayments',
    // Les numéros des trois pastilles de progression : la page les écrivait
    // « 1 », « 2 », « 3 » et la coquille les recopiait. Le rang d'une étape
    // est un fragment publié comme un autre, donc une clé i18n.
    step1NumberKey: 'stepNumber1',
    step2NumberKey: 'stepNumber2',
    step3NumberKey: 'stepNumber3',
    stepNoticeKey: 'clientStepNotice',
    // La chaîne de la notice d'étape EST l'élément LCP de la page (mesuré :
    // 10 048 px² mobile / 12 544 desktop après le passage de son ⚠️ de l'emoji
    // au SVG, puis 9 548 / 12 338 le 26/09/2026 avec la police servie par le
    // site — UNE candidate au premier paint) — déclarée ici pour que les deux
    // canaux la lisent (voir /login).
    stepNoticeClass: 'text-xs text-amber-800 mt-3',
    stepNoticeIcon: 'stepNotice',
    clientIcon: 'client',
    // Le marteau du travailleur est le wrench déjà dessiné pour la catégorie
    // « plomberie » : un même contenu, jamais recopié.
    workerIcon: 'categoryPlumbing',
    photoIcon: 'profilePhoto',
    // Les CONSEILS photo de src/components/ProfilePhotoUpload.js : un bloc
    // entier (216,56 px mesurés à 412×823) que la coquille oubliait de
    // publier. Déclaré ici, il devient une partie du corps que la coquille
    // DOIT porter (`exigerCorpsDeclare`), et la sonde de géométrie le mesure
    // des deux côtés — avant, tout le bas du formulaire d'inscription montait
    // de 232 px au montage de React.
    photoTipsIcon: 'photoTips',
    // Les deux glyphes du sélecteur de pays (src/components/CountryDisplay.js :
    // le globe affiché tant qu'aucun pays n'est choisi, et le chevron du
    // menu). La coquille publiait un `<select>` à la place de ce contrôle :
    // un élément DIFFÉRENT, 1 px moins haut — mesuré, tout le bas du
    // formulaire (47 textes) était 1 px trop haut.
    countryGlobeIcon: 'countryGlobe',
    countryChevronIcon: 'countryChevron',
    photoTipsTitleKey: 'tipsGoodPhoto',
    photoTipsKeys: ['useRecentPhoto', 'lookCamera', 'avoidGroup', 'neutralBackground'],
    // Le glyphe du bloc légal est DESSINÉ (page-icons.js) : le plan nomme une
    // icône, pas une clé i18n d'emoji (`iconLegalNotice` reste au dictionnaire
    // comme valeur interdite pour les coquilles, cf. check-prerender-shells).
    legalNoticeIcon: 'legalNotice',
    googleSignupKey: 'googleSignup',
    orSeparatorKey: 'orSeparator',
    userTypeKey: 'userType',
    clientKey: 'client',
    iAmClientKey: 'iAmClient',
    workerKey: 'worker',
    iAmWorkerKey: 'iAmWorker',
    countryKey: 'country',
    firstNameKey: 'firstName',
    lastNameKey: 'lastName',
    emailKey: 'email',
    emailPlaceholderKey: 'emailPlaceholder',
    phoneKey: 'phone',
    phoneFormatHintKey: 'phoneFormatHint',
    passwordKey: 'password',
    passwordTooShortKey: 'passwordTooShort',
    confirmPasswordKey: 'confirmPassword',
    profilePhotoOptionalKey: 'profilePhotoOptional',
    profilePhotoHelpsKey: 'profilePhotoHelps',
    addProfilePhotoKey: 'addProfilePhoto',
    clickToChooseOptionKey: 'clickToChooseOption',
    upToKey: 'upTo',
    detectingLanguageKey: 'detectingLanguage',
    legalNoticeTitleKey: 'legalNoticeTitle',
    legalConsentHelpKey: 'legalConsentHelp',
    legalConsentLinkKey: 'legalConsentLink',
    legalConsentLabelKey: 'legalConsentLabel',
    legalContactLineKey: 'legalContactLine',
    continueButtonKey: 'continueButton',
    signInPromptKey: 'signInPrompt',
    signInKey: 'signIn',
  },

  '/forgot-password': {
    // La pastille de l'étape e-mail : glyphe publié par la page et par la
    // coquille, donc déclaré une fois.
    // L'enveloppe de la réinitialisation est l'e-mail déjà dessiné pour le
    // contact (`contactSendEmail`) : un même contenu, jamais recopié.
    badgeIcon: 'contactSendEmail',
    titleKey: 'forgotPasswordPageTitle',
    subtitleKey: 'forgotPasswordSubtitle',
    // Le sous-titre est l'élément LCP de la page (mesuré : 14 001 px² mobile /
    // 16 458 desktop, UNE candidate au premier paint) — voir /login.
    subtitleClass: 'mt-3 text-sm text-stone-600',
    stepEmailKey: 'forgotPasswordStepEmail',
    stepCodeKey: 'forgotPasswordStepCode',
    stepPasswordKey: 'forgotPasswordStepPassword',
    emailLabelKey: 'forgotPasswordEmailLabel',
    emailPlaceholderKey: 'email',
    requestMessageKey: 'forgotPasswordRequestMessage',
    sendCodeKey: 'forgotPasswordSendCode',
    backToLoginKey: 'forgotPasswordBackToLogin',
  },

  '/payment': {
    // Le glyphe de la carte « mission requise » (état par défaut, celui que
    // publie la coquille).
    // La mallette de la carte « mission requise » est celle des promesses de
    // l'accueil (`promiseFindWork`) : un même contenu, jamais recopié.
    noJobIcon: 'promiseFindWork',
    titleKey: 'paymentPageTitle',
    subtitleKey: 'paymentPageSubtitle',
    noJobTitleKey: 'paymentPageNoJobTitle',
    noJobTextKey: 'paymentPageNoJobText',
    noJobCtaKey: 'paymentPageNoJobCta',
  },

  // /support : le bloc de contact de la coquille était recopié, libellé par
  // libellé, face au dictionnaire local de src/pages/Support.js — et cinq
  // textes du suivi de ticket (titre, sous-titre, deux placeholders, bouton)
  // étaient écrits EN DUR dans la coquille elle-même. Plus aucun texte ici :
  // les libellés sont des CLÉS i18n comme pour les cinq autres pages,
  // src/i18n/*.json en est le seul propriétaire, la page les lit au runtime et
  // la coquille au build.
  '/support': {
    // Le titre de la page EST le libellé de son lien (même clé que le pied de
    // page et la page de contact) : un seul texte pour un seul mot.
    titleKey: 'support',
    subtitleKey: 'supportSubtitle',
    // Le sous-titre est l'élément LCP de la page (mesuré : 16 720 px² mobile /
    // 9 480 desktop avec la police servie — voir /login) — UNE candidate au
    // premier paint. La chaîne
    // est courte (`text-gray-600`) mais elle n'apparaît plus ailleurs dans
    // Support.js ni dans le corps de sa coquille : elle a bien un propriétaire
    // unique.
    subtitleClass: 'text-stone-600',
    // La carte de contact publie le titre du mode « contact direct » — même
    // texte, donc même clé (elle était écrite deux fois dans le dictionnaire).
    directCard: {
      titleKey: 'supportDirectTitle',
      subtitleKey: 'supportDirectCardSubtitle',
    },
    // Le suivi de ticket est PUBLIC et visible avant toute interaction : la
    // coquille le publie, donc ses textes se déclarent ici comme les autres.
    tracker: {
      titleKey: 'supportTrackTitle',
      subtitleKey: 'supportTrackSubtitle',
      idPlaceholderKey: 'supportTicketIdPlaceholder',
      emailPlaceholderKey: 'supportTicketEmailPlaceholder',
      ctaKey: 'supportTrackCta',
    },
    modes: [
      // Le glyphe du mode est DESSINÉ : la page publiait déjà un composant
      // lucide (`Bot`, `Phone`) là où la coquille publiait l'emoji de la clé —
      // deux dessins pour un même mode. Les deux canaux lisent maintenant le
      // même `icone`, et la couleur vient du `badgeClass` (`currentColor`).
      {
        icone: 'supportRobot',
        badgeClass: 'bg-orange-100 text-orange-600',
        titleKey: 'supportRobotTitle',
        subtitleKey: 'supportRobotSubtitle',
      },
      {
        icone: 'contactCall',
        badgeClass: 'bg-emerald-100 text-emerald-600',
        titleKey: 'supportDirectTitle',
        subtitleKey: 'supportDirectSubtitle',
      },
    ],
    rows: [
      {
        icone: 'contactCall',
        labelKey: 'contactCall',
        badgeClass: 'bg-orange-100 text-orange-600',
        href: telHref,
        value: CONTACT.phoneDisplay,
        rowClass: LIGNE_LIEN,
      },
      {
        icone: 'contactWhatsapp',
        labelKey: 'contactWhatsapp',
        badgeClass: 'bg-emerald-100 text-emerald-600',
        href: CONTACT.whatsappUrl,
        value: CONTACT.phoneDisplay,
        external: true,
        rowClass: LIGNE_LIEN,
      },
      {
        icone: 'contactSendEmail',
        labelKey: 'contactSendEmail',
        badgeClass: 'bg-blue-100 text-blue-600',
        href: mailtoHref,
        value: CONTACT.email,
        breakAll: true,
        rowClass: LIGNE_LIEN,
      },
      {
        icone: 'contactAddress',
        labelKey: 'contactAddress',
        badgeClass: 'bg-stone-100 text-stone-600',
        value: CONTACT.address,
        rowClass: LIGNE_INFO,
      },
    ],
    links: [
      { to: '/how-it-works', labelKey: 'howItWorksTitle' },
      { to: '/jobs', labelKey: 'viewJobs' },
    ],
  },

  '/about': {
    titleKey: 'aboutTitle',
    introKey: 'aboutIntro',
    // ── La GÉOMÉTRIE du plus grand texte peint ────────────────────────────
    // L'élément LCP de /about est le paragraphe d'introduction. Mesuré le
    // 25/09/2026 comme sur /jobs (deux canaux, deux tailles) : UNE SEULE
    // candidate, au premier paint (coquille t = 112 / 116 ms, React 88 / 112),
    // sur ce paragraphe, d'aire IDENTIQUE — 74 466 px² mobile, 80 262 px²
    // desktop ; re-mesuré le 26/09/2026 avec la police servie par le site :
    // 82 940 / 79 540 px² (voir /login). C'est cette ÉGALITÉ qui tient la garantie : createRoot efface
    // #root, React reconstruit le même paragraphe, et un remplacement de MÊME
    // TAILLE n'enregistre aucun nouvel élément LCP.
    //
    // Les trois chaînes étaient recopiées dans src/pages/About.js et
    // vite-plugins/prerender/shells-routes.js. `frameClass` porte la largeur
    // (donc le retour à la ligne du paragraphe), `introClass` sa hauteur, et
    // `titleClass` le seul autre texte qui puisse prendre le LCP.
    frameClass: 'max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12',
    titleClass: 'titre-page mb-4',
    introClass: 'text-stone-600 mb-8',
    // Les trois promesses publiaient l'emoji de leur clé (`iconPromise*`) ;
    // l'accueil, lui, DESSINE déjà ces trois mêmes icônes (`icone:
    // 'promise*'`). Elles sont maintenant déclarées de la même façon ici, donc
    // /about et l'accueil publient le même dessin au lieu d'un emoji d'un côté
    // et d'un SVG de l'autre.
    cards: [
      { icone: 'promiseFindWork', titleKey: 'findWork', descriptionKey: 'findWorkDescription' },
      { icone: 'promiseConnect', titleKey: 'connect', descriptionKey: 'connectDescription' },
      { icone: 'promiseSecurePayments', titleKey: 'securePayments', descriptionKey: 'securePaymentsDescription' },
    ],
    highlight: {
      titleKey: 'escrowTrustTitle',
      textKey: 'escrowTrustText',
      bulletsKey: 'escrowTrustBullets',
    },
    links: [
      { to: '/contact', labelKey: 'contactTitle' },
      { to: '/privacy', labelKey: 'privacyTitle' },
      { to: '/how-it-works', labelKey: 'howItWorksTitle' },
    ],
  },

  '/contact': {
    titleKey: 'contactTitle',
    introKey: 'contactIntro',
    noteKey: 'contactHelpText',
    // ── La GÉOMÉTRIE du plus grand texte peint ────────────────────────────
    // L'élément LCP de /contact est le paragraphe d'introduction, et c'est la
    // coquille pré-rendue qui le peint. Mesuré (Chrome 152, sonde des
    // candidates `largest-contentful-paint`, serveur de rewrites de
    // vercel.json, 412×823 et 1350×940, 6 relevés) : UNE SEULE candidate, À
    // L'INSTANT DU FCP (t = 92 à 112 ms, chaque fois égal au FCP au dixième de
    // milliseconde près), sur ce paragraphe, et de même aire que celui que
    // React reconstruit (57 213,8 px² mobile / 65 520 px² desktop, mesurés
    // JavaScript coupé pour la coquille et activé pour React). C'est cette
    // ÉGALITÉ qui tient : createRoot EFFACE #root, React reconstruit le
    // paragraphe, et un remplacement de MÊME TAILLE n'enregistre aucun nouvel
    // élément LCP.
    //
    // La mesure qui prouve le mécanisme est celle de la DIVERGENCE — rejouée le
    // 25/09/2026 en rétrécissant d'une seule classe la peinture de la coquille
    // (`… introClass} text-xs`), donc SANS toucher à React : une SECONDE
    // candidate apparaît, plus tardive, et `e2e/contact-lcp.spec.js` rougit sur
    // « React a peint un élément PLUS GRAND que la coquille ». Toute la chaîne
    // JavaScript entre alors dans le graphe LCP simulé de Lantern (mesuré sur
    // /jobs, où la géométrie avait divergé : `elementRenderDelay` de 1156 à
    // 2345 ms, score desktop 92 au lieu de 100). Les budgets Lighthouse de
    // /contact sur l'artefact corrigé : 100/100/100 mobile et 100/100/100
    // desktop (3 tours chacun).
    //
    // Ces chaînes étaient recopiées face à face dans src/pages/Contact.js et
    // vite-plugins/prerender/shells-routes.js : la moindre retouche d'un côté
    // faisait diverger la géométrie des deux peintures EN SILENCE, et c'est
    // exactement ce que le LCP ne pardonne pas. Elles ont maintenant UN
    // propriétaire, ici, que les deux canaux lisent (le build refuse par
    // ailleurs une coquille qui ne les publie pas : `exigerCorpsDeclare`).
    //
    // Ce qui décide de l'aire du paragraphe, c'est sa LARGEUR (donc le retour à
    // la ligne) : elle vient de `frameClass`. `titleClass` porte le seul autre
    // texte capable de prendre le LCP au paragraphe (l'aire du titre grandit
    // avec lui), et `noteClass` le suit dans le flux.
    frameClass: 'max-w-2xl mx-auto px-4 py-8',
    titleClass: 'titre-page mb-2',
    introClass: 'text-stone-600 mb-3',
    noteClass: 'text-sm text-stone-500 mb-6',
    // ── La carte Google : un contrôle, pas un embed au premier écran ───────
    // La coquille publiait l'iframe elle-même (en `loading="lazy"`). Mesuré
    // (Lighthouse 12.6.1, pile de la CI, Chrome 152, /contact mobile, 3 runs) :
    // le premier écran tirait quand même l'embed tiers, et le LCP de la page —
    // qui est notre PROPRE paragraphe d'introduction — était repoussé à
    // 4143-4399 ms simulés (scores 81-85), avec jusqu'à 2800 ms de « element
    // render delay ». La coquille publie donc le MÊME contrôle que la page, avec
    // les mêmes classes : un lien vers la fiche Google (il fonctionne même sans
    // JavaScript) que la page transforme en « afficher la carte ici » à l'appui.
    // Les deux canaux lisent ces classes ICI : une géométrie qui divergerait
    // ferait sauter le bloc au montage, et ce qui charge au premier écran est
    // exactement ce qui repousse le LCP.
    mapButtonKey: 'mapShowMap',
    // Le repère de la façade de carte — le même `contactAddress` que la ligne
    // d'adresse ci-dessus : un seul dessin pour un seul lieu. Il est LITTÉRAL
    // ici (un nom d'icône, pas une clé i18n) parce que la page et la coquille
    // le résolvent par le registre, pas par le dictionnaire.
    icone: 'contactAddress',
    mapFrameClass:
      'mt-6 w-full rounded-xl border border-stone-200 bg-white flex h-80 flex-col items-center justify-center gap-3 px-4 text-center',
    mapControlClass:
      'inline-flex items-center rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-700',
    // Une ligne de contact = une donnée (icône, libellé, destination, valeur
    // affichée, accent). `href` vient de src/config/contact.js : la règle `tel:`
    // et la règle `mailto:` (sujet compris) n'existent qu'à cet endroit, donc la
    // page et sa coquille ne peuvent pas publier deux liens différents.
    //
    // `badgeClass` / `breakAll` sont l'identité de LA LIGNE (un accent par moyen
    // de contact, un e-mail qui se coupe proprement) et non la mise en page de la
    // page : les deux canaux doivent rendre la même ligne, donc ils la lisent ici
    // plutôt que de la réécrire chacun de leur côté.
    //
    // Les libellés sont des CLÉS i18n, et les QUATRE MÊMES que les lignes de
    // /support (`rows` plus haut) : « Appeler », « WhatsApp », « Envoyer un
    // e-mail », « Adresse » désignent le même moyen de contact sur les deux
    // pages, donc ils n'ont qu'un texte. Ils étaient écrits ici en français, ce
    // qui laissait /contact publier quatre libellés français dans les cinq
    // langues du site pendant que /support les traduisait.
    actions: [
      {
        icone: 'contactCall',
        labelKey: 'contactCall',
        badgeClass: 'bg-orange-100 text-orange-600',
        href: telHref,
        value: CONTACT.phoneDisplay,
      },
      {
        icone: 'contactWhatsapp',
        labelKey: 'contactWhatsapp',
        badgeClass: 'bg-emerald-100 text-emerald-600',
        href: CONTACT.whatsappUrl,
        value: CONTACT.phoneDisplay,
        external: true,
      },
      {
        icone: 'contactSendEmail',
        labelKey: 'contactSendEmail',
        badgeClass: 'bg-blue-100 text-blue-600',
        href: mailtoHref,
        value: CONTACT.email,
        breakAll: true,
      },
      {
        icone: 'contactAddress',
        labelKey: 'contactAddress',
        badgeClass: 'bg-stone-100 text-stone-600',
        href: CONTACT.mapsUrl,
        value: CONTACT.address,
        external: true,
      },
    ],
    links: [
      { to: '/about', labelKey: 'aboutTitle' },
      { to: '/privacy', labelKey: 'privacyTitle' },
      { to: '/support', labelKey: 'support' },
    ],
  },

  '/privacy': {
    titleKey: 'privacyTitle',
    introKey: 'privacyIntro',
    // ── La GÉOMÉTRIE du plus grand texte peint ────────────────────────────
    // Sur CETTE page, le plus grand texte n'est pas l'introduction : c'est le
    // CORPS d'une section (« Kojo conserve les données nécessaires à la mise
    // en relation… », mesuré le 25/09/2026 : UNE SEULE candidate au premier
    // paint, 84 360 px² mobile / 86 676 px² desktop, aire identique entre la
    // coquille et React ; re-mesuré le 26/09/2026 avec la police servie par le
    // site : 91 630 / 100 788 px² — voir /login). La géométrie à déclarer est donc celle de la
    // section, pas seulement de son en-tête : `sectionBodyClass` porte
    // l'élément élu, `sectionTitleClass` l'en-tête qui le précède dans le
    // flux, et `frameClass` la largeur — c'est elle qui décide du retour à la
    // ligne, donc de la hauteur du corps.
    //
    // Ces cinq chaînes étaient recopiées dans src/pages/Privacy.js et
    // vite-plugins/prerender/shells-routes.js : une retouche d'un seul côté
    // faisait diverger les deux peintures en silence.
    frameClass: 'max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12',
    titleClass: 'titre-page mb-4',
    introClass: 'text-stone-600 mb-8',
    sectionTitleClass: 'text-xl font-semibold text-stone-900 mb-2',
    sectionBodyClass: 'text-stone-600',
    sections: [
      { titleKey: 'privacyDataTitle', bodyKey: 'privacyDataBody' },
      { titleKey: 'privacyRetentionTitle', bodyKey: 'privacyRetentionBody' },
      { titleKey: 'privacyRightsTitle', bodyKey: 'privacyRightsBody' },
      { titleKey: 'privacyContactSectionTitle', bodyKey: 'privacyContactBody' },
    ],
    links: [
      { to: '/contact', labelKey: 'contactTitle' },
      { to: '/about', labelKey: 'aboutTitle' },
    ],
  },

  // ── Conditions générales d'utilisation ────────────────────────────────────
  // Le pied de page renvoyait vers un .docx fusionné (confidentialité + CGU) :
  // un crawler n'en lisait rien et un lecteur devait télécharger un fichier
  // Word. Cette page existe pour publier les CGU en clair, à une adresse
  // citable, avec la MÊME forme que la politique de confidentialité (le plan
  // est lu par la page React ET par la coquille pré-rendue).
  '/terms': {
    titleKey: 'termsTitle',
    introKey: 'termsIntro',
    // Même géométrie que /privacy : le plus grand texte peint est le CORPS
    // d'une section, c'est `sectionBodyClass` qui porte l'élément LCP.
    frameClass: 'max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12',
    titleClass: 'titre-page mb-4',
    introClass: 'text-stone-600 mb-8',
    sectionTitleClass: 'text-xl font-semibold text-stone-900 mb-2',
    sectionBodyClass: 'text-stone-600',
    sections: [
      { titleKey: 'termsServiceTitle', bodyKey: 'termsServiceBody' },
      { titleKey: 'termsAccountTitle', bodyKey: 'termsAccountBody' },
      { titleKey: 'termsPaymentTitle', bodyKey: 'termsPaymentBody' },
      { titleKey: 'termsLiabilityTitle', bodyKey: 'termsLiabilityBody' },
    ],
    links: [
      { to: '/privacy', labelKey: 'privacyTitle' },
      { to: '/contact', labelKey: 'contactTitle' },
    ],
  },
};

/**
 * Ce qu'un plan déclare publier, séparé en deux : les CLÉS i18n (résolues dans
 * la langue du canal) et les TEXTES littéraux (déjà dans la langue de la
 * coquille).
 *
 * La règle est la convention du dépôt : un champ dont le nom finit par `Key`
 * porte une clé i18n, `Keys` une LISTE de clés ; TOUT autre texte d'un plan est
 * un texte que la coquille doit publier tel quel. Le build s'en sert pour
 * REFUSER une coquille incomplète sans tenir de seconde liste — les attendus se
 * déduisent du plan, jamais d'une table écrite à côté.
 *
 * Corollaire : un plan ne porte AUCUNE donnée interne. Ce qu'un plan déclare
 * est publié par la coquille, sans exception — y compris la valeur d'un lien.
 *
 * @param {object} plan Plan d'une page (`PAGE_SECTIONS[route]`).
 * Un TROISIÈME champ échappe aux deux : `icone` (dans une LISTE d'entrées) ou
 * un champ de niveau ROUTE terminé par `Icon` (`legalNoticeIcon`,
 * `countryGlobeIcon`…), qui nomment une icône DESSINÉE (src/config/page-icons.js)
 * au lieu d'un texte — la coquille doit la publier par son repère `data-icone`,
 * et non comme un glyphe.
 *
 * @returns {{cles: string[], textes: string[], icones: string[]}} Attendus, dédoublonnés.
 */
export function pageSectionParts(plan) {
  const cles = [];
  const textes = [];
  const icones = [];
  // Une clé i18n : un champ terminé par `Key`/`Keys`. Le suffixe `Icon`, lui, est
  // réservé aux icônes DESSINÉES (cf. `porteUneIcone`) — les deux suffixes ne
  // peuvent pas cohabiter sur un même nom.
  const porteUneCle = (nom) => Boolean(nom) && /Keys?$/.test(nom);
  // Un champ `icone` (liste) ou `*Icon` (route) porte le NOM d'une icône
  // DESSINÉE (src/config/page-icons.js), pas un texte : la coquille doit la
  // publier comme un SVG (repère `data-icone`), jamais comme un glyphe. C'est ce
  // qui retire les emoji du document — voir l'en-tête de page-icons.js.
  const porteUneIcone = (nom) => Boolean(nom) && (nom === 'icone' || /Icon$/.test(nom));
  const visiter = (valeur, nom) => {
    if (typeof valeur === 'string') {
      if (porteUneIcone(nom)) icones.push(valeur);
      else (porteUneCle(nom) ? cles : textes).push(valeur);
      return;
    }
    if (Array.isArray(valeur)) {
      valeur.forEach((element) => visiter(element, nom));
      return;
    }
    if (valeur && typeof valeur === 'object') {
      Object.entries(valeur).forEach(([cle, sousValeur]) => visiter(sousValeur, cle));
    }
  };
  visiter(plan, null);
  return { cles: [...new Set(cles)], textes: [...new Set(textes)], icones: [...new Set(icones)] };
}
