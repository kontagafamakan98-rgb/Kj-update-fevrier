/**
 * LA FENÊTRE GOOGLE DOIT S'OUVRIR PENDANT LE CLIC, PAS APRÈS DEUX RÉSEAUX.
 *
 * ── Le défaut mesuré en production (23/10/2026) ────────────────────────────
 * Sur `/register`, le bouton « S’inscrire avec Google » tournait et rien ne
 * s'ouvrait : le SDK Google était bien chargé (200 sur
 * `https://accounts.google.com/gsi/client`) et aucune fenêtre n'était demandée.
 *
 * La chaîne : `loginWithGoogle` faisait `await import('../utils/googleAuth')`,
 * puis `getGoogleAuthCode` faisait `await loadGsiScript()` — deux allers-retours
 * réseau AVANT `client.requestCode()`, qui ouvre la fenêtre. Un navigateur
 * n'autorise une ouverture que pendant l'ACTIVATION du clic (quelques
 * secondes) : sur un téléphone, la fenêtre était bloquée en silence. Le message
 * n'arrivait jamais, parce que rien n'échouait — simplement, rien ne s'ouvrait.
 *
 * ── Ce que ce fichier tient ────────────────────────────────────────────────
 *   • `preloadGoogleAuth()` charge le SDK UNE fois, à l'apparition du bouton ;
 *   • `getGoogleAuthCode()`, appelé ensuite, ne recharge RIEN et demande la
 *     fenêtre tout de suite ;
 *   • une annulation (fermeture de la fenêtre) rend `null` — pas une erreur ;
 *   • une fenêtre bloquée est NOMMÉE, en français, au lieu du silence ;
 *   • sans client_id, rien n'est chargé et le bouton reste masqué.
 *
 * Ce que ce fichier ne prouve pas : l'échange du code côté backend (couvert par
 * `backend/tests/test_google_auth.py`) ni le dessin du bouton.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const CLIENT_ID = '1234567890-abcdefghij.apps.googleusercontent.com';
const SDK_URL = 'https://accounts.google.com/gsi/client';

let scripts;
let appendSpy;
let dernierConfig;
let reponseGoogle;

// Le SDK simulé : `initCodeClient` garde la configuration, `requestCode`
// rejoue la réponse Google comme le fait la vraie popup.
const installerSdk = () => {
  window.google = {
    accounts: {
      oauth2: {
        initCodeClient: vi.fn((config) => {
          dernierConfig = config;
          return {
            requestCode: () => config.callback(reponseGoogle),
          };
        }),
      },
    },
  };
};

const chargerModule = async () => {
  vi.resetModules();
  return import('../googleAuth');
};

describe('googleAuth — préchargement du SDK et ouverture de la fenêtre', () => {
  beforeEach(() => {
    scripts = [];
    dernierConfig = null;
    reponseGoogle = { code: 'code-google-de-test-0123456789' };
    delete window.google;
    delete window.__KOJO_GOOGLE_CLIENT_ID__;
    appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      if (node.tagName === 'SCRIPT') scripts.push(node);
      return node;
    });
  });

  afterEach(() => {
    appendSpy.mockRestore();
    delete window.google;
    delete window.__KOJO_GOOGLE_CLIENT_ID__;
  });

  it('sans client_id, rien n’est chargé et le bouton reste masqué', async () => {
    const mod = await chargerModule();

    expect(mod.isGoogleAuthEnabled()).toBe(false);
    await expect(mod.preloadGoogleAuth()).resolves.toBeNull();
    expect(scripts).toHaveLength(0);
    await expect(mod.getGoogleAuthCode()).rejects.toThrow(/non configurée/i);
  });

  it('preloadGoogleAuth charge le SDK UNE seule fois, à l’apparition du bouton', async () => {
    window.__KOJO_GOOGLE_CLIENT_ID__ = CLIENT_ID;
    const mod = await chargerModule();

    const premier = mod.preloadGoogleAuth();
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe(SDK_URL);

    // Le second appel (deuxième bouton monté, navigation) ne recharge pas.
    const second = mod.preloadGoogleAuth();
    expect(scripts).toHaveLength(1);

    installerSdk();
    scripts[0].onload();
    await expect(premier).resolves.toBeTruthy();
    await expect(second).resolves.toBeTruthy();
  });

  it('le clic ne recharge rien : requestCode est appelé sans nouveau réseau', async () => {
    window.__KOJO_GOOGLE_CLIENT_ID__ = CLIENT_ID;
    const mod = await chargerModule();

    const precharge = mod.preloadGoogleAuth();
    installerSdk();
    scripts[0].onload();
    await precharge;

    const code = await mod.getGoogleAuthCode();

    expect(code).toBe(reponseGoogle.code);
    // Un seul <script> depuis le début : le chemin de clic est synchrone.
    expect(scripts).toHaveLength(1);
    expect(dernierConfig.client_id).toBe(CLIENT_ID);
    expect(dernierConfig.ux_mode).toBe('popup');
  });

  it('une fenêtre BLOQUÉE est nommée, en français (plus de bouton qui tourne en silence)', async () => {
    window.__KOJO_GOOGLE_CLIENT_ID__ = CLIENT_ID;
    reponseGoogle = { error: 'popup_blocked_by_browser' };
    const mod = await chargerModule();

    const precharge = mod.preloadGoogleAuth();
    installerSdk();
    scripts[0].onload();
    await precharge;

    await expect(mod.getGoogleAuthCode()).rejects.toThrow(/bloqué la fenêtre Google/i);
  });

  it('une fermeture par l’utilisateur rend null (annulation, pas une panne)', async () => {
    window.__KOJO_GOOGLE_CLIENT_ID__ = CLIENT_ID;
    reponseGoogle = { error: 'access_denied' };
    const mod = await chargerModule();

    const precharge = mod.preloadGoogleAuth();
    installerSdk();
    scripts[0].onload();
    await precharge;

    await expect(mod.getGoogleAuthCode()).resolves.toBeNull();
  });

  it('un échec de préchargement ne casse rien : le clic retentera et dira l’erreur', async () => {
    window.__KOJO_GOOGLE_CLIENT_ID__ = CLIENT_ID;
    const mod = await chargerModule();

    const precharge = mod.preloadGoogleAuth();
    scripts[0].onerror();

    // La précharge est silencieuse (elle ne rejette pas)…
    await expect(precharge).resolves.toBeNull();
    // …et le clic retente le chargement au lieu de rester sans SDK.
    const clic = mod.getGoogleAuthCode();
    expect(scripts).toHaveLength(2);
    installerSdk();
    scripts[1].onload();
    await expect(clic).resolves.toBe(reponseGoogle.code);
  });
});
