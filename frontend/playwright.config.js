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
    //     inertiel, capture du premier appui) ;
    //   • `carte-facade` — l'appui qui monte la carte tierce : ce qu'on mesure
    //     est l'instant où la requête PART, et il n'est pas le même d'un moteur
    //     à l'autre (un moteur qui préchargerait l'iframe ferait payer le tiers
    //     au premier écran). Ce parcours a remplacé `carte-accueil`, supprimé
    //     avec la refonte de l'accueil (#152/#157) : le registre a suivi, et
    //     c'est le garde qui l'a exigé ;
    //   • `tiers-apres-interaction` — le geste APRÈS lequel le seul tiers
    //     autorisé est contacté : ce qui dépend du moteur est l'ORDRE entre la
    //     requête du geste et la peinture, donc la fenêtre dans laquelle la
    //     sonde lit le journal.
    //
    // Le périmètre est tenu par `scripts/__tests__/check-moteurs-gestes.test.js` :
    // un parcours qui mesurerait un geste sans être rejoué ici est REFUSÉ — le
    // figer en commentaire l'aurait laissé dériver.
    {
      name: 'firefox',
      testMatch: /(appuis-exterieurs|notifications|barres-rupture|carte-facade|tiers-apres-interaction)\.spec\.js/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testMatch: /(appuis-exterieurs|notifications|barres-rupture|carte-facade|tiers-apres-interaction)\.spec\.js/,
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
