import { test, expect } from '@playwright/test';

/**
 * Le centre de notifications : supprimer une ligne la retire VRAIMENT.
 *
 * ── Ce que ce parcours couvre, et que jsdom ne peut pas voir ────────────────
 * `Navbar.js` rend DEUX instances du panneau (barres desktop et mobile) et
 * chacune écoute `mousedown` sur le document pour se refermer au clic extérieur.
 * Un appui DANS le panneau visible n'est « à l'intérieur » que pour une seule
 * des deux : l'autre appelait `closePanel()`, le panneau se démontait pendant
 * l'appui, et le `click` n'atteignait plus le bouton — supprimer ne partait
 * jamais, sans requête et sans message (symptôme : « la notification montre
 * toujours 1 et refuse de disparaître »).
 *
 * La séquence qui compte est celle du navigateur : appui PUIS relâchement.
 * `page.click()` l'envoie pour de vrai (`mousedown` → `mouseup` → `click`) sur
 * le bundle compilé, dans un vrai Chromium : c'est la seule exécution où la
 * disparition est observable — un test qui n'enverrait qu'un `click` isolé, ou
 * une doublure de service, passe sans rien mesurer.
 *
 * La fixture est un VRAI serveur : `scripts/playtest-api-server.mjs` sert une
 * notification non lue au compte connecté et traite sa suppression, donc la
 * ligne ne disparaît que si la requête est bien partie.
 */
test.describe('Parcours E2E — le centre de notifications se vide', () => {
  test("un clic sur la croix d'une ligne la supprime, pastille comprise", async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill('demo@example.com');
    await page.locator('input[type="password"]').fill('password');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 10000 });

    // La cloche annonce la non-lue servie par la fixture.
    const cloche = page.locator('button[aria-label^="Notifications"]').first();
    await expect(cloche).toContainText('1', { timeout: 10000 });
    await cloche.click();

    // Le panneau VISIBLE seulement : la barre mobile en rend un second, masqué.
    const panneau = page.locator('[data-notification-panel]:visible').first();
    await expect(panneau).toBeVisible();
    await expect(panneau.getByText('Nouvelle proposition reçue')).toBeVisible();

    await panneau.getByRole('button', { name: 'Supprimer cette notification' }).click();

    // La ligne part, le panneau ouvre son état vide, la pastille tombe.
    await expect(panneau.getByText('Nouvelle proposition reçue')).toHaveCount(0);
    await expect(panneau.getByText('Aucune notification')).toBeVisible();
    await expect(page.locator('button[aria-label^="Notifications"] .bg-red-500')).toHaveCount(0);
  });
});
