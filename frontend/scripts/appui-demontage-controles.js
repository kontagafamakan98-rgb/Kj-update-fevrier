// RÈGLE : DÉTECTION DES CONTRÔLES INTERACTIFS QU'UN CHANGEMENT D'ÉTAT DÉCLENCHÉ
// PENDANT L'APPUI DÉMONTE AVANT QUE LE `click` N'ARRIVE (autre moitié de la
// classe de bug du panneau de notifications).
//
// ── La classe de bug (moitié « appui → démontage ») ──────────────────────────
// La première moitié (fermée par `composants-etat-partage-ecouteurs.js`) portait
// sur un écouteur GLOBAL dépendant d'une ref locale, monté plusieurs fois.
//
// La seconde moitié est plus générale : un contrôle interactif dont un
// changement d'état survient PENDANT l'appui et démonte l'élément appuyé avant
// que l'événement `click` ne parte. La séquence mesurée sur appareil tactile est
//
//     pointerdown → touchstart → touchend → mousedown → mouseup → click
//
// donc un `setState` dans `onMouseDown` / `onPointerDown` / `onTouchStart` qui
// retire l'élément pressé du DOM (fermeture d'une surface, bascule `!X`, retour
// anticipé `if (!open) return null`) supprime l'élément AVANT le `click` :
// l'action portée par `onClick` ne part jamais. C'est le symptôme « je clique et
// rien ne se passe » (ex. « la notification refuse de disparaître »).
//
// ── Ce que ce module interdit ────────────────────────────────────────────────
// Un contrôle interactif (bouton, lien, `<select>`, tout élément porteur d'un
// `onClick` ou d'un `role` interactif) qui
//   - a un gestionnaire d'appui (`onMouseDown`/`onPointerDown`/`onTouchStart`)
//     sur lui-même OU sur un ancêtre (l'appui remonte par bouillonnement), et
//   - ce gestionnaire écrit un état LOCAL (`useState`) qui gouverne le
//     démontage de ce contrôle : soit il apparaît dans le test d'un rendu
//     conditionnel (`{etat && …}`, `{etat ? … : …}`) ENCLOSANT le contrôle,
//     soit il apparaît dans un retour anticipé du composant
//     (`if (!etat) return null`).
//
// Le contrôle est alors démonté pendant l'appui : son `onClick` est perdu.
//
// ── Angles morts assumés ─────────────────────────────────────────────────────
//   - Seuls les setters `useState` locaux sont suivis : un handler qui ferme via
//     une prop (`onCancel?.()`) ou un contexte partagé n'est pas résolu ici
//     (l'analyse inter-fichiers n'est pas faite). La première moitié couvre le
//     cas du contexte partagé couplé à un écouteur global.
//   - L'appui est reconnu uniquement sur les trois props nommées ci-dessus ;
//     un `onPointerDown` construit dynamiquement (`{...props}`) échappe à la
//     règle.

import parser from '@babel/parser';
import traverseModule from '@babel/traverse';
const traverse = traverseModule.default || traverseModule;
import fs from 'node:fs';
import path from 'node:path';

// Plancher de lecture : en dessous, le garde refuse de juger.
export const MIN_FICHIERS_LUS = 30;
export const MIN_CONTROLES_ANALYSES = 100;

// Événements d'appui : ils précèdent le `click` et peuvent donc le supprimer.
export const EVENEMENTS_APPUI = new Set(['onMouseDown', 'onPointerDown', 'onTouchStart']);

const NOMS_CONTROLES_NATIFS = new Set(['button', 'a', 'select', 'input', 'textarea', 'summary']);
const ROLES_INTERACTIFS = new Set([
  'button',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'tab',
  'checkbox',
  'radio',
  'switch',
]);

/**
 * Vrai si l'élément JSX est un contrôle interactif au sens de la règle — c'est-à-dire
 * un élément dont une ACTION peut être perdue : un élément natif (`button`, `a`,
 * `select`…), un élément porteur d'un `onClick`, ou un élément à `role` interactif.
 *
 * Un élément qui ne porte QUE un gestionnaire d'appui n'est pas un contrôle : il n'a
 * pas d'action `click` à perdre. Il reste toutefois trouvé comme ancêtre porteur d'appui.
 */
function estControleInteractif(ouverture) {
  const nom = ouverture.name;
  if (nom && nom.type === 'JSXIdentifier' && NOMS_CONTROLES_NATIFS.has(nom.name)) {
    return true;
  }
  for (const attr of ouverture.attributes) {
    if (attr.type !== 'JSXAttribute' || attr.name.type !== 'JSXIdentifier') continue;
    const n = attr.name.name;
    if (n === 'onClick') return true;
    if (n === 'role' && attr.value && attr.value.type === 'StringLiteral' && ROLES_INTERACTIFS.has(attr.value.value)) {
      return true;
    }
  }
  return false;
}

/** Décrit le contrôle pour les messages (libellé lisible). */
function decrireControle(ouverture) {
  const nom = ouverture.name;
  if (nom && nom.type === 'JSXIdentifier') return `<${nom.name}>`;
  if (nom && nom.type === 'JSXMemberExpression') return `<composant>`;
  return '<élément>';
}

/** Collecte les identifiants libres référencés dans une expression de test. */
function identifiantsDe(noeud) {
  const noms = new Set();
  const visiter = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const e of n) visiter(e);
      return;
    }
    if (typeof n.type !== 'string') return;
    if (n.type === 'Identifier') {
      noms.add(n.name);
      return;
    }
    if (n.type === 'MemberExpression') {
      visiter(n.object);
      if (n.computed) visiter(n.property);
      return;
    }
    for (const cle of Object.keys(n)) {
      if (cle === 'loc' || cle === 'start' || cle === 'end' || cle === 'range') continue;
      const valeur = n[cle];
      if (valeur && typeof valeur === 'object') visiter(valeur);
    }
  };
  visiter(noeud);
  return noms;
}

/** Résout le chemin de la fonction gestionnaire d'une prop JSX. */
function resoudreHandler(attrPath) {
  const valeur = attrPath.node.value;
  if (!valeur) return null;
  if (valeur.type === 'JSXExpressionContainer') {
    const exprPath = attrPath.get('value.expression');
    if (exprPath.isFunction()) return exprPath;
    if (exprPath.isIdentifier()) {
      const binding = attrPath.scope.getBinding(exprPath.node.name);
      if (binding) {
        if (binding.path.isFunction()) return binding.path;
        if (binding.path.isVariableDeclarator()) {
          const init = binding.path.get('init');
          if (init && init.isFunction()) return init;
        }
      }
    }
  }
  return null;
}

/**
 * Recense les états locaux écrits par un gestionnaire d'appui, en suivant les
 * appels à des fonctions locales du composant (un niveau de plus par fonction).
 */
function etatsEcritsParHandler(handlerPath, etatsMap, vus = new Set()) {
  const etats = new Set();
  handlerPath.traverse({
    CallExpression(cp) {
      const callee = cp.node.callee;
      if (callee.type !== 'Identifier') return;
      if (etatsMap.has(callee.name)) {
        etats.add(etatsMap.get(callee.name));
        return;
      }
      if (vus.has(callee.name)) return;
      const binding = cp.scope.getBinding(callee.name);
      if (!binding) return;
      let fn = null;
      if (binding.path.isFunction()) fn = binding.path;
      else if (binding.path.isVariableDeclarator()) {
        const init = binding.path.get('init');
        if (init && init.isFunction()) fn = init;
      }
      if (!fn) return;
      vus.add(callee.name);
      for (const e of etatsEcritsParHandler(fn, etatsMap, vus)) etats.add(e);
    },
  });
  return etats;
}

/** Analyse un composant (fonction) et renvoie ses violations. */
function analyserComposant(fnPath, nomComposant, nomFichier) {
  const violations = [];
  let controlesAnalyses = 0;

  // 1. Apparier setters et états locaux des `useState`.
  const etatsMap = new Map(); // setter -> état
  const nomsEtats = new Set();
  fnPath.traverse({
    VariableDeclarator(p) {
      const init = p.node.init;
      if (
        init &&
        init.type === 'CallExpression' &&
        init.callee.type === 'Identifier' &&
        init.callee.name === 'useState' &&
        p.node.id.type === 'ArrayPattern'
      ) {
        const [premier, second] = p.node.id.elements;
        if (premier && premier.type === 'Identifier' && second && second.type === 'Identifier') {
          etatsMap.set(second.name, premier.name);
          nomsEtats.add(premier.name);
        }
      }
    },
  });

  // 2. Retours anticipés du corps du composant (`if (!etat) return null`).
  const etatsRetourAnticipe = new Set();
  fnPath.traverse({
    IfStatement(p) {
      // Uniquement les gardes de premier niveau du composant.
      if (!fnPath.node.body || p.parentPath.node !== fnPath.node.body) return;
      const consequent = p.node.consequent;
      const retourne =
        consequent.type === 'ReturnStatement' ||
        (consequent.type === 'BlockStatement' && consequent.body.some((s) => s.type === 'ReturnStatement'));
      if (!retourne) return;
      for (const id of identifiantsDe(p.node.test)) {
        if (nomsEtats.has(id)) etatsRetourAnticipe.add(id);
      }
    },
  });

  // 3. Recenser les gestionnaires d'appui et les états locaux qu'ils écrivent.
  const handlersParElement = new Map(); // JSXOpeningElement -> [{ evenement, etats, ligne }]
  fnPath.traverse({
    JSXAttribute(p) {
      const nom = p.node.name && p.node.name.type === 'JSXIdentifier' ? p.node.name.name : null;
      if (!nom || !EVENEMENTS_APPUI.has(nom)) return;
      const handler = resoudreHandler(p);
      if (!handler) return;
      const etats = etatsEcritsParHandler(handler, etatsMap);
      if (etats.size === 0) return;
      const ouverture = p.parentPath.node; // JSXOpeningElement
      if (!handlersParElement.has(ouverture)) handlersParElement.set(ouverture, []);
      handlersParElement.get(ouverture).push({
        evenement: nom,
        etats,
        ligne: p.node.loc ? p.node.loc.start.line : 0,
      });
    },
  });

  // 4. Balayer tous les contrôles interactifs et confronter appui et démontage.
  //    Ce balayage a lieu même sans gestionnaire d'appui : il compte les contrôles
  //    (preuve que le sujet a été lu) avant de statuer sur une violation.
  fnPath.traverse({
    JSXElement(p) {
      if (!estControleInteractif(p.node.openingElement)) return;
      controlesAnalyses += 1;

      // États écrits par un gestionnaire d'appui porté par ce contrôle ou un ancêtre.
      const etatsAppui = new Set();
      let evenement = null;
      let ligneAppui = 0;
      let ancetre = p;
      while (ancetre) {
        if (ancetre.isJSXElement()) {
          const infos = handlersParElement.get(ancetre.node.openingElement);
          if (infos) {
            for (const info of infos) {
              if (!evenement) evenement = info.evenement;
              if (!ligneAppui) ligneAppui = info.ligne;
              for (const e of info.etats) etatsAppui.add(e);
            }
          }
        }
        ancetre = ancetre.parentPath;
      }
      if (etatsAppui.size === 0) return;

      // États qui gouvernent le démontage de ce contrôle.
      const etatsFermants = new Set(etatsRetourAnticipe);
      let courant = p;
      while (courant) {
        const parent = courant.parentPath;
        if (!parent) break;
        if (parent.isLogicalExpression()) {
          for (const id of identifiantsDe(parent.node.left)) etatsFermants.add(id);
        } else if (parent.isConditionalExpression()) {
          for (const id of identifiantsDe(parent.node.test)) etatsFermants.add(id);
        }
        courant = parent;
      }

      for (const etat of etatsAppui) {
        if (!etatsFermants.has(etat)) continue;
        violations.push({
          fichier: nomFichier,
          composant: nomComposant,
          controle: decrireControle(p.node.openingElement),
          ligne: p.node.loc ? p.node.loc.start.line : 0,
          evenement,
          ligneAppui,
          etat,
          message:
            `[${nomFichier}] <${nomComposant}> : le contrôle ${decrireControle(p.node.openingElement)} ` +
            `(ligne ${p.node.loc ? p.node.loc.start.line : 0}) est démonté PENDANT l'appui — ` +
            `son gestionnaire '${evenement}' écrit l'état local '${etat}' qui conditionne son rendu ` +
            `(rendu conditionnel ou retour anticipé), supprimant l'événement 'click' avant qu'il ne parte.`,
        });
        break; // un seul signalement par contrôle
      }
    },
  });

  return { violations, controlesAnalyses };
}

/** Vrai si la fonction est déclarée au niveau du module (pas imbriquée). */
function estAuNiveauModule(p) {
  let courant = p.parentPath;
  while (courant) {
    if (courant.isProgram()) return true;
    if (
      courant.isExportNamedDeclaration() ||
      courant.isExportDefaultDeclaration() ||
      courant.isVariableDeclaration()
    ) {
      courant = courant.parentPath;
      continue;
    }
    return false;
  }
  return false;
}

/**
 * Analyse le code source d'un fichier JS/JSX et détecte la classe de bug.
 *
 * @param {string} code Contenu du fichier source
 * @param {string} nomFichier Chemin relatif ou identifiant du fichier
 * @returns {{ violations: Array<object>, controlesAnalyses: number }}
 */
export function analyserCodeComposant(code, nomFichier = 'fichier.js') {
  let ast;
  try {
    ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
  } catch (err) {
    throw new Error(`Erreur de parsing AST sur ${nomFichier} : ${err.message}`);
  }

  const composants = [];
  traverse(ast, {
    FunctionDeclaration(p) {
      if (p.node.id && /^[A-Z]/.test(p.node.id.name) && estAuNiveauModule(p)) {
        composants.push({ path: p, nom: p.node.id.name });
      }
    },
    VariableDeclarator(p) {
      const init = p.node.init;
      if (
        init &&
        (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') &&
        p.node.id.type === 'Identifier' &&
        /^[A-Z]/.test(p.node.id.name) &&
        estAuNiveauModule(p)
      ) {
        composants.push({ path: p.get('init'), nom: p.node.id.name });
      }
    },
  });

  const violations = [];
  let controlesAnalyses = 0;

  for (const composant of composants) {
    const resultat = analyserComposant(composant.path, composant.nom, nomFichier);
    violations.push(...resultat.violations);
    controlesAnalyses += resultat.controlesAnalyses;
  }

  return { violations, controlesAnalyses };
}

/**
 * Compte les contrôles interactifs d'un code source (pour prouver que le sujet
 * a été lu, indépendamment des violations).
 */
export function compterControlesInteractifs(code) {
  let ast;
  try {
    ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
  } catch (_) {
    return 0;
  }
  let total = 0;
  traverse(ast, {
    JSXElement(p) {
      if (estControleInteractif(p.node.openingElement)) total += 1;
    },
  });
  return total;
}

/** Parcourt récursivement un dossier source et analyse tous les fichiers JS/JSX. */
export function analyserDossierSource(dossierSrc) {
  const fichiers = [];
  const parcourir = (courant) => {
    for (const entree of fs.readdirSync(courant, { withFileTypes: true })) {
      const complet = path.join(courant, entree.name);
      if (entree.isDirectory()) {
        if (entree.name === '__tests__') continue;
        parcourir(complet);
      } else if (/\.(js|jsx)$/.test(entree.name) && entree.name !== 'setupTests.js') {
        fichiers.push(complet);
      }
    }
  };

  parcourir(dossierSrc);

  const resultats = [];
  let controlesAnalyses = 0;

  for (const f of fichiers) {
    const code = fs.readFileSync(f, 'utf8');
    const relPath = path.relative(dossierSrc, f).replace(/\\/g, '/');
    const { violations, controlesAnalyses: controles } = analyserCodeComposant(code, relPath);
    controlesAnalyses += controles;

    if (violations.length > 0) {
      resultats.push({
        fichier: relPath,
        nomComposant: path.basename(f, path.extname(f)),
        violations,
      });
    }
  }

  return { fichiersLus: fichiers.length, controlesAnalyses, resultats };
}
