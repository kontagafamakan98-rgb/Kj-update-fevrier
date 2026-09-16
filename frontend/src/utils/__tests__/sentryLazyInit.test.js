import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Tests du chargement DIFFÉRÉ de Sentry (src/utils/sentry.js).
//
// Ce qui est vérifié ici ne se voit pas dans un build : le chunk peut être
// petit et pourtant téléchargé au boot. Les trois propriétés qui comptent sont
// donc testées explicitement — le SDK n'est pas chargé avant interaction, les
// erreurs du début de session ne sont pas perdues, et une session sans
// interaction finit quand même par être surveillée (repli temporisé).

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setUser: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

// Le signal « le SDK a été chargé » est `init` (appelé juste après
// l'import dynamique), et non un compteur incrémenté DANS la fabrique : celle-ci
// ne s'exécute qu'une fois par fichier de test, alors que `clearAllMocks()`
// remet son compteur à zéro à chaque test — un tel compteur vaut donc 0 dans
// tous les tests sauf le premier à importer le module.
vi.mock('@sentry/react', () => ({
  init: mocks.init,
  captureException: mocks.captureException,
  captureMessage: mocks.captureMessage,
  setUser: mocks.setUser,
  addBreadcrumb: mocks.addBreadcrumb,
}));

const loadSentry = async () => {
  vi.resetModules();
  return import('../sentry');
};

/**
 * Laisse se dérouler la chaîne de promesses de l'init : `await import(...)`
 * (mocké) puis `.then(flushEarlyErrors)` puis les `await import(...)` du flush.
 * Assez de tours de microtâches pour absorber cette profondeur — et
 * volontairement AUCUN minuteur, pour rester utilisable sous faux timers
 * (sinon l'attente ne se résoudrait jamais dans le test du repli temporisé).
 */
const settle = async () => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
};

// La `window` de jsdom est partagée par tout le fichier, alors que
// `vi.resetModules()` crée une NOUVELLE instance de utils/sentry.js à chaque
// test : sans nettoyage, les écouteurs armés par un test précédent restent
// attachés et réagissent aux événements du test suivant (mesuré : une erreur
// tamponnée rejouée deux fois, par deux instances vivantes). On enregistre
// donc tout ce qui est ajouté pour le retirer après chaque test — et on
// vérifie au passage que l'installation est bien passive.
let addedListeners = [];
let nativeAdd;
let nativeRemove;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_SENTRY_ENABLED', 'true');
  vi.stubEnv('VITE_SENTRY_DSN', 'https://cle@exemple.ingest.sentry.io/1');

  addedListeners = [];
  nativeAdd = window.addEventListener.bind(window);
  nativeRemove = window.removeEventListener.bind(window);
  window.addEventListener = (type, handler, options) => {
    addedListeners.push([type, handler, options]);
    return nativeAdd(type, handler, options);
  };
});

afterEach(() => {
  for (const [type, handler, options] of addedListeners) {
    nativeRemove(type, handler, options);
  }
  addedListeners = [];
  window.addEventListener = nativeAdd;
  window.removeEventListener = nativeRemove;
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('Sentry différé — Sentry désactivé', () => {
  it('n\'arme rien et ne télécharge jamais le SDK', async () => {
    vi.stubEnv('VITE_SENTRY_ENABLED', 'false');
    const sentry = await loadSentry();

    expect(sentry.initSentryOnInteraction()).toBe(false);
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('keydown'));
    await settle();

    expect(mocks.init).not.toHaveBeenCalled();
  });
});

describe('Sentry différé — déclencheurs', () => {
  it('ne charge le SDK qu\'APRÈS la première interaction', async () => {
    const sentry = await loadSentry();

    expect(sentry.initSentryOnInteraction()).toBe(true);
    // Au boot : écouteurs installés, mais le SDK n'est jamais chargé (et donc
    // jamais initialisé) tant qu'aucune interaction n'a eu lieu.
    await settle();
    expect(mocks.init).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('pointerdown'));
    await settle();

    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.init.mock.calls[0][0]).toMatchObject({
      dsn: 'https://cle@exemple.ingest.sentry.io/1',
    });
  });

  it('reste idempotent sur les interactions suivantes', async () => {
    const sentry = await loadSentry();
    sentry.initSentryOnInteraction();

    window.dispatchEvent(new Event('keydown'));
    await settle();
    window.dispatchEvent(new Event('touchstart'));
    window.dispatchEvent(new Event('pointerdown'));
    await settle();

    expect(mocks.init).toHaveBeenCalledTimes(1);
  });

  it('n\'arme pas deux fois (double appel au boot)', async () => {
    const sentry = await loadSentry();

    expect(sentry.initSentryOnInteraction()).toBe(true);
    expect(sentry.initSentryOnInteraction()).toBe(false);
  });

  it('charge quand même le SDK SANS interaction (repli temporisé)', async () => {
    const sentry = await loadSentry();

    expect(sentry.initSentryOnInteraction({ fallbackMs: 20 })).toBe(true);
    expect(mocks.init).not.toHaveBeenCalled();

    // Vraie attente courte plutôt que faux timers : c'est le COMPORTEMENT du
    // repli qui est testé (charger sans interaction), pas la mécanique
    // d'horloge de Vitest — sous faux timers, le minuteur armé par le module
    // ne se déclenche pas via advanceTimersByTimeAsync (mesuré).
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    await new Promise((resolve) => setTimeout(resolve, 80));
    await settle();

    // Sonde : `start()` retire les écouteurs d'interaction. Si elle n'a pas
    // tourné, ce n'est pas l'init qui a échoué mais le minuteur.
    expect(removeSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    removeSpy.mockRestore();

    expect(mocks.init).toHaveBeenCalledTimes(1);
  });
});

describe('Sentry différé — erreurs du début de session', () => {
  it('met en tampon une erreur survenue avant l\'init, puis la rejoue', async () => {
    const sentry = await loadSentry();
    sentry.initSentryOnInteraction();

    const failure = new Error('panne avant init');
    window.dispatchEvent(new ErrorEvent('error', { error: failure, message: 'panne avant init' }));
    await settle();
    // Tamponnée : rien n'est envoyé tant que le SDK n'est pas chargé.
    expect(mocks.captureException).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('pointerdown'));
    await settle();

    expect(mocks.captureException).toHaveBeenCalledTimes(1);
    expect(mocks.captureException.mock.calls[0][0]).toBe(failure);
  });

  it('met aussi en tampon un rejet de promesse non géré', async () => {
    const sentry = await loadSentry();
    sentry.initSentryOnInteraction();

    const rejection = new Error('promesse rejetée');
    const event = new Event('unhandledrejection');
    event.reason = rejection;
    window.dispatchEvent(event);
    await settle();

    window.dispatchEvent(new Event('keydown'));
    await settle();

    expect(mocks.captureException).toHaveBeenCalledTimes(1);
    expect(mocks.captureException.mock.calls[0][0]).toBe(rejection);
  });

  it('borne le tampon pour qu\'une boucle d\'erreurs ne grossisse pas sans fin', async () => {
    const sentry = await loadSentry();
    sentry.initSentryOnInteraction();

    for (let i = 0; i < sentry.EARLY_BUFFER_MAX + 10; i += 1) {
      window.dispatchEvent(new ErrorEvent('error', { error: new Error(`boucle ${i}`), message: `boucle ${i}` }));
    }
    await settle();

    window.dispatchEvent(new Event('pointerdown'));
    await settle();

    expect(mocks.captureException).toHaveBeenCalledTimes(sentry.EARLY_BUFFER_MAX);
  });

  it('ne rejoue pas deux fois le même tampon', async () => {
    const sentry = await loadSentry();
    sentry.initSentryOnInteraction();
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('une fois'), message: 'une fois' }));
    window.dispatchEvent(new Event('pointerdown'));
    await settle();

    expect(await sentry.flushEarlyErrors()).toBe(0);
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
  });
});

describe('Sentry différé — helpers', () => {
  it('captureError transmet le contexte quand Sentry est activé', async () => {
    const sentry = await loadSentry();

    await sentry.captureError(new Error('explicite'), { route: '/jobs' });
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
      extra: { route: '/jobs' },
    });
  });

  it('captureMessage et setUser restent des no-op si désactivé', async () => {
    vi.stubEnv('VITE_SENTRY_ENABLED', 'false');
    const sentry = await loadSentry();

    await sentry.captureMessage('rien');
    await sentry.setUser({ id: '1', country: 'ML' });

    expect(mocks.captureMessage).not.toHaveBeenCalled();
    expect(mocks.setUser).not.toHaveBeenCalled();
  });

  it('setUser ne transmet JAMAIS de données personnelles', async () => {
    const sentry = await loadSentry();

    await sentry.setUser({ id: 'u1', country: 'ML', email: 'a@b.c', name: 'Prénom', phone: '+223...' });

    expect(mocks.setUser).toHaveBeenCalledWith({ id: 'u1', country: 'ML' });
  });
});
