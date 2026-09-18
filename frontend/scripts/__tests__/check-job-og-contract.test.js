import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONTRACT_JOBS,
  FIXTURE_JOB,
  compareJobOg,
  decodeEntities,
  findPython,
  hasLoneSurrogate,
  htmlTitle,
  renderPrerenderedPage,
  runJobOgContractCheck,
} from '../check-job-og-contract';
import { DESCRIPTION_LIMIT, jobSeo } from '../../src/utils/jobSeo';

// Tests du garde « contrat app ↔ pré-rendu de /jobs/:id » (hors ligne) :
//   - le HTML comparé est celui du MODULE DE PRODUCTION (backend/kojo_job_og.py),
//     pas une fixture écrite ici : un test qui recopierait la forme du HTML
//     pourrait être vert avec un pré-rendu qui ne la produit plus ;//   - chaque moitié du contrat est prouvée capable d'échouer (titre, carte,
//     variante carrée, description, canonical) sur ce même HTML, par mutation
//     d'un seul côté ;
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

/**
 * Chaque mission du JEU de référence, avec le HTML de PRODUCTION qui lui
 * correspond et ce que l'application annonce. Le jeu est éprouvé cas par cas :
 * une seule mission ne dirait rien d'un pré-rendu qui n'a jamais traversé de
 * caractère astral.
 */
const referenceCases = hasPrerender
  ? CONTRACT_JOBS.map((job) => ({
      job,
      app: jobSeo(job),
      html: renderPrerenderedPage({ python, job, base: BASE, root: REPO_ROOT }).html,
    }))
  : [];

// Le détecteur de demi-caractère vient du GARDE (hasLoneSurrogate), pas d'une
// copie locale : il sert aussi à nommer la cause dans ses messages d'échec.

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

  it('détecte une URL de fiche divergente (canonical ET og:url) — des DEUX côtés', () => {
    // Côté application : c'est le chemin que /jobs/:id annonce au runtime —
    // celui qui restait figé sur la fiche PRÉCÉDENTE quand l'identifiant
    // changeait sans remonter le composant (cf. usePageMeta.test.jsx).
    const appSide = compareJobOg({ app: { ...app, canonicalPath: '/jobs/autre' }, html: realHtml, base: BASE });
    expect(appSide.join('\n')).toMatch(new RegExp(`canonical : le pré-rendu annonce « ${BASE}/jobs/${FIXTURE_JOB.id} »`));
    expect(appSide.join('\n')).toMatch(/og:url : le pré-rendu annonce/);

    // Côté pré-rendu : une balise ABSENTE doit être nommée, pas confondue avec
    // une comparaison vide (le pré-rendu d'avant ne portait pas de canonical).
    const withoutCanonical = realHtml.replace(/\s*<link rel="canonical"[^>]*\/>/, '');
    expect(withoutCanonical).not.toBe(realHtml);
    expect(compareJobOg({ app, html: withoutCanonical, base: BASE }).join('\n'))
      .toMatch(/canonical : le pré-rendu annonce « \(absent\) »/);

    const withoutOgUrl = realHtml.replace(/\s*<meta property="og:url"[^>]*\/>/, '');
    expect(withoutOgUrl).not.toBe(realHtml);
    expect(compareJobOg({ app, html: withoutOgUrl, base: BASE }).join('\n'))
      .toMatch(/og:url : le pré-rendu annonce « \(absente\) »/);
  });

  it('détecte une description coupée à un autre endroit', () => {
    // La coupe à 150 points de code + « … » est une règle des DEUX côtés : une
    // différence d'un seul caractère doit être visible, pas arrondie.
    const errors = compareJobOg({ app: { ...app, description: `${app.description}x` }, html: realHtml, base: BASE });
    expect(errors.join('\n')).toMatch(
      /description : le pré-rendu annonce 151 points de code, l'application 152/
    );
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

describe.skipIf(!hasPrerender)('check-job-og-contract — le jeu de référence (frontière des 150)', () => {
  it('chaque mission du jeu tient le contrat des DEUX côtés', () => {
    expect(referenceCases).toHaveLength(CONTRACT_JOBS.length);
    for (const { job, app: announce, html } of referenceCases) {
      expect(compareJobOg({ app: announce, html, base: BASE }), job.label).toEqual([]);
    }
  });

  it('place bien la frontière sur ce qu’il annonce', () => {
    // Sans ce contrôle, un jeu qui n'atteint jamais la frontière passerait pour
    // une couverture alors qu'il ne prouverait rien : chaque mission déclare ce
    // qu'elle couvre, et ce test le vérifie sur le texte lui-même.
    const at = (job) => Array.from(job.description)[DESCRIPTION_LIMIT - 1];
    const byLabel = Object.fromEntries(CONTRACT_JOBS.map((job) => [job.label, job]));

    expect(at(byLabel['accents à la frontière'])).toBe('è');
    expect(at(byLabel['emoji BMP à la frontière'])).toBe('☕');
    expect(at(byLabel['astral à la frontière'])).toBe('😀');
    // Le cas « avant la frontière » place son astral ailleurs : au 100e point.
    expect(Array.from(byLabel['astral avant la frontière'].description)[99]).toBe('🚚');
    for (const job of CONTRACT_JOBS) {
      expect(Array.from(job.description).length, job.label).toBeGreaterThan(DESCRIPTION_LIMIT);
      expect(job.covers, job.label).toBeTruthy();
    }
  });

  it('coupe en POINTS DE CODE : aucun demi-caractère publié', () => {
    // Le détecteur lui-même d'abord : sans cela, un détecteur qui répondrait
    // toujours « non » ferait passer l'assertion suivante pour une preuve.
    expect(hasLoneSurrogate('\ud83d')).toBe(true);
    expect(hasLoneSurrogate('a\udc00b')).toBe(true);
    expect(hasLoneSurrogate('😀')).toBe(false);
    expect(hasLoneSurrogate('Réfection à Ouagadougou')).toBe(false);

    const case_ = referenceCases.find(({ job }) => job.label === 'astral à la frontière');

    expect(case_.app.description).toContain('😀');
    expect(hasLoneSurrogate(case_.app.description)).toBe(false);
    // 150 points de code + le « … » de la coupe.
    expect(Array.from(case_.app.description)).toHaveLength(DESCRIPTION_LIMIT + 1);
    expect(case_.app.description.endsWith('…')).toBe(true);
  });

  it('détecte la règle d’AVANT (unités UTF-16), qui coupait la paire en deux', () => {
    for (const { job, html, app: announce } of referenceCases) {
      // Ce que `slice(0, 150)` + `length` produisaient avant le correctif.
      const utf16 = `${job.description.slice(0, DESCRIPTION_LIMIT)}${
        job.description.length > DESCRIPTION_LIMIT ? '…' : ''
      }`;
      const hasAstral = /[\u{10000}-\u{10FFFF}]/u.test(job.description);

      // Les textes du plan de base (accents compris) ne divergent PAS : c'est
      // exactement pourquoi la règle d'avant passait inaperçue.
      expect(utf16 !== announce.description, job.label).toBe(hasAstral);
      if (!hasAstral) continue;

      const errors = compareJobOg({ app: { ...announce, description: utf16 }, html, base: BASE });
      expect(errors.join('\n'), job.label).toMatch(
        /description : le pré-rendu annonce \d+ points de code, l'application \d+/
      );
      // Quand la coupe est tombée DANS la paire, le message nomme la cause —
      // c'est le cas où les deux textes ont la même longueur en points de code.
      if (hasLoneSurrogate(utf16)) {
        expect(errors.join('\n'), job.label).toMatch(/DEMI-CARACTÈRE/);
      }
    }
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
