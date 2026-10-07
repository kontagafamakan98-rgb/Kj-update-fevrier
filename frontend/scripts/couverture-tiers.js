// ── LA COUVERTURE DES CLASSES DE TIERS — la règle, possédée une fois ────────
//
// Le dépôt regarde les tiers par CINQ canaux, chacun avec sa règle et sa sonde.
// Chaque canal publie ses propres limites en prose, mais RIEN ne reliait une
// CLASSE de tiers aux canaux qui peuvent l'observer : on ne pouvait pas dire si
// la classe « lien rendu » était vue par quelqu'un, ni si une classe ajoutée
// demain le serait.
//
// Ce que ce trou coûtait, concrètement : une classe qu'aucun canal n'observe
// est un classement INVÉRIFIABLE. `CLASSEMENT_ORIGINES` dirait « cette origine
// a le droit d'être là parce qu'elle est un lien rendu, jamais une requête »
// pendant qu'aucune mesure ne confronterait jamais cette affirmation — une
// exemption qui survit à son contrôle est exactement ce que le dépôt refuse
// ailleurs (« une exemption qu'on n'ose plus retirer est une exemption qui
// mente »).
//
// ── Ce que ce module possède, et ce qu'il n'a PAS le droit de redéclarer ────
//   * `CANAUX` — le vocabulaire FERMÉ des vues : pour chacune, son module, sa
//     sonde, et OÙ sa déclaration de limites est écrite ;
//   * `MATRICE` — une ligne par CLASSE, qui nomme les canaux qui l'observent et
//     POURQUOI les autres ne l'observent pas.
//
// Les CLASSES (`SORTES`) ne sont pas redéclarées : elles viennent de
// `origines-bundles.js`, qui en est le propriétaire. Deux vocabulaires
// divergeraient à la première classe ajoutée — la faute que ce dépôt refuse
// partout (langues, pays, drapeaux, emplacements de la marque).
//
// ── Les cinq canaux, et pourquoi le partage statique/dynamique n'est pas ────
// « DEUX canaux » (un statique, un dynamique) serait plus court à écrire et faux
// sur cet arbre : les deux gardes statiques ne voient PAS la même chose — l'un
// lit ce que la coquille DÉCLARE (des balises, du CSS), l'autre lit les octets
// LIVRÉS (une URL écrite en clair dans le code, y compris dans une branche que
// personne n'exerce) — et c'est précisément cette différence qui a justifié un
// garde entier (`check-origines-bundles.js`, 27/09/2026). De même, la sonde
// d'après-interaction et celle de la carte différée répondent à deux questions
// différentes : l'une juge ce qu'un GESTE déclaré a le droit de contacter,
// l'autre ce qu'un bloc monté SANS aucun geste demande. Fusionner ces colonnes
// ferait dire à la matrice ce que le dépôt ne fait pas.
//
// ── Ce que ce module NE fait pas ───────────────────────────────────────────
// Il ne juge pas le BIEN-FONDÉ d'une classe : il ne dit pas si « lien rendu »
// est une bonne raison d'être là (c'est `CLASSEMENT_ORIGINES` et ses `preuve`).
// Il ne dit pas non plus si une limite de canal est vraie (chaque sonde le
// prouve, et sa prose le publie). Il dit UNE chose que personne ne disait :
// pour chaque classe, qui peut l'observer — et qui ne peut pas, avec pourquoi.

import { SORTES } from './origines-bundles.js';

/**
 * LES CINQ CANAUX. Vocabulaire FERMÉ : un canal cité par la matrice et absent
 * d'ici est un refus (le canal a été renommé ou supprimé et la matrice mentirait
 * en le citant).
 *
 * Chaque canal nomme :
 *   * `module` — la règle qui l'incarne (elle doit EXISTER sur disque) ;
 *   * `sonde` — ce qui l'exerce (un garde statique ou un parcours e2e : elle
 *     doit EXISTER, une sonde supprimée laisserait le canal sans exécutant) ;
 *   * `declaration` — OÙ ce canal publie ses propres limites, quand il le fait
 *     (`{ module, export, cle }`) : le garde le CHARGE et exige un tableau non
 *     vide, donc une déclaration vidée ou renommée rougit ;
 *   * `motif` — obligatoire quand `declaration` est `null` : pourquoi ce canal
 *     n'a pas de déclaration de limites à lui.
 */
export const CANAUX = {
  coquille: {
    nom: 'la coquille pré-rendue, telle qu’elle DÉCLARE',
    nature: 'statique',
    module: 'frontend/scripts/shell-remote-resources.js',
    // Le garde de ce canal lit les balises, le `rel` et le CSS des coquilles
    // servies : ce qui est ÉCRIT dans un document publié.
    sonde: 'frontend/scripts/check-shell-remote-resources.js',
    declaration: {
      module: 'frontend/scripts/tiers-avant-interaction.js',
      export: 'CE_QUE_LE_GARDE_STATIQUE_VOIT',
      cle: 'voit',
    },
  },
  livre: {
    nom: 'les fichiers LIVRÉS (le JS et le CSS du build)',
    nature: 'statique',
    module: 'frontend/scripts/origines-bundles.js',
    // Lit tous les octets livrés sans exécuter le code : la seule vue qui
    // attrape une origine écrite en clair, y compris dans une branche morte.
    sonde: 'frontend/scripts/check-origines-bundles.js',
    declaration: {
      module: 'frontend/scripts/origines-bundles.js',
      export: 'CE_QUE_CE_GARDE_VOIT',
      cle: 'voit',
    },
  },
  'avant-interaction': {
    nom: 'le navigateur, SANS aucun geste',
    nature: 'dynamique',
    module: 'frontend/scripts/tiers-avant-interaction.js',
    sonde: 'frontend/e2e/aucun-tiers-avant-interaction.spec.js',
    declaration: null,
    motif:
      'ce canal n’a pas de déclaration de limites à lui : son verdict est ABSOLU (« aucun tiers, ' +
      'jamais »), donc il n’a pas de cas légitime à nommer — ce qu’il ne peut pas voir (une classe ' +
      'qui n’est JAMAIS requêtée, une route qu’il ne visite pas) est une limite de l’observation ' +
      'elle-même, et c’est la matrice qui la porte',
  },
  'apres-interaction': {
    nom: 'le navigateur, APRÈS un geste déclaré',
    nature: 'dynamique',
    module: 'frontend/scripts/tiers-apres-interaction.js',
    sonde: 'frontend/e2e/tiers-apres-interaction.spec.js',
    declaration: {
      module: 'frontend/scripts/tiers-apres-interaction.js',
      export: 'CE_QUE_CETTE_SONDE_NE_PEUT_PAS_VOIR',
      cle: 'peutVoir',
    },
  },
  'mise-en-ecran': {
    nom: 'le bloc différé qui entre dans le viewport (sans geste)',
    nature: 'dynamique',
    module: 'frontend/src/components/DeferredMap.js',
    sonde: 'frontend/e2e/carte-facade.spec.js',
    declaration: null,
    motif:
      'ce canal n’a pas de déclaration de limites écrite : il est observé par le parcours de carte ' +
      'différée, qui vit avec ses preuves (`e2e/carte-facade.spec.js`), et sa limite est nommée par ' +
      'la matrice — un bloc que l’observateur ne voit jamais (jamais assez stable) ne monterait pas ' +
      'sa carte, et c’est ce parcours qui le dit',
  },
};

/**
 * LA MATRICE : une ligne par CLASSE de tiers, qui nomme les canaux qui
 * l’observent et POURQUOI les autres ne l’observent pas.
 *
 * Une CLASSE est une VALEUR du vocabulaire `SORTES` (`'lien rendu (href, pas une
 * requête)'`, `'chargé après interaction'`…) et non la clé de celui-ci : c’est
 * la valeur que `CLASSEMENT_ORIGINES[].sorte` stocke, donc la seule forme sous
 * laquelle une classe est réellement écrite dans le dépôt. Les clés (`LIEN`,
 * `APRES_INTERACTION`) ne servent qu’à désigner la valeur sans la recopier.
 *
 *   * `vusPar` — les canaux qui peuvent OBSERVER cette classe (au moins un,
 *     sinon la classe est ORPHELINE et le garde refuse : son classement ne
 *     serait vérifiable par personne) ;
 *   * `absence` — la raison qui vaut pour TOUS les canaux absents (non vide dès
 *     qu’il y a un absent) ;
 *   * `absencesParticulieres` — les raisons qui DIFFÈRENT d’un canal à l’autre,
 *     quand la raison générale ne suffit pas. Un canal nommé ici qui VOIT la
 *     classe est une incohérence (le garde refuse : une raison d’absence pour un
 *     canal qui observe est une ligne qui s’est trompée de colonne).
 *
 * Une classe ABSENTE de cette table est refusée comme une origine non classée :
 * une classe nouvelle exige une décision écrite, pas un défaut.
 */
export const MATRICE = {
  [SORTES.IDENTIFIANT]: {
    vusPar: ['livre'],
    absence:
      'un identifiant n’est jamais requêté : il n’y a aucune requête à observer pour une sonde, et ' +
      'ce n’est pas une balise qui télécharge — le garde de coquille juge les balises, l’`xmlns` ' +
      'd’un SVG n’en est pas une',
  },
  [SORTES.MESSAGE]: {
    vusPar: ['livre'],
    absence:
      'une chaîne affichée dans un message d’erreur de bibliothèque n’est jamais requêtée : aucune ' +
      'sonde ne peut l’observer, et elle ne vit dans aucun document publié',
  },
  [SORTES.LIEN]: {
    vusPar: ['livre'],
    absence:
      'un `href` n’est pas une requête tant que personne ne l’ouvre : aucune sonde ne le voit ' +
      'partir, et il n’est pas non plus une balise qui télécharge pour le garde de coquille',
  },
  [SORTES.APRES_INTERACTION]: {
    vusPar: ['livre', 'apres-interaction'],
    absence: 'chargé APRÈS un geste : le canal « sans geste » ne peut pas le voir partir, par construction',
    absencesParticulieres: {
      coquille:
        'l’injection du script est faite par du code (`document.createElement("script")`), donc ' +
        'l’URL n’est dans aucun document publié',
    },
  },
  [SORTES.APRES_MISE_EN_ECRAN]: {
    vusPar: ['livre', 'mise-en-ecran'],
    absence:
      'la requête part à la MISE À L’ÉCRAN du bloc, sans geste : les canaux statiques la voient ' +
      'écrite, la sonde sans geste ne la voit pas (le bloc est hors du premier écran), et la sonde ' +
      'd’après-interaction non plus (aucun geste n’a eu lieu)',
    absencesParticulieres: {
      'avant-interaction':
        'le bloc est HORS du premier écran au chargement (mesuré : y=2 190,6 en mobile) : il faut ' +
        'que la page défile pour qu’il entre dans le viewport, et cette sonde ne défile pas',
    },
  },
  [SORTES.CONDITIONNEL]: {
    vusPar: ['livre'],
    absence:
      'le script n’est injecté que si une variable de BUILD l’autorise : sans elle, aucune requête ' +
      'n’existe à observer, donc les trois canaux dynamiques ne verraient rien même sur une page ' +
      'où la classe est légitime',
  },
};

/** Les identifiants de canal, dans l’ordre de déclaration. */
export const IDS_DES_CANAUX = Object.keys(CANAUX);

/**
 * Les identifiants de CLASSE, dans l’ordre du propriétaire (`SORTES`) : les
 * VALEURS du vocabulaire, celles que `CLASSEMENT_ORIGINES[].sorte` porte.
 *
 * `classesDuVocabulaire` les rend en REFUSANT un vocabulaire ambigu : deux clés
 * de `SORTES` qui partageraient la même valeur feraient disparaître une classe
 * de la couverture, en silence — la matrice croirait l’avoir couverte alors
 * qu’elle ne verrait que sa jumelle.
 */
export const classesDuVocabulaire = (sortes = SORTES) => {
  const valeurs = Object.values(sortes || {});
  if (valeurs.length !== new Set(valeurs).size) {
    throw new Error(
      'couverture-tiers : le vocabulaire `SORTES` porte deux classes de MÊME valeur — ' +
        'la matrice ne peut pas les distinguer, donc l’une des deux resterait invérifiée.'
    );
  }
  return valeurs;
};

export const IDS_DES_CLASSES = classesDuVocabulaire();

/**
 * LA CONFRONTATION, pure et sans E/S : ce que la matrice ne tient pas.
 *
 * Elle rend SEPT listes, chacune nommant sa faute — et aucune n’est un
 * avertissement : toutes sont des refus.
 *
 * @param {{ sortes?: Object, canaux?: Object, matrice?: Object }} [sources]
 * @returns {{
 *   nonCouvertes: string[],
 *   orphelines: string[],
 *   classesInconnues: string[],
 *   canauxInconnus: Array<{classe: string, canal: string}>,
 *   raisonsManquantes: Array<{classe: string, canal: string}>,
 *   absencesIncoherentes: Array<{classe: string, canal: string}>,
 *   observationsIncoherentes: Array<{classe: string, canal: string}>,
 * }}
 */
export function lacunesDeCouverture({ sortes = SORTES, canaux = CANAUX, matrice = MATRICE } = {}) {
  const classes = classesDuVocabulaire(sortes);
  const idsCanaux = Object.keys(canaux || {});
  const nonCouvertes = [];
  const orphelines = [];
  const classesInconnues = [];
  const canauxInconnus = [];
  const raisonsManquantes = [];
  const absencesIncoherentes = [];
  const observationsIncoherentes = [];

  // 1. Une CLASSE déclarée sans ligne de matrice : personne n’a décidé qui
  //    l’observe. C’est le refus « non classée », transposé.
  for (const classe of classes) {
    if (!matrice || !(classe in matrice)) nonCouvertes.push(classe);
  }

  for (const [classe, ligne] of Object.entries(matrice || {})) {
    // 2. Une LIGNE dont la classe n’existe plus (renommée, retirée) : la matrice
    //    survit à ce qu’elle décrivait, donc elle décrit autre chose.
    if (!classes.includes(classe)) classesInconnues.push(classe);
    const vusPar = Array.isArray(ligne?.vusPar) ? ligne.vusPar : [];
    for (const canal of vusPar) {
      if (!idsCanaux.includes(canal)) canauxInconnus.push({ classe, canal });
    }
    const particuliere = ligne?.absencesParticulieres || {};
    for (const canal of Object.keys(particuliere)) {
      if (!idsCanaux.includes(canal)) canauxInconnus.push({ classe, canal });
      // 4. Une raison d’ABSENCE pour un canal qui VOIT la classe : la ligne s’est
      //    trompée de colonne, et l’une des deux affirmations est fausse.
      if (vusPar.includes(canal)) absencesIncoherentes.push({ classe, canal });
    }

    // 3. ORPHELINE : aucun canal RÉEL ne l’observe (une liste vide, ou une liste
    //    qui ne nomme que des canaux inconnus). C’est le refus central : le
    //    classement de cette classe ne serait vérifié par personne.
    const reels = vusPar.filter((canal) => idsCanaux.includes(canal));
    if (reels.length === 0) orphelines.push(classe);

    // 5. Un canal absent sans aucune raison (ni générale, ni particulière) : une
    //    absence muette ne se distingue pas d’un oubli.
    const absence = String(ligne?.absence || '').trim();
    for (const canal of idsCanaux) {
      if (reels.includes(canal)) continue;
      if (absence === '' && !particuliere[canal]) raisonsManquantes.push({ classe, canal });
    }

    // 6. Un canal listé dans `vusPar` DEUX fois : la matrice se contredit.
    if (new Set(vusPar).size !== vusPar.length) {
      for (const canal of vusPar) {
        if (vusPar.filter((candidat) => candidat === canal).length > 1) {
          observationsIncoherentes.push({ classe, canal });
        }
      }
    }
  }

  // Les doublons de la 6e liste sont repliés : un canal cité trois fois est UNE
  // incohérence, pas trois (le message doit rester lisible).
  const replie = (liste) => {
    const vus = new Set();
    return liste.filter((entree) => {
      const cle = `${entree.classe}|${entree.canal}`;
      if (vus.has(cle)) return false;
      vus.add(cle);
      return true;
    });
  };

  return {
    nonCouvertes: nonCouvertes.sort(),
    orphelines: orphelines.sort(),
    classesInconnues: classesInconnues.sort(),
    canauxInconnus: replie(canauxInconnus),
    raisonsManquantes: replie(raisonsManquantes),
    absencesIncoherentes: replie(absencesIncoherentes),
    observationsIncoherentes: replie(observationsIncoherentes),
  };
}

/**
 * Ce que ce garde voit, et ce qu’il ne peut pas voir — publié pour être lu et
 * comparé, jamais pour être cru (même rôle que `CE_QUE_CE_GARDE_VOIT` des
 * gardes voisins).
 */
export const CE_QUE_CE_GARDE_VOIT = {
  voit: [
    'pour chaque CLASSE de tiers, les canaux qui peuvent l’observer et, pour chacun des autres, la raison de son absence',
    'une classe que personne n’observe (orpheline), une classe sans ligne, une ligne dont la classe n’existe plus',
    'un canal cité qui n’existe pas, une raison d’absence donnée à un canal qui observe la classe',
    'un canal dont le module ou la sonde n’existe pas sur disque, une déclaration `CE_QUE_*` vidée ou renommée',
  ],
  nePeutPasVoir: [
    'le BIEN-FONDÉ d’une classe : dire qu’une origine est « un lien rendu » est une affirmation que `CLASSEMENT_ORIGINES` porte avec sa `preuve`, pas quelque chose que la couverture juge',
    'la VÉRACITÉ d’une limite de canal : chaque sonde la prouve à son niveau ; la matrice dit QUI regarde, jamais si son regard est bon',
    'une classe observée par un canal qui n’est PAS exécuté par la CI : la présence d’une sonde sur disque est vérifiée, son exécution sur un runner ne l’est pas',
    'le contenu réel des fichiers livrés : c’est `origines-bundles.js` qui les lit — la matrice dit seulement que ce canal peut voir la classe',
  ],
};
