#!/usr/bin/env node
// Le MÊME lint des workflows que la CI — avant que le push ne parte.
//
// ── Le trou que ce garde ferme ──────────────────────────────────────────────
// `workflow-lint` (job requis) délègue les blocs `run:` à shellcheck, présent
// sur le runner. Sur un poste de développement, ni actionlint ni shellcheck ne
// le sont : un `$(date +%F)` non quoté (SC2046) passe donc la relecture, part
// en CI, et rougit le job APRÈS le push — mesuré le 19/10/2026 sur
// `.github/workflows/backup-db.yml`, un workflow neuf. Le push avait déjà eu
// lieu : c'est exactement ce que le pré-vol existe pour empêcher.
//
// ── Les DEUX moteurs, et pourquoi dans cet ordre ────────────────────────────
//  1. `actionlint`, s'il est installé : c'est LUI que la CI lance
//     (`rhysd/actionlint@v1.7.12`), et il délègue lui-même les `run:` à
//     shellcheck. Sa sortie nomme fichier, ligne et code — parité exacte.
//  2. `shellcheck` seul, sinon : on EXTRAIT les blocs `run:` et on les lui
//     donne avec `--norc`, son amorce et les SEPT exclusions d'actionlint
//     v1.7.12 (`EXCLUSIONS`, recopiées de `rule_shellcheck.go`), et SANS filtre
//     de sévérité — mesuré : actionlint rapporte aussi les `info:` et les
//     `style:` (SC2086, SC2005), donc filtrer ici rendrait le pré-vol plus
//     indulgent que la CI, ce qui est le défaut à corriger.
//
// `shellcheck` est donc REQUIS (sans lui les `run:` ne sont pas jugés, et
// actionlint se contente de les ignorer) : absent, le pré-vol REFUSE le push
// quand un workflow en fait partie, en nommant l'installation. `actionlint`
// est utilisé s'il est là ; absent, la sortie le DÉCLARE (la structure et les
// expressions restent jugées par la CI) — une surface aveugle se déclare.
//
// ── Ce qui n'est PAS interprété, et se déclare ──────────────────────────────
// `defaults.run.shell` (niveau workflow ou job) et le shell par défaut de
// `runs-on: windows-*` (`pwsh`) demandent une lecture YAML STRUCTURÉE que le
// scanner par indentation ne fait pas. Le dépôt n'en a aucun le 19/10/2026 ;
// le jour où il en aura un, le bloc serait jugé en bash à tort — donc plus
// sévère que la CI, et c'est ce cas que le pré-vol ne doit pas créer.
//
// ── Ce que ce script ne refait pas ──────────────────────────────────────────
// Les `${{ … }}` sont REMPLACÉS par des SOULIGNÉS de même longueur avant
// shellcheck, exactement comme actionlint : sans ça, `${{ secrets.X }}`
// déclenche des faux positifs (« parameter expansion can't start with { ») et
// le pré-vol refuserait du travail sain — une mesure ratée vaut moins qu'une
// mesure absente, parce qu'elle apprend à contourner le garde. La longueur est
// préservée pour que la COLONNE rapportée reste celle du YAML.
//
// Usage :
//   node frontend/scripts/check-workflows-lint.mjs                 (tout)
//   KOJO_REFS_DU_PUSH="<réf> <oid> <réf> <oid>" … --from-push      (pré-vol)
//   node frontend/scripts/check-workflows-lint.mjs --files a.yml b.yml
//
// Sorties : 0 = rien à redire (ou rien à juger), 1 = au moins un écart,
// 2 = prémisse (outil requis absent, fichier illisible) — jamais un vert muet.
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

// Les exclusions d'actionlint v1.7.12 — le tag que la CI épingle —, recopiées
// de `rule_shellcheck.go` et non choisies ici : `$GITHUB_*` est fourni par le
// runner (SC2153/SC2154), les `${{ }}` deviennent des soulignés (SC2050,
// SC2194, SC2157, SC2043), un `source` dynamique n'a pas de sens (SC1091).
// En AJOUTER une rendrait le pré-vol plus indulgent que la CI ; en RETIRER une,
// plus sévère — les deux défauts que ce garde existe pour ne pas créer.
export const EXCLUSIONS = 'SC1091,SC2194,SC2050,SC2153,SC2154,SC2157,SC2043';

// L'amorce qu'actionlint ajoute avant de déléguer, par shell. `pipefail` en plus
// de `-e` pour bash : c'est SON texte, donc ses diagnostics sont les mêmes.

const RUN = /^(\s*)(?:-\s+)?run:\s*(.*?)\s*$/;
const SHELL = /^(\s*)shell:\s*(.+?)\s*$/;
const BLOC = /^[|>][+-]?\d*$/;

/** Remplace chaque `${{ … }}` par des soulignés de MÊME longueur, jamais par du vide. */
export function substituerExpressions(script) {
  return script.replace(/\$\{\{[^}]*\}\}/g, (expression) => '_'.repeat(expression.length));
}

/**
 * `bash`/`sh` quand shellcheck les lit, `null` sinon — la règle d'ACTIONLINT.
 *
 * Elle est plus étroite qu'elle n'en a l'air, et c'est voulu : actionlint
 * n'accepte que `bash`, `sh` et leurs préfixes `bash …` / `sh …`
 * (`rule_shellcheck.go`, `runShellcheck`). Un `shell: /usr/bin/bash -e {0}`,
 * lui, est IGNORÉ par la CI — le juger ici refuserait du travail que la CI
 * accepte, donc un pré-vol plus sévère qu'elle. Le bloc se DÉCLARE non jugé
 * plutôt que de diverger.
 */
export function shellNormalise(brut) {
  if (!brut) return 'bash';
  const valeur = String(brut).trim();
  if (valeur === 'bash' || valeur === 'sh') return valeur;
  if (valeur.startsWith('bash ')) return 'bash';
  if (valeur.startsWith('sh ')) return 'sh';
  return null;
}

/**
 * Les blocs `run:` d'un workflow, avec leur LIGNE absolue dans le fichier.
 *
 * Le scanner est en indentation, pas en YAML : `js-yaml` rend les valeurs mais
 * pas leurs positions, et un message sans ligne exacte oblige à rouvrir le
 * fichier pour savoir de quoi on parle. Une ligne absolue rend le refus
 * actionnable tel quel.
 */
export function blocsDeRun(texte) {
  const lignes = texte.split('\n');
  const blocs = [];
  for (let i = 0; i < lignes.length; i += 1) {
    const m = RUN.exec(lignes[i]);
    if (!m) continue;
    const indentation = m[1].length;
    const reste = m[2];

    let script = null;
    let ligne = i + 1;
    if (BLOC.test(reste)) {
      const contenu = [];
      let j = i + 1;
      for (; j < lignes.length; j += 1) {
        const courante = lignes[j];
        if (courante.trim() === '') { contenu.push(''); continue; }
        const indent = courante.length - courante.trimStart().length;
        if (indent <= indentation) break;
        contenu.push(courante);
      }
      while (contenu.length && contenu[contenu.length - 1] === '') contenu.pop();
      const retrait = Math.min(
        ...contenu.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length),
      );
      if (!Number.isFinite(retrait)) continue;
      script = contenu.map((l) => (l.trim() === '' ? '' : l.slice(retrait))).join('\n');
      ligne = i + 2;
      i = j - 1;
    } else if (reste.length) {
      // `run: echo x` en ligne : la valeur est le script, guillemets retirés.
      script = reste.replace(/^(['"])(.*)\1$/, '$2');
    }
    if (script === null) continue;

    // Le `shell:` du MÊME step : même indentation, avant le `run:`, sans
    // franchir le début du step (`- name:` / `- uses:` plus haut).
    let shell = 'bash';
    for (let k = i - 1; k >= 0 && k >= i - 20; k -= 1) {
      const candidat = SHELL.exec(lignes[k]);
      const indent = lignes[k].length - lignes[k].trimStart().length;
      if (/^\s*-\s/.test(lignes[k]) && indent < indentation) break;
      if (candidat && indent === indentation) { shell = candidat[2]; break; }
      if (lignes[k].trim() !== '' && indent < indentation) break;
    }

    blocs.push({
      ligne,
      shell: shellNormalise(shell),
      shellBrut: shell,
      script: substituerExpressions(script),
    });
  }
  return blocs;
}

function versionne(commande) {
  if (!commande) return false;
  try {
    execFileSync(commande, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** `{ actionlint, shellcheck }` — les chemins utilisables, ou `null`. */
export function outils(env = process.env) {
  const shellcheck = env.KOJO_SHELLCHECK || 'shellcheck';
  const actionlint = env.KOJO_ACTIONLINT || 'actionlint';
  return {
    shellcheck: versionne(shellcheck) ? shellcheck : null,
    actionlint: versionne(actionlint) ? actionlint : null,
  };
}

/**
 * Les écarts d'un bloc `run:`, lignes ABSOLUES du fichier.
 *
 * La ligne n'est pas recalculée : le fichier soumis à shellcheck porte
 * l'amorce d'actionlint puis le script aligné sur les lignes du YAML, donc
 * shellcheck lui-même compte en coordonnées du YAML. Une arithmétique de
 * décalage serait une seconde source d'erreur, et c'est précisément la ligne
 * qui rend le refus utilisable.
 *
 * L'amorce n'est pas décorative : les steps tournent sous `bash -e {0}`, donc
 * actionlint ajoute `set -eo pipefail` avant de déléguer — MESURÉ le
 * 19/10/2026, sans elle `cd ../frontend` de `ci.yml` remontait en SC2164, un
 * écart que la CI ne voit pas. Un pré-vol plus sévère que la CI est un pré-vol
 * qu'on apprend à contourner.
 */
export function amorce(shell) {
  return shell === 'bash' ? 'set -eo pipefail' : 'set -e';
}

export function lancerShellcheck(blocs, { shellcheck, repertoire = null, executer = execFileSync } = {}) {
  const travaux = repertoire || mkdtempSync(path.join(tmpdir(), 'kojo-lint-'));
  const ecarts = [];
  // Les blocs sont groupés PAR SHELL : shellcheck prend plusieurs fichiers par
  // appel, donc un workflow = un ou deux processus au lieu d'un par bloc (125
  // spawns sur ce dépôt, mesuré : 7 s en pré-vol, contre ~1 s groupé).
  const lots = new Map();
  try {
    blocs.forEach((bloc, index) => {
      if (!bloc.shell) return;
      const fichier = path.join(travaux, `bloc-${index}.sh`);
      // L'amorce occupe la ligne (ligne - 1) : le script commence donc à la
      // ligne du `run:` dans le YAML, sans décalage à recalculer.
      const blancs = Math.max(0, bloc.ligne - 2);
      writeFileSync(fichier, `${'\n'.repeat(blancs)}${amorce(bloc.shell)}\n${bloc.script}\n`, 'utf8');
      if (!lots.has(bloc.shell)) lots.set(bloc.shell, []);
      lots.get(bloc.shell).push({ fichier, bloc });
    });

    for (const [shell, membres] of lots) {
      let sortie = '';
      try {
        executer(
          shellcheck,
          // `--norc` : sans lui, un `.shellcheckrc` du poste changerait le
          // verdict — la CI, elle, tourne sous actionlint qui le passe.
          ['--norc', '-f', 'gcc', '-x', '--shell', shell, '-e', EXCLUSIONS, ...membres.map((m) => m.fichier)],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
      } catch (erreur) {
        sortie = `${erreur.stdout || ''}${erreur.stderr || ''}`;
        if (erreur.status !== 1) {
          ecarts.push({
            ligne: membres[0].bloc.ligne,
            code: 'ERREUR',
            severite: 'error',
            message: `shellcheck n'a pas pu lire les blocs (code ${erreur.status}) : ${sortie.trim()}`,
          });
          continue;
        }
      }
      for (const ligne of sortie.split('\n')) {
        const m = /^(.+?):(\d+):\d+:\s*(\w+):\s*(.+?)(?:\s*\[(SC\d+)\])?\s*$/.exec(ligne.trim());
        if (!m) continue;
        // Le fichier temporaire dit de QUEL bloc vient l'écart ; la ligne, elle,
        // est déjà en coordonnées du YAML.
        const index = /bloc-(\d+)\.sh$/.exec(m[1]);
        const bloc = index ? blocs[Number(index[1])] : null;
        ecarts.push({
          ligne: Number(m[2]),
          code: m[5] || 'SC?',
          severite: m[3],
          message: m[4],
          bloc: bloc ? bloc.ligne : 0,
        });
      }
    }
  } finally {
    if (!repertoire) rmSync(travaux, { recursive: true, force: true });
  }
  return ecarts.sort((a, b) => a.ligne - b.ligne);
}

/** Les .yml/.yaml de `.github/workflows/` — la surface que la CI juge. */
export function workflowsDuDepot(racine = process.cwd()) {
  const dossier = path.join(racine, '.github', 'workflows');
  let entrees = [];
  try {
    entrees = readdirSync(dossier);
  } catch {
    return [];
  }
  return entrees
    .filter((nom) => /\.ya?ml$/.test(nom))
    .map((nom) => path.join(dossier, nom))
    .filter((chemin) => statSync(chemin).isFile());
}

/**
 * Les workflows touchés par ce push.
 *
 * `refs` = les lignes de stdin du hook. `fichiers: null` veut dire « base
 * inconnue » : on juge TOUT, jamais rien — un push de refonte ne doit pas
 * échapper au lint parce que sa base n'est pas calculable.
 */
export function fichiersDuPush(refs, { cwd = process.cwd(), executer = execFileSync } = {}) {
  const lignes = String(refs || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/))
    .filter((c) => c.length >= 4 && !/^0+$/.test(c[1]));

  if (lignes.length === 0) return { fichiers: [], motif: 'aucune réf publiée' };

  const git = (args) =>
    executer('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  const noms = new Set();
  for (const [, oidLocal, , oidDistant] of lignes) {
    let base = oidDistant && !/^0+$/.test(oidDistant) ? oidDistant : null;
    if (!base) {
      for (const candidate of ['origin/main', 'main']) {
        try {
          base = git(['merge-base', oidLocal, candidate]);
          break;
        } catch {
          /* base inconnue pour cette référence */
        }
      }
    }
    if (!base) return { fichiers: null, motif: `base inconnue pour ${oidLocal.slice(0, 8)}` };
    let sortie = '';
    try {
      sortie = git(['diff', '--name-only', `${base}..${oidLocal}`]);
    } catch {
      return { fichiers: null, motif: `diff impossible pour ${oidLocal.slice(0, 8)}` };
    }
    sortie
      .split('\n')
      .map((n) => n.trim())
      .filter((n) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(n))
      .forEach((n) => noms.add(n));
  }
  return { fichiers: [...noms].sort(), motif: '' };
}

function ecrire(flux, texte) {
  (flux === 'erreur' ? process.stderr : process.stdout).write(`${texte}\n`);
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const depuisPush = argv.includes('--from-push');
  const indexFiles = argv.indexOf('--files');
  let cibles;

  if (indexFiles !== -1) {
    cibles = argv.slice(indexFiles + 1).filter((a) => !a.startsWith('--'));
  } else if (depuisPush) {
    const { fichiers, motif } = fichiersDuPush(env.KOJO_REFS_DU_PUSH, {
      cwd: process.cwd(),
    });
    if (fichiers === null) {
      // Base inconnue : on juge tout, et on le DIT (pas une mesure devinée).
      ecrire('sortie', `[INFO] ${motif} — tous les workflows sont jugés.`);
      cibles = null;
    } else if (fichiers.length === 0) {
      ecrire('sortie', '[OK] aucun workflow dans ce push — rien à juger (le lint des workflows n\'a pas eu lieu).');
      return 0;
    } else {
      cibles = fichiers;
    }
  }

  const fichiers = cibles ?? workflowsDuDepot().map((f) => path.relative(process.cwd(), f) || f);
  if (fichiers.length === 0) {
    ecrire('erreur', '[PRÉMISSE] aucun workflow lu sous .github/workflows/ — le lint n\'a rien jugé.');
    return 2;
  }

  const disponibles = outils(env);
  if (!disponibles.shellcheck) {
    ecrire(
      'erreur',
      '[PRÉMISSE] shellcheck introuvable : les blocs `run:` ne sont PAS jugés (actionlint lui-même ' +
        'l\'ignore quand il est absent). Installer shellcheck (apt-get install shellcheck, ' +
        'brew install shellcheck) ou poser KOJO_SHELLCHECK=<chemin>. push ANNULÉ pour ne pas ' +
        'publier un workflow que la CI refusera.',
    );
    return 2;
  }

  const ecarts = [];
  let blocsJuges = 0;
  let ignores = 0;
  for (const fichier of fichiers) {
    let texte;
    try {
      texte = readFileSync(path.resolve(fichier), 'utf8');
    } catch (erreur) {
      ecrire('erreur', `[PRÉMISSE] ${fichier} illisible (${erreur.code || erreur.message}) — rien n'a été jugé.`);
      return 2;
    }
    const blocs = blocsDeRun(texte);
    blocsJuges += blocs.length;
    for (const bloc of blocs) {
      if (!bloc.shell) {
        ignores += 1;
        ecrire('sortie', `[INFO] ${fichier}:${bloc.ligne} shell « ${bloc.shellBrut} » — hors shellcheck (non jugé).`);
      }
    }
    for (const ecart of lancerShellcheck(blocs, { shellcheck: disponibles.shellcheck })) {
      ecarts.push({ fichier, ...ecart });
    }
    if (disponibles.actionlint) {
      let sortie = '';
      try {
        execFileSync(disponibles.actionlint, [fichier], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (erreur) {
        sortie = `${erreur.stdout || ''}${erreur.stderr || ''}`;
      }
      // Les lignes `shellcheck reported issue` sont déjà rendues par notre
      // passage, avec une ligne absolue : les garder doublerait chaque écart.
      for (const ligne of sortie.split('\n')) {
        if (!ligne.trim() || /shellcheck reported issue/.test(ligne)) continue;
        ecarts.push({ fichier, ligne: 0, code: 'actionlint', severite: 'error', message: ligne.trim() });
      }
    }
  }

  if (!disponibles.actionlint) {
    ecrire(
      'sortie',
      '[NON MESURÉ] actionlint absent : la structure et les expressions des workflows ne sont pas ' +
        'jugées ici (la CI les juge). Les blocs `run:` le sont.',
    );
  }

  if (ecarts.length === 0) {
    ecrire(
      'sortie',
      `[OK] ${blocsJuges} bloc(s) run: jugé(s) dans ${fichiers.length} workflow(s)` +
        `${ignores ? `, ${ignores} hors shell (non jugé)` : ''} — rien à redire.`,
    );
    return 0;
  }

  for (const ecart of ecarts) {
    const position = ecart.ligne ? `${ecart.fichier}:${ecart.ligne}` : ecart.fichier;
    ecrire('erreur', `${position} [${ecart.code}] ${ecart.severite}: ${ecart.message}`);
  }
  ecrire('erreur', `${ecarts.length} écart(s) : la CI refusera ce workflow (workflow-lint).`);
  return 1;
}

const direct =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

if (direct) {
  process.exitCode = main();
}
