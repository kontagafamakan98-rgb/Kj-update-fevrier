import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PhotoDuHeros from '../PhotoDuHeros';
import {
  PHOTOS_HEROS,
  PHOTO_HEROS_DELAI_MS,
  PHOTO_HEROS_HAUTEUR,
  PHOTO_HEROS_LARGEUR,
} from '../../config/photos-heros';

// ── CE QUE CES CAS PROUVENT, ET POURQUOI ────────────────────────────────────
// La photo du héros est l'ÉLÉMENT LCP de « / » (mesuré, les deux canaux), et
// elle ALTERNE toutes les 15 s : c'est exactement la situation où plusieurs
// propriétés peuvent se perdre en silence.
//
//   1. LA BOÎTE EST RÉSERVÉE. `width` et `height` doivent porter les dimensions
//      RÉELLES du fichier, sinon le navigateur ne réserve pas la place et
//      l'arrivée de l'image décale la page (CLS) — et sur un héros, le décalage
//      emporte tout le premier écran.
//   2. LES FICHIERS EXISTENT, ET SONT AU MÊME RAPPORT. C'est la condition de
//      l'alternance (même boîte à chaque tour) — et c'est aussi le genre de
//      défaut qu'AUCUN autre garde ne voit : un chemin mal orthographié dans la
//      liste ne casse pas le build, ne rougit nulle part, et l'image manque en
//      silence dans le navigateur. Les dimensions sont lues DANS l'en-tête JPEG,
//      pas dans une constante : c'est le fichier qui parle.
//   3. L'ALTERNANCE TOURNE ET REVIENT. Le compteur est un modulo, pas une remise
//      à zéro : la liste est un cycle, donc la première photo revient au bout du
//      tour — un `index + 1` sans modulo aurait fait disparaître la source au
//      dernier tour (`undefined` dans l'attribut `src`).
//   4. LE NŒUD NE CHANGE PAS. Remplacer la source ne remplace pas l'élément :
//      l'identité du nœud est ce qui garantit que Chrome ne ré-élit pas un
//      second élément LCP à chaque tour (même boîte, même nœud, même position).
//   5. LA PRÉFÉRENCE SYSTÈME NE L'ÉTEINT PAS, et c'est une décision, pas un
//      oubli (voir le commentaire du composant) : le cas existe pour que ce
//      choix reste un choix, à renverser en connaissance de cause.
//   6. LE MINUTEUR EST DÉMONTÉ avec le composant (aucun `setInterval` orphelin
//      sur une page quittée).
//   7. LE PRÉCHARGEMENT AVANCE D'UN CRAN, APRÈS LE PREMIER PAINT : la photo
//      suivante est prête quand vient son tour, et rien n'est téléchargé pendant
//      le premier paint (l'image affichée, elle, part en `fetchpriority="high"`).
//
// jsdom ne calcule aucune mise en page : ces cas prouvent le COMPORTEMENT
// (fichiers, attributs, nœud, minuteurs, ordre des effets). Le FAIT — la boîte
// peinte, le CLS à 0,00 et une seule candidate LCP sous l'alternance — se mesure
// en navigateur (`e2e/cls-coquille-react.spec.js`, `e2e/lcp-geometrie.spec.js`).
const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const cheminPublic = (src) => path.join(frontendDir, 'public', src.replace(/^\//, ''));

const image = () => document.querySelector('img.cadre-image') || document.querySelector('img');

/** Dimensions réelles d'un JPEG, lues dans son en-tête (marqueur SOF). */
function dimensionsJpeg(chemin) {
  const octets = readFileSync(chemin);
  const sof = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf];
  let i = 2;
  while (i + 9 < octets.length) {
    if (octets[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marqueur = octets[i + 1];
    if (sof.includes(marqueur)) {
      return { hauteur: octets.readUInt16BE(i + 5), largeur: octets.readUInt16BE(i + 7) };
    }
    if (marqueur === 0xd8 || (marqueur >= 0xd0 && marqueur <= 0xd9)) {
      i += 2;
      continue;
    }
    i += 2 + octets.readUInt16BE(i + 2);
  }
  return null;
}

/** Remplace `window.Image` par un espion : le composant en crée pour PRÉCHARGER
 *  la photo suivante, et le `<img>` de React, lui, ne passe pas par là — ce que
 *  l'espion compte est donc exactement le préchargement. */
function espionnerLePrechargement() {
  const creees = [];
  const VraieImage = window.Image;
  window.Image = class ImageEspionnee {
    constructor() {
      creees.push(this);
    }

    set src(valeur) {
      this._src = valeur;
    }

    get src() {
      return this._src;
    }

    decode() {
      return Promise.resolve();
    }
  };
  return {
    creees,
    restaurer: () => {
      window.Image = VraieImage;
    },
  };
}

describe('la photo du héros (et son alternance)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('publie la PREMIÈRE photo, avec la boîte réservée par les dimensions réelles', () => {
    render(<PhotoDuHeros className="cadre-image" />);
    const img = image();
    expect(img.getAttribute('src')).toBe(PHOTOS_HEROS[0]);
    expect(img.getAttribute('width')).toBe(String(PHOTO_HEROS_LARGEUR));
    expect(img.getAttribute('height')).toBe(String(PHOTO_HEROS_HAUTEUR));
    expect(img.getAttribute('alt')).toBe('');
    expect(img.className).toBe('cadre-image');
    // La photo de tête est celle du LCP : elle part en priorité haute.
    expect(img.getAttribute('fetchpriority')).toBe('high');
    expect(img.getAttribute('decoding')).toBe('async');
  });

  it('tourne sur AU MOINS cinq photos, toutes uniques et toutes présentes', () => {
    // « au moins 5 pour la rotation » : c'est une demande du propriétaire du
    // site, donc une propriété du produit — pas un détail du dessin.
    expect(PHOTOS_HEROS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(PHOTOS_HEROS).size).toBe(PHOTOS_HEROS.length);
    for (const src of PHOTOS_HEROS) {
      expect(existsSync(cheminPublic(src)), `fichier absent : public${src}`).toBe(true);
    }
  });

  it('sert des fichiers au MÊME rapport que les dimensions déclarées — sinon l’alternance déplacerait la page', () => {
    // Le couple largeur/hauteur est UNIQUE pour toute la liste : c'est la
    // condition de l'alternance sans décalage. Les valeurs sont lues dans
    // l'en-tête de chaque JPEG, donc un fichier d'un autre rapport (ou une
    // constante qui ne décrirait plus les fichiers) fait rougir ce cas AVANT
    // d'atteindre le navigateur.
    for (const src of PHOTOS_HEROS) {
      const chemin = cheminPublic(src);
      if (!existsSync(chemin)) continue; // déjà refusé par le cas précédent
      expect(dimensionsJpeg(chemin), `en-tête JPEG illisible : ${src}`).toEqual({
        largeur: PHOTO_HEROS_LARGEUR,
        hauteur: PHOTO_HEROS_HAUTEUR,
      });
    }
    // Et le rapport déclaré est bien le 3/4 du cadre.
    expect(PHOTO_HEROS_HAUTEUR / PHOTO_HEROS_LARGEUR).toBeCloseTo(4 / 3, 6);
  });

  it('alterne au bout du délai, puis REVIENT à la première photo', () => {
    render(<PhotoDuHeros />);
    expect(image().getAttribute('src')).toBe(PHOTOS_HEROS[0]);
    // Un tour complet : chaque pas montre la photo suivante, et le dernier
    // ramène à la première (le modulo, et non un index qui déborde).
    for (let pas = 1; pas <= PHOTOS_HEROS.length; pas += 1) {
      act(() => {
        vi.advanceTimersByTime(PHOTO_HEROS_DELAI_MS);
      });
      expect(image().getAttribute('src')).toBe(PHOTOS_HEROS[pas % PHOTOS_HEROS.length]);
    }
  });

  it('remplace la SOURCE, jamais le nœud : c’est le même élément à chaque tour', () => {
    render(<PhotoDuHeros />);
    const avant = image();
    act(() => {
      vi.advanceTimersByTime(PHOTO_HEROS_DELAI_MS);
    });
    const apres = image();
    expect(apres).toBe(avant);
    // …et ses dimensions n'ont pas bougé : la boîte est stable sous l'alternance.
    expect(apres.getAttribute('width')).toBe(avant.getAttribute('width'));
    expect(apres.getAttribute('height')).toBe(avant.getAttribute('height'));
  });

  it('alterne aussi quand le système demande moins d’animation — décision écrite, pas oubli', () => {
    const matchMediaVrai = window.matchMedia;
    window.matchMedia = (requete) => ({
      matches: requete.includes('prefers-reduced-motion: reduce'),
      media: requete,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    try {
      render(<PhotoDuHeros />);
      act(() => {
        vi.advanceTimersByTime(PHOTO_HEROS_DELAI_MS);
      });
      expect(image().getAttribute('src')).toBe(PHOTOS_HEROS[1]);
    } finally {
      window.matchMedia = matchMediaVrai;
    }
  });

  it('démonte son minuteur avec le composant (aucune alternance orpheline)', () => {
    const { unmount } = render(<PhotoDuHeros />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelector('img')).toBe(null);
  });

  it('précharge LA SUIVANTE après le premier paint, jamais avant — et avance d’un cran', () => {
    const { creees, restaurer } = espionnerLePrechargement();
    try {
      render(<PhotoDuHeros />);
      // Au montage : rien. Le premier paint a l'image de tête pour lui seul.
      expect(creees).toHaveLength(0);
      // Puis, au temps mort (repli borné quand `requestIdleCallback` manque) :
      // la SEULE photo suivante — pas les six (le site sert l'Afrique de
      // l'Ouest, et personne n'a besoin de la cinquième photo dans la minute).
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(creees.map((im) => im.src)).toEqual([PHOTOS_HEROS[1]]);
      // Après le premier remplacement, le cran suivant se prépare de la même
      // façon : la liste peut grandir sans que le premier écran s'alourdisse.
      act(() => {
        vi.advanceTimersByTime(PHOTO_HEROS_DELAI_MS);
      });
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(creees.map((im) => im.src)).toEqual([PHOTOS_HEROS[1], PHOTOS_HEROS[2]]);
    } finally {
      restaurer();
    }
  });

  it('précharge pendant un temps mort quand le navigateur en a un', () => {
    // `requestIdleCallback` existe (Chrome) : c'est LUI le chemin, pas le repli
    // — et il est borné dans le temps, sinon un onglet occupé ne verrait jamais
    // la photo suivante.
    const rappels = [];
    const avant = window.requestIdleCallback;
    window.requestIdleCallback = (rappeler, options) => {
      rappels.push(options);
      rappeler();
      return 1;
    };
    const { creees, restaurer } = espionnerLePrechargement();
    try {
      render(<PhotoDuHeros />);
      expect(rappels).toEqual([{ timeout: 3000 }]);
      expect(creees.map((im) => im.src)).toEqual([PHOTOS_HEROS[1]]);
    } finally {
      restaurer();
      if (avant) window.requestIdleCallback = avant;
      else delete window.requestIdleCallback;
    }
  });
});
