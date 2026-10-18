import { test, expect } from '@playwright/test';

import { connexionALaFixture } from './helpers/parcours-carte.js';

/**
 * Les champs du bloc « Comptes de paiement » sont-ils dessinés comme les cartes
 * du site — focus orange compris ?
 *
 * ── Ce qui se mesure ici, et pourquoi PAS en jsdom ──────────────────────────
 * Une classe écrite dans le JSX ne prouve pas un pixel : c'est le calcul du
 * navigateur qui décide (une règle de feuille, une couche, un défaut d'élément
 * peuvent la retourner). Le cas de composant
 * (`src/components/__tests__/PaymentAccountsManager.champs.test.jsx`) verrouille
 * la LECTURE du propriétaire (`src/config/classes-champ.js`) ; cette sonde juge
 * ce que l'écran peint réellement, aux valeurs CALCULÉES.
 *
 * ── Le défaut mesuré le 17/10/2026 ─────────────────────────────────────────
 * Dans une même carte, trois dessins de champ cohabitaient : `rounded-md` (rayon
 * qu'aucune carte ne porte), filet froid, et un anneau de focus PLEIN de trois
 * couleurs différentes — orange pour Orange Money, BLEU pour Wave, GRIS pour la
 * banque. Sur le reste du site, un champ est un filet chaud, un rayon de 8 px et
 * un anneau de focus orange translucide (30 %).
 *
 * ── Pourquoi la couleur est RAMENÉE en sRGB ────────────────────────────────
 * Chrome rend une couleur Tailwind v4 telle qu'elle est ÉCRITE dans la feuille :
 * `oklch(0.705 0.213 47.604)`. Comparer cette chaîne lierait le cas à une
 * syntaxe de couleur — le jour où la feuille écrit `color-mix()` ou `rgb()`, le
 * rouge parlerait de la notation, pas du dessin. La sonde peint donc un pixel
 * dans un canvas et relit ses canaux : c'est la même couleur, en sRGB, quelle
 * que soit la notation d'entrée.
 *
 * ── Ce qu'elle n'affirme PAS ───────────────────────────────────────────────
 * La valeur du FILET au repos : elle vient du conteneur (`form :is(input…)`
 * pose `--kojo-filet` quand un champ est dans un formulaire, sinon l'utilitaire
 * du champ s'applique). Deux origines légitimes pour un même dessin — la sonde
 * juge donc que les SEPT champs en portent UN seul, pas laquelle.
 */
const CHAMPS = [
  'payment_accounts_orange_money',
  'payment_accounts_wave',
  'payment_accounts_bank_account_number',
  'payment_accounts_bank_name',
  'payment_accounts_bank_account_holder',
  'payment_accounts_bank_code',
  'payment_accounts_bank_branch',
];

// `focus:ring-orange-500/30` : anneau à 30 %.
const ALPHA_ANNEAU = 0.3;
const TOLERANCE_ALPHA = 0.05;
const TOLERANCE_CANAL = 1;

/**
 * Peint la couleur dans un pixel et relit ses canaux (sRGB, alpha compris).
 * Un token de couleur est extrait d'abord : `box-shadow` en contient un parmi
 * des longueurs (`0px 0px 0px 2px`).
 */
/* À appeler par `page.evaluate(fn, valeur)` : `locator.evaluate` remettrait
   l'ÉLÉMENT en premier argument, et la couleur ne serait jamais lue. */
const mesureDeCouleur = (valeur) => {
  const tokens = String(valeur).match(
    /(?:rgba?|oklch|oklab|lab|lch|hsl|hsla|color)\([^)]*\)/gi
  );
  if (!tokens) return null;
  const ctx = document.createElement('canvas').getContext('2d');
  // `box-shadow` porte PLUSIEURS couleurs : le jeton `ring-offset` transparent
  // (`rgba(0, 0, 0, 0) 0px 0px 0px 0px`) précède l'anneau visible. On peint
  // chaque token et on garde le plus OPAQUE — lire le premier rendait
  // « alpha 0,000 » sur un anneau bien présent.
  let retenu = null;
  for (const token of tokens) {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = token;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const mesure = { r, g, b, a: a / 255, brut: token };
    if (!retenu || mesure.a > retenu.a) retenu = mesure;
  }
  return retenu;
};

/** Le dessin calculé d'un champ : rayon, filet, anneau — en sRGB. */
const dessin = (champ) =>
  champ.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      rayon: style.borderTopLeftRadius,
      filet: style.borderTopColor,
      anneau: style.boxShadow,
    };
  });

const approx = (valeur, attendu, tolerance) => Math.abs(valeur - attendu) <= tolerance;

test('les champs de comptes de paiement portent le focus orange du site', async ({ page }) => {
  await connexionALaFixture(page);
  await page.goto('/profile');

  // LE jeton du dessin, lu dans la feuille servie : la couleur de référence
  // n'est pas recopiée ici (une copie divergerait au premier changement de
  // palette, et le rouge accuserait la sonde, pas l'écran).
  const jetonOrange = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-orange-500').trim()
  );
  expect(jetonOrange, 'jeton --color-orange-500 absent de la feuille servie').not.toBe('');
  const orange = await page.evaluate(mesureDeCouleur, jetonOrange);
  expect(orange, `jeton orange illisible : ${jetonOrange}`).not.toBeNull();

  // Le repère de la carte est DÉCLARÉ, jamais une classe de présentation.
  const carte = page.locator('[data-section="comptes-paiement"]');
  await carte.getByRole('button', { name: 'Modifier' }).click();

  const mesures = [];
  for (const id of CHAMPS) {
    const champ = page.locator(`#${id}`);
    await expect(champ, `${id} absent du formulaire d'édition`).toBeVisible();

    const repos = await dessin(champ);
    await champ.focus();
    const focus = await dessin(champ);

    const filetFocus = await page.evaluate(mesureDeCouleur, focus.filet);
    const anneauFocus = await page.evaluate(mesureDeCouleur, focus.anneau);
    mesures.push({ id, repos, focus, filetFocus, anneauFocus });

    // Le rayon du dessin partagé (0.5rem) — plus de `rounded-md` (6 px).
    expect(repos.rayon, `${id} : rayon du champ`).toBe('8px');

    // Focus : le filet passe à l'orange du site (le jeton, pas une teinte
    // approchante — les deux passent par la MÊME conversion sRGB).
    expect(filetFocus, `${id} : filet au focus illisible (${JSON.stringify(focus.filet)})`).not.toBeNull();
    expect(
      approx(filetFocus.r, orange.r, TOLERANCE_CANAL) &&
        approx(filetFocus.g, orange.g, TOLERANCE_CANAL) &&
        approx(filetFocus.b, orange.b, TOLERANCE_CANAL),
      `${id} : filet au focus = ${filetFocus.brut} → sRGB(${filetFocus.r}, ${filetFocus.g}, ${filetFocus.b}) ` +
        `≠ jeton ${jetonOrange} → sRGB(${orange.r}, ${orange.g}, ${orange.b})`
    ).toBe(true);

    // …et l'anneau translucide l'accompagne : orangé, à 30 %.
    expect(anneauFocus, `${id} : anneau de focus absent (box-shadow = ${focus.anneau})`).not.toBeNull();
    expect(
      approx(anneauFocus.a, ALPHA_ANNEAU, TOLERANCE_ALPHA),
      `${id} : alpha de l'anneau = ${anneauFocus.a.toFixed(3)} (${anneauFocus.brut})`
    ).toBe(true);
    expect(
      approx(anneauFocus.r, orange.r, TOLERANCE_CANAL) &&
        approx(anneauFocus.g, orange.g, TOLERANCE_CANAL) &&
        approx(anneauFocus.b, orange.b, TOLERANCE_CANAL),
      `${id} : couleur de l'anneau = ${anneauFocus.brut} ≠ jeton ${jetonOrange}`
    ).toBe(true);
  }

  // Une SEULE couleur de focus pour tout le bloc : le bleu de Wave et le gris de
  // la banque ne sont plus des dessins concurrents.
  const filets = new Set(mesures.map((m) => m.focus.filet));
  const anneaux = new Set(mesures.map((m) => m.focus.anneau));
  expect([...filets], 'couleurs de focus du bloc').toHaveLength(1);
  expect([...anneaux], 'anneaux de focus du bloc').toHaveLength(1);

  console.log(
    `ℹ️  comptes de paiement : ${mesures.length} champ(s) mesuré(s) — rayon ${mesures[0].repos.rayon} · ` +
      `filet au repos unique = ${
        new Set(mesures.map((m) => m.repos.filet)).size === 1 ? 'oui' : 'non'
      } · focus ${[...filets][0]} → sRGB(${mesures[0].filetFocus.r}, ${mesures[0].filetFocus.g}, ` +
      `${mesures[0].filetFocus.b}) · anneau alpha ${mesures[0].anneauFocus.a.toFixed(2)} « ${mesures[0].focus.anneau} »`
  );
});
