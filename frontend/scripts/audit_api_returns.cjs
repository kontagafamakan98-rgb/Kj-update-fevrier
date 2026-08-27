#!/usr/bin/env node
/**
 * Audit des RETOURS des services frontend — garde-fou CI.
 *
 * Deux vérifications, miroir frontend de backend/scripts/audit_docstrings.py :
 *
 * 1. CONTRAT (endpoint + verbe HTTP) : chaque appel `api.<verbe>('/chemin')`
 *    dans src/services/*.js doit correspondre à une route RÉELLE du backend
 *    (verbe identique, chemin avec les mêmes segments statiques). Un endpoint
 *    supprimé/renommé, un verbe erroné ou une faute de frappe → échec CI.
 *    Le verbe est comparé aux verbes AUTORISÉS : pour @router.<verbe> c'est le
 *    verbe du décorateur, pour @app.api_route c'est la liste explicite
 *    `methods=[...]` — un appel frontend avec un verbe hors liste échoue
 *    même si le chemin existe (« verbe non autorisé »).
 *    Les routes backend sont lues depuis ../backend/kojo_routers_*.py et
 *    ../backend/server.py (décorateurs @router.<verbe> / @app.api_route).
 *
 * 2. DOCUMENTATION (@returns) : chaque méthode des objets API exportés de
 *    src/services/api.js (authAPI, jobsAPI, messagesAPI, paymentAPI,
 *    usersAPI, workerProfileAPI, notificationAPI, reviewAPI, supportAPI,
 *    messageAPI, geolocationAPI, publicAPI, api) doit porter un bloc JSDoc
 *    contenant @returns — la forme de retour est documentée, comme la
 *    section « Returns: » exigée côté backend.
 *
 * Routes HORS PÉRIMÈTRE : les appels vers les endpoints d'infra
 * (/monitor/*, /health, /favicon.ico) dont la « forme de retour » est un
 * statut HTTP échouent le CONTRAT en WARNING (non bloquant) — cohérent avec
 * le backend (audit_docstrings.py utilise les mêmes préfixes). En mode
 * strict --fail-on-warning (CI), ces warnings deviennent bloquants.
 *
 * Usage (depuis frontend/) :
 *    node scripts/audit_api_returns.cjs                  # défaut
 *    node scripts/audit_api_returns.cjs --fail-on-warning # strict (CI)
 *
 * Sortie : exit 0 si conforme, exit 1 sinon (détail pour la CI).
 */

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// Répertoires audités. Surchargeables par env pour les TESTS (fixtures
// temporaires) : KOJO_AUDIT_SERVICES_DIR / KOJO_AUDIT_BACKEND_DIR.
const SERVICES_DIR = process.env.KOJO_AUDIT_SERVICES_DIR
  || path.join(__dirname, '..', 'src', 'services');
const BACKEND_DIR = process.env.KOJO_AUDIT_BACKEND_DIR
  || path.join(__dirname, '..', '..', 'backend');
const VERBS = ['get', 'post', 'put', 'patch', 'delete'];

// Routes HORS PÉRIMÈTRE : endpoints d'infra (sondes 200/503, health check,
// favicon 204) dont la « forme de retour » est un statut HTTP, pas un contrat
// métier. Un appel frontend vers ces chemins qui échoue le CONTRAT est un
// WARNING (non bloquant), pas une erreur — cohérent avec le backend
// (audit_docstrings.py utilise les mêmes préfixes).
const OUT_OF_SCOPE_PREFIXES = ['/monitor', '/health', '/favicon.ico'];

const FAIL_ON_WARNING = '--fail-on-warning';

function isOutOfScopePath(p) {
  return OUT_OF_SCOPE_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + '/'));
}

// ---------------------------------------------------------------------------
// 1) Routes backend : (verbe, chemin) depuis les décorateurs FastAPI
// ---------------------------------------------------------------------------

function collectBackendRoutes() {
  // routes : "VERBE /path" -> loc (exact matches)
  // paths  : "/path" -> { verbs: Set, loc } (index par chemin, pour
  //          distinguer « verbe non autorisé » de « route introuvable »)
  const routes = new Map();
  const paths = new Map();
  const files = fs
    .readdirSync(BACKEND_DIR)
    .filter((f) => f.endsWith('.py') && (f.startsWith('kojo_routers_') || f === 'server.py'));

  // Décorateurs à verbe implicite : @router.get("/path") / @app.get("/path").
  const decoratorRe = /@(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/g;
  // api_route à méthodes EXPLICITES : @app.api_route("/path", methods=["GET", "HEAD"]).
  const apiRouteRe = /@app\.api_route\s*\(\s*["']([^"']+)["'][\s\S]*?methods\s*=\s*\[([^\]]+)\]/g;

  for (const file of files) {
    const src = fs.readFileSync(path.join(BACKEND_DIR, file), 'utf8');

    let m;
    decoratorRe.lastIndex = 0;
    while ((m = decoratorRe.exec(src)) !== null) {
      const verb = m[1].toUpperCase();
      const p = normalizeBackendPath(m[2]);
      const loc = `${file}:${lineOf(src, m.index)}`;
      routes.set(`${verb} ${p}`, loc);
      registerPath(paths, p, verb, loc);
    }

    // @app.api_route("/path", methods=["GET", "HEAD"]) — server.py : chaque
    // verbe de `methods` est autorisé ; un verbe frontend hors de cette liste
    // doit faire échouer l'audit même si le chemin existe.
    apiRouteRe.lastIndex = 0;
    while ((m = apiRouteRe.exec(src)) !== null) {
      const p = normalizeBackendPath(m[1]);
      const loc = `${file}:${lineOf(src, m.index)}`;
      const verbs = [...m[2].matchAll(/"(\w+)"/g)].map((x) => x[1].toUpperCase());
      for (const verb of verbs) {
        routes.set(`${verb} ${p}`, loc);
        registerPath(paths, p, verb, loc);
      }
    }
  }
  return { routes, paths };
}

function registerPath(paths, p, verb, loc) {
  if (!paths.has(p)) paths.set(p, { verbs: new Set(), loc });
  paths.get(p).verbs.add(verb);
}

function normalizeBackendPath(p) {
  // /jobs/{job_id} -> /jobs/{p}
  return p.replace(/\{[^}]+\}/g, '{p}').replace(/\/+$/, '');
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

// ---------------------------------------------------------------------------
// 2) Appels frontend : api.<verbe>(chemin) dans src/services/*.js
// ---------------------------------------------------------------------------

function collectFrontendCalls() {
  const calls = [];
  const files = fs.readdirSync(SERVICES_DIR).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

  for (const file of files) {
    const src = fs.readFileSync(path.join(SERVICES_DIR, file), 'utf8');
    let ast;
    try {
      ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
    } catch (e) {
      calls.push({ error: `Erreur de parsing ${file}: ${e.message}` });
      continue;
    }
    traverse(ast, {
      CallExpression(p) {
        const callee = p.node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        const obj = callee.object;
        if (!obj || obj.type !== 'Identifier' || obj.name !== 'api') return;
        const verb = callee.property.name;
        if (!VERBS.includes(verb) && verb !== 'uploadFile') return;
        const arg = p.node.arguments[0];
        let rawPath = null;
        if (arg && arg.type === 'StringLiteral') {
          rawPath = arg.value;
        } else if (arg && arg.type === 'TemplateLiteral' && arg.expressions.length > 0) {
          rawPath = arg.quasis.map((q) => q.value.raw).join('{p}');
        }
        if (rawPath === null || rawPath === undefined) return;
        // Chemins dynamiques (createResourceApi : `${basePath}/${id}`) — le
        // préfixe est une variable, non résoluble statiquement : on saute,
        // mais on compte pour le rapport.
        if (rawPath.startsWith('{p}/') || rawPath === '{p}') {
          calls.push({ dynamic: true, verb: verb.toUpperCase(), rawPath });
          return;
        }
        calls.push({
          verb: verb === 'uploadFile' ? 'POST' : verb.toUpperCase(),
          path: normalizeFrontendPath(rawPath),
          rawPath,
          loc: `${file}:${p.node.loc.start.line}`,
        });
      },
    });
  }
  return calls;
}

function normalizeFrontendPath(p) {
  // /jobs/${id} -> /jobs/{p}
  return p.replace(/\$\{[^}]+\}/g, '{p}').replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// 3) Documentation @returns sur les objets API exportés d'api.js
// ---------------------------------------------------------------------------

function countApiMethods() {
  // Total de méthodes dans les objets API exportés d'api.js.
  const file = path.join(SERVICES_DIR, 'api.js');
  if (!fs.existsSync(file)) return 0; // fixtures de test sans api.js
  const src = fs.readFileSync(file, 'utf8');
  const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
  let count = 0;
  traverse(ast, {
    ObjectMethod(p) { countIfExported(p); },
    ObjectProperty(p) {
      if (p.node.value.type === 'ArrowFunctionExpression' || p.node.value.type === 'FunctionExpression') countIfExported(p);
    },
  });
  function countIfExported(p) {
    let parent = p.parentPath;
    while (parent && !parent.isProgram()) {
      if (parent.isVariableDeclarator()) {
        const id = parent.node.id;
        if (id && id.type === 'Identifier' && /API$|^api$/.test(id.name)) count += 1;
        break;
      }
      parent = parent.parentPath;
    }
  }
  return count;
}

function countClassMethods() {
  let count = 0;
  for (const file of CLASS_SERVICE_FILES) {
    const full = path.join(SERVICES_DIR, file);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
    traverse(ast, {
      ClassMethod(p) {
        const key = p.node.key.name || p.node.key.value;
        if (!key || key === 'constructor' || String(key).startsWith('_')) return;
        count += 1;
      },
    });
  }
  return count;
}

function collectMissingJSDoc() {
  const file = path.join(SERVICES_DIR, 'api.js');
  if (!fs.existsSync(file)) return []; // fixtures de test sans api.js
  const src = fs.readFileSync(file, 'utf8');
  const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
  const missing = [];

  traverse(ast, {
    ObjectMethod(p) { checkMethod(p); },
    ObjectProperty(p) {
      if (p.node.value.type === 'ArrowFunctionExpression' || p.node.value.type === 'FunctionExpression') checkMethod(p);
    },
  });

  function checkMethod(p) {
    // Seulement dans les objets API exportés (const xxxAPI = {...}).
    let parent = p.parentPath;
    let exported = false;
    while (parent && !parent.isProgram()) {
      if (parent.isVariableDeclarator()) {
        const id = parent.node.id;
        if (id && id.type === 'Identifier' && /API$|^api$/.test(id.name)) {
          exported = true;
        }
        break;
      }
      parent = parent.parentPath;
    }
    if (!exported) return;

    const key = p.node.key.name || p.node.key.value || '(?)';
    const comments = p.node.leadingComments || [];
    const hasJSDocReturns = comments.some(
      (c) => c.type === 'CommentBlock' && c.value.includes('@returns')
    );
    if (!hasJSDocReturns) {
      missing.push({ key, line: p.node.loc.start.line });
    }
  }

  return missing;
}

// ---------------------------------------------------------------------------
// 3bis) Documentation @returns sur les méthodes publiques des services en
// classe (ownerService, paymentAccountService, commissionService — instances
// exportées par défaut). Les méthodes privées (préfixe _) et le constructeur
// sont exclus : seule la surface publique est le contrat de retour.
// ---------------------------------------------------------------------------

const CLASS_SERVICE_FILES = [
  'ownerService.js',
  'paymentAccountService.js',
  'commissionService.js',
  'ProfilePhotoService.js',
];

// Fichiers dont les EXPORTS NOMMÉS de fonctions (pas les constantes de
// données) doivent documenter leur retour (@returns).
const NAMED_EXPORT_FILES = ['geolocationService.js'];

function isFunctionNode(node) {
  return node
    && (node.type === 'ArrowFunctionExpression'
      || node.type === 'FunctionExpression'
      || node.type === 'FunctionDeclaration');
}

function countNamedExports() {
  let count = 0;
  for (const file of NAMED_EXPORT_FILES) {
    const full = path.join(SERVICES_DIR, file);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
    traverse(ast, {
      ExportNamedDeclaration(p) {
        const decl = p.node.declaration;
        if (!decl) return;
        if (decl.type === 'VariableDeclaration') {
          for (const d of decl.declarations) {
            if (d.id && d.id.type === 'Identifier' && isFunctionNode(d.init)) count += 1;
          }
        } else if (isFunctionNode(decl)) {
          count += 1;
        }
      },
    });
  }
  return count;
}

function collectMissingNamedExportJSDoc() {
  const missing = [];
  for (const file of NAMED_EXPORT_FILES) {
    const full = path.join(SERVICES_DIR, file);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
    traverse(ast, {
      ExportNamedDeclaration(p) {
        const decl = p.node.declaration;
        if (!decl) return;
        if (decl.type === 'VariableDeclaration') {
          for (const d of decl.declarations) {
            if (d.id && d.id.type === 'Identifier' && isFunctionNode(d.init)) {
              checkExport(p, d.id.name, d.loc.start.line);
            }
          }
        } else if (isFunctionNode(decl)) {
          checkExport(p, decl.id && decl.id.name, decl.loc.start.line);
        }
      },
    });
    function checkExport(pathNode, key, line) {
      if (!key) return;
      const comments = pathNode.node.leadingComments || [];
      const hasJSDocReturns = comments.some(
        (c) => c.type === 'CommentBlock' && c.value.includes('@returns')
      );
      if (!hasJSDocReturns) missing.push({ file, key, line });
    }
  }
  return missing;
}

function collectMissingClassMethodJSDoc() {
  const missing = [];
  for (const file of CLASS_SERVICE_FILES) {
    const full = path.join(SERVICES_DIR, file);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    let ast;
    try {
      ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
    } catch (e) {
      missing.push({ file, key: '(parsing)', line: 0 });
      continue;
    }
    traverse(ast, {
      ClassMethod(p) {
        const m = p.node;
        const key = m.key.name || m.key.value;
        if (!key || key === 'constructor' || String(key).startsWith('_')) return;
        const comments = m.leadingComments || [];
        const hasJSDocReturns = comments.some(
          (c) => c.type === 'CommentBlock' && c.value.includes('@returns')
        );
        if (!hasJSDocReturns) {
          missing.push({ file, key, line: m.loc.start.line });
        }
      },
    });
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(argv) {
  const failOnWarning = argv.includes(FAIL_ON_WARNING);
  const errors = [];
  const warnings = [];
  let dynamicCount = 0;

  // --- Contrat backend ---
  const { routes, paths } = collectBackendRoutes();
  const calls = collectFrontendCalls();

  for (const c of calls) {
    if (c.error) {
      errors.push(`  [CONTRAT] ${c.error}`);
      continue;
    }
    if (c.dynamic) {
      dynamicCount += 1;
      continue;
    }
    if (!routes.has(`${c.verb} ${c.path}`)) {
      const pathInfo = paths.get(c.path);
      let message;
      if (pathInfo) {
        // Le chemin existe mais le verbe frontend n'est pas autorisé (api_route
        // à methods explicites, ou verbe différent du décorateur implicite).
        const allowed = [...pathInfo.verbs].sort().join(', ');
        message = `  [CONTRAT] ${c.verb} ${c.rawPath}  (${c.loc}) → verbe non autorisé `
          + `pour cet endpoint (autorisés: ${allowed})`;
      } else {
        message = `  [CONTRAT] ${c.verb} ${c.rawPath}  (${c.loc}) → route introuvable dans le backend`;
      }
      // Routes infra (health/monitor/favicon) : cohérent avec le backend,
      // un échec CONTRAT y est un WARNING non bloquant (strict en CI).
      if (isOutOfScopePath(c.path)) {
        warnings.push(`${message}  [hors périmètre]`);
      } else {
        errors.push(message);
      }
    }
  }

  // --- Documentation @returns ---
  const missingDocs = collectMissingJSDoc();
  for (const m of missingDocs) {
    errors.push(`  [DOCS] api.js:${m.line}  ${m.key} — bloc JSDoc @returns manquant`);
  }
  const missingClassDocs = collectMissingClassMethodJSDoc();
  for (const m of missingClassDocs) {
    errors.push(`  [DOCS] ${m.file}:${m.line}  ${m.key} — bloc JSDoc @returns manquant`);
  }
  const missingNamedExports = collectMissingNamedExportJSDoc();
  for (const m of missingNamedExports) {
    errors.push(`  [DOCS] ${m.file}:${m.line}  ${m.key} — bloc JSDoc @returns manquant`);
  }

  const totalApiMethods = countApiMethods();
  const totalClassMethods = countClassMethods();
  const totalNamedExports = countNamedExports();
  console.log(`Routes backend connues : ${routes.size}`);
  console.log(`Appels frontend audités : ${calls.length} (${dynamicCount} dynamiques ignorés)`);
  console.log(`Méthodes api.js documentées : ${totalApiMethods - missingDocs.length}/${totalApiMethods}`);
  console.log(`Méthodes services (classes) documentées : ${totalClassMethods - missingClassDocs.length}/${totalClassMethods}`);
  console.log(`Exports nommés (fonctions) documentés : ${totalNamedExports - missingNamedExports.length}/${totalNamedExports}`);

  if (warnings.length) {
    console.log(`[AVERTISSEMENT] ${warnings.length} route(s) hors périmètre `
      + `(health/monitor/favicon) non conformes :`);
    for (const w of warnings) console.log(w);
    console.log('  (non bloquant — utilisez --fail-on-warning en CI pour les rendre bloquantes)');
  }
  if (errors.length) {
    console.log(`[ECHEC] ${errors.length} problème(s) :`);
    for (const e of errors) console.log(e);
    return 1;
  }
  if (failOnWarning && warnings.length) {
    console.log(`[ECHEC] Mode strict --fail-on-warning : ${warnings.length} warning(s)`);
    return 1;
  }
  console.log('[OK] Chaque appel frontend correspond à une route backend réelle, '
    + 'et chaque méthode API documente sa forme de retour (@returns).');
  return 0;
}

process.exit(main(process.argv.slice(2)));
