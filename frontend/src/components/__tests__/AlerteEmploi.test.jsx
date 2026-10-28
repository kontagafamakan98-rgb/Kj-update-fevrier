/**
 * La carte d'alerte emploi — ce qu'elle PROMET et ce qu'elle n'invente pas.
 *
 * Le backend est la source de vérité (correspondance, résumé, désinscription :
 * `backend/tests/test_job_alerts.py`). Ici on mesure la seule chose qui
 * appartient à cette carte : ce qu'elle envoie au serveur, ce qu'elle affiche
 * selon l'état rendu, et le fait qu'un échec se VOIE au lieu de laisser croire
 * à une alerte enregistrée.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AlerteEmploi from '../AlerteEmploi';

// `vi.hoisted` : `vi.mock` est remonté au-dessus des imports, donc les doublures
// doivent exister AVANT — une simple `const` serait encore en zone morte et le
// module importé lirait un `api` non initialisé.
const { api, toast } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../services/api', () => ({ api }));
vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (cle) => cle, currentLanguage: 'fr' }),
}));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toast }));

const CATEGORIES = [
  { value: '', label: 'Toutes les catégories' },
  { value: 'plumbing', label: 'Plomberie' },
  { value: 'electrical', label: 'Électricité' },
];

const rendre = () => render(<AlerteEmploi categories={CATEGORIES} pays="senegal" />);

describe('AlerteEmploi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({
      active: false,
      category: null,
      city: null,
      country: 'senegal',
      sent_count: 0,
      last_notified_at: null,
    });
    api.put.mockResolvedValue({ active: true, category: 'plumbing', city: 'Dakar' });
    api.delete.mockResolvedValue({ active: false });
  });

  it('active l’alerte avec la catégorie, la ville et le pays du compte', async () => {
    rendre();

    const categorie = await screen.findByLabelText('jobAlertCategory');
    await waitFor(() => expect(categorie).toBeEnabled());
    await userEvent.selectOptions(categorie, 'plumbing');
    await userEvent.type(screen.getByLabelText('jobAlertCity'), 'Dakar');
    await userEvent.click(screen.getByRole('button', { name: 'jobAlertSave' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith('/job-alerts', {
      category: 'plumbing',
      city: 'Dakar',
      country: 'senegal',
      active: true,
    });
    expect(toast.success).toHaveBeenCalledWith('jobAlertSaved');
  });

  it('n’envoie ni catégorie ni ville vides, et garde le pays', async () => {
    rendre();

    await screen.findByLabelText('jobAlertCategory');
    await userEvent.click(screen.getByRole('button', { name: 'jobAlertSave' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith('/job-alerts', {
      category: null,
      city: null,
      country: 'senegal',
      active: true,
    });
  });

  it('affiche l’état actif et permet de couper la veille', async () => {
    api.get.mockResolvedValue({
      active: true,
      category: 'electrical',
      city: 'Thiès',
      country: 'senegal',
      sent_count: 2,
      last_notified_at: null,
    });

    rendre();

    expect(await screen.findByText('jobAlertActive')).toBeInTheDocument();
    // Les critères enregistrés sont repris dans le formulaire : une veille qui
    // s'ouvrirait vide ferait croire qu'elle n'a rien retenu.
    expect(screen.getByLabelText('jobAlertCategory')).toHaveValue('electrical');
    expect(screen.getByLabelText('jobAlertCity')).toHaveValue('Thiès');

    await userEvent.click(screen.getByRole('button', { name: 'jobAlertStop' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/job-alerts'));
    expect(toast.success).toHaveBeenCalledWith('jobAlertStopped');
  });

  it('un échec se VOIT : la carte ne prétend pas avoir enregistré', async () => {
    api.put.mockRejectedValue(new Error('HTTP 503'));
    rendre();

    await screen.findByLabelText('jobAlertCategory');
    await userEvent.click(screen.getByRole('button', { name: 'jobAlertSave' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('HTTP 503'));
    expect(toast.success).not.toHaveBeenCalled();
    // L'état affiché reste celui du serveur (inactive), pas un optimisme local.
    expect(screen.queryByText('jobAlertActive')).not.toBeInTheDocument();
  });

  it('un lien venu d’une page ville pose SA ville sans effacer la catégorie du compte', async () => {
    // Une alerte par compte : écraser la catégorie que le visiteur n'a pas
    // cliquée serait une perte silencieuse. La ville du lien, elle, gagne —
    // c'est ce qu'il est venu demander.
    api.get.mockResolvedValue({
      active: true,
      category: 'plumbing',
      city: 'Bamako',
      country: 'mali',
    });

    render(
      <AlerteEmploi
        categories={CATEGORIES}
        pays="mali"
        ouvrirAlerte
        villeInitiale="Abidjan"
      />
    );

    const ville = await screen.findByLabelText('jobAlertCity');
    await waitFor(() => expect(ville).toHaveValue('Abidjan'));
    expect(screen.getByLabelText('jobAlertCategory')).toHaveValue('plumbing');
  });

  it('sans lien, la veille enregistrée gagne : /jobs n’écrase pas un réglage en s’ouvrant', async () => {
    api.get.mockResolvedValue({
      active: true,
      category: 'plumbing',
      city: 'Bamako',
      country: 'mali',
    });

    render(
      <AlerteEmploi
        categories={CATEGORIES}
        pays="mali"
        categorieInitiale="electrical"
        villeInitiale="Dakar"
      />
    );

    const ville = await screen.findByLabelText('jobAlertCity');
    await waitFor(() => expect(ville).toHaveValue('Bamako'));
    expect(screen.getByLabelText('jobAlertCategory')).toHaveValue('plumbing');
  });

  it('une lecture impossible est DITE, et ne casse pas la page', async () => {
    api.get.mockRejectedValue(new Error('HTTP 500'));

    rendre();

    expect(await screen.findByText('jobAlertUnavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'jobAlertSave' })).not.toBeInTheDocument();
  });
});
