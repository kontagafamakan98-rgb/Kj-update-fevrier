/**
 * PREUVE D'ÉCHEC de `check-corpus-missions.js` (et de la règle qu'il porte,
 * `corpus-missions.js`) : chaque refus de l'inventaire est éprouvé sur un
 * inventaire INJECTÉ, et l'arbre RÉEL est jugé tel qu'il est.
 *
 * Ce que la preuve couvre, et par quel chemin :
 *   • l'audit PUR (`auditerInventaire`, inventaire injectable) pour chaque
 *     refus : déclaration périmée, sonde muette, sonde qui ne consulte pas le
 *     registre, lecture non déclarée, motif/remède/date trop courts, planchers ;
 *   • le CLI réel, exécuté en sous-processus sur l'arbre réel : il publie son
 *     inventaire et sort en 0.
 *
 * Limite assumée et écrite : le CHEMIN D'ÉCHEC du CLI (sortie 1 sur un
 * inventaire cassé) n'est pas rejoué ici en sous-processus — il faudrait une
 * arborescence de scripts entière, où le garde irait chercher le registre à un
 * chemin fixe. Ce chemin est prouvé par les cas d'audit ci-dessus ET par les
 * mutations du registre (`guard-proofs.json`), qui neutralisent une règle et
 * exigent que CE fichier rougisse en la nommant.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CORPUS,
  DATE_ISO,
  LONGUEURS,
  PLANCHERS_LECTURE,
  REGISTRE,
  SONDES,
  SURFACES,
  auditerInventaire,
  litLeCorpus,
  nomDeLaConstante,
  sansCommentaires,
  verdictDeSurfaceVide,
} from '../corpus-missions.js';
import { fichiersBalayes, verifierInventaire } from '../check-corpus-missions.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(ICI, '..');
const DEPOT = path.resolve(SCRIPTS, '..', '..');

// La surface dont le cas d'arborescence cassée retire la consultation.
const SURFACE_TESTEE = SURFACES[0].cle;

/** La source RÉELLE du registre : les cas d'inventaire la lisent, jamais une copie. */
const sourceDuRegistre = () => fs.readFileSync(path.join(SCRIPTS, 'corpus-missions.js'), 'utf8');

/** Une sonde MINIMALE mais conforme : elle lit le corpus, consulte, et publie. */
const sourceDeSonde = (fichier) => {
  const { surfaces } = SONDES[fichier];
  return [
    `import { ${surfaces.map(nomDeLaConstante).join(', ')}, verdictDeSurfaceVide } ` +
      "from './corpus-missions.js';",
    'const res = await fetchImpl(`${BACKEND}/api/jobs?limit=1`);',
    ...surfaces.map(
      (cle) => `const verdict = verdictDeSurfaceVide({ cle: ${nomDeLaConstante(cle)} });`
    ),
    "console.log('::warning title=Surface aveugle (corpus vide)::…');",
  ].join('\n');
};

/** L'inventaire conforme : registre réel + une sonde conforme par sonde déclarée. */
const inventaire = (extras = {}) => ({
  [REGISTRE]: sourceDuRegistre(),
  ...Object.fromEntries(Object.keys(SONDES).map((fichier) => [fichier, sourceDeSonde(fichier)])),
  ...extras,
});

/** Les refus d'un inventaire, en une chaîne — le procédé des autres preuves du dépôt. */
const refusDe = (sources, inventaireJuge) =>
  auditerInventaire(sources, inventaireJuge).refus.join('\n');

// Une surface de remplacement, pour les cas de FORME de la déclaration : elle
// reprend la première du registre et n'en change qu'un champ.
const surfaceModifiee = (champs) => [{ ...SURFACES[0], ...champs }];

describe('check-corpus-missions — l’arbre réel', () => {
  it('l’inventaire RÉEL tient : chaque lecture du corpus est déclarée et chaque déclaration est demandée', () => {
    const { refus, lues, fichiers } = verifierInventaire();
    expect(refus).toEqual([]);
    expect(lues.sondes).toBe(Object.keys(SONDES).length);
    expect(lues.surfaces).toBe(SURFACES.length);
    expect(lues.corpus).toBe(Object.keys(CORPUS).length);
    expect(fichiers.length).toBe(lues.fichiers);
    expect(lues.fichiers).toBeGreaterThanOrEqual(PLANCHERS_LECTURE.fichiers);
  });

  it('le registre déclare ses clés par des constantes exportées, et chaque sonde les nomme', () => {
    // Le lien registre ↔ sonde est ce qui autorise une sonde à ne pas recopier sa
    // clé : il est vérifié ici comme le garde le vérifie, sur les sources réelles.
    const registre = sourceDuRegistre();
    for (const surface of SURFACES) {
      expect(registre).toContain(`export const ${nomDeLaConstante(surface.cle)} = '${surface.cle}'`);
      const source = fs.readFileSync(path.join(DEPOT, surface.sonde), 'utf8');
      expect(source).toContain(nomDeLaConstante(surface.cle));
    }
  });

  it('chaque surface déclarée a un motif, un remède et une date qui disent quelque chose', () => {
    for (const surface of SURFACES) {
      expect(surface.motif.length, surface.cle).toBeGreaterThanOrEqual(LONGUEURS.motif);
      expect(surface.remede.length, surface.cle).toBeGreaterThanOrEqual(LONGUEURS.remede);
      expect(surface.depuis, surface.cle).toMatch(DATE_ISO);
      expect(CORPUS[surface.corpus], surface.cle).toBeTruthy();
    }
  });

  it('les sondeurs de production déclarés sont exactement les fichiers qui lisent le corpus', () => {
    const lecteurs = fichiersBalayes()
      .filter((nom) => nom !== path.basename(REGISTRE))
      .filter((nom) => litLeCorpus(fs.readFileSync(path.join(SCRIPTS, nom), 'utf8')))
      .map((nom) => `${REGISTRE.split('/').slice(0, -1).join('/')}/${nom}`)
      .sort();
    expect(lecteurs).toEqual(Object.keys(SONDES).sort());
  });

  it('sur une arborescence de scripts CASSÉE, le verdict nomme la faute', () => {
    // Le CHEMIN D'ÉCHEC du garde, sur une arborescence TEMPORAIRE : les trois
    // noms de sondes y existent (les clés de SONDES sont des chemins du dépôt),
    // et l'une d'elles a perdu sa consultation du registre. Rien du dépôt n'est
    // touché — c'est le paramètre `racine` du garde qui est exercé.
    const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-corpus-missions-'));
    try {
      for (const fichier of Object.keys(SONDES)) {
        let source = fs.readFileSync(path.join(DEPOT, fichier), 'utf8');
        if (SONDES[fichier].surfaces.includes(SURFACE_TESTEE)) {
          source = source.replaceAll('verdictDeSurfaceVide', 'autreChose');
        }
        fs.writeFileSync(path.join(bac, path.basename(fichier)), source, 'utf8');
      }
      fs.writeFileSync(
        path.join(bac, path.basename(REGISTRE)),
        fs.readFileSync(path.join(SCRIPTS, 'corpus-missions.js'), 'utf8'),
        'utf8'
      );
      const { refus } = verifierInventaire({ racine: bac });
      expect(refus.join('\n')).toContain('ne consulte pas');
      expect(refus.join('\n')).toContain('plancher de lecture non atteint');
    } finally {
      fs.rmSync(bac, { recursive: true, force: true });
    }
  });

  it('le CLI publié sort en 0 et publie son inventaire', () => {
    const execution = spawnSync(process.execPath, ['scripts/check-corpus-missions.js'], {
      cwd: path.join(DEPOT, 'frontend'),
      encoding: 'utf8',
    });
    expect(execution.status, execution.stderr).toBe(0);
    expect(execution.stdout).toContain('surface « og-images:fiche-200 »');
    // Le compte publié est confronté à ce que le registre DÉCLARE (et non à un
    // chiffre recopié ici) : une surface ajoutée change ce compte sans laisser
    // une seconde déclaration à tenir à jour, et un compte FAUX reste rouge.
    expect(execution.stdout).toContain(`${SURFACES.length} surface(s) aveugle(s) déclarée(s)`);
    expect(execution.stdout).toContain(`${Object.keys(SONDES).length} sonde(s)`);
  });
});

describe('check-corpus-missions — refus (inventaire injecté)', () => {
  it('refuse une LECTURE du corpus qui n’est pas déclarée', () => {
    const ligne = refusDe(
      inventaire({
        'frontend/scripts/sonde-non-declaree.js':
          'const r = await fetch(`http://127.0.0.1:4174/api/jobs?limit=1`);',
      })
    );
    expect(ligne).toContain('sans être déclaré dans');
  });

  it('refuse une déclaration PÉRIMÉE : la sonde ne demande plus sa surface', () => {
    const fichier = Object.keys(SONDES)[0];
    const sansLaClé = sourceDeSonde(fichier).replaceAll(
      nomDeLaConstante(SONDES[fichier].surfaces[0]),
      'AUTRE_CHOSE'
    );
    expect(refusDe(inventaire({ [fichier]: sansLaClé }))).toContain('INTROUVABLE dans');
  });

  it('refuse une sonde déclarée qui ne lit PLUS le corpus', () => {
    const fichier = Object.keys(SONDES)[0];
    const sansLecture = sourceDeSonde(fichier).replace('/api/jobs?limit=1', '/sante');
    expect(refusDe(inventaire({ [fichier]: sansLecture }))).toContain('déclaration PÉRIMÉE');
  });

  it('refuse une sonde qui NE CONSULTE PAS le registre', () => {
    const fichier = Object.keys(SONDES)[0];
    const sansConsultation = sourceDeSonde(fichier).replaceAll('verdictDeSurfaceVide', 'autreChose');
    expect(refusDe(inventaire({ [fichier]: sansConsultation }))).toContain('ne consulte pas');
  });

  it('refuse une sonde MUETTE : aucun avertissement publié', () => {
    const fichier = Object.keys(SONDES)[0];
    const sansWarning = sourceDeSonde(fichier).replace('::warning', '::notice');
    expect(refusDe(inventaire({ [fichier]: sansWarning }))).toContain('::warning');
  });

  it('refuse une source ILLISIBLE plutôt que de conclure', () => {
    const fichier = Object.keys(SONDES)[0];
    expect(refusDe(inventaire({ [fichier]: null }))).toContain('illisible');
  });

  it('refuse un MOTIF trop court', () => {
    const refus = refusDe(inventaire(), {
      surfaces: surfaceModifiee({ motif: 'parce que' }),
    });
    expect(refus).toContain('motif de 9 caractère(s)');
  });

  it('refuse un REMÈDE trop court', () => {
    const refus = refusDe(inventaire(), { surfaces: surfaceModifiee({ remede: 'plus tard' }) });
    expect(refus).toContain('remède de 9 caractère(s)');
  });

  it('refuse une date de déclaration qui n’est pas ISO', () => {
    const refus = refusDe(inventaire(), { surfaces: surfaceModifiee({ depuis: 'le 12 octobre' }) });
    expect(refus).toContain('date de déclaration');
  });

  it('refuse un CHEMIN vide : la déclaration ne dit pas quelle surface est aveugle', () => {
    const refus = refusDe(inventaire(), { surfaces: surfaceModifiee({ chemin: '  ' }) });
    expect(refus).toContain('chemin vide');
  });

  it('refuse une clé déclarée DEUX FOIS', () => {
    const premiere = SURFACES[0];
    const refus = refusDe(inventaire(), { surfaces: [premiere, { ...premiere }] });
    expect(refus).toContain('clé vide ou déclarée deux fois');
  });

  it('refuse une surface déclarée par une sonde INCONNUE', () => {
    const refus = refusDe(inventaire(), {
      surfaces: surfaceModifiee({ sonde: 'frontend/scripts/inexistant.js' }),
    });
    expect(refus).toContain("n'est pas déclarée dans SONDES");
  });

  it('refuse une surface dont le corpus n’existe pas', () => {
    const refus = refusDe(inventaire(), { surfaces: surfaceModifiee({ corpus: 'corpus-fantome' }) });
    expect(refus).toContain('inconnu de CORPUS');
  });

  it('refuse une surface que la déclaration de SA sonde ne reconnaît pas', () => {
    const fichier = Object.keys(SONDES)[0];
    const refus = refusDe(inventaire(), {
      sondes: { [fichier]: { ...SONDES[fichier], surfaces: [] } },
      surfaces: [SURFACES.find((s) => s.sonde === fichier)],
    });
    expect(refus).toContain('la déclaration de la sonde ne la reconnaît pas');
  });

  it('refuse une clé de registre sans constante exportée', () => {
    const surface = SURFACES[0];
    const registreSansConstante = sourceDuRegistre().replace(
      `export const ${nomDeLaConstante(surface.cle)} = '${surface.cle}'`,
      'export const AUTRE_NOM = null'
    );
    const refus = refusDe({ ...inventaire(), [REGISTRE]: registreSansConstante });
    expect(refus).toContain("le registre n'exporte pas");
  });

  it('refuse une exemption de registre SANS SUJET (le chemin du corpus a disparu)', () => {
    const registreSansChemin = sourceDuRegistre().replaceAll('/api/jobs', '/autre/route');
    expect(refusDe({ ...inventaire(), [REGISTRE]: registreSansChemin })).toContain(
      "n'a plus de sujet"
    );
  });

  it('refuse un corpus dont le PLANCHER ne refuse rien', () => {
    const refus = refusDe(inventaire(), {
      corpus: { 'missions-vivantes': { ...CORPUS['missions-vivantes'], plancher: 0 } },
    });
    expect(refus).toContain('un plancher sous 1 ne refuse rien');
  });

  it('refuse de conclure SOUS les planchers de lecture', () => {
    const refus = refusDe(inventaire(), {
      corpus: {},
      sondes: {},
      surfaces: [],
      registre: REGISTRE,
    });
    expect(refus).toContain('plancher de lecture non atteint');
  });
});

describe('corpus-missions — le verdict demandé par une sonde', () => {
  it('une surface DÉCLARÉE publie un avertissement, jamais une erreur', () => {
    const verdict = verdictDeSurfaceVide({
      cle: SURFACES[0].cle,
      detail: 'aucune mission servie par http://api.test/api/jobs',
    });
    expect(verdict.declare).toBe(true);
    expect(verdict.erreur).toBe('');
    expect(verdict.avertissement).toContain(SURFACES[0].chemin);
    expect(verdict.avertissement).toContain("n'a PAS été mesurée");
    expect(verdict.avertissement).toContain(SURFACES[0].remede);
  });

  it('une surface NON déclarée REFUSE : le silence d’un vert sans mesure', () => {
    const verdict = verdictDeSurfaceVide({ cle: 'surface-qui-nexiste-pas' });
    expect(verdict.declare).toBe(false);
    expect(verdict.avertissement).toBe('');
    expect(verdict.erreur).toContain('SURFACE AVEUGLE NON DÉCLARÉE');
    expect(verdict.erreur).toContain('surface-qui-nexiste-pas');
  });
});

describe('corpus-missions — ce qui compte comme une lecture', () => {
  it('une phrase de COMMENTAIRE n’est pas une lecture du corpus', () => {
    expect(litLeCorpus('// GET /api/jobs?status=open explique ceci\n/* et /api/jobs aussi */')).toBe(
      false
    );
    expect(litLeCorpus("const texte = '/api/jobs';")).toBe(false);
    expect(litLeCorpus('await fetch(`${base}/api/jobs?limit=1`);')).toBe(true);
    expect(litLeCorpus("export const P = '/api/jobs';\nawait fetchImpl(`${base}${P}`);")).toBe(true);
  });

  it('sansCommentaires garde les chaînes et les sauts de ligne, retire les commentaires', () => {
    const source = "const a = '// pas un commentaire';\n// celui-ci en est un\n/* bloc\nsur deux lignes */\nconst b = `/api/jobs`;";
    const code = sansCommentaires(source);
    expect(code).toContain("'// pas un commentaire'");
    expect(code).toContain('/api/jobs');
    expect(code).not.toContain('celui-ci en est un');
    expect(code).not.toContain('sur deux lignes');
    // Les sauts de ligne survivent : une ligne de commentaire reste une ligne.
    expect(code.split('\n').length).toBe(source.split('\n').length);
  });
});
