// RÈGLE : AUCUN VERDICT NE PEUT PORTER SUR UN TEMPS ABSOLU SANS ÊTRE DÉCLARÉ ET
// CLASSÉ — le module que lit le garde `scripts/check-juges-de-temps.js`, qui
// prononce le verdict.
//
// ── Le défaut, tel qu'il a été mesuré une première fois ─────────────────────
// Un garde du dépôt jugeait la hauteur du document pré-rendu en comparant la
// page à un nombre de pixels ABSOLU relevé sur une machine. Vert sur ce poste,
// rouge sur un autre : le verdict portait sur l'hôte, pas sur l'artefact. Il a
// été rendu portable (le verdict porte désormais sur une STRUCTURE, pas sur une
// mesure). Ce module-ci existe parce que le même défaut peut vivre ailleurs, et
// qu'un défaut d'hôte est invisible tant que l'hôte de CI ressemble au poste de
// développement.
//
// ── Les quatre classes, et pourquoi le vocabulaire est fermé ────────────────
//   • PROPRIETE — le délai n'est qu'un PLAFOND D'ATTENTE ; ce qui décide est une
//     propriété (`toHaveURL`, `waitForSelector`, un marqueur de montage). Un hôte
//     lent retarde le verdict, il ne l'inverse pas. Portable par construction.
//   • VIVACITE — le délai ne juge RIEN de l'artefact : il tue un blocage. Sa
//     valeur est une marge, pas une mesure ; elle doit être dimensionnée par le
//     TRAVAIL (nombre de modules importés, appels HTTP) et justifiée comme telle.
//   • HOTE — le délai DÉCIDE, et sa valeur suit la vitesse de la machine. C'est
//     le défaut d'origine. Toléré seulement s'il est nommé dans les angles
//     acceptés, avec ce qui le compense.
//   • MESURE — le délai est une MÉTRIQUE en millisecondes (un budget Lighthouse).
//     Elle mêle l'hôte et l'artefact par nature ; c'est un jugement de
//     LABORATOIRE. Toléré seulement s'il est nommé dans les angles acceptés.
// Une borne dont la classe est PROPRIETE ou VIVACITE passe : son verdict ne porte
// pas sur le temps. Une borne HOTE ou MESURE qui n'est pas un angle accepté
// NOMMÉ fait rougir le garde — c'est tout l'objet du module.
//
// ── Ce qui est DÉCLARÉ (et pourquoi une déclaration, pas un scan) ───────────
// Une borne ne se reconnaît pas à sa forme : `timeout: 20000` est une vivacité
// ici et un plafond d'attente ailleurs, et `maxNumericValue: 0.9` est un SCORE
// sans unité quand ses voisins sont des millisecondes. Le module ne devine donc
// pas la classe : il EXIGE que chaque borne d'une surface de verdict soit
// déclarée, et refuse ce qui n'y est pas. Le bénéfice est double :
//   • une borne NOUVELLE (une métrique ajoutée à la hâte) ne peut pas entrer en
//     silence — le garde nomme le fichier, la ligne et la valeur ;
//   • une borne DISPARUE rougit aussi : une déclaration périmée est un mensonge
//     du registre, comme partout ailleurs dans ce dépôt.
//
// ── Ce que la surface ACCEPTE de ne pas inventorier (angle mort publié) ─────
//   • Les `{ timeout: N }` d'attente de CONDITION dans `e2e/` (`toHaveURL`,
//     `waitForSelector`) : leur verdict est une propriété, donc leur classe est
//     PROPRIETE par construction. Les inventorier ferait rougir ce garde à
//     chaque assertion ajoutée — un garde qui crie pour rien ne se lit plus.
//   • Les `timeout-minutes` des workflows : ce sont les bornes de VIVACITÉ du
//     runner lui-même (un job bloqué doit mourir), pas des verdicts.
//   • Les `waitForTimeout(N)` d'attente de stabilisation dans `e2e/` : eux
//     DÉCIDENT (la mesure est prise après le délai), donc ils appartiennent bien
//     à la classe HOTE. Ils n'étaient que RECENSÉS (angle mort 19) ; depuis le
//     28/09/2026 ils sont REFUSÉS : `frontend/e2e` est une surface déclarée
//     (`dossier: true`) sur le motif `attenteFixe`, avec une déclaration VIDE —
//     toute `waitForTimeout(N)` y est donc une borne non déclarée, nommée avec
//     son fichier. Le remède est une attente de CONDITION, et il vit dans
//     `e2e/helpers/attentes.js` (pas d'échantillonnage NOMMÉ, plafonds bornés) :
//     `e2e/helpers/geometrie.js` en portait déjà une (`attendreLaStabilite`).

/** Classes de borne. Vocabulaire FERMÉ : une classe inconnue est un refus. */
export const CLASSES = {
  PROPRIETE: {
    decisions: false,
    description:
      "plafond d'attente ; ce qui décide est une propriété (URL, sélecteur, marqueur) — un hôte lent retarde, il n'inverse pas",
  },
  VIVACITE: {
    decisions: false,
    description:
      "ne juge rien de l'artefact ; tue un blocage — la valeur est une marge dimensionnée par le TRAVAIL, pas une mesure",
  },
  HOTE: {
    decisions: true,
    description:
      "le délai DÉCIDE et sa valeur suit la vitesse de la machine — le défaut d'origine",
  },
  MESURE: {
    decisions: true,
    description:
      'métrique en millisecondes (budget Lighthouse) : mêle par nature l’hôte et l’artefact — jugement de LABORATOIRE',
  },
};

/**
 * Motifs de relevé. `regex` doit être globale ; elle est recréée à chaque appel
 * (une expression régulière globale est à état : réutilisée, elle saute des
 * occurrences). `unite` et `quoi` servent au verdict.
 */
export const MOTIFS = {
  timeout: {
    regex: /timeout\s*:\s*(\d[\d_]*)/g,
    unite: 'ms',
    quoi: "délai d'un plafond d'attente ou d'un sous-processus",
  },
  testTimeout: {
    regex: /testTimeout\s*:\s*(\d[\d_]*)/g,
    unite: 'ms',
    quoi: "délai par défaut d'un test unitaire (Vitest)",
  },
  maxNumericValue: {
    regex: /maxNumericValue\s*:\s*(\d[\d_.]*)/g,
    unite: 'score|ms',
    quoi: 'budget numérique de Lighthouse (score sans unité ou métrique en ms)',
  },
  attenteFixe: {
    regex: /waitForTimeout\(\s*(\d[\d_]*)\s*\)/g,
    unite: 'ms',
    quoi: 'attente avant mesure : le temps EST le verdict',
  },
};

/**
 * Surfaces dont une borne peut décider. C'est une liste DÉCLARÉE : un nouveau
 * fichier de budget doit y être ajouté pour être jugé, et le garde refuse une
 * surface déclarée qu'il ne trouve pas sur le disque (un registre périmé).
 */
export const SURFACES = [
  {
    chemin: 'frontend/lighthouserc.cjs',
    motifs: ['maxNumericValue'],
    quoi: 'budgets Lighthouse de la coquille (poste local et CI)',
  },
  {
    chemin: 'frontend/lighthouserc.desktop.cjs',
    motifs: ['maxNumericValue'],
    quoi: 'budgets Lighthouse desktop — TBT DÉRIVÉ d’une table mesurée, aucun littéral',
  },
  {
    chemin: 'frontend/vite.config.js',
    motifs: ['testTimeout'],
    quoi: 'délai par défaut des tests unitaires',
  },
  {
    chemin: 'frontend/playwright.config.js',
    motifs: ['timeout'],
    quoi: 'délai global et délais des serveurs de test e2e',
  },
  {
    chemin: 'frontend/scripts/check-job-og-contract.js',
    motifs: ['timeout'],
    quoi: 'plafond HTTP de la sonde de contrat OG',
  },
  {
    // Une surface peut être un DOSSIER : ses fichiers JavaScript sont lus un par
    // un (le refus NOMME le fichier), et aucun n'a besoin d'être listé ici pour
    // être jugé — un parcours e2e AJOUTÉ demain est donc couvert sans que
    // personne y pense. C'est ce qui manquait aux dix-neuf attentes fixes
    // recensées le 27/09/2026 : elles vivaient dans des specs, hors de toute
    // surface déclarée.
    chemin: 'frontend/e2e',
    dossier: true,
    motifs: ['attenteFixe'],
    quoi: 'les parcours Chromium : aucune attente FIXE (un cas attend une CONDITION, ou un FAIT peint)',
  },
];

/**
 * Ancienneté minimale d'une justification. Une déclaration sans prose est un
 * enregistrement, pas une décision — et c'est la prose qui porte la mesure.
 */
export const MIN_JUSTIFICATION = 40;

/**
 * LA DÉCLARATION. Par surface, par motif, la liste des valeurs existantes, avec
 * leur classe et leur justification. `occurrences` est le nombre attendu de
 * fois où la valeur apparaît (trois `timeout: 30000` dans un même fichier sont
 * un fait, pas un détail : leur disparition doit rougir).
 */
export const JUGES = {
  'frontend/lighthouserc.cjs': {
    maxNumericValue: [
      {
        valeur: 3500,
        occurrences: 1,
        classe: 'MESURE',
        quoi: 'LCP (ms) — coquille livrée',
        pourquoi:
          "Métrique de laboratoire : elle mêle l'hôte et l'artefact. Compensation : l'agrégation est « optimistic » (meilleur de trois tours), le seuil a été ÉLARGI depuis la borne mesurée, et le classement se fait d'abord sur un SCORE sans unité (≥ 0,9) — jamais sur la seule milliseconde.",
      },
      {
        valeur: 2500,
        occurrences: 1,
        classe: 'MESURE',
        quoi: 'FCP (ms) — coquille livrée',
        pourquoi:
          "Même famille que le LCP : un budget en millisecondes, donc un jugement de laboratoire. Il reste asserti parce qu'il borne le premier pixel peint, la seule métrique que la coquille pré-rendue peut dégrader sans que le score bouge.",
      },
    ],
  },
  'frontend/lighthouserc.desktop.cjs': {
    maxNumericValue: [],
  },
  'frontend/vite.config.js': {
    testTimeout: [
      {
        valeur: 20000,
        occurrences: 1,
        classe: 'HOTE',
        quoi: "délai par défaut d'un test unitaire",
        pourquoi:
          "Relevé du 16/09/2026 : des gardes qui LANCENT un sous-processus (check-bundle-size, check-script-deps…) dépassent 5 s sous la charge de la suite parallèle alors qu'ils passent seuls en moins d'une seconde. La valeur est donc une marge d'hôte — et c'est exactement pour cela que le test dont le travail est le plus lourd (import-health, ~180 modules) s'est vu donner son PROPRE budget dérivé d'une mesure, au lieu d'emprunter celui-ci.",
      },
    ],
  },
  'frontend/playwright.config.js': {
    timeout: [
      {
        valeur: 30000,
        occurrences: 3,
        classe: 'HOTE',
        quoi: 'délai global des tests e2e, et démarrage des deux serveurs de test',
        pourquoi:
          "Les trois occurrences sont le délai du test et celui du démarrage des serveurs (coquille + API de fixture). Le verdict d'un cas porte sur une propriété (URL, sélecteur, géométrie), donc la forme est portable ; seule la TAILLE suit la machine, et elle est ici un plafond de vivacité, pas une mesure.",
      },
    ],
  },
  'frontend/scripts/check-job-og-contract.js': {
    timeout: [
      {
        valeur: 20000,
        occurrences: 1,
        classe: 'VIVACITE',
        quoi: 'plafond HTTP de la sonde de contrat OG',
        pourquoi:
          "Le plafond ne juge pas la réponse : il tue une requête qui ne répond jamais. Ce qui décide est le contrat (en-têtes, image, dimensions) ; la valeur borne un blocage, et 20 s couvrent largement un aller-retour local.",
      },
    ],
  },
  /**
   * LE HARNAIS e2e N'A DROIT À AUCUNE ATTENTE FIXE, et la déclaration VIDE est
   * la règle : toute `waitForTimeout(N)` sous `frontend/e2e/` est une borne NON
   * DÉCLARÉE, donc un refus qui NOMME le fichier et la valeur.
   *
   * Les dix-neuf attentes recensées le 27/09/2026 (angle mort 19 de
   * CI-COVERAGE.md) ont été converties en attentes de CONDITION le 28/09/2026 :
   * un fait observé (peinture d'un nouveau rendu, arrêt d'un défilement, silence
   * du journal des requêtes, fermeture d'une fenêtre de session) ou une grandeur
   * sondée jusqu'à deux lectures égales. Le pas de sondage, les durées de calme
   * et les plafonds vivent dans `e2e/helpers/attentes.js`, nommés — plus aucun
   * littéral au milieu d'un cas.
   *
   * Rien n'est toléré ici, mais rien n'est interdit À JAMAIS : une valeur
   * réellement nécessaire s'écrit ICI, avec sa classe (HOTE ou MESURE), sa
   * justification et son angle accepté — c'est-à-dire qu'elle ne peut pas
   * arriver en silence, ce qui est tout l'objet de ce garde.
   */
  'frontend/e2e': {
    attenteFixe: [],
  },
};

/**
 * Angles ACCEPTÉS : une borne qui DÉCIDE (HOTE ou MESURE) n'est tolérée que si
 * une règle la couvre. La règle nomme ce qui compense — c'est l'engagement, pas
 * la permission.
 */
export const ANGLES_ACCEPTES = [
  {
    chemins: ['frontend/lighthouserc.cjs', 'frontend/lighthouserc.desktop.cjs'],
    motifs: ['maxNumericValue'],
    classe: 'MESURE',
    compensation:
      "Agrégation « optimistic » (meilleur de trois tours), seuils ÉLARGIS depuis les bornes mesurées, classement d'abord sur un SCORE sans unité, et retrait des assertions que la mesure n'arbitrait pas (speed-index jamais asserti ; LCP et score de /jobs retirés car ils mesuraient l'API et non la coquille). Les budgets qui dépendent de l'hôte sont SÉPARÉS par hôte : le TBT de la coquille vaut 1600 ms sur un poste non bridé et 1200 ms en CI (`targetIsLocal ? …`), et le TBT desktop n'est plus un littéral — il est DÉRIVÉ d'une table mesurée, dont un test interdit le littéral.",
  },
  {
    chemins: ['frontend/vite.config.js', 'frontend/playwright.config.js'],
    motifs: ['timeout', 'testTimeout'],
    classe: 'HOTE',
    compensation:
      "Ces délais tuent un blocage, ils ne classent pas l'artefact : ce qui décide reste une propriété (un test unitaire rendu, une URL atteinte, un sélecteur monté). Là où le travail est le plus lourd et le plus inégal selon l'hôte, la borne a été DÉRIVÉE d'une mesure prise à l'exécution (import-health) au lieu d'être empruntée. Les attentes de stabilisation de `e2e/` relevaient de la même classe et n'étaient que RECENSÉES : elles sont CONVERTIES depuis le 28/09/2026 (angle mort 19a fermé) et leur survivante éventuelle serait refusée, parce que `frontend/e2e` est une surface déclarée sur `attenteFixe` avec une déclaration VIDE.",
  },
];

/** Recrée la regex du motif et relève ses valeurs dans un texte. */
export function relever(texte, motif) {
  const definition = MOTIFS[motif];
  if (!definition) throw new Error(`motif inconnu : ${motif}`);
  const regex = new RegExp(definition.regex.source, definition.regex.flags);
  const occurrences = [];
  for (const trouvaille of String(texte).matchAll(regex)) {
    const valeur = Number(String(trouvaille[1]).replace(/_/g, ''));
    const ligne = String(texte).slice(0, trouvaille.index).split('\n').length;
    occurrences.push({ valeur, ligne });
  }
  return occurrences;
}

/**
 * L'inventaire complet d'une surface, sans aucune E/S : les fichiers sont passés
 * en clair, ce qui rend la règle éprouvable par mutation de chaîne.
 *
 * Une surface peut être un DOSSIER (`dossier: true`) : chacun des fichiers
 * fournis SOUS ce chemin est alors inventorié À SON PROPRE NOM (la clé de
 * `parSurface` est le chemin du fichier) — c'est la condition pour qu'un refus
 * nomme le fichier fautif, et pour qu'un parcours ajouté demain soit couvert
 * sans être listé nulle part.
 *
 * @param {{fichiers: Array<{chemin: string, texte: string}>}} sources
 * @returns {{parSurface: Record<string, Record<string, Array<{valeur, ligne}>>>, lues: string[], motifsLus: string[]}}
 */
export function inventorier({ fichiers }) {
  const parSurface = {};
  const lues = [];
  const motifsLus = [];
  const parChemin = new Map((fichiers || []).map((f) => [f.chemin, f.texte]));

  const cibles = (surface) =>
    surface.dossier
      ? [...parChemin.keys()].filter((chemin) => chemin.startsWith(`${surface.chemin}/`))
      : [surface.chemin];

  for (const surface of SURFACES) {
    for (const chemin of cibles(surface)) {
      const texte = parChemin.get(chemin);
      if (typeof texte !== 'string') continue;
      lues.push(chemin);
      parSurface[chemin] = {};
      for (const motif of surface.motifs) {
        parSurface[chemin][motif] = relever(texte, motif);
        if (!motifsLus.includes(motif)) motifsLus.push(motif);
      }
    }
  }
  return { parSurface, lues, motifsLus };
}

/** Nombre de fois qu'une valeur apparaît pour (surface, motif). */
const compter = (occurrences, valeur) => occurrences.filter((o) => o.valeur === valeur).length;

/** La liste des (surface, motif, valeur) présents, dédoublonnés, avec leur compte. */
export function bornesPresentes({ parSurface }) {
  const presentes = [];
  for (const [chemin, parMotif] of Object.entries(parSurface)) {
    for (const [motif, occurrences] of Object.entries(parMotif)) {
      for (const valeur of [...new Set(occurrences.map((o) => o.valeur))]) {
        presentes.push({ chemin, motif, valeur, occurrences: compter(occurrences, valeur) });
      }
    }
  }
  return presentes;
}

/**
 * Confronte l'inventaire à la déclaration. Trois écarts, tous refusés :
 *   • NON DÉCLARÉE — une borne présente que `JUGES` ignore ;
 *   • PÉRIMÉE — une borne déclarée absente du fichier, ou dont le NOMBRE a
 *     changé (le registre décrit un fichier qui n'existe plus) ;
 *   • SANS JUSTIFICATION — une déclaration dont la prose est absente ou trop
 *     courte pour porter une mesure.
 *
 * @returns {{nonDeclarees: Array, perimees: Array, occurrencesAttendues: number, occurrencesReelles: number}}
 */
export function confronterInventaire({ parSurface }, juges = JUGES) {
  const presentes = bornesPresentes({ parSurface });
  const declarees = new Set();
  const nonDeclarees = [];
  const perimees = [];
  let occurrencesAttendues = 0;
  let occurrencesReelles = 0;

  for (const borne of presentes) {
    occurrencesReelles += borne.occurrences;
  }

  for (const [chemin, parMotif] of Object.entries(juges || {})) {
    for (const [motif, declarations] of Object.entries(parMotif)) {
      for (const declaration of declarations) {
        const cle = `${chemin}|${motif}|${declaration.valeur}`;
        declarees.add(cle);
        const attendues = declaration.occurrences ?? 1;
        occurrencesAttendues += attendues;
        const reelles = compter(parSurface?.[chemin]?.[motif] || [], declaration.valeur);
        // Une seule comparaison : « disparue » et « moins d'occurrences que
        // déclaré » sont le MÊME écart (le registre décrit un fichier qui n'existe
        // plus sous cette forme). Deux branches jumelles qui poussent le même
        // objet sont du code mort que la mutation ne saurait plus distinguer.
        if (reelles !== attendues) {
          perimees.push({ chemin, motif, valeur: declaration.valeur, attendues, reelles });
        }
      }
    }
  }

  for (const borne of presentes) {
    if (!declarees.has(`${borne.chemin}|${borne.motif}|${borne.valeur}`)) nonDeclarees.push(borne);
  }

  return { nonDeclarees, perimees, occurrencesAttendues, occurrencesReelles };
}

/**
 * Toutes les déclarations, à plat. Une déclaration imbriquée se lit
 * `JUGES[chemin][motif][index]` : deux `flatMap` sont nécessaires, et un seul
 * rendrait des TABLEAUX — un piège qui a rendu « 0 MESURE » sur 2 déclarées.
 */
export const toutesLesDeclarations = (juges = JUGES) =>
  Object.entries(juges || {}).flatMap(([chemin, parMotif]) =>
    Object.entries(parMotif || {}).flatMap(([motif, declarations]) =>
      (declarations || []).map((declaration) => ({ ...declaration, chemin, motif }))
    )
  );

/** Une déclaration porte-t-elle une prose qui mérite d'être appelée justification ? */
export function justificationInsuffisante(declaration) {
  return String(declaration?.pourquoi || '').trim().length < MIN_JUSTIFICATION;
}

/** Une borne décide-t-elle par elle-même ? (HOTE ou MESURE) */
export const decideParElleMeme = (classe) => Boolean(CLASSES[classe]?.decisions);

/** Un angle accepté couvre-t-il cette borne ? */
export function angleAccepte(borne, angles = ANGLES_ACCEPTES) {
  return (angles || []).find(
    (angle) =>
      (angle.chemins || []).includes(borne.chemin) &&
      (angle.motifs || []).includes(borne.motif) &&
      angle.classe === borne.classe
  );
}

/**
 * Les délits de DÉCLARATION : classe inconnue, justification absente, et surtout
 * une borne qui décide sans angle accepté — le défaut d'origine, nommé.
 */
export function delitsDeDeclaration(juges = JUGES, angles = ANGLES_ACCEPTES) {
  const delits = [];
  for (const [chemin, parMotif] of Object.entries(juges || {})) {
    for (const [motif, declarations] of Object.entries(parMotif)) {
      for (const declaration of declarations) {
        const borne = { chemin, motif, valeur: declaration.valeur, classe: declaration.classe };
        if (!CLASSES[declaration.classe]) {
          delits.push({ ...borne, type: 'CLASSE_INCONNUE' });
          continue;
        }
        if (justificationInsuffisante(declaration)) {
          delits.push({ ...borne, type: 'SANS_JUSTIFICATION' });
        }
        if (decideParElleMeme(declaration.classe) && !angleAccepte(borne, angles)) {
          delits.push({ ...borne, type: 'DECIDE_SANS_ANGLE' });
        }
      }
    }
  }
  return delits;
}

/**
 * Ce que CE garde voit, et ce qu'il ne peut pas voir — publié pour être comparé
 * au relevé de CI-COVERAGE.md, pas pour être cru.
 */
export const CE_QUE_CE_GARDE_VOIT = {
  voit: [
    'toute borne de temps ABSOLU des surfaces de verdict déclarées (budgets Lighthouse, délais de test, plafonds HTTP), nommée avec son fichier, sa ligne et sa valeur',
    'une borne NOUVELLE : elle rougit tant qu’elle n’est pas déclarée ET classée',
    'une borne DISPARUE ou dont le nombre d’occurrences a changé : une déclaration périmée est un mensonge du registre',
    'une borne qui DÉCIDE (classe HOTE ou MESURE) sans angle accepté nommé — le défaut d’origine, rendu bruyant',
    'une déclaration sans prose : une justification de moins de 40 caractères n’en est pas une',
  ],
  nePeutPasVoir: [
    'les `{ timeout: N }` d’attente de CONDITION de `e2e/` (`toHaveURL`, `waitForSelector`) : leur classe est PROPRIETE par construction, et les inventorier ferait crier ce garde à chaque assertion ajoutée',
    'les `timeout-minutes` des workflows : bornes de vivacité du runner lui-même, pas verdicts',
    'les attentes de CONDITION de `e2e/` (`waitForSelector`, `waitForFunction`, les attentes de `e2e/helpers/attentes.js`) : ce ne sont pas des bornes qui décident, et les inventorier ferait crier ce garde à chaque condition écrite',
    'une borne calculée à l’exécution : seule une valeur LITTÉRALE est relevée. C’est le cas du TBT de la coquille, écrit `maxNumericValue: targetIsLocal ? 1600 : 1200` — deux seuils, un par hôte, et c’est justement la forme portable (le budget suit l’hôte au lieu de le supposer). Elle est donc NOMMÉE dans la compensation de l’angle accepté, pas relevée ligne à ligne',
    'les TABLES MESURÉES (`CLS_BUDGETS`, `TBT_DESKTOP_BUDGETS` de `scripts/lhci-cls-budgets.cjs`) : l’unité d’une entrée de table n’est pas syntaxique (un score sans unité voisine des millisecondes), donc elles ne sont pas balayées clé à clé — elles sont gouvernées par leurs propres tests (`lhci-cls-budgets.test.js`, `lhci-desktop-tbt.test.js`)',
    'une borne écrite ailleurs que dans les surfaces déclarées (un helper, une spec isolée) : elle n’est jugée que si sa surface entre au registre',
    'la différence entre une borne JOUÉE et une borne CITÉE : le relevé est TEXTUEL (`timeout: 20000` dans un commentaire compte autant que dans le code). Le garde surestime donc — il demande une déclaration de trop, jamais une de moins, et c’est le sens de l’erreur qu’on veut',
  ],
};
