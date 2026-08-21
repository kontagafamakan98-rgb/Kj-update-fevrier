#!/usr/bin/env node
// ============================================================================
// Validation locale de frontend/vercel.json contre le SCHÉMA OFFICIEL Vercel.
//
// Pourquoi : un build Vercel peut échouer à la validation du schéma AVANT même
// de compiler (ex: propriété `headers` interdite dans un item de `rewrites` —
// bug réel qui a bloqué un déploiement). Ce script la détecte LOCALEMENT, en
// pré-déploiement, avec un message clair au lieu d'un échec de build distant.
//
// Fonctionnement :
//   1. Charge le schéma officiel (https://openapi.vercel.sh/vercel.json),
//      mis en cache dans node_modules/.cache (gitignoré) → 1 seul fetch à vie.
//   2. Valide vercel.json avec ajv contre ce schéma.
//   3. Hors-ligne (fetch impossible ET pas de cache) : repli sur une
//      validation structurelle embarquée (rewrites/headers/redirects) pour ne
//      JAMAIS laisser passer un fichier cassé en silence.
//
// Usage : node scripts/validate-vercel-json.mjs   (ou `npm run validate:vercel`)
// Exit code : 0 = valide, 1 = invalide (ou schéma indisponible sans cache).
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ajv from 'ajv';

const SCHEMA_URL = 'https://openapi.vercel.sh/vercel.json';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERCEL_JSON_PATH = path.join(ROOT, 'vercel.json');
const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'vercel-schema.json');

// --- Schéma officiel : cache local d'abord, puis fetch, puis échec ---
async function loadSchema() {
  if (existsSync(CACHE_FILE)) {
    try {
      return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    } catch (err) {
      console.warn(`⚠️ Cache du schéma illisible (${err.message}), re-fetch…`);
    }
  }
  const res = await fetch(SCHEMA_URL);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} en récupérant ${SCHEMA_URL}`);
  }
  const schema = await res.json();
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(schema));
  } catch (err) {
    console.warn(`⚠️ Impossible de mettre le schéma en cache (${err.message})`);
  }
  return schema;
}

// --- Validation contre le schéma officiel ---
// Le schéma Vercel déclare `$schema: draft-04` mais utilise en réalité une
// syntaxe moderne (exclusiveMinimum numérique, additionalProperties en objet).
// On valide donc avec ajv (draft-07) en retirant la déclaration draft-04 et en
// désactivant la validation de la meta-schema (meta:false) — sinon ajv rejette
// le schéma officiel lui-même.
function validateWithSchema(vercelJson, schema) {
  const compiledSchema = { ...schema };
  delete compiledSchema['$schema'];
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false, meta: false, logger: false });
  const validate = ajv.compile(compiledSchema);
  const valid = validate(vercelJson);
  return valid ? [] : (validate.errors || []);
}

// --- Repli structurel embarqué (hors-ligne) ---
// Couvre les règles qui ont historiquement cassé des builds Vercel. Ce repli
// n'est PAS exhaustif : il sert de filet de sécurité quand le schéma officiel
// est indisponible, pas de remplacement.
const REWRITE_ALLOWED_KEYS = new Set(['source', 'destination', 'has', 'missing']);
const HEADER_RULE_ALLOWED_KEYS = new Set(['source', 'headers', 'has', 'missing']);
const REDIRECT_ALLOWED_KEYS = new Set(['source', 'destination', 'statusCode', 'permanent', 'has', 'missing']);

export function structuralFallbackCheck(vercelJson) {
  const errors = [];
  const push = (instancePath, message) => errors.push({ instancePath, message });

  if (vercelJson === null || typeof vercelJson !== 'object' || Array.isArray(vercelJson)) {
    push('', 'vercel.json doit être un objet');
    return errors;
  }

  for (const key of ['rewrites', 'headers', 'redirects']) {
    const value = vercelJson[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      push(`/${key}`, 'doit être un tableau');
      continue;
    }
    value.forEach((item, index) => {
      const base = `/${key}/${index}`;
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        push(base, 'chaque entrée doit être un objet');
        return;
      }
      const allowed = key === 'rewrites' ? REWRITE_ALLOWED_KEYS
        : key === 'headers' ? HEADER_RULE_ALLOWED_KEYS
        : REDIRECT_ALLOWED_KEYS;
      for (const prop of Object.keys(item)) {
        if (!allowed.has(prop)) {
          push(
            `${base}/${prop}`,
            `propriété non autorisée dans un item ${key} (autorisées : ${[...allowed].join(', ')})`
          );
        }
      }
      if (key === 'rewrites' && (typeof item.source !== 'string' || typeof item.destination !== 'string')) {
        push(base, 'un rewrite doit avoir source (string) et destination (string)');
      }
      if (key === 'headers') {
        if (typeof item.source !== 'string') push(base, 'une règle headers doit avoir source (string)');
        if (!Array.isArray(item.headers)) {
          push(base, 'une règle headers doit avoir headers (tableau)');
        } else {
          item.headers.forEach((h, hi) => {
            if (h === null || typeof h !== 'object' || typeof h.key !== 'string' || typeof h.value !== 'string') {
              push(`${base}/headers/${hi}`, 'chaque header doit avoir key (string) et value (string)');
            }
          });
        }
      }
    });
  }
  return errors;
}

function formatErrors(errors) {
  return errors
    .map((e) => `  • ${e.instancePath || '(racine)'} : ${e.message || JSON.stringify(e.params || {})}`)
    .join('\n');
}

async function main() {
  let vercelJson;
  try {
    vercelJson = JSON.parse(readFileSync(VERCEL_JSON_PATH, 'utf8'));
  } catch (err) {
    console.error(`❌ Impossible de lire ${VERCEL_JSON_PATH} : ${err.message}`);
    process.exit(1);
  }

  let schema;
  try {
    schema = await loadSchema();
  } catch (err) {
    console.warn(`⚠️ Schéma officiel indisponible (${err.message}) — repli structurel embarqué.`);
    const errors = structuralFallbackCheck(vercelJson);
    if (errors.length) {
      console.error(`❌ vercel.json invalide (repli structurel) :\n${formatErrors(errors)}`);
      process.exit(1);
    }
    console.log('✅ vercel.json structurellement valide (repli hors-ligne).');
    return;
  }

  const errors = validateWithSchema(vercelJson, schema);
  if (errors.length) {
    console.error(`❌ vercel.json invalide contre le schéma officiel Vercel :\n${formatErrors(errors)}`);
    console.error('👉 Corrigez le fichier puis relancez la validation — le build Vercel échouerait sinon.');
    process.exit(1);
  }
  console.log(`✅ vercel.json valide contre le schéma officiel Vercel (${SCHEMA_URL}).`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(`❌ Erreur inattendue : ${err.message}`);
    process.exit(1);
  });
}
