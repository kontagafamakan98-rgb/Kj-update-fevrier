// Audit statique de la classe de bug TDZ (référence de variable AVANT sa
// déclaration const/let dans le même scope) — comme le bug AuthContext
// « loadUserRef.current = loadUser » avant `const loadUser`.
// Direct = référence dans le MÊME scope avant la déclaration (TDZ certain).
// Nested = référence dans une fonction imbriquée située avant la déclaration
// (TDZ seulement si cette fonction est invoquée avant l'init).
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const ROOT = path.join(__dirname, '..', 'src');
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|jsx)$/.test(entry.name)) files.push(full);
  }
}
walk(ROOT);

const direct = [];
const nested = [];

for (const file of files) {
  let ast;
  try {
    const code = fs.readFileSync(file, 'utf8');
    ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
  } catch (e) {
    console.log(`PARSE ERROR ${file}: ${e.message.split('\n')[0]}`);
    continue;
  }

  const bindings = [];
  traverse(ast, {
    Scope(path) {
      const scope = path.scope;
      const funcNode = path.node;
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

      const declLine = b.path.node.loc.start.line;
      const refLine = refPath.node.loc.start.line;
      const snippet = String(refPath.toString()).slice(0, 60);
      const entry = {
        file: path.relative(ROOT, file),
        binding: b.identifier.name,
        declLine,
        refLine,
        host,
        snippet,
      };
      if (sameFunc) direct.push(entry);
      else nested.push(entry);
    }
  }
}

// Dé-duplication
const dedupe = (arr) => {
  const seen = new Set();
  return arr.filter((e) => {
    const k = `${e.file}|${e.binding}|${e.declLine}|${e.refLine}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const d = dedupe(direct).sort((a, b) => a.file.localeCompare(b.file) || a.declLine - b.declLine);
const n = dedupe(nested).sort((a, b) => a.file.localeCompare(b.file) || a.declLine - b.declLine);

console.log(`\n===== DIRECT (TDZ certain — référence avant déclaration, même scope) : ${d.length} =====`);
for (const e of d) {
  console.log(`${e.file}:${e.refLine}  '${e.binding}' utilisé (ligne ${e.refLine}) avant déclaration (ligne ${e.declLine}) : ${e.snippet}`);
}

// Regroupement des NESTED par hôte d'invocation. Un callback exécuté PENDANT le
// rendu (useMemo/useState init/renderProp/.map du JSX) est un TDZ réel ; un
// useEffect/useCallback/gestionnaire différé est sûr (const initialisée avant).
const byHost = {};
for (const e of n) {
  (byHost[e.host] = byHost[e.host] || []).push(e);
}

console.log(`\n===== NESTED (potentiel — référence dans fonction imbriquée avant la déclaration) : ${n.length} =====`);
console.log('--- Par hôte d\'invocation ---');
for (const host of Object.keys(byHost).sort((a, b) => byHost[b].length - byHost[a].length)) {
  console.log(`\n[${host}] ×${byHost[host].length}`);
  for (const e of byHost[host]) {
    console.log(`  ${e.file}:${e.refLine}  '${e.binding}' (décl. l.${e.declLine}) : ${e.snippet}`);
  }
}
