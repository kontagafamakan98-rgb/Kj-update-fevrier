import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // `ecarts-moteurs` est déclaré APRÈS `html`, et l'ordre est le sujet : les
  // rapporteurs sont appelés dans cet ordre, le rapporteur HTML efface puis
  // régénère `playwright-report/` dans SON `onEnd`, et le nôtre y dépose le
  // résumé des écarts APRÈS — un fichier écrit plus tôt serait perdu (mesuré
  // dans la source de Playwright 1.63.0, cf. e2e/reporters/ecarts-moteurs.js).
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['./e2e/reporters/ecarts-moteurs.js']]
    : 'list',
  // Les relevés par moteur : vidés avant la suite, agrégés après elle. C'est le
  // seul moment où les trois projets coexistent (un processus de travail par
  // projet), donc le seul endroit où un ÉCART se calcule — voir
  // e2e/helpers/moteurs.js et e2e/global-teardown-moteurs.js.
  globalSetup: './e2e/global-setup-moteurs.js',
  globalTeardown: './e2e/global-teardown-moteurs.js',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Les PREUVES D'APPUI rejouées sur les deux autres moteurs.
    //
    // Chromium n'est pas le sujet : la séquence d'événements d'un appui au
    // doigt est un fait de MOTEUR, et le panneau de notifications se ferme sur
    // `mousedown` puis agit sur `click` — deux mécanismes qui dépendent de
    // l'ordre et de la présence des événements de compatibilité. Un moteur qui
    // n'émettrait pas `mousedown` après un appui tactile, ou qui l'émettrait
    // AVANT le `touchend`, referait la panne historique (« l'appui ne supprime
    // jamais ») sans qu'aucun cas Chromium ne le voie.
    //
    // Le périmètre est DÉLIBÉRÉMENT limité aux parcours qui MESURENT DES
    // GESTES : rejouer les 150 cas de la suite sur trois moteurs triplerait le
    // job pour des assertions qui ne portent pas d'événements. La suite entière
    // reste mesurée sur Chromium.
    //
    // ── Ce que le périmètre couvre, geste par geste (28/09/2026) ────────────
    //   • `appuis-exterieurs` — l'appui du doigt sur une commande de la barre :
    //     la séquence d'événements de compatibilité, sur laquelle ce fichier
    //     repose entièrement ;
    //   • `notifications` — le même appui, sur le panneau qui se ferme à
    //     `mousedown` et AGIT à `click`, plus le cas qui PUBLIE la séquence ;
    //   • `barres-rupture` — la BASCULE de taille (rotation d'un téléphone), la
    //     molette et l'ouverture du tiroir : trois gestes qui dépendent du
    //     moteur pour des raisons différentes (re-mise en page, défilement
    //     inertiel, capture du premier appui).
    //
    // ── DEUX PARCOURS EN SONT HORS, ET C'EST MESURÉ (08/10/2026) ────────────
    // Le premier passage de CI qui a réellement exécuté ce périmètre (run
    // 37772882341) a rendu 22 cas rouges, TOUS dans `carte-facade` et
    // `tiers-apres-interaction`, sur `firefox` et `webkit` :
    //   • `tiers-apres-interaction` lit le CDP (`Network.enable`) — hors
    //     Chromium, Playwright refuse la session. Ce parcours ne PEUT donc pas
    //     être rejoué ailleurs ; mesurer les tiers sur trois moteurs demande une
    //     sonde SANS CDP, et c'est un travail à faire, pas à simuler ;
    //   • `carte-facade` : son harnais (`e2e/helpers/parcours-carte.js`) rougit
    //     sur ces deux moteurs (« la façade n'a pas pu être amenée dans le
    //     viewport », et le cas de la carte différée).
    // Les deux gardent leur entrée au REGISTRE, marquée `horsPerimetre` avec sa
    // raison et sa preuve : le périmètre ne peut donc pas les rapetisser en
    // silence, et le garde refuse qu'on les exclue sans preuve vérifiable.
    //
    // Le périmètre est tenu par `scripts/__tests__/check-moteurs-gestes.test.js` :
    // un parcours qui mesurerait un geste sans être déclaré ici est REFUSÉ — le
    // figer en commentaire l'aurait laissé dériver.
    {
      name: 'firefox',
      testMatch: /(appuis-exterieurs|notifications|barres-rupture)\.spec\.js/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testMatch: /(appuis-exterieurs|notifications|barres-rupture)\.spec\.js/,
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: [
    {
      command: 'node scripts/playtest-api-server.mjs',
      url: 'http://127.0.0.1:8123/health',
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30000,
    },
    {
      command: 'npm run preview -- --port 4173 --host 127.0.0.1',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30000,
    },
  ],
});
