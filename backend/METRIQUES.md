# Métriques Prometheus — ce qui est exposé, et comment c'est collecté

Ce document est le contrat de collecte de `GET /metrics`
([`kojo_metrics.py`](kojo_metrics.py), route dans [`server.py`](server.py)).
Chaque famille listée ci-dessous vient d'un compteur que le produit tient
**déjà** (`kojo_live.bus_stats`, `kojo_live.partage_stats`,
`kojo_rate_limit.rate_limit_stats`, `kojo_auth_core.revocation_stats`) — sauf
`kojo_missions_ouvertes`, le seul chiffre que la base seule connaît : la route
en fait une lecture bornée par scrape (voir plus bas), et `kojo_metrics` reste
sans I/O.

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

La configuration ci-dessous est aussi un FICHIER exécutable,
[`backend/metrics/prometheus.yml`](metrics/prometheus.yml) : c'est lui qu'on
monte sur l'hôte qui collecte (`prometheus --config.file=…`), et
`backend/tests/test_metrics_scrape_config.py` refuse que ce fichier et ce bloc
ne disent plus la même chose — deux déclarations de la même collecte
finiraient par diverger, et Prometheus collecterait un objet que personne n'a
mesuré.

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

## Qui lit ces chiffres (le lecteur quotidien)

Une configuration de scrape n'est une collecte que si QUELQU'UN lit la route.
Mesuré le 30/10/2026 : `/metrics` répondait **401** sur l'hôte du backend (donc
un jeton était posé sur la machine Fly), l'origine du site **404**, et le dépôt
n'avait **aucun** secret `METRICS_TOKEN` ni aucun collecteur versionné — le
bloc `scrape_configs` ci-dessus est une configuration que personne ne monte.
Les quatre provenances des veilles et la jauge de fraîcheur de leur acquisition
étaient donc publiées dans le vide : personne ne les lisait, et rien ne le
disait.

[`.github/workflows/metriques-collecte.yml`](../.github/workflows/metriques-collecte.yml)
est ce **LECTEUR**, et il est la preuve qu'une collecte a lieu :
[`scripts/check_metrics_collecte.py`](scripts/check_metrics_collecte.py)
s'authentifie avec le jeton, lit l'exposition et juge la chaîne entière.

| Situation | Verdict |
|---|---|
| 200, six familles présentes, acquisition de moins de 30 jours | **0** conforme |
| aucun secret `METRICS_TOKEN` côté CI | **1** — « AUCUN COLLECTEUR », avec le remède |
| 401 / 503 / 404 | **1**, nommé : jeton refusé / route fermée / mauvais hôte |
| une provenance, le hors-vocabulaire ou la fraîcheur absents | **1**, la famille est NOMMÉE |
| exposition illisible (ligne ou valeur) | **1** |
| `plus_recente = 0`, date future, ou âge au-delà du seuil | **1**, nommé avec l'âge |
| transport injoignable ou URL inutilisable | **2** prémisse — jamais un vert |

Deux secrets, et les DEUX sont nécessaires :

```bash
fly secrets set METRICS_TOKEN=<jeton> -a kojo-backend   # ouvre la route
gh secret set METRICS_TOKEN                             # donne un lecteur
```

Cadence : `48 7 * * *`, après les sondes de document de la matinée (07:04 →
07:40). Un échec est relevé par
[`sondes-sante.yml`](../.github/workflows/sondes-sante.yml), qui ouvre — et
referme quand tout repasse au vert — l'issue des sondes : c'est la boucle
fermée, la même que pour les treize crons que ce workflow surveille. Le coût de
la passe (une requête, ses octets, sa durée) est publié dans le résumé du job,
verdict **vert compris**.

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
| `kojo_live_flux_plafond_compte` | gauge | `MAX_STREAMS_PER_USER` (8 par défaut, dérivé de `FLUX_PAR_PAGE × ONGLETS_SIMULTANES`) |
| `kojo_live_flux_reserves_total` | counter | Places admises par le registre partagé |
| `kojo_live_flux_refus_total` | counter | Flux refusés par le registre partagé (plafond du compte, tous workers) |
| `kojo_live_flux_refus_local_total` | counter | Flux refusés par le plafond **local** du compte, avant le registre |
| `kojo_live_flux_refus_processus_total` | counter | Flux refusés parce que le process est au plafond `MAX_STREAMS_TOTAL` |
| `kojo_live_comptes_satures` | gauge | Comptes ayant **atteint** `MAX_STREAMS_PER_USER` dans ce process |
| `kojo_live_flux_repli_total` | counter | Admissions faites par le plafond **local**, registre injoignable |

Un **503 de capacité** n'est pas une panne : c'est le produit qui se protège.
Il était pourtant invisible — mesuré le 25/10/2026 sur la console de production,
`GET /api/notifications/stream` rendait des 503 par rafales sans qu'aucun
chiffre ne dise que le plafond mordait. Les trois causes de refus sont
séparées parce que leur remède diffère :

* `flux_refus_local_total` — le **compte** ferme un onglet (il porte déjà
  `flux_actifs` à `flux_plafond_compte`, et `comptes_satures` le nomme) ;
* `flux_refus_total` (registre partagé) — le compte sature **tous workers
  confondus** : fermer un onglet sur l'un ne libère pas l'autre ;
* `flux_refus_processus_total` — la **machine** est pleine (`flux_actifs`
  atteint `flux_plafond_processus`) : il faut une instance de plus, rien côté
  client n'y changera.

La règle de lecture : un refus qui monte **pendant que `flux_actifs` reste
sous son plafond** n'est pas de la charge, c'est un client qui boucle
(reconnexion immédiate) ou un plafond sous-dimensionné. `comptes_satures` est
une jauge et redescend : les compteurs, eux, ne se remettent jamais à zéro
(sauf redémarrage), donc c'est leur **pente** qu'on lit, pas leur valeur.

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

### Relance client

| Série | Type | Sens |
|---|---|---|
| `kojo_relances_envoyees_total` | counter | Relances envoyées par ce process (une par mission, après `CLIENT_SANS_PROPOSITION_HEURES`) |
| `kojo_relances_echecs_total` | counter | Envois échoués : la mission reste à relancer au passage suivant |

Ces deux compteurs disent ce que le process a **envoyé**, pas ce que les
relances ont **produit**. Un compteur qui monte ne prouve pas qu'il sert :
l'effet — missions relancées ayant reçu au moins une candidature APRÈS la
relance, délai médian, taux sous plancher non publié — se mesure sur
l'historique et se lit dans `GET /owner/relances/mesures`
(`kojo_scheduler.mesure_relances`, 30 jours, plancher de 10 relances). Comme tous
les compteurs de ce document, ils sont par process et repartent à zéro au
redémarrage.

### Corpus de la place de marché

| Série | Type | Sens |
|---|---|---|
| `kojo_missions_ouvertes` | gauge | Missions `open` en base, non supprimées. **0 = place de marché vide**, donc aucun effet de réseau, aucune fiche à indexer et un revenu nul |
| `kojo_alertes_emploi{origine="ville\|metier\|directe\|inconnue"}` | gauge | Veilles emploi actives par provenance. Les quatre séries sont **toujours** publiées, zéro compris : une série qui disparaîtrait à zéro se lirait comme une provenance qui n'existe pas |
| `kojo_alertes_emploi_hors_vocabulaire` | gauge | Veilles dont `origin` n'appartient pas au vocabulaire déclaré (`ORIGINES_ALERTE` + `inconnue`). Comptées **à part**, jamais repliées dans `inconnue` : ce serait faire passer une donnée écrite de travers pour une absence |
| `kojo_alertes_emploi_plus_recente_timestamp_seconds` | gauge | Date de création de la veille la plus récente, en secondes epoch. **0 = aucune veille datée** (jamais « maintenant »). L'âge se lit `time() - valeur` : c'est lui qui distingue une acquisition qui **tarit** d'un total stable |

Les trois familles de veilles viennent aussi de la BASE, lues par la route dans la
même passe que le corpus : `kojo_job_alerts.compter_par_origine()` lit `origin` et
`created_at` de chaque veille (une par compte, donc borné par le nombre de comptes
en veille), une valeur inconnue ne crée **pas** d'étiquette — l'étiquette est une
constante, donc la cardinalité est de quatre — et une lecture en panne **omet** la
famille plutôt que de publier quatre zéros, qui se liraient comme un échec
d'acquisition alors que c'en est un de lecture.

La date de la plus récente est publiée **parce que les totaux ne suffisent pas** :
quatre séries stables disent la même chose qu'il entre une veille par jour ou que
la dernière date de six semaines. Trois règles, et aucune n'est cosmétique :

- c'est la date d'**ACQUISITION** (`created_at`, posé par `$setOnInsert`), pas
  celle du dernier réglage : régler sa ville ne rajeunit pas une acquisition ;
- elle porte sur la **même population** que les compteurs — aucun filtre sur
  `active`, une veille coupée reste une acquisition —, sinon les deux chiffres
  décriraient deux corpus et l'écart serait inexplicable ;
- `0` veut dire **JAMAIS**, et c'est pour ça que la série porte une date et non
  un âge calculé au scrape : un âge vaudrait 0 aussi bien pour « créée à
  l'instant » que pour « aucune veille », et l'age d'un corpus vide est l'infini,
  pas zéro. `time() - 0` vaut l'infini, donc une acquisition tarie **ou jamais
  démarrée** se voit. Une date illisible sur un document importé est ignorée
  plutôt que datée d'office, et une date sans fuseau est ramenée à UTC.

Alerte type : `time() - kojo_alertes_emploi_plus_recente_timestamp_seconds >
30 * 86400` (aucune veille créée depuis un mois, corpus vide compris, puisque la
valeur vaut alors 0).

C'est la seule famille qui vient de la BASE : la route fait un `count_documents`
indexé au moment du scrape (une lecture toutes les 30 s), et `kojo_metrics`
reste sans I/O — le chiffre lui est passé. Si la lecture échoue, la jauge est
**omise** et les autres familles restent publiées : un `0` inventé ferait
passer une panne de base pour une place vide, et une alerte se déclencherait
sur la mauvaise cause. Le 23/10/2026, la production comptait zéro mission
ouverte sans qu'aucun tableau de bord ne le dise — cette jauge est le remède
minimal, et la MÊME règle de comptage est lue par
`kojo_scheduler.marche_vide_alert_once` : la série se collecte avec une alerte
`kojo_missions_ouvertes == 0` maintenue pendant plus de 24 h, ET le backend la
dit lui-même au propriétaire (`MARCHE_VIDE_ALERTE_HEURES`) une fois par
épisode — un tableau de bord qui ne se consulte pas ne corrige rien.

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
