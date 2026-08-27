# Déploiement du backend Kojo sur Fly.io

Guide de migration depuis Render. Fly.io : pas de spin-down, pas de limite
d'heures d'instance, facture prévisible (~0–3 $/mois pour Kojo).

> 🎯 **Bascule définitive** (suppression de Render, UptimeRobot, checklist de
> validation) : voir [`SWITCHOVER_CHECKLIST.md`](./SWITCHOVER_CHECKLIST.md).

## Prérequis

- Compte [Fly.io](https://fly.io) + **carte bancaire** (vérification à
  l'inscription, aucun débit sous l'allocation gratuite).
- `flyctl` installé localement :

  ```bash
  # Windows (PowerShell)
  winget install fly-io.flyctl
  # macOS
  brew install flyctl
  # Linux / WSL
  curl -L https://fly.io/install.sh | sh
  ```

- Se connecter : `fly auth login`

## 1. Créer l'app (une seule fois)

Depuis le dossier `backend/` (le Dockerfile et le fly.toml y sont déjà) :

```bash
cd backend
fly launch --no-deploy
```

- **Nom de l'app** : `kojo-backend` (ou personnaliser, ex. `kojo-backend-03az`).
  C'est ce nom qui forme votre URL : `https://kojo-backend.fly.dev`.
- **Région** : choisir **`fra`** (Francfort) — meilleure latence pour
  l'Afrique de l'Ouest (~100 ms depuis Dakar). Vérifier les régions
  disponibles avec `fly platform regions` (Johannesburg `jnb` existe aussi).
- `fly launch` va détecter le `fly.toml` existant ; répondre **non** quand il
  propose de créer un autre Dockerfile.

## 2. Poser les secrets (obligatoire avant le 1er déploiement)

Copier depuis Render (Dashboard → Environment) **les mêmes valeurs** :

```bash
fly secrets set \
  "MONGO_URL=mongodb+srv://..." \
  "JWT_SECRET=..." \
  "EMAIL_OTP_SECRET=..." \
  "BACKEND_PUBLIC_URL=https://kojo-backend.fly.dev" \
  "OWNER_EMAIL=..." \
  "OWNER_INITIAL_PASSWORD=..." \
  "OWNER_USER_ID=..." \
  "PAYDUNYA_MODE=live" \
  "PAYDUNYA_MASTER_KEY=..." \
  "PAYDUNYA_PRIVATE_KEY=..." \
  "PAYDUNYA_TOKEN=..." \
  "PAYDUNYA_STORE_NAME=KOJO" \
  "EMAIL_PROVIDER=brevo" \
  "BREVO_API_KEY=..." \
  "BREVO_SENDER_EMAIL=..." \
  "BREVO_SENDER_NAME=KOJO" \
  "CLOUDINARY_CLOUD_NAME=..." \
  "CLOUDINARY_API_KEY=..." \
  "CLOUDINARY_API_SECRET=..." \
  "VAPID_PRIVATE_KEY=..." \
  "VAPID_PUBLIC_KEY=..." \
  "VAPID_CLAIMS_EMAIL=mailto:kojoapp98@gmail.com"
```

**Règles d'or :**

- 🔒 **`EMAIL_OTP_SECRET` ne doit JAMAIS être changé** (il signe les jetons de
  vérification email et les OTP — le changer invalide tous les jetons déjà
  émis). Copier la valeur **exacte** de Render.
- ✅ **`BACKEND_PUBLIC_URL` est obligatoire** : sans elle, le
  TrustedHostMiddleware rejette les requêtes vers `*.fly.dev` (erreur 400) et
  les callbacks IPN PayDunya seraient construits sans domaine (donc cassés).
- 📧 **`VAPID_CLAIMS_EMAIL`** (claim `sub` des notifications push, RFC 8292) :
  doit être une URI `mailto:` **sans espace** après le schéma
  (`mailto:kojoapp98@gmail.com` ✅, `mailto: kojoapp98@gmail.com` ❌). La valeur
  déployée sur Fly est **`mailto:kojoapp98@gmail.com`** — elle doit rester
  identique à celle de `.env.example`. Un garde-fou CI
  (`backend/tests/test_vapid_sub_claim.py`) vérifie le format des références
  du dépôt à chaque push.
- **`REDIS_URL` (recommandé en prod)** : active un rate-limiting PARTAGÉ
  multi-workers. Sans Redis, le rate-limiter reste en mémoire par process
  (limites effectives × N workers, non partagées). Provisionner un Redis sur
  Fly (`fly redis create` ou Upstash) puis :
  ```bash
  fly secrets set REDIS_URL="redis://default:<password>@<host>:6379"
  fly deploy
  ```
  Le client Redis se ré-initialise paresseusement si Redis était brièvement
  down au boot (plus besoin de redéployer pour le récupérer).
- Optionnels : `SENTRY_DSN`, `PAYMENT_COMMISSION_RATE`,
  `EMAIL_OTP_*`, `CORS_ORIGINS`, `TRUSTED_HOSTS` (pour un domaine
  personnalisé type `api.kojo.app`).
- `APP_ENV`, `DB_NAME`, `FRONTEND_APP_URL`, `VERCEL_PROJECT_NAME` sont déjà
  dans `backend/fly.toml`.

## 3. Premier déploiement

```bash
fly deploy
```

## 4. Vérifications

```bash
# Health check (attendre "database": "connected")
curl -s https://kojo-backend.fly.dev/health

# /docs doit être en 404 (APP_ENV=production)
curl -s -o /dev/null -w '%{http_code}\n' https://kojo-backend.fly.dev/docs

# Racine
curl -s https://kojo-backend.fly.dev/
```

Logs : `fly logs` · État : `fly status`

### 4bis. Audit des variables d'environnement (format + présence)

Un script d'audit réutilisable vérifie le FORMAT et la PRÉSENCE des
variables critiques (CORS_ORIGINS, VAPID_CLAIMS_EMAIL, URLs publiques,
TRUSTED_HOSTS, REDIS_URL, MONGO_URL) sur 3 plans :

```bash
# 1) Formats des RÉFÉRENCES du dépôt (déterministe, SANS token ni réseau —
#    rejouable localement et lancé par la CI à chaque push) :
python .github/scripts/check-fly-env-drift.py --refs-only

# 2) Drift doc↔prod + présence des secrets + formats DÉPLOYÉS (nécessite
#    FLY_API_TOKEN ; les valeurs des secrets sont lues via SSH et masquées,
#    jamais affichées) :
FLY_API_TOKEN=<deploy_token> python .github/scripts/check-fly-env-drift.py
```

Le check valide :

- **`CORS_ORIGINS`** : CSV d'origines https://, sans slash final, sans
  localhost/127.0.0.1 ni entrée vide ;
- **`VAPID_CLAIMS_EMAIL`** : URI `mailto:` ou `https:` sans espace (RFC 8292) ;
- **`BACKEND_PUBLIC_URL` / `FRONTEND_APP_URL`** : URL https://, sans slash
  final (un slash final casse les callbacks IPN PayDunya — le runtime ne
  normalise pas) ;
- **`TRUSTED_HOSTS`** : CSV d'hôtes, motifs joker `*.` autorisés (trafic
  interne Fly des health checks) ;
- **`REDIS_URL`** : URI `redis://` ou `rediss://` (vide = mémoire, accepté) ;
- **`MONGO_URL`** : URI `mongodb://` ou `mongodb+srv://` (Atlas).

Valeurs de référence contrôlées : `backend/fly.toml [env]` (config de prod),
`backend/.env.example` (template dev — les valeurs vides et `http://localhost`
sont ignorées) et `backend/DEPLOY_FLYIO.md` (bloc `fly secrets set`, les
placeholders `...` ignorés).

## 5. Mettre à jour le frontend Vercel

Le frontend pointe encore vers Render (`VITE_API_URL`). Le changer dans le
dashboard Vercel (Settings → Environment Variables) :

```
VITE_API_URL=https://kojo-backend.fly.dev/api
```

> ⚠️ Faire la bascule **au moment voulu** : tant que Render tourne, le
> frontend continue de l'utiliser. Les deux backends partagent le même
> MongoDB Atlas, donc aucun risque de divergence de données — on peut même
> tester Fly.io en parallèle avant de basculer.

## 6. PayDunya

Les URLs de callback IPN (`/api/payments/ipn/paydunya` et
`/api/payments/disburse-ipn`) sont construites automatiquement à partir de
`BACKEND_PUBLIC_URL` à la création de chaque facture — **rien à configurer
dans le dashboard PayDunya**. Chaque IPN est de toute façon re-confirmée
auprès de PayDunya (jamais de confiance au payload).

## 7. Redéploiements & rollback

- Chaque `fly deploy` relit le code du dépôt (branche courante) et rebuild
  l'image.
- Rollback : `fly releases` puis `fly rollback <id>`.
- Les machines ne s'arrêtent jamais (`auto_stop_machines = false`) : pas de
  cold start, **plus besoin d'UptimeRobot en anti-sleep** (à garder seulement
  en moniteur d'alerte sur `https://kojo-backend.fly.dev/health`).

## 8. Auto-déploiement GitHub Actions (comme l'auto-deploy Render)

Le job `deploy-fly` de `.github/workflows/ci.yml` déploie le backend sur
Fly.io à chaque push sur `main` touchant `backend/**` — **mais uniquement si
le job `backend-tests` passe** (verrouillage CI). Un échec frontend/mobile
ne bloque pas le déploiement backend. Seul le backend est concerné (le
frontend reste déployé par Vercel).

Prérequis (une seule fois) :

1. Créer un token de déploiement :
   ```bash
   fly tokens create deploy -n "GitHub Actions"
   ```
2. L'ajouter comme secret du dépôt GitHub : **Settings → Secrets and
   variables → Actions → New repository secret** → nom `FLY_API_TOKEN`.

Détails : build distant (`--remote-only`, pas de Docker sur le runner),
`needs: backend-tests` + filtre `dorny/paths-filter` sur `backend/**`,
`concurrency` pour ne pas entremêler deux déploiements. Les secrets
applicatifs restent posés sur l'app Fly (ils ne transitent pas par le workflow).

## 9. Coûts

| Configuration | Coût |
|---|---|
| `memory = "256mb"` (fly.toml) | **0 $/mois** (allocation : 3 VMs incluses) — risque OOM |
| `memory = "512mb"` (config actuelle) | ~2,93 $/mois ≈ **1 900 FCFA** |

Changer la RAM : éditer `memory` dans `backend/fly.toml`, puis `fly deploy`.

## Dépannage rapide

- **Déploiement bloqué : `400 Bad Request` en boucle sur `/health` dans les
  logs** → le TrustedHostMiddleware rejette le Host des health checks de Fly.
  `build_trusted_hosts()` couvre désormais par défaut `*.internal`,
  `*.flycast.internal` et `*.fly.dev` → le Host des sondes Fly est accepté.
  Si le symptôme persiste (Host attendu non couvert), vérifier qu'aucun secret
  `DISABLE_TRUSTED_HOST_MIDDLEWARE=true` ne surcharge la config, puis
  ajouter le motif exact via `fly secrets set TRUSTED_HOSTS='*.internal,...'`.
  Re-désactiver en dernier recours : `fly secrets set DISABLE_TRUSTED_HOST_MIDDLEWARE=true`.
- **Machine arrêtée après 5 min (`Trial machine stopping`)** → aucune carte
  bancaire sur le compte : ajouter la carte (Dashboard → Billing ou
  https://fly.io/trial) puis `fly deploy`.
- **Attention : `fly launch` RÉGÉNÈRE `fly.toml`** et écrase les commentaires/
  variables ajoutés à la main. Après un `fly launch`, revérifier que
  `BACKEND_PUBLIC_URL` et `TRUSTED_HOSTS` sont toujours présents dans `[env]`.
- **Erreur 400 Bad Request sur `*.fly.dev`** → `BACKEND_PUBLIC_URL` absent :
  `fly secrets set BACKEND_PUBLIC_URL "https://<ton-app>.fly.dev"` puis
  `fly deploy`.
- **Crash au boot (OOM)** → passer `memory` de `256mb` à `512mb`.
- **`RuntimeError: JWT_SECRET ... not set`** → secrets manquants (section 2).
- **`Suspending` dans `fly status`** → mémoire insuffisante ; vérifier les
  logs `fly logs` et augmenter la RAM.
