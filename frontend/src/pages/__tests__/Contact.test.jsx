import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Contact from '../Contact';
import { PAGE_SECTIONS } from '../../config/page-sections';
import { CONTACT } from '../../config/contact';
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

// La carte Google n'appartient PAS au premier écran.
//
// Mesuré (Lighthouse 12.6.1, pile de la CI, Chrome 152, mobile, 3 runs) :
// l'iframe publiée d'emblée tirait ~300 Ko de tiers dans le premier paint et
// repoussait le LCP de /contact à 4143 / 4143 / 4397 ms simulés (scores 81 / 85
// / 84), alors que l'élément LCP de cette page est notre paragraphe
// d'introduction. Le contrôle ne monte donc la carte qu'à l'appui — et tant
// qu'il ne l'a pas fait, aucun iframe n'existe dans l'arbre.
describe('Contact — la carte Google n’est pas chargée au premier écran', () => {
  const titreAttendu = fr.mapIframeTitle.replace('{address}', CONTACT.address);

  it('ne rend AUCUN iframe avant l’appui, et le contrôle mène à la fiche Google', () => {
    render(<MemoryRouter><Contact /></MemoryRouter>);

    expect(document.querySelector('iframe')).toBeNull();
    const controle = screen.getByRole('link', { name: fr.mapShowMap });
    expect(controle.getAttribute('href')).toBe(CONTACT.mapsUrl);
    expect(controle.getAttribute('title')).toBe(titreAttendu);
  });

  it('monte l’iframe à l’appui, avec le titre et le même bloc réservé', () => {
    render(<MemoryRouter><Contact /></MemoryRouter>);

    fireEvent.click(screen.getByRole('link', { name: fr.mapShowMap }));

    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute('src')).toBe(CONTACT.mapsEmbedUrl);
    expect(iframe.getAttribute('title')).toBe(titreAttendu);
    expect(iframe.getAttribute('loading')).toBe('lazy');
    // La hauteur réservée (h-80 = 320 px) est celle du contrôle : le
    // remplacement ne déplace rien, donc pas de CLS à l'appui.
    expect(iframe.className).toBe(PAGE_SECTIONS['/contact'].mapFrameClass);
  });
});
