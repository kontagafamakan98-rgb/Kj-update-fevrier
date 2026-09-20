// Audit statique de la classe de bug TDZ (référence de variable AVANT sa
// déclaration const/let dans le même scope) — comme le bug AuthContext
// « loadUserRef.current = loadUser » avant `const loadUser`, ou le tableau lu par
// les cartes de l'accueil avant sa déclaration (page blanche, attrapée par
// l'ErrorBoundary).
//
// Deux classifications :
//   * DIRECT = référence dans le MÊME scope avant la déclaration (TDZ certain).
//     C'est un ROUGE : le build n'a aucune raison de publier un fichier où une
//     constante est lue avant d'exister, même si le chemin n'est atteint qu'au
//     clic de l'utilisateur.
//   * NESTED = référence dans une fonction imbriquée située avant la
//     déclaration (TDZ seulement si cette fonction est invoquée avant l'init).
//     Informative : un useEffect/useCallback s'exécute après le rendu, donc
//     l'ordre du fichier n'y prouve rien.
//
// La logique est dans `analyserLeCode` (pure, sans disque) et le parcours du
// dépôt dans `analyserLeDepot` : la capacité de refus est donc exerçable par un
// test sur une source synthétique, pas seulement sur l'arbre réel.
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// `KOJO_TDZ_DIR` permet d'auditer un arbre de fixture : la capacité de refus du
// script (code de sortie 1) s'exerce donc sur des sources connues, pas
// seulement sur l'arbre réel qui est propre — même convention que
// audit_api_returns.cjs.
const RACINE = process.env.KOJO_TDZ_DIR
  ? path.resolve(process.env.KOJO_TDZ_DIR)
  : path.join(__dirname, '..', 'src');

function analyserLeCode(code, fichier) {
  const direct = [];
  const nested = [];
  let ast;
  try {
    ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
  } catch (e) {
    return { direct, nested, erreurAnalyse: `${fichier}: ${e.message.split('\n')[0]}` };
  }

  const bindings = [];
  traverse(ast, {
    Scope(chemin) {
      const scope = chemin.scope;
      const funcNode = chemin.node;
      for (const name of Object.keys(scope.bindings)) {
        const b = scope.bindings[name];
        if (b.kind !== 'let' && b.kind !== 'const') continue;
        bindings.push({ b, funcNode });
      }
    },
  });

  for (const { b, funcNode } of bindings) {
    const declStart = b.path.node.start;
    for (const refPath of b.referencePaths) {
      const refStart = refPath.node.start;
      if (refStart === undefined || refStart >= declStart) continue;

      // Faux positif : la référence EST la déclaration elle-même (export const X
      // compté par Babel comme référence sur la même ligne).
      if (refPath.node.loc.start.line === b.path.node.loc.start.line) continue;

      // Remonte jusqu'à la fonction contenant la référence.
      let refFunc = refPath;
      while (refFunc && !refFunc.isFunction()) refFunc = refFunc.parentPath;
      const sameFunc = refFunc && refFunc.node === funcNode;

      // Nom/type de la fonction imbriquée contenant la référence (useEffect,
      // useMemo, useCallback, gestionnaire d'événement, .map() du JSX...).
      let host = '';
      if (refFunc && !sameFunc) {
        const p = refFunc.parentPath;
        if (p) {
          if (p.isCallExpression()) {
            const callee = p.node.callee;
            host = callee.type === 'Identifier' ? callee.name : 'callExpr';
            if (p.node.arguments.some((a) => a && a.type === 'JSXElement' && a.start === refFunc.node.start)) host = 'renderProp';
          } else if (p.isJSXExpressionContainer()) {
            host = 'jsxExpr';
          }
        }
        const name = refFunc.node.id ? refFunc.node.id.name : '';
        host = host ? `${host}${name ? `/${name}` : ''}` : (name || 'anon');
      }

      const entry = {
        file: fichier,
        binding: b.identifier.name,
        declLine: b.path.node.loc.start.line,
        refLine: refPath.node.loc.start.line,
        host,
        snippet: String(refPath.toString()).slice(0, 60),
      };
      if (sameFunc) direct.push(entry);
      else nested.push(entry);
    }
  }
  return { direct, nested, erreurAnalyse: null };
}

function dedupe(arr) {
  const seen = new Set();
  return arr.filter((e) => {
    const k = `${e.file}|${e.binding}|${e.declLine}|${e.refLine}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function analyserLeDepot(racine = RACINE) {
  const direct = [];
  const nested = [];
  const erreurs = [];
  const fichiers = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry.name)) fichiers.push(full);
    }
  };
  walk(racine);

  for (const fichier of fichiers) {
    const res = analyserLeCode(fs.readFileSync(fichier, 'utf8'), path.relative(racine, fichier));
    if (res.erreurAnalyse) erreurs.push(res.erreurAnalyse);
    direct.push(...res.direct);
    nested.push(...res.nested);
  }
  return {
    direct: dedupe(direct).sort((a, b) => a.file.localeCompare(b.file) || a.declLine - b.declLine),
    nested: dedupe(nested).sort((a, b) => a.file.localeCompare(b.file) || a.declLine - b.declLine),
    erreurs,
  };
}

module.exports = { analyserLeCode, analyserLeDepot, RACINE };

if (require.main === module) {
  const { direct, nested, erreurs } = analyserLeDepot();

  for (const e of erreurs) console.log(`PARSE ERROR ${e}`);

  console.log(`\n===== DIRECT (TDZ certain — référence avant déclaration, même scope) : ${direct.length} =====`);
  for (const e of direct) {
    console.log(`${e.file}:${e.refLine}  '${e.binding}' utilisé (ligne ${e.refLine}) avant déclaration (ligne ${e.declLine}) : ${e.snippet}`);
  }

  // Regroupement des NESTED par hôte d'invocation. Un callback exécuté PENDANT le
  // rendu (useMemo/useState init/renderProp/.map du JSX) est un TDZ réel ; un
  // useEffect/useCallback/gestionnaire différé est sûr (const initialisée avant).
  const byHost = {};
  for (const e of nested) {
    (byHost[e.host] = byHost[e.host] || []).push(e);
  }

  console.log(`\n===== NESTED (potentiel — référence dans fonction imbriquée avant la déclaration) : ${nested.length} =====`);
  console.log("--- Par hôte d'invocation ---");
  for (const host of Object.keys(byHost).sort((a, b) => byHost[b].length - byHost[a].length)) {
    console.log(`\n[${host}] ×${byHost[host].length}`);
    for (const e of byHost[host]) {
      console.log(`  ${e.file}:${e.refLine}  '${e.binding}' (décl. l.${e.declLine}) : ${e.snippet}`);
    }
  }

  // Le seul verdict bloquant : une référence avant déclaration dans le MÊME
  // scope est un TDZ certain, donc un fichier que le dépôt ne publie pas.
  process.exit(direct.length ? 1 : 0);
}
