/**
 * LE CYCLE D'UNE MESURE — un état sur disque, des pids que l'on sait arrêter, et
 * un arrêt qui ne laisse rien derrière lui.
 *
 * ── POURQUOI CE MODULE EXISTE (mesuré le 28/10/2026) ────────────────────────
 * `mesure-lighthouse-locale.mjs` démonte sa pile dans son `finally`. Un `finally`
 * n'est atteint que si le processus va jusqu'au bout : un SIGTERM (un `kill` sur
 * le shell qui l'a lancé), une erreur non rattrapée ou une fermeture de fenêtre
 * le sautent, et la pile SURVIT — mesuré en tuant la mesure à 14 s, en pleine
 * passe : **10 processus Chrome** (`--user-data-dir=…\Temp\lighthouse.*`) et les
 * **deux serveurs** (fixture 8123, rewrites 4174) étaient encore vivants, ports à
 * l'écoute compris.
 *
 * Ce que cela coûte n'est pas la fuite elle-même, c'est le CHIFFRE qu'elle
 * fabrique. Sur le même artefact (`build` de `main`, `/`, preset mobile ×4 CPU),
 * une seule pile mesure **417 à 793 ms** de Style & Layout et des tâches longues
 * de **112 à 272 ms** ; deux piles qui mesurent EN MÊME TEMPS (la fuite d'une
 * session précédente continuait sa passe) ont rendu **2 528 ms**, puis
 * **3 540 à 4 295 ms**, avec des Speed Index étendus de **3 822 ms** sur un seul
 * artefact. Le chiffre « 1 511 à 2 445 ms de tâche longue sur / » qui a circulé
 * décrivait donc l'HÔTE, pas le document pré-rendu — et il a été pris pour un
 * levier de performance pendant une journée.
 *
 * D'où l'état sur disque : la mesure refuse de démarrer si l'état d'une
 * précédente est encore là (elle nomme les pids à arrêter), et elle efface le
 * sien quand elle se termine — ou quand un signal l'interrompt, parce qu'elle a
 * branché les signaux.
 *
 * Le module est PUR (aucun effet de bord à l'import) : ses règles se testent
 * sans lancer ni Chrome ni un serveur.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** L'état vit dans le dossier temporaire : il ne suit pas le dépôt d'une mesure à l'autre. */
export const CHEMIN_ETAT = path.join(os.tmpdir(), 'kojo-mesure-lighthouse-etat.json');

/** Les signaux qu'un shell, un IDE ou un runner envoient à un processus qu'on arrête. */
export const SIGNAUX = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * `true` si le pid désigne un processus vivant.
 *
 * `EPERM` compte pour vivant : le processus existe, il n'est simplement pas à
 * nous — le déclarer mort ferait mesurer à côté de la pile qu'on n'a pas pu
 * arrêter, c'est-à-dire exactement le défaut que ce module ferme.
 */
export function pidVivant(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (erreur) {
    return erreur?.code === 'EPERM';
  }
}

export function ecrireEtat(etat, chemin = CHEMIN_ETAT) {
  writeFileSync(chemin, JSON.stringify({ debut: new Date().toISOString(), ...etat }, null, 2));
  return chemin;
}

export function effacerEtat(chemin = CHEMIN_ETAT) {
  try {
    rmSync(chemin, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ce que la mesure PRÉCÉDENTE a laissé, ou `null` si rien ne traîne.
 *
 * Trois cas, trois refus distincts, tous nommés :
 *   • l'état est ILLISIBLE (fichier tronqué par un arrêt brutal) : on ne peut
 *     nommer aucun pid, donc on ne peut pas dire que la place est libre ;
 *   • des pids enregistrés sont VIVANTS : la passe précédente mesure encore ;
 *   • aucun pid n'est vivant mais l'état est là : la mesure est morte avant sa
 *     dernière ligne — la pile a pu fuiter sous d'autres pids que ceux notés.
 * Le silence n'est aucun des trois.
 */
const pidDeLaPasse = (etat) => (Number.isInteger(etat.pid) && etat.pid > 0 ? etat.pid : null);

export function etatAnterieur(chemin = CHEMIN_ETAT, { vivant = pidVivant } = {}) {
  if (!existsSync(chemin)) return null;

  let etat = null;
  try {
    etat = JSON.parse(readFileSync(chemin, 'utf8'));
  } catch {
    etat = null;
  }

  if (!etat || typeof etat !== 'object') {
    return {
      chemin,
      illisible: true,
      pids: [],
      vivants: [],
      refus: `l'état d'une mesure précédente est ILLISIBLE (${chemin}) : sa pile a peut-être survécu à un arrêt brutal, et aucun pid ne s'y lit pour l'arrêter — vérifiez les processus \`chrome\` et les ports 4174/8123, puis relancez avec --nettoyer`,
    };
  }

  // Dédupliqués : le même pid y figure légitimement deux fois (arrêté sur signal,
  // puis relancé), et un message qui répète « 37481, 37481 » se lit mal.
  const pids = [
    ...new Set(
      [etat.chrome, pidDeLaPasse(etat), ...(Array.isArray(etat.serveurs) ? etat.serveurs : [])].filter(
        (pid) => Number.isInteger(pid) && pid > 0
      )
    ),
  ];
  const vivants = pids.filter((pid) => vivant(pid));
  const refus = vivants.length
    ? `une mesure précédente TOURNE ENCORE (état ${chemin}, depuis ${etat.debut || 'date inconnue'}) : pid(s) vivant(s) ${vivants.join(', ')} — deux piles qui mesurent en même temps rendent des chiffres qui décrivent l'hôte et non la page (mesuré le 28/10/2026 : 2 528 à 4 295 ms de Style & Layout au lieu de 417 à 793). Arrêtez ces pid(s), ou relancez avec --nettoyer`
    : `une mesure précédente ne s'est PAS TERMINÉE (état ${chemin}, depuis ${etat.debut || 'date inconnue'}, aucun pid vivant — les pid(s) ${pids.join(', ') || 'aucun'} ont disparu, sa pile a pu fuiter) : vérifiez les processus \`chrome\` et les ports 4174/8123, puis relancez avec --nettoyer`;

  return { chemin, illisible: false, pids, vivants, refus };
}

/**
 * Arrête les pid(s) indiqués — jamais le processus courant, jamais un pid
 * absent — et rend ceux qui ont RÉELLEMENT été arrêtés : un pid déjà mort n'a
 * pas été arrêté par nous, et le dire évite de publier un « nettoyé » qui ne
 * décrit rien.
 */
export function arreterPids(pids, tuer = (pid) => process.kill(pid), moi = process.pid) {
  const arretes = [];
  for (const pid of pids || []) {
    if (!Number.isInteger(pid) || pid <= 0 || pid === moi) continue;
    try {
      tuer(pid);
      arretes.push(pid);
    } catch {
      /* déjà mort : rien à arrêter, et rien à dire */
    }
  }
  return arretes;
}

/**
 * Branche l'arrêt sur les signaux et rend la fonction qui le débranche.
 *
 * Le gestionnaire ne s'exécute qu'UNE fois (un second signal pendant le
 * nettoyage ne relance pas la séquence), et chaque signal est branché
 * séparément : Windows ne connaît pas `SIGHUP`, et un `process.on` qui lève là
 * ferait perdre AUSSI `SIGINT` et `SIGTERM`.
 */
export function brancherArret(surArret, { signaux = SIGNAUX, processus = process } = {}) {
  let pris = false;
  const gestionnaires = new Map();

  for (const signal of signaux) {
    const gestionnaire = () => {
      if (pris) return;
      pris = true;
      try {
        surArret(signal);
      } catch {
        /* on sort quand même : un nettoyage qui jette ne doit pas laisser la pile */
      }
    };
    try {
      processus.on(signal, gestionnaire);
      gestionnaires.set(signal, gestionnaire);
    } catch {
      /* signal inconnu de cette plateforme */
    }
  }

  return () => {
    for (const [signal, gestionnaire] of gestionnaires) {
      try {
        processus.removeListener(signal, gestionnaire);
      } catch {
        /* déjà débranché */
      }
    }
  };
}

/**
 * n, min, médiane, max, étendue — la forme sous laquelle une mesure dit si elle
 * peut attribuer quelque chose. Une différence plus petite que l'étendue n'est
 * pas un effet de l'artefact : c'est l'hôte.
 */
export function dispersionDe(valeurs) {
  const triees = (valeurs || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!triees.length) return null;
  const n = triees.length;
  const mediane = n % 2 ? triees[(n - 1) / 2] : (triees[n / 2 - 1] + triees[n / 2]) / 2;
  return { n, min: triees[0], mediane, max: triees[n - 1], etendue: triees[n - 1] - triees[0] };
}
