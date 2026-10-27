/**
 * PARTAGER UNE MISSION — le lien qui part, le canal, et ce qui est COMPTÉ.
 *
 * ── Ce que ce fichier ferme ────────────────────────────────────────────────
 * Un partage qui n'ouvre pas la BONNE URL est pire qu'aucun partage : le
 * destinataire reçoit une page sans aperçu. Le lien doit donc être celui de la
 * fiche PUBLIQUE (`/jobs/:id`), en ABSOLU (les crawlers de partage refusent une
 * URL relative) — c'est cette URL que le backend pré-rend avec ses balises Open
 * Graph (`kojo_job_og.py`), donc la seule qui affiche un titre et une carte
 * dans WhatsApp.
 *
 * Les trois refus de mesure sont verrouillés ici aussi :
 *   • la feuille du système ouverte puis REFERMÉE (`AbortError`) n'est pas un
 *     partage — la compter ferait lire un intérêt que personne n'a exprimé ;
 *   • un partage porte le CANAL, jamais l'identifiant de la mission ni son
 *     titre (liste blanche de `utils/funnel.js`) ;
 *   • une mission sans identifiant ne rend AUCUN bouton : un bouton qui
 *     ouvrirait une fiche inexistante serait un lien mort.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../contexts/LanguageContext', async () => {
  const { default: fr } = await vi.importActual('../../i18n/fr.json');
  return { useLanguage: () => ({ currentLanguage: 'fr', t: (key) => fr[key] || key }) };
});

import BoutonPartageMission, {
  identifiantDeMission,
  lienPartageMission,
  messagePartageMission,
} from '../BoutonPartageMission';

const MISSION = {
  id: 'job-42',
  title: 'Réparation d’une fuite à Dakar',
};

/** Un `gtag` espion : c'est lui qui reçoit les étapes du funnel. */
const avecGtag = () => {
  const gtag = vi.fn();
  window.gtag = gtag;
  return gtag;
};

const evenements = (gtag) =>
  gtag.mock.calls.filter(([commande, nom]) => commande === 'event' && nom === 'job_shared');

beforeEach(() => {
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  delete window.gtag;
  delete window.navigator.share;
  vi.restoreAllMocks();
});

describe('BoutonPartageMission — le lien partagé', () => {
  it('partage la fiche PUBLIQUE en absolu, pas la route courante', () => {
    const lien = lienPartageMission(MISSION);

    // L'URL de la fiche pré-rendue, celle qui porte les balises OG.
    expect(lien).toBe(`${window.location.origin}/jobs/job-42`);
    expect(lien.startsWith('http')).toBe(true);
  });

  it('lit l’identifiant quelle que soit la forme rendue par l’API', () => {
    expect(identifiantDeMission({ _id: 'a' })).toBe('a');
    expect(identifiantDeMission({ job_id: 'b' })).toBe('b');
    expect(identifiantDeMission({ jobId: 'c' })).toBe('c');
    expect(identifiantDeMission({})).toBe('');
  });

  it('ne rend AUCUN bouton pour une mission sans identifiant (pas de lien mort)', () => {
    const { container } = render(<BoutonPartageMission job={{ title: 'Sans identifiant' }} />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('nomme la mission dans le message : le titre, puis le lien', () => {
    expect(messagePartageMission(MISSION)).toBe(
      `${MISSION.title} — ${window.location.origin}/jobs/job-42`
    );
  });
});

describe('BoutonPartageMission — le canal, et le compte', () => {
  it('sans feuille système, ouvre wa.me avec le message et compte `whatsapp`', () => {
    const gtag = avecGtag();
    render(<BoutonPartageMission job={MISSION} variante="libelle" />);

    fireEvent.click(screen.getByRole('button', { name: /Partager/ }));

    expect(window.open).toHaveBeenCalledTimes(1);
    const [url, cible] = window.open.mock.calls[0];
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    // Le message réellement transmis : le lien de la fiche y est, encodé.
    expect(decodeURIComponent(url.split('text=')[1])).toContain('/jobs/job-42');
    expect(cible).toBe('_blank');

    expect(evenements(gtag)).toEqual([['event', 'job_shared', { channel: 'whatsapp' }]]);
  });

  it('avec la feuille du système, compte `natif` et n’ouvre pas wa.me', async () => {
    const gtag = avecGtag();
    window.navigator.share = vi.fn().mockResolvedValue(undefined);
    render(<BoutonPartageMission job={MISSION} />);

    fireEvent.click(screen.getByRole('button', { name: /Partager/ }));

    await waitFor(() => expect(evenements(gtag)).toHaveLength(1));
    expect(window.navigator.share).toHaveBeenCalledWith({
      title: MISSION.title,
      text: MISSION.title,
      url: `${window.location.origin}/jobs/job-42`,
    });
    expect(evenements(gtag)[0][2]).toEqual({ channel: 'natif' });
    expect(window.open).not.toHaveBeenCalled();
  });

  it('une feuille REFERMÉE n’est pas un partage compté', async () => {
    const gtag = avecGtag();
    window.navigator.share = vi.fn().mockRejectedValue(
      Object.assign(new Error('annulé'), { name: 'AbortError' })
    );
    render(<BoutonPartageMission job={MISSION} />);

    fireEvent.click(screen.getByRole('button', { name: /Partager/ }));

    await waitFor(() => expect(window.navigator.share).toHaveBeenCalled());
    expect(evenements(gtag)).toEqual([]);
    // Une fermeture n'est pas une panne : elle ne retombe pas sur WhatsApp.
    expect(window.open).not.toHaveBeenCalled();
  });

  it('une feuille en PANNE retombe sur WhatsApp, et le geste est compté une fois', async () => {
    const gtag = avecGtag();
    window.navigator.share = vi.fn().mockRejectedValue(new Error('non disponible'));
    render(<BoutonPartageMission job={MISSION} />);

    fireEvent.click(screen.getByRole('button', { name: /Partager/ }));

    await waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(evenements(gtag)).toHaveLength(1));
    expect(evenements(gtag)[0][2]).toEqual({ channel: 'whatsapp' });
  });

  it('n’envoie jamais l’identifiant ni le titre au rapport d’audience', () => {
    const gtag = avecGtag();
    render(<BoutonPartageMission job={MISSION} variante="libelle" />);

    fireEvent.click(screen.getByRole('button', { name: /Partager/ }));

    const transmis = JSON.stringify(gtag.mock.calls);
    expect(transmis).not.toContain('job-42');
    expect(transmis).not.toContain('Dakar');
  });
});
