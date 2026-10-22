/**
 * LE PARCOURS CLAVIER D'UNE PAGE PUBLIQUE — premier arrêt, lien d'évitement,
 * sortie vers le contenu — et les PREUVES que chaque vérification rougit.
 *
 * ── Le défaut que ce fichier ferme (22/10/2026) ─────────────────────────────
 * Rien ne mesurait ce qu'un utilisateur au clavier traverse pour atteindre le
 * contenu d'une page. Sur ce site, la barre de navigation porte des menus, une
 * cloche de notifications, un sélecteur de langue et une bascule de profil :
 * sans lien d'évitement, il fallait tous les franchir À CHAQUE PAGE, et WCAG
 * 2.4.1 (« contourner des blocs ») exige le moyen de les sauter.
 *
 * ── Ce qui est jugé, et sur QUEL document ───────────────────────────────────
 * 1. le document SERVİ avant tout JavaScript (contexte sans JS) : un lien
 *    d'évitement qui n'existerait qu'après l'hydratation serait absent pour qui
 *    arrive sur la page — le cas exact qu'il sert ;
 * 2. la page montée par React : le PREMIER arrêt de Tab est ce lien, son
 *    activation déplace le focus DANS `main`, et la tabulation suivante reste
 *    dans le contenu — donc la barre a bien été sautée ;
 * 3. deux routes différentes, parce que c'est le chrome qui porte le lien, pas
 *    une page.
 *
 * ── La preuve que ÇA ROUGIT ─────────────────────────────────────────────────
 * Chaque vérification passe par la MÊME fonction que sa preuve d'échec : on
 * retire le lien, ou l'identifiant de `main`, puis on rejoue la fonction et on
 * exige qu'elle dise NON. Un garde qu'on n'a jamais vu échouer peut être
 * aveugle sans que personne ne le sache.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIBELLE = JSON.parse(
  fs.readFileSync(path.join(RACINE, 'src', 'i18n', 'fr.json'), 'utf8')
).skipToContent;

/** `main` reçoit le focus par programme : c'est SA cible qui est jugée ici. */
const ID_MAIN = 'contenu-principal';
const CLASSE_LIEN = 'lien-evitement';

/** Le document est-il prêt (React monté, ou coquille servie) ? */
const attendreLaPage = async (page, avecJs = true) => {
  await page.waitForLoadState('load');
  if (avecJs) {
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#root nav')).toBeVisible();
  }
  await expect(page.locator('main')).toBeVisible();
};

/** Ce que le clavier a atteint : une forme comparable partout. */
const elementFocalise = (page) =>
  page.evaluate(() => {
    const actif = document.activeElement;
    if (!actif || actif === document.body) return { tag: 'BODY', classes: '', id: '', texte: '', dansMain: false };
    return {
      tag: actif.tagName,
      classes: typeof actif.className === 'string' ? actif.className : '',
      id: actif.id || '',
      texte: (actif.textContent || '').trim(),
      dansMain: Boolean(actif.closest('main')),
    };
  });

/**
 * Le PREMIER arrêt de la touche Tab depuis le haut du document.
 *
 * C'est la seule mesure qui dise la vérité de l'ordre de tabulation : lire le
 * DOM pour chercher « le premier a[href] » décrirait l'intention, pas ce que le
 * navigateur fait (un `tabindex` positif, un élément `inert`, un `display:none`
 * changeraient tout sans changer le DOM).
 */
const premierArret = async (page) => {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
  await page.keyboard.press('Tab');
  return elementFocalise(page);
};

/**
 * Ouvre le lien d'évitement au clavier et rend l'élément qui a reçu le focus.
 *
 * DEUX faits, attendus dans cet ordre : le FRAGMENT est posé (le navigateur a
 * suivi le lien — il change d'adresse même quand la cible manque), puis le
 * focus atteint `main`. `exigerFocus: false` sert à la PREUVE d'échec : elle
 * retire l'identifiant, donc le focus ne bougera pas, et c'est précisément ce
 * qu'elle doit observer — attendre le focus y rendrait la preuve impossible.
 *
 * Aucun délai fixe : `waitForTimeout` faisait rougir
 * `scripts/check-juges-de-temps.js`, et une attente en millisecondes ne dit
 * rien de ce qui doit être vrai.
 */
const activerLeLien = async (page, { exigerFocus = true } = {}) => {
  await page.locator(`.${CLASSE_LIEN}`).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (fragment) => window.location.hash === `#${fragment}`,
    ID_MAIN,
    { timeout: 2000 }
  );
  if (exigerFocus) {
    await page.waitForFunction(
      (id) => document.activeElement instanceof HTMLElement && document.activeElement.id === id,
      ID_MAIN,
      { timeout: 2000 }
    );
  }
  return elementFocalise(page);
};

const estLeLienDEvitement = (arret) =>
  arret.tag === 'A' && arret.classes.split(/\s+/).includes(CLASSE_LIEN);

test.describe('clavier — le lien d’évitement est le premier arrêt', () => {
  for (const chemin of ['/', '/jobs']) {
    test(`sur ${chemin}, Tab atteint le lien d’évitement puis son activation mène dans main`, async ({ page }) => {
      await page.goto(chemin);
      await attendreLaPage(page);

      const premier = await premierArret(page);
      expect(estLeLienDEvitement(premier), `premier arrêt sur ${chemin} : ${JSON.stringify(premier)}`).toBe(true);
      expect(premier.texte, 'le lien doit avoir un nom lisible').toBe(LIBELLE);

      const apresActivation = await activerLeLien(page);
      expect(apresActivation.id, `le focus n’a pas atteint main sur ${chemin}`).toBe(ID_MAIN);

      // Et la tabulation SUIVANTE reste dans le contenu : la barre a été sautée.
      await page.keyboard.press('Tab');
      const suivant = await elementFocalise(page);
      expect(suivant.dansMain, `après le lien, le focus repart hors de main (${JSON.stringify(suivant)})`).toBe(true);
    });
  }

  test('le document SERVI (sans JavaScript) porte déjà le lien et sa cible', async ({ browser }) => {
    // Le cas qui compte : quelqu'un arrive sur la page AVANT l'hydratation.
    const contexte = await browser.newContext({ javaScriptEnabled: false });
    const page = await contexte.newPage();
    await page.goto('/');
    await attendreLaPage(page, false);

    const lien = page.locator(`.${CLASSE_LIEN}`);
    await expect(lien).toHaveAttribute('href', `#${ID_MAIN}`);
    await expect(lien).toHaveText(LIBELLE);
    // La cible existe dans le même document, sinon le lien est mort.
    await expect(page.locator(`main#${ID_MAIN}`)).toHaveCount(1);

    const premier = await premierArret(page);
    expect(estLeLienDEvitement(premier), `coquille sans JS : ${JSON.stringify(premier)}`).toBe(true);

    await contexte.close();
  });
});

test.describe('clavier — les preuves que les vérifications rougissent', () => {
  test('SANS le lien, le premier arrêt n’est plus le lien d’évitement', async ({ page }) => {
    await page.goto('/');
    await attendreLaPage(page);

    // Le cas sain d'abord : la vérification dit OUI.
    expect(estLeLienDEvitement(await premierArret(page))).toBe(true);

    await page.evaluate((classe) => {
      document.querySelectorAll(`.${classe}`).forEach((noeud) => noeud.remove());
    }, CLASSE_LIEN);

    // La MÊME vérification dit NON : elle mesure bien la présence du lien.
    const sansLien = await premierArret(page);
    expect(
      estLeLienDEvitement(sansLien),
      `retirer le lien n’a rien changé au premier arrêt (${JSON.stringify(sansLien)})`
    ).toBe(false);
  });

  test('SANS l’identifiant de main, le lien ne mène nulle part', async ({ page }) => {
    await page.goto('/');
    await attendreLaPage(page);

    expect((await activerLeLien(page)).id).toBe(ID_MAIN);

    await page.evaluate((id) => {
      document.querySelector('main').removeAttribute('id');
      document.querySelectorAll('main').forEach((main) => {
        if (main.id) main.removeAttribute('id');
      });
      void id;
    }, ID_MAIN);

    const apres = await activerLeLien(page, { exigerFocus: false });
    expect(
      apres.id,
      `sans identifiant, le focus a quand même atteint main (${JSON.stringify(apres)})`
    ).not.toBe(ID_MAIN);
  });
});
