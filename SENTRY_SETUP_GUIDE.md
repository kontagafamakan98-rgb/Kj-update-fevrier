# 📊 Guide de Configuration Sentry — Kojo (frontend + backend)

Sentry est un outil de monitoring d'erreurs (issues, stack traces, contexte
utilisateur, breadcrumbs). Il est **optionnel** : sans les variables
d'environnement ci-dessous, le code est un no-op et l'application fonctionne
exactement comme avant.

## État actuel du code

| Couche | Package | Init | Variables d'activation |
|---|---|---|---|
| Frontend (Vercel) | `@sentry/react` (déjà dans package.json) | `src/index.js` → `initSentry()` | `VITE_SENTRY_ENABLED=true` + `VITE_SENTRY_DSN` |
| Backend (Render) | `sentry-sdk` (déjà dans requirements.txt) | `server.py` → `_init_sentry()` | `SENTRY_DSN` |

Les variables sont documentées dans `frontend/.env.example` et
`backend/.env.example`.

---

## Étape 1 — Créer les projets Sentry

1. Créer un compte sur [sentry.io](https://sentry.io) (plan gratuit :
   10 000 événements/mois).
2. Créer un projet **« React »** (ou « JavaScript ») → DSN **frontend**.
3. Créer un projet **« FastAPI »** (ou « Python ») → DSN **backend**.

Chaque projet a son propre DSN (Settings → Projects → *projet* → Client
Keys / DSN). Le DSN a la forme `https://<clé>@sentry.io/<project_id>`.

---

## Étape 2 — Frontend : activer sur Vercel

Projet Vercel : `kj-update-fevrier` (répertoire racine `frontend/`).

1. **Project Settings → Environment Variables**, ajouter :
   - `VITE_SENTRY_ENABLED` = `true`
   - `VITE_SENTRY_DSN` = `<DSN frontend>`
2. **Ne PAS cocher « Sensitive »** : les variables `VITE_*` sont lues au
   moment du **build** (inlinées dans le bundle JS). Une variable marquée
   « Sensitive » n'est pas exposée au build et le monitoring resterait inactif.
3. **Redéployer** (Production Deploy). Sans redéploiement, le bundle
   existant ne contient pas le DSN.

> 🔓 Le DSN frontend est **public par design** : il est embarqué dans le
> bundle JS que tous les visiteurs téléchargent. La protection se configure
> dans Sentry (Settings → Security & Privacy → **Allowed Domains** :
> `*.vercel.app`) pour que seuls vos domaines puissent envoyer des événements.

---

## Étape 3 — Backend : activer sur Render

Service Render : `kojo-backend` (voir `backend/.env.example`).

1. **Environment** (onglet du service) → **Add Environment Variable** :
   - `SENTRY_DSN` = `<DSN backend>`
2. **Deploy** (ou push sur `main`, selon la config auto-deploy).

> 🔒 Le DSN backend est un **secret** : ne jamais le mettre dans du code
> client, un `.env` committé ou une variable `VITE_*`.

### Vérification côté backend

Dans les logs Render au démarrage :

```
✅ Sentry activé (backend)
```

ou, si le DSN est absent/invalide :

```
⚠️ Sentry non initialisé (backend): ...
```

---

## Étape 4 — Vérifier la réception des erreurs

1. Frontend : ouvrir l'app en production et déclencher une erreur (ex. page
   inexistante). Dans Sentry → **Issues**, l'erreur doit apparaître avec la
   stack trace et, après connexion, l'utilisateur (`setUser` appelé depuis
   AuthContext).
2. Backend : appeler une route en erreur ; l'issue doit apparaître avec
   `environment` = `production` (valeur de `APP_ENV` sur Render).

---

## Configuration embarquée (rappel)

- **Frontend** (`src/utils/sentry.js`) : `tracesSampleRate: 0.1`, ignore des
  erreurs réseau 2G/3G (`Network Error`, `Failed to fetch`…), `setUser`
  (id, email, pays) après connexion, helpers `captureError` /
  `captureMessage` / `addBreadcrumb`.
- **Backend** (`server.py`) : `traces_sample_rate=0.1`,
  `send_default_pii=False` (jamais d'emails/téléphones envoyés), intégrations
  FastAPI/Starlette.

---

## Désactiver Sentry

- **Frontend** : `VITE_SENTRY_ENABLED=false` (ou retirer les deux variables)
  puis redéployer.
- **Backend** : retirer `SENTRY_DSN` puis redéployer.

Le code retombe en no-op dans les deux cas — aucun impact sur le
fonctionnement de l'application.

---

## 🆘 Support

- Documentation Sentry : https://docs.sentry.io
- Plateforme JS/React : https://docs.sentry.io/platforms/javascript/guides/react/
- Plateforme Python/FastAPI : https://docs.sentry.io/platforms/python/guides/fastapi/
- Dashboard : https://sentry.io

---

**Configuration actuelle :** ❌ désactivée — à activer via les étapes 2 et 3.
