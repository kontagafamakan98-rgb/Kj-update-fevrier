/**
 * Preuve d'échec de `frontend/scripts/check-csp-documents-production.js`.
 *
 * La sonde juge un fait que rien d'autre ne voit : la politique que le SITE sert
 * et celle que les DOCUMENTS pré-rendus servent peuvent diverger sans qu'aucun
 * test hors ligne ne le sache (les deux côtés lisent des environnements
 * différents). Chaque refus de la sonde a donc son scénario ici — page témoin
 * muette, document muet, directive en écart, ordre différent, prémisse —, avec
 * un `fetch` doublure : aucun réseau n'est touché.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  FAMILLE,
  MARQUE_PREMISSE,
  PAGE_REFERENCE,
  REMEDE_ENV,
  TITRE_ERREUR,
  jugerDocument,
  libelleSonde,
  main,
  parseArguments,
  runCspDocumentsProbe,
} from '../check-csp-documents-production.js';
import { cspDeDocument } from '../csp-document.js';

const BASE = 'https://kojo-csp.test';
const ID_FICHE = 'mission-csp';
const ID_PROFIL = 'travailleur-csp';

/** La politique de référence — GA actif, comme la production mesurée. */
const POLITIQUE = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://res.cloudinary.com https://tile.openstreetmap.org https://www.google-analytics.com",
  "connect-src 'self' https://api.kojo.test https://accounts.google.com https://www.google-analytics.com https://region1.google-analytics.com",
  "frame-src 'self' https://www.google.com https://www.openstreetmap.org https://accounts.google.com",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
].join('; ');

/** Un document HTML qui publie `csp` dans une meta, ou AUCUNE si `csp` est vide. */
const document = (csp, { entetes = '"' } = {}) => {
  if (!csp) return '<!DOCTYPE html><html><head><title>t</title></head><body></body></html>';
  const valeur = csp.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return (
    '<!DOCTYPE html><html><head>' +
    `<meta http-equiv="Content-Security-Policy" content=${entetes}${valeur}${entetes} />` +
    '<title>t</title></head><body></body></html>'
  );
};

const SITEMAP = (chemins) =>
  '<?xml version="1.0"?><urlset>' +
  chemins.map((chemin) => `<url><loc>https://kojo-csp.test${chemin}</loc></url>`).join('') +
  '</urlset>';

/**
 * Un `fetch` doublure : chaque route rend `{status, body}`, et les appels sont
 * journalisés — pour vérifier ce que la sonde a demandé, pas seulement ce
 * qu'elle a conclu.
 *
 * @param {Record<string, {status?: number, body?: string} | null>} routes
 *   `null` = la requête échoue (réseau).
 */
function fetchFactice(routes) {
  const appels = [];
  const impl = async (url) => {
    const chemin = new URL(String(url)).pathname;
    appels.push(chemin);
    const route = routes[chemin];
    if (route === null) throw new Error('net::ERR_CONNECTION_REFUSED');
    if (!route) return { status: 404, text: async () => '' };
    return { status: route.status ?? 200, text: async () => route.body ?? '' };
  };
  return { impl, appels };
}

/** Les routes d'un scénario conforme, surchargeables une à une. */
const routesConformes = (overrides = {}) => ({
  '/': { body: document(POLITIQUE) },
  '/sitemap.xml': { body: SITEMAP([`/jobs/${ID_FICHE}`, `/workers/${ID_PROFIL}`]) },
  [`/jobs/${ID_FICHE}`]: { body: document(POLITIQUE) },
  [`/workers/${ID_PROFIL}`]: { body: document(POLITIQUE) },
  ...overrides,
});

const sonder = async (overrides = {}) => {
  const { impl, appels } = fetchFactice(routesConformes(overrides));
  const result = await runCspDocumentsProbe({ base: BASE, quiet: true, fetchImpl: impl });
  return { result, appels };
};

describe('csp documents — la politique du site est la référence', () => {
  it('compare la page témoin puis les deux documents servis', async () => {
    const { result, appels } = await sonder();

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.politique).toBe(POLITIQUE);
    expect(appels).toEqual([
      PAGE_REFERENCE,
      '/sitemap.xml',
      '/sitemap.xml',
      `/jobs/${ID_FICHE}`,
      `/workers/${ID_PROFIL}`,
    ]);
    const publie = result.checked.join('\n');
    expect(publie).toContain('politique du site lue');
    expect(publie).toContain("sans frame-ancestors");
    expect(publie).toContain(`/jobs/:id (${BASE}/jobs/${ID_FICHE})`);
    expect(publie).toContain(`/workers/:id (${BASE}/workers/${ID_PROFIL})`);
  });

  it('refuse une page témoin MUETTE au lieu de comparer à du vide', async () => {
    const { result } = await sonder({ '/': { body: document('') } });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('ne publie AUCUNE CSP');
    expect(result.errors[0]).toContain('inject-production-csp');
    expect(result.errors[0]).toContain('page témoin');
    // Rien n'a été comparé : la page a bien été LUE (et publiée), aucun document
    // n'a été demandé.
    expect(result.pages).toEqual([`${BASE}${PAGE_REFERENCE}`]);
  });

  it('refuse une page témoin qui ne répond pas 200', async () => {
    const { result } = await sonder({ '/': { status: 503, body: '' } });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('HTTP 503');
    expect(result.errors[0]).toContain('--reference');
  });

  it('refuse une page témoin injoignable, en nommant le réseau', async () => {
    const { result } = await sonder({ '/': null });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("n'a pas pu être lue");
    expect(result.errors[0]).toContain('ERR_CONNECTION_REFUSED');
  });
});

describe('csp documents — le document jugé', () => {
  it('refuse une fiche qui ne publie AUCUNE meta CSP', async () => {
    const { result } = await sonder({ [`/jobs/${ID_FICHE}`]: { body: document('') } });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('/jobs/:id');
    expect(result.errors[0]).toContain('ne publie AUCUNE meta CSP');
    expect(result.errors[0]).toContain('balise_csp');
    // Le profil, lui, reste conforme : le défaut est LOCALISÉ.
    expect(result.checked.join('\n')).toContain('/workers/:id');
  });

  it('refuse une politique qui DIVERGE, en nommant la directive en écart', async () => {
    const sansGa = POLITIQUE.replace(' https://www.googletagmanager.com', '');
    const { result } = await sonder({ [`/workers/${ID_PROFIL}`]: { body: document(sansGa) } });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('/workers/:id');
    expect(result.errors[0]).toContain('script-src');
    expect(result.errors[0]).toContain('googletagmanager');
    expect(result.errors[0]).toContain(REMEDE_ENV);
    expect(result.errors[0]).toContain('GA_MEASUREMENT_ID');
  });

  it('refuse une source AUTORISÉE EN PLUS par le document', async () => {
    const plusPermissif = POLITIQUE.replace(
      "script-src 'self'",
      "script-src 'self' https://cdn.pirate.test"
    );
    const { result } = await sonder({ [`/jobs/${ID_FICHE}`]: { body: document(plusPermissif) } });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("autorise en plus https://cdn.pirate.test");
  });

  it('refuse les mêmes directives dans un AUTRE ORDRE (ce ne sont pas les mêmes octets)', async () => {
    const morceaux = POLITIQUE.split('; ');
    const reordonnee = [morceaux[0], morceaux[1], ...morceaux.slice(2).reverse()].join('; ');
    const { result } = await sonder({ [`/workers/${ID_PROFIL}`]: { body: document(reordonnee) } });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('la politique n’est pas la MÊME CHAÎNE');
  });

  it('refuse un document qui ne répond pas 200 (réécriture perdue)', async () => {
    const { result } = await sonder({ [`/jobs/${ID_FICHE}`]: { status: 404, body: '' } });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('HTTP 404');
    expect(result.errors[0]).toContain('réécriture Vercel');
  });

  it('refuse un document injoignable', async () => {
    const { result } = await sonder({ [`/workers/${ID_PROFIL}`]: null });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("n'a pas pu être lu");
  });
});

describe('csp documents — prémisse et périmètre', () => {
  it('rend une PRÉMISSE quand le sitemap ne porte aucun document à comparer', async () => {
    const { result, appels } = await sonder({ '/sitemap.xml': { body: SITEMAP(['/']) } });

    expect(result.premisse).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.notices.join('\n')).toContain(MARQUE_PREMISSE);
    expect(result.notices.join('\n')).toContain('aucun document pré-rendu');
    // Aucun document n'a été demandé : rien n'a été jugé.
    expect(appels).toEqual([PAGE_REFERENCE, '/sitemap.xml', '/sitemap.xml']);
  });

  it('mesure la fiche seule quand aucun profil n’est publié, et le DIT', async () => {
    const { result } = await sonder({
      '/sitemap.xml': { body: SITEMAP([`/jobs/${ID_FICHE}`]) },
    });

    expect(result.ok).toBe(true);
    expect(result.premisse).toBe(false);
    expect(result.notices.join('\n')).toContain('aucun profil /workers/:id');
    expect(result.checked.join('\n')).toContain('/jobs/:id');
    expect(result.checked.join('\n')).not.toContain('/workers/:id');
  });

  it('refuse un sitemap illisible au lieu de conclure', async () => {
    const { result } = await sonder({ '/sitemap.xml': { status: 502, body: '' } });

    expect(result.ok).toBe(false);
    expect(result.premisse).toBe(false);
    expect(result.errors.join('\n')).toContain('sitemap');
    expect(result.errors.join('\n')).toContain('502');
  });
});

describe('csp documents — la comparaison pure', () => {
  it('ne trouve aucun écart entre deux politiques identiques', () => {
    expect(jugerDocument({ nom: '/jobs/:id', url: 'u', attendue: POLITIQUE, html: document(POLITIQUE) })).toEqual([]);
  });

  it('décode l’échappement du backend sans changer la politique', () => {
    // `kojo_csp` n'échappe que `&`, `<`, `>` et `"` : une politique avec
    // apostrophes doit se relire IDENTIQUE après décodage.
    expect(cspDeDocument(document(POLITIQUE))).toBe(POLITIQUE);
  });

  it('distingue une balise absente d’une balise vide', () => {
    expect(cspDeDocument(document(''))).toBe('');
    expect(cspDeDocument('<meta http-equiv="Content-Security-Policy" content="" />')).toBe('');
    expect(cspDeDocument('<meta name="robots" content="index" />')).toBe('');
  });
});

describe('csp documents — options et verdict', () => {
  it('parse les options sans imposer de surface', () => {
    expect(parseArguments([])).toEqual({ base: '', job: '', worker: '', reference: '', quiet: false });
    expect(
      parseArguments(['--base', BASE, '--job', 'a', '--worker', 'b', '--reference', '/about'])
    ).toEqual({ base: BASE, job: 'a', worker: 'b', reference: '/about', quiet: false });
    expect(parseArguments(['--quiet'])).toEqual({
      base: '',
      job: '',
      worker: '',
      reference: '',
      quiet: true,
    });
  });

  it('rend 0, 1 et 2 sur les trois états, et annote le titre de la famille', async () => {
    const lignes = [];
    const erreurs = [];
    const deps = {
      log: (ligne) => lignes.push(ligne),
      error: (ligne) => erreurs.push(ligne),
    };
    const conforme = {
      ok: true,
      premisse: false,
      errors: [],
      notices: [],
      checked: ['  ✓ politique du site lue'],
      politique: POLITIQUE,
      pages: ['/', '/jobs/x'],
    };
    const refuse = { ...conforme, ok: false, errors: ['le document ne publie rien'] };
    const premisse = { ...conforme, ok: false, premisse: true, checked: [], notices: [MARQUE_PREMISSE] };

    expect(await main([], { run: async () => conforme, ...deps })).toBe(0);
    expect(await main([], { run: async () => refuse, ...deps })).toBe(1);
    expect(await main([], { run: async () => premisse, ...deps })).toBe(2);
    expect(erreurs.join('\n')).toContain(`::error title=${TITRE_ERREUR}::`);
    expect(lignes.join('\n')).toContain('politique du site lue');
    expect(lignes.join('\n')).toContain('✅ les documents pré-rendus servent la CSP du site');
  });

  it('porte sa famille et son titre, distincts de ceux des sondes de document', () => {
    expect(FAMILLE).toBe('CSP des documents pré-rendus');
    expect(libelleSonde(BASE)).toContain(FAMILLE);
    expect(libelleSonde(BASE)).toContain(BASE);
    expect(TITRE_ERREUR).toContain('CSP');
  });
});
