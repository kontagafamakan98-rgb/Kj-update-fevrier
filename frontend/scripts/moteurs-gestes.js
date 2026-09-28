/**
 * LA RÈGLE DU PÉRIMÈTRE MULTI-MOTEURS — pure, sans I/O.
 *
 * ── Pourquoi cette règle existe ────────────────────────────────────────────
 * `playwright.config.js` limite les projets `firefox` et `webkit` aux parcours
 * qui MESURENT DES GESTES, et la liste vivait dans un commentaire : « rejouer
 * toute la suite sur trois moteurs triplerait le job ». Un parcours qui mesure un
 * geste AJOUTÉ demain (un appui, une molette, une bascule de taille) n'entrait
 * donc dans ce périmètre que si quelqu'un y pensait — et rien ne rougissait dans
 * le cas contraire. C'est la dette que ce dépôt refuse ailleurs : une liste tenue
 * à la main à côté d'un fait mesurable.
 *
 * ── Deux détections, pas une ───────────────────────────────────────────────
 *   1. Les GESTES DE BAS NIVEAU sont DÉTECTABLES : les API d'entrée réelles et
 *      rares de `@playwright/test` (`tap`/`hasTouch`, `mouse.wheel`,
 *      `setViewportSize`, `dragTo`, `mouse.down`/`up`) n'apparaissent que dans
 *      trois fichiers. Un parcours qui en porte un SANS être au registre est donc
 *      REFUSÉ — c'est la règle qui attrape l'ajout oublié.
 *   2. D'autres parcours mesurent un geste SANS API rare : `appuis-exterieurs`
 *      appuie avec le clic Playwright (une vraie séquence `pointerdown` →
 *      `mousedown` → `pointerup` → `mouseup` → `click`), mais un `.click()` est
 *      partout dans la suite : il ne peut pas SÉPARER le périmètre. Ces
 *      parcours-là sont donc DÉCLARÉS à la main, et la déclaration doit être
 *      DÉMENTIE possible : le geste annoncé doit être PRÉSENT dans le fichier.
 *      Déclarer « molette » pour un fichier qui ne molette jamais est refusé.
 *
 * ── Ce que la règle exige ──────────────────────────────────────────────────
 *   • les deux projets moteurs existent, portent le bon appareil, et couvrent
 *     EXACTEMENT le registre — `testMatch` et registre ne peuvent pas diverger,
 *     dans aucun des deux sens ;
 *   • les deux moteurs couvrent le MÊME périmètre : deux périmètres différents
 *     voudraient dire qu'un moteur juge moins que l'autre sans décision ;
 *   • tout parcours du périmètre PUBLIE ses mesures (`publier(...)`) : c'est
 *     l'autre moitié de « publier les écarts par moteur » — rejouer trois fois
 *     en silence ne publie rien ;
 *   • la CI installe les TROIS moteurs (la ligne qui installe les BINAIRES,
 *     `install --with-deps`, pas celle des dépendances système) ;
 *   • des PLANCHERS DE LECTURE : un périmètre cassé (mauvais chemin, dossier
 *     vide) doit ROUGIR au lieu de rendre un vert vide.
 *
 * La règle ne lit rien : elle reçoit les sources et rend ses refus. C'est ce qui
 * permet de l'éprouver à l'unité (`scripts/__tests__/check-moteurs-gestes.test.js`)
 * au lieu de croire une exécution du garde.
 */

/**
 * LE REGISTRE DES GESTES : qui est rejoué sur les trois moteurs, et pourquoi.
 *
 * Chaque entrée porte le geste qu'elle mesure ET un motif qui doit être PRÉSENT
 * dans le fichier — une déclaration qu'on peut démentir en lisant la source.
 */
export const PARCOURS_DE_GESTE = [
  {
    fichier: 'appuis-exterieurs.spec.js',
    geste: 'un appui réel doit ATTEINDRE sa cible (une surface plein écran le captait avant)',
    motif: /\.click\(/,
  },
  {
    fichier: 'notifications.spec.js',
    geste: 'appui au doigt et bascule de taille (le panneau se ferme à `mousedown`, agit à `click`)',
    motif: /\.tap\(|setViewportSize/,
  },
  {
    fichier: 'barres-rupture.spec.js',
    geste: 'molette (défilement inertiel) et bascule de taille (re-mise en page)',
    motif: /mouse\.wheel|setViewportSize/,
  },
  {
    fichier: 'carte-accueil.spec.js',
    geste: 'appui au doigt qui monte la carte tierce (l’instant où la requête PART dépend du moteur)',
    motif: /\.tap\(|hasTouch/,
  },
];

/**
 * LES GESTES DE BAS NIVEAU, détectables dans la source.
 *
 * Ces API sont des faits de MOTEUR et elles sont RARES : chaque parcours qui en
 * porte une doit figurer au registre, sans quoi le garde rougit en le nommant.
 */
export const MARQUEURS_DE_GESTE = [
  { nom: 'appui au doigt', motif: /\.tap\(|hasTouch|touchscreen/ },
  { nom: 'molette', motif: /mouse\.wheel|\.wheel\(/ },
  { nom: 'bascule de taille', motif: /setViewportSize/ },
  { nom: 'glisser-déposer', motif: /dragTo\(|mouse\.down\(|mouse\.up\(/ },
];

/** Le plancher de lecture : en dessous, le périmètre est cassé, pas vert. */
export const MIN_SPECS = 8;

/** Les appareils attendus, moteur par moteur : un profil de bureau générique ne porte pas le tactile. */
export const APPAREILS_ATTENDUS = { firefox: 'Desktop Firefox', webkit: 'Desktop Safari' };

/** Les trois moteurs que la CI doit installer (les binaires, pas les dépendances système). */
export const MOTEURS_ATTENDUS = ['chromium', 'firefox', 'webkit'];

/**
 * Le projet d'un moteur, lu dans la SOURCE de `playwright.config.js`.
 *
 * La lecture est textuelle et volontairement stricte : la config est un module
 * ESM qu'on ne veut pas EXÉCUTER ici (son `webServer` démarre deux serveurs). Le
 * bloc est découpé entre son `name: '<moteur>'` et le `name:` SUIVANT, pour que
 * l'objet imbriqué de `devices[...]` ne fasse pas échouer la découpe.
 *
 * @param {string} source Source de `playwright.config.js`.
 * @param {string} nom Nom du projet (`firefox`, `webkit`).
 * @returns {{declaration: string|null, motif: string|null, appareil: string|null}}
 */
export function projetMoteur(source, nom) {
  const depart = source.indexOf(`name: '${nom}'`);
  if (depart < 0) return { declaration: null, motif: null, appareil: null };
  const suivants = MOTEURS_ATTENDUS.map((autre) => source.indexOf(`name: '${autre}'`, depart + 1)).filter(
    (index) => index > 0
  );
  const fin = suivants.length ? Math.min(...suivants) : source.length;
  const declaration = source.slice(depart, fin);
  const motif = declaration.match(/testMatch:\s*(\/.*?\/),/s);
  // Le premier `devices[...]` du bloc est celui du `use:` : c'est l'appareil.
  const appareil = declaration.match(/devices\[['"]([^'"]+)['"]\]/);
  return {
    declaration,
    motif: motif ? motif[1] : null,
    appareil: appareil ? appareil[1] : null,
  };
}

/**
 * Les parcours qui portent un geste de bas niveau.
 *
 * @param {Array<{fichier: string, source: string}>} specs
 * @returns {Array<{fichier: string, gestes: string[]}>}
 */
export function parcoursDetectes(specs) {
  const trouves = [];
  for (const { fichier, source } of specs) {
    const gestes = MARQUEURS_DE_GESTE.filter(({ motif }) => motif.test(source)).map(({ nom }) => nom);
    if (gestes.length) trouves.push({ fichier, gestes });
  }
  return trouves;
}

/**
 * Les refus opposés au périmètre. Vide = le contrat est tenu.
 *
 * @param {{config: string, ci: string, specs: Array<{fichier: string, source: string}>,
 *   registre?: Array<{fichier: string, geste: string, motif: RegExp}>}} sources Le registre est
 *   injectable pour que les preuves unitaires éprouvent la règle sans toucher au registre réel.
 * @returns {string[]}
 */
export function refusDuPerimetreMoteurs({ config, ci, specs, registre = PARCOURS_DE_GESTE }) {
  const refus = [];
  const chromium = projetMoteur(config, 'chromium');
  const firefox = projetMoteur(config, 'firefox');
  const webkit = projetMoteur(config, 'webkit');

  if (!chromium.declaration) {
    refus.push("le projet `chromium` a disparu de playwright.config.js : la suite entière ne serait plus mesurée");
  }
  for (const [nom, projet, appareil] of Object.entries(APPAREILS_ATTENDUS).map(([nom, appareil]) => [
    nom,
    projetMoteur(config, nom),
    appareil,
  ])) {
    if (!projet.declaration) {
      refus.push(`le projet \`${nom}\` n'est plus déclaré : ce moteur ne rejoue plus aucun geste`);
      continue;
    }
    if (!projet.motif) {
      refus.push(`le projet \`${nom}\` ne déclare plus de \`testMatch\` : son périmètre serait la suite ENTIÈRE`);
    }
    if (projet.appareil !== appareil) {
      refus.push(
        `le projet \`${nom}\` n'utilise plus l'appareil \`${appareil}\` (lu : « ${projet.appareil} ») : ` +
          'un profil de bureau générique ne porte ni le tactile ni la même pile de rendu'
      );
    }
  }
  if (firefox.motif && webkit.motif && firefox.motif !== webkit.motif) {
    refus.push(
      `les projets moteurs ne couvrent pas le MÊME périmètre (« ${firefox.motif} » contre « ${webkit.motif} ») : ` +
        "un moteur jugerait moins que l'autre sans que personne ne l'ait décidé"
    );
  }

  const declares = registre.map(({ fichier }) => fichier);
  const parFichier = new Map(specs.map(({ fichier, source }) => [fichier, source]));

  if (!specs.length) {
    refus.push(
      'aucun parcours `.spec.js` lu dans frontend/e2e/ : le périmètre est cassé (mauvais dossier, dossier vide) et ' +
        'le garde rendrait un vert sans sujet'
    );
    return refus;
  }
  if (!declares.length) {
    refus.push('le registre des gestes est VIDE : le garde ne prouverait rien');
    return refus;
  }
  for (const { fichier, geste, motif } of registre) {
    if (!parFichier.has(fichier)) {
      refus.push(`le registre déclare \`${fichier}\`, mais ce fichier n'existe pas dans frontend/e2e/`);
      continue;
    }
    const source = parFichier.get(fichier);
    if (!motif.test(source)) {
      refus.push(
        `\`${fichier}\` est déclaré comme mesurant « ${geste} », mais la source ne porte AUCUN geste de ce genre : ` +
          'soit le geste a disparu du parcours, soit la déclaration est périmée'
      );
    }
    if (!/publier\(/.test(source)) {
      refus.push(
        `\`${fichier}\` est rejoué sur trois moteurs sans PUBLIER ses mesures : trois relevés identiques en apparence, ` +
          'donc aucun écart lisible (utiliser `publier(...)` de e2e/helpers/moteurs.js)'
      );
    }
  }

  // Le `testMatch` et le registre ne peuvent pas diverger, dans aucun sens.
  if (firefox.motif) {
    const portee = new RegExp(firefox.motif.slice(1, -1));
    const couverts = specs.map(({ fichier }) => fichier).filter((fichier) => portee.test(fichier));
    for (const fichier of declares) {
      if (!couverts.includes(fichier)) {
        refus.push(`\`${fichier}\` est au registre des gestes sans être rejoué par les projets moteurs (testMatch)`);
      }
    }
    for (const fichier of couverts) {
      if (!declares.includes(fichier)) {
        refus.push(`\`${fichier}\` est rejoué par les projets moteurs sans figurer au registre des gestes`);
      }
    }
  }

  for (const { fichier, gestes } of parcoursDetectes(specs)) {
    if (!declares.includes(fichier)) {
      refus.push(
        `\`${fichier}\` porte un geste de bas niveau (${gestes.join(', ')}) sans être rejoué sur Firefox ni WebKit : ` +
          'ajouter son entrée au registre PARCOURS_DE_GESTE (scripts/moteurs-gestes.js), et le `testMatch` suit'
      );
    }
  }

  for (const moteur of MOTEURS_ATTENDUS) {
    // La ligne qui installe les BINAIRES (l'autre, `install-deps`, n'installe que
    // les dépendances système) : c'est elle qui fait exister le moteur.
    if (!new RegExp(`playwright install --with-deps[^\\n]*\\b${moteur}\\b`).test(ci)) {
      refus.push(
        `la CI n'installe plus le moteur \`${moteur}\` : le projet porterait ce nom sans avoir de binaire, et ` +
          'échouerait sur un navigateur absent au lieu de juger'
      );
    }
  }
  return refus;
}
