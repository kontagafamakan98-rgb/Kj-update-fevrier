#!/usr/bin/env node
/**
 * Le frontend SERVI est-il celui de ce commit ?
 *
 * ── Le trou que ce garde ferme ─────────────────────────────────────────────
 * Le backend répond quelle révision il exécute (`/health`, champ `revision`) et
 * `deploy-fly` refuse quand ce n'est pas le commit attendu (CI-COVERAGE.md, F8).
 * Le frontend, lui, ne disait RIEN : le déploiement de production est fait par
 * Vercel depuis l'app GitHub, aucun job ne le commande, donc « main est vert »
 * ne pouvait pas distinguer « le site servi est construit depuis ce commit » de
 * « Vercel a échoué / est en retard / n'a pas redéployé ». Rien n'observait la
 * production du frontend pour le CODE — les sondes existantes y regardent le SEO,
 * les OG et le CORS, jamais de quel commit l'artefact est fait.
 *
 * Le build publie donc sa révision dans le HTML statique
 * (`vite-plugins/inject-build-revision.js` → meta `kojo-build-revision`), et ce
 * garde compare cette réponse à ce que `main` aurait dû déployer.
 *
 * ── Quelle révision est ATTENDUE, et ce qu'on compare VRAIMENT ────────────
 * La propriété visée est : aucun changement de `frontend/**` n'est absent de la
 * production. C'est une propriété d'ARBRE, pas de SHA — et le SHA n'en était
 * qu'un raccourci, faux dès qu'une fusion ne touche pas le frontend.
 *
 * Mesuré le 21/10/2026 : une fusion DOCUMENTAIRE laisse Vercel sur le build
 * précédent (le déployeur ne reconstruit pas pour un changement qui ne le
 * concerne pas), donc la révision servie n'est ni la tête de `main` ni, dans un
 * clone superficiel ou sur un commit de fusion, ce que `git rev-list -1 HEAD --
 * frontend/` désigne. Le garde refusait alors une production CONFORME : un rouge
 * sur un fait vrai, c'est-à-dire un garde qu'on apprend à ignorer.
 *
 * Le verdict porte donc sur l'arbre de `frontend/`. Deux SHA différents avec le
 * MÊME arbre sont acceptés (et le disent) ; deux SHA différents avec des arbres
 * différents sont refusés. L'égalité de SHA reste le chemin rapide, qui
 * n'appelle même pas git.
 *
 * L'arbre SERVI n'est plus lu dans le clone : le build le PUBLIE dans le HTML
 * qu'il produit (`vite-plugins/inject-build-revision.js` → meta
 * `kojo-build-tree`), et ce garde le lit là. C'était la dernière raison pour
 * laquelle le commit servi devait exister localement : un clone superficiel
 * rendait l'arbre « incomparable » et la vérification sortait en prémisse
 * (code 2) pour un fait qui ne disait rien de la production. Le clone n'est
 * plus interrogé que pour les commits ATTENDUS — ceux que l'appelant nomme, et
 * qui viennent de `main`.
 *
 *   • `--attendu` : le commit poussé (Vercel redéploie chaque push de `main`,
 *     mesuré sur 12 commits consécutifs) ;
 *   • `--sinon`   : le dernier commit qui a touché `frontend/**` — conservé pour
 *     que les deux valeurs restent nommées, même si l'arbre les départage.
 * Accepter une révision PLUS ANCIENNE dont l'arbre diffère ne relâcherait rien
 * non plus, mais serait un refus silencieux de la question posée : un
 * déploiement en retard doit rougir.
 *
 * ── Ce que ce garde refuse, et pourquoi il le NOMME ────────────────────────
 * Quatre refus, quatre corrections différentes — un seul « échec » les confondrait :
 *   1. le HTML servi n'annonce AUCUNE révision : l'artefact est antérieur à ce
 *      mécanisme, ou construit sans qu'aucune source n'en donne (ni `KOJO_GIT_SHA`,
 *      ni variable système, ni dépôt git — cf. `vite-plugins/inject-build-revision.js`).
 *      Correction : redéployer le frontend sur Vercel.
 *   2. le HTML servi annonce une révision mais AUCUN arbre : artefact antérieur
 *      au verdict par arbre, ou build fait hors dépôt git. Correction :
 *      redéployer. C'est un fait de PRODUCTION (code 1), jamais une prémisse :
 *      comparer deux arbres ne demande plus le commit servi dans ce clone.
 *   3. l'arbre servi n'est celui d'aucune révision attendue : la production est
 *      en retard (build échoué, en file d'attente depuis plus longtemps que la
 *      fenêtre d'attente, ou déploiement annulé).
 *   4. aucune réponse exploitable : le site ne répond pas, ou le CDN refuse
 *      (défi de sécurité de l'edge Vercel, mesuré le 20/09/2026 et nommé ici :
 *      `X-Vercel-Mitigated`). Rien ne peut alors être affirmé sur le déploiement.
 *
 * La seule prémisse qui reste (code 2) ne parle PAS de la production : c'est
 * l'arbre d'une révision ATTENDUE qui est illisible dans ce clone — donc
 * l'invocation, pas le déploiement. Son remède est le clone, jamais un
 * redéploiement.
 *
 * ── Coût, et le risque de faux rouge ───────────────────────────────────────
 * Un appel HTTP par tentative, séquentiels, bornés par `--tentatives` (défaut 9
 * espacés de 20 s ≈ 3 min) : c'est ce qui absorbe un déploiement Vercel en cours
 * sans jamais transformer un refus en succès. Le défi de l'edge Vercel (le seul
 * faux rouge observé sur la production, cf. `resolve-vercel-url.sh`) est nommé
 * comme tel, donc reconnu au lieu d'être confondu avec un frontend en retard.
 *
 * ── « EN FILE » N'EST PAS « EN RETARD » (22/10/2026) ────────────────────────
 * La fusion de #184 (21/10/2026) a laissé `main` rouge : la fenêtre de 3 min
 * expirait à 15:21, Vercel n'a créé le déploiement de production qu'à 15:40 —
 * 22 min de file. Le garde mesurait VRAI (la production ne servait pas ce
 * commit) mais son message nommait TROIS causes possibles sans les distinguer :
 * build échoué, en file d'attente, jamais déclenché. Trois corrections
 * différentes sous un seul rouge, donc un rouge qu'on apprend à ignorer.
 *
 * Allonger la fenêtre ne tenait pas : le job `frontend-build` a un plafond de
 * 20 min et en consomme déjà ~19 (mesuré le 22/10/2026). L'API Vercel, elle,
 * SAIT : `/v7/deployments?sha=…` rend les déploiements de la révision avec leur
 * `readyState`. Un déploiement QUEUED/BUILDING/INITIALIZING est une mesure qui
 * n'a pas encore eu lieu — une PRÉMISSE (code 2), comme la résolution de preview
 * qui utilise le même client. Un build ERROR/CANCELED, une révision sans AUCUN
 * déploiement, et une production qui sert un autre arbre restent des rouges, et
 * le message dit lequel. Sans jeton, rien n'est inventé : le refus reste celui
 * d'avant, avec la raison de la non-lecture.
 *
 * Usage :
 *   cd frontend && node scripts/check-deployed-revision.js \
 *     --attendu "$GITHUB_SHA" --sinon "$(git -C .. rev-list -1 HEAD -- frontend/)"
 * Optionnel :
 *   --base https://kojoforafrica.cc.cd   (défaut : SITE_ORIGIN, scripts/site-meta.js)
 *   --tentatives 9 --delai 20
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  BUILD_REVISION_META,
  BUILD_TREE_DIR,
  BUILD_TREE_META,
  SITE_ORIGIN,
  isLoopbackUrl,
  metaContent,
} from './site-meta.js';
// L'API Vercel et son client vivent dans `preview-vercel.js` : un SECOND client
// HTTP aurait sa propre gestion d'erreur, et les deux pourraient diverger sur ce
// qui est lisible. Le jeton, l'équipe et le projet sont les MÊMES variables.
import { PROJET_DEFAUT, REVISION, vercelApi } from './preview-vercel.js';

// Le dossier dont l'ARBRE décide du verdict. Un seul propriétaire : le jour où
// le déployeur sert autre chose que `frontend/`, c'est ici que ça se dit — et
// le build lit la MÊME constante (`BUILD_TREE_DIR`), donc les deux côtés ne
// peuvent pas comparer deux dossiers différents.
export const DOSSIER_FRONTEND = BUILD_TREE_DIR;

// Longueur minimale d'un SHA de commit : en dessous, ce n'est pas un identifiant
// de commit mais une chaîne quelconque — comparer là-dessus serait un faux vert.
export const LONGUEUR_SHA_MIN = 7;

// Un arbre git, c'est 40 caractères hexadécimaux — et rien d'autre. Une valeur
// d'une autre forme (arbre abrégé, message d'erreur) n'est pas un arbre, et
// comparer là-dessus accepterait deux contenus différents sur douze caractères.
export const ARBRE_GIT = /^[0-9a-f]{40}$/i;

// Valeurs qui ne sont PAS une révision : le champ vide, et ce qu'un artefact
// fabriqué sans révision pourrait annoncer.
export const REVISIONS_ABSENTES = new Set(['', 'inconnue', 'unknown', 'none', 'null', 'undefined', 'n/a']);

// Un seul en-tête, pour que la requête soit identifiable dans les journaux du CDN.
const PROBE_HEADERS = { 'user-agent': 'kojo-deployed-revision/1.0' };

// ── L'ÉTAT DU DÉPLOIEMENT, quand la production ne sert pas encore la révision ──
// Un déploiement EN VOL n'est pas un retard mesuré : la production n'a pas
// encore eu l'occasion de servir cette révision, donc aucun verdict n'est rendu
// ici (code 2). Lui donner le rouge du retard ferait porter au code un fait de
// file d'attente Vercel — l'incident du 21/10/2026 (22 min de file, `main` rouge).
export const ETATS_EN_FILE = new Set(['QUEUED', 'BUILDING', 'INITIALIZING']);

// États terminaux d'un ÉCHEC : là, le déploiement a eu lieu et n'a pas abouti.
// Ce n'est ni une file ni une prémisse — le build est à corriger.
export const ETATS_ECHEC_DEPLOIEMENT = new Set(['ERROR', 'CANCELED']);

/**
 * Les en-têtes qui DATENT le déploiement, rendus avec le corps de la réponse.
 *
 * `Last-Modified` porte l'instant où l'artefact SERVI a été construit — mesuré
 * sur la production le 08/10/2026 : `Thu, 08 Oct 2026 05:05:03 GMT` pour un
 * commit de fusion daté de 05:04:12, soit 51 s de build Vercel — et `Date`
 * l'horloge de l'edge, seule référence d'âge immunisée contre la dérive de
 * l'horloge locale.
 *
 * Ils voyagent avec le corps parce qu'un SECOND lecteur en a besoin :
 * `scripts/check-retard-main.js` publie l'ancienneté du dernier déploiement.
 * Deux requêtes pour une seule réponse seraient deux occasions de diverger — la
 * même raison qui a mis l'origine du site dans `site-meta.js`.
 *
 * @param {Response} réponse Réponse de production.
 * @returns {Object<string, string>} En-têtes en minuscules (chaîne vide si absents).
 */
export function entetesDatants(réponse) {
  const lire = (nom) => {
    const valeur = réponse?.headers?.get?.(nom);
    return typeof valeur === 'string' ? valeur : '';
  };
  return { 'last-modified': lire('last-modified'), date: lire('date') };
}

/**
 * La valeur est-elle une RÉVISION ? Vide et « inconnue » ne le sont pas.
 *
 * Une seule fonction pour les deux côtés de la comparaison : sans ça, une
 * révision « inconnue » servie et la même attendue se déclareraient concordantes
 * — le faux vert exact que ce garde existe pour fermer.
 *
 * @param {unknown} valeur Valeur brute (chaîne, null, autre type).
 * @returns {string} La révision, ou '' si la valeur n'en est pas une.
 */
export function normaliser(valeur) {
  if (typeof valeur !== 'string') return '';
  const propre = valeur.trim();
  return REVISIONS_ABSENTES.has(propre.toLowerCase()) ? '' : propre;
}

/**
 * Les révisions acceptées, à partir de ce que l'appelant a fourni.
 *
 * @param {Array<string|undefined>} valeurs `--attendu`, puis `--sinon`.
 * @returns {{valides: string[], invalides: string[]}} Les invalides sont rendues
 *   telles quelles : c'est ce qui permet de les NOMMER dans le refus.
 */
export function revisionsAttendues(valeurs = []) {
  const valides = [];
  const invalides = [];
  for (const valeur of valeurs) {
    const brute = String(valeur ?? '').trim();
    if (!brute) continue;
    const révision = normaliser(brute);
    if (révision.length < LONGUEUR_SHA_MIN) invalides.push(brute);
    else if (!valides.includes(révision)) valides.push(révision);
  }
  return { valides, invalides };
}

/**
 * La révision publiée par le HTML servi, ou '' si la page n'en annonce aucune.
 *
 * @param {string} html Corps de la réponse de la page d'accueil.
 * @returns {string} La révision annoncée.
 */
export function revisionServie(html) {
  return normaliser(metaContent(String(html ?? ''), BUILD_REVISION_META));
}

/**
 * L'ARBRE `frontend/` publié par le HTML servi, ou '' si la page n'en annonce
 * aucun (ou en annonce un qui n'a pas la forme d'un arbre git).
 *
 * C'est la grandeur du verdict, et elle voyage dans l'artefact : le garde n'a
 * donc plus à résoudre le commit SERVI localement. Une valeur abrégée est
 * refusée comme absente — deux arbres différents partagent leurs douze premiers
 * caractères assez souvent pour qu'un préfixe soit un faux vert.
 *
 * @param {string} html Corps de la réponse de la page d'accueil.
 * @returns {string} L'arbre publié, en minuscules, ou ''.
 */
export function arbreServi(html) {
  const valeur = String(metaContent(String(html ?? ''), BUILD_TREE_META) ?? '').trim();
  return ARBRE_GIT.test(valeur) ? valeur.toLowerCase() : '';
}

/**
 * Les coordonnées Vercel lues dans l'environnement, jamais recopiées ailleurs.
 *
 * Les MÊMES variables que `check-deployed-assets.js --preview` et
 * `livrer.py` : le jeton, l'équipe et le nom de projet n'ont qu'une source.
 *
 * @param {object} [env] Environnement (injectable en test). Défaut `process.env`.
 * @returns {{token: string, teamId: string, projet: string}}
 */
export function optionsVercel(env = process.env) {
  return {
    token: String(env?.VERCEL_TOKEN ?? '').trim(),
    teamId: String(env?.VERCEL_TEAM_ID ?? '').trim(),
    projet: String(env?.VERCEL_PROJECT_NAME ?? '').trim() || PROJET_DEFAUT,
  };
}

/**
 * L'état du déploiement de PRODUCTION d'une révision, ou la raison de son absence.
 *
 * Le filtre `sha` rend les déploiements de CE commit ; on ne retient que
 * `target === 'production'` (une preview du même commit ne dit rien de la
 * production) et on vérifie `meta.githubCommitSha`, comme `preview-vercel.js` :
 * l'API rend parfois des voisins, et attribuer leur état à cette révision
 * reviendrait à juger un autre artefact.
 *
 * Jamais d'exception : `erreur` non nul veut dire « état non lu » (jeton absent,
 * API illisible) — l'appelant garde alors son refus d'avant au lieu d'inventer
 * une prémisse.
 *
 * @param {string} révision SHA poussé (7 à 40 caractères).
 * @param {object} [options] `token`, `teamId`, `projet`, `fetchImpl`.
 * @returns {Promise<{trouve: boolean, etat: string, id: string, erreur: string|null}>}
 */
export async function etatDeploiementProduction(révision, {
  token,
  teamId = '',
  projet = PROJET_DEFAUT,
  fetchImpl = fetch,
} = {}) {
  const rev = normaliser(révision).toLowerCase();
  if (!REVISION.test(rev)) {
    return {
      trouve: false,
      etat: '',
      id: '',
      erreur: `révision « ${révision ?? ''} » illisible : l'état d'un déploiement se lit pour un identifiant de commit`,
    };
  }
  const jeton = String(token ?? '').trim();
  if (!jeton) {
    return {
      trouve: false,
      etat: '',
      id: '',
      erreur:
        `jeton Vercel absent (VERCEL_TOKEN) : l'état du déploiement de ${rev.slice(0, 12)} ` +
        'n\'a PAS été lu — « en file » et « jamais déclenché » restent confondus, comme avant.',
    };
  }

  let liste;
  try {
    liste = await vercelApi(
      `/v7/deployments?projectId=${encodeURIComponent(projet)}&sha=${rev}&limit=20`,
      { token: jeton, teamId, fetchImpl }
    );
  } catch (error) {
    return {
      trouve: false,
      etat: '',
      id: '',
      erreur: `état des déploiements de ${rev.slice(0, 12)} illisible (${error.message})`,
    };
  }

  const déploiements = Array.isArray(liste?.deployments) ? liste.deployments : [];
  const production = déploiements.filter(
    (d) =>
      d &&
      d.target === 'production' &&
      String(d.meta?.githubCommitSha ?? '').trim().toLowerCase() === rev
  );
  if (!production.length) {
    return { trouve: false, etat: '', id: '', erreur: null };
  }
  const retenu = production[0];
  return {
    trouve: true,
    etat: String(retenu.readyState ?? '').trim().toUpperCase(),
    id: String(retenu.uid || retenu.id || ''),
    erreur: null,
  };
}

/**
 * Qualifie un refus avec ce que Vercel sait du DÉPLOIEMENT, quand il le sait.
 *
 * Ce que fait cette fonction, et pourquoi elle existe : le refus du garde dit
 * « la production ne sert pas cette révision » sans pouvoir distinguer un build
 * échoué d'une file d'attente (l'incident du 21/10/2026). Elle interroge l'API
 * pour UNE question étroite — l'état du déploiement de production de la
 * révision attendue — et rend :
 *   • une PRÉMISSE si le déploiement est en vol (QUEUED/BUILDING/INITIALIZING) ;
 *   • le même refus, nommé, si le build est en ERROR/CANCELED ;
 *   • le même refus s'il n'y a AUCUN déploiement de cette révision ;
 *   • le même refus, inchangé, si l'état n'a pas pu être lu (jeton, API).
 * Elle ne rend JAMAIS un succès : le déploiement existe et bouge, mais la
 * production ne sert pas encore son artefact.
 *
 * @param {object} verdict Verdict déjà rendu (`ok: false`).
 * @param {Array<string>} attendues Révisions acceptées.
 * @param {object} [options] `deploiement` (identifiants), `etatDeploiement`, `fetchImpl`.
 * @returns {Promise<object>} Le verdict, éventuellement précisé.
 */
export async function qualifierRefus(verdict, attendues = [], {
  deploiement = optionsVercel(),
  etatDeploiement = etatDeploiementProduction,
  fetchImpl = fetch,
} = {}) {
  if (!verdict || verdict.ok || verdict.premisse) return verdict;
  const message = String(verdict.message ?? '');
  // Ces trois refus ne parlent pas du déploiement : une production muette, un
  // artefact sans arbre publié, un site injoignable. L'API n'y changerait rien
  // et l'interroger donnerait un chiffre qui ne décrit pas ce refus-là.
  if (/AUCUNE révision|AUCUN arbre|aucune réponse exploitable/.test(message)) return verdict;

  const cibles = attendues.map(normaliser).filter(Boolean);
  let lu = null;
  let erreur = null;
  for (const cible of cibles) {
    const état = await etatDeploiement(cible, { ...deploiement, fetchImpl });
    if (état?.trouve) {
      lu = { ...état, cible };
      break;
    }
    erreur = état?.erreur || erreur;
  }

  if (!lu) {
    const cause = erreur
      ? ` État Vercel NON LU : ${erreur}`
      : ` Aucun déploiement de ${cibles.map((c) => c.slice(0, 12)).join(' ou ')} côté Vercel : ` +
        "le push n'en a déclenché AUCUN — ce n'est pas une file d'attente, c'est un déploiement manquant.";
    return { ...verdict, message: message + cause };
  }

  const suite = `${lu.cible.slice(0, 12)}${lu.id ? ` (${lu.id})` : ''} est en ${lu.etat}`;
  if (ETATS_EN_FILE.has(lu.etat)) {
    return {
      ok: false,
      premisse: true,
      message:
        `déploiement de ${suite} : la production n'a pas ENCORE servi cette révision, ` +
        "donc aucun verdict n'est rendu ici (prémisse) — ce n'est ni un build échoué ni un " +
        "déploiement manquant. Vercel a mis 22 min à créer le déploiement d'une fusion le " +
        "21/10/2026 ; la fenêtre d'attente de ce garde (≈ 3 min) est plus courte que cette file.",
    };
  }
  if (ETATS_ECHEC_DEPLOIEMENT.has(lu.etat)) {
    return {
      ...verdict,
      message: `${message} Le déploiement de ${suite} : ce n'est pas une file d'attente, c'est un build Vercel en échec.`,
    };
  }
  return {
    ...verdict,
    message:
      `${message} Le déploiement de ${suite} : il existe, mais la production ne sert pas son ` +
      'arbre — vérifier l\'alias de production (un déploiement READY que le domaine ne sert pas).',
  };
}

/**
 * Le verdict, avec le coupable nommé dans chaque cas.
 *
 * @param {string} servie Révision annoncée par la production.
 * @param {string[]} attendues Révisions acceptées.
 * @returns {{ok: boolean, message: string}} Verdict et son explication.
 */
export function comparer(servie, attendues = []) {
  const révision = normaliser(servie);
  const acceptées = attendues.map(normaliser).filter(Boolean);
  const attendu = acceptées.length ? acceptées.map((r) => r.slice(0, 12)).join(' ou ') : '(aucune)';

  if (!révision) {
    return {
      ok: false,
      message:
        `le frontend servi n'annonce AUCUNE révision (meta « ${BUILD_REVISION_META} » absente) : ` +
        "l'artefact déployé est antérieur à ce mécanisme, ou il a été construit sans qu'aucune " +
        'source n\'en donne (KOJO_GIT_SHA, variables système, ou le dépôt git du build). ' +
        'Redéployer le frontend sur Vercel — tant que cette balise se tait, rien ne prouve ' +
        'quel code le site sert.',
    };
  }
  if (acceptées.includes(révision)) {
    return { ok: true, message: `révision servie = attendue (${révision.slice(0, 12)})` };
  }
  return {
    ok: false,
    message:
      `révision servie ≠ attendue : servi=${révision.slice(0, 12)} attendu=${attendu} — ` +
      "le frontend déployé n'est pas celui de main (build Vercel échoué, en file d'attente, " +
      'ou déploiement jamais déclenché).',
  };
}

/**
 * Lance git et rend son verdict, sans jamais lever.
 *
 * `spawnSync` (et un délai BORNÉ) plutôt qu'`execSync` : un `git fetch` qui
 * pendrait sur un réseau lent ne doit pas figer le garde plus longtemps que la
 * fenêtre d'attente qu'il s'est donnée.
 *
 * @param {string[]} args Arguments git.
 * @param {object} [options] `cwd`, `timeout` (ms).
 * @returns {{ok: boolean, sortie: string, erreur: string}}
 */
export function gitTexte(args, { cwd = process.cwd(), timeout = 20000 } = {}) {
  const résultat = spawnSync('git', args, { cwd, encoding: 'utf8', timeout });
  const sortie = typeof résultat.stdout === 'string' ? résultat.stdout.trim() : '';
  const erreur = typeof résultat.stderr === 'string' ? résultat.stderr.trim() : '';
  return {
    ok: résultat.status === 0,
    sortie,
    erreur: erreur || (résultat.error?.message ?? ''),
  };
}

// Révisions pour lesquelles une récupération a DÉJÀ été tentée. Sans cette
// borne, une révision absente du clone relancerait un `git fetch` à CHAQUE
// tentative du garde (neuf fois, ~25 s chacune au pire) : la fenêtre d'attente
// annoncée deviendrait fausse. Une révision ne se récupère qu'une fois.
const RECUPERATIONS_TENTEES = new Set();

/**
 * L'arbre `frontend/` d'une révision, ou la raison de son absence.
 *
 * La grandeur comparée à l'arbre PUBLIÉ par l'artefact (cf. `arbreServi`). Une
 * fusion documentaire laisse la production sur le build précédent : son SHA
 * n'est alors ni la tête de `main` ni ce que `rev-list -1 HEAD -- frontend/`
 * désigne, alors que le contenu servi est pourtant celui de `main`. L'arbre dit
 * cette égalité-là.
 *
 * Cette fonction ne sert donc plus qu'aux révisions ATTENDUES (celles de
 * `main`, nommées par l'appelant) : le commit SERVI n'est plus résolu ici, ce
 * qui est exactement ce qui a supprimé le cas « arbre incomparable ». Si même
 * un commit attendu manque au clone, une récupération BORNÉE est tentée, puis
 * la lecture est refaite ; si elle échoue encore, l'erreur le dit — on ne rend
 * jamais un arbre vide qu'un appelant confondrait avec « identique ».
 *
 * @param {string} révision SHA (ou référence) du commit.
 * @param {object} [options] `cwd`, `git` (injectable), `récupérer` (false = pas de réseau).
 * @returns {{arbre: string, erreur: string|null}}
 */
export function arbreFrontend(révision, {
  cwd = process.cwd(),
  git = gitTexte,
  récupérer = true,
} = {}) {
  const rev = normaliser(révision);
  if (rev.length < LONGUEUR_SHA_MIN) {
    return { arbre: '', erreur: `révision inutilisable (${JSON.stringify(révision)})` };
  }

  const lire = () => git(['rev-parse', '--verify', '--quiet', `${rev}:${DOSSIER_FRONTEND}`], { cwd });
  let lecture = lire();
  if (!lecture.ok && récupérer && !RECUPERATIONS_TENTEES.has(rev)) {
    RECUPERATIONS_TENTEES.add(rev);
    git(['fetch', '--no-tags', 'origin', rev], { cwd, timeout: 25000 });
    lecture = lire();
  }
  if (!lecture.ok) {
    return {
      arbre: '',
      erreur:
        `commit ${rev.slice(0, 12)} absent de ce clone (${lecture.erreur || 'git rev-parse a échoué'}) : ` +
        `impossible de lire l'arbre ${DOSSIER_FRONTEND}/ de la révision ATTENDUE. ` +
        `Correction : passer un commit présent dans ce clone, ou ` +
        `\`git fetch origin ${rev.slice(0, 12)}\` — le commit SERVI, lui, n'est plus ` +
        'lu ici depuis que le build publie son arbre.',
    };
  }

  const arbre = lecture.sortie.split(/\s+/).pop();
  if (!ARBRE_GIT.test(arbre)) {
    return {
      arbre: '',
      erreur:
        `git n'a pas rendu d'arbre pour ${rev.slice(0, 12)}:${DOSSIER_FRONTEND} ` +
        `(${JSON.stringify(lecture.sortie)})`,
    };
  }
  return { arbre, erreur: null };
}

/**
 * Le verdict : le SHA d'abord (chemin rapide, aucun appel à git), puis l'ARBRE
 * PUBLIÉ par l'artefact comparé à celui des révisions attendues.
 *
 * Ce qui est accepté, et pourquoi ce n'est pas un relâchement :
 *   • même SHA → même code, évidemment ;
 *   • SHA différent, arbre `frontend/` IDENTIQUE → aucun changement de frontend
 *     n'est absent de la production, ce qui est exactement la propriété visée.
 *     C'est le cas d'une fusion documentaire (mesuré le 21/10/2026) ;
 *   • SHA différent, arbre DIFFÉRENT → refus, en nommant les deux arbres ;
 *   • révision servie SANS arbre publié → refus (code 1) : c'est un fait de
 *     production, l'artefact précède le verdict par arbre ou a été construit
 *     hors dépôt git. Plus de prémisse ici : l'arbre servi vient du HTML, donc
 *     rien du clone n'est nécessaire pour le lire.
 *
 * La seule prémisse restante (code 2) porte sur une révision ATTENDUE dont
 * l'arbre est illisible dans ce clone — une invocation qui ne peut pas conclure,
 * pas un déploiement en retard.
 *
 * @param {string} servie Révision annoncée par la production.
 * @param {string[]} attendues Révisions acceptées.
 * @param {object} [options] `arbrePublié` (lu dans le HTML), `arbreDe` (injectable), `cwd`.
 * @returns {{ok: boolean, message: string, premisse?: boolean, parArbre?: boolean}}
 */
export function verdictDeRevision(servie, attendues = [], {
  arbrePublié = '',
  arbreDe = arbreFrontend,
  cwd = process.cwd(),
} = {}) {
  const simple = comparer(servie, attendues);
  if (simple.ok) return { ...simple, parArbre: false };

  const révision = normaliser(servie);
  // Une production MUETTE n'est pas une prémisse : c'est le refus « aucune
  // révision annoncée » (artefact antérieur, ou build sans source), et il doit
  // garder son code 1 et son message. L'arbre n'a rien à y voir.
  if (!révision) return { ...simple, parArbre: false };

  const publié = String(arbrePublié ?? '').trim().toLowerCase();
  if (!ARBRE_GIT.test(publié)) {
    return {
      ok: false,
      message:
        `le frontend servi annonce une révision (${révision.slice(0, 12)}) mais AUCUN arbre ` +
        `${DOSSIER_FRONTEND}/ (meta « ${BUILD_TREE_META} » absente ou mal formée) : ` +
        "l'artefact déployé est antérieur au verdict par arbre, ou il a été construit hors " +
        "dépôt git. Redéployer le frontend sur Vercel — comparer le SHA seul refuserait une " +
        'fusion documentaire (rouge sur un fait vrai), et ne rien comparer passerait sur du vide.',
    };
  }

  const arbres = [];
  for (const cible of attendues.map(normaliser).filter(Boolean)) {
    const lu = arbreDe(cible, { cwd });
    if (!lu?.arbre) {
      return {
        ok: false,
        premisse: true,
        message:
          `arbre ${DOSSIER_FRONTEND}/ ATTENDU illisible — prémisse (aucun verdict rendu ici) : ` +
          `${lu?.erreur || `aucun arbre pour ${cible.slice(0, 12)}`}. ` +
          "Ce n'est pas un retard de production : c'est le clone qui ne contient pas la " +
          'révision attendue (celle que `--attendu`/`--sinon` nomment).',
      };
    }
    arbres.push({ cible, arbre: lu.arbre });
  }

  const identique = arbres.find(({ arbre }) => arbre === publié);
  if (identique) {
    return {
      ok: true,
      parArbre: true,
      message:
        `révision servie ≠ attendue (servi=${révision.slice(0, 12)} attendu=${identique.cible.slice(0, 12)}) ` +
        `mais l'arbre ${DOSSIER_FRONTEND}/ publié par l'artefact est IDENTIQUE (${publié.slice(0, 12)}) : ` +
        `aucun changement de ${DOSSIER_FRONTEND}/ n'est absent de la production.`,
    };
  }

  return {
    ok: false,
    premisse: false,
    message:
      `révision servie ≠ attendue et l'arbre ${DOSSIER_FRONTEND}/ DIFFÈRE : ` +
      `servi=${révision.slice(0, 12)} (arbre ${publié.slice(0, 12)}) ` +
      `attendu=${arbres.map(({ cible, arbre }) => `${cible.slice(0, 12)} (arbre ${arbre.slice(0, 12)})`).join(' ou ')} — ` +
      "le frontend déployé n'est pas celui de main (build Vercel échoué, en file d'attente, " +
      'ou déploiement jamais déclenché).',
  };
}

/**
 * Lit la page d'accueil du site servi.
 *
 * @param {string} base Origine du site (`https://…`, sans slash final).
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @param {number} [options.timeout] Délai maximal de la requête, en ms.
 * @returns {Promise<{html: string|null, erreur: string|null, entetes: Object<string, string>}>}
 *   Jamais d'exception. `entetes` : les en-têtes datants, pour
 *   `check-retard-main.js` (cf. `entetesDatants`).
 */
export async function interroger(base, { fetchImpl = fetch, timeout = 15000 } = {}) {
  let réponse;
  try {
    réponse = await fetchImpl(`${base}/`, {
      redirect: 'follow',
      headers: PROBE_HEADERS,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    return { html: null, erreur: `${error.name || 'Error'}: ${error.message}`, entetes: {} };
  }

  const entetes = entetesDatants(réponse);

  if (!réponse.ok) {
    // Le défi de l'edge Vercel a déjà produit des rouges au hasard sur `main`
    // (403 `X-Vercel-Mitigated: challenge`, cf. resolve-vercel-url.sh) : le nommer
    // ici évite qu'il se lise comme « frontend en retard ».
    const mitigation = réponse.headers?.get?.('x-vercel-mitigated') || '';
    const suffixe = mitigation ? ` — défi de sécurité du CDN Vercel (X-Vercel-Mitigated: ${mitigation})` : '';
    return { html: null, erreur: `HTTP ${réponse.status}${suffixe}`, entetes };
  }

  const corps = await réponse.text();
  if (!/<html[\s>]/i.test(corps)) {
    return { html: null, erreur: "la réponse n'est pas du HTML (le site ne sert pas sa page d'accueil)", entetes };
  }
  return { html: corps, erreur: null, entetes };
}

/**
 * Interroge la production jusqu'à ce qu'elle annonce une révision acceptée.
 *
 * Les tentatives absorbent le déploiement en cours ; elles ne transforment pas un
 * refus en succès, elles attendent que la réponse change.
 *
 * L'arbre est lu dans CHAQUE réponse (il est publié par l'artefact, cf.
 * `arbreServi`) : un build en cours peut servir d'abord l'ancien arbre, puis le
 * bon, sans que le commit servi ait à exister dans ce clone.
 *
 * @param {object} options `base`, `attendues`, `fetchImpl`, `tentatives`, `delai`.
 * @returns {Promise<{ok: boolean, journal: string[]}>} Le verdict et chaque essai.
 */
export async function verifierServie({
  base,
  attendues = [],
  fetchImpl = fetch,
  tentatives = 9,
  delai = 20,
  dormir = (ms) => new Promise((r) => setTimeout(r, ms * 1000)),
  log = console.log,
  interrogerImpl = interroger,
  arbreDe = arbreFrontend,
  cwd = process.cwd(),
  deploiement = optionsVercel(),
  etatDeploiement = etatDeploiementProduction,
} = {}) {
  const journal = [];
  let dernier = null;
  const total = Math.max(1, Number(tentatives) || 1);
  for (let tentative = 1; tentative <= total; tentative += 1) {
    const { html, erreur } = await interrogerImpl(base, { fetchImpl });
    const verdict = html === null
      ? {
        ok: false,
        message: `aucune réponse exploitable de ${base} : ${erreur} — rien ne peut être affirmé sur le déploiement.`,
      }
      : verdictDeRevision(revisionServie(html), attendues, {
        arbrePublié: arbreServi(html),
        arbreDe,
        cwd,
      });
    dernier = verdict;
    journal.push(`tentative ${tentative}/${total} : ${verdict.message}`);
    log(`  ${journal[journal.length - 1]}`);
    if (verdict.ok) return { ok: true, journal, premisse: false, parArbre: Boolean(verdict.parArbre) };
    if (tentative < total) await dormir(delai);
  }
  // La fenêtre est épuisée : le refus est vrai, mais sa CAUSE ne l'est pas
  // encore. L'API Vercel dit si un déploiement de cette révision est en vol
  // (prémisse, donc aucun verdict), en échec, ou absent — trois corrections
  // différentes que le message du garde ne pouvait pas distinguer seul.
  const qualifié = await qualifierRefus(dernier, attendues, {
    deploiement,
    etatDeploiement,
    fetchImpl,
  });
  return {
    ok: false,
    journal,
    premisse: Boolean(qualifié?.premisse),
    motif: String(qualifié?.message ?? ''),
  };
}

/**
 * @param {object} [options]
 * @param {string} [options.base] Site interrogé (défaut `SITE_ORIGIN`).
 * @returns {{ok: boolean, erreur: string|null}} `erreur` : le refus d'invoquer.
 */
export function baseAutorisée(base) {
  const propre = String(base ?? '').trim().replace(/\/+$/, '');
  if (!propre) return { ok: false, erreur: 'aucune base à interroger' };
  if (isLoopbackUrl(propre)) {
    return {
      ok: false,
      erreur:
        `base locale (${propre}) : ce garde mesure la PRODUCTION (ce que Vercel sert) ; ` +
        "un build de poste ne dit rien de la révision déployée.",
    };
  }
  return { ok: true, erreur: null };
}

/**
 * Lit les options de la ligne de commande, sans jamais conclure sur du vide.
 *
 * @param {string[]} argv Arguments (sans `node`/le script).
 * @returns {{base: string, attendues: string[], tentatives: number, delai: number}}
 */
export function lireOptions(argv = []) {
  const valeurDe = (nom) => {
    const index = argv.indexOf(nom);
    return index === -1 ? '' : String(argv[index + 1] ?? '');
  };
  const nombreDe = (nom, défaut) => {
    const brut = valeurDe(nom);
    return brut ? Number(brut) : défaut;
  };
  const { valides, invalides } = revisionsAttendues([valeurDe('--attendu'), valeurDe('--sinon')]);
  if (invalides.length) {
    throw new Error(
      `--attendu/--sinon ne sont pas des identifiants de commit (${invalides
        .map((v) => JSON.stringify(v))
        .join(', ')}) : ce garde compare la révision et l\'arbre SERVIS à des commits ` +
        'attendus, il ne peut pas conclure sans eux.'
    );
  }
  if (valides.length === 0) {
    throw new Error(
      '--attendu manquant : passer le commit poussé (et `--sinon` le dernier commit ayant ' +
        'touché frontend/) — sans quoi rien ne dit à quoi comparer la production.'
    );
  }
  return {
    base: valeurDe('--base') || SITE_ORIGIN,
    attendues: valides,
    tentatives: nombreDe('--tentatives', 9),
    delai: nombreDe('--delai', 20),
  };
}

export async function main(argv = process.argv.slice(2), { verifier = verifierServie } = {}) {
  let options;
  try {
    options = lireOptions(argv);
  } catch (error) {
    console.error(`::error title=Frontend servi — invocation impossible::${error.message}`);
    return 2;
  }

  const base = baseAutorisée(options.base);
  if (!base.ok) {
    console.error(`::error title=Frontend servi — invocation impossible::${base.erreur}`);
    return 2;
  }

  console.log(`Révisions acceptées : ${options.attendues.map((r) => r.slice(0, 12)).join(' ou ')}`);
  console.log(`Interrogation de ${options.base}/…`);
  // Le VÉRIFICATEUR est injectable comme `arbreDe`/`fetchImpl` le sont plus bas :
  // le verdict de prémisse ne se fabrique pas depuis la production réelle (il
  // faut une révision servie ET un commit attendu ABSENT de ce clone), donc sans
  // cette couture le CODE 2 — la prémisse TOLÉRÉE, qui ne doit pas accuser le
  // déploiement — ne serait nommé par aucun cas, et un `return 1` posé là
  // passerait la suite entière sans qu'un test bronche.
  const { ok, journal, premisse, motif } = await verifier(options);
  if (ok) {
    console.log(
      `::notice title=Frontend servi::${journal[journal.length - 1]} — le site sert bien un ` +
        'artefact construit depuis main.'
    );
    return 0;
  }

  // `motif` porte la qualification du refus (état du déploiement Vercel) ; le
  // journal, lui, garde chaque tentative, sans quoi un rejeu perdrait l'heure
  // à laquelle chaque essai a eu lieu.
  const dernier = motif || journal[journal.length - 1] || 'aucune tentative';
  if (premisse) {
    // Deux prémisses, deux titres : un déploiement EN VOL (Vercel travaille) et
    // un CLONE qui ne contient pas la révision attendue ne se réparent pas au
    // même endroit. Le code 2 est le même — c'est le fait que la CI et
    // `livrer.py` doivent lire comme « aucun verdict », pas comme un retard.
    if (/est en (QUEUED|BUILDING|INITIALIZING)/.test(dernier)) {
      console.log(`::warning title=Déploiement Vercel en file::${dernier}`);
    } else {
      console.log(`::error title=Arbre attendu illisible::${dernier}`);
    }
    return 2;
  }
  if (dernier.includes('AUCUNE révision')) {
    console.log(`::error title=Révision du frontend non annoncée::${dernier}`);
  } else if (dernier.includes('AUCUN arbre')) {
    console.log(`::error title=Arbre du frontend non annoncé::${dernier}`);
  } else if (dernier.includes('aucune réponse exploitable')) {
    console.log(`::error title=Frontend injoignable::${dernier}`);
  } else {
    console.log(`::error title=Révision du frontend ≠ attendue::${dernier}`);
  }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
