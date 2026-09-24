/**
 * Garde TBT DESKTOP de l'accueil — le seuil de l'AUDIT, pas un second socle.
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
 * ── Le seuil : 200 ms, MESURÉ ──────────────────────────────────────────────
 * C'est le seuil de l'audit qui a ouvert le chantier (« TBT (Desktop) 477 ms —
 * should be < 200 ms »). Relevé après correctif, Lighthouse 12.6.1 :
 *
 *   surface                        runs   TBT mesuré        tâche la plus longue
 *   production (CDN Vercel)          3    0 / 0 / 0 ms      78 à 92 ms
 *   repli local, machine au repos    3    0 / 0 / 0 ms      81 à 92 ms
 *   repli local, 8 cœurs saturés     3    0 / 0 / 15 ms     92 à 154 ms
 *   (4 boucles CPU, 8 cœurs — le pire cas qu'un runner partagé imite)
 *
 * La dernière ligne est celle qui autorise ce plafond : même sous contention
 * CPU, le desktop reste à 15 ms au pire, avec une tâche la plus longue à 154 ms
 * — sous le seuil de « tâche longue ». 200 ms laisse donc plus de 13× la pire
 * mesure, et c'est précisément ce qui la distingue des plafonds du socle mobile,
 * où un runner affamé a valu 1397 ms pour le même arbre. Le seuil de l'audit est
 * conservé tel quel plutôt que traduit en marge : c'est lui qui sera relu le
 * jour où quelqu'un se demandera pourquoi la CI a rougi.
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
 * 13 pages, par la passe mobile, avec les mesures qui les justifient. Les
 * dupliquer en desktop, sans relevé desktop qui les adosse, multiplierait les
 * refus sans rien mesurer de plus.
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
} = require('./scripts/lhci-cls-budgets.cjs');

// Plafond de TBT desktop, en millisecondes. Justifié par la mesure ci-dessus.
const TBT_DESKTOP_MAX = 200;

// PÉRIMÈTRE : l'accueil, et lui seul. C'est la page sur laquelle l'audit a
// relevé 477 ms, et la seule dont on ait un TBT desktop mesuré — sur les pages
// protégées, la grandeur dépend de l'état du compte CI, donc un plafond y
// manquerait de mesure pour l'adosser.
const ROUTES_DESKTOP = ['/'];

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
      // Le TBT (meilleur des 3 runs) ET le plafond CLS de la route : les deux
      // passent par la table partagée, donc une page sans CLS mesuré ne peut pas
      // être auditée ici non plus.
      assertMatrix: clsAssertionMatrix(ROUTES_DESKTOP, {
        'total-blocking-time': ['error', { maxNumericValue: TBT_DESKTOP_MAX }],
      }),
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
