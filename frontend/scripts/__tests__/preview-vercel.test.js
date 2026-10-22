/**
 * @vitest-environment node
 *
 * Garde-fou de la résolution de PREVIEW (scripts/preview-vercel.js).
 *
 * ── Ce que ce test empêche ─────────────────────────────────────────────────
 * La sonde d'actifs ne juge plus seulement `main` : sur une PR, elle doit lire
 * le déploiement Vercel de LA RÉVISION poussée, avant fusion. Trois faux verts
 * sont possibles si la résolution se trompe, et ce fichier les refuse :
 *   1. rendre un déploiement d'une AUTRE révision (le commentaire de la PR peut
 *      être périmé) — la chaîne serait cohérente sur un artefact qui n'est pas
 *      celui qu'on fusionne ;
 *   2. rendre un déploiement de PRODUCTION, ou un déploiement sans
 *      `meta.githubCommitSha` (rien ne prouve alors à quelle révision il
 *      appartient) ;
 *   3. transformer une absence (jeton, API, fenêtre d'attente) en verdict : ce
 *      sont des PRÉMISSES, jamais un vert et jamais un rouge du code de la PR.
 * Aucun réseau : le transport est fabriqué, et les cas d'échec sont joués.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  BYPASS_ENV,
  BYPASS_HEADER,
  MARQUE_PREMISSE,
  REVISION,
  TENTATIVES_DEFAUT,
  resoudrePreview,
} from '../preview-vercel.js';
import { BYPASS_ENV as ENV_SESSION, BYPASS_HEADER as HEADER_SESSION } from '../check-session-reload-production.js';
import { BYPASS_ENV as ENV_SSE, BYPASS_HEADER as HEADER_SSE } from '../check-sse-proxy-production.js';

const SHA = 'b'.repeat(40);
const AUTRE = 'c'.repeat(40);

/** Une réponse minimale, lue par `vercelApi` (`ok`, `status`, `text`). */
function réponse(statut, charge) {
  return {
    ok: statut >= 200 && statut < 300,
    status: statut,
    text: async () => JSON.stringify(charge),
  };
}

/**
 * Un transport Vercel fabriqué.
 *
 * `déploiements` peut être une fonction : elle reçoit le numéro de la lecture
 * des déploiements et permet de jouer « BUILDING, puis READY ».
 */
function transport({ déploiements = [], statut = 200, panne = '' } = {}) {
  const appels = [];
  let lectures = 0;
  const fetchImpl = vi.fn(async (url) => {
    const adresse = new URL(url);
    appels.push(adresse);
    if (panne) throw new Error(panne);
    if (adresse.pathname === '/v7/deployments') {
      lectures += 1;
      if (statut !== 200) return réponse(statut, { error: { message: 'forbidden' } });
      const liste = typeof déploiements === 'function' ? déploiements(lectures) : déploiements;
      return réponse(200, { deployments: liste });
    }
    return réponse(404, { error: { message: 'route inconnue' } });
  });
  return { fetchImpl, appels, lectures: () => lectures };
}

/** Un déploiement Vercel, tel que l'API le rend. */
function déploiement({ sha = SHA, état = 'READY', url = 'kj-preview-abc.vercel.app', target = null, meta = true, message = '' } = {}) {
  return {
    uid: `dpl_${url}`,
    url,
    readyState: état,
    target,
    meta: meta ? { githubCommitSha: sha } : {},
    errorMessage: message,
  };
}

describe('preview-vercel — la preview de CETTE révision, jamais une autre', () => {
  it('rend l’URL d’un déploiement READY de la révision, en filtrant sur le commit', async () => {
    const site = transport({
      déploiements: [
        déploiement({ sha: AUTRE }), // une autre PR, READY : ne doit jamais être rendue
        déploiement({ sha: SHA, url: 'kj-pr-42.vercel.app' }),
      ],
    });
    const résolution = await resoudrePreview({ sha: SHA, token: 'vcp_jeton', fetchImpl: site.fetchImpl });

    expect(résolution.ok).toBe(true);
    expect(résolution.premisse).toBe(false);
    expect(résolution.url).toBe('https://kj-pr-42.vercel.app');
    expect(résolution.revision).toBe(SHA);
    // Le filtre est posé sur la REQUÊTE : l'API ne renvoie que la révision
    // demandée, et la vérification locale ne fait que confirmer.
    const liste = site.appels.find((a) => a.pathname === '/v7/deployments');
    expect(liste.searchParams.get('sha')).toBe(SHA);
    // Le NOM du projet suffit : `projectId` l'accepte, donc aucun appel de
    // résolution préalable ne peut échouer en chemin.
    expect(liste.searchParams.get('projectId')).toBe('kj-update-fevrier');
  });

  it('attend qu’un déploiement en construction passe READY, sans rendre un état intermédiaire', async () => {
    const attendre = vi.fn(async () => {});
    const site = transport({
      déploiements: (lecture) =>
        lecture === 1
          ? [déploiement({ état: 'BUILDING' })]
          : [déploiement({ état: 'READY', url: 'kj-pret.vercel.app' })],
    });
    const résolution = await resoudrePreview({
      sha: SHA,
      token: 'vcp_jeton',
      fetchImpl: site.fetchImpl,
      tentatives: 3,
      delaiMs: 15000,
      attendre,
    });

    expect(résolution.ok).toBe(true);
    expect(résolution.url).toBe('https://kj-pret.vercel.app');
    expect(résolution.tentatives).toBe(2);
    expect(attendre).toHaveBeenCalledTimes(1);
    expect(attendre).toHaveBeenCalledWith(15000);
  });

  it('ignore un déploiement de PRODUCTION, même pour le bon commit', async () => {
    const site = transport({
      déploiements: [déploiement({ target: 'production', url: 'kojoforafrica.cc.cd' })],
    });
    const résolution = await resoudrePreview({ sha: SHA, token: 'vcp_jeton', fetchImpl: site.fetchImpl, tentatives: 1 });

    expect(résolution.ok).toBe(false);
    expect(résolution.premisse).toBe(true);
    expect(résolution.url).toBe('');
  });

  it('ignore un déploiement sans meta.githubCommitSha : il ne prouve pas sa révision', async () => {
    const site = transport({ déploiements: [déploiement({ meta: false })] });
    const résolution = await resoudrePreview({ sha: SHA, token: 'vcp_jeton', fetchImpl: site.fetchImpl, tentatives: 1 });

    expect(résolution.ok).toBe(false);
    expect(résolution.premisse).toBe(true);
    // Le motif DIT pourquoi : sans cette distinction, un champ de révision
    // mal nommé se lirait « pas encore prêt » pour toujours.
    expect(résolution.motif).toContain('aucun ne porte');
    expect(résolution.motif).toContain('meta.githubCommitSha');
  });
});

describe('preview-vercel — une absence est une prémisse, un build en échec est un refus', () => {
  it('prémisse sans jeton Vercel, SANS toucher au réseau', async () => {
    const site = transport();
    const résolution = await resoudrePreview({ sha: SHA, token: '', fetchImpl: site.fetchImpl });

    expect(résolution.ok).toBe(false);
    expect(résolution.premisse).toBe(true);
    expect(résolution.motif).toContain('VERCEL_TOKEN');
    expect(site.fetchImpl).not.toHaveBeenCalled();
  });

  it('prémisse pour une révision illisible, sans réseau non plus', async () => {
    const site = transport();
    const résolution = await resoudrePreview({ sha: 'pas-un-sha', token: 'vcp_jeton', fetchImpl: site.fetchImpl });

    expect(résolution.ok).toBe(false);
    expect(résolution.premisse).toBe(true);
    expect(résolution.motif).toContain('illisible');
    expect(site.fetchImpl).not.toHaveBeenCalled();
  });

  it('prémisse quand aucun déploiement de la révision n’apparaît dans la fenêtre', async () => {
    const attendre = vi.fn(async () => {});
    const site = transport({ déploiements: [] });
    const résolution = await resoudrePreview({
      sha: SHA,
      token: 'vcp_jeton',
      fetchImpl: site.fetchImpl,
      tentatives: 2,
      delaiMs: 1000,
      attendre,
    });

    expect(résolution.ok).toBe(false);
    expect(résolution.premisse).toBe(true);
    expect(résolution.motif).toContain('après 2 tentative(s)');
    expect(site.lectures()).toBe(2);
    expect(attendre).toHaveBeenCalledTimes(1);
  });

  it('prémisse quand l’API Vercel est illisible (401) : rien n’est affirmé sur la PR', async () => {
    const site = transport({ statut: 401 });
    const résolution = await resoudrePreview({ sha: SHA, token: 'vcp_jeton', fetchImpl: site.fetchImpl });

    expect(résolution.ok).toBe(false);
    expect(résolution.premisse).toBe(true);
    expect(résolution.motif).toContain('illisible');
    expect(résolution.motif).toContain('401');
  });

  it('REFUSE (pas une prémisse) un déploiement de la révision en ERROR, en nommant le build', async () => {
    const site = transport({
      déploiements: [déploiement({ état: 'ERROR', message: 'Command "npm run build" exited with 1' })],
    });
    const résolution = await resoudrePreview({ sha: SHA, token: 'vcp_jeton', fetchImpl: site.fetchImpl });

    expect(résolution.ok).toBe(false);
    expect(résolution.premisse).toBe(false);
    expect(résolution.motif).toContain('ERROR');
    expect(résolution.motif).toContain('npm run build');
    // Un build en échec ne s'arrange pas en attendant : une seule lecture.
    expect(site.lectures()).toBe(1);
  });
});

describe('preview-vercel — constantes partagées', () => {
  it('les trois sondes nomment le contournement Vercel de la MÊME façon', () => {
    // Le nom est celui de la convention Vercel ; une deuxième orthographe ferait
    // chercher un secret qui existe sous un autre nom, et la preview protégée
    // resterait illisible sans que personne ne sache pourquoi.
    expect(BYPASS_ENV).toBe(ENV_SESSION);
    expect(BYPASS_ENV).toBe(ENV_SSE);
    expect(BYPASS_HEADER).toBe(HEADER_SESSION);
    expect(BYPASS_HEADER).toBe(HEADER_SSE);
    expect(BYPASS_HEADER).toBe('x-vercel-protection-bypass');
    expect(MARQUE_PREMISSE).toContain('aucun verdict');
    expect(REVISION.test(SHA)).toBe(true);
    expect(REVISION.test('abc')).toBe(false);
    expect(TENTATIVES_DEFAUT).toBeGreaterThan(1);
  });
});
