import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PhotoDuHeros from '../PhotoDuHeros';
import {
  PHOTOS_HEROS,
  PHOTO_HEROS_DELAI_MS,
  PHOTO_HEROS_FORMATS,
  PHOTO_HEROS_HAUTEUR,
  PHOTO_HEROS_LARGEUR,
  PHOTO_HEROS_LARGEURS,
  PHOTO_HEROS_SIZES,
  VARIANTES_HEROS,
  srcsetHeros,
} from '../../config/photos-heros';
// Le libellé attendu n'est PAS recopié ici : il est lu dans le dictionnaire que
// le composant consomme (le français est le repli universel hors provider, cf.
// LanguageContext). Une locale qui repartirait en arrière rougirait donc ce
// fichier, et pas seulement la sonde de langue.
import fr from '../../i18n/fr.json';

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
//   8. LE CONTRÔLE DE PAUSE ARRÊTE VRAIMENT L'ALTERNANCE (WCAG 2.2.2). Une
//      alternance de plus de cinq secondes doit pouvoir être interrompue par
//      l'utilisateur : le bouton porte donc l'ÉTAT (`aria-pressed`) et l'ACTION
//      qui suit (le nom accessible), son dessin change avec l'état, et un appui
//      coupe réellement le minuteur — plusieurs tours d'horloge plus loin, la
//      source est la même ; un second appui la relance. Ce que ces cas NE
//      peuvent pas prouver (jsdom ne calcule aucune mise en page) est la
//      GÉOMÉTRIE : que le contrôle ne déplace rien et n'ajoute aucune candidate
//      LCP se mesure en navigateur, dans `e2e/heros-pause.spec.js`.
//   9. LE CONTRÔLE NE PUBLIE AUCUN TEXTE, et n'ajoute AUCUN `<img>` : un nom
//      accessible est un attribut, pas une phrase peinte, et l'élément LCP de
//      « / » doit rester l'unique image de la page. C'est le même contrat que
//      la règle 4, vu depuis le contrôle.
//  10. LES DEUX FORMATS SONT PUBLIÉS, DANS L'ORDRE DU CONFIG, avec leurs deux
//      largeurs, leur `sizes`, et un `<img>` JPEG en DERNIER recours : c'est ce
//      qui fait choisir au navigateur un fichier jusqu'à trois fois plus léger
//      que le JPEG. Ces cas prouvent la STRUCTURE du balisage ; les octets
//      réellement téléchargés se mesurent en navigateur
//      (`e2e/heros-format.spec.js`).
//  11. LE PRÉCHARGEMENT SUIT LE CHOIX DU NAVIGATEUR, ET ATTEND QU'IL CHOISISSE.
//      Précharger le JPEG quand le tour suivant servira l'AVIF ferait
//      télécharger deux fichiers pour une seule photo — pire qu'avant cette
//      passe. Le composant lit donc `currentSrc` (la variante réellement
//      choisie) et, tant qu'il est vide, n'anticipe RIEN : c'est le `load` de
//      l'image affichée qui déclenche le préchargement de la bonne variante.
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

/**
 * Simule la SÉLECTION du navigateur sur l'image affichée : `currentSrc` (la
 * variante réellement choisie) et `complete`. jsdom ne charge aucune image,
 * donc sans ce geste le composant — qui ATTEND la sélection pour précharger la
 * bonne variante, plutôt que de deviner un format — semblerait ne rien
 * précharger du tout.
 */
function simulerSelection(url) {
  const img = image();
  Object.defineProperty(img, 'currentSrc', { value: url, configurable: true });
  Object.defineProperty(img, 'complete', { value: true, configurable: true });
  return img;
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
    // `decoding="sync"` depuis le 07/10/2026, et ce n'est PAS un détail de
    // réglage : en décodage asynchrone, l'image se peint une TRAME après le
    // texte du héros, Chrome ré-élit un second élément LCP plus tardif, et la
    // sonde `e2e/lcp-geometrie.spec.js` compte deux candidates au lieu d'une
    // (mesuré sur Chromium, 412×823, CPU limité par CDP). Le préchargement posé
    // dans le `<head>` par vite-plugins/prerender-route-meta.js est l'autre
    // moitié du remède ; le refus de cette paire est tenu par
    // scripts/__tests__/check-home-hero-lcp.test.js.
    expect(img.getAttribute('decoding')).toBe('sync');
  });

  it('tourne sur AU MOINS cinq photos, toutes uniques et toutes présentes', () => {
    // « au moins 5 pour la rotation » : c'est une demande du propriétaire du
    // site, donc une propriété du produit — pas un détail du dessin.
    expect(PHOTOS_HEROS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(PHOTOS_HEROS).size).toBe(PHOTOS_HEROS.length);
    for (const src of PHOTOS_HEROS) {
      expect(existsSync(cheminPublic(src)), `fichier absent : public${src}`).toBe(true);
    }
    // ET LES 24 VARIANTES EXISTENT. C'est le contrôle le moins cher du même
    // défaut : une faute de frappe dans un chemin CONSTRUIT ne rougirait nulle
    // part ailleurs — le navigateur ne choisit que parmi les candidats
    // existants, donc une variante absente se traduirait par un repli silencieux
    // sur un fichier plus lourd, jamais par une image manquante.
    for (const [index, variantes] of VARIANTES_HEROS.entries()) {
      for (const format of PHOTO_HEROS_FORMATS) {
        for (const largeur of PHOTO_HEROS_LARGEURS) {
          const chemin = variantes[format][largeur];
          expect(existsSync(cheminPublic(chemin)), `variante absente : public${chemin} (photo ${index})`).toBe(true);
        }
      }
    }
  });

  it('publie les DEUX formats en <source>, dans l’ordre du config, avec leurs srcset et leur sizes', () => {
    render(<PhotoDuHeros className="cadre-image" />);
    const picture = document.querySelector('picture');
    expect(picture).not.toBe(null);
    const sources = [...picture.querySelectorAll('source')];
    // L'ORDRE est celui de `PHOTO_HEROS_FORMATS` : l'AVIF d'abord. L'inverser
    // ferait télécharger le WebP (le plus lourd des deux) à tous les navigateurs
    // qui savent lire l'AVIF.
    expect(sources.map((source) => source.getAttribute('type'))).toEqual(
      PHOTO_HEROS_FORMATS.map((format) => `image/${format}`)
    );
    expect(sources[0].getAttribute('srcset')).toBe(srcsetHeros(0, 'avif'));
    expect(sources[1].getAttribute('srcset')).toBe(srcsetHeros(0, 'webp'));
    // Chaque `srcset` porte les DEUX largeurs, avec leur descripteur : c'est ce
    // qui autorise le navigateur à choisir autre chose que la source entière
    // (un écran à densité 1 n'a pas besoin de 720 px).
    for (const source of sources) {
      expect(source.getAttribute('sizes')).toBe(PHOTO_HEROS_SIZES);
      expect(
        (source.getAttribute('srcset') || '').split(',').map((candidat) => candidat.trim().split(' ')[1])
      ).toEqual(['480w', '720w']);
    }
    // L'`<img>` est le DERNIER enfant du `<picture>` : c'est le repli, et le
    // SEUL nœud image de la page — l'élément LCP reste unique.
    expect(picture.lastElementChild.tagName).toBe('IMG');
    expect(picture.lastElementChild.getAttribute('src')).toBe(PHOTOS_HEROS[0]);
    expect(document.querySelectorAll('img')).toHaveLength(1);
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

  it('précharge LA SUIVANTE après le premier paint, DANS LA VARIANTE que le navigateur a choisie', () => {
    const { creees, restaurer } = espionnerLePrechargement();
    try {
      render(<PhotoDuHeros />);
      // Au montage : rien. Le premier paint a l'image de tête pour lui seul.
      expect(creees).toHaveLength(0);
      // Tant que le navigateur n'a rien choisi, RIEN n'est parti : le temps mort
      // arrive avant la sélection (jsdom ne charge aucune image, donc c'est
      // aussi le cas réel d'une liaison lente).
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(creees).toHaveLength(0);
      // Le navigateur a choisi la variante 480 en AVIF : c'est ELLE que la photo
      // suivante précharge — ni le JPEG (un fichier de trop), ni une autre
      // largeur, ni l'autre format.
      simulerSelection(VARIANTES_HEROS[0].avif[480]);
      act(() => {
        fireEvent.load(image());
      });
      expect(creees.map((im) => im.src)).toEqual([VARIANTES_HEROS[1].avif[480]]);
      // Après le premier remplacement, le cran suivant se prépare de la même
      // façon — et la variante SUIT le choix, elle ne le fige pas.
      simulerSelection(VARIANTES_HEROS[1].webp[720]);
      act(() => {
        vi.advanceTimersByTime(PHOTO_HEROS_DELAI_MS);
      });
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(creees.map((im) => im.src)).toEqual([VARIANTES_HEROS[1].avif[480], VARIANTES_HEROS[2].webp[720]]);
    } finally {
      restaurer();
    }
  });

  it('ne précharge RIEN tant que le navigateur n’a pas choisi — et repart à son `load`', () => {
    // LE CONTRAT QUI ÉVITE LE DOUBLE TÉLÉCHARGEMENT : sans `currentSrc`, le
    // format de la photo suivante est INCONNU. Précharger le JPEG « faute de
    // mieux » ferait télécharger deux fichiers pour une seule photo — plus
    // qu'avant cette passe. On attend donc la sélection, qui arrive avec le
    // `load` de l'image affichée.
    const { creees, restaurer } = espionnerLePrechargement();
    try {
      render(<PhotoDuHeros />);
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(creees.map((im) => im.src)).toEqual([]);
      simulerSelection(VARIANTES_HEROS[0].webp[720]);
      act(() => {
        fireEvent.load(image());
      });
      expect(creees.map((im) => im.src)).toEqual([VARIANTES_HEROS[1].webp[720]]);
    } finally {
      restaurer();
    }
  });

  it('publie un contrôle de pause NOMMÉ, sans texte peint et sans seconde image', () => {
    render(<PhotoDuHeros className="cadre-image" />);
    const bouton = document.querySelector('button.heros-controle');
    expect(bouton).not.toBe(null);
    // L'état initial : l'alternance tourne, donc le contrôle propose la PAUSE.
    expect(bouton.getAttribute('aria-pressed')).toBe('false');
    expect(bouton.getAttribute('aria-label')).toBe(fr.heroRotationPause);
    // « Visible » au sens du critère : le libellé est un nom accessible, mais
    // AUCUN texte n'est peint — un texte publié appartiendrait au dictionnaire
    // des deux canaux et à la sonde de texte des coquilles.
    expect(bouton.textContent.trim()).toBe('');
    // Et le contrôle n'est pas une image : l'élément LCP de « / » reste unique.
    expect(document.querySelectorAll('img')).toHaveLength(1);
  });

  it('la pause ARRÊTE l’alternance sur plusieurs tours, et la reprise la relance', () => {
    render(<PhotoDuHeros className="cadre-image" />);
    const bouton = document.querySelector('button.heros-controle');
    const source = () => image().getAttribute('src');

    // Un appui : l'état bascule, et l'action annoncée devient la REPRISE.
    act(() => {
      fireEvent.click(bouton);
    });
    expect(bouton.getAttribute('aria-pressed')).toBe('true');
    expect(bouton.getAttribute('aria-label')).toBe(fr.heroRotationResume);
    // Trois tours d'horloge plus loin, la source n'a pas bougé : ce n'est pas
    // « un tour de retard », c'est le minuteur qui n'existe plus.
    const enPause = source();
    act(() => {
      vi.advanceTimersByTime(PHOTO_HEROS_DELAI_MS * 3);
    });
    expect(source()).toBe(enPause);

    // Second appui : l'alternance repart, du cran suivant (elle n'a pas été
    // remise à la première photo — la pause interrompt, elle ne réinitialise pas).
    act(() => {
      fireEvent.click(bouton);
    });
    expect(bouton.getAttribute('aria-pressed')).toBe('false');
    expect(bouton.getAttribute('aria-label')).toBe(fr.heroRotationPause);
    act(() => {
      vi.advanceTimersByTime(PHOTO_HEROS_DELAI_MS);
    });
    expect(source()).not.toBe(enPause);
  });

  it('le dessin du contrôle dit l’état : les barres de pause, puis la flèche de lecture', () => {
    render(<PhotoDuHeros className="cadre-image" />);
    const bouton = document.querySelector('button.heros-controle');
    // Deux rectangles (les barres) à l'arrêt, une flèche (un chemin) en pause.
    expect(bouton.querySelectorAll('rect')).toHaveLength(2);
    expect(bouton.querySelectorAll('path')).toHaveLength(0);
    act(() => {
      fireEvent.click(bouton);
    });
    expect(bouton.querySelectorAll('rect')).toHaveLength(0);
    expect(bouton.querySelectorAll('path')).toHaveLength(1);
    // Le dessin est décoratif : il ne double pas le nom accessible.
    for (const dessin of bouton.querySelectorAll('svg')) {
      expect(dessin.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('en pause, il ne précharge RIEN de plus (la « suivante » n’a plus de sens)', () => {
    const { creees, restaurer } = espionnerLePrechargement();
    try {
      render(<PhotoDuHeros />);
      act(() => {
        fireEvent.click(document.querySelector('button.heros-controle'));
      });
      act(() => {
        vi.advanceTimersByTime(PHOTO_HEROS_DELAI_MS + 3000);
      });
      expect(creees.map((im) => im.src)).toEqual([]);
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
      // Le rappel est synchrone dans ce cas (stub) : il tombe AVANT la
      // sélection, donc rien ne part — c'est le contrat, pas un oubli.
      expect(creees).toHaveLength(0);
      // Le REPLI JPEG reste atteignable : c'est ce que le navigateur a choisi
      // quand il ne connaît ni l'AVIF ni le WebP.
      simulerSelection(VARIANTES_HEROS[0].jpeg);
      act(() => {
        fireEvent.load(image());
      });
      expect(creees.map((im) => im.src)).toEqual([VARIANTES_HEROS[1].jpeg]);
    } finally {
      restaurer();
      if (avant) window.requestIdleCallback = avant;
      else delete window.requestIdleCallback;
    }
  });
});
