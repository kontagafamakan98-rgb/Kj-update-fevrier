/**
 * GARDE-FOU CI : LA COUVERTURE DES CLASSES DE TIERS, ET LE REFUS D'UNE ORPHELINE.
 *
 * ── PAS DE `#!`, ET C'EST UNE MESURE (07/10/2026) ─────────────────────────
 * Ce fichier charge une déclaration par un `import()` dont le SPÉCIFICATEUR est
 * une variable (la matrice nomme le module). Vite ne peut pas analyser un tel
 * `import()` : il le réécrit en appel à son client HMR et PRÉFIXE ce fichier,
 * ce qui repousse le hashbang au-delà de la première ligne — et `vitest`, qui
 * importe ce module pour l’éprouver, refuse alors le fichier (« Parse failure:
 * Expected ident » à 1:68). Le `#!` des gardes voisins n’est donc pas recopié
 * ici : le fichier est lancé par `node scripts/…`, jamais comme exécutable.
 *
 * La règle et la matrice sont dans `scripts/couverture-tiers.js` ; la preuve
 * d'échec dans `scripts/__tests__/check-couverture-tiers.test.js`. Ce fichier-ci
 * lit le disque, charge ce que la matrice DÉCLARE, appelle la règle et sort :
 * c'est le bras de la CI.
 *
 * ── Le trou que ce garde ferme, et pourquoi les quatre autres ne le ferment pas ──
 * Le dépôt regarde les tiers par CINQ canaux (deux gardes statiques, trois
 * sondes dynamiques), et chacun publie ses propres limites en prose. Mais RIEN
 * ne reliait une CLASSE de tiers (`SORTES` : « identifiant », « lien rendu »,
 * « chargé après interaction »…) aux canaux qui peuvent l'observer. On ne
 * pouvait donc pas dire si le classement d'une origine était vérifié par
 * QUELQU'UN : `CLASSEMENT_ORIGINES` pouvait affirmer « cette origine est
 * permise parce qu'elle est un lien rendu, jamais une requête » pendant
 * qu'aucune mesure ne confronterait jamais cette affirmation. Une exemption qui
 * survit à son contrôle est exactement ce que ce dépôt refuse ailleurs.
 *
 * Ce garde-ci rend le trou visible et le refuse : une classe qu'AUCUN canal
 * n'observe (ORPHELINE), une classe sans ligne de matrice, une ligne dont la
 * classe n'existe plus, une raison d'absence donnée à un canal qui observe,
 * un canal cité qui n'existe pas, une raison d'absence muette, un canal qui
 * cite deux fois le même observateur.
 *
 * ── Ce qu'il vérifie EN PLUS de la règle pure, et qu'aucun test ne peut ────
 *   * chaque `module` et chaque `sonde` d'un canal EXISTE sur disque (une sonde
 *     supprimée laisserait le canal sans exécutant, donc la matrice décrirait
 *     une observation qui n'a plus lieu) ;
 *   * chaque déclaration de limites (`CE_QUE_*`) est réellement CHARGÉE et rend
 *     un tableau NON VIDE (un export renommé ou une liste vidée retire au canal
 *     ses limites publiées sans que la prose ne change d'un mot).
 *
 * ── Les planchers de LECTURE ───────────────────────────────────────────────
 * Sous ceux-là, le garde REFUSE de juger : il n'a pas lu son sujet (la matrice
 * a été vidée, un canal a disparu, les déclarations n'ont pas pu être
 * chargées). Relevé du 07/10/2026 sur l'arbre réel : 5 canaux, 6 classes,
 * 3 canaux à déclaration lue. Un `import` cassé rendrait sinon un vert.
 *
 * Usage : cd frontend && node scripts/check-couverture-tiers.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CANAUX, MATRICE, classesDuVocabulaire, lacunesDeCouverture } from './couverture-tiers.js';
import { SORTES } from './origines-bundles.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
/** La racine du frontend (celle du garde), et celle du dépôt (celle des chemins de la matrice). */
export const RACINE = path.join(ICI, '..');
export const RACINE_DEPOT = path.join(RACINE, '..');

/**
 * LES PLANCHERS DE LECTURE. Relevé du 07/10/2026 : 5 canaux, 6 classes,
 * 3 canaux portant une déclaration de limites lue. Les planchers sont posés un
 * cran SOUS le relevé du jour : ils ne jugent pas la richesse de la matrice, ils
 * refusent seulement un balayage qui n'a rien lu.
 */
export const MIN_CANAUX = 5;
export const MIN_CLASSES = 6;
export const MIN_DECLARATIONS_LUES = 3;

/** Les champs de chemin qu'un canal doit nommer et qui doivent EXISTER. */
export const CHAMPS_DE_CHEMIN = ['module', 'sonde'];

/**
 * Charge UN export d'un module, par son chemin absolu.
 *
 * Séparé de `auditerCanaux` pour être remplaçable dans les cas synthétiques :
 * c'est ce qui permet d'éprouver le refus « export absent » / « liste vidée »
 * sans écrire un module temporaire sur disque.
 *
 * @param {string} cheminAbsolu Le module (chemin absolu, résolu).
 * @param {string} nomExport L'export attendu.
 * @returns {Promise<unknown>} La valeur de l'export (peut être `undefined`).
 */
export const chargerExport = async (cheminAbsolu, nomExport) => {
  // Le spécificateur est une VARIABLE (la matrice nomme le module) : c’est ce
  // `import()` qui interdit le `#!` en tête de ce fichier — voir l’en-tête.
  const module = await import(/* @vite-ignore */ pathToFileURL(cheminAbsolu).href);
  return module[nomExport];
};

/**
 * L'AUDIT DES CANAUX : ce que la matrice nomme existe-t-il, et chaque canal
 * publie-t-il encore ses limites.
 *
 * Aucune décision de couverture ici — seulement des faits d'existence et de
 * lecture. C'est `lacunesDeCouverture` (pure) qui juge classe par classe.
 *
 * @param {{
 *   racineDepot?: string,
 *   canaux?: Object,
 *   chargerDeclaration?: (cheminAbsolu: string, nomExport: string) => Promise<unknown>,
 * }} [options]
 * @returns {Promise<{
 *   manquants: Array<{canal: string, champ: string, chemin: string}>,
 *   declarationsFautives: Array<{canal: string, raison: string}>,
 *   declarationsLues: Array<{canal: string, module: string, export: string, cle: string, taille: number}>,
 * }>}
 */
export const auditerCanaux = async ({
  racineDepot = RACINE_DEPOT,
  canaux = CANAUX,
  chargerDeclaration = chargerExport,
} = {}) => {
  const manquants = [];
  const declarationsFautives = [];
  const declarationsLues = [];

  for (const id of Object.keys(canaux || {})) {
    const canal = canaux[id] || {};

    // 1. Chaque chemin nommé doit EXISTER. Un chemin vide est un refus à part
    //    entière : il n'y a rien à chercher.
    for (const champ of CHAMPS_DE_CHEMIN) {
      const relatif = canal[champ];
      // Un chemin VIDE (ou fait d’espaces) est un refus à part entière : il n’y a
      // rien à chercher, et le message doit le dire plutôt que nommer un chemin
      // blanc comme « absent ».
      if (typeof relatif !== 'string' || relatif.trim() === '') {
        manquants.push({ canal: id, champ, chemin: '' });
        continue;
      }
      if (!fs.existsSync(path.resolve(racineDepot, relatif))) {
        manquants.push({ canal: id, champ, chemin: relatif });
      }
    }

    // 2. La déclaration de limites : soit elle existe et rend un tableau NON
    //    VIDE, soit le canal déclare POURQUOI il n'en a pas. Un canal muet
    //    n'est pas un canal sans limites, c'est un canal dont personne ne sait
    //    ce qu'il ne voit pas.
    const declaration = canal.declaration ?? null;
    if (!declaration) {
      if (String(canal.motif || '').trim() === '') {
        declarationsFautives.push({
          canal: id,
          raison:
            'aucune déclaration de limites ET aucun motif écrit — un canal sans `declaration` doit ' +
            'dire POURQUOI il n’en a pas (`motif`), sinon son angle mort n’est publié nulle part',
        });
      }
      continue;
    }

    const { module: cheminDeclaration, export: nomExport, cle } = declaration;
    if (
      typeof cheminDeclaration !== 'string' ||
      cheminDeclaration.trim() === '' ||
      typeof nomExport !== 'string' ||
      nomExport.trim() === '' ||
      typeof cle !== 'string' ||
      cle.trim() === ''
    ) {
      declarationsFautives.push({
        canal: id,
        raison: 'déclaration incomplète — `module`, `export` et `cle` sont les trois champs attendus',
      });
      continue;
    }

    let valeur;
    try {
      valeur = await chargerDeclaration(path.resolve(racineDepot, cheminDeclaration), nomExport);
    } catch (erreur) {
      declarationsFautives.push({
        canal: id,
        raison: `module de déclaration illisible (${cheminDeclaration}) : ${erreur.message}`,
      });
      continue;
    }
    if (valeur === undefined) {
      declarationsFautives.push({
        canal: id,
        raison: `l’export « ${nomExport} » n’existe pas dans ${cheminDeclaration}`,
      });
      continue;
    }
    const liste = valeur?.[cle];
    if (!Array.isArray(liste) || liste.length === 0) {
      declarationsFautives.push({
        canal: id,
        raison:
          `${nomExport}.${cle} est vide ou n’est pas un tableau — un canal sans limites publiées ` +
          'n’est pas un canal sans angle mort',
      });
      continue;
    }
    declarationsLues.push({
      canal: id,
      module: cheminDeclaration,
      export: nomExport,
      cle,
      taille: liste.length,
    });
  }

  return { manquants, declarationsFautives, declarationsLues };
};

/**
 * LE VERDICT. La forme est celle des gardes voisins (`runMarqueKojoCheck`) :
 * `errors` vide ⇒ `ok`, et chaque message NOMME sa faute, sinon le rouge n'est
 * pas réparable.
 *
 * @param {{
 *   racineDepot?: string,
 *   sortes?: Object,
 *   canaux?: Object,
 *   matrice?: Object,
 *   chargerDeclaration?: Function,
 *   journal?: {log: Function, error?: Function},
 * }} [options]
 * @returns {Promise<{ok: boolean, errors: string[], notices: string[], declarationsLues: Array<Object>}>}
 */
export const runCouvertureTiersCheck = async ({
  racineDepot = RACINE_DEPOT,
  sortes = SORTES,
  canaux = CANAUX,
  matrice = MATRICE,
  chargerDeclaration = chargerExport,
  journal = console,
} = {}) => {
  const log = (message) => journal.log(message);
  const logError = (message) => (journal.error || journal.log)(message);
  const errors = [];
  const notices = [];

  const idsCanaux = Object.keys(canaux || {});

  // Le vocabulaire des classes AVANT les planchers : un `SORTES` ambigu (deux
  // clés de même valeur) ferait disparaître une classe de la couverture, et
  // juger sur un vocabulaire illisible est exactement ce que ce garde refuse.
  let idsClasses;
  try {
    idsClasses = classesDuVocabulaire(sortes);
  } catch (erreur) {
    logError(`❌ La couverture des classes de tiers ne peut pas être jugée : ${erreur.message}`);
    return { ok: false, errors: [erreur.message], notices, declarationsLues: [] };
  }

  // ── Les planchers, AVANT toute lecture de la matrice ──────────────────────
  if (idsCanaux.length < MIN_CANAUX) {
    errors.push(
      `canaux insuffisants (${idsCanaux.length} < ${MIN_CANAUX}) : la matrice n’a plus assez de vues ` +
        'à confronter — refus de juger (un canal renommé ou supprimé doit se voir ici, pas passer ' +
        'pour une matrice plus courte).'
    );
  }
  if (idsClasses.length < MIN_CLASSES) {
    errors.push(
      `classes insuffisantes (${idsClasses.length} < ${MIN_CLASSES}) : le vocabulaire ` +
        '`SORTES` a été vidé ou tronqué — le garde n’a pas lu son sujet, refus de juger.'
    );
  }

  const audit = await auditerCanaux({ racineDepot, canaux, chargerDeclaration });
  const { manquants, declarationsFautives, declarationsLues } = audit;

  for (const { canal, champ, chemin } of manquants) {
    errors.push(
      `canal « ${canal} » : ${chemin ? `le champ « ${champ} » nomme un fichier ABSENT` : `le champ « ${champ} » est vide`}` +
        `${chemin ? ` (${chemin})` : ''} — un canal sans règle ou sans sonde n’observe plus rien, et la ` +
        'matrice décrirait une observation qui n’a plus lieu.'
    );
  }
  for (const { canal, raison } of declarationsFautives) {
    errors.push(`canal « ${canal} » : ${raison}`);
  }
  if (declarationsLues.length < MIN_DECLARATIONS_LUES) {
    errors.push(
      `déclarations de limites lues insuffisantes (${declarationsLues.length} < ` +
        `${MIN_DECLARATIONS_LUES}) : les ` +
        'limites publiées des canaux n’ont pas pu être chargées — refus de juger sur une prose ' +
        'qu’on n’a pas lue.'
    );
  }

  // ── La règle PURE : qui observe quelle classe, et qui ne le peut pas ─────
  const lacunes = lacunesDeCouverture({ sortes, canaux, matrice });

  for (const classe of lacunes.nonCouvertes) {
    errors.push(
      `classe « ${classe} » SANS LIGNE de matrice : personne n’a décidé quels canaux peuvent ` +
        'l’observer — une classe nouvelle exige une décision écrite, pas un défaut.'
    );
  }
  for (const classe of lacunes.orphelines) {
    errors.push(
      `classe « ${classe} » ORPHELINE : aucun canal ne l’observe, donc son classement dans ` +
        '`CLASSEMENT_ORIGINES` affirme une raison que nulle mesure ne confronte — une exemption ' +
        'invérifiable qui survivra au code qu’elle justifie.'
    );
  }
  for (const classe of lacunes.classesInconnues) {
    errors.push(
      `ligne de matrice « ${classe} » : cette classe n’existe plus dans ` +
        '`SORTES` — la ligne a survécu à ce qu’elle décrivait, donc elle décrit autre chose.'
    );
  }
  for (const { classe, canal } of lacunes.canauxInconnus) {
    errors.push(
      `classe « ${classe} » : le canal « ${canal} » est CITÉ mais n’existe pas dans ` +
        '`CANAUX` — il a été renommé ou supprimé, et la matrice mentirait en le citant.'
    );
  }
  for (const { classe, canal } of lacunes.observationsIncoherentes) {
    errors.push(
      `classe « ${classe} » : le canal « ${canal} » est listé DEUX FOIS dans ` +
        '`vusPar` — la ligne se contredit.'
    );
  }
  for (const { classe, canal } of lacunes.absencesIncoherentes) {
    errors.push(
      `classe « ${classe} » : une raison d’ABSENCE est donnée au canal « ${canal} » alors que ` +
        'la ligne le compte parmi ses observateurs — l’une des deux affirmations est fausse, et ' +
        'retenir l’une au hasard ferait dire à la matrice le contraire de ce qu’elle écrit.'
    );
  }
  for (const { classe, canal } of lacunes.raisonsManquantes) {
    errors.push(
      `classe « ${classe} » : le canal « ${canal} » ne l’observe pas et AUCUNE raison n’est ` +
        'écrite (ni `absence`, ni `absencesParticulieres`) — une absence muette ne se distingue ' +
        'pas d’un oubli.'
    );
  }

  if (errors.length > 0) {
    logError(`❌ La couverture des classes de tiers est en écart (${errors.length} problème(s)) :`);
    for (const message of errors) logError(`   • ${message}`);
    for (const message of notices) logError(`   ℹ️  ${message}`);
    return { ok: false, errors, notices, declarationsLues };
  }

  log(
    `Canaux confrontés : ${idsCanaux.length} canaux (${declarationsLues.length} avec limites lues), ` +
      `${idsClasses.length} classes — ${idsCanaux
        .map((id) => `${id} (${canaux[id].nature})`)
        .join(', ')}`
  );
  for (const lu of declarationsLues) {
    log(`  ${lu.canal.padEnd(18)} limites lues dans ${lu.export}.${lu.cle} — ${lu.taille} entrée(s)`);
  }
  for (const message of notices) log(`  ℹ️  ${message}`);
  log(
    `✅ Couverture tenue : chacune des ${idsClasses.length} classes de tiers est observée par au ` +
      'moins un canal, et chacun des canaux absents a sa raison écrite.'
  );
  return { ok: true, errors, notices, declarationsLues };
};

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const resultat = await runCouvertureTiersCheck();
  if (!resultat.ok) process.exit(1);
}
