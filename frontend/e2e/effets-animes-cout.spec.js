import { test, expect } from '@playwright/test';
import { attendreLaStabilite } from './helpers/geometrie.js';
import { connexionALaFixture } from './helpers/parcours-carte.js';
import {
  IMAGES_ECHANTILLON,
  etatAnimation,
  installerSonde,
  mesurerSousPreference,
  pireImage,
  tempsDeBlocage,
  valeurSurDeuxImages,
} from './helpers/effets-animes.js';

/**
 * LE COÛT DES DEUX EFFETS ANIMÉS, MESURÉ LÀ OÙ ILS TOURNENT VRAIMENT.
 *
 * ── Ce que ce parcours remplace ────────────────────────────────────────────
 * La campagne Lighthouse du 19/10/2026 a mesuré que la CI juge un dessin
 * IMMOBILE : Chrome headless rapporte `prefers-reduced-motion: reduce`, donc le
 * reflet et la morphose sont éteints dans toutes ses passes. Sa variante
 * « effets rallumés » était synthétique (reflet rallumé sous `reduce`), et le
 * TBT à n = 30 ne verrait pas un coût de 40-60 ms.
 *
 * Ici, la préférence est la VRAIE (`emulateMedia`), la fenêtre est un NOMBRE
 * D'IMAGES rendues, et la mesure est APPARIÉE sur la même page : repos, effets,
 * repos. Le verdict ne compare pas à un budget d'hôte — il compare l'effet au
 * PIRE des deux repos mesurés dans le même passage.
 *
 * ── Ce que le parcours refuse de laisser passer ────────────────────────────
 * • un effet qui ne TOURNE pas (nom d'animation absent, ou valeur figée entre
 *   deux images) : sans cette preuve, un zéro de blocage ne dirait rien ;
 * • un repos où l'animation tourne encore : la comparaison serait fausse ;
 * • un navigateur qui ne suit pas les longues tâches : la passe le déclare, et
 *   le cas refuse de conclure au lieu de publier un zéro muet.
 */

/** Publie une passe dans le journal du run — une mesure qu'on ne lit pas ne sert à rien. */
function publier(etiquette, mesure) {
  const blocage = tempsDeBlocage(mesure);
  console.log(
    `[effets] ${etiquette} : ${mesure.images.length} images, ` +
      `blocage ${Math.round(blocage)} ms sur ${mesure.longues.length} longue(s) tâche(s) ` +
      `(seuil du navigateur, jamais recopié ici), pire image ${Math.round(pireImage(mesure))} ms`
  );
}

/**
 * Le verdict APPARIÉ : les effets n'ajoutent pas de blocage au pire des repos.
 * Le pire repos est la référence — jamais une constante, jamais l'hôte supposé.
 */
function juger(effets, reposA, reposC, etiquette) {
  const reference = Math.max(tempsDeBlocage(reposA), tempsDeBlocage(reposC));
  expect(
    effets.longtaskSuivi && reposA.longtaskSuivi && reposC.longtaskSuivi,
    'le navigateur ne suit pas les longues tâches : la mesure serait aveugle'
  ).toBe(true);
  expect(
    effets.images.length,
    `la fenêtre d'échantillonnage n'a pas rendu ses ${IMAGES_ECHANTILLON} images`
  ).toBeGreaterThanOrEqual(IMAGES_ECHANTILLON - 1);
  expect(
    tempsDeBlocage(effets),
    `${etiquette} : les effets ajoutent du blocage — ` +
      `${Math.round(tempsDeBlocage(effets))} ms contre ${Math.round(reference)} ms au pire repos`
  ).toBeLessThanOrEqual(reference);
}

test.describe('coût des effets animés — préférence réelle, fenêtre en images', () => {
  test('le reflet du héros tourne sous `no-preference` sans ajouter de longue tâche', async ({
    page,
  }) => {
    await installerSonde(page);
    await page.goto('/');
    await page.waitForSelector('.titre-heros', { timeout: 15000 });
    await attendreLaStabilite(page);

    // Une passe de chauffe, JETÉE : elle absorbe l'hydratation et les images qui
    // arrivent après le premier écran. Sans elle, le premier « repos » porterait
    // le coût du chargement, et l'effet serait innocenté par comparaison.
    publier('chauffe (jetée)', await mesurerSousPreference(page, { reduit: true }));

    const reposA = await mesurerSousPreference(page, { reduit: true });
    const etatReposA = await etatAnimation(page, '.titre-heros');
    publier('repos A', reposA);

    const effets = await mesurerSousPreference(page, { reduit: false });
    const etatEffets = await etatAnimation(page, '.titre-heros');
    const [avant, apres] = await valeurSurDeuxImages(page, '.titre-heros', null, 'backgroundPosition');
    publier('effets', effets);

    const reposC = await mesurerSousPreference(page, { reduit: true });
    const etatReposC = await etatAnimation(page, '.titre-heros');
    publier('repos C', reposC);

    // L'effet TOURNE — et il ne tourne QUE sous la préférence qui l'autorise.
    expect(etatEffets.present).toBe(true);
    expect(etatEffets.nom).toBe('kojo-cinetique');
    expect(etatReposA.nom).toBe('none');
    expect(etatReposC.nom).toBe('none');
    expect(apres, 'le reflet est déclaré mais la position du dégradé ne bouge pas').not.toBe(avant);

    juger(effets, reposA, reposC, 'reflet du héros');
  });

  test('la morphose du bandeau tourne sur le tableau de bord sans ajouter de longue tâche', async ({
    page,
  }) => {
    await installerSonde(page);
    await connexionALaFixture(page);
    await page.waitForSelector('.bande-app', { timeout: 15000 });
    await attendreLaStabilite(page);

    publier('chauffe (jetée)', await mesurerSousPreference(page, { reduit: true }));

    const reposA = await mesurerSousPreference(page, { reduit: true });
    const etatReposA = await etatAnimation(page, '.bande-app', '::before');
    publier('repos A', reposA);

    const effets = await mesurerSousPreference(page, { reduit: false });
    const etatEffets = await etatAnimation(page, '.bande-app', '::before');
    const [avant, apres] = await valeurSurDeuxImages(page, '.bande-app', '::before', 'borderRadius');
    publier('effets', effets);

    const reposC = await mesurerSousPreference(page, { reduit: true });
    const etatReposC = await etatAnimation(page, '.bande-app', '::before');
    publier('repos C', reposC);

    expect(etatEffets.present).toBe(true);
    expect(etatEffets.nom).toBe('kojo-morphe');
    expect(etatReposA.nom).toBe('none');
    expect(etatReposC.nom).toBe('none');
    expect(apres, 'la morphose est déclarée mais le rayon ne bouge pas').not.toBe(avant);

    juger(effets, reposA, reposC, 'morphose du bandeau');
  });
});
