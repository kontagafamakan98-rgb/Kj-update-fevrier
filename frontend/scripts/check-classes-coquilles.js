/**
 * GARDE « UNE COQUILLE NE RECOPIE PAS UNE CLASSE » — étape CI.
 *
 * ── Le fait, en une phrase ──────────────────────────────────────────────────
 * Toute liste de classes écrite EN LITTÉRAL dans `vite-plugins/prerender/**`
 * doit avoir un JUMEAU entier chez React (une valeur de `className` de `src/**`),
 * ou être DÉCLARÉE propre à la coquille avec son motif — et les champs du
 * DOMICILE partagé (src/config/classes-chrome.js) doivent être LUS par les deux
 * canaux, jamais retapés.
 *
 * ── Pourquoi ce garde existe (mesure du 09/10/2026) ─────────────────────────
 * Les coquilles écrivaient 236 listes de classes en littéral, dont 203 avaient un
 * jumeau exact dans `src/**` (relevé rejoué sur l'état d'avant : `listes: 236,
 * avecJumelle: 203`) : deux peintures de la même page, dont chacune gardait sa
 * copie. Rien ne rougissait quand un seul côté changeait — une classe recopiée ne
 * déplace pas un texte, elle change un état (grisé, bordure, ombre), et cela ne
 * se voit qu'à l'œil sur la page. La passe a ramené le compte à **213 listes,
 * dont 182 jumelles et 31 déclarées** : les 23 restantes sont celles qui sont
 * passées au DOMICILE partagé (les 18 du chrome, lues par app-chrome.js ET par
 * src/App.js + src/components/Navbar.js, et les 5 conteneurs de page de
 * l'accueil), donc elles ne sont plus des copies du tout.
 *
 * ── Les deux moitiés ────────────────────────────────────────────────────────
 *   • la RÉUTILISATION — ce qui est partagé vit dans UN domicile, lu par React ET
 *     par la coquille (`verdictDomicile` : un champ lu par un seul canal est un
 *     défaut, et un champ RETAPÉ dans une coquille aussi) ;
 *   • la DÉTECTION — ce qui n'est pas partagé est nommé (`verdictListesCoquilles`
 *     : le jumeau disparaît dès qu'un des deux côtés retouche sa copie, et une
 *     déclaration périmée ou menteuse est refusée).
 *
 * ── Deux niveaux de refus, et le second n'est pas un détail ────────────────
 * Le garde REFUSE DE JUGER (`erreurs` de lecture) s'il lit moins de 5 modules de
 * pré-rendu, moins de 90 sources React, moins de 128 listes publiées ou moins de
 * 110 jumelles — un balayage qui n'a rien lu ne prouve rien, et un lecteur cassé
 * produirait un faux vert. Il refuse aussi un dossier de pré-rendu absent, un
 * dossier `src/` absent et un domicile introuvable. Ces refus-là sont SÉPARÉS des
 * écarts (`defauts`) : un refus dit « je n'ai pas pu juger », un défaut dit
 * « l'arbre est en écart » — les confondre ferait passer une panne de lecture
 * pour un verdict.
 *
 * Ce qu'il ne prouve PAS, et qui est écrit ici plutôt que tu : le jumeau dit que
 * la chaîne existe quelque part chez React, pas que c'est le même ÉLÉMENT. Cette
 * moitié est mesurée dans un navigateur (`e2e/geometrie-coquille-react.spec.js`,
 * `e2e/texte-coquille-react.spec.js`), et le domicile partagé, lui, garantit
 * l'identité de la VALEUR par construction.
 *
 * ── PAS DE `#!`, ET C'EST LE MÊME CHOIX QUE SON VOISIN ────────────────────
 * Ce fichier exporte `verifierClassesCoquilles` pour que sa preuve l'éprouve sans
 * passer par un sous-processus. Le hashbang des gardes voisins n'est donc pas
 * recopié : le fichier est lancé par `node scripts/check-classes-coquilles.js`,
 * jamais comme exécutable.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   cd frontend && node scripts/check-classes-coquilles.js
 *   cd frontend && node scripts/check-classes-coquilles.js --root <racine> --domicile <chemin relatif>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CLASSES_CHROME } from '../src/config/classes-chrome.js';
import {
  CLASSES_PROPRES_AUX_COQUILLES,
  DOSSIER_COQUILLES,
  MIN_LISTES_AVEC_JUMELLE,
  MIN_LISTES_LUES,
  MIN_MODULES_COQUILLES,
  MIN_SOURCES_REACT,
  verdictDomicile,
  verdictListesCoquilles,
} from './classes-coquilles.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));

/** La racine du paquet frontend : le dossier qui porte `src/`. */
export const FRONTEND = path.resolve(ICI, '..');

/** Le domicile par défaut, relatif à la racine. */
export const DOMICILE_PAR_DEFAUT = 'src/config/classes-chrome.js';

/** Le chemin d'un fichier, en séparateurs POSIX (pour des messages stables). */
const relatif = (racine, chemin) => path.relative(racine, chemin).split(path.sep).join('/');

/** Les `.js` d'un dossier (non récursif), triés. */
function modulesDe(dossier) {
  return fs
    .readdirSync(dossier, { withFileTypes: true })
    .filter((entree) => entree.isFile() && entree.name.endsWith('.js'))
    .map((entree) => path.join(dossier, entree.name))
    .sort();
}

/** Les sources React : `src/**`, sans les tests (ils ne peignent rien). */
function sourcesDe(dossier) {
  const trouvees = [];
  const parcourir = (courant) => {
    for (const entree of fs.readdirSync(courant, { withFileTypes: true })) {
      const chemin = path.join(courant, entree.name);
      if (entree.isDirectory()) {
        parcourir(chemin);
        continue;
      }
      if (!/[.](js|jsx)$/.test(entree.name) || /[.]test[.]/.test(entree.name)) continue;
      trouvees.push(chemin);
    }
  };
  parcourir(dossier);
  return trouvees.sort();
}

/**
 * Le verdict, INJECTABLE : le CLI l'appelle avec le disque, la preuve avec des
 * listes fabriquées — les planchers, eux, refuseraient une fixture (c'est leur
 * travail de refuser un balayage maigre, pas de rendre une fixture illisible).
 *
 * @returns {{ok: boolean, erreurs: string[], defauts: string[], volumes: object|null,
 *            champs: Array<object>, listes: Array<object>}}
 */
export function verifierClassesCoquilles({
  racine = FRONTEND,
  cheminDomicile = DOMICILE_PAR_DEFAUT,
  domicile = CLASSES_CHROME,
  propres = CLASSES_PROPRES_AUX_COQUILLES,
  coquilles: coquillesFournies = null,
  sourcesReact: sourcesFournies = null,
  journal = console,
} = {}) {
  const vide = { ok: false, erreurs: [], defauts: [], volumes: null, champs: [], listes: [] };
  const refus = (message) => {
    journal.error(`::error::${message}`);
    return { ...vide, erreurs: [message] };
  };

  let coquilles = coquillesFournies;
  if (!coquilles) {
    const dossier = path.join(racine, DOSSIER_COQUILLES);
    if (!fs.existsSync(dossier)) {
      return refus(
        `dossier de pré-rendu introuvable : ${DOSSIER_COQUILLES} — un garde qui n’a rien lu n’a rien vérifié`
      );
    }
    coquilles = modulesDe(dossier).map((chemin) => ({
      module: relatif(racine, chemin),
      source: fs.readFileSync(chemin, 'utf8'),
    }));
  }

  let react = sourcesFournies;
  if (!react) {
    const dossierReact = path.join(racine, 'src');
    if (!fs.existsSync(dossierReact)) {
      return refus(
        'sources React introuvables : la racine ne porte pas de dossier `src/` — le jumeau d’une classe ne peut pas être cherché'
      );
    }
    react = sourcesDe(dossierReact).map((chemin) => ({
      chemin: relatif(racine, chemin),
      source: fs.readFileSync(chemin, 'utf8'),
    }));
  }

  if (coquilles.length < MIN_MODULES_COQUILLES || react.length < MIN_SOURCES_REACT) {
    return refus(
      `balayage trop maigre (${coquilles.length} module(s) de pré-rendu, ${react.length} source(s) React) — planchers ` +
        `${MIN_MODULES_COQUILLES} et ${MIN_SOURCES_REACT} : le garde n’a pas lu son sujet, donc il ne peut pas juger`
    );
  }

  const { volumes, defauts: defautsListes, listes } = verdictListesCoquilles(coquilles, react, propres);
  if (volumes.listes < MIN_LISTES_LUES || volumes.avecJumelle < MIN_LISTES_AVEC_JUMELLE) {
    return refus(
      `trop peu de listes de classes publiées (${volumes.listes}) ou jumelles (${volumes.avecJumelle}) — planchers ` +
        `${MIN_LISTES_LUES} et ${MIN_LISTES_AVEC_JUMELLE} : un lecteur cassé produirait un faux vert`
    );
  }

  const domicileLisible = fs.existsSync(path.join(racine, cheminDomicile));
  const { defauts: defautsDomicile, champs } = verdictDomicile(domicile, coquilles, react);
  const erreurs = [];
  if (!domicileLisible) {
    erreurs.push(
      `domicile des classes partagées introuvable : ${cheminDomicile} — les deux canaux ne peuvent pas lire la même déclaration`
    );
  }

  const defauts = [...defautsListes, ...defautsDomicile];
  journal.log(
    `::notice::${volumes.listes} liste(s) de classes publiées par les coquilles — ${volumes.avecJumelle} jumelle(s) d’une ` +
      `valeur écrite par React et ${volumes.declarees} déclarée(s) propre(s) à la coquille ; domicile ${cheminDomicile} : ` +
      `${champs.length} champ(s), ${champs.filter((champ) => champ.coquilles && champ.react).length} lu(s) par les deux canaux`
  );

  for (const erreur of erreurs) journal.error(`::error::${erreur}`);
  for (const defaut of defauts) journal.error(`::error::${defaut}`);

  if (!erreurs.length && !defauts.length) {
    journal.log(
      `✅ Aucune classe recopiée : les ${volumes.listes} listes publiées par les coquilles sont soit LISES au domicile ` +
        `partagé, soit jumelles d’une valeur écrite par React, soit DÉCLARÉES propres à la coquille avec leur motif ` +
        `(${volumes.declarees} listes). Le domicile ${cheminDomicile} est lu par les deux canaux et sa valeur n’est ` +
        'retapée nulle part. Ce que ce garde ne prouve pas — écrit plutôt que tu : un jumeau prouve que la CHAÎNE existe ' +
        'chez React, pas que c’est le même élément ; cette moitié est mesurée en navigateur par les sondes de géométrie ' +
        'et de texte des deux peintures.'
    );
  } else {
    journal.error(
      `\n❌ ${defautsListes.length} liste(s) de classes recopiée(s) sans jumeau ni déclaration et ` +
        `${defautsDomicile.length} champ(s) du domicile en défaut` +
        `${erreurs.length ? `, plus ${erreurs.length} refus de juger` : ''}. Une classe publiée par une coquille DOIT être ` +
        'la même que celle de React — sinon les deux peintures divergent en silence.'
    );
  }

  return { ok: !erreurs.length && !defauts.length, erreurs, defauts, volumes, champs, listes };
}

function main() {
  const valeur = (nom, defaut) => {
    const index = process.argv.indexOf(`--${nom}`);
    return index === -1 ? defaut : process.argv[index + 1];
  };
  const rapport = verifierClassesCoquilles({
    racine: path.resolve(valeur('root', FRONTEND)),
    cheminDomicile: valeur('domicile', DOMICILE_PAR_DEFAUT),
  });
  if (!rapport.ok) process.exitCode = 1;
}

const lanceDirectement =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (lanceDirectement) {
  try {
    main();
  } catch (erreur) {
    console.error(`::error::${erreur.message}`);
    process.exitCode = 1;
  }
}
