/**
 * LE REGISTRE DES DRAPEAUX, éprouvé à l'unité — parce que la coquille de
 * l'accueil en dépend pour ne plus publier d'EMOJI.
 *
 * Ce qui est verrouillé ici, et pourquoi chacun a un sens :
 *   • CHAQUE pays du référentiel a un dessin. `COUNTRIES` est lu par les deux
 *     canaux (les cartes de l'accueil et le build), et `shells-home.js` LÈVE si
 *     un pays n'a pas de drapeau : ce cas est la première marche — sans lui, le
 *     build s'arrête à la première carte, et la preuve dit laquelle.
 *   • Le rendu ne contient AUCUN emoji. C'est l'objet même du module : tant que
 *     le HTML pré-rendu portait « 🇲🇱 », le document dépendait de la police du
 *     VISITEUR (mesuré : −58,0 ms mobile / −13,7 ms desktop de « Style &
 *     Layout » en les remplaçant par ces dessins, variantes entrelacées).
 *   • Un nom inconnu ÉCHOUE bruyamment (jamais un drapeau vide publié en
 *     silence), et les alias de code pays/language tombent sur le même dessin.
 *   • Le Royaume-Uni garde son viewBox à lui (60×30) : les six drapeaux ne
 *     partagent pas la même grille, et une simplification qui l'oublierait
 *     recadrerait le drapeau.
 */
import { describe, expect, it } from 'vitest';
import { COUNTRIES } from '../../src/config/countries.js';
import {
  IconeDrapeau,
  contenuDuDrapeau,
  nomDuDrapeau,
  viewBoxDuDrapeau,
} from '../../src/config/flags.js';

const EMOJI_DRAPEAU = /[\u{1F1E6}-\u{1F1FF}\u{1F3F3}]/u;

describe('le registre des drapeaux', () => {
  it('couvre chaque pays du référentiel — le build refuse sinon', () => {
    const sansDessin = COUNTRIES.filter((pays) => !nomDuDrapeau(pays.code));
    expect(sansDessin.map((pays) => pays.code)).toEqual([]);
    expect(COUNTRIES.length).toBeGreaterThan(0);
  });

  it('rend un SVG sans aucun emoji (c’est la raison d’être du module)', () => {
    for (const pays of COUNTRIES) {
      const nom = nomDuDrapeau(pays.code);
      const contenu = contenuDuDrapeau(nom);
      expect(contenu, `${pays.code} : le dessin porte un emoji`).not.toMatch(EMOJI_DRAPEAU);
      expect(contenu, `${pays.code} : ce n’est pas un dessin`).toMatch(/^<(rect|path|g|circle|polygon)/);
      expect(contenu, `${pays.code} : le dessin doit être fermé`).not.toContain('</svg>');
    }
    // Le rendu React, lui, est un `<svg>` : aucun emoji ne peut s'y glisser.
    const rendu = IconeDrapeau({ nom: 'mali', classe: 'w-14 h-10' });
    expect(rendu.props.viewBox).toBe('0 0 900 600');
    expect(rendu.props['data-drapeau']).toBe('mali');
    expect(String(rendu.props.dangerouslySetInnerHTML.__html)).not.toMatch(EMOJI_DRAPEAU);
    expect(rendu.props['aria-hidden']).toBe(true);
  });

  it('résout les alias de pays ET de langue sur le même dessin', () => {
    // Les cartes de l'accueil passent un code de pays ; le sélecteur de langue
    // affiche `fr`, `en`, `wo`, `bm`, `mos` par un drapeau — c'est l'usage réel,
    // et une seule table le porte.
    expect(nomDuDrapeau('ivory_coast')).toBe('ivory_coast');
    expect(nomDuDrapeau('ci')).toBe('ivory_coast');
    expect(nomDuDrapeau('ML')).toBe('mali');
    expect(nomDuDrapeau('wo')).toBe('senegal');
    expect(nomDuDrapeau('bm')).toBe('mali');
    expect(nomDuDrapeau('mos')).toBe('burkina_faso');
    expect(nomDuDrapeau('fr')).toBe('france');
    expect(nomDuDrapeau('en')).toBe('royaumeUni');
    expect(nomDuDrapeau('gb')).toBe('royaumeUni');
    // Ce qui n'est pas un drapeau connu vaut `null` (la page peint une icône
    // neutre) — et le BUILD, lui, lève sur ce cas (voir le premier test).
    expect(nomDuDrapeau('narnia')).toBe(null);
    expect(nomDuDrapeau(undefined)).toBe(null);
  });

  it('échoue bruyamment sur un nom inconnu, au lieu de publier un drapeau vide', () => {
    expect(() => contenuDuDrapeau('narnia')).toThrow(/n’est pas déclaré dans le registre/);
    expect(() => viewBoxDuDrapeau('narnia')).toThrow(/n’est pas déclaré dans le registre/);
  });

  it('garde le viewBox de chaque drapeau (le Royaume-Uni n’est pas sur la même grille)', () => {
    expect(viewBoxDuDrapeau('royaumeUni')).toBe('0 0 60 30');
    expect(viewBoxDuDrapeau('france')).toBe('0 0 900 600');
    expect(viewBoxDuDrapeau('mali')).toBe('0 0 900 600');
  });
});
