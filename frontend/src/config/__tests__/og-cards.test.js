/**
 * La table des cartes vient-elle de ce que les fichiers de données DÉCLARENT —
 * la route servie, les textes de la page — et non plus du nom des PNG ?
 *
 * C'est la propriété qui remplace la convention de nom : `og-jobs.png` ne dit
 * plus quelle page il sert (la carte générique, elle, n'a jamais suivi de
 * convention), et la carte DESSINE le titre et la description de sa page, donc
 * c'est le même fichier de données qui déclare les deux. Deux erreurs
 * silencieuses sont possibles et doivent être nommées : une carte servie à une
 * route que personne n'a déclarée, et des textes de page déclarés à deux endroits
 * — d'où le dernier bloc, qui confronte la table servie aux fichiers de données
 * lus sur le disque.
 *
 * Les textes, eux, ne sont plus comparés : ils sortent du même fichier pour la
 * carte et pour la page. Ce qui reste à vérifier, c'est le CÂBLAGE — un fichier
 * de données présent sur le disque mais absent de la table servie.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  CARDS_BY_ROUTE,
  CARD_PAGE_META,
  GENERIC_CARD,
  cardPageMetaFrom,
  cardsFromDeclarations,
  ogCardFor,
} from '../og-cards';
import { PAGE_META } from '../page-meta';

describe('cardsFromDeclarations — la route déclarée décide de la carte', () => {
  it('sert la carte déclarée à la route déclarée', () => {
    const cards = cardsFromDeclarations([
      { route: '/jobs', wide: 'og-jobs.png', square: 'og-jobs-square.png' },
    ]);

    expect(cards).toEqual({
      '/jobs': { image: '/og-jobs.png', imageSquare: '/og-jobs-square.png' },
    });
  });

  it('n’invente aucune route à partir du NOM des fichiers', () => {
    // `og-image-1200x630.png` ne nomme aucune page : c'est la carte de la racine,
    // et seule sa déclaration le dit.
    const cards = cardsFromDeclarations([
      { route: '/', wide: 'og-image-1200x630.png', square: 'og-square-1200x1200.png' },
    ]);

    expect(cards).toEqual({
      '/': { image: '/og-image-1200x630.png', imageSquare: '/og-square-1200x1200.png' },
    });
    expect(Object.keys(cards)).toEqual(['/']);
  });

  it('normalise la route déclarée (« /jobs/ » est la même page que « /jobs »)', () => {
    const cards = cardsFromDeclarations([{ route: '/jobs/', wide: 'a.png', square: 'b.png' }]);

    expect(cards['/jobs']).toEqual({ image: '/a.png', imageSquare: '/b.png' });
    expect(cards['/jobs/']).toBeUndefined();
  });

  it('ignore une entrée incomplète plutôt que d’inventer une carte', () => {
    for (const card of [
      null,
      {},
      { route: '/x' },
      { route: '/x', wide: 'a.png' },
      { wide: 'a.png', square: 'b.png' },
    ]) {
      expect(cardsFromDeclarations([card]), JSON.stringify(card)).toEqual({});
    }
  });

  it('est vide — sans planter — pour une liste vide ou absente', () => {
    for (const cards of [[], undefined, null]) expect(cardsFromDeclarations(cards)).toEqual({});
  });
});

describe('cardPageMetaFrom — les textes de page que les cartes déclarent', () => {
  it('rend les clés i18n déclarées, par route', () => {
    expect(cardPageMetaFrom([{ route: '/jobs', title: 'a', description: 'b' }])).toEqual({
      '/jobs': { title: 'a', description: 'b' },
    });
  });

  it('ignore une carte qui ne déclare pas ses deux clés', () => {
    for (const card of [
      { route: '/jobs', wide: 'a.png', square: 'b.png' },
      { route: '/jobs', title: 'a' },
      { route: '/jobs', description: 'b' },
    ]) {
      expect(cardPageMetaFrom([card])).toEqual({});
    }
  });
});

// Le CÂBLAGE des fichiers de données : ce module les importe un par un, donc
// ajouter un fichier de scripts/og-cards/ sans l'importer servirait la carte
// générique à sa place, sans que rien ne le dise. C'est le seul reste de
// comparaison — les TEXTES, eux, ne sont plus comparés : ils sont lus dans le
// même fichier par la carte et par la page.
const CARDS_DIR = path.resolve(__dirname, '..', '..', '..', 'scripts', 'og-cards');
const DECLARED = readdirSync(CARDS_DIR)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => ({ name, card: JSON.parse(readFileSync(path.join(CARDS_DIR, name), 'utf8')) }));

describe('dépôt réel — chaque fichier de données est câblé, et sa page le lit', () => {
  it('chaque carte déclarée est servie à SA route, et ses PNG existent', () => {
    // Un dépôt sans carte ferait passer les boucles suivantes pour des preuves.
    expect(DECLARED.length).toBeGreaterThan(0);
    for (const { name, card } of DECLARED) {
      const served = CARDS_BY_ROUTE[card.route];
      expect(served, `${name} → ${card.route}`).toEqual({
        image: `/${card.wide}`,
        imageSquare: `/${card.square}`,
      });
      for (const file of [card.wide, card.square]) {
        expect(existsSync(path.join('public', file)), `${file} absent de public/`).toBe(true);
      }
    }
  });

  it('les textes de la route viennent de SON fichier de carte, des deux côtés', () => {
    for (const { name, card } of DECLARED) {
      const keys = { title: card.title, description: card.description };
      // La table servie au bundle ET celle que lit le build : une seule
      // déclaration, donc rien à comparer qui puisse diverger.
      expect(CARD_PAGE_META[card.route], name).toEqual(keys);
      expect(PAGE_META[card.route], name).toEqual(keys);
    }
  });

  it('la carte générique est celle de la racine, servie à toute page sans carte', () => {
    expect(Object.keys(CARDS_BY_ROUTE).length).toBeGreaterThan(0);
    expect(GENERIC_CARD).toEqual(CARDS_BY_ROUTE['/']);

    for (const [route, card] of Object.entries(CARDS_BY_ROUTE)) {
      expect(ogCardFor(route)).toEqual(card);
      expect(ogCardFor(`${route}/`)).toEqual(card);
      expect(ogCardFor(`${route}?ref=x`)).toEqual(card);
    }
    expect(ogCardFor('/une-page-sans-visuel')).toEqual(GENERIC_CARD);
    expect(ogCardFor(undefined)).toEqual(GENERIC_CARD);
  });
});
