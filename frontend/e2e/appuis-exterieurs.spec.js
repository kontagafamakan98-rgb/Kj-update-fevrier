import { test, expect } from '@playwright/test';

/**
 * Un appui qui vise une commande doit ATTEINDRE cette commande — même quand un
 * menu ouvert doit se refermer au passage.
 *
 * ── Le défaut, et pourquoi seule une preuve navigateur le voit ─────────────
 * Le menu de langue et le sélecteur de pays fermaient sur un appui extérieur par
 * une SURFACE PLEIN ÉCRAN (`fixed inset-0`) posée au-dessus de la page. Cette
 * surface CAPTE l'appui : elle devient la cible, et la commande visée ne la
 * reçoit jamais. Mesuré le 25/09/2026 dans Chromium via ce fichier — Playwright
 * retentait le clic sur le lien « Emplois » de la barre, 55 fois de suite, arrêté
 * chaque fois par `<div class="fixed inset-0 z-10">` : tant que le menu de langue
 * était ouvert, le PREMIER appui sur n'importe quelle commande de la barre était
 * perdu, et il fallait appuyer deux fois.
 *
 * C'est le même défaut de fond que le panneau de notifications dupliqué (un
 * appui visant une commande n'atteint pas cette commande), par un autre chemin.
 * jsdom ne peut pas le voir : il ne calcule aucune mise en page et
 * `fireEvent.click(element)` envoie l'appui DIRECTEMENT à l'élément, donc aucune
 * surface ne peut y intercepter quoi que ce soit. La preuve est donc ici, avec
 * de vrais appuis (`mousedown` → `mouseup` → `click`) sur le bundle compilé.
 *
 * Chaque parcours exige les DEUX effets du même geste : la commande visée agit,
 * ET le menu se referme. C'est la propriété que la surface captante rendait
 * impossible.
 */

/** Connexion par le compte de la fixture (scripts/playtest-api-server.mjs). */
async function connexion(page) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill('demo@example.com');
  await page.locator('input[type="password"]').fill('password');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 10000 });
}

/** Ouvre le menu de langue et rend son déclencheur. */
async function ouvrirMenuLangue(page) {
  const declencheur = page.locator('button', { hasText: 'Français' }).first();
  await declencheur.click();
  await expect(page.getByRole('button', { name: /Wolof/ })).toBeVisible();
  return declencheur;
}

test.describe("Parcours E2E — un appui extérieur ferme le menu sans avaler l'appui", () => {
  test("menu de langue ouvert, un SEUL appui sur un lien de la barre le suit", async ({ page }) => {
    await page.goto('/');
    await ouvrirMenuLangue(page);

    // Un seul appui : le lien doit naviguer, et le menu se refermer au passage.
    await page.getByRole('link', { name: 'Emplois' }).first().click();

    await expect(page).toHaveURL(/\/jobs/, { timeout: 10000 });
    await expect(page.getByRole('button', { name: /Wolof/ })).toHaveCount(0);
  });

  test("menu de langue ouvert, un SEUL appui sur la cloche ouvre le centre de notifications", async ({ page }) => {
    await connexion(page);
    const declencheur = await ouvrirMenuLangue(page);

    // La cloche est dans la même barre que le menu de langue : avant le
    // correctif, elle ne recevait rien au premier appui.
    await page.locator('button[aria-label^="Notifications"]').first().click();

    const panneau = page.locator('[data-notification-panel]');
    await expect(panneau).toHaveCount(1);
    await expect(panneau).toBeVisible();
    // …et le menu de langue s'est refermé dans le même geste.
    await expect(page.getByRole('button', { name: /Wolof/ })).toHaveCount(0);
    await expect(declencheur).toBeVisible();
  });

  test("menu de pays ouvert sur /jobs, un SEUL appui sur la bascule de vue l'active", async ({ page }) => {
    await connexion(page);
    await page.goto('/jobs');

    // Le sélecteur de pays de cette page (pas celui des formulaires).
    const pays = page.locator('button[aria-haspopup="listbox"]');
    await expect(pays).toHaveCount(1);
    await pays.click();
    await expect(pays).toHaveAttribute('aria-expanded', 'true');

    // La bascule liste/carte est juste à côté : c'est la commande visée.
    const bascules = page.locator('[role="group"]').first().locator('button[aria-pressed]');
    await expect(bascules).toHaveCount(2);
    const carte = bascules.nth(1);
    // L'état de DÉPART est vérifié : sans ça, appuyer sur un bouton déjà actif
    // ferait passer l'assertion suivante sans rien prouver.
    await expect(carte).toHaveAttribute('aria-pressed', 'false');

    await carte.click();

    await expect(carte).toHaveAttribute('aria-pressed', 'true');
    await expect(pays).toHaveAttribute('aria-expanded', 'false');
  });
});
