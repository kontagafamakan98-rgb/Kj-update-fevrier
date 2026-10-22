/**
 * LE PUSH WEB EST BRIDÉ DANS LE SHELL NATIF — et il le dit avant de demander
 * une permission.
 *
 * La WebView Capacitor expose `serviceWorker`, `PushManager` et `Notification`
 * (c'est Chromium) : une détection par simple PRÉSENCE répondait « oui » dans
 * l'application Android/iOS, l'abonnement partait au backend et la permission
 * était consommée — pour une notification qui ne peut pas arriver, la
 * distribution native passant par FCM/APNs et un plugin. Ces cas verrouillent
 * la garde : le web continue de fonctionner, le natif s'arrête AVANT la
 * demande de permission.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    notificationAPI: {
      getVapidPublicKey: vi.fn(async () => ({ vapid_public_key: '' })),
      registerPushToken: vi.fn(async () => ({ ok: true })),
    },
  };
});

// eslint-disable-next-line import/first
import { isPushSupported, registerPushSubscription } from '../pushRegistration';

/** Pose les API que la WebView expose, sur le web comme en natif. */
const poserLesApiPush = () => {
  Object.defineProperty(window.navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: vi.fn(), register: vi.fn(), ready: Promise.resolve({}) },
  });
  window.PushManager = function PushManager() {};
  window.Notification = {
    permission: 'default',
    requestPermission: vi.fn(async () => 'granted'),
  };
};

const retirerLesApiPush = () => {
  delete window.navigator.serviceWorker;
  delete window.PushManager;
  delete window.Notification;
  delete window.Capacitor;
};

beforeEach(() => {
  poserLesApiPush();
});

afterEach(() => {
  retirerLesApiPush();
  localStorage.clear();
});

describe('push — détection de la plateforme', () => {
  it('sur le web, un navigateur qui expose les API push est supporté', () => {
    expect(isPushSupported()).toBe(true);
  });

  it('dans le shell natif, les MÊMES API ne font pas un push supporté', () => {
    window.Capacitor = { isNativePlatform: () => true };

    expect(window.navigator.serviceWorker).toBeTruthy();
    expect(window.PushManager).toBeTruthy();
    expect(isPushSupported()).toBe(false);
  });

  it('sans les API du navigateur, le web n’est pas supporté non plus', () => {
    retirerLesApiPush();
    expect(isPushSupported()).toBe(false);
  });
});

describe('push — l’inscription dans le shell natif', () => {
  it('n’inscrit rien et ne consomme PAS la permission de notification', async () => {
    window.Capacitor = { isNativePlatform: () => true };

    const abonnement = await registerPushSubscription('user-1');

    expect(abonnement).toBeNull();
    // Le cœur du bridage : on s'arrête AVANT la demande de permission, sinon
    // l'utilisateur paie un refus pour une fonctionnalité absente.
    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
    expect(window.navigator.serviceWorker.register).not.toHaveBeenCalled();
  });
});
