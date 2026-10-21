# Sauvegardes et restauration — MongoDB Atlas

Ce document est la **procédure** de restauration de la base de production, la
**preuve datée** de l'exercice, et ce qui reste à faire pour que les sauvegardes
soient vérifiées toutes seules.

Il ne contient aucun secret : les clés Atlas vivent dans les secrets GitHub
(`ATLAS_PUBLIC_KEY`, `ATLAS_PRIVATE_KEY`, `ATLAS_PROJECT_ID`, `ATLAS_CLUSTER`)
et dans le coffre du propriétaire, jamais ici.

---

## 1. Ce qu'Atlas doit avoir — et comment on le VÉRIFIE

Trois choses, et aucune ne se suppose :

| Exigence | Pourquoi | Où elle se lit |
|---|---|---|
| `backupEnabled = true` | sans sauvegarde, il n'y a rien à restaurer | API Atlas, champ du cluster |
| `pitEnabled = true` (restauration continue) | sans PITR, le RPO est celui du dernier snapshot — **jusqu'à 6 h de pertes** | API Atlas, champ du cluster |
| palier dédié **M10 minimum** | les paliers partagés M0/M2/M5 **ne fournissent pas** la restauration continue, quelle que soit la case cochée | `replicationSpecs[].regionConfigs[].electableSpecs.instanceSize` |

La sonde `backend/scripts/check_atlas_backups.py` interroge
`GET /api/atlas/v2/groups/{groupId}/clusters/{nom}` (authentification DIGEST par
clés API) et rend **trois** sorties :

| Code | Sens | Ce que ça veut dire |
|---:|---|---|
| **0** | les deux champs sont vrais | sauvegardes + PITR actives |
| **1** | un des deux est faux | le message nomme lequel, le palier, et le remède — c'est l'alerte |
| **2** | impossible de juger | clés absentes, 401/403, 404, réseau, réponse sans les champs. **Aucun verdict rendu** : une surface aveugle se déclare, elle ne vaut pas un vert |

Le workflow `.github/workflows/atlas-backups-probe.yml` l'exécute chaque jour
(06:45 UTC) : un code 1 ou 2 rend le run **rouge** et publie une annotation
`::error title=Sauvegardes Atlas …::`. GitHub notifie le propriétaire du dépôt.
Un run rouge pour cause de code 2 est une **prémisse** (les clés ne sont pas
posées), pas une panne de sauvegarde : la distinction est écrite dans le
message, pour qu'on ne cherche pas une panne qui n'existe pas.

Depuis le 21/10/2026, cette prémisse publie **aussi** une ligne `[MESURÉ]` avec
l'âge de la dernière sauvegarde EXTERNE. Motif mesuré : les clés `ATLAS_*` ont
été refusées (401) le jour même où `backup-db.yml` venait d'aboutir, et le run
ne disait **rien** de cette moitié — on y lisait « on ne sait rien » là où un
fait était mesurable. Le code reste **2** : un fait rassurant à côté d'un refus
ne fait pas un vert, et la sonde ne prétend pas avoir jugé Atlas.

À la main, la même vérité se lit dans le tableau de bord : **Atlas → Project →
Cluster → Backup**. Une case « Cloud Backup » cochée sans « Continuous Cloud
Backup » est le cas piégeux que la sonde attrape.

### Le cluster est en M0 : la sauvegarde est EXTERNE, et la sonde juge sa fraîcheur

Relevé le 19/10/2026, clés `ATLAS_*` posées : le cluster de production `Kojo`
est un **M0** (fournisseur TENANT), `backupEnabled=false`, `pitEnabled=false`.
Un palier partagé ne fournit **aucune** sauvegarde continue : « activer le
Cloud Backup » y est impossible, et la sonde le dit au lieu de le demander.
La seule restauration possible est donc celle du workflow
`.github/workflows/backup-db.yml` (cron 02:40 UTC) :

1. `mongodump` de la production, archive unique compressée ;
2. base de travail `kojo_verif` vidée, puis `mongorestore` de CETTE archive
   dedans ;
3. comparaison source/archive par `backend/scripts/exercice_restauration.py`
   **`--deja-restauree`** (empreintes SHA-256 par collection, index ET options
   d'index) — une archive non restaurée n'est pas une sauvegarde.
   Le mode compte : sans lui le script **détruit** la base que `mongorestore`
   vient de remplir pour la recopier lui-même depuis la source, et le run
   devient vert sans avoir jamais jugé l'archive — c'est-à-dire sans avoir jugé
   le seul objet qui serve le jour d'une perte. Dans ce mode le RTO n'est pas
   prétendu non plus : `mongorestore` a restauré hors du script, donc le rapport
   le dit (`rto_mesure_s: null`) au lieu de publier la durée d'une comparaison ;
4. chiffrement AES-256 (les dumps contiennent des données personnelles) ;
5. dépôt sur un bucket S3/R2 **privé**, avec empreinte et taille publiées.

La sonde Atlas juge alors la **fraîcheur** du dernier run réussi de ce
workflow — 36 h par défaut (`BACKUP_FRAICHEUR_MAX_HEURES`) — parce qu'une
sauvegarde de trois jours n'est pas une sauvegarde. Six secrets sont
nécessaires : `MONGO_URL`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`,
`BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_KEY`, `BACKUP_PASSPHRASE`.
Sans eux le workflow rend **2** en nommant ce qui manque, et la sonde rougit en
disant qu'aucune sauvegarde externe n'a jamais abouti.

### Mise en service du bucket (une fois, et avec preuve)

Un dépôt qu'on n'a jamais relu n'est pas une sauvegarde. La mise en service se
fait donc en trois temps, avec un outil qui **juge** avant d'écrire :
`backend/scripts/preparer_sauvegarde_externe.py`.

1. **Créer le bucket privé** dans le tableau de bord du fournisseur (R2 :
   *Storage → Create bucket*, « Public access » **désactivé** ; S3 : blocage de
   tout accès public). L'API S3 de R2 n'implémente pas `CreateBucket` : l'outil
   ne le fait pas et le dit, au lieu d'échouer sur une erreur de transport.
2. **Créer un jeton d'objet** (R2 : *Manage R2 API Tokens* → « Object Read &
   Write »). Il donne `BACKUP_S3_ACCESS_KEY_ID` et `BACKUP_S3_SECRET_KEY` ;
   `BACKUP_S3_ENDPOINT` vaut `https://<account-id>.r2.cloudflarestorage.com`.
   L'utilisateur Atlas de la sauvegarde est DÉDIÉ (`kojo-backup`) :
   `readWrite` sur `kojo_db`, et `readWrite` **+ `dbAdmin`** sur `kojo_verif` —
   l'exercice repart d'une base de travail vide (`dropDatabase`), action que
   `readWrite` ne couvre pas (mesuré : `user is not allowed to do action
   [dropDatabase] on [kojo_verif.]`). L'URI doit porter `authSource=admin` :
   sans lui le pilote cherche l'utilisateur dans la base du chemin et rend
   « bad auth » (mesuré aussi).
3. **Écrire les six valeurs dans un fichier local** `.backup-secrets.env`
   (ignoré par git : `*.env`). `MONGO_URL` doit pouvoir **lire `kojo_db` et
   écrire `kojo_verif`** : l'exercice restaure l'archive dans `kojo_verif`, donc
   un utilisateur en lecture seule échouerait à la restauration, pas au dump —
   c'est-à-dire après avoir cru sauvegarder. Aucune valeur ne se colle dans un
   ticket ni dans un journal : l'outil ne les affiche jamais.

```bash
# 1. juger : bucket privé (lecture anonyme refusée), clés qui écrivent ET
#    relisent le même objet, phrase secrète qui DÉCHIFFRE ce qu'elle chiffre
python backend/scripts/preparer_sauvegarde_externe.py --fichier .backup-secrets.env
# 2. poser les six secrets (la liste est LUE dans le workflow, jamais recopiée)
python backend/scripts/preparer_sauvegarde_externe.py --fichier .backup-secrets.env \
    --poser-secrets --depot <owner>/<repo>
# 3. déclencher la première sauvegarde réelle, puis la sonde qui la juge
python backend/scripts/preparer_sauvegarde_externe.py --declencher \
    --depot <owner>/<repo> --ref main
```

Ce que l'outil refuse, et pourquoi : un bucket qui répond **200 sans
authentification** est public (l'archive est chiffrée, mais sa présence et sa
taille fuient — et une erreur de chiffrement un jour la publierait) ; des clés
qui écrivent mais ne relisent pas ne prouvent rien ; une phrase secrète qui
chiffre sans déchiffrer rendrait l'archive **irrécupérable**, et c'est la seule
panne qui ne se découvre qu'au moment de restaurer. Sortie : 0 tout est prouvé,
1 un fait est faux (nommé), 2 rien n'a pu être jugé.

Le dernier temps ne rend un vert que si **les deux** disent oui : le run de
sauvegarde a réussi (dump, restauration comparée à la source, chiffrement,
dépôt) **et** la sonde Atlas juge cette sauvegarde fraîche. Un run vert dont la
sonde refuse ne prouve pas la restauration, et une sonde verte sans run récent
ne prouve rien du tout.

Relevé du 21/10/2026, bucket `kojo-sauvegardes` (R2, compte `2d2623e9…`) :
lecture anonyme **refusée** (HTTP 400, motif `Authorization` — R2 ne répond pas
403 à un anonyme, et un 400 sans ce motif n'est PAS un refus), cycle
écriture → relecture identique → effacement **prouvé**, phrase secrète
**éprouvée**. Ce qui restait à ce moment-là : `MONGO_URL` (lire `kojo_db`,
écrire `kojo_verif`) et le premier run réel.

---

## 2. Procédure de restauration (production)

Deux chemins selon l'incident. Dans les deux, **on ne restaure pas par-dessus la
production sans avoir vérifié la cible** : on restaure dans un cluster
temporaire, on vérifie, puis on bascule l'URL — ou l'on restaure en place si
l'incident est déjà une perte totale.

### A. PITR / snapshot Atlas (chemin normal)

1. **Geler les écritures** : `flyctl scale count app=0 -a kojo-backend` (ou
   `auto_stop_machines`), pour que la cible ne bouge plus pendant la copie.
2. **Créer la cible** : un cluster temporaire du **même palier** dans la même
   région (`fra`), nommé `kojo-restore-<date>`.
3. **Lancer la restauration** : Atlas → Backup → *Restore* → choisir
   *Point in Time* (date/heure précise) ou *Snapshot*, destination **le cluster
   temporaire**. L'équivalent API est
   `POST /api/atlas/v2/groups/{groupId}/clusters/{cluster}/backup/restoreJobs`
   — la projection qu'il faut surveiller est `stateName` jusqu'à `DONE`.
4. **Vérifier la cible** (section 4, les mêmes requêtes) — comptes par
   collection, index, et un document témoin.
5. **Basculer** : nouveau `MONGO_URL` →
   `flyctl secrets set MONGO_URL=… -a kojo-backend`, puis redémarrer les
   machines. Le health check `/health` doit rendre `database: connected` et
   `/monitor` rester vert.
6. **Rouvrir les écritures** : `flyctl scale count app=1 -a kojo-backend`.
7. **Détruire la cible temporaire** seulement après une sauvegarde fraîche du
   cluster restauré (sinon on jette l'unique copie vérifiée).

> Le basculement est un changement de `MONGO_URL` : c'est une rotation de
> secret, elle suit `CONTINUITE.md` §3 (nouvelle valeur hors dépôt, jamais dans
> un fichier).

### B. Repli `mongodump` / `mongorestore` (Atlas indisponible)

Atlas ne sait pas exporter sans être joignable ; ce chemin sert quand on a un
dump, ou un snapshot téléchargé. Il sert aussi à **prouver** la procédure sans
toucher la production (section 3).

```bash
# sauvegarde (RPO = instant du dump)
mongodump --uri "$MONGO_URL" --db kojo_db --gzip --out ./sauvegarde-$(date -u +%Y%m%dT%H%M%SZ)

# restauration vers une cible VIDE (jamais --drop sur la production)
mongorestore --uri "$MONGO_URL_CIBLE" --db kojo_db --gzip --drop ./sauvegarde-<horodatage>/kojo_db

# vérification
mongosh "$MONGO_URL_CIBLE" --quiet --eval '
  db.getCollectionNames().sort().forEach(c => print(c, db[c].countDocuments({})));
  print("index users :", db.users.getIndexes().map(i => i.name).join(","));
'
```

Ce que ce chemin **ne** donne pas : le RPO de PITR. Il vaut l'heure du dump.

---

## 3. Exercice exécuté — 18/10/2026

**Ce qui a été exécuté, réellement** : un MongoDB local (7.0.14, port 27019,
répertoire `\.mongo-tmp\drill`, ignoré par git), un jeu de données de forme
production, puis **dump → suppression de la base → restauration → vérification
d'empreinte**. Outils : MongoDB Database Tools 100.10.0.

| Étape | Résultat mesuré |
|---|---|
| Jeu de données | **328 000 documents** : users 20 000, jobs 5 000, payments 3 000, notifications 200 000, messages 100 000 — **61,1 Mo** |
| `mongodump` (sans compression) | **4,2 s**, archive de **61,1 Mo** |
| `mongodump --gzip` (**la commande du §2**) | **1,5 s**, archive de **3,9 Mo** |
| Sinistre simulé | `drop_database("kojo_drill")` → 0 collection |
| `mongorestore --drop` | **56,9 s** |
| `mongorestore --gzip --drop` (**la commande du §2**) | **28,0 s** |
| **RTO mesuré** (dump + restauration) | **61,0 s** en brut, **29,5 s** avec `--gzip`, pour 61,1 Mo de données |
| Comptes par collection après restauration | **identiques** (20 000 / 5 000 / 3 000 / 200 000 / 100 000) |
| Empreinte SHA-256 des documents | **identique** avant/après : `cf7f3c3f…d22d8b` |
| Index `id` (unique) | **restauré sur les 5 collections** |

Les DEUX variantes ont été lancées : celle du §2 est la variante `--gzip`, et
c'est elle qui donne le RTO de 29,5 s. Le rapport de compression (61,1 → 3,9 Mo)
est **gonflé** par le jeu de test, très répétitif : sur des données réelles,
compter un facteur bien plus faible. La restauration, elle, reste dominée par
autant de documents à réinsérer et d'index à reconstruire — c'est la variable
qui compte pour un RTO, pas la taille de l'archive.

### Ce que l'exercice prouve

- Les commandes du repli **fonctionnent telles qu'elles sont écrites** : les
  deux variantes (`--gzip` et brut) ont été lancées, pas relues.
- La **vérification** est réelle : ce n'est pas « ça a l'air d'être là », c'est
  une empreinte SHA-256 du contenu complet, plus les comptes et les index. Une
  restauration partielle ou un index perdu la font échouer.
- L'ordre des opérations (geler → restaurer ailleurs → vérifier → basculer → ne
  détruire qu'après une sauvegarde fraîche) est exécutable de bout en bout.

### Ce que l'exercice NE prouve PAS

- **Le chemin Atlas (PITR) n'a pas été exécuté** : il exige les clés API du
  projet et le droit de créer un cluster. La sonde le vérifie à partir du jour
  où les secrets existent ; le premier vrai exercice PITR reste à faire.
- Le **RTO de production** n'est pas 61 s : ici la base est locale et vide de
  charge concurrente. Le chiffre utile est le **débit** observé, ~1,1 Mo/s à la
  restauration sur ce poste ; pour estimer un RTO, diviser la taille du dump de
  production par ce débit, puis ajouter la durée de création du cluster Atlas.
- La **fraîcheur** (RPO) n'est mesurée par aucun exercice : elle vient du
  réglage PITR, que la sonde vérifie, pas d'un dump.
- Le bloc de vérification `mongosh` du §4 est fourni mais **n'a pas été
  exécuté** : `mongosh` n'était pas installé sur l'hôte du drill. La
  vérification réellement faite est l'empreinte SHA-256 du contenu complet
  (calculée par `pymongo`), plus les comptes et les index — plus stricte qu'un
  comptage, mais avec un autre outil.

---

## 3bis. Exercice exécuté — 21/10/2026 (production, base restaurée comparée)

Rejoué par `backend/scripts/exercice_restauration.py` sur la VRAIE base de
production, avec un utilisateur dédié `kojo-backup` (rôles `readWrite` sur
`kojo_db`, `readWrite` + `dbAdmin` sur `kojo_verif`) :

| Étape | Résultat mesuré |
| --- | --- |
| Source | `kojo_db`, **20 collections**, **403 documents** au 21/10/2026 (la production est quasi vide : ce chiffre ne dit rien du volume futur) |
| Restauration (recopie + recréation des index) | **32,8 s** |
| Vérification (empreintes SHA-256 des deux côtés) | **9,3 s** |
| **RTO mesuré** | **51,7 s** |
| Verdict | **identique** : aucun écart, empreintes et index compris |
| Base de travail | `kojo_verif` **détruite** après comparaison |

Deux choses que cet exercice a corrigées, mesurées et non supposées :

1. **les options d'index sont recopiées TELLES QUELLES.** Ne garder que
   `unique` perdait `sparse`, et la reconstruction de
   `payments.idempotency_key` échouait dès le deuxième document sans clé
   (`E11000 duplicate key`, run 39526117357) ; elle perdait aussi
   `expireAfterSeconds`, donc une restauration aurait gardé POUR TOUJOURS les
   collections à TTL ;
2. **la comparaison juge la DÉFINITION, pas le nom.** Un index présent mais
   sans `sparse`, sans TTL ou sans filtre partiel est désormais un ÉCART nommé —
   le nom seul ne disait rien du comportement.

Ce que cet exercice ne prouve toujours pas : l'archive `mongodump` chiffrée et
son dépôt sur le bucket (c'est le rôle du workflow `backup-db.yml`), et la
restauration d'un point PITR côté Atlas.

## 3ter. Exercice Atlas rejouable — préparé le 18/10/2026, **non exécuté**

L'exercice du §3 prouve les commandes du repli sur une base **locale**. Le
chemin **Atlas** restait non exécuté, et c'était écrit. Le 18/10/2026, la
tentative d'exercice Atlas a été faite et s'est arrêtée sur une **prémisse** :
ni URI de connexion (`MONGO_URL`) ni droit de créer un namespace sur le
cluster ne sont disponibles depuis l'hôte qui a lancé la commande, et les
binaires `mongodump`/`mongorestore` n'y sont plus installés. Aucun verdict n'a
donc été rendu — et c'est le résultat honnête : un exercice « réussi » sans
base lue serait le pire des deux mondes.

Ce qui a été livré à la place, et qui rend l'exercice rejouable en UNE
commande : `backend/scripts/exercice_restauration.py`.

```bash
# L'URI de LECTURE du cluster vient de l'environnement du propriétaire, JAMAIS
# de ce fichier : une adresse Atlas citée dans un runbook est refusée par son
# propre garde (`test_atlas_backups_probe.py`). `:?` échoue bruyamment si elle
# n'est pas posée, plutôt que de lancer un exercice sans base.
MONGO_URL="${KOJO_ATLAS_READ_URI:?poser l'URI de lecture Atlas hors dépôt}" \
  python backend/scripts/exercice_restauration.py \
  --base kojo_db --rapport "restauration-$(date +%F).json"
```

Ce que le script fait, et qui est la moitié vérifiable sans privilège de
cluster : il lit la base réelle, calcule pour chaque collection le nombre exact
de documents, une empreinte **SHA-256 du contenu complet** (documents encodés
BSON, ordonnés par `_id`) et les noms d'index, **restaure** dans une base de
travail `<base>_restauration_<AAAAMMJJ>` du **même** serveur, recalcule la même
empreinte, **compare**, puis détruit la base de travail (ou la garde avec
`--garder`). Codes : 0 identique, 1 écart mesuré, 2 prémisse. Il refuse
`--cible` égale à `--base` : un exercice ne restaure jamais par-dessus la
source.

Ce qu'il **ne** prouve toujours pas, et qui reste le vrai exercice Atlas à
faire : la restauration d'un **snapshot** ou d'un **point PITR** depuis
l'interface/API Atlas (elle exige le palier et les clés API, cf. §1). Le script
compare une copie restaurée à la source ; il ne restaure pas une sauvegarde
Atlas. Le premier exercice PITR daté reste donc **à planifier** — c'est le
seul risque du dépôt qui ne se répare pas après coup.

Preuve du script : `backend/tests/test_exercice_restauration.py` (comparaison
réelle : collection absente, document en moins, contenu altéré au bon compte,
index perdu, collection en trop ; prémisse réelle : sans URI et cible = source).

---

## 4. Vérification après restauration (à copier telle quelle)

```bash
mongosh "$MONGO_URL_CIBLE" --quiet --eval '
  const attendus = { users: null, jobs: null, payments: null,
                     notifications: null, messages: null };
  db.getCollectionNames().sort().forEach(c => print(c, db[c].countDocuments({})));
  print("index users :", db.users.getIndexes().map(i => i.name).join(","));
  print("dernier paiement :", db.payments.find({}).sort({created_at:-1}).limit(1).next()?.id);
'
```

Trois choses doivent tenir, dans cet ordre :

1. **les collections attendues existent** (une collection absente = dump
   incomplet, pas « base saine ») ;
2. **les comptes** sont cohérents avec le dump (ou avec le point PITR choisi) ;
3. **les index** sont là — sans `jobs.assigned_worker_id` et les index uniques,
   la base répond mais les requêtes redeviennent des scans (cf. `SCALING.md` §6).

---

## 5. Ce qui reste ouvert (et ce qu'il faut pour fermer)

1. **La sauvegarde EXTERNE existe et se juge** (21/10/2026) : premier run
   réussi de `backup-db.yml` (run 39532321510) — archive restaurée puis
   comparée à la source (404 documents, 20 collections, options d'index
   comprises), chiffrée en AES-256 et déposée sur le bucket privé. La sonde
   juge donc une **fraîcheur** au lieu de constater « aucun run réussi ».
2. **Les quatre clés `ATLAS_*` sont REFUSÉES** (401) depuis le 21/10/2026 :
   elles rendaient un verdict à 00:10 (M0, `backupEnabled=false`,
   `pitEnabled=false`) et ne le rendent plus à 02:22. Cause la plus probable :
   clé supprimée ou roulée pendant la mise en place du compte de sauvegarde,
   ou **liste d'accès IP** d'Atlas qui exclut les runners GitHub. Tant que
   c'est le cas, la sonde sort en **2** : elle publie l'âge de la sauvegarde
   externe (ligne `[MESURÉ]`) mais ne juge PAS le cluster. Remède : Atlas →
   Access Manager → API Keys, clé « Project Read Only », accès réseau incluant
   les runners, puis reposer `ATLAS_PUBLIC_KEY`, `ATLAS_PRIVATE_KEY`,
   `ATLAS_PROJECT_ID`, `ATLAS_CLUSTER`.
3. **Passer le cluster en M10+ et activer Continuous Cloud Backup** si la sonde
   répond 1 : c'est le seul moyen d'avoir un RPO court.
4. **Exécuter un vrai exercice PITR daté** et l'écrire ici (même tableau, même
   empreinte), au moins une fois avant la mise en service à volume.
5. **Cadence** : un exercice par trimestre, daté dans ce fichier. Une procédure
   jamais rejouée est une intention, pas une capacité — et cette cadence n'est
   pas une intention non plus : `.github/scripts/check-exercice-restauration.py`
   lit le titre daté du §3 et **refuse** un exercice plus vieux que 100 jours
   (90 de cadence + 10 de marge, étape de `workflow-lint`). Le runbook ne peut
   donc pas rester « prêt à restaurer » sur une preuve périmée. Ce que le garde
   ne fait pas : rejouer l'exercice à ta place — il rougit, il ne restaure pas.
6. **Le propriétaire doit pouvoir restaurer seul** : la règle des deux personnes
   de `CONTINUITE.md` §1 (écart connu) s'applique aussi ici — une sauvegarde
   dont une seule personne détient les clés reste un point de défaillance.

Gardes : `backend/tests/test_atlas_backups_probe.py` (verdicts de la sonde et
câblage du workflow) ; `.github/scripts/check-exercice-restauration.py` juge la
FRAÎCHEUR de l'exercice daté du §3 (un titre « non exécuté » n'est pas une
preuve), preuve `backend/tests/test_exercice_restauration_fraicheur.py`.
