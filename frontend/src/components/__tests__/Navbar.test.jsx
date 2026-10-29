/**
 * LA BARRE DE NAVIGATION SE LIT SUR LE VERRE, AU REPOS COMME AU SURVOL.
 *
 * ── Le défaut que ce fichier ferme ─────────────────────────────────────────
 * Les entrées de la barre changeaient de teinte au survol vers `orange-600`
 * (`#ea580c`). Sur une barre BLANCHE, cela passerait ; la nôtre est une VITRE
 * (`.verre-barre` : `rgba(253, 250, 244, 0.78)` + flou), donc la surface qu'un
 * lien peint dépend de ce qui défile derrière. Mesuré sur les deux fonds de
 * référence que `scripts/verre-contraste.js` emploie déjà pour une vitre :
 * **3,36:1** sur le verre posé sur le sable, **2,15:1** sur le pire cas (un
 * contenu sombre sous la barre) — sous le 4,5:1 du texte courant, pour TOUTES
 * les entrées de la barre : les quatre liens de bureau, les deux liens
 * d'en-tête (« Connexion » / « Profil »), le hamburger et les entrées des deux
 * tiroirs mobiles.
 *
 * ── Ce qui est mesuré, et sur quelle surface ────────────────────────────────
 * Le composite du verre est CALCULÉ depuis la feuille, sur deux fonds de
 * référence :
 *   • le SABLE de l'application (`--kojo-sable`) — ce que la barre montre quand
 *     la page défile en haut d'une section claire ;
 *   • l'ENCRE du site (`--kojo-encre`) — le PIRE cas plausible, celui qu'une
 *     vitre doit tenir (même arbitrage que `verre-contraste.js` : « un fond
 *     clair n'est pas le pire cas d'une vitre »).
 * Un lien qui ne tient que sur le premier ne passe pas : c'est la plus
 * défavorable des deux qui décide.
 *
 * Le tiroir mobile est un cas DIFFÉRENT : ses entrées peignent elles-mêmes
 * `hover:bg-orange-50`, une surface OPAQUE. Leur encre de survol est donc jugée
 * sur `#fff7ed`, et non sur le verre — mesurer contre le verre aurait certifié
 * un fond que le survol ne laisse pas voir.
 *
 * ── Ce que ce fichier ne prouve pas ────────────────────────────────────────
 * Aucune géométrie (hauteur de barre, rupture mobile) : c'est
 * `e2e/barres-rupture.spec.js`. Il ne mesure pas non plus le texte des menus
 * déroulants qui ne sont pas ouverts ici (langue, notifications) : ils ont
 * leurs propres composants et leurs propres mesures. Les boutons PLEINS du
 * reste du site sont jugés par `src/__tests__/boutons-pleins.test.js`, qui
 * balaie tout `src/`.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Navbar from '../Navbar';
import { contrasteEntre, SEUIL_GRAPHIQUE, SEUIL_TEXTE } from '../../../scripts/contraste-jetons.js';

// Le dictionnaire FRANÇAIS réel : les libellés lus sont ceux que la page
// publie, et les repères du test (ouvrir le menu) passent par ses clés.
vi.mock('../../contexts/LanguageContext', async (importOriginal) => {
  const actual = await importOriginal();
  const { default: fr } = await vi.importActual('../../i18n/fr.json');
  return {
    ...actual,
    useLanguage: () => ({
      currentLanguage: 'fr',
      changeLanguage: vi.fn(),
      t: (cle) => fr[cle] ?? cle,
    }),
  };
});

// `user` est mutable : le même fichier mesure les deux barres (visiteur et
// connecté), et une doublure figée n'en peindrait qu'une.
let utilisateur = null;
// `loading`/`sessionProbable` sont muables pour la même raison : la barre peint
// TROIS états (visiteur, session attendue, connecté), pas deux.
let etatSession = { loading: false, sessionProbable: false };
vi.mock('../../contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAuth: () => ({
      user: utilisateur,
      ...etatSession,
      logout: vi.fn(),
      login: vi.fn(),
      loginWithGoogle: vi.fn(),
    }),
  };
});

// La cloche interroge le centre de notifications : hors du sujet ici, mais elle
// est PEINTE dans la barre, et c'est son icône qu'on mesure côté connecté.
vi.mock('../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0, isOpen: false, togglePanel: vi.fn() }),
}));

const CSS = fs.readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8');

/** Une valeur hexadécimale d'un jeton de la feuille — refus nommé si absente. */
const jeton = (nom) => {
  const trouve = CSS.match(new RegExp(`${nom}:\\s*(#[0-9a-fA-F]{6})`));
  if (!trouve) throw new Error(`jeton ${nom} introuvable dans src/index.css : la mesure refuse de conclure`);
  return trouve[1];
};

const versRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const versHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** Le composite d'une couleur translucide sur un fond opaque. */
const composer = ([r, g, b, a], fond) =>
  versHex([r, g, b].map((canal, i) => canal * a + fond[i] * (1 - a)));

/** Le fond de `.verre-barre`, en `[r, g, b, a]` — la vitre, telle qu'elle est peinte. */
const fondDuVerre = () => {
  const regle = CSS.match(/\.verre-barre[\s\S]{0,400}?background-color:\s*rgba\(([^)]+)\)/);
  if (!regle) {
    throw new Error(
      '`.verre-barre` ne déclare plus un fond rgba : la barre n’est plus la vitre que ce fichier ' +
        'mesure, et la mesure refuse de conclure sur une surface qu’elle ne connaît pas'
    );
  }
  return regle[1].split(',').map((valeur) => Number(valeur.trim()));
};

const SABLE = jeton('--kojo-sable');
const ENCRE = jeton('--kojo-encre');
const VERRE_SUR_SABLE = composer(fondDuVerre(), versRgb(SABLE));
const VERRE_SUR_ENCRE = composer(fondDuVerre(), versRgb(ENCRE));
/** Les deux surfaces d'un texte posé sur la barre : la plus défavorable décide. */
const SURFACES_DU_VERRE = [VERRE_SUR_SABLE, VERRE_SUR_ENCRE];

/**
 * Les teintes Tailwind que la barre emploie, et leur valeur.
 *
 * Deux tables séparées, et c'est délibéré : une classe `bg-…` lue comme une
 * encre mesurerait le fond contre lui-même (1:1) et le test passerait au vert
 * en comparant une couleur à elle-même.
 */
const ENCRES = {
  'text-gray-700': '#374151',
  'text-stone-700': '#44403c',
  // `orange-600` est la teinte de survol que la barre portait AVANT le
  // 26/10/2026 : elle reste dans la table pour que la régression qui y
  // reviendrait soit MESURÉE (« 3.36:1, sous le seuil ») et non pas refusée
  // comme une teinte inconnue — un refus dit qu'on ne sait pas, pas de combien
  // on échoue.
  'text-orange-600': '#ea580c',
  'text-orange-700': '#c2410c',
  'text-orange-800': '#9a3412',
  'text-orange-900': '#7c2d12',
  'text-white': '#ffffff',
};

/**
 * Les fonds OPAQUES peints par la barre, rangés par leur teinte (`bg-…` / `hover:bg-…`).
 *
 * Les deux teintes de la RÉGRESSION (`orange-500`, `orange-600`) restent dans la
 * table : c'est le fond que la barre peignait avant le 26/10/2026, et un retour
 * en arrière doit être MESURÉ (blanc sur `orange-600` = 3,56:1, l'échec nommé
 * avec son rapport) au lieu d'être refusé comme « fond inconnu » — un refus dit
 * qu'on ne sait pas, pas de combien on échoue. Même règle que pour l'encre de
 * survol, un peu plus haut.
 */
const FONDS = {
  'orange-50': '#fff7ed',
  'orange-500': '#f97316',
  'orange-600': '#ea580c',
  'orange-700': '#c2410c',
  'orange-800': '#9a3412',
};

const classes = (element) => String(element.className || '').split(/\s+/);

/** L'encre d'un élément, lue sur sa classe `text-…` — refus nommé si elle est inconnue. */
const encreDe = (element, ou) => {
  const teinte = classes(element).find((classe) => Object.hasOwn(ENCRES, classe));
  if (!teinte) {
    throw new Error(
      `${ou} : aucune encre connue sur « ${classes(element).join(' ')} » — la mesure refuse de ` +
        'conclure (ajouter la teinte à ENCRES, dans ce fichier, après l’avoir mesurée)'
    );
  }
  return { teinte, valeur: ENCRES[teinte] };
};

/** L'encre de SURVOL (`hover:text-…`), ou `null` si l'élément n'en déclare pas. */
const encreAuSurvol = (element, ou) => {
  const classe = classes(element).find((nom) => nom.startsWith('hover:text-'));
  if (!classe) return null;
  const nom = classe.slice('hover:'.length);
  if (!Object.hasOwn(ENCRES, nom)) {
    throw new Error(`${ou} : encre de survol « ${nom} » inconnue — la mesure refuse de conclure`);
  }
  return { classe, teinte: nom, valeur: ENCRES[nom] };
};

/**
 * Un fond OPAQUE peint par l'élément, ou `null`.
 *
 * `prefixe` vaut `bg-` au repos et `hover:bg-` au survol : la teinte se lit
 * APRÈS le préfixe, dans une seule table. Une teinte inconnue est un refus
 * nommé — le jour où la barre adoptera une couleur que ce fichier ne connaît
 * pas, la mesure le dira au lieu de la comparer à elle-même.
 */
const fondPeint = (element, prefixe, ou) => {
  const classe = classes(element).find((nom) => nom.startsWith(prefixe));
  if (!classe) return null;
  const teinte = classe.slice(prefixe.length);
  if (!Object.hasOwn(FONDS, teinte)) {
    throw new Error(`${ou} : fond « ${classe} » inconnu — la mesure refuse de conclure`);
  }
  return FONDS[teinte];
};

/** Le fond de SURVOL (`hover:bg-…`), ou `null` — un fond opaque remplace la vitre. */
const fondAuSurvol = (element, ou) => fondPeint(element, 'hover:bg-', ou);

/** Le pire des deux composites : c'est lui qui décide. */
const pireSurLeVerre = (encre) =>
  SURFACES_DU_VERRE.reduce(
    (pire, surface) => Math.min(pire, contrasteEntre(encre.valeur, surface)),
    Number.POSITIVE_INFINITY
  );

const SURFACE_VERRE = `le verre de la barre (${VERRE_SUR_SABLE} sur sable, ${VERRE_SUR_ENCRE} sur encre)`;

const exiger = ({ ou, encre, seuil, ratio, surface }) => {
  expect(
    ratio,
    `${ou} en ${encre.teinte} : ${ratio.toFixed(2)}:1 sur ${surface}, sous le seuil ${seuil}:1 ` +
      `(${seuil === SEUIL_TEXTE ? 'WCAG 1.4.3' : 'WCAG 1.4.11'})`
  ).toBeGreaterThanOrEqual(seuil);
};

const monter = (user) => {
  utilisateur = user;
  const { container } = render(
    <MemoryRouter initialEntries={['/']}>
      <Navbar />
    </MemoryRouter>
  );
  const nav = container.querySelector('nav');
  expect(nav, 'la barre n’est pas rendue : la mesure n’a rien à juger').not.toBeNull();
  return nav;
};

afterEach(() => {
  cleanup();
  utilisateur = null;
  etatSession = { loading: false, sessionProbable: false };
});

/** Les entrées de BUREAU : la variante qui porte le filet de 2 px. */
const liensDeBureau = (nav) =>
  Array.from(nav.querySelectorAll('a[href]')).filter((lien) =>
    classes(lien).includes('border-b-2')
  );

/** Les entrées du TIROIR mobile (il n'existe qu'ouvert). */
const liensDuTiroir = (nav) =>
  Array.from(nav.querySelectorAll('#mobile_menu a[href]'));

/**
 * Le hamburger : un bouton qui publie son état ouvert/fermé et n'ouvre AUCUN
 * menu pré-ancré (`aria-haspopup` est le signe du contraire — la cloche et le
 * sélecteur de langue le portent, pas lui). Le désigner par `aria-label`
 * serait recopier un libellé traduit ; ce filtre-là dit ce qu'il EST.
 */
const hamburger = (nav) => {
  const trouves = Array.from(nav.querySelectorAll('button[aria-expanded]')).filter(
    (bouton) => !bouton.hasAttribute('aria-haspopup')
  );
  expect(
    trouves.length,
    `la barre porte ${trouves.length} bouton(s) de tiroir au lieu d’un : le hamburger est introuvable sans ambiguïté`
  ).toBe(1);
  return trouves[0];
};

const ouvrirLeTiroir = (nav) => {
  const bouton = hamburger(nav);
  fireEvent.click(bouton);
  expect(
    nav.querySelector('#mobile_menu'),
    'le tiroir mobile ne s’ouvre pas : la mesure des entrées mobiles n’a rien à juger'
  ).not.toBeNull();
};

/**
 * Mesure un élément au repos, puis au survol.
 *
 * Les deux états n'ont pas forcément la même surface, et c'est le sens de ce
 * fichier :
 *   • au repos, une entrée de bureau est posée sur la VITRE — sauf l'entrée
 *     active, qui peint `bg-orange-50`, un fond OPAQUE ;
 *   • au survol, tant que la teinte de texte change, le fond change aussi
 *     (`hover:bg-orange-50` dans le tiroir, sur la cloche) : c'est ce fond-là
 *     qui est mesuré, jamais la vitre qu'il recouvre.
 */
const mesurerSurLeVerre = (element, seuil = SEUIL_TEXTE, nom) => {
  const ou = nom
    || `« ${(element.textContent || '').replace(/\s+/g, ' ').trim()} » (${element.getAttribute('href')})`;

  const encre = encreDe(element, ou);
  const fond = fondPeint(element, 'bg-', ou);
  if (fond) {
    exiger({
      ou: `${ou} (fond opaque)`,
      encre,
      seuil,
      ratio: contrasteEntre(encre.valeur, fond),
      surface: `le fond qu’il peint lui-même (${fond})`,
    });
  } else {
    exiger({ ou, encre, seuil, ratio: pireSurLeVerre(encre), surface: SURFACE_VERRE });
  }

  const survol = encreAuSurvol(element, ou);
  // Un élément sans état de survol déclaré n'a pas de second état à juger.
  if (!survol) return;

  const fondDeSurvol = fondPeint(element, 'hover:bg-', ou);
  exiger({
    ou: `${ou} au survol`,
    encre: survol,
    seuil,
    ratio: fondDeSurvol
      ? contrasteEntre(survol.valeur, fondDeSurvol)
      : pireSurLeVerre(survol),
    surface: fondDeSurvol ? `le fond de survol de l’élément (${fondDeSurvol})` : SURFACE_VERRE,
  });
};

describe('navbar — lisibilité sur le verre', () => {
  it('les entrées de bureau d’un VISITEUR tiennent 4,5:1 au repos et au survol', () => {
    const nav = monter(null);

    const liens = liensDeBureau(nav);
    expect(
      liens.length,
      `la barre ne peint que ${liens.length} entrée(s) publique(s) — la navigation publique a été amputée`
    ).toBeGreaterThanOrEqual(4);

    for (const lien of liens) mesurerSurLeVerre(lien);

    // Le lien « Connexion » n'est pas un `LienDesktop` : il vit dans l'autre
    // groupe de la barre, et il portait la même teinte de survol.
    const connexion = nav.querySelector('a[href="/login"]');
    expect(connexion, 'le lien de connexion n’est plus dans la barre').not.toBeNull();
    mesurerSurLeVerre(connexion);

    // Le hamburger ouvre le tiroir : son tracé relève de 1.4.11, pas du texte.
    mesurerSurLeVerre(hamburger(nav), SEUIL_GRAPHIQUE, 'le hamburger');
  });

  it('les entrées de bureau d’un compte CONNECTÉ tiennent 4,5:1, icônes comprises', () => {
    const nav = monter({ id: 'u1', email: 'a@b.c', email_verified: true });

    const liens = liensDeBureau(nav);
    expect(
      liens.length,
      `la barre connectée ne peint que ${liens.length} entrée(s) — elle en porte quatre`
    ).toBeGreaterThanOrEqual(4);
    for (const lien of liens) mesurerSurLeVerre(lien);

    const profil = nav.querySelector('a[href="/profile"]');
    expect(profil, 'le lien de profil n’est plus dans la barre').not.toBeNull();
    mesurerSurLeVerre(profil);

    // Les ICÔNES relèvent de 1.4.11 (3:1) : elles ne portent pas d'information
    // écrite, mais doivent rester distinguables sur la vitre.
    const cloche = nav.querySelector('button[aria-haspopup]');
    expect(cloche, 'la cloche n’est plus dans la barre d’un compte connecté').not.toBeNull();
    mesurerSurLeVerre(cloche, SEUIL_GRAPHIQUE, 'la cloche');
  });

  // Les deux tiroirs sont mesurés : celui d'un visiteur (les entrées publiques)
  // et celui d'un compte connecté (le sien, plus court mais plus utilisé).
  //
  // L'APPEL À L'ACTION n'est plus écarté (26/10/2026) : son fond plein est passé
  // de `orange-600` à `orange-700`, donc blanc sur ce fond vaut 5,18:1 et il
  // entre dans la mesure comme les autres. Un bouton qu'on n'avait le droit de
  // mesurer que pour dire qu'il échouait est un bouton qu'on finit par oublier.
  it.each([
    ['un VISITEUR', null, 7],
    ['un compte CONNECTÉ', { id: 'u1', email: 'a@b.c', email_verified: true }, 5],
  ])('les entrées du TIROIR mobile d’%s tiennent 4,5:1, sur leur fond', (_cas, compte, plancher) => {
    const nav = monter(compte);
    ouvrirLeTiroir(nav);

    const liens = liensDuTiroir(nav);
    expect(
      liens.length,
      `le tiroir mobile ne peint que ${liens.length} entrée(s) — il en porte ${plancher} ou plus`
    ).toBeGreaterThanOrEqual(plancher);

    for (const lien of liens) {
      const ou = `« ${lien.textContent.replace(/\s+/g, ' ').trim()} » (${lien.getAttribute('href')})`;
      // Le tiroir pose `hover:bg-orange-50` : `mesurerSurLeVerre` juge donc le
      // survol sur ce fond OPAQUE, et le repos sur la vitre.
      mesurerSurLeVerre(lien, SEUIL_TEXTE, ou);
      const fond = fondAuSurvol(lien, ou);
      if (encreAuSurvol(lien, ou)) {
        expect(
          fond,
          `${ou} déclare une encre de survol SANS fond de survol : la mesure ne sait pas sur quoi elle est posée`
        ).toBeTruthy();
      }
    }
  });
});

/**
 * ── LA BARRE NE SE DÉPLACE PAS QUAND LA SESSION ARRIVE (29/10/2026) ────────
 *
 * Le défaut mesuré à la sonde des cadres (1350×940, artefact servi, compte
 * travailleur) : la barre peignait d'abord les deux groupes d'un VISITEUR, puis
 * les remplaçait par ceux d'un utilisateur connecté quand `/auth/me` répondait.
 * Relevé à t=129,3 ms — les deux groupes se déplaçaient d'un coup :
 *
 *   • navigation : 588 → 451 px, de x=216,3 à x=264,7 ;
 *   • commandes : 365,3 → 405,7 px, de x=917,7 à x=877,3.
 *
 * CLS 0,0039, et c'était la TOTALITÉ de ce qui restait sur /payment une fois son
 * cadre réglé. Le remède : pendant l'amorçage d'une session PROBABLE (trace
 * locale, `sessionProbable` d'AuthContext), la barre peint la disposition
 * connectée `invisible` — elle occupe sa place sans se peindre, donc l'arrivée du
 * profil ne fait que la révéler.
 *
 * Ce que ces cas tiennent, et pourquoi ils comparent une SIGNATURE plutôt qu'une
 * classe : la propriété qui empêche le déplacement est que les deux peintures
 * portent les MÊMES commandes, dans le même ordre. Un libellé ajouté d'un côté
 * seulement ferait rougir le cas même si la classe `invisible` était là.
 */
describe('navbar — la disposition de la session est réservée', () => {
  /** Les quatre groupes de la rangée, dans l’ordre du DOM. */
  const groupes = (nav) => Array.from(nav.querySelector(':scope > div > div').children);

  /** Ce que chaque groupe COMMANDE (tag + nom accessible ou texte), groupe par groupe. */
  const signature = (nav) =>
    groupes(nav).map((groupe) =>
      Array.from(groupe.querySelectorAll('a, button'))
        .map((el) => `${el.tagName}:${(el.textContent || el.getAttribute('aria-label') || '').trim()}`)
        .join('|')
    );

  /** Les groupes masqués pendant la réserve — la classe que la barre pose. */
  const groupesMasques = (nav) => Array.from(nav.querySelectorAll('.invisible'));

  it('pendant l’amorçage, la barre porte les commandes d’un compte — sans les peindre', () => {
    etatSession = { loading: true, sessionProbable: true };
    const nav = monter(null);

    // L’état VISITEUR ne doit pas être peint : c’est son remplacement qui
    // déplaçait les deux groupes.
    expect(
      nav.querySelector('a[href="/login"]'),
      'la barre peint encore « Connexion » alors qu’une session est attendue : c’est le remplacement qui déplace les groupes'
    ).toBeNull();

    const reserves = groupesMasques(nav);
    expect(
      reserves.length,
      `la barre réserve ${reserves.length} groupe(s) au lieu de deux : les deux groupes qui changent avec la session doivent occuper leur place sans se peindre`
    ).toBe(2);
    for (const groupe of reserves) {
      expect(
        groupe.getAttribute('aria-hidden'),
        'un groupe réservé n’est pas retiré de l’arbre d’accessibilité : il annoncerait une session qui n’est pas encore prouvée'
      ).toBe('true');
    }
  });

  it('la disposition réservée est EXACTEMENT celle d’un compte connecté', () => {
    etatSession = { loading: true, sessionProbable: true };
    const reservee = signature(monter(null));
    cleanup();

    etatSession = { loading: false, sessionProbable: false };
    const connectee = signature(monter({ id: 'u1', email: 'a@b.c', email_verified: true }));

    expect(
      reservee,
      'la barre réservée et la barre connectée ne portent pas les mêmes commandes : la révélation déplacerait les groupes'
    ).toEqual(connectee);
    // Et une fois le profil arrivé, plus rien n’est masqué.
    const nav = monter({ id: 'u1', email: 'a@b.c', email_verified: true });
    expect(groupesMasques(nav).length, 'la barre garde un groupe masqué une fois le profil arrivé').toBe(0);
  });

  it('un visiteur SANS trace ne réserve rien : la barre publique est peinte tout de suite', () => {
    // `sessionProbable` est faux dès le premier rendu pour un visiteur sans
    // trace (AuthContext le dérive de `loading && hasSessionTrace()`), donc le
    // cas où la réservation ne doit PAS avoir lieu.
    etatSession = { loading: true, sessionProbable: false };
    const nav = monter(null);

    expect(
      nav.querySelector('a[href="/login"]'),
      'la barre a perdu « Connexion » pour un visiteur sans trace : le remède a été appliqué à tout le monde'
    ).not.toBeNull();
    expect(groupesMasques(nav).length, 'la barre masque un groupe pour un visiteur sans trace').toBe(0);
  });
});
