/**
 * LE CADRE DES ROUTES D'APPLICATION — ce que `page-sections.js` est aux routes
 * pré-rendues. Pourquoi un SECOND fichier, et pas une ligne de plus dans le
 * premier : parce que les deux répondent à deux contrats différents.
 *
 * ── La règle qui a décidé de la séparation ─────────────────────────────────
 * `page-sections.js` est lu par DEUX canaux : les pages React ET les coquilles
 * pré-rendues (`vite-plugins/prerender/`). C'est ce qui l'oblige à ne déclarer
 * que des classes qu'une coquille peut recopier à l'identique, et ce qui en fait
 * le propriétaire du contrat LCP. Les routes déclarées ici n'ont PAS de coquille :
 * elles sont servies par `app.html` en `noindex`, donc aucun HTML pré-rendu,
 * aucun élément LCP élu par une peinture statique, et rien à comparer entre deux
 * canaux. Leur écrire un cadre dans `page-sections.js` mélangerait les deux
 * contrats : un lecteur du fichier ne saurait plus si la classe qu'il lit est
 * publiée par une coquille ou seulement par React.
 *
 * ── Ce que ce fichier supprime ─────────────────────────────────────────────
 * Les pages d'application écrivaient leur cadre à la main, et il avait divergé
 * de trois façons, toutes vérifiables en lisant les pages :
 *   • CINQ LARGEURS — `max-w-7xl` (tableau de bord, détail de mission),
 *     `max-w-6xl` (messages), `max-w-4xl` (profil, création de mission) ;
 *   • DEUX VOCABULAIRES DE GOUTTIÈRE — `px-4 sm:px-6 lg:px-8` sur trois pages,
 *     `px-4` seul sur deux autres : le texte ne s'écarte donc pas du bord de la
 *     même façon selon la page, au-delà de 640 px ;
 *   • UN PAS DE PAGE PARFOIS ABSENT — `py-8` sur quatre pages, rien sur la
 *     cinquième : la distance entre la barre de navigation et le premier bloc
 *     changeait d'une page à l'autre.
 * Le pas est désormais celui du site (`cadre-page`, donc `--rythme-page`, FLUIDE
 * — une valeur fixe laissait 32 px de tête sur un téléphone comme sur un 27
 * pouces), et la gouttière est la même partout.
 *
 * ── CE QUI EST DÉLIBÉRÉMENT LAISSÉ PROPRE À CHAQUE PAGE ────────────────────
 * La LARGEUR et le PAS INTERNE. La largeur d'abord : elle suit le contenu, pas
 * l'humeur — un formulaire de création de mission ne se lit pas à la largeur
 * d'un tableau de bord, et `max-w-4xl` y est un choix, pas un reliquat. Chaque
 * entrée dit donc POURQUOI sa largeur, et une largeur qui changerait sans que sa
 * raison change est une régression, pas une retouche.
 * Le pas interne ensuite, et c'est le point sur lequel il faut être explicite :
 * `--rythme-section` (60 à 104 px) est calibré pour le pas entre les SECTIONS
 * d'une page éditoriale longue, où l'air fait lire la page comme un sommaire. Une
 * pile de cartes de tableau de bord n'est pas un sommaire : y appliquer ce pas
 * ouvrirait des trous de 100 px entre deux blocs qui se répondent — donc NON, et
 * cette décision ne bouge pas.
 *
 * ── 09/10/2026 : LES JETONS SONT LUS, ILS NE SONT PLUS RECOPIÉS ────────────
 * Le relevé des cinq routes (RAPPORT-RYTHME-EDITORIAL.md) a montré ce que
 * « chaque page garde son pas » voulait dire en pratique : quatre valeurs FIXES
 * écrites à la main (32, 24, 16 et 8 px), dont trois qu'aucun jeton ne produit,
 * plus un rembourrage de carte à 24 px fixes quand le jeton du site est FLUIDE
 * (22,08 → 28,65 px), plus un titre de tableau de bord collé à sa première carte
 * (4 px d'encre — le minimum relevé sur le site).
 *
 * DEUX classes lisent maintenant les jetons (déclarées dans `src/index.css`, à
 * côté des trois autres, avec leur relevé) :
 *   • `.tete-app` — le pas de l'EN-TÊTE vers le corps (`--rythme-tete`), posé
 *     par `src/components/CadrePage.js` sur le DERNIER élément de l'en-tête ;
 *   • `.bloc-app` — le pas APRÈS un bloc de l'écran (`--rythme-bloc`), posé par
 *     la page sur ses propres blocs.
 * Et le rembourrage des cartes se lit par `carte-publique` — le même couple
 * classe/jeton que les pages publiques, et non un utilitaire fixe.
 *
 * Ce qui reste PROPRE À CHAQUE PAGE : la largeur (voir ci-dessus), et le pas
 * INTERNE d'un groupe — les champs d'un formulaire, les lignes d'une liste : le
 * pas entre deux champs n'est pas le pas entre deux blocs de l'écran.
 *
 * ── Un seul consommateur, et il est nommé ─────────────────────────────────
 * Ces entrées n'ont qu'un lecteur : le composant `src/components/CadrePage.js`,
 * auquel chaque page délègue son cadre — et le test
 * `src/components/__tests__/cadres-app.test.jsx` refuse qu'une page d'ici
 * ré-écrive son cadre à la main. `emplacement` nomme le fichier que le test
 * surveille : une page renommée fait rougir, au lieu de laisser un cadre
 * déclaré que plus personne ne lit.
 */

/**
 * ── LA RÈGLE DU PIED DE PAGE PENDANT LE CHARGEMENT (08/10/2026) ──────────────
 *
 * Un squelette d'attente a UNE raison d'être : que rien ne bouge quand les
 * données arrivent. Il la tient de deux façons, et le choix entre les deux se
 * décide ICI, par route — c'est la même déclaration que le cadre, parce que
 * c'est la même question (« quelle géométrie cette route a-t-elle ? ») posée à
 * un autre moment.
 *
 *   • `pied-hors-ecran` — la page grandit avec ses DONNÉES, donc le squelette ne
 *     peut pas la répliquer. Le pied de page commence alors au bas de la fenêtre
 *     (le shell est `min-h-screen` + `main.flex-1`) et il est POUSSÉ hors de
 *     l'écran quand le contenu arrive : un déplacement que Chrome compte, de la
 *     valeur de la partie visible. La réserve `HAUTEUR_PIED_HORS_ECRAN` remplit
 *     l'écran moins la barre, donc le pied de page démarre SOUS la ligne de
 *     flottaison et n'a plus rien à quitter — ni pendant, ni après.
 *
 *   • `replique` — la hauteur de la page est CONNUE sans ses données (elle ne
 *     dépend que de la fenêtre). Le squelette doit alors faire EXACTEMENT la
 *     hauteur de la page (« le pied de page peut rester visible, il ne bouge
 *     plus »), et une réserve d'écran serait PIRE que le mal : sur une fenêtre
 *     plus haute que la page, elle ferait ENTRER le pied de page dans l'écran à
 *     l'arrivée des données au lieu de le laisser tranquille.
 *
 *   • `generique` — la route n'a pas de squelette dédié : son repli est le
 *     `PageSkeleton` partagé, qui est en 100vh pour la raison inverse (sa
 *     destination est INCONNUE, cf. son commentaire) et tient donc déjà la règle.
 *
 * UNE RÈGLE EST UNE MESURE, PAS UNE INTENTION. Relevé du 08/10/2026 (Chromium,
 * fixture, 412×823 / 1350×940 / 1350×1200, chargement RETENU pour que le
 * squelette soit peint pour de bon) — le pied de page, hauteur et position :
 *   • `/profile` : page 2 914,8 (mobile) et 2 403,9 px (desktop) pour un
 *     squelette de 838,5 / 993 / 1 253 px — le pied de page était VISIBLE pendant
 *     le chargement (CLS 0,1010 mesuré le 07/10, source nommée : le pied de page
 *     à y=858,9 puis tiré de ~1 600 px plus bas). Réserve appliquée depuis.
 *   • `/dashboard` : page 2 527,3 / 1 522,3 px pour un squelette de 1 500,5 px
 *     (mobile) et 960 px (desktop) — hors écran par ACCIDENT aux deux tailles
 *     d'usage, mais VISIBLE (y=1 119) dans une fenêtre de 1 200 px, et rien ne
 *     le disait. Réserve appliquée : elle suit la fenêtre, donc les trois
 *     tailles sont couvertes.
 *   • `/jobs/:id` : avec une mission LONGUE (créée par le chemin réel de la
 *     fixture, `POST /api/jobs`), page 2 904,7 (mobile) et 1 635,6 px (desktop)
 *     pour un squelette de 908,5 / 590 px — CLS 0,0577 en desktop, dont le plus
 *     grand décalage (0,0537) NOMME le pied de page (1 350×81 px à y=858,6, puis
 *     poussé hors écran). Réserve appliquée.
 *   • `/messages` : page 884,8 px contre un squelette de 871 px — 13,8 px d'écart,
 *     et c'est TOUT l'écart : la boîte du titre (`h-8` = 32 px contre un
 *     `<h1>` de 45,8 px à 1350). Le pied de page passait de y=936 (VISIBLE, 4 px)
 *     à 949,8 en 1350×940 — 13,8 px de déplacement pour un écart de 13,8 px. La
 *     hauteur de cette page ne dépend pas des données (la carte des
 *     conversations fait `75vh`), donc la règle est `replique` : le squelette
 *     réserve la BOÎTE DU TITRE (`.reserve-titre-page`), calculée de la même
 *     déclaration que `.titre-page`.
 */

/**
 * La hauteur réservée par un squelette dont la page peut être plus haute que
 * lui : l'écran moins la barre de navigation (65 px, `h-16` plus sa bordure),
 * soit la fenêtre entière une fois le cadre de page et ses pas comptés. Le pied
 * de page démarre donc SOUS la ligne de flottaison, quelle que soit la taille de
 * la fenêtre — c'est ce qui rend la règle vraie sur un écran qu'aucune sonde ne
 * visite.
 *
 * LA CLASSE EST ÉCRITE DANS `src/index.css`, ET C'EST UNE MESURE (08/10/2026) :
 * un utilitaire Tailwind ARBITRAIRE portant un `calc()` sans espaces autour du
 * `-` a été essayé d'abord, et il n'avait AUCUN effet — Tailwind recopie la
 * valeur verbatim, donc du CSS INVALIDE que le navigateur rejette. Le build, les
 * tests unitaires et le CLS de l'hôte restaient verts pendant que la réserve ne
 * réservait rien ; seule la sonde des routes connectées l'a nommé (« réserve de
 * 0 px pour 758 px annoncés »), et c'est pourquoi elle lit désormais la hauteur
 * MINIMALE PEINTE, pas la chaîne de classes.
 *
 * (Le jeton n'est pas recopié ici non plus, et ce n'est pas une coquetterie :
 * Tailwind lit des JETONS dans les fichiers qu'il scanne, prose comprise — une
 * valeur arbitraire écrite dans ce commentaire générait son utilitaire, sans
 * porteur, et `scripts/check-css-selecteurs-morts.js` la refusait.)
 */
export const HAUTEUR_PIED_HORS_ECRAN = 'reserve-pied-hors-ecran';

/** Les trois règles qu'un squelette d'attente peut tenir (voir l'en-tête). */
export const REGLES_DE_SQUELETTE = {
  PIED_HORS_ECRAN: 'pied-hors-ecran',
  REPLIQUE: 'replique',
  GENERIQUE: 'generique',
};

/**
 * LES RÈGLES DE CHARGEMENT DES ROUTES DONT LE CADRE EST DÉCLARÉ AILLEURS
 * (09/10/2026).
 *
 * ── Pourquoi une table À PART, alors que `CADRES_APP` en porte déjà une ────
 * Une seule raison, et elle est mesurée : /payment a une COQUILLE pré-rendue,
 * donc son cadre appartient à `src/config/page-sections.js` (les deux canaux de
 * cette route lisent la même chaîne — c'est un test de `cadres-app.test.jsx`),
 * et son cadre n'a rien à faire dans `CADRES_APP`. Sa règle de CHARGEMENT, elle,
 * est purement React : la coquille ne publie pas d'état de chargement. La
 * déclarer dans le plan a été essayé le 09/10/2026 et `npm run build` l'a
 * REFUSÉE (`exigerCorpsDeclare` a réclamé « pied-hors-ecran » dans la coquille),
 * ce qui est le contrat même de `page-sections.js` : « un plan ne porte AUCUNE
 * donnée interne : ce qu'il déclare est publié par la coquille, sans
 * exception ». Une règle que la coquille ne peut pas porter vit donc ici, avec
 * le vocabulaire et la réserve — pas dans le plan.
 *
 * ── La forme est CELLE de `CADRES_APP[route].squelette` ────────────────────
 * `{ regle, hauteurClass?, pourquoi }`, pour que le même contrôle de déclaration
 * s'y applique sans second vocabulaire (cf. `cadres-app.test.jsx`, qui rejoue
 * `manquementsDeLaRegle` sur les DEUX tables) et pour que le consommateur
 * (ici `PaymentSkeleton`) lise la règle au lieu de recopier une classe.
 *
 * ── La règle de /payment, MESURÉE le 09/10/2026 ────────────────────────────
 * Protocole : chunk de la route RETENU (le repli de `<Suspense>` est peint pour
 * de bon) puis relâché, connexion à la fixture, 412×823 et 1350×940 — la même
 * sonde que les routes de `CADRES_APP`, désormais PERMANENTE
 * (`e2e/cadres-app.spec.js`, cas « chunk retenu » de /payment).
 *   • PENDANT, réserve active : `main` 954 px (mobile) et 939 (desktop), pied de
 *     page 141 px à y=1019 pour une fenêtre de 823, 81 px à y=1004 pour 940 —
 *     HORS écran aux deux tailles ; réserve PEINTE 758 / 875 px, soit la fenêtre
 *     moins les 65 px de la barre.
 *   • APRÈS (la page) : `main` 700,38 px et pied à 765,38 (mobile, branche
 *     « mission requise », la plus COURTE) ; 794 et 859 (desktop).
 *   • CLS du relâchement : 0,0218 mobile — un seul décalage, le pied de page qui
 *     entre UNE fois dans l'écran — et 0,0132 desktop (0,0093 le pied de page,
 *     0,0039 la pastille de la barre du haut).
 *   • TÉMOIN SANS LA RÉSERVE (même journée, même protocole) : en desktop le pied
 *     de page restait VISIBLE pendant tout le chargement (y=859, déjà à sa place
 *     finale) et le CLS valait 0,0148. La réserve ne coûte donc rien : elle
 *     GAGNE 0,0016 et rend la règle vraie aux DEUX tailles. (Le témoin du repli
 *     RÉDUIT — en-tête seul, sans réserve — avait été mesuré la veille : 0,0801,
 *     le pied de page inséré dans l'écran dès le chargement, puis poussé vers le
 *     bas quand la page plus haute arrivait. C'est ce relevé-là qui interdit de
 *     rétrécir le repli sous la hauteur de sa destination.)
 *   • CE QUI FERAIT BASCULER LA DÉCISION, écrit pour que la prochaine mesure le
 *     voie : un pied de page VISIBLE pendant le retrait du chunk (le cas
 *     permanent rougit) — la réponse serait de réserver PLUS, pas moins ; ou une
 *     réserve de 0 px peinte alors qu'elle est annoncée (le cas permanent
 *     rougit aussi, cf. `calc(100vh-65px)` et son CSS invalide).
 */
export const REGLES_DE_CHARGEMENT = {
  '/payment': {
    regle: REGLES_DE_SQUELETTE.PIED_HORS_ECRAN,
    hauteurClass: HAUTEUR_PIED_HORS_ECRAN,
    pourquoi:
      'sa hauteur dépend de la BRANCHE de l’URL (formulaire et cartes de paiement avec `job_id`, ' +
      'carte « mission requise » sans elle : 700,4 px de `main` en mobile) et le repli de ' +
      '`<Suspense>` est peint AVANT que la page existe : il réserve la branche la PLUS HAUTE. ' +
      'Mesuré le 09/10/2026 : sans réserve le pied de page restait VISIBLE en desktop pendant tout ' +
      'le chargement (y=859 pour une fenêtre de 940, déjà à sa place finale) ; avec elle il démarre ' +
      'HORS écran aux deux tailles — 1019 pour 823 (mobile), 1004 pour 940 (desktop), réserve ' +
      'peinte 758 / 875 px — et le relâchement vaut 0,0218 mobile / 0,0132 desktop (témoin sans ' +
      'réserve : 0,0148 desktop)',
  },
};

/**
 * Le cadre d'une route d'application. `emplacement` est le fichier CONSOMMATEUR,
 * relativement à `src/` — pas une décoration : c'est lui que le test ouvre pour
 * vérifier que la page lit bien sa déclaration au lieu de la recopier.
 *
 * `squelette` est OBLIGATOIRE, et c'est le point : une route ajoutée ici doit
 * dire quelle règle son état de chargement tient, avec la mesure qui l'a décidée
 * (`pourquoi`) — sans quoi la seule réponse serait « on verra bien », qui est
 * exactement ce que la sonde des routes connectées transforme en rouge.
 */
export const CADRES_APP = {
  '/dashboard': {
    emplacement: 'pages/Dashboard.js',
    // La plus large : le tableau de bord aligne des colonnes de statistiques et
    // une liste de missions, deux contenus qui respirent en largeur.
    frameClass: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 cadre-page',
    titleClass: 'titre-page',
    squelette: {
      regle: REGLES_DE_SQUELETTE.PIED_HORS_ECRAN,
      hauteurClass: HAUTEUR_PIED_HORS_ECRAN,
      pourquoi:
        'la page grandit avec ses données (liste des missions récentes, 5 lignes contre 3 réservées : ' +
        '1 522,3 px mesurés contre un squelette de 960) et le pied de page était visible (y=1 119) dans une ' +
        'fenêtre de 1 200 px',
    },
  },
  '/profile': {
    emplacement: 'pages/Profile.js',
    // Colonne de lecture : un formulaire de profil se parcourt du regard, il ne
    // se compare pas en colonnes.
    frameClass: 'max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 cadre-page',
    titleClass: 'titre-page',
    squelette: {
      regle: REGLES_DE_SQUELETTE.PIED_HORS_ECRAN,
      hauteurClass: HAUTEUR_PIED_HORS_ECRAN,
      pourquoi:
        'la page grandit avec ses données (2 914,8 px mesurés en mobile et 2 403,9 en desktop contre un ' +
        'squelette de 838,5 / 993 / 1 253) : le pied de page s’ancrait à l’écran pendant le chargement ' +
        '(CLS 0,1010 sur /profile desktop, mesuré le 07/10/2026, source nommée)',
    },
  },
  '/messages': {
    emplacement: 'pages/Messages.js',
    // Deux colonnes (fils et conversation) : entre le tableau de bord et la
    // colonne de lecture, la largeur où les deux tiennent sans se tasser.
    frameClass: 'max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 cadre-page',
    titleClass: 'titre-page',
    squelette: {
      regle: REGLES_DE_SQUELETTE.REPLIQUE,
      pourquoi:
        'sa hauteur ne dépend PAS des données (la carte des conversations fait 75vh) : le squelette doit ' +
        'donc faire exactement celle de la page. Mesuré : 871 px contre 884,8 px pour la page — les 13,8 px ' +
        'd’écart étaient la BOÎTE DU TITRE (h-8 = 32 px au lieu de 45,8 à 1350), et c’est la distance exacte ' +
        'dont le pied de page bougeait. Une réserve d’écran serait pire : sur une fenêtre de 1 200 px, le ' +
        'pied de page (visible dans l’état final) ENTRERAIT dans l’écran au lieu d’y rester',
    },
  },
  '/create-job': {
    emplacement: 'pages/CreateJob.js',
    // Formulaire : même raison que /profile. Sa gouttière était `px-4` seul —
    // c'est précisément la divergence que cette déclaration ferme.
    frameClass: 'max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 cadre-page',
    titleClass: 'titre-page',
    squelette: {
      regle: REGLES_DE_SQUELETTE.GENERIQUE,
      pourquoi:
        'AUCUN squelette dédié, et c’est une MESURE qui l’a décidé (09/10/2026) — pas une préférence. La ' +
        'route n’attend AUCUNE donnée : avec ses trois requêtes `/api` RETENUES, le formulaire se peint ' +
        'quand même (0 pulse dans le cadre, aucune réserve, relevé du 08/10/2026). Son SEUL état d’attente ' +
        'est donc le repli du `<Suspense>` de `src/App.js` pendant le chargement du CHUNK de la route, ' +
        'c’est-à-dire le `PageSkeleton` partagé — en 100vh pour la raison inverse (sa destination est ' +
        'inconnue, cf. `src/components/SkeletonLoader.js`). LA MESURE QUI TRANCHE retient ce chunk pour ' +
        'que le repli soit peint pour de bon (sonde des routes connectées, 412×823 et 1350×940, quatre ' +
        'runs par taille) : pendant tout le chargement le pied de page démarre SOUS la ligne de ' +
        'flottaison — y=984 pour une fenêtre de 823 (mobile), y=1005 pour 940 (desktop) — et le ' +
        'relâchement ne déplace RIEN de visible : CLS 0,0000 en mobile (ZÉRO décalage) et 0,0039 en ' +
        'desktop, identiques sur les quatre runs, dont l’unique source est la pastille de notifications ' +
        'de la barre du HAUT — le même décalage que les quatre autres routes connectées, et qu’un ' +
        'squelette dédié ne toucherait pas (la barre du haut n’est pas dans son périmètre). Un squelette ' +
        'dédié n’enlèverait donc rien de mesurable : il ne changerait ni la position du pied de page ' +
        '— 100vh et `HAUTEUR_PIED_HORS_ECRAN` (100vh − 65 px) gardent tous deux le pied de page sous la ' +
        'ligne de flottaison, quelle que soit la hauteur de la fenêtre — ni le CLS. CE QUI FERAIT ' +
        'BASCULER LA DÉCISION, écrit pour que la prochaine mesure le voie : un pied de page VISIBLE ' +
        'pendant le retrait du chunk, ou un décalage du relâchement attribué à un nœud du CADRE. Le cas ' +
        '« repli GÉNÉRIQUE » de la sonde rejoue cette mesure à chaque exécution et rougirait alors — la ' +
        'réponse serait la réserve, comme pour `/dashboard`, `/profile` et `/jobs/:id`. CONTREPARTIE ' +
        'MESURÉE, et elle n’est PAS un argument pour un cinquième squelette : ce repli ne publie aucun ' +
        'TEXTE (22 nœuds peints, 0 élément de contenu dans le premier écran), mais les quatre squelettes ' +
        'dédiés du dépôt sont eux aussi des barres grises sans texte — un squelette dédié peindrait la ' +
        'même chose, en gris.',
    },
  },
  '/jobs/:id': {
    emplacement: 'pages/JobDetails.js',
    // Une mission se lit à côté de ses actions : large, comme le tableau de bord.
    frameClass: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 cadre-page',
    titleClass: 'titre-page',
    squelette: {
      regle: REGLES_DE_SQUELETTE.PIED_HORS_ECRAN,
      hauteurClass: HAUTEUR_PIED_HORS_ECRAN,
      pourquoi:
        'la page grandit avec la DESCRIPTION de la mission (aucune longueur maximale) : avec une mission ' +
        'longue, elle fait 2 904,7 px (mobile) et 1 635,6 (desktop) contre un squelette de 908,5 / 590, et ' +
        'le CLS mesuré en desktop (0,0577) nomme le pied de page (1 350×81 px à y=858,6, puis poussé hors écran). ' +
        'RELEVÉ DU 09/10/2026, SUR LES DEUX CAS que la fixture sert et que la sonde visite (annonce LONGUE, ' +
        'première mission ; annonce COURTE, seconde) : en desktop, le cas long vaut 0,0039 (cadre ' +
        '1 280×1 767,9 px — le pied de page, réservé sous la ligne de flottaison, ne remonte pas, et ce 0,0039 ' +
        'vient de la barre du HAUT, la pastille de notifications) tandis que le cas COURT vaut 0,0164 — sa page ' +
        'fait 1 280×795,3 px, donc la réserve la dépasse et le pied de page remonte DANS l’écran. En mobile, ' +
        '0,0000 dans les deux cas : la barre de navigation BASSE ne se réajuste plus quand la session se ' +
        'résout, sa hauteur ne dépendant plus du nombre d’items (09/10/2026)',
    },
  },
};

/**
 * Le cadre d'une route, ou une ERREUR NOMMÉE.
 *
 * Lever plutôt que rendre `undefined` : un cadre absent produirait une page sans
 * marge ni largeur maximale — donc une page qui a l'air d'un brouillon — et le
 * défaut serait attribué au CSS plutôt qu'à la clé mal orthographiée. Le refus
 * dit la clé ET la liste des clés connues, pour que la correction soit immédiate.
 */
export function cadreAppDe(chemin) {
  const cadre = CADRES_APP[chemin];
  if (!cadre) {
    throw new Error(
      `CadrePage : aucune déclaration de cadre pour « ${chemin} » (src/config/app-cadres.js) — ` +
        `les routes déclarées sont ${Object.keys(CADRES_APP).join(', ')}.`
    );
  }
  return cadre;
}
