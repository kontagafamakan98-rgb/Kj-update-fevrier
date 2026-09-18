import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FIXTURE_JOB,
  compareJobOg,
  decodeEntities,
  findPython,
  htmlTitle,
  renderPrerenderedPage,
  runJobOgContractCheck,
} from '../check-job-og-contract';
import { jobSeo } from '../../src/utils/jobSeo';

// Tests du garde « contrat app ↔ pré-rendu de /jobs/:id » (hors ligne) :
//   - le HTML comparé est celui du MODULE DE PRODUCTION (backend/kojo_job_og.py),
//     pas une fixture écrite ici : un test qui recopierait la forme du HTML
//     pourrait être vert avec un pré-rendu qui ne la produit plus ;
//   - chaque moitié du contrat est prouvée capable d'échouer (titre, carte,
//     variante carrée, description) sur ce même HTML, par mutation d'un seul côté ;
//   - l'absence d'interpréteur Python est une ERREUR en CI et un simple avis
//     ailleurs : un garde qui ne s'exécute pas ne garde rien.

const BASE = 'https://kojoforafrica.cc.cd';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const app = jobSeo(FIXTURE_JOB);
const python = findPython({ root: REPO_ROOT, base: BASE });
const prerender = python ? renderPrerenderedPage({ python, base: BASE, root: REPO_ROOT }) : null;
const hasPrerender = Boolean(prerender && !prerender.error && prerender.html);

// Le HTML de référence : celui que le backend produit RÉELLEMENT pour la mission
// de référence. Tout le reste du fichier le mute, jamais ne le réécrit.
const realHtml = hasPrerender ? prerender.html : '';

describe('check-job-og-contract — le pré-rendu de production est exécuté', () => {
  it('le module backend est importable sans aucune dépendance installée', () => {
    // Non-vacuité : sans interpréteur, les comparaisons ci-dessous seraient
    // sautées — et en CI, c'est un échec (voir le dernier test).
    expect(hasPrerender, python ? prerender.error : 'aucun interpréteur Python trouvé').toBe(true);
  });

  it('le dépôt réel tient le contrat (titre, description, carte)', () => {
    const result = runJobOgContractCheck({ root: REPO_ROOT, base: BASE, quiet: true });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe.skipIf(!hasPrerender)('check-job-og-contract — ce qui doit échouer', () => {
  it('cas nominal : les deux côtés annoncent la même chose', () => {
    expect(compareJobOg({ app, html: realHtml, base: BASE })).toEqual([]);
  });

  it('détecte un TITRE renommé d’un seul côté', () => {
    const errors = compareJobOg({ app: { ...app, title: `${FIXTURE_JOB.title} | Kojo` }, html: realHtml, base: BASE });
    expect(errors.join('\n')).toMatch(/titre : le pré-rendu annonce .* — Kojo .*, l'application .* \| Kojo/);
    // Le titre est porté par QUATRE balises : les quatre doivent être comparées,
    // pas seulement <title> — un crawler de partage lit og:title.
    expect(errors.filter((e) => e.startsWith('og:title') || e.startsWith('twitter:title'))).toHaveLength(2);
  });

  it('détecte une CARTE renommée d’un seul côté (wide ET carrée)', () => {
    const errors = compareJobOg({ app: { ...app, card: '/api/og/jobs/autre.png' }, html: realHtml, base: BASE });
    expect(errors.join('\n')).toMatch(/carte wide/);
    expect(errors.join('\n')).toMatch(/carte carrée/);
    expect(errors.join('\n')).toMatch(/autre\.png/);
  });

  it('détecte une variante carrée ABSENTE du pré-rendu', () => {
    const withoutSquare = realHtml.replace(
      new RegExp(`<meta property="og:image" content="[^"]*-square\\.png" />`),
      ''
    );
    expect(withoutSquare).not.toBe(realHtml);
    const errors = compareJobOg({ app, html: withoutSquare, base: BASE });
    expect(errors.join('\n')).toMatch(/carte carrée : le pré-rendu annonce « \(absente\) »/);
  });

  it('détecte une description coupée à un autre endroit', () => {
    // La coupe à 150 caractères + « … » est une règle des DEUX côtés : une
    // différence d'un seul caractère doit être visible, pas arrondie.
    const errors = compareJobOg({ app: { ...app, description: `${app.description}x` }, html: realHtml, base: BASE });
    expect(errors.join('\n')).toMatch(/description : le pré-rendu annonce 151 caractères, l'application 152/);
  });

  it('décode les entités du HTML : un texte échappé est un texte CONFORME', () => {
    // Le pré-rendu échappe « & » et l'apostrophe ; sans décodage, le garde
    // accuserait un HTML correct — et pousserait à retirer l'échappement.
    expect(decodeEntities('fuite &amp; rebouchage d&apos;une')).toBe("fuite & rebouchage d'une");
    expect(htmlTitle('<title>a &amp; b — Kojo</title>')).toBe('a & b — Kojo');
    expect(realHtml).toContain('&amp;');
  });

  it('refuse une mission sans annonce côté application (comparaison non vide)', () => {
    const errors = compareJobOg({ app: jobSeo({ id: FIXTURE_JOB.id }), html: realHtml, base: BASE });
    expect(errors.join('\n')).toMatch(/aucun titre pour cette mission/i);
  });
});

describe('check-job-og-contract — un interpréteur absent ne passe pas en silence', () => {
  it('échoue en CI, avise seulement ailleurs', () => {
    // Dépôt sans le module de production : le garde ne peut rien comparer.
    const vide = fs.mkdtempSync(path.join(os.tmpdir(), 'job-og-contract-'));
    try {
      const previous = process.env.CI;
      try {
        process.env.CI = 'true';
        const enCi = runJobOgContractCheck({ root: vide, base: BASE, quiet: true });
        expect(enCi.ok).toBe(false);
        expect(enCi.errors.join('\n')).toMatch(/n'a donc PAS été vérifié/);

        delete process.env.CI;
        const horsCi = runJobOgContractCheck({ root: vide, base: BASE, quiet: true });
        expect(horsCi.ok).toBe(true);
        expect(horsCi.notices.join('\n')).toMatch(/n'a donc PAS été vérifié/);
      } finally {
        if (previous === undefined) delete process.env.CI;
        else process.env.CI = previous;
      }
    } finally {
      fs.rmSync(vide, { recursive: true, force: true });
    }
  });
});
