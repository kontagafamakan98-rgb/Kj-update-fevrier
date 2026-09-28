/**
 * PREUVE D'ÉCHEC REJOUÉE — la forme `icone` de LISTE.
 *
 * Le fichier voisin `check-declared-body-icones.test.js` prouve la forme de
 * niveau ROUTE (`legalNoticeIcon`, `noJobIcon`…). Celui-ci prouve l'autre
 * moitié du même registre : une entrée de LISTE qui porte un champ `icone`
 * (`categories`, `promises`, `steps` de l'accueil, étapes de /how-it-works,
 * modes et lignes de /support, cartes de /about, lignes de /contact).
 *
 * ── Pourquoi c'est un fichier à part, et pas un cas de plus ────────────────
 * Les deux formes passent par le MÊME garde (`declared-body.js`), mais pas par
 * le même CHEMIN dans `pageSectionParts` : `icone` est un NOM DE CHAMP, dans un
 * OBJET, dans un TABLEAU. Ce que ce fichier verrouille, c'est la classification
 * qui fait qu'une liste d'entrées publie des icônes au lieu de textes — sans
 * elle, renommer une catégorie ferait publier son nom comme du TEXTE (la
 * coquille l'écrirait à l'écran) au lieu de faire refuser le build. Un cas de la
 * forme route ne l'éprouverait pas.
 *
 * ── Les deux refus, mesurés sur un VRAI build le 26/09/2026 ────────────────
 *
 *   • le PREMIER, celui qui mord en vrai — le REGISTRE. La coquille lit le nom
 *     DANS le plan (`svgDeLIcone(category.icone, …)`, vite-plugins/prerender/
 *     shells-home.js), donc renommer l'icône d'une entrée de liste →
 *     `contenuDeLICone` lève AVANT que le corps ne soit bâti. Relevé :
 *     `categories[0].icone: 'categoryGeneral'` → `'categoryGeneralRenomme'` fait
 *     sortir `npm run build` en **1** sur « page-icons : l'icône
 *     « categoryGeneralRenomme » n'est pas déclarée dans le registre — un plan ne
 *     peut pas dessiner une icône qui n'existe pas. » (restauré : SHA-1 de
 *     `src/config/page-sections.js` de retour à 551065f3…).
 *
 *   • le SECOND — `exigerCorpsDeclare` — pour la coquille qui cesse de DESSINER
 *     une icône de liste pourtant déclarée. Relevé : retirer l'expression
 *     `svgDeLIcone(category.icone, …)` de la boucle des catégories de
 *     `shells-home.js` (liste dont les noms, eux, restent valides au registre)
 *     fait sortir `npm run build` en **1** sur « prerender-shells : la coquille /
 *     ne dessine pas 10 icône(s) déclarée(s) par sa page — « categoryGeneral »
 *     manque (aucun data-icone="categoryGeneral" trouvé). Le corps d'une page a
 *     UN propriétaire (src/config/page-sections.js) : la coquille s'en dérive. »
 *     (DIX, parce que l'expression retirée alimentait les dix entrées de la
 *     liste ; restauré : SHA-1 de `shells-home.js` de retour à 412aae34…).
 *
 * Le premier nomme le PLAN, le second nomme la COQUILLE — il faut les deux, et
 * aucun ne peut remplacer l'autre : le registre ne regarde QUE le nom, jamais ce
 * que la coquille publie ; le garde ne regarde QUE ce qui est publié.
 */
import { describe, expect, it } from 'vitest';
import { makeDeclaredBodyGuard } from '../../vite-plugins/prerender/declared-body.js';
import { contenuDeLICone, marqueurDIcone, NOMS_D_ICONES } from '../../src/config/page-icons.js';
import { PAGE_SECTIONS, pageSectionParts } from '../../src/config/page-sections.js';

/** Un garde monté sur les plans que le cas veut éprouver. */
const gardeAvec = (pageSections) =>
  makeDeclaredBodyGuard({
    esc: (texte) => String(texte),
    T: (cle) => cle,
    registerT: (cle) => cle,
    jobsT: (cle) => cle,
    pageSections,
    pageSectionParts,
  });

/**
 * Les icônes déclarées par une LISTE — un champ `icone` d'un élément de tableau.
 * Le `icone` de niveau ROUTE (hors tableau) est délibérément EXCLU : il
 * appartient au fichier voisin, et cette frontière est fixée par un cas.
 */
const iconesDeListe = (plan) => {
  const noms = [];
  const visiter = (valeur, dansUneListe) => {
    if (Array.isArray(valeur)) {
      valeur.forEach((element) => visiter(element, true));
      return;
    }
    if (valeur && typeof valeur === 'object') {
      if (dansUneListe && typeof valeur.icone === 'string') noms.push(valeur.icone);
      Object.values(valeur).forEach((sousValeur) => visiter(sousValeur, dansUneListe));
    }
  };
  visiter(plan, false);
  return noms;
};

/**
 * Un corps qui satisfait TOUT le plan (le `T` de ces cas rend la clé telle
 * quelle, donc l'attendu vaut le nom de champ) et qui dessine les icônes
 * données. Sert de coquille CONSISTANTE, que chaque cas casse ensuite.
 */
const corpsQuiPorte = (plan, nomsD_icones) => {
  const { cles, textes } = pageSectionParts(plan);
  return [...cles, ...textes, ...nomsD_icones.map(marqueurDIcone)].join(' | ');
};

describe('forme `icone` de LISTE — la classification', () => {
  it('classe l’`icone` d’une entrée de liste comme une icône, jamais comme un texte', () => {
    // LA règle que ce fichier protège : un `icone` de liste nourrit `icones`
    // (la coquille devra le DESSINER), jamais `textes` (la coquille l'écrirait).
    const { cles, textes, icones } = pageSectionParts({
      categories: [{ labelKey: 'general', icone: 'categoryGeneral' }],
    });
    expect(icones).toEqual(['categoryGeneral']);
    expect(cles).toEqual(['general']); // `labelKey` reste une CLÉ i18n…
    expect(textes).toEqual([]); // …et le nom d'icône n'est publié NULLE PART comme texte.
  });

  it("la collecte des icônes de LISTE exclut le `icone` de niveau ROUTE", () => {
    // La frontière avec le fichier voisin, fixée ici : le garde, lui, voit les
    // deux (il lit `pageSectionParts`), mais cette preuve-ci ne parle que des
    // listes.
    const plan = {
      icone: 'escrow',
      categories: [{ labelKey: 'general', icone: 'categoryGeneral' }],
    };
    expect(pageSectionParts(plan).icones).toEqual(['escrow', 'categoryGeneral']);
    expect(iconesDeListe(plan)).toEqual(['categoryGeneral']);
  });
});

describe('forme `icone` de LISTE — preuve d’échec rejouée', () => {
  it('renommer l’icône d’une entrée de liste vers un nom inconnu fait lever le REGISTRE', () => {
    // C'est le refus qui mord en premier au build : la coquille lit le nom dans
    // le plan, donc l'icône renommée est résolue AVANT que le corps soit composé.
    expect(() => contenuDeLICone('categoryGeneralRenomme')).toThrow(/déclarée dans le registre/);
    // Le contrôle qui donne son sens au rouge : le nom d'origine, lui, existe.
    expect(() => contenuDeLICone('categoryGeneral')).not.toThrow();
  });

  it('une coquille qui cesse de dessiner une icône de LISTE est refusée, en la nommant', () => {
    // La mutation EXACTE : l'icône de la liste est renommée dans le plan, la
    // coquille N'A PAS suivi — elle porte encore le repère de l'ANCIEN nom.
    const planRenomme = { categories: [{ labelKey: 'general', icone: 'categoryGeneralRenomme' }] };
    const garde = gardeAvec({ '/': planRenomme });
    const corpsQuiNAPasSuivi = corpsQuiPorte(
      { categories: [{ labelKey: 'general' }] },
      ['categoryGeneral']
    );

    let erreur;
    try {
      garde('/', 'home', corpsQuiNAPasSuivi);
    } catch (e) {
      erreur = e;
    }
    expect(erreur?.message).toContain('ne dessine pas');
    expect(erreur?.message).toContain('categoryGeneralRenomme');
    expect(erreur?.message).toContain(marqueurDIcone('categoryGeneralRenomme'));
    expect(erreur?.message).toContain('la coquille');
  });

  it('la coquille qui suit la liste passe — le refus n’est pas un refus de principe', () => {
    // Contrôle positif : le même plan, une coquille qui DESSINE l'icône déclarée
    // ne lève pas. Sans lui, le cas négatif ne prouverait pas que c'est bien le
    // repère `data-icone` de la liste que le garde exige.
    const plan = { categories: [{ labelKey: 'general', icone: 'categoryPlumbing' }] };
    const garde = gardeAvec({ '/': plan });
    expect(() => garde('/', 'home', corpsQuiPorte(plan, ['categoryPlumbing']))).not.toThrow();
  });

  it('sur le plan RÉEL de l’accueil : retirer UN repère de liste fait refuser la coquille', () => {
    // Le rejeu porte sur la vraie liste de catégories, pas sur une maquette : le
    // corps satisfait tout le plan, puis on retire le repère d'UNE catégorie.
    const plan = PAGE_SECTIONS['/'];
    const garde = gardeAvec(PAGE_SECTIONS);
    const corps = corpsQuiPorte(plan, pageSectionParts(plan).icones);
    expect(() => garde('/', 'home', corps)).not.toThrow();

    const sansGeneral = corps
      .split(' | ')
      .filter((element) => element !== marqueurDIcone('categoryGeneral'))
      .join(' | ');
    expect(sansGeneral).not.toContain(marqueurDIcone('categoryGeneral'));
    expect(() => garde('/', 'home', sansGeneral)).toThrow(/categoryGeneral/);
  });

  it('le plan RÉEL ne déclare aucune icône de LISTE absente du registre', () => {
    // Le contrôle de l'arbre réel : il garantit que les refus ci-dessus décrivent
    // une MUTATION, jamais un état de départ déjà rouge.
    const declarees = [];
    for (const plan of Object.values(PAGE_SECTIONS)) declarees.push(...iconesDeListe(plan));
    const distinctes = [...new Set(declarees)];

    // 32 occurrences / 24 noms DISTINCTS mesurés le 26/09/2026. Le plancher prouve
    // que la collecte a lu les vraies listes, sans se figer sur un compte exact
    // (ajouter une catégorie ne doit pas rougir ce cas).
    expect(distinctes.length).toBeGreaterThanOrEqual(20);
    // …et que les quatre familles de listes sont bien atteintes.
    expect(distinctes).toEqual(
      expect.arrayContaining([
        'categoryGeneral', // catégories de l'accueil
        'promiseFindWork', // promesses
        'step1', // étapes de l'accueil
        'howStep1', // étapes de /how-it-works
        'supportRobot', // modes de /support
      ])
    );
    expect(distinctes.filter((nom) => !NOMS_D_ICONES.includes(nom))).toEqual([]);
  });
});
