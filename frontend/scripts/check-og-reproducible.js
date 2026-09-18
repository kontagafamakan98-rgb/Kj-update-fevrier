#!/usr/bin/env node
/**
 * Reproduction EXACTE des cartes Open Graph : régénère les cartes dans un
 * dossier temporaire et les compare octet à octet avec celles versionnées dans
 * public/.
 *
 * ── Pourquoi ce script n'est PAS branché dans la CI ──────────────────────────
 * La comparaison exacte exige la police qui a produit les cartes (Arial, voir
 * REFERENCE_FONTS dans check-og-assets.js). Or TOUS les jobs de ce dépôt
 * tournent sur ubuntu-latest, qui n'a ni Arial ni aucune police versionnée
 * ici : mesuré, une régénération sans Arial change 5,6 à 6,8 % des pixels des
 * cartes wide. Le garde serait donc rouge en permanence pour une raison
 * légitime — exactement le garde qu'on apprend à ignorer.
 *
 * En CI, la protection vient de l'EMPREINTE VERSIONNÉE
 * (scripts/check-og-assets.js) : elle détecte une carte retouchée à la main,
 * un générateur modifié sans régénération, ou des cartes refaites ailleurs
 * avec une AUTRE police, sans avoir besoin des polices sur le runner.
 *
 * Ce script-ci est la preuve locale, plus forte : il ne se contente pas de
 * comparer des empreintes, il rejoue la génération.
 *     cd frontend && node scripts/check-og-reproducible.js
 *
 * Il ne touche JAMAIS public/ : tout part dans un dossier temporaire, supprimé
 * à la sortie. Sortie 0 = cartes reproductibles, 1 = divergence prouvée,
 * 0 + ::notice = environnement non reproductible (police absente), vérifié
 * ailleurs.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARDS_DIR_NAME, GENERATOR_NAME, MANIFEST_NAME } from './check-og-assets.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMITTED_MANIFEST = path.join(FRONTEND_DIR, 'scripts', MANIFEST_NAME);
const PUBLIC_DIR = path.join(FRONTEND_DIR, 'public');

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

// Interpréteurs candidats : PYTHON explicite, le venv backend du dépôt (celui
// documenté par le générateur), puis ceux du PATH.
const PYTHON_CANDIDATES = [
  process.env.PYTHON,
  path.join('..', 'backend', '.venv', 'Scripts', 'python.exe'),
  path.join('..', 'backend', '.venv', 'Scripts', 'python'),
  path.join('..', 'backend', '.venv', 'bin', 'python'),
  'python3',
  'python',
].filter(Boolean);

const findPython = () => {
  for (const candidate of PYTHON_CANDIDATES) {
    const probe = spawnSync(candidate, ['-c', 'import PIL'], {
      cwd: FRONTEND_DIR,
      stdio: 'ignore',
    });
    if (probe.status === 0) return candidate;
  }
  return null;
};

const run = () => {
  if (!existsSync(COMMITTED_MANIFEST)) {
    console.error(`❌ manifeste ${MANIFEST_NAME} introuvable : lance scripts/${GENERATOR_NAME}.`);
    return 1;
  }
  const committed = JSON.parse(readFileSync(COMMITTED_MANIFEST, 'utf8'));

  const python = findPython();
  if (!python) {
    console.log(
      '::notice::check-og-reproducible ignoré : aucun interpréteur Python avec Pillow ' +
        '(la comparaison exacte des octets ne peut pas être rejouée ici)'
    );
    return 0;
  }

  const tempDir = mkdtempSync(path.join(tmpdir(), 'og-repro-'));
  try {
    const outDir = path.join(tempDir, 'public');
    const manifestPath = path.join(tempDir, MANIFEST_NAME);
    const generation = spawnSync(
      python,
      ['scripts/' + GENERATOR_NAME, '--out-dir', outDir, '--manifest', manifestPath],
      { cwd: FRONTEND_DIR, encoding: 'utf8' }
    );
    if (generation.status !== 0) {
      console.error(
        `❌ régénération impossible (${python}) : ` +
          `${(generation.stderr || generation.stdout || '').trim().slice(0, 400)}`
      );
      return 1;
    }

    const regenerated = JSON.parse(readFileSync(manifestPath, 'utf8'));

    // Si la police retenue n'est pas celle de référence, l'écart de pixels est
    // attendu : on s'arrête proprement, en le disant, plutôt que d'accuser les
    // cartes à tort.
    const fonts = JSON.stringify(regenerated.fonts);
    const reference = JSON.stringify(committed.fonts);
    if (fonts !== reference) {
      console.log(
        `::notice::comparaison exacte ignorée : polices ${fonts} ≠ référence ${reference} ` +
          `(cartes non reproductibles dans cet environnement — l'empreinte versionnée reste ` +
          `la garantie CI)`
      );
      return 0;
    }

    const errors = [];
    for (const entry of committed.assets) {
      const committedFile = path.join(PUBLIC_DIR, entry.file);
      const regeneratedFile = path.join(outDir, entry.file);
      if (!existsSync(committedFile)) {
        errors.push(`public/${entry.file} manquant`);
        continue;
      }
      if (!existsSync(regeneratedFile)) {
        errors.push(`${entry.file} : non régénéré`);
        continue;
      }
      const committedBytes = readFileSync(committedFile);
      const regeneratedBytes = readFileSync(regeneratedFile);
      if (!committedBytes.equals(regeneratedBytes)) {
        errors.push(
          `${entry.file} : ${committedBytes.length} octets versionnés ≠ ` +
            `${regeneratedBytes.length} régénérés (empreinte ${sha256(committedBytes).slice(0, 12)}… ` +
            `≠ ${sha256(regeneratedBytes).slice(0, 12)}…)`
        );
      }
    }
    if (regenerated.generator_sha256 !== committed.generator_sha256) {
      errors.push(
        `scripts/${GENERATOR_NAME} : empreinte régénérée ≠ manifeste versionné ` +
          `(le manifeste doit être régénéré et commité)`
      );
    }
    if (regenerated.cards_sha256 !== committed.cards_sha256) {
      errors.push(
        `contenu des cartes (${CARDS_DIR_NAME}/) : empreinte régénérée ≠ manifeste ` +
          `versionné (le manifeste doit être régénéré et commité)`
      );
    }

    if (errors.length > 0) {
      console.error(`❌ Cartes Open Graph NON reproductibles (${errors.length} problème(s)) :`);
      for (const message of errors) console.error(`   • ${message}`);
      console.error(
        `   → régénère avec scripts/${GENERATOR_NAME} sur un poste doté de la police de ` +
          `référence, puis committe les PNG et le manifeste.`
      );
      return 1;
    }

    console.log(
      `✅ Reproduction exacte : ${committed.assets.length} cartes régénérées octet pour octet ` +
        `(police ${committed.fonts.bold}).`
    );
    return 0;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
};

process.exit(run());
