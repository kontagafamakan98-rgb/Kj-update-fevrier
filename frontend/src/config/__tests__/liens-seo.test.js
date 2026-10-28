/**
 * LE MAILLAGE SEO SE LIT SUR DEUX SURFACES, PAS SUR UNE.
 *
 * ── Pourquoi ce fichier existe ─────────────────────────────────────────────
 * Le bloc de liens `src/config/liens-seo.js` est peint à DEUX endroits qui
 * n'ont pas le même fond :
 *   • l'accueil, sur le PAPIER (`--kojo-papier` → `#fffdf9`) ;
 *   • le pied de page, sur du VERRE (`.verre-barre` :
 *     `rgba(253, 250, 244, 0.78)` + flou), donc sur un composite qui dépend de
 *     ce qui défile derrière — `#fcf8f2` sur le sable, `#ccc9c3` sur l'encre.
 * Une teinte choisie pour la première surface peut tomber sous le seuil sur la
 * seconde : c'est le défaut qu'a produit `orange-700` sur le verre du pied de
 * page (3,13:1), mesuré et corrigé le 27/10/2026. Le module emploie donc les
 * encres DÉJÀ mesurées de ce pied de page (`orange-900`, survol `orange-950`,
 * titre `stone-800`), et ce fichier le vérifie au lieu de le commenter.
 *
 * La mesure RETIENT LA PIRE des trois surfaces : une encre qui ne tient que sur
 * le papier n'a pas tenu, puisque le même lien est peint sur la vitre.
 *
 * Les teintes de la RÉGRESSION (`orange-600`, `orange-700`, `orange-800`,
 * `stone-500`, `stone-600`) restent dans la table pour être MESURÉES : une
 * teinte inconnue serait refusée, ce qui dit qu'on ne sait pas et non de combien
 * on échoue.
 *
 * ── Ce que ce fichier ne prouve pas ────────────────────────────────────────
 * Il lit les CLASSES déclarées par le module, pas le DOM calculé : une classe
 * composée à l'exécution (`className={base + variante}`) lui échapperait. Les
 * quatre rendus qui publient ce bloc lisent tous ce module (gardé côté serveur
 * par `backend/tests/test_pages_seo_maillage.py`), donc la classe mesurée est
 * bien celle qu'ils peignent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrasteEntre, SEUIL_TEXTE } from '../../../scripts/contraste-jetons.js';

const FRONTEND = path.resolve(__dirname, '../../..');
const CSS = fs.readFileSync(path.join(FRONTEND, 'src/index.css'), 'utf8');
const MODULE = fs.readFileSync(path.join(FRONTEND, 'src/config/liens-seo.js'), 'utf8');

const lire = (source, motif, quoi) => {
  const trouve = source.match(motif);
  if (!trouve) {
    throw new Error(
      `${quoi} introuvable — la mesure refuse de conclure sur une surface qu'elle ne connaît pas`
    );
  }
  return trouve;
};

const jeton = (nom) => lire(CSS, new RegExp(`${nom}:\\s*(#[0-9a-fA-F]{6})`), `le jeton ${nom}`)[1];

const versRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const versHex = (rgb) =>
  `#${rgb.map((valeur) => Math.round(valeur).toString(16).padStart(2, '0')).join('')}`;
const composer = ([r, g, b, a], fond) =>
  versHex([r, g, b].map((canal, index) => canal * a + fond[index] * (1 - a)));

/** La vitre du pied de page, telle qu'elle est peinte (recalculée depuis index.css). */
const VERRE = lire(
  CSS,
  /\.verre-barre[\s\S]{0,400}?background-color:\s*rgba\(([^)]+)\)/,
  'le fond de `.verre-barre`'
)[1]
  .split(',')
  .map((valeur) => Number(valeur.trim()));

const PAPIER = jeton('--kojo-papier');
const SURFACES = {
  'le papier de l’accueil': PAPIER,
  'le verre du pied de page (sur sable)': composer(VERRE, versRgb(jeton('--kojo-sable'))),
  'le verre du pied de page (sur encre)': composer(VERRE, versRgb(jeton('--kojo-encre'))),
};

const ENCRES = {
  'stone-500': '#78716c',
  'stone-600': '#57534e',
  'stone-700': '#44403c',
  'stone-800': '#292524',
  'orange-600': '#ea580c',
  'orange-700': '#c2410c',
  'orange-800': '#9a3412',
  'orange-900': '#7c2d12',
  'orange-950': '#431407',
};

/** La valeur d'une constante du module, refusée nommément si elle a disparu. */
const constante = (nom) => lire(MODULE, new RegExp(`export const ${nom} =\\s*'([^']*)'`), `la constante ${nom}`)[1];

/** Les encres d'une chaîne de classes : au repos, puis au survol. */
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

/** Le pire rapport d'une encre sur les trois surfaces que ce bloc traverse. */
const pireContraste = (teinte) => {
  if (!Object.hasOwn(ENCRES, teinte)) {
    throw new Error(
      `la teinte « text-${teinte} » n'est pas dans la table de ce fichier — la mesure refuse de ` +
        'conclure (l’ajouter à ENCRES, après l’avoir mesurée)'
    );
  }
  return Math.min(...Object.values(SURFACES).map((fond) => contrasteEntre(ENCRES[teinte], fond)));
};

describe('maillage SEO — lisibilité sur le papier et sur le verre', () => {
  it('mesure les encres que le module peint RÉELLEMENT, au repos comme au survol', () => {
    const mesures = [];
    for (const [ou, nom] of [
      ['le titre du groupe', 'LIENS_SEO_TITRE_CLASS'],
      ['le lien', 'LIENS_SEO_LIEN_CLASS'],
    ]) {
      const classes = constante(nom);
      const { repos, survol } = encresDe(classes);
      expect(
        repos.length,
        `${nom} ne déclare plus d’encre (text-… introuvable) : la mesure porterait sur rien`
      ).toBeGreaterThanOrEqual(1);
      for (const teinte of repos) mesures.push({ ou, etat: 'au repos', teinte, ratio: pireContraste(teinte) });
      for (const teinte of survol) mesures.push({ ou, etat: 'au survol', teinte, ratio: pireContraste(teinte) });
    }

    // Un balayage vide rendrait un vert qui n'a rien mesuré.
    expect(
      mesures.length,
      `seulement ${mesures.length} encre(s) mesurée(s) dans le maillage : la mesure refuse de conclure`
    ).toBeGreaterThanOrEqual(3);
    expect(
      mesures.some(({ etat }) => etat === 'au survol'),
      'le survol des liens n’est plus mesuré : c’est le moment où la personne visant le lien le lit'
    ).toBe(true);

    const fautes = mesures
      .filter(({ ratio }) => ratio < SEUIL_TEXTE)
      .map(
        ({ ou, etat, teinte, ratio }) =>
          `maillage, ${ou} ${etat} : text-${teinte} = ${ratio.toFixed(2)}:1 au pire des trois fonds ` +
          `(${Object.values(SURFACES).join(', ')}), seuil ${SEUIL_TEXTE}:1 (WCAG 1.4.3)`
      );
    expect(fautes, `encre sous le seuil dans le maillage :\n  ${fautes.join('\n  ')}`).toEqual([]);
  });

  it('distingue un lien sans compter sur la seule couleur', () => {
    // WCAG 1.4.1 : un lien dans un paragraphe ne peut pas être signalé par la
    // couleur seule. Les liens du maillage sont dans une phrase (le groupe),
    // donc ils portent `underline` — et ce fichier refuse de le laisser partir.
    expect(
      constante('LIENS_SEO_LIEN_CLASS'),
      'les liens du maillage ne sont plus soulignés : dans une phrase, seule la couleur les distinguerait (WCAG 1.4.1)'
    ).toContain('underline');
  });

  it('pointe les trois familles de pages servies par le backend', () => {
    // Ces pages ne sont PAS des routes React : un href mal préfixé enverrait le
    // visiteur (et le crawler) sur la 404 de l'application.
    for (const prefixe of ['/emplois/', '/metiers/', '/guides/']) {
      expect(MODULE, `le module ne construit plus d’URL en ${prefixe}`).toContain(prefixe);
    }
  });
});
