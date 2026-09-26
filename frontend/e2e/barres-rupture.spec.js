import { test, expect } from '@playwright/test';
import { MARQUEUR_DE_MONTAGE } from './helpers/geometrie.js';

/**
 * LES DEUX BARRES, LE POINT DE RUPTURE, ET LA QUESTION DE L'INSTANCE DUPLIQUÉE.
 *
 * ── Le défaut mesuré ici ────────────────────────────────────────────────────
 * La barre de navigation existe en DEUX dispositions séparées par un point de
 * rupture CSS (`hidden md:flex` / `md:hidden`), et les deux vivent dans le même
 * DOM : rien n'empêche une surface OUVERTE dans l'une de survivre au
 * franchissement. Le centre de notifications l'a payé (deux panneaux, chacun
 * avec son écouteur : l'instance masquée refermait l'autre PENDANT l'appui) et
 * s'en protège depuis en fermant dès que son conteneur n'est plus affiché.
 *
 * Le MENU MOBILE portait le même défaut, et il coûtait plus cher. Relevé du
 * 25/09/2026 dans Chromium, avant correctif : menu ouvert à 412×823, écran
 * élargi à 1350×940 (une rotation de téléphone fait exactement ça — 823 px de
 * large en paysage) → le menu restait OUVERT dans une barre `display:none`
 * (hamburger et fond de fermeture invisibles, `document.body.style.overflow`
 * toujours à `hidden`), et **900 px de molette ne faisaient défiler la page que
 * de 0 px**, sans aucune commande visible pour la débloquer. Le retour en
 * mobile retrouvait le tiroir ouvert, comme si rien ne s'était passé.
 *
 * Piège d'outillage mesuré au passage : `window.scrollTo` défile MÊME sous
 * `overflow:hidden` (il est programmatique). Une sonde qui défile ainsi
 * conclurait « la page va bien » sur une page que la molette ne bouge pas —
 * d'où `page.mouse.wheel`, un vrai geste, dans le cas 1.
 *
 * ── Ce que cette sonde ne refait pas ────────────────────────────────────────
 * Le couple cloche/panneau a ses propres preuves (`e2e/notifications.spec.js`,
 * dont le franchissement du point de rupture, et
 * `src/components/__tests__/NotificationCenter.test.jsx` pour le NOMBRE de
 * panneaux) : les redire ici donnerait deux propriétaires au même fait. Ce qui
 * est mesuré ici est le reste des composants des deux barres — le MENU MOBILE
 * et le CONTRÔLE DE LANGUE — et, en creux, la réponse à « combien d'instances
 * sont affichées à la fois ».
 *
 * ── Le CONTRÔLE DE LANGUE est indemne, et voici pourquoi plutôt que « on a regardé » ──
 * Il n'est monté QU'UNE fois : le seul `<LanguageSelector>` de `src/` est dans
 * la barre desktop, dont le sous-arbre est `hidden md:flex`. La barre mobile
 * publie, elle, un `<select id="mobile_language_selector">` DANS son menu, qui
 * n'existe que menu ouvert. Les deux dispositions ne peuvent donc pas peindre
 * deux contrôles à la fois — c'est le compte du cas 3, à trois états différents,
 * et c'est ce compte qui échouerait le jour où l'on ajouterait le second. Trois
 * autres raisons, lues dans la source : il ne pose AUCUN `id` (rien à dupliquer
 * dans le document), il ne pose aucun verrou global, et son écouteur d'appui
 * extérieur n'existe que tant que SA liste est ouverte (`e2e/appuis-exterieurs.spec.js`
 * prouve l'autre moitié : un seul appui suit sa cible). Une surface laissée
 * ouverte dans la barre masquée ne peut RIEN avaler : son sous-arbre entier est
 * `display:none`, donc ni peint ni captant — le nombre de contrôles affichés
 * tombe à zéro, et c'est encore le cas 3 qui le dit.
 *
 * ── La frontière jsdom / Chromium ───────────────────────────────────────────
 * jsdom ne calcule aucune mise en page : il ne verra jamais le défaut
 * lui-même. `src/components/__tests__/barres-rupture.test.jsx` y prouve la
 * RÈGLE dans les deux sens (un panneau non affiché ferme, un panneau affiché ne
 * ferme pas) ; ici, c'est le FAIT qui est mesuré, sur le bundle compilé.
 */

const MOBILE = { width: 412, height: 823 };
const DESKTOP = { width: 1350, height: 940 };

/** Ce que la page dit de son propre état : tout est LIT, rien n'est supposé. */
const etatDeLaPage = (page) =>
  page.evaluate(() => {
    const affiches = (elements) => elements.filter((el) => el.getClientRects().length > 0).length;
    const dansLaBarre = (selecteur) => [...document.querySelectorAll(selecteur)];
    return {
      verrouDeDefilement: document.body.style.overflow,
      surfaceOuverte: dansLaBarre('nav button[aria-label="Fermer le menu"]').length,
      hamburgerAffiche: affiches(
        dansLaBarre('nav button[aria-label="Ouvrir le menu"], nav button[aria-label="Fermer le menu"]')
      ),
      hauteurDeDefilement: document.scrollingElement.scrollHeight - window.innerHeight,
      positionDeDefilement: Math.round(document.scrollingElement.scrollTop),
    };
  });

/**
 * La page est MONTÉE : sans ce repère, un compte lu trop tôt vaut zéro pour
 * toutes ses cases, et un cas qui attend « zéro contrôle affiché » passerait en
 * n'ayant rien mesuré. Le marqueur est celui du harnais de géométrie (un lien
 * dans la barre : la coquille pré-rendue n'en publie aucun).
 */
const attendreLeMontage = async (page) => {
  await expect(page.locator(MARQUEUR_DE_MONTAGE).first()).toBeVisible();
};

/** Le menu mobile tel que le visiteur le voit : ouvert par un seul appui. */
const ouvrirLeMenuMobile = async (page) => {
  await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await expect(page.locator('#mobile_language_selector')).toBeVisible();
};

/**
 * Les contrôles de LANGUE affichés : celui de la barre du haut (un `<button>`
 * qui porte le nom de la langue courante) et celui du menu mobile (un
 * `<select>` natif). La question de l'instance dupliquée se répond par ce
 * compte : jamais deux à l'écran.
 */
const controlesDeLangue = (page) =>
  page.evaluate(() => {
    const affiche = (el) => el.getClientRects().length > 0;
    const barre = [...document.querySelectorAll('nav button')].filter(
      (b) => b.textContent.includes('Français') && affiche(b)
    ).length;
    const select = [...document.querySelectorAll('#mobile_language_selector')].filter(affiche).length;
    return { barre, select, total: barre + select };
  });

test.describe('les barres et le point de rupture', () => {
  test("le menu mobile se ferme quand sa barre cesse d'être affichée (et la page défile à nouveau)", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/');
    await attendreLeMontage(page);
    await ouvrirLeMenuMobile(page);

    const ouvert = await etatDeLaPage(page);
    expect(ouvert.verrouDeDefilement, 'le tiroir ouvert verrouille le défilement').toBe('hidden');
    expect(ouvert.surfaceOuverte, 'deux commandes de fermeture : le hamburger et le fond').toBe(2);

    // Le franchissement : c'est ce que fait une rotation d'écran. L'état est
    // LU, puis jugé — un `toHaveCount(0)` aurait rougi sans dire pourquoi, et
    // un rouge qui n'est pas nommé n'est pas réparable.
    await page.setViewportSize(DESKTOP);
    await page.waitForTimeout(100);

    const apres = await etatDeLaPage(page);
    expect(
      apres.surfaceOuverte,
      "l'état ouvert a survécu à la disparition de sa barre : le menu existe encore dans un conteneur display:none"
    ).toBe(0);
    expect(apres.hamburgerAffiche, 'aucun hamburger sur cette taille : rien ne pourrait fermer le tiroir').toBe(0);
    expect(apres.verrouDeDefilement, 'le verrou de défilement doit être rendu avec le menu').toBe('');

    // Le fait qui compte pour le visiteur, et il se mesure au VRAI geste.
    expect(apres.hauteurDeDefilement, 'la page doit avoir de quoi défiler, sinon le cas ne prouverait rien').toBeGreaterThan(300);
    await page.mouse.move(DESKTOP.width / 2, DESKTOP.height / 2);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(200);
    const defile = await etatDeLaPage(page);
    expect(
      defile.positionDeDefilement,
      "900 px de molette n'ont pas bougé la page : le verrou du tiroir a survécu à sa barre"
    ).toBeGreaterThan(300);
  });

  test("l'état ne survit pas au retour en mobile : le hamburger dit « Ouvrir le menu »", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/');
    await attendreLeMontage(page);
    await ouvrirLeMenuMobile(page);

    await page.setViewportSize(DESKTOP);
    await page.waitForTimeout(100);
    await page.setViewportSize(MOBILE);
    await page.waitForTimeout(100);

    // Le hamburger est le seul juge de l'état : son libellé vient de
    // `isMobileMenuOpen`, donc la commande doit être l'OUVERTURE, pas la
    // fermeture d'un tiroir que personne ne voit.
    await expect(page.getByRole('button', { name: 'Ouvrir le menu' })).toBeVisible();
    await expect(page.locator('#mobile_language_selector')).toHaveCount(0);
    expect((await etatDeLaPage(page)).verrouDeDefilement).toBe('');
  });

  test('le contrôle de langue n’est JAMAIS affiché en double, à aucune taille', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/');
    // Le montage est attendu AVANT de compter : c'est ce qui empêche le cas de
    // passer en lisant une page vide (zéro partout est aussi le compte d'une
    // barre qui ne serait pas encore peinte).
    await attendreLeMontage(page);

    // Mobile fermé : la langue n'est atteignable qu'en ouvrant le menu — le
    // compte est donc 0, et le contrôle de la barre desktop ne doit pas être
    // affiché « en plus » (c'est la forme du doublon).
    expect(await controlesDeLangue(page), 'menu fermé sur mobile').toEqual({ barre: 0, select: 0, total: 0 });

    await ouvrirLeMenuMobile(page);
    expect(await controlesDeLangue(page), 'menu ouvert sur mobile').toEqual({ barre: 0, select: 1, total: 1 });

    await page.setViewportSize(DESKTOP);
    await page.waitForTimeout(100);
    expect(await controlesDeLangue(page), 'barre desktop').toEqual({ barre: 1, select: 0, total: 1 });
  });

  test("un menu de langue laissé ouvert dans la barre masquée ne peint plus rien et n'avale rien", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/');
    await attendreLeMontage(page);

    // Ouvrir le menu de langue de la barre desktop, puis la masquer en
    // rétrécissant : son état reste « ouvert » dans un conteneur `display:none`.
    await page.locator('nav button', { hasText: 'Français' }).first().click();
    await expect(page.getByRole('button', { name: /Wolof/ })).toBeVisible();
    expect((await controlesDeLangue(page)).barre).toBeGreaterThan(1); // déclencheur + la liste

    await page.setViewportSize(MOBILE);
    await page.waitForTimeout(150);
    expect(await controlesDeLangue(page), 'la barre masquée ne doit plus rien peindre').toEqual({
      barre: 0,
      select: 0,
      total: 0,
    });

    // L'appui suit sa cible au PREMIER geste (le menu de langue resté ouvert
    // ferme par effet de bord, sans rien capturer) et le tiroir s'ouvre. Ce
    // qu'un sous-arbre `display:none` ne peut pas faire, c'est avaler un appui :
    // c'est structurel, et le compte ci-dessus le mesure.
    await ouvrirLeMenuMobile(page);
    await expect(page.getByRole('button', { name: 'Fermer le menu' })).toHaveCount(2);
  });
});
