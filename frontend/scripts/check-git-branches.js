#!/usr/bin/env node
/**
 * Contrôle des branches git et réfs distantes :
 *
 *   1. Branche LOCALE dont la PR est fusionnée ET dont la réf distante a
 *      disparu : GitHub supprime la réf distante à la fusion, `fetch.prune=true`
 *      la fait disparaître des refs de suivi, et la branche locale reste —
 *      d'autant plus discrète que `git branch -d` la REFUSE (une fusion par
 *      squash n'est pas une ascendance). Elle est NOMMÉE, avec sa raison et la
 *      commande pour la supprimer (`git branch -D`).
 *   2. Réf DISTANTE qu'AUCUNE branche locale ne porte : le miroir de (1),
 *      quand la branche locale a été supprimée mais que le distant a gardé la
 *      sienne (suppression automatique absente ou en échec, élagage non fait).
 *      Seules les réfs du distant qui PORTE la base sont jugées — un clone peut
 *      suivre plusieurs distants, et un checkout de PR laisse des réfs qui ne
 *      sont à aucune passe. Le remède est nommé, les deux formes à la fois —
 *      `git push <distant> --delete`, ou `git remote prune` si elle a disparu
 *      sans élagage —, parce que cette lecture est LOCALE : elle ne demande rien
 *      au réseau et ne peut donc pas trancher entre les deux.
 *
 * Un contrôle qui ne peut pas lire son sujet échoue au lieu de se taire (git
 * illisible, aucune branche de base à comparer).
 */
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export const CHAMPS_BRANCHE = '%(refname:short)%09%(upstream:short)%09%(upstream:track)%09%(HEAD)';

// Les refs du DISTANT : `%(symref)` distingue la réf symbolique `origin/HEAD`.
export const CHAMPS_REF_DISTANTE = '%(refname:short)%09%(symref)';

export function lireGit(args, cwd) {
  const resultat = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (resultat.error) throw resultat.error;
  return {
    ok: resultat.status === 0,
    lignes: (resultat.stdout || '').split('\n').map((ligne) => ligne.replace(/\r$/, '')).filter(Boolean),
    erreur: (resultat.stderr || '').trim(),
  };
}

export function lireObligatoire(args, cwd, lire) {
  const lecture = lire(args, cwd);
  if (!lecture.ok) {
    throw new Error(`git ${args.join(' ')} : ${lecture.erreur || 'échec sans message'}`);
  }
  return lecture.lignes;
}

export function brancheDeBase(branches, cwd, lire) {
  const tete = lire(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
  const duDistant = tete.ok ? tete.lignes[0]?.replace(/^[^/]+\//, '') : null;
  return [duDistant, 'main', 'master', branches.find((b) => b.courante)?.nom].find(
    (nom) => nom && branches.some((branche) => branche.nom === nom),
  ) || null;
}

export function raisonDuContenu(ref, base, cwd, lire) {
  const compte = lireObligatoire(
    ['rev-list', '--left-right', '--count', `${base}...${ref}`], cwd, lire,
  )[0];
  if (Number(compte.split(/\s+/)[1]) === 0) return `ses commits sont déjà dans ${base}`;
  return lire(['diff', '--quiet', base, ref], cwd).ok
    ? `son arbre est identique à ${base} (fusion par squash)`
    : null;
}

export function rapportBranche(branche, base, cwd, lire) {
  const raison = raisonDuContenu(branche.nom, base, cwd, lire);
  if (!raison) return null;
  return `branche locale « ${branche.nom} » : ${raison}, et sa réf distante « ${branche.suivi} » a disparu — la supprimer (git branch -D ${branche.nom})`;
}

export function rapportRefDistante(ref, base, cwd, lire) {
  const raison = raisonDuContenu(ref.ref, base, cwd, lire);
  return raison
    ? `réf distante « ${ref.ref} » : ${raison}, et aucune branche locale ne la porte — la retirer (git push ${ref.distant} --delete ${ref.nom}, ou git remote prune ${ref.distant} si elle a disparu du distant)`
    : null;
}

export function mesurerBranches({ cwd = process.cwd(), lire = lireGit } = {}) {
  const branches = lireObligatoire(
    ['for-each-ref', `--format=${CHAMPS_BRANCHE}`, 'refs/heads'], cwd, lire,
  ).map((ligne) => {
    const [nom, suivi, trace, tete] = ligne.split('\t');
    return { nom, suivi, disparue: trace.includes('gone'), courante: tete.trim() === '*' };
  });
  const refsDistantes = lireObligatoire(
    ['for-each-ref', `--format=${CHAMPS_REF_DISTANTE}`, 'refs/remotes'], cwd, lire,
  ).map((ligne) => {
    const [ref, symref] = ligne.split('\t');
    const coupe = ref.indexOf('/');
    return { ref, distant: ref.slice(0, coupe), nom: ref.slice(coupe + 1), symbolique: Boolean(symref) };
  });
  const base = brancheDeBase(branches, cwd, lire);
  if (!base) {
    return {
      issues: branches.some((branche) => branche.suivi)
        ? [`branches locales : aucune branche de base (main) parmi ${branches.length} branche(s) — le contrôle n'a rien pu comparer`]
        : [],
      examinees: 0,
      distantes: 0,
    };
  }
  const candidates = branches.filter((branche) => branche.suivi && branche.nom !== base);
  const locales = new Set(branches.map((branche) => branche.nom));
  const baseDistante = refsDistantes.find((ref) => ref.nom === base);
  const orphelines = baseDistante
    ? refsDistantes.filter(
      (ref) => !ref.symbolique && ref.distant === baseDistante.distant
        && ref.nom !== base && !locales.has(ref.nom),
    )
    : [];
  const issues = candidates
    .filter((branche) => branche.disparue)
    .map((branche) => rapportBranche(branche, base, cwd, lire))
    .filter(Boolean)
    .concat(orphelines.map((ref) => rapportRefDistante(ref, baseDistante.ref, cwd, lire)).filter(Boolean));
  // `examinees` et `distantes` dénombrent les entités inspectées (branches locales
  // suivies candidates et réfs distantes orphelines sans branche locale). Ces deux
  // compteurs alimentent la ligne de résumé informatif affichée en console lors du
  // succès, attestant du périmètre effectivement contrôlé.
  return { issues, examinees: candidates.length, distantes: orphelines.length };
}

export function ecrireStepSummary({ issues, examinees, distantes }, cheminFichier = process.env.GITHUB_STEP_SUMMARY) {
  if (!cheminFichier) return;
  const lignes = [
    '### Hygiène des branches et réfs distantes',
    '',
    issues.length === 0
      ? `✅ **Aucun résidu détecté** : ${examinees} branche(s) locale(s) suivie(s) et ${distantes} réf(s) distante(s) sans branche locale vérifiée(s).`
      : `❌ **Résidu(s) de passe détecté(s)** : ${issues.length} anomalie(s) trouvée(s).`,
  ];
  if (issues.length) {
    lignes.push('', '| Anomalie | Remède requis |', '| --- | --- |');
    for (const issue of issues) {
      lignes.push(`| ${issue} | Voir commande suggérée ci-contre |`);
    }
  }
  lignes.push('');
  try {
    appendFileSync(cheminFichier, `${lignes.join('\n')}\n`, 'utf8');
  } catch {
    // Si l'écriture échoue (fichier restreint ou inexistant), on ne bloque pas le contrôle.
  }
}

export async function main(
  args = process.argv.slice(2),
  { cwd = process.cwd(), mesurer = mesurerBranches, stepSummaryPath = process.env.GITHUB_STEP_SUMMARY } = {},
) {
  try {
    const resultat = mesurer({ cwd });
    const { issues, examinees, distantes } = resultat;
    ecrireStepSummary(resultat, stepSummaryPath);
    if (issues.length) {
      for (const issue of issues) console.error(`::error::${issue}`);
      return false;
    }
    console.log(`Hygiène des branches : ${examinees} branche(s) locale(s) suivie(s) et ${distantes} réf(s) distante(s) sans branche locale — aucun résidu.`);
    return true;
  } catch (err) {
    console.error(`::error::branches : lecture impossible (${err.message})`);
    return false;
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  main().then((ok) => {
    if (!ok) process.exitCode = 1;
  });
}
