import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONTRACT_WORKERS,
  FIXTURE_WORKER,
  PRERENDER_SCRIPT,
  comparePointEntree,
  compareWorkerOg,
  egalProfond,
  extraireSeed,
  findPython,
  hasLoneSurrogate,
  renderPrerenderedPage,
  runWorkerOgContractCheck,
  verifierArtefacts,
} from '../check-worker-og-contract';
import { POINT_ENTREE_TRAVAILLEUR } from '../site-meta';
import { SELECTEUR_TEMOIN } from '../../vite-plugins/worker-boot.js';
import { DESCRIPTION_LIMIT } from '../../src/utils/jobSeo';
import { workerSeo } from '../../src/utils/workerSeo';

// Tests du garde « contrat app ↔ pré-rendu de /workers/:id » (hors ligne) :
//   - le HTML comparé est celui du MODULE DE PRODUCTION
//     (backend/kojo_worker_og.py), exécuté par un interpréteur Python : un test
//     qui recopierait la forme du HTML serait vert avec un pré-rendu qui ne la
//     produit plus ;
//   - chaque moitié du contrat est prouvée capable d'échouer (titre, carte,
//     variante carrée, description, canonical) sur ce même HTML, par mutation
//     d'UN SEUL côté ;
//   - la coupe se compte en POINTS DE CODE : la règle d'avant (unités UTF-16)
//     est rejouée et doit être détectée sur le cas astral ;
//   - l'absence d'interpréteur Python est une ERREUR en CI et un avis ailleurs.

const BASE = 'https://kojoforafrica.cc.cd';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PYTHON = findPython({
  root: REPO_ROOT,
  base: BASE,
  module: 'backend/kojo_worker_og.py',
  job: FIXTURE_WORKER,
  script: PRERENDER_SCRIPT,
});
const hasPrerender = Boolean(PYTHON);

const render = (worker) =>
  renderPrerenderedPage({
    python: PYTHON,
    job: worker,
    base: BASE,
    root: REPO_ROOT,
    script: PRERENDER_SCRIPT,
  });

const referenceCases = CONTRACT_WORKERS.map(({ label, worker }) => {
  if (!hasPrerender) return { label, worker, app: null, html: '' };
  const { html, error } = render(worker);
  // Une erreur d'exécution est un ÉCHEC du cas, pas un silence : le test
  // nominal la verrait passer pour une chaîne vide.
  if (error) throw new Error(`[${label}] ${error}`);
  return { label, worker, app: workerSeo(worker), html };
});

describe('check-worker-og-contract — le pré-rendu de production est exécuté', () => {
  it('en CI, un interpréteur est là — sinon tous les cas ci-dessous sauteraient', () => {
    // Hors CI, un poste sans Python n'est pas une panne du dépôt (le garde le
    // dit en `::notice`). En CI, l'image du runner en fournit un : son absence
    // ferait sauter le contrat en silence, ce qui rendrait ce fichier vert sans
    // avoir rien comparé.
    if (!process.env.CI) return;
    expect(hasPrerender).toBe(true);
  });

  it.skipIf(!hasPrerender)('cas nominal : les deux côtés annoncent la même chose', () => {
    for (const { label, app: announce, html } of referenceCases) {
      expect(compareWorkerOg({ app: announce, html, base: BASE }), label).toEqual([]);
    }
  });

  it.skipIf(!hasPrerender)('détecte un TITRE renommé d’un seul côté', () => {
    const { app: announce, html } = referenceCases[0];
    const errors = compareWorkerOg({
      app: { ...announce, title: `${announce.title} (retouché)` },
      html,
      base: BASE,
    });
    expect(errors.join('\n')).toMatch(/titre : le pré-rendu annonce/);
  });

  it.skipIf(!hasPrerender)('détecte une CARTE renommée d’un seul côté (wide ET carrée)', () => {
    const { worker, app: announce, html } = referenceCases[0];
    const id = worker.id;

    const wide = compareWorkerOg({
      app: { ...announce, card: `/api/og/workers/${id}-autre.png` },
      html,
      base: BASE,
    });
    expect(wide.join('\n')).toMatch(/carte wide/);

    const square = compareWorkerOg({
      app: { ...announce, cardSquare: `/api/og/workers/${id}-carre.png` },
      html,
      base: BASE,
    });
    expect(square.join('\n')).toMatch(/carte carrée/);
  });

  it.skipIf(!hasPrerender)('détecte une variante carrée ABSENTE du pré-rendu', () => {
    const { app: announce, html } = referenceCases[0];
    // Le pré-rendu amputé de sa seconde carte : c'est le défaut qu'un réseau qui
    // recadre en 1:1 verrait (aucune image).
    // `\r?\n` : sous Windows Python écrit la sortie standard en mode texte et
    // la ligne se termine par CRLF ; une expression qui exigerait `\n` seul ne
    // trouverait rien et le cas passerait pour un contrat tenu.
    const amputé = html.replace(
      /<meta property="og:image" content="[^"]*-square\.png" \/>\r?\n/,
      ''
    );
    expect(amputé).not.toBe(html);
    const errors = compareWorkerOg({ app: announce, html: amputé, base: BASE });
    expect(errors.join('\n')).toMatch(/carte carrée/);
  });

  it.skipIf(!hasPrerender)('détecte une URL de profil divergente (canonical ET og:url)', () => {
    const { app: announce, html } = referenceCases[0];
    const errors = compareWorkerOg({
      app: { ...announce, canonicalPath: '/workers/autre-profil' },
      html,
      base: BASE,
    });
    const texte = errors.join('\n');
    expect(texte).toMatch(/canonical/);
    expect(texte).toMatch(/og:url/);
  });

  it.skipIf(!hasPrerender)('détecte une description coupée à un autre endroit', () => {
    const { app: announce, html } = referenceCases[0];
    const errors = compareWorkerOg({
      app: { ...announce, description: announce.description.slice(0, 40) },
      html,
      base: BASE,
    });
    expect(errors.join('\n')).toMatch(/description : le pré-rendu annonce/);
  });
});

describe.skipIf(!hasPrerender)('check-worker-og-contract — le jeu de référence', () => {
  it('chaque profil tient le contrat des DEUX côtés', () => {
    expect(referenceCases).toHaveLength(CONTRACT_WORKERS.length);
    for (const { label, app: announce, html } of referenceCases) {
      expect(compareWorkerOg({ app: announce, html, base: BASE }), label).toEqual([]);
    }
  });

  it('place bien la frontière sur ce qu’il annonce', () => {
    // Sans ce contrôle, un jeu qui n'atteindrait jamais la coupe passerait pour
    // une couverture alors qu'il ne prouverait rien.
    const at = (label) =>
      Array.from(CONTRACT_WORKERS.find((entry) => entry.label === label).worker.bio)[
        DESCRIPTION_LIMIT - 1
      ];
    expect(at('astral à la frontière')).toBe('😀');
    expect(
      Array.from(CONTRACT_WORKERS.find((e) => e.label === 'astral avant la frontière').worker.bio)[99]
    ).toBe('🚚');
    for (const { label, covers } of CONTRACT_WORKERS) {
      expect(covers, label).toBeTruthy();
    }
  });

  it('coupe en POINTS DE CODE : aucun demi-caractère publié', () => {
    // Le détecteur d'abord : un détecteur qui répondrait toujours « non »
    // ferait passer l'assertion suivante pour une preuve.
    expect(hasLoneSurrogate('\ud83d')).toBe(true);
    expect(hasLoneSurrogate('a\udc00b')).toBe(true);
    expect(hasLoneSurrogate('😀')).toBe(false);

    const astral = referenceCases.find(({ label }) => label === 'astral à la frontière');
    expect(astral.app.description).toContain('😀');
    expect(hasLoneSurrogate(astral.app.description)).toBe(false);
    // 150 points de code + le « … » de la coupe.
    expect(Array.from(astral.app.description)).toHaveLength(DESCRIPTION_LIMIT + 1);
    expect(astral.app.description.endsWith('…')).toBe(true);
  });

  it('détecte la règle d’AVANT (unités UTF-16), qui coupait la paire en deux', () => {
    for (const { label, worker, html, app: announce } of referenceCases) {
      if (!worker.bio) continue;
      const utf16 = `${worker.bio.slice(0, DESCRIPTION_LIMIT)}${
        worker.bio.length > DESCRIPTION_LIMIT ? '…' : ''
      }`;
      const hasAstral = /[\u{10000}-\u{10FFFF}]/u.test(worker.bio);
      if (!hasAstral) continue;

      const errors = compareWorkerOg({
        app: { ...announce, description: utf16 },
        html,
        base: BASE,
      });
      expect(errors.join('\n'), label).toMatch(
        /description : le pré-rendu annonce \d+ points de code, l'application \d+/
      );
      if (hasLoneSurrogate(utf16)) {
        expect(errors.join('\n'), label).toMatch(/DEMI-CARACTÈRE/);
      }
    }
  });
});

describe.skipIf(!hasPrerender)('check-worker-og-contract — le document DÉMARRE l’application', () => {
  it('cas nominal : point d’entrée, feuille et données déjà rendues', () => {
    for (const { label, worker, html } of referenceCases) {
      expect(comparePointEntree({ html, vue: worker }), label).toEqual([]);
    }
    // Et la lecture du bloc est celle du module de production, pas une fixture.
    const { worker, html } = referenceCases[0];
    expect(egalProfond(JSON.parse(extraireSeed(html)), worker)).toBe(true);
  });

  it('détecte un point d’entrée ABSENT (page statique, pas d’application)', () => {
    const { worker, html } = referenceCases[0];
    const amputé = html.replace(/<script type="module"[^>]*><\/script>\r?\n/, '');
    expect(amputé).not.toBe(html);

    expect(comparePointEntree({ html: amputé, vue: worker }).join('\n')).toMatch(/point d’entrée/);
  });

  it('détecte une feuille ABSENTE (application peinte sans style)', () => {
    const { worker, html } = referenceCases[0];
    const amputé = html.replace(/<link rel="stylesheet"[^>]*\/?>\r?\n/, '');
    expect(amputé).not.toBe(html);

    expect(comparePointEntree({ html: amputé, vue: worker }).join('\n')).toMatch(/feuille/);
  });

  it('détecte un bloc de données ABSENT (retour au squelette)', () => {
    const { worker, html } = referenceCases[0];
    const amputé = html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '');

    expect(comparePointEntree({ html: amputé, vue: worker }).join('\n')).toMatch(/bloc .* absent/);
  });

  it('détecte les données d’un AUTRE profil', () => {
    const { html } = referenceCases[0];
    const autre = referenceCases[1].worker;

    expect(comparePointEntree({ html, vue: autre }).join('\n')).toMatch(
      /ne porte pas la vue publique rendue/
    );
  });

  it('détecte un bloc qui REFERME sa balise (balisage injecté)', () => {
    const { worker, html } = referenceCases[0];
    // Une valeur NON échappée ouvre une balise dans le bloc (ici `<script>`, ce
    // qu'un échappement correct aurait rendu `\u003cscript\u003e`).
    const injecté = html.replace(
      /(<script type="application\/json"[^>]*>)[\s\S]*?(<\/script>)/,
      '$1{"id":"x","bio":"<script>alert(1)"}$2'
    );

    expect(comparePointEntree({ html: injecté, vue: worker }).join('\n')).toMatch(/NON échappée/);
  });

  it('détecte un bloc illisible', () => {
    const { worker, html } = referenceCases[0];
    const tronqué = html.replace(
      /(<script type="application\/json"[^>]*>)[\s\S]*?(<\/script>)/,
      '$1{"id":$2'
    );

    expect(comparePointEntree({ html: tronqué, vue: worker }).join('\n')).toMatch(/pas du JSON lisible/);
  });

  it('suit les chemins DÉCLARÉS : un renommage d’un côté rougit', () => {
    const { worker, html } = referenceCases[0];

    const errors = comparePointEntree({
      html,
      vue: worker,
      attendu: {
        ...POINT_ENTREE_TRAVAILLEUR,
        script: '/boot/autre-nom.js',
        style: '/boot/autre-feuille.css',
      },
    });
    const texte = errors.join('\n');
    expect(texte).toMatch(/point d’entrée/);
    expect(texte).toMatch(/feuille/);
  });
});

describe('check-worker-og-contract — les cibles du document existent dans l’artefact', () => {
  let racine;

  const ecrire = (relatif, contenu) => {
    const abs = path.join(racine, relatif);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contenu, 'utf8');
  };

  const artefactValide = () => {
    ecrire(POINT_ENTREE_TRAVAILLEUR.script.replace(/^\//, ''), 'import"/assets/index-Ab12Cd.js";\n');
    ecrire('assets/index-Ab12Cd.js', 'console.log("app")');
    ecrire(POINT_ENTREE_TRAVAILLEUR.style.replace(/^\//, ''), `${SELECTEUR_TEMOIN}{color:red}`);
    ecrire(
      'asset-manifest.json',
      JSON.stringify({
        fichiers: {
          [POINT_ENTREE_TRAVAILLEUR.script]: 'a'.repeat(64),
          [POINT_ENTREE_TRAVAILLEUR.style]: 'b'.repeat(64),
        },
      })
    );
  };

  beforeEach(() => {
    racine = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-og-artefact-'));
  });

  afterEach(() => {
    fs.rmSync(racine, { recursive: true, force: true });
  });

  it('accepte un artefact complet', () => {
    artefactValide();

    expect(verifierArtefacts(racine)).toEqual([]);
  });

  it('refuse un boot absent, ou pointant vers un fichier absent', () => {
    artefactValide();
    fs.rmSync(path.join(racine, POINT_ENTREE_TRAVAILLEUR.script.replace(/^\//, '')));
    expect(verifierArtefacts(racine).join('\n')).toMatch(/absent du build/);

    ecrire(POINT_ENTREE_TRAVAILLEUR.script.replace(/^\//, ''), 'import"/assets/inconnu.js";\n');
    expect(verifierArtefacts(racine).join('\n')).toMatch(/ABSENT du build/);
  });

  it('refuse un boot qui importerait une entrée hors de /assets/', () => {
    artefactValide();
    ecrire(POINT_ENTREE_TRAVAILLEUR.script.replace(/^\//, ''), 'import"/boot/autre.js";\n');

    expect(verifierArtefacts(racine).join('\n')).toMatch(/hors de \/assets\//);
  });

  it('refuse une feuille absente ou étrangère à l’application', () => {
    artefactValide();
    ecrire(POINT_ENTREE_TRAVAILLEUR.style.replace(/^\//, ''), 'body{margin:0}');
    expect(verifierArtefacts(racine).join('\n')).toMatch(/feuille de l’application/);

    fs.rmSync(path.join(racine, POINT_ENTREE_TRAVAILLEUR.style.replace(/^\//, '')));
    expect(verifierArtefacts(racine).join('\n')).toMatch(/SANS style/);
  });

  it('refuse un manifeste qui n’ancre pas les deux fichiers', () => {
    artefactValide();
    ecrire('asset-manifest.json', JSON.stringify({ fichiers: {} }));

    const texte = verifierArtefacts(racine).join('\n');
    expect(texte).toMatch(/n’est pas dans asset-manifest\.json/);
  });
});

describe('check-worker-og-contract — un interpréteur absent ne passe pas en silence', () => {
  it('échoue en CI, avise seulement ailleurs', () => {
    const vide = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-og-contract-'));
    try {
      const previous = process.env.CI;
      try {
        process.env.CI = 'true';
        const enCi = runWorkerOgContractCheck({ root: vide, base: BASE, quiet: true });
        expect(enCi.ok).toBe(false);
        expect(enCi.errors.join('\n')).toMatch(/n'a donc PAS été vérifié/);

        delete process.env.CI;
        const horsCi = runWorkerOgContractCheck({ root: vide, base: BASE, quiet: true });
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
