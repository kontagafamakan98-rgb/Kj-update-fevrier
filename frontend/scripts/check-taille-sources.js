#!/usr/bin/env node
// ── LE PLAFOND DES SOURCES : un fichier a une borne, pas seulement un artefact
//
// L'audit du 31/10/2026 (§5.3-11) l'a écrit tel quel : « le budget par module
// juge les ARTEFACTS, pas les sources — `frontend/src/index.css` 3 463,
// `backend/kojo_scheduler.py` 1 934, `frontend/src/config/page-sections.js`
// 1 668, `frontend/src/pages/JobDetails.js` 1 236 lignes. Un module de bundle
// peut être petit alors que le fichier qui le produit est ingérable. »
//
// C'est exact : le 31/10, `BUDGETS.chunkGzip` bornait 59 chunks émis, et un
// fichier de 3 000 lignes pouvait produire un chunk de 4 Ko sans qu'aucun garde
// n'ait son mot à dire. Ce fichier-ci juge la SOURCE.
//
// ── CE QU'IL REFUSE, ET POURQUOI CES REFUS-LÀ ────────────────────────────────
//
// 1. Un fichier AU-DESSUS de son plafond. Le plafond vient de la table déclarée
//    s'il y est, de `PLAFOND_PAR_DEFAUT` sinon. Un fichier neuf n'a donc pas
//    besoin d'être déclaré pour être borné : c'est la règle qui manquait.
// 2. Une entrée de la table dont le FICHIER N'EXISTE PLUS. Une ligne morte
//    surveille zéro ligne et se lit comme un budget tenu.
// 3. Une entrée dont le plafond est SOUS le plafond par défaut. Elle ne
//    plafonne alors plus rien que la règle générale ne plafonne déjà : la table
//    doit rester la liste des DÉROGATIONS, pas un second répertoire.
// 4. Une entrée sans `cible` qui soit une VRAIE réduction (strictement sous le
//    plafond ET sous la mesure). Une dérogation sans cible est un sursis
//    permanent : le fichier reste gros et plus rien ne le dit.
// 5. Une entrée sans DATE de mesure. Toute dérogation de ce dépôt se date (même
//    règle que les budgets de `check-bundle-size.js` et que les états de
//    référence) ; une date est ce qui permet de juger si un sursis a duré.
// 6. Un corpus VIDE. Un garde qui ne juge aucun fichier rend un vert qui ne
//    mesure rien — `src/` renommé, un `racine` mal résolu.
//
// ── CE QU'IL NE FAIT PAS, ET QUI EST ÉCRIT ───────────────────────────────────
//
// Il ne DÉCOUPE aucun fichier. Une source de 3 463 lignes sous un plafond de
// 3 500 est plafonnée, pas réduite : la table porte donc une `cible` par
// dérogation, et le rapport PUBLIE l'écart à la cible. Découper `index.css` ou
// `kojo_scheduler.py` est un travail de refonte, pas de garde — et un garde ne
// doit pas prétendre l'avoir fait.
//
// Il ne juge pas les tests (`__tests__`, `*.test.*`) : la longueur d'un test se
// juge à ce qu'il prouve, et la borner pousserait à supprimer des cas.
// Il ne juge pas `public/` (des fichiers servis, pas des sources), ni les
// dépendances (`node_modules`, `.venv`), ni les sorties (`build`, `dist`).
//
// ── MESURÉ LE 01/11/2026 (l'arbre de ce commit) ──────────────────────────────
//
// **281 fichiers, 82 496 lignes jugées**, et **8 dérogations** au-dessus du
// plafond par défaut : index.css 3 463, kojo_scheduler.py 1 934,
// page-sections.js 1 668, JobDetails.js 1 236, geolocationService.js 1 190,
// kojo_routers_auth.py 1 181, Profile.js 1 084, kojo_live.py 1 067 — soit
// **4 323 lignes au-dessus du plafond de leur extension**. Chaque entrée porte
// une cible ; le rapport publie l'écart qui reste, sur le vert comme sur le rouge.
//
// Usage : node scripts/check-taille-sources.js [--racine <chemin>] [--verbose]

import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
export const RACINE_PAR_DEFAUT = path.resolve(ICI, '..', '..');

// Les arbres jugés, avec leurs extensions. `scripts/` est jugé aussi : un garde
// de 2 000 lignes est un fichier que personne ne relit, et c'est la même
// question posée au même endroit.
export const ARBRES = [
  { racine: 'frontend/src', extensions: ['.js', '.jsx', '.css'] },
  { racine: 'frontend/vite-plugins', extensions: ['.js'] },
  { racine: 'frontend/scripts', extensions: ['.js', '.cjs', '.mjs'] },
  { racine: 'backend', extensions: ['.py'] },
];

// Les dossiers et suffixes hors périmètre, avec leur motif (règle 5 de
// AGENTS.md : une surface aveugle se DÉCLARE).
export const HORS_PERIMETRE = [
  { motif: '__tests__', raison: 'la longueur d’un test se juge à ce qu’il prouve' },
  { motif: '.test.', raison: 'idem, pour les fichiers de test hors dossier' },
  { motif: 'node_modules', raison: 'dépendances installées, pas des sources' },
  { motif: '.venv', raison: 'idem, côté Python' },
  { motif: '__pycache__', raison: 'cache d’octets, régénéré' },
  { motif: '/build', raison: 'sortie du build' },
  { motif: '/dist', raison: 'sortie du build' },
  { motif: '/public', raison: 'fichiers SERVIS (polices, images, service worker)' },
  { motif: '/android', raison: 'projet Capacitor généré' },
  { motif: '/ios', raison: 'idem' },
  { motif: '/tests', raison: 'côté backend : la suite a son propre corpus (136 fichiers)' },
  { motif: '/scripts', raison: 'outillage du backend, pas le service' },
];

// Le plafond par défaut : celui d'un fichier que personne n'a déclaré. Une
// valeur ronde et basse, pour qu'un fichier neuf ne puisse pas naître gros.
export const PLAFOND_PAR_DEFAUT = { '.css': 1500, '.js': 1000, '.jsx': 1000, '.cjs': 1000, '.mjs': 1000, '.py': 1000 };

// ── LA TABLE DES DÉROGATIONS ─────────────────────────────────────────────────
//
// `plafond` = la borne AUJOURD'HUI (mesure arrondie à la cinquantaine
// supérieure : une correction de quelques lignes reste possible, +50 lignes de
// dérive ne le sont pas) ; `cible` = ce que le fichier doit devenir ; `mesure`
// = la date du comptage ; `motif` = pourquoi la dérogation existe encore.
export const PLAFONDS_DECLARES = [
  {
    chemin: 'frontend/src/index.css',
    plafond: 3500,
    cible: 2000,
    mesure: '01/11/2026',
    motif:
      'la feuille du site porte les jetons, la typographie, la matière éditoriale et ' +
      'les composants des coquilles : la découper demande de toucher aux gardes qui la ' +
      'lisent (jetons `--kojo-*`, budget de CSS critique, sélecteurs morts)',
  },
  {
    chemin: 'backend/kojo_scheduler.py',
    plafond: 1950,
    cible: 1200,
    mesure: '01/11/2026',
    motif:
      'les tâches planifiées (purges, relances, baux) partagent un même verrou et une ' +
      'même horloge ; les sortir demande de décider où vit le bail, pas seulement de ' +
      'déplacer des fonctions',
  },
  {
    chemin: 'frontend/src/config/page-sections.js',
    plafond: 1700,
    cible: 900,
    mesure: '01/11/2026',
    motif:
      'les plans de sections des 12 routes pré-rendues sont des DONNÉES : les découper ' +
      'par route est mécanique, mais deux gardes lisent ce CHEMIN (provenance des textes, ' +
      'hygiène i18n) et doivent suivre le déplacement dans le même commit',
  },
  {
    chemin: 'frontend/src/pages/JobDetails.js',
    plafond: 1250,
    cible: 900,
    mesure: '01/11/2026',
    motif: 'fiche mission : les cartes (proposition, complétion, litige) peuvent sortir en composants',
  },
  {
    chemin: 'frontend/src/services/geolocationService.js',
    plafond: 1200,
    cible: 900,
    mesure: '01/11/2026',
    motif: 'détection de pays/ville : le référentiel et la géométrie sont séparables du parcours de permission',
  },
  {
    chemin: 'backend/kojo_routers_auth.py',
    plafond: 1200,
    cible: 900,
    mesure: '01/11/2026',
    motif: 'inscription + connexion + Google + verrouillage : les trois flux n’ont pas les mêmes tests',
  },
  {
    chemin: 'frontend/src/pages/Profile.js',
    plafond: 1100,
    cible: 900,
    mesure: '01/11/2026',
    motif: 'profil : formulaire, photo, compétences et ports monétaires sur la même page',
  },
  {
    chemin: 'backend/kojo_live.py',
    plafond: 1100,
    cible: 900,
    mesure: '01/11/2026',
    motif: 'bus temps réel : transport, présence et rejeu peuvent se séparer',
  },
];

const EXTENSIONS_JAUGEES = new Set(Object.keys(PLAFOND_PAR_DEFAUT));

const estHorsPerimetre = (cheminRelatif) =>
  HORS_PERIMETRE.some(({ motif }) => cheminRelatif.includes(motif));

const compterLignes = (chemin) => {
  const texte = readFileSync(chemin, 'utf8');
  if (!texte) return 0;
  const lignes = texte.split('\n');
  // Un fichier terminé par un saut de ligne n'a pas une ligne de plus : la
  // dernière entrée vide de `split` n'est pas une ligne.
  return lignes[lignes.length - 1] === '' ? lignes.length - 1 : lignes.length;
};

const parcourir = (racineAbsolue, cheminRelatif, sortie) => {
  let entrees;
  try {
    entrees = readdirSync(racineAbsolue, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entree of entrees) {
    const relatif = `${cheminRelatif}/${entree.name}`;
    if (estHorsPerimetre(relatif)) continue;
    const absolu = path.join(racineAbsolue, entree.name);
    if (entree.isDirectory()) {
      parcourir(absolu, relatif, sortie);
    } else if (EXTENSIONS_JAUGEES.has(path.extname(entree.name))) {
      sortie.push({ chemin: relatif.replace(/^\/+/, ''), lignes: compterLignes(absolu) });
    }
  }
};

/**
 * Juge la taille des sources.
 *
 * @param {object} [options]
 * @param {string} [options.racine] Racine du dépôt (fixtures de test).
 * @param {Array} [options.arbres] Arbres jugés (défaut : ARBRES).
 * @param {Array} [options.declarations] Dérogations (défaut : PLAFONDS_DECLARES).
 * @param {object} [options.plafondParDefaut] Plafonds par extension.
 * @param {boolean} [options.quiet] Tait le rapport (tests).
 * @returns {{ok: boolean, errors: string[], stats: object}}
 */
export const checkTailleSources = ({
  racine = RACINE_PAR_DEFAUT,
  arbres = ARBRES,
  declarations: declarationsFournies = PLAFONDS_DECLARES,
  plafondParDefaut = PLAFOND_PAR_DEFAUT,
  quiet = false,
} = {}) => {
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };
  const errors = [];

  const fichiers = [];
  for (const arbre of arbres) {
    parcourir(path.join(racine, arbre.racine), arbre.racine, fichiers);
  }

  // Refus 6 : corpus vide.
  if (fichiers.length === 0) {
    return {
      ok: false,
      errors: [
        `aucun fichier source jugé sous ${arbres.map((a) => a.racine).join(', ')} — ` +
          `un garde qui ne mesure rien rend un vert qui ne prouve rien`,
      ],
      stats: { fichiers: 0, lignes: 0, declarations: declarationsFournies.length, pires: [] },
    };
  }

  const declarations = new Map(declarationsFournies.map((d) => [d.chemin, d]));
  const cheminsJuges = new Set(fichiers.map((f) => f.chemin));

  // Refus 2, 3, 4 et 5 : la table elle-même.
  for (const declaration of declarationsFournies) {
    const defaut = plafondParDefaut[path.extname(declaration.chemin)];
    if (!cheminsJuges.has(declaration.chemin)) {
      errors.push(
        `${declaration.chemin} est déclaré avec un plafond de ${declaration.plafond} lignes ` +
          `mais ce fichier n'est pas jugé (absent, ou hors périmètre) : une dérogation orpheline ` +
          `surveille zéro ligne et se lit comme un budget tenu`
      );
      continue;
    }
    if (declaration.plafond <= defaut) {
      errors.push(
        `${declaration.chemin} déclare un plafond de ${declaration.plafond} lignes, ` +
          `c'est-à-dire PAS PLUS que le plafond par défaut (${defaut}) : cette entrée ne ` +
          `plafonne rien de plus que la règle générale — la retirer`
      );
    }
    const mesure = fichiers.find((f) => f.chemin === declaration.chemin).lignes;
    if (!(declaration.cible < declaration.plafond) || !(declaration.cible < mesure)) {
      errors.push(
        `${declaration.chemin} porte une cible de ${declaration.cible} lignes qui n'est pas ` +
          `une RÉDUCTION (mesure ${mesure}, plafond ${declaration.plafond}) : une dérogation ` +
          `sans cible réelle est un sursis permanent`
      );
    }
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(declaration.mesure || '')) {
      errors.push(
        `${declaration.chemin} n'est pas DATÉ (mesure « ${declaration.mesure} ») : une ` +
          `dérogation non datée ne peut pas être jugée sur sa durée`
      );
    }
  }

  // Refus 1 : le plafond de chaque fichier.
  const juges = fichiers.map((f) => {
    const declaration = declarations.get(f.chemin);
    const defaut = plafondParDefaut[path.extname(f.chemin)];
    const plafond = declaration ? declaration.plafond : defaut;
    return {
      ...f,
      plafond,
      defaut,
      declare: Boolean(declaration),
      cible: declaration ? declaration.cible : null,
      depasse: f.lignes > plafond,
    };
  });

  for (const f of juges.filter((j) => j.depasse)) {
    errors.push(
      `${f.chemin} fait ${f.lignes} lignes pour un plafond de ${f.plafond}` +
        (f.cible ? ` (dérogation datée, cible ${f.cible} : il doit DESCENDRE, pas s'installer)` : '') +
        ` — découper le fichier, ou déclarer une dérogation AVEC sa date, son motif et sa cible ` +
        `dans PLAFONDS_DECLARES (scripts/check-taille-sources.js)`
    );
  }

  const total = juges.reduce((somme, f) => somme + f.lignes, 0);
  // Ce que la dette PÈSE : les lignes qui dépassent le plafond par défaut de
  // leur extension. Compter les fichiers entiers (3 463 pour `index.css`) ferait
  // lire 12 823 lignes de dette là où 4 323 sont au-dessus de la borne.
  const dette = juges
    .filter((f) => f.lignes > f.defaut)
    .reduce((somme, f) => somme + (f.lignes - f.defaut), 0);
  const pires = [...juges].sort((a, b) => b.lignes - a.lignes).slice(0, 5);

  // Le COÛT et l'ÉTAT sont publiés sur le vert comme sur le rouge : une dette
  // qui ne s'affiche que le jour du dépassement n'a servi à aucun arbitrage.
  log('Plafond des sources (lignes) :');
  for (const f of pires) {
    log(
      `  ${String(f.lignes).padStart(6)}  ${f.declare ? 'dérogé' : 'défaut'}  plafond ${f.plafond}` +
        `${f.cible ? ` · cible ${f.cible}` : ''}  ${f.chemin}`
    );
  }
  log(
    `  fichiers jugés      : ${juges.length} (${total} lignes), ` +
      `${declarationsFournies.length} dérogation(s) déclarée(s)`
  );
  log(
    `  lignes au-dessus du plafond par défaut : ${dette} ` +
      `(${juges.filter((f) => f.lignes > f.defaut).length} fichier(s))`
  );
  log(
    `  plafonds par défaut : ${Object.entries(plafondParDefaut)
      .map(([ext, n]) => `${ext} ${n}`)
      .join(' · ')}`
  );

  const stats = { fichiers: juges.length, lignes: total, dette, declarations: declarationsFournies.length, pires };

  if (errors.length > 0) {
    if (!quiet) {
      console.error(`\n❌ Plafond des sources dépassé (${errors.length} problème(s)) :`);
      for (const message of errors) console.error(`   • ${message}`);
    }
    return { ok: false, errors, stats };
  }

  log(
    '\n✅ Toutes les sources sont sous leur plafond (plafond par défaut, ou dérogation ' +
      'datée avec sa cible).'
  );
  return { ok: true, errors, stats };
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const args = process.argv.slice(2);
  const iRacine = args.indexOf('--racine');
  const racine = iRacine !== -1 && args[iRacine + 1] ? path.resolve(args[iRacine + 1]) : RACINE_PAR_DEFAUT;
  const result = checkTailleSources({ racine });
  if (!result.ok) process.exit(1);
}
