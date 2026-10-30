#!/usr/bin/env node
/**
 * LE FUNNEL EST-IL ÉMIS LÀ OÙ IL DOIT, ET SEULEMENT AVEC DES CLÉS DÉCLARÉES ?
 *
 * ── Ce que ce garde empêche ─────────────────────────────────────────────────
 * `src/utils/funnel.js` porte deux listes — les cinq ÉTAPES et les CLÉS de
 * paramètres admises —, et il FILTRE au moment de l'envoi. Un filtre runtime ne
 * protège pourtant que ce qui passe par lui :
 *   • un `gtag('event', …)` écrit DIRECTEMENT dans une page contourne la liste
 *     blanche et envoie ce qu'il veut, y compris une adresse email ;
 *   • une clé mal orthographiée (`pays`, `countryCode`) est écartée en silence
 *     par le filtre : l'étape part, la dimension manque, et personne ne le voit ;
 *   • une étape DÉCLARÉE que plus aucune page n'émet reste dans les listes et se
 *     lit comme mesurée alors qu'elle n'existe plus ;
 *   • un paramètre dont les clés viennent d'un objet calculé (`{ ...form }`) ne
 *     peut pas être jugé : le filtre le réduirait, mais rien ne dit ce qu'il
 *     contenait, et c'est exactement la forme d'un futur `{ email }`.
 *
 * ── Ce qu'il vérifie ────────────────────────────────────────────────────────
 *   1. NOM D'ÉVÉNEMENT — chaque `trackFunnel(…)` de `src/` reçoit soit
 *      `EVENEMENTS_FUNNEL.<clé>`, soit une chaîne littérale qui figure dans la
 *      liste. Un nom calculé est refusé : on ne juge pas ce qu'on ne lit pas.
 *   2. CLÉS — l'objet de paramètres est LITTÉRAL, sans `spread` ni clé
 *      calculée, et chacune de ses clés est déclarée dans `CLES_FUNNEL`.
 *   3. ÉMETTEUR — chacune des étapes déclarées (les cinq de l'entonnoir, plus
 *      `job_shared` du partage) a au moins un appelant hors des tests. Une
 *      étape déclarée sans émetteur est un refus nommé. *   4. AUCUN CONTOURNEMENT — un `gtag('event', …)` direct est refusé partout,
 *      sauf l'exception DÉCLARÉE ci-dessous (la page vue, qui n'est pas une
 *      étape de funnel et n'a qu'un seul propriétaire).
 *   5. PLANCHERS — sous `PLANCHERS.fichiers` fichiers lus ou `PLANCHERS.appels`
 *      appels trouvés, il refuse de conclure : un balayage cassé rendrait tous
 *      ses refus muets en rendant son périmètre vide, et ça passerait pour un
 *      vert (la forme de silence que F9 a coûtée).
 *
 * Les imports sont lus dans l'ARBRE SYNTAXIQUE (@babel/parser), pas par
 * expression régulière : `trackFunnel(` cité dans un commentaire ou dans une
 * chaîne de documentation n'est pas un appel, et une regex le prendrait pour
 * tel — les gardes de ce dépôt se sont déjà fait piéger par leurs propres
 * explications.
 *
 * Ce qu'il ne juge pas, et qui est écrit plutôt que tu : la VALEUR d'un
 * paramètre (c'est le filtre de `funnel.js` qui la borne, et ses cas de test qui
 * la verrouillent), et le fait que l'appel soit atteint pour un utilisateur réel
 * (seul le parcours e2e le dirait).
 *
 * Usage : cd frontend && node scripts/check-funnel-events.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

import { EVENEMENTS_FUNNEL, CLES_FUNNEL } from '../src/utils/funnel.js';

// @babel/traverse est un module CJS : selon l'interopérateur, la fonction est
// exportée directement ou sous `.default`.
const traverse = traverseModule.default || traverseModule;

const ICI = path.dirname(fileURLToPath(import.meta.url));

/** Le répertoire jugé : `src/`, résolu depuis CE fichier (CI ou poste). */
export const SRC = path.resolve(ICI, '..', 'src');

/** Le seul appel direct à `gtag('event', …)` toléré, et pourquoi. */
// `page_view` a un domicile UNIQUE, et il a changé le 30/10/2026 : le
// planificateur de vue vit désormais dans `utils/vue-de-page.js`, sans quoi
// `utils/seo.js` (appelé à chaque navigation) entraînait le module d'injection
// des fournisseurs dans le JS initial. C'est le même émetteur, plus mince.
export const EVENEMENTS_HORS_FUNNEL = Object.freeze({
  page_view: 'utils/vue-de-page.js',
});

/**
 * L'ÉMETTEUR du funnel : lui seul a le droit d'appeler `gtag('event', …)` avec
 * un nom qu'il a déjà validé (`trackFunnel` refuse un nom non déclaré AVANT
 * d'arriver ici). Autoriser un autre fichier ouvrirait la porte que ce garde
 * ferme ; l'autoriser ici est la définition même du module.
 */
export const PROPRIETAIRE_FUNNEL = 'utils/funnel.js';

/**
 * Planchers de lecture, MESURÉS sur l'arbre (voir le rapport publié par le
 * garde) : ils ne disent rien du produit, seulement « le balayage a bien vu le
 * corpus ». Un `src/` tronqué, un motif d'extension cassé ou un dossier
 * disparu les franchissent à la baisse.
 */
export const PLANCHERS = Object.freeze({ fichiers: 150, appels: 5 });

const EXTENSIONS = new Set(['.js', '.jsx']);
const PARSER_OPTIONS = Object.freeze({
  sourceType: 'unambiguous',
  plugins: ['jsx', 'importMeta', 'dynamicImport', 'topLevelAwait'],
  errorRecovery: false,
});

/**
 * Les fichiers de `src/` jugés, en chemins relatifs à `src/`, sans les tests.
 *
 * Les tests sont EXCLUS : un cas qui appelle `trackFunnel` pour l'éprouver
 * compterait comme un émetteur, et une étape pourrait alors sembler branchée
 * alors que seule sa preuve l'appelle.
 *
 * @param {string} [racine] Répertoire `src/` (injectable pour les cas d'échec).
 * @returns {string[]} Chemins relatifs triés, séparateurs `/`.
 */
export function fichiersSources(racine = SRC) {
  const trouves = [];
  const parcourir = (absolu) => {
    for (const entree of fs.readdirSync(absolu, { withFileTypes: true })) {
      const chemin = path.join(absolu, entree.name);
      if (entree.isDirectory()) {
        if (entree.name === '__tests__' || entree.name === 'node_modules') continue;
        parcourir(chemin);
        continue;
      }
      if (!entree.isFile() || !EXTENSIONS.has(path.extname(entree.name))) continue;
      trouves.push(path.relative(racine, chemin).split(path.sep).join('/'));
    }
  };
  parcourir(racine);
  return trouves.sort();
}

/**
 * Lit les sources du périmètre (`null` = illisible, jamais une exception).
 *
 * @param {string} [racine] Répertoire `src/`.
 * @param {string[]} [fichiers] Périmètre ; dérivé de `fichiersSources`.
 * @returns {Record<string, string|null>} `chemin → source`.
 */
export function lireLesSources(racine = SRC, fichiers = fichiersSources(racine)) {
  const sources = {};
  for (const relatif of fichiers) {
    try {
      sources[relatif] = fs.readFileSync(path.join(racine, relatif), 'utf8');
    } catch (_erreur) {
      sources[relatif] = null;
    }
  }
  return sources;
}

/** Nom local d'un identifiant d'import, quelle que soit l'écriture. */
const nomLocal = (specifier) => specifier?.local?.name || '';
const nomImporte = (specifier) => specifier?.imported?.name || '';

/**
 * Les noms LOCAUX liés au module de funnel par les imports d'un fichier.
 *
 * Un appelant peut renommer à l'import (`trackFunnel as suivreEtape`) : le garde
 * le suit, sinon un renommage suffirait à sortir de son périmètre sans qu'aucune
 * ligne de règle ne change.
 *
 * @param {object} fichierAst AST du fichier.
 * @returns {{ appels: Set<string>, evenements: Set<string> }} Noms locaux.
 */
const lieuxDuModule = (fichierAst) => {
  const appels = new Set(['trackFunnel']);
  const evenements = new Set(['EVENEMENTS_FUNNEL']);

  for (const noeud of fichierAst.program.body) {
    if (noeud.type !== 'ImportDeclaration') continue;
    const source = String(noeud.source?.value || '');
    if (!/(^|\/)utils\/funnel$|^\.\/funnel$/.test(source)) continue;
    for (const specifier of noeud.specifiers || []) {
      if (specifier.type !== 'ImportSpecifier') continue;
      const importe = nomImporte(specifier);
      if (importe === 'trackFunnel') appels.add(nomLocal(specifier));
      if (importe === 'EVENEMENTS_FUNNEL') evenements.add(nomLocal(specifier));
    }
  }

  return { appels, evenements };
};

/** Le nom de l'événement porté par un `EVENEMENTS_FUNNEL.<clé>`, ou `undefined`. */
const evenementParCle = (noeud, lieux, evenements) => {
  if (!noeud || noeud.type !== 'MemberExpression' || noeud.computed) return undefined;
  if (!lieux.evenements.has(noeud.object?.name)) return undefined;
  return evenements[noeud.property?.name];
};

/** La clé d'une propriété d'objet littéral, ou `null` si elle est calculée. */
const cleDePropriete = (propriete) => {
  if (propriete.type !== 'ObjectProperty' || propriete.computed) return null;
  if (propriete.key.type === 'Identifier') return propriete.key.name;
  if (propriete.key.type === 'StringLiteral') return propriete.key.value;
  return null;
};

/**
 * Le verdict, sans E/S : il juge des sources fournies.
 *
 * @param {Record<string, string|null>} sources `chemin → source`.
 * @param {object} [options] Listes et planchers (injectables pour les preuves).
 * @returns {{ refus: string[], lues: object }} Refus nommés et comptes lus.
 */
export function auditerSources(sources, options = {}) {
  const evenements = options.evenements || EVENEMENTS_FUNNEL;
  const cles = options.cles || CLES_FUNNEL;
  const planchers = options.planchers || PLANCHERS;
  const horsFunnel = options.horsFunnel || EVENEMENTS_HORS_FUNNEL;
  const proprietaireFunnel = options.proprietaireFunnel || PROPRIETAIRE_FUNNEL;

  const nomsDeclares = new Set(Object.values(evenements));
  const refus = [];
  const emetteurs = new Map(Object.values(evenements).map((nom) => [nom, 0]));
  let appels = 0;

  for (const [fichier, source] of Object.entries(sources)) {
    if (source === null) {
      refus.push(`${fichier} : illisible — le fichier n'a pas été jugé`);
      continue;
    }

    let ast;
    try {
      ast = parse(source, PARSER_OPTIONS);
    } catch (erreur) {
      refus.push(`${fichier} : illisible (${erreur.message}) — le fichier n'a pas été jugé`);
      continue;
    }

    const lieux = lieuxDuModule(ast);

    traverse(ast, {
      CallExpression(chemin) {
        const noeud = chemin.node;
        const callee = noeud.callee;
        const ligne = noeud.loc?.start?.line ?? 0;
        const ou = `${fichier}:${ligne}`;

        const estGtag =
          (callee.type === 'Identifier' && callee.name === 'gtag') ||
          (callee.type === 'MemberExpression' &&
            !callee.computed &&
            callee.object?.name === 'window' &&
            callee.property?.name === 'gtag');

        if (estGtag) {
          const premier = noeud.arguments?.[0];
          if (premier?.type !== 'StringLiteral' || premier.value !== 'event') return;
          // L'émetteur du funnel : c'est LUI qui publie, après avoir validé le
          // nom contre la liste (voir PROPRIETAIRE_FUNNEL).
          if (fichier === proprietaireFunnel) return;
          const second = noeud.arguments?.[1];
          const nom = second?.type === 'StringLiteral' ? second.value : '';
          const proprietaire = horsFunnel[nom];
          if (!proprietaire) {
            refus.push(
              `${ou} : \`gtag('event', ${nom ? `'${nom}'` : '…'})\` écrit DIRECTEMENT — ` +
                `les événements passent par \`trackFunnel\` (src/utils/funnel.js), sinon la ` +
                `liste blanche des clés est contournée.`
            );
            return;
          }
          if (fichier !== proprietaire) {
            refus.push(
              `${ou} : \`${nom}\` n'a qu'un propriétaire déclaré (${proprietaire}) — ` +
                `un second émetteur publierait deux fois la même chose.`
            );
          }
          return;
        }

        // Le SECOND fournisseur (PostHog, SDK CDN) a le même domicile unique :
        // `trackFunnel`. Le garde ne jugeait que `gtag` ; ajouter le relais
        // sans étendre la règle aurait laissé un `posthog.capture('sign_up',
        // { email })` dans une page contourner la liste blanche chez l'autre
        // fournisseur, sans qu'aucune ligne de ce garde ne change.
        const estPosthog =
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property?.name === 'capture' &&
          (callee.object?.name === 'posthog' ||
            (callee.object?.type === 'MemberExpression' &&
              !callee.object.computed &&
              callee.object.object?.name === 'window' &&
              callee.object.property?.name === 'posthog'));

        if (estPosthog) {
          if (fichier === proprietaireFunnel) return;
          refus.push(
            `${ou} : \`posthog.capture(…)\` écrit DIRECTEMENT — les événements passent ` +
              `par \`trackFunnel\` (src/utils/funnel.js), sinon la liste blanche des clés ` +
              `est contournée chez le second fournisseur.`
          );
          return;
        }

        if (callee.type !== 'Identifier' || !lieux.appels.has(callee.name)) return;

        appels += 1;

        const premier = noeud.arguments?.[0];
        let nom = evenementParCle(premier, lieux, evenements);

        if (nom === undefined && premier?.type === 'StringLiteral' && nomsDeclares.has(premier.value)) {
          nom = premier.value;
        }

        if (nom === undefined) {
          const cleInconnue =
            premier?.type === 'MemberExpression' &&
            !premier.computed &&
            lieux.evenements.has(premier.object?.name)
              ? premier.property?.name
              : null;
          const lisible =
            cleInconnue !== null
              ? `la clé « ${cleInconnue} » n'existe pas dans EVENEMENTS_FUNNEL`
              : premier?.type === 'StringLiteral'
                ? `« ${premier.value} » n'est pas dans EVENEMENTS_FUNNEL`
                : premier === undefined
                  ? 'aucun nom d’événement'
                  : 'nom d’événement calculé (non lisible)';
          refus.push(
            `${ou} : \`${callee.name}(…)\` — ${lisible}. Une étape non déclarée ne part pas ` +
              `(le filtre la refuse) et le rapport la lirait comme absente.`
          );
          return;
        }

        emetteurs.set(nom, (emetteurs.get(nom) || 0) + 1);

        const parametres = noeud.arguments?.[1];
        if (parametres === undefined) return;

        if (parametres.type !== 'ObjectExpression') {
          refus.push(
            `${ou} : paramètres de \`${nom}\` non littéraux — les clés ne sont pas lisibles, ` +
              `donc rien ne prouve qu'aucune n'est un identifiant. Écrire l'objet en clair.`
          );
          return;
        }

        for (const propriete of parametres.properties) {
          const cle = cleDePropriete(propriete);
          if (cle === null) {
            refus.push(
              `${ou} : paramètre de \`${nom}\` dont la clé est un \`spread\` ou est calculée — ` +
                `une clé illisible peut porter un email.`
            );
            continue;
          }
          if (!Object.prototype.hasOwnProperty.call(cles, cle)) {
            refus.push(
              `${ou} : clé « ${cle} » absente de CLES_FUNNEL — elle serait écartée en silence ` +
                `(dimension perdue) ou, si elle y entrait un jour, publiée sans bornage.`
            );
          }
        }
      },
    });
  }

  const fichiers = Object.keys(sources).length;
  if (fichiers < planchers.fichiers) {
    refus.push(
      `${fichiers} fichier(s) lu(s) sous le plancher ${planchers.fichiers} — le balayage ` +
        `n'a pas vu le corpus, il ne prouve rien.`
    );
  }
  if (appels < planchers.appels) {
    refus.push(
      `${appels} appel(s) à \`trackFunnel\` sous le plancher ${planchers.appels} — ` +
        `les étapes ne sont plus émises, ou l'analyse ne les voit plus.`
    );
  }

  for (const [cle, nom] of Object.entries(evenements)) {
    if ((emetteurs.get(nom) || 0) === 0) {
      refus.push(
        `étape « ${cle} » (${nom}) déclarée SANS AUCUN ÉMETTEUR dans src/ — ` +
          `une étape que rien n'émet se lit comme mesurée alors qu'elle n'existe plus.`
      );
    }
  }

  return {
    refus,
    lues: { fichiers, appels, emetteurs: Object.fromEntries(emetteurs) },
  };
}

/** Le verdict complet sur l'arbre réel. */
export function verifierFunnel({ racine = SRC } = {}) {
  const fichiers = fichiersSources(racine);
  const sources = lireLesSources(racine, fichiers);
  return { ...auditerSources(sources), fichiers };
}

const estAppelDirect =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (estAppelDirect) {
  const { refus, lues, fichiers } = verifierFunnel();

  console.log(`Funnel GA4 — liste blanche des clés (${fichiers.length} fichier(s) lu(s)) :`);
  for (const [cle, nom] of Object.entries(EVENEMENTS_FUNNEL)) {
    console.log(`  ${nom.padEnd(20)} étape « ${cle} » — ${lues.emetteurs[nom] || 0} émetteur(s)`);
  }
  console.log(`  clés admises : ${Object.keys(CLES_FUNNEL).join(', ')}`);
  console.log(`  → ${lues.appels} appel(s), planchers ${JSON.stringify(PLANCHERS)}`);

  if (refus.length) {
    console.error(`\n❌ Funnel non tenu (${refus.length} refus) :`);
    for (const ligne of refus) console.error(`  • ${ligne}`);
    console.error(
      `\n   → corriger l'appel, ou déclarer la clé/l'étape dans src/utils/funnel.js. ` +
        `Un paramètre non déclaré est ÉCARTÉ à l'envoi : il ne part pas, et la dimension manque.`
    );
    process.exit(1);
  }

  console.log(
    `\n✅ ${lues.appels} émission(s) pour ${Object.keys(EVENEMENTS_FUNNEL).length} étape(s) : ` +
      `chaque étape a un émetteur, chaque clé est déclarée, aucun \`gtag('event')\` ne contourne le filtre.`
  );
}
