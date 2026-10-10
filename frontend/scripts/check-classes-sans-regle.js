#!/usr/bin/env node
/**
 * GARDE : AUCUNE CLASSE POSÉE SANS RÈGLE — la troisième direction du même fait.
 *
 * ── Ce que le dépôt tenait déjà, et le trou exact qui restait ───────────────
 * `scripts/check-css-selecteurs-morts.js` juge un nom de sélecteur (feuilles
 * source : un nom sans porteur) et une RÈGLE servie (sans porteur). Il écrit
 * pourtant, dans son verdict final, la phrase que RIEN ne vérifiait :
 * « et une classe POSÉE doit exister dans la feuille servie » — à une exception
 * près, les neuf noms de la `blocklist` de `tailwind.config.cjs`. Ce garde
 * vérifie la phrase entière : toute classe que les PAGES livrées portent doit
 * avoir sa règle dans la feuille SERVIE.
 *
 * ── DEUX SUJETS : LES PAGES LIVRÉES, ET LE JAVASCRIPT LIVRÉ (09/10/2026) ────
 * Le premier sujet est là où le trou a été trouvé : `vite-plugins/prerender/**`
 * n'est pas dans le `content` de Tailwind, donc une classe écrite UNIQUEMENT dans
 * une coquille n'est générée par personne — et c'est la peinture du premier écran.
 * Le second — les scripts servis — manquait, et c'est un TROU MESURÉ : la sonde
 * des pages ne voit que le HTML des coquilles, or deux classes de l'arbre réel
 * (`profile-photo-container`, `profile-photo-uploader`) n'étaient rendues que par
 * React, jamais par une coquille, et n'avaient AUCUNE règle. Aucune autre sonde
 * ne pouvait les voir : Tailwind ne génère que des UTILITAIRES, et une classe de
 * site sans règle n'est ni un utilitaire, ni dans le HTML pré-rendu.
 * Le JavaScript est lu par une lecture PLUS STRICTE (littéraux entiers en
 * position de classe, cf. l'en-tête de `scripts/classes-sans-regle.js`) : la
 * lecture large du corpus des poseurs, elle, rendait 255 jetons sans règle —
 * deux noms de pays, sept CHEMINS de route, des fragments de gabarit, de la prose,
 * du SVG. Un verdict rendu là-dessus aurait été du bruit.
 *
 * ── Les refus (un vert sans lecture est un faux vert) ───────────────────────
 * Le garde REFUSE de rendre un verdict si le build est absent, s'il lit moins de
 * 10 pages livrées, moins de 2 feuilles servies, moins de 400 règles, moins de
 * 300 noms de classe servis, moins de 300 classes posées, ou moins de 30 fichiers
 * JavaScript, 1 300 valeurs entières et 340 jetons distincts du bundle — et il
 * refuse AUSSI un fichier JavaScript ILLISIBLE (un lecteur partiel ne rend pas un
 * verdict complet), une exemption sans motif ou une exemption que plus RIEN ne
 * pose (une exception qu'on n'ose plus retirer est une exception qui mente).
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   cd frontend && npm run build && node scripts/check-classes-sans-regle.js
 *   node scripts/check-classes-sans-regle.js --root <build>
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  MIN_CLASSES_POSEES,
  MIN_FICHIERS_JS,
  MIN_FEUILLES_SERVIES,
  MIN_JETONS_JS,
  MIN_NOMS_SERVIES,
  MIN_PAGES_LIVREES,
  MIN_REGLES_SERVIES,
  MIN_VALEURS_JS,
  NOMS_ACCEPTES_SANS_REGLE,
  classesPoseesDePage,
  classesPoseesDuJs,
  classesSansRegle,
  exemptionsEnDefaut,
  feuilleServie,
} from './classes-sans-regle.js';
import { feuillesDe } from './css-selecteurs-morts.js';

const valeur = (nom, defaut) => {
  const index = process.argv.indexOf(`--${nom}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : defaut;
};
const RACINE = valeur('root', 'build');

/**
 * Tous les fichiers `.css` (récursif), triés — ils sont servis.
 * Et tous les scripts `.js`/`.mjs` (récursif aussi) : le service worker et le
 * script de push en font partie, ce sont des fichiers que le navigateur
 * télécharge, donc leur classes comptent comme celles des chunks.
 */
function fichiersDe(dossier, motif) {
  const trouvees = [];
  const parcourir = (courant) => {
    for (const entree of fs.readdirSync(courant, { withFileTypes: true })) {
      const chemin = path.join(courant, entree.name);
      if (entree.isDirectory()) { parcourir(chemin); continue; }
      if (motif.test(entree.name)) trouvees.push(chemin);
    }
  };
  parcourir(dossier);
  return trouvees.sort();
}

const feuillesCss = (dossier) => fichiersDe(dossier, /[.]css$/);
const scriptsServis = (dossier) => fichiersDe(dossier, /[.](js|mjs)$/);

/**
 * Une valeur de classe, abrégée pour un message : une ligne, jamais un pavé — et
 * la fenêtre est CENTRÉE sur le nom accusé (09/10/2026). Une troncature par la
 * fin coupait justement le nom sur les longues listes — mesuré sur la fixture du
 * test : 13 classes avant la fautive, et le message citait `… classe-p0-8 …`
 * sans jamais montrer `opacity-50`. Un message qui n'atteint pas la classe qu'il
 * accuse envoie le lecteur chercher à l'œil.
 */
const abreger = (valeur, nom) => {
  const plat = String(valeur).replace(/\s+/g, ' ').trim();
  if (plat.length <= 120) return plat;
  const position = plat.indexOf(nom);
  const debut = Math.max(0, Math.min(position - 40, plat.length - 120));
  return `${debut > 0 ? '… ' : ''}${plat.slice(debut, debut + 120)}${debut + 120 < plat.length ? ' …' : ''}`;
};

/** Les sources d'un nom (pages ou scripts), abrégées : cinq au plus, le reste compté. */
const listerSources = (sources) =>
  sources.length <= 5 ? sources.join(', ') : `${sources.slice(0, 5).join(', ')} et ${sources.length - 5} autre(s)`;

function main() {
  if (!fs.existsSync(RACINE)) {
    throw new Error(
      `dossier de build introuvable (« ${RACINE} ») : lancer \`npm run build\` — un garde qui n'a rien lu n'a rien vérifié`
    );
  }

  const pages = fs
    .readdirSync(RACINE)
    .filter((nom) => nom.endsWith('.html'))
    .sort();
  if (pages.length < MIN_PAGES_LIVREES) {
    throw new Error(`seulement ${pages.length} page(s) livrée(s) — plancher ${MIN_PAGES_LIVREES}`);
  }

  // ── Le sujet : ce que les PAGES posent, puis ce que le BUNDLE pose ──────────
  const posees = new Map(); // nom -> { sources: [{sorte, nom}], porteur }
  const retenir = (nom, porteur, sorte, source) => {
    const entree = posees.get(nom) || { sources: [], porteur };
    if (!entree.sources.some((s) => s.nom === source)) entree.sources.push({ sorte, nom: source });
    posees.set(nom, entree);
  };

  const feuilles = [];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(RACINE, page), 'utf8');
    for (const css of feuillesDe(html)) feuilles.push(css);
    for (const [nom, porteur] of classesPoseesDePage(html).porteurDe) retenir(nom, porteur, 'page', page);
  }

  // ── Le BUNDLE : littéraux ENTIERS en position de classe ─────────────────────
  const scripts = scriptsServis(RACINE);
  let valeursJs = 0;
  const nomsDuJs = new Set();
  const refusJs = { fragments: 0, nonLitteral: 0 };
  const illisibles = [];
  for (const script of scripts) {
    const lecture = classesPoseesDuJs(fs.readFileSync(script, 'utf8'));
    if (!lecture.lisible) {
      illisibles.push(path.relative(RACINE, script));
      continue;
    }
    valeursJs += lecture.valeurs;
    refusJs.fragments += lecture.fichiersRefuses.fragments;
    refusJs.nonLitteral += lecture.fichiersRefuses.nonLitteral;
    for (const [nom, porteur] of lecture.porteurDe) {
      nomsDuJs.add(nom);
      retenir(nom, porteur, 'bundle', path.relative(RACINE, script));
    }
  }

  // ── La feuille SERVIE : les blocs `<style>` des pages ET les `.css` du build,
  //    qu'un nom ait sa règle dans l'une d'elles suffit — le navigateur les
  //    applique toutes.
  for (const feuille of feuillesCss(RACINE)) feuilles.push(fs.readFileSync(feuille, 'utf8'));

  let servie;
  try {
    servie = feuilleServie(feuilles);
  } catch (erreur) {
    throw new Error(`feuille servie illisible (${erreur.message}) — un lecteur cassé ne rend aucun verdict`);
  }

  if (feuilles.length < MIN_FEUILLES_SERVIES || servie.regles < MIN_REGLES_SERVIES) {
    throw new Error(
      `feuille servie illisible (${feuilles.length} feuille(s), ${servie.regles} règle(s)) — ` +
        `planchers ${MIN_FEUILLES_SERVIES} et ${MIN_REGLES_SERVIES} : le lecteur n'a pas lu son sujet`
    );
  }
  if (servie.noms.size < MIN_NOMS_SERVIES) {
    throw new Error(
      `feuille servie trop pauvre en noms de classe (${servie.noms.size}) — plancher ${MIN_NOMS_SERVIES} : ` +
        'un verdict rendu sur une feuille qu’on n’a pas su lire déclare sans règle des classes qui en ont une'
    );
  }
  // Le sujet PAGES est mesuré à part : une union qui aurait grandi par le bundle
  // ne doit pas pouvoir faire passer un lecteur de pages cassé.
  const poseesParLesPages = [...posees.entries()].filter(([, e]) => e.sources.some((s) => s.sorte === 'page')).length;
  if (poseesParLesPages < MIN_CLASSES_POSEES) {
    throw new Error(
      `seulement ${poseesParLesPages} classe(s) DISTINCTE(s) posée(s) par les pages livrées — plancher ${MIN_CLASSES_POSEES} : ` +
        'c’est le SUJET du verdict, et un sujet vide ne prouve rien'
    );
  }
  if (illisibles.length) {
    throw new Error(
      `${illisibles.length} fichier(s) JavaScript illisible(s) (${illisibles.slice(0, 3).join(', ')}) — un lecteur ` +
        'partiel ne rend pas un verdict complet : les classes de ces fichiers ne sont pas confrontées à la feuille '
    );
  }
  if (scripts.length < MIN_FICHIERS_JS || valeursJs < MIN_VALEURS_JS || nomsDuJs.size < MIN_JETONS_JS) {
    throw new Error(
      `sujet JavaScript illisible (${scripts.length} fichier(s), ${valeursJs} valeur(s) entière(s) en position de ` +
        `classe, ${nomsDuJs.size} jeton(s) distinct(s)) — planchers ${MIN_FICHIERS_JS}, ${MIN_VALEURS_JS} et ` +
        `${MIN_JETONS_JS} : le lecteur du bundle n’a pas lu son sujet`
    );
  }

  const sansRegle = classesSansRegle(posees.keys(), servie.noms);
  const defauts = exemptionsEnDefaut(posees.keys(), NOMS_ACCEPTES_SANS_REGLE);
  const exemptionsPosees = Object.keys(NOMS_ACCEPTES_SANS_REGLE).filter((nom) => posees.has(nom)).length;

  console.log(
    `::notice::aucune classe posée sans règle — ${pages.length} page(s) livrée(s) et ${scripts.length} script(s) ` +
      `servi(s) (${valeursJs} valeur(s) entière(s), ${nomsDuJs.size} jeton(s) distinct(s)), ${feuilles.length} feuille(s) ` +
      `servie(s) (${servie.regles} règle(s), ${servie.noms.size} nom(s) de classe), ${posees.size} classe(s) DISTINCTE(s) ` +
      `posée(s), ${Object.keys(NOMS_ACCEPTES_SANS_REGLE).length} nom(s) accepté(s) sans règle dont ${exemptionsPosees} posé(s)`
  );

  if (!sansRegle.length && !defauts.sansMotif.length && !defauts.perimees.length) {
    console.log(
      `✅ Toute classe POSÉE a sa règle dans la feuille servie : ${posees.size} classe(s) DISTINCTE(s) — ` +
        `${poseesParLesPages} posée(s) par ${pages.length} page(s) livrée(s), ${nomsDuJs.size} par ${scripts.length} ` +
        `script(s) servi(s) — confrontées aux ${servie.noms.size} nom(s) de classe de ${feuilles.length} feuille(s) ` +
        'servie(s). Le lecteur du BUNDLE ne retient que les LITTÉRAUX ENTIERS d’une position de classe : ' +
        `${refusJs.nonLitteral} position(s) non littérale(s) (identifiant, résultat d’appel, index dynamique) et ` +
        `${refusJs.fragments} fragment(s) d’assemblage ne sont PAS jugés — un nom qui n’est écrit que là est hors ` +
        'du verdict, et c’est écrit plutôt que tu. La troisième direction du fait — un nom bloqué pourtant posé — ' +
        'appartient à `scripts/check-css-selecteurs-morts.js`.'
    );
    return;
  }

  for (const nom of sansRegle) {
    const { sources, porteur } = posees.get(nom);
    const parLesPages = sources.filter((s) => s.sorte === 'page').map((s) => s.nom);
    const parLeBundle = sources.filter((s) => s.sorte === 'bundle').map((s) => s.nom);
    const qui = [
      parLesPages.length ? `${listerSources(parLesPages)} (page)` : '',
      parLeBundle.length ? `${listerSources(parLeBundle)} (bundle)` : '',
    ].filter(Boolean).join(' et par ');
    console.error(
      `::error::« ${nom} » est POSÉE par ${qui} et AUCUNE règle servie ne la peint — portée par ` +
        `« ${abreger(porteur, nom)} ». Le CSS ne dit rien : l'élément est peint comme si la classe n'existait pas. ` +
        'Si c’est un utilitaire, l’écrire dans une source que Tailwind SCANNE (`src/**`) ; si c’est une classe de ' +
        'SITE, la définir dans une feuille servie ; sinon la retirer du livré, ou l’accepter dans ' +
        '`scripts/classes-sans-regle.js` avec sa raison.'
    );
  }
  for (const nom of defauts.sansMotif) {
    console.error(
      `::error::« ${nom} » est accepté SANS RÈGLE sans qu’aucun motif ne le dise (NOMS_ACCEPTES_SANS_REGLE de ` +
        'scripts/classes-sans-regle.js) : une exemption muette est un oubli qui a reçu un droit de passage. ' +
        'Lui écrire sa raison, ou la retirer.'
    );
  }
  for (const nom of defauts.perimees) {
    console.error(
      `::error::« ${nom} » est accepté SANS RÈGLE alors qu’AUCUNE page livrée ni AUCUN script servi ne le pose : l’exemption ne protège plus rien ` +
        'et elle mentirait sur l’arbre le jour où la classe reviendrait par ailleurs. La retirer de `NOMS_ACCEPTES_SANS_REGLE`.'
    );
  }
  console.error(
    `\n❌ ${sansRegle.length} classe(s) posée(s) sans règle servie, ${defauts.sansMotif.length} exemption(s) sans motif ` +
      `et ${defauts.perimees.length} exemption(s) périmée(s). Une classe posée DOIT exister dans la feuille servie — ` +
      'c’est la phrase que le garde des sélecteurs écrit sans la vérifier.'
  );
  process.exitCode = 1;
}

try {
  main();
} catch (erreur) {
  console.error(`::error::${erreur.message}`);
  process.exitCode = 1;
}
