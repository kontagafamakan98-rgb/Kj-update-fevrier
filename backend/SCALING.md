# Dimensionnement : où l'API casse, et à combien d'utilisateurs

Ce document est le compte rendu d'un **test de charge réel** de la couche
applicative, avec ses chiffres, ses courbes et ses limites. Il répond à une
question précise : *« est-ce que l'application tient 100 000 utilisateurs ? »*

Réponse courte : **100 000 comptes, oui. 100 000 utilisateurs simultanés, non**
— mais ce n'est plus l'architecture de sondage qui l'empêche : elle a été
remplacée par du push (SSE, §5), ce qui a retiré 293 rps de sondages au pic et
divisé la charge totale par 3,3. Ce qui reste est de la navigation (CPU) et le
nombre de connexions à tenir. Le détail et les seuils mesurés sont ci-dessous.

---

## 1. Le banc de mesure

| Fichier | Rôle |
|---|---|
| `scripts/charge/serveur_mesure.py` | Le **vrai** `server.app` (middlewares, auth, Pydantic, sérialisation) sur une base **en mémoire**, avec une latence simulée par opération (`--latence-ms`, 1 ms par défaut) |
| `scripts/charge/mesure_charge.py` | Générateur de charge **fermé** : paliers de concurrence, latences p50/p95/p99, débit, erreurs |
| `scripts/charge/etalon.py` | Serveur ASGI qui **ne fait rien** : mesure le plafond du générateur, sans quoi on ne saurait pas qui sature |

```bash
# 1) le serveur mesuré (port 8990)
python scripts/charge/serveur_mesure.py --port 8990 --latence-ms 1

# 2) le plafond du générateur (port 8991) — à faire AVANT de conclure
python scripts/charge/etalon.py --port 8991
python scripts/charge/mesure_charge.py --url http://127.0.0.1:8991 --scenario health

# 3) les scénarios réels
python scripts/charge/mesure_charge.py --scenario mix    --paliers 1,8,32,64,128
python scripts/charge/mesure_charge.py --scenario jobs   --paliers 1,32,64
python scripts/charge/mesure_charge.py --scenario blocage --lenteur 2
```

**Ce que le banc ne mesure pas** (et qu'aucun chiffre ci-dessous ne prétend
couvrir) : le débit de MongoDB (index, disque, connexions — c'est le palier
Atlas), le réseau, et la politique de rate-limiting (désactivée pendant la
mesure : c'est un contrôle, pas une capacité — voir §6).

**Plafond du générateur, mesuré** : contre `etalon.py` (serveur vide), un seul
processus de mesure atteint **322 rps à 8 clients**, puis **100 rps à 32** — le
client Python sature avant le serveur au-delà. Les conclusions ne valent donc
que **sous ~300 rps**, et les paliers à 64/128 sont à lire comme « le serveur
n'arrive plus à suivre » (ils restent valables en *comparaison*).

---

## 2. La courbe : une machine, un worker (configuration Fly actuelle)

Mélange réaliste (`mix`) : liste de missions (50 fiches), détail, `/auth/me`,
compteur de notifications, santé.

| Concurrence | Débit | p50 | p95 | p99 |
|---:|---:|---:|---:|---:|
| 1 | 46,4 rps | 21,7 ms | 41,7 ms | 43,2 ms |
| 8 | 84,9 rps | 93,7 ms | 157,9 ms | 199,1 ms |
| **32** | **85,2 rps** | 364 ms | 523 ms | 596 ms |
| 64 | 63,6 rps | 699 ms | **2 753 ms** | 4 355 ms |
| 128 | 49,0 rps | 1 910 ms | **6 094 ms** | 6 777 ms |

Lecture : l'API **sature vers 85 rps** sur 1 vCPU / 1 worker, et **s'effondre**
au-delà de ~32 requêtes simultanées (le débit baisse *et* la latence explose :
c'est la file d'attente qui grossit, pas un manque de parallélisme).

Rejoué le 18/10/2026 après correction : même plateau (52 rps à 1 client, 95 rps
à 8, **83 rps à 32**, 62 rps à 64), soit ±10 % d'une exécution à l'autre. Les
chiffres de ce document sont reproductibles à cette précision près.

## 3. Le prix de chaque endpoint (même machine)

| Endpoint | Débit à 1 client | p95 à 1 client | Commentaire |
|---|---:|---:|---|
| `GET /api/health` | 240 rps | 4,6 ms | coût fixe (middlewares + routeur) |
| `GET /api/auth/me` | 98 rps | 11,5 ms | 2 lectures Mongo + modèle `User` |
| `GET /api/notifications/unread-count` | 74 rps | 16,3 ms | le sondage de chaque session connectée |
| `GET /api/jobs` (50 fiches) | **31,6 rps** | 41 ms | **l'endpoint le plus cher** : 50 validations `JobPublic` + sérialisation |
| `POST /api/auth/login` | 63 rps | 6,2 ms (p99 274 ms) | bcrypt (12 tours) : CPU pur, p99 = hachage |
| `GET /api/jobs/:id` | ~160 rps | ~6 ms | 2 lectures |

**Conséquence directe** : la page de découverte (`/jobs`, 50 fiches) coûte
**3× plus cher** que n'importe quelle autre route. C'est elle qui fixe le
plafond d'une machine, pas `/auth/me`.

---

## 4. Le vrai précipice : un appel sortant lent gèle tout le worker

`requests` est **synchrone**. Appelé depuis une route `async def`, il bloque la
boucle pour toute la durée du timeout (15 à 30 s chez Brevo/Resend/PayDunya).
Mesuré, avec un envoi d'email simulant 2 s :

| | Requêtes servies | p95 | p99 | max |
|---|---:|---:|---:|---:|
| santé seule | 755 | 19 ms | 22 ms | 1 145 ms |
| santé + **1 envoi / 2 s** | **360** | 25 ms | **1 988 ms** | 1 991 ms |

Un envoi d'email toutes les 2 secondes **divise le débit par deux** et fait
attendre 2 secondes aux utilisateurs qui n'ont rien demandé. Avec le timeout
réel de 30 s, un fournisseur email en difficulté **arrête l'API entière**, pour
tout le monde — y compris la connexion et la liste des missions.

**Corrigé** (`asyncio.to_thread`, cf. §8). Après correction, même scénario :

| | Requêtes servies | p95 | p99 |
|---|---:|---:|---:|
| santé + 1 envoi / 2 s | **805** | 15,6 ms | **18,6 ms** |

L'envoi lui-même prend toujours 2 s (le client attend son email) ; **les autres
requêtes ne l'attendent plus**. Garde : `tests/test_event_loop_non_blocage.py`.

---

## 5. Du sondage au push (SSE) : ce que le serveur ne paie plus

### Ce qui a été retiré du client

Le sondage n'était pas négociable côté serveur : il vivait dans le client.

| Source | Avant | Requêtes par session |
|---|---:|---:|
| `NotificationContext` (`/notifications/unread-count`) | 30 s | **2 / min** |
| Liste des conversations (`/messages/conversations`) | 15 s | 4 / min |
| Conversation ouverte (`/messages?conversation=…`) | 5 s | **12 / min** |
| `/auth/me` | à chaque chargement de page | ~1 / page (inchangé) |

Un utilisateur qui lit une conversation coûtait **18 requêtes par minute** pour
des messages qui n'arrivaient pas ; les autres, 6.

### Ce qui les remplace

`GET /api/notifications/stream` et `GET /api/messages/stream` (`kojo_live.py`) :
UNE connexion SSE par session, un battement de cœur toutes les 20 s (un
commentaire dans le même flux, aucune requête). Le premier événement `ready`
porte le compteur non lus exact ; chaque notification et chaque message est
ensuite poussé, avec l'identifiant serveur de la ligne stockée. Le client ne
relit plus que : la liste complète à l'ouverture du panneau, et le fil ouvert
quand un message y arrive (c'est cette lecture qui marque « lu »).

| Surface | Avant | Flux vivant | Flux coupé (repli) |
|---|---:|---:|---:|
| Compteur de notifications | 2 / min | **0** | 1 / min |
| Liste des conversations | 4 / min | **0** | 1 / min |
| Fil ouvert | 12 / min | 0 (1 lecture par message reçu) | 1 / min |

Le sondage disparaît donc entièrement : **18 → 0** requêtes par minute pour un
utilisateur dans `/messages`. Quand le flux ne passe pas (proxy qui tamponne,
plafond de connexions, 401), le client se rabat sur **1 requête par minute** —
6 fois moins que l'ancien rythme du fil.

### Ce que la machine paie pour tenir les connexions — MESURÉ

Banc : `scripts/charge/mesure_push.py`, même serveur (`serveur_mesure.py`,
latence DB 1 ms), 4 clients fermés sur `/api/health`, mesure avant puis après
l'ouverture de **200 flux SSE** laissés ouverts (`ready` attendu sur chacun,
plafond par compte levé pour le banc — il vaut 4 en production) :

| | débit | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| sans flux | 237,2 rps | 11,8 ms | 12,7 ms | 13,9 ms |
| **200 flux ouverts** | 231,9 rps | 11,9 ms | 13,8 ms | 16,5 ms |

**−2,2 % de débit, +1,1 ms de p95, 0 requête émise par les flux.** Tenir une
connexion immobile ne coûte donc presque rien : c'est le principe même — le
push remplace N requêtes par une connexion.

### Ce que le bus partagé ajoute — MESURÉ

Le fan-out en mémoire suffit à un worker. Un bus Redis en ajoute un encodage,
une publication, une réception et un décodage **par événement et par process
abonné** : est-ce que ça se paie ? Relevé du 18/10/2026, même montage que
ci-dessus (200 flux laissés ouverts, 4 clients fermés sur `/api/health`, 6 s
par phase), `--evenements N` publiant vers le compte dont les flux sont
ouverts :

| Événements/s | Bus | Phase 1 (témoin) | Phase 2 (200 flux) | p95 ph. 1 → 2 |
|---|---:|---:|---:|---:|
| 0 | non | 217,2 | 221,2 | 17,4 → 17,5 |
| 0 | non | 182,7 | 209,0 | 22,7 → 20,9 |
| 0 | oui | 214,3 | **227,6** | 18,3 → 15,8 |
| 0 | oui | 218,7 | 219,8 | 17,6 → 17,7 |
| 5 | non | 222,1 | 156,7 | 16,2 → 41,5 |
| 5 | non | 208,3 | 141,2 | 19,0 → 45,0 |
| 5 | oui | 224,3 | **163,8** | 17,4 → 40,9 |
| 5 | oui | 215,7 | 160,3 | 17,8 → 43,2 |
| 50 | non | 213,5 | 46,8 | 18,7 → 67,8 |
| 50 | non | 208,3 | 65,9 | 20,6 → 57,1 |
| 50 | non | 166,1 | 46,9 | 26,0 → 81,5 |
| 50 | oui | 217,8 | **56,8** | 18,9 → 94,1 |
| 50 | oui | 218,4 | 60,2 | 17,2 → 68,1 |

Deux à trois passages par variante, variantes **entrelacées** (sans bus, bus,
sans bus, bus) : la dérive de l'hôte ne se lit pas comme un effet du bus. Le bus
est un serveur pub/sub **en mémoire** (`--bus memoire`, même protocole
`redis.asyncio` que la production) : aucun Redis n'était joignable sur cette
machine.

Lecture :

1. **Bus au repos : rien.** 227,6 / 219,8 rps avec, 221,2 / 209,0 sans — l'écart
   est dans la dispersion d'un passage à l'autre (±10 %). Un bus branché mais
   muet ne coûte pas plus qu'une tâche qui attend.
2. **Ce qui coûte, c'est le FAN-OUT, pas le bus.** À 5 événements/s (1 000
   trames/s vers 200 flux), le débit tombe de ~213 à ~150 rps : **−30 %**.
   Avec le bus : 163,8 / 160,3 rps, soit *au-dessus* des passages sans bus
   (156,7 / 141,2) — les deux variantes se chevauchent, et l'écart des médianes
   (+9 %) est plus petit que la dispersion. Le coût du bus est **O(événements)**, celui
   du fan-out est **O(événements × flux locaux)** : à 200 flux, le second terme
   écrase le premier.
3. **À 50 événements/s, la machine sature et le bus reste invisible.** 46,8 /
   65,9 / 46,9 rps sans bus, 56,8 / 60,2 avec : les passages varient de ±20 %,
   ce qui est plus large que tout effet mesurable du bus. La conclusion n'est
   pas « le bus est gratuit », c'est « à ce point, le goulot n'est plus lui ».
4. **La publication ne touche pas la latence des requêtes client.** La phase 1
   reste entre 166 et 224 rps dans les treize passages, y compris ceux qui
   publient 50 événements/s : `publish` dépose localement sans `await`, puis
   propose au bus. C'est la propriété à ne pas perdre — une requête qui publie
   ne doit jamais attendre Redis.
5. **Le bus a réellement publié.** `etat_bus` porte `publies` = `echo` (139 =
   139, 133 = 133) : chaque enveloppe est revenue à son propre process et y a
   été ignorée, donc aucun flux n'a reçu l'événement deux fois. `repli` et
   `perdus` à 0.

Ce que ces chiffres ne mesurent pas, et qui reste à faire sur un vrai Redis :
l'aller-retour réseau (une publication et une livraison par événement,
**hors** du chemin de la requête), la tenue d'une file saturée, et le fan-out
réparti sur plusieurs process — ici les 200 flux vivent dans le même process,
donc la mesure est une **borne basse** du coût d'un bus réseau.

Conséquence de dimensionnement : un événement adressé à 4 flux (le plafond par
compte) coûte 4 trames, pas 800. Ce sont les **événements par seconde** qui
saturent une machine qui tient des centaines de flux — d'où le bus plutôt que
des machines plus grosses dès que `WEB_CONCURRENCY > 1`.

### Le prix du `resync` quand Redis bat de l'aile — MESURÉ

Le `resync` n'est pas un événement de plus : c'est une TRAME par flux local,
que chaque client traduit en une relecture de sa source de vérité. À 400 flux,
un seul `resync` vaut donc 400 requêtes. Sa cadence est bornée par
`RESYNC_MIN_INTERVAL_SECONDS` — **30 s, la parité avec le sondage remplacé**
(2 req/min par session) —, avec une relecture différée pour la dernière
fenêtre d'une rafale. Banc : `scripts/charge/mesure_resync.py` (relevé du
19/10/2026).

**1. La cadence.** 400 flux, un serveur pub/sub arrêté pour de vrai 2 s puis
relancé 2 s pendant 183 s — socket et client `redis-py` réels, même double que
`mesure_panne_redis.py` (§5) — soit 45 fenêtres aveugles (`reprises` = 45),
deux passages identiques :

| Passage | Fenêtres | Relectures | /min | 1 fenêtre sur | Trames `resync` | /min | Sondage remplacé | Parité |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 (183,2 s) | 45 | 7 | 2,3 | 6,4 relues | 2 800 | 917,0 | 800 | 1,15× |
| 2 (182,9 s) | 45 | 7 | 2,3 | 6,4 relues | 2 800 | 918,7 | 800 | 1,15× |

Un Redis qui bat en continu produit **2,3 relectures/min**, pas une par
fenêtre : **918 requêtes/min** à 400 flux, contre **800** pour les 2 req/min
par session que le flux a remplacées. La parité est celle du plancher (une
relecture toutes les 30 s = 2,0/min, soit 800 req/min) ; l'écart de 15 % est
l'unique relecture de RATTRAPAGE de la rafale. Il ne dépend pas du nombre de
flux (les deux termes sont proportionnels) et ne grandit pas avec la durée du
flap : c'est une relecture par rafale, pas un taux. Le coût propre du fan-out
reste négligeable (0,5 à 3,2 ms pour 400 flux, soit 1 à 8 µs/flux, synchrone
dans la boucle).

**Pourquoi pas 10 s.** Le même banc, au plancher précédent, donnait 15
fenêtres en 60,9 s → 7 relectures, soit **6,9/min et 2 767 requêtes/min** :
3,5× le sondage remplacé, et 46 req/s (≈54 % du débit d'une machine à 85 rps)
pour un seul Redis instable. C'est ce relevé qui a fixé le plancher à 30 s,
celui que `RESYNC_MIN_INTERVAL_SECONDS` porte et que
`.github/scripts/check-resync-parite.py` rejuge dans `workflow-lint`.

**2. Le p99.** La rafale est REJOUÉE contre le vrai `server.app`
(`serveur_mesure.py`, base en mémoire à 1 ms/op) : 400 requêtes
`/api/notifications/unread-count` — un appel par flux — espacées du plancher
du produit (le banc DÉRIVE la durée de phase de `RESYNC_MIN_INTERVAL_SECONDS`
pour y contenir trois rafales), sous une charge constante. Les 400 flux du banc
ne vivent pas dans ce serveur ; c'est leur RAFALE qui est rejouée, pas le
`publish`.

| Phase | Requêtes stables | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| 66 s sans relecture | 4 057 (61,5 rps) | 583 ms | 1 281 ms | **2 489 ms** |
| 79 s avec 3 relectures | 2 522 (31,9 rps) | 578 ms | 5 418 ms | **12 769 ms** |
| 66 s sans relecture (2ᵉ) | 4 521 (68,5 rps) | 559 ms | 832 ms | **1 142 ms** |
| 79 s avec 3 relectures (2ᵉ) | 2 802 (35,5 rps) | 574 ms | 5 247 ms | **12 418 ms** |

Chaque rafale de 400 requêtes met **12,8 à 14,1 s** à se résorber (p99 des
trois rafales de chaque passage), et le débit stable tombe de ~65 à ~34 rps
pendant la phase avec relectures (~−48 %). La rafale seule, serveur au repos,
dure **12,6 à 13,1 s**, ses 400 départs étalés sur 0,75 à 0,83 s : ce n'est
donc pas le générateur qui plafonne, c'est le serveur qui fait la queue.

Le p99 de REPOS de ce relevé (1,1 à 2,5 s) est plus haut que celui du premier
passage au plancher de 10 s (0,12 à 0,25 s, même harnais, hôte moins chargé) :
le RAPPORT entre les deux phases n'est donc pas le chiffre transférable — la
file de 12 à 13 s, elle, se retrouve dans les deux relevés. C'est cette file
que 30 s rendent trois fois plus rare (2,3 rafales/min au lieu de 6,9).

**3. Ce que cela dit du contrat.** 30 s est la parité, pas une marge : à 400
flux, 2,3 relectures/min valent 918 req/min, contre 800 pour les 2 req/min par
session retirées. Ce qui se paie encore est la RAFALE, pas le taux : 400
relectures simultanées font la queue 12 à 13 s et font tomber le débit stable
de moitié. À 30 s d'espacement elle arrive 2,3 fois/min, contre 6,9 à 10 s —
c'est là que se joue la latence des autres clients, et c'est pourquoi le
plancher n'est pas descendu plus bas : la réparation serait plus rapide, au
prix d'une rafale toutes les 10 s.

Ce que ce banc ne mesure pas : le coût d'une relecture dans le NAVIGATEUR (la
rafale ne compte qu'un appel par flux ; un client qui relit notifications,
conversations et messages en émet plusieurs, donc 918/min est une **borne
basse**), le RTT d'un vrai Redis, et la production elle-même (machine
partagée, générateur local : les p99 absolus sont pessimistes, la cadence et
la file sont les chiffres transférables).

```
cd backend && python scripts/charge/mesure_resync.py     # cadence (180 s) + p99
python scripts/charge/mesure_resync.py --sans-http        # cadence seule
python scripts/charge/mesure_resync.py --http-seul        # la rafale seule
python scripts/charge/mesure_resync.py --controle-seul    # le générateur plafonne-t-il ?
# sans backend/.env : APP_ENV=development (le fail-fast JWT_SECRET refuse la production)
```

### La projection, recalculée

| Scénario | Sondages AVANT | Sondages APRÈS | + navigation | Total avant | Total après | Machines à 85 rps |
|---|---:|---:|---:|---:|---:|---:|
| 100 000 **comptes**, 10 % actifs le jour | 67 rps | **0** | ~65 rps | ~212 rps | **~65 rps** | **1** (avant 4) |
| 100 000 **comptes**, 20 % actifs, pic | 293 rps | **0** | ~130 rps | ~423 rps | **~130 rps** | **2** (avant 8) |
| 100 000 **sessions simultanées** | ~7 300 rps | **0** | ~3 000 rps | ~10 300 rps | **~3 000 rps** | ~36 (avant ~200) |

Sur les requêtes de sondage, la division n'est pas par cinq mais TOTALE : elles
disparaissent. Sur le total d'un pic à 4 000 sessions (423 → 130 rps), c'est
**divisé par 3,3**, parce que les deux tiers restants étaient déjà de la
navigation — que le push ne touche pas. La demande (« diviser la charge par
cinq ») est satisfaite là où elle portait : 293 rps de sondages retirés, 0
ajouté.

**La contrainte qui remplace le CPU est le nombre de CONNEXIONS.** À 800 par
machine (`fly.toml`, `[services.concurrency]`, relevé de 50), 4 000 sessions
simultanées demandent 5 machines pour leurs connexions même si le CPU en
suffirait à 2. C'est une borne de configuration explicite, pas une saturation :
`KOJO_SSE_MAX_TOTAL` (1000 par défaut) refuse proprement au-delà, et le client
retombe sur le repli.

### Ce que le push ne garantit pas

- **Le fan-out est en mémoire, et le bus le prolonge.** `kojo_live.publish`
  dépose toujours localement d’abord, puis confie l’événement à un canal Redis
  pub/sub quand `REDIS_URL` est posé ; chaque process écoute ce canal et
  redistribue à SES flux. Sans `REDIS_URL`, rien ne change : un événement
  publié ne joint que les flux de ce process (exact avec un worker), et
  `start_bus` DIT la perte si `WEB_CONCURRENCY > 1` — `kojo_settings` refuse
  même de démarrer dans ce cas en production. Ce que le bus ne fait pas : il ne
  porte pas de présence (aucune liste de flux par compte n’est partagée), il
  n’ordonne rien entre process, et une publication qui échoue est retentée sur
  la MÊME enveloppe (`bus_stats()['repli']` compte la tentative) : les autres
  workers la reçoivent en RETARD, pas jamais. Ce que la reprise empêche, et qui
  a été mesuré : sans elle, la tâche retirait une enveloppe du tampon, la
  publication échouait, et elle passait à la suivante — **799 des 800**
  enveloppes d’une fenêtre de 2 s parvenaient au bus, la manquante n’étant
  comptée NULLE PART (`perdus` restait à 0). Banc :
  `scripts/charge/mesure_panne_redis.py` (400 flux, 400 évt/s, panne réelle :
  800/800 depuis la correction). **Le second bout du bus perd, lui, vraiment :**
  le pub/sub n’a aucun historique, donc ce qu’un autre worker publie pendant
  qu’un process n’écoute pas ne lui sera jamais rejoué. C’est mesuré — douze
  enveloppes publiées pendant la fenêtre, zéro livrée — et non caché : la
  fenêtre est comptée (`bus_stats()['reprises']`) et chaque flux local reçoit
  `resync` au rétablissement, c’est-à-dire RELIT la source de vérité. La
  cadence des relectures est bornée (`RESYNC_MIN_INTERVAL_SECONDS`, **30 s**)
  pour ne pas redevenir plus bavarde que le sondage remplacé (2 req/min), avec
  une relecture différée pour la dernière fenêtre d’une rafale. Ce plancher
  n’est pas un réglage : à 10 s — sa valeur d’origine — une rafale de
  reconnexions relisait les flux six fois par minute, trois fois plus bavard
  que le mécanisme remplacé. La parité est JUGÉE
  (`.github/scripts/check-resync-parite.py`, étape de `workflow-lint`) contre le
  seuil **lu** dans la sonde (`ANCIEN_SONDAGE_MS`), jamais recopié. Et une
  lecture qui
  expire n’est pas une panne : la lecture par `get_message` avec un délai
  explicite rend `None` sur un canal calme ; `listen()`, lui, héritait du
  `socket_timeout` du client (2 s) et rompait l’abonnement toutes les 2,2 s —
  donc restait sourd près de la moitié du temps, la perte que ce paragraphe
  décrit devenant permanente au repos (mesuré le 19/10/2026). Ce qu’il coûte :
  un message par événement par process abonné, et un tampon borné
  (`KOJO_LIVE_BUS_QUEUE`, 1000) dont le dépassement est compté (`perdus`) — le
  bus perd, jamais le flux local. **Mesuré** à 200 flux (§5) : non
  distinguable du bruit à 5 comme à 50 événements/s ; ce qui sature, c'est le
  fan-out par flux ouvert.
- **Le flux n'est pas la source de vérité.** La ligne est stockée AVANT d'être
  poussée ; `ready` recompte, et `resync` (file pleine) fait relire. Un client
  qui perd un événement se répare en relisant l'API.
- **Le shell natif suit la même route** : le flux est lu par `fetch` (en-têtes
  `Authorization`), jamais par `EventSource` — donc aucun jeton dans l'URL.
- **Un flux muet est une panne, pas un calme.** Le client coupe et retombe sur
  le repli après `SILENCE_TIMEOUT_MS` sans un octet — **45 s**, soit deux
  battements du serveur (20 s) plus une marge de gigue, déclarés ensemble dans
  `frontend/src/config/flux-temps-reel.js`. La fenêtre est forcément PLUS LONGUE
  que le battement : à 15 s contre 20 s (le 18/10/2026), un flux **vivant mais
  inactif** était déclaré tombé 5 s avant son premier `: keepalive`, donc rouvert
  à chaque cycle — plus d'allers-retours que le sondage qu'il remplaçait.
  Sans ce chien de garde, un proxy qui tamponne la réponse (200 puis rien)
  laisserait croire au flux vivant : aucun événement ET aucun sondage — le pire
  état possible. La borne haute (90 s) est là pour que ce filet morde encore.
  Le passage par le proxy Vercel en production n'a pas été mesuré ici ; le
  chien de garde est ce qui rend ce cas visible au lieu de silencieux.

Garde : `tests/test_live_stream.py` (serveur), `frontend/src/services/__tests__/liveStream.test.js`,
`frontend/src/contexts/__tests__/NotificationStream.test.jsx` et
`frontend/src/pages/__tests__/MessagesStream.test.jsx` (client).

---

## 6. Ce qui casse *avant* le CPU (à corriger en premier)

1. **`fly.toml` : une seule machine, 1 vCPU, 512 Mo, `min_machines_running = 1`.**
   `hard_limit` valait **50 connexions** simultanées par machine — avec le flux
   SSE, chaque session en tient une, donc 50 aurait plafonné le produit à ~50
   utilisateurs connectés. Il a été relevé à **800** au passage au push… sur
   **256 Mo**, c'est-à-dire une promesse que la RAM ne tenait pas (voir
   §6.1bis). Il vaut aujourd'hui **400** (`soft_limit` 200) sur 512 Mo. Pour
   100k comptes : `min_machines_running ≥ 2`, et
   **`WEB_CONCURRENCY > 1` exige `REDIS_URL`** (garde de démarrage dans
   `kojo_settings.py` : sans Redis le rate-limit serait multiplié par le nombre
   de workers — et le bus SSE, lui, ne franchirait pas la frontière du process).
2. **Le rate-limit par IP est incompatible avec le CGNAT d'Afrique de l'Ouest.**
   `auth-session` valait **20 requêtes / 5 min / IP** : derrière une IP partagée
   par des milliers d'abonnés Orange/Sonatel, un pic de connexions produisait des
   429 massifs et légitimes. Réglé en deux temps (20/10/2026) : la CONNEXION a
   son propre bucket (`auth-login`, 300/5 min — un garde-fou de débit brut, pas
   un juge d'attaque) et l'attaque est plafonnée là où elle se décrit,
   `kojo_login_reseau` : 120 ÉCHECS / 15 min par `/24` (`/64` en IPv6), puis
   goutte-à-goutte à une tentative / 5 s. `auth-session` 20/5 min ne garde plus
   que l'INSCRIPTION, où un abus crée des comptes. Ce qui reste à dimensionner
   pour 100k : le compteur réseau est PAR PROCESS sans `REDIS_URL` (avec Redis il
   est partagé) — c'est la même dépendance que le rate-limiter.
3. **Un index manquant** : `GET /jobs?mine=assigned` filtre sur
   `assigned_worker_id`, qui **n'était pas indexé** — scan complet de la
   collection à chaque ouverture de « mes missions ». Ajouté (§8).
4. **Lecture non bornée** : `GET /users/:id/reviews` fait
   `to_list(length=None)` — le profil d'un travailleur très noté renvoie toute
   la collection. À borner (100, comme les propositions) ou paginer.
5. **Recherche `q` sur `/jobs`** : `$regex` insensible à la casse sur titre +
   description, sans index texte → scan complet. Acceptable à 2 000 missions,
   pas à 100 000.
6. **MongoDB Atlas** : le palier doit encaisser `machines × workers × 100`
   connexions (pool Motor par défaut) ; les index de `kojo_db` doivent être
   vérifiés sur le palier réel (le banc ne les mesure pas).

### 6.1bis. Ce que la RAM tient vraiment — mesuré le 18/10/2026

Une limite de connexions n'est pas une opinion : c'est
`(RAM × 0,75 − base) ÷ coût mesuré d'une session`. Le banc
`scripts/charge/mesure_memoire_flux.py` relève le RSS du serveur à 0, 100, 200
et 400 flux **ouverts** (`serveur_mesure.py`, base en mémoire) :

| Flux ouverts | RSS |
|---:|---:|
| 0 | 166,6 Mo |
| 100 | 182,9 Mo |
| 200 | 220,5 Mo |
| 400 | 243,6 Mo |

Le coût **marginal** est de **276 Ko** en moyenne pondérée, **385 Ko au pire
palier** — et c'est le pire qui décide (l'allocateur ne rend pas la mémoire
d'un palier fermé, une moyenne effacerait le palier qui a coûté cher). La base
de 166 Mo vient d'un poste Windows, donc c'est un **majorant** : l'interpréteur
Linux de l'image est plus léger.

| Config | Calcul | Verdict |
|---|---|---|
| 256 Mo / 800 | 166,6 + 800 × 0,385 = **474 Mo** pour 192 Mo | impossible (état d'avant le 18/10) |
| 512 Mo / 800 | 474 Mo pour 384 Mo | encore au-dessus |
| **512 Mo / 400** | 166,6 + 400 × 0,385 = **320 Mo** pour 384 Mo | **retenu** (83 % du budget) |

D'où `memory_mb = 512`, `hard_limit = 400`, `soft_limit = 200`, et
`MAX_STREAMS_TOTAL = 400` comme **défaut du code** (`kojo_live.py`) : le plafond
applicatif ne promet plus 1000 flux à un process que la plateforme arrête à
400. Il n'est PAS dans `[env]` de fly.toml, et c'est voulu : la sonde de drift
lit une clé `[env]` pas encore déployée comme une configuration non appliquée,
si bien qu'une variable ajoutée dans une PR rendrait le job rouge jusqu'au
déploiement. Le refus devient
alors le 503 nommé du produit (`Retry-After`), pas un OOM choisi par Fly — et
comme `soft_limit` fait ajouter une machine avant la limite dure, l'échelle
vient de l'horizontal, pas d'une promesse plus grosse.

Ce que cette mesure ne dit pas : le coût d'un flux qui **reçoit** des
événements (le banc mesure des flux immobiles), le RSS de l'image Linux
elle-même (majorant), et la mémoire de MongoDB. La mesure est écrite dans
`backend/scripts/charge/mesure_memoire.json` et **relue** par
`backend/tests/test_dimensionnement_machine.py` : un `hard_limit` au-dessus de
la RAM fait rougir le test (vérifié en sens inverse le 18/10 : 800/256 →
« la machine ne tiendra pas ce qu'elle annonce »).

---

## 7. Ce que le banc a changé dans le produit

| Fichier | Changement |
|---|---|
| `kojo_email.py` | `send_email_via_active_provider` appelle le fournisseur via `asyncio.to_thread` — point unique de tous les envois (OTP, alertes, tickets) |
| `kojo_routers_payments.py` | `create_paydunya_invoice` (timeout 30 s) hors de la boucle |
| `kojo_routers_auth.py` | échange de code Google + `tokeninfo` (2 × 15 s) hors de la boucle |
| `kojo_db.py` | index `jobs.assigned_worker_id` |
| `tests/test_event_loop_non_blocage.py` | garde : l'envoi ne tourne pas sur la boucle (mutation rejouée : rouge) |
| `kojo_live.py` | bus SSE en mémoire : fan-out par compte, battement de cœur, plafonds, refus nommé |
| `kojo_routers_notifications.py`, `kojo_routers_messages.py` | `GET /notifications/stream` et `GET /messages/stream` ; le message est poussé à l'envoi |
| `kojo_shared.py` | `store_notification` publie la ligne APRÈS l'avoir stockée (identifiant serveur dans le flux) |
| `NotificationContext.js`, `Messages.js` | sondages de 30 s / 15 s / 5 s remplacés par un flux ; repli à 60 s seulement s'il tombe |
| `fly.toml` | `hard_limit` 50 → 800 → **400 sur 512 Mo** (une session SSE tient une connexion), dimensionné par `mesure_memoire_flux.py` (§6.1bis) |
| `scripts/charge/mesure_memoire_flux.py` | banc : RSS par palier de flux ouverts, coût marginal et pire palier, `mesure_memoire.json` |
| `tests/test_dimensionnement_machine.py` | garde : la config ne promet pas plus que `base + hard_limit × coût_pire ≤ RAM × 0,75` |
| `scripts/charge/mesure_push.py` | banc : débit et p95 avec/sans 200 connexions ouvertes, flux muets ou publiés, bus actif ou non (§5) |
| `scripts/charge/mesure_panne_redis.py` | banc : panne de Redis pendant la fenêtre de reconnexion (socket et client `redis-py` réels, serveur pub/sub minimal) — enveloppes reçues, comptées perdues, pertes MUETTES |
| `scripts/charge/mesure_resync.py` | banc : cadence des relectures `resync` à 400 flux (Redis arrêté/relancé pour de vrai) et effet de la rafale de 400 relectures sur le p99, contrôle du générateur compris (§5) |
| `scripts/charge/serveur_mesure.py` | `--bus memoire` (pub/sub en mémoire, protocole `redis.asyncio`), `POST /_mesure/publier`, `GET /_mesure/bus` (§5) |

Non corrigé, volontairement listé : bornage des avis (§6.4), index texte pour
`q`, et politique de rate-limit CGNAT — les trois demandent une décision
produit, pas un correctif mécanique.

---

## 8. Limites de ce compte rendu

- Le banc mesure la **couche applicative** ; la base est simulée (1 ms/op).
  Les débits réels dépendront du palier Atlas et du réseau.
- Le générateur plafonne à ~320 rps : au-delà, les paliers décrivent la
  contention du client autant que celle du serveur.
- Client et serveur partagent la même machine : les débits absolus sont
  **pessimistes** ; les comparaisons avant/après restent valables.
- Le banc du push mesure des connexions **locales** : il prouve ce que coûte
  une connexion immobile au serveur, pas la tenue d'un flux à travers un
  opérateur mobile (coupures, changement de réseau). C'est le rôle du battement
  de cœur et du repli à 60 s — et ce n'est pas mesuré ici.
- Le coût du bus (§5) est mesuré avec un serveur pub/sub **en mémoire**, faute
  de Redis joignable sur la machine de mesure : le protocole et le fan-out sont
  ceux de la production, l'aller-retour réseau ne l'est pas. Les chiffres sont
  une borne basse, et le fan-out inter-process n'est pas jugé ici.
- La rafale de `resync` (§5) compte **un appel par flux** : c'est le minimum
  qu'un client fait en relisant, pas ce qu'il fait réellement (rendu, appels
  multiples) — le coût mesuré des relectures est donc une borne basse.
- Les projections du §5 sont des **hypothèses de trafic**, explicitées comme
  telles — pas des mesures.
