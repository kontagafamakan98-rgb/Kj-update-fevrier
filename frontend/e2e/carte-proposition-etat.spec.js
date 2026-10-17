/**
 * LA PROPOSITION CHOISIE EST PEINTE PAR LA FEUILLE QUI POSSÈDE LA CARTE.
 *
 * ── Ce que cette sonde juge, et pourquoi c'est un NAVIGATEUR ────────────────
 * La carte de proposition de /jobs/:id a deux états, et l'état est peint par
 * `.carte-editoriale-selectionnee` (src/index.css), déclarée à côté de
 * `.carte-editoriale`. Le défaut que cette sonde ferme est un défaut de
 * CASCADE, invisible en jsdom : `.carte-editoriale` est écrite hors couche, donc
 * elle l'emporte sur `@layer utilities`. Tant que l'état vivait dans deux
 * utilitaires de teinte, POSER la carte à filet suffisait à ramener la
 * proposition choisie au filet neutre — sans erreur, sans rouge, sans que rien
 * ne le dise à l'écran.
 *
 * Elle lit donc des couleurs CALCULÉES (`getComputedStyle`) et les compare aux
 * jetons du site, jamais aux classes : une valeur d'utilitaire (`rgb(255,255,255)`
 * pour un fond blanc, un `rgba(...)` pour un fond translucide) ne peut pas les
 * produire. Elle exige aussi la MÊME largeur de filet dans les deux états :
 * choisir une proposition ne doit rien déplacer dans la liste.
 *
 * ── Comment elle atteint l'état ─────────────────────────────────────────────
 * Par la CONNEXION RÉELLE (le formulaire), et c'est nécessaire : le web ne garde
 * aucun jeton en stockage, donc une session posée par un simple appel d'API ne
 * suffit pas — au rechargement, `AuthContext` n'a de trace que le profil mis en
 * cache par la connexion, et la fiche ne saurait pas qu'elle parle au
 * propriétaire. La connexion repose l'état de la fixture, donc la mission et ses
 * deux propositions sont créées ENSUITE, par le double-submit que l'application
 * utilise elle-même (cookie + `X-CSRFToken`).
 *
 * La mission est créée pour le compte client (`client_id`) : c'est la vue
 * PROPRIÉTAIRE, la seule qui liste les propositions reçues. Les missions de
 * démonstration ne sont pas touchées — `/jobs/:id` a des cellules d'aire LCP
 * calibrées sur elles.
 *
 * ── Ce qu'elle ne juge pas ─────────────────────────────────────────────────
 * Le CHOIX lui-même (ouvrir la discussion, attribuer) : c'est du comportement,
 * il n'a pas changé ici.
 */
import { test, expect } from '@playwright/test';

const API = 'http://127.0.0.1:8123/api';

// Les jetons, écrits une fois : ce sont les valeurs de src/index.css. Une sonde
// qui les relirait dans la feuille ne pourrait plus signaler qu'on l'a changée
// sans le dire.
const FILET_CHOISIE = 'rgb(253, 186, 116)'; // #fdba74, le filet de `.etiquette-app-orange`
const CREME = 'rgb(255, 247, 237)'; // --kojo-creme
const FILET_NEUTRE = 'rgb(230, 225, 215)'; // --kojo-filet
const PAPIER = 'rgb(255, 253, 249)'; // --kojo-papier

/** Connexion par le formulaire, comme un utilisateur — voir l'en-tête. */
async function connexion(page, email) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill('password');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 10000 });
}

test.describe('Parcours E2E — la carte de proposition de /jobs/:id', () => {
  test('la proposition choisie et la neutre sont peintes par la carte à filet, sans se déplacer', async ({ page, context }) => {
    await connexion(page, 'client@example.com');

    // Le double-submit de l'application : le cookie est déjà dans le contexte,
    // l'en-tête est le même jeton ré-échoé (la fixture refuse une écriture
    // authentifiée par cookie sans lui, comme le backend).
    const csrf = (await context.cookies()).find((cookie) => cookie.name === 'kojo_csrf')?.value;
    expect(csrf, 'la connexion doit poser le jeton CSRF').toBeTruthy();
    const entetes = { 'X-CSRFToken': csrf };

    const creation = await context.request.post(`${API}/jobs`, {
      headers: entetes,
      data: {
        title: 'Mission de contrôle — propositions',
        description: 'Mission de contrôle pour la sonde des états de carte.',
        category: 'plumbing',
        status: 'open',
        budget_min: 100,
        budget_max: 200,
        location: { address: 'Dakar, Sénégal' },
        client_id: 'demo-client',
      },
    });
    expect(creation.ok(), 'la mission de contrôle doit être créée').toBeTruthy();
    const { job } = await creation.json();

    for (const montant of [150, 175]) {
      const depot = await context.request.post(`${API}/jobs/${job.id}/proposals`, {
        headers: entetes,
        data: { proposed_amount: montant, message: `Proposition à ${montant}` },
      });
      expect(depot.ok(), 'la proposition de contrôle doit être déposée').toBeTruthy();
    }

    // La fiche, rechargée : c'est là que la trace de session décide (voir
    // l'en-tête — sans elle, la page ne saurait pas qu'elle parle au
    // propriétaire, et ces deux cartes n'existeraient pas).
    await page.goto(`/jobs/${job.id}`);
    const cartes = page.locator('[data-section="proposition"]');
    await expect(cartes).toHaveCount(2);

    const etats = async () =>
      cartes.evaluateAll((noeuds) =>
        noeuds.map((noeud) => {
          const style = getComputedStyle(noeud);
          return {
            fond: style.backgroundColor,
            filet: style.borderTopColor,
            largeur: style.borderTopWidth,
            rayon: style.borderTopLeftRadius,
          };
        }),
      );

    // `expect.poll` plutôt qu'une attente fixe : la première peinture peut
    // précéder l'arrivée de la feuille complète.
    await expect
      .poll(async () => (await etats())[0].filet, { message: 'la première proposition est celle que la page ouvre' })
      .toBe(FILET_CHOISIE);

    const [choisie, neutre] = await etats();
    expect(choisie).toEqual({ fond: CREME, filet: FILET_CHOISIE, largeur: '1px', rayon: '8px' });
    expect(neutre).toEqual({ fond: PAPIER, filet: FILET_NEUTRE, largeur: '1px', rayon: '8px' });
  });
});
