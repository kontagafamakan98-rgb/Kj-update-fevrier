import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  CSS_INLINE_BUDGETS,
  FEUILLE_DE_REFERENCE,
  PLANCHERS_DE_LECTURE,
  auditCssInline,
  checkCssInlineBudget,
  lireFeuilleInlinee,
} from '../check-css-inline-budget';

// Tests du garde « budget de CSS inline par page pré-rendue »
// (scripts/check-css-inline-budget.js).
//
// Ce qu'il tient : la feuille critique est recopiée dans CHAQUE document du
// build, et elle est lue AVANT le premier paint. `check-bundle-size.js` portait
// ce fait en prose (avec un compte périmé : 22 pages / ~1,5 Mo pour 14 documents
// et 0,86 Mo mesurés le 09/10/2026) ; ce garde le tient page par page.
//
// Les cas se lisent en deux familles :
//   • la LECTURE (`lireFeuilleInlinee`) — ce qui est réellement compté ;
//   • les SIX REFUS, chacun nommé, avec pour chacun une fixture qui doit le
//     déclencher ET le texte qu'il doit produire (un refus muet ne serait pas
//     plus utile qu'une absence de refus) ;
//   • les PLANCHERS DE LECTURE, qui refusent de rendre un verdict vert sur ce
//     qui n'a pas été lu ;
//   • le passage sur un ARBRE de build (fixture sur disque), pour ce que la
//     fonction pure ne peut pas voir : le nom des fichiers, le build absent.
//
// Ce qui n'est PAS rejoué ici : le passage sur le build RÉEL — l'étape de CI
// « Check inline CSS budget per prerendered page » le fait après `vite build`.
// Les valeurs de la table, elles, sont celles mesurées sur ce build réel
// (69 276 o × 13, 392 o pour 404.html).

const CSS_REFERENCE = [
  '.a{color:red}',
  '.b{margin:0}',
  '.c{padding:1rem}',
].join('');

/** Le document d'une page pré-rendue, avec la feuille critique de référence. */
const html = (css = CSS_REFERENCE) => `<!doctype html><html><head><style>${css}</style></head><body></body></html>`;

/** Une page LUE, conforme par défaut : c'est le relevé du build réel. */
const page = (nom, overrides = {}) => ({
  nom,
  octets: 69276,
  blocs: 1,
  regles: 936,
  sha: 'd8c74e2cb457a497',
  ...overrides,
});

/** Les 14 documents du build, conformes : 13 partagent la feuille, 404 a la sienne. */
const arbreConforme = () =>
  [
    ...Object.keys(CSS_INLINE_BUDGETS).filter((nom) => nom !== '404.html').map((nom) => page(nom)),
    page('404.html', { octets: 392, regles: 6, sha: '8108c4546aacc8b6' }),
  ];

/** Une coupe d'un arbre conforme, sans les planchers de lecture (cas ciblé). */
const sansPlanchers = (pages) =>
  auditCssInline({ pages, planchers: { pages: 0, regles: 0 } });

describe('lireFeuilleInlinee — ce qui est réellement compté', () => {
  it('compte les octets, les blocs, les règles et l’empreinte de la feuille', () => {
    const releve = lireFeuilleInlinee(html());
    expect(releve.blocs).toBe(1);
    expect(releve.octets).toBe(Buffer.byteLength(CSS_REFERENCE, 'utf8'));
    expect(releve.regles).toBe(3);
    expect(releve.sha).toMatch(/^[0-9a-f]{16}$/);
  });

  it('ADDITIONNE deux blocs `<style>` au lieu de ne lire que le premier', () => {
    // Un garde qui ne lirait que le premier bloc laisserait une seconde feuille
    // entrer sans budget : les octets des deux sont donc comptés ensemble, et
    // c'est le nombre de blocs qui dénonce l'intrusion.
    const deux = `<html><head><style>${CSS_REFERENCE}</style><style>.d{color:blue}</style></head></html>`;
    const releve = lireFeuilleInlinee(deux);
    expect(releve.blocs).toBe(2);
    expect(releve.octets).toBe(Buffer.byteLength(`${CSS_REFERENCE}.d{color:blue}`, 'utf8'));
    expect(releve.regles).toBe(4);
  });

  it('compte un `<style>` porteur d’attributs (le motif ne dépend pas de la balise nue)', () => {
    const avecMedia = '<style media="(min-width:768px)">.e{display:flex}</style>';
    expect(lireFeuilleInlinee(avecMedia).octets).toBe(Buffer.byteLength('.e{display:flex}', 'utf8'));
  });

  it('un document sans feuille rend zéro octet, zéro bloc, zéro règle', () => {
    const vide = lireFeuilleInlinee('<html><head></head></html>');
    expect(vide).toMatchObject({ octets: 0, blocs: 0, regles: 0 });
  });
});

describe('auditCssInline — le cas conforme', () => {
  it('accepte l’arbre mesuré : 13 pages sur la feuille de index, 404 sur la sienne', () => {
    const { errors, stats } = auditCssInline({ pages: arbreConforme() });
    expect(errors).toEqual([]);
    expect(stats.octetsTotal).toBe(69276 * 13 + 392);
    expect(CSS_INLINE_BUDGETS[FEUILLE_DE_REFERENCE].feuille).toBe(FEUILLE_DE_REFERENCE);
  });

  it('ne compare PAS une page qui est propriétaire de sa propre feuille (404)', () => {
    const pages = arbreConforme();
    // 404.html déclare `feuille: '404.html'` : sa feuille courte est légitime.
    expect(CSS_INLINE_BUDGETS['404.html'].feuille).toBe('404.html');
    expect(sansPlanchers(pages).errors).toEqual([]);
  });
});

describe('refus 1 — dépassement du budget (nommé, chiffré)', () => {
  it('nomme la page, ses octets, le budget et l’excès en pourcentage', () => {
    const pages = arbreConforme().map((p) =>
      p.nom === 'about.html' ? { ...p, octets: 90000 } : p
    );
    const { errors } = sansPlanchers(pages);
    // Le verdict du refus est affirmé EN PREMIER : c'est lui que la mutation du
    // garde (« dépassement neutralisé ») doit faire disparaître du rapport, et
    // le harnais exige que le rouge NOMME ce qui manque.
    expect(errors.join('\n')).toContain('90000 o de CSS inline > budget 71680 o');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('about.html');
    expect(errors[0]).toContain('(+18320 o, +25.6 %)');
    // Et il dit POURQUOI ces octets comptent : lus avant le premier paint.
    expect(errors[0]).toContain('AVANT le premier paint');
  });
});

describe('refus 2 — plancher : la feuille critique a disparu', () => {
  it('refuse une page plus LÉGÈRE que son plancher, et dit ce qui est revenu', () => {
    // La contrepartie sans laquelle un budget plafond serait un faux vert : un
    // document qui perd sa feuille est plus léger, donc « meilleur ».
    const pages = arbreConforme().map((p) =>
      p.nom === 'jobs.html' ? { ...p, octets: 1000 } : p
    );
    const { errors } = sansPlanchers(pages);
    // Même ordre que ci-dessus : le verdict d'abord, c'est lui que la mutation
    // « plancher neutralisé » doit faire disparaître.
    expect(errors.join('\n')).toContain('< plancher 61440 o');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('jobs.html');
    expect(errors[0]).toContain("la feuille critique n'est plus inlinée");
    expect(errors[0]).toContain('render-blocking');
  });
});

describe('refus 3 — le nombre de blocs `<style>`', () => {
  it('refuse 0 bloc en nommant le plugin d’inlining', () => {
    const pages = arbreConforme().map((p) => (p.nom === 'login.html' ? { ...p, blocs: 0 } : p));
    const { errors } = sansPlanchers(pages);
    expect(errors[0]).toContain('login.html : 0 bloc(s) <style> pour 1 déclaré(s)');
    expect(errors[0]).toContain('aucun CSS inline');
  });

  it('refuse 2 blocs : une seconde feuille sans propriétaire', () => {
    const pages = arbreConforme().map((p) => (p.nom === 'login.html' ? { ...p, blocs: 2 } : p));
    const { errors } = sansPlanchers(pages);
    expect(errors[0]).toContain('2 bloc(s) <style> pour 1 déclaré(s)');
    expect(errors[0]).toContain('seconde feuille est entrée sans propriétaire déclaré');
  });
});

describe('refus 4 — feuille divergente (le propriétaire unique)', () => {
  it('nomme les DEUX pages et leurs deux empreintes', () => {
    const pages = arbreConforme().map((p) =>
      p.nom === 'support.html' ? { ...p, sha: 'ffffffffffffffff' } : p
    );
    const { errors } = sansPlanchers(pages);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('support.html porte une feuille DIFFÉRENTE de celle de index.html');
    expect(errors[0]).toContain('sha ffffffffffffffff contre d8c74e2cb457a497');
    expect(errors[0]).toContain('DÉCLARER');
  });

  it('accepte une divergence DÉCLARÉE (la page devient propriétaire de sa feuille)', () => {
    // La règle ne refuse pas la divergence : elle refuse la divergence MUETTE.
    const budgets = {
      ...CSS_INLINE_BUDGETS,
      'support.html': { ...CSS_INLINE_BUDGETS['support.html'], feuille: 'support.html' },
    };
    const pages = arbreConforme().map((p) =>
      p.nom === 'support.html' ? { ...p, sha: 'ffffffffffffffff' } : p
    );
    const { errors } = auditCssInline({ pages, budgets, planchers: { pages: 0, regles: 0 } });
    expect(errors).toEqual([]);
  });

  it('refuse un propriétaire DÉCLARÉ mais absent de la table (une seule fois)', () => {
    const budgets = {
      ...CSS_INLINE_BUDGETS,
      'support.html': { ...CSS_INLINE_BUDGETS['support.html'], feuille: 'fantome.html' },
    };
    const { errors } = auditCssInline({
      pages: arbreConforme(),
      budgets,
      planchers: { pages: 0, regles: 0 },
    });
    const proprietaires = errors.filter((e) => e.includes('sans ligne dans la table'));
    expect(proprietaires).toHaveLength(1);
    expect(proprietaires[0]).toContain('fantome.html');
  });
});

describe('refus 5 et 6 — page sans ligne, ligne périmée', () => {
  it('refuse une page pré-rendue AJOUTÉE, en la nommant avec ses octets', () => {
    const pages = [...arbreConforme(), page('nouvelle-page.html')];
    const { errors } = sansPlanchers(pages);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('sans budget');
    expect(errors[0]).toContain('nouvelle-page.html (69276 o)');
    expect(errors[0]).toContain('CSS_INLINE_BUDGETS');
  });

  it('refuse une ligne PÉRIMÉE : une exemption qui survit à son sujet', () => {
    const pages = arbreConforme().filter((p) => p.nom !== 'terms.html');
    const { errors } = sansPlanchers(pages);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ligne(s) PÉRIMÉE(S) : terms.html');
    expect(errors[0]).toContain('aucun document du build ne les porte');
  });
});

describe('planchers de lecture — refuser de juger ce qu’on n’a pas lu', () => {
  it('refuse un balayage trop court, avec le compte lu et le plancher', () => {
    const { errors } = auditCssInline({ pages: [page('index.html'), page('404.html')] });
    expect(errors.some((e) => e.includes('lecture incomplète : 2 document(s) lu(s)'))).toBe(true);
    expect(errors.some((e) => e.includes(`plancher de ${PLANCHERS_DE_LECTURE.pages}`))).toBe(true);
  });

  it('refuse un total de règles sous le plancher (la feuille lue n’est pas celle du site)', () => {
    const pages = arbreConforme().map((p) => ({ ...p, regles: 1 }));
    const { errors } = auditCssInline({ pages });
    expect(errors.some((e) => e.includes('règle(s) de CSS inline au total'))).toBe(true);
  });

  it('refuse quand la page de référence est absente du build', () => {
    const pages = arbreConforme().filter((p) => p.nom !== FEUILLE_DE_REFERENCE);
    const { errors } = auditCssInline({ pages });
    expect(errors.some((e) => e.includes(`la feuille de référence « ${FEUILLE_DE_REFERENCE} » est absente`))).toBe(
      true
    );
    expect(errors.some((e) => e.includes('ne peuvent pas être comparées'))).toBe(true);
  });

  it('refuse quand la référence n’a aucune ligne dans la table', () => {
    const budgets = { ...CSS_INLINE_BUDGETS };
    delete budgets[FEUILLE_DE_REFERENCE];
    const { errors } = auditCssInline({
      pages: arbreConforme(),
      budgets,
      planchers: { pages: 0, regles: 0 },
    });
    expect(errors.some((e) => e.includes('aucune ligne dans la table'))).toBe(true);
  });
});

describe('checkCssInlineBudget — le build sur disque', () => {
  /**
   * Un arbre de build minimal mais CONFORME : les 14 documents, à la bonne taille.
   *
   *   • les 13 pages pré-rendues à 61 500 o : au-dessus du plancher (61 440) et
   *     sous le budget (71 680), avec 80 règles chacune ;
   *   • `404.html` à 512 o et 6 règles : il a son propre couple (2 048 / 256),
   *     c'est un document minimal et non une page pré-rendue.
   * Total des règles : 13 × 80 + 6 = 1 046, au-dessus du plancher de 1 000.
   */
  const TAILLE_PAGE = 61500;
  // Le document minimal est celui qui n'est PAS une page pré-rendue — donc celui
  // dont le plancher est très bas (404.html, 256 o). Le désigner par `feuille ===
  // nom` désignerait AUSSI index.html, qui est propriétaire de la feuille
  // partagée : la fixture aurait alors rendu le document de référence minuscule.
  const pagesDuDisque = () =>
    Object.entries(CSS_INLINE_BUDGETS).map(([nom, ligne]) =>
      ligne.plancher < 1000
        ? page(nom, { octets: 512, regles: 6 })
        : page(nom, { octets: TAILLE_PAGE, regles: 80 })
    );

  const ecrireArbre = (pages) => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'css-inline-'));
    const build = path.join(racine, 'build');
    fs.mkdirSync(build, { recursive: true });
    for (const p of pages) {
      // 80 règles par page sauf pour le document minimal, qui en a 6.
      const nombre = p.regles === 6 ? 6 : 80;
      const regles = Array.from({ length: nombre }, (_, i) => `.r${i}{color:red}`).join('');
      const remplissage = 'x'.repeat(Math.max(0, p.octets - regles.length - 4));
      const css = `/*${remplissage}*/${regles}`;
      expect(Buffer.byteLength(css, 'utf8')).toBe(p.octets);
      fs.writeFileSync(path.join(build, p.nom), html(css));
    }
    return racine;
  };

  it('rend ok sur un arbre conforme, et publie le total', () => {
    const resultat = checkCssInlineBudget({ root: ecrireArbre(pagesDuDisque()), quiet: true });
    expect(resultat.errors).toEqual([]);
    expect(resultat.ok).toBe(true);
    expect(resultat.stats.octetsTotal).toBe(TAILLE_PAGE * 13 + 512);
  });

  it('rend ok:false en NOMMANT la page trop lourde du disque', () => {
    // Les TREIZE pages à 71 904 o — juste au-dessus du budget de 71 680 — et à
    // contenu IDENTIQUE entre elles : le seul motif du refus est donc le budget.
    // (N'alourdir qu'une page ferait aussi diverger sa feuille, et le cas
    // mesurerait deux refus au lieu d'un.)
    const pages = pagesDuDisque().map((p) =>
      p.octets === 512 ? p : { ...p, octets: 71904 }
    );
    const resultat = checkCssInlineBudget({ root: ecrireArbre(pages), quiet: true });
    expect(resultat.ok).toBe(false);
    expect(resultat.errors).toHaveLength(13);
    expect(resultat.errors.every((e) => e.includes('de CSS inline > budget 71680 o'))).toBe(true);
    expect(resultat.errors[0]).toContain('about.html');
    expect(resultat.errors.some((e) => e.includes('jobs.html'))).toBe(true);
  });

  it('refuse un build ABSENT au lieu de passer en ne mesurant rien', () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'css-inline-vide-'));
    const resultat = checkCssInlineBudget({ root: racine, quiet: true });
    expect(resultat.ok).toBe(false);
    expect(resultat.stats).toBeNull();
    expect(resultat.errors[0]).toContain('build/ introuvable dans');
    expect(resultat.errors[0]).toContain('npm run build');
  });

  it('refuse un build VIDE (aucun document) par ses planchers de lecture', () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'css-inline-sans-html-'));
    fs.mkdirSync(path.join(racine, 'build'), { recursive: true });
    const resultat = checkCssInlineBudget({ root: racine, quiet: true });
    expect(resultat.ok).toBe(false);
    expect(resultat.errors.some((e) => e.includes('lecture incomplète'))).toBe(true);
  });
});
