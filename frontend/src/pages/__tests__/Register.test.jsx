/**
 * /register ANNONCE LA BONNE CHOSE QUAND UN COURRIEL EST DÉJÀ PRIS.
 *
 * ── Les deux défauts que ce fichier ferme (23/10/2026) ──────────────────────
 * 1. La page testait `!result.available`. Or la route répondait `null` pour
 *    TOUTE adresse (réponse neutre) : `!null` est vrai, donc « Cette adresse
 *    email est déjà utilisée » s'affichait à un nouveau venu et `handleSubmit`
 *    refusait l'envoi (`emailAvailable === false`). Plus personne ne pouvait
 *    s'inscrire, et le message était faux : l'adresse n'était pas prise, elle
 *    n'était pas connue.
 * 2. Quand la phrase existait vraiment, le toast la portait par CLÉ
 *    (`messageKey: 'duplicateEmailError'`, scope `register`) et le scope
 *    `register` manquait de `utils/toastScopedI18n.js` : l'écran affichait
 *    « duplicateEmailError ». Ce second volet est jugé dans
 *    `utils/__tests__/toastScopedI18n.test.js`.
 *
 * ── Ce qui est mesuré ici, et par quel chemin ──────────────────────────────
 * Trois réponses, trois comportements lus à l'ÉCRAN (jamais dans un état
 * interne) :
 *   • `available: false` → la PHRASE est affichée UNE SEULE FOIS, jamais la
 *     clé (elle l'était trois fois : bandeau du haut, bloc de champ, toast) ;
 *   • `available: true`  → « Adresse email disponible » (la coche servie) ;
 *   • `available: null`  → rien : ni reproche, ni coche (un backend d'avant
 *     la correction, ou une autre origine, ne bloque pas l'inscription).
 *
 * Ce que ce fichier ne prouve pas : l'inscription complète (OTP, paiement),
 * qui appartient aux pages de vérification, ni le rendu de la page — ses
 * sondes de géométrie sont ailleurs.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
// Le RAPPORT de contraste vient de la règle qui mesure les jetons du site : la
// même arithmétique WCAG que le CSS, pas une seconde implémentation.
import { contrasteEntre, SEUIL_TEXTE } from '../../../scripts/contraste-jetons.js';

const etat = vi.hoisted(() => ({
  reponse: { available: null, email: 'x@y.z', message: 'Vérification effectuée.' },
  erreur: null,
  toastErreur: [],
}));

// Les APPELS de détection, pour juger ce que la page DEMANDE à l'appareil.
const geo = vi.hoisted(() => ({ appels: [] }));

// Le dictionnaire FRANÇAIS RÉEL : une phrase affichée doit exister, pas être
// recopiée dans le test.
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
    useAuth: () => ({ user: null, register: vi.fn(), loginWithGoogle: vi.fn(), logout: vi.fn() }),
  };
});

vi.mock('../../contexts/ToastContext', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useToast: () => ({
      success: vi.fn(),
      error: (toast) => { etat.toastErreur.push(toast); },
      info: vi.fn(),
      warning: vi.fn(),
    }),
  };
});

vi.mock('../../services/geolocationService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    detectUserCountry: vi.fn(async (options) => {
      geo.appels.push(options);
      return null;
    }),
    getCountriesList: () => [{ code: 'SN', name: 'Sénégal', phonePrefix: '+221' }],
    getPhoneExampleForCountry: () => '77 123 45 67',
  };
});

vi.mock('../../utils/seo', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, usePageMeta: vi.fn() };
});

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    authAPI: {
      ...actual.authAPI,
      checkEmailAvailability: vi.fn(async () => {
        if (etat.erreur) throw etat.erreur;
        return etat.reponse;
      }),
    },
    handleApiError: (error, repli) => error?.response?.data?.detail || error?.message || repli,
  };
});

const { default: Register } = await import('../Register');

const monter = () =>
  render(
    <MemoryRouter initialEntries={['/register']}>
      <Register />
    </MemoryRouter>
  );

const saisirEmail = async (email) => {
  // L'identifiant est l'ancre stable de la page (`<label htmlFor="email">`) :
  // le libellé est traduit, l'id ne l'est pas.
  const champ = document.getElementById('email');
  await userEvent.clear(champ);
  await userEvent.type(champ, email);
  await userEvent.tab();
  // La vérification part au blur : on laisse la promesse se résoudre.
  await waitFor(() => expect(champ).toBeTruthy());
};

describe('/register — disponibilité de l’adresse', () => {
  beforeEach(() => {
    etat.reponse = { available: null, email: 'nouveau@exemple.com', message: 'Vérification effectuée.' };
    etat.erreur = null;
    etat.toastErreur = [];
  });

  afterEach(() => cleanup());

  it('« available: null » (backend muet) n’annonce NI que l’adresse est prise NI qu’elle est libre', async () => {
    monter();
    await saisirEmail('nouveau@exemple.com');

    await waitFor(() => {
      expect(screen.queryByText('Cette adresse email est déjà utilisée')).toBeNull();
    });
    // Et rien n'est parti en toast : le seul chemin qui produisait jadis la CLÉ
    // « duplicateEmailError » en clair.
    expect(etat.toastErreur).toEqual([]);
  });

  it('« available: true » affiche la coche servie (« Adresse email disponible »)', async () => {
    etat.reponse = { available: true, email: 'libre@exemple.com', message: 'Adresse email disponible' };
    monter();
    await saisirEmail('libre@exemple.com');

    expect(await screen.findByText('Adresse email disponible')).toBeTruthy();
    expect(screen.queryByText('Cette adresse email est déjà utilisée')).toBeNull();
  });

  /**
   * MESURÉ LE 25/10/2026 : le même refus s'affichait TROIS fois — bandeau en
   * haut du formulaire, bloc sous le champ, et toast. Trois copies ne disent
   * pas trois choses : elles font douter que la première soit la bonne, et sur
   * un téléphone le toast en bas masque justement le bloc qui porte les issues.
   * La surface est donc le bloc DU CHAMP, et lui seul.
   */
  it('« available: false » affiche la phrase UNE SEULE fois, dans le bloc du champ', async () => {
    etat.reponse = { available: false, email: 'pris@exemple.com', message: 'Cette adresse email est déjà utilisée' };
    monter();
    await saisirEmail('pris@exemple.com');

    await screen.findAllByText('Cette adresse email est déjà utilisée');
    const occurrences = screen.getAllByText('Cette adresse email est déjà utilisée');
    expect(occurrences).toHaveLength(1);
    expect(screen.queryByText('duplicateEmailError')).toBeNull();

    // Ce qui la porte est le bloc DU CHAMP (`role="alert"`), pas un bandeau en
    // haut de formulaire : il est dans le même groupe que l'input.
    const champ = document.getElementById('email');
    const bloc = screen.getByRole('alert');
    expect(bloc.contains(occurrences[0])).toBe(true);
    expect(champ.parentElement.contains(bloc)).toBe(true);
    // Le champ DÉCRIT le refus : l'annonce d'un lecteur d'écran tombe sur lui.
    expect(champ.getAttribute('aria-describedby')).toBe('email-disponibilite');
    expect(champ.getAttribute('aria-invalid')).toBe('true');

    // Les deux issues sont EMPILÉES sur mobile (une par ligne, lisibles en
    // entier) et alignées à partir de `sm` : jsdom ne calcule aucune mise en
    // page, donc c'est la CLASSE qui porte le contrat qui est jugée.
    const issues = screen.getByRole('link', { name: /connectez-vous avec cette adresse/i }).parentElement;
    expect(issues.className).toContain('flex-col');
    expect(issues.className).toContain('sm:flex-row');

    // Et rien en toast pour ce refus (le toast était la troisième copie).
    expect(etat.toastErreur).toEqual([]);
  });

  /**
   * Sur un téléphone, le bouton d'envoi est en bas d'un formulaire long : un
   * refus qui tombe à l'envoi laisserait le message hors de l'écran. Le champ
   * reprend donc le focus (ce que jsdom sait vérifier), et l'appel de
   * `scrollIntoView` est ce qui le Y ramène.
   */
  it('à l’ENVOI, un refus ramène au champ et n’ajoute aucun toast', async () => {
    etat.reponse = { available: false, email: 'pris@exemple.com', message: 'Cette adresse email est déjà utilisée' };
    monter();

    const champ = document.getElementById('email');
    await userEvent.type(champ, 'pris@exemple.com');
    await userEvent.type(document.getElementById('password'), 'motdepasse123');
    await userEvent.type(document.getElementById('confirmPassword'), 'motdepasse123');
    await userEvent.click(document.getElementById('legal_documents_accepted'));

    fireEvent.submit(champ.closest('form'));

    await waitFor(() => expect(document.activeElement).toBe(champ));
    expect(screen.getAllByText('Cette adresse email est déjà utilisée')).toHaveLength(1);
    expect(etat.toastErreur).toEqual([]);
    expect(screen.getByRole('link', { name: /connectez-vous avec cette adresse/i }).getAttribute('href')).toBe('/login');
    expect(screen.getByRole('link', { name: /réinitialisez votre mot de passe/i }).getAttribute('href')).toBe('/forgot-password');
  });

  /**
   * MESURÉ EN PRODUCTION LE 24/10/2026 : la phrase était JUSTE et localisée,
   * mais sans ISSUE. On apprenait que l'adresse est prise sans lire nulle part
   * quoi faire — le seul recours était le lien « Se connecter » du bas de
   * page, à l'autre bout du formulaire. Le message porte donc ses deux issues,
   * et elles doivent être de VRAIS liens (une phrase qui dit « connectez-vous »
   * sans mener à la connexion est un conseil, pas une action).
   */
  it('« available: false » dit aussi quoi faire ensuite, avec les deux liens réels', async () => {
    etat.reponse = { available: false, email: 'pris@exemple.com', message: 'Cette adresse email est déjà utilisée' };
    monter();
    await saisirEmail('pris@exemple.com');

    expect(await screen.findByText(/Pour continuer :/)).toBeTruthy();

    const connexion = screen.getByRole('link', { name: /connectez-vous avec cette adresse/i });
    expect(connexion.getAttribute('href')).toBe('/login');

    const motDePasse = screen.getByRole('link', { name: /réinitialisez votre mot de passe/i });
    expect(motDePasse.getAttribute('href')).toBe('/forgot-password');

    // Et aucune clé de traduction ne fuit à l'écran.
    expect(screen.queryByText(/duplicateEmail(NextStep|SignIn|Or|ResetPassword)/)).toBeNull();
  });

  it('« available: true » ne propose AUCUNE issue : il n\'y a rien à corriger', async () => {
    etat.reponse = { available: true, email: 'libre@exemple.com', message: 'Adresse email disponible' };
    monter();
    await saisirEmail('libre@exemple.com');

    expect(await screen.findByText('Adresse email disponible')).toBeTruthy();
    expect(screen.queryByText(/Pour continuer :/)).toBeNull();
  });
});

/**
 * ── LA PERMISSION, L'ORDRE DES TITRES ET LA LECTURE (26/10/2026) ────────────
 *
 * Trois défauts mesurés en production par Lighthouse mobile sur la page
 * d'inscription (`geolocation-on-start`, `heading-order`, `color-contrast`).
 * Ce que chaque test referme :
 *
 * 1. La page demandait la POSITION DE L'APPAREIL au chargement, avant tout
 *    geste : le navigateur affichait donc sa demande de permission au seuil du
 *    formulaire. Le montage ne demande plus que le PAYS, par IP
 *    (`sansGps: true`) ; la position précise reste derrière un bouton, où la
 *    permission répond à une intention. Le test juge l'ARGUMENT transmis au
 *    service, pas un état interne de la page.
 * 2. Le premier titre sous le `h1` était un `h3` : un niveau sauté. L'ordre des
 *    titres est le plan que la synthèse vocale annonce, donc on juge la SUITE
 *    des niveaux, jamais un titre isolé.
 * 3. Le « ou » du séparateur était en `gray-400` sur blanc : 2,5:1, sous le
 *    4,5:1 du texte courant. Le test lit la TEINTE portée par le span et
 *    calcule le rapport avec la règle de contraste du site (`scripts/contraste-jetons.js`),
 *    la même arithmétique WCAG que le CSS : il ne compare pas des noms de classes.
 */
describe('/register — permission de géolocalisation, ordre des titres et séparateur', () => {
  beforeEach(() => {
    etat.reponse = { available: null, email: 'nouveau@exemple.com', message: 'Vérification effectuée.' };
    etat.erreur = null;
    etat.toastErreur = [];
    geo.appels = [];
  });

  afterEach(() => {
    cleanup();
    delete window.__KOJO_GOOGLE_CLIENT_ID__;
  });

  it('au MONTAGE, la page demande le PAYS et JAMAIS la position de l’appareil', async () => {
    monter();

    await waitFor(() => expect(geo.appels.length).toBeGreaterThan(0));

    // `sansGps` est la seule chose qui empêche le service de toucher
    // `navigator.geolocation` : tant qu'elle est vraie, aucune permission ne
    // peut être demandée pendant le chargement.
    expect(geo.appels.every((options) => options?.sansGps === true)).toBe(true);
  });

  it('« Utiliser ma position » est le SEUL chemin qui demande le GPS', async () => {
    monter();

    const bouton = await screen.findByRole('button', { name: /utiliser ma position/i });
    expect(geo.appels.some((options) => options?.sansGps === false)).toBe(false);

    await userEvent.click(bouton);

    await waitFor(() => expect(geo.appels.some((options) => options?.sansGps === false)).toBe(true));
    // Le montage, lui, n'a toujours demandé que le pays : la position part d'un
    // GESTE, jamais du chargement.
    expect(geo.appels[0]).toEqual({ sansGps: true });
  });

  it('les titres ne sautent aucun niveau : h1, puis h2 — jamais h1 → h3', () => {
    monter();

    const niveaux = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((titre) =>
      Number(titre.tagName[1])
    );

    expect(
      niveaux.length,
      'la page ne porte plus assez de titres pour que la suite soit jugée'
    ).toBeGreaterThanOrEqual(3);
    expect(niveaux[0]).toBe(1);
    expect(niveaux.filter((niveau) => niveau === 1)).toHaveLength(1);

    for (let index = 1; index < niveaux.length; index += 1) {
      expect(
        niveaux[index] - niveaux[index - 1],
        `titre ${index + 1} : h${niveaux[index - 1]} → h${niveaux[index]} saute un niveau`
      ).toBeLessThanOrEqual(1);
    }
  });

  it('le « ou » du séparateur atteint le 4,5:1 du texte courant', () => {
    // Le séparateur n'existe que si le bouton qu'il sépare existe : sans
    // client_id Google, il n'y a rien à mesurer et le test dirait « absent ».
    window.__KOJO_GOOGLE_CLIENT_ID__ = 'test.apps.googleusercontent.com';
    monter();

    const separateur = Array.from(document.querySelectorAll('span')).find(
      (span) => span.textContent.trim() === 'ou' && span.className.includes('bg-white')
    );
    expect(
      separateur,
      'le séparateur « ou » n’est plus rendu : la mesure n’a rien à juger'
    ).toBeTruthy();

    // C'est le SPAN qui peint le fond derrière le mot, pas la carte : sans ce
    // fond la ligne du séparateur passerait sous le texte et le contraste ne
    // serait plus celui qu'on mesure.
    expect(separateur.className).toContain('bg-white');

    // Les valeurs des teintes Tailwind employées sur ce séparateur.
    const teintes = {
      'text-stone-500': '#78716c',
      'text-stone-600': '#57534e',
      'text-stone-700': '#44403c',
      'text-gray-500': '#6b7280',
      'text-gray-400': '#9ca3af',
      'text-stone-400': '#a8a29e',
    };
    const teinte = Object.keys(teintes).find((classe) =>
      separateur.className.split(/\s+/).includes(classe)
    );
    expect(
      teinte,
      'aucune teinte connue sur le séparateur : la mesure refuse de conclure'
    ).toBeTruthy();

    const ratio = contrasteEntre(teintes[teinte], '#ffffff');
    expect(
      ratio,
      `« ou » en ${teinte} : ${ratio.toFixed(2)}:1 sur blanc, sous le seuil ${SEUIL_TEXTE}:1 (WCAG 1.4.3)`
    ).toBeGreaterThanOrEqual(SEUIL_TEXTE);
  });
});
