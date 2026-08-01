/* eslint-disable no-restricted-globals */
//
// KOJO — Service Worker "kill switch"
// ------------------------------------------------------------------
// Kojo n'utilise plus de Service Worker (voir src/index.js, qui appelle
// serviceWorkerRegistration.unregister()). Ce fichier existe uniquement
// pour NETTOYER les navigateurs qui ont encore une ancienne version du
// Service Worker active (installee avant ce correctif).
//
// Pourquoi c'est necessaire : un navigateur qui a deja installe un
// Service Worker continue de l'utiliser tant que le NAVIGATEUR ne
// detecte pas que le fichier /service-worker.js a change d'octets.
// Simplement arreter d'appeler register() ne suffit donc pas a faire
// disparaitre les Service Workers deja actifs chez les utilisateurs :
// eux continuent de recevoir de vieilles pages/JS mis en cache, ce qui
// provoquait les plantages ("kojo crashe") apres chaque mise a jour.
//
// Ce script : prend le controle immediatement, vide TOUS les caches
// crees par les anciennes versions (kojo-v1.0.0, kojo-runtime-v1.0.0,
// kojo-pwa-v2-fixed, etc.), se desinscrit lui-meme, puis recharge les
// onglets ouverts pour qu'ils repartent sur une base 100% reseau.
// ------------------------------------------------------------------

self.addEventListener('install', () => {
  // Ne pas attendre : on veut prendre la main tout de suite pour nettoyer.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        // 1) Supprimer tous les caches, quel que soit leur nom/version
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      } catch (err) {
        // silencieux : on veut quand meme continuer le nettoyage
      }

      try {
        // 2) Ce Service Worker se desinscrit lui-meme : plus aucun
        //    Service Worker Kojo ne controlera les prochaines visites.
        await self.registration.unregister();
      } catch (err) {
        // ignore
      }

      try {
        // 3) Recharger les onglets ouverts pour repartir sur du frais
        const allClients = await self.clients.matchAll({ type: 'window' });
        allClients.forEach((client) => {
          try {
            client.navigate(client.url);
          } catch (err) {
            // ignore
          }
        });
      } catch (err) {
        // ignore
      }
    })()
  );
});

// Ne rien intercepter : laisser passer toutes les requetes au reseau.
self.addEventListener('fetch', () => {});
