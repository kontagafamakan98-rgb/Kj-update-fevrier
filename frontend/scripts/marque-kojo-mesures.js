// ── LA MESURE DU POINÇON — la règle, sans E/S ──────────────────────────────
//
// Ce module rend les TROIS verdicts que le dessin de la marque doit tenir, et
// il ne fait que du calcul : il reçoit la géométrie (lue du JSON par l'appelant)
// et, pour la mesure de pixels, un tampon RGBA déjà décodé. Rien ici ne lit un
// fichier, rien n'écrit, rien n'imprime — c'est ce qui permet de mesurer la
// règle en isolation, avec des cas synthétiques qui la font MORDRE.
//
// ── POURQUOI CES TROIS MESURES, ET PAS D'AUTRES ───────────────────────────
// Elles sont exactement celles de l'atelier du 28/09/2026, qui ont décidé du
// dessin et qui n'étaient tenues par RIEN depuis : l'atelier a été supprimé avec
// le reste (`frontend/.apercu/`), et ce qui restait était trois phrases d'en-tête
// et deux nombres dans un journal. Un nombre écrit dans un commentaire ne
// rougit pas quand la géométrie change : il vieillit en silence.
//
//   1. LE CONTRASTE DE LA LETTRE SUR LA MATIÈRE. Le blanc du « K » n'est lisible
//      que si la matière sous lui reste assez sombre. L'atelier avait mesuré
//      2,67:1 au point le plus défavorable — l'attribut le plus visible de la
//      marque était le moins lisible —, et le dégradé a été ramené DANS le coin
//      pour remonter à 3,29:1. Le protocole est rejoué ici tel quel : un « tube »
//      de rayon `largeur/2` promené sur les trois segments de la lettre, un
//      échantillon tous les quarts d'unité, huit directions sur le bord du tube
//      plus son axe.
//
//   2. LES CERCLES DANS LE DISQUE. Un trait n'est pas rogné par le cercle qui le
//      porte : un arc posé trop près du bord peint un liseré DEHORS, sur le fond
//      — le seul défaut de ce dessin qui se voie à l'œil nu, et il était là
//      (l'ombre à 22,6 avec un demi-trait de 1,15 débordait de 0,55 unité). La
//      règle est `rayon + largeur/2 ≤ rayon du disque`, pour chaque `cercle` et
//      chaque `arc` de la peinture.
//
//   3. LES PIXELS PEINTS HORS DU DISQUE. Les deux règles précédentes portent sur
//      des nombres déclarés ; celle-ci porte sur l'ARTEFACT SERVI (le PNG décodé
//      par l'appelant). C'est la seule qui attrape ce qu'aucune prose ne décrit :
//      un débordement de composition, une couche décalée, un anti-aliasing qui
//      dépasse la portée du disque.
//
// ── LA CONTREPARTIE, SANS LAQUELLE LA 3e MESURE SERAIT UN FAUX VERT ───────
// « Aucun pixel peint hors du disque » est VRAI d'une image entièrement
// transparente. Le troisième verdict exige donc AUSSI que le disque soit peint :
// la part des pixels du disque qui sont opaques doit dépasser un plancher
// mesuré. Un garde qui rougit à tort finit ignoré, mais un garde qui verdit à
// tort finit par ne plus rien garder du tout.
//
// ── CE QUE LES TROIS MESURES NE JUGENT PAS, ET QU'IL FAUT SAVOIR ──────────
// Elles ne jugent ni la composition (que la lettre soit centrée, que l'ombre
// soit en bas), ni le goût, ni la conformité du manifeste — c'est
// `check-generated-icons.js` et `check-pwa-manifest.js`. Elles ne jugent pas non
// plus les variantes MASKABLE : leur fond est OPAQUE par exigence des masques
// (`MASKABLE_BACKGROUND`), donc « un pixel peint » n'y a pas de sens — le pixel
// est toujours peint, c'est le fond. Ce qui les borne, elles, est vérifié
// ailleurs : la zone de sécurité du contenu maskable est mesurée par
// `check-pwa-manifest.js` (rayon de contenu contre `safe_zone_radius`).

/** La grille de dessin du JSON (48 × 48) : le centre est (24, 24). */
export const CENTRE = 24;

/**
 * LE SEUIL DE CONTRASTE RETENU : 3,0:1, le seuil WCAG 1.4.11 (contraste des
 * objets graphiques et des éléments d'interface). La marque est un TRACÉ, pas du
 * texte : lui demander 4,5:1 serait lui demander un autre dessin.
 *
 * Le seuil vient d'une NORME, jamais du relevé du jour. La mesure actuelle
 * (3,29:1 au pire point) laisse 0,29 de marge — c'est une marge, pas le seuil,
 * et le jour où une retouche rendra 3,05:1 le garde restera vert à juste titre.
 */
export const SEUIL_CONTRASTE = 3;

/** Le pas d'échantillonnage de la lettre, en unités de grille. */
export const PAS_ECHANTILLON = 0.25;

/** Le nombre de directions échantillonnées sur le bord du tube de la lettre. */
export const DIRECTIONS_DU_TUBE = 8;

/**
 * LA PART MINIMALE du disque qui doit être PEINTE. Mesurée à 1,0000 sur les
 * huit icônes claires (la matière du disque est opaque : tout pixel dont le
 * centre tombe dans le disque est peint). Le plancher est posé à 0,9 : il
 * refuse un disque troué ou vidé, il ne juge pas l'anti-aliasing du bord.
 */
export const PLANCHER_DISQUE_PEINT = 0.9;

/**
 * LA MARGE DE PIXELS, en pixels de sortie, entre le bord du disque et le dernier
 * pixel qu'un dessin SAIN peut encore teinter. Elle n'est pas un réglage de
 * confort : c'est la somme de deux causes, mesurées.
 *
 *   1. LA RAMPE D'ANTI-ALIASING : le rasteriseur peint la couverture du disque
 *      par `couverture(distance - rayon, pas)`, qui s'éteint à `+0,5 × pas` —
 *      donc un demi-pixel au-delà du bord nominal.
 *   2. LA TRAÎNE DU RÉ-ÉCHANTILLONNAGE : les icônes ne sont PAS dessinées à leur
 *      taille. Elles sont dessinées à 512 px puis réduites par MOYENNE DE SURFACE
 *      (`reduce_area`), dont chaque pixel de sortie vaut la moyenne d'un pavé de
 *      la source. Un pixel de sortie dont le pavé touche encore l'encre est
 *      teinté, même si son PROPRE centre est dehors : au plus la demi-diagonale
 *      d'un pixel de sortie, soit 0,71 px.
 *
 * 0,5 + 0,71 = 1,21, arrondi à 1,25. Mesuré sur l'arbre actuel : le dernier
 * pixel teinté de icon-192x192.png est à 0,35 px du bord (c'est la traîne de
 * ré-échantillonnage, pas un débordement). Ce que cette mesure attrape n'est
 * donc pas le liseré d'un trait — la mesure 2 le fait au dix-millième d'unité —,
 * mais ce que RIEN ne déclare : une couche décalée, une lettre poussée dehors,
 * une composition qui déborde.
 */
export const MARGE_DISQUE_PAS = 1.25;

/** « #rrggbb » → [r, g, b]. Une couleur héritée n'existe pas dans une mesure :
 * `currentColor` dépend de la feuille de la page, pas du dessin mesuré. */
export const couleurCss = (valeur) => {
  if (typeof valeur !== 'string' || !valeur.startsWith('#') || valeur.length !== 7) {
    throw new Error(
      `marque-kojo-mesures : couleur « ${valeur} » — la mesure ne peint que des couleurs ` +
        'explicites (« currentColor » dépend de la feuille de style de la page)'
    );
  }
  return [1, 3, 5].map((decalage) => parseInt(valeur.slice(decalage, decalage + 2), 16));
};

/** La luminance relative WCAG d'une couleur [r, g, b] (0 → 1). */
export const luminanceRelative = ([rouge, vert, bleu]) => {
  const canal = (valeur) => {
    const part = valeur / 255;
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(rouge) + 0.7152 * canal(vert) + 0.0722 * canal(bleu);
};

/** Le rapport de contraste WCAG entre deux couleurs (1 → 21). */
export const contrasteEntre = (couleurA, couleurB) => {
  const clair = Math.max(luminanceRelative(couleurA), luminanceRelative(couleurB));
  const sombre = Math.min(luminanceRelative(couleurA), luminanceRelative(couleurB));
  return (clair + 0.05) / (sombre + 0.05);
};

/**
 * LES SEGMENTS d'un chemin SVG minimal : « M x y », « L x y », « V y », « H x ».
 *
 * Les trois tracés de la lettre sont déclarés dans le JSON en syntaxe SVG —
 * parce que c'est ce que peint la page. Les recopier ici en couples de points
 * serait une SECONDE déclaration de la lettre, c'est-à-dire exactement ce que le
 * JSON existe pour empêcher.
 */
export const lireChemin = (donnee) => {
  const jetons = donnee.match(/[A-Za-z]|-?\d*\.?\d+/g) || [];
  const segments = [];
  let courant = null;
  let commande = null;
  let index = 0;
  while (index < jetons.length) {
    const jeton = jetons[index];
    if (/[A-Za-z]/.test(jeton)) {
      commande = jeton.toUpperCase();
      index += 1;
      continue;
    }
    if (commande === null || commande === 'Z') {
      throw new Error(`marque-kojo-mesures : chemin « ${donnee} » — commande manquante`);
    }
    if (commande === 'M') {
      courant = [Number(jetons[index]), Number(jetons[index + 1])];
      index += 2;
      commande = 'L';
      continue;
    }
    let suivant;
    if (commande === 'L') {
      suivant = [Number(jetons[index]), Number(jetons[index + 1])];
      index += 2;
    } else if (commande === 'V') {
      suivant = [courant[0], Number(jetons[index])];
      index += 1;
    } else if (commande === 'H') {
      suivant = [Number(jetons[index]), courant[1]];
      index += 1;
    } else {
      throw new Error(
        `marque-kojo-mesures : la commande « ${commande} » de « ${donnee} » n'est pas ` +
          'supportée (seuls M, L, V et H sont nécessaires à la lettre)'
      );
    }
    segments.push([courant, suivant]);
    courant = suivant;
  }
  return segments;
};

/**
 * La distance SIGNÉE d'un point à un segment à BOUTS PLATS (un rectangle).
 * La version « capsule » donnerait des bouts ronds : le « K » est un gras
 * géométrique à coupes franches. Même règle que le rasteriseur.
 */
export const distanceAuSegment = (x, y, depart, arrivee, demiTrait) => {
  const [x1, y1] = depart;
  const [x2, y2] = arrivee;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const longueur = Math.hypot(dx, dy);
  if (longueur === 0) return Math.hypot(x - x1, y - y1) - demiTrait;
  const axe = ((x - x1) * dx + (y - y1) * dy) / longueur;
  const perpendiculaire = Math.abs((x - x1) * dy - (y - y1) * dx) / longueur;
  const debordement = Math.max(0 - axe, axe - longueur);
  return Math.max(perpendiculaire - demiTrait, debordement);
};

/** La couverture d'un bord : 1 dedans, 0 dehors, une rampe d'un pixel au bord
 * (l'anti-aliasing analytique du rasteriseur, rejoué à l'identique). */
export const couverture = (valeur, pas) => {
  if (valeur <= -0.5 * pas) return 1;
  if (valeur >= 0.5 * pas) return 0;
  return 0.5 - valeur / pas;
};

/** L'angle d'un point, en degrés dans [0, 360), comme le tracé d'un arc. */
const angleSurLeCercle = (x, y) => ((Math.atan2(y - CENTRE, x - CENTRE) * 180) / Math.PI + 360) % 360;

/** L'écart d'un angle à l'intervalle parcouru par un arc : zéro dedans, ce qui
 * fait la coupe FRANCHE des bouts (les arcs de la marque sont en `butt`). */
const ecartAngulaire = (angle, debut, fin) => {
  if (debut <= angle && angle <= fin) return 0;
  return Math.min(Math.abs(angle - debut), Math.abs(angle - fin));
};

/** L'arrêt de dégradé atteint par un décalage, interpolé entre ses deux
 * voisins — et le DERNIER arrêt prolongé au-delà (le `spreadMethod` par défaut
 * du SVG : ne pas le faire peindrait du noir). */
const melange = (arrets, decalage) => {
  if (decalage <= arrets[0][0]) return arrets[0][1];
  if (decalage >= arrets[arrets.length - 1][0]) return arrets[arrets.length - 1][1];
  for (let index = 1; index < arrets.length; index += 1) {
    const gauche = arrets[index - 1];
    const droite = arrets[index];
    if (decalage <= droite[0]) {
      const part = droite[0] > gauche[0] ? (decalage - gauche[0]) / (droite[0] - gauche[0]) : 0;
      return [0, 1, 2, 3].map((canal) => gauche[1][canal] + (droite[1][canal] - gauche[1][canal]) * part);
    }
  }
  return arrets[arrets.length - 1][1];
};

/** LES ARRÊTS d'un dégradé, en données : `[décalage, [r, g, b, a]]`. */
export const arrets = (declaration) =>
  declaration.arrets.map((arret) => [
    Number(arret[0]),
    [...couleurCss(arret[1]), arret.length > 2 ? Number(arret[2]) : 1],
  ]);

/**
 * La couleur d'un dégradé au point (x, y) de la grille. `radial` mesure la
 * distance du point au centre dans les unités de la BOÎTE de l'élément qui le
 * référence (le défaut SVG `objectBoundingBox`) ; `lineaire` projette le point
 * sur l'axe en coordonnées de la grille (`gradientUnits="userSpaceOnUse"`).
 */
export const couleurDuDegrade = (declaration, x, y, boite) => {
  const arretsMelanges = arrets(declaration);
  if (declaration.sorte === 'radial') {
    const [gauche, haut, largeur, hauteur] = boite;
    const decalage =
      Math.hypot((x - gauche) / largeur - declaration.centre[0], (y - haut) / hauteur - declaration.centre[1]) /
      declaration.portee;
    return melange(arretsMelanges, decalage);
  }
  const [x1, y1, x2, y2] = declaration.axe;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const carre = dx * dx + dy * dy;
  const decalage = carre ? ((x - x1) * dx + (y - y1) * dy) / carre : 0;
  return melange(arretsMelanges, decalage);
};

/** Le rayon du DISQUE de la peinture : c'est lui qui commande tout l'extérieur. */
export const rayonDuDisque = (geometrie, peinture = 'marque') => {
  const disque = geometrie.peintures[peinture].couches.find((couche) => couche.sorte === 'disque');
  if (!disque) {
    throw new Error(
      `marque-kojo-mesures : la peinture « ${peinture} » n'a pas de disque — il n'y a rien ` +
        'à mesurer.'
    );
  }
  return Number(disque.rayon);
};

/** LES COUCHES de la lettre, en segments à bouts plats. */
export const segmentsDeLaLettre = (geometrie) => {
  const lettre = geometrie.lettre;
  return [lettre.tronc, lettre.brasHaut, lettre.brasBas].flatMap((trace) =>
    lireChemin(trace).map(([depart, arrivee]) => [depart, arrivee, Number(lettre.largeur)])
  );
};

/** La couverture d'UNE couche au point (x, y), ou 0 si elle n'y peint rien. */
const porteeDeLaCouche = (couche, x, y, distance, pas, segmentsLettre) => {
  switch (couche.sorte) {
    case 'disque':
      return couverture(distance - Number(couche.rayon), pas);
    case 'arc': {
      const rayon = Number(couche.rayon);
      const bord = Math.abs(distance - rayon) - Number(couche.largeur) / 2;
      if (bord >= 0.5 * pas) return 0;
      const angle = angleSurLeCercle(x, y);
      const ecart = ecartAngulaire(angle, Number(couche.de), Number(couche.a));
      return couverture(Math.max(bord, ((ecart * Math.PI) / 180) * rayon), pas);
    }
    case 'cercle':
      return couverture(Math.abs(distance - Number(couche.rayon)) - Number(couche.largeur) / 2, pas);
    case 'lettre': {
      let portee = 0;
      for (const [depart, arrivee, largeur] of segmentsLettre) {
        portee = Math.max(portee, couverture(distanceAuSegment(x, y, depart, arrivee, largeur / 2), pas));
      }
      return portee;
    }
    default:
      throw new Error(
        `marque-kojo-mesures : sorte de couche inconnue « ${couche.sorte} » — le JSON et la ` +
          'mesure ont divergé.'
      );
  }
};

/**
 * LA COULEUR SOUS UN POINT, en composant les couches déclarées AVANT celle dont
 * on mesure le fond (source-over prémultiplié, comme le rasteriseur).
 *
 * Composer les couches et non seulement la matière est ce qui rend la mesure
 * VALABLE PAR CONSTRUCTION : le jour où la lettre grandirait assez pour passer
 * sous le collet ou sous un arc, le fond mesuré serait celui que l'œil voit, et
 * pas un dégradé qui ne s'y trouve plus. Aujourd'hui les deux ne se rencontrent
 * pas — la mesure le publie plus bas (marge entre le décor et l'encre).
 */
export const couleurSous = (geometrie, peinture, x, y, nomDeLaCouche) => {
  const pas = 1;
  const boiteDisque = (() => {
    const rayon = rayonDuDisque(geometrie, peinture);
    return [CENTRE - rayon, CENTRE - rayon, 2 * rayon, 2 * rayon];
  })();
  const segmentsLettre = segmentsDeLaLettre(geometrie);
  let rouge = 0;
  let vert = 0;
  let bleu = 0;
  let alpha = 0;
  for (const couche of geometrie.peintures[peinture].couches) {
    if (couche.nom === nomDeLaCouche) break;
    const distance = Math.hypot(x - CENTRE, y - CENTRE);
    const portee = porteeDeLaCouche(couche, x, y, distance, pas, segmentsLettre);
    if (portee <= 0) continue;
    let r;
    let g;
    let b;
    let opacite = portee;
    if (couche.peinture) {
      if (!(couche.peinture in geometrie.gradients)) {
        throw new Error(
          `marque-kojo-mesures : le dégradé « ${couche.peinture} » n'est pas déclaré — la ` +
            'mesure ne peut pas peindre ce qu\'elle ne connaît pas.'
        );
      }
      const couleur = couleurDuDegrade(geometrie.gradients[couche.peinture], x, y, boiteDisque);
      r = couleur[0];
      g = couleur[1];
      b = couleur[2];
      opacite *= couleur[3];
    } else {
      [r, g, b] = couleurCss(couche.couleur);
    }
    if (couche.opacite !== undefined) opacite *= Number(couche.opacite);
    if (opacite <= 0) continue;
    const restant = 1 - opacite;
    rouge = r * opacite + rouge * restant;
    vert = g * opacite + vert * restant;
    bleu = b * opacite + bleu * restant;
    alpha = opacite + alpha * restant;
  }
  if (alpha <= 0) return { couleur: [0, 0, 0], alpha: 0 };
  return { couleur: [rouge / alpha, vert / alpha, bleu / alpha], alpha };
};

/**
 * ── MESURE 1 : LE CONTRASTE DE LA LETTRE ─────────────────────────────────
 * Le protocole de l'atelier, rejoué : un tube de rayon `largeur/2` promené sur
 * les trois segments, un échantillon tous les quarts d'unité, son axe et huit
 * points de son bord. En chacun, la couleur de la lettre (déclarée) contre la
 * couleur COMPOSÉE sous elle.
 */
export const contrasteDeLaLettre = (geometrie, peinture = 'marque') => {
  const lettre = geometrie.peintures[peinture].couches.find((couche) => couche.sorte === 'lettre');
  if (!lettre) {
    throw new Error(`marque-kojo-mesures : la peinture « ${peinture} » n'a pas de lettre à mesurer.`);
  }
  const couleurDeLaLettre = couleurCss(lettre.couleur);
  const demi = Number(geometrie.lettre.largeur) / 2;
  const mesures = [];
  for (const [depart, arrivee] of segmentsDeLaLettre(geometrie)) {
    const longueur = Math.hypot(arrivee[0] - depart[0], arrivee[1] - depart[1]);
    const etapes = Math.max(1, Math.ceil(longueur / PAS_ECHANTILLON));
    for (let etape = 0; etape <= etapes; etape += 1) {
      const part = etape / etapes;
      const x = depart[0] + (arrivee[0] - depart[0]) * part;
      const y = depart[1] + (arrivee[1] - depart[1]) * part;
      for (let direction = -1; direction < DIRECTIONS_DU_TUBE; direction += 1) {
        // `direction = -1` est l'AXE du tube ; au-delà, le bord, huit fois.
        const angle = (direction / DIRECTIONS_DU_TUBE) * 2 * Math.PI;
        const rayon = direction < 0 ? 0 : demi;
        const echantillonX = x + rayon * Math.cos(angle);
        const echantillonY = y + rayon * Math.sin(angle);
        const sous = couleurSous(geometrie, peinture, echantillonX, echantillonY, lettre.nom);
        if (sous.alpha < 0.999) continue; // hors du disque : pas de matière, pas de mesure
        mesures.push({
          x: Number(echantillonX.toFixed(3)),
          y: Number(echantillonY.toFixed(3)),
          couleur: sous.couleur.map((canal) => Math.round(canal)),
          contraste: contrasteEntre(couleurDeLaLettre, sous.couleur),
        });
      }
    }
  }
  if (!mesures.length) {
    throw new Error(
      'marque-kojo-mesures : aucun échantillon de la lettre n\'est tombé sur la matière — ' +
        'la lettre est peut-être sortie du disque, et aucune mesure n\'aurait de sens.'
    );
  }
  const pire = mesures.reduce((a, b) => (b.contraste < a.contraste ? b : a));
  const moyenne = mesures.reduce((total, mesure) => total + mesure.contraste, 0) / mesures.length;
  return {
    nom: 'contraste de la lettre',
    echantillons: mesures.length,
    pire: { x: pire.x, y: pire.y, couleur: pire.couleur, contraste: Number(pire.contraste.toFixed(3)) },
    moyenne: Number(moyenne.toFixed(3)),
    seuil: SEUIL_CONTRASTE,
    ok: pire.contraste >= SEUIL_CONTRASTE,
  };
};

/**
 * ── MESURE 2 : LES CERCLES DANS LE DISQUE ────────────────────────────────
 * `rayon + largeur/2 ≤ rayon du disque`, pour chaque `cercle` et chaque `arc`.
 * Le rayon du disque est lu dans le JSON, jamais recopié.
 */
export const cerclesDansLeDisque = (geometrie, peinture = 'marque') => {
  const rayonDisque = rayonDuDisque(geometrie, peinture);
  const couches = geometrie.peintures[peinture].couches.filter(
    (couche) => couche.sorte === 'cercle' || couche.sorte === 'arc'
  );
  if (!couches.length) {
    throw new Error(
      `marque-kojo-mesures : la peinture « ${peinture} » ne porte aucun cercle ni arc — il n'y a ` +
        'rien à mesurer, et un vert sur une liste vide ne prouverait rien.'
    );
  }
  const bords = couches.map((couche) => {
    const bord = Number(couche.rayon) + Number(couche.largeur) / 2;
    return {
      nom: couche.nom,
      sorte: couche.sorte,
      rayon: Number(couche.rayon),
      largeur: Number(couche.largeur),
      bord: Number(bord.toFixed(4)),
      debordement: Number(Math.max(0, bord - rayonDisque).toFixed(4)),
    };
  });
  const pire = bords.reduce((a, b) => (b.bord > a.bord ? b : a));
  return {
    nom: 'cercles dans le disque',
    rayonDisque,
    bords,
    pire: { nom: pire.nom, bord: pire.bord, debordement: pire.debordement },
    marge: Number((rayonDisque - pire.bord).toFixed(4)),
    ok: bords.every((bord) => bord.debordement === 0),
  };
};

/**
 * ── MESURE 3 : LES PIXELS PEINTS HORS DU DISQUE ──────────────────────────
 * Sur l'artefact DÉCODÉ (RGBA, `taille` × `taille`), on compte les pixels peints
 * (alpha > 0) dont le centre tombe au-delà du disque plus `MARGE_DISQUE_PAS`
 * pixels — la rampe d'anti-aliasing et la traîne du ré-échantillonnage (voir la
 * constante, et pourquoi ces deux-là et pas une tolérance de confort).
 */
export const pixelsHorsDuDisque = (pixels, { taille, geometrie, peinture = 'marque' }) => {
  const grille = Number(geometrie.grille);
  const rayonDisque = rayonDuDisque(geometrie, peinture);
  const pas = grille / taille;
  const limite = rayonDisque + MARGE_DISQUE_PAS * pas;
  const attendu = taille * taille * 4;
  if (pixels.length !== attendu) {
    throw new Error(
      `marque-kojo-mesures : le tampon fait ${pixels.length} octets pour une image de ${taille} × ` +
        `${taille} (attendu ${attendu}) — la mesure refuserait de lire des pixels mal alignés.`
    );
  }
  let peints = 0;
  let hors = 0;
  let excesMax = 0;
  let pointPire = null;
  let dansLeDisque = 0;
  let dansLeDisquePeints = 0;
  for (let ligne = 0; ligne < taille; ligne += 1) {
    for (let colonne = 0; colonne < taille; colonne += 1) {
      const distance = Math.hypot((colonne + 0.5) * pas - CENTRE, (ligne + 0.5) * pas - CENTRE);
      const alpha = pixels[(ligne * taille + colonne) * 4 + 3];
      if (distance <= rayonDisque - MARGE_DISQUE_PAS * pas) {
        dansLeDisque += 1;
        if (alpha > 0) dansLeDisquePeints += 1;
      }
      if (alpha === 0) continue;
      peints += 1;
      if (distance > limite) {
        hors += 1;
        const exces = distance - limite;
        if (exces > excesMax) {
          excesMax = exces;
          pointPire = { x: colonne, y: ligne, distance: Number(distance.toFixed(4)) };
        }
      }
    }
  }
  const partPeinte = dansLeDisque ? dansLeDisquePeints / dansLeDisque : 0;
  return {
    nom: 'pixels peints hors du disque',
    taille,
    rayonDisque,
    limite: Number(limite.toFixed(4)),
    peints,
    hors,
    excesMaxUnites: Number(excesMax.toFixed(4)),
    excesMaxPixels: Number((excesMax / pas).toFixed(2)),
    pointPire,
    partPeinte: Number(partPeinte.toFixed(4)),
    plancher: PLANCHER_DISQUE_PEINT,
    // Les DEUX conditions, et la seconde n'est pas décorative : sans elle, une
    // image transparente satisferait la première.
    ok: hors === 0 && partPeinte >= PLANCHER_DISQUE_PEINT,
  };
};
