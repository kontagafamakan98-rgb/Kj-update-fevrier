/**
 * PREUVE D'ÉCHEC REJOUÉE — la forme `*Icon` (les icônes DESSINÉES).
 *
 * Un plan de page pré-rendue nomme ses icônes par un champ de niveau ROUTE
 * terminé par `Icon` (`legalNoticeIcon`, `noJobIcon`…, `src/config/page-sections.js`)
 * et non plus par un emoji : la page les dessine par `IconePage` et la coquille
 * par `svgDeLIcone`, toutes deux lisant le MÊME registre
 * (`src/config/page-icons.js`). Ce que ces cas rejouent : on RENOMME l'icône dans
 * le plan SANS toucher la coquille, et le build REFUSE — une icône ne peut pas
 * disparaître en silence.
 *
 * Deux refus, et il faut les DEUX :
 *
 *   • le PREMIER à mordre en vrai — le REGISTRE. La coquille lit le nom DANS le
 *     plan (`svgDeLIcone(plan.noJobIcon, …)`), donc renommer vers une valeur
 *     inconnue fait lever `contenuDeLICone` AVANT même que le corps ne soit bâti.
 *     Relevé le 26/09/2026 : `noJobIcon: 'promiseFindWork'` → `'…Renomme'` fait
 *     sortir `npm run build` en **1** sur « page-icons : l'icône
 *     « promiseFindWorkRenomme » n'est pas déclarée dans le registre — un plan ne
 *     peut pas dessiner une icône qui n'existe pas. » (restauré, empreinte SHA-1
 *     de `page-sections.js` identique).
 *
 *   • le SECOND — `vite-plugins/prerender/declared-body.js`, `exigerCorpsDeclare`
 *     — pour la coquille qui cesse de DESSINER une icône pourtant déclarée (nom
 *     valide au registre, mais AUCUN repère `data-icone` dans le corps) :
 *     « la coquille … ne dessine pas … icône(s) … « X » manque ». C'est lui qui
 *     nomme la COQUILLE, là où le registre nomme le PLAN. Le registre ne peut pas
 *     le remplacer : il ne regarde QUE le nom, jamais ce que la coquille publie.
 */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, expect, it } from 'vitest';
import { makeDeclaredBodyGuard } from '../../vite-plugins/prerender/declared-body.js';
import { CLASSES_ICONE, contenuDeLICone, marqueurDIcone, NOMS_D_ICONES } from '../../src/config/page-icons.js';
import { classesDuJs } from '../css-selecteurs-morts.js';
import { PAGE_SECTIONS, pageSectionParts } from '../../src/config/page-sections.js';

const ICI = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ICI, 'src');

/** La SOURCE du domicile des classes — lue brute, pour ce que l'objet cache. */
const lireLaSourceDesIcones = () => readFileSync(join(SRC, 'config', 'page-icons.js'), 'utf8');

/** Un garde monté sur un plan SYNTHÉTIQUE : seul le champ `*Icon` compte ici. */
const gardeAvec = (plan) =>
  makeDeclaredBodyGuard({
    esc: (texte) => String(texte),
    T: (cle) => cle,
    registerT: (cle) => cle,
    jobsT: (cle) => cle,
    pageSections: { '/payment': plan },
    pageSectionParts,
  });

describe('forme `*Icon` — preuve d’échec rejouée', () => {
  it('renommer un `*Icon` du plan vers un nom inconnu fait lever le REGISTRE', () => {
    // C'est le refus qui mord en premier au build : la coquille lit le nom dans
    // le plan, donc le nom renommé est résolu AVANT que le corps ne soit composé.
    expect(() => contenuDeLICone('promiseFindWorkRenomme')).toThrow(
      /déclarée dans le registre/
    );
    // Le contrôle qui donne son sens au rouge : le nom d'origine, lui, existe.
    expect(() => contenuDeLICone('promiseFindWork')).not.toThrow();
  });

  it('une coquille qui ne dessine plus une icône déclarée est refusée, en la nommant', () => {
    // La mutation EXACTE : l'icône est renommée dans le plan, la coquille N'EST
    // PAS touchée — elle porte encore le repère de l'ANCIEN nom.
    const garde = gardeAvec({ noJobIcon: 'promiseFindWorkRenomme' });
    const corpsInchange = `<div>${marqueurDIcone('promiseFindWork')}</div>`;

    let erreur;
    try {
      garde('/payment', 'payment', corpsInchange);
    } catch (e) {
      erreur = e;
    }
    expect(erreur?.message).toContain('ne dessine pas');
    expect(erreur?.message).toContain('promiseFindWorkRenomme');
    expect(erreur?.message).toContain(marqueurDIcone('promiseFindWorkRenomme'));
    expect(erreur?.message).toContain('la coquille');
  });

  it('la coquille qui dessine l’icône déclarée passe — le refus n’est pas un refus de principe', () => {
    // Contrôle positif : la même coquille, l'icône au bon nom, ne lève pas. Sans
    // lui, le cas négatif ne prouverait pas que le repère `data-icone` est bien
    // ce que le garde exige.
    const garde = gardeAvec({ noJobIcon: 'promiseFindWork' });
    expect(() =>
      garde('/payment', 'payment', `<div>${marqueurDIcone('promiseFindWork')}</div>`)
    ).not.toThrow();
  });

  it('le plan RÉEL ne déclare aucune icône absente du registre', () => {
    // Le contrôle de l'arbre réel : il garantit que le refus ci-dessus décrit une
    // mutation, jamais un état de départ déjà rouge.
    const declarees = new Set();
    for (const plan of Object.values(PAGE_SECTIONS)) {
      for (const nom of pageSectionParts(plan).icones) declarees.add(nom);
    }
    // 31 noms DISTINCTS mesurés le 26/09/2026 (45 occurrences avant dédoublonnage,
    // cf. `check-shell-text-provenance.test.js`) : le plancher prouve que la
    // boucle a lu le vrai plan, sans se figer sur une valeur exacte.
    expect(declarees.size).toBeGreaterThanOrEqual(30);
    expect([...declarees].filter((nom) => !NOMS_D_ICONES.includes(nom))).toEqual([]);
  });

  it('`CLASSES_ICONE` ne déclare aucune clé DEUX fois', () => {
    // L'état mesuré le 28/09/2026 : `badge` était déclaré deux fois — le repère
    // du badge de confiance (`inline h-3 w-3`) ÉTAIT écrasé par la pastille
    // blanche de 24 px de /forgot-password, si bien que la coche du badge se
    // peignait blanche dans une pastille orange pâle, c'est-à-dire invisible.
    // Rien ne l'a vu pendant une passe entière : un doublon de clé n'est qu'un
    // AVERTISSEMENT de compilation, et le canevas publié n'en garde aucune trace
    // (la classe écrasée n'existe simplement plus). Ce contrôle lit la SOURCE de
    // l'objet — c'est le seul endroit où le doublon est encore visible — et
    // compare la liste des clés écrite à la liste que JavaScript garde.
    const source = readFileSync(join(ICI, 'src', 'config', 'page-icons.js'), 'utf8');
    const debut = source.indexOf('export const CLASSES_ICONE');
    expect(debut, '`CLASSES_ICONE` a quitté src/config/page-icons.js — ce contrôle ne lit plus rien').toBeGreaterThan(-1);
    const corps = source.slice(debut, source.indexOf('};', debut));
    const ecrites = [...corps.matchAll(/^\s{2}([A-Za-z_][A-Za-z0-9_]*):/gm)].map((m) => m[1]);
    // Le plancher prouve que l'extraction a lu l'objet entier, sans se figer sur
    // un compte exact (une classe ajoutée ne doit pas rougir ici).
    expect(ecrites.length).toBeGreaterThanOrEqual(15);
    const doublons = ecrites.filter((cle, index) => ecrites.indexOf(cle) !== index);
    expect(doublons, `clé(s) déclarée(s) deux fois dans CLASSES_ICONE : ${doublons.join(', ')}`).toEqual([]);
    // Et le témoin direct : ce que JavaScript garde vraiment de cet objet porte
    // autant de clés qu'il en est écrit — sinon l'extraction lit un autre objet.
    expect(Object.keys(CLASSES_ICONE).length).toBe(ecrites.length);
  });

  /**
   * LE DOMICILE EST LISIBLE D'UN BOUT (09/10/2026).
   *
   * Une classe d'icône n'est vue par `check-css-selecteurs-morts.js` que si une
   * POSITION DE CLASSE la porte — et ce corpus ne résout un objet que depuis le
   * fichier où il est déclaré. Mesuré avant ce contrôle : `classesDuJs` de
   * `page-icons.js` rendait **0 valeur**, donc chaque classe du domicile ne tenait
   * que par le HTML d'une coquille qui la posait, et une classe peinte par la
   * PAGE SEULE (le repère du badge de confiance) n'avait aucun porteur lisible :
   * elle devait s'écrire en clair chez son appelant, c'est-à-dire hors du domicile.
   * `IconePage` nomme maintenant le registre dans une position de classe
   * (`className: [CLASSES_ICONE[role], …]`) : ce cas tient cette ligne, et il
   * rougit si elle redevient un appel (`className: classeDeRole(role)` rendrait le
   * domicile invisible à nouveau).
   */
  it('le corpus LIT le domicile : toutes les classes de `CLASSES_ICONE` sont vues', () => {
    const vues = new Set(classesDuJs(lireLaSourceDesIcones()));
    const manquantes = [...new Set(Object.values(CLASSES_ICONE))].filter((classe) => !vues.has(classe));
    expect(
      manquantes,
      `classe(s) du domicile INVISIBLES au corpus : ${manquantes.join(' | ')} — une classe d'icône ne doit pas dépendre d'un littéral écrit ailleurs pour être vue`
    ).toEqual([]);
    // Le plancher : un lecteur qui ne lirait rien ne prouverait rien. Mesuré le
    // 09/10/2026 : **0 valeur** avant, 18 après — et non 21, parce que plusieurs
    // rôles PARTAGENT la même classe (`h-5 w-5`) et que le corpus rend un
    // ENSEMBLE : le compte des valeurs distinctes est plus petit que celui des
    // rôles, c'est `manquantes` qui porte l'égalité (par valeur, pas par compte).
    expect(vues.size).toBeGreaterThanOrEqual(15);
  });

  /**
   * AUCUN APPELANT N'ÉCRIT UNE CLASSE D'ICÔNE EN CLAIR.
   *
   * C'est la règle que le domicile porte : un emplacement d'icône dit un RÔLE. Le
   * balayage est un TEXTE, pas une intention — `classe=` dans un fichier qui
   * dessine une icône du registre est la forme qu'a prise le défaut le 07/10/2026
   * (le repère du badge écrit chez `workerTrustLevel.js`), et c'est celle qu'on ne
   * veut plus. Le fichier du domicile est EXCLU : c'est le seul où une classe est
   * écrite en clair, et c'est son métier.
   */
  it('aucun fichier qui dessine une icône du registre ne passe de classe en clair', () => {
    const dessine = new Set();
    const parcourir = (dossier) => {
      for (const entree of readdirSync(dossier, { withFileTypes: true })) {
        const chemin = join(dossier, entree.name);
        if (entree.isDirectory()) { parcourir(chemin); continue; }
        if (!/\.(js|jsx)$/.test(entree.name)) continue;
        const texte = readFileSync(chemin, 'utf8');
        if (!/\bIconePage\b/.test(texte)) continue;
        for (const ligne of texte.split('\n')) {
          if (/classe=/.test(ligne)) dessine.add(`${chemin.replace(SRC, 'src')} : ${ligne.trim().slice(0, 80)}`);
        }
      }
    };
    parcourir(SRC);
    expect([...dessine], 'une classe d’icône écrite hors du domicile est une classe qui n’a pas de propriétaire').toEqual([]);
  });
});
