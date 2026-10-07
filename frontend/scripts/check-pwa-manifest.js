#!/usr/bin/env node
/**
 * Garde-fou du manifeste PWA (public/manifest.json) : les icônes qu'il déclare
 * doivent exister, dire la vérité sur elles-mêmes, et surtout ne pas s'attribuer
 * la propriété « maskable » sans l'avoir.
 *
 * Depuis le 07/10/2026 il juge aussi ce que l'INSTALLATION ouvre : `id`,
 * `start_url` et `scope` doivent rester sous l'origine du site, et la liste de
 * précache du service worker (`public/push-sw.js`) ne peut porter aucune entrée
 * tierce.
 *
 * ── Le défaut que ce garde existe pour empêcher ──────────────────────────────
 * Le manifeste déclarait « any maskable » sur ses deux icônes. Mesuré :
 *   • contenu jusqu'à un rayon de 0,495 pour une limite de 0,400 — les
 *     plateformes qui appliquent un masque (Android, Chrome) rognaient le logo ;
 *   • le fichier « icon-512x512-maskable.png », qui semblait justifier la
 *     déclaration, était un duplicata AU PIXEL PRÈS de l'icône normale.
 * La propriété annoncée n'était donc vraie pour aucun fichier — et rien ne
 * pouvait le voir : un manifeste est du JSON servi tel quel, sans build ni test.
 *
 * ── Ce que ce garde vérifie ──────────────────────────────────────────────────
 *   1. le manifeste existe et se lit — le BOM que le fichier portait a été
 *      retiré le 20/09/2026 (tout `JSON.parse` non averti le refusait ; le
 *      lecteur ci-dessous le tolère encore pour un fichier qui en porterait) ;
 *   2. « background_color » est celui que le générateur d'icônes utilise pour le
 *      fond de ses variantes maskable — une seule source de vérité, croisée ;
 *   3. chaque « src » déclaré reste SOUS public/, existe, est un PNG valide et
 *      porte EXACTEMENT les dimensions annoncées par « sizes » ;
 *   4. chaque « purpose » n'emploie que des jetons connus, sans doublon ;
 *   5. une icône déclarée « maskable » doit être une variante réellement
 *      fabriquée pour le masque, dont le manifeste de la famille atteste qu'elle
 *      est OPAQUE et que son contenu tient dans la ZONE DE SÉCURITÉ ;
 *   6. aucune variante « …-maskable.png » de la famille ne doit rester non
 *      déclarée : fabriquée mais jamais servie, c'est le mensonge par omission
 *      dans l'autre sens ;
 *   7. `id`, `start_url` et `scope`, quand ils sont déclarés, restent sous
 *      l'origine du site : même schéma (http/https) et même hôte, une valeur
 *      non-chaîne comprise ;
 *   8. la liste de précache du service worker est LISIBLE (chaque entrée est un
 *      littéral de chaîne), non vide, et aucune de ses entrées ne sort de
 *      l'origine du site.
 *
 * Le point 5 s'appuie sur l'inventaire de la famille (public/icons/
 * icons-assets.manifest.json), lui-même confronté aux fichiers committés par
 * scripts/check-generated-icons.js, exécuté juste avant en CI. La chaîne est
 * donc : pixels mesurés → inventaire de la famille → déclaration PWA.
 *
 * ── Ce que l'INSTALLATION ouvre, et pourquoi ça se juge ICI ────────────────
 * Un manifeste ne déclare pas que des icônes : `id`, `start_url` et `scope`
 * décident OÙ l'application installée s'ouvre et QUEL périmètre elle revendique.
 * Une valeur qui pointe vers un autre domaine — `start_url:
 * "https://ailleurs.test/"`, un `scope` en `//ailleurs.test`, ou un schéma qui
 * n'est pas http(s) — fait ouvrir l'application installée sur un site qu'on
 * n'exploite pas, et RIEN ne le voyait : le manifeste est du JSON servi tel quel.
 * L'origine du site n'est pas recopiée ici, elle vient de `site-meta.js` — son
 * propriétaire unique depuis la migration de domaine du 17/09/2026.
 *
 * Et `public/push-sw.js` précharge son « app shell » (`APP_SHELL_URLS`) dans le
 * cache de l'installation : chaque entrée y est TÉLÉCHARGÉE à l'installation du
 * service worker, et y RESTE. Une entrée tierce y ferait donc ce que les gardes
 * d'origines interdisent ailleurs — un transfert d'adresse IP vers un domaine
 * qu'on n'exploite pas, jusqu'hors ligne compris. Ce fichier leur échappe : un
 * service worker est copié tel quel depuis `public/`, il n'est ni le HTML d'une
 * coquille (`shell-remote-resources.js`) ni un fichier livré par le build
 * (`origines-bundles.js`). Une entrée qui n'est pas un LITTÉRAL de chaîne (un
 * identifiant, un gabarit, un appel) est REFUSÉE plutôt que supposée
 * inoffensive : on ne juge pas ce qu'on ne peut pas lire.
 *
 * Usage : cd frontend && node scripts/check-pwa-manifest.js
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { SITE_ORIGIN } from './site-meta.js';

// Chemins écrits en « / » : path.join les accepte partout, et les messages
// restent identiques d'une plateforme à l'autre (sous Windows, path.join
// produirait « public\manifest.json » dans les libellés).
export const MANIFEST_FILE = 'public/manifest.json';
export const FAMILY_DIR = 'public/icons';
export const FAMILY_MANIFEST_FILE = 'public/icons/icons-assets.manifest.json';

/** Le service worker, copié tel quel depuis `public/` : il porte son précache. */
export const SERVICE_WORKER_FILE = 'public/push-sw.js';

/** Le nom du tableau de précache du service worker — un seul, lu des deux côtés. */
export const PRECACHE_LIST_NAME = 'APP_SHELL_URLS';

/** Les champs du manifeste qui décident OÙ l'application installée s'ouvre. */
export const CHAMPS_A_MEME_ORIGINE = ['id', 'start_url', 'scope'];

// Jetons de « purpose » reconnus par la spécification des Web App Manifests.
const ALLOWED_PURPOSES = ['any', 'maskable', 'monochrome'];

// Convention de nom des variantes fabriquées pour les masques.
export const MASKABLE_NAME = /-maskable\.png$/;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Lecture minimale d'un PNG : signature + chunk IHDR (dimensions). */
export const readPngSize = (filePath) => {
  const buffer = readFileSync(filePath);
  if (buffer.length < 33) return null;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};

/** Un manifeste peut porter un BOM : JSON.parse le refuse, on le retire. */
export const parseManifest = (text) => JSON.parse(text.replace(/^\uFEFF/, ''));

/** « 192x192 » → dimensions ; « any » → réservé au vectoriel. */
export const parseSizes = (value) => {
  if (value === 'any') return { any: true };
  const match = /^(\d+)x(\d+)$/.exec(String(value));
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
};

export const splitPurposes = (value) =>
  String(value === undefined ? 'any' : value)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

/**
 * Cette valeur déclarée (un champ du manifeste, une entrée de précache)
 * désigne-t-elle une adresse du SITE ?
 *
 * Trois refus, et chacun a sa raison d'être nommé pour lui-même :
 *   • une valeur qui n'est pas une CHAÎNE (`id: 42`) — il n'y a rien à résoudre ;
 *   • un SCHÉMA qui n'est pas http(s) (`javascript:`, `data:`) : `new URL()` les
 *     lit et leur `origin` vaut la chaîne « null », donc la comparaison
 *     d'origine les refuserait aussi — mais le message dirait « null au lieu
 *     de … », ce qui n'apprend rien à qui doit réparer ;
 *   • une ORIGINE différente (hôte ou port).
 *
 * Une valeur RELATIVE (`dashboard`, `/index.html`) est résolue contre l'origine
 * du site, donc acceptée : c'est la spec (les URL du manifeste se résolvent
 * contre l'URL du manifeste), et un chemin relatif ne peut pas sortir du
 * domaine. Un hôte qui IMITE le nôtre (`kojoforafrica.cc.cd.ailleurs.test`) est
 * refusé par construction, parce que c'est `new URL()` qui décide de l'hôte —
 * jamais un suffixe comparé à la main.
 *
 * @param {unknown} valeur Valeur déclarée.
 * @param {{ origineDuSite?: string, sujet?: string, nommerLaValeur?: boolean }} [options]
 *   `nommerLaValeur: false` pour un `sujet` qui contient déjà la valeur.
 * @returns {{ ok: true, url: URL, href: string } | { ok: false, raison: string }}
 */
export const memeOrigineQueLeSite = (
  valeur,
  { origineDuSite = SITE_ORIGIN, sujet = 'cette valeur', nommerLaValeur = true } = {}
) => {
  // `nommerLaValeur` existe pour les sujets qui PORTENT déjà la valeur (une
  // entrée de précache se nomme par son texte) : sans lui, le message dirait
  // deux fois la même adresse — « l'entrée de précache « X » (« X ») … ».
  const nom = nommerLaValeur ? ` (« ${valeur} »)` : '';
  let base;
  try {
    base = new URL(origineDuSite).origin;
  } catch (_erreur) {
    return { ok: false, raison: `l'origine du site déclarée (« ${origineDuSite} ») n'est pas une URL absolue` };
  }
  if (typeof valeur !== 'string') {
    return { ok: false, raison: `${sujet} doit être une chaîne (reçu ${typeof valeur})` };
  }
  let url;
  try {
    url = new URL(valeur, base);
  } catch (_erreur) {
    return { ok: false, raison: `${sujet}${nom} n'est pas une URL résolvable` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      raison: `${sujet}${nom} emploie le schéma « ${url.protocol} » — seuls http et https servent une page du site`,
    };
  }
  if (url.origin !== base) {
    return {
      ok: false,
      raison:
        `${sujet}${nom} pointe hors du domaine du site (${url.origin} au lieu de ${base}) : ` +
        `l'application installée s'ouvrirait sur un domaine qu'on n'exploite pas`,
    };
  }
  return { ok: true, url, href: url.href };
};

/**
 * La LISTE DE PRÉCACHE d'un service worker : ses entrées littérales, ou la
 * raison pour laquelle on ne peut pas les lire.
 *
 * On ne fait pas `eval` (le fichier est du code, pas des données) et on ne
 * découpe pas sur les virgules (une virgule dans une chaîne casserait
 * l'entrée) : le tableau est parcouru caractère par caractère. Tout ce qui n'est
 * ni un littéral de chaîne, ni une virgule, ni la fin du tableau est une entrée
 * CALCULÉE — et une entrée calculée ne peut pas être jugée, donc elle est
 * refusée : c'est le même refus de conclure que les planchers des autres gardes.
 *
 * @param {string} source Contenu du fichier du service worker.
 * @param {string} [nom] Nom du tableau (`APP_SHELL_URLS`).
 * @returns {{ ok: true, valeurs: string[] } | { ok: false, raison: string }}
 */
export const extraireListePrecache = (source, nom = PRECACHE_LIST_NAME) => {
  const texte = String(source ?? '');
  const entete = new RegExp(`\\b${nom}\\s*=\\s*\\[`).exec(texte);
  if (!entete) {
    return { ok: false, raison: `la liste « ${nom} » est introuvable (aucune déclaration \`${nom} = [ … ]\`)` };
  }

  const valeurs = [];
  let index = entete.index + entete[0].length;
  while (index < texte.length) {
    const caractere = texte[index];
    if (/\s/.test(caractere) || caractere === ',') {
      index += 1;
      continue;
    }
    if (caractere === ']') return { ok: true, valeurs };
    // Un COMMENTAIRE n'est pas une entrée : le refuser ferait rougir une liste
    // légitime, et un garde qui rougit à tort finit ignoré.
    if (caractere === '/' && texte[index + 1] === '/') {
      const finLigne = texte.indexOf('\n', index);
      index = finLigne === -1 ? texte.length : finLigne + 1;
      continue;
    }
    if (caractere === '/' && texte[index + 1] === '*') {
      const finBloc = texte.indexOf('*/', index + 2);
      if (finBloc === -1) return { ok: false, raison: `la liste « ${nom} » contient un commentaire de bloc non fermé` };
      index = finBloc + 2;
      continue;
    }
    if (caractere === "'" || caractere === '"' || caractere === '`') {
      const fin = texte.indexOf(caractere, index + 1);
      if (fin === -1) {
        return { ok: false, raison: `la liste « ${nom} » contient une chaîne non fermée` };
      }
      const valeur = texte.slice(index + 1, fin);
      if (caractere === '`' && /\$\{/.test(valeur)) {
        return {
          ok: false,
          raison: `l'entrée « ${valeur} » de la liste « ${nom} » est un gabarit, donc une adresse calculée : elle ne peut pas être jugée`,
        };
      }
      valeurs.push(valeur);
      index = fin + 1;
      continue;
    }
    const apercu = texte.slice(index, index + 40).split('\n')[0].trim();
    return {
      ok: false,
      raison: `la liste « ${nom} » contient une entrée qui n'est pas un littéral de chaîne (à « ${apercu}… ») : une adresse calculée ne peut pas être jugée`,
    };
  }
  return { ok: false, raison: `la liste « ${nom} » n'est pas fermée (le crochet « ] » manque)` };
};

/**
 * @param {{ root?: string }} [opts]
 * @returns {{ ok: boolean, errors: string[], notices: string[], icons: Array<object> }}
 */
export const runPwaManifestCheck = (opts = {}) => {
  const root = opts.root || process.cwd();
  const origineDuSite = opts.origineDuSite || SITE_ORIGIN;
  const publicDir = path.join(root, 'public');
  const manifestPath = path.join(root, MANIFEST_FILE);
  const familyManifestPath = path.join(root, FAMILY_MANIFEST_FILE);
  const familyDir = path.join(root, FAMILY_DIR);
  const log = opts.quiet ? () => {} : console.log;
  const logError = opts.quiet ? () => {} : console.error;

  const errors = [];
  const notices = [];
  const fail = (message) => errors.push(message);
  const icons = [];
  const urls = [];
  const precache = [];

  // ── 1. Le manifeste se lit ───────────────────────────────────────────────
  let manifest = null;
  if (!existsSync(manifestPath)) {
    fail(`${MANIFEST_FILE} absent : sans lui, aucune installation PWA n'est possible`);
  } else {
    try {
      manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      fail(`${MANIFEST_FILE} illisible (JSON invalide) : ${error.message}`);
    }
  }

  // L'inventaire de la famille fait autorité sur ce qu'est chaque icône : c'est
  // lui qui a été confronté aux pixels committés.
  let family = null;
  const familyEntries = new Map();
  let maskableContract = null;
  if (!existsSync(familyManifestPath)) {
    fail(
      `${FAMILY_MANIFEST_FILE} absent : impossible de vérifier qu'une icône déclarée ` +
        `« maskable » l'est vraiment`
    );
  } else {
    try {
      family = parseManifest(readFileSync(familyManifestPath, 'utf8'));
      for (const entry of [
        ...(Array.isArray(family.outputs) ? family.outputs : []),
        ...(family.maskable && Array.isArray(family.maskable.outputs) ? family.maskable.outputs : []),
      ]) {
        if (entry && typeof entry.file === 'string') familyEntries.set(entry.file, entry);
      }
      if (family.maskable && typeof family.maskable === 'object') {
        maskableContract = {
          sizes: new Set((family.maskable.sizes || []).map(Number)),
          safeZone: Number(family.maskable.safe_zone_radius),
          background: family.maskable.background,
          outputs: new Map(
            (Array.isArray(family.maskable.outputs) ? family.maskable.outputs : [])
              .filter((entry) => entry && typeof entry.file === 'string')
              .map((entry) => [entry.file, entry])
          ),
        };
      }
    } catch (error) {
      fail(`${FAMILY_MANIFEST_FILE} illisible (JSON invalide) : ${error.message}`);
    }
  }

  if (manifest) {
    // ── 2. Une seule source de vérité pour le fond des variantes maskable ───
    if (!maskableContract) {
      fail(
        `${FAMILY_MANIFEST_FILE} ne déclare pas de section « maskable » : le fond des ` +
          `variantes n'est pas vérifiable`
      );
    } else if (manifest.background_color !== maskableContract.background) {
      fail(
        `${MANIFEST_FILE} annonce background_color « ${manifest.background_color} » alors que ` +
          `les variantes maskable sont composées sur « ${maskableContract.background} » ` +
          `(generate_icons.py, MASKABLE_BACKGROUND) : le fond d'une icône adaptative doit ` +
          `être celui annoncé par le manifeste`
      );
    }

    // ── 3 à 5. Chaque icône déclarée ────────────────────────────────────────
    if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
      fail(`${MANIFEST_FILE} ne déclare aucune icône`);
    } else {
      for (const entry of manifest.icons) {
        const label = entry && typeof entry.src === 'string' ? entry.src : '<entrée sans src>';
        if (!entry || typeof entry !== 'object') {
          fail(`${MANIFEST_FILE} : entrée « icons » invalide`);
          continue;
        }
        if (typeof entry.src !== 'string' || !entry.src.startsWith('/')) {
          fail(`${MANIFEST_FILE} : « src » (${entry.src}) doit être un chemin absolu du site`);
          continue;
        }

        // 3. Le fichier reste sous public/ (aucune remontée de chemin).
        const target = path.resolve(publicDir, `.${entry.src}`);
        if (target !== publicDir && !target.startsWith(publicDir + path.sep)) {
          fail(`${MANIFEST_FILE} : « ${entry.src} » sort de public/`);
          continue;
        }
        const relative = path.relative(root, target).replace(/\\/g, '/');
        if (!existsSync(target)) {
          fail(`${relative} manquant : le manifeste PWA le déclare pourtant`);
          continue;
        }

        // 3bis. C'est un PNG réel, aux dimensions annoncées.
        const sizes = parseSizes(entry.sizes);
        if (!sizes) {
          fail(
            `${MANIFEST_FILE} : « sizes » (« ${entry.sizes} ») doit valoir « <largeur>x<hauteur> » ` +
              `ou « any » pour un vectoriel`
          );
          continue;
        }
        if (sizes.any) {
          if (path.extname(target).toLowerCase() !== '.svg') {
            fail(
              `${MANIFEST_FILE} : « sizes: any » n'est admis que pour un vectoriel, or ` +
                `${relative} n'en est pas un`
            );
            continue;
          }
        } else {
          const actual = readPngSize(target);
          if (!actual) {
            fail(`${relative} n'est pas un PNG valide (signature ou IHDR illisible)`);
            continue;
          }
          if (actual.width !== sizes.width || actual.height !== sizes.height) {
            fail(
              `${relative} fait ${actual.width}×${actual.height} alors que le manifeste annonce ` +
                `« ${entry.sizes} »`
            );
            continue;
          }
          const expectedType = 'image/png';
          if (entry.type !== expectedType) {
            fail(
              `${MANIFEST_FILE} : « ${entry.src} » est un PNG mais son « type » vaut ` +
                `« ${entry.type} » au lieu de « ${expectedType} »`
            );
            continue;
          }
        }
        // 4. Les jetons de « purpose ».
        const purposes = splitPurposes(entry.purpose);
        if (purposes.length === 0) {
          fail(`${MANIFEST_FILE} : « ${entry.src} » a un « purpose » vide`);
          continue;
        }
        if (new Set(purposes).size !== purposes.length) {
          fail(`${MANIFEST_FILE} : « ${entry.src} » répète un jeton dans « ${entry.purpose} »`);
          continue;
        }
        const unknown = purposes.filter((token) => !ALLOWED_PURPOSES.includes(token));
        if (unknown.length > 0) {
          fail(
            `${MANIFEST_FILE} : « ${entry.src} » emploie un purpose inconnu ` +
              `(${unknown.join(', ')}) — attendus : ${ALLOWED_PURPOSES.join(', ')}`
          );
          continue;
        }

        // 5. « maskable » se prouve, il ne se déclare pas.
        if (purposes.includes('maskable')) {
          if (!maskableContract) {
            continue; // déjà signalé en 2.
          }
          const name = path.basename(target);
          const output = maskableContract.outputs.get(name);
          if (!output) {
            fail(
              `${relative} est déclaré « maskable » mais n'est pas une variante fabriquée pour ` +
                `le masque (absente de maskable.outputs de ${FAMILY_MANIFEST_FILE}) — déclare cette ` +
                `taille dans MASKABLE_SIZES de generate_icons.py, ou retire « maskable » du purpose`
            );
            continue;
          }
          if (Number.isFinite(maskableContract.safeZone) && !maskableContract.sizes.has(sizes.width)) {
            fail(
              `${relative} est déclaré « maskable » à ${sizes.width} px, taille absente de ` +
                `maskable.sizes (${[...maskableContract.sizes].join(', ')})`
            );
            continue;
          }
          const recordedRadius = Number(output.content_radius);
          if (!Number.isFinite(recordedRadius) || recordedRadius > maskableContract.safeZone) {
            fail(
              `${relative} est déclaré « maskable » avec un contenu jusqu'à un rayon de ` +
                `${recordedRadius} alors que le masque ne garantit que ${maskableContract.safeZone} : ` +
                `l'icône serait rognée par les plateformes`
            );
            continue;
          }
          if (output.opaque !== true) {
            fail(
              `${relative} est déclaré « maskable » sans être entièrement opaque : un masque ` +
                `laisserait voir le fond du système à travers l'icône`
            );
            continue;
          }
        }

        icons.push({
          src: entry.src,
          sizes: entry.sizes,
          purpose: purposes.join(' '),
          maskable: purposes.includes('maskable'),
        });
        if (!familyEntries.has(path.basename(target))) {
          notices.push(
            `${relative} est déclaré par ${MANIFEST_FILE} sans appartenir à l'inventaire de la ` +
              `famille : aucune empreinte ne le verrouille`
          );
        }
      }
    }

    // ── 6. Aucune variante maskable fabriquée mais jamais servie ────────────
    if (existsSync(familyDir)) {
      const declaredSources = new Set(
        (Array.isArray(manifest.icons) ? manifest.icons : [])
          .filter((entry) => entry && typeof entry.src === 'string')
          .map((entry) => path.basename(entry.src))
      );
      const onDisk = readdirSync(familyDir)
        .filter((name) => MASKABLE_NAME.test(name))
        .sort();
      for (const name of onDisk) {
        if (!declaredSources.has(name)) {
          fail(
            `${FAMILY_DIR}/${name} existe mais n'est déclarée nulle part dans ${MANIFEST_FILE} : ` +
              `une variante fabriquée pour le masque et jamais servie ne sert à rien — ` +
              `déclare-la avec « purpose: maskable » ou cesse de la produire`
          );
        }
      }
    }

    // ── 7. id / start_url / scope : sous la MÊME origine ─────────────────────
    // Un champ ABSENT n'est pas jugé : la spec lui donne un défaut (l'URL du
    // manifeste), qui est sous l'origine du site par construction.
    for (const champ of CHAMPS_A_MEME_ORIGINE) {
      if (!Object.prototype.hasOwnProperty.call(manifest, champ)) continue;
      const verdict = memeOrigineQueLeSite(manifest[champ], {
        origineDuSite,
        sujet: `« ${champ} »`,
      });
      if (!verdict.ok) fail(`${MANIFEST_FILE} : ${verdict.raison}`);
      else urls.push({ champ, valeur: String(manifest[champ]), href: verdict.href });
    }
  }

  // ── 8. La liste de précache du service worker ─────────────────────────────
  // Elle est jugée HORS du `if (manifest)` : un manifeste illisible ne doit pas
  // dispenser de regarder ce que l'installation télécharge.
  const serviceWorkerPath = path.join(root, SERVICE_WORKER_FILE);
  if (!existsSync(serviceWorkerPath)) {
    fail(
      `${SERVICE_WORKER_FILE} absent : la liste de précache n'est plus lisible — un service worker que ` +
        `rien ne lit n'est pas un service worker vérifié`
    );
  } else {
    const lecture = extraireListePrecache(readFileSync(serviceWorkerPath, 'utf8'));
    if (!lecture.ok) {
      fail(`${SERVICE_WORKER_FILE} : ${lecture.raison}`);
    } else if (lecture.valeurs.length === 0) {
      fail(
        `${SERVICE_WORKER_FILE} : la liste « ${PRECACHE_LIST_NAME} » est VIDE — un service worker qui ne ` +
          `précache rien laisse l'application sans coquille hors ligne, et un vert sur une liste vide ne ` +
          `dirait rien de son contenu`
      );
    } else {
      for (const entree of lecture.valeurs) {
        const verdict = memeOrigineQueLeSite(entree, {
          origineDuSite,
          sujet: `l'entrée de précache « ${entree} »`,
          nommerLaValeur: false,
        });
        if (!verdict.ok) fail(`${SERVICE_WORKER_FILE} : ${verdict.raison}`);
        else precache.push(entree);
      }
    }
  }

  if (errors.length > 0) {
    logError(`❌ Manifeste PWA non conforme (${errors.length} problème(s)) :`);
    for (const message of errors) logError(`   • ${message}`);
    for (const message of notices) logError(`   ℹ️  ${message}`);
    return { ok: false, errors, notices, icons, urls, precache };
  }

  log(`Icônes déclarées par ${MANIFEST_FILE} :`);
  for (const icon of icons) {
    log(`  ${icon.src.padEnd(36)} ${icon.sizes.padEnd(9)} ${icon.purpose}`);
  }
  if (urls.length > 0) {
    log(`Application installée : ${urls.map((url) => `${url.champ}=${url.valeur}`).join(', ')} — sous ${origineDuSite}`);
  }
  log(`Précache de ${SERVICE_WORKER_FILE} : ${precache.length} entrée(s), toutes sous ${origineDuSite}`);
  for (const message of notices) log(`  ℹ️  ${message}`);
  log(
    `✅ Manifeste PWA verrouillé : ${icons.length} icône(s) existante(s) aux bonnes dimensions, ` +
      `« maskable » prouvé par la mesure, aucune variante orpheline, et l'application installée reste ` +
      `sous ${origineDuSite} (${urls.length} champ(s) d'URL, ${precache.length} entrée(s) de précache)`
  );
  return { ok: true, errors, notices, icons, urls, precache };
};

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = runPwaManifestCheck();
  if (!result.ok) process.exit(1);
}
