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
import { POINT_ENTREE_MISSION } from '../site-meta';

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

  // Le dépôt réel n'est pas rejoué ici : l'étape « Check job OG contract » de la CI
  // l'examine sur le runner, titre, description et carte compris.
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
    // La coupe (150 points de code, puis recul au dernier espace) est une règle
    // des DEUX côtés : une différence d'un seul caractère doit être visible, pas
    // arrondie. Les longueurs sont LUES, jamais recopiées : la règle de l'espace
    // rend la longueur variable (la tranche recule), donc un nombre écrit ici
    // deviendrait faux au premier texte de référence retouché.
    const points = Array.from(app.description).length;
    const errors = compareJobOg({ app: { ...app, description: `${app.description}x` }, html: realHtml, base: BASE });
    expect(errors.join('\n')).toContain(
      `description : le pré-rendu annonce ${points} points de code, l'application ${points + 1}`
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

describe.skipIf(!hasPrerender)('check-job-og-contract — la fiche DÉMARRE l’application', () => {
  it('le document de production porte la feuille, le point d’entrée et la vue rendue', () => {
    // Le document rendu par le module de production est confronté AUX chemins
    // déclarés : renommer l'un des deux côtés rougit ici, sans serveur.
    expect(compareJobOg({ app, html: realHtml, base: BASE, vue: FIXTURE_JOB })).toEqual([]);
    // Et le CLI FOURNIT la vue : sans elle, le bloc ne serait jamais jugé dans
    // l'étape de CI — un contrôle qui ne s'exécute pas ne garde rien.
    const run = runJobOgContractCheck({ root: REPO_ROOT, base: BASE, quiet: true });
    expect(run.ok).toBe(true);
    expect(run.checked.join('\n')).toContain(`bloc « ${POINT_ENTREE_MISSION.seedId} »`);
  });

  it('détecte un document qui NE démarre PAS l’application', () => {
    const sansBoot = realHtml.replace(/<script type="module"[^>]*><\/script>\r?\n?/, '');
    expect(sansBoot).not.toBe(realHtml);

    const errors = compareJobOg({ app, html: sansBoot, base: BASE, vue: FIXTURE_JOB });
    expect(errors.join('\n')).toContain('point d’entrée');

    // Sans vue à juger, ce même document passerait : c'est bien le CLI qui
    // décide que le bloc et le démarrage font partie du contrat.
    expect(compareJobOg({ app, html: sansBoot, base: BASE })).toEqual([]);
  });

  it('le CLI REFUSE un pré-rendu qui ne porte plus le bloc (il fournit donc la vue)', () => {
    // La preuve que l'étape de CI juge vraiment le bloc : on retire la balise du
    // module de production, sur une COPIE du dépôt (le dépôt n'est jamais écrit),
    // et la même invocation doit rougir. Si le CLI oubliait de passer la vue, ce
    // document passerait au vert — le contrôle serait décoratif.
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'job-og-boot-'));
    try {
      const backend = path.join(racine, 'backend');
      fs.mkdirSync(backend);
      // Les modules du backend sont copiés À PLAT avant la mutation :
      // `kojo_job_og` importe `kojo_csp` (et `kojo_worker_og` importe celle-ci),
      // donc un fichier SEUL ne s'importe pas — la copie ne portait que le
      // module muté, le CLI ne trouvait aucun interpréteur capable de l'importer
      // et rendait une PRÉMISSE au lieu de juger le bloc, ce qui faisait de ce
      // cas une preuve de rien. Seul `kojo_job_og.py` est ensuite réécrit.
      for (const nom of fs.readdirSync(path.join(REPO_ROOT, 'backend'))) {
        if (!nom.endsWith('.py')) continue;
        fs.copyFileSync(
          path.join(REPO_ROOT, 'backend', nom),
          path.join(backend, nom)
        );
      }
      const source = fs.readFileSync(path.join(REPO_ROOT, 'backend/kojo_job_og.py'), 'utf8');
      const mute = source.replace(
        '+ (balise_seed(SEED_ID, vue_publique) if vue_publique is not None else "")',
        '+ ""'
      );
      expect(mute).not.toBe(source);
      fs.writeFileSync(path.join(backend, 'kojo_job_og.py'), mute);

      const run = runJobOgContractCheck({ root: racine, base: BASE, quiet: true });

      expect(run.ok).toBe(false);
      expect(run.errors.join('\n')).toContain('bloc');
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });

  it('détecte un bloc de données d’une AUTRE mission', () => {
    // La page afficherait la mauvaise mission, avec son budget et son adresse :
    // le bloc doit porter la vue RENDUE, pas une vue voisine.
    const errors = compareJobOg({
      app,
      html: realHtml,
      base: BASE,
      vue: { ...FIXTURE_JOB, id: 'autre-mission' },
    });
    expect(errors.join('\n')).toContain('ne porte pas la vue publique rendue');
  });
});

describe.skipIf(!hasPrerender)('check-job-og-contract — le jeu de référence (frontière des 150)', () => {
  it('chaque mission du jeu tient le contrat des DEUX côtés', () => {
    expect(referenceCases).toHaveLength(CONTRACT_JOBS.length);
    for (const { job, app: announce, html } of referenceCases) {
      // `vue: job` : chaque mission du jeu est aussi jugée sur son bloc de
      // données, pas seulement sur sa tête.
      expect(compareJobOg({ app: announce, html, base: BASE, vue: job }), job.label).toEqual([]);
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

    const frontiere = referenceCases.find(({ job }) => job.label === 'astral à la frontière');
    const avant = referenceCases.find(({ job }) => job.label === 'astral avant la frontière');

    // Un astral PILE sur la coupe n'est pas publié du tout : la tranche recule au
    // dernier espace, donc le caractère tombe avec la fin du mot — mieux qu'un
    // demi-caractère, et c'est ce que la règle des 150 laissait passer.
    expect(frontiere.app.description).not.toContain('😀');
    // Un astral DANS la tranche retenue est publié entier.
    expect(avant.app.description).toContain('🚚');

    for (const { job, app: announce } of referenceCases) {
      expect(hasLoneSurrogate(announce.description), job.label).toBe(false);
      // Au plus 150 points de code, plus le « … » de la coupe.
      expect(Array.from(announce.description).length, job.label).toBeLessThanOrEqual(
        DESCRIPTION_LIMIT + 1
      );
      expect(announce.description.endsWith('…'), job.label).toBe(true);
      // La coupe tombe sur une FRONTIÈRE DE MOT : le caractère suivant dans la
      // source est un espace (ou la coupe était dure, faute d'espace).
      const garde = Array.from(announce.description.slice(0, -1)).length;
      const suivant = Array.from(job.description)[garde];
      expect(suivant === ' ' || garde === DESCRIPTION_LIMIT, `${job.label} : « ${suivant} »`).toBe(
        true
      );
    }
  });

  it('détecte la règle d’AVANT (unités UTF-16), qui coupait la paire en deux', () => {
    for (const { job, html, app: announce } of referenceCases) {
      // Ce que la règle d'avant produisait : `slice(0, 150)` + `length`, en
      // UNITÉS UTF-16. La coupe sur l'espace est volontairement ABSENTE des deux
      // côtés, pour que ce cas ne juge que le COMPTAGE.
      const points = Array.from(job.description);
      const tranchePoints = `${points.slice(0, DESCRIPTION_LIMIT).join('')}${
        points.length > DESCRIPTION_LIMIT ? '…' : ''
      }`;
      const trancheUtf16 = `${job.description.slice(0, DESCRIPTION_LIMIT)}${
        job.description.length > DESCRIPTION_LIMIT ? '…' : ''
      }`;
      const hasAstral = /[\u{10000}-\u{10FFFF}]/u.test(job.description);

      // Les deux COMPTAGES ne divergent que sur un caractère astral : les textes
      // du plan de base (accents compris) donnent la même tranche, et c'est
      // exactement pourquoi la règle d'avant passait inaperçue.
      expect(trancheUtf16 !== tranchePoints, job.label).toBe(hasAstral);
      if (!hasAstral) continue;

      const errors = compareJobOg({ app: { ...announce, description: trancheUtf16 }, html, base: BASE });
      expect(errors.join('\n'), job.label).toMatch(
        /description : le pré-rendu annonce \d+ points de code, l'application \d+/
      );
      // Quand la coupe est tombée DANS la paire, le message nomme la cause —
      // c'est le cas où les deux textes ont la même longueur en points de code.
      if (hasLoneSurrogate(trancheUtf16)) {
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
