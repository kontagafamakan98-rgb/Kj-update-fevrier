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
//   1. Le corps est recopié À L'IDENTIQUE, en-têtes de volume et TÉMOIN de
//      cache compris : une fonction qui recomposerait le XML serait une
//      seconde déclaration du sitemap, libre de diverger de celle que `/health`
//      confronte et que les sondes `hreflang` et SEO lisent. Elle ne fait que
//      TRANSPORTER — y compris ce qu'elle ne comprend pas, comme le
//      `frais`/`rejoue` du backend, sans lequel cette URL ne dit plus si le CDN
//      a rafraîchi ou resservi la mémoire de l'origine.
//   2. Une ERREUR NE SE CACHE JAMAIS (`no-store`) : un incident de cinq
//      secondes ne doit pas figer un 502 pendant une minute chez les crawlers.
//   3. La fraîcheur est MESURÉE, pas promise : 60 s de CDN comme le backend
//      garde son document 60 s. Mesuré en production le 03/11/2026 : `Age`
//      reste sous 60 s quand le lien est sain (13–15 s relevés), et
//      `stale-while-revalidate` sert la copie PENDANT le rafraîchissement —
//      `Age` est monté à 191 s au moment où l'aller-retour vers Fly prenait
//      plusieurs secondes.
//
//      LA FENÊTRE STALE EST PASSÉE DE 300 À 60 s LE 03/11/2026 : 300 s
//      donnaient un plafond de 6 min pour un document qui ne change qu'aux
//      publications, et c'était une copie de cinq minutes servie à un crawler
//      pour éviter une revalidation qui coûte 0,41 s chez le backend. Une
//      revalidation BLOQUANTE au pire des cas est bornée par le délai d'amont
//      ci-dessous ; c'est moins cher que de publier du périmé. Le plafond est
//      donc 60 s frais + 60 s de stale = 2 min au pire, et il se relit sur
//      `Age` — jamais sur cet en-tête, puisque Vercel normalise le
//      `Cache-Control` qu'il rend au client (`public`, mesuré). La valeur
//      DEMANDÉE est donc publiée à part, dans `X-Kojo-Cache-Politique` : sans
//      cela, la politique de ce module n'était lisible par personne et seul
//      `Age` parlait — un fait mesuré, jamais la déclaration.
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
//
// 60 s de stale, et non 300 : le plafond de fraîcheur est `s-maxage` + cette
// fenêtre, donc 2 min. Une copie de 6 min n'était pas un besoin, c'était le
// reste d'un réglage choisi avant de mesurer qu'une revalidation coûte 0,41 s.
const CACHE = 'public, s-maxage=60, stale-while-revalidate=60';

// Les volumes rendus par le backend, recopiés tels quels : les sondes et le
// bloc `langues` de /health les confrontent au corps, donc ils doivent
// accompagner CE corps.
const ENTETES_VOLUME = ['X-Kojo-Urls', 'X-Kojo-Urls-Declarees', 'X-Kojo-Urls-Vivantes'];

// LE TÉMOIN DE L'AMONT (03/11/2026) : il dit si le backend a RENDU son document
// (`frais`) ou resservi sa mémoire 60 s (`rejoue`). Sans lui, cette URL ne
// distinguait plus « le CDN a rafraîchi depuis l'origine » de « le CDN a
// resservi la mémoire du backend » — le fait restait lisible sur
// `/api/sitemap.xml`, mais l'adresse que tout le monde interroge était muette,
// et c'est justement celle que les crawlers et les sondes lisent.
const ENTETES_TEMOIN = ['X-Kojo-Sitemap-Cache'];

// LA POLITIQUE DÉCLARÉE, PUBLIÉE À PART. Vercel normalise le `Cache-Control`
// d'une fonction d'arête : mesuré le 03/11/2026, un observateur reçoit `public`
// et rien d'autre, donc le `s-maxage` et la fenêtre stale écrits dans ce module
// n'étaient lisibles par PERSONNE. Ils sont publiés ici, dans un en-tête que la
// plateforme ne réécrit pas — et `Age` reste la mesure de ce qui est
// réellement servi : deux faits, deux en-têtes, aucun des deux ne prétendant
// remplacer l'autre.
const ENTETE_POLITIQUE = 'X-Kojo-Cache-Politique';

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
    // La politique DEMANDÉE, lisible même quand la plateforme réécrit
    // `Cache-Control` : c'est la déclaration du module, pas une mesure.
    [ENTETE_POLITIQUE]: CACHE,
  });
  for (const nom of [...ENTETES_VOLUME, ...ENTETES_TEMOIN]) {
    const valeur = amont.headers.get(nom);
    if (valeur) entetes.set(nom, valeur);
  }

  // HEAD : mêmes en-têtes, corps vide — un crawler qui vérifie l'entête ne
  // télécharge pas 30 Ko pour rien.
  return new Response(request.method === 'HEAD' ? null : corps, { status: 200, headers: entetes });
}
