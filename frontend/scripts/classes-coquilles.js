// LES RÈGLES DE « UNE COQUILLE NE RECOPIE PAS UNE CLASSE » — le module que lit
// le garde `scripts/check-classes-coquilles.js`, qui prononce le verdict.
//
// ── Le fait, et le trou qu'il ferme (09/10/2026) ─────────────────────────────
// Une coquille pré-rendue et React peignent la MÊME page deux fois. Pour qu'une
// bascule coquille → React ne déplace rien, les deux peintures doivent porter les
// mêmes classes — et jusqu'ici, elles les RECOPIAIENT : 236 listes de classes
// écrites en littéral dans `vite-plugins/prerender/**`, dont 203 avaient un
// jumeau EXACT dans `src/**` (mesure du 09/10/2026, rejouée sur l'état d'avant)
// et 31 étaient propres à la coquille. Rien ne rougissait quand un seul des deux
// côtés changeait : la classe recopiée ne déplace pas un texte, ne change pas un
// mot — elle change une bordure, une ombre, un état grisé, et cela se voit
// seulement à l'œil, sur la page. Aucune sonde existante ne pouvait le voir :
// celles de géométrie comparent l'encre et le `text-align` calculé, celle de
// texte compare les mots.
//
// Le remède a deux moitiés, et ce module les tient toutes les deux :
//   1. ce qui est PARTAGÉ vit dans un DOMICILE unique (src/config/classes-chrome.js
//      pour le chrome, 13 champs) : les deux canaux LISENT la même déclaration au
//      lieu de la retaper. Un champ que personne ne lit est refusé, un champ lu
//      par un SEUL canal aussi (c'est la recopie qui revient par la porte de
//      derrière), et une coquille qui RETAPE la valeur d'un champ au lieu de lire
//      son nom l'est également. Après la passe : 213 listes publiées, 182 jumelles,
//      31 déclarées — les 23 autres (18 listes du chrome, 5 conteneurs de page de
//      l'accueil) ne sont plus des copies du tout ;
//   2. ce qui n'est PAS partagé est NOMMÉ, et rien d'autre n'a le droit d'être
//      écrit en littéral dans une coquille : toute liste doit avoir un JUMEAU
//      dans une source React, ou être déclarée ici avec son motif. TROIS refus
//      tiennent la déclaration honnête : sans motif (un oubli avec un droit de
//      passage), périmée (la liste n'est plus publiée — l'exemption ne protège
//      plus rien et mentirait le jour où elle reviendrait) et MENTEUSE (la liste
//      a gagné un jumeau depuis — elle n'est donc plus propre à la coquille) ; la
//      MÊME exemption écrite deux fois est refusée pour la même raison.
//
// ── Pourquoi le JUMEAU est le bon critère (et ce qu'il ne prouve pas) ───────
// Le fait mesurable est celui-ci : la chaîne publiée par la coquille existe-t-elle
// ENTIÈRE comme valeur de `className` dans une source React ? Si oui, elle est
// peinte des deux côtés, et une retouche d'un seul côté fait disparaître le
// jumeau — donc le garde rougit, nommément, en donnant le module et la ligne.
// Ce qu'il ne prouve PAS, et qui doit être écrit : le jumeau dit que la CHAÎNE est
// écrite quelque part chez React, pas que c'est le MÊME ÉLÉMENT. Cette moitié
// faible est mesurée dans un navigateur (`e2e/geometrie-coquille-react.spec.js`
// compare l'encre et l'alignement calculé des deux peintures, et
// `e2e/texte-coquille-react.spec.js` compare les mots) ; ce que le domicile
// partagé, lui, garantit par construction, c'est l'identité de la VALEUR.
//
// ── La FRONTIÈRE du domicile est l'ÉGALITÉ, et elle est MESURÉE ─────────────
// La première rédaction cherchait la valeur d'un champ N'IMPORTE OÙ dans une liste
// publiée par une coquille, et elle refusait du vert : le bloc social de l'accueil
// publie « font-medium hover:text-orange-800 underline underline-offset-2 », qui
// CONTIENT le libellé de lien du pied de page sans être le même élément. Une liste
// qui se contente de PARTAGER une queue de jetons est donc acceptée — et elle n'a
// pas besoin de ce refus-là : une liste MODIFIÉE n'a plus de jumeau (React LIT le
// champ, donc sa valeur n'y est plus un littéral), et c'est ce verdict-ci qui la
// renvoie. Ce que le refus propre au domicile garde est le seul cas qu'il soit
// seul à voir : la liste EXACTE d'un champ, retapée telle quelle.
export const DOSSIER_COQUILLES = 'vite-plugins/prerender';

/**
 * Les planchers du balayage : en dessous, on refuse de juger.
 *
 * ~60 % du relevé du 09/10/2026 (5 modules, 90 sources React, 128 listes
 * publiées, 110 jumelles, pour 9 / 150 / 213 / 182 mesurés) : c'est la
 * proportion déjà retenue par `PLANCHERS_NOEUDS` et `PLANCHERS_PREMIER_ECRAN`
 * pour la même raison — un lecteur CASSÉ rend zéro, pas 20 % de moins, donc un
 * plancher serré n'ajoute pas de mordant et refuse du vert ; un plancher large
 * laisse passer une lecture qui n'a vu qu'un fragment. Déplacer 30 listes vers
 * le domicile partagé est un travail légitime, et il ne doit pas faire rougir ce
 * refus-là.
 */
export const MIN_MODULES_COQUILLES = 5;
export const MIN_LISTES_LUES = 128;
export const MIN_LISTES_AVEC_JUMELLE = 110;
export const MIN_SOURCES_REACT = 90;

/**
 * Les listes de classes ÉCRITES EN LITTÉRAL dans une coquille.
 *
 * Une liste COMPOSÉE (`class="${classe} mb-6"`, `class="… ${…}"`) n'est pas
 * lue : elle n'est pas une recopie, elle assemble des valeurs, et ce sont ces
 * valeurs qui doivent venir du domicile (vérifié par `verdictDomicile`).
 *
 * @param {string} source Module de pré-rendu.
 * @returns {Array<{valeur: string, ligne: number}>}
 */
export function listesDeClasseDeCoquille(source) {
  const listes = [];
  const texte = String(source);
  for (const trouve of texte.matchAll(/class="([^">]*)"/g)) {
    const valeur = trouve[1].trim();
    if (!valeur || valeur.includes('${')) continue;
    listes.push({ valeur, ligne: texte.slice(0, trouve.index).split('\n').length });
  }
  return listes;
}

/**
 * Les listes de classes écrites par React, telles quelles (`className="a b"`,
 * `className={'a b'}`, `className={`a b`}`). Les valeurs composées sont
 * ignorées : ce qui doit exister chez React, c'est la chaîne ENTIÈRE.
 *
 * @param {string} source Source React.
 * @returns {Set<string>}
 */
export function listesDeClasseReact(source) {
  const chaines = new Set();
  const texte = String(source);
  const motifs = [
    /className="([^"]*)"/g,
    /className='([^']*)'/g,
    /className=\{['"`]([^'"`]*)['"`]\}/g,
  ];
  for (const motif of motifs) {
    for (const trouve of texte.matchAll(motif)) {
      const valeur = trouve[1].trim();
      if (valeur && !valeur.includes('${')) chaines.add(valeur);
    }
  }
  return chaines;
}

/**
 * Les listes de classes qu'une coquille a le droit d'écrire seule.
 *
 * CHACUNE PORTE SON MOTIF, et le motif n'est pas un commentaire : c'est ce qui
 * distingue une décision d'un oubli. Toutes ont été relevées le 09/10/2026 —
 * ce sont les listes dont React ne publie PAS la même chaîne, parce que la
 * coquille peint un ÉTAT que React n'a jamais (un contrôle `readonly`, un
 * emplacement vide, un aperçu de formulaire désactivé avant hydratation).
 *
 * `publiee` est le texte exact tel que la coquille l'écrit : deux refus tiennent
 * l'entrée honnête (périmée si elle disparaît du module, menteuse si elle gagne
 * un jumeau chez React).
 */
export const CLASSES_PROPRES_AUX_COQUILLES = [
  {
    publiee:
      'w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-gray-300 rounded-md bg-white text-gray-700 text-sm font-medium',
    module: 'vite-plugins/prerender/shells-routes.js',
    motif:
      "bouton d'un aperçu de formulaire (état sans JavaScript) : React peint le bouton ACTIF, jamais ce repli inerte",
  },
  {
    publiee: 'inline-flex items-center text-sm font-medium text-orange-700 underline',
    module: 'vite-plugins/prerender/shells-routes.js',
    motif:
      "lien de consentement légal de l'aperçu (/login et /register, même liste aux deux endroits) : React publie un " +
      'composant de lien, la coquille un texte souligné',
  },
  {
    publiee: 'font-medium text-orange-600',
    module: 'vite-plugins/prerender/shells-routes.js',
    motif:
      "mot mis en avant dans une phrase d'aperçu (« Connexion », « inscrivez-vous ») : React découpe la phrase en composants",
  },
  {
    publiee:
      'relative flex items-center justify-center p-4 border-2 border-orange-500 bg-orange-50 rounded-lg cursor-pointer transition-all',
    module: 'vite-plugins/prerender/shells-routes.js',
    motif:
      "carte de choix SÉLECTIONNÉE de l'aperçu de /register : la sélection est un état React, la coquille peint les deux cartes",
  },
  {
    publiee:
      'relative flex items-center justify-center p-4 border-2 border-gray-300 rounded-lg cursor-pointer transition-all',
    module: 'vite-plugins/prerender/shells-routes.js',
    motif:
      "carte de choix NON sélectionnée du même aperçu (l'autre moitié de la paire ci-dessus)",
  },
  {
    publiee:
      'w-full flex items-center justify-between px-4 py-3 border border-gray-300 rounded-lg shadow-sm bg-white text-left',
    module: 'vite-plugins/prerender/shells-routes.js',
    motif:
      "sélecteur de pays de l'aperçu : React publie un composant à état (ouverture, sélection), la coquille une barre inerte",
  },
  {
    publiee: 'truncate text-gray-400',
    module: 'vite-plugins/prerender/shells-routes.js',
    motif:
      "valeur vide d'un sélecteur d'aperçu : elle n'existe que sans JavaScript (React publie la valeur choisie)",
  },
  {
    publiee: 'text-xs text-gray-500 transition-transform',
    module: 'vite-plugins/prerender/shells-routes.js',
    motif: "chevron du sélecteur d'aperçu (rotation à l'ouverture, état React)",
  },
  {
    publiee: 'block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm',
    module: 'vite-plugins/prerender/shells-routes.js',
    motif:
      "champ d'aperçu de /register (plusieurs occurrences : nom, e-mail, mot de passe) — React peint chaque champ avec ses utilitaires d'état",
  },
  {
    publiee: 'flex-1 block w-full px-4 py-3 border border-gray-300 rounded-r-lg',
    module: 'vite-plugins/prerender/shells-routes.js',
    motif: "champ collé d'un groupe (indicatif + numéro) dans l'aperçu de /register",
  },
  {
    publiee: 'bloc-differe-photo carte-editoriale carte-publique mb-6',
    module: 'vite-plugins/prerender/shells-routes.js',
    motif:
      "emplacement RÉSERVÉ de la photo de profil différée : React monte le bloc plus tard (lazy), la coquille réserve sa boîte",
  },
  {
    publiee: 'relative rounded-[3px] border-2 border-dashed border-stone-300 p-6',
    module: 'vite-plugins/prerender/shells-routes.js',
    motif: "boîte du même emplacement différé (le cadre en pointillés de l'uploader)",
  },
  {
    publiee: 'mt-1 h-4 w-4 rounded border-gray-300 text-orange-600',
    module: 'vite-plugins/prerender/shells-routes.js',
    motif: "case à cocher de l'aperçu (les utilitaires de formulaire de React ne sont pas écrits en clair)",
  },
  {
    publiee:
      'group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-orange-600',
    module: 'vite-plugins/prerender/shells-routes.js',
    motif: "bouton d'envoi de l'aperçu de /register (même raison que celui de /login, avec son pas propre)",
  },
  {
    publiee: 'bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center',
    module: 'vite-plugins/prerender/shells-routes.js',
    motif:
      "carte du message d'état vide (un état que React atteint par sa logique, jamais au premier rendu)",
  },
  {
    publiee: 'inline-flex items-center rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white',
    module: 'vite-plugins/prerender/shells-routes.js',
    motif: "appel à l'action de cet état vide (même raison que la carte ci-dessus)",
  },
];

/**
 * Le verdict sur les listes publiées par les coquilles.
 *
 * @param {Array<{module: string, source: string}>} coquilles Modules de pré-rendu.
 * @param {Array<{chemin: string, source: string}>} sourcesReact Sources React.
 * @param {Array<object>} [propres] `CLASSES_PROPRES_AUX_COQUILLES`.
 * @returns {{listes: Array<object>, sansJumelle: Array<object>, defauts: string[], volumes: object}}
 */
export function verdictListesCoquilles(coquilles, sourcesReact, propres = CLASSES_PROPRES_AUX_COQUILLES) {
  const jumelles = new Map();
  for (const { chemin, source } of sourcesReact) {
    for (const valeur of listesDeClasseReact(source)) {
      if (!jumelles.has(valeur)) jumelles.set(valeur, []);
      jumelles.get(valeur).push(chemin);
    }
  }

  const listes = [];
  for (const { module, source } of coquilles) {
    for (const { valeur, ligne } of listesDeClasseDeCoquille(source)) {
      listes.push({
        module,
        ligne,
        valeur,
        jumelles: jumelles.get(valeur) || [],
        declaree: propres.some((entree) => entree.module === module && entree.publiee === valeur),
      });
    }
  }

  const defauts = [];
  const sansJumelle = listes.filter((liste) => !liste.jumelles.length);
  for (const liste of sansJumelle) {
    if (liste.declaree) continue;
    defauts.push(
      `« ${liste.valeur} » (${liste.module}:${liste.ligne}) n'est écrite NULLE PART chez React et n'est pas déclarée : ` +
        'une classe recopiée depuis une ancienne version de la page ne rougit nulle part, donc elle dérive en silence — ' +
        'la lire au domicile partagé (src/config/classes-chrome.js, src/config/page-sections.js) ou la déclarer dans ' +
        'CLASSES_PROPRES_AUX_COQUILLES avec son motif'
    );
  }

  const vues = new Set();
  for (const entree of propres) {
    const cle = `${entree.module} :: ${entree.publiee}`;
    if (vues.has(cle)) defauts.push(`déclaration en double dans CLASSES_PROPRES_AUX_COQUILLES : ${cle}`);
    vues.add(cle);
    if (!String(entree.motif ?? '').trim()) {
      defauts.push(`« ${entree.publiee} » est déclarée SANS MOTIF : une exemption muette est un oubli avec un droit de passage`);
      continue;
    }
    const publiee = listes.some((liste) => liste.module === entree.module && liste.valeur === entree.publiee);
    if (!publiee) {
      defauts.push(
        `« ${entree.publiee} » est déclarée propre à ${entree.module}, qui ne la publie plus : l'exemption ne protège plus rien ` +
          'et elle mentirait le jour où la liste reviendrait'
      );
      continue;
    }
    if (jumelles.has(entree.publiee)) {
      defauts.push(
        `« ${entree.publiee} » est déclarée propre aux coquilles alors que React l'écrit maintenant ` +
          `(${(jumelles.get(entree.publiee) || []).slice(0, 3).join(', ')}) : la liste n'est plus propre à la coquille, ` +
          'elle doit passer au domicile partagé'
      );
    }
  }

  const volumes = {
    modules: coquilles.length,
    sourcesReact: sourcesReact.length,
    listes: listes.length,
    declarees: listes.filter((liste) => liste.declaree).length,
    avecJumelle: listes.length - sansJumelle.length,
  };
  return { listes, sansJumelle, defauts, volumes };
}

/**
 * Le verdict sur le DOMICILE partagé : chaque champ déclaré doit être LU par les
 * deux canaux, et sa valeur ne doit pas être RECOPIÉE dans une coquille.
 *
 * « Lu » se vérifie par le NOM du champ dans la source : c'est la seule forme
 * stable (interpoler la valeur directement dans une chaîne serait impossible sans
 * le nom — le build échouerait). Un champ lu par un seul canal est le défaut
 * d'origine, à un cran près : la déclaration existe, mais une des deux peintures
 * ne la lit pas.
 *
 * @param {Record<string, string>} domicile `CLASSES_CHROME` (nom -> valeur).
 * @param {Array<{module: string, source: string}>} coquilles Modules de pré-rendu.
 * @param {Array<{chemin: string, source: string}>} sourcesReact Sources React.
 * @returns {{defauts: string[], champs: Array<object>}}
 */
export function verdictDomicile(domicile, coquilles, sourcesReact) {
  const defauts = [];
  const champs = [];
  for (const [nom, valeur] of Object.entries(domicile)) {
    const luParCoquille = coquilles.filter(({ source }) => new RegExp(`\\b${nom}\\b`).test(source)).map((c) => c.module);
    const luParReact = sourcesReact.filter(({ source }) => new RegExp(`\\b${nom}\\b`).test(source)).map((s) => s.chemin);
    if (!luParCoquille.length) {
      defauts.push(
        `le champ « ${nom} » du domicile n'est LU par AUCUNE coquille : la déclaration ne peint rien avant le JavaScript ` +
          '(une coquille doit lire son nom, jamais sa valeur)'
      );
    }
    if (!luParReact.length) {
      defauts.push(
        `le champ « ${nom} » du domicile n'est LU par AUCUNE source React : les deux peintures ne peuvent alors pas porter ` +
          'la même valeur, et c’est la recopie qui revient'
      );
    }
    for (const { module, source } of coquilles) {
      // ── Ce qui compte comme « RECOPIE » : une liste ENTIÈRE, pas un fragment ──
      // La première rédaction cherchait la valeur n'importe OÙ dans une liste
      // (`class="[^"]*valeur`), et elle refusait du vert : le bloc social de
      // l'accueil publie « font-medium hover:text-orange-800 underline
      // underline-offset-2 », qui CONTIENT le libellé de lien du pied de page
      // sans être le même élément (mesuré le 09/10/2026). Or une liste MODIFIÉE
      // n'a pas besoin de ce refus : elle n'a alors aucun jumeau chez React
      // (React LIT le champ, donc la valeur n'y est plus un littéral) et c'est
      // `verdictListesCoquilles` qui la renvoie, en la nommant. Le refus propre
      // au domicile garde donc le seul cas qu'il soit seul à voir : la liste
      // EXACTE d'un champ, retapée telle quelle. Il dit alors « lis ce champ »
      // là où l'autre dit seulement « cette chaîne n'est écrite nulle part chez
      // React ».
      const listes = listesDeClasseDeCoquille(source);
      if (listes.some((liste) => liste.valeur === valeur)) {
        defauts.push(
          `la coquille ${module} RECOPIE la valeur de « ${nom} » au lieu de la lire (${valeur}) — ` +
            'la retaper est exactement ce que ce domicile existe pour interdire : lire le nom, jamais sa valeur'
        );
      }
    }
    champs.push({ nom, valeur, coquilles: luParCoquille.length, react: luParReact.length });
  }
  return { defauts, champs };
}
