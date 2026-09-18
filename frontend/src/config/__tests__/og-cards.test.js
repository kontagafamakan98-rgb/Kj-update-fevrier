/**
 * La table des cartes dédiées est-elle bien DÉDUITE des fichiers présents ?
 *
 * C'est la propriété qui remplace la liste écrite à la main : le nom du fichier
 * (`og-<page>.png` + sa variante carrée) EST la déclaration. Deux erreurs
 * silencieuses sont possibles et doivent être nommées : une carte servie à une
 * page qui n'existe pas (clé fantôme), et une carte large sans sa variante carrée
 * (la page retomberait sans bruit sur la carte générique).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import manifest from '../../../scripts/og-assets.manifest.json';
import { GENERIC_CARD, dedicatedCardsFrom, ogCardFor } from '../og-cards';

describe('dedicatedCardsFrom — le nom du fichier est la déclaration', () => {
  it('associe og-<page>.png à la page /<page>, variante carrée comprise', () => {
    const { cards, incomplete } = dedicatedCardsFrom(['og-jobs.png', 'og-jobs-square.png']);

    expect(cards).toEqual({
      '/jobs': { image: '/og-jobs.png', imageSquare: '/og-jobs-square.png' },
    });
    expect(incomplete).toEqual([]);
  });

  it('n’invente aucune page à partir des deux fichiers GÉNÉRIQUES', () => {
    const { cards } = dedicatedCardsFrom([GENERIC_CARD.image.slice(1), GENERIC_CARD.imageSquare.slice(1)]);

    expect(cards).toEqual({});
  });

  it('ne prend pas une variante carrée pour la carte d’une page « -square »', () => {
    const { cards } = dedicatedCardsFrom(['og-jobs-square.png']);

    expect(cards).toEqual({});
    expect(Object.keys(cards)).not.toContain('/jobs-square');
  });

  it('signale une carte large sans variante carrée, et ne la sert pas', () => {
    const { cards, incomplete } = dedicatedCardsFrom(['og-support.png']);

    expect(incomplete).toEqual(['/og-support.png']);
    expect(cards).toEqual({});
  });

  it('ignore les fichiers qui ne sont pas des cartes de page', () => {
    const { cards, incomplete } = dedicatedCardsFrom([
      'icons/icon-dark.png',
      'favicon.ico',
      'og-assets.manifest.json',
    ]);

    expect(cards).toEqual({});
    expect(incomplete).toEqual([]);
  });

  it('est vide — sans planter — pour une liste vide ou absente', () => {
    for (const files of [[], undefined, null]) {
      const { cards, incomplete } = dedicatedCardsFrom(files);
      expect(cards).toEqual({});
      expect(incomplete).toEqual([]);
    }
  });
});

// L'attente est DÉDUITE des cartes réellement présentes, jamais recopiée :
// nommer /jobs et /login ici serait la dernière liste écrite à la main — celle
// qu'une carte ajoutée ne met pas à jour, et qui laisse passer pour une preuve
// une déduction capable de renvoyer une table vide.
const REAL_FILES = (manifest.assets || []).map((asset) => asset.file);
const { cards: REAL_CARDS } = dedicatedCardsFrom(REAL_FILES);

describe('ogCardFor — la route décide, la carte suit', () => {
  it('sert à SA page chaque carte réellement présente dans public/', () => {
    // Une table vide ne prouve rien : sans ce plancher, une déduction débranchée
    // ferait passer la boucle ci-dessous pour une vérification.
    expect(Object.keys(REAL_CARDS).length).toBeGreaterThan(0);
    for (const [route, card] of Object.entries(REAL_CARDS)) {
      for (const file of [card.image, card.imageSquare]) {
        expect(existsSync(path.join('public', file)), `${file} absent de public/`).toBe(true);
      }
      expect(ogCardFor(route)).toEqual(card);
      expect(ogCardFor(`${route}/`)).toEqual(card);
      expect(ogCardFor(`${route}?ref=x`)).toEqual(card);
    }
  });

  it('sert la carte générique à une page sans visuel dédié', () => {
    const unknown = `${Object.keys(REAL_CARDS)[0]}-inexistant`;
    expect(ogCardFor(unknown)).toEqual(GENERIC_CARD);
    expect(ogCardFor(undefined)).toEqual(GENERIC_CARD);
  });
});
