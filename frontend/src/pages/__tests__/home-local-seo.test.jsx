/**
 * L'ACCUEIL publie une carte Google intégrée et un lien Google Maps explicite.
 *
 * ── La classe de défaut que ce fichier ferme ────────────────────────────────
 * Un audit de référencement local reprochait à l'accueil deux manques : « aucune
 * carte Google intégrée » et « aucun lien vers Google Maps / Business Profile ».
 * Les deux EXISTAIENT pourtant… dans la coquille pré-rendue
 * (vite-plugins/prerender/shells-home.js, contrôlée par check-home-shell.js) :
 * le bloc de contact et son iframe étaient rendus par le HTML statique, puis
 * EFFACÉS au montage de React, parce que src/pages/Home.js ne rendait pas cette
 * section. Un crawler qui exécute le JavaScript — celui qui produit l'audit —
 * ne voyait donc ni carte, ni lien, alors que `node scripts/check-home-shell.js`
 * était vert : le garde lit le BUILD, pas ce que React affiche.
 *
 * Le commentaire de shells-home.js disait « elle est aussi dans le footer React,
 * donc elle survit au montage » — le pied de page React ne portait que les
 * QUATRE liens de contact, jamais la carte. Un commentaire n'est pas un contrôle.
 *
 * ── Ce que ce test exige ────────────────────────────────────────────────────
 *   1. la FAÇADE de carte est dans l'arbre APRÈS montage — un lien vers la
 *      fiche Google, comme la coquille pré-rendue et comme /contact — et NON
 *      une iframe : l'embed `output=embed` ne doit monter QU'À l'appui. Mesuré
 *      (Lighthouse 12.6.1, pile de la CI, Chrome 152, /contact mobile, 3 runs) :
 *      l'iframe du premier écran, même en `loading="lazy"`, tire ~300 Ko de
 *      tiers et repousse le LCP à 4143-4399 ms simulés (scores 81-85) ;
 *   2. au moins un lien porte `aria-label="Google Maps"` + `title="Google Maps"`
 *      vers l'URL de la fiche (c'est cette désignation qu'un audit lit pour
 *      reconnaître la présence locale) ;
 *   3. les moyens de contact restent cliquables (`tel:`, `mailto:`, `wa.me/`).
 *
 * C'est un test de RENDU : il monte la vraie page, avec le vrai dictionnaire.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Home from '../Home';
import { CONTACT } from '../../config/contact';
import { PAGE_SECTIONS } from '../../config/page-sections';
import fr from '../../i18n/fr.json';

// Le hook de métadonnées écrit dans document.head : hors du sujet ici.
vi.mock('../../utils/seo', () => ({ usePageMeta: vi.fn() }));

// Seuls les HOOKS sont figés (mêmes raisons que pages-render.test.jsx) : le
// dictionnaire, lui, est le vrai — une clé absente doit se voir dans le rendu.
vi.mock('../../contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useAuth: () => ({ user: null, loading: false }) };
});
vi.mock('../../contexts/LanguageContext', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useLanguage: () => ({
      currentLanguage: 'fr',
      changeLanguage: vi.fn(),
      t: (key) => fr[key] ?? key,
    }),
  };
});

const rendreLAccueil = () =>
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>
  );

afterEach(() => {
  cleanup();
});

describe('accueil — SEO local (carte intégrée + lien Google Maps)', () => {
  it('publie la FAÇADE de carte après montage (aucun tiers au premier écran, l’iframe à l’appui)', () => {
    const { container } = rendreLAccueil();

    // Le premier écran ne tire AUCUN embed tiers : c'est la façade, et non une
    // iframe chargée d'emblée, qui donne son feu vert à un audit « carte
    // intégrée ». (Le tableau vide est la garde : une iframe rendue ici serait
    // exactement la régression que la coquille a fermée.)
    expect(
      [...container.querySelectorAll('iframe')],
      'une iframe de carte est rendue AVANT l’appui : le premier écran tire des octets tiers'
    ).toHaveLength(0);

    // Le contrôle mène à la fiche Google (un vrai lien : il fonctionne sans
    // JavaScript, c'est lui que la coquille publie aussi).
    const controle = screen.getByRole('link', { name: fr.mapShowMap });
    expect(controle.getAttribute('href')).toBe(CONTACT.mapsUrl);
    expect(controle.getAttribute('title')).toBe(
      fr.mapIframeTitle.replace('{address}', CONTACT.address)
    );

    fireEvent.click(controle);

    const iframe = container.querySelector('iframe');
    expect(iframe, 'l’iframe n’est pas montée à l’appui').not.toBeNull();
    const src = iframe.getAttribute('src') || '';
    expect(src).toBe(CONTACT.mapsEmbedUrl);
    expect(src, 'la carte montée doit être la carte INTÉGRÉE (output=embed)').toContain('output=embed');
    expect(
      iframe.getAttribute('loading'),
      'la carte doit rester en loading="lazy" (sinon elle concurrence le LCP de l’accueil)'
    ).toBe('lazy');
    expect(iframe.getAttribute('title')).toBe(
      fr.mapIframeTitle.replace('{address}', CONTACT.address)
    );
    // Même boîte réservée que la coquille et que /contact : le remplacement ne
    // déplace rien (pas de CLS), et les deux canaux lisent la même déclaration.
    expect(iframe.className).toBe(PAGE_SECTIONS['/contact'].mapFrameClass);
  });

  it('publie un lien Google Maps explicite (désigné par aria-label et title)', () => {
    rendreLAccueil();

    const liens = screen.getAllByRole('link', { name: 'Google Maps' });
    expect(liens.length).toBeGreaterThan(0);

    for (const lien of liens) {
      expect(lien.getAttribute('href')).toBe(CONTACT.mapsUrl);
      expect(lien.getAttribute('title')).toBe('Google Maps');
      expect(lien.getAttribute('target')).toBe('_blank');
      expect(lien.getAttribute('rel')).toContain('noreferrer');
    }
  });

  it('garde les moyens de contact cliquables (tel:, mailto:, wa.me)', () => {
    rendreLAccueil();

    const hrefs = screen
      .getAllByRole('link')
      .map((lien) => lien.getAttribute('href') || '');

    expect(hrefs.some((h) => h.startsWith('tel:')), 'aucun lien tel:').toBe(true);
    expect(hrefs.some((h) => h.startsWith('mailto:')), 'aucun lien mailto:').toBe(true);
    expect(hrefs.some((h) => h.includes('wa.me/')), 'aucun lien WhatsApp').toBe(true);
    expect(hrefs).toContain(`tel:${CONTACT.phone.replace(/[^+\d]/g, '')}`);
  });
});
