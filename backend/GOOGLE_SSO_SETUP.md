# Activation du SSO Google (connexion / inscription) en production

Guide pas-à-pas pour activer le bouton « Continuer avec Google » sur Kojo.
Le code est déjà implémenté (backend + frontend) et testé : il ne reste que la
configuration des credentials Google et leur injection dans l'environnement.

> **Sans configuration, rien ne casse** : si `GOOGLE_CLIENT_ID` /
> `GOOGLE_CLIENT_SECRET` sont absents, `GOOGLE_AUTH_ENABLED=false` (backend) et
> le bouton Google est simplement masqué côté frontend.

## Rappel du flux (pour comprendre ce qu'on configure)

1. Le frontend ouvre la popup Google (Google Identity Services, PKCE,
   `ux_mode=popup`, `redirect_uri=postmessage`) et récupère un **code**
   d'autorisation — jamais l'id_token.
2. Le frontend envoie ce code à `POST /api/auth/google` (via le proxy
   même-origine Vercel `/api/*` → Fly).
3. Le backend échange le code contre un id_token auprès de
   `https://oauth2.googleapis.com/token`, puis vérifie la **signature** et
   l'**audience** via `tokeninfo`. Il crée le compte, lie automatiquement si
   l'email existe, ou renvoie `email_exists` pour la fusion sécurisée
   (`POST /api/auth/google/link`).

---

## Étape 1 — Créer les credentials OAuth dans la console Google

1. Aller sur la [Google Cloud Console](https://console.cloud.google.com/) →
   sélectionner (ou créer) le projet Kojo.
2. **Console → APIs & Services → OAuth consent screen** :
   - User type : **External**.
   - Renseigner le nom de l'app (ex. « KOJO ») et l'email de support.
   - Scopes : les scopes par défaut `openid email profile` suffisent (aucune
     donnée sensible demandée).
   - **Test users** : en mode « Testing », seuls les emails listés peuvent se
     connecter. **Publier** l'app (Publish app) avant la mise en production,
     sinon les utilisateurs réels seront bloqués.
3. **Console → APIs & Services → Credentials → Create credentials →
   OAuth client ID** :
   - **Application type : Web application**.
   - **Authorized JavaScript origins** (pour le flux popup) :
     - `https://kj-update-fevrier.vercel.app`
     - `http://localhost:3000` (dev local)
   - **Authorized redirect URIs** : en mode popup, l'échange du code utilise
     l'**origine** de la page comme `redirect_uri` — déclarer donc l'origine
     SANS chemin :
     - `https://kj-update-fevrier.vercel.app`
     - `http://localhost:3000`
   - Créer → noter le **Client ID** et le **Client secret**.

> ⚠️ Le **même** `client_id` est utilisé côté frontend (bouton) ET côté backend
> (vérification de l'audience). C'est important : le backend rejette tout
> id_token dont l'audience ne correspond pas à `GOOGLE_CLIENT_ID`.

---

## Étape 2 — Configurer le backend Fly

Poser les 3 secrets sur l'app Fly (depuis `backend/`) :

```bash
fly secrets set \
  "GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com" \
  "GOOGLE_CLIENT_SECRET=GOCSPX-..." \
  "GOOGLE_REDIRECT_URI=https://kj-update-fevrier.vercel.app"
```

Puis redéployer :

```bash
fly deploy
```

**Détail de chaque variable :**

| Variable | Rôle | Requis ? |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Identifiant OAuth (aussi utilisé comme audience de vérification) | ✅ |
| `GOOGLE_CLIENT_SECRET` | Secret du client OAuth (échange du code) | ✅ |
| `GOOGLE_REDIRECT_URI` | **Origine** du frontend, repli si l'échange ne reçoit pas d'origine | ⚠️ (recommandé) |

> **Point clé — l'échange du code utilise l'ORIGINE, pas une URL de callback.**
> En mode popup (Google Identity Services, `initCodeClient`), Google **ignore**
> `redirect_uri` côté client et utilise **l'origine de la page appelante** comme
> `redirect_uri` du code (ex: `https://kj-update-fevrier.vercel.app`). À
> l'échange (`/token`), le backend doit donc envoyer cette **même origine** —
> pas une URL de callback comme `/auth/google/callback` (sinon
> `redirect_uri_mismatch`).
>
> Le backend récupère automatiquement l'origine de la page appelante via le
> **header `Origin`** de la requête (le proxy même-origine Vercel le transmet
> tel quel) et l'utilise comme `redirect_uri` de l'échange. `GOOGLE_REDIRECT_URI`
> sert de **repli** pour les clients non navigateur (sans header Origin) :
> mettez-y l'origine `https://kj-update-fevrier.vercel.app`.
>
> ⚠️ L'origine doit être déclarée dans la console Google (Étape 1) — à la fois
> en **Authorized JavaScript origin** ET en **Authorized redirect URI** — sinon
> l'échange échoue (Google vérifie le `redirect_uri` de l'échange contre les
> URIs autorisées).

**Vérifier que le backend a bien activé Google :**

```bash
# Les logs ne doivent plus contenir d'erreur de config Google au boot
fly logs

# Appel direct : un code invalide (≥ 20 caractères pour passer la validation)
# doit renvoyer un 401 (échange refusé) et PAS un 503 (config absente).
# Un 503 signifie que les secrets ne sont pas posés.
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://kojo-backend.fly.dev/api/auth/google \
  -H 'Content-Type: application/json' \
  -d '{"code":"invalid_code_placeholder_xxxxx"}'
# 401 = GOOGLE_AUTH_ENABLED ✓ (l'échange est tenté) · 503 = secrets manquants
```

---

## Étape 3 — Configurer le frontend Vercel

Le frontend lit le client_id via **`VITE_GOOGLE_CLIENT_ID`** (injecté au build)
ou `window.__KOJO_GOOGLE_CLIENT_ID__` (override runtime, utile pour tester sans
redéployer).

### Option A — Variable de build (recommandé)

Dans le dashboard **Vercel → projet `kj-update-fevrier` → Settings →
Environment Variables** :

```
Name:  VITE_GOOGLE_CLIENT_ID
Value: xxxxx.apps.googleusercontent.com
```

Puis **Redeploy** (une variable `VITE_*` nécessite un nouveau build ; elle n'est
pas lue à chaud).

### Option B — Override runtime (test rapide, sans redéployer)

Le client_id peut être injecté à chaud (utile pendant la phase de test) :

```html
<script>
  window.__KOJO_GOOGLE_CLIENT_ID__ = "xxxxx.apps.googleusercontent.com";
</script>
```

> Le bouton Google n'apparaît que si un client_id est disponible. Sans lui, le
> formulaire classique (email + mot de passe) reste inchangé.

---

## Étape 4 — Vérifier de bout en bout

1. Ouvrir `https://kj-update-fevrier.vercel.app` (en incognito).
2. Aller sur **Connexion** → cliquer **« Continuer avec Google »**.
3. Choisir un compte Google → la popup se ferme → l'utilisateur est connecté.
4. **Première connexion** : le compte est créé (sans OTP email — l'email Google
   est déjà vérifié) et l'utilisateur est redirigé vers l'**onboarding
   paiement** (`/payment-verification`) pour ajouter ses comptes de paiement.
5. **Utilisateur dont l'email existe déjà** : le backend renvoie
   `email_exists` → le frontend invite à se connecter puis à **lier** le compte
   Google depuis le profil (fusion sécurisée, mot de passe requis).
6. **Déconnexion / reconnexion** : le compte Google se reconnecte sans
   mot de passe.

**Cas à tester :**

| Scénario | Comportement attendu |
|---|---|
| Email Google jamais utilisé | Compte créé + onboarding paiement |
| Email déjà inscrit (mot de passe) | `email_exists` → fusion via le profil |
| Compte SSO → connexion email/mot de passe | Refusée (aucun hash stocké) |
| Email Google non vérifié | 401 « Email non vérifié par Google » |
| id_token d'une autre app (audience mismatch) | 401 « Jeton Google invalide » |

---

## Dépannage rapide

- **Le bouton Google n'apparaît pas** → `VITE_GOOGLE_CLIENT_ID` absent au build
  (ou `window.__KOJO_GOOGLE_CLIENT_ID__` non défini). Vérifier la variable
  Vercel et redéployer.
- **503 « La connexion Google n'est pas configurée sur le serveur »** →
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` absents côté Fly : poser les
  secrets puis `fly deploy`.
- **`redirect_uri_mismatch`** → l'échange a envoyé un `redirect_uri` non
  déclaré. Vérifier que l'**origine** du frontend (ex:
  `https://kj-update-fevrier.vercel.app`) est bien dans les **Authorized
  redirect URIs** ET les **Authorized JavaScript origins** de la console
  Google, et que `GOOGLE_REDIRECT_URI` (Fly) contient cette même origine.
- **401 « Jeton Google invalide »** → l'audience de l'id_token ne correspond pas
  à `GOOGLE_CLIENT_ID` : vérifier que le même client_id est utilisé côté
  frontend et backend.
- **« Accès refusé » dans la popup Google** → l'app est encore en mode
  « Testing » : publier l'app dans l'écran de consentement OAuth, ou ajouter
  l'email aux test users.
- **Erreur 401 au login après avoir lié Google** → normal pour un compte SSO :
  il se connecte uniquement via Google, pas via le formulaire mot de passe.

---

## Liens utiles

- Console Google Cloud : <https://console.cloud.google.com/apis/credentials>
- Doc Google Identity Services (flux code + PKCE) :
  <https://developers.google.com/identity/oauth2/web/guides/use-code-model>
- Déploiement backend sur Fly : [`DEPLOY_FLYIO.md`](./DEPLOY_FLYIO.md)
