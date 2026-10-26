/**
 * LE SUPPORT RÉPOND SEPT JOURS SUR SEPT — et ce fait se vérifie, il ne se
 * réécrit pas à la main dans huit fichiers sans que rien ne rougisse.
 *
 * ── Le fait, rectifié le 07/10/2026 ─────────────────────────────────────────
 * La bande de faits de l'accueil publiait « 6j/7 » et trois textes FR
 * énonçaient l'énoncé qui le justifiait : « du lundi au samedi » —
 * `contactIntro`, `homeAboutText2`, `homeContactText`. La déclaration
 * (`src/config/page-sections.js`) le disait même en commentaire : « le support
 * répond du lundi au samedi, donc la valeur dit 6j/7 ». Le propriétaire du site
 * a tranché : c'est **7j/7**. Huit valeurs publiées portaient le chiffre faux
 * (le plan de la page, et les cinq dictionnaires) : les corriger une par une ne
 * tenait qu'à la mémoire, et une seule oubliée laissait la page se contredire
 * d'une section à l'autre.
 *
 * ── Ce que ce garde juge, et ce qu'il ne juge PAS ───────────────────────────
 * Il lit les valeurs PUBLIÉES : les cinq dictionnaires (toutes leurs chaînes) et
 * les deux champs du plan que les DEUX canaux écrivent (`fallback` pour React,
 * `shellText` pour la coquille pré-rendue). Il refuse la forme fausse partout,
 * et exige la forme vraie là où elle est le fait de référence : le chiffre du
 * plan (`7j/7`) et le dictionnaire FR, qui est celui que la coquille publie.
 *
 * Il ne juge PAS les commentaires : un commentaire qui RACONTE la rectification
 * cite forcément l'ancien énoncé (« la valeur disait 6j/7 »), et un garde qui
 * interdirait de nommer ce qu'on a corrigé empêcherait d'écrire pourquoi on l'a
 * corrigé. La frontière est « ce que le visiteur lit », pas « ce que le fichier
 * contient ».
 *
 * Il ne juge pas non plus la LANGUE des traductions (une clé non traduite est
 * un autre sujet, `i18nParity` tient les clés) : il exige seulement qu'aucun
 * dictionnaire ne publie une phrase qui contredit le chiffre.
 *
 * ── Ce que la traduction a laissé passer, mesuré le 20/10/2026 ─────────────
 * Les formes fausses ci-dessous étaient toutes FRANÇAISES ou ANGLAISES, donc
 * invisibles dans une phrase wolof : `contactIntro` et `homeAboutText2` de `wo`
 * disaient « altine ba gaawu » et ceux de `bm` « ntɛnɛn ni sibiri ntɛm » —
 * lundi→samedi, exactement l'énoncé que le 07/10/2026 avait retiré du français.
 * Le fait faux avait donc survécu à sa correction, dans deux langues que le
 * garde ne lisait pas. Les deux formes locales sont désormais déclarées : une
 * traduction qui réintroduit six jours sur sept rougit comme le français.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PAGE_SECTIONS } from '../../src/config/page-sections.js';

const FRONTEND_DIR = path.resolve(__dirname, '../..');

/** Les langues servies. La liste est celle des fichiers de `src/i18n/`. */
const DICTIONNAIRES = ['fr', 'en', 'bm', 'mos', 'wo'];

/**
 * LES FORMES FAUSSES, chacune avec ce qu'elle dit — le message d'échec doit
 * nommer l'énoncé, pas seulement le fichier.
 */
const FORMES_FAUSSES = [
  { motif: /\b6\s*j\s*\/\s*7\b/i, dit: '« 6j/7 » (six jours sur sept)' },
  { motif: /(?:^|[^0-9])6\s*\/\s*7(?:[^0-9]|$)/, dit: '« 6/7 »' },
  { motif: /\blundi\s+au\s+samedi\b/i, dit: '« du lundi au samedi »' },
  { motif: /\blundi\s*-\s*samedi\b/i, dit: '« lundi-samedi »' },
  { motif: /\bMonday\s*(?:to|-)\s*Saturday\b/i, dit: '« Monday to Saturday »' },
  // Formes LOCALES de la même affirmation, mesurées dans `wo` et `bm` le
  // 20/10/2026 : « du lundi au samedi » s'y écrit ainsi, et le garde n'en
  // connaissait que la version française.
  { motif: /\baltine\s+ba\s+gaawu\b/i, dit: '« altine ba gaawu » (lundi au samedi, en wolof)' },
  { motif: /\bntɛnɛn\s+ni\s+sibiri\b/i, dit: '« ntɛnɛn ni sibiri » (lundi au samedi, en bambara)' },
];

/** LES FORMES VRAIES : au moins l'une doit être publiée. */
const FORMES_VRAIES = [
  /\b7\s*j\s*\/\s*7\b/i,
  /\bsept\s+jours\s+sur\s+sept\b/i,
  /\b7\s*\/\s*7\b/,
  /\bseven\s+days\s+a\s+week\b/i,
];

/**
 * La RÈGLE, pure : les valeurs fautives d'un ensemble `{ou, texte}`.
 *
 * @param {{ou: string, texte: string}[]} valeurs Les valeurs publiées à juger.
 * @returns {string[]} Un message par faute, vide si le fait est tenu.
 */
export function valeursFautives(valeurs) {
  return valeurs.flatMap(({ ou, texte }) =>
    FORMES_FAUSSES.filter(({ motif }) => motif.test(texte)).map(
      ({ dit }) => `${ou} — publie ${dit} alors que le support répond sept jours sur sept`
    )
  );
}

/** Toutes les valeurs des cinq dictionnaires, avec leur origine. */
function valeursDesDictionnaires() {
  return DICTIONNAIRES.flatMap((langue) => {
    const fichier = path.join(FRONTEND_DIR, 'src', 'i18n', `${langue}.json`);
    const dictionnaire = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    return Object.entries(dictionnaire).map(([cle, valeur]) => ({
      ou: `src/i18n/${langue}.json:${cle}`,
      texte: String(valeur),
      langue,
      cle,
    }));
  });
}

/** Les deux champs du plan que les deux canaux écrivent, pour la bande de faits. */
function valeursDuPlan() {
  return PAGE_SECTIONS['/'].stats.flatMap(({ labelKey, fallback, shellText }) => [
    { ou: `src/config/page-sections.js:stats.${labelKey}.fallback`, texte: String(fallback) },
    { ou: `src/config/page-sections.js:stats.${labelKey}.shellText`, texte: String(shellText) },
  ]);
}

describe('le support répond sept jours sur sept — dans les valeurs publiées', () => {
  it('la règle sait mordre, et elle ne confond pas un chiffre avec un autre', () => {
    expect(
      valeursFautives([
        { ou: 'faux-a', texte: 'Le support répond 6j/7 par téléphone.' },
        { ou: 'faux-b', texte: 'Kojo est joignable du lundi au samedi.' },
        { ou: 'faux-c', texte: 'The Kojo team answers Monday to Saturday.' },
        { ou: 'faux-d', texte: 'Ekib Kojo di tontu altine ba gaawu, ci telefon.' },
        { ou: 'faux-e', texte: 'Kojo jɛkulu bɛ jaabi ntɛnɛn ni sibiri ntɛm.' },
        { ou: 'vrai-a', texte: 'Le support répond sept jours sur sept.' },
        { ou: 'vrai-b', texte: 'Seven days a week, by phone.' },
        { ou: 'vrai-c', texte: 'Support client 7j/7.' },
        // Un chiffre VOISIN ne doit pas être pris pour le fait : une note de
        // version « 6/70 » ou une quantité « 16/7 » ne parlent pas du support.
        { ou: 'voisin', texte: 'Lot 6/70 vendu' },
      ]).map((message) => message.split(' — ')[0]),
    ).toEqual(['faux-a', 'faux-b', 'faux-c', 'faux-d', 'faux-e']);
  });

  it("aucune valeur publiée (cinq dictionnaires + le plan) ne dit six jours sur sept", () => {
    const dictionnaires = valeursDesDictionnaires();
    const bande = PAGE_SECTIONS['/'].stats;
    const plan = valeursDuPlan();

    // Anti-faux-vert : un balayage qui ne lit presque rien ne prouve rien.
    //
    // Le NOMBRE de valeurs jugées se DÉRIVE de la déclaration — deux champs
    // (`fallback` et `shellText`) pour chaque entrée de la bande —, il ne se
    // recopie pas. Mesuré le 26/10/2026 : un `expect(plan.length).toBe(10)`
    // écrit en dur a rendu ce garde ROUGE sur la PR qui RETIRAIT trois entrées
    // de la bande (le compte tombait à 4). Le refus accusait donc un changement
    // VOULU au lieu d'une lecture aveugle, et il fallait desserrer le garde
    // pour livrer une décision produit : c'est exactement le genre de verrou
    // qu'on finit par désactiver.
    //
    // Ce qui est exigé est ce qui prouve la LECTURE, et rien de plus : la bande
    // déclare au moins ses deux faits statiques (pays, support), chaque entrée
    // publie ses DEUX canaux, et aucun des deux n'est vide (`String(undefined)`
    // vaudrait « undefined » : un champ oublié se verrait ici).
    expect(DICTIONNAIRES.length).toBe(5);
    expect(dictionnaires.length).toBeGreaterThan(2000);
    expect(
      bande.length,
      'la bande de faits de l’accueil doit déclarer au moins ses deux faits statiques'
    ).toBeGreaterThanOrEqual(2);
    expect(plan.length).toBe(bande.length * 2);
    expect(
      plan.every(({ texte }) => texte.trim().length > 0 && texte.trim() !== 'undefined'),
      'une entrée de la bande publie un champ vide : le balayage ne l’aurait pas lue'
    ).toBe(true);

    expect(valeursFautives([...dictionnaires, ...plan])).toEqual([]);
  });

  it('le chiffre publié par les DEUX canaux est « 7j/7 », et le FR l’énonce', () => {
    const plan = PAGE_SECTIONS['/'].stats.find(({ labelKey }) => labelKey === 'customerSupport');
    expect(plan, 'la bande de faits de l’accueil doit déclarer son fait de support').toBeTruthy();
    // Les deux canaux : `fallback` (React) et `shellText` (la coquille).
    expect({ fallback: plan.fallback, shellText: plan.shellText }).toEqual({
      fallback: '7j/7',
      shellText: '7j/7',
    });

    // Et la prose de référence — celle de la coquille, en français — le dit
    // aussi : le chiffre et la phrase qui l'explique ne peuvent pas diverger.
    const fr = valeursDesDictionnaires().filter(({ langue }) => langue === 'fr');
    expect(fr.some(({ texte }) => FORMES_VRAIES.some((motif) => motif.test(texte)))).toBe(true);
  });
});
