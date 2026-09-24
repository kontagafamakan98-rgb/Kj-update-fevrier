import { execFile } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  CHAMPS_REF_DISTANTE,
  actionsDesArguments,
  checkTestEnvironment,
  main,
  mesurerBranches,
  verdictDeLaPasse,
} from '../check-test-environment.js';
import { main as mainGitBranches } from '../check-git-branches.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('check-test-environment', () => {
  it('détecte réellement un serveur local resté ouvert', async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      const issues = await checkTestEnvironment({
        ports: [{ port, owner: 'fixture de test' }],
        previewUrls: [],
      });
      expect(issues).toEqual([`serveur de test encore ouvert sur le port ${port} (fixture de test)`]);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('refuse une Preview qui vient réellement de fermer', async () => {
    const server = createServer((_req, res) => res.end('ok'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

    const url = `http://127.0.0.1:${port}/`;
    const issues = await checkTestEnvironment({ ports: [], previewUrls: [url] });
    expect(issues).toEqual([`onglet Preview sans serveur joignable : ${url}`]);
  });

  it('considère une réponse HTTP réelle, même 404, comme un serveur vivant', async () => {
    const server = createServer((_req, res) => { res.statusCode = 404; res.end('not found'); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      const issues = await checkTestEnvironment({
        ports: [],
        previewUrls: [`http://127.0.0.1:${port}/unknown`],
      });
      expect(issues).toEqual([]);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('exige une déclaration explicite des onglets de Preview', async () => {
    expect(actionsDesArguments(['--no-preview-tabs'])).toEqual({ avantPush: false, previewUrls: [] });
    expect(actionsDesArguments(['--preview-url', 'http://127.0.0.1:4174/'])).toEqual({
      avantPush: false,
      previewUrls: ['http://127.0.0.1:4174/'],
    });
    expect(() => actionsDesArguments([])).toThrow('--preview-url URL');
    expect(() =>
      actionsDesArguments(['--no-preview-tabs', '--preview-url', 'http://127.0.0.1:4174/']),
    ).toThrow('ne peut pas être combiné');
    expect(await checkTestEnvironment({ ports: [], previewUrls: ['ftp://invalid'] })).toEqual([
      'URL de Preview invalide : ftp://invalid',
    ]);
  });

  it('le pré-vol de push n’a rien à déclarer, et ne mélange pas les deux modes', () => {
    // C'est l'invocation exacte du hook : sans argument d'environnement.
    expect(actionsDesArguments(['--avant-push'])).toEqual({ avantPush: true, previewUrls: [] });
    expect(() =>
      actionsDesArguments(['--avant-push', '--preview-url', 'http://127.0.0.1:4174/']),
    ).toThrow('--avant-push ne se combine pas');
    expect(() => actionsDesArguments(['--avant-push', '--no-preview-tabs'])).toThrow(
      '--avant-push ne se combine pas',
    );
  });
});

// ── Le partage « ce qui bloque / ce qui est rappelé » : un seul domicile ─────
describe('check-test-environment — le verdict selon le mode', () => {
  const residus = ['branche locale « refonte » : son arbre est identique à main (fusion par squash), …'];
  const environnement = ['serveur de test encore ouvert sur le port 8000 (CI local backend)'];

  it('en fin de passe, tout compte', () => {
    const verdict = verdictDeLaPasse({ avantPush: false, branches: { issues: residus }, environnement });
    expect(verdict.bloquants).toEqual([...residus, ...environnement]);
    expect(verdict.rappels).toEqual([]);
  });

  it('en pré-vol de push, les résidus de passe bloquent', () => {
    const verdict = verdictDeLaPasse({ avantPush: true, branches: { issues: residus }, environnement });
    expect(verdict.bloquants).toEqual(residus);
    expect(verdict.rappels).toEqual(environnement);
  });

  it('en pré-vol de push, un serveur de dev ouvert ne bloque pas — il est rappelé', () => {
    // Le cas qui décide de la valeur du garde : travailler avec un serveur ouvert
    // est légitime. Bloquer là-dessus n'apprend rien, sinon à pousser avec
    // --no-verify — c'est-à-dire à ignorer le garde.
    const verdict = verdictDeLaPasse({ avantPush: true, branches: { issues: [] }, environnement });
    expect(verdict.bloquants).toEqual([]);
    expect(verdict.rappels).toEqual(environnement);
  });
});

// ── Branches locales ET distantes : le lecteur de git est injecté ─────────────────────────
// Chaque cas limite tient en un tableau, sans créer un dépôt par situation. Ce
// que la fixture ne peut PAS fabriquer — un état que git PRODUIT : `[gone]`
// après la suppression d'une réf distante, ou une réf distante sans homologue
// local — est lu sur un vrai dépôt et un vrai distant, dans le describe suivant.
function fauxGit(table) {
  return (args) => {
    const commande = args.join(' ');
    // Le préfixe le PLUS LONG gagne : les deux lectures de refs partagent
    // `for-each-ref`, et un catch-all qui répondrait aux deux ferait lire la
    // même fixture des deux côtés — le « vert sans lecture » que ce garde existe
    // précisément pour empêcher.
    const prefixe = Object.keys(table)
      .filter((debut) => commande.startsWith(debut))
      .sort((a, b) => b.length - a.length)[0];
    if (!prefixe) throw new Error(`commande non prévue par la fixture : ${commande}`);
    return { ok: true, lignes: [], erreur: '', ...table[prefixe] };
  };
}

const ORIGIN_HEAD = { 'symbolic-ref --short refs/remotes/origin/HEAD': { lignes: ['origin/main'] } };
const COMMANDE_DISTANTE = `for-each-ref --format=${CHAMPS_REF_DISTANTE} refs/remotes`;

function mesurer(branches, lire = {}, distantes = []) {
  return mesurerBranches({
    cwd: 'dépôt-fixture',
    lire: fauxGit({
      ...ORIGIN_HEAD,
      'for-each-ref': { lignes: branches },
      [COMMANDE_DISTANTE]: { lignes: distantes },
      ...lire,
    }),
  });
}

const FUSION_PAR_SQUASH = {
  'rev-list --left-right --count main...refonte': { lignes: ['0\t1'] },
  'diff --quiet main refonte': { ok: true },
};

const REFONTE_EST_LA = [
  'branche locale « refonte » : son arbre est identique à main (fusion par squash), ' +
    'et sa réf distante « origin/refonte » a disparu — la supprimer (git branch -D refonte)',
];

describe('check-test-environment — branches locales', () => {
  it('nomme une branche fusionnée par squash dont la réf distante a disparu', () => {
    const { issues, examinees } = mesurer(
      ['main\torigin/main\t\t*', 'refonte\torigin/refonte\t[gone]\t '],
      FUSION_PAR_SQUASH,
    );
    expect(examinees).toBe(1);
    expect(issues).toEqual(REFONTE_EST_LA);
  });

  it('nomme une branche dont les commits sont déjà dans la base', () => {
    const { issues } = mesurer(['main\torigin/main\t\t*', 'fusion\torigin/fusion\t[gone]\t '], {
      'rev-list --left-right --count main...fusion': { lignes: ['0\t0'] },
    });
    expect(issues).toEqual([
      'branche locale « fusion » : ses commits sont déjà dans main, ' +
        'et sa réf distante « origin/fusion » a disparu — la supprimer (git branch -D fusion)',
    ]);
  });

  it('laisse une branche encore présente sur le distant', () => {
    // Aucune commande n'est prévue pour elle : la fixture refuse tout appel, donc
    // ce contrôle ne demande rien à git au sujet d’une branche encore distante.
    const { issues, examinees } = mesurer([
      'main\torigin/main\t\t*',
      'encours\torigin/encours\t\t ',
    ]);
    expect(examinees).toBe(1);
    expect(issues).toEqual([]);
  });

  it('laisse une branche dont le contenu n’est pas dans la base', () => {
    const { issues } = mesurer(['main\torigin/main\t\t*', 'non-livree\torigin/non-livree\t[gone]\t '], {
      'rev-list --left-right --count main...non-livree': { lignes: ['0\t1'] },
      'diff --quiet main non-livree': { ok: false },
    });
    expect(issues).toEqual([]);
  });

  it('refuse de se taire quand aucune branche de base n’est identifiable', () => {
    // `origin/HEAD` dit `main`, qu'aucune branche locale n'incarne, et rien n'est
    // coché : sans base, ce contrôle ne peut rien comparer — il le dit.
    const { issues } = mesurer(['b1\torigin/b1\t[gone]\t ']);
    expect(issues).toEqual([
      'branches locales : aucune branche de base (main) parmi 1 branche(s) — le contrôle n\'a rien pu comparer',
    ]);
  });

  it('relaie le verdict des branches avec celui des ports et des onglets', async () => {
    const verdict = mesurer(['main\torigin/main\t\t*', 'refonte\torigin/refonte\t[gone]\t '], FUSION_PAR_SQUASH);
    const issues = await checkTestEnvironment({ ports: [], previewUrls: [], branches: verdict });
    expect(issues).toEqual(REFONTE_EST_LA);
  });
});

// ── Refs distantes : le miroir, quand la branche locale a disparu ────────────
// Mêmes deux conditions, et deux précisions que les cas ci-dessous tiennent : la
// base est celle VUE DU DISTANT (`origin/main` — la fusion y est enregistrée, pas
// forcément dans `main`), et seules les réfs DE CE distant-là sont jugées. La
// partition est stricte — avec homologue local la réf appartient à la lecture
// ci-dessus, sans lui à celle-ci — donc un résidu ne produit jamais deux lignes.
const DISTANTE_REFONTE_EST_LA =
  'réf distante « origin/refonte » : son arbre est identique à origin/main (fusion par squash), ' +
  'et aucune branche locale ne la porte — la retirer (git push origin --delete refonte, ' +
  'ou git remote prune origin si elle a disparu du distant)';

const LOCALES = ['main\torigin/main\t\t*'];
const DISTANTE_ENVOYEE_PAR_SQUASH = {
  'rev-list --left-right --count origin/main...origin/refonte': { lignes: ['0\t1'] },
  'diff --quiet origin/main origin/refonte': { ok: true },
};

describe('check-test-environment — refs distantes sans branche locale', () => {
  it('nomme une réf distante fusionnée que plus aucune branche locale ne porte', () => {
    const { issues, distantes } = mesurer(LOCALES, DISTANTE_ENVOYEE_PAR_SQUASH, [
      'origin/main\t',
      'origin/refonte\t',
    ]);
    expect(distantes).toBe(1);
    expect(issues).toEqual([DISTANTE_REFONTE_EST_LA]);
  });

  it('nomme une réf distante dont les commits sont déjà dans la base du distant', () => {
    const { issues } = mesurer(LOCALES, {
      'rev-list --left-right --count origin/main...origin/fusion': { lignes: ['0\t0'] },
    }, ['origin/main\t', 'origin/fusion\t']);
    expect(issues).toEqual([
      'réf distante « origin/fusion » : ses commits sont déjà dans origin/main, et aucune ' +
        'branche locale ne la porte — la retirer (git push origin --delete fusion, ou ' +
        'git remote prune origin si elle a disparu du distant)',
    ]);
  });

  it('laisse une réf distante dont le contenu n’est pas dans la base (PR encore ouverte)', () => {
    const { issues, distantes } = mesurer(LOCALES, {
      'rev-list --left-right --count origin/main...origin/encours': { lignes: ['0\t3'] },
      'diff --quiet origin/main origin/encours': { ok: false },
    }, ['origin/main\t', 'origin/encours\t']);
    expect(distantes).toBe(1);
    expect(issues).toEqual([]);
  });

  it('ignore la réf symbolique `origin/HEAD` et la base elle-même', () => {
    // Aucune commande n'est prévue pour elles : si elles étaient jugées, la
    // fixture refuserait un appel imprévu au lieu de rester verte.
    const { issues, distantes } = mesurer(LOCALES, {}, [
      'origin/HEAD\trefs/remotes/origin/main',
      'origin/main\t',
    ]);
    expect(distantes).toBe(0);
    expect(issues).toEqual([]);
  });

  it('laisse une réf distante que sa branche locale porte (une seule ligne par résidu)', () => {
    const { issues, distantes } = mesurer(
      ['main\torigin/main\t\t*', 'refonte\torigin/refonte\t[gone]\t '],
      FUSION_PAR_SQUASH,
      ['origin/refonte\t'],
    );
    expect(distantes).toBe(0);
    expect(issues).toEqual(REFONTE_EST_LA);
  });

  it('ne juge pas les réfs d’un autre distant : un checkout de PR n’est pas un résidu', () => {
    // MESURÉ sur ce dépôt : le job de PR laisse `refs/remotes/pull/141/merge` —
    // une réf sans branche locale, sous `refs/remotes/`, qu'aucune passe n'a
    // laissée (log du job `Lighthouse performance budgets`, run de la PR #141).
    // Sans la règle « seules les réfs du distant qui porte la base », ce
    // contrôle refuserait en CI une réf que personne n'a laissée. Aucune
    // commande n'est prévue pour elle : si elle était jugée, la fixture
    // refuserait un appel imprévu au lieu de rester verte.
    const { issues, distantes } = mesurer(LOCALES, {}, ['origin/main\t', 'pull/141/merge\t']);
    expect(distantes).toBe(0);
    expect(issues).toEqual([]);
  });
});

// ── Ce que la fixture ne peut pas fabriquer : l'état que git PRODUIT ─────────
// Un vrai dépôt et un vrai distant, pour les deux traces d'une PR fusionnée. La
// branche poussée puis supprimée sur le distant laisse `[gone]` dans git (mesuré :
// `push origin --delete` retire la réf de suivi, sans `fetch --prune`) ; celle que
// le distant garde alors que la locale a disparu ne laisse rien du tout — c'est
// exactement pourquoi elle est invisible à l'œil nu.
const IDENTITE = ['-c', 'user.email=ci@example.com', '-c', 'user.name=Kojo CI', '-c', 'commit.gpgsign=false'];
const executer = promisify(execFile);

async function git(cwd, ...args) {
  try {
    const { stdout } = await executer('git', [...IDENTITE, ...args], {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    throw new Error(`git ${args.join(' ')} : ${error.stderr?.trim() || error.message}`);
  }
}

/**
 * Le décor des deux scénarios de fusion : un distant nu, une base `main`
 * poussée, et une branche `refonte` qui change le MÊME fichier — de quoi jouer
 * une fusion par squash, c'est-à-dire un contenu identique sous un autre commit.
 */
async function decorDeFusion(prefixe) {
  const racine = mkdtempSync(path.join(tmpdir(), prefixe));
  const distant = path.join(racine, 'distant.git');
  const travail = path.join(racine, 'travail');
  mkdirSync(distant);
  await git(distant, 'init', '--bare', '--quiet');
  mkdirSync(travail);
  await git(travail, 'init', '--initial-branch=main', '--quiet');
  writeFileSync(path.join(travail, 'depart.txt'), 'depart\n');
  await git(travail, 'add', '.');
  await git(travail, 'commit', '-m', 'depart');
  await git(travail, 'remote', 'add', 'origin', distant.replaceAll(path.sep, '/'));
  await git(travail, 'push', '-u', 'origin', 'main');
  await git(travail, 'switch', '-c', 'refonte', 'main');
  writeFileSync(path.join(travail, 'depart.txt'), 'refonte\n');
  await git(travail, 'commit', '-am', 'refonte');
  await git(travail, 'push', '-u', 'origin', 'refonte');
  return { racine, travail };
}

/** La fusion « par squash » : la base reçoit le MÊME contenu sous un autre commit. */
async function fusionnerParSquash(travail) {
  await git(travail, 'switch', 'main');
  writeFileSync(path.join(travail, 'depart.txt'), 'refonte\n');
  await git(travail, 'commit', '-am', 'refonte (squash)');
  await git(travail, 'push', 'origin', 'main');
}

async function nettoyer(racine) {
  try {
    await rm(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Au mieux : un dossier de %TEMP% qu'un verrou transitoire retient n'est
    // pas un résidu du dépôt, il ne fait pas rougir la suite.
  }
}

// Le pré-vol de push, tel qu'il est VERSIONNÉ : les tests ci-dessous l'exécutent
// pour de vrai, à travers un vrai `git push`.
const PRE_PUSH_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.githooks'
);
const PRE_PUSH = path.join(PRE_PUSH_DIR, 'pre-push');

/** Un push RÉEL, dont on veut lire la sortie AU LIEU de lever. */
async function pousser(travail, ...args) {
  try {
    const { stdout, stderr } = await executer('git', [...IDENTITE, 'push', ...args], {
      cwd: travail,
      encoding: 'utf8',
      windowsHide: true,
    });
    return { ok: true, sortie: `${stdout}${stderr}` };
  } catch (error) {
    return { ok: false, sortie: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

describe('check-test-environment — refs sur un vrai dépôt', () => {
  // 60 s : bâtir le dépôt demande une quinzaine d'appels à git, et un runner
  // partagé les ralentit — le défaut de vitest (10 s) ne suffit pas ici.
  it('nomme la branche fusionnée par squash dont la réf distante a disparu', async () => {
    const { racine, travail } = await decorDeFusion('kojo-branches-');
    try {
      // Le distant supprime la sienne, la locale reste : la marque `[gone]`.
      await git(travail, 'push', 'origin', '--delete', 'refonte');
      await fusionnerParSquash(travail);

      expect(mesurerBranches({ cwd: travail }).issues).toEqual(REFONTE_EST_LA);
    } finally {
      await nettoyer(racine);
    }
  }, 60_000);

  it('nomme la réf distante que plus aucune branche locale ne porte', async () => {
    const { racine, travail } = await decorDeFusion('kojo-distante-');
    try {
      // L'inverse : la branche locale est supprimée, celle du distant reste.
      await git(travail, 'switch', 'main');
      await git(travail, 'branch', '-D', 'refonte');
      await fusionnerParSquash(travail);

      expect(mesurerBranches({ cwd: travail }).issues).toEqual([DISTANTE_REFONTE_EST_LA]);
    } finally {
      await nettoyer(racine);
    }
  }, 60_000);
});

// ── Le pré-vol de push : la même lecture, mais qui BLOQUE un push ─────────────
// Ces cas n'exécutent pas une copie du hook : ils pointent `core.hooksPath` sur
// le `.githooks/pre-push` versionné et poussent pour de vrai. Une régression du
// hook (droit d'exécution perdu, code de sortie inversé) se voit donc ici, dans
// un vrai `git push`, pas dans une simulation.
describe('check-test-environment — le pré-vol de push', () => {
  // Le décor commun des deux cas : le résidu EST en place (réf distante livrée,
  // aucune branche locale ne la porte) et un commit attend d'être poussé.
  async function avecResiduLivré(prefixe) {
    const { racine, travail } = await decorDeFusion(prefixe);
    await git(travail, 'config', 'core.hooksPath', PRE_PUSH_DIR.replaceAll(path.sep, '/'));
    await git(travail, 'switch', 'main');
    await git(travail, 'branch', '-D', 'refonte');
    // Ce push-là est encore permis : le contenu vient seulement d'arriver dans la
    // base, donc la réf distante n'est pas encore « livrée ».
    await fusionnerParSquash(travail);
    writeFileSync(path.join(travail, 'depart.txt'), 'suite\n');
    await git(travail, 'commit', '-am', 'suite');
    return { racine, travail };
  }

  it('refuse un push qui publierait un résidu de passe, en le nommant', async () => {
    const { racine, travail } = await avecResiduLivré('kojo-pre-vol-');
    try {
      const refuse = await pousser(travail, 'origin', 'main');
      // La sortie du push est portée par l'assertion : un rouge doit dire POURQUOI
      // le pré-vol a laissé passer, pas seulement qu'il l'a fait.
      expect(refuse.ok, refuse.sortie).toBe(false);
      expect(refuse.sortie).toContain('réf distante « origin/refonte »');
      expect(refuse.sortie).toContain('push ANNULÉ par le pré-vol');
    } finally {
      await nettoyer(racine);
    }
  }, 60_000);

  it('laisse passer le nettoyage qu’il réclame : une suppression seule', async () => {
    // Le remède que le garde NOMME (« git push origin --delete ») est lui-même un
    // push. Le refuser rendrait le pré-vol incompatible avec le nettoyage qu'il
    // exige, et le seul chemin restant serait `--no-verify` — c'est-à-dire
    // l'ignorer. Une suppression ne publie rien : elle passe.
    const { racine, travail } = await avecResiduLivré('kojo-pre-vol-nettoyage-');
    try {
      const nettoyage = await pousser(travail, 'origin', '--delete', 'refonte');
      expect(nettoyage.ok, nettoyage.sortie).toBe(true);
      expect(nettoyage.sortie).toContain('suppression seule');
      // Et le push suivant, qui publie du travail, n'est plus retenu.
      const apres = await pousser(travail, 'origin', 'main');
      expect(apres.ok, apres.sortie).toBe(true);
    } finally {
      await nettoyer(racine);
    }
  }, 60_000);

  it('refuse au lieu de laisser passer quand il ne peut pas lire son sujet', async () => {
    const { racine, travail } = await decorDeFusion('kojo-pre-vol-aveugle-');
    const hooks = path.join(racine, 'hooks-sans-script');
    try {
      mkdirSync(hooks, { recursive: true });
      const hookDest = path.join(hooks, 'pre-push');
      copyFileSync(PRE_PUSH, hookDest);
      try {
        chmodSync(hookDest, 0o755);
      } catch {
        // Sous Windows non supporté, pas bloquant
      }
      await git(travail, 'config', 'core.hooksPath', hooks.replaceAll(path.sep, '/'));
      writeFileSync(path.join(travail, 'depart.txt'), 'suite\n');
      await git(travail, 'commit', '-am', 'suite');

      const refuse = await pousser(travail, 'origin', 'main');
      expect(refuse.ok).toBe(false);
      expect(refuse.sortie).toContain('introuvable');
    } finally {
      await nettoyer(racine);
    }
  }, 60_000);

  it('est armé par la seule chose qui le rend actif : core.hooksPath', () => {
    // Un hook versionné ne s'exécute que si le clone le pointe. L'armement est
    // donc une propriété à surveiller : le retirer éteindrait le pré-vol sans
    // qu'aucun test ne s'en aperçoive.
    const paquet = JSON.parse(readFileSync(path.join(FRONTEND_DIR, 'package.json'), 'utf8'));
    expect(paquet.scripts.prepare).toContain('core.hooksPath .githooks');
  });
});

// ── Exécution directe : main() refuse si git est illisible ────────────────────
describe('check-test-environment et check-git-branches — exécution de main()', () => {
  it('échoue proprement dans check-test-environment quand git est illisible', async () => {
    const erreurs = [];
    const origError = console.error;
    console.error = (msg) => erreurs.push(msg);
    try {
      const ok = await main(['--no-preview-tabs'], {
        cwd: tmpdir(),
        mesurer: () => {
          throw new Error('fatal: not a git repository');
        },
      });
      expect(ok).toBe(false);
      expect(erreurs.some((e) => e.includes('lecture impossible'))).toBe(true);
    } finally {
      console.error = origError;
    }
  });

  it('échoue proprement dans check-git-branches quand git est illisible', async () => {
    const erreurs = [];
    const origError = console.error;
    console.error = (msg) => erreurs.push(msg);
    try {
      const ok = await mainGitBranches([], {
        cwd: tmpdir(),
        mesurer: () => {
          throw new Error('fatal: not a git repository');
        },
      });
      expect(ok).toBe(false);
      expect(erreurs.some((e) => e.includes('lecture impossible'))).toBe(true);
    } finally {
      console.error = origError;
    }
  });

  it('valide l’hygiène des branches sur le dépôt réel sans erreur', async () => {
    const ok = await mainGitBranches([], { cwd: path.resolve(FRONTEND_DIR, '..') });
    expect(ok).toBe(true);
  });

  it('écrit un résumé Markdown dans $GITHUB_STEP_SUMMARY si renseigné', async () => {
    const fichierTemp = path.join(tmpdir(), `summary-${Date.now()}.md`);
    try {
      const ok = await mainGitBranches([], {
        cwd: tmpdir(),
        mesurer: () => ({ issues: [], examinees: 3, distantes: 2 }),
        stepSummaryPath: fichierTemp,
      });
      expect(ok).toBe(true);
      const contenu = readFileSync(fichierTemp, 'utf8');
      expect(contenu).toContain('Hygiène des branches et réfs distantes');
      expect(contenu).toContain('3 branche(s) locale(s)');
      expect(contenu).toContain('2 réf(s) distante(s)');
    } finally {
      await rm(fichierTemp, { force: true });
    }
  });
});
