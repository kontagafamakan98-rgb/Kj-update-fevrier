// Le lint des workflows, du côté où il est JUGÉ — pas seulement écrit.
//
// Ce fichier prouve trois choses, et chacune a coûté un défaut réel :
//
//  1. l'EXTRACTION lit les blocs `run:` avec leur ligne ABSOLUE et remplace les
//     `${{ … }}` par un jeton inerte. Sans le remplacement, `${{ secrets.X }}`
//     remonte en faux positif : un pré-vol qui refuse du travail sain apprend
//     à être contourné ;
//  2. `set -e` est ajouté avant de déléguer, parce que les steps tournent sous
//     `bash -e {0}` : mesuré, sans lui le `cd ../frontend` de `ci.yml` remonte
//     en SC2164, un écart que la CI ne voit pas ;
//  3. avec le VRAI shellcheck, la commande refuse un `$(date +%F)` non quoté
//     (SC2046) en nommant la ligne du YAML — c'est le défaut qui est parti en
//     CI le 19/10/2026 sur `.github/workflows/backup-db.yml`.
//
// Le parcours complet (un push REFUSÉ pour de vrai, par `.githooks/pre-push`)
// vit dans `scripts/__tests__/check-test-environment.test.js`, qui possède déjà
// le décor de vrai dépôt : c'est le même hook, et sa preuve doit rester une.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  EXCLUSIONS,
  JETON_EXPRESSION,
  blocsDeRun,
  fichiersDuPush,
  main,
  outils,
  shellNormalise,
  substituerExpressions,
} from '../check-workflows-lint.mjs';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'check-workflows-lint.mjs',
);
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const FIXTURE = [
  'name: fixture', // 1
  'on: workflow_dispatch', // 2
  'jobs:', // 3
  '  j:', // 4
  '    runs-on: ubuntu-latest', // 5
  '    steps:', // 6
  '      - name: bloc', // 7
  '        run: |', // 8
  '          echo "${{ secrets.MONGO_URL }}"', // 9
  '          echo fin', // 10
  '', // 11
  '      - name: en ligne', // 12
  '        run: echo ok', // 13
  '', // 14
  '      - name: powershell', // 15
  '        shell: pwsh', // 16
  '        run: Write-Host ok', // 17
  '      - name: shell absolu', // 18
  '        shell: /usr/bin/bash -e {0}', // 19
  '        run: |', // 20
  '          cd dossier', // 21
  '          make', // 22
].join('\n');

const dossiers = [];

function dossier() {
  const chemin = mkdtempSync(path.join(tmpdir(), 'kojo-lint-'));
  dossiers.push(chemin);
  return chemin;
}

afterAll(() => {
  for (const chemin of dossiers) rmSync(chemin, { recursive: true, force: true });
});

function workflow(contenu, nom = 'essai.yml') {
  const fichier = path.join(dossier(), nom);
  writeFileSync(fichier, contenu, 'utf8');
  return fichier;
}

/** Lance la commande RÉELLE (code de sortie, stdout, stderr), sans lever. */
function lancer(args, env = {}, cwd = undefined) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, sortie: stdout };
  } catch (erreur) {
    return { code: erreur.status ?? -1, sortie: `${erreur.stdout || ''}${erreur.stderr || ''}` };
  }
}

const SHELLCHECK = outils().shellcheck;
const sansShellcheck = SHELLCHECK ? it : it.skip;

describe('check-workflows-lint — les blocs run: et leurs lignes', () => {
  it('extrait chaque bloc avec sa ligne ABSOLUE dans le YAML', () => {
    const blocs = blocsDeRun(FIXTURE);
    expect(blocs.map((b) => b.ligne)).toEqual([9, 13, 17, 21]);
    expect(blocs[0].script).toBe(`echo "${JETON_EXPRESSION}"\necho fin`);
    expect(blocs[1].script).toBe('echo ok');
  });

  it('n’envoie à shellcheck que les shells qu’il sait lire', () => {
    const blocs = blocsDeRun(FIXTURE);
    // pwsh : extrait (sa ligne compte) mais `shell: null` → non jugé.
    expect(blocs[2].shell).toBeNull();
    expect(blocs[2].shellBrut).toBe('pwsh');
    // Un chemin absolu et un `{0}` restent du bash.
    expect(blocs[3].shell).toBe('bash');
  });

  it('remplace les expressions GitHub, jamais par du vide', () => {
    // Une substitution par des espaces casserait `[ "${{ x }}" = … ]` ; une
    // suppression laisserait un `$` orphelin. Un mot inerte, lui, ne déclenche
    // ni SC2086 (non quoté) ni SC2050 (condition constante) à sa place.
    const sortie = substituerExpressions('if [ "${{ github.sha }}" = "x" ]; then echo ${{ secrets.A }}; fi');
    expect(sortie).not.toContain('${{');
    expect(sortie).toContain(JETON_EXPRESSION);
    expect(sortie.startsWith('if [ "')).toBe(true);
  });

  it('normalise les noms de shell, et refuse ceux qu’il ne lit pas', () => {
    expect(shellNormalise(undefined)).toBe('bash');
    expect(shellNormalise('bash -e {0}')).toBe('bash');
    expect(shellNormalise('/usr/bin/bash')).toBe('bash');
    expect(shellNormalise('sh')).toBe('sh');
    expect(shellNormalise('pwsh')).toBeNull();
    expect(shellNormalise('python')).toBeNull();
  });
});

describe('check-workflows-lint — les fichiers d’un push', () => {
  const refs = (locale, local, distante, distanteOid) =>
    `${locale} ${local} ${distante} ${distanteOid}\n`;

  it('ne retient que les workflows touchés par la plage poussée', () => {
    const vus = [];
    const { fichiers } = fichiersDuPush(refs('refs/heads/main', 'a'.repeat(40), 'refs/heads/main', 'b'.repeat(40)), {
      executer: (_cmd, args) => {
        vus.push(args);
        return '.github/workflows/x.yml\nfrontend/src/App.js\n.github/workflows/y.yaml\n';
      },
    });
    expect(fichiers).toEqual(['.github/workflows/x.yml', '.github/workflows/y.yaml']);
    expect(vus[0]).toEqual(['diff', '--name-only', `${'b'.repeat(40)}..${'a'.repeat(40)}`]);
  });

  it('juge TOUT quand la base est inconnue — jamais rien', () => {
    // Un premier push de branche n'a pas de base : ne rien juger serait le
    // silence que ce garde existe pour empêcher.
    const { fichiers, motif } = fichiersDuPush(
      refs('refs/heads/refonte', 'a'.repeat(40), 'refs/heads/refonte', '0'.repeat(40)),
      { executer: () => { throw new Error('pas de base'); } },
    );
    expect(fichiers).toBeNull();
    expect(motif).toContain('base inconnue');
  });

  it('ne juge rien quand aucune réf de branche n’est publiée', () => {
    expect(fichiersDuPush('', {}).fichiers).toEqual([]);
  });
});

describe('check-workflows-lint — la commande', () => {
  it('refuse d’annoncer un vert sans shellcheck, en nommant l’outil', () => {
    const fichier = workflow(FIXTURE);
    const { code, sortie } = lancer(['--files', fichier], { KOJO_SHELLCHECK: '/introuvable/shellcheck' });
    expect(code).toBe(2);
    expect(sortie).toContain('shellcheck introuvable');
    // Le remède est nommé : un refus qui n'en donne pas un est un mur.
    expect(sortie).toContain('KOJO_SHELLCHECK');
  });

  it('déclare actionlint absent au lieu de laisser croire qu’il a jugé', () => {
    const fichier = workflow(FIXTURE);
    const { sortie } = lancer(['--files', fichier], {
      KOJO_SHELLCHECK: SHELLCHECK || '/introuvable/shellcheck',
      KOJO_ACTIONLINT: '/introuvable/actionlint',
    });
    expect(sortie).toContain('[NON MESURÉ] actionlint absent');
  });

  sansShellcheck('refuse un SC2046 en nommant la ligne du YAML', () => {
    // Le défaut mesuré le 19/10/2026 : `$(date +%F)` sans guillemets dans une
    // commande qui ÉCRIT un fichier. On rejoue exactement ce geste.
    const fichier = workflow(
      [
        'name: sauvegarde',
        'on: workflow_dispatch',
        'jobs:',
        '  j:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: rapport',
        '        run: |',
        '          python outil.py --rapport /tmp/r-$(date +%F).json',
      ].join('\n'),
    );
    const { code, sortie } = lancer(['--files', fichier], { KOJO_ACTIONLINT: '/introuvable/actionlint' });
    expect(code, sortie).toBe(1);
    expect(sortie).toContain('SC2046');
    // Ligne 9 : celle du YAML, pas celle du bloc. Sans cette exactitude, le
    // refus oblige à rouvrir le fichier pour savoir de quoi il parle.
    expect(sortie).toContain(`${fichier}:9`);
    expect(sortie).toContain('la CI refusera ce workflow');
  });

  sansShellcheck('accepte un workflow sain, y compris son `cd` sans garde', () => {
    // `set -e` rend `cd` légitime : la CI ne signale pas SC2164, le pré-vol ne
    // doit pas être plus sévère qu'elle — mesuré sur le `cd ../frontend` de
    // `ci.yml`, qui remontait avant l'ajout de `set -e`.
    const fichier = workflow(
      [
        'name: sain',
        'on: workflow_dispatch',
        'jobs:',
        '  j:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: enchaînement',
        '        run: |',
        '          cd sous-dossier',
        '          python outil.py --rapport "/tmp/r-$(date +%F).json"',
      ].join('\n'),
    );
    const { code, sortie } = lancer(['--files', fichier], { KOJO_ACTIONLINT: '/introuvable/actionlint' });
    expect(code, sortie).toBe(0);
    expect(sortie).toContain('[OK] 1 bloc(s) run: jugé(s)');
  });

  sansShellcheck('le dépôt lui-même passe — le parité avec la CI, mesurée', () => {
    // 125 blocs le 19/10/2026. Ce cas attrape un faux positif introduit dans
    // l'extraction (exclusions retirées, `set -e` oublié, expressions non
    // remplacées) : la CI serait verte, le pré-vol refuserait tout le monde.
    const { code, sortie } = lancer([], { KOJO_ACTIONLINT: '/introuvable/actionlint' }, RACINE);
    expect(code, sortie).toBe(0);
    expect(sortie).toContain('[OK]');
  });

  it('les exclusions sont celles d’actionlint, pas un choix local', () => {
    // Elles sont recopiées de son comportement mesuré : les changer sans le
    // mesurer rendrait le pré-vol différent de la CI dans un sens ou dans
    // l'autre. La liste est figée ici pour que le changement soit visible.
    expect(EXCLUSIONS).toBe('SC1091,SC2194,SC2050,SC2154,SC2157');
  });
});

describe('check-workflows-lint — l’entrée du pré-vol', () => {
  it('lit les réfs depuis l’environnement du hook, jamais d’un argument', () => {
    // L'appel du hook est `node <script> --from-push` : la mutation déclarée
    // sur `.githooks/pre-push` vise cette ligne, donc elle ne doit pas porter
    // de charge utile qui la réécrirait.
    const hook = readFileSync(path.join(RACINE, '.githooks', 'pre-push'), 'utf8');
    expect(hook).toContain('node "$script_lint" --from-push');
    expect(hook).toContain('KOJO_REFS_DU_PUSH');
    // Et le pré-vol refuse un lint qui n'a pas pu juger (sortie 2), pas
    // seulement un lint qui a trouvé un écart.
    expect(hook).toContain('le lint des workflows n\'a pas pu juger');
  });

  it('la commande est joignable sans passer par le hook', () => {
    const paquet = JSON.parse(
      readFileSync(path.join(RACINE, 'frontend', 'package.json'), 'utf8'),
    );
    expect(paquet.scripts['lint:workflows']).toBe('node scripts/check-workflows-lint.mjs');
  });
});
