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
 *   2. au moins un lien porte `title="Google Maps"` vers l'URL de la fiche
 *      (c'est cette désignation qu'un audit lit pour reconnaître la présence
 *      locale) ; il était auparavant nommé par `aria-label="Google Maps"`, et
 *      ce nom MASQUAIT le texte affiché (« Adresse » + l'adresse) — WCAG 2.5.3,
 *      refusé par la sonde d'accessibilité sur cinq routes publiques le
 *      22/10/2026. Le nom accessible est donc le texte visible, et le test le
 *      vérifie au lieu de le supposer ;
 *   3. les moyens de contact restent cliquables (`tel:`, `mailto:`, `wa.me/`).
 *
 * C'est un test de RENDU : il monte la vraie page, avec le vrai dictionnaire.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Home from '../Home';
import { CONTACT } from '../../config/contact';
import { PAGE_SECTIONS } from '../../config/page-sections';
import fr from '../../i18n/fr.json';

// Le hook de métadonnées écrit dans document.head : hors du sujet ici.
vi.mock('../../utils/seo', () => ({ usePageMeta: vi.fn() }));

// La réponse de `GET /public/stats` : c'est elle qui départage l'état d'attente et
// les chiffres réels. Tenue de l'extérieur pour juger les TROIS états — sous le
// seuil, au-dessus, et en panne — sans jamais appeler le réseau.
const statsPubliques = vi.hoisted(() => ({ reponse: null, erreur: null }));

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn(async (chemin) => {
        if (chemin !== '/public/stats') throw new Error(`route inattendue : ${chemin}`);
        if (statsPubliques.erreur) throw statsPubliques.erreur;
        return statsPubliques.reponse;
      }),
    },
  };
});

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

  it('publie un lien Google Maps explicite (désigné par title, nommé par son texte visible)', () => {
    const { container } = rendreLAccueil();

    // La désignation lue par un audit de référencement local : un lien qui
    // MÈNE à la fiche et la NOMME. Elle passe par `title` — un `aria-label` ne
    // peut pas la porter ici, parce que le nom accessible doit être le texte
    // visible (WCAG 2.5.3) et que ce lien affiche l'adresse, pas « Google
    // Maps ».
    const liens = [...container.querySelectorAll('a[title="Google Maps"]')];
    expect(liens.length, 'aucun lien Google Maps sur l’accueil').toBeGreaterThan(0);

    for (const lien of liens) {
      expect(lien.getAttribute('href')).toBe(CONTACT.mapsUrl);
      expect(lien.getAttribute('target')).toBe('_blank');
      expect(lien.getAttribute('rel')).toContain('noreferrer');

      // Le nom accessible est le texte visible : une étiquette qui ne le
      // contient pas est exactement le défaut que la sonde refusait.
      const etiquette = lien.getAttribute('aria-label');
      const texteVisible = lien.textContent.replace(/\s+/g, ' ').trim();
      expect(texteVisible.length, 'le lien n’a AUCUN texte visible').toBeGreaterThan(0);
      if (etiquette !== null) {
        expect(
          etiquette.toLowerCase(),
          `l’étiquette « ${etiquette} » masque le texte visible « ${texteVisible} » (WCAG 2.5.3)`
        ).toContain(texteVisible.toLowerCase());
      }
    }
  });

  /**
   * ── LA BANDE DE FAITS NE PUBLIE AUCUN COMPTEUR (26/10/2026) ─────────────
   *
   * Mesuré en production : la bande du héros affichait « 3 travailleurs ·
   * 0 mission terminée · 0 avis ». La doctrine d'alors — « un zéro publié est
   * une mesure » — est juste dans un tableau de bord et fausse au seuil d'un
   * accueil qui vend la confiance : deux zéros alignés ne mesurent pas la
   * plateforme, ils la décrivent comme vide.
   *
   * Les deux faits qui restent sont déclarés dans le plan et ne dépendent
   * d'AUCUNE donnée : la valeur peinte est donc exactement celle du plan, ce
   * qui interdit à la fois le compteur à zéro et le remplacement après
   * montage (celui-ci déplaçait la bande).
   */
  it('la bande de faits ne publie que les faits DÉCLARÉS — aucun compteur, aucun zéro', () => {
    const { container } = rendreLAccueil();

    const figures = [...container.querySelectorAll('.fait-cta-figure')];
    const declarees = PAGE_SECTIONS['/'].stats;

    expect(
      declarees.length,
      'la bande doit garder un plancher de faits : un garde qui ne lit rien ne prouve rien'
    ).toBeGreaterThanOrEqual(2);
    expect(
      figures.length,
      `${figures.length} fait(s) peint(s) pour ${declarees.length} déclaré(s) — la bande a divergé de son plan`
    ).toBe(declarees.length);

    const peintes = figures.map((figure) => figure.textContent.replace(/\s+/g, ' ').trim());
    expect(peintes).toEqual(declarees.map((stat) => stat.fallback));

    for (const valeur of peintes) {
      expect(
        /^0([.,]\s?0+)?\s*(\+|%|\/7)?$/.test(valeur),
        `« ${valeur} » est un compteur à zéro publié comme preuve sociale`
      ).toBe(false);
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

/**
 * ── LA PREUVE SOCIALE PUBLIE UN ÉTAT D'ATTENTE, PUIS DES CHIFFRES RÉELS ───
 *
 * Le 26/10/2026, la bande publiait « 0 mission terminée · 0 avis » : le compteur
 * brut de l'API. Les deux faits statiques (pays, support) l'ont remplacée — et
 * ne prouvent rien de ce que la plateforme a FAIT. La ligne de preuve rétablit
 * la mesure sans rétablir le mensonge : elle dit « chiffres à venir » tant que
 * trois missions terminées et deux avis ne sont pas atteints, puis publie les
 * compteurs réels.
 *
 * Ce qui est jugé ici, et pourquoi ces trois cas :
 *   • SOUS le seuil — l'état d'attente est l'état PAR DÉFAUT, celui que la
 *     coquille pré-rendue peint avant tout JavaScript. Un premier paint qui
 *     afficherait déjà autre chose ferait diverger les deux canaux ;
 *   • AU-DESSUS — les chiffres réels, formatés par la langue, remplacent le
 *     texte d'attente dans le MÊME nœud (la ligne existe avant le montage :
 *     rien n'est inséré, donc rien ne se déplace) ;
 *   • PANNE — une lecture qui échoue laisse l'attente : elle ne devient ni un
 *     zéro ni un message d'erreur.
 */
describe('accueil — preuve sociale mesurée', () => {
  const ATTTENTE = fr[PAGE_SECTIONS['/'].preuveAttenteKey];
  const ligneDePreuve = (conteneur) =>
    conteneur.querySelector(`.${PAGE_SECTIONS['/'].preuveClass}`);

  beforeEach(() => {
    statsPubliques.reponse = null;
    statsPubliques.erreur = null;
  });

  it('sous le seuil, la ligne dit l’état d’attente déclaré — et n’avance aucun chiffre', async () => {
    statsPubliques.reponse = { completed_jobs: 2, reviews: 9 };
    const { container } = rendreLAccueil();

    const ligne = ligneDePreuve(container);
    expect(ligne, 'la ligne de preuve n’est pas peinte dans la bande').not.toBeNull();
    expect(
      ligne.closest(`.${PAGE_SECTIONS['/'].faitsClass}`),
      'la ligne de preuve est sortie de la bande de faits'
    ).not.toBeNull();

    // Le PREMIER paint est déjà l'attente : c'est ce que la coquille publie.
    expect(ligne.textContent.trim()).toBe(ATTTENTE);
    // …et la lecture ne la change pas : deux missions ne sont pas une preuve.
    await waitFor(() => expect(ligne.textContent.trim()).toBe(ATTTENTE));
    expect(ligne.textContent, 'un chiffre a été publié sous le seuil').not.toMatch(/\d/);
  });

  it('au-dessus du seuil, la ligne publie les compteurs RÉELS, dans le nœud déjà peint', async () => {
    statsPubliques.reponse = { completed_jobs: 12, reviews: 8 };
    const { container } = rendreLAccueil();

    const ligne = ligneDePreuve(container);
    expect(ligne, 'la ligne de preuve n’est pas peinte dans la bande').not.toBeNull();
    const avant = ligne.textContent.trim();
    expect(avant, 'le premier paint doit rester l’attente déclarée').toBe(ATTTENTE);

    await waitFor(() => expect(ligne.textContent).toContain('12 missions terminées'));
    expect(ligne.textContent).toContain('8 avis vérifiés');
    expect(ligne.textContent, 'l’attente est restée affichée avec les chiffres').not.toContain(
      ATTTENTE
    );
  });

  it('une lecture en panne reste en attente — jamais un zéro, jamais un rouge', async () => {
    statsPubliques.erreur = new Error('503 Service Unavailable');
    const { container } = rendreLAccueil();

    const ligne = ligneDePreuve(container);
    await waitFor(() => expect(ligne.textContent.trim()).toBe(ATTTENTE));
    expect(ligne.textContent, 'une panne de lecture a publié un compteur').not.toMatch(/\b0\b/);
  });
});
