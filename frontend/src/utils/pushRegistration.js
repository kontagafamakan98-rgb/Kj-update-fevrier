/**
 * pushRegistration.js
 * ---------------------------------------------------------------
 * Gère l'enregistrement du Service Worker push et l'abonnement
 * VAPID. S'appuie sur le backend pour récupérer la clé publique.
 * Ne dépend pas de Firebase.
 * ---------------------------------------------------------------
 */

import { notificationAPI } from '../services/api';
import { devLog, safeLog } from './env';

const PUSH_SW_PATH = '/push-sw.js';
const PUSH_SW_SCOPE = '/';

/** Convertit une clé VAPID base64url → Uint8Array (requis par pushManager) */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

/** Vérifie si le navigateur supporte les push */
export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Enregistre le Service Worker push et crée l'abonnement VAPID.
 * Envoie la subscription au backend.
 *
 * @param {string} userId  – ID de l'utilisateur connecté
 * @returns {PushSubscription|null}
 */
export async function registerPushSubscription(userId) {
  if (!isPushSupported()) {
    devLog.info('Push notifications non supportées sur ce navigateur');
    return null;
  }

  // 1. Demander la permission si besoin
  if (Notification.permission === 'denied') {
    devLog.info('Permission push refusée par l\'utilisateur');
    return null;
  }

  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      devLog.info('Permission push non accordée');
      return null;
    }
  }

  try {
    // 2. Enregistrer (ou récupérer) le Service Worker push
    let registration = await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE);
    const existingScript = registration?.active?.scriptURL || '';

    if (!existingScript.includes('push-sw.js')) {
      registration = await navigator.serviceWorker.register(PUSH_SW_PATH, {
        scope: PUSH_SW_SCOPE,
      });
      devLog.info('✅ push-sw.js enregistré');
    }

    // Attendre que le SW soit prêt
    await navigator.serviceWorker.ready;

    // 3. Récupérer la clé VAPID publique depuis le backend
    let vapidPublicKey = '';
    try {
      const res = await notificationAPI.getVapidPublicKey();
      vapidPublicKey = res.vapid_public_key || '';
    } catch (err) {
      safeLog.error('Impossible de récupérer la clé VAPID:', err);
      return null;
    }

    if (!vapidPublicKey) {
      devLog.info('Clé VAPID non configurée côté serveur, push désactivé');
      return null;
    }

    // 4. Créer ou récupérer la subscription
    const reg = await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();

    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      devLog.info('✅ Nouvelle subscription push créée');
    }

    // 5. Envoyer la subscription au backend
    const deviceId = generateDeviceId();
    await notificationAPI.registerPushToken({
      user_id: userId,
      // On sérialise la subscription complète (endpoint + keys) en JSON
      push_token: JSON.stringify(subscription.toJSON()),
      device_type: 'web',
      device_id: deviceId,
    });

    devLog.info('✅ Subscription push enregistrée sur le backend');
    return subscription;

  } catch (err) {
    safeLog.error('Erreur enregistrement push:', err);
    return null;
  }
}

/** Génère un identifiant d'appareil stable stocké dans localStorage */
function generateDeviceId() {
  const key = 'kojo_device_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = `web_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

/**
 * Se désabonne du push et informe le backend.
 */
export async function unregisterPushSubscription() {
  if (!isPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      devLog.info('✅ Subscription push révoquée');
    }
  } catch (err) {
    safeLog.error('Erreur révocation push:', err);
  }
}
