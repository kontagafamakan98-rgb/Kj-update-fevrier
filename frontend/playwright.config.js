import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
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
    // Le périmètre est DÉLIBÉRÉMENT limité à ces deux parcours : ce sont eux
    // qui mesurent des gestes, et rejouer les 141 cas de la suite sur trois
    // moteurs triplerait le job pour des assertions qui ne portent pas
    // d'événements. La suite entière reste mesurée sur Chromium.
    {
      name: 'firefox',
      testMatch: /(appuis-exterieurs|notifications)\.spec\.js/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testMatch: /(appuis-exterieurs|notifications)\.spec\.js/,
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
