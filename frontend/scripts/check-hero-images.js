#!/usr/bin/env node
/**
 * LES VARIANTES DU HÉROS NE PEUVENT PAS MENTIR SUR LEUR POIDS.
 *
 * ── Ce que ce garde ferme ──────────────────────────────────────────────────
 * `src/config/photos-heros.js` publie un TABLEAU DE MESURES (AVIF 720 = 213 059
 * octets à six pour −62,9 % contre le JPEG, WebP 720 = 264 938 pour −53,9 %,
 * et les deux largeurs à 480), et le composant comme la coquille publient ces
 * fichiers parce que ce tableau dit qu'ils sont plus légers. Rien, avant ce
 * garde, ne reliait le tableau au disque :
 *
 *   1. une variante RÉGÉNÉRÉE avec un autre réglage (ou par une montée de
 *      libavif/libwebp) pesait autre chose que les octets publiés, et le
 *      commentaire mentait en silence — c'est le risque que le manifeste
 *      `scripts/hero-variants.manifest.json` a été écrit pour fermer ;
 *   2. une variante DÉCLARÉE par la config mais jamais générée se serait
 *      téléchargée en 404 (le `<picture>` ne le dit pas : ses `<source>`
 *      pointent tous vers un fichier qui n'existe pas, et le navigateur
 *      retombe alors sur le JPEG — donc la page aurait servi 63 Ko de plus en
 *      croyant servir 20) ;
 *   3. une SOURCE JPEG recodée sans régénérer les variantes laissait des
 *      variantes qui ne sont plus celles de la photo affichée — le
 *      `sha256_source` du manifeste est là pour ça ;
 *   4. une variante PLUS LOURDE que le JPEG qu'elle double (un réglage de
 *      qualité poussé trop haut) ferait télécharger davantage à un navigateur
 *      moderne — exactement l'inverse du but, et invisible.
 *
 * ── La règle qui porte le SENS de la passe ─────────────────────────────────
 * Ce ne sont pas les totaux qui décident si la passe a un sens, c'est le
 * rapport à la source : AUCUNE variante ne doit être plus lourde que le JPEG
 * qu'elle remplace, et le total AVIF ne doit pas dépasser le total WebP (c'est
 * l'ordre des `<source>` — l'AVIF est publié en premier parce qu'il est le plus
 * léger ; s'il ne l'était plus, le balisage ferait télécharger le plus lourd).
 * Une campagne de compression qui dériverait rougit donc ICI, en nommant le
 * fichier, plutôt que dans le commentaire du config.
 *
 * ── Ce qu'il ne fait pas ──────────────────────────────────────────────────
 * Il ne juge pas l'ASPECT à l'œil ni le PSNR (une mesure d'encodeur, faite lors
 * de la campagne et publiée dans le manifeste) ; il ne juge pas non plus ce que
 * le NAVIGATEUR télécharge vraiment, ce que seule une sonde navigateur peut
 * dire (`e2e/heros-format.spec.js`, qui lit les octets de la réponse). Ici on
 * vérifie que le disque est ce que la mesure annonce — les deux plans sont
 * nécessaires et aucun ne remplace l'autre.
 *
 * Usage : node scripts/check-hero-images.js
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  PHOTO_HEROS_HAUTEUR,
  PHOTO_HEROS_LARGEUR,
  PHOTO_HEROS_FORMATS,
  PHOTO_HEROS_LARGEURS,
  PHOTOS_HEROS,
  VARIANTES_HEROS,
} from '../src/config/photos-heros.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DOSSIER_PUBLIC = path.join(RACINE, 'public', 'assets');
export const MANIFESTE = path.join(RACINE, 'scripts', 'hero-variants.manifest.json');

// Planchers de lecture : un manifeste vide (ou tronqué à deux photos) rendrait
// ce garde vert en ne pesant RIEN — c'est le seul faux vert qu'un garde de
// contenu peut produire, et il est nommé plutôt que traversé.
export const PLANCHER_PHOTOS = 4;
export const PLANCHER_VARIANTES = 16;
// Le gain minimal de la photo de tête, publié par la passe : mesuré à −81,3 %.
// Un plancher à 50 % laisse de la marge à un réglage retouché, et rougit sur une
// « variante » qui ne serait plus une variante.
export const GAIN_MINIMAL_TETE = 0.5;

/**
 * Les dimensions d'un AVIF, lues dans sa boîte `ispe` (ISO-BMFF).
 *
 * On ne décode pas l'image : on lit l'en-tête, ce qui suffit à refuser un
 * fichier tronqué, d'un autre format, ou d'une autre taille que celle annoncée.
 * `ispe` est la boîte qui porte la taille affichée ; elle suit immédiatement son
 * en-tête de boîte, donc la largeur est à `index + 8` et la hauteur à
 * `index + 12` (le type fait 4 octets, puis 4 octets de version/drapeaux).
 *
 * @param {Buffer} buf Contenu du fichier.
 * @returns {{largeur: number, hauteur: number}|null} null si ce n'est pas un AVIF.
 */
export function dimensionsAvif(buf) {
  if (buf.length < 24) return null;
  if (buf.toString('latin1', 4, 8) !== 'ftyp') return null;
  const marque = buf.toString('latin1', 8, 12);
  if (marque !== 'avif' && marque !== 'avis' && marque !== 'mif1') return null;
  const index = buf.indexOf('ispe', 0, 'latin1');
  if (index === -1 || index + 16 > buf.length) return null;
  const largeur = buf.readUInt32BE(index + 8);
  const hauteur = buf.readUInt32BE(index + 12);
  if (largeur < 1 || hauteur < 1 || largeur > 20000 || hauteur > 20000) return null;
  return { largeur, hauteur };
}

/**
 * Les dimensions d'un WebP, lues dans son premier morceau.
 *
 * Trois formes possibles, et elles ne se lisent pas au même endroit : `VP8X`
 * (étendu, canvas sur 24 bits à partir de l'octet 24), `VP8 ` (perte avec
 * code de synchronisation `9d 01 2a` à l'octet 23, puis deux entiers 14 bits
 * little-endian), `VP8L` (sans perte, un entier 32 bits à partir de l'octet 21
 * qui porte largeur−1 et hauteur−1). Pillow écrit la première ou la deuxième
 * selon le contenu ; les trois sont donc acceptées, et une quatrième ne l'est
 * pas.
 *
 * @param {Buffer} buf Contenu du fichier.
 * @returns {{largeur: number, hauteur: number}|null} null si ce n'est pas un WebP lisible.
 */
export function dimensionsWebp(buf) {
  if (buf.length < 30) return null;
  if (buf.toString('latin1', 0, 4) !== 'RIFF') return null;
  if (buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const morceau = buf.toString('latin1', 12, 16);
  if (morceau === 'VP8X') {
    const largeur = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const hauteur = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { largeur, hauteur };
  }
  if (morceau === 'VP8 ') {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return { largeur: buf.readUInt16LE(26) & 0x3fff, hauteur: buf.readUInt16LE(28) & 0x3fff };
  }
  if (morceau === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return { largeur: (bits & 0x3fff) + 1, hauteur: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** Les dimensions d'un fichier de variante, selon son format déclaré. */
export const dimensionsVariante = (format, buf) =>
  format === 'avif' ? dimensionsAvif(buf) : format === 'webp' ? dimensionsWebp(buf) : null;

/** Les octets et le SHA-256 d'un fichier — la forme sous laquelle il est jugé. */
export const empreinteFichier = (chemin) => {
  const buf = readFileSync(chemin);
  return { octets: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
};

/**
 * Les variantes DÉCLARÉES par la config, par nom de fichier.
 *
 * La config est l'autorité — c'est elle que le composant et la coquille lisent —
 * donc la question du garde est « le disque dit-il ce que la config publie ? »
 * et non l'inverse.
 *
 * @param {Array} [variantes] Table config (défaut : la table réelle).
 * @returns {Map<string, {format: string, largeur: number, photo: number}>}
 */
export function variantesDeclarees(variantes = VARIANTES_HEROS) {
  const table = new Map();
  variantes.forEach((photo, index) => {
    for (const format of PHOTO_HEROS_FORMATS) {
      for (const largeur of PHOTO_HEROS_LARGEURS) {
        // Un chemin ABSENT n'est pas une faute de ce garde : c'est une
        // déclaration manquante, et c'est le disque (une variante générée que
        // rien ne publie) qui la nomme. On ne fabrique donc pas une entrée
        // `undefined`, qui ferait tomber la lecture du dossier pour de bon.
        const chemin = photo[format] && photo[format][largeur];
        if (chemin) table.set(chemin, { format, largeur, photo: index });
      }
    }
  });
  return table;
}

/**
 * Le verdict complet, sur un manifeste et un dossier donnés.
 *
 * Fonction pure d'E/S (elle lit, elle ne répare pas) : les tests lui donnent une
 * arborescence fixture et un manifeste fabriqués, pour que CHAQUE refus soit
 * exercé sur la faute qu'il vise — un garde dont les refus ne sont prouvés que
 * sur l'arbre sain ne prouve rien.
 *
 * @param {object} options
 * @param {object} options.manifeste     Manifeste analysé (objet JSON).
 * @param {string} options.dossier       Dossier contenant les fichiers publiés.
 * @param {Array}  [options.variantes]   Table config (injectable).
 * @param {string[]} [options.photos]    Chemins des JPEG (injectable).
 * @returns {{ok: boolean, erreurs: string[], controles: string[], mesures: object}}
 */
export function verifierHeros({
  manifeste,
  dossier,
  variantes = VARIANTES_HEROS,
  photos = PHOTOS_HEROS,
  formats = PHOTO_HEROS_FORMATS,
  largeurs = PHOTO_HEROS_LARGEURS,
} = {}) {
  const erreurs = [];
  const controles = [];
  const mesures = { variantesPesees: 0, octetsVariantes: 0, octetsJpeg: 0, parFormat: {} };

  const entrees = Array.isArray(manifeste && manifeste.photos) ? manifeste.photos : [];
  const parFichier = new Map();
  for (const entree of entrees) {
    for (const variante of entree.variantes || []) parFichier.set(variante.fichier, { ...variante, entree });
  }

  // ── 0. Le manifeste a-t-il quelque chose à dire ? ────────────────────────
  if (entrees.length < PLANCHER_PHOTOS || parFichier.size < PLANCHER_VARIANTES) {
    erreurs.push(
      `manifeste ${path.basename(MANIFESTE)} : ${entrees.length} photo(s) et ${parFichier.size} variante(s) ` +
        `— planchers ${PLANCHER_PHOTOS} et ${PLANCHER_VARIANTES}. Un manifeste vide ou tronqué rendrait ce ` +
        'garde vert en ne pesant RIEN : régénérer avec scripts/gen-hero-images.py.'
    );
    return { ok: false, erreurs, controles, mesures };
  }

  // ── 1. Les deux tables parlent-elles de la même chose ? ─────────────────
  if (JSON.stringify(manifeste.largeurs) !== JSON.stringify(largeurs)) {
    erreurs.push(
      `manifeste : largeurs ${JSON.stringify(manifeste.largeurs || null)} ≠ config ` +
        `${JSON.stringify(largeurs)} — le manifeste a été généré pour une autre liste.`
    );
  }
  const formatsManifeste = [...new Set([...parFichier.values()].map((v) => v.format))].sort();
  if (JSON.stringify(formatsManifeste) !== JSON.stringify([...formats].sort())) {
    erreurs.push(
      `manifeste : formats ${JSON.stringify(formatsManifeste)} ≠ config ${JSON.stringify([...formats].sort())}.`
    );
  }

  const declarees = variantesDeclarees(variantes);
  const nom = (chemin) => path.basename(chemin);
  const declareesParNom = new Map([...declarees].map(([chemin, info]) => [nom(chemin), { ...info, chemin }]));
  for (const [fichier, info] of declareesParNom) {
    if (!parFichier.has(fichier)) {
      erreurs.push(
        `variante DÉCLARÉE mais jamais générée : ${fichier} (schéma ${info.format} ${info.largeur}w, ` +
          'src/config/photos-heros.js) — absente du manifeste. Un `<source>` qui pointe vers un fichier ' +
          'inexistant retombe en silence sur le JPEG.'
      );
    }
  }
  for (const fichier of parFichier.keys()) {
    if (!declareesParNom.has(fichier)) {
      erreurs.push(
        `variante GÉNÉRÉE mais que rien ne publie : ${fichier} — absente de src/config/photos-heros.js, ` +
          'donc téléchargée par personne (ou chemin mal orthographié dans la config).'
      );
    }
  }

  // ── 2. Les sources : une variante dérive de SON JPEG ────────────────────
  const sources = new Map(entrees.map((entree) => [entree.source, entree]));
  const jpegParPhoto = new Map();
  for (const chemin of photos) {
    const fichier = nom(chemin);
    const entree = sources.get(fichier);
    const cheminDisque = path.join(dossier, fichier);
    if (!entree) {
      erreurs.push(`photo de la rotation absente du manifeste : ${fichier} — régénérer les variantes.`);
      continue;
    }
    try {
      const mesure = empreinteFichier(cheminDisque);
      mesures.octetsJpeg += mesure.octets;
      jpegParPhoto.set(fichier, mesure.octets);
      if (mesure.octets !== entree.octets_source) {
        erreurs.push(
          `source recodée sans régénérer les variantes : ${fichier} pèse ${mesure.octets} o sur disque, ` +
            `${entree.octets_source} o dans le manifeste (les variantes ne sont donc plus celles de cette photo).`
        );
      }
      if (mesure.sha256 !== entree.sha256_source) {
        erreurs.push(
          `source modifiée sans régénérer les variantes : ${fichier} — SHA-256 différent du manifeste ` +
            `(${mesure.sha256.slice(0, 12)}… ≠ ${String(entree.sha256_source).slice(0, 12)}…).`
        );
      }
    } catch (error) {
      erreurs.push(`source illisible : ${cheminDisque} (${error.message}).`);
    }
  }

  // ── 3. Chaque variante : présente, du bon poids, du bon format, de la bonne taille ──
  for (const [fichier, info] of parFichier) {
    const cheminDisque = path.join(dossier, fichier);
    let buf;
    try {
      buf = readFileSync(cheminDisque);
    } catch (error) {
      erreurs.push(`variante ABSENTE du disque : ${cheminDisque} (${error.message}).`);
      continue;
    }
    mesures.variantesPesees += 1;
    mesures.octetsVariantes += buf.length;
    mesures.parFormat[info.format] = (mesures.parFormat[info.format] || 0) + buf.length;

    if (buf.length !== info.octets) {
      erreurs.push(
        `${fichier} : ${buf.length} octets sur disque, ${info.octets} mesurés dans le manifeste — ` +
          'variante régénérée avec un autre réglage (ou encodeur), ou fichier tronqué.'
      );
    }
    const dimensions = dimensionsVariante(info.format, buf);
    if (!dimensions) {
      erreurs.push(
        `${fichier} : en-tête illisible comme ${info.format.toUpperCase()} — le fichier n'est pas du format ` +
          'que son extension annonce (un navigateur le refuserait, et la page retomberait sur le JPEG).'
      );
      continue;
    }
    if (dimensions.largeur !== info.largeur || dimensions.hauteur !== info.hauteur) {
      erreurs.push(
        `${fichier} : ${dimensions.largeur} × ${dimensions.hauteur} réel, ${info.largeur} × ${info.hauteur} ` +
          'annoncés — une variante d\'une autre taille que celle du manifeste change la géométrie du LCP.'
      );
    }
    const jpegEquivalent = jpegParPhoto.get(info.entree.source);
    if (jpegEquivalent !== undefined && buf.length >= jpegEquivalent) {
      erreurs.push(
        `${fichier} pèse ${buf.length} o contre ${jpegEquivalent} o pour le JPEG qu'il double (${info.entree.source}) : ` +
          'une variante plus LOURDE que son repli fait télécharger davantage à un navigateur moderne.',
      );
    }
  }

  // ── 4. Aucun fichier publié ne doit échapper à la déclaration ───────────
  // Un résidu d'une campagne précédente (variante d'une photo retirée de la
  // rotation, ou d'un réglage abandonné) resterait servi par `public/assets/`
  // sans que rien ne le publie : c'est du contenu livré pour personne. La
  // population lue est TOUT encodage de la famille (`.avif`, `.webp`) du
  // dossier — pas seulement les noms attendus, sans quoi un résidu bien nommé
  // serait précisément celui qu'on ne verrait pas.
  let surDisque = [];
  try {
    surDisque = readdirSync(dossier).filter((f) => /\.(avif|webp)$/i.test(f));
  } catch (error) {
    erreurs.push(`dossier des photos illisible : ${dossier} (${error.message}).`);
  }
  const orphelins = surDisque.filter((f) => !declareesParNom.has(f));
  if (orphelins.length) {
    erreurs.push(
      `encodage(s) publié(s) sans variante déclarée : ${orphelins.join(', ')} — aucun élément de ` +
        'src/config/photos-heros.js ne les sert (résidu d\'une campagne précédente, ou faute de frappe dans un nom).'
    );
  }
  if (surDisque.length < declareesParNom.size) {
    erreurs.push(
      `seulement ${surDisque.length} fichier(s) de variante lus sur disque pour ${declareesParNom.size} déclaré(s) ` +
        '— le dossier n\'est pas celui du build.'
    );
  }

  // ── 5. Les totaux du manifeste, et le SENS de la passe ──────────────────
  const parFormatLargeur = {};
  for (const variante of parFichier.values()) {
    const cle = `${variante.format}${variante.largeur}`;
    parFormatLargeur[cle] = (parFormatLargeur[cle] || 0) + variante.octets;
  }
  for (const [format, parLargeur] of Object.entries(manifeste.totaux || {})) {
    for (const [largeur, total] of Object.entries(parLargeur)) {
      if (parFormatLargeur[`${format}${largeur}`] !== total) {
        erreurs.push(
          `manifeste : total ${format} ${largeur}w = ${total} o, somme des fichiers = ` +
            `${parFormatLargeur[`${format}${largeur}`]} o — un total qui ne suit plus les fichiers est un ` +
            'chiffre qui mentira au prochain lecteur.'
        );
      }
    }
  }
  const totalJpeg = entrees.reduce((somme, entree) => somme + entree.octets_source, 0);
  if (manifeste.jpeg_total !== totalJpeg) {
    erreurs.push(
      `manifeste : jpeg_total = ${manifeste.jpeg_total} o, somme des sources = ${totalJpeg} o.`
    );
  }
  // L'ORDRE DES `<source>` : l'AVIF est publié en premier parce qu'il est le plus
  // léger, donc le poids doit CROÎTRE avec la position. Un format publié avant
  // un autre qui le bat ferait télécharger le plus lourd aux navigateurs qui
  // lisent le premier.
  const totalParFormat = Object.fromEntries(
    formats.map((format) => [
      format,
      largeurs.reduce((somme, largeur) => somme + (parFormatLargeur[`${format}${largeur}`] || 0), 0),
    ])
  );
  for (let index = 1; index < formats.length; index += 1) {
    const precedent = formats[index - 1];
    const courant = formats[index];
    if (totalParFormat[precedent] > totalParFormat[courant]) {
      erreurs.push(
        `le format publié en ${index}e position (${precedent}, ${totalParFormat[precedent]} o) est plus LOURD ` +
          `que celui publié après lui (${courant}, ${totalParFormat[courant]} o) : l'ordre de ` +
          'PHOTO_HEROS_FORMATS fait donc télécharger le plus lourd aux navigateurs qui lisent le premier.'
      );
    }
  }
  // Le gain de la photo de TÊTE : c'est le chiffre que la passe publie, et le
  // seul qui décide si le `<picture>` sert à quelque chose au premier écran.
  const tete = nom(photos[0]);
  const teteJpeg = jpegParPhoto.get(tete);
  // La variante de tête peut être ABSENTE de la table de config : c'est un
  // autre refus (« GÉNÉRÉE mais que rien ne publie ») qui le dit, et ce n'est pas
  // à cette mesure-là de tomber pour un chemin qui n'existe pas.
  const cheminTete = variantes[0] && variantes[0][formats[0]] && variantes[0][formats[0]][largeurs[0]];
  const teteVariante = cheminTete ? parFichier.get(nom(cheminTete)) : undefined;
  if (teteJpeg && teteVariante) {
    const gain = 1 - teteVariante.octets / teteJpeg;
    mesures.gainTete = gain;
    if (gain < GAIN_MINIMAL_TETE) {
      erreurs.push(
        `photo de tête : la variante ${formats[0]} ${largeurs[0]}w fait ${teteVariante.octets} o contre ` +
          `${teteJpeg} o de JPEG (−${(gain * 100).toFixed(1)} %) — sous le plancher de ` +
          `${(GAIN_MINIMAL_TETE * 100).toFixed(0)} % : le <picture> ne sert alors plus à rien au premier écran.`
      );
    }
  }

  if (!erreurs.length) {
    controles.push(
      `  ✓ ${mesures.variantesPesees} variante(s) pesée(s) — ${mesures.octetsVariantes} o servis contre ` +
        `${mesures.octetsJpeg} o de JPEG (${entrees.length} photos)`
    );
    controles.push(
      `  ✓ totaux par format : ${formats
        .map((f) => `${f} ${totalParFormat[f]} o`)
        .join(', ')} — tous sous le JPEG, dans l'ordre des <source>`
    );
    if (mesures.gainTete !== undefined) {
      controles.push(
        `  ✓ photo de tête : ${teteVariante.octets} o en ${formats[0]} ${largeurs[0]}w au lieu de ${teteJpeg} o ` +
          `(−${(mesures.gainTete * 100).toFixed(1)} %)`
      );
    }
  }

  return { ok: erreurs.length === 0, erreurs, controles, mesures };
}

const estExecutionDirecte =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (estExecutionDirecte) {
  let manifeste = null;
  try {
    manifeste = JSON.parse(readFileSync(MANIFESTE, 'utf8'));
  } catch (error) {
    console.error(
      `❌ manifeste illisible : ${MANIFESTE} (${error.message}) — régénérer avec ` +
        'scripts/gen-hero-images.py --verifier'
    );
    process.exit(1);
  }
  const resultat = verifierHeros({ manifeste, dossier: DOSSIER_PUBLIC });
  console.log('Variantes du héros (disque ↔ manifeste ↔ src/config/photos-heros.js) :');
  console.log(resultat.controles.join('\n'));
  if (!resultat.ok) {
    console.error(`\n❌ ${resultat.erreurs.length} écart(s) :`);
    for (const erreur of resultat.erreurs) console.error(`  · ${erreur}`);
    process.exit(1);
  }
  console.log('\n✅ Toutes les variantes publiées sont celles mesurées, et toutes plus légères que leur JPEG.');
}
