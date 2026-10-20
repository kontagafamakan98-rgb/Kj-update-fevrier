/**
 * LE PROFIL PUBLIC D'UN TRAVAILLEUR SE LIT SANS COMPTE — ET SANS JETON.
 *
 * ── Ce que cette sonde juge, et pourquoi c'est un NAVIGATEUR ───────────────
 * La page `/workers/:id` est la seule surface où la réputation d'un travailleur
 * se LIT (missions terminées, note, avis). Deux choses n'y sont pas visibles
 * depuis un test de composant :
 *
 *   1. la ROUTE existe dans le build servi (`vercel.json` la fait servir par le
 *      gabarit nu, exactement comme les autres routes clientes) — un lien
 *      partagé sur WhatsApp doit ouvrir la page d'un visiteur qui n'a PAS de
 *      compte ;
 *   2. la requête part SANS `Authorization` : la page est publique, et un jeton
 *      envoyé sur une route publique est le début d'une fuite (le shell natif
 *      en garde un ; le web, lui, ne doit rien envoyer).
 *
 * Elle mesure aussi le cas INCONNU : un identifiant qui ne désigne personne dit
 * « page introuvable » au lieu de peindre un profil vide — un profil sans nom
 * ni mesure se lirait comme un travailleur sans historique.
 *
 * ── Ce qu'elle ne juge pas ─────────────────────────────────────────────────
 * L'ALLOWLIST de la réponse (ni email, ni téléphone, ni position) : c'est un
 * fait du routeur, mesuré sur les clés exactes par
 * `backend/tests/test_workers_public_profile.py`. Ici, le double ne sert que
 * les champs publiés — la sonde ne pourrait donc pas voir une fuite.
 */
import { test, expect } from '@playwright/test';

// Le travailleur de la fixture (`scripts/playtest-api-server.mjs`). Son
// identifiant est celui du compte `demo@example.com` ; la fixture répond 404
// pour tout autre, comme le vrai backend pour un compte qui n'est pas un
// travailleur.
const TRAVAILLEUR = 'demo-user';

test.describe('Parcours E2E — le profil public d’un travailleur', () => {
  test('un visiteur sans compte lit la réputation, et la requête ne porte aucun jeton', async ({ page }) => {
    const entetesDuProfil = [];
    page.on('request', (requete) => {
      // L'URL diffère selon la topologie (proxy `/api` même-origine en
      // production, hôte de l'API en développement) : on juge le suffixe, pas
      // l'origine — la page, elle, passe par `buildApiUrl`.
      if (new URL(requete.url()).pathname.endsWith(`/api/workers/${TRAVAILLEUR}`)) {
        entetesDuProfil.push(requete.headers());
      }
    });

    await page.goto(`/workers/${TRAVAILLEUR}`);

    // L'identité professionnelle, puis les preuves : une mission terminée et un
    // avis réel. Ce sont les trois choses qu'un client vient chercher.
    await expect(page.getByRole('heading', { name: 'Awa Diallo' })).toBeVisible();
    await expect(page.getByText('plomberie')).toBeVisible();
    await expect(page.getByText('Travail impeccable.')).toBeVisible();
    // La note est formatée par `toLocaleString()` : le séparateur dépend de la
    // locale du navigateur. Ce qui est jugé, c'est la VALEUR publiée.
    await expect(page.locator('body')).toContainText(/4[.,]7/);

    expect(entetesDuProfil, 'la page doit avoir lu le profil une fois').toHaveLength(1);
    expect(
      entetesDuProfil[0].authorization,
      'route publique : aucun jeton ne doit partir sur la lecture du profil'
    ).toBeUndefined();
  });

  test('un identifiant inconnu dit « page introuvable », pas un profil vide', async ({ page }) => {
    await page.goto('/workers/inconnu');

    await expect(page.getByRole('heading', { name: 'Page introuvable' })).toBeVisible();
  });
});
