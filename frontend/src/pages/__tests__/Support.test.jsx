import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Support from '../Support';
import { supportAPI } from '../../services/apiEndpoints';

vi.mock('../../services/apiEndpoints', () => ({
  supportAPI: { getTicketStatus: vi.fn() },
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ currentLanguage: 'fr', t: (key) => key }),
}));
vi.mock('../../utils/seo', () => ({ usePageMeta: vi.fn() }));
vi.mock('../../config/contact', () => ({
  CONTACT: { phoneDisplay: '+1 819 300 3507', whatsappUrl: 'https://wa.me/18193003507', email: 'test@example.com', address: 'Bamako' },
  mailtoHref: 'mailto:test@example.com',
  telHref: 'tel:+18193003507',
}));
vi.mock('../../config/page-sections', () => ({
  SUPPORT_COPY_FR: { title: 'Support', subtitle: 'Aide', robotTitle: 'Robot', robotSubtitle: 'Questions', directTitle: 'Contact', directSubtitle: 'Direct' },
}));

describe('Support — suivi de ticket', () => {
  it('refuse un e-mail invalide avant toute requête', () => {
    render(<MemoryRouter><Support /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText('N° de ticket (ex : 3fa85f64…)'), { target: { value: 'ticket-1' } });
    fireEvent.change(screen.getByPlaceholderText('Votre e-mail'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier le statut' }));

    expect(screen.getByText('Cette adresse e-mail ne semble pas valide.')).toBeTruthy();
    expect(supportAPI.getTicketStatus).not.toHaveBeenCalled();
  });
});
