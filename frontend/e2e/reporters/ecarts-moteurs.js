/**
 * PLACER LE TABLEAU DES ÉCARTS DANS LE REPORT PLAYWRIGHT, À CHAQUE EXÉCUTION.
 *
 * ── Ce que ce rapporteur fait, et ce qu'il ne fait PAS ─────────────────────
 * Le tableau des écarts par moteur est DÉJÀ calculé et publié une fois, après
 * tous les projets, par `e2e/global-teardown-moteurs.js` (au journal et dans
 * `test-results/ecarts-moteurs.md`). Ce rapporteur ne le recalcule donc PAS —
 * deux calculs d'une même mesure finiraient par diverger, et c'est exactement ce
 * que le dépôt refuse ailleurs. Il TRANSPORTE le résumé publié vers les deux
 * endroits qui n'existent qu'à la fin de l'exécution :
 *   • `playwright-report/ecarts-moteurs.md` — le résumé est ainsi DANS le report
 *     Playwright (le dossier d'artefact), à côté de `index.html` ;
 *   • le RÉSUMÉ DU RUN (`$GITHUB_STEP_SUMMARY`) — lisible sans télécharger
 *     l'artefact.
 *
 * ── Pourquoi un RAPPORTEUR, et pas le teardown ─────────────────────────────
 * MESURÉ dans la source de Playwright 1.63.0
 * (`node_modules/playwright/lib/runner/index.js`) : les tâches globales
 * (dont `globalTeardown`) sont exécutées AVANT `reporter.onEnd()`, et le
 * rapporteur HTML — dont le commentaire dit lui-même « HTML reporter will clear
 * its output directory prior to being generated, which will lead to the artifact
 * loss » — efface puis régénère `playwright-report/` dans SON `onEnd`. Un fichier
 * écrit par le teardown dans ce dossier serait donc PERDU. Les rapporteurs sont
 * appelés dans l'ORDRE de la liste de `playwright.config.js` (`Multiplexer.onEnd`
 * itère `this._reporters`), donc celui-ci est déclaré APRÈS `html` : quand il
 * écrit, le rapport existe et ne sera plus effacé.
 *
 * ── Pourquoi il ne dit rien quand il n'a rien à dire ───────────────────────
 * Deux absences sont NORMALES et ne doivent pas rougir : le rapport HTML n'est
 * produit qu'en CI (la config déclare ce rapporteur dans la même condition), et
 * une exécution sans relevé n'a pas de tableau à placer. Une TROISIÈME absence,
 * elle, est DITE : si le fichier publié par le teardown manque alors que ce
 * dernier devait l'écrire, c'est le CÂBLAGE qui a changé (teardown retiré de la
 * config, chemin déplacé) — et un rapport qui ne se placerait nulle part en
 * silence serait un faux vert, pas une absence.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Le résumé PUBLIÉ par `e2e/global-teardown-moteurs.js` (sa source unique). */
export const SOURCE_DEFAUT = path.resolve('test-results', 'ecarts-moteurs.md');

/** Où le déposer pour qu'il soit DANS le report Playwright. */
export const DESTINATION_DEFAUT = path.resolve('playwright-report', 'ecarts-moteurs.md');

/**
 * Place le résumé publié dans le report, et dans le résumé du run quand il est demandé.
 *
 * Toutes les E/S sont ici et sont injectables : l'écriture se prouve sur des
 * dossiers temporaires (`scripts/__tests__/check-moteurs-gestes.test.js`), pas en
 * croyant une exécution.
 *
 * @param {object} [options]
 * @param {string} [options.source] Fichier publié par le teardown.
 * @param {string} [options.destination] Copie à écrire dans le dossier du report.
 * @param {string} [options.resume] Fichier de résumé du run (`$GITHUB_STEP_SUMMARY`), ou ''.
 * @param {(ligne: string) => void} [options.journaliser]
 * @returns {{place: string[], manquant: string|null, raison: string}}
 *   `place` : les fichiers réellement écrits ; `manquant` : la source absente, nommée.
 */
export function placerLeResume({
  source = SOURCE_DEFAUT,
  destination = DESTINATION_DEFAUT,
  resume = process.env.GITHUB_STEP_SUMMARY || '',
  journaliser = (ligne) => console.log(ligne),
} = {}) {
  let contenu;
  try {
    contenu = fs.readFileSync(source, 'utf8');
  } catch {
    journaliser(
      `⚠️  résumé des écarts non placé : « ${source} » est introuvable — le tableau devait être ` +
        'publié par e2e/global-teardown-moteurs.js avant la fin de l’exécution ; vérifier qu’il est ' +
        'toujours déclaré dans playwright.config.js (globalTeardown).'
    );
    return { place: [], manquant: source, raison: 'source introuvable' };
  }

  const place = [];

  // Le dossier du report est créé par le rapporteur HTML : s'il n'existe pas,
  // cette exécution n'a pas produit de report (hors CI) et il n'y a rien à
  // compléter — on ne fabrique pas un dossier de report vide.
  if (fs.existsSync(path.dirname(destination))) {
    fs.writeFileSync(destination, contenu, 'utf8');
    place.push(destination);
  } else {
    journaliser(
      `ℹ️  résumé des écarts non déposé dans un report : « ${path.dirname(destination)} » n'existe ` +
        'pas (cette exécution ne produit pas de report HTML). Le tableau reste dans ' +
        `« ${source} ».`
    );
  }

  if (resume) {
    try {
      fs.appendFileSync(resume, avecSautDeLigne(contenu), 'utf8');
      place.push(resume);
    } catch (erreur) {
      journaliser(`⚠️  résumé des écarts non ajouté au résumé du run : ${erreur.message}`);
    }
  }

  for (const fichier of place) journaliser(`ℹ️  résumé des écarts placé dans : ${fichier}`);
  return {
    place,
    manquant: null,
    raison: place.length ? '' : 'ni report HTML, ni résumé de run à compléter',
  };
}

/** Le contenu se colle après un saut de ligne, jamais dans le mot précédent. */
function avecSautDeLigne(texte) {
  return texte.endsWith('\n') ? texte : `${texte}\n`;
}

/**
 * Le rapporteur Playwright. `onEnd` s'exécute APRÈS la génération du report HTML
 * (les rapporteurs sont appelés dans l'ordre de la liste), donc la copie survit.
 */
export default class RapportEcartsMoteurs {
  onEnd() {
    placerLeResume();
  }
}
