import { devLog } from '../utils/env';
import { api } from './api';

export const IP_GEOLOCATION_SERVICES = [
  {
    name: 'KojoBackend',
    path: '/geolocation/detect',
    isBackend: true,
    parser: (data) => {
      if (!data?.country || data.detected === false) return null;
      return {
        country: data.country.code?.toUpperCase(),
        countryName: data.country.name,
        city: data.country.capital || '',
        region: '',
        latitude: data.country.coordinates?.lat,
        longitude: data.country.coordinates?.lng,
        accuracy: data.detected ? 95 : 80,
        timezone: data.country.timezone
      };
    }
  }
];

export async function fetchIpGeolocationServices(services = IP_GEOLOCATION_SERVICES) {
  const results = [];
  const promises = services.map(async (service) => {
    try {
      devLog.info(`📡 Test service ${service.name}...`);
      const data = await api.get(service.path);
      const parsed = service.parser(data);
      devLog.info(`✅ ${service.name} réponse:`, parsed);
      if (parsed && parsed.latitude && parsed.longitude) {
        results.push({
          service: service.name,
          ...parsed
        });
      }
    } catch (error) {
      devLog.info(`⚠️ Service ${service.name} échoué:`, error?.message);
    }
  });

  await Promise.allSettled(promises);
  return results;
}
