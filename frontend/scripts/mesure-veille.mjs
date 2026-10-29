/**
 * LA VEILLE D'UNE MESURE — démonter la pile quand la passe meurt sans le dire.
 *
 * ── POURQUOI CE PROCESSUS EXISTE (mesuré le 28/10/2026) ─────────────────────
 * `mesure-lighthouse-locale.mjs` branche `SIGINT`/`SIGTERM`/`SIGHUP` et démonte
 * sa pile dans son `finally`. Sur un poste Windows, AUCUN des deux ne suffit :
 * `kill -TERM` sur un processus natif passe par `TerminateProcess`, qui ne
 * livre aucun signal — mesuré, la mesure tuée à 14 s en pleine passe laissait
 * **10 à 11 processus Chrome** et **les deux serveurs** (ports 4174 et 8123 à
 * l'écoute), sans qu'une seule ligne d'arrêt soit écrite. Le `finally` n'est
 * atteint que si le processus va au bout, et TerminateProcess ne va pas au bout.
 *
 * D'où un processus SÉPARÉ, DÉTACHÉ (`detached: true` : il ne reçoit pas le
 * Ctrl+C de la console) qui interroge la vie de la passe une fois par seconde :
 *   • la passe est morte et l'état est encore là → il arrête les pid(s) que
 *     l'état nomme et retire l'état (c'est le cas que rien d'autre ne couvre) ;
 *   • l'état a disparu → la passe s'est terminée normalement, la veille sort ;
 *   • l'état est illisible → il ne détruit rien : il laisse le fichier, et la
 *     passe suivante le publicra comme ILLISIBLE (un état qu'on efface sans
 *     pouvoir le lire ferait croire que la place est libre).
 *
 * Ce qu'il ne fait pas : il ne mesure rien, n'écrit aucun chiffre, et ne dit
 * rien — sa preuve est l'absence de ce qui restait.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CHEMIN_ETAT, arreterPids, effacerEtat, etatAnterieur, pidVivant } from './mesure-cycle.mjs';

const attendreVraiment = (ms) => new Promise((resoudre) => setTimeout(resoudre, ms));

/**
 * Surveille la passe `pid` jusqu'à ce qu'elle disparaisse, puis démonte.
 *
 * Tout est injectable (`vivant`, `attendre`, `arreter`) : la règle se teste sans
 * lancer ni Chrome, ni serveur, ni horloge.
 */
export async function veiller({
  pid,
  chemin = CHEMIN_ETAT,
  intervalle = 1000,
  essaisMax = 900,
  vivant = pidVivant,
  attendre = attendreVraiment,
  arreter = arreterPids,
} = {}) {
  for (let essai = 0; essai < essaisMax; essai += 1) {
    const anterieur = etatAnterieur(chemin);
    if (!anterieur) return { nettoye: false, motif: 'terminee' };
    // Un état ILLISIBLE ne nomme aucun pid : on ne peut rien arrêter, et
    // l'effacer ferait croire que la place est libre. On le laisse à la passe
    // suivante, qui le publicra comme ILLISIBLE (refus nommé).
    if (anterieur.illisible) return { nettoye: false, motif: 'etat-illisible' };
    if (vivant(pid)) {
      await attendre(intervalle);
      continue;
    }
    // La passe a disparu SANS retirer son état : c'est la fuite.
    const arretes = arreter(anterieur.pids);
    effacerEtat(chemin);
    return { nettoye: true, arretes, motif: 'passe-disparue' };
  }
  return { nettoye: false, motif: 'veille-expiree' };
}

/** Lance la veille détachée, et rend de quoi la laisser tranquille. */
export function lancerVeille(pid, { cwd, script, chemin = CHEMIN_ETAT } = {}) {
  const enfant = spawn(
    process.execPath,
    // `fileURLToPath` et pas `.pathname` : sous Windows le chemin d'une URL
    // commence par « /C:/… », que `spawn` ne sait pas ouvrir.
    [script || fileURLToPath(new URL('./mesure-veille.mjs', import.meta.url)), '--pid', String(pid), '--etat', chemin],
    { cwd, detached: true, stdio: 'ignore', windowsHide: true }
  );
  enfant.unref();
  return enfant;
}

// ── Entrée en ligne de commande (`--pid <pid>`, `--etat <chemin>`) ───────────
const estLanceDirectement = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (estLanceDirectement) {
  const lire = (nom) => {
    const index = process.argv.indexOf(`--${nom}`);
    return index > -1 ? process.argv[index + 1] : undefined;
  };
  const pid = Number(lire('pid'));
  if (!Number.isInteger(pid) || pid <= 0) process.exit(2);
  veiller({ pid, chemin: lire('etat') || CHEMIN_ETAT })
    .then(() => process.exit(0))
    .catch(() => process.exit(2));
}
