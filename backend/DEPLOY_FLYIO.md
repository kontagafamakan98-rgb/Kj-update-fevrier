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
  C'est ce nom qui forme votre URL : `https://api.kojoforafrica.cc.cd`.
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
  "BACKEND_PUBLIC_URL=https://api.kojoforafrica.cc.cd" \
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
- 📥 **Webhooks Resend (rebonds, plaintes)** — `POST /api/email/resend-webhook`.
  Resend y annonce qu'une adresse a rebondi ou que son destinataire nous a
  signalés comme spam ; le backend marque alors l'adresse injoignable et
  **cesse de lui écrire** (un rebond ignoré est un échec silencieux : on croit
  avoir prévenu, personne n'a rien reçu).

  Déclarer l'URL dans le tableau de bord Resend (Webhooks → Add endpoint),
  puis copier le **Signing Secret** (il commence par `whsec_`) dans
  `RESEND_WEBHOOK_SECRET` :
  ```bash
  fly secrets set RESEND_WEBHOOK_SECRET="whsec_…"
  fly deploy
  ```
  Sans ce secret, la route **refuse** tout appel (503) au lieu de supprimer une
  adresse sur la parole du premier venu — la fonctionnalité reste donc
  désactivée tant qu'il n'est pas posé, et le reste du backend fonctionne.
  Vérification :
  `curl -X POST -H 'content-type: application/json' -d '{}' \
   https://<ton-app>.fly.dev/api/email/resend-webhook` → **401** (signature
  absente) si le secret est posé, **503** (ingestion désactivée) sinon — dans
  les deux cas jamais 200 : une requête non signée ne retient aucune adresse.

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
- 📧 **Expéditeur transactionnel SUR LE DOMAINE** : `BREVO_SENDER_EMAIL` doit
  valoir une adresse du domaine (`noreply@kojoforafrica.cc.cd`), jamais une
  adresse Gmail. Brevo envoie sous l'identité déclarée dans le payload : une
  adresse Gmail n'applique ni SPF, ni DKIM, ni DMARC du domaine (d'où les
  emails en spam).

  Le domaine porte **quatre** enregistrements, tous publiés chez DNSHE. Brevo
  ne distribue plus une clé DKIM en TXT : il donne deux **CNAME** vers sa
  propre infrastructure, qui sert la clé publique (et permet de la faire
  tourner sans republier d'enregistrement) :

  | Nom | Type | Valeur |
  |---|---|---|
  | `@` | TXT | `v=spf1 include:spf.brevo.com ~all` |
  | `brevo1._domainkey` | CNAME | `b1.kojoforafrica-cc-cd.dkim.brevo.com` |
  | `brevo2._domainkey` | CNAME | `b2.kojoforafrica-cc-cd.dkim.brevo.com` |
  | `@` | TXT | `brevo-code:a433622abb3dee4d75550ea815ebca1e` |
  | `_dmarc` | TXT | `v=DMARC1; p=quarantine; pct=10; rua=mailto:rua@dmarc.brevo.com` |

  Les valeurs exactes se relisent avec
  `GET https://api.brevo.com/v3/senders/domains/kojoforafrica.cc.cd`
  (en-tête `api-key`) — jamais de mémoire, Brevo les régénère par compte.

  ⚠️ **Un script qui appelle Brevo (ou l'API DNSHE) doit poser un `User-Agent`
  explicite** : Cloudflare protège les deux et répond
  `403 browser_signature_banned` (erreur 1010) à la signature d'`urllib`. Le
  backend, lui, utilise `requests` et passe — d'où un symptôme qui n'apparaît
  que dans les outils d'exploitation, jamais en production.

  ⚠️ **L'ordre compte** : publier SPF + DKIM + `brevo-code`, **authentifier le
  domaine dans Brevo** (`PUT /senders/domains/{domaine}/authenticate`), ajouter
  l'expéditeur (`POST /senders`), et seulement ensuite changer
  `BREVO_SENDER_EMAIL` sur Fly. Brevo refuse d'envoyer depuis un expéditeur non
  vérifié : dans l'autre sens, la bascule coupe les emails de production (OTP,
  resets, reçus).
  Vérifier aussi `PASSWORD_RESET_FROM_EMAIL` — quand il est posé, il ÉCRASE
  l'expéditeur (`sender_email = PASSWORD_RESET_FROM_EMAIL or BREVO_SENDER_EMAIL`).

  🪜 **La politique DMARC monte par paliers**, publiés et datés par
  `backend/scripts/dmarc_policy.py`. Un saut direct à `p=quarantine`
  déciderait sur une impression : il suffit d'un expéditeur légitime oublié
  (une adresse « Envoyer en tant que » dans une boîte, un outil qui signe sans
  DKIM aligné) pour envoyer ses messages en quarantaine sans que personne ne le
  voie avant la plainte d'un utilisateur.

  | Étape | Record publié | Durée minimale dans l'étape |
  |---|---|---|
  | `observe` | `p=none` | aucune |
  | `canary` | `p=quarantine; pct=10` | 7 jours |
  | `half` | `p=quarantine; pct=50` | 3 jours |
  | `full` | `p=quarantine` | — |

  ```bash
  export DNSHE_API_KEY=… DNSHE_API_SECRET=…        # API Management du domaine
  python backend/scripts/dmarc_policy.py show      # état réel + ce qui est permis
  python backend/scripts/dmarc_policy.py ramp      # palier suivant (refusé si trop tôt)
  python backend/scripts/dmarc_policy.py rollback  # ⏪ retour immédiat à p=none
  ```

  État déployé le 18/09/2026 : étape **`canary`** (`p=quarantine; pct=10`), TTL
  ramené à **300 s** — c'est lui qui borne le temps de retour arrière.

  ⚠️ `pct` est déprécié par DMARCbis et certains récepteurs l'ignorent : pour
  eux, `pct=10` vaut `p=quarantine` plein. D'où l'observation à chaque palier —
  et d'où `rollback`.

  **Revenir en arrière si un mail légitime est touché** : `rollback` republie
  `p=none` sans délai, garde `rua` en place pour continuer à recevoir les
  rapports pendant le diagnostic, et note la nouvelle date. À savoir :
  `p=quarantine` met en **quarantaine**, il ne rejette pas — le message reste
  récupérable dans le dossier « spam » du destinataire, et c'est ce signal qui
  déclenche le retour arrière.

  L'horloge du délai vit dans `backend/scripts/dmarc_policy.state.json` :
  **l'API DNSHE n'horodate pas ses enregistrements** (aucun `created_at` ni
  `updated_at` sur un TXT listé), donc le record ne peut pas dire depuis quand
  il est en place. Si cet état ne décrit pas l'étape constatée, `ramp` REFUSE de
  monter plutôt que de supposer qu'on a observé — `rollback` repart alors d'une
  étape datée.

  🧪 **Vérifier, plutôt que supposer** — `.github/scripts/check-email-auth.py`
  (job `fly-env-drift`, `main` uniquement) envoie un OTP via l'API de
  PRODUCTION vers un alias Gmail dédié (`boîte+kojo-probe-<jeton>@gmail.com`),
  puis lit l'en-tête `Authentication-Results` que Gmail pose à la RÉCEPTION et
  échoue si `spf`, `dkim` ou `dmarc` n'est pas `pass`. C'est elle qui fournit la
  preuve attendue avant chaque `ramp` ci-dessus : un palier ne se monte pas sur
  une impression, mais sur des verdicts lus chez un vrai récepteur.

  Pourquoi une boîte réelle : une boîte jetable reçoit le message mais
  n'enregistre AUCUN verdict (mesuré sur mail.tm : zéro `Authentication-Results`,
  zéro `Received-SPF`), et recalculer DKIM sur la copie reçue est impossible —
  le récepteur réécrit le corps, donc le `bh` signé ne correspond plus à celui
  qu'on recalcule. L'octet signé n'existe qu'à la réception.

  🧭 **Alignement SPF : DMARC ne tient aujourd'hui que sur DKIM.** Un `spf=pass`
  posé sur le domaine d'un TIERS ne compte pas pour DMARC : seul l'alignement de
  l'enveloppe (`Return-Path` / `smtp.mailfrom`) avec le domaine du `From:` est
  retenu. Mesuré le 18/09/2026 sur un message réellement livré :

  ```
  Return-Path:     <bounces-470616010-2104611724@gw.d.sender-sib.com>   ← Brevo
  From:            "KOJO" <noreply@kojoforafrica.cc.cd>
  DKIM-Signature:  … d=kojoforafrica.cc.cd; s=brevo2                    ← aligné
  ```

  → `spf=pass` **non aligné**, `dkim=pass` aligné : une seule jambe porte la
  politique `p=quarantine`. La sonde publie désormais cette phrase d'alignement
  à chaque run de `main` (`::notice title=Alignement DMARC::…`, enveloppe et
  `d=` comparés au domaine du `From:`, jamais supposés).

  Ce qui manque n'est pas dans le DNS mais chez Brevo : leur FAQ est explicite —
  *sans sous-domaine brandé, SPF passe via l'infrastructure de Brevo, pas votre
  domaine* ; le sous-domaine brandé « déplace l'alignement SPF sur votre domaine
  d'envoi » et permet de tenir une politique DMARC stricte sur **deux signaux
  indépendants**. Il est disponible sur IP partagée (obligatoire seulement en IP
  dédiée) et se configure dans Settings → Senders, Domains, IPs → Domains →
  *Add a domain* → **branded subdomain** (préfixe libre, p. ex. `mail`, d'où
  `mail.kojoforafrica.cc.cd`). Brevo génère alors un **CNAME « branded record »**
  (en-tête de retour et SPF hébergés chez eux) **dont la valeur est propre au
  compte** : elle ne se devine pas, elle se lit dans ce flux (ou via l'API).

  Dès que ces valeurs sont connues, l'ajout à la zone DNSHE est un appel de
  plus (`dns_records/create`, même client que `dmarc_policy.py`) : aucun
  redéploiement n'est nécessaire, la vérification se fait sur un message.

  ✅ **Verrouiller le gain une fois les deux jambes en place** :
  `gh variable set KOJO_REQUIRE_SPF_ALIGNMENT --body 1`. La sonde l'exige alors
  et rougit si DMARC ne repose plus que sur DKIM — sans toucher au code.

  À noter : les deux CNAME `brevo1`/`brevo2` existent pour que Brevo fasse
  TOURNER la clé sans republier d'enregistrement. Une rotation est donc déjà
  absorbée ; ce que l'alignement SPF protège, c'est la perte de DKIM (clé
  révoquée, signature retirée, réglage cassé) — le jour où elle survient, la
  politique DMARC ne tombe pas avec elle.

  Deux secrets GitHub l'activent — **et seulement GitHub** : les ajouter à
  `.env.example` les rendrait obligatoires sur Fly (`check-fly-env-drift.py`
  exige que toute clé de `.env.example` soit déployée) :

  | Secret | Valeur |
  |---|---|
  | `KOJO_PROBE_IMAP_USER` | adresse de la boîte de test (ex. `kojoapp98@gmail.com`) |
  | `KOJO_PROBE_IMAP_PASSWORD` | **mot de passe d'application** Gmail (Compte Google → Sécurité → Mots de passe des applications ; validation en deux étapes requise) |

  Sans ces secrets, la sonde publie une `::notice` « NON EXÉCUTÉE » et sort en
  0 : un run qui n'a rien vérifié se lit comme tel. Avec eux, une boîte
  injoignable ou un verdict non `pass` font échouer le job — volontairement.
- 📬 **`BREVO_REPLY_TO_EMAIL`** (optionnel, défaut `kojoapp98@gmail.com`) :
  boîte qui reçoit les RÉPONSES, l'adresse d'envoi du domaine n'ayant pas de
  boîte. La vider désactive l'en-tête (les réponses repartent à l'expéditeur).
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
curl -s https://api.kojoforafrica.cc.cd/health

# /docs doit être en 404 (APP_ENV=production)
curl -s -o /dev/null -w '%{http_code}\n' https://api.kojoforafrica.cc.cd/docs

# Racine
curl -s https://api.kojoforafrica.cc.cd/
```

Logs : `fly logs` · État : `fly status`

### 4bis. Audit des variables d'environnement (format + présence)

Un script d'audit réutilisable vérifie le FORMAT et la PRÉSENCE des
variables critiques (CORS_ORIGINS, VAPID_CLAIMS_EMAIL, URLs publiques,
TRUSTED_HOSTS, REDIS_URL, MONGO_URL) sur 3 plans :

```bash
# 1) Formats des RÉFÉRENCES du dépôt ET contrat des deux délais du bus
#    (déterministe, SANS token ni réseau — rejouable localement et lancé par
#    la CI à chaque push et chaque PR, donc AVANT le déploiement) :
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
- **`MONGO_URL`** : URI `mongodb://` ou `mongodb+srv://` (Atlas) ;
- **les trois délais du flux temps réel**, chacun contre le contrat qu'il sert :
  le battement déployé (`KOJO_SSE_HEARTBEAT_SECONDS`, deux battements doivent
  tenir dans la fenêtre de silence du client), le bail du registre Redis — qui
  n'est pas une variable mais un CALCUL de `backend/kojo_live.py` depuis ce
  battement : il doit tolérer un battement perdu (`≥ 2 × battement`) sans
  survivre au verdict du client (`≤ fenêtre + un battement`) —, et le repli du
  client (`FALLBACK_POLL_MS`, lu dans ses deux déclarations), qui doit rester
  moins bavard que les 2 req/min du sondage remplacé. Les valeurs sont lues et
  le calcul refait, jamais recopiés : si la formule change, c'est elle qui est
  jugée.
- **les deux délais du bus temps réel**, qui se jugent ENSEMBLE :
  `KOJO_LIVE_BUS_RECONNECT_SECONDS` reste entre 1 s (en deçà, une boucle
  republie sans répit) et UN battement de cœur (au-delà, un Redis revenu n'est
  pas rejoint avant plusieurs battements, et le pub/sub ne rejoue rien) ;
  `KOJO_LIVE_BUS_QUEUE` doit valoir au moins `MAX_STREAMS_TOTAL × reprise`
  (une notification par seconde et par flux) — allonger la reprise sans
  agrandir la file déplace la panne. Le mode `--refs-only` juge ce contrat HORS
  LIGNE sur ce que le dépôt déclare (`fly.toml [env]`, bloc `fly secrets set`
  ci-dessous) et sur les défauts lus dans `kojo_live.py` : une PR le voit avant
  le déploiement. Une surcharge posée en SECRET sur Fly n'est pas lisible
  hors ligne — la passe en ligne la juge, et le mode `--refs-only` DÉCLARE
  cette portée.

Valeurs de référence contrôlées : `backend/fly.toml [env]` (config de prod),
`backend/.env.example` (template dev — les valeurs vides et `http://localhost`
sont ignorées) et `backend/DEPLOY_FLYIO.md` (bloc `fly secrets set`, les
placeholders `...` ignorés).

### 4ter. Métriques Prometheus (optionnel)

`GET /metrics` publie les compteurs que le backend tient déjà (bus temps réel,
flux SSE, repli du rate-limiter, échecs de révocation) au format texte
Prometheus. La route est **fermée par défaut** : sans `METRICS_TOKEN` elle
répond 503 nommée, avec un jeton absent ou faux 401 — jamais 200.

```bash
# Activer la collecte (secret, jamais dans fly.toml)
fly secrets set METRICS_TOKEN=<jeton> -a kojo-backend

# Vérifier
curl -fsS -H "Authorization: Bearer <jeton>" \
  https://api.kojoforafrica.cc.cd/metrics | head
```

La collecte (bloc `scrape_configs`, cadence de 30 s, rotation du jeton, liste
des familles exposées et ce que ces chiffres ne disent pas) est décrite dans
[`METRIQUES.md`](METRIQUES.md). Le jeton est OPTIONNEL côté déploiement : son
absence n'empêche pas le backend de démarrer, elle éteint la collecte.

## 5. Mettre à jour le frontend Vercel

Le frontend doit pointer vers Fly (`VITE_API_URL`). Vérifier la valeur dans le
dashboard Vercel (Settings → Environment Variables) :

```
VITE_API_URL=https://api.kojoforafrica.cc.cd/api
```

> ℹ️ Le backend Render est retiré : toute valeur `VITE_API_URL` pointant vers
> Render est obsolète et doit être remplacée avant le prochain build Vercel.

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
  en moniteur d'alerte sur `https://api.kojoforafrica.cc.cd/health`).
- Sondes hors `/api`, pointables par un moniteur : `/health` (l'app),
  `/monitor` (agrégé : 503 si au moins 2 fournisseurs down, défaut), et les
  sondes dédiées `/monitor/paydunya`, `/monitor/email`, `/monitor/brevo`,
  `/monitor/cloudinary`. `/monitor/email` juge le fournisseur **actif**
  (`EMAIL_PROVIDER`) et son expéditeur : il rougit sur une clé refusée, un
  transport coupé, un domaine Resend non vérifié, un expéditeur Brevo inactif
  ou un jeton Gmail révoqué — c'est-à-dire sur les pannes qu'un utilisateur
  découvrirait en demandant son code. Son `detail` dit ce qui a été jugé.
- La sonde quotidienne `backend/scripts/check_health_probe.py` (job
  `backend-health-probe`, cron 06:30) interroge `/health`, puis
  `/monitor/email` et `/monitor` dérivés de la même origine : un fournisseur
  email muet ou mal configuré **fait échouer le job** en nommant la cause, et
  un composite au-delà de son seuil nomme les fournisseurs down. Une panne
  isolée sous le seuil reste un WARN, comme le contrat du composite.
- **Auto-alerte (17/10/2026)** : le backend ne dépend PAS de ce job externe.
  La boucle `kojo_scheduler.email_provider_alert_loop` juge le fournisseur
  ACTIF toutes les `EMAIL_HEALTH_ALERT_INTERVAL_MINUTES` (15 par défaut) avec
  la MÊME sonde que `/monitor/email`, puis prévient le propriétaire **une
  seule fois par panne** (document d'état `scheduler_alerts`, `_id`
  `email_provider`) : notification in-app au compte propriétaire RÉSOLU par
  email, et email best-effort — dont l'échec est écrit (`alerte_erreur`) au
  lieu d'être tu, puisque le cas normal d'une panne totale est que l'email ne
  puisse pas partir. Le rétablissement (`retabli_at`) RÉ-ARME l'alerte : une
  reprise suivie d'une nouvelle panne redonne un email ; un motif qui change
  en restant muet (`muet` → `mal-configure`, ou un autre fournisseur) est une
  nouvelle panne. Aucun secret à poser : le réglage est optionnel. Gardes :
  `backend/tests/test_email_provider_auto_alert.py`,
  `backend/tests/test_scheduler_leases.py` (bail partagé entre machines).

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

Le dépôt porte deux autres secrets, pour la sonde email (jamais des variables
Fly, cf. la section « Expéditeur transactionnel ») : `KOJO_PROBE_IMAP_USER` et
`KOJO_PROBE_IMAP_PASSWORD`. Tant qu'ils manquent, le job `fly-env-drift` reste
vert en PUBLIANT que l'authentification email n'a pas été vérifiée.

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
