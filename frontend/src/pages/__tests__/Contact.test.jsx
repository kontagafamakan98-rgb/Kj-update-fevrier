import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Contact from '../Contact';
import { PAGE_SECTIONS } from '../../config/page-sections';
import fr from '../../i18n/fr.json';

vi.mock('../../utils/seo', () => ({ usePageMeta: vi.fn() }));

// Sans provider, `useLanguage()` rend le repli réel de src/contexts/
// LanguageContext.js : `fr[key] || key`. Une clé absente du dictionnaire
// afficherait donc la clé BRUTE à l'écran, et ce test rougirait — c'est
// exactement ce qu'on veut vérifier des libellés de contact.

describe('Contact — lignes de contact', () => {
  it('rend chaque ligne déclarée par le plan, libellé résolu par le dictionnaire', () => {
    render(<MemoryRouter><Contact /></MemoryRouter>);

    const { actions } = PAGE_SECTIONS['/contact'];
    expect(actions.length).toBeGreaterThan(0);

    for (const action of actions) {
      expect(screen.getAllByText(fr[action.labelKey]).length).toBeGreaterThan(0);
      expect(screen.getAllByText(action.value).length).toBeGreaterThan(0);
      expect(screen.getAllByRole('link').some((a) => a.getAttribute('href') === action.href)).toBe(true);
    }
  });

  // La résidence unique : les quatre moyens de contact portent les MÊMES clés
  // que les lignes équivalentes de /support, donc un seul texte pour un seul
  // moyen — et aucun libellé littéral ne peut revenir dans le plan (une page
  // qui réécrirait « Appeler » en français cesserait de suivre la langue).
  it('partage les quatre libellés avec /support, sans littéral dans le plan', () => {
    const clesContact = PAGE_SECTIONS['/contact'].actions.map((a) => a.labelKey);
    const clesSupport = PAGE_SECTIONS['/support'].rows.map((r) => r.labelKey);

    expect(new Set(clesContact)).toEqual(new Set(clesSupport));
    expect(PAGE_SECTIONS['/contact'].actions.every((a) => a.label === undefined)).toBe(true);
    for (const cle of clesContact) expect(typeof fr[cle]).toBe('string');
  });
});
