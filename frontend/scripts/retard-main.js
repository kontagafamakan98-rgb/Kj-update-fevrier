/**
 * Règle PURE du retard de la base sur la branche de travail, et de l'ancienneté
 * du dernier déploiement de production — sans aucune E/S.
 *
 * ── Le trou que ce couple ferme ─────────────────────────────────────────────
 * Le dépôt savait dire « le frontend servi est-il celui de ce commit ? »
 * (`check-deployed-revision.js`, sur `main` seulement) et « ce travail existe-t-il
 * ailleurs que sur ce disque ? » (`check-git-branches.js`). Rien ne disait
 * COMBIEN : ni de combien de commits la base est en retard sur la branche de
 * travail, ni depuis quand la production n'a pas été reconstruite. Le
 * 07/10/2026, dix commits ont attendu d'être livrés sans qu'aucune ligne d'un
 * run ne le rappelle — et l'arbitrage « on fusionne maintenant » s'est fait sur
 * une mémoire, pas sur une mesure.
 *
 * ── (1) LE RETARD, EN COMMITS, ET POURQUOI LE COMPTE BRUT MENT ──────────────
 * « `main` est en retard sur ma branche » se lit de deux façons, et le garde
 * publie les DEUX parce qu'un seul des deux serait un demi-verdict :
 *   • `enAttente` — ce que la branche porte dont le CONTENU n'est pas dans la
 *     base, c'est-à-dire du travail qui attend d'être livré ;
 *   • `retardBranche` — ce que la base porte et que la branche n'a pas, donc ce
 *     qu'un rebasage apporterait.
 *
 * LA CORRECTION DU SQUASH N'EST PAS UN CONFORT, C'EST LA MESURE. Relevé sur ce
 * dépôt le 08/10/2026, la base ayant reçu le contenu de la branche par une
 * FUSION PAR SQUASH : `git rev-list --count origin/main..HEAD` dit **14**, et
 * l'attente réelle est **0** — l'arbre de la tête est celui de la base
 * (`778aee71…` des deux côtés). Un garde qui annoncerait 14 ferait chercher un
 * retard qui n'existe pas ; c'est le rouge qu'on apprend à ignorer, et un garde
 * ignoré ne garde rien. D'où la règle, en deux temps :
 *   1. si l'ARBRE de la tête est celui de la base, l'attente est NULLE, quels que
 *      soient les comptes de commits ;
 *   2. sinon, l'attente commence APRÈS le plus ANCIEN commit de la branche dont
 *      l'arbre est celui de la base — le point où le contenu de la base est entré
 *      dans la branche.
 * Le cas PARTIEL — squash déjà livré, puis de nouveaux commits — est ainsi compté
 * juste, et pas seulement le tout-ou-rien (c'est le cas réel d'une branche qu'on
 * continue après une fusion, donc le cas courant). Un « il suffit de comparer les
 * arbres » n'y suffirait pas : il déclarerait 0 devant une tête identique mais
 * compterait 11 devant la même branche qui a repris du travail.
 *
 * ── (2) L'ANCIENNETÉ, EN TEMPS : UN FAIT DE L'ARTEFACT, PAS DU COMMIT ──────
 * L'âge du dernier déploiement de production se lit dans l'en-tête
 * `Last-Modified` de la réponse de production : c'est l'instant où l'artefact
 * SERVI a été écrit. MESURÉ le 08/10/2026 — `Last-Modified: Thu, 08 Oct 2026
 * 05:05:03 GMT` pour un commit de fusion daté de 05:04:12, soit **51 s**, le temps
 * du build Vercel (le cache de l'edge le confirme : `Age: 4883` pour une réponse
 * de 06:26:27, c'est-à-dire un remplissage à 05:05).
 *
 * L'ÂGE DU COMMIT SERVI AURAIT MENTI, et c'est la raison de préférer l'en-tête :
 * un artefact reconstruit trois jours après son commit — redéploiement, cache
 * purgé, restauration — aurait paru aussi vieux que son commit, donc « en
 * retard » sans l'être ; et un artefact construit à l'instant pour un commit
 * ancien aurait paru vieux alors qu'il venait d'être publié. L'âge mesuré est
 * celui de la PEINTURE en ligne.
 *
 * L'horloge de référence est celle de l'EDGE (en-tête `Date` de la même
 * réponse) quand elle est là : les deux valeurs viennent alors de la même
 * horloge, donc aucune dérive de l'horloge locale ne peut fabriquer un âge. Sans
 * `Date`, l'horloge locale sert de repli et la source est rendue avec l'âge.
 *
 * ── (3) CE QUI REND UN VERDICT, ET POURQUOI IL N'Y EN A PAS PAR DÉFAUT ─────
 * Ce module ne juge RIEN tout seul : il rend `{ ok: true }` tant que l'appelant
 * n'a déclaré aucune borne (`--max-commits`, `--max-heures`). C'est délibéré, et
 * c'est la même décision que le troisième verdict de `check-git-branches.js` :
 * une branche de travail PORTE par définition des commits non livrés, et un dépôt
 * calme a LÉGITIMEMENT un déploiement ancien — un défaut par défaut serait rouge
 * tous les jours, donc lu jamais. Ce qui est un défaut, c'est ce que l'appelant
 * borne (par exemple : « plus de 5 commits en attente », « un déploiement de plus
 * de 48 h »), et une borne annoncée sur une valeur INCONNUE est alors un refus —
 * une borne ne se vérifie pas sur une inconnue.
 */

/** En-tête qui porte l'instant de construction de l'artefact servi. */
export const ENTETE_CONSTRUCTION = 'last-modified';

/** En-tête qui porte l'horloge de l'edge (référence de l'âge, si présente). */
export const ENTETE_REFERENCE = 'date';

const MS_PAR_HEURE = 3_600_000;

/**
 * Une durée en millisecondes, dite en français lisible (log, résumé de run).
 *
 * Trois échelles et pas une : « 3 j 4 h » se lit d'un coup d'œil là où
 * « 266 400 000 ms » se déchiffre. Les minutes ne s'affichent avec les heures que
 * pour ne pas confondre « 4 h » et « 4 h 59 ».
 *
 * @param {number} enMs Durée en millisecondes (négative → 'moins d’une minute').
 * @returns {string} Durée lisible.
 */
export function duree(enMs) {
  const ms = Number(enMs);
  if (!Number.isFinite(ms)) return 'inconnue';
  const secondes = Math.floor(Math.max(0, ms) / 1000);
  const jours = Math.floor(secondes / 86400);
  const heures = Math.floor((secondes % 86400) / 3600);
  const minutes = Math.floor((secondes % 3600) / 60);
  if (jours) return `${jours} j ${heures} h`;
  if (heures) return `${heures} h ${String(minutes).padStart(2, '0')}`;
  if (minutes) return `${minutes} min`;
  return 'moins d’une minute';
}

/**
 * L'attente de livraison d'une branche, corrigée de la fusion par squash.
 *
 * @param {object} faits
 * @param {Array<{sha: string, arbre: string, quandMs: number}>} faits.commits
 *   Commits de la branche absents de la base, du PLUS ANCIEN au plus récent
 *   (`git log --reverse`, jamais l'ordre par défaut : toute la règle repose sur
 *   le premier commit rencontré).
 * @param {string} faits.arbreBase Arbre (`<commit>^{tree}`) de la base.
 * @param {string} faits.arbreTete Arbre de la tête de la branche.
 * @param {number} faits.maintenant Horloge d'observation, en ms.
 * @returns {{enAttente: number, motif: string, indexDepuis: number, depuisMs: number|null}}
 *   `indexDepuis` : index, dans `commits`, du PLUS ANCIEN commit en attente (-1
 *   s'il n'y en a aucun) — c'est de lui que part l'ancienneté du travail en
 *   attente, pas de la tête : un commit d'il y a trois jours qui attend depuis
 *   trois jours est plus grave qu'un commit d'aujourd'hui.
 */
export function attenteDeLivraison({ commits = [], arbreBase, arbreTete, maintenant = Date.now() } = {}) {
  const total = commits.length;
  if (total === 0) {
    return { enAttente: 0, motif: 'aucun commit de la branche n’est absent de la base', indexDepuis: -1, depuisMs: null };
  }
  // 1. L'ARBRE décide avant les comptes : même tête que la base ⇒ rien à livrer,
  //    quel que soit le nombre de commits que le squash a laissés « absents ».
  if (arbreBase && arbreTete === arbreBase) {
    return {
      enAttente: 0,
      motif: 'l’arbre de la tête est celui de la base : fusion par squash, tout le contenu est déjà livré',
      indexDepuis: -1,
      depuisMs: null,
    };
  }
  // 2. Sinon, l'attente commence après le dernier commit dont l'arbre est celui
  //    de la base — le plus ANCIEN d'entre eux, donc `findIndex` sur une liste
  //    ordonnée du plus ancien au plus récent.
  const livraison = commits.findIndex((commit) => arbreBase && commit.arbre === arbreBase);
  const indexDepuis = livraison === -1 ? 0 : livraison + 1;
  const enAttente = total - indexDepuis;
  const premier = commits[indexDepuis];
  const depuisMs = premier ? Math.max(0, maintenant - Number(premier.quandMs)) : null;
  return {
    enAttente,
    motif: livraison === -1
      ? 'aucun commit de la branche ne porte l’arbre de la base : tout ce qui est absent est du contenu à livrer'
      : `fusion par squash reconnue au commit ${commits[livraison].sha.slice(0, 12)} : l’attente commence après lui`,
    indexDepuis: enAttente > 0 ? indexDepuis : -1,
    depuisMs: enAttente > 0 ? depuisMs : null,
  };
}

/**
 * Une date d'en-tête HTTP, ou `null` — jamais une date inventée.
 *
 * `Date.parse` sur une chaîne vide rend `NaN`, et `new Date(NaN)` propagerait un
 * âge silencieusement faux : la lecture est donc explicite des deux côtés.
 *
 * @param {unknown} valeur Valeur brute de l'en-tête.
 * @returns {Date|null} La date, ou null si elle n'est pas lisible.
 */
export function dateEntete(valeur) {
  if (typeof valeur !== 'string' || !valeur.trim()) return null;
  const ms = Date.parse(valeur.trim());
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * L'ancienneté du dernier déploiement de production, lue dans deux en-têtes.
 *
 * @param {Object<string, string>} entetes En-têtes de la réponse de production,
 *   en minuscules (`last-modified`, `date`).
 * @param {object} [options]
 * @param {number} [options.maintenant] Horloge locale, utilisée SEULEMENT si
 *   l'edge n'a pas donné son `Date`.
 * @returns {{ms: number|null, construit: Date|null, reference: Date|null, source: string, erreur: string|null}}
 *   `ms === null` et `erreur` renseignée : rien ne peut être affirmé sur l'âge,
 *   et le refus le NOMME plutôt que de rendre 0 (un « vieux de 0 » inventé serait
 *   un vert fabriqué).
 */
export function ageDeploiement(entetes = {}, { maintenant = Date.now() } = {}) {
  const construit = dateEntete(entetes[ENTETE_CONSTRUCTION]);
  if (!construit) {
    return {
      ms: null,
      construit: null,
      reference: null,
      source: '',
      erreur:
        `l'en-tête « Last-Modified » de la production est absent ou illisible ` +
        `(${JSON.stringify(entetes[ENTETE_CONSTRUCTION] ?? null)}) : rien ne dit quand l'artefact servi a été ` +
        'construit. Un hébergeur qui ne date pas ses réponses rendrait l\'ancienneté invérifiable — les ' +
        'sondes de production nomment cet état, elles ne le comblent pas par une estimation.',
    };
  }
  const reference = dateEntete(entetes[ENTETE_REFERENCE]);
  return {
    ms: Math.max(0, (reference ?? new Date(Number(maintenant))).getTime() - construit.getTime()),
    construit,
    reference,
    source: reference ? `en-tête « ${ENTETE_REFERENCE} » de l'edge` : 'horloge locale (l\'edge n\'annonce pas de « Date »)',
    erreur: null,
  };
}

/**
 * Le verdict, et ses bornes — aucune n'est tenue si l'appelant ne la déclare pas.
 *
 * @param {object} faits
 * @param {number} faits.enAttente Commits de la branche en attente de livraison.
 * @param {number|null} faits.ageMs Ancienneté du dernier déploiement, ou null.
 * @param {number|null} faits.maxCommits Borne sur l'attente (null = pas de borne).
 * @param {number|null} faits.maxHeures Borne sur l'ancienneté (null = pas de borne).
 * @returns {{ok: boolean, raisons: string[]}} `raisons` nomme CHAQUE borne
 *   dépassée : deux bornes dépassées donnent deux phrases, jamais un « échec ».
 */
export function verdictDeRetard({ enAttente = 0, ageMs = null, maxCommits = null, maxHeures = null } = {}) {
  const raisons = [];
  if (maxCommits !== null && enAttente > maxCommits) {
    raisons.push(
      `retard de livraison : ${enAttente} commit(s) de la branche en attente > borne de ${maxCommits} ` +
        '— la base n\'a pas rattrapé ce travail, il faut le livrer (fusion) ou le borner autrement'
    );
  }
  if (maxHeures !== null) {
    if (ageMs === null) {
      raisons.push(
        `borne de ${maxHeures} h annoncée sur l'ancienneté du dernier déploiement, mais cette ancienneté n'a ` +
          'pas pu être établie : une borne ne se vérifie pas sur une inconnue'
      );
    } else if (ageMs > maxHeures * MS_PAR_HEURE) {
      raisons.push(
        `dernier déploiement de production il y a ${duree(ageMs)} > borne de ${maxHeures} h ` +
          `— la production n'a pas été reconstruite depuis la date annoncée`
      );
    }
  }
  return { ok: raisons.length === 0, raisons };
}

/**
 * La phrase du retard en commits — les deux directions, toujours les deux.
 *
 * @param {object} faits
 * @param {string} faits.branche Nom de la branche de travail (« HEAD détaché (abc1234) » si détachée).
 * @param {string} faits.base Réf de la base comparée.
 * @param {number} faits.enAttente Contenu de la branche en attente de livraison.
 * @param {number} faits.absents Comptes bruts de commits de la branche absents de la base.
 * @param {number} faits.retardBranche Commits de la base absents de la branche.
 * @param {string} faits.motif Pourquoi l'attente vaut ce qu'elle vaut (squash ou non).
 * @param {number|null} faits.depuisMs Ancienneté du plus ancien commit en attente.
 * @returns {string} La phrase publiée en annotation.
 */
export function phraseDeRetard({ branche, base, enAttente, absents = 0, retardBranche = 0, motif = '', depuisMs = null } = {}) {
  const attente = enAttente === 0
    ? `aucun contenu en attente de livraison (${absents} commit(s) de « ${branche} » absents de ${base} — ${motif})`
    : `${base} est en retard de ${enAttente} commit(s) sur « ${branche} »` +
      (depuisMs === null ? '' : `, dont le plus ancien attend depuis ${duree(depuisMs)}`) +
      ` (${motif})`;
  const inverse = retardBranche === 0
    ? `« ${branche} » ne manque aucun commit de ${base}`
    : `« ${branche} » est en retard de ${retardBranche} commit(s) sur ${base} (un rebasage les apporterait)`;
  return `base « ${base} » ↔ branche « ${branche} » : ${attente} ; ${inverse}.`;
}

/**
 * La phrase du déploiement — l'âge, et ce qui l'a mesuré.
 *
 * @param {object} faits
 * @param {string} faits.revision Révision annoncée par la production (meta du build).
 * @param {number|null} faits.ageMs Ancienneté du dernier déploiement.
 * @param {Date|null} faits.construit Instant de construction (`Last-Modified`).
 * @param {string} faits.source Horloge de référence utilisée.
 * @param {string|null} faits.erreur Cause quand l'âge n'a pas pu être établi.
 * @returns {string} La phrase publiée en annotation.
 */
export function phraseDeploiement({ revision = '', ageMs = null, construit = null, source = '', erreur = null } = {}) {
  const sert = revision ? `sert la révision ${revision.slice(0, 12)}` : 'n\'annonce AUCUNE révision';
  if (ageMs === null) {
    return `production (frontend) : ${sert}, ancienneté du dernier déploiement INCONNUE — ${erreur}`;
  }
  return (
    `production (frontend) : ${sert}, dernier déploiement il y a ${duree(ageMs)} ` +
    `(« Last-Modified » du ${construit.toISOString()}${source ? `, ${source}` : ''}).`
  );
}
