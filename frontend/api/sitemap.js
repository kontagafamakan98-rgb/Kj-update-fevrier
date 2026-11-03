// ============================================================================
// /sitemap.xml SERVI PAR LE CDN VERCEL (03/11/2026)
//
// Mesure du 02/11/2026 au soir : le sitemap du backend rend **0,41 s** en rejeu
// (0,80 s au rendu), mais à travers la réécriture EXTERNE `/sitemap.xml →
// api.…/api/sitemap.xml` il coûtait encore 0,33–0,55 s et Vercel répondait
// `X-Vercel-Cache: MISS` à chaque crawl : le CDN ne met pas en cache une
// réécriture vers une origine externe, donc le `s-maxage=3600` du backend ne
// protégeait que le navigateur, jamais le crawler.
//
// Cette fonction d'arête (Edge) rapatrie le document et le rend avec
// `s-maxage=60` : Vercel garde alors la réponse dans son CDN, et un crawl coûte
// un aller-retour d'arête au lieu d'un aller-retour jusqu'à Fly — sauf le
// premier de chaque point de présence (POP), qui paie le trajet une fois.
//
// TROIS RÈGLES, CHACUNE TENUE PAR LE CODE CI-DESSOUS.
//
//   1. Le corps est recopié À L'IDENTIQUE, en-têtes de volume compris : une
//      fonction qui recomposerait le XML serait une seconde déclaration du
//      sitemap, libre de diverger de celle que `/health` confronte et que les
//      sondes `hreflang` et SEO lisent. Elle ne fait que TRANSPORTER.
//   2. Une ERREUR NE SE CACHE JAMAIS (`no-store`) : un incident de cinq
//      secondes ne doit pas figer un 502 pendant une minute chez les crawlers.
//   3. La fraîcheur est MESURÉE, pas promise : 60 s de CDN comme le backend
//      garde son document 60 s. Mesuré en production le 03/11/2026 : `Age`
//      reste sous 60 s quand le lien est sain (13–15 s relevés), et
//      `stale-while-revalidate` sert la copie PENDANT le rafraîchissement —
//      `Age` est monté à 191 s au moment où l'aller-retour vers Fly prenait
//      plusieurs secondes. Le plafond réel est donc `s-maxage` + la fenêtre
//      stale (6 min au pire), pas la minute du backend : c'est le prix de
//      l'indisponibilité évitée, et il est écrit ici plutôt que supposé.
//
// Garde : `frontend/scripts/__tests__/sitemap-vercel.test.js` (la réécriture
// INTERNE et son ordre, la recopie du corps et des volumes, le refus d'un
// amont en échec, la méthode). Ce qu'elle ne dit pas, et qui reste mesuré en
// production : le taux de `X-Vercel-Cache: HIT` réellement obtenu.
// ============================================================================

// L'amont est le sitemap du backend, celui qui porte déjà son propre cache
// mémoire et ses trois en-têtes de volume. Surchargeable pour une répétition
// locale, jamais pour changer ce que la production sert.
// `process` est lu DÉFENSIVEMENT : le runtime d'arête l'expose, mais un module
// qui lèverait à l'import rendrait 500 sur TOUTES les requêtes — un test local
// hors Vercel (où il n'existe pas) doit pouvoir importer le handler.
const AMONT =
  (typeof process !== 'undefined' && process.env && process.env.SITEMAP_UPSTREAM) ||
  'https://api.kojoforafrica.cc.cd/api/sitemap.xml';

// Le délai de l'aller-retour. Au-delà, mieux vaut un 502 NOMMÉ et non caché
// qu'un crawler qui attend le délai de la plateforme.
const DELAI_MS = 5000;

// 60 s de CDN : la déclaration ne change qu'aux publications, et le backend
// garde son document 60 s — les deux horizons coïncident.
const CACHE = 'public, s-maxage=60, stale-while-revalidate=300';

// Les volumes rendus par le backend, recopiés tels quels : les sondes et le
// bloc `langues` de /health les confrontent au corps, donc ils doivent
// accompagner CE corps.
const ENTETES_VOLUME = ['X-Kojo-Urls', 'X-Kojo-Urls-Declarees', 'X-Kojo-Urls-Vivantes'];

export const config = { runtime: 'edge' };

function echec(motif) {
  return new Response(`sitemap indisponible : ${motif}\n`, {
    status: 502,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      // Règle 2 : jamais de cache sur un échec.
      'cache-control': 'no-store',
    },
  });
}

export default async function handler(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('méthode non autorisée\n', {
      status: 405,
      headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' },
    });
  }

  // Délai borné par `AbortController` (et non `AbortSignal.timeout`) : c'est la
  // forme que le runtime d'arête accepte partout, et un garde qui dépend d'un
  // ajout récent de la plateforme tomberait en silence chez elle.
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), DELAI_MS);

  let amont;
  try {
    amont = await fetch(AMONT, {
      // Un User-Agent nommé : si le backend voit passer ces requêtes, il sait
      // qu'elles viennent du CDN et non d'un crawler.
      headers: { 'user-agent': 'kojo-sitemap-vercel/1.0' },
      signal: controleur.signal,
    });
  } catch (err) {
    return echec(`amont injoignable (${err?.name || 'erreur'})`);
  } finally {
    clearTimeout(minuteur);
  }

  if (!amont.ok) {
    return echec(`amont HTTP ${amont.status}`);
  }

  let corps;
  try {
    corps = await amont.text();
  } catch (err) {
    return echec(`corps amont illisible (${err?.name || 'erreur'})`);
  }

  const entetes = new Headers({
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': CACHE,
  });
  for (const nom of ENTETES_VOLUME) {
    const valeur = amont.headers.get(nom);
    if (valeur) entetes.set(nom, valeur);
  }

  // HEAD : mêmes en-têtes, corps vide — un crawler qui vérifie l'entête ne
  // télécharge pas 30 Ko pour rien.
  return new Response(request.method === 'HEAD' ? null : corps, { status: 200, headers: entetes });
}
