/**
 * MESURER LE COÛT D'UN EFFET ANIMÉ, DANS LE NAVIGATEUR, SOUS LA PRÉFÉRENCE RÉELLE.
 *
 * ── Les deux trous que ce harnais ferme ────────────────────────────────────
 * 1. Lighthouse ne joue AUCUN des deux effets : Chrome headless rapporte
 *    `prefers-reduced-motion: reduce`, la feuille éteint alors `kojo-cinetique`
 *    et `kojo-morphe`, et le budget TBT juge donc un dessin IMMOBILE. La
 *    campagne du 19/10/2026 l'a mesuré (`non-composited-animations` muet sur le
 *    build servi, 30/30) — mais sa variante « effets rallumés » était
 *    SYNTHÉTIQUE : elle rallumait le reflet SOUS `reduce`, en laissant les
 *    autres transitions éteintes. Elle ne mesurait donc pas l'état d'un
 *    visiteur réel.
 * 2. Une différence de TBT de l'ordre de 40-60 ms serait sous la résolution de
 *    n = 30, et l'hôte de développement est plus calme qu'un runner de CI.
 *
 * ── Ce que ce harnais mesure, et pourquoi ça se lit sur un runner ──────────
 * `page.emulateMedia({ reducedMotion })` change la préférence que la feuille
 * LIT (CDP `Emulation.setEmulatedMedia`) : l'état « effets allumés » est donc la
 * feuille ENTIÈRE sous `no-preference`, pas un override posé par le test.
 * Chaque passe échantillonne `IMAGES_ECHANTILLON` images RENDUES — la fenêtre
 * est un NOMBRE D'IMAGES, pas une durée en millisecondes — et relève les
 * longues tâches (≥ 50 ms : seuil du NAVIGATEUR, pas un nombre du dépôt).
 *
 * Le verdict est APPARIÉ : A (`reduce`) → B (`no-preference`) → C (`reduce`) sur
 * la MÊME page, et B ne doit pas ajouter de longue tâche au PIRE des deux
 * repos. Ce n'est pas un budget d'hôte : c'est « l'effet n'ajoute pas de
 * blocage », et la référence est le repos mesuré dans le même passage, jamais
 * une constante choisie ici.
 */

/** La fenêtre d'échantillonnage, en IMAGES rendues (aucune durée absolue). */
export const IMAGES_ECHANTILLON = 120;

/**
 * Installe la sonde dans la page, AVANT tout script de l'application.
 *
 * Une sonde qui ne pourrait pas s'installer est un refus de l'appelant, pas un
 * vert : `longtaskSuivi` dit si le navigateur a réellement observé le seuil.
 */
export async function installerSonde(page) {
  await page.addInitScript((images) => {
    window.__effetsAnimes = {
      mesurer() {
        const longues = [];
        let observateur = null;
        try {
          observateur = new PerformanceObserver((liste) => {
            for (const entree of liste.getEntries()) longues.push(entree.duration);
          });
          observateur.observe({ entryTypes: ['longtask'] });
        } catch {
          // Le moteur ne suit pas les longues tâches : la passe le DIT, et
          // l'appelant refuse de conclure plutôt que de publier un zéro muet.
          observateur = null;
        }
        return new Promise((resolve) => {
          const lue = [];
          let precedente = null;
          let restantes = images;
          const tic = (t) => {
            if (precedente !== null) lue.push(t - precedente);
            precedente = t;
            restantes -= 1;
            if (restantes <= 0) {
              if (observateur) observateur.disconnect();
              resolve({ images: lue, longues, longtaskSuivi: observateur !== null });
              return;
            }
            requestAnimationFrame(tic);
          };
          requestAnimationFrame(tic);
        });
      },
    };
  }, IMAGES_ECHANTILLON);
}

/**
 * Une passe sous une préférence de mouvement DONNÉE, sur la page ouverte.
 *
 * `reducedMotion` est la préférence que la feuille lit vraiment : c'est ce qui
 * remplace la variante synthétique de la campagne précédente.
 *
 * @param {import('@playwright/test').Page} page Page où la sonde est installée.
 * @param {{reduit: boolean}} options `reduit: true` = `prefers-reduced-motion: reduce`.
 */
export async function mesurerSousPreference(page, { reduit }) {
  await page.emulateMedia({ reducedMotion: reduit ? 'reduce' : 'no-preference' });
  const mesure = await page.evaluate(() => window.__effetsAnimes.mesurer());
  return { ...mesure, reduit };
}

/**
 * L'état d'animation d'un porteur, lu dans le style CALCULÉ.
 *
 * @param {import('@playwright/test').Page} page Page ouverte.
 * @param {string} selecteur Le porteur de l'effet.
 * @param {string|null} pseudo `'::before'` quand l'effet vit sur un pseudo-élément.
 */
export async function etatAnimation(page, selecteur, pseudo = null) {
  return page.evaluate(
    ([sel, ps]) => {
      const el = document.querySelector(sel);
      if (!el) return { present: false };
      const style = getComputedStyle(el, ps);
      return {
        present: true,
        nom: style.animationName,
        duree: style.animationDuration,
        valeur: ps ? style.borderRadius : style.backgroundPosition,
      };
    },
    [selecteur, pseudo]
  );
}

/**
 * Deux lectures de la propriété animée, séparées d'UNE image.
 *
 * C'est la preuve que l'effet BOUGE : un `animation-name` présent ne dit pas
 * qu'une image change, et une valeur figée passerait pour un effet allumé.
 *
 * @returns {Promise<[string, string]>} Deux valeurs consécutives.
 */
export async function valeurSurDeuxImages(page, selecteur, pseudo, propriete) {
  return page.evaluate(
    ([sel, ps, prop]) =>
      new Promise((resolve) => {
        const el = document.querySelector(sel);
        if (!el) {
          resolve([null, null]);
          return;
        }
        const lire = () => getComputedStyle(el, ps)[prop];
        const premiere = lire();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve([premiere, lire()]));
        });
      }),
    [selecteur, pseudo, propriete]
  );
}

/** Le temps total de blocage d'une passe (0 quand aucune longue tâche n'a eu lieu). */
export const tempsDeBlocage = (mesure) => mesure.longues.reduce((total, d) => total + d, 0);

/** La pire image d'une passe — la plus longue, en ms. */
export const pireImage = (mesure) => (mesure.images.length ? Math.max(...mesure.images) : 0);
