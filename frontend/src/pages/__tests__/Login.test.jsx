/**
 * /login — LE SÉPARATEUR « ou » TIENT 4,5:1 SUR LA SURFACE QU'IL PEINT.
 *
 * ── La classe de défaut que ce fichier ferme ────────────────────────────────
 * Le même séparateur vivait en `gray-400` sur les deux pages de compte :
 * **2,54:1** sur blanc, sous le seuil WCAG 1.4.3 du texte courant. Lighthouse
 * mobile l'a mesuré sur `/register` le 26/10/2026 (`color-contrast`) ; la
 * correction a changé la teinte sur les DEUX pages, mais seul `/register` a
 * reçu un garde. `Login.test.jsx` n'existait pas : la page de CONNEXION — celle
 * que traverse chaque visiteur qui revient — n'avait aucune mesure, et une
 * retouche de teinte y serait passée sans que rien ne rougisse.
 *
 * ── Pourquoi la mesure porte sur DEUX surfaces ──────────────────────────────
 * Le séparateur peint sa propre pastille (`bg-white`) pour couper le filet qui
 * passe derrière le mot. Cette pastille est posée sur la CARTE du formulaire
 * (`.carte-editoriale`, `rgba(252, 249, 242, 0.94)` — donc un composite sur le
 * sable, pas un blanc pur, depuis que `/login` a une carte le 17/10/2026).
 * Un test qui ne mesurerait que le blanc pur certifierait la teinte sur une
 * surface que la page ne peint pas : le rapport est donc calculé sur les DEUX
 * — la pastille et la carte —, et c'est la plus défavorable qui décide.
 *
 * ── LA MESURE NE S'ARRÊTE PLUS AU SÉPARATEUR (26/10/2026) ───────────────────
 * Trois textes décident de la lisibilité du formulaire, et aucun n'était mesuré :
 * les LIBELLÉS des deux champs, le lien « mot de passe oublié » (le seul recours
 * d'une personne qui n'entre plus) et l'ENCART LÉGAL, qui porte la notice, le
 * lien des conditions et la ligne de contact. Chacun est jugé sur la surface
 * qu'il peint RÉELLEMENT : la carte composite pour les deux premiers, et le
 * SABLE pour l'encart — `.encart` déclare `background-color: var(--kojo-sable)`,
 * il ne laisse donc pas voir la carte derrière lui. C'est cette distinction qui
 * a trouvé le défaut : le SURVOL des liens orange était en `orange-600`
 * (#ea580c), **3,39:1** sur la carte, sous le seuil — la teinte a été corrigée
 * dans le plan (`hover:text-orange-800`, 6,95:1), et le survol est désormais
 * mesuré, pas seulement l'état au repos.
 *
 * ── Ce que ce fichier ne prouve pas ─────────────────────────────────────────
 * La géométrie du séparateur (sondes e2e), ni la connexion elle-même (OTP,
 * Google) : il mesure la LISIBILITÉ d'un texte publié, avec l'arithmétique
 * WCAG du site (`scripts/contraste-jetons.js`), pas une comparaison de noms de
 * classes.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from '../Login';
import { PAGE_SECTIONS } from '../../config/page-sections';
import {
  contrasteEntre,
  SEUIL_TEXTE,
} from '../../../scripts/contraste-jetons.js';

// Le dictionnaire FRANÇAIS RÉEL : le libellé du séparateur est celui que la
// page publie, pas une chaîne recopiée dans le test.
vi.mock('../../contexts/LanguageContext', async (importOriginal) => {
  const actual = await importOriginal();
  const { default: fr } = await vi.importActual('../../i18n/fr.json');
  return {
    ...actual,
    useLanguage: () => ({ currentLanguage: 'fr', changeLanguage: vi.fn(), t: (cle) => fr[cle] ?? cle }),
  };
});

vi.mock('../../contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAuth: () => ({ user: null, login: vi.fn(), loginWithGoogle: vi.fn(), logout: vi.fn() }),
  };
});

vi.mock('../../contexts/ToastContext', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
  };
});

// Les métadonnées écrivent dans document.head : hors du sujet ici.
vi.mock('../../utils/seo', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, usePageMeta: vi.fn() };
});

const CSS = fs.readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8');

/** Une valeur hexadécimale d'un jeton de la feuille — refus nommé si absente. */
const jeton = (nom) => {
  const trouve = CSS.match(new RegExp(`${nom}:\\s*(#[0-9a-fA-F]{6})`));
  if (!trouve) throw new Error(`jeton ${nom} introuvable dans src/index.css : la mesure refuse de conclure`);
  return trouve[1];
};

/** La couleur du fond de `.carte-editoriale`, en `[r, g, b, a]`. */
const fondDeLaCarte = () => {
  const regle = CSS.match(/\.carte-editoriale\s*\{[^}]*background-color:\s*rgba\(([^)]+)\)/);
  if (!regle) throw new Error('la carte du formulaire n’a plus de fond rgba : la mesure refuse de conclure');
  return regle[1].split(',').map((valeur) => Number(valeur.trim()));
};

const versRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const versHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** Le composite d'une couleur translucide sur un fond opaque. */
const composer = ([r, g, b, a], fond) => {
  const melange = [r, g, b].map((canal, i) => canal * a + fond[i] * (1 - a));
  return versHex(melange);
};

const SABLE = jeton('--kojo-sable');
const CARTE = composer(fondDeLaCarte(), versRgb(SABLE));

/**
 * Les teintes Tailwind employées sur la page, avec leur valeur hexadécimale.
 *
 * La table est PARTAGÉE par les quatre mesures de ce fichier (séparateur,
 * libellés, lien, encart) : deux tables pour une même teinte finiraient par
 * diverger, et l'une certifierait alors une valeur que la page ne peint plus.
 * Une classe inconnue n'est jamais ignorée — la mesure refuse de conclure.
 */
const TEINTES = {
  'text-stone-900': '#1c1917',
  'text-stone-800': '#292524',
  'text-stone-700': '#44403c',
  'text-stone-600': '#57534e',
  'text-stone-500': '#78716c',
  'text-stone-400': '#a8a29e',
  'text-gray-500': '#6b7280',
  'text-gray-400': '#9ca3af',
  'text-orange-600': '#ea580c',
  'text-orange-700': '#c2410c',
  'text-orange-800': '#9a3412',
};

/** L'encre d'un élément, lue sur sa classe — refus nommé si elle est inconnue. */
const encreDe = (element, ou) => {
  const classes = String(element.className || '').split(/\s+/);
  const teinte = classes.find((classe) => Object.hasOwn(TEINTES, classe));
  if (!teinte) {
    throw new Error(
      `${ou} : aucune teinte connue sur « ${classes.join(' ')} » — la mesure refuse de conclure ` +
        `(ajouter la teinte à TEINTES, dans ce fichier, en la mesurant)`
    );
  }
  return { teinte, valeur: TEINTES[teinte] };
};

/** L'encre de SURVOL déclarée (`hover:text-…`), ou `null` si l'élément n'en a pas. */
const encreAuSurvol = (element, ou) => {
  const classe = String(element.className || '')
    .split(/\s+/)
    .find((nom) => nom.startsWith('hover:text-'));
  if (!classe) return null;
  const nom = classe.slice('hover:'.length);
  if (!Object.hasOwn(TEINTES, nom)) {
    throw new Error(
      `${ou} : teinte de survol « ${nom} » inconnue — la mesure refuse de conclure sans sa valeur`
    );
  }
  return { classe, teinte: nom, valeur: TEINTES[nom] };
};

/**
 * Le fond de l'ENCART légal, lu dans la feuille.
 *
 * Il est OPAQUE (`var(--kojo-sable)`) : les textes de l'encart ne sont donc pas
 * posés sur la carte, et mesurer contre la carte aurait certifié une surface que
 * la page ne peint pas — un composite plus clair, donc un rapport plus flatteur.
 */
const fondDeLEncart = () => {
  const regle = CSS.match(/\.encart\s*\{[^}]*background-color:\s*var\((--kojo-[a-z-]+)\)/);
  if (!regle) {
    throw new Error(
      '`.encart` ne déclare plus un fond en jeton (--kojo-…) : la mesure des textes de l’encart ' +
        'refuserait de conclure sur une surface qu’elle ne connaît pas'
    );
  }
  return jeton(regle[1]);
};

const ENCART = fondDeLEncart();

const monter = () =>
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Login />
    </MemoryRouter>
  );

/** Le séparateur, tel qu'il est peint : le span qui porte le mot ET son fond. */
const separateur = (libelle) =>
  Array.from(document.querySelectorAll('span')).find(
    (span) => span.textContent.trim() === libelle && span.className.includes('bg-white')
  );

afterEach(() => {
  cleanup();
  delete window.__KOJO_GOOGLE_CLIENT_ID__;
});

describe('/login — lisibilité du séparateur « ou »', () => {
  it('sans bouton Google, il n’y a pas de séparateur (la mesure n’a rien à juger)', () => {
    monter();

    expect(
      separateur('ou'),
      'un séparateur est rendu alors que le bouton qu’il sépare n’existe pas : la page se contredit'
    ).toBeUndefined();
  });

  it('le « ou » atteint 4,5:1 sur la pastille ET sur la carte qui la porte', () => {
    // Le séparateur n'existe que si le bouton Google existe : sans client_id,
    // il n'y a rien à mesurer et le test dirait « absent ».
    window.__KOJO_GOOGLE_CLIENT_ID__ = 'test.apps.googleusercontent.com';
    monter();

    const span = separateur('ou');
    expect(
      span,
      'le séparateur « ou » n’est plus rendu : la mesure n’a rien à juger'
    ).toBeTruthy();

    // C'est le SPAN qui peint le fond derrière le mot : sans lui, le filet du
    // séparateur passerait sous le texte et le contraste ne serait plus celui
    // qu'on mesure.
    expect(span.className).toContain('bg-white');

    // Le séparateur vit DANS la carte du formulaire : c'est la surface que le
    // plan déclare, et donc celle que la mesure doit connaître.
    const carte = span.closest(`.${PAGE_SECTIONS['/login'].carteClass.trim().split(/\s+/)[0]}`);
    expect(carte, 'le séparateur est sorti de la carte du formulaire').not.toBeNull();

    // Les valeurs viennent de la table PARTAGÉE de ce fichier (TEINTES) : le
    // séparateur et les autres textes de la page ne peuvent pas être mesurés
    // avec deux tables qui divergeraient.
    const { teinte, valeur } = encreDe(span, 'le séparateur « ou »');

    const surPastille = contrasteEntre(valeur, '#ffffff');
    const surCarte = contrasteEntre(valeur, CARTE);

    expect(
      surPastille,
      `« ou » en ${teinte} : ${surPastille.toFixed(2)}:1 sur la pastille blanche, sous le seuil ${SEUIL_TEXTE}:1 (WCAG 1.4.3)`
    ).toBeGreaterThanOrEqual(SEUIL_TEXTE);

    // La carte est un composite (rgba 0,94 sur le sable), donc légèrement plus
    // sombre que le blanc : c'est ce cas-là qui décide, pas l'autre.
    expect(
      surCarte,
      `« ou » en ${teinte} : ${surCarte.toFixed(2)}:1 sur la carte (${CARTE}), sous le seuil ${SEUIL_TEXTE}:1 (WCAG 1.4.3)`
    ).toBeGreaterThanOrEqual(SEUIL_TEXTE);
  });
});

/**
 * Le verdict d'un texte posé sur une surface : un refus nommé, jamais un
 * arrondi. Le nom de l'élément et la surface sont dans le message, sinon un
 * rouge ne dit pas quoi corriger.
 */
const exigerLisible = ({ ou, encre, surface, surfaceNom }) => {
  const ratio = contrasteEntre(encre.valeur, surface);
  expect(
    ratio,
    `${ou} en ${encre.teinte} : ${ratio.toFixed(2)}:1 sur ${surfaceNom} (${surface}), ` +
      `sous le seuil ${SEUIL_TEXTE}:1 (WCAG 1.4.3)`
  ).toBeGreaterThanOrEqual(SEUIL_TEXTE);
  return ratio;
};

describe('/login — lisibilité du formulaire sur la carte', () => {
  it('les libellés des deux champs tiennent 4,5:1 sur la carte', () => {
    monter();

    const libelles = Array.from(document.querySelectorAll('form label'));
    expect(
      libelles.length,
      'aucun libellé de champ n’est rendu : la mesure n’a rien à juger'
    ).toBeGreaterThanOrEqual(2);

    for (const libelle of libelles) {
      exigerLisible({
        ou: `le libellé « ${libelle.textContent.replace(/\s+/g, ' ').trim()} »`,
        encre: encreDe(libelle, 'un libellé de champ'),
        surface: CARTE,
        surfaceNom: 'la carte',
      });
    }
  });

  it('le lien « mot de passe oublié » tient 4,5:1, y compris AU SURVOL', () => {
    monter();

    const lien = document.querySelector('a[href="/forgot-password"]');
    expect(
      lien,
      'le lien « mot de passe oublié » n’est plus rendu : la mesure n’a rien à juger'
    ).not.toBeNull();

    exigerLisible({
      ou: 'le lien « mot de passe oublié »',
      encre: encreDe(lien, 'le lien « mot de passe oublié »'),
      surface: CARTE,
      surfaceNom: 'la carte',
    });

    // Le survol est un état PEINT : une teinte qui s'éclaircit y perd le seuil
    // au moment précis où la personne vise le lien. C'est ce défaut
    // (`hover:text-orange-600`, 3,39:1 sur la carte) que la mesure a trouvé.
    const survol = encreAuSurvol(lien, 'le lien « mot de passe oublié »');
    if (survol) {
      exigerLisible({
        ou: `le lien « mot de passe oublié » au survol (${survol.classe})`,
        encre: survol,
        surface: CARTE,
        surfaceNom: 'la carte',
      });
    }
  });

  it('l’encart légal tient 4,5:1 sur le SABLE qu’il peint, pas sur la carte', () => {
    monter();

    const encart = document.querySelector('.encart');
    expect(encart, 'l’encart légal n’est plus rendu : la mesure n’a rien à juger').not.toBeNull();
    expect(
      encart.closest('.carte-editoriale'),
      'l’encart légal est sorti de la carte du formulaire : ce fichier mesure la carte'
    ).not.toBeNull();

    // Les trois textes de l'encart : la notice, le lien des conditions et la
    // ligne de contact. Un texte retiré n'est pas un texte mesuré.
    const textes = Array.from(encart.querySelectorAll('p, a, span')).filter(
      (element) => element.textContent.trim().length > 0
    );
    expect(
      textes.length,
      `l’encart légal ne porte que ${textes.length} texte(s) — la notice, le lien des conditions et ` +
        'la ligne de contact en font trois ; la mesure refuse de conclure sur un encart amputé'
    ).toBe(3);

    for (const texte of textes) {
      const ou = `« ${texte.textContent.replace(/\s+/g, ' ').trim()} »`;
      exigerLisible({
        ou,
        encre: encreDe(texte, `l’encart légal, ${ou}`),
        surface: ENCART,
        surfaceNom: 'le sable de l’encart',
      });
      const survol = encreAuSurvol(texte, `l’encart légal, ${ou}`);
      if (survol) {
        exigerLisible({
          ou: `${ou} au survol (${survol.classe})`,
          encre: survol,
          surface: ENCART,
          surfaceNom: 'le sable de l’encart',
        });
      }
    }
  });
});
