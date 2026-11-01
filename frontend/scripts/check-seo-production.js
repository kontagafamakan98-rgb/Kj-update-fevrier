#!/usr/bin/env node
/**
 * SONDE SEO de la PRODUCTION — rapport informatif, ne bloque rien.
 *
 * Deux MODES : informatif (défaut) et `--strict`, où une intégration REQUISE
 * absente fait ÉCHOUER la sonde (une facultative n'échoue pas : une sonde rouge
 * en permanence est une sonde qu'on ignore). Le mode informatif est ce qui a
 * laissé F9 ouvert : quatre intégrations absentes de la production, et aucun run
 * rouge nulle part.
 *
 * Trois sections, et un `::notice` par fait constaté :
 *
 * 1. INTÉGRATIONS — les quatre réclamées par un audit SEO « sans JavaScript »
 *    (balise Google Analytics 4, meta de vérification Search Console, `sameAs`
 *    des profils sociaux, domaine Plausible dans la CSP) n'existent que si leur
 *    variable est définie AU MOMENT DU BUILD. Le build de CI ne les définit
 *    jamais — une balise tierce dans l'artefact audité fausserait Lighthouse —
 *    donc seo-extras-injection.test.js prouve l'INJECTION, jamais la
 *    CONFIGURATION : rien ne distinguait « pas configuré sur Vercel » de
 *    « configuré et perdu ».
 *
 * 2. DOMAINE — le canonical servi par l'accueil et l'hôte annoncé par le
 *    sitemap, comparés à SITE_ORIGIN (`scripts/site-meta.js`). Le HTML et le
 *    sitemap appartiennent à deux déploiements indépendants (Vercel, et Fly pour
 *    le sitemap) : pendant la migration du 17/09/2026 ils ont annoncé deux
 *    adresses différentes pendant des heures, et rien ne le disait. L'écart est
 *    maintenant nommé, au lieu de se déduire d'une carte OG cassée.
 *
 * 3. PAGES — chaque page du sitemap est lue et doit annoncer son `canonical`,
 *    son `<title>` et sa `description`. Mesuré le 01/11/2026 : le sitemap
 *    annonçait **85 URL** et la passe en jugeait **20**, en publiant `64 page(s)
 *    au-delà du plafond` — un angle mort que le résumé avouait sans que personne
 *    ne le ferme. La fenêtre de 20 pages **TOURNE** donc d'une passe à l'autre
 *    (`fenetreTournante`, graine = `GITHUB_RUN_NUMBER`, `KOJO_SEO_PAS`, ou le
 *    jour en local) : cinq passes couvrent les 84 pages du site, et chaque
 *    verdict **nomme les pages qu'il n'a pas jugées** et la passe qu'il a lue. Avant, seule l'accueil était sondée : le
 *    sitemap annonçait huit pages dont sept n'étaient jamais lues, donc une page
 *    servie sans description (ou avec le canonical d'une autre) restait
 *    silencieuse. Les fiches `/jobs/:id` sont ensuite jugées sur les trois mêmes
 *    métadonnées, avec la MÊME mécanique : mesuré le 01/11/2026, la sonde en
 *    jugeait trois au plus et TOUJOURS les trois premières, si bien qu'une fiche
 *    au-delà n'était jugée par aucune passe. La fenêtre des fiches tourne donc
 *    aussi (`MAX_JOB_PAGES` par passe, même graine), et le verdict NOMME les
 *    fiches laissées aux passes suivantes ; leur carte OG et le verrou 404 après
 *    suppression restent à `check-og-job-200.js`.
 *
 *    Ces fiches ont DEUX sources, et c'est le point qui manquait : le sitemap
 *    (ce qu'un crawler découvre) ET l'API publique des missions
 *    (`/api/jobs`, la même origine, statuts vivants). Mesuré le 12/10/2026 : le
 *    sitemap annonçait 8 URL dont ZÉRO fiche — les deux sources disaient alors la
 *    même chose (aucune mission servie), mais avec une SEULE source un sitemap
 *    muet et une base vide produisaient exactement le même rapport, et la sonde
 *    n'aurait jugé aucune fiche le jour où il y en aurait eu. Ce que la seconde
 *    source change :
 *      • les fiches vivantes que le sitemap n'énumère PAS sont lues quand même
 *        (elles sont jugées, et leur absence du sitemap est refusée en strict —
 *        une fiche servie mais non découvrable est un défaut, pas un silence) ;
 *      • un échantillon vide n'est un fait MESURÉ que si les deux sources
 *        concordent ; sitemap muet + API illisible est une SONDE AVEUGLE, et le
 *        mode strict la refuse (aucune fiche jugée, aucune source lisible).
 *
 * En mode INFORMATIF (le défaut, pour un run de poste), le script ne fait JAMAIS
 * échouer : une intégration non configurée ou un écart d'adresse sont des faits
 * d'exploitation, pas des régressions de code. Ce mode n'est PLUS celui de la
 * CI : l'étape de `ci.yml` (job `lighthouse-ci`) qui le lançait a été RETIRÉE le
 * 10/10/2026 — un rapport qui ne peut pas échouer et que personne ne lit n'est
 * pas une vérification, et c'est ce qui a laissé F9 ouvert. La production est
 * désormais lue par la sonde QUOTIDIENNE
 * (`.github/workflows/seo-production-probe.yml`, `--strict`), qui BLOQUE. Il
 * refuse de conclure sur une base locale (repli des PR) — là, les variables sont
 * absentes par construction, et quatre « ABSENT » ne diraient rien de la
 * production.
 *
 * TROIS SORTIES en mode strict, jamais deux (comme les sondes de document) :
 * 1 = refus nommé (une intégration requise absente, une page qui répond 404, un
 * sitemap muet) ; 2 = PRÉMISSE (une page du sitemap n'a pas pu être LUE) ;
 * 0 = vert. Mesuré le 01/11/2026 sur `main`, après la livraison des cinq
 * langues : `/emplois/bamako` a dépassé le délai de 15 s au moment où
 * `deploy-fly` venait de remplacer la machine Fly, et la sonde a rendu un 1 qui
 * disait « le sitemap annonce une page que la production ne sert pas » — la page
 * répondait 200 en 0,3 s une minute plus tard. Un délai n'est pas une mesure
 * d'absence : la page est demandée DEUX fois (`TENTATIVES_PAGE`), et si elle
 * reste illisible elle est publiée en `::warning` « Page non mesurée » et la
 * sonde sort en 2 — bruyante, jamais verte, sans accuser la production de ce
 * qu'elle n'a pas constaté.
 *
 * Usage : cd frontend && node scripts/check-seo-production.js [--base URL]
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SITE_ORIGIN, canonicalHref, isLoopbackUrl, metaContent, titleOf } from './site-meta.js';
// Le corpus « missions vivantes » est DÉCLARÉ (scripts/corpus-missions.js) : quand
// les DEUX sources concordent sur un corpus vide, aucune fiche réelle n'est
// jugée — cette surface aveugle se publie en `::warning`, et elle est REFUSÉE si
// elle n'est pas déclarée (cf. l'en-tête de ce script).
import {
  SURFACE_SEO_PRODUCTION_FICHES,
  verdictDeSurfaceVide,
} from './corpus-missions.js';

// Les quatre intégrations, la variable d'environnement qui les active, et si
// leur ABSENCE est un défaut (`required`) ou un choix d'exploitation.
//
// `required` existe pour que le mode strict ne bloque que sur ce qui doit être
// là : une sonde quotidienne qui échouerait AUSSI sur une intégration
// facultative resterait rouge à jamais après la pose des valeurs requises, et
// une sonde rouge en permanence est une sonde qu'on apprend à ignorer —
// exactement le silence qu'elle est censée fermer.
export const INTEGRATIONS = [
  { key: 'ga4', label: 'Google Analytics 4', env: 'VITE_GA_MEASUREMENT_ID', required: true },
  { key: 'gsc', label: 'Search Console (balise meta)', env: 'VITE_GSC_VERIFICATION', required: true },
  { key: 'plausible', label: 'Plausible (facultatif)', env: 'VITE_PLAUSIBLE_DOMAIN', required: false },
  { key: 'social', label: 'Liens sociaux (sameAs du LocalBusiness)', env: 'VITE_SOCIAL_*', required: true },
];

// Aucun en-tête `cache-control: no-cache` : le HTML est servi en
// `public, max-age=0, must-revalidate`, donc l'edge revalide avant de répondre
// (mesuré le 17/09/2026 : `HIT` + `Age: 1` avec et sans l'en-tête).
const PROBE_HEADERS = { 'user-agent': 'kojo-seo-production-probe/1.0' };

/**
 * Liens sociaux RÉELLEMENT posés dans le HTML servi, restreints aux hôtes que
 * le `sameAs` déclare.
 *
 * `sameAs` prouve que les profils sont déclarés au build ; il ne prouve pas
 * qu'un crawler sans JavaScript les voit. Un `sameAs` rempli avec zéro lien
 * dans le corps de page est exactement le faux vert que ce décompte nomme.
 */
export function socialAnchorsFrom(html, declared) {
  const hosts = new Set();
  for (const url of declared) {
    try {
      hosts.add(new URL(url).host);
    } catch (_error) {
      /* URL déjà écartée du sameAs */
    }
  }
  const source = String(html);
  const count = (chunk) =>
    [...chunk.matchAll(/<a\b[^>]*\shref="(https?:\/\/[^"]+)"/gi)].filter((match) => {
      try {
        return hosts.has(new URL(match[1]).host);
      } catch (_error) {
        return false;
      }
    }).length;
  // Les OCCURRENCES, pas les URL distinctes : le même profil est publié deux
  // fois (bloc « Suivez-nous » du corps + pied de page), et un décompte dédoublonné
  // afficherait le même chiffre avant et après l'ajout du bloc — une mesure qui
  // ne bouge pas ne prouve rien. La part d'AVANT le pied de page est ce qui dit
  // si un crawler voit les liens dans le corps de page.
  const total = count(source);
  const body = count(source.split(/<footer\b/i)[0]);
  return { total, body };
}

/**
 * Ce que le HTML servi contient réellement.
 *
 * `plausible.io` n'apparaît que dans la CSP quand Plausible est activé : son
 * script est chargé par le BUNDLE, donc invisible du HTML statique — un audit
 * « no-JS » ne le verra jamais, ce que dit explicitement le rapport.
 */
export function analyzeSeoServedHtml(html = '') {
  const source = String(html);
  const ga = /googletagmanager\.com\/gtag\/js\?id=([A-Za-z0-9_-]+)/.exec(source);
  const gsc = metaContent(source, 'google-site-verification');
  let social = [];
  try {
    const declared = JSON.parse(/\"sameAs"\s*:\s*(\[[^\]]*\])/.exec(source)?.[1] || '[]');
    social = Array.isArray(declared) ? declared.filter((url) => /^https:\/\//.test(String(url))) : [];
  } catch (_error) {
    social = [];
  }
  return {
    ga4: { present: Boolean(ga), value: ga ? ga[1] : '' },
    gsc: { present: Boolean(gsc), value: gsc },
    plausible: { present: source.includes('plausible.io'), value: '' },
    social: {
      present: social.length > 0,
      value: social.join(', '),
      count: social.length,
      ...socialAnchorsFrom(source, social),
    },
  };
}

/** Une ligne par intégration : ce qui est présent, ou la variable à poser. */
export function noticeFor({ key, label, env, required = true }, state) {
  if (!state.present) {
    return (
      `${label} : ABSENT — poser ${env} dans Vercel → Settings → Environment Variables, puis REDÉPLOYER (les VITE_* sont inlinées au build).` +
      (required ? '' : ' FACULTATIF : son absence ne fait pas échouer la sonde stricte.')
    );
  }
  const detail =
    key === 'ga4'
      ? `gtag/js?id=${state.value}`
      : key === 'gsc'
        ? `jeton ${String(state.value).slice(0, 8)}…`
        : key === 'social'
          ? `${state.count} profil(s) dans le sameAs, ${state.total} lien(s) dans le HTML servi ` +
            `(dont ${state.body} dans le corps, avant le pied de page)` +
            (state.total === 0
              ? " — AUCUN lien social dans le HTML brut : un crawler sans JavaScript ne peut pas les voir (bloc social du shell pré-rendu et footer)"
              : '')
          : 'CSP script-src ouverte (script injecté par le bundle)';
  return `${label} : PRÉSENT — ${detail}`;
}

/**
 * `<loc>` du sitemap servi, ou l'erreur de lecture — jamais une exception : le
 * sitemap peut manquer sans que le reste du rapport perde sa valeur.
 */
async function readSitemap(base, fetchImpl) {
  try {
    const response = await fetchImpl(`${base}/sitemap.xml`, {
      redirect: 'follow',
      headers: PROBE_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const xml = await response.text();
    return { locs: [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]) };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * L'adresse appartient-elle à l'origine attendue ?
 *
 * La frontière compte : `https://kojoforafrica.cc.cd.attaquant.test/` ne doit
 * pas passer pour conforme.
 */
const belongsTo = (address, origin) => address === origin || address.startsWith(`${origin}/`);

/** Le canonical servi, confronté à l'origine attendue. */
function canonicalNotice(href, origin) {
  if (!href) {
    return `Domaine — canonical : ABSENT de l'accueil, un crawler ne peut pas trancher entre les adresses qui répondent (attendu ${origin}/).`;
  }
  if (belongsTo(href, origin)) {
    return `Domaine — canonical servi : ${href} (conforme à l'origine attendue).`;
  }
  return `Domaine — canonical servi : ${href} — ÉCART : l'origine attendue est ${origin}. Migration de domaine à moitié faite, ou HTML d'avant bascule.`;
}

/** L'hôte annoncé par le sitemap, confronté à l'origine attendue. */
function sitemapNotice({ locs, error }, attendue) {
  if (error) {
    return `Domaine — sitemap : non lisible (${error}), l'hôte qu'il annonce reste inconnu.`;
  }
  // Origines distinctes annoncées, dans l'ordre du document : un `<loc>`
  // illisible ne compte pas comme hôte, sans faire tomber le rapport.
  const origins = [];
  for (const loc of locs) {
    try {
      const { origin } = new URL(loc);
      if (!origins.includes(origin)) origins.push(origin);
    } catch (_error) {
      /* ignoré : visible par son absence du décompte */
    }
  }
  const announced = origins.join(', ') || 'aucun hôte lisible';
  if (origins.length === 1 && belongsTo(origins[0], attendue)) {
    return `Domaine — sitemap : ${locs.length} URL, hôte annoncé ${announced} (conforme à l'origine attendue).`;
  }
  return `Domaine — sitemap : ${locs.length} URL, hôte annoncé ${announced} — ÉCART : l'origine attendue est ${attendue}.`;
}

/**
 * Métadonnées qu'une page PUBLIQUE doit annoncer, lues sur le HTML SERVI — ce
 * qu'un crawler sans JavaScript reçoit réellement, pas ce que le build a écrit.
 */
export function analyzePageMetadata(html) {
  return {
    title: titleOf(html),
    description: metaContent(html, 'description'),
    canonical: canonicalHref(html),
  };
}

/** Chemin d'une adresse, barre finale retirée (« / » et « / » restent égaux). */
const normalizePathname = (value) => String(value).replace(/\/+$/, '') || '/';

/** Le chemin d'une URL, ou la chaîne vide si elle est illisible. */
function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch (_error) {
    return String(url);
  }
}

/** Une fiche mission `/jobs/:id` du sitemap (et non la liste `/jobs`). */
const JOB_DETAIL = /^\/jobs\/[^/]+\/?$/;

/**
 * Le budget d'une passe, en pages du SITE — il ne bouge pas.
 *
 * Mesuré le 01/11/2026 : le sitemap sert **85 URL**, la passe en jugeait **20**
 * et publiait « 64 page(s) au-delà du plafond » — ces 64 pages n'étaient jugées
 * par AUCUNE sonde de production, jamais. Le coût d'une passe ne peut pas
 * couvrir 84 pages sans allonger chaque run ; c'est donc l'ÉCHANTILLON qui
 * tourne : la même fenêtre de 20 pages avance d'un cran à chaque passe, si bien
 * que la couverture est complète en ``tours`` passes — et les pages hors
 * fenêtre sont NOMMÉES dans le verdict, au lieu d'être sous-entendues.
 */
const MAX_PAGES = 20;

/**
 * La fenêtre tournante de cette passe.
 *
 * `graine` est un NUMÉRO DE PASSE, pas un offset : deux passes successives
 * lisent deux fenêtres disjointes, et `tours` passes lisent toutes les pages.
 * Le calcul est déterministe pour une graine donnée — un run peut donc être
 * rejoué à l'identique, et le verdict nomme la passe qu'il a jugée.
 *
 * @returns {{passe: number, tours: number, offset: number, indexes: number[], from: number, to: number}}
 */
export function fenetreTournante({ total = 0, max = MAX_PAGES, graine = 0 } = {}) {
  if (!Number.isFinite(total) || total <= 0) {
    return { passe: 0, tours: 0, offset: 0, indexes: [], from: 0, to: 0 };
  }
  const taille = Math.min(max, total);
  const tours = Math.ceil(total / taille);
  const passe = ((Math.trunc(graine) % tours) + tours) % tours;
  const offset = passe * taille;
  const indexes = [];
  for (let i = 0; i < taille; i += 1) indexes.push((offset + i) % total);
  return {
    passe: passe + 1,
    tours,
    offset,
    indexes,
    from: offset + 1,
    // Une fenêtre qui boucle annonce ses deux morceaux : « 81..84 + 1..16 ».
    to: Math.min(offset + taille, total),
  };
}

/**
 * La GRAINE de la passe, résolue dans cet ordre : l'option explicite (tests,
 * rejeu), `KOJO_SEO_PAS` (une passe forcée à la main), `GITHUB_RUN_NUMBER`
 * (chaque run avance d'un cran), puis le JOUR (UTC) en local.
 *
 * Le jour est en dernier et non en premier : en CI, deux runs le même jour
 * (le cron et le push de `main`) doivent lire deux fenêtres DIFFÉRENTES, sinon
 * la couverture n'avance pas là où elle sert le plus.
 */
export function graineFenetre({ graine, env = process.env, jour = new Date() } = {}) {
  if (Number.isInteger(graine)) return graine;
  const pas = String(env.KOJO_SEO_PAS ?? '').trim();
  if (/^\d+$/.test(pas)) return Number.parseInt(pas, 10);
  const run = String(env.GITHUB_RUN_NUMBER ?? '').trim();
  if (/^\d+$/.test(run)) return Number.parseInt(run, 10);
  return Math.floor(jour.getTime() / 86400000);
}

/**
 * Budget de fiches `/jobs/:id` PAR PASSE — la fenêtre tourne, comme les pages.
 *
 * Le sitemap en admet jusqu'à 9 000 et une passe ne peut pas les couvrir : elle
 * vérifie que la FORME de la fiche tenue par le backend annonce bien
 * `canonical`/`title`/`description`, sur des missions réelles. Ce que
 * `check-og-job-200.js` possède déjà — la carte OG, ses variantes, le verrou
 * 404 après suppression — n'est PAS rejoué ici, et l'échantillon ne prétend pas
 * couvrir les fiches qu'il n'a pas lues (la notice les NOMME).
 *
 * Mesuré le 01/11/2026 : le plafond était FIXE, donc la sonde jugeait toujours
 * les trois premières fiches du sitemap et une fiche au-delà de la troisième
 * n'était jugée par AUCUNE passe, jamais — le même angle mort que les 64 pages
 * du sitemap, fermé le même jour. La fenêtre de `MAX_JOB_PAGES` TOURNE donc avec
 * la MÊME graine que celle des pages : une fiche est jugée une passe sur `tours`.
 *
 * Deux budgets, pas un : `MAX_JOB_PAGES` borne la fenêtre du SITEMAP (le corpus,
 * qui tourne) ET la lecture du DÉTECTEUR d'API (les fiches vivantes absentes du
 * sitemap, dont l'absence est déjà un défaut). Le coût d'une passe reste de six
 * lectures au plus, quel que soit le nombre de missions vivantes.
 */
export const MAX_JOB_PAGES = 3;

/**
 * Statuts dont la fiche est PUBLIQUE et indexable — exactement ceux que le
 * sitemap du backend énumère (`open`, `in_progress`, cf.
 * `kojo_routers_public.get_sitemap_xml`). La seconde source doit lire le même
 * ensemble : comparer un sitemap « open + in_progress » à une liste sans filtre
 * ferait refuser une fiche TERMINÉE, qui n'a rien à y faire.
 */
export const LIVE_JOB_STATUSES = ['open', 'in_progress'];

/** Chemin de l'API publique des missions, sur la MÊME origine (rewrite Vercel). */
export const PUBLIC_JOBS_PATH = '/api/jobs';

/**
 * Les fiches VIVANTES que l'API PUBLIQUE sert — la SECONDE source des fiches.
 *
 * Lecture bornée et idempotente : un appel par statut vivant, `limit` = la
 * taille de l'échantillon. La liste est triée par `created_at` décroissant
 * (`kojo_routers_jobs_listing.get_jobs`), donc les fiches lues sont les plus
 * récentes — un échantillon représentatif, comme celui du sitemap.
 *
 * Jamais d'exception : une panne devient une entrée d'`erreurs`, nommée par le
 * statut fautif. Une forme de charge utile inattendue est NOMMÉE plutôt que
 * devinée : une enveloppe ajoutée côté backend doit se lire dans le verdict, pas
 * se traduire en « aucune fiche ».
 *
 * @returns {Promise<{urls: string[], live: number, erreurs: string[]}>}
 */
export async function readPublicJobs(base, fetchImpl, { limit = MAX_JOB_PAGES } = {}) {
  const urls = [];
  const erreurs = [];
  for (const status of LIVE_JOB_STATUSES) {
    try {
      const response = await fetchImpl(`${base}${PUBLIC_JOBS_PATH}?status=${status}&limit=${limit}`, {
        redirect: 'follow',
        headers: PROBE_HEADERS,
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        erreurs.push(`${status} : HTTP ${response.status}`);
        continue;
      }
      const charge = JSON.parse(await response.text());
      if (!Array.isArray(charge)) {
        erreurs.push(`${status} : forme inattendue (${typeof charge})`);
        continue;
      }
      for (const job of charge) {
        if (!job || !job.id) {
          erreurs.push(`${status} : une fiche sans identifiant`);
          continue;
        }
        const url = `${base}/jobs/${job.id}`;
        if (!urls.includes(url)) urls.push(url);
      }
    } catch (error) {
      erreurs.push(`${status} : ${error.message}`);
    }
  }
  return { urls, live: urls.length, erreurs };
}

/**
 * QUI est jugé cette passe, et QUI ne l'est pas.
 *
 * Le SITEMAP est le corpus : c'est ce qu'un crawler découvre, et c'est lui qui
 * tourne. L'API PUBLIQUE est un DÉTECTEUR de trou de découverte : elle dit
 * quelles fiches vivantes sont servies SANS être au sitemap, et elle est lue sur
 * un échantillon borné qui ne prend JAMAIS la place d'une fiche du corpus dans la
 * fenêtre — sinon un détecteur ferait perdre du corpus à chaque run.
 *
 * @returns {{aLire: Array<{url: string, source: 'sitemap'|'api'}>, total: number,
 *   fichesSitemap: number, nonJugees: string[], apiSeules: number,
 *   apiNonJugees: string[], fenetre: object}}
 */
export function fenetreFiches({ sitemap = [], api = [], graine = 0, max = MAX_JOB_PAGES } = {}) {
  const fenetre = fenetreTournante({ total: sitemap.length, max, graine });
  const aJuger = fenetre.indexes.map((index) => sitemap[index]);
  // Ce que CETTE passe laisse aux suivantes : nommé, jamais sous-entendu.
  const nonJugees = sitemap.filter((url) => !aJuger.includes(url));
  const apiSeules = (api || []).filter((url) => !sitemap.includes(url));
  const apiJugees = apiSeules.slice(0, max);
  const apiNonJugees = apiSeules.slice(apiJugees.length);
  return {
    aLire: [
      ...aJuger.map((url) => ({ url, source: 'sitemap' })),
      ...apiJugees.map((url) => ({ url, source: 'api' })),
    ],
    total: sitemap.length + apiSeules.length,
    fichesSitemap: sitemap.length,
    nonJugees,
    apiSeules: apiSeules.length,
    apiNonJugees,
    fenetre,
  };
}

/**
 * Combien de fois une page est DEMANDÉE avant d'être dite non mesurée.
 *
 * Mesuré le 01/11/2026, sur `main` après la livraison des cinq langues :
 * `/emplois/bamako` a dépassé le délai de 15 s au moment précis où la sonde
 * stricte tournait juste après `deploy-fly`, et la CI est passée ROUGE sur
 * « le sitemap annonce une page que la production ne sert pas » — une phrase
 * FAUSSE : la page répondait 200 en 0,3 s une minute plus tard, et la machine
 * Fly venait d'être remplacée. Un délai réseau n'est pas une mesure d'absence.
 */
export const TENTATIVES_PAGE = 2;
export const ATTENTE_TENTATIVE_MS = 2000;

/**
 * Défauts d'une page vis-à-vis de sa PROPRE adresse, chacun nommant la page et
 * ce qui manque — un rouge muet obligerait à relire le script.
 *
 * Le canonical est confronté à la page elle-même, pas seulement à l'origine :
 * une route qui annoncerait le canonical d'une AUTRE page a bien une adresse
 * canonique, mais elle envoie les crawlers ailleurs.
 *
 * DEUX CLASSES, jamais mélangées : un statut HTTP qui n'est pas 2xx est une
 * MESURE (la production répond ça, le sitemap annonce donc une page qu'elle ne
 * sert pas) ; une erreur de TRANSPORT après `TENTATIVES_PAGE` demandes est un
 * défaut de mesure (la page n'a pas été jugée) et ne doit jamais se lire comme
 * un constat sur ce que la production sert.
 *
 * @returns {{defects: string[], premisses: string[]}}
 */
export function pageDefects({ url, html, error, illisible }) {
  const path = pathOf(url);
  if (illisible) {
    return {
      defects: [],
      premisses: [
        `${path} : NON MESURÉE après ${TENTATIVES_PAGE} tentatives (${illisible}) — la page n'est pas ` +
          'jugée, et ce n’est pas un constat sur ce que la production sert (relancer la sonde).',
      ],
    };
  }
  if (error) {
    return {
      defects: [
        `${path} : non lisible (${error}) — le sitemap annonce une page que la production ne sert pas.`,
      ],
      premisses: [],
    };
  }
  const { title, description, canonical } = analyzePageMetadata(html);
  const defects = [];
  if (!title) {
    defects.push(`${path} : <title> ABSENT — un résultat de recherche s'afficherait avec l'adresse brute.`);
  }
  if (!description) {
    defects.push(`${path} : description ABSENTE — un moteur n'a aucun extrait à afficher.`);
  }
  if (!canonical) {
    defects.push(`${path} : canonical ABSENT — un crawler ne peut pas trancher entre les adresses qui répondent.`);
  } else if (!belongsTo(canonical, SITE_ORIGIN)) {
    defects.push(`${path} : canonical ${canonical} — ÉCART : hors de l'origine attendue ${SITE_ORIGIN}.`);
  } else if (normalizePathname(pathOf(canonical)) !== normalizePathname(path)) {
    defects.push(
      `${path} : canonical ${canonical} — ÉCART : désigne ${normalizePathname(pathOf(canonical))} au lieu de cette page.`,
    );
  }
  return { defects, premisses: [] };
}

/**
 * Lit une page du sitemap ; jamais d'exception.
 *
 * Une réponse HTTP est RENDUE telle quelle (`error` = `HTTP 404`), parce qu'elle
 * est une mesure. Une erreur de TRANSPORT (délai dépassé, connexion coupée) est
 * rejouée une fois — c'est exactement le cas mesuré le 01/11/2026 après un
 * déploiement Fly — puis rendue en `illisible`, une prémisse.
 */
async function readPage(url, fetchImpl) {
  let derniere;
  for (let tentative = 1; tentative <= TENTATIVES_PAGE; tentative += 1) {
    try {
      const response = await fetchImpl(url, {
        redirect: 'follow',
        headers: PROBE_HEADERS,
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return { url, error: `HTTP ${response.status}` };
      return { url, html: await response.text() };
    } catch (error) {
      derniere = error?.message || String(error);
      if (tentative < TENTATIVES_PAGE) {
        await new Promise((resolve) => setTimeout(resolve, ATTENTE_TENTATIVE_MS));
      }
    }
  }
  return { url, illisible: derniere };
}

/**
 * Les pages du sitemap à vérifier : la FENÊTRE tournante des pages du SITE, et
 * un ÉCHANTILLON borné des fiches `/jobs/:id`.
 *
 * @returns {Promise<{checked: Array<{url: string, defects: string[]}>, total: number,
 *   fenetre: object, nonJugees: string[], jobs: {checked: Array, sampled: number,
 *   total: number, sitemap: number, api: number, apiErreurs: string[],
 *   horsSitemap: number}}>}
 */
async function checkSitemapPages({
  locs = [],
  fetchImpl,
  homeHtml,
  apiJobs = { urls: [], live: 0, erreurs: [] },
  graine = 0,
}) {
  const sitePages = [];
  const jobPages = [];
  for (const loc of locs) {
    let pathname;
    try {
      pathname = new URL(loc).pathname;
    } catch (_error) {
      // `<loc>` illisible : déjà visible dans le décompte du sitemap.
      continue;
    }
    const cible = JOB_DETAIL.test(pathname) ? jobPages : sitePages;
    if (!cible.includes(loc)) cible.push(loc);
  }

  const fenetre = fenetreTournante({ total: sitePages.length, max: MAX_PAGES, graine });
  const aLire = fenetre.indexes.map((index) => sitePages[index]);
  // Les pages que CETTE passe ne juge pas. Elles sont nommées dans le verdict :
  // une couverture partielle qui ne se déclare pas est le silence que ce garde
  // existe pour fermer.
  const nonJugees = sitePages.filter((url) => !aLire.includes(url));
  const checked = [];
  for (const url of aLire) {
    // L'accueil est déjà lu pour les intégrations : ne pas le redemander.
    const page =
      pathOf(url) === '/' && homeHtml !== undefined
        ? { url, html: homeHtml }
        : await readPage(url, fetchImpl);
    checked.push({ url, ...pageDefects(page) });
  }

  // Les fiches à juger : la FENÊTRE TOURNANTE des fiches du sitemap (le corpus,
  // même graine que les pages), puis un détecteur borné des fiches que l'API
  // publique sert SANS qu'elles soient au sitemap. Ce que la fenêtre laisse aux
  // passes suivantes est NOMMÉ dans le verdict, jamais sous-entendu.
  const fiches = fenetreFiches({
    sitemap: jobPages,
    api: apiJobs.urls || [],
    graine,
  });

  const sampled = [];
  for (const { url, source } of fiches.aLire) {
    const page = await readPage(url, fetchImpl);
    // Une fiche peut être clôturée entre la lecture qui l'a listée et sa
    // lecture : un 404 n'est PAS un défaut (une mission vivante disparaît
    // normalement), c'est une mesure impossible — nommée, pas jugée. Une page
    // servie en 200 reste jugée sur ses métadonnées.
    sampled.push(
      page.error
        ? { url, source, disparue: page.error }
        : page.illisible
          ? { url, source, illisible: page.illisible }
          : { url, source, ...pageDefects(page) }
    );
  }

  return {
    checked,
    total: sitePages.length,
    fenetre,
    nonJugees,
    jobs: {
      checked: sampled,
      sampled: sampled.length,
      total: fiches.total,
      sitemap: fiches.fichesSitemap,
      api: apiJobs.live || 0,
      apiErreurs: apiJobs.erreurs || [],
      horsSitemap: fiches.apiSeules,
      fenetreFiches: fiches.fenetre,
      nonJugees: fiches.nonJugees,
      apiNonJugees: fiches.apiNonJugees,
    },
  };
}

/**
 * Notices de l'échantillon des fiches `/jobs/:id`, avec les DEUX sources.
 *
 * Un échantillon vide n'est pas une conformité : il n'est publié comme un fait
 * que si une source l'a dit (les deux concordent), et l'absence des fiches du
 * sitemap est refusée dès que l'API publique en sert.
 *
 * @returns {{notices: string[], défauts: string[], avertissements: string[]}}
 */
export function jobSampleNotices({
  checked = [],
  total = 0,
  sampled = 0,
  sitemap = 0,
  api = 0,
  apiErreurs = [],
  horsSitemap = 0,
  fenetreFiches: fenetre = null,
  nonJugees = [],
  apiNonJugees = [],
} = {}) {
  const défauts = checked.filter(({ defects }) => defects?.length).flatMap(({ defects }) => defects);
  const trousDeSource = [];
  const apiNommee = `API publique (${PUBLIC_JOBS_PATH})`;

  // ── Les deux sources ne disent pas la même chose : des fiches VIVANTES que le
  //    sitemap n'énumère pas sont servies, donc non découvrables. C'est un défaut
  //    de découverte, et il n'était PAS visible tant que le sitemap était la
  //    seule source — le rapport disait alors « aucune fiche ».
  if (api > 0 && sitemap === 0) {
    trousDeSource.push(
      `fiches /jobs/:id : ${api} fiche(s) vivante(s) servie(s) par l'${apiNommee} ` +
        "ne figure(nt) dans AUCUN sitemap — un crawler ne les découvre pas par là, et la sonde ne les " +
        'jugeait pas tant que le sitemap était sa seule source.',
    );
  }
  // ── Une source illisible n'est pas un « aucune fiche » : c'est une mesure
  //    impossible, et elle est NOMMÉE. Sans lecture de l'API publique, les fiches
  //    que le sitemap omet restent invisibles à la sonde COMME au crawler.
  if (apiErreurs.length) {
    trousDeSource.push(
      `fiches /jobs/:id : l'${apiNommee} n'a pas pu être lue (${apiErreurs.join(' ; ')}) — ` +
        'vérification de complétude impossible : les fiches absentes du sitemap ne sont jugées nulle part.',
    );
  }

  // ── Aucune fiche à juger. Ce n'est un FAIT que si une source a pu le dire :
  //    sitemap muet + API illisible = sonde aveugle, et un échantillon vide ne
  //    doit pas se lire comme une conformité (cf. F9).
  if (total === 0 && !trousDeSource.length) {
    // ── Corps VIDE ET concordant : la sonde ne juge la forme d'AUCUNE fiche
    //    réelle. C'est un fait mesuré, mais c'est aussi une surface AVEUGLE :
    //    elle est donc DÉCLARÉE (scripts/corpus-missions.js) et publiée en
    //    `::warning` — bruyante, jamais bloquante. Non déclarée, elle serait un
    //    DÉFAUT (refusé par le mode strict) : une sonde qui ne mesure rien ne
    //    doit pas pouvoir le taire.
    const verdict = verdictDeSurfaceVide({
      cle: SURFACE_SEO_PRODUCTION_FICHES,
      detail: `sitemap ${sitemap} fiche(s) et ${apiNommee} ${api} fiche(s) vivante(s)`,
    });
    return {
      notices: [
        `Pages — fiches /jobs/:id : aucune jugée — le sitemap n'annonce aucune fiche ET l'${apiNommee} ` +
          "n'en sert aucune : les deux sources CONCORDENT, il n'y a pas de fiche vivante à juger " +
          '(aucune conclusion n’est tirée sur cette forme de page, mais elle n’est pas muette pour autant).',
      ],
      défauts: verdict.erreur ? [verdict.erreur] : [],
      avertissements: verdict.erreur ? [] : [verdict.avertissement],
    };
  }
  if (total === 0) {
    return {
      notices: [
        `Pages — fiches /jobs/:id : AUCUNE jugée — le sitemap n'annonce aucune fiche et l'${apiNommee} ` +
          "n'a pas pu être lue : les deux sources sont muettes, impossible de distinguer « aucune mission " +
          'vivante » d’une découverte cassée.',
      ],
      défauts: trousDeSource,
      avertissements: [],
    };
  }

  const disparues = checked.filter(({ disparue }) => disparue);
  const nonLues = checked.filter(({ illisible }) => illisible);
  const premisses = nonLues.map(
    ({ url }) =>
      `${pathOf(url)} : NON MESURÉE (${TENTATIVES_PAGE} tentatives) — fiche non jugée ; ce n’est pas une ` +
        'disparition constatée, relancer la sonde.',
  );
  const notes = [`${sampled} sur ${total} vérifiée(s)`];
  if (disparues.length) notes.push(`${disparues.length} disparue(s) entre la lecture et sa vérification (non jugées)`);
  if (nonLues.length) notes.push(`${nonLues.length} non lue(s) (défaut de mesure, non jugées)`);
  if (horsSitemap) notes.push(`${horsSitemap} venue(s) de l'${apiNommee} (absente(s) du sitemap)`);
  if (nonJugees.length) notes.push(`${nonJugees.length} du sitemap hors fenêtre cette passe`);
  if (apiNonJugees.length) notes.push(`${apiNonJugees.length} de l'${apiNommee} non jugée(s)`);
  const fenetreTexte =
    fenetre && fenetre.tours > 1
      ? `Fenêtre ${fenetre.passe}/${fenetre.tours} des fiches du sitemap (${MAX_JOB_PAGES} par passe : ` +
        `l'échantillon tourne, couverture complète en ${fenetre.tours} passes)`
      : sitemap === 0
        ? `Aucune fiche au sitemap : ${api} fiche(s) lue(s) par le SEUL détecteur d'API ` +
          `(${MAX_JOB_PAGES} par passe au plus)`
        : `Fiches du sitemap : ${sitemap}, toutes dans la fenêtre d'une passe (${MAX_JOB_PAGES} au plus)`;
  const résumé =
    `Pages — fiches /jobs/:id : ${notes.join(' ; ')} (canonical, title, description) : ` +
    (défauts.length ? `${défauts.length} défaut(s) nommé(s) ci-dessous` : 'conformes') +
    ` — sources lues : ${sitemap} du sitemap, ${api} de l'${apiNommee}. ` +
    `${fenetreTexte} ; la carte OG et le verrou 404 restent à check-og-job-200.js.`;

  // ── CE QUI N'A PAS ÉTÉ JUGÉ, nommé : le budget n'est plus un angle mort, la
  //    fenêtre tourne, et la passe dit quelles fiches elle laisse aux suivantes.
  const noticesNonJugees = [];
  if (nonJugees.length) {
    noticesNonJugees.push(
      `Pages — fiches /jobs/:id non jugées par la passe ${fenetre?.passe || 1}/${fenetre?.tours || 1} ` +
        `(${nonJugees.length}) : ${nonJugees.map((url) => pathOf(url)).join(', ')} — échantillonnage ` +
        'tournant, couverture complète en autant de passes.',
    );
  }
  if (apiNonJugees.length) {
    noticesNonJugees.push(
      `Pages — fiches /jobs/:id servies par l'${apiNommee} et non jugées (${apiNonJugees.length}) : ` +
        `${apiNonJugees.map((url) => pathOf(url)).join(', ')} — l'API est un DÉTECTEUR borné ` +
        `(${MAX_JOB_PAGES} par passe), pas le corpus : ce sont les fiches du sitemap qui tournent.`,
    );
  }

  return {
    notices: [
      résumé,
      ...[...défauts, ...trousDeSource].map((d) => `Pages — ${d}`),
      ...premisses.map((p) => `Pages — ${p}`),
      ...noticesNonJugees,
    ],
    défauts: [...défauts, ...trousDeSource],
    premisses,
    avertissements: [],
  };
}

/**
 * Notices de la section « Pages » : un résumé par famille, puis un `::notice`
 * par défaut.
 *
 * @returns {{notices: string[], défauts: string[], avertissements: string[]}} Les
 *   défauts sont ceux que le mode strict refuse ; les avertissements sont les
 *   surfaces aveugles DÉCLARÉES (corpus vide), publiées en `::warning`.
 */
export function pagesNotices({
  checked = [],
  total = 0,
  fenetre = null,
  nonJugees = [],
  jobs = {},
  error,
}) {
  if (error) {
    // Le sitemap est la source des pages du SITE, pas celle des fiches : celles
    // que l'API publique sert sont jugées quand même, et la section le dit au
    // lieu de se taire entièrement.
    const echantillon = jobSampleNotices(jobs);
    return {
      notices: [
        `Pages — non vérifiées : le sitemap n'est pas lisible (${error}).`,
        ...echantillon.notices,
      ],
      défauts: echantillon.défauts,
      premisses: echantillon.premisses || [],
      avertissements: echantillon.avertissements,
    };
  }
  const notes = [];
  const tourne = fenetre && fenetre.tours > 1;
  if (tourne) {
    notes.push(
      `fenêtre ${fenetre.passe}/${fenetre.tours} du sitemap (pages ${fenetre.from}..${fenetre.to}), ` +
        `${nonJugees.length} hors fenêtre`,
    );
  }
  const défauts = checked.filter(({ defects }) => defects.length > 0).flatMap(({ defects }) => defects);
  // Les pages que le TRANSPORT n'a pas permis de lire : une prémisse, jamais un
  // défaut — le résumé le dit, sinon un run rouge laisserait croire qu'on a
  // constaté une absence.
  const premisses = checked.flatMap(({ premisses: p }) => p || []);
  if (premisses.length) notes.push(`${premisses.length} page(s) NON MESURÉE(S)`);
  const résumé =
    `Pages — ${checked.length}/${total} page(s) du sitemap vérifiée(s) (canonical, title, description) : ` +
    (défauts.length ? `${défauts.length} défaut(s) nommé(s) ci-dessous` : 'conformes') +
    (notes.length ? ` (${notes.join(' ; ')})` : '') +
    '.';
  const echantillon = jobSampleNotices(jobs);
  // CE QUI N'A PAS ÉTÉ JUGÉ, nommé. Le plafond n'est plus un angle mort : la
  // fenêtre tourne, et la passe dit quelles pages elle laisse aux suivantes (et
  // en combien de passes la couverture est complète).
  const noticeNonJugees = tourne
    ? [
        `Pages — non jugées par la passe ${fenetre.passe}/${fenetre.tours} (${nonJugees.length}) : ` +
          `${nonJugees.map((url) => pathOf(url)).join(', ')} — échantillonnage tournant, couverture ` +
          `complète en ${fenetre.tours} passes.`,
      ]
    : [];
  return {
    notices: [
      résumé,
      ...défauts.map((d) => `Pages — ${d}`),
      ...premisses.map((p) => `Pages — ${p}`),
      ...noticeNonJugees,
      ...echantillon.notices,
    ],
    défauts: [...défauts, ...echantillon.défauts],
    premisses: [...premisses, ...(echantillon.premisses || [])],
    fenetre,
    nonJugees,
    avertissements: echantillon.avertissements,
  };
}

/**
 * @param {object} [options]
 * @param {string} [options.base] Base sondée (KOJO_LHCI_BASE_URL, sinon SITE_ORIGIN).
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @returns {Promise<{skipped: boolean, notices: string[]}>} `skipped` : rien à
 *   conclure (base locale, ou accueil injoignable) — jamais un échec.
 */
export async function runSeoProductionReport({
  base = process.env.KOJO_LHCI_BASE_URL || SITE_ORIGIN,
  fetchImpl = fetch,
  strict = false,
  graine,
  env = process.env,
  jour,
} = {}) {
  const cleanBase = String(base).trim().replace(/\/+$/, '');
  // « Base locale » : la question appartient à `isLoopbackUrl`
  // (scripts/site-meta.js), posée une seule fois pour tous les gardes.
  if (isLoopbackUrl(cleanBase)) {
    return {
      skipped: true,
      manquantes: [],
      avertissements: [],
      notices: [
        `base locale (${cleanBase}) : les intégrations SEO/analytics s'activent par ` +
          "variables d'environnement posées sur Vercel — un build local ne dit rien de " +
          'la production, aucune conclusion publiée.',
      ],
    };
  }

  let html;
  try {
    const response = await fetchImpl(`${cleanBase}/`, {
      redirect: 'follow',
      headers: PROBE_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    html = await response.text();
  } catch (error) {
    return {
      skipped: true,
      manquantes: [],
      avertissements: [],
      notices: [`accueil non lisible (${error.message}) : aucune conclusion.`],
    };
  }

  const analysis = analyzeSeoServedHtml(html);
  const sitemap = await readSitemap(cleanBase, fetchImpl);
  // La SECONDE source des fiches : l'API publique des missions, sur la même
  // origine. Elle sert à juger les fiches que le sitemap n'énumère pas, et à
  // distinguer « aucune mission vivante » d'un sitemap muet (cf. l'en-tête).
  const apiJobs = await readPublicJobs(cleanBase, fetchImpl);
  // La section « Pages » suit le sitemap SERVI : ce qu'un sitemap annonce doit
  // être servi avec ses métadonnées. Son HTML n'est lu que si le sitemap l'est.
  const pages = await checkSitemapPages({
    locs: sitemap.locs || [],
    fetchImpl,
    homeHtml: html,
    apiJobs,
    // La fenêtre tourne d'une passe à l'autre : deux runs successifs ne jugent
    // pas les mêmes 20 pages, mais `tours` passes les jugent toutes.
    graine: graineFenetre({ graine, env, jour }),
  });
  const pagesRapport = pagesNotices(sitemap.error ? { error: sitemap.error, jobs: pages.jobs } : pages);
  const presentes = INTEGRATIONS.filter(({ key }) => analysis[key].present);
  const requises = INTEGRATIONS.filter(({ required }) => required);
  // Ce que le mode strict refuse : les intégrations REQUISES absentes, nommées
  // avec la variable à poser, et chaque page du sitemap qui n'annonce pas ses
  // métadonnées — sinon un rouge ne dirait pas quoi corriger. Une intégration
  // facultative absente est publiée en notice et n'entre pas ici.
  const manquantes = [
    ...requises
      .filter(({ key }) => !analysis[key].present)
      .map((integration) => noticeFor(integration, analysis[integration.key])),
    ...pagesRapport.défauts.map((défaut) => `Pages — ${défaut}`),
  ];
  return {
    skipped: false,
    manquantes,
    // Les pages qu'un défaut de TRANSPORT a empêchées d'être jugées : publiées
    // en `::warning`, et refusées (code 2) quand rien d'autre ne rougit — une
    // sonde qui n'a pas mesuré ne se déclare jamais verte.
    premisses: pagesRapport.premisses || [],
    // Ce que la passe a jugé, et ce qu'elle laisse aux suivantes.
    fenetre: pages.fenetre || null,
    nonJugees: pages.nonJugees || [],
    analyse: analysis,
    pages: pages.checked,
    jobPages: pages.jobs.checked,
    // Le détail de l'échantillon (sources, erreurs de lecture) : ce qui fait
    // qu'un échantillon vide est mesuré plutôt que subi.
    jobSample: pages.jobs,
    // Les surfaces aveugles DÉCLARÉES (corpus vide) : publiées en `::warning`.
    avertissements: pagesRapport.avertissements || [],
    notices: [
      ...INTEGRATIONS.map((integration) => noticeFor(integration, analysis[integration.key])),
      `${presentes.length}/${INTEGRATIONS.length} intégration(s) présente(s) sur ${cleanBase} ` +
        `(dont ${presentes.filter(({ required }) => required).length}/${requises.length} requise(s)) — ` +
        (strict
          ? 'cette sonde BLOQUE sur les intégrations REQUISES, pas sur les facultatives (cf. CI-COVERAGE.md, F9).'
          : 'ce rapport ne bloque rien (cf. CI-COVERAGE.md, F9).'),
      canonicalNotice(canonicalHref(html), SITE_ORIGIN),
      sitemapNotice(sitemap, SITE_ORIGIN),
      ...pagesRapport.notices,
    ],
  };
}

/**
 * Le code de sortie du mode STRICT — trois classes, jamais deux, et la plus
 * grave gagne : un refus nommé (1) prime sur une prémisse (2), qui prime sur un
 * vert (0). Une sonde qui n'a pas mesuré ne sort JAMAIS en 0.
 */
export function codeDeSortieStrict({ skipped = false, manquantes = [], premisses = [] } = {}) {
  if (skipped || manquantes.length) return 1;
  return premisses.length ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // ── Deux modes, et pourquoi ────────────────────────────────────────────────
  // INFORMATIF (le défaut, ce que lance un run de poste) : une configuration
  // incomplète est un fait d'exploitation, pas une régression de code — un rouge
  // sur chaque PR bloquerait des fusions pour une variable que personne n'a
  // encore obtenue. La CI ne le lance plus : son étape de `ci.yml` a été retirée
  // le 10/10/2026.
  // STRICT (--strict, la sonde QUOTIDIENNE — le seul mode de la CI) : c'est ce
  // mode qui met fin au silence. Une intégration absente, ou une sonde qui ne
  // peut pas conclure, ÉCHOUE bruyamment — sans bloquer une PR.
  const strict = process.argv.includes('--strict');
  const flag = process.argv.indexOf('--base');
  const result = await runSeoProductionReport(
    flag === -1 ? { strict } : { base: process.argv[flag + 1], strict }
  );
  console.log(
    `Sonde SEO de la production — ${result.skipped ? 'sans verdict' : 'verdict publié'}${strict ? ' [strict]' : ''}`
  );
  for (const notice of result.notices) console.log(`::notice title=SEO production::${notice}`);
  // Une surface AVEUGLE (corpus vide, les deux sources concordantes) est
  // BRUYANTE dans les deux modes : `::warning` nommant le chemin non mesuré, son
  // motif et son remède. Non déclarée, elle est passée en DÉFAUT et refusée par
  // le mode strict (l'erreur, elle, est publiée ci-dessous).
  for (const avertissement of result.avertissements || []) {
    console.log(`::warning title=Surface aveugle (corpus vide)::${avertissement}`);
  }
  // Une page que le TRANSPORT n'a pas laissé lire est BRUYANTE dans les deux
  // modes : elle n'est pas un défaut, mais elle ne doit pas disparaître non plus.
  for (const premisse of result.premisses || []) {
    console.log(`::warning title=Page non mesurée::${premisse}`);
  }
  if (strict) {
    // Une sonde qui ne peut pas conclure échoue : un « sans verdict » vert
    // voudrait dire « rien de cassé » alors que rien n'a été mesuré.
    const echecs = result.skipped
      ? ['sonde sans verdict : la production n’a pas pu être lue — aucune conclusion n’est possible']
      : result.manquantes;
    for (const echec of echecs) {
      console.error(`::error title=SEO production::${echec}`);
    }
    // ── TROIS SORTIES, JAMAIS DEUX (cf. les sondes de document) : 1 = refus
    //    nommé (la production a répondu quelque chose de fautif) ; 2 =
    //    PRÉMISSE (la page n'a pas pu être lue, rien n'a été jugé) ; 0 = vert.
    //    Mesuré le 01/11/2026 : un délai réseau après `deploy-fly` a rendu un 1
    //    qui accusait le sitemap d'annoncer une page non servie.
    process.exitCode = codeDeSortieStrict({ ...result, manquantes: echecs });
  }
}
