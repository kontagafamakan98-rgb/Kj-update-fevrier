/**
 * LE TEXTE BLANC DES BOUTONS PLEINS, MESURÉ PARTOUT DANS `src/`.
 *
 * ── Le défaut que ce fichier ferme ─────────────────────────────────────────
 * Les boutons pleins du site peignaient le fond `orange-600` (`#ea580c`) sous du
 * texte blanc : **3,56:1**, sous le 4,5:1 du texte courant (WCAG 1.4.3). Ce n'était
 * pas un oubli isolé mais un JETON, recopié dans une trentaine de classes —
 * barre de navigation, modales, fiches, chat, cartes, tableaux de bord. Mesuré
 * le 26/10/2026 sur les quatre teintes qui portaient du blanc : `orange-600`
 * 3,56:1 et `orange-500` (`#f97316`) 2,80:1 échouaient ; `orange-700`
 * (`#c2410c`, 5,18:1) et `orange-800` (`#9a3412`, 7,31:1) tiennent. Le fond des
 * boutons pleins est donc `orange-700`, leur survol `orange-800`.
 *
 * ── Ce qui est jugé, et d'où viennent les valeurs ──────────────────────────
 * Le fichier balaie TOUT `src/` (hors `__tests__`), lit les chaînes de classes
 * et juge deux choses :
 *   1. chaque couple « fond orange + `text-white` » déclaré dans la MÊME chaîne
 *      doit atteindre 4,5:1 — c'est la règle qui a trouvé les deux badges
 *      fond `orange-500` de l'inscription, oubliés par la première passe ;
 *   2. aucun fichier ne peint de fond orange à `500` ou `600` (refus nommé).
 * La seconde règle existe pour un angle mort de la première, et c'est un défaut
 * RÉEL qui l'a montrée : `PaymentAccountsManager` porte son blanc dans un
 * `<span>` ENFANT (fond `orange-500` sur le parent, `text-white` sur le span),
 * donc une mesure qui ne regarde que la chaîne du fond ne voit rien. Une teinte
 * qu'aucun texte blanc ne peut tenir n'a pas à être un fond, ici.
 *
 * ── Ce que ce fichier ne prouve pas ────────────────────────────────────────
 * Il ne compose pas les classes (`className={base + ${variante}}`) et ne résout
 * pas les feuilles : un jeton composé hors des chaînes écrites lui échappe, et
 * c'est pour cela que la règle 2 interdit les teintes qui échouent, au lieu de
 * seulement juger celles qu'il arrive à lire. Les états DÉSACTIVÉS
 * (`disabled:opacity-60`) sont hors du seuil par la norme elle-même (les
 * composants inactifs en sont exclus) : l'état actif est jugé, lui.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrasteEntre, SEUIL_TEXTE } from '../../../scripts/contraste-jetons.js';

const FRONTEND = path.resolve(__dirname, '../../..');
const RACINE = path.join(FRONTEND, 'src');
/**
 * Le balayage couvre AUSSI les coquilles pré-rendues : elles peignent les mêmes
 * boutons en HTML statique, et c'est ce document-là qu'un crawler et le premier
 * rendu affichent. Mesuré le 26/10/2026 : le badge d'étape de `/register` y
 * portait encore le fond `orange-500` que React venait de quitter — deux canaux, deux
 * couleurs, et la mesure du composant ne voyait pas la coquille.
 */
const DOSSIERS = [RACINE, path.join(FRONTEND, 'vite-plugins')];
const BLANC = '#ffffff';

/** La palette `orange` de Tailwind, telle qu'elle est peinte. */
const FONDS = {
  '50': '#fff7ed',
  '100': '#ffedd5',
  '200': '#fed7aa',
  '300': '#fdba74',
  '400': '#fb923c',
  '500': '#f97316',
  '600': '#ea580c',
  '700': '#c2410c',
  '800': '#9a3412',
  '900': '#7c2d12',
  '950': '#431407',
};

/** Les teintes qui ne peuvent pas porter du texte blanc — et qui ne sont donc pas des fonds. */
const TEINTES_REFUSEES = ['500', '600'];

// 172 fichiers .js/.jsx lus le 26/10/2026 : le plancher est sous ce chiffre, pour
// ne pas rougir à chaque suppression de fichier, et bien au-dessus d'un
// balayage cassé (dossier vide, extension oubliée).
const PLANCHER_FICHIERS = 150;
const PLANCHER_COUPLES = 30;

const fichiersSource = (dossier, trouves = []) => {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) {
      if (entree.name === '__tests__' || entree.name === 'node_modules') continue;
      fichiersSource(chemin, trouves);
    } else if (/\.jsx?$/.test(entree.name)) {
      trouves.push(chemin);
    }
  }
  return trouves;
};

/** Les chaînes littérales d'un fichier (simples, doubles, gabarits). */
const CHAINES = /'([^'\n]{0,600})'|"([^"\n]{0,600})"|`([^`]{0,900})`/g;

const lireCouples = () => {
  const fichiers = DOSSIERS.flatMap((dossier) => fichiersSource(dossier));
  const couples = [];
  const teintesRefusees = [];

  for (const fichier of fichiers) {
    const texte = fs.readFileSync(fichier, 'utf8');
    const relatif = path.relative(FRONTEND, fichier).replace(/\\/g, '/');

    for (const trouve of texte.matchAll(CHAINES)) {
      const chaine = trouve[1] || trouve[2] || trouve[3] || '';
      const fonds = [...chaine.matchAll(/(?<![\w-])bg-orange-(\d{2,3})(?![\d])/g)].map((m) => m[1]);
      if (fonds.length === 0) continue;

      const ligne = texte.slice(0, trouve.index).split('\n').length;
      const ou = `${relatif}:${ligne}`;

      for (const teinte of new Set(fonds)) {
        if (!Object.hasOwn(FONDS, teinte)) {
          throw new Error(
            `${ou} : la teinte « bg-orange-${teinte} » n'est pas dans la palette de ce fichier — ` +
              'la mesure refuse de conclure (l’ajouter à FONDS, après l’avoir mesurée)'
          );
        }
        if (TEINTES_REFUSEES.includes(teinte)) {
          teintesRefusees.push(
            `${ou} peint un fond bg-orange-${teinte} (${FONDS[teinte]}) : ` +
              `${contrasteEntre(BLANC, FONDS[teinte]).toFixed(2)}:1 sous du blanc, et l’encre peut ` +
              'être dans un élément ENFANT — une teinte qu’aucun texte blanc ne tient n’est pas un fond'
          );
        }
      }

      // Le blanc est déclaré dans la MÊME chaîne : la surface et l'encre sont
      // appariées sans ambiguïté, donc le rapport est celui que la personne lit.
      if (/\btext-white\b/.test(chaine)) {
        for (const teinte of new Set(fonds)) {
          couples.push({ ou, teinte, ratio: contrasteEntre(BLANC, FONDS[teinte]) });
        }
      }
    }
  }

  return { fichiers, couples, teintesRefusees };
};

const { fichiers, couples, teintesRefusees } = lireCouples();

describe('boutons pleins — le texte blanc tient sur son fond', () => {
  it('juge assez de couples pour que le balayage ne puisse pas être vide', () => {
    expect(
      fichiers.length,
      `seulement ${fichiers.length} fichier(s) source lu(s) — le balayage est cassé, il ne prouve rien`
    ).toBeGreaterThan(PLANCHER_FICHIERS);
    expect(
      couples.length,
      `seulement ${couples.length} couple(s) « fond orange + texte blanc » lu(s) : ` +
        'la mesure refuse de conclure sous son plancher'
    ).toBeGreaterThanOrEqual(PLANCHER_COUPLES);
  });

  it('aucun couple ne passe sous 4,5:1', () => {
    const fautes = couples
      .filter(({ ratio }) => ratio < SEUIL_TEXTE)
      .map(
        ({ ou, teinte, ratio }) =>
          `${ou} : texte BLANC sur bg-orange-${teinte} = ${ratio.toFixed(2)}:1 ` +
          `(seuil ${SEUIL_TEXTE}:1, WCAG 1.4.3)`
      );
    expect(
      fautes,
      `texte blanc sous le seuil sur un fond plein :\n  ${fautes.join('\n  ')}`
    ).toEqual([]);
  });

  it('aucun fond n’est peint à une teinte que le blanc ne tient pas', () => {
    expect(
      teintesRefusees,
      `teinte de fond refusée :\n  ${teintesRefusees.join('\n  ')}`
    ).toEqual([]);
  });
});
