/**
 * Garde TBT DESKTOP — un plafond PAR ROUTE, chacun adossé à SA mesure.
 *
 * ── Pourquoi une SECONDE config, et pas une entrée de plus ─────────────────
 * `lighthouserc.cjs` audite 13 pages en condition MOBILE simulée (CPU ×4 + 4G
 * lente) et y plafonne le TBT à 1600 ms (repli local) / 1200 ms (déploiement) :
 * ces plafonds sont dimensionnés pour un runner partagé, ce ne sont pas des
 * seuils d'audit. Les `settings` d'un collect valent pour TOUTES ses URLs — on
 * ne peut donc pas demander « cette page-ci, en desktop » à la même passe. D'où
 * une passe à part, qui n'audite QUE l'accueil, en `preset: 'desktop'`.
 *
 * `preset` est une option du CLI Lighthouse (`cli/bin.js` charge
 * `core/config/<preset>-config.js`) et lhci transmet `settings` au CLI via
 * `--cli-flags-path` (`@lhci/cli/src/collect/node-runner.js`) : c'est donc bien
 * la config desktop qui s'applique — ni bridage CPU, ni 4G simulée. Sans ce
 * champ, cette passe mesurerait un TBT mobile sous un plafond de 200 ms, et un
 * run de runner affamé la ferait rougir au hasard (1397 ms déjà mesurés pour un
 * commit vert, voir lighthouserc.cjs).
 *
 * ── Les plafonds : par route, et MESURÉS ───────────────────────────────────
 * Ils vivent dans `scripts/lhci-cls-budgets.cjs`, chacun avec son relevé.
 * L'accueil garde le seuil de l'audit qui a ouvert le chantier (« TBT
 * (Desktop) 477 ms — should be < 200 ms ») : 200 ms, soit 13× sa pire mesure
 * (15 ms sous saturation CPU sur 8 cœurs). /jobs porte désormais le SIEN.
 *
 * ── /jobs : 27 runs, 0 ms, quatre conditions ───────────────────────────────
 * Mesure desktop reprise le 24/09/2026 après le correctif de la première visite
 * (le squelette n'y est plus monté deux fois) : Lighthouse 12.6.1, Chrome NEUF à
 * chaque run, même machine, même session —
 *
 *   condition                              runs   TBT      plus longue tâche   Style & Layout
 *   pile de la CI (serveur de rewrites)       6   0 ms     0 ms                73–76 ms
 *   + 4 boucles CPU sur 8 cœurs               6   0 ms     0 ms                93–119 ms
 *   + bord de CDN froid (+120 ms/actif)       5   0 ms     0 ms                73–76 ms
 *   + 7 boucles CPU sur 8 cœurs (famine)      4   0 ms     0 ms                105–149 ms
 *   production, 9 runs à chaud (avant fix)         0 ms ×8, 8 ms au pire        83–130 ms
 *   production, 1er run à froid (avant fix)        1076 ms                 2397 ms
 *
 * Le mode « mauvais » n'était pas un coût de la page : c'est le PREMIER run à
 * froid d'un déploiement frais, dont la tâche de 888 ms était du `Style &
 * Layout` attribué au chunk `jobs` (dont l'évaluation de script ne faisait que
 * 5 ms), sans aucun tiers (`third-party-summary` vide). C'est ce mode que le
 * correctif de la première visite a supprimé, et la colonne « bord de CDN
 * froid » est là pour l'éprouver sans déployer : +120 ms sur chaque actif, et le
 * TBT reste à 0 ms avec un Style & Layout identique à celui d'une machine au
 * repos (73–76 ms). Le plafond de 150 ms est choisi sur une BORNE HAUTE du coût
 * de la page (149 ms de travail de style et de mise en page sous famine, donc
 * ~99 ms de blocage si tout coalesait en une tâche) et reste 7× SOUS le mode
 * froid mesuré — c'est-à-dire qu'il continue de l'attraper s'il redevenait
 * permanent. Le détail du raisonnement est dans `TBT_DESKTOP_BUDGETS`.
 *
 * ── Aucun élargissement par SURFACE, contrairement au socle mobile ──────────
 * `lighthouserc.cjs` élargit ses plafonds sur une base loopback (1600 au lieu de
 * 1200) parce que le runner y reste partagé. Ici la mesure dit l'inverse, et
 * c'est elle qui tranche : le preset desktop n'applique AUCUN bridage CPU, donc
 * un runner affamé allonge le travail de la page (Style & Layout de 73 à 149 ms)
 * sans jamais créer de tâche longue — 0 ms de TBT sur les 27 runs, famine
 * comprise. Un plafond élargi sur la pile locale n'aurait donc rien à couvrir, et
 * il masquerait la seule surface où la mesure est stable aujourd'hui (celle que
 * le job exécute réellement depuis le 20/09/2026).
 *
 * C'est le MEILLEUR des 3 runs qui est comparé : les trois runs d'un job
 * partagent la même arborescence et la même arête de cache, et une régression de
 * l'artefact monte dans les trois — c'est la même règle que le socle mobile, où
 * un runner affamé a valu 1397 ms pour un arbre vert.
 *
 * SURFACE : cette passe est ANONYME, et /jobs n'est pas une route privée
 * (`scripts/check-spa-routes.js` la classe publique) : rien ne redirige, donc
 * l'URL auditée est bien celle qui est assertée. La passe mobile, elle, envoie
 * le jeton du compte CI et couvre donc AUSSI le rendu connecté de /jobs — les
 * deux rendus sont ainsi mesurés, chacun par la passe qui l'exerce.
 *
 * ── Ce qui est ASSERTÉ, et rien de plus ───────────────────────────────────
 * Le TBT, au MEILLEUR des 3 runs (comme le socle mobile : le bruit d'un runner
 * ne peut qu'AJOUTER du temps, donc le meilleur run décrit le coût propre de
 * l'artefact, quand une régression monte dans les trois), et le plafond CLS de
 * la route. Ce dernier vient de `scripts/lhci-cls-budgets.cjs` — la table
 * mesurée — pour qu'aucune page auditée ne puisse l'être sans plafond de mise en
 * page ; une route absente de cette table fait échouer le chargement de CE
 * fichier, donc la passe entière.
 *
 * Le score, le FCP et le LCP ne sont PAS réassertés ici : ils le sont déjà, sur
 * 13 pages, par la passe mobile, avec les mesures qui les justifient — et pour
 * /jobs le socle mobile les exclut lui-même (son LCP est le moment où la réponse
 * de `GET /api/jobs` est connue, son score le pèse). Les dupliquer en desktop,
 * sans relevé desktop qui les adosse, multiplierait les refus sans rien mesurer
 * de plus.
 *
 * ── Variables d'env ───────────────────────────────────────────────────────
 * `KOJO_LHCI_BASE_URL` (comme lighthouserc.cjs) : déploiement réel, preview
 * Vercel, ou pile locale du job. Aucun jeton n'est nécessaire — l'accueil est
 * public — et `KOJO_LHCI_LOCAL_STACK` ne change RIEN ici : le plafond est le
 * même sur les deux surfaces, puisque c'est la mesure desktop qui le fixe.
 */
const {
  REQUETES_HORS_CONTROLE,
  clsAssertionMatrix,
  TBT_DESKTOP_BUDGETS,
  plafondTbtDesktop,
} = require('./scripts/lhci-cls-budgets.cjs');

// PÉRIMÈTRE : les deux pages dont on a un TBT desktop MESURÉ. L'accueil est la
// page sur laquelle l'audit a relevé 477 ms ; /jobs est la plus lourde du site
// (liste de missions, images) et la seule autre page publique dont l'audit
// signalait du JavaScript inutilisé. Aucune page PROTÉGÉE n'est ici : leur
// grandeur dépend de l'état du compte CI, donc un plafond y manquerait de mesure
// pour l'adosser.
const ROUTES_DESKTOP = ['/', '/jobs'];

const baseUrl = (process.env.KOJO_LHCI_BASE_URL || '').trim().replace(/\/$/, '');
const localBase = 'http://localhost:4173';

module.exports = {
  ci: {
    collect: {
      url: ROUTES_DESKTOP.map((route) =>
        route === '/' ? `${baseUrl || localBase}/` : `${baseUrl || localBase}${route}`
      ),
      numberOfRuns: 3,
      settings: {
        chromeFlags: '--no-sandbox --headless=new --disable-gpu --disable-dev-shm-usage',
        preset: 'desktop',
        // MÊME liste que la passe mobile : une seconde liste pourrait oublier un
        // motif, et la requête lente redéciderait le verdict par cette porte-là.
        blockedUrlPatterns: Object.keys(REQUETES_HORS_CONTROLE),
      },
    },
    assert: {
      // Le TBT (meilleur des 3 runs) ET le plafond CLS de la route : l'un et
      // l'autre passent par une table de valeurs MESURÉES, donc une page sans
      // CLS mesuré — comme une page sans plafond TBT desktop — fait échouer le
      // chargement de cette config, et la passe entière avec elle.
      // Le socle est une FONCTION de la route : chaque page porte le plafond que
      // sa propre mesure supporte (cf. TBT_DESKTOP_BUDGETS).
      assertMatrix: clsAssertionMatrix(ROUTES_DESKTOP, (route) => ({
        'total-blocking-time': ['error', { maxNumericValue: plafondTbtDesktop(route) }],
      })),
    },
    upload: {
      // SOUS-DOSSIER, pas le dossier de la passe mobile : les deux passes
      // auditent la MÊME URL le même jour, donc les mêmes noms de fichiers, et
      // la seconde écraserait le `manifest.json` de la première. L'artifact CI
      // (`frontend/lhci-reports`) reste unique : il ramasse le sous-dossier, donc
      // un rouge se diagnostique sans changer le workflow.
      target: 'filesystem',
      outputDir: './lhci-reports/desktop',
    },
  },
};
