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
 * Pourquoi les pages, et pas le JavaScript du bundle, cf. l'en-tête de
 * `scripts/classes-sans-regle.js` : c'est une mesure (515 jetons sans règle dans
 * le corpus du bundle, tous du bruit — fragments de gabarit, prose, noms de
 * route, SVG — contre 1 116 classes réellement posées par les pages, dont 13
 * sans règle). Le trou réel est là : `vite-plugins/prerender/**` n'est pas dans
 * le `content` de Tailwind, donc une classe écrite UNIQUEMENT dans une coquille
 * n'est générée par personne — et c'est la peinture du premier écran.
 *
 * ── Les refus (un vert sans lecture est un faux vert) ───────────────────────
 * Le garde REFUSE de rendre un verdict si le build est absent, s'il lit moins de
 * 10 pages livrées, moins de 2 feuilles servies, moins de 400 règles, moins de
 * 300 noms de classe servis ou moins de 300 classes posées — et il refuse AUSSI
 * une exemption sans motif ou une exemption que plus aucune page ne pose (une
 * exception qu'on n'ose plus retirer est une exception qui mente).
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   cd frontend && npm run build && node scripts/check-classes-sans-regle.js
 *   node scripts/check-classes-sans-regle.js --root <build>
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  MIN_CLASSES_POSEES,
  MIN_FEUILLES_SERVIES,
  MIN_NOMS_SERVIES,
  MIN_PAGES_LIVREES,
  MIN_REGLES_SERVIES,
  NOMS_ACCEPTES_SANS_REGLE,
  classesPoseesDePage,
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

/** Toutes les feuilles `.css` d'un dossier (récursif), triées — elles sont servies. */
function feuillesCss(dossier) {
  const trouvees = [];
  const parcourir = (courant) => {
    for (const entree of fs.readdirSync(courant, { withFileTypes: true })) {
      const chemin = path.join(courant, entree.name);
      if (entree.isDirectory()) { parcourir(chemin); continue; }
      if (entree.name.endsWith('.css')) trouvees.push(chemin);
    }
  };
  parcourir(dossier);
  return trouvees.sort();
}

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

/** Les pages d'un nom, abrégées : cinq au plus, le reste compté. */
const listerPages = (pages) =>
  pages.length <= 5 ? pages.join(', ') : `${pages.slice(0, 5).join(', ')} et ${pages.length - 5} autre(s)`;

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

  // ── Le sujet : ce que les PAGES posent ─────────────────────────────────────
  const posees = new Map(); // nom -> { pages: string[], porteur: string }
  const feuilles = [];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(RACINE, page), 'utf8');
    for (const css of feuillesDe(html)) feuilles.push(css);
    for (const [nom, porteur] of classesPoseesDePage(html).porteurDe) {
      const entree = posees.get(nom) || { pages: [], porteur };
      if (!entree.pages.includes(page)) entree.pages.push(page);
      posees.set(nom, entree);
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
  if (posees.size < MIN_CLASSES_POSEES) {
    throw new Error(
      `seulement ${posees.size} classe(s) DISTINCTE(s) posée(s) par les pages livrées — plancher ${MIN_CLASSES_POSEES} : ` +
        'c’est le SUJET du verdict, et un sujet vide ne prouve rien'
    );
  }

  const sansRegle = classesSansRegle(posees.keys(), servie.noms);
  const defauts = exemptionsEnDefaut(posees.keys(), NOMS_ACCEPTES_SANS_REGLE);
  const exemptionsPosees = Object.keys(NOMS_ACCEPTES_SANS_REGLE).filter((nom) => posees.has(nom)).length;

  console.log(
    `::notice::aucune classe posée sans règle — ${pages.length} page(s) livrée(s), ${feuilles.length} feuille(s) servie(s) ` +
      `(${servie.regles} règle(s), ${servie.noms.size} nom(s) de classe), ${posees.size} classe(s) DISTINCTE(s) posée(s), ` +
      `${Object.keys(NOMS_ACCEPTES_SANS_REGLE).length} nom(s) accepté(s) sans règle dont ${exemptionsPosees} posé(s)`
  );

  if (!sansRegle.length && !defauts.sansMotif.length && !defauts.perimees.length) {
    console.log(
      `✅ Toute classe POSÉE par une page livrée a sa règle dans la feuille servie : ${posees.size} classe(s) ` +
        `DISTINCTE(s) (${pages.length} page(s)) confrontées aux ${servie.noms.size} nom(s) de classe de ` +
        `${feuilles.length} feuille(s) servie(s). ` +
        'Le JavaScript du bundle n’est PAS jugé ici (Tailwind scanne `src/**`, et son corpus ne distingue pas une ' +
        'classe d’un fragment de chaîne) : sa troisième direction — un nom bloqué pourtant posé — appartient à ' +
        '`scripts/check-css-selecteurs-morts.js`.'
    );
    return;
  }

  for (const nom of sansRegle) {
    const { pages: portantes, porteur } = posees.get(nom);
    console.error(
      `::error::« ${nom} » est POSÉE par ${listerPages(portantes)} et AUCUNE règle servie ne la peint — portée par ` +
        `« ${abreger(porteur, nom)} ». Le CSS ne dit rien : l'élément est peint comme si la classe n'existait pas. ` +
        'L’écrire dans une source que Tailwind SCANNE (`src/**`), la retirer du livré, ou l’accepter dans ' +
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
      `::error::« ${nom} » est accepté SANS RÈGLE alors qu’AUCUNE page livrée ne le pose : l’exemption ne protège plus rien ` +
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
