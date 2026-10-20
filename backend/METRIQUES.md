# Métriques Prometheus — ce qui est exposé, et comment c'est collecté

Ce document est le contrat de collecte de `GET /metrics`
([`kojo_metrics.py`](kojo_metrics.py), route dans [`server.py`](server.py)).
Chaque famille listée ci-dessous vient d'un compteur que le produit tient
**déjà** (`kojo_live.bus_stats`, `kojo_live.partage_stats`,
`kojo_rate_limit.rate_limit_stats`, `kojo_auth_core.revocation_stats`) : aucune
mesure n'est calculée à la demande, et la route ne fait aucune I/O.

## Pourquoi une route protégée

Ces chiffres décrivent la **topologie interne** (bus partagé branché ou non,
plafonds de flux, repli du limiteur, échecs de révocation). Une route ouverte
serait une surface de reconnaissance de plus, et une route qui répondrait 200
sans rien publier ferait croire à une collecte saine.

Trois réponses, jamais deux :

| Situation | Réponse |
|---|---|
| `METRICS_TOKEN` absent sur la machine | **503** nommée — la route refuse de publier |
| En-tête `Authorization` absent ou faux | **401** (`WWW-Authenticate: Bearer`) — aucun nom de métrique ne sort |
| En-tête `Authorization: Bearer $METRICS_TOKEN` | **200** `text/plain; version=0.0.4; charset=utf-8` |

La comparaison est en **temps constant** (`hmac.compare_digest`), comme la
signature des webhooks Resend. `Cache-Control: no-store` : un cache
intermédiaire servirait des compteurs périmés en croyant mesurer le présent.

## Activer la collecte

1. Générer un jeton (32 octets suffisent) :

   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

2. Le poser sur la machine Fly — c'est un **secret**, jamais une variable
   publique de `fly.toml` :

   ```bash
   fly secrets set METRICS_TOKEN=<jeton> -a kojo-backend
   ```

   La route est fermée tant qu'il manque (503 nommée). Le backend démarre
   normalement sans lui : l'absence est un choix d'exploitation, pas une config
   cassée (`OPTIONAL_KEYS` de `.github/scripts/check-fly-env-drift.py`).

3. Vérifier à la main :

   ```bash
   curl -fsS -H "Authorization: Bearer <jeton>" \
     https://api.kojoforafrica.cc.cd/metrics | head
   ```

   Sans le jeton, la même URL répond 401 — si elle répond 200, la collecte est
   ouverte et c'est un défaut, pas une configuration.

## Configuration du scrape

L'endpoint est **hors `/api`** (comme `/monitor`, `/health`) : il se scrape
directement sur l'hôte du backend, pas à travers le proxy Vercel (`/api/:path*`).
Prometheus n'a pas de cookie de session : le jeton porteur est la seule preuve.

```yaml
scrape_configs:
  - job_name: kojo-api
    scheme: https
    metrics_path: /metrics
    scrape_interval: 30s
    scrape_timeout: 10s
    # Le jeton est lu dans un fichier hors du dépôt (jamais commité).
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/secrets/kojo-metrics-token
    static_configs:
      - targets: ["api.kojoforafrica.cc.cd"]
```

Cadence : **30 s** — un scrape ne coûte qu'une lecture de dictionnaires en
mémoire et ne touche ni Mongo ni Redis. `scrape_timeout` à 10 s laisse de la
marge au démarrage à froid d'une machine Fly arrêtée (trial), sans quoi le
premier scrape après réveil compterait comme une cible morte.

Ce qui n'est **pas** nécessaire : aucun relabeling, aucun exportateur, aucune
sonde réseau supplémentaire. Les cibles sont les machines Fly ; Prometheus pose
lui-même `instance` et `job`.

Rotation : `fly secrets set METRICS_TOKEN=<nouveau>` redémarre les machines ;
mettre à jour le fichier de credentials dans la même fenêtre. L'ancien jeton
cesse immédiatement de valider (la valeur est lue à chaque requête).

## Familles exposées

Aucune famille ne porte d'**étiquette** : une date ou un identifiant en label
créerait une série par valeur — une fuite de cardinalité que Prometheus paie en
mémoire. Les dates sortent en `..._timestamp_seconds` (jauges), `0` valant
« jamais ».

### Bus temps réel (Redis pub/sub)

| Série | Type | Sens |
|---|---|---|
| `kojo_live_bus_publies_total` | counter | Événements déposés par ce process, localement puis proposés au bus |
| `kojo_live_bus_recus_total` | counter | Événements reçus d'un **autre** process |
| `kojo_live_bus_echo_total` | counter | Événements ignorés parce qu'ils venaient de ce process (anti-doublon) |
| `kojo_live_bus_illisibles_total` | counter | Enveloppes illisibles, ignorées et comptées |
| `kojo_live_bus_repli_total` | counter | Publications/souscriptions échouées puis retentées |
| `kojo_live_bus_perdus_total` | counter | Événements perdus par le bus (tampon plein) — jamais l'événement local |
| `kojo_live_bus_ecoutes_total` | counter | Souscriptions établies, la première comprise |
| `kojo_live_bus_reprises_total` | counter | Fenêtres où ce process n'écoutait pas (perte d'abonné **déclarée**) |
| `kojo_live_bus_resyncs_total` | counter | Relectures de réparation demandées sur les flux locaux |
| `kojo_live_bus_actif` | gauge | 1 si le bus partagé est branché dans ce process |

### Flux SSE

| Série | Type | Sens |
|---|---|---|
| `kojo_live_flux_actifs` | gauge | Flux SSE ouverts dans ce process |
| `kojo_live_flux_plafond_processus` | gauge | `MAX_STREAMS_TOTAL` (400 par défaut) |
| `kojo_live_flux_plafond_compte` | gauge | `MAX_STREAMS_PER_USER` (4 par défaut) |
| `kojo_live_flux_reserves_total` | counter | Places admises par le registre partagé |
| `kojo_live_flux_refus_total` | counter | Flux refusés par le registre partagé (plafond du compte) |
| `kojo_live_flux_repli_total` | counter | Admissions faites par le plafond **local**, registre injoignable |

### Rate-limiter

| Série | Type | Sens |
|---|---|---|
| `kojo_rate_limit_replis_total` | counter | Bascules Redis → mémoire |
| `kojo_rate_limit_en_memoire` | gauge | 1 si le limiteur est retombé en mémoire après une panne |
| `kojo_rate_limit_en_redis` | gauge | 1 si les compteurs de limites sont partagés par Redis **maintenant** |
| `kojo_rate_limit_derniere_panne_timestamp_seconds` | gauge | Dernière bascule mémoire (0 = aucune) |
| `kojo_rate_limit_alerte_envoyee_timestamp_seconds` | gauge | Dernière alerte propriétaire sur un repli (0 = aucune) |

`en_memoire` et `en_redis` ne disent pas la même chose : le premier qu'un
**repli** a eu lieu, le second où en sont les compteurs. Déployé sans
`REDIS_URL`, aucun repli n'a eu lieu et les limites sont pourtant comptées par
process — `en_memoire` seul laisserait croire au partage.

### Révocation de jeton

| Série | Type | Sens |
|---|---|---|
| `kojo_revocation_verifications_total` | counter | Vérifications abouties (liste noire lue) |
| `kojo_revocation_echecs_total` | counter | Vérifications impossibles : jeton accepté sans liste noire (repli fail-open) |
| `kojo_revocation_dernier_echec_timestamp_seconds` | gauge | Dernier échec (0 = aucun) |

## Ce que ces chiffres ne disent pas

- **Ils sont par PROCESS.** Un scrape ne voit que le process qui répond. Le
  dépôt tourne à un seul process : `kojo_settings` refuse
  `WEB_CONCURRENCY > 1` sans `REDIS_URL`, et le bus comme le registre de flux
  vivent dans Redis précisément pour ce cas. Plusieurs process demanderaient
  une cible par worker (ou un exportateur), pas une série de plus ici.
- **Ils ne sont pas historisés.** Prometheus garde l'historique ; l'endpoint ne
  rend que l'instantané, et un redémarrage remet les compteurs à zéro (c'est ce
  qu'un `counter` de Prometheus sait lire : `rate()` gère la remise à zéro).
- **Ils ne jugent pas.** Un `repli` qui monte est un fait ; savoir si c'est une
  panne appartient aux sondes qui testent le service (`/monitor`, les workflows
  de sonde), pas à l'exposition.
