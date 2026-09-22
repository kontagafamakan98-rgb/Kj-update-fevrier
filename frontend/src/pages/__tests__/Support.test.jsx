import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Support from '../Support';
import { supportAPI } from '../../services/apiEndpoints';
import { PAGE_SECTIONS } from '../../config/page-sections';
import fr from '../../i18n/fr.json';

vi.mock('../../services/apiEndpoints', () => ({
  supportAPI: { getTicketStatus: vi.fn() },
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../utils/seo', () => ({ usePageMeta: vi.fn() }));
vi.mock('../../config/contact', () => ({
  CONTACT: { phoneDisplay: '+1 819 300 3507', whatsappUrl: 'https://wa.me/18193003507', email: 'test@example.com', address: 'Bamako' },
  mailtoHref: 'mailto:test@example.com',
  telHref: 'tel:+18193003507',
}));

// Le LanguageContext n'est PLUS simulé : la page rendue sans provider résout
// ses textes par le repli réel (src/i18n/fr.json), exactement comme le dépôt le
// fait partout. C'est ce qui rend ces tests utiles : asserter un texte français
// échoue si la clé disparaît du dictionnaire (le repli afficherait la clé brute)
// — la classe de bug que le garde i18n couvre, ici du point de vue de l'écran.

describe('Support — suivi de ticket', () => {
  it('refuse un e-mail invalide avant toute requête', () => {
    render(<MemoryRouter><Support /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText(fr.supportTicketIdPlaceholder), { target: { value: 'ticket-1' } });
    fireEvent.change(screen.getByPlaceholderText(fr.supportTicketEmailPlaceholder), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: fr.supportTrackCta }));

    expect(screen.getByText(fr.supportErrorEmail)).toBeTruthy();
    expect(supportAPI.getTicketStatus).not.toHaveBeenCalled();
  });

  it('publie les textes du dictionnaire, dans les deux modes comme dans la carte de contact', () => {
    render(<MemoryRouter><Support /></MemoryRouter>);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(fr.support);
    expect(screen.getByText(fr.supportRobotTitle)).toBeTruthy();
    expect(screen.getByText(fr.supportDirectSubtitle)).toBeTruthy();
    expect(screen.getByText(fr.supportTrackTitle)).toBeTruthy();
  });

  // Les lignes de contact sont lues depuis la déclaration du plan, JAMAIS
  // réécrites dans la page : ce test exige donc la ligne ENTIÈRE — libellé
  // résolu, valeur affichée, destination — pour chaque entrée déclarée. Une
  // cinquième ligne ajoutée à src/config/page-sections.js rougit ici tant que
  // la page ne la rend pas.
  it('rend chaque ligne de contact déclarée par le plan, libellé résolu', () => {
    render(<MemoryRouter><Support /></MemoryRouter>);

    const { directCard, rows } = PAGE_SECTIONS['/support'];
    // `getAllByText` : le titre de la carte porte la même clé que le mode
    // « contact direct », donc le même texte apparaît deux fois sur la page.
    expect(screen.getAllByText(fr[directCard.titleKey]).length).toBeGreaterThan(0);
    expect(screen.getAllByText(fr[directCard.subtitleKey]).length).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(screen.getAllByText(fr[row.labelKey]).length).toBeGreaterThan(0);
      expect(screen.getAllByText(row.value).length).toBeGreaterThan(0);
      if (row.href) {
        expect(screen.getAllByRole('link').some((a) => a.getAttribute('href') === row.href)).toBe(true);
      }
    }
  });

  it('ouvre le mode « contact direct » sans lever (le retour du robot est rendu par ses propres clés)', () => {
    render(<MemoryRouter><Support /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: new RegExp(fr.supportDirectTitle) }));

    expect(screen.getByText(fr.supportBack)).toBeTruthy();
  });
});
