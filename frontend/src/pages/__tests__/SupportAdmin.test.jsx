/**
 * /support-admin : une requête en vol ne doit plus écrire d'état APRÈS le
 * démontage de la page.
 *
 * ── La classe de défaut que ce fichier ferme ────────────────────────────────
 * Sur `main`, le job « Frontend tests + build » est devenu ROUGE sur
 * `src/pages/SupportAdmin.js` : une réponse de `supportAPI.listTickets` arrivait
 * après la fin de l'environnement de test, la page appelait `setTickets(...)`,
 * et React lit `window` pour choisir la priorité d'une mise à jour d'état —
 * `ReferenceError: window is not defined`. Même cause côté produit : quitter la
 * page pendant qu'une requête est en vol faisait écrire dans un arbre démonté.
 *
 * ── Ce qui est mesuré ───────────────────────────────────────────────────────
 * Pas une relecture : on compte les ÉCRITURES D'ÉTAT réelles. Le test enveloppe
 * `useState` et enregistre tout appel de setter APRÈS le démontage. Retirer le
 * garde de démontage fait donc rougir ce test, sans dépendre du hasard du
 * timing d'un runner.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ── Compteur d'écritures d'état postérieures au démontage ─────────────────
const etatDeLaPage = { demontee: false, ecrituresApresDemon: 0 };
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal();
  const useState = (initial) => {
    const [valeur, setValeur] = actual.useState(initial);
    return [
      valeur,
      (...args) => {
        if (etatDeLaPage.demontee) etatDeLaPage.ecrituresApresDemon += 1;
        return setValeur(...args);
      },
    ];
  };
  return { ...actual, useState };
});

const listTickets = vi.fn();
vi.mock('../../services/apiEndpoints', () => ({
  supportAPI: {
    listTickets: (...args) => listTickets(...args),
    updateTicketStatus: vi.fn(),
  },
}));
vi.mock('../../contexts/LanguageContext', async (importOriginal) => {
  const actual = await importOriginal();
  const { default: fr } = await vi.importActual('../../i18n/fr.json');
  return {
    ...actual,
    useLanguage: () => ({ currentLanguage: 'fr', changeLanguage: vi.fn(), t: (key) => fr[key] ?? key }),
  };
});

const SupportAdmin = (await import('../SupportAdmin.js')).default;

const reponseDifferee = () => {
  let resolve;
  const promesse = new Promise((r) => { resolve = r; });
  return { promesse, resolve };
};

describe('SupportAdmin — démontage pendant une requête', () => {
  beforeEach(() => {
    listTickets.mockReset();
    etatDeLaPage.demontee = false;
    etatDeLaPage.ecrituresApresDemon = 0;
  });

  it('la charge initiale aboutit (témoin : la page fonctionne)', async () => {
    listTickets.mockResolvedValue({ data: [{ id: 't1', status: 'Nouveau' }] });
    render(<SupportAdmin />);
    await waitFor(() => expect(screen.queryByText('Chargement...')).toBeNull());
    expect(listTickets).toHaveBeenCalledTimes(1);
  });

  it("une réponse arrivée APRÈS le démontage n'écrit plus d'état", async () => {
    const { promesse, resolve } = reponseDifferee();
    listTickets.mockReturnValue(promesse);

    const { unmount } = render(<SupportAdmin />);
    unmount();
    etatDeLaPage.demontee = true;

    resolve({ data: [{ id: 't1', status: 'Nouveau' }] });
    await new Promise((r) => setTimeout(r, 20));

    expect(listTickets).toHaveBeenCalledTimes(1);
    expect(
      etatDeLaPage.ecrituresApresDemon,
      'une requête terminée après le démontage ne doit plus toucher l’état de la page'
    ).toBe(0);
  });
});
