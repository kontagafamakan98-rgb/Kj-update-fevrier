/**
 * LE PIED DE PAGE ET LA BARRE DU BAS SE LISENT SUR LEUR VITRE.
 *
 * ── Le défaut que ce fichier ferme ─────────────────────────────────────────
 * Les deux surfaces sont du VERRE (`.verre-barre` : `rgba(253, 250, 244, 0.78)`
 * + flou), comme la barre du haut : la teinte d'un lien n'y est donc pas posée
 * sur du papier, mais sur un composite qui dépend de ce qui défile derrière.
 * Mesuré le 27/10/2026 sur les deux fonds de référence du dépôt (`--kojo-sable`
 * → `#fcf8f2`, `--kojo-encre` → `#ccc9c3`) :
 *   • pied de page, encre de repos `orange-700` : 4,89:1 puis **3,13:1** ;
 *   • pied de page, survol des liens de contact `orange-700` : **3,13:1** ;
 *   • pied de page, survol des liens de navigation `orange-800` : **4,42:1** ;
 *   • barre du bas, libellé inactif `gray-500` : 4,57:1 puis **2,93:1** ;
 *   • barre du bas, onglet actif : `orange-600` sur `bg-orange-50` (OPAQUE),
 *     **3,35:1** — jugé sur ce fond-là, pas sur la vitre qu'il recouvre.
 *
 * ── Ce qui est mesuré ─────────────────────────────────────────────────────
 * Les valeurs sont lues dans les SOURCES qui les peignent — les constantes
 * `PIED_*` de `src/config/classes-chrome.js` (les deux canaux les importent :
 * React dans `App.js`, les coquilles pré-rendues dans `prerender/app-chrome.js`)
 * et les classes de `MobileBottomNav.js`. Le composite du verre est RECALCULÉ
 * depuis `src/index.css` : une vitre qui changerait d'opacité ou de teinte
 * change la mesure sans qu'on touche à ce fichier.
 *
 * Chaque littéral attendu doit être PRÉSENT dans sa source : un retour à
 * l'ancienne teinte fait donc rougir ce test en le nommant, au lieu de le
 * laisser passer parce que le motif ne trouve plus rien.
 *
 * ── LES ICÔNES AUSSI, À LEUR PROPRE SEUIL (27/10/2026) ────────────
 * Ce fichier disait ne pas juger les icônes, qui relèvent de 1.4.11 (3:1, objets
 * graphiques) et non du 4,5:1 du texte. Ce paragraphe était une limite, et la
 * limite était un défaut : les inactives portaient `gray-400` (`#9ca3af`),
 * **2,40:1** sur le sable et **1,54:1** au pire cas — sous les 3:1 du critère
 * qui les concerne. Ils sont donc mesurés ici, à leur seuil : inactives
 * `gray-600` (`#4b5563`, 7,14:1 et 4,57:1), actives `orange-700` sur le fond
 * opaque `bg-orange-50` (4,88:1), et la cloche comme les inactives.
 *
 * La CLOCHE a deux objets, et le premier jet de ce fichier n'en mesurait aucun :
 * son TRACÉ (`text-gray-600`, 1.4.11) et son LIBELLÉ « Notifications », qui
 * hérite de l'encre du bouton — `text-gray-500`, 4,57:1 puis **2,93:1**, sous
 * le seuil du texte. Les deux sont maintenant jugés, chacun au sien.
 *
 * ── Ce que ce fichier ne prouve pas ───────────────────────────────────────
 * Les classes COMPOSÉES à l'exécution (`className={base + variante}`) échappent
 * à une lecture de source : la présence du littéral est exigée, pas l'état
 * final du DOM.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrasteEntre, SEUIL_GRAPHIQUE, SEUIL_TEXTE } from '../../../scripts/contraste-jetons.js';

const FRONTEND = path.resolve(__dirname, '../../..');
const CSS = fs.readFileSync(path.join(FRONTEND, 'src/index.css'), 'utf8');
const CHROME = fs.readFileSync(path.join(FRONTEND, 'src/config/classes-chrome.js'), 'utf8');
const APP = fs.readFileSync(path.join(FRONTEND, 'src/App.js'), 'utf8');
const BARRE = fs.readFileSync(path.join(FRONTEND, 'src/components/MobileBottomNav.js'), 'utf8');

const lire = (source, motif, quoi) => {
  const trouve = source.match(motif);
  if (!trouve) throw new Error(`${quoi} introuvable : la mesure refuse de conclure sur une surface qu'elle ne connaît pas`);
  return trouve;
};

const jeton = (nom) =>
  lire(CSS, new RegExp(`${nom}:\\s*(#[0-9a-fA-F]{6})`), `le jeton ${nom}`)[1];

const versRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const versHex = (rgb) => `#${rgb.map((valeur) => Math.round(valeur).toString(16).padStart(2, '0')).join('')}`;
const composer = ([r, g, b, a], fond) =>
  versHex([r, g, b].map((canal, index) => canal * a + fond[index] * (1 - a)));

/** La vitre telle qu'elle est peinte, sur les deux fonds de référence. */
const FOND_DU_VERRE = () =>
  lire(CSS, /\.verre-barre[\s\S]{0,400}?background-color:\s*rgba\(([^)]+)\)/, 'le fond de `.verre-barre`')[1]
    .split(',')
    .map((valeur) => Number(valeur.trim()));

const VERRE = FOND_DU_VERRE();
const SABLE = composer(VERRE, versRgb(jeton('--kojo-sable')));
const ENCRE = composer(VERRE, versRgb(jeton('--kojo-encre')));
/** Les deux surfaces d'un texte posé sur la vitre : la plus défavorable décide. */
const SURFACES_VERRE = [SABLE, ENCRE];

/**
 * Les teintes que ces deux surfaces emploient — et celles de la RÉGRESSION
 * (`orange-600`, `orange-800`, `gray-500`, `gray-400`) pour qu'un retour en
 * arrière soit MESURÉ : une teinte inconnue serait refusée, ce qui dit qu'on ne
 * sait pas et non de combien on échoue. `gray-400` n'est plus peinte nulle part
 * ici : elle est la teinte d'icône d'AVANT le 27/10/2026, gardée pour que la
 * régression rende son rapport (1,54:1) au lieu d'un refus muet.
 */
const ENCRES = {
  // Les teintes CHAUDES désormais peintes (29/10/2026) : la barre du bas, son
  // bouton de cloche et le pied de page quittent les gris froids pour
  // `stone-700`, la même encre que les liens de la barre du haut. Elles sont
  // MESURÉES comme les autres — déclarer une teinte ne la fait pas passer.
  'stone-700': '#44403c',
  'gray-400': '#9ca3af',
  'gray-500': '#6b7280',
  'gray-600': '#4b5563',
  'gray-700': '#374151',
  'orange-600': '#ea580c',
  'orange-700': '#c2410c',
  'orange-800': '#9a3412',
  'orange-900': '#7c2d12',
  'orange-950': '#431407',
};

const ORANGE_50 = '#fff7ed';

/** Les fonds OPAQUES que la barre du bas peint sous ses libellés. */
const FONDS_OPAQUES = { 'orange-50': ORANGE_50 };

/** Le pire rapport d'une encre sur la vitre (le plus défavorable des deux composites). */
const pireSurLeVerre = (teinte) => Math.min(...SURFACES_VERRE.map((fond) => contrasteEntre(ENCRES[teinte], fond)));

const ratio = (teinte, surface) => {
  if (!Object.hasOwn(ENCRES, teinte)) {
    throw new Error(
      `la teinte « text-${teinte} » n'est pas dans la table de ce fichier — la mesure refuse de ` +
        'conclure (l’ajouter à ENCRES, après l’avoir mesurée)'
    );
  }
  return surface === 'verre' ? pireSurLeVerre(teinte) : contrasteEntre(ENCRES[teinte], ORANGE_50);
};

/**
 * Le fond OPAQUE peint sous l'onglet ACTIF, lu sur le LIEN qui le porte.
 *
 * L'icône et le libellé de cet onglet sont des enfants : ils ne peignent rien
 * eux-mêmes et héritent de cette surface. Les juger contre le verre
 * certifierait un fond qu'ils recouvrent — la même erreur que mesurer l'encart
 * de `/login` contre la carte au lieu de son propre fond. Le fond est cherché
 * UNE fois pour les deux mesures (libellés, icônes) : deux recherches pour une
 * même teinte finiraient par diverger.
 */
const surfaceDeLOngletActif = () => {
  const classesActives = [...BARRE.matchAll(/isActive \? '([^']*)' :/g)].map(([, classes]) => classes);
  const fond = classesActives.map((classes) => /bg-orange-(\d{2,3})/.exec(classes)).find(Boolean);
  if (!fond) return 'verre';
  const surface = FONDS_OPAQUES[`orange-${fond[1]}`];
  if (!surface) {
    throw new Error(
      `la barre du bas peint « bg-orange-${fond[1]} » sans que ce fichier connaisse sa couleur — ` +
        'la mesure refuse de conclure'
    );
  }
  return surface;
};

/** La valeur d'une constante `PIED_*`, refusée nommément si elle a disparu. */
const constante = (nom) =>
  lire(CHROME, new RegExp(`export const ${nom} =\\s*'([^']*)'`), `la constante ${nom}`)[1];

/** Les encres déclarées par une chaîne de classes : au repos, puis au survol. */
const encresDe = (classes) => {
  const repos = [];
  const survol = [];
  for (const token of classes.split(/\s+/)) {
    const teinte = /^text-([a-z]+-\d{2,3})$/.exec(token);
    if (teinte) repos.push(teinte[1]);
    const survolee = /^hover:text-([a-z]+-\d{2,3})$/.exec(token);
    if (survolee) survol.push(survolee[1]);
  }
  return { repos, survol };
};

const PIED = {
  adresse: constante('PIED_ADRESSE_CLASS'),
  navigation: constante('PIED_NAV_CLASS'),
  // `PIED_LIEN_LONG_CLASS` n'est pas listé : il COMPOSE `PIED_LIEN_CLASS`
  // (`${PIED_LIEN_CLASS} break-all`), donc il porte la même encre — la mesurer
  // une seconde fois ne dirait rien de plus.
  lien: constante('PIED_LIEN_CLASS'),
  lienNavigation: constante('PIED_NAV_LIEN_CLASS'),
};

describe('pied de page et barre du bas — lisibilité sur la vitre', () => {
  it('le pied de page est bien la VITRE que ce fichier mesure', () => {
    expect(
      constante('PIED_CLASS'),
      'le pied de page ne porte plus `.verre-barre` : la surface mesurée n’est plus celle qu’il peint'
    ).toContain('verre-barre');
  });

  it('les encres du pied de page tiennent 4,5:1, au repos comme au survol', () => {
    // Chaque constante est LUE par le pied de page : une encre déclarée mais
    // jamais peinte ne prouverait rien de ce que la personne lit.
    for (const nom of ['PIED_ADRESSE_CLASS', 'PIED_NAV_CLASS', 'PIED_LIEN_CLASS', 'PIED_NAV_LIEN_CLASS']) {
      expect(APP.includes(nom), `${nom} n’est plus lue par App.js : la mesure porterait sur du code mort`).toBe(true);
    }

    const mesures = [];
    for (const [surface, classes] of Object.entries(PIED)) {
      const { repos, survol } = encresDe(classes);
      for (const teinte of repos) mesures.push({ surface, etat: 'au repos', teinte, ratio: ratio(teinte, 'verre') });
      for (const teinte of survol) mesures.push({ surface, etat: 'au survol', teinte, ratio: ratio(teinte, 'verre') });
    }

    expect(
      mesures.length,
      `seulement ${mesures.length} encre(s) mesurée(s) dans le pied de page : la mesure refuse de conclure`
    ).toBeGreaterThanOrEqual(4);

    const fautes = mesures
      .filter(({ ratio: valeur }) => valeur < SEUIL_TEXTE)
      .map(
        ({ surface, etat, teinte, ratio: valeur }) =>
          `pied de page, ${surface} ${etat} : text-${teinte} = ${valeur.toFixed(2)}:1 ` +
          `sur le verre (${SABLE} sur sable, ${ENCRE} sur encre), seuil ${SEUIL_TEXTE}:1 (WCAG 1.4.3)`
      );
    expect(fautes, `encre sous le seuil dans le pied de page :\n  ${fautes.join('\n  ')}`).toEqual([]);
  });

  it('les libellés de la barre du bas tiennent 4,5:1, actif comme inactif', () => {
    // La barre ne déclare AUCUN survol : ce sont ses deux états réels qui sont
    // mesurés. Ils sont LUS dans la source (`isActive ? 'actif' : 'inactif'`),
    // pas comparés à des littéraux attendus — une régression vers `gray-500`
    // doit rendre son rapport, pas un refus muet.
    const paires = [...BARRE.matchAll(/isActive \? '([^']*)' : '([^']*)'/g)];
    expect(
      paires.length,
      `la barre du bas ne déclare plus ses deux états d’onglet (${paires.length} paire(s) lue(s)) : ` +
        'la mesure refuse de conclure sur un balayage vide'
    ).toBeGreaterThanOrEqual(2);

    // L'onglet actif peint son fond sur le LIEN ; son libellé est un `<span>`
    // ENFANT, qui hérite de cette surface. Juger le span contre le verre
    // certifierait un fond que le survol ne laisse pas voir — la même erreur
    // que mesurer l'encart de `/login` contre la carte au lieu de son propre
    // fond. La surface de l'état ACTIF est donc lue sur le lien, une fois
    // (`surfaceDeLOngletActif`), et partagée avec la mesure des icônes.
    const surfaceActive = surfaceDeLOngletActif();

    const mesures = [];
    for (const [, classeActive, classeInactive] of paires) {
      for (const [etat, classes, surface] of [
        ['actif', classeActive, surfaceActive],
        ['inactif', classeInactive, 'verre'],
      ]) {
        for (const teinte of encresDe(classes).repos) {
          mesures.push({
            etat,
            teinte,
            ratio: surface === 'verre' ? pireSurLeVerre(teinte) : contrasteEntre(ENCRES[teinte], surface),
            surface: surface === 'verre' ? 'le verre de la barre' : `#fff7ed (${surface})`,
          });
        }
      }
    }

    // ── LA CLOCHE REND UN LIBELLÉ, DONC DU TEXTE ────────────────
    // « Notifications » hérite de l'encre du BOUTON (`caseDeCloche`), qui vaut
    // `text-gray-500` — 4,57:1 sur le sable puis **2,93:1** — : la cinquième
    // case de la barre n'était mesurée par personne, parce qu'elle n'a pas de
    // paire `isActive ? …` et que son tracé, lui, n'est pas du texte. Le seuil
    // appliqué est donc celui du libellé, pas celui de l'icône.
    const caseDeCloche = lire(
      BARRE,
      /const caseDeCloche =\s*`[^`]*?\b(text-[a-z]+-\d{2,3})\b/,
      'l’encre du bouton de la cloche'
    )[1].replace('text-', '');
    mesures.push({
      etat: 'de la cloche',
      teinte: caseDeCloche,
      ratio: ratio(caseDeCloche, 'verre'),
      surface: 'le verre de la barre',
    });

    const fautes = mesures
      .filter(({ ratio: valeur }) => valeur < SEUIL_TEXTE)
      .map(
        ({ etat, teinte, ratio: valeur, surface }) =>
          `barre du bas, libellé ${etat} : text-${teinte} = ${valeur.toFixed(2)}:1 sur ${surface}, ` +
          `seuil ${SEUIL_TEXTE}:1 (WCAG 1.4.3)`
      );
    expect(fautes, `libellé sous le seuil dans la barre du bas :\n  ${fautes.join('\n  ')}`).toEqual([]);
  });

  it('les icônes de la barre du bas tiennent 3:1, actives comme inactives', () => {
    // Le seuil n'est pas celui du texte : un tracé d'icône relève de 1.4.11
    // (3:1, objet graphique porteur d'information). Mesurer les icônes au 4,5:1
    // du libellé qu'elles accompagnent demanderait une teinte qu'aucune n'a
    // besoin d'atteindre ; mesurer les libellés à 3:1 laisserait le texte sous
    // son propre seuil. Chaque objet est donc jugé au sien.
    const paires = [...BARRE.matchAll(/active \? '([^']*)' : '([^']*)'/g)];
    expect(
      paires.length,
      `la barre du bas ne déclare plus les deux états de ses icônes (${paires.length} paire(s) ` +
        'lue(s)) : la mesure refuse de conclure sur un balayage vide'
    ).toBeGreaterThanOrEqual(8);

    // La CLOCHE est une icône de la barre comme les autres : son tracé est un
    // objet graphique sur la même vitre, et son `iconClassName` est lu ici pour
    // qu'une teinte plus claire ne passe pas par la porte de service.
    const cloche = /iconClassName="([^"]*)"/.exec(BARRE);
    expect(
      cloche,
      'la barre du bas ne déclare plus l’icône de la cloche : la mesure des icônes porterait sur trois cases sur quatre'
    ).toBeTruthy();

    const surfaceActive = surfaceDeLOngletActif();
    const mesures = [];
    const mesurer = (etat, classes, surface, ou) => {
      for (const teinte of encresDe(classes).repos) {
        if (!Object.hasOwn(ENCRES, teinte)) {
          throw new Error(
            `${ou} : la teinte « text-${teinte} » n'est pas dans la table de ce fichier — la mesure ` +
              'refuse de conclure (l’ajouter à ENCRES, après l’avoir mesurée)'
          );
        }
        mesures.push({
          ou,
          etat,
          teinte,
          ratio: surface === 'verre' ? pireSurLeVerre(teinte) : contrasteEntre(ENCRES[teinte], surface),
          surface: surface === 'verre' ? 'le verre de la barre' : `#fff7ed (${surface})`,
        });
      }
    };

    for (const [, classeActive, classeInactive] of paires) {
      mesurer('active', classeActive, surfaceActive, 'icône');
      mesurer('inactive', classeInactive, 'verre', 'icône');
    }
    mesurer('inactive', cloche[1], 'verre', 'cloche');

    expect(
      mesures.length,
      `seulement ${mesures.length} icône(s) mesurée(s) : la mesure refuse de conclure`
    ).toBeGreaterThanOrEqual(9);

    const fautes = mesures
      .filter(({ ratio: valeur }) => valeur < SEUIL_GRAPHIQUE)
      .map(
        ({ ou, etat, teinte, ratio: valeur, surface }) =>
          `barre du bas, ${ou} ${etat} : text-${teinte} = ${valeur.toFixed(2)}:1 sur ${surface}, ` +
          `seuil ${SEUIL_GRAPHIQUE}:1 (WCAG 1.4.11)`
      );
    expect(fautes, `icône sous le seuil dans la barre du bas :\n  ${fautes.join('\n  ')}`).toEqual([]);
  });
});
