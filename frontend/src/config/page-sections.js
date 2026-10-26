// Extension explicite, et attribut sur l'import JSON : ce fichier est chargé par
// Node (vite.config.js écrit les coquilles pré-rendues avec lui) autant que par
// le bundle — Node n'exécute pas d'import relatif sans extension, ni d'import
// JSON sans `with { type: 'json' }`.
import { CONTACT, mailtoHref, telHref } from './contact.js';
// Le dessin du CHAMP est partagé par les trois formulaires du site (login,
// register, profile) : il a un propriétaire (./classes-champ.js) et ces plans le
// lisent, plutôt que d'écrire chacun leur bordure et leur anneau de focus.
import { CHAMP, CHAMP_TELEPHONE, CHAMP_PREFIXE, CHAMP_SELECTEUR } from './classes-champ.js';
// La colonne du chrome (l'enveloppe de l'application, publiée UNE fois par
// `vite-plugins/prerender/app-chrome.js` pour les deux canaux) : un plan peut la
// désigner comme élément élu d'une route, et il cite alors le DOMICILE de la
// chaîne au lieu de la recopier.
import { COLONNE_CLASS } from './classes-chrome.js';

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
// La ligne de contact — la même pour /contact et pour /support, et lue par les
// DEUX canaux de chacune. Refonte éditoriale du 28/09/2026 : elle quitte le
// cadre à coin arrondi (`rounded-xl border border-stone-200 px-4 py-3`) pour la
// LIGNE À FILET de l'accueil (`.liste-editoriale` + `.ligne-editoriale`, src/index.css),
// avec la pastille ronde et la flèche de la colonne de droite. Une ligne de
// contact devient donc une ENTRÉE : ce qu'elle publie tient dans une liste dont
// l'ordre se lit, au lieu d'une boîte posée à côté d'une autre.
const LIGNE_CONTACT = 'ligne-editoriale ligne-contact';

// ── QUEL ÉLÉMENT PORTE LE LCP (doctrine du 20/10/2026) ──────────────────────
// Un plan de route PUBLIQUE ne déclare pas seulement la géométrie du plus grand
// texte : il dit QUEL élément le navigateur élit. C'est une DÉCLARATION, pas une
// préférence — `e2e/lcp-geometrie-declaree.spec.js` la lit (jamais une copie),
// exige que l'élément élu porte les classes désignées et que son aire dépasse un
// plancher, et `scripts/__tests__/check-lcp-geometrie.test.js` refuse un nom qui
// ne désigne pas un champ de géométrie déclaré pour cette route, un élément élu
// nommé deux fois, et l'absence de nom. Les routes qui n'en portent pas (/, dont
// le LCP est l'image du héros, et /contact) ont leur propre sonde et leur propre
// garde : `check-home-hero-lcp.test.js`, `check-contact-lcp.test.js`.
//
// DEUX FORMES, et deux seulement :
//   • `lcpChamp: 'introClass'` — le nom d'un champ de CE plan (ou, quand le plus
//     grand texte change de camp selon la taille, `{ mobile, desktop }`) ;
//   • `lcpColonne: COLONNE_CLASS` — la colonne du CHROME, citée à son domicile
//     (`classes-chrome.js`) : c'est l'enveloppe que `app-chrome.js` publie une
//     seule fois pour les deux canaux, donc la déclaration ne recopie rien.
//
// Pourquoi le CONTENEUR est ACCEPTÉ là où il est élu : le titrage public est
// animé (`.titre-page`, src/index.css), et /about élit la COLONNE DU CHROME
// (`min-h-screen fond-sable relative flex flex-col`, 191 786 / 196 500 px²
// mesurés le 20/10/2026, trois passages d'affilée). La mesure A/B sous
// `prefers-reduced-motion` — titrage immobile — donne la MÊME élection : l'effet
// n'est pas la CAUSE, il est la décision de cohérence qui l'accompagne.
// POURQUOI CETTE PAGE ET PAS /jobs, la mesure ne le dit pas : elle dit ce qui
// est élu, route par route et taille par taille, et c'est cette élection-là que
// le plan déclare — pas une règle générale qu'on supposerait valable partout
// (sur /jobs et les sept autres, l'élu reste un texte, mesuré le même jour).
//
// La contrepartie est nommée à l'endroit de l'effet : la garantie « React ne
// peint pas plus grand que la coquille » porte alors sur la colonne entière, et
// les budgets LCP par route (`scripts/lcp-app-budgets.cjs`) restent seuls juges
// du COÛT de la chaîne JavaScript.

// Les quatre classes du BLOC de contact (la liste, la pastille, le libellé, la
// valeur) : elles sont portées par /contact et par /support, donc déclarées une
// fois et recopiées dans les deux plans — jamais dans une page.
const BLOC_CONTACT = {
  listeContactClass: 'liste-editoriale',
  pastilleContactClass: 'pastille-rond',
  etiquetteContactClass: 'etiquette-contact',
  valeurContactClass: 'valeur-contact',
};


// ── La GÉOMÉTRIE du héros de l'accueil ────────────────────────────────────────
// L'ÉLÉMENT LCP DE « / » A CHANGÉ DE NATURE LE 27/09/2026, et c'est mesuré : la
// refonte éditoriale a donné au héros une ILLUSTRATION — aujourd'hui une PHOTO
// (`/assets/kojo-hero.jpg` et ses cinq suivantes, publiées à leur rapport 3/4 de
// 720 × 960 ; le dessin qu'elles ont remplacé le 29/09/2026 était en 4/3, 960 ×
// 720) — dont l'aire peinte dépasse celle du titre, RE-MESURÉE le 29/09/2026 sur
// la photo publiée à son rapport : **69 920 px² en mobile et 306 870 en desktop**
// (la veille : 62 700 et 139 733, le cadre 4/3), contre **37 400 et 110 500**
// pour le `<h1>` lors de sa propre dernière mesure (28/09/2026 — l'aire d'un
// texte que Chrome élit est celle de son encre, pas celle de sa boîte : les deux
// chiffres ne se comparent qu'entre eux, chacun à sa date), dans les DEUX
// canaux, une seule candidate, horodatée au premier paint (`e2e/
// lcp-geometrie.spec.js`, 24/24 ; le CLS de « / » reste 0,0000). Le LCP n'est
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
  // ── LES DEUX PAS DU RYTHME : LA SECTION ET LA CARTE (28/09/2026) ──────────
  // Le pas vertical d'une section (deux utilitaires de rembourrage, dont la
  // variante de largeur doublait le pas) et le rembourrage d'une carte (`p-6`)
  // n'étaient déclarés NULLE PART : dix sections de l'accueil, neuf dans sa
  // coquille, et deux cartes de chaque côté portaient chacun leur propre
  // littéral. (Ces utilitaires ne sont PAS nommés ici : Tailwind lit ce fichier
  // comme une source de candidats, commentaires compris — les citer ici ferait
  // réapparaître leurs règles dans la feuille servie, sans porteur, et le garde
  // de sélecteurs les refuserait ; c'est mesuré, la première rédaction de ce
  // commentaire a fait rougir douze pages.) Un rythme recopié dix-neuf fois n'est pas un rythme, c'est
  // dix-neuf accords à tenir — et rien ne rougissait quand deux copies
  // cessaient d'être d'accord : la page changeait simplement de pas à la
  // bascule coquille → React. Ces deux classes sont dans src/index.css (elles
  // n'y portent qu'un pas, jamais un dessin), donc les DEUX canaux les lisent
  // par construction, et `exigerCorpsDeclare` refuse un build dont la coquille
  // a perdu l'une des deux chaînes.
  sectionClass: 'section-publique',
  carteClass: 'carte-publique',
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
  // ── LES DEUX FAITS DE LA CLÔTURE (07/10/2026) ────────────────────────────
  // Ils étaient une BANDE à filets posée seule entre la clôture orange et
  // « Qui sommes-nous » : MESURÉ (Chromium, 412 × 823) 245 px de section pour
  // 115 px de bande, elle-même deux cases vides de 187 px pour 64 px d'encre,
  // et deux nombres centrés en 2,25 rem qui dominaient leur libellé de 12 px.
  // Étirée sur toute la largeur en desktop, la rangée ressemblait à un TABLEAU,
  // pas à une application. Elle vit maintenant DANS la clôture, sous les deux
  // boutons : c'est là que le visiteur hésite, donc là que la réassurance sert.
  // La rangée est bornée en largeur (elle ne s'étire plus), alignée à gauche
  // (comme tout le site depuis la refonte du 25/09/2026) et le chiffre redescend
  // à 1,5 rem pour céder la hiérarchie au titre de la clôture.
  faitsClass: 'faits-cta',
  faitClass: 'fait-cta',
  faitFigureClass: 'fait-cta-figure',
  faitLibelleClass: 'fait-cta-libelle',
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

// ── LE VOCABULAIRE COMMUN AUX PAGES DE CONTENU (28/09/2026) ─────────────────
// Deuxième portée du même langage. `EDITORIAL_ACCUEIL` ci-dessus habille
// l'accueil ; celui-ci habille toute page dont la coquille publie un corps de
// contenu — aujourd'hui /how-it-works. Ce ne sont pas des variantes : ce sont
// les MÊMES classes de src/index.css, déclarées une seconde fois parce qu'un
// plan se lit seul (chaque route déclare ce que SA coquille doit porter).
//
// Ce qui a décidé de la séparation : `pageSectionParts` (plus bas) verse dans
// les textes attendus TOUTE chaîne du plan qui n'est ni une clé i18n ni un nom
// d'icône. Étaler le vocabulaire complet de l'accueil sur /how-it-works aurait
// donc exigé que sa coquille publiât aussi la grille du héros, le ruban des
// pays et la galerie — trois choses que cette page ne peint pas, et le build
// aurait refusé. Un plan ne déclare que ce qu'il publie.
const EDITORIAL_PAGE = {
  // La bande de tête : elle remplace le dégradé orange → ROUGE que seule cette
  // page portait.
  bandePageClass: 'bande-page',
  entreeSectionClass: 'entree-section',
  // Le pas de SECTION, le même qu'à l'accueil (voir `EDITORIAL_ACCUEIL`) :
  // déclaré une seconde fois parce qu'un plan se lit seul, mais c'est la MÊME
  // classe de src/index.css. Le pas de CARTE, lui, n'est pas déclaré ici :
  // cette page ne peint aucune carte (ses blocs sont un panneau —
  // `.panneau-sequestre`, qui porte déjà ce pas — et des lignes à filet), et
  // un plan ne déclare que ce qu'il publie : l'avoir déclaré quand même a fait
  // REFUSER le build par `exigerCorpsDeclare` (« carte-publique manque »), ce
  // qui est exactement son travail — une déclaration sans porteur casse au lieu
  // de peindre une page muette.
  sectionClass: 'section-publique',
  listeClass: 'liste-editoriale',
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
  listeGarantiesClass: 'liste-garanties',
  faqListeClass: 'faq-liste',
  faqLigneClass: 'faq-ligne',
  faqMarqueClass: 'faq-marque',
  ctaClass: 'cta-final',
  ctaInnerClass: 'cta-final-inner',
  ctaActionsClass: 'cta-actions',
  lienFlecheClass: 'lien-fleche',
  lienFlecheClairClass: 'lien-fleche lien-fleche-clair',
  boutonClass: 'bouton bouton-creme',
  boutonSecondClass: 'bouton bouton-contour',
  headClass: 'titre-section',
  sectionIntroClass: 'text-stone-600',
  paperClass: 'fond-papier',
  sandClass: 'fond-sable',
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
// ── RE-MESURE DU 28/09/2026, APRÈS LE RYTHME DÉCLARÉ ────────────────────────
// Deuxième passe du même jour : le PAS des cadres, des sections et des cartes
// est passé en classes de `src/index.css` (`cadre-page`, `section-publique`,
// `carte-publique`), donc les peintures rétrécissent ou grandissent de quelques
// pixels — dans les DEUX canaux à la fois, puisque les deux lisent les mêmes
// jetons. Relevé (`npx playwright test e2e/lcp-geometrie-declaree.spec.js`,
// taille de l'élément élu / aire réellement peinte, mobile / desktop) :
//
//   /jobs           37 240 / 34 960   (avant 36 750 / 35 144)
//   /about          74 295 / 79 346   (avant 82 940 / 79 540)
//   /privacy        91 140 / 103 896  (inchangé — son cadre est un `min-h-screen`)
//   /how-it-works   29 260 / 32 830   (inchangé)
//   /login          15 040 / 11 532   (avant 15 040 / 12 834)
//   /register        9 792 / 12 672   (avant 9 548 / 12 338)
//   /forgot-password 13 690 / 16 021  (avant 13 690 / 16 095)
//   /support        16 632 /  9 648   (avant 16 720 / 9 480)
//
// Aucun plancher n'a bougé d'un chiffre : le plus serré reste /about
// (55 000 px² pour 74 295 mesurés, soit 26 % de marge) — et c'est voulu. Les
// mesures des commentaires de chaque route sont conservées TELLES QUELLES :
// elles datent d'une session précise, et les réécrire avec les chiffres d'une
// autre session ferait passer une variation d'hôte pour une variation de page.
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
    // Les faits de l'accueil — des FAITS VÉRIFIABLES, jamais des compteurs
    // inventés. Les deux anciens (« 1 000+ travailleurs », « 500+ projets »)
    // étaient des replis FABRIQUÉS avant l'appel à /public/stats : le HTML
    // pré-rendu les publiait donc à un crawler, et le premier paint les
    // affichait à un visiteur, comme s'ils étaient mesurés. Ils sont RETIRÉS
    // (règle « pas de faux compteurs »).
    // `shellText` est le texte EXACT que la coquille écrit ; `fallback` la même
    // valeur côté page — les deux sortent d'ici, une seule liste. `icone` nomme
    // le dessin (src/config/page-icons.js), publié par les deux canaux : le
    // globe pour les pays, le téléphone pour le support.
    //
    // RECTIFIÉ le 07/10/2026 : la valeur disait « 6j/7 » et trois textes FR
    // portaient l'énoncé « du lundi au samedi ». Le propriétaire du site a
    // tranché : le support répond SEPT JOURS SUR SEPT. Le chiffre et les huit
    // textes qui l'énonçaient sont corrigés ensemble — un chiffre faux dans la
    // seule bande de faits d'une page est exactement ce que cette bande
    // interdit, et une phrase qui le contredit ailleurs le serait autant.
    stats: [
      { labelKey: 'countriesCovered', fallback: '4', shellText: '4', icone: 'countryGlobe' },
      { labelKey: 'customerSupport', fallback: '7j/7', shellText: '7j/7', icone: 'contactCall' },
      // ── LA PREUVE MESURÉE (22/10/2026) ──────────────────────────────────
      // Trois entrées de plus, et leur valeur publiée est « — » : le HTML
      // pré-rendu ne peut pas appeler `/api/public/stats` (il est écrit au
      // BUILD), donc il publie « pas mesuré ici » plutôt qu'un chiffre figé
      // qui aurait l'air mesuré. React remplace ce tiret par la mesure dès
      // que la route répond, DANS LE MÊME NŒUD (même boîte, même classe) :
      // aucun décalage de mise en page, aucune seconde peinture de la bande.
      // La règle de ce remplacement vit dans `utils/preuveSociale.js`, et
      // elle n'invente jamais de repli chiffré.
      { labelKey: 'measuredWorkers', fallback: '—', shellText: '—', icone: 'client' },
      { labelKey: 'measuredCompletedJobs', fallback: '—', shellText: '—', icone: 'step3' },
      { labelKey: 'measuredReviews', fallback: '—', shellText: '—', icone: 'check' },
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
      { icone: 'howStep1', numberKey: 'stepNumber1', titleKey: 'howStep1Title', descriptionKey: 'howStep1Desc' },
      { icone: 'escrow', numberKey: 'stepNumber2', titleKey: 'howStep2Title', descriptionKey: 'howStep2Desc' },
      { icone: 'howStep3', numberKey: 'stepNumber3', titleKey: 'howStep3Title', descriptionKey: 'howStep3Desc' },
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
    // Le vocabulaire éditorial commun (voir EDITORIAL_PAGE plus haut) : les
    // mêmes classes que l'accueil, lues par src/pages/HowItWorks.js ET par
    // vite-plugins/prerender/shells-routes.js.
    ...EDITORIAL_PAGE,
    // ── La GÉOMÉTRIE du plus grand texte peint ────────────────────────────
    // L'élément LCP de /how-it-works est le SOUS-TITRE du héros (« Trouver un
    // travailleur ou une mission… »). Mesuré le 25/09/2026 comme sur /jobs
    // (deux canaux, deux tailles) : UNE SEULE candidate, au premier paint, sur
    // ce paragraphe, d'aire IDENTIQUE — 30 320 px² mobile, 32 656 px² desktop.
    // Re-mesuré le 26/09/2026 avec la police SERVIE PAR LE SITE : 26 334 /
    // 32 928 px² (voir /login — la police n'est plus celle de l'hôte).
    //
    // RE-MESURÉ LE 28/09/2026, au port du vocabulaire éditorial : **29 260 px²
    // en mobile et 32 830 en desktop**, une seule candidate au premier paint
    // (`e2e/lcp-geometrie-declaree.spec.js`), et l'aire est IDENTIQUE entre la
    // coquille et React (`e2e/lcp-geometrie.spec.js`) — c'est l'invariant, et il
    // tient. Le mobile gagne 2 926 px² par rapport au relevé de la veille : ce
    // n'est PAS la correction de contraste (une couleur ne change ni la boîte ni
    // le repli) mais le TITRE de la bande, qui est passé à la police de titrage
    // le 27/09/2026 et se replie plus court — le paragraphe remonte donc
    // entièrement au-dessus de la ligne de flottaison, là où il était auparavant
    // coupé par le bas de la fenêtre. Le plancher de 18 000 px² de
    // `e2e/lcp-geometrie-declaree.spec.js` reste très en dessous des deux tailles.
    //
    // ── RE-MESURÉ LE 07/10/2026 : LA MARGE ÉTAIT TROP MINCE, ET ELLE A CASSÉ ──
    // **33 642 px² en mobile et 36 480 en desktop** pour le sous-titre (classes
    // ci-dessous, une seule candidate au premier paint). Le relevé précédent
    // (29 260 / 32 830) n'était PAS faux — il était FRAGILE, et la CI l'a dit
    // deux fois de suite sur le runner Linux : l'élément élu y était
    // `<p class="note-de-ligne">`, c'est-à-dire la description d'une ÉTAPE,
    // jamais le sous-titre du héros.
    //
    // Ce qui se passait, mesuré et reproduit (Chromium, sonde des candidates
    // `largest-contentful-paint`, mobile) : les trois descriptions d'étapes sont
    // des paragraphes larges et multi-lignes, presque aussi grands que le
    // sous-titre — **28 201 px² de boîte pour une note contre 31 920 pour le
    // sous-titre à 412 px**. Or la colonne de texte d'une ligne d'étape
    // s'ÉTRÉCIT quand la mise en page rétrécit (340 px de large à 412, 211 px à
    // 397) : la note se replie alors sur plus de lignes et sa boîte MONTE à
    // 30 717 (397 px) puis 32 610 (382 px), pendant que le sous-titre, lui, ne
    // bougeait pas — à 397 px l'écart tombait à **1,5 %**, et l'élection
    // basculait. Un écart de 15 px de mise en page a suffi : c'est exactement ce
    // qu'une barre de défilement CLASSIQUE (Linux) retire à la fenêtre, quand
    // l'hôte du poste partagé la laisse en surimpression.
    //
    // Le remède est une MARGE, pas une tolérance : `text-lg` (18 px, interligne
    // 28) devient `text-xl` (20 px) avec `leading-relaxed`. Re-mesuré sur le
    // MÊME artefact à quatre largeurs de mise en page, sous-titre contre la
    // plus grande note : 412 px **33 642** contre 25 860 (+30 %), 397 px **42 578**
    // contre 28 840 (+48 %), 382 px **42 456** contre 32 610 (+30 %). Les sept
    // autres routes déclarées gardent leur élément élu aux trois largeurs — le
    // défaut était propre à cette page, et c'est la marge de SON sous-titre qui
    // le ferme.
    //
    // `heroFrameClass` porte la largeur du héros (donc le retour à la ligne du
    // sous-titre, qui porte lui-même son `max-w-2xl`), `heroSubtitleClass` sa
    // hauteur, et `heroTitleClass` le texte qui le précède et pourrait lui
    // prendre le LCP. Les trois étaient recopiées dans src/pages/HowItWorks.js
    // et vite-plugins/prerender/shells-routes.js.
    // `section-publique` remplace les deux valeurs de rembourrage du héros
    // (28/09/2026) : le premier écran est le PREMIER TEMPS du rythme, pas un
    // bloc à part qui aurait ses propres valeurs — c'est déjà la règle du héros de l'accueil
    // (`.heros-grille`).
    heroFrameClass: 'max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 section-publique text-center',
    heroTitleClass: 'titre-page mb-4',
    // Le sous-titre du héros est l'élément LCP de la page : sa GÉOMÉTRIE
    // décide du retour à la ligne, donc de l'aire mesurée — et c'est ELLE qu'on
    // ne peut pas laisser mince (voir le relevé du 07/10/2026 plus haut :
    // `text-xl leading-relaxed` donne 30 à 48 % de marge sur la plus grande note
    // d'étape, contre 1,5 % avec `text-lg`). `max-w-2xl` reste : il ne bride pas
    // la largeur à 412 px (380 px disponibles), il borne le desktop.
    // Ce qui change AUSSI, et c'est un défaut mesuré : la COULEUR.
    // `text-stone-600` sur le fond orange du héros donne un contraste de 2,6:1 —
    // la page publiait un paragraphe illisible depuis sa mise en ligne.
    // `text-orange-50` mesure 7,3:1 sur `#ea580c`.
    heroSubtitleClass: 'text-xl leading-relaxed text-orange-50 max-w-2xl mx-auto',
    // L'élément élu : le SOUS-TITRE du héros, pas le titre — la bande est
    // exclue de l'effet cinétique (`.bande-page`, src/index.css), donc le titre
    // y reste un texte peint et ne prend pas le LCP (20/10/2026).
    lcpChamp: 'heroSubtitleClass',
    escrowTitleKey: 'escrowWhatTitle',
    escrowTextKey: 'escrowWhatText',
    // L'illustration et l'estampille du panneau de séquestre : le MÊME fichier et
    // la MÊME clé que le panneau de l'accueil (l'estampille reprend un texte que
    // la page publie déjà ; elle n'en invente aucun). Le chemin est déclaré ici
    // parce que la coquille le publie aussi, dans la même balise `<img>`.
    panneauImageSrc: '/assets/kojo-paiement-securise.svg',
    estampilleKey: 'securePayments',
    // Le repère des quatre garanties : une icône DESSINÉE (`check`), jamais un
    // caractère — c'est la règle qui a retiré les emoji du document. Le nom du
    // champ finit par `Icon` : `pageSectionParts` le verse dans les icônes, dont
    // la coquille doit porter le repère `data-icone`.
    garantieIcon: 'check',
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
    // `cadre-page` remplace le rembourrage écrit ici (28/09/2026) : le pas d'un
    // cadre de page est le même sur toutes les pages publiques, et il est
    // FLUIDE — une valeur fixe laissait 32 px de tête sur un téléphone comme
    // sur un 27 pouces.
    frameClass: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 cadre-page min-h-screen',
    titleClass: 'titre-page',
    introClass: 'mb-6 max-w-3xl text-base leading-relaxed text-stone-600 min-h-[104px] md:min-h-[52px]',
    // ── LA LIGNE DE DATE : un fait du CLIENT, pas du DOCUMENT ─────────────
    // Sous le titre, la page affiche « aujourd'hui ». Une coquille est un
    // document STATIQUE : la date y est figée au build, donc fausse dès le
    // lendemain — et le jour où le build et la lecture tombent de part et
    // d'autre de minuit, la coquille publie la VEILLE pendant que React peint
    // le jour (mesuré en CI le 23/10/2026 : « 22 octobre 2026 » contre
    // « 23 octobre 2026 », sonde `texte-coquille-react` rouge). Le TEXTE n'a
    // donc qu'UN propriétaire, la page ; la coquille ne RÉSERVE que la bande
    // pour que la bascule coquille → React ne déplace pas l'en-tête.
    //
    // La hauteur réservée est `1.6em` : c'est EXACTEMENT la hauteur de ligne
    // que `p` porte (`p, label, small, li { line-height: 1.6 }`, src/index.css),
    // lue dans l'`em` du paragraphe — donc la même dans les deux canaux quel
    // que soit le corps de police. Mesuré le 23/10/2026 : 24 px réservés pour
    // une ligne de 25,088 px décalaient de 1,1 px tout ce qui suit la date
    // (« Liste », « Carte », l'intro), refusé par `geometrie-coquille-react`.
    dateClass: 'mt-2 text-gray-600 min-h-[1.6em]',
    // L'élément élu : le PARAGRAPHE d'introduction, pas le titre animé —
    // mesuré le 20/10/2026 après l'animation de `.titre-page`.
    lcpChamp: 'introClass',
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
    // L'élément élu : la LIGNE LÉGALE, pas le titre (voir le relevé en tête de
    // `e2e/lcp-geometrie-declaree.spec.js`) — toujours vrai le 20/10/2026.
    lcpChamp: 'legalContactClass',
    // Classes de la page : lues par src/pages/Login.js ET par la coquille.
    //
    // ── LE DESSIN DE L'ÉCRAN (17/10/2026) ───────────────────────────────────
    // /login était la dernière page publique restée au vocabulaire d'AVANT la
    // refonte : libellés `text-gray-700`, champs `rounded-md border-gray-300`,
    // bouton `bg-orange-600`, encadré légal `bg-orange-50` — quatre familles de
    // chaînes qu'aucune autre page ne portait plus. Le formulaire devient une
    // CARTE du site (`.carte-editoriale` + `.carte-publique`), son bouton lit
    // `.bouton` comme les actions des écrans connectés, et son encadré légal
    // est un `.encart` (filet orange à gauche) au lieu d'un aplat orange clair.
    // La carte est déclarée ici et publiée par la coquille : les deux canaux
    // peignent la même enveloppe, donc la bascule coquille → React ne déplace
    // rien (le bloc est centré verticalement, une hauteur différente aurait
    // décalé tout le formulaire).
    frameClass: 'min-h-full flex items-center justify-center fond-sable cadre-page px-4 sm:px-6',
    colonneClass: 'max-w-md w-full',
    carteClass: 'carte-editoriale carte-publique',
    titleClass: 'mt-6 text-center titre-page',
    formClass: 'mt-8 space-y-6',
    champsClass: 'space-y-4',
    labelClass: 'block whitespace-nowrap text-sm font-semibold text-stone-800',
    champClass: CHAMP,
    // Le séparateur (« ou ») et la boîte d'erreur restent ÉCRITS dans la page
    // et dans la coquille : les deux vivent sous condition (`VITE_GOOGLE_CLIENT_ID`
    // pour l'un, une réponse d'API pour l'autre), et `exigerCorpsDeclare` lit un
    // champ de plan comme un texte TOUJOURS publié — le déclarer ici faisait
    // refuser le build dès que le client Google n'était pas configuré.
    // La rangée du mot de passe porte DEUX textes dans une colonne de 320 px :
    // sans `flex-wrap`, `justify-between` rétrécissait le LIBELLÉ jusqu'à le
    // replier (« Mot de / passe ») tandis que le lien, lui, restait entier —
    // relevé au port du dessin le 17/10/2026. Le lien ne se coupe plus, et si
    // les deux ne tiennent pas, le lien passe à la ligne.
    ligneMotDePasseClass: 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1',
    lienMotDePasseClass: 'whitespace-nowrap text-sm font-semibold text-orange-700 underline underline-offset-2 hover:text-orange-600',
    // La place de l'œil (quarante-quatre pixels à droite) s'ajoute au champ
    // partagé : c'est la seule différence, et elle est lisible ici.
    champMotDePasseClass: `${CHAMP} pr-11`,
    // `relative` n'est pas décoratif : LoadingButton monte son spinner dans une
    // couche `absolute inset-0`, qui prend le bouton pour référence. React
    // l'ajoute lui-même à la racine du bouton, la coquille n'a que ce plan —
    // l'omettre faisait diverger les classes de la MÊME boîte sur /login et
    // /register (sonde e2e/classes-coquille-react.spec.js, 17/10/2026).
    boutonClass: 'relative bouton bouton-encre w-full',
    encadreLegalClass: 'encart space-y-2',
    legalNoticeClass: 'text-sm font-semibold text-stone-900',
    legalLienClass: 'inline-flex items-center text-sm font-medium text-orange-700 underline underline-offset-2 hover:text-orange-800',
    noAccountClass: 'text-center',
    noAccountTexteClass: 'text-sm text-stone-600',
    lienInscriptionClass: 'font-semibold text-orange-700 hover:text-orange-600',
    // Le glyphe du bloc légal est DESSINÉ (page-icons.js) : le plan nomme une
    // icône, pas une clé i18n d'emoji (`iconLegalNotice` reste au dictionnaire
    // comme valeur interdite pour les coquilles, cf. check-prerender-shells).
    legalNoticeIcon: 'legalNotice',
    noAccountKey: 'noAccount',
    registerKey: 'register',
  },

  '/register': {
    // ── Les champs du formulaire (17/10/2026) ─────────────────────────────
    // Ces quatre chaînes sont lues par Register.js ET par sa coquille
    // (vite-plugins/prerender/shells-routes.js) : les champs du formulaire
    // pré-rendu et ceux de React portent donc le même filet, le même fond et le
    // même focus — la bascule ne change rien à leur dessin. Le dessin lui-même
    // vit dans ./classes-champ.js, avec celui de /login et de /profile.
    champClass: CHAMP,
    champTelephoneClass: CHAMP_TELEPHONE,
    champPrefixeClass: CHAMP_PREFIXE,
    selecteurPaysClass: CHAMP_SELECTEUR,
    // Même plan de bouton que /login : la coquille publie le même `<button>`
    // que React, `relative` compris (spinner de LoadingButton).
    boutonClass: 'relative bouton bouton-encre w-full',
    titleKey: 'title',
    subtitleKey: 'subtitle',
    // L'état d'ATTENTE (« Détection de votre position… ») n'est plus publié
    // (26/10/2026) : sans JavaScript la coquille ne peut pas le faire aboutir,
    // et un premier rendu qui diffère d'elle se déplace à l'hydratation.
    // ── La hauteur RÉSERVÉE du bloc d'état de géolocalisation ───────────────
    // Les deux états ont des hauteurs NATURELLES différentes (mesuré à 412 ET
    // 1350 px : 42,5 px pour « pays détecté », et l'état « position non
    // détectée » qui porte désormais le bouton) et le bloc des états FINAUX
    // portait en plus un `mb-3` (12 px) que l'état de chargement n'avait pas :
    // quand la détection se terminait, les pastilles d'étape et tout le
    // formulaire descendaient de 14 px — CLS 0,0088 sur /register mobile et
    // 0,0021 en desktop (sonde e2e/cls-coquille-react.spec.js, 26/09/2026).
    // La coquille ET la page réservent donc la hauteur du PLUS HAUT (l'état
    // « pays détecté », 42,5 px de contenu) : la boîte mesure 60,5 px dans les
    // TROIS états, et plus rien ne bouge. Valeur DÉCLARÉE ici, lue par les deux
    // canaux (`vite-plugins/prerender/shells-routes.js` et
    // `src/pages/Register.js`) — les couleurs restent locales à chaque état.
    geoStatusBoxClass:
      'mb-3 p-2 border rounded text-center min-h-[60.5px] flex flex-col items-center justify-center',
    step1TitleKey: 'personalInformation',
    step2TitleKey: 'stepEmail',
    step3TitleKey: 'stepPayments',
    // Les numéros des trois pastilles de progression : la page les écrivait
    // « 1 », « 2 », « 3 » et la coquille les recopiait. Le rang d'une étape
    // est un fragment publié comme un autre, donc une clé i18n.
    step1NumberKey: 'stepNumber1',
    step2NumberKey: 'stepNumber2',
    step3NumberKey: 'stepNumber3',
    // ── LA JAUGE DU FORMULAIRE (28/09/2026) ───────────────────────────────
    // Les trois pastilles ci-dessus montrent le PARCOURS (trois pages) et ne
    // bougeaient jamais : quelqu'un qui avait rempli sept champs sur neuf n'y
    // voyait aucun avancement. Sous elles, une jauge dit ce qui reste à remplir
    // ICI — sa largeur est une donnée de l'écran (le pré-rendu la peint vide,
    // et les deux canaux lui donnent donc la même boîte) et sa couleur un
    // verdict : gris, orange pendant la saisie, vert quand les champs exigés
    // sont tous remplis. Ces deux classes sont DÉCLARÉES ici parce que la
    // coquille les publie aussi : sans porteur des deux côtés, la bascule
    // coquille → React ferait sauter la jauge et remonterait toute la notice.
    progressTrackClass: 'jauge-inscription',
    progressFillClass: 'jauge-inscription-remplie',
    stepNoticeKey: 'clientStepNotice',
    // La chaîne de la notice d'étape EST l'élément LCP de la page (mesuré :
    // 10 048 px² mobile / 12 544 desktop après le passage de son ⚠️ de l'emoji
    // au SVG, puis 9 548 / 12 338 le 26/09/2026 avec la police servie par le
    // site — UNE candidate au premier paint) — déclarée ici pour que les deux
    // canaux la lisent (voir /login).
    stepNoticeClass: 'text-xs text-amber-800 mt-3',
    // L'élément élu : la NOTICE D'ÉTAPE (20/10/2026).
    lcpChamp: 'stepNoticeClass',
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
    // L'élément élu : le SOUS-TITRE de la carte (20/10/2026).
    lcpChamp: 'subtitleClass',
    stepEmailKey: 'forgotPasswordStepEmail',
    stepCodeKey: 'forgotPasswordStepCode',
    stepPasswordKey: 'forgotPasswordStepPassword',
    emailLabelKey: 'forgotPasswordEmailLabel',
    emailPlaceholderKey: 'email',
    requestMessageKey: 'forgotPasswordRequestMessage',
    sendCodeKey: 'forgotPasswordSendCode',
    backToLoginKey: 'forgotPasswordBackToLogin',
    // Classes de la page : lues par src/pages/ForgotPassword.js ET par la coquille.
    frameClass: 'min-h-full flex items-center justify-center fond-sable py-12 px-4 sm:px-6 lg:px-8',
    colonneClass: 'max-w-md w-full space-y-8',
    enteteClass: 'text-center',
    badgeClass: 'mx-auto h-14 w-14 flex items-center justify-center rounded-lg bg-orange-600',
    badgeTexteClass: 'text-white text-2xl font-bold',
    titleClass: 'mt-6 text-3xl font-bold text-stone-900',
    carteClass: 'carte-editoriale carte-publique space-y-6',
    etapesClass: 'flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-500',
    etapeActiveClass: 'text-orange-600',
    etapeAttenteClass: 'text-stone-500',
    formClass: 'space-y-5',
    labelClass: 'block text-sm font-medium text-gray-700',
    champClass: 'mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-hidden focus:ring-orange-500',
    aideClass: 'text-xs text-gray-500',
    boutonClass: 'relative w-full rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-700',
    retourClass: 'text-center',
    lienRetourClass: 'text-sm font-medium text-orange-600 hover:text-orange-500',
  },

  '/payment': {
    // Le glyphe de la carte « mission requise » (état par défaut, celui que
    // publie la coquille).
    // La mallette de la carte « mission requise » est celle des promesses de
    // l'accueil (`promiseFindWork`) : un même contenu, jamais recopié.
    noJobIcon: 'promiseFindWork',
    titleKey: 'paymentPageTitle',
    subtitleKey: 'paymentPageSubtitle',
    // LE CADRE, ET POURQUOI IL EST ICI PLUTÔT QUE DANS app-cadres.js : /payment a
    // une COQUILLE, donc les deux canaux peignent ce cadre — une chaîne recopiée
    // de chaque côté divergerait en silence, et c'est exactement le défaut que ce
    // bloc ferme (`src/pages/Payment.js` et `vite-plugins/prerender/shells-routes.js`
    // écrivaient tous deux `min-h-full bg-gray-50 py-8` et
    // `max-w-6xl mx-auto px-4 space-y-6` à la main).
    // /payment ne passe PAS par `CadrePage` : ce composant sert les routes SANS
    // coquille (`src/config/app-cadres.js`), et le fond gris de celle-ci est une
    // décision de cette page-là, pas un pas de site.
    frameClass: 'min-h-full bg-gray-50 py-8',
    corpsClass: 'max-w-6xl mx-auto px-4 space-y-6',
    // ── LE VOCABULAIRE D'ÉCRAN (17/10/2026) ──────────────────────────────────
    // /payment était le dernier écran déclaré sans le vocabulaire des autres :
    // en-tête en carte blanche ombrée, montants en pavés gris/vert/bleu, titres
    // en `titre-entree`. Les cinq chaînes ci-dessous sont publiées par la
    // COQUILLE (bande + carte « mission requise ») et lues par la page : une
    // seule déclaration pour les deux canaux, comme le cadre lui-même.
    bandeClass: 'bande-app bloc-app',
    subtitleClass: 'mt-2 text-sm text-stone-600 sm:max-w-2xl sm:text-base',
    carteClass: 'carte-editoriale carte-publique',
    carteTitreClass: 'titre-carte-app',
    ctaClass: 'bouton bouton-encre',
    titleClass: 'titre-page',
    // ── LA RÈGLE DE SON ÉTAT DE CHARGEMENT N'EST PAS ICI, ET C'EST UN REFUS MESURÉ ──
    // Elle a été écrite dans ce plan le 09/10/2026, et `npm run build` l'a REFUSÉE :
    // `exigerCorpsDeclare` a lu `squelette.regle` comme un texte déclaré et a réclamé
    // « pied-hors-ecran » dans la coquille de /payment — or une coquille n'a AUCUN état
    // de chargement à publier. Le contrat de ce fichier est explicite (« un plan ne porte
    // aucune donnée interne : ce qu'il déclare est publié par la coquille, sans
    // exception »), donc une déclaration que la coquille ne peut pas porter n'a rien à y
    // faire. Elle vit chez le propriétaire des RÈGLES DE CHARGEMENT :
    // `REGLES_DE_CHARGEMENT['/payment']` dans `src/config/app-cadres.js`.
    noJobTitleKey: 'paymentPageNoJobTitle',
    noJobTextKey: 'paymentPageNoJobText',
    noJobCtaKey: 'paymentPageNoJobCta',
    // LE PLUS GRAND TEXTE PEINT de la route, et c'est le CORPS de cette carte —
    // ni le titre ni le sous-titre de la bande. Déclaré ici depuis le
    // 17/10/2026 : `e2e/lcp-geometrie-declaree.spec.js` exige que l'élément élu
    // porte une classe du plan, sinon la géométrie du LCP n'a plus de
    // propriétaire et la sonde ne peut plus rien vérifier.
    noJobTextClass: 'text-stone-600 max-w-lg mx-auto mb-5',
    // L'élément élu : le CORPS de la carte « mission requise » — l'état par
    // défaut, celui que la coquille publie ; le repli de `<Suspense>` ne
    // l'énonce pas (20/10/2026).
    lcpChamp: 'noJobTextClass',
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
    // Le CADRE de la page (28/09/2026) : il portait `py-8` en littéral, écrit
    // deux fois — dans src/pages/Support.js et dans sa coquille. C'est le pas
    // commun des cadres de page publiques (`cadre-page`), qui est FLUIDE là où
    // un `py-8` fixe donnait 32 px de tête à toutes les tailles d'écran.
    frameClass: 'max-w-2xl mx-auto px-4 cadre-page',
    titleKey: 'support',
    subtitleKey: 'supportSubtitle',
    // Le sous-titre est l'élément LCP de la page (mesuré : 16 720 px² mobile /
    // 9 480 desktop avec la police servie — voir /login) — UNE candidate au
    // premier paint. La chaîne est courte (`text-stone-600`) mais elle vit dans
    // CE plan seulement : Support.js et le corps de sa coquille la lisent,
    // aucun des deux ne la recopie (c'est ce que vérifie
    // scripts/__tests__/check-lcp-geometrie.test.js).
    subtitleClass: 'text-stone-600',
    // Classes de la page : lues par src/pages/Support.js, par TicketTracker.js ET par la coquille.
    titleClass: 'titre-page mb-2',
    enteteClass: 'mb-6 text-center',
    modeSousTitreClass: 'text-xs text-stone-500',
    directTitleClass: 'titre-entree mb-1',
    directSousTitreClass: 'text-sm text-stone-500 mb-5',
    liensClass: 'mt-6 text-center text-sm text-stone-500',
    lienClass: 'text-orange-600 underline underline-offset-2',
    suiviCarteClass: 'mb-6 carte-editoriale carte-publique',
    suiviTitreClass: 'titre-entree mb-1',
    suiviSousTitreClass: 'text-sm text-stone-500 mb-4',
    suiviRangeeClass: 'flex flex-col sm:flex-row gap-2',
    suiviChampClass: 'flex-1 rounded-lg border border-stone-300 px-4 py-2.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500',
    suiviBoutonClass: 'rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-50',
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
    // ── Le vocabulaire éditorial de la page, déclaré UNE fois ──────────────
    // Les deux cartes de choix, la carte de contact et les quatre lignes de
    // contact lisent ces cinq chaînes. Le 28/09/2026, elles portaient encore
    // une ombre (`shadow-xs`), un coin `rounded-2xl` et une pastille de teinte
    // EMPRUNTÉE (`bg-blue-100` pour le courriel, `bg-emerald-100` pour le
    // téléphone) : c'étaient les deux seules teintes du site qui
    // n'appartenaient à personne. La pastille ronde, elle, prend le sable et
    // l'orange de la marque — c'est la même que sur l'accueil, et le glyphe qui
    // la remplit dit déjà de quel moyen de contact il s'agit.
    // Le `p-6` de ces deux cartes est devenu `carte-publique` (28/09/2026) : le
    // rembourrage d'une carte est LE MÊME pas partout, y compris sur les cartes
    // de l'accueil et de /about, qui portaient le même littéral chacune de leur
    // côté. Ce qui reste ici est ce qui DISTINGUE ces cartes (elles se cliquent,
    // elles centrent leur contenu), jamais leur pas.
    carteClass: 'carte-editoriale carte-publique',
    carteModeClass:
      'carte-editoriale carte-editoriale-cliquable carte-publique flex flex-col items-center gap-3 text-center',
    pastilleModeClass: 'pastille-rond pastille-rond-large',
    titreEntreeClass: 'titre-entree',
    // L'élément élu CHANGE DE CAMP selon la taille depuis le 28/09/2026 (le
    // titre d'entrée est passé devant en desktop) : la déclaration porte donc
    // les deux, comme la sonde qui la lit.
    lcpChamp: { mobile: 'subtitleClass', desktop: 'titreEntreeClass' },
    ...BLOC_CONTACT,
    modes: [
      // Le glyphe du mode est DESSINÉ : la page publiait déjà un composant
      // lucide (`Bot`, `Phone`) là où la coquille publiait l'emoji de la clé —
      // deux dessins pour un même mode. Les deux canaux lisent le même `icone`,
      // et la couleur vient de la pastille qui le porte (`currentColor`).
      {
        icone: 'supportRobot',
        titleKey: 'supportRobotTitle',
        subtitleKey: 'supportRobotSubtitle',
      },
      {
        icone: 'contactCall',
        titleKey: 'supportDirectTitle',
        subtitleKey: 'supportDirectSubtitle',
      },
    ],
    rows: [
      {
        icone: 'contactCall',
        labelKey: 'contactCall',
        href: telHref,
        value: CONTACT.phoneDisplay,
        rowClass: LIGNE_CONTACT,
      },
      {
        icone: 'contactWhatsapp',
        labelKey: 'contactWhatsapp',
        href: CONTACT.whatsappUrl,
        value: CONTACT.phoneDisplay,
        external: true,
        rowClass: LIGNE_CONTACT,
      },
      {
        icone: 'contactSendEmail',
        labelKey: 'contactSendEmail',
        href: mailtoHref,
        value: CONTACT.email,
        breakAll: true,
        rowClass: LIGNE_CONTACT,
      },
      {
        // Cette ligne N'EST PAS un lien (elle n'a pas de `href`) : c'est elle
        // qui décide, dans les deux canaux, qu'aucune flèche n'est peinte —
        // une flèche promet une destination.
        icone: 'contactAddress',
        labelKey: 'contactAddress',
        value: CONTACT.address,
        rowClass: LIGNE_CONTACT,
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
    // L'élément LCP de /about est sa COLONNE, pas un texte — RE-MESURÉ le
    // 20/10/2026 : le navigateur élit `frameClass` (191 786 px² mobile,
    // 196 500 desktop), au premier paint, dans les deux canaux. Jusqu'au
    // 25/09/2026 c'était le paragraphe d'introduction (74 466 / 80 262 px²) ;
    // la sonde de cette époque est l'histoire, pas la déclaration.
    //
    // Ce que la mesure A/B a établi, et qui décide de la doctrine : sous
    // `prefers-reduced-motion: reduce` — donc titrage IMMOBILE, la feuille
    // éteint le reflet — la colonne est élue PAREIL (191 786 / 196 500). La
    // cause est la page, pas l'effet : un conteneur de 191 786 px² de fond et de
    // texte est la plus grande peinture, qu'un titre soit animé ou non. La
    // décision du 20/10/2026 est donc d'ACCEPTER cette élection et de la
    // DÉCLARER (`lcpChamp`), au lieu de la combattre : le titrage du site est
    // cohérent, et la garantie « React ne peint pas plus grand que la coquille »
    // porte ici sur la colonne entière (les deux canaux la peignent depuis le
    // même `frameClass`, donc elle est de même aire — c'est ce que vérifie
    // `e2e/lcp-geometrie.spec.js`).
    //
    // Les trois chaînes étaient recopiées dans src/pages/About.js et
    // vite-plugins/prerender/shells-routes.js. `frameClass` porte la largeur et
    // le rembourrage du corps ; `introClass` la hauteur du texte, et
    // `titleClass` le titre animé.
    frameClass: 'max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 cadre-page',
    titleClass: 'titre-page mb-4',
    introClass: 'text-stone-600 mb-8',
    // L'ÉLÉMENT ÉLU DE CETTE ROUTE EST LA COLONNE DU CHROME, pas un texte du
    // corps (191 786 / 196 500 px², 20/10/2026, stable sur trois passages).
    // `COLONNE_CLASS` est son domicile : la chaîne n'est pas recopiée ici, et
    // les deux canaux la publient depuis `app-chrome.js` — donc ils peignent la
    // même colonne, de même aire.
    lcpColonne: COLONNE_CLASS,
    // Le PAS de la carte (28/09/2026) : les trois promesses portaient
    // `carte-editoriale p-6`, la MÊME chaîne écrite deux fois — ici la page, et
    // dans la coquille. `carte-publique` est le pas commun aux cartes du site
    // (src/index.css) ; ce qui reste propre à cette page est son dessin
    // (`carte-editoriale`), jamais son rembourrage.
    carteClass: 'carte-editoriale carte-publique',
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
    frameClass: 'max-w-2xl mx-auto px-4 cadre-page',
    titleClass: 'titre-page mb-2',
    introClass: 'text-stone-600 mb-3',
    noteClass: 'text-sm text-stone-500 mb-6',
    // Le vocabulaire éditorial des quatre lignes de contact : le MÊME bloc que
    // /support (`BLOC_CONTACT`, plus haut). Les deux pages publiaient la même
    // ligne sous deux habillages — un cadre arrondi ici, un cadre arrondi
    // là-bas — et les deux sont maintenant une entrée de liste.
    ...BLOC_CONTACT,
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
    // `breakAll` est l'identité de LA LIGNE (un e-mail qui se coupe proprement,
    // sans déborder de sa colonne) et non la mise en page de la page : les deux
    // canaux doivent rendre la même ligne, donc ils la lisent ici plutôt que de
    // la réécrire chacun de leur côté.
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
        href: telHref,
        value: CONTACT.phoneDisplay,
        rowClass: LIGNE_CONTACT,
      },
      {
        icone: 'contactWhatsapp',
        labelKey: 'contactWhatsapp',
        href: CONTACT.whatsappUrl,
        value: CONTACT.phoneDisplay,
        external: true,
        rowClass: LIGNE_CONTACT,
      },
      {
        icone: 'contactSendEmail',
        labelKey: 'contactSendEmail',
        href: mailtoHref,
        value: CONTACT.email,
        breakAll: true,
        rowClass: LIGNE_CONTACT,
      },
      {
        icone: 'contactAddress',
        labelKey: 'contactAddress',
        href: CONTACT.mapsUrl,
        value: CONTACT.address,
        external: true,
        rowClass: LIGNE_CONTACT,
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
    // Ces six chaînes étaient recopiées dans src/pages/Privacy.js et
    // vite-plugins/prerender/shells-routes.js : une retouche d'un seul côté
    // faisait diverger les deux peintures en silence.
    //
    // Refonte éditoriale du 28/09/2026 : le titre d'une section prend le dessin
    // des titres d'entrée du site (serif, un cran sous `.titre-section`) et
    // chaque section devient une ENTRÉE à filet (`.bloc-de-section`) — quatre
    // paragraphes séparés par du vide se lisaient comme un document, quatre
    // entrées à filet se lisent comme une liste ordonnée, le vocabulaire de
    // l'accueil. La TAILLE du titre ne bouge pas (`1.25rem`, soit le `text-xl`
    // qu'elle portait) : le plus grand texte peint reste le CORPS d'une
    // section, donc l'élément LCP de la page reste celui sur lequel elle a été
    // mesurée.
    frameClass: 'max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 cadre-page',
    titleClass: 'titre-page mb-4',
    introClass: 'text-stone-600 mb-8',
    sectionTitleClass: 'titre-entree mb-2',
    sectionBodyClass: 'text-stone-600',
    sectionWrapClass: 'bloc-de-section',
    // L'élément élu : le CORPS d'une section, pas l'introduction — mesuré le
    // 25/09/2026 et toujours vrai le 20/10/2026, titre animé compris.
    lcpChamp: 'sectionBodyClass',
    sections: [
      { titleKey: 'privacyDataTitle', bodyKey: 'privacyDataBody' },
      // Les sous-traitants viennent APRÈS « données conservées » : la page dit
      // d'abord ce qu'elle garde, puis chez qui. La liste fait autorité dans
      // PRIVACY.md §2, et un test refuse un prestataire appelé par le code sans
      // y être nommé (backend/tests/test_sous_traitants_politique.py).
      { titleKey: 'privacyProcessorsTitle', bodyKey: 'privacyProcessorsBody' },
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
    // Même vocabulaire aussi : les deux pages se lisent d'un bout à l'autre
    // comme un document — titre serif et sections à filet.
    frameClass: 'max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 cadre-page',
    titleClass: 'titre-page mb-4',
    introClass: 'text-stone-600 mb-8',
    sectionTitleClass: 'titre-entree mb-2',
    sectionBodyClass: 'text-stone-600',
    sectionWrapClass: 'bloc-de-section',
    // Trois sections AJOUTÉES le 18/10/2026, toutes dérivées du comportement
    // réel du produit, pas d'un modèle de document :
    //   * cookies — les seuls cookies posés sont la session httpOnly et le
    //     jeton CSRF (cf. `set_auth_cookies`), et la mesure d'audience est
    //     désormais CONDITIONNÉE au consentement (`src/utils/consent.js`) ;
    //   * annulation et remboursement — `DELETE /jobs/{id}` rembourse le
    //     séquestre tant que le versement n'est pas parti, et refuse ensuite
    //     (409) : la page dit exactement cette règle ;
    //   * âge minimum — 18 ans, la politique que l'inscription applique.
    // La coquille pré-rendue lit CES sections (shells-routes.js) : les ajouter
    // ici les publie aussi sans JavaScript. Aucun texte n'est recopié ailleurs.
    sections: [
      { titleKey: 'termsServiceTitle', bodyKey: 'termsServiceBody' },
      { titleKey: 'termsAccountTitle', bodyKey: 'termsAccountBody' },
      { titleKey: 'termsPaymentTitle', bodyKey: 'termsPaymentBody' },
      { titleKey: 'termsRefundTitle', bodyKey: 'termsRefundBody' },
      { titleKey: 'termsCookiesTitle', bodyKey: 'termsCookiesBody' },
      { titleKey: 'termsAgeTitle', bodyKey: 'termsAgeBody' },
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
 * La SEULE exception est un RENVOI à une autre déclaration du MÊME plan :
 * `icone`/`*Icon` nomme un dessin (et la coquille en publie le repère), et
 * `lcpChamp` nomme le champ dont la géométrie est élue comme LCP (voir la
 * doctrine en tête). Aucun des deux n'est un texte à publier — l'oublier a fait
 * refuser le build le 20/10/2026, qui réclamait « introClass » dans la coquille.
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
  // Un RENVOI, pas un texte : `lcpChamp` porte le NOM du champ dont la
  // géométrie est élue comme LCP (`introClass`, `stepNoticeClass`…) et
  // `lcpColonne` cite la classe de la colonne du chrome à son domicile
  // (`classes-chrome.js`). Aucun des deux n'est quelque chose que la coquille
  // publie. Un renvoi peut être un objet (`{ mobile, desktop }`, /support), donc
  // l'exclusion se fait à la CLÉ et pas seulement sur la valeur.
  const porteUnRenvoi = (nom) => nom === 'lcpChamp' || nom === 'lcpColonne';
  const visiter = (valeur, nom) => {
    if (typeof valeur === 'string') {
      if (porteUnRenvoi(nom)) return;
      if (porteUneIcone(nom)) icones.push(valeur);
      else (porteUneCle(nom) ? cles : textes).push(valeur);
      return;
    }
    if (Array.isArray(valeur)) {
      valeur.forEach((element) => visiter(element, nom));
      return;
    }
    if (valeur && typeof valeur === 'object') {
      Object.entries(valeur).forEach(([cle, sousValeur]) => {
        if (porteUnRenvoi(cle)) return;
        visiter(sousValeur, cle);
      });
    }
  };
  visiter(plan, null);
  return { cles: [...new Set(cles)], textes: [...new Set(textes)], icones: [...new Set(icones)] };
}
