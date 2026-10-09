/**
 * GARDE « AUCUNE CLASSE POSÉE SANS RÈGLE » — deux niveaux, comme les autres
 * gardes de ce dossier.
 *
 *   1. la RÈGLE (`scripts/classes-sans-regle.js`) est éprouvée DIRECTEMENT, sur
 *      des cas synthétiques : ce qu'une page POSE (un attribut `class`, jamais le
 *      contenu d'un bloc `<style>`, qui ne peut pas se poser lui-même), ce qu'une
 *      feuille SERVIE offre (des classes, pas des ID), et la liste des noms
 *      acceptés sans règle — qui doit refuser un motif vide comme une entrée
 *      périmée.
 *   2. le GARDE (`scripts/check-classes-sans-regle.js`) est lancé en
 *      SOUS-PROCESSUS sur des arbres de fixture — parce que ce qui compte est son
 *      CODE DE SORTIE et ses messages, pas ses fonctions. Les fixtures sont
 *      ENGENDRÉES au-dessus des planchers de lecture (10 pages, 2 feuilles, 400
 *      règles, 300 noms servis, 150 classes posées) : sans ça, le garde refuserait
 *      de juger et le test confondrait « refus » et « verdict ».
 *
 * Le cas positif sur l'arbre RÉEL est joué quand le build est là ET plus jeune
 * que les sources qu'il publie : la CI exécute `vitest` SANS build (le cas est
 * alors annoncé, pas silencieux), et un build périmé ferait rougir sur un
 * artefact que personne n'a reconstruit — le refus doit dire la vérité, pas
 * accuser le dépôt.
 *
 * Preuves d'échec rejouées à la main, et une par le harnais de mutation :
 *   • poser `opacity-50` dans une page de fixture (le cas réel du 09/10/2026) →
 *     sortie 1, nommant la page, la classe ET la valeur qui la porte ;
 *   • retirer `App` des pages d'une fixture → sortie 1 par l'exemption PÉRIMÉE
 *     (une exception que plus rien ne pose mentirait sur l'arbre) ;
 *   • neutraliser la comparaison (`classesSansRegle` → `[]`) → le cas
 *     `opacity-50` passe au vert ;
 *   • neutraliser le verdict (`if (!sansRegle.length && …)` → toujours vrai) →
 *     les trois cas de verdict passent au vert ;
 *   • neutraliser chacun des trois planchers de lecture → le refus nommé
 *     correspondant passe au vert.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIN_CLASSES_POSEES,
  MIN_REGLES_SERVIES,
  NOMS_ACCEPTES_SANS_REGLE,
  classesPoseesDePage,
  classesSansRegle,
  exemptionsEnDefaut,
  feuilleServie,
} from '../classes-sans-regle.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const GARDE = path.resolve(ICI, '..', 'check-classes-sans-regle.js');
const FRONTEND = path.resolve(ICI, '..', '..');

describe('classes-sans-regle — ce qu’une page POSE', () => {
  it('lit les attributs `class`, guillemets simples ou doubles, et découpe les listes', () => {
    const { noms } = classesPoseesDePage('<body class="a b"><p class=\'c d\'>x</p>');
    expect(noms).toEqual(['a', 'b', 'c', 'd']);
  });

  it('lit `class=`, et RIEN d’autre : ni `content`, ni un nom d’attribut', () => {
    // La lecture est celle du corpus des poseurs du garde des sélecteurs : c'est
    // la leçon des cinq `kojo-pack-*.css` supprimés le 28/09/2026, dont les noms
    // morts étaient « portés » par `<meta name="twitter:card">`.
    const { noms } = classesPoseesDePage('<meta name="twitter:card" content="summary">');
    expect(noms).toEqual([]);
  });

  it('RETIRE les blocs `<style>` avant de lire : une feuille ne POSE pas une classe', () => {
    // Sans ce retrait, la feuille servie se justifierait elle-même — et toute
    // règle morte serait « posée » par le document qui la décrit.
    const { noms, porteurDe } = classesPoseesDePage(
      '<style>.fantome{color:red}</style><div class="vrai">x</div>'
    );
    expect(noms).toEqual(['vrai']);
    expect(porteurDe.has('fantome')).toBe(false);
  });

  it('rend la VALEUR qui porte chaque nom (le verdict doit désigner la ligne)', () => {
    const { porteurDe } = classesPoseesDePage('<div class="une deux trois">x</div>');
    expect(porteurDe.get('deux')).toBe('une deux trois');
  });

  it('ne compte qu’UNE fois un nom porté par plusieurs éléments', () => {
    const { noms } = classesPoseesDePage('<i class="a"><i class="a b">');
    expect(noms).toEqual(['a', 'b']);
  });
});

describe('classes-sans-regle — ce que la feuille SERVIE offre', () => {
  it('résout les échappements CSS des classes à variante et à valeur arbitraire', () => {
    const { noms } = feuilleServie([
      String.raw`.md\:min-h-\[10rem\]{color:red}.hover\:bg-gray-50:hover{color:blue}`,
    ]);
    expect(noms.has('md:min-h-[10rem]')).toBe(true);
    expect(noms.has('hover:bg-gray-50')).toBe(true);
  });

  it('lit les classes d’une liste de sélecteurs et d’un `:is()`, et compte les règles imbriquées', () => {
    const { noms, regles } = feuilleServie(['.a, .b{color:red}@media (x){.c{color:blue}}:is(.d,.e) p{color:green}']);
    expect([...noms].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(regles).toBe(3);
  });

  it('REFUSE de se laisser disculper par un ID : `#root` ne peint pas `class="root"`', () => {
    // C'est la raison d'être de l'option `marques` de `nomsDeSelecteur` : lire
    // aussi les ID ferait passer un nom de classe pour servi alors qu'aucune
    // règle ne le peint.
    const { noms } = feuilleServie(['#root{color:red}#profil .x{color:blue}']);
    expect(noms.has('root')).toBe(false);
    expect(noms.has('profil')).toBe(false);
    expect(noms.has('x')).toBe(true);
  });

  it('UNION de toutes les feuilles servies : un nom peut avoir sa règle dans un fichier `.css`', () => {
    const { noms } = feuilleServie(['.une{color:red}', '.deux{color:blue}']);
    expect(noms.has('deux')).toBe(true);
  });
});

describe('classes-sans-regle — le verdict et les exemptions', () => {
  it('nomme une classe posée qu’aucune règle servie ne peint', () => {
    expect(classesSansRegle(['peinte', 'orpheline'], new Set(['peinte']))).toEqual(['orpheline']);
  });

  it('laisse passer un nom ACCEPTÉ sans règle, et ne laisse passer que lui', () => {
    expect(classesSansRegle(['App', 'orpheline'], new Set(), { App: 'raison' })).toEqual(['orpheline']);
  });

  it('refuse une exemption SANS MOTIF', () => {
    expect(exemptionsEnDefaut(['muette'], { muette: '   ' }).sansMotif).toEqual(['muette']);
    expect(exemptionsEnDefaut(['vive'], { vive: 'une raison' }).sansMotif).toEqual([]);
  });

  it('refuse une exemption PÉRIMÉE (plus rien ne la pose)', () => {
    expect(exemptionsEnDefaut(['autre'], { fantome: 'une raison' }).perimees).toEqual(['fantome']);
    expect(exemptionsEnDefaut(['vive'], { vive: 'une raison' }).perimees).toEqual([]);
  });

  it('la liste RÉELLE est motivée (une exemption muette serait un oubli avec un droit de passage)', () => {
    for (const [nom, motif] of Object.entries(NOMS_ACCEPTES_SANS_REGLE)) {
      expect(typeof motif, `exemption « ${nom} »`).toBe('string');
      expect(motif.trim().length, `exemption « ${nom} »`).toBeGreaterThan(20);
    }
  });
});

/**
 * Arbre de fixture ENGENDRÉ au-dessus des planchers du garde.
 *
 * Les trois sujets sont indépendants, et c'est ce qui rend chaque plancher
 * prouvable : un arbre peut être complet en pages et en classes posées tout en
 * étant illisible en feuilles servies (aucun bloc `<style>`, aucun `.css`), ou
 * complet en règles mais pauvre en NOMS servis (les règles de remplissage d'une
 * page nomment toutes le même sélecteur, ce qui gonfle le compte de règles sans
 * gonfler celui des noms).
 *
 * `App` est POSÉ par défaut : c'est l'exemption réelle que le garde lit dans le
 * module de règle, et une exemption périmée est refusée — donc une fixture qui ne
 * le pose pas n'est pas un arbre conforme.
 */
function ecrireArbre({
  nbPages = 12,
  classesParPage = 30,
  reglesDeRemplissage = 4,
  remplissagePartage = false,
  styles = true,
  feuillesCss = 1,
  classeAssetSeule = true,
  classeSansRegle = null,
  sansApp = false,
} = {}) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-classes-'));
  const build = path.join(racine, 'build');
  const assets = path.join(build, 'assets');
  fs.mkdirSync(assets, { recursive: true });

  // Une classe dont la seule règle vit dans le fichier `.css` SERVI : c'est la
  // contrepartie du plancher de feuilles — la feuille servie n'est pas seulement
  // les blocs `<style>` des pages.
  if (feuillesCss) {
    fs.writeFileSync(path.join(assets, 'app.css'), '.classe-du-fichier-css{color:red}\n', 'utf8');
  }

  for (let i = 0; i < nbPages; i += 1) {
    const posees = Array.from({ length: classesParPage }, (_, j) => `classe-p${i}-${j}`);
    if (!sansApp) posees.push('App');
    if (classeAssetSeule) posees.push('classe-du-fichier-css');
    if (classeSansRegle) posees.push(classeSansRegle);
    const regles = Array.from({ length: classesParPage }, (_, j) => `.classe-p${i}-${j}{color:red}`);
    for (let k = 0; k < reglesDeRemplissage; k += 1) {
      regles.push(`.remplissage-${remplissagePartage ? 'commun' : `${i}-${k}`}{color:blue}`);
    }
    const feuille = styles ? `<style>${regles.join('')}</style>` : '';
    fs.writeFileSync(
      path.join(build, `page-${i}.html`),
      `<html><head>${feuille}</head><body><div class="${posees.join(' ')}">x</div></body></html>`,
      'utf8'
    );
  }
  return { racine, build };
}

const lancerGarde = (build) => {
  try {
    const sortie = execFileSync(process.execPath, [GARDE, '--root', build], {
      encoding: 'utf8',
      errors: 'replace',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, sortie };
  } catch (erreur) {
    return { code: erreur.status, sortie: `${erreur.stdout || ''}${erreur.stderr || ''}` };
  }
};

describe('check-classes-sans-regle — le garde, sur des arbres de fixture', () => {
  it('sort 0 sur un arbre conforme, et PUBLIE ce qu’il a lu', () => {
    const { build } = ecrireArbre();
    const { code, sortie } = lancerGarde(build);
    expect(code).toBe(0);
    expect(sortie).toMatch(/Aucune classe posée sans règle|Toute classe POSÉE par une page livrée a sa règle/);
    expect(sortie).toMatch(/12 page\(s\) livrée\(s\), 13 feuille\(s\) servie\(s\)/);
    // L'exemption RÉELLE est publiée avec son compte : un zéro qui ne dirait pas
    // combien de noms il a acceptés serait indistinguable d'une liste vide.
    expect(sortie).toMatch(/1 nom\(s\) accepté\(s\) sans règle dont 1 posé\(s\)/);
  });

  it('sort 1 en NOMMANT la page, la classe et la valeur qui la porte (le cas réel de /support)', () => {
    const { build } = ecrireArbre({ classeSansRegle: 'opacity-50' });
    const { code, sortie } = lancerGarde(build);
    expect(code).toBe(1);
    expect(sortie).toMatch(/« opacity-50 » est POSÉE par page-0\.html/);
    // La valeur citée CONTIENT le nom accusé, même quand la liste de classes est
    // longue (fenêtre centrée sur le nom) : un message qui n'atteint pas la
    // classe qu'il accuse envoie le lecteur chercher à l'œil.
    expect(sortie).toMatch(/portée par « [^»]*opacity-50[^»]* »/);
    // L'exemption déclarée n'avale pas les autres noms : elle n'apparaît pas.
    expect(sortie).not.toMatch(/« App »/);
  });

  it('sort 1 quand la règle n’existe que dans le `.css` du build et qu’il est absent', () => {
    // Contrepartie du cas conforme : la même classe est disculpée par le fichier
    // `.css` serv quand il est là, et signalée quand il ne l'est plus.
    const { build } = ecrireArbre({ feuillesCss: 0 });
    const { code, sortie } = lancerGarde(build);
    expect(code).toBe(1);
    expect(sortie).toMatch(/« classe-du-fichier-css » est POSÉE/);
  });

  it('sort 1 quand une exemption n’est plus POSÉE (une exception qui ment sur l’arbre)', () => {
    const { build } = ecrireArbre({ sansApp: true });
    const { code, sortie } = lancerGarde(build);
    expect(code).toBe(1);
    expect(sortie).toMatch(/« App » est accepté SANS RÈGLE alors qu’AUCUNE page livrée ne le pose/);
  });

  // Les planchers de lecture, un arbre par plancher : chacun est prouvé par une
  // mutation d'une seule ligne du garde (cf. le registre des preuves).
  it('REFUSE de juger un livré sans pages (plancher de pages)', () => {
    const { build } = ecrireArbre({ nbPages: 1 });
    const { code, sortie } = lancerGarde(build);
    expect(code).toBe(1);
    expect(sortie).toMatch(/seulement 1 page\(s\) livrée\(s\) — plancher 10/);
  });

  it('REFUSE de juger une feuille servie illisible (plancher de feuilles et de règles)', () => {
    const { build } = ecrireArbre({ styles: false, feuillesCss: 0 });
    const { code, sortie } = lancerGarde(build);
    expect(code).toBe(1);
    expect(sortie).toMatch(/feuille servie illisible \(0 feuille\(s\), 0 règle\(s\)\)/);
    expect(sortie).toMatch(new RegExp(`planchers 2 et ${MIN_REGLES_SERVIES}`));
  });

  it('REFUSE de juger une feuille servie trop pauvre en noms de classe', () => {
    // 12 pages × 10 classes = 120 noms servis (< 300), et 12 × 40 règles de
    // remplissage sur UN SEUL nom : le compte de RÈGLES est au-dessus du
    // plancher, celui des NOMS ne l'est pas.
    const { build } = ecrireArbre({ classesParPage: 10, reglesDeRemplissage: 40, remplissagePartage: true });
    const { code, sortie } = lancerGarde(build);
    expect(code).toBe(1);
    expect(sortie).toMatch(/trop pauvre en noms de classe/);
  });

  it('REFUSE de juger un sujet vide (plancher de classes posées)', () => {
    const { build } = ecrireArbre({ classesParPage: 5, reglesDeRemplissage: 40 });
    const { code, sortie } = lancerGarde(build);
    expect(code).toBe(1);
    expect(sortie).toMatch(new RegExp(`plancher ${MIN_CLASSES_POSEES}`));
  });

  it('REFUSE de juger sans build (« un garde qui n’a rien lu n’a rien vérifié »)', () => {
    const { racine } = ecrireArbre();
    const { code, sortie } = lancerGarde(path.join(racine, 'absent'));
    expect(code).toBe(1);
    expect(sortie).toMatch(/dossier de build introuvable/);
  });

  /**
   * Le cas POSITIF sur l'arbre réel : il ne prouve pas une règle, il publie un
   * fait — le build du dépôt ne pose aucune classe sans règle. Il est SAUTÉ quand
   * le build est absent (la CI exécute `vitest` sans build) ou plus VIEUX que les
   * sources qui le publient (un build périmé ferait accuser le dépôt pour un
   * artefact que personne n'a reconstruit) ; le motif du saut est écrit ici.
   */
  const build = path.join(FRONTEND, 'build');
  const sourcesQuiPeignent = ['vite-plugins', 'src', 'tailwind.config.cjs'];
  const plusJeune = (chemin) => {
    if (!fs.existsSync(chemin)) return false;
    const reference = fs.statSync(path.join(build, 'index.html')).mtimeMs;
    const parcourir = (courant) => {
      if (fs.statSync(courant).isFile()) return fs.statSync(courant).mtimeMs > reference;
      return fs.readdirSync(courant).some((nom) => parcourir(path.join(courant, nom)));
    };
    return parcourir(chemin);
  };
  const buildAJour =
    fs.existsSync(path.join(build, 'index.html')) && !sourcesQuiPeignent.some((s) => plusJeune(path.join(FRONTEND, s)));

  it.skipIf(!buildAJour)('sort 0 sur l’arbre RÉEL (build à jour)', () => {
    const { code, sortie } = lancerGarde(build);
    expect(sortie).toMatch(/Toute classe POSÉE par une page livrée a sa règle/);
    expect(code).toBe(0);
  });
});
