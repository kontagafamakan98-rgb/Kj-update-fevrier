/**
 * L'URL du déploiement de PREVIEW d'une révision — et rien d'autre.
 *
 * ── Pourquoi ce module ──────────────────────────────────────────────────────
 * La sonde d'actifs savait juger une origine (`--base`) mais aucun appelant ne
 * lui DONNAIT celle d'une PR : la CI ne jugeait la chaîne HTML → manifeste →
 * octets que sur `main`, après fusion. Un artefact de PR n'était donc vérifié
 * par personne avant d'être fusionné — et le jour où il l'est, c'est en
 * production que l'écart se découvre.
 *
 * ── Pourquoi l'API Vercel, et pas le commentaire de l'app Vercel ────────────
 * Le commentaire de la PR dit « voici une preview de cette PR » : il peut
 * désigner le déploiement d'un commit PRÉCÉDENT (l'app le met à jour, mais rien
 * ne garantit qu'elle l'a déjà fait), et une chaîne interne cohérente sur un
 * artefact périmé rendrait un vert sur le mauvais objet. La question posée est
 * celle de CE commit, donc elle se filtre sur lui : `sha=<révision>`.
 * `resolve-vercel-url.sh` continue de lire le commentaire pour Lighthouse, qui a
 * un autre besoin (une origine interrogeable SANS jeton, avec repli local quand
 * la preview est protégée). Ici le besoin est l'inverse : la révision exacte, et
 * la protection se franchit par le jeton d'automatisation.
 *
 * ── Ce que ce module refuse de confondre ────────────────────────────────────
 *   • PRÉMISSE (aucun verdict) : jeton absent, API illisible, aucun déploiement
 *     de cette révision après la fenêtre d'attente, déploiement sans
 *     `meta.githubCommitSha`. Rien de tout cela ne décrit le code de la PR.
 *   • REFUS : un déploiement de cette révision est en `ERROR` ou `CANCELED` —
 *     l'artefact de la PR n'existe pas, il n'y a rien à juger et c'est un fait
 *     sur la PR, pas sur l'outillage.
 * Le code de sortie n'est pas décidé ici (le module ne sort pas) : il rend
 * `{ ok, premisse, url, motif }` et l'appelant nomme le sien.
 *
 * ── Fenêtre d'attente ───────────────────────────────────────────────────────
 * Vercel met 0,4 à 0,6 min par déploiement de production (mesuré le 08/10/2026) ;
 * une preview attend souvent un build de PR plus lourd. `tentatives × delaiMs`
 * (12 × 15 s ≈ 3 min par défaut) absorbe ce délai sans jamais transformer une
 * absence en vert : au bout de la fenêtre, le module rend une PRÉMISSE nommée.
 */

const API = 'https://api.vercel.com';

/** Le projet dont on résout les previews, quand l'environnement ne le dit pas. */
export const PROJET_DEFAUT = 'kj-update-fevrier';

/**
 * Jeton de contournement de la Protection de déploiement Vercel.
 *
 * Les MÊMES noms que `check-session-reload-production.js` et
 * `check-sse-proxy-production.js` : c'est la convention Vercel, et une deuxième
 * orthographe ferait chercher un secret qui existe sous un autre nom.
 */
export const BYPASS_ENV = 'VERCEL_AUTOMATION_BYPASS_SECRET';
export const BYPASS_HEADER = 'x-vercel-protection-bypass';

/** La marque d'une prémisse, celle des autres sondes de production. */
export const MARQUE_PREMISSE = 'prémisse (aucun verdict rendu ici)';

/** Un identifiant de commit : celui que Vercel accepte dans `sha`. */
export const REVISION = /^[0-9a-f]{7,40}$/i;

export const TENTATIVES_DEFAUT = 12;
export const DELAI_DEFAUT_MS = 15000;

/** États d'un déploiement Vercel qui ne bougeront plus, et qui comptent tous deux. */
export const ETATS_ECHEC = new Set(['ERROR', 'CANCELED']);

const dormir = (ms) => new Promise((résoudre) => setTimeout(résoudre, ms));

/**
 * Un appel REST Vercel. Lève avec le message de l'API : l'appelant décide si
 * c'est une prémisse (outillage) ou un refus (artefact).
 *
 * @param {string} route Chemin et requête (`/v6/deployments?…`).
 * @param {object} options `token`, `teamId`, `fetchImpl`, `timeout`.
 * @returns {Promise<object>} Charge utile JSON.
 */
export async function vercelApi(route, { token, teamId = '', fetchImpl = fetch, timeout = 20000 } = {}) {
  const url = new URL(API + route);
  if (teamId) url.searchParams.set('teamId', teamId);
  const réponse = await fetchImpl(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(timeout),
  });
  const texte = await réponse.text();
  let charge = null;
  try {
    charge = JSON.parse(texte);
  } catch (_error) {
    // Réponse non JSON : le texte brut sert de diagnostic, jamais de verdict.
  }
  if (!réponse.ok) {
    const détail = charge?.error?.message || texte.slice(0, 200) || 'sans corps';
    throw new Error(`${route} → HTTP ${réponse.status} : ${détail}`);
  }
  return charge;
}

/** Le déploiement est-il bien celui de la RÉVISION demandée ? */
const duCommit = (déploiement, revision) =>
  String(déploiement?.meta?.githubCommitSha ?? '').trim().toLowerCase() === revision;

/** Un déploiement de PRODUCTION n'est pas une preview, même pour le bon commit. */
const estPreview = (déploiement) => déploiement?.target !== 'production';

/**
 * Résout l'URL de la preview d'une révision, en attendant qu'elle soit prête.
 *
 * @param {object} options
 * @param {string} options.sha      Révision attendue (tête de la PR).
 * @param {string} options.token    Jeton Vercel (`VERCEL_TOKEN`).
 * @param {string} [options.teamId] Équipe Vercel, si le projet n'est pas au compte.
 * @param {string} [options.projet] Nom du projet (`VERCEL_PROJECT_NAME`).
 * @param {Function} [options.fetchImpl] Transport injectable (aucun réseau en test).
 * @param {number} [options.tentatives] Fenêtre d'attente, en tentatives.
 * @param {number} [options.delaiMs]   Délai entre deux tentatives.
 * @param {Function} [options.attendre] Attente injectable.
 * @param {Function} [options.onMesure] Relevé d'une tentative (journal).
 * @returns {Promise<{ok: boolean, premisse: boolean, url: string, motif: string,
 *   revision: string, id: string, tentatives: number}>} Jamais d'exception.
 */
export async function resoudrePreview({
  sha,
  token,
  teamId = '',
  projet = PROJET_DEFAUT,
  fetchImpl = fetch,
  tentatives = TENTATIVES_DEFAUT,
  delaiMs = DELAI_DEFAUT_MS,
  attendre = dormir,
  onMesure = () => {},
} = {}) {
  const revision = String(sha ?? '').trim().toLowerCase();
  const sans = (motif) => ({ ok: false, premisse: true, url: '', motif, revision, id: '', tentatives: 0 });

  if (!REVISION.test(revision)) {
    return sans(
      `révision « ${sha ?? ''} » illisible : la preview se résout pour un identifiant de ` +
        'commit, jamais pour une chaîne quelconque (sinon la sonde jugerait un déploiement ' +
        'dont elle ne peut pas dire à quelle révision il appartient).'
    );
  }
  const jeton = String(token ?? '').trim();
  if (!jeton) {
    return sans(
      `jeton Vercel absent (VERCEL_TOKEN) : l'URL de la preview de ${revision.slice(0, 12)} ` +
        "ne peut pas être résolue sans lui. Aucun verdict sur l'artefact de cette PR n'est rendu."
    );
  }

  let dernier = null;
  let vus = 0;
  let sansCommit = 0;
  for (let tentative = 1; tentative <= Math.max(1, tentatives); tentative += 1) {
    let liste;
    try {
      // `projectId` accepte le NOM du projet (documentation Vercel) : pas besoin
      // d'une lecture de projet préalable, donc un appel de moins à échouer.
      liste = await vercelApi(
        `/v7/deployments?projectId=${encodeURIComponent(projet)}&sha=${revision}&limit=20`,
        { token: jeton, teamId, fetchImpl }
      );
    } catch (error) {
      return sans(`déploiements de ${revision.slice(0, 12)} illisibles (${error.message}).`);
    }
    const déploiements = Array.isArray(liste?.deployments) ? liste.deployments : [];
    const candidats = déploiements.filter((d) => d && estPreview(d) && duCommit(d, revision));
    vus = candidats.length;
    sansCommit = déploiements.filter((d) => d && estPreview(d) && !duCommit(d, revision)).length;

    const prêts = candidats.filter((d) => d.readyState === 'READY' && d.url);
    if (prêts.length > 0) {
      const retenu = prêts[0];
      const id = String(retenu.uid || retenu.id || '');
      return {
        ok: true,
        premisse: false,
        url: `https://${String(retenu.url).replace(/^https?:\/\//, '').replace(/\/+$/, '')}`,
        motif:
          `déploiement ${id || '(sans identifiant)'} READY pour ${revision.slice(0, 12)} ` +
          `(tentative ${tentative}/${tentatives})`,
        revision,
        id,
        tentatives: tentative,
      };
    }

    const échoués = candidats.filter((d) => ETATS_ECHEC.has(String(d.readyState)));
    if (échoués.length > 0) {
      const échec = échoués[0];
      return {
        ok: false,
        premisse: false,
        url: '',
        motif:
          `le déploiement de ${revision.slice(0, 12)} est en ${échec.readyState}` +
          `${échec.errorMessage ? ` (« ${String(échec.errorMessage).slice(0, 200)} »)` : ''} : ` +
          "l'artefact de cette PR n'existe pas, il n'y a rien à ancrer. Corriger le build " +
          'Vercel de la PR, puis relancer.',
        revision,
        id: String(échec.uid || échec.id || ''),
        tentatives: tentative,
      };
    }

    dernier = candidats[0] ?? null;
    onMesure({ tentative, candidats: vus, état: dernier?.readyState ?? 'aucun déploiement' });
    if (tentative < tentatives) await attendre(delaiMs);
  }

  // Le cas silencieux qu'il ne faut pas laisser passer : des déploiements sont
  // rendus, mais AUCUN ne porte `meta.githubCommitSha`. C'est un fait sur
  // l'outillage (ou sur le nom du champ), pas sur l'artefact — et le taire
  // ferait lire « pas encore prêt » à une sonde qui ne peut rien reconnaître.
  if (vus === 0 && sansCommit > 0) {
    return sans(
      `${sansCommit} déploiement(s) rendu(s) pour ${revision.slice(0, 12)} mais aucun ne porte ` +
        '`meta.githubCommitSha` : la révision servie ne peut pas être prouvée, donc aucune ' +
        "preview ne lui est attribuée. Rien n'est affirmé sur l'artefact de cette PR."
    );
  }

  return sans(
    `aucun déploiement READY pour ${revision.slice(0, 12)} après ${Math.max(1, tentatives)} ` +
      `tentative(s) sur ${delaiMs} ms (dernier état : ${dernier?.readyState ?? 'aucun déploiement'}). ` +
      "Rien ne dit que l'artefact de la PR est mauvais — il n'est pas encore là."
  );
}
