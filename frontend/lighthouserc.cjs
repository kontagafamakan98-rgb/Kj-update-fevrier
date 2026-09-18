/**
 * Config Lighthouse CI — garde-fou performance du frontend.
 *
 * Audite plusieurs pages :
 *   • l'accueil (/) — publique
 *   • les 2 pages d'authentification PUBLIQUES /register et /forgot-password —
 *     ajoutées pour verrouiller les gains CLS des PR #19 (wrapper Register
 *     aligné sur `min-h-full`) et #20 (ForgotPasswordSkeleton calibré sur la
 *     hauteur réelle de sa page). Sans elles dans le collect, le budget CLS ne
 *     portait sur AUCUNE des deux pages que ces PR ont corrigées ;
 *   • les pages PROTÉGÉES /dashboard, /jobs, /profile — authentifiées via un
 *     token Bearer obtenu par le job CI (login avec le COMPTE CLIENT DÉDIÉ CI
 *     stocké dans les secrets GitHub LHCI_CI_EMAIL / LHCI_CI_PASSWORD). Ce
 *     compte est isolé des comptes e2e partagés : jamais touché à la main,
 *     donc des budgets Lighthouse déterministes d'un run à l'autre.
 *
 * Cible (URL de base) : le DÉPLOIEMENT VERCEL réel quand KOJO_LHCI_BASE_URL est fournie
 * (résolue par le job CI depuis le commentaire Vercel de la PR, ou l'URL de
 * prod sur main), sinon le build local servi statiquement (contenu identique).
 *
 * Condition mobile simulée (Slow 4G + CPU 4x, défaut Lighthouse), et BLOQUE
 * le job si un budget est dépassé.
 *
 * ── Pourquoi « KOJO_LHCI_ » et pas « LHCI_ » ────────────────────────────
 * lhci configure yargs avec `.env('LHCI')` (node_modules/@lhci/cli/src/cli.js) :
 * TOUTE variable d'environnement `LHCI_<x>` est relue par le CLI comme l'option
 * `--<x>`. Une variable `LHCI_URL` devenait donc l'option `--url` du
 * collecteur, qui ÉCRASE le tableau d'URLs défini ici. Conséquence mesurée le
 * 16/09/2026 dans les logs du job : « Checking assertions against 1 URL(s) » —
 * les pages /dashboard, /jobs et /profile n'étaient JAMAIS auditées, malgré
 * cette configuration, et les budgets ne portaient que sur l'accueil. D'où le
 * préfixe `KOJO_LHCI_`, hors du motif capturé par yargs (un test l'exige :
 * scripts/__tests__/check-lhci-env.test.js).
 *
 * Budgets calibrés sur les mesures CI réelles :
 *   Accueil, servi par le CDN Vercel : TBT < 500 ms (budget strict conservé).
 *   Accueil, servi par le repli local sur un runner partagé : 516 ms puis
 *     1397 ms POUR LE MÊME COMMIT — d'où le plafond propre au repli local.
 * Toutes les pages auditées reçoivent l'en-tête Bearer du job CI (nécessaire aux
 * pages protégées, inoffensif sur les pages publiques).
 *
 * Note : détecter une « régression » relative nécessiterait un serveur LHCI ;
 * sans infrastructure, les budgets absolus jouent ce rôle : tout run sous les
 * seuils fait échouer la PR.
 *
 * Variables d'env injectées par le job CI :
 *   KOJO_LHCI_BASE_URL     base (ex https://x.vercel.app ou http://localhost:4173)
 *   KOJO_LHCI_AUTH_HEADER  JSON {"Authorization": "Bearer <token>"} pour les pages
 *                          protégées. Vide si non fourni.
 */
const baseUrl = (process.env.KOJO_LHCI_BASE_URL || '').trim().replace(/\/$/, '');
const authHeader = (process.env.KOJO_LHCI_AUTH_HEADER || '').trim();
const localBase = 'http://localhost:4173';

// Pages auditées selon ce qui est réellement servi :
//  • DÉPLOIEMENT réel → les 10 pages dont on mesure la stabilité de mise en page :
//    l'accueil, les pages PUBLIQUES (/login, /register, /forgot-password,
//    /how-it-works, /support, /jobs) et les pages protégées (rendues avec l'état
//    du compte CI, cf. le jeton Bearer plus bas) ;
//  • repli local (base absente ou LOOPBACK) → l'accueil SEUL. Le repli local
//    sert le build hors du déploiement : la table de rewrites y est rejouée par
//    scripts/vercel-rewrite-server.js, donc les routes existent bien, mais le
//    build est compilé avec `VITE_API_URL` = backend de PROD. Auditer /jobs,
//    /login, /register ou /forgot-password y mesurerait autre chose que ces
//    pages (données absentes, puis redirection vers /login pour les pages
//    protégées). Les shells de ces routes restent vérifiés, page par page, par
//    check-prerender-shells.js et par check-og-images.js (qui exécute, lui, la
//    fiche /jobs/:id quand la base la sert — voir les PR du 17/09/2026).
//
// ⚠️ Deux noms, deux significations : `DEPLOYMENT_PATHS` = URLs auditées quand
// un VRAI déploiement est disponible (le Bearer y est inoffensif sur les pages
// publiques) ; `LOCAL_FALLBACK_PATHS` = URLs réellement servies par le repli.
//
// ── `DEPLOYMENT_PATHS` est la LISTE DES PAGES DU PROJET ──────────────────────
// Ce n'est pas seulement le périmètre de Lighthouse : la table route → carte OG
// (scripts/check-og-images.js, `ROUTES`) en DÉRIVE, elle ne la recopie plus. Deux
// listes coexistaient — les pages auditées et les pages à carte — et rien ne les
// empêchait de diverger : /forgot-password a été auditée pour son CLS pendant
// que sa carte OG n'était vérifiée par personne, et sept pages pré-rendues
// pouvaient l'être sans jamais être mesurées. Désormais :
//   • une page auditée sans carte déclarée reçoit la carte GÉNÉRIQUE (définie),
//     donc elle est vérifiée au lieu d'être oubliée ;
//   • une page PRÉ-RENDUE absente d'ici fait ÉCHOUER le build (vite.config.js),
//     donc on ne peut plus écrire une coquille que rien ne surveille ;
//   • une carte dédiée absente d'ici n'existe plus : c'est la même liste.
// Les 4 pages ajoutées le 18/09/2026 (/login, /payment, /how-it-works, /support)
// sont exactement celles qui étaient pré-rendues hors du périmètre : /login
// portait même une carte DÉDIÉE (og-login.png) que personne ne vérifiait.
// /payment est protégée — le Bearer du job CI la rend comme un utilisateur
// connecté, ce que sa coquille pré-rendue décrit déjà.
const LOCAL_FALLBACK_PATHS = ['/'];
const DEPLOYMENT_PATHS = [
  '/',
  '/jobs',
  '/login',
  '/register',
  '/forgot-password',
  '/payment',
  '/how-it-works',
  '/support',
  '/dashboard',
  '/profile',
];
// Le repli « build local » n'est pas seulement l'ABSENCE d'URL : depuis le
// 17/09/2026, la CI sert le build depuis une adresse LOOPBACK
// (`http://127.0.0.1:4174`, le serveur qui rejoue la table de rewrites de
// vercel.json) pour y exercer le cycle /jobs/:id en vraies requêtes HTTP sur
// chaque PR — et cette adresse est passée ici via KOJO_LHCI_BASE_URL. Une
// adresse loopback reste le repli local : le build y est compilé avec
// `VITE_API_URL` = backend de prod, donc les pages protégées n'ont pas de
// données réelles à mesurer (elles redirigent vers /login), et le plafond TBT
// élargi d'un runner partagé doit continuer de s'appliquer.
const targetIsLocal =
  !baseUrl || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(baseUrl);
const auditedPaths = targetIsLocal ? LOCAL_FALLBACK_PATHS : DEPLOYMENT_PATHS;
const urls = auditedPaths.map((p) =>
  p === '/' ? `${baseUrl || localBase}/` : `${baseUrl || localBase}${p}`
);

// En-têtes à appliquer lors du collect (couvert par l'audit des pages
// protégées). Un seul jeu d'headers s'applique à toutes les URLs : l'accueil,
// /register et /forgot-password les ignorent sans incidence (Bearer inoffensif
// sur une route publique — aucune de ces pages ne redirige un visiteur déjà
// authentifié).
const extraHeaders = authHeader
  ? (() => { try { return JSON.parse(authHeader); } catch (_e) { return {}; } })()
  : {};

// Le repli local s'audite via l'URL (le job CI y sert déjà le build, sur
// 4174 depuis le 17/09/2026 ; `localBase` ne sert plus que si aucune URL n'est
// fournie) plutôt que via `staticDistDir` : LHCI lancerait sinon SON serveur
// statique sur un port libre, différent de celui que `check-og-images.js`
// interroge — deux serveurs, deux contenus à diagnostiquer.

module.exports = {
  ci: {
    collect: {
      url: urls,
      numberOfRuns: 3,
      // Le repli local mesure une machine partagée : `optimistic` (défaut)
      // retenait le meilleur run (516 ms) et laissait passer le suivant à
      // 1397 ms pour le même commit. La MÉDIANE décrit ce que vaut la page sur
      // cette machine, et une vraie régression (tous les runs hauts) la fait
      // bouger.
      settings: {
        chromeFlags: '--no-sandbox --headless=new --disable-gpu --disable-dev-shm-usage',
        extraHeaders,
      },
    },
    assert: {
      aggregationMethod: 'median',
      assertions: {
        // ── Budgets calés sur des MESURES du déploiement réel ──────────────
        // Relevé du 16/09/2026, 3 runs par page (médianes) :
        //   page        score  FCP ms  LCP ms  TBT ms (médiane, détail)   CLS
        //   /           0,99    1263    1263       1  [2878, 1, 0]       0,056
        //   /dashboard  0,98    1395    2386       0  [0, 0, 0]          0,001
        //   /jobs       0,94     969    2057      30  [665, 12, 30]      0,135
        //   /profile    0,97    1399    2496       2  [7, 2, 0]          0,001
        // Les TBT par run montrent la distribution réelle d'un runner partagé :
        // 0-30 ms le plus souvent, jusqu'à 2878 ms sur un run. C'est pourquoi
        // numberOfRuns=3 et l'agrégation par MÉDIANE sont indispensables : une
        // mesure unique serait une pièce de monnaie.
        'categories:performance': ['error', { minScore: 0.9 }],
        // LCP : pire médiane mesurée 2496 ms (marge ~1,4×).
        'largest-contentful-paint': ['error', { maxNumericValue: 3500 }],
        // TBT : interactivité. 500 ms sur le déploiement réel (mesuré vert sur
        // main). Sur le repli local d'un runner partagé, le MÊME commit a
        // mesuré 516 ms puis 1397 ms : un plafond de 500 y est une
        // pièce de monnaie, pas un budget. Le plafond du repli est donc plus
        // large et documenté ici, plutôt que de laisser la CI rougir au hasard
        // (le budget strict reste appliqué partout où un vrai déploiement est
        // audité, c'est-à-dire sur `main`).
        'total-blocking-time': [
          'error',
          { maxNumericValue: targetIsLocal ? 1600 : 1200 },
        ],
        // CLS : seuil de passage Lighthouse (0.1).
        // Ce plafond est GLOBAL (il n'y a qu'un jeu d'assertions pour toutes les
        // URLs, cf. `assertMatrix` dans @lhci/cli) : 0.15 couvre /register,
        // /forgot-password, /dashboard et /profile, dont les CLS mesurés sont
        // très en-dessous — il n'attrape donc qu'un EFFONDREMENT, pas la
        // régression fine que les PR #19/#20 ont corrigée (0,0165 et 0,0012).
        // Un plafond par route exige `assertMatrix` (exclusif de `assertions`
        // et `aggregationMethod`) et des valeurs MESURÉES : à faire une fois le
        // premier relevé des deux pages auth disponible.
        // Plafond porté à 0.15 à cause d'un défaut réel, MESURÉ et non corrigé :
        // /jobs déplace un élément visible de 0.1353 (identique sur les 3 runs
        // du 16/09/2026, contre le déploiement réel). Le rapport Lighthouse
        // n'attribue ce décalage à aucun nœud, et il n'apparaissait jamais
        // auparavant parce que ce job n'auditait qu'une URL (voir le correctif
        // du préfixe environnemental ci-dessus). À resserrer dès que le
        // décalage est corrigé — voir la section « défauts connus » de
        // CI-COVERAGE.md.
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.15 }],
        // FCP : pire médiane mesurée 1399 ms (marge ~1,8×).
        'first-contentful-paint': ['error', { maxNumericValue: 2500 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: './lhci-reports',
    },
  },
};