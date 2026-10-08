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
 *   3. Branche LOCALE dont la tête n'est contenue dans AUCUNE réf distante : du
 *      travail qui n'existe que sur ce disque. MESURÉ le 28/09/2026 — sept
 *      commits du chantier éditorial vivaient dans un seul checkout,
 *      `origin/web-design-guidelines` s'arrêtant sept commits plus bas, et rien
 *      ne le disait : les deux verdicts ci-dessus ne regardent que ce qui est
 *      DÉJÀ livré, donc une branche jamais poussée n'existe pour aucun des
 *      deux. Elle est NOMMÉE, avec sa marche à suivre (`git push`, ou la
 *      supprimer si son contenu a été livré autrement).
 *
 * Cette troisième classe RAPPELLE, elle ne bloque pas : à l'instant du pré-vol
 * de push, la branche qu'on pousse EST du travail non publié — refuser là-dessus
 * reviendrait à refuser le geste qui le publie, et le seul chemin restant serait
 * `--no-verify`, c'est-à-dire mépriser le garde. Le partage « ce qui bloque / ce
 * qui est seulement rappelé » se décide en un seul endroit (`verdictDeLaPasse`,
 * scripts/check-test-environment.js).
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

// Les branches qu'un push EN COURS publie : le pré-vol les passe par
// l'environnement (`.githooks/pre-push` lit les réfs sur son entrée standard).
// Elles sont retirées du verdict de publication, et c'est ce qui garde ce
// verdict utile : un rappel qui nomme à chaque push la branche que ce push
// publie s'apprend à être ignoré — il ne resterait alors que du bruit, dans le
// seul message que cette classe existe pour faire lire.
export const ENV_BRANCHES_POUSEES = 'KOJO_BRANCHES_POUSEES';

export function branchesPoussees(env = process.env) {
  return (env[ENV_BRANCHES_POUSEES] || '')
    .split(/\s+/)
    .map((nom) => nom.replace(/^refs\/heads\//, '').trim())
    .filter(Boolean);
}

/**
 * Combien de commits une branche locale porte SANS qu'aucune réf distante ne les
 * porte : `--not --remotes` retire de la liste tout ce qui est joignable depuis
 * n'importe quel distant (tous distants confondus, pas seulement celui de la
 * base). Zéro veut donc dire « tout ce que cette branche porte existe déjà
 * ailleurs » — rien à perdre en perdant ce disque. Une seule lecture, et elle ne
 * présuppose ni base ni suivi configuré : une branche jamais poussée en est
 * exactement le sujet.
 */
export function commitsNonPublies(nom, cwd, lire) {
  return Number(
    lireObligatoire(['rev-list', '--count', nom, '--not', '--remotes'], cwd, lire)[0].trim(),
  );
}

export function rapportNonPubliee(branche, distant, cwd, lire) {
  const compte = commitsNonPublies(branche.nom, cwd, lire);
  if (compte === 0) return null;
  return (
    `branche locale « ${branche.nom} » : ${compte} commit(s) n'existent dans aucune réf distante — ` +
    `la publier (git push ${distant} ${branche.nom}), ou la supprimer si son contenu a déjà été livré autrement (git branch -D ${branche.nom})`
  );
}

/**
 * Le verdict de publication, et son plancher de lecture.
 *
 * Sans AUCUNE réf distante (dépôt purement local, greffon d'archive, checkout
 * sans réf de suivi), le sujet de ce verdict n'existe pas : `--not --remotes`
 * rendrait alors « tout est non publié », un rouge — ou un vert — sans lecture.
 * L'état est donc NOMMÉ au lieu d'être tu, et il ne bloque pas plus que la
 * classe qu'il protège : rien, ici, ne dépend d'un disque qu'on s'apprête à
 * jeter.
 */
export function mesurerPublication(branches, refsDistantes, distant, cwd, lire, publiees = []) {
  if (refsDistantes.every((ref) => ref.symbolique)) {
    return {
      jugees: 0,
      lignes: branches.length
        ? [`publication : aucune réf distante dans ce dépôt — ${branches.length} branche(s) locale(s) non jugée(s), rien à comparer`]
        : [],
    };
  }
  const aJuger = branches.filter((branche) => !publiees.includes(branche.nom));
  return {
    jugees: aJuger.length,
    lignes: aJuger.map((branche) => rapportNonPubliee(branche, distant, cwd, lire)).filter(Boolean),
  };
}

export function mesurerBranches({
  cwd = process.cwd(),
  lire = lireGit,
  publiees = branchesPoussees(),
} = {}) {
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
  const baseDistante = base ? refsDistantes.find((ref) => ref.nom === base) : null;
  const distant = baseDistante?.distant
    ?? refsDistantes.find((ref) => !ref.symbolique)?.distant
    ?? 'origin';
  if (!base) {
    return {
      issues: branches.some((branche) => branche.suivi)
        ? [`branches locales : aucune branche de base (main) parmi ${branches.length} branche(s) — le contrôle n'a rien pu comparer`]
        : [],
      examinees: 0,
      distantes: 0,
      // Le verdict de publication ne dépend PAS de la base : il est rendu ici
      // aussi, sinon un dépôt dont la branche de base a été renommée perdrait
      // le seul verdict qui parle du travail qui n'existe que sur ce disque.
      publication: mesurerPublication(branches, refsDistantes, distant, cwd, lire, publiees),
    };
  }
  const candidates = branches.filter((branche) => branche.suivi && branche.nom !== base);
  const locales = new Set(branches.map((branche) => branche.nom));
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
  // La partition est stricte, comme pour les réfs distantes ci-dessus : une
  // branche DÉJÀ nommée comme résidu est livrée (son contenu est dans la base),
  // donc elle ne porte pas de travail propre à ce disque — un résidu ne produit
  // pas une seconde ligne. Le prix de cette exclusion est de relire le prédicat
  // du résidu, et seulement sur les branches dont la réf distante a disparu.
  const livrees = new Set(
    candidates
      .filter((branche) => branche.disparue)
      .filter((branche) => Boolean(raisonDuContenu(branche.nom, base, cwd, lire)))
      .map((branche) => branche.nom),
  );
  const publication = mesurerPublication(
    branches.filter((branche) => !livrees.has(branche.nom)), refsDistantes, distant, cwd, lire, publiees,
  );
  // `examinees`, `distantes` et `publication.jugees` dénombrent les entités
  // inspectées (branches locales suivies candidates, réfs distantes orphelines
  // sans branche locale, branches locales jugées du point de vue de la
  // publication). Ces compteurs alimentent la ligne de résumé informatif affichée
  // en console lors du succès, attestant du périmètre effectivement contrôlé.
  return { issues, examinees: candidates.length, distantes: orphelines.length, publication };
}

export function ecrireStepSummary({ issues, examinees, distantes, publication }, cheminFichier = process.env.GITHUB_STEP_SUMMARY) {
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
  // Les rappels de publication ne sont pas des résidus : le tableau ci-dessus
  // dit ce qu'il faut SUPPRIMER, cette section ce qu'il faut PUBLIER. Les
  // mélanger ferait lire une branche à jeter là où il y a du travail à sauver.
  if (publication?.lignes?.length) {
    lignes.push(
      '',
      `⚠️ **Travail qui n'existe que sur ce disque** (${publication.lignes.length}, rappel non bloquant) :`,
    );
    for (const ligne of publication.lignes) lignes.push(`- ${ligne}`);
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
    const { issues, examinees, distantes, publication } = resultat;
    ecrireStepSummary(resultat, stepSummaryPath);
    // Nommés AVANT le verdict, et dans les deux cas : c'est la demande de cette
    // classe — un travail qui n'existe que sur ce disque doit être lu à la fin de
    // chaque passe, pas découvert par hasard —, et un rappel qui disparaît quand
    // un résidu est présent serait lu encore moins souvent.
    for (const ligne of publication?.lignes ?? []) console.log(`::notice::${ligne}`);
    if (issues.length) {
      for (const issue of issues) console.error(`::error::${issue}`);
      return false;
    }
    console.log(
      `Hygiène des branches : ${examinees} branche(s) locale(s) suivie(s) et ${distantes} réf(s) distante(s) sans branche locale, ` +
        `${publication?.jugees ?? 0} branche(s) locale(s) jugée(s) pour la publication — aucun résidu.`,
    );
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
