import { describe, expect, it } from 'vitest';

import { makeToastTranslator, toastScopes } from '../toastScopedI18n';

/**
 * Régression mesurée en production le 23/10/2026 : le toast d'une adresse déjà
 * utilisée affichait « duplicateEmailError » — la clé — au lieu de la phrase.
 *
 * La chaîne du défaut : `Register` émet `toast.error({ messageKey:
 * 'duplicateEmailError', scope: 'register' })` ; `ToastContainer` résout par
 * `makeToastTranslator`, qui ne connaissait pas le scope `register` et
 * retombait sur le `t()` GLOBAL — où cette clé n'existe pas, puisqu'elle ne vit
 * que dans le pack de la page. La clé revenait donc telle quelle à l'écran.
 *
 * Ce que ce test tient pour l'avenir : un scope consommé par un toast doit être
 * déclaré ici **dans les cinq langues**, et aucune résolution ne doit jamais
 * rendre la clé elle-même. C'est le seul symptôme commun à toutes les clés
 * manquantes : un texte que personne ne devrait lire.
 */
const LANGUES = ['fr', 'en', 'wo', 'bm', 'mos'];

// Le repli du vrai fournisseur rend la clé quand elle est absente : c'est
// exactement le comportement qui a publié « duplicateEmailError » à l'écran.
const repliQuiRendLaCle = (cle) => cle;

describe('dictionnaires des toasts scoped', () => {
  it('chaque scope sert ses clés en français ET en anglais (le repli déclaré)', () => {
    const manquantes = [];
    for (const [scope, langues] of Object.entries(toastScopes)) {
      const cles = Object.keys(langues.fr || {});
      expect(cles.length, `le scope « ${scope} » n’a aucune clé en français`).toBeGreaterThan(0);
      for (const langue of ['fr', 'en']) {
        for (const cle of cles) {
          if (!langues[langue] || !langues[langue][cle]) {
            manquantes.push(`${scope}/${langue}/${cle}`);
          }
        }
      }
    }
    expect(manquantes).toEqual([]);
  });

  it('le scope « register » est traduit dans les CINQ langues du site', () => {
    // Il est né de la panne : le déclarer à moitié aurait laissé le repli
    // anglais servir un utilisateur wolof, alors que la phrase existe déjà
    // dans le pack de la page — donc dans les cinq dictionnaires.
    const manquantes = [];
    for (const cle of Object.keys(toastScopes.register.fr)) {
      for (const langue of LANGUES) {
        if (!toastScopes.register[langue]?.[cle]) manquantes.push(`${langue}/${cle}`);
      }
    }
    expect(manquantes).toEqual([]);
  });

  it('« duplicateEmailError » est servie en phrase, jamais comme une clé', () => {
    for (const langue of LANGUES) {
      const valeur = makeToastTranslator(langue, repliQuiRendLaCle, 'register')('duplicateEmailError');

      expect(valeur).not.toBe('duplicateEmailError');
      expect(valeur.length).toBeGreaterThan(10);
    }
    // La phrase française est celle du pack de la page : une seule vérité.
    expect(makeToastTranslator('fr', repliQuiRendLaCle, 'register')('duplicateEmailError')).toBe(
      'Cette adresse email est déjà utilisée'
    );
  });

  it('aucune clé d’aucun scope ne se résout en elle-même', () => {
    const clesRendues = [];
    for (const scope of Object.keys(toastScopes)) {
      const cles = Object.keys(toastScopes[scope].fr || {});
      for (const langue of LANGUES) {
        const traduire = makeToastTranslator(langue, repliQuiRendLaCle, scope);
        for (const cle of cles) {
          if (traduire(cle) === cle) clesRendues.push(`${scope}/${langue}/${cle}`);
        }
      }
    }
    expect(clesRendues).toEqual([]);
  });

  it('un scope inconnu retombe sur le traducteur global — comportement DÉCLARÉ', () => {
    // Ce repli n'est pas un défaut : c'est écrit ici pour qu'il ne se confonde
    // pas un jour avec la panne ci-dessus (une clé servie par le global existe
    // dans `src/i18n/*.json` ; une clé de page, non).
    expect(makeToastTranslator('fr', (cle) => `global:${cle}`, 'scopeInconnu')('uneCle')).toBe(
      'global:uneCle'
    );
  });
});
