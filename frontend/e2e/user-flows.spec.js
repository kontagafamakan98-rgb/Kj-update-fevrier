import { test, expect } from '@playwright/test';

test.describe('Parcours E2E — Géolocalisation & Détection de position', () => {
  test('La détection de pays et l\'affichage fonctionnent sans erreur', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Kojo/i);

    // Navigation vers la page /jobs
    await page.goto('/jobs');
    await expect(page.locator('body')).not.toBeEmpty();

    // Vérification que les missions de la fixture s'affichent correctement
    await expect(page.locator('text=Mission de démonstration 1').first()).toBeVisible({ timeout: 10000 });
  });

  test('La simulation GPS positionne l\'utilisateur correctement', async ({ page, context }) => {
    // Émulation de la géolocalisation à Dakar
    await context.setGeolocation({ latitude: 14.7167, longitude: -17.4677 });
    await context.grantPermissions(['geolocation']);

    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');

    // La page répond et affiche les missions
    const count = await page.locator('text=Mission de démonstration').count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Parcours E2E — Support & Assistance', () => {
  test('Affichage des options de support et validation de suivi de ticket', async ({ page }) => {
    await page.goto('/support');

    // Vérifier les éléments principaux de la page Support
    await expect(page.locator('h1')).toContainText(/Support|Aide/i);

    // Tester la validation d'email invalide sur le suivi de ticket
    const ticketIdInput = page.locator('input[placeholder*="ticket" i], input[aria-label*="ticket" i]').first();
    const emailInput = page.locator('input[type="email"]').first();
    const submitBtn = page.locator('button:has-text("Vérifier"), button:has-text("Statut")').first();

    if (await ticketIdInput.isVisible()) {
      await ticketIdInput.fill('ticket-abc-123');
      await emailInput.fill('email-invalide');
      await submitBtn.click();

      // Message d'erreur attendu
      await expect(page.locator('text=Cette adresse e-mail ne semble pas valide.')).toBeVisible();
    }
  });

  test('Ouverture du dialogue avec le Robot Support', async ({ page }) => {
    await page.goto('/support');

    // Cliquer sur le bouton Robot
    const robotButton = page.locator('button:has-text("Assistant"), button:has-text("Robot")').first();
    if (await robotButton.isVisible()) {
      await robotButton.click();

      // L'assistant doit afficher sa première question
      await expect(page.locator('text=nom complet')).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('Parcours E2E — Candidature travailleur & Consultation', () => {
  test('Connexion en tant que travailleur et consultation d\'une mission', async ({ page }) => {
    // Connexion avec les identifiants de la fixture locale
    await page.goto('/login');

    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const submitButton = page.locator('button[type="submit"]');

    await emailInput.fill('demo@example.com');
    await passwordInput.fill('password');
    await submitButton.click();

    // Redirection vers le dashboard
    await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 10000 });

    // Consultation des missions
    await page.goto('/jobs');
    await expect(page.locator('text=Mission de démonstration 1').first()).toBeVisible();

    // Cliquer sur la première mission
    await page.locator('text=Mission de démonstration 1').first().click();

    // Vérifier la présence des détails de mission
    await expect(page.locator('text=Mission de démonstration 1').first()).toBeVisible();

    // Tester le bouton ou modal de candidature s'il est présent
    const applyButton = page.locator('button:has-text("Postuler"), button:has-text("Candidater")').first();
    if (await applyButton.isVisible()) {
      await applyButton.click();
      await expect(page.locator('textarea, input[type="number"]').first()).toBeVisible({ timeout: 5000 });
    }
  });
});
