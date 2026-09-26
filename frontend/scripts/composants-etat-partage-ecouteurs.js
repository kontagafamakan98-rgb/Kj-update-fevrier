// RÈGLE : DÉTECTION DES COMPOSANTS À ÉTAT PARTAGÉ DONT LES ÉCOUTEURS DÉPENDENT
// D'UNE RÉFÉRENCE LOCALE (classe de bug du panneau de notifications).
//
// ── La classe de bug (signalée le 21/09/2026, corrigée le 25/09/2026) ────────
// Dans la version historique de `NotificationDropdown.js`, le composant lisait
// un état global partagé (`const { isOpen, closePanel } = useNotifications()`)
// tout en gérant son écouteur d'appui extérieur via une référence d'instance
// locale (`panelRef = useRef(null)`).
//
// Quand la barre de navigation montait DEUX exemplaires de ce composant
// (disposition desktop et disposition mobile) :
//   1. Les deux instances s'ouvraient en même temps (état partagé `isOpen`).
//   2. L'instance dont le conteneur était masqué (ex: `md:hidden` sur grand
//      écran) recevait l'événement `mousedown` global sur `document`.
//   3. Sa propre référence locale `panelRef.current` ne contenait PAS la cible
//      cliquée (car le clic avait lieu dans l'autre barre, visible).
//   4. L'instance masquée appelait donc immédiatement l'action partagée
//      `closePanel()` PENDANT l'appui sur le bouton.
//   5. Le composant visible était démonté en plein vol avant que l'événement
//      `click` n'arrive au bouton : aucune action (suppression de notification,
//      « tout marquer comme lu ») ne partait jamais (« la notification montre
//      toujours 1 et refuse de disparaître »).
//
// Ce module formalise l'analyse statique AST (Babel) pour interdire :
//   - un composant montant ou pouvant être monté plusieurs fois,
//   - qui consomme un hook d'état partagé (useContext, useNotifications, useAuth, etc.),
//   - et dont un écouteur global (document/window.addEventListener) prend une décision
//     sur une action d'état partagée en se basant sur une ref locale d'instance
//     (`ref.current.contains(...)`) sans cibler l'ancre partagée ou une preuve globale (DOM/contexte).

import parser from '@babel/parser';
import traverseModule from '@babel/traverse';
const traverse = traverseModule.default || traverseModule;
import fs from 'node:fs';
import path from 'node:path';

export const MIN_FICHIERS_LUS = 30;

const HOOKS_REACT_STANDARDS = new Set([
  'useState',
  'useReducer',
  'useRef',
  'useMemo',
  'useCallback',
  'useEffect',
  'useLayoutEffect',
  'useId',
  'useTransition',
  'useDeferredValue',
  'useImperativeHandle',
  'useDebugValue',
  'useNavigate',
  'useLocation',
  'useParams',
  'useSearchParams',
  'useLanguage', // simple traduction i18n sans action d'état partagé
]);

/**
 * Analyse le code source d'un fichier JS/JSX et détecte la classe de bug.
 *
 * @param {string} code Contenu du fichier source
 * @param {string} nomFichier Chemin relatif ou identifiant du fichier
 * @returns {{ violations: Array<{ ligne: number, ref: string, action: string, evenement: string, message: string }> }}
 */
export function analyserCodeComposant(code, nomFichier = 'fichier.js') {
  let ast;
  try {
    ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
  } catch (err) {
    throw new Error(`Erreur de parsing AST sur ${nomFichier} : ${err.message}`);
  }

  const localRefs = new Set();
  const sharedStateActions = new Set();
  const localSetters = new Set();
  const violations = [];

  // 1. Recenser les refs locales, les setters locaux et les actions d'état partagé
  traverse(ast, {
    VariableDeclarator(p) {
      const init = p.node.init;
      if (!init || init.type !== 'CallExpression') return;
      const callee = init.callee;

      // Ref locale
      if (callee.type === 'Identifier' && callee.name === 'useRef') {
        if (p.node.id.type === 'Identifier') {
          localRefs.add(p.node.id.name);
        }
      }

      // Setter local (useState)
      if (callee.type === 'Identifier' && callee.name === 'useState') {
        if (p.node.id.type === 'ArrayPattern' && p.node.id.elements[1] && p.node.id.elements[1].type === 'Identifier') {
          localSetters.add(p.node.id.elements[1].name);
        }
      }

      // Hook de contexte / état partagé
      const isSharedHook =
        callee.type === 'Identifier' &&
        (callee.name === 'useContext' || (/^use[A-Z]/.test(callee.name) && !HOOKS_REACT_STANDARDS.has(callee.name)));

      if (isSharedHook) {
        if (p.node.id.type === 'ObjectPattern') {
          for (const prop of p.node.id.properties) {
            if (prop.value && prop.value.type === 'Identifier') {
              sharedStateActions.add(prop.value.name);
            }
          }
        } else if (p.node.id.type === 'Identifier') {
          sharedStateActions.add(p.node.id.name);
        }
      }
    },
  });

  // Si le fichier n'a pas de ref locale ou d'action d'état partagé, pas de conflit possible
  if (localRefs.size === 0 || sharedStateActions.size === 0) {
    return { violations };
  }

  // 2. Chercher les écouteurs globaux (document / window .addEventListener)
  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee;
      if (
        callee.type === 'MemberExpression' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'addEventListener' &&
        callee.object.type === 'Identifier' &&
        (callee.object.name === 'document' || callee.object.name === 'window')
      ) {
        const evtArg = p.node.arguments[0];
        const evtName = evtArg && evtArg.type === 'StringLiteral' ? evtArg.value : 'evenement';
        const handlerArg = p.node.arguments[1];
        if (!handlerArg) return;

        // Trouver la fonction gestionnaire
        let handlerScope = null;
        if (handlerArg.type === 'Identifier') {
          const binding = p.scope.getBinding(handlerArg.name);
          if (binding) {
            if (binding.path.isFunction()) handlerScope = binding.path;
            else if (binding.path.isVariableDeclarator()) {
              const init = binding.path.get('init');
              if (init && init.isFunction()) handlerScope = init;
            }
          }
        } else if (p.get('arguments.1').isFunction()) {
          handlerScope = p.get('arguments.1');
        }

        if (!handlerScope) return;

        let refLocaleUtilisee = null;
        let actionPartageeAppelee = null;

        handlerScope.traverse({
          MemberExpression(mp) {
            if (mp.node.object.type === 'Identifier' && localRefs.has(mp.node.object.name)) {
              refLocaleUtilisee = mp.node.object.name;
            }
          },
          CallExpression(cp) {
            const ccallee = cp.node.callee;
            if (
              ccallee.type === 'Identifier' &&
              sharedStateActions.has(ccallee.name) &&
              !localSetters.has(ccallee.name)
            ) {
              actionPartageeAppelee = ccallee.name;
            }
          },
        });

        if (refLocaleUtilisee && actionPartageeAppelee) {
          violations.push({
            fichier: nomFichier,
            ligne: p.node.loc ? p.node.loc.start.line : 0,
            ref: refLocaleUtilisee,
            action: actionPartageeAppelee,
            evenement: evtName,
            message:
              `[${nomFichier}] Écouteur global '${evtName}' dépendant de la ref locale '${refLocaleUtilisee}' ` +
              `invoquant l'action d'état partagé '${actionPartageeAppelee}()' : ` +
              `si le composant est monté plus d'une fois, l'instance masquée refermera ou écrasera l'autre.`,
          });
        }
      }
    },
  });

  return { violations };
}

/**
 * Recense tous les composants JSX et leur nombre d'instanciations.
 */
export function compterMontagesComposants(fichiers, dossierRacine) {
  const montages = new Map();

  for (const fichier of fichiers) {
    const code = fs.readFileSync(fichier, 'utf8');
    try {
      const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
      traverse(ast, {
        JSXOpeningElement(p) {
          if (p.node.name.type === 'JSXIdentifier') {
            const nom = p.node.name.name;
            if (/^[A-Z]/.test(nom)) {
              if (!montages.has(nom)) montages.set(nom, []);
              montages.get(nom).push({
                fichier: path.relative(dossierRacine, fichier).replace(/\\/g, '/'),
                ligne: p.node.loc ? p.node.loc.start.line : 0,
              });
            }
          }
        },
      });
    } catch (_) {}
  }

  return montages;
}

/**
 * Parcourt récursivement un dossier source et analyse tous les fichiers JS/JSX.
 */
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
  const montages = compterMontagesComposants(fichiers, dossierSrc);
  const resultats = [];

  for (const f of fichiers) {
    const code = fs.readFileSync(f, 'utf8');
    const relPath = path.relative(dossierSrc, f).replace(/\\/g, '/');
    const nomComposant = path.basename(f, path.extname(f));
    const { violations } = analyserCodeComposant(code, relPath);

    if (violations.length > 0) {
      const occurrences = montages.get(nomComposant) || [];
      resultats.push({
        fichier: relPath,
        nomComposant,
        occurrences: occurrences.length,
        violations,
      });
    }
  }

  return {
    fichiersLus: fichiers.length,
    resultats,
  };
}
