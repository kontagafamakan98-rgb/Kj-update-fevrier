# Bascule définitive Render → Fly.io — Checklist

Objectif : arrêter la facture Render et ne dépendre que de Fly.io, **sans
aucune perte de données** (les deux backends partagent le même MongoDB Atlas,
donc la bascule est sans risque de divergence).

> ⏱️ Durée totale : ~30 min. À faire **en bloc**, un jour où tu peux tester
> les paiements (pour valider le flux complet avant de couper Render).

---

## Étape 0 — Prérequis (tout doit être ✅ avant de commencer)

- [ ] **Carte bancaire ajoutée sur Fly** (sinon la machine s'arrête après 5 min) :
      Dashboard Fly → Billing. Vérif : `fly status` ne montre pas « trial ».
- [ ] **Backend Fly healthy** :
      `curl https://kojo-backend.fly.dev/health` → `"database":"connected"`
- [ ] **Frontend Vercel pointe vers Fly** :
      Vercel → projet → Settings → Environment Variables → `VITE_API_URL`
      doit valoir `https://kojo-backend.fly.dev/api` (puis redeploy).
- [ ] **CI `deploy-fly` passe** (le secret `FLY_API_TOKEN` est un *Repository
      secret*, pas un *Environment*) : dernier run GitHub Actions en vert.
- [ ] **Clés VAPID valides** (notifications push) : le backend renvoie une clé
      publique décodable (65 octets) sur `/api/notifications/vapid-public-key`.
- [ ] Avoir **une commande de test PayDunya en mode sandbox** prête (montant
      symbolique) pour valider le checkout + l'IPN.

---

## Étape 1 — Validation en parallèle (les deux backends tournent)

Tant que Render tourne, tester **tout le parcours utilisateur** sur la
nouvelle URL (le frontend pointe déjà vers Fly) :

- [ ] **Connexion / inscription** (le profil se charge, plus d'erreur console)
- [ ] **Profil** : chargement des comptes de paiement (le bug `/api/api` est
      corrigé — vérifier qu'aucun 404 n'apparaît dans la console F12)
- [ ] **Géolocalisation** : le pays est détecté (plus d'erreur CSP
      `ipapi.co` / `ipinfo.io`)
- [ ] **Envoi d'OTP email** (vérification email / reset password)
- [ ] **Photos de profil** : upload + affichage (Cloudinary)
- [ ] **Messages / conversations** : envoi et réception
- [ ] **Paiement sandbox PayDunya** : checkout → paiement simulé → retour → le
      statut de la commande passe à payé (l'IPN revient sur Fly via
      `BACKEND_PUBLIC_URL`)
- [ ] **Notifications push** : souscrire depuis un appareil, déclencher une
      notification, la recevoir
- [ ] **Logs Fly propres** : `fly logs` — aucune traceback, aucun 5xx

> ⚠️ Si un point échoue : le corriger **avant** de supprimer Render (on peut
> basculer le frontend sur Render le temps de corriger — même base de données).

---

## Étape 2 — Supprimer le service payant Render (arrête la facture)

**Avant de supprimer — double contrôle (2 min) :**

- [ ] Comparer **les secrets** : Dashboard Render → ton service → Environment,
      et `fly secrets list` → les mêmes valeurs sont posées sur Fly
      (surtout `MONGO_URL`, `JWT_SECRET`, `EMAIL_OTP_SECRET`, `PAYDUNYA_*`).
- [ ] Confirmer que **MongoDB est bien sur Atlas** (pas un add-on Render) :
      `MONGO_URL` commence par `mongodb+srv://` → c'est Atlas, aucune donnée
      chez Render. ✅
- [ ] Confirmer qu'**aucune autre app** (ex. un cron, un autre frontend) ne
      pointe encore vers l'URL Render `...onrender.com`.

**Suppression :**

1. Dashboard Render → ton service web payant → **Settings** (en bas) →
   **Delete Web Service** → taper le nom du service pour confirmer.
2. (Si tu avais un **Redis Render**) : le supprimer aussi, sauf si
   `REDIS_URL` est posé sur Fly (le rate-limiting est en mémoire avec 1
   worker, donc pas de Redis nécessaire pour l'instant).
3. Vérifier qu'aucune facture ne reste : Dashboard Render → Billing →
   plus aucun service actif.

---

## Étape 3 — UptimeRobot sur la nouvelle URL

1. UptimeRobot → Dashboard → ton moniteur existant → **Edit**.
2. **URL** → `https://kojo-backend.fly.dev/health`.
3. **Type** : HTTP(S) → **Keyword** : `healthy` (ou `database`).
4. **Intervalle** : 5 min (le plus fréquent gratuit) — **plus besoin
   d'anti-sleep** : les machines Fly ne s'endorment jamais.
5. **Alert contacts** : garder ton email/Telegram.
6. Sauvegarder → le moniteur doit passer au **vert** en < 1 min.

---

## Étape 4 — Post-bascule (vérifications finales)

- [ ] `curl https://kojo-backend.fly.dev/health` → healthy (même après la
      suppression de Render)
- [ ] Le **frontend fonctionne toujours** (Vercel → Fly) : connexion réelle
      depuis ton téléphone (réseau mobile, pas juste le PC)
- [ ] Un **paiement réel** (petit montant) si l'occasion se présente
- [ ] `fly logs` sur 24-48 h : aucune erreur, aucun crash
- [ ] **Facture Fly** à la fin du mois : ~0–3 $ (pas de surprise)

---

## Rollback (si problème après bascule)

Les données sont dans MongoDB Atlas (partagé), donc **rien n'est perdu** :

1. **Re-poser `VITE_API_URL` sur l'ancienne URL Render** sur Vercel →
   redeploy (si Render n'est pas encore supprimé).
2. Si Render est déjà supprimé : **recréer le service** depuis le dépôt
   (`render.yaml` / build depuis GitHub) → re-poser les secrets → le
   frontend rebascule.
3. Le contenu (utilisateurs, commandes, paiements) est intact grâce à Atlas.

---

## Nettoyage optionnel (fait par le dépôt)

Les URLs Render en dur dans le frontend (fallbacks `api.js`, `backendUrl.js`,
`vite.config.js`) ont été remplacées par l'URL Fly — plus aucune dépendance
codée en dur à Render. Vérifier que le commit correspondant est bien poussé.
