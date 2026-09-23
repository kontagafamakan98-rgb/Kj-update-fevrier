import { devLog } from '../utils/env';

export const TARGET_GPS_ACCURACY = 12;

export async function getGeolocationPermissionState() {
  try {
    if (!navigator?.permissions?.query) {
      return 'unknown';
    }
    const permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
    return permissionStatus?.state || 'unknown';
  } catch (error) {
    devLog.info('⚠️ Permissions API indisponible:', error?.message);
    return 'unknown';
  }
}

export function getCurrentPositionWithOptions(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator?.geolocation?.getCurrentPosition) {
      reject(new Error('Geolocation non disponible'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

export async function getBestAvailableGpsPosition(targetAccuracy = TARGET_GPS_ACCURACY) {
  const permissionState = await getGeolocationPermissionState();
  devLog.info(`🔐 Permission géolocalisation: ${permissionState}`);

  const baseOptions = {
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 0
  };

  const firstPosition = await getCurrentPositionWithOptions(baseOptions);
  const firstAccuracy = firstPosition?.coords?.accuracy ?? Number.POSITIVE_INFINITY;

  if (!navigator?.geolocation?.watchPosition || firstAccuracy <= targetAccuracy) {
    return firstPosition;
  }

  devLog.info(`📡 Premier fix GPS à ${Math.round(firstAccuracy)}m, lancement d’un warm-up précision...`);

  const watchDurationMs = firstAccuracy <= 25 ? 6000 : 10000;

  return new Promise((resolve) => {
    let bestPosition = firstPosition;
    let settled = false;
    let watchId = null;
    let timerId = null;

    const finalize = () => {
      if (settled) return;
      settled = true;

      if (timerId) {
        clearTimeout(timerId);
      }

      if (watchId !== null && navigator?.geolocation?.clearWatch) {
        navigator.geolocation.clearWatch(watchId);
      }

      resolve(bestPosition);
    };

    const evaluatePosition = (position) => {
      const accuracy = position?.coords?.accuracy ?? Number.POSITIVE_INFINITY;
      const currentBestAccuracy = bestPosition?.coords?.accuracy ?? Number.POSITIVE_INFINITY;

      if (accuracy < currentBestAccuracy) {
        bestPosition = position;
      }

      if (accuracy <= targetAccuracy) {
        finalize();
      }
    };

    try {
      watchId = navigator.geolocation.watchPosition(
        evaluatePosition,
        () => {},
        {
          enableHighAccuracy: true,
          maximumAge: 0
        }
      );
    } catch (_error) {
      finalize();
      return;
    }

    timerId = setTimeout(finalize, watchDurationMs);
  });
}
