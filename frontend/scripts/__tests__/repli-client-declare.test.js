/**
 * GARDE : LE REPLI DU CLIENT SE JUGE SUR SES DEUX DÉCLARATIONS, SANS FLY.
 *
 * ── Le fait, et pourquoi ce garde existe ────────────────────────────────────
 * `FALLBACK_POLL_MS` vit DEUX fois : dans `NotificationContext.js` et dans
 * `Messages.js`. Deux copies, une seule cadence voulue — c'est exactement la
 * forme qui a divergé le 18/10/2026 pour le battement (deux sources, deux
 * valeurs, 15 s contre 20 s), sauf qu'ici les deux copies sont dans le MÊME
 * langage : rien n'empêche l'une de bouger seule.
 *
 * La sonde Fly (`.github/scripts/check-fly-env-drift.py`) juge déjà cette
 * cadence, en ligne comme hors ligne. Mais un développeur ne la lance pas : il
 * faut un jeton Fly pour l'étape en ligne, et un interpréteur Python pour
 * l'étape `--refs-only`. Ce fichier-ci rend le MÊME verdict à `npm test`, avec
 * les moyens d'un test unitaire : il LIT les deux déclarations, il LIT le seuil
 * dans la sonde (une seule source, jamais recopiée) et il REFUSE DE CONCLURE
 * quand il ne lit plus son sujet.
 *
 * ── Ce qui est exigé, et pourquoi chacun ───────────────────────────────────
 *   1. exactement DEUX déclarations de production (`src/`, hors tests) : une
 *      troisième serait une cadence que personne ne juge, et deux cadences
 *      selon la page ouverte sont le défaut qu'on empêche ;
 *   2. la MÊME valeur des deux côtés ;
 *   3. une valeur STRICTEMENT supérieure au seuil du sondage remplacé
 *      (2 requêtes par minute et par session) : à 30 s ou moins, le repli ne
 *      remplace qu'un aller-retour par un autre, et le flux n'aurait rien
 *      remplacé du tout ;
 *   4. chaque déclaration est ARMÉE (`setInterval(…, FALLBACK_POLL_MS)`) : une
 *      constante que rien n'utilise passerait autrement pour une cadence
 *      respectée.
 *
 * ── Ce que ce garde ne peut pas voir ────────────────────────────────────────
 * La valeur réellement servie dans un bundle DÉPLOYÉ : il lit la source. La
 * constante n'a pas de surcharge d'exécution (elle part telle quelle dans le
 * bundle), donc la source EST le contrat — mais c'est la sonde Fly qui juge la
 * machine, et ce fichier ne la remplace pas : il rend le rouge accessible sans
 * elle. Une TROISIÈME déclaration hors de `src/` (un script, une page non
 * livrée) ne serait pas vue non plus ; la surface déclarée est `src/`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ICI = path.dirname(fileURLToPath(import.meta.url));
// Les chemins sont écrits depuis la RACINE DU DÉPÔT : ils se lisent comme des
// emplacements, pas comme des voisins du fichier de test.
const RACINE = path.resolve(ICI, '..', '..', '..');

const CONSTANTE = 'FALLBACK_POLL_MS';
const SONDE = '.github/scripts/check-fly-env-drift.py';
const SOURCES = 'frontend/src';

// Les DEUX déclarations attendues. Une absence ET une troisième sont refusées :
// le registre est la liste, pas un échantillon.
const DECLARATIONS = [
  'frontend/src/contexts/NotificationContext.js',
  'frontend/src/pages/Messages.js',
];

// Planchers de LECTURE. Un fichier tronqué, déplacé ou un motif qui a bougé ne
// doit pas rendre un vert : sans eux, une expression régulière qui ne trouve
// plus rien passerait pour « cadence respectée ».
const MIN_OCTETS = 500;
const MIN_FICHIERS_SRC = 20;

const lire = (relatif) => {
  const complet = path.join(RACINE, relatif);
  const texte = fs.readFileSync(complet, 'utf8');
  if (texte.length < MIN_OCTETS) {
    throw new Error(
      `${relatif} fait ${texte.length} octet(s) (< ${MIN_OCTETS}) : le fichier lu ` +
        "n'est pas son sujet — refus de conclure."
    );
  }
  return texte;
};

/** Les fichiers `.js`/`.jsx` de production sous `frontend/src`, hors tests. */
function sourcesDeProduction(dossier) {
  const trouves = [];
  const parcourir = (courant) => {
    for (const entree of fs.readdirSync(courant, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const complet = path.join(courant, entree.name);
      if (entree.isDirectory()) {
        if (entree.name === '__tests__') continue;
        parcourir(complet);
        continue;
      }
      if (!/\.(js|jsx)$/.test(entree.name)) continue;
      if (/\.(test|spec)\./.test(entree.name)) continue;
      trouves.push(complet);
    }
  };
  parcourir(path.join(RACINE, dossier));
  return trouves.map((complet) => ({
    chemin: path.relative(RACINE, complet).split(path.sep).join('/'),
    texte: fs.readFileSync(complet, 'utf8'),
  }));
}

/**
 * Les valeurs DÉCLARÉES de `FALLBACK_POLL_MS` dans un texte.
 *
 * On lit la DÉCLARATION (`const FALLBACK_POLL_MS = 60_000;`), jamais une simple
 * mention en commentaire : un fichier qui parle du repli n'en déclare pas la
 * cadence.
 */
export function valeursDuRepli(texte) {
  const motif = new RegExp(`\\bconst\\s+${CONSTANTE}\\s*=\\s*([\\d_.]+)\\s*;`, 'g');
  return [...String(texte).matchAll(motif)].map((trouvaille) =>
    Number(trouvaille[1].replace(/_/g, ''))
  );
}

/**
 * Le seuil du sondage remplacé, LU dans la sonde Fly.
 *
 * Recopier `30000` ici en ferait un SECOND seuil : le jour où l'un bouge, le
 * test et la sonde jugeraient deux contrats différents, et l'un des deux
 * resterait vert sur un repli redevenu bavard.
 */
export function seuilSondageRemplace(texte) {
  const trouve = String(texte).match(/^ANCIEN_SONDAGE_MS\s*=\s*([\d_.]+)/m);
  if (!trouve) {
    throw new Error(
      `le seuil du sondage remplacé n'a pas été trouvé dans ${SONDE} : le motif ` +
        'a bougé, donc ce garde ne lit plus son sujet — corriger le motif, pas le verdict.'
    );
  }
  return Number(trouve[1].replace(/_/g, ''));
}

/** La déclaration est-elle ARMÉE (un `setInterval` qui la consomme) ? */
export function armeLeRepli(texte) {
  const motif = new RegExp(`setInterval\\(\\s*[^,]+,\\s*${CONSTANTE}\\s*\\)`);
  return motif.test(String(texte));
}

describe('repli du client — les deux déclarations portent la MÊME cadence', () => {
  const sources = sourcesDeProduction(SOURCES);
  const seuil = seuilSondageRemplace(lire(SONDE));
  const parChemin = new Map(sources.map((source) => [source.chemin, source.texte]));

  it("lit un nombre suffisant de sources pour que l'absence soit un fait", () => {
    // Un dossier vide ou une extension changée rendrait le reste vert sans
    // avoir regardé le dépôt : sous ce plancher, on ne juge pas.
    expect(sources.length).toBeGreaterThanOrEqual(MIN_FICHIERS_SRC);
  });

  it('il y a exactement les DEUX déclarations de production, et aucune autre', () => {
    const porteurs = sources
      .filter((source) => valeursDuRepli(source.texte).length > 0)
      .map((source) => source.chemin);
    expect(porteurs.sort()).toEqual([...DECLARATIONS].sort());
  });

  it('chaque fichier ne déclare la constante qu’UNE fois', () => {
    // Une seconde déclaration dans le même fichier déplacerait le propriétaire
    // en silence (la dernière gagne) : c'est la règle des doublons appliquée à
    // cette cadence.
    for (const chemin of DECLARATIONS) {
      const valeurs = valeursDuRepli(parChemin.get(chemin));
      expect(valeurs, `déclaration de ${CONSTANTE} dans ${chemin}`).toHaveLength(1);
      expect(Number.isFinite(valeurs[0])).toBe(true);
      expect(valeurs[0]).toBeGreaterThan(0);
    }
  });

  it('les deux valeurs sont IDENTIQUES (sinon deux cadences selon la page ouverte)', () => {
    const valeurs = DECLARATIONS.map((chemin) => valeursDuRepli(parChemin.get(chemin))[0]);
    expect(valeurs[0]).toBe(valeurs[1]);
  });

  it(`la cadence est plus LENTE que le sondage remplacé (${seuil} ms)`, () => {
    const [notifications, messages] = DECLARATIONS.map(
      (chemin) => valeursDuRepli(parChemin.get(chemin))[0]
    );
    // Strictement supérieur : à `seuil` exactement, le repli ne fait qu'un
    // aller-retour pour un autre, et la sonde Fly le refuse pour la même raison.
    expect(notifications, `${CONSTANTE} aussi bavard que les 2 req/min remplacées`).toBeGreaterThan(
      seuil
    );
    expect(messages, `${CONSTANTE} aussi bavard que les 2 req/min remplacées`).toBeGreaterThan(seuil);
  });

  it('chaque déclaration est ARMÉE — une constante que rien n’utilise ne règle rien', () => {
    for (const chemin of DECLARATIONS) {
      expect(
        armeLeRepli(parChemin.get(chemin)),
        `${CONSTANTE} déclaré dans ${chemin} mais aucun setInterval ne le consomme`
      ).toBe(true);
    }
  });
});
