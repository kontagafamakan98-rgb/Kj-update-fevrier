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

    // Les valeurs des teintes Tailwind employées sur ce séparateur — la même
    // table que le garde de /register : deux tables pour un même séparateur
    // finiraient par diverger.
    const teintes = {
      'text-stone-500': '#78716c',
      'text-stone-600': '#57534e',
      'text-stone-700': '#44403c',
      'text-gray-500': '#6b7280',
      'text-gray-400': '#9ca3af',
      'text-stone-400': '#a8a29e',
    };
    const teinte = Object.keys(teintes).find((classe) =>
      span.className.split(/\s+/).includes(classe)
    );
    expect(
      teinte,
      'aucune teinte connue sur le séparateur : la mesure refuse de conclure'
    ).toBeTruthy();

    const surPastille = contrasteEntre(teintes[teinte], '#ffffff');
    const surCarte = contrasteEntre(teintes[teinte], CARTE);

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
