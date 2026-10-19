import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyserCouleur,
  blocsDe,
  declaration,
  EXIGENCES,
  FONDS_DE_REFERENCE,
  mesurerVerre,
  PLANCHER_DE_MESURES,
  SEUIL_GRAPHIQUE,
  SEUIL_TEXTE,
} from '../verre-contraste.js';

// ── LA FEUILLE RÉELLE, PAS UNE FIXTURE ──────────────────────────────────────
// Ce test lit `src/index.css` et les DEUX composants qui portent le verre des
// messages. Une mesure sur une fixture prouverait que le calcul est juste, pas
// que le SITE tient : le défaut du 19/10/2026 (encre secondaire du panneau à
// 3,17:1 sur le pire fond) vivait dans la feuille, pas dans une fonction.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (...morceaux) => readFileSync(path.join(RACINE, ...morceaux), 'utf8');

const FEUILLE = lire('src', 'index.css');
const COMPOSANT_TOASTS = lire('src', 'components', 'ToastContainer.js');
const COMPOSANT_PANNEAU = lire('src', 'components', 'NotificationPanel.js');

const ETATS_TOAST = [
  'verre-toast-succes',
  'verre-toast-erreur',
  'verre-toast-avertissement',
  'verre-toast-information',
];

const tableau = (verdicts) =>
  verdicts
    .map(
      (verdict) =>
        `${verdict.ok ? '  ' : '✗ '}${verdict.nom.padEnd(38)} ` +
        `${String(verdict.pire.ratio).padStart(6)}:1 (seuil ${verdict.seuil}, sur ${verdict.pire.fond})`
    )
    .join('\n');

describe('contraste du verre — la règle de calcul', () => {
  it('lit #rrggbb, #rgb et rgba(), et refuse ce qu’elle ne comprend pas', () => {
    expect(analyserCouleur('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(analyserCouleur('#166534')).toEqual({ r: 22, g: 101, b: 52, a: 1 });
    expect(analyserCouleur('rgba(255, 247, 237, 0.72)')).toEqual({
      r: 255,
      g: 247,
      b: 237,
      a: 0.72,
    });
    // Une couleur qu'aucune règle ne sait composer (nommée, `currentColor`,
    // dégradé) ferait un ratio inventé : elle est REFUSÉE, pas approximée.
    expect(() => analyserCouleur('currentColor')).toThrow(/ne devine rien/);
    expect(() => analyserCouleur('var(--inexistant)', new Map())).toThrow(/n'est pas déclaré/);
    expect(() => analyserCouleur(undefined)).toThrow(/vide ou absente/);
  });

  it('résout un jeton de la feuille (les teintes du site sont des variables)', () => {
    const jetons = new Map([['--kojo-encre', '#1c1917']]);
    expect(analyserCouleur('var(--kojo-encre)', jetons)).toEqual({ r: 28, g: 25, b: 23, a: 1 });
  });

  it('lit une règle dans la feuille, y compris son repli, sans lire un commentaire', () => {
    const css = `
      /* .verre-faux { background-color: #000; } */
      .verre-faux, .autre { background-color: rgba(1, 2, 3, 0.5); }
    `;
    expect(declaration(css, '.verre-faux', 'background-color')).toBe('rgba(1, 2, 3, 0.5)');
    expect(blocsDe(css, '.verre-faux')).toHaveLength(1);
    expect(declaration(css, '.inexistant', 'background-color')).toBeUndefined();
  });

  it('garde un plancher de lecture cohérent avec ses exigences', () => {
    expect(FONDS_DE_REFERENCE).toHaveLength(2);
    expect(SEUIL_TEXTE).toBe(4.5);
    expect(SEUIL_GRAPHIQUE).toBe(3);
    expect(PLANCHER_DE_MESURES).toBeLessThanOrEqual(EXIGENCES.length);
  });
});

describe('contraste du verre — la feuille livrée', () => {
  it('passe toutes ses paires sous le pire fond de référence', () => {
    const mesure = mesurerVerre(FEUILLE);
    expect(mesure.erreurs, `erreurs de lecture :\n${mesure.erreurs.join('\n')}`).toEqual([]);
    expect(mesure.verdicts.length).toBeGreaterThanOrEqual(PLANCHER_DE_MESURES);
    expect(mesure.ok, `paires en défaut :\n${tableau(mesure.verdicts.filter((v) => !v.ok))}`).toBe(
      true
    );
  });

  it('nomme un texte et un filet par état de toast, et le panneau', () => {
    const mesure = mesurerVerre(FEUILLE);
    const noms = mesure.verdicts.map((verdict) => verdict.nom);
    for (const etat of ['succès', 'erreur', 'avertissement', 'information']) {
      expect(noms).toContain(`toast ${etat} — texte`);
      expect(noms).toContain(`toast ${etat} — filet d'état`);
    }
    for (const surface of ['en-tête', "bandeau d'échec", 'ligne non lue']) {
      expect(noms).toContain(`panneau — ${surface}`);
    }
    // Le filet d'état est un objet GRAPHIQUE : c'est le seuil 3:1 qui s'applique,
    // et la mesure le dit au lieu de lui appliquer le seuil du texte.
    const filets = mesure.verdicts.filter((verdict) => verdict.categorie === 'graphique');
    expect(filets).toHaveLength(4);
    expect(filets.every((verdict) => verdict.seuil === SEUIL_GRAPHIQUE)).toBe(true);
  });

  it('garde le pire verdict sous le seuil du TEXTE, jamais sous celui du filet', () => {
    const mesure = mesurerVerre(FEUILLE);
    const pire = mesure.verdicts.reduce((a, b) => (b.pire.ratio < a.pire.ratio ? b : a));
    expect(pire.pire.ratio).toBeGreaterThanOrEqual(SEUIL_GRAPHIQUE);
    expect(pire.nom).toContain('filet');
  });

  it('rend une surface d’état PLUS opaque que le verre neutre', () => {
    const verre = analyserCouleur(declaration(FEUILLE, '.verre-panneau', 'background-color'));
    for (const etat of ETATS_TOAST) {
      const surface = analyserCouleur(declaration(FEUILLE, `.${etat}`, 'background-color'));
      expect(surface.a, `.${etat} doit rester au-dessus du verre neutre`).toBeGreaterThan(verre.a);
    }
  });

  it('replie sur une teinte d’état PLEINE quand le navigateur ignore le flou', () => {
    for (const etat of ETATS_TOAST) {
      const declarations = blocsDe(FEUILLE, `.${etat}`).map((bloc) => bloc.get('background-color'));
      expect(declarations, `.${etat} : règle + repli @supports`).toHaveLength(2);
      const repli = analyserCouleur(declarations[1]);
      expect(repli.a, `.${etat} : un état qui perd sa couleur dans le repli`).toBe(1);
    }
    expect(declaration(FEUILLE, '.verre-toast', 'background-color')).toMatch(/^rgba\(/);
    const replis = blocsDe(FEUILLE, '.verre-toast').map((bloc) => bloc.get('background-color'));
    expect(replis).toContain('var(--kojo-papier)');
  });
});

describe('contraste du verre — les porteurs', () => {
  it('les toasts portent les classes de la feuille, pas des utilitaires de fond', () => {
    for (const classe of ['verre-toast', ...ETATS_TOAST]) {
      expect(COMPOSANT_TOASTS).toContain(classe);
    }
    // Les surfaces d'état sont déclarées dans la feuille : un fond opaque posé
    // en utilitaire serait écrasé sans erreur, et la mesure ne le verrait pas.
    expect(COMPOSANT_TOASTS).not.toMatch(/\bbg-(green|red|yellow|blue)-50\b/);
    // Les icônes suivent la teinte MESURÉE (700), pas la 600 d'avant, qui ne
    // tenait pas 3:1 sur la surface teintée au-dessus d'un contenu sombre.
    for (const couleur of ['green', 'red', 'yellow', 'blue']) {
      expect(COMPOSANT_TOASTS).toContain(`text-${couleur}-700`);
    }
  });

  it('le panneau déclare son en-tête, son alerte et ses lignes dans la feuille', () => {
    for (const classe of [
      'verre-panneau',
      'verre-panneau-entete',
      'panneau-alerte',
      'panneau-ligne-non-lue',
      'panneau-ligne-lue',
    ]) {
      expect(COMPOSANT_PANNEAU).toContain(classe);
      expect(FEUILLE).toContain(`.${classe}`);
    }
    // La ligne non lue était peinte en utilitaire opaque : c'est justement la
    // déclaration qui ne pouvait pas être mesurée, et qui a été déplacée.
    expect(COMPOSANT_PANNEAU).not.toContain('bg-orange-50/60');
    expect(COMPOSANT_PANNEAU).not.toContain('fond-sable');
  });
});

describe('contraste du verre — la mesure mord', () => {
  it('refuse une encre éclaircie', () => {
    const mutee = FEUILLE.replace('color: #166534;', 'color: #86efac;');
    expect(mutee).not.toBe(FEUILLE);
    const mesure = mesurerVerre(mutee);
    expect(mesure.ok).toBe(false);
    expect(mesure.verdicts.find((verdict) => verdict.nom === 'toast succès — texte').ok).toBe(false);
  });

  it('refuse une surface d’état rendue transparente', () => {
    const mutee = FEUILLE.replace(
      'background-color: rgba(243, 252, 244, 0.94);',
      'background-color: rgba(243, 252, 244, 0.5);'
    );
    expect(mutee).not.toBe(FEUILLE);
    expect(mesurerVerre(mutee).ok).toBe(false);
  });

  it('refuse une règle disparue au lieu de mesurer moins', () => {
    const mutee = FEUILLE.replace(/\.verre-toast-avertissement\s*\{[^}]*\}/g, '');
    expect(mutee).not.toContain('.verre-toast-avertissement');
    const mesure = mesurerVerre(mutee);
    expect(mesure.ok).toBe(false);
    expect(mesure.erreurs.join('\n')).toMatch(/verre-toast-avertissement/);
  });

  it('refuse une couleur qu’elle ne sait pas composer', () => {
    const mutee = FEUILLE.replace('color: #166534;', 'color: currentColor;');
    const mesure = mesurerVerre(mutee);
    expect(mesure.ok).toBe(false);
    expect(mesure.erreurs.join('\n')).toMatch(/currentColor/);
  });

  it('refuse de conclure sur une feuille vidée de son verre', () => {
    const mesure = mesurerVerre(':root { --kojo-encre: #1c1917; }');
    expect(mesure.ok).toBe(false);
    expect(mesure.verdicts).toHaveLength(0);
    expect(mesure.erreurs.join('\n')).toMatch(/lecture incomplète/);
  });
});
