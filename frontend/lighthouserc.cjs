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
 * CLS : les budgets sont PAR ROUTE (voir scripts/lhci-cls-budgets.cjs et son
 * en-tête : table mesurée, marges justifiées, et refus d'auditer une page sans
 * budget). Le plafond global de 0,15 a été remplacé le 18/09/2026 : il tolérait
 * la régression fine des pages d'auth (0,0165 mesuré sur /register avant #19).
 *
 * Variables d'env injectées par le job CI :
 *   KOJO_LHCI_BASE_URL     base (ex https://x.vercel.app ou http://localhost:4173)
 *   KOJO_LHCI_AUTH_HEADER  JSON {"Authorization": "Bearer <token>"} pour les pages
 *                          protégées. Vide si non fourni.
 */
// Les budgets CLS PAR ROUTE et la matrice d'assertions : propriété de
// scripts/lhci-cls-budgets.cjs (la table mesurée vit avec sa justification, et
// un test l'éprouve contre le résolveur de @lhci/utils lui-même).
const { CLS_BUDGETS, REQUETES_HORS_CONTROLE, clsAssertionMatrix } = require('./scripts/lhci-cls-budgets.cjs');

// Les requêtes de DONNÉES bloquées pendant le collect, dérivées de la table qui
// porte leur justification (scripts/lhci-cls-budgets.cjs) : un motif, pas une
// liste écrite deux fois. Motifs SANS hôte, donc valables sur la production
// comme sur une preview Vercel ou le repli loopback.
const blockedUrlPatterns = Object.keys(REQUETES_HORS_CONTROLE).map((chemin) => `*${chemin}*`);

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
//   • une carte dédiée dont la page est absente d'ici fait ÉCHOUER la
//     dérivation, donc `vite build` (scripts/check-og-images.js, deriveRoutes) :
//     une carte se déclare par son nom de fichier, donc ce slug ne serait servi
//     à aucune page et disparaîtrait de la table sans que rien ne le signale.
// Les 4 pages ajoutées le 18/09/2026 (/login, /payment, /how-it-works, /support)
// sont exactement celles qui étaient pré-rendues hors du périmètre : /login
// portait même une carte DÉDIÉE (og-login.png) que personne ne vérifiait.
// /payment est protégée — le Bearer du job CI la rend comme un utilisateur
// connecté, ce que sa coquille pré-rendue décrit déjà.
const LOCAL_FALLBACK_PATHS = ['/'];
// Les trois pages de CONFIANCE (/about, /contact, /privacy) sont dans cette
// liste : c est elle qui decide quelles coquilles le build ecrit, donc quelles
// pages un crawler sans JavaScript peut lire. Elles n ont pas de carte OG
// dediee, la carte generique les sert.
//
// ⚠️ AUCUN commentaire A L INTERIEUR du tableau : deux extracteurs le lisent
// naivement — le build y prend le texte entre apostrophes, le test de cette
// config y coupe sur les virgules. Un commentaire place la est donc lu comme
// une page. Le mode d emploi reste ici, hors des crochets.
const DEPLOYMENT_PATHS = [
  '/',
  '/jobs',
  '/login',
  '/register',
  '/forgot-password',
  '/payment',
  '/how-it-works',
  '/support',
  '/about',
  '/contact',
  '/privacy',
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
      settings: {
        chromeFlags: '--no-sandbox --headless=new --disable-gpu --disable-dev-shm-usage',
        extraHeaders,
        // ── Pourquoi des requêtes sont BLOQUÉES ────────────────────────────
        // L'audit doit mesurer l'ARTEFACT, or une requête d'API décidait du
        // verdict : la requête LENTE nommée par le job rouge du 20/09/2026
        // (13:54) est `GET /api/geolocation/available-countries`, et le LCP de
        // /login y a valu 3 836 / 3 781 / 3 912 ms pour un FCP de 1 028 ms —
        // même code que le job vert de 12:29, qui le mesurait à 1 767 ms. Une
        // grandeur décidée par un tiers ne peut pas bloquer un merge : elle est
        // retirée du CHEMIN DE MESURE (Lighthouse applique ces motifs via CDP,
        // la requête échoue immédiatement et la page peint ce que l'artefact
        // lui donne). Mesuré avec le serveur de rewrites local, même build :
        // /login 1 479 ms → 1 112 ms. Les budgets sont INCHANGÉS.
        //
        // Les requêtes d'AUTHENTIFICATION ne sont pas bloquées : les pages
        // protégées doivent rester rendues avec le compte CI (sinon elles
        // redirigeraient vers /login et deux URLs porteraient le même LHR).
        //
        // Une page dont la RÉPONSE *est* le plus grand peintre (/jobs : 2 727 ms
        // avec la liste, 4 256 ms avec l'état vide, 5 177 ms la requête
        // bloquée) n'est pas corrigée par ce blocage : son LCP et son score ne
        // sont pas assertés (voir `LCP_PRODUIT_PAR_UNE_REPONSE`).
        blockedUrlPatterns,
      },
    },
    assert: {
      // ── Un socle ET un budget CLS PAR ROUTE (plus d'entrée globale) ─────
      // L'entrée globale (sans motif) a été retirée le 20/09/2026 : elle
      // appliquait le MÊME jeu de budgets à toutes les pages, donc une exception
      // justifiée sur une seule (voir plus bas) aurait affaibli toutes les
      // autres. Chaque route porte désormais son socle, et une route dont une
      // grandeur est produite par un tiers n'en porte pas moins : elle en porte
      // moins (voir « Le LCP de /jobs », dans l'en-tête de
      // scripts/lhci-cls-budgets.cjs, qui possède la table et la décision).
      //
      // ── Un budget CLS PAR ROUTE, plus un socle commun ───────────────────
      // `assertMatrix` est EXCLUSIF d'`assertions`, `preset`, `budgetsFile` et
      // `aggregationMethod` (@lhci/utils/src/assertions.js lève « Cannot use
      // assertMatrix with other options ») : l'agrégation est donc portée par
      // CHAQUE entrée, sinon lhci refuserait la config. La table des budgets
      // CLS — et les mesures qui les justifient — vit dans
      // scripts/lhci-cls-budgets.cjs ; une page auditée sans budget MESURÉ fait
      // échouer le chargement de cette config (voir clsAssertionMatrix).
      //
      // ── Quelle statistique pour quelle grandeur ─────────────────────────
      // Le socle commun est mesuré au MEILLEUR des 3 runs (`optimistic`), le CLS
      // par route reste à la MÉDIANE. Le pourquoi est mesuré, pas choisi : deux
      // jobs de `main` du 20/09/2026 sur le MÊME arbre (14e0531) ont rendu deux
      // verdicts — vert à 08:10, rouge à 08:50 — et le rouge ne tenait qu'à
      // `categories:performance` sur `/login` (médiane 0,79 ; runs 1,00 / 0,79 /
      // 0,77). Les budgets explicites ci-dessous sont passés dans les deux. Ce
      // qui avait bougé : sur `/login`, mêmes octets, `Script Evaluation`
      // 174 ms → 995 ms et une tâche de 908 ms sur un run — le runner avait
      // faim. Le bruit d'un runner est UNILATÉRAL : il ne peut qu'ajouter du
      // temps, donc le meilleur run décrit le coût propre de l'artefact, tandis
      // qu'une régression monte dans les trois. Le CLS, lui, ne dépend pas de la
      // machine (relevé identique d'un run à l'autre) : la médiane y reste la
      // statistique la plus stricte ET la plus stable. Détail complet dans
      // scripts/lhci-cls-budgets.cjs, qui possède les deux. AUCUN seuil n'a été
      // relevé dans cette passe : seule la statistique comparée au seuil a
      // changé.
        // ── Ce que la matrice porte PAR ROUTE ───────────────────────────────
      // `clsAssertionMatrix` construit une entrée par page : le socle ci-dessous
      // (score, FCP, LCP, TBT) puis son plafond CLS. Deux raisons de ne pas
      // écrire un socle global (vérifié par
      // scripts/__tests__/lhci-cls-budgets.test.js) :
      //   • lhci refuse un motif qui couvrirait deux URLs (« Can only assert one
      //     URL at a time! »), donc un socle par route est le seul moyen
      //     d'attacher un budget à UNE page (c'est ce qui porte le CLS) ;
      //   • c'est aussi la seule forme où une exception FUTURE tiendrait sur une
      //     page sans affaiblir les autres — l'entrée globale rendait toute
      //     exception contagieuse.
      assertMatrix: clsAssertionMatrix(auditedPaths, {
        // ── Socle commun, mesuré le 16/09/2026 (3 runs par page, médianes) ──
        //   page        score  FCP ms  LCP ms  TBT ms (médiane, détail)
        //   /           0,99    1263    1263       1  [2878, 1, 0]
        //   /dashboard  0,98    1395    2386       0  [0, 0, 0]
        //   /jobs       0,94     969    2057      30  [665, 12, 30]
        //   /profile    0,97    1399    2496       2  [7, 2, 0]
        // Les TBT par run montrent la distribution réelle d'un runner partagé :
        // 0-30 ms le plus souvent, jusqu'à 2878 ms sur un run. C'est pourquoi
        // numberOfRuns=3 est indispensable, et pourquoi la grandeur comparée au
        // seuil est le MEILLEUR des 3 (voir « Quelle statistique pour quelle
        // grandeur ») : une mesure unique serait une pièce de monnaie, et une
        // médiane sur 3 runs l'est presque autant quand un run sur trois
        // souffre.
        'categories:performance': ['error', { minScore: 0.9 }],
        // LCP : pire meilleur-run mesuré 2587 ms sur les 2 jobs de main du
        // 20/09/2026 (39 runs, 13 pages) — la marge reste ~1,4×. Ce plafond
        // n'est PAS relevé : la route dont le LCP est produit par une réponse
        // d'API n'est simplement plus assertée sur cette grandeur (elle garde
        // FCP, TBT et CLS) — voir `LCP_PRODUIT_PAR_UN_TIERS`.
        'largest-contentful-paint': ['error', { maxNumericValue: 3500 }],
        // TBT : interactivité. Le plafond du repli local est plus large et
        // documenté ici parce que ce repli tourne sur un runner partagé (même
        // commit : 516 ms puis 1397 ms), plutôt que de laisser la CI rougir au
        // hasard. Les deux plafonds sont INCHANGÉS par la passe du 20/09/2026 :
        // c'est la statistique qui a changé, pas le budget. Comparés au meilleur
        // des 3 runs, ils ne sont plus frôlés : sur les 2 jobs de main du
        // 20/09/2026, le pire meilleur-run vaut 10 ms (déploiement réel).
        'total-blocking-time': [
          'error',
          { maxNumericValue: targetIsLocal ? 1600 : 1200 },
        ],
        // FCP : pire meilleur-run mesuré 1380 ms sur les 2 jobs de main du
        // 20/09/2026 (39 runs, 13 pages) — la marge reste ~1,8×.
        'first-contentful-paint': ['error', { maxNumericValue: 2500 }],
      }),
    },
    upload: {
      target: 'filesystem',
      outputDir: './lhci-reports',
    },
  },
};