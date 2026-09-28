import { test, expect } from '@playwright/test';
import { MARQUEUR_DE_MONTAGE } from './helpers/geometrie.js';
import { attendreLaCondition } from './helpers/attentes.js';
// La PUBLICATION par moteur : ce que les trois moteurs font des mêmes gestes se
// lit au tableau des écarts, publié une fois la suite finie
// (e2e/global-teardown-moteurs.js).
import { publier } from './helpers/moteurs.js';

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
 * ── LE MENU DE LANGUE EST PARTAGÉ, ET JAMAIS PEINT DEUX FOIS ────────────────
 * Les deux barres montent le MÊME composant (`LanguageSelector`) : le tiroir
 * mobile n'a plus de `<select>` à lui, donc un seul menu — mêmes libellés, même
 * comportement d'appui extérieur — pour les deux dispositions. Elles ne peuvent
 * pas pour autant peindre deux contrôles à la fois : le sous-arbre desktop est
 * `hidden md:flex`, et celui du tiroir n'existe que menu ouvert (`md:hidden`).
 * C'est le compte du cas 3, à trois états : mobile fermé 0, mobile ouvert 1,
 * desktop 1. Le composant ne pose AUCUN `id` (rien à dupliquer dans le
 * document), aucun verrou global, et son écouteur d'appui extérieur n'existe que
 * tant que SA liste est ouverte (`e2e/appuis-exterieurs.spec.js` prouve l'autre
 * moitié : un seul appui suit sa cible). Une surface laissée ouverte dans la
 * barre masquée ne peut RIEN avaler : son sous-arbre entier est `display:none`,
 * donc ni peint ni captant — le nombre de contrôles affichés tombe à zéro, et
 * c'est encore le cas 3 qui le dit.
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
const SONDE_ETAT = () => {
  const affiches = (elements) => elements.filter((el) => el.getClientRects().length > 0).length;
  const dansLaBarre = (selecteur) => [...document.querySelectorAll(selecteur)];
  return {
    verrouDeDefilement: document.body.style.overflow,
    surfaceOuverte: dansLaBarre('nav button[aria-label="Fermer le menu"]').length,
    hamburgerAffiche: affiches(
      dansLaBarre('nav button[aria-label="Ouvrir le menu"], nav button[aria-label="Fermer le menu"]')
    ),
    // Le LIBELLÉ du hamburger AFFICHÉ : c'est lui qui dit si le tiroir est
    // ouvert (« Fermer le menu ») ou refermé (« Ouvrir le menu »). Un compte
    // d'éléments affichés ne le dit pas — les deux libellés comptent pour un —,
    // donc un cas qui n'attendrait que « au moins un » se satisferait d'un
    // tiroir resté ouvert et jugerait ensuite sur autre chose.
    libelleHamburger:
      dansLaBarre('nav button[aria-label="Ouvrir le menu"], nav button[aria-label="Fermer le menu"]')
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => el.getAttribute('aria-label'))[0] ?? null,
    hauteurDeDefilement: document.scrollingElement.scrollHeight - window.innerHeight,
    positionDeDefilement: Math.round(document.scrollingElement.scrollTop),
  };
};

// La sonde est séparée de sa lecture : `attendreLaCondition` évalue la FONCTION
// dans la page, donc lui passer `etatDeLaPage` (qui prend un `page`) lui
// enverrait du code qui ne peut pas s'exécuter là-bas.
const etatDeLaPage = (page) => page.evaluate(SONDE_ETAT);

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
  await expect(page.locator('#mobile_menu')).toBeVisible();
};

/**
 * Les contrôles de LANGUE AFFICHÉS : les deux barres montent le même composant,
 * dont le déclencheur est un `<button>` portant le nom de la langue courante
 * (« Français »). La question de l'instance dupliquée se répond par ce compte :
 * jamais deux à l'écran, quelle que soit la disposition.
 */
const SONDE_LANGUE = () =>
  [...document.querySelectorAll('nav button')].filter(
    (b) => b.textContent.includes('Français') && b.getClientRects().length > 0
  ).length;

const controlesDeLangue = (page) => page.evaluate(SONDE_LANGUE);

/**
 * Publie une attente MESURÉE : ses DEUX bornes, sous un même nom.
 *
 * Une durée de sondage est un intervalle (voir `e2e/helpers/attentes.js`) : la
 * condition a été vue vraie à la borne haute, et elle était fausse à la borne
 * basse. Publier la seule borne haute fait entrer la latence d'UNE lecture de
 * page dans la mesure — relevé du 28/09/2026 : une bascule à 6 283 ms sur
 * Firefox dont ~6 s étaient une seule lecture, soit un « écart » de 104 616 %
 * qui ne mesurait que la lenteur d'une sonde. Publier la seule borne basse
 * l'inverse : un fait déjà vrai à la première lecture vaut 0, ce qui est exact
 * mais muet. Les deux, côte à côte, se lisent : `3 · 12` est une bascule de
 * ~3 ms, `3 · 6283` dit que la sonde a attendu son tour.
 */
const publierLesBornes = (test, nom, attente) => {
  publier(test, `${nom} (borne basse)`, attente.fourchetteMs[0], 'ms');
  publier(test, `${nom} (borne haute)`, attente.fourchetteMs[1], 'ms');
  return attente;
};

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
    //
    // La bascule est un GESTE, et sa durée se MESURE (elle se compare d'un
    // moteur à l'autre : une re-mise en page de rupture n'est pas instantanée
    // partout). L'ancien `waitForTimeout(100)` la décidait au lieu de la lire.
    await page.setViewportSize(DESKTOP);
    const bascule = await attendreLaCondition(
      page,
      SONDE_ETAT,
      (etat) => etat.surfaceOuverte === 0 && etat.verrouDeDefilement === ''
    );
    expect(
      bascule.atteinte,
      `après la bascule en desktop, le tiroir est resté ouvert (${JSON.stringify(bascule.dernier)}) : ` +
        'aucune commande visible ne le ferme, et le verrou de défilement survit à sa barre.'
    ).toBe(true);
    publierLesBornes(test, 'bascule mobile→desktop : état refermé', bascule);

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
    // La molette est un geste INERTIEL sur certains moteurs : la position
    // atteinte n'est pas la même au bout du même temps, donc on attend la
    // condition (la page a défilé) et on PUBLIE la durée — l'écart entre
    // moteurs est précisément ce qu'un délai fixe cachait.
    const defilement = await attendreLaCondition(
      page,
      SONDE_ETAT,
      (etat) => etat.positionDeDefilement > 300
    );
    expect(
      defilement.atteinte,
      "900 px de molette n'ont pas bougé la page : le verrou du tiroir a survécu à sa barre"
    ).toBe(true);
    const defile = defilement.dernier;
    publierLesBornes(test, 'molette de 900 px : défiler jusqu’à 300 px', defilement);
    publier(test, 'molette de 900 px : position atteinte', defile.positionDeDefilement, 'px');
  });

  test("l'état ne survit pas au retour en mobile : le hamburger dit « Ouvrir le menu »", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/');
    await attendreLeMontage(page);
    await ouvrirLeMenuMobile(page);

    await page.setViewportSize(DESKTOP);
    // ATTEINDRE le desktop n'est pas être ARRIVÉ : le point de rupture masque le
    // hamburger dès la re-mise en page CSS, AVANT que l'état React ne se referme
    // (le verrou de défilement est le témoin de cet état, pas la peinture du
    // bouton). Attendre le premier et repartir aussitôt mesurait donc un
    // aller-retour commencé en plein vol : relevé du 28/09/2026 sur WebKit, le
    // tiroir restait ouvert au retour en mobile — non pas que WebKit referme
    // mal, mais parce que la bascule retour arrivait avant l'effet de fermeture.
    // Le cas 1 mesure cette fermeture ; ici, elle est la condition de DÉPART.
    const masque = await attendreLaCondition(
      page,
      SONDE_ETAT,
      (etat) => etat.hamburgerAffiche === 0 && etat.surfaceOuverte === 0 && etat.verrouDeDefilement === ''
    );
    expect(
      masque.atteinte,
      `en desktop, ${masque.dernier.hamburgerAffiche} hamburger(s) affiché(s), ` +
        `${masque.dernier.surfaceOuverte} surface(s) ouverte(s), verrou de défilement « ${masque.dernier.verrouDeDefilement} » : ` +
        "la barre mobile ne s'est pas entièrement refermée"
    ).toBe(true);
    publierLesBornes(test, 'bascule mobile→desktop : état refermé, verrou levé', masque);
    await page.setViewportSize(MOBILE);

    // Le hamburger est le seul juge de l'état : son libellé vient de
    // `isMobileMenuOpen`, donc la commande doit être l'OUVERTURE, pas la
    // fermeture d'un tiroir que personne ne voit. C'est ce libellé qu'on
    // ATTEND (et non « un hamburger quelconque »), puis qu'on juge en le
    // nommant : un WebKit qui laisserait le tiroir ouvert doit dire « Fermer le
    // menu » et sa durée, au lieu de rougir sur un localisateur introuvable.
    const retour = await attendreLaCondition(page, SONDE_ETAT, (etat) => etat.libelleHamburger === 'Ouvrir le menu');
    publierLesBornes(test, 'aller-retour desktop→mobile : hamburger repeint', retour);
    publier(test, 'aller-retour desktop→mobile : libellé du hamburger', retour.dernier.libelleHamburger ?? '(aucun)');
    expect(
      retour.atteinte,
      `après le retour en mobile, le hamburger dit « ${retour.dernier.libelleHamburger} » ` +
        `(${retour.dernier.hamburgerAffiche} affiché(s)) : le menu mobile aurait dû se refermer en quittant le point de rupture`
    ).toBe(true);
    await expect(page.locator('#mobile_menu')).toHaveCount(0);
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
    expect(await controlesDeLangue(page), 'menu fermé sur mobile').toBe(0);

    await ouvrirLeMenuMobile(page);
    expect(await controlesDeLangue(page), 'menu ouvert sur mobile').toBe(1);

    await page.setViewportSize(DESKTOP);
    const barre = await attendreLaCondition(page, SONDE_LANGUE, (n) => n === 1);
    expect(barre.atteinte, `après la bascule, ${barre.dernier} contrôle(s) de langue affiché(s) au lieu d'un`).toBe(
      true
    );
    publierLesBornes(test, 'bascule mobile→desktop : un seul contrôle de langue', barre);
    expect(await controlesDeLangue(page), 'barre desktop').toBe(1);
  });

  test("un menu de langue laissé ouvert dans la barre masquée ne peint plus rien et n'avale rien", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/');
    await attendreLeMontage(page);

    // Ouvrir le menu de langue de la barre desktop, puis la masquer en
    // rétrécissant : son état reste « ouvert » dans un conteneur `display:none`.
    await page.locator('nav button', { hasText: 'Français' }).first().click();
    await expect(page.getByRole('button', { name: /Wolof/ })).toBeVisible();
    expect(await controlesDeLangue(page), 'déclencheur + la liste ouverte').toBeGreaterThan(1);

    await page.setViewportSize(MOBILE);
    const masquee = await attendreLaCondition(page, SONDE_LANGUE, (n) => n === 0);
    expect(masquee.atteinte, `la barre masquée peint encore ${masquee.dernier} contrôle(s) de langue`).toBe(true);
    publierLesBornes(test, 'bascule desktop→mobile : barre masquée vidée', masquee);
    expect(await controlesDeLangue(page), 'la barre masquée ne doit plus rien peindre').toBe(0);

    // L'appui suit sa cible au PREMIER geste (le menu de langue resté ouvert
    // ferme par effet de bord, sans rien capturer) et le tiroir s'ouvre. Ce
    // qu'un sous-arbre `display:none` ne peut pas faire, c'est avaler un appui :
    // c'est structurel, et le compte ci-dessus le mesure.
    await ouvrirLeMenuMobile(page);
    await expect(page.getByRole('button', { name: 'Fermer le menu' })).toHaveCount(2);
  });
});
