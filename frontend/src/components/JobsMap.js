import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import { useLanguage } from '../contexts/LanguageContext';
import { escapeHtml } from '../utils/htmlEscape';
import 'leaflet/dist/leaflet.css';
// Les icônes par défaut de Leaflet sont référencées par des URL relatives
// dans leaflet.css qui cassent sous un bundler (Vite). On les importe
// explicitement et on les injecte dans Icon.Default pour que les marqueurs
// s'affichent correctement en production.
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

L.Icon.Default.mergeOptions({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

// Position de repli : Dakar (centre de la couverture ouest-africaine).
const DEFAULT_CENTER = [14.7167, -17.4677];
const DEFAULT_ZOOM = 6;

const getJobCoords = (job) => {
  const loc = job?.location || {};
  const lat = Number(loc?.latitude);
  const lng = Number(loc?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat && lng) {
    return [lat, lng];
  }
  const shared = job?.shared_location || {};
  const sharedLat = Number(shared?.latitude);
  const sharedLng = Number(shared?.longitude);
  if (Number.isFinite(sharedLat) && Number.isFinite(sharedLng) && sharedLat && sharedLng) {
    return [sharedLat, sharedLng];
  }
  return null;
};

export default function JobsMap({ jobs }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const navigate = useNavigate();
  const { t } = useLanguage();

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    mapRef.current = map;

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Met à jour les marqueurs quand les jobs changent (sans recréer la carte).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const layerGroup = L.layerGroup().addTo(map);
    const points = (Array.isArray(jobs) ? jobs : [])
      .map((job) => ({ job, coords: getJobCoords(job) }))
      .filter((item) => item.coords);

    points.forEach(({ job, coords }) => {
      // SÉCURITÉ XSS : le popup est construit en HTML brut (Leaflet), donc
      // TOUTES les valeurs contrôlées par l'utilisateur sont échappées — le
      // titre ET la localisation (adresse saisie à la création du job) et
      // l'id. Sans échappement, une adresse contenant un <script> ou un
      // gestionnaire d'événement s'exécuterait au survol du marqueur.
      const title = escapeHtml(job.title || t('mission'));
      const locationText = escapeHtml(job.location_text || job.location?.address || '');
      const jobId = escapeHtml(job.id || '');
      const marker = L.marker(coords).addTo(layerGroup);
      marker.bindPopup(
        `<div style="font-family:inherit;min-width:160px">
           <strong>${title}</strong><br/>
           <span style="font-size:12px;color:#555">${locationText}</span><br/>
           <button data-kojo-job="${jobId}" style="margin-top:6px;background:#ea580c;color:#fff;border:0;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer">${t('viewMission')}</button>
         </div>`
      );
    });

    if (points.length > 0) {
      const bounds = L.latLngBounds(points.map((p) => p.coords));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    } else {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }

    // Navigation depuis le bouton du popup
    const onPopupClick = (event) => {
      const button = event.target.closest('[data-kojo-job]');
      if (button) navigate(`/jobs/${button.getAttribute('data-kojo-job')}`);
    };
    map.on('popupopen', (popupEvent) => {
      const container = popupEvent.popup.getElement();
      container?.addEventListener('click', onPopupClick);
    });

    return () => {
      map.off('popupopen');
      layerGroup.clearLayers();
    };
  }, [jobs, navigate]);

  return <div ref={containerRef} className="h-full w-full" aria-label={t('jobMapAria')} />;
}
