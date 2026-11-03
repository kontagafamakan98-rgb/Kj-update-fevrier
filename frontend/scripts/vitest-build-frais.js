/**
 * LE `build/` QUE JUGENT LES TESTS EST CELUI DES SOURCES, OU IL N'EST PAS JUGÉ.
 *
 * ── Le défaut, mesuré le 03/11/2026 ─────────────────────────────────────────
 * La suite complète comptait HUIT rouges sans rebuild, SEPT après un
 * `npm run build` de 8,9 s. Ces sept cas n'avaient rien trouvé dans le
 * produit : ils jugeaient un `build/` d'une révision PRÉCÉDENTE — budget CSS
 * d'avant une règle, coquilles d'avant une clé, pré-rendu d'avant une section
 * — et le disaient comme un défaut du code. Un rouge qu'un rebuild efface
 * apprend à relancer au lieu de lire, et c'est exactement le prix qu'un garde
 * ne peut pas se permettre de faire payer.
 *
 * Il y avait deux états, et le dépôt n'en traitait qu'un :
 *   * `build/` ABSENT (c'est l'état de la CI, où `npm test` tourne AVANT le
 *     build) : les gardes d'artefact se déclarent alors en PRÉMISSE et
 *     passent — mesuré, 472 tests verts sans `build/` sur les dix-neuf
 *     fichiers qui le lisent ;
 *   * `build/` PÉRIMÉ (l'état d'un poste de développement) : aucun garde ne
 *     le distinguait d'un artefact courant, donc sept d'entre eux rendaient
 *     un verdict FAUX sur un objet périmé.
 *
 * ── La règle ───────────────────────────────────────────────────────────────
 * Avant la suite, si `build/index.html` existe mais date d'AVANT la plus
 * récente source publiée, le build est refait UNE fois (9 s mesurées). S'il
 * n'existe pas, on ne construit rien : la CI garde son ordre (tests puis
 * build) et chaque garde garde sa prémisse. Si le rebuild échoue, la suite
 * s'arrête sur une cause NOMMÉE — un build impossible n'est pas sept défauts
 * de produit, et c'est le seul message que ces sept cas ne savaient pas dire.
 *
 * Ce que ce fichier ne fait pas : il ne juge aucun contenu, ne réécrit aucune
 * attente et ne masque aucun échec. Il publie sa décision (à jour, reconstruit,
 * absent) sur la sortie standard, parce qu'une reconstruction silencieuse
 * laisserait croire que le `build/` trouvé était le bon.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Ce qui entre DANS `build/` : un fichier de ces arbres modifié après le build
 * rend l'artefact périmé. `scripts/` n'y est pas — ce sont les gardes, ils ne
 * sont pas publiés.
 */
const SOURCES = [
  'src',
  'public',
  'vite-plugins',
  'api',
  'index.html',
  'vite.config.js',
  'package.json',
  'vercel.json',
];

const REVISION = path.join('build', 'index.html');

/** La date de modification la plus RÉCENTE d'un fichier ou d'un arbre. */
export function plusRecent(cible) {
  let quand;
  const visiter = (chemin) => {
    let stats;
    try {
      stats = fs.statSync(chemin);
    } catch {
      return; // disparu entre deux lectures : ce n'est pas une source publiée
    }
    if (stats.isDirectory()) {
      for (const entree of fs.readdirSync(chemin, { withFileTypes: true })) {
        visiter(path.join(chemin, entree.name));
      }
      return;
    }
    if (quand === undefined || stats.mtimeMs > quand) quand = stats.mtimeMs;
  };
  visiter(cible);
  return quand;
}

/** `{etat, sources, build, retard}` — `etat` ∈ `frais` | `perime` | `absent`. */
export function etatDuBuild(racine = RACINE) {
  const build = path.join(racine, REVISION);
  let dateBuild;
  try {
    dateBuild = fs.statSync(build).mtimeMs;
  } catch {
    return { etat: 'absent', sources: undefined, build: undefined, retard: 0 };
  }
  let sources;
  for (const nom of SOURCES) {
    const quand = plusRecent(path.join(racine, nom));
    if (quand !== undefined && (sources === undefined || quand > sources)) sources = quand;
  }
  if (sources === undefined) {
    // Aucune source lue : on ne peut pas dater l'écart, donc on ne reconstruit
    // pas au hasard — et on le dit.
    return { etat: 'frais', sources: undefined, build: dateBuild, retard: 0 };
  }
  const retard = sources - dateBuild;
  return {
    etat: retard > 0 ? 'perime' : 'frais',
    sources,
    build: dateBuild,
    retard: Math.max(0, Math.round(retard / 1000)),
  };
}

/**
 * Le hook `globalSetup` de Vitest. Vitest ne lui applique AUCUN plafond de
 * temps (il tourne dans le processus principal, hors du pool de workers) :
 * aucune borne absolue n'entre ici, donc rien à déclarer au garde des juges de
 * temps.
 *
 * Il n'accepte AUCUN argument : Vitest appelle `setup(project)` avec un objet
 * de projet, et le prendre pour un chemin rendait `path.join(TestProject)` —
 * mesuré le 03/11/2026, où la suite entière est tombée sur ce TypeError au
 * lieu de juger quoi que ce soit. La racine est donc lue ici, et `preparer`
 * (exporté) est ce que les cas éprouvent.
 */
export default function setup() {
  preparer(RACINE);
}

/** La décision et son exécution, sur une racine DONNÉE (éprouvable). */
export function preparer(racine = RACINE) {
  const etat = etatDuBuild(racine);

  if (etat.etat === 'absent') {
    console.log(
      '[build] absent — la suite juge ce qu’elle peut construire elle-même (CI : ' +
        '`npm test` précède `npm run build`) ; les gardes d’artefact se déclarent ' +
        'en PRÉMISSE au lieu de juger un dossier qui n’existe pas.'
    );
    return;
  }

  if (etat.etat === 'frais') {
    console.log('[build] à jour avec les sources — rien à reconstruire.');
    return;
  }

  console.log(
    `[build] PÉRIMÉ de ${etat.retard} s (source plus récente que build/index.html) : ` +
      'reconstruction avant la suite, pour que les gardes d’artefact jugent les ' +
      'sources de cette révision et non celles d’avant.'
  );
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const build = spawnSync(npm, ['run', 'build'], {
    cwd: racine,
    stdio: 'inherit',
    env: process.env,
    // Windows : `npm` est un `.cmd`, et un `.cmd` ne se lance pas sans shell
    // depuis Node 18 (spawnSync rend EINVAL — mesuré ici le 03/11/2026, où la
    // reconstruction a refusé de démarrer). Ailleurs, pas de shell du tout :
    // aucun argument ne traverse d'interpréteur.
    shell: process.platform === 'win32',
  });
  if (build.error) {
    throw new Error(
      `build/ PÉRIMÉ et la reconstruction n’a pas pu démarrer (${build.error.message}) : ` +
        'les sept gardes d’artefact ne sont PAS jugés. Lancer `npm run build` dans ' +
        'frontend/ et relancer la suite.'
    );
  }
  if (build.status !== 0) {
    throw new Error(
      `build/ PÉRIMÉ et la reconstruction a ÉCHOUÉ (code ${build.status}) : ce n’est ` +
        'pas un défaut de produit mais un artefact impossible à produire, et aucun ' +
        'garde d’artefact n’est jugé. La sortie du build ci-dessus porte la cause.'
    );
  }
  console.log('[build] reconstruit — les gardes d’artefact jugent la révision courante.');
}
