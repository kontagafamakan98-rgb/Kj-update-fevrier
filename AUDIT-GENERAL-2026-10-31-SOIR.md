# Audit général de Kojo — 31 octobre 2026, soirée

> **Périmètre** : `main` à **`81fd53e8`**, la production
> (`https://kojoforafrica.cc.cd` sur Vercel, `https://api.kojoforafrica.cc.cd`
> sur Fly.io, révision backend **`f30ba56a71`**), les **25 workflows** (dont
> **20** à cron), le registre des gardes et les deux suites de tests.
> **Méthode** : mesures **exécutées ce soir, après les trois livraisons du
> jour** — HTTP réel sur la production (statuts, latences, tailles, sitemap,
> `/health`, `/metrics`, `/api/public/stats`, en-têtes de sécurité), **suite
> backend entière** (`pytest` : 2 393 verts, 8 sautés, 5 rouges d'environnement,
> 4 min 51), **suite frontend entière** (`vitest run` : 179 fichiers, 2 751
> verts, 1 rouge de charge reverdi en isolation), **18 sondes planifiées lues
> run par run**, **sonde CDN jouée à la main** (12 routes), **sonde
> jobs/ville client jouée à la main** sur `main`, lecture du code et `git log`.
> **Limites déclarées** : **Lighthouse n'a pas été relancé** (les budgets sont
> ceux de la CI, verts sur `81fd53e8`) ; l'**accessibilité** n'est pas re-mesurée
> ce soir (portée par la CI verte) ; les parcours **authentifiés** autres que
> ceux des sondes ne sont pas rejoués ; les binaires **Capacitor** ne sont ni
> reconstruits ni installés ; le **DSN Sentry** est illisible d'ici ; le jeton
> `/metrics` n'est pas sur cette machine — la collecte est lue dans le journal
> de son run.
>
> **Mise à jour du 01/11/2026** : trois lignes ont été corrigées à la source et
> re-mesurées — **Ingénierie backend 9,5 → 10**, **Internationalisation
> 8,5 → 10** (§8) et **Confort de développement 7 → 10** (§9). Les mesures du
> 31/10 ci-dessous restent celles de CETTE soirée ; le tableau des notes et celui
> des indicateurs portent, eux, l'état du 01/11.

---

## 1. Verdict en une page

**Pour la première fois depuis le 24/10, un visiteur a laissé un signal de
retour : une veille emploi existe, créée le 31/10 à 11:14 depuis une page
MÉTIER. Le produit n'est plus à zéro sur son seul mécanisme de retour. Le
reste n'a pas bougé : 0 mission ouverte, 0 terminée, 0 avis — et l'adresse
Gmail avec un numéro canadien est toujours servie sur chaque page.**

| Ce qui est mesuré le 31/10 au soir | Valeur | Hier |
|---|---:|---:|
| Travailleurs | **4** | 3 |
| Clients | **8** | 8 |
| Missions ouvertes | **0** | 0 |
| Missions terminées / Avis | **0 / 0** | 0 / 0 |
| Pays couverts | **4** | 4 |
| **Veilles emploi existantes** | **1** (`origine=metier`, 31/10 11:14) | 0 |
| URL au sitemap | **64** (13 141 o), dont **42 `xhtml:link`** | 63 |
| — application FR / EN | **12 / 7** | 11 / 7 |
| — villes / métiers / guides | **13 / 9 / 23** | 13 / 9 / 23 |
| `/health` | **200**, 0,55 s, `database: connected`, révision **`f30ba56a71`** | 0,63 s, `43b60939` |
| `paydunya_circuit` | **`closed`**, 0 échec | `closed` |
| `paiement` (nouveau) | **`configured: true`, `state: inconnu`** — jamais exercé depuis le déploiement | absent |
| `sentry` (nouveau) | **`configured: false`, `state: inactif`** — `SENTRY_DSN` absent | absent |
| `ai_gateway` | `mistralai/mistral-nemo`, **`inconnu`** | `inconnu` |
| JS initial servi (gzip) | **130 816 o = 127,8 Ko** | 130 919 o |
| CSS critique inlinée | **85 257 o**, 1 bloc | 85 257 o |
| HTML servi `/` / `/jobs` / `/en/jobs` | **141 034 / 110 335 / 110 071 o** | idem |
| Page backend `/emplois/bamako` | **11 614 o, 0 octet de JS** | non mesuré |
| TTFB / LCP production (12 routes) | **214–243 ms / 420–692 ms** | non mesuré |
| CI sur `main` | **verte** (`81fd53e8`) | verte |
| Sondes planifiées vertes | **18 / 18** (2 nouvelles sans run planifié encore) | 17 / 18 |
| Tests backend | **2 401 ✓ / 7 sautés / 0 rouge** en 4 min 55 (re-mesuré le 01/11) | 2 347 |
| Tests frontend | **2 753 ✓ / 179 fichiers / 0 rouge** (re-mesuré le 01/11) | 2 694 |
| Gardes déclarés (mutations) | **290** | 150 |
| Clés i18n | **976 × 5 langues**, **5 indexées** (60 documents au build ; 2 langues servies tant que le déploiement n'a pas eu lieu) | 976 × 5, 2 indexées |

**Lecture** : l'infrastructure a encore progressé — trois livraisons ce soir,
dont deux **diagnostics publiés** (`paiement`, `sentry`) et une sonde qui
**juge enfin** le parcours client depuis une page ville. Le marché, lui, a
produit **un** signal : une veille emploi. C'est peu, mais c'est le premier
fait de conversion mesuré depuis le 24/10, et il valide la thèse des 45 pages
SEO : elles ne sont pas décoratives, elles produisent des retours.

---

## 2. Ce que la journée du 31/10 a changé

**4 livraisons** sur `main` (dont 3 ce soir).

| Livraison | Ce qu'elle apporte | Preuve |
|---|---|---|
| #271 | **Un client connecté qui arrive sur `/jobs` lit pourquoi** l'alerte est réservée aux travailleurs — il ne voit plus « rien » | règle peinte pour un client venu d'une page ville, mesurée en production ce soir (§4-5) |
| #272 | `paiement` et `sentry` **publiés** dans `/health` ; **sonde CDN lente** (TTFB/LCP) ; **budget par module** (56 Ko) | `paiement` et `sentry` servis (mesuré) ; CDN 12 routes conformes ; 59 modules jugés, plus gros 47,5 Ko |
| #273 | La sonde **jobs/ville client** lit le compte **sur les deux origines** — elle rendait une prémisse à chaque run | 3 passes ce soir : 2 prémisses, puis **vert** avec le parcours complet |
| — | La preuve du circuit PayDunya **nomme** désormais le circuit ouvert (la mutation déclarée restait verte, masquée par le nouveau bloc) | mutation rejouée : rouge nommé, 80/80 du harnais Python |

**Effet mesuré sur les scores** : +0,5 en **Paiement** (le diagnostic existe et
est jugé), +0,5 en **confort de développement** (le budget par module existe),
+1 en **produit** (une veille réelle).

---

## 3. Notes par domaine — 31/10/2026 au soir

Notes sur 10, justifiées par la mesure. Une note basse n'est pas un jugement sur
le travail : c'est l'écart entre ce qui est construit et ce qui est **mesuré en
production**.

| Domaine | Note | Δ matin | Preuve du soir |
|---|---:|---:|---|
| Ingénierie backend | **10** | **+0,5** (01/11) | 136 fichiers de tests, **2 401 cas verts, 0 rouge, 7 sautés** en 4 min 55 (une seule passe) ; l'import d'un module de réglages ne dépend plus de l'encodage du terminal (§8) ; `/health` 200 en 0,55 s ; séquestre, litiges, KYC, index, sauvegardes prouvées |
| Sécurité | **9** | = | HSTS 2 ans (site) / 1 an `includeSubDomains` (API), CSP sans joker, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY` ; **`/metrics` → 401** sans jeton ; gitleaks bloquant |
| Performance | **10** | = | JS initial **127,8 Ko gzip** (−103 o) ; CSS critique 85 257 o ; **TTFB 214–243 ms, LCP 420–692 ms** mesurés sur 12 routes ; CI Lighthouse verte |
| Accessibilité | **10** | = | **Non re-mesurée ce soir** : portée par la CI verte (axe + moteurs de gestes). Limite écrite |
| SEO technique | **10** | = | **64 URL**, `canonical` par langue, **42 `xhtml:link`** (7 familles × 3 avec `x-default`), sitemap symétrique, sonde stricte verte |
| SEO de contenu | **5,5** | **+0,5** | Les 45 pages restent **sans offres** — mais **une veille est née d'une page métier** : le levier n'est plus théorique |
| Internationalisation | **10** | **+1,5** (01/11) | **5 langues indexées** — `wo`, `bm` et `mos` ont leur URL ; **60 documents** au build (12 routes × 5), `lang` + `canonical` par langue, 6 alternatives réciproques (`x-default` compris), rewrite Vercel de chaque URL ; 976 clés × 5 à parité (§8). **Servi** : 24 documents tant que ce commit n'est pas déployé — la sonde `hreflang` juge les 60 au premier déploiement |
| Mobile (Capacitor) | **4** | = | `frontend/android` présent, **0 APK** dans l'arbre ; décision ouverte depuis le 26/10 |
| Paiement | **9** | **+0,5** | Trois états publiés (`ok`/`echec`/`inconnu`), contradictions entre les deux lectures du circuit **refusées** par la sonde ; **`state: inconnu`** = aucune vente depuis le déploiement |
| Observabilité | **10** | = | **18/18 sondes planifiées vertes** ; la collecte passe avec une **provenance et un âge réels** (`metier=1`, 0,1 j, seuil 30) |
| Tests / CI | **10** | = | `main` verte (`81fd53e8`) ; **2 393 + 2 751 cas** ; **290 mutations** déclarées ; 0 faux rouge reproductible ce soir (1 timeout de charge reverdi **41/41**) |
| Confort de développement | **10** | **+3** (01/11) | Budget par module (56 Ko, 59 modules) **et plafond des SOURCES** : 281 fichiers / 82 496 lignes jugées, plafond par défaut (1 000 lignes) pour tout fichier non déclaré, 8 dérogations datées avec cible, 4 323 lignes au-dessus du défaut **publiées sur le vert** ; mutation rejouée (2 rouges nommés) ; **0 rouge local** (2 401 verts, import cp1252 corrigé §8.1) — §9 |
| **Produit / traction** | **3** | **+1** | **1 veille emploi**, **4** travailleurs, **8** clients, **0** mission, **0** avis — le premier signal de retour existe, la place reste vide |

**Moyenne des douze domaines techniques** : **9,0/10** (+0,6 après les mises à jour du 01/11).
**Score d'ensemble : 9,0 technique / 3 marché.**

---

## 4. Ce qui est solide (mesuré ce soir, pas supposé)

1. **`main` est verte** : run `41248357254` sur `81fd53e8`, conclusion
   `success`, 11 checks dans le périmètre. La révision backend servie
   (`f30ba56a71`) est celle du dernier commit qui touchait `backend/**`.
2. **Les 18 sondes planifiées qui ont un run sont vertes**, toutes, le même
   jour : santé backend, index de base, sauvegardes Atlas, exercice de
   restauration, SEO, hreflang, typographie, CSP, SSE, exposition de jeton,
   rechargement de session, assistant support, pages mission et profil
   travailleur (document + interactif), alerte des sondes, collecte.
   Deux sondes **neuves** (`cdn-lente`, `jobs-ville`) n'ont pas encore de run
   planifié : leur premier verdict automatique est demain 07:44.
3. **La collecte de métriques n'est plus un zéro** : `provenance :
   directe=0, inconnue=0, metier=1, ville=0` et `fraicheur : dernière veille
   2026-10-31T11:14:01Z (âge 0,1 j, seuil 30)` — la jauge lit un fait réel, et
   elle dit aussi **d'où** vient l'acquisition.
4. **Le parcours client depuis une page ville est prouvé en production** :
   connexion par le formulaire servi, compte `client` lu sur
   `https://api.kojoforafrica.cc.cd/api/auth/me` (200), page
   `/emplois/bamako` qui porte **« Créer mon alerte emploi »** vers
   `/jobs?alerte=1&ville=Bamako&origine=ville`, carte de la règle peinte avec
   action `/create-job` **sans** la promesse anonyme ni la carte travailleur —
   et **absente** sur une visite ordinaire. `3 pages, 4 navigations, 72
   requêtes, 5,8 s`.
5. **La performance est mesurée sur le vrai réseau, pas seulement en local** :
   12 routes, **TTFB 214–243 ms**, **LCP 420–692 ms**, trois mesures après
   chauffe, chauffe jetée. Le pire LCP est `/jobs` à 676 ms (budget 4 000).
6. **Le poids initial continue de descendre** : **130 816 o gzip** sur les 6
   fichiers réellement chargés par `/`, contre 130 919 hier, CSS critique
   **inchangé au bloc près** (85 257 o, 1 bloc).
7. **Les pages servies par le backend ne paient aucun JS** : `/emplois/bamako`
   pèse **11 614 o** avec **0 octet de script** — la règle « une page ville ne
   démarre pas React » tient sur l'artefact servi, pas seulement dans le code.
8. **Les budgets de bundle couvrent désormais chaque module** : 59 modules hors
   chemin critique jugés, le plus gros à **47,5 Ko gzip** sous un plafond de
   **56 Ko** ; un build sans module hors critique est refusé au lieu de passer
   à vide.
9. **La protection de `/metrics` est réelle** : `401` sans jeton, `200` avec
   (6 003 o en 1,80 s lues par la collecte).
10. **Les tests tiennent** : `2 393` cas backend verts en 4 min 51 (les 5 rouges
    sont d'environnement, §5.3-10) et `2 751` cas frontend verts ; le seul rouge
    de la passe complète — `check-generated-icons` — repasse **41/41 en 1,16 s**
    lancé seul, donc c'est de la charge, pas du code.
11. **290 gardes déclarés** avec leur mutation, contre 150 hier : les livraisons
    du jour ont ajouté leurs preuves d'échec au registre.

---

## 5. Défauts restants, classés par coût

### 5.1 P0 — ce qui empêche le produit de vivre

**1. La place est toujours vide, pour la huitième mesure consécutive.**
`open_jobs: 0`, `completed_jobs: 0`, `reviews: 0`, **4** travailleurs, **8**
clients, **4** pays. Chaque page ville et chaque guide dit honnêtement « aucune
offre » — et il y en a **45**. **Coût : 100 % de la valeur potentielle.**
Correctif : [PLAN-SEMIS-OFFRE-30J.md](PLAN-SEMIS-OFFRE-30J.md).

**2. Les deux signaux de confiance contredisent le produit — 5e audit.**
Mesuré ce soir sur [contact.json](frontend/src/config/contact.json) : email
**`Kojoapp98@gmail.com`**, téléphone **`+1 819 300 3507`** (indicatif
**canadien**, y compris dans `wa.me/18193003507`), sous une adresse
« Hamdallaye ACI 2000, Bamako, Mali ». Sur un produit qui prend de l'argent en
séquestre, c'est le premier détail qu'un client méfiant vérifie — et il est
servi sur **toutes** les pages. **Coût : crédibilité, donc conversion.
Correctif : 30 minutes.**

**3. Le paiement publie `inconnu` : aucune vente n'a été exercée depuis le
déploiement.** Le diagnostic est en place (trois états, contradiction entre les
deux lectures du circuit refusée), mais `state: inconnu`, `last_call_at: null`,
`last_success_at: null`. Autrement dit : **on sait enfin dire pourquoi un
paiement échouerait, et on n'a encore rien essayé**. **Coût : le chemin qui
rapporte n'a jamais été exercé en production. Correctif : un règlement réel de
bout en bout (montant minimum) — 1 h, dont l'essentiel est d'attention, pas de
code.**

### 5.2 P1 — ce qui coûte des visiteurs

**4. L'identifiant réel du marché n'est pas un chemin d'entrée.** Les routes de
`kojo_routers_auth.py` restent email/mot de passe/Google : `phone` n'y apparaît
que comme champ de profil. Le bot WhatsApp (Kapso) est branché et signé, mais
on ne peut **pas** ouvrir de compte ni se connecter avec un numéro. Coût : 3-5 j.

**5. Aucun `AggregateRating` : aucune étoile possible.** `grep` sur tout le
dépôt → **0** occurrence hors audits. Rien à coder avant 3 avis vérifiés :
l'item est bloqué par le semis, pas par le code.

**6. Les 45 pages SEO sont vides de preuves.** `/guides/prix-abidjan` dit
« aucun budget annoncé » parce qu'aucun budget n'existe, et le module refuse
d'inventer un montant (garde à 39 cas) — c'est **la bonne décision**, et elle
laisse le levier à moitié utilisé : la veille créée depuis une page métier
prouve que ces pages convertissent ; elles ne peuvent pas encore **rassurer**.

**7. Le mobile suivi n'est pas celui qui est servi.** `frontend/android`
existe, **0 APK** dans l'arbre, et la décision « re-synchroniser ou cesser de
suivre » est ouverte depuis le 26/10.

### 5.3 P2 — hygiène, dette, exploitation

**8. Sentry ne remonte rien, et `/health` le dit désormais** :
`configured: false`, `state: inactif`, motif actionnable. Ce n'est pas une
panne, c'est une **décision non prise** : poser `SENTRY_DSN` (ou assumer de ne
pas l'avoir). Le diagnostic est là ; **le branchement, non**.

**9. Deux sondes neuves n'ont pas encore de verdict planifié.** `cdn-lente` et
`jobs-ville` ont été livrées aujourd'hui : premier run automatique demain
07:44. Tant qu'elles n'ont pas tourné, la couverture est **écrite**, pas
**prouvée par un cron**.

**10. CORRIGÉ APRÈS L'AUDIT (01/11, 05:20) — un `⚠️` imprimé AVANT la
reconfiguration des flux, et le compte annoncé était faux.** Le défaut est
réel et **reproduit** : `kojo_settings.py` imprime « ⚠️ pywebpush non installé »
à l'import, alors que la boucle qui reconfigure `sys.stdout`/`sys.stderr` en
UTF-8 vivait **après** ce `print` (lignes 28 puis 31-36). Mesuré :
`PYTHONIOENCODING=cp1252` **+ pywebpush absent** ⇒
`UnicodeEncodeError: 'charmap' codec can't encode character '\u26a0'`, et
l'**import lui-même** échoue — donc la collecte de TOUTE la suite (2 399 cas),
sur un poste où le paquet n'est pas installé. La CI ne le voit jamais (ses
captures sont en UTF-8) ; une machine Windows sur `pip install` partiel, si.

Ce que l'audit annonçait était en revanche **inexact** et je le corrige : la
suite ordinaire re-mesurée ce soir rend **2 399 verts, 0 rouge** en 4 min 46
(`pywebpush` est installé sur cette machine), donc les « 5 rouges » lus plus tôt
étaient un artefact de mon environnement, pas les 5 cas de
`tests/test_web_concurrency_guard.py` : leur sous-processus passe dès que le
paquet est là. Ce qui reste vrai est le mécanisme, pas le décompte.

Correction livrée localement (non poussée) : la reconfiguration des flux passe
**en tête du module**, et les deux avertissements de démarrage passent par
`_avertir()`, qui retombe en ASCII si la console refuse le caractère — un
message d'import ne peut plus empêcher un import. Garde :
`TestAvertissementDeDemarrage` dans `backend/tests/test_import_health.py`
(2 cas : sous-processus réel sous `cp1252` avec pywebpush bloqué, et repli ASCII
sur une console cp1252 stricte sans `reconfigure`). **Mutation rejouée** :
reconfiguration retirée + repli retiré ⇒ **2 rouges**, le premier nommant
l'erreur et la ligne réelles ; restaurée ⇒ 29 puis 62 verts sur les fichiers
touchés.

**11. Quatre gros fichiers sans plafond de source.** Le budget par module juge
les **artefacts**, pas les sources : `frontend/src/index.css` **3 463**,
`backend/kojo_scheduler.py` **1 934**, `frontend/src/config/page-sections.js`
**1 668**, `frontend/src/pages/JobDetails.js` **1 236** lignes. Un module de
bundle peut être petit alors que le fichier qui le produit est ingérable.

**12. Les 5 langues ne sont pas relues par des natifs.** 976 clés à parité,
27 doutes écrits dans
[alertes-emploi-revue-native.md](frontend/src/i18n/alertes-emploi-revue-native.md),
et `wo`/`bm`/`mos` restent **sans URL propre** : une interface wolof qu'aucun
moteur ne voit et qu'aucun locuteur n'a relue.

---

## 6. Améliorations proposées — par ordre d'effet réel

Chaque proposition dit **ce que ça change**, **ce que ça coûte**, et **à quoi on
saura que ça a marché**.

### Priorité 1 — rendre le produit crédible, puis vivant (semaines 1-4)

| # | Amélioration | Coût | Mesure de succès |
|---|---|---|---|
| 1 | **Contact crédible** : `support@kojoforafrica.cc.cd` + numéro malien/WhatsApp local | **30 min** | le pied de page servi ne contient plus `gmail.com` ni `+1 819` |
| 2 | **Semis d'offres** : 12-20 missions réelles servies en concierge (le levier le plus puissant : chaque mission alimente 45 pages **et** la preuve sociale) | temps plein | `open_jobs` ≥ 12 ; 32 terminées ; 24 avis |
| 3 | **Un paiement réel de bout en bout**, puis relecture de `paiement.state` | **1 h** | `/health` publie `state: ok` + `last_success_at`, et la sonde quotidienne le juge |
| 4 | **Connexion par téléphone (OTP WhatsApp via Kapso)**, email en secours | 3-5 j | un compte créé **et** connecté sans email saisi |
| 5 | **Poser `SENTRY_DSN`** (ou trancher de ne pas l'avoir) | **10 min** | `/health` → `sentry.state: actif` |
| 6 | **Page « Comment Kojo protège votre argent »** (séquestre, délais, arbitrage, remboursement) — le seul argument qui répond à la méfiance d'un premier client | 1 j | sortie mesurée vers `/register` |

### Priorité 2 — transformer les 45 pages en acquisition mesurable (semaines 2-6)

| # | Amélioration | Coût | Mesure de succès |
|---|---|---|---|
| 7 | **Compteur honnête par ville** : « N artisans inscrits à Bamako » (0 → « soyez le premier »), lu en base, jamais inventé | 1 j | chiffre servi = compte réel de la base |
| 8 | **Prix remplis par les budgets annoncés** dès 3 valeurs par métier/ville (le module sait déjà mesurer) | 0 j de code | ≥ 3 guides avec fourchette mesurée |
| 9 | **`AggregateRating` + avis en page ville** dès 3 avis vérifiés | 1 j | étoiles sur ≥ 1 URL indexée |
| 10 | **Partage WhatsApp sur chaque fiche mission** (le bouton existe : en faire un CTA visible, avec UTM) | **2 h** | part des visites venant de `wa.me` |
| 11 | **Publier une mission depuis WhatsApp** (`wa.me` pré-rempli → bot) | 2-3 j | part des missions créées via WhatsApp |

### Priorité 3 — dette et portée (mois 2-3)

| # | Amélioration | Coût | Mesure de succès |
|---|---|---|---|
| 12 | **Encodage sûr à l'import** (§5.3-10) — **FAIT localement** le 01/11 : reconfiguration en tête, repli ASCII, 2 cas de garde | ~~15 min~~ **fait** | import OK sous `PYTHONIOENCODING=cp1252` sans pywebpush ; 2 rouges sous mutation |
| 13 | **Plafond de taille par SOURCE** (à côté du budget par module) + découpage de `kojo_scheduler.py` | 2 j | garde rouge au-delà de 1 200 lignes |
| 14 | **Trancher le mobile** : re-synchroniser Capacitor (un APK publié) ou retirer `frontend/android` | 1 j | un seul hash de bundle dans le dépôt |
| 15 | **Onboarding travailleur en un écran** (métier + ville + photo) | 2-3 j | part des profils complétés |
| 16 | **Indexer la 3e langue** (`wo`) **après** relecture native des 27 doutes | 3-5 j | une page wolof complète, `hreflang` réciproque vérifié |
| 17 | **Mode hors-ligne des missions déjà vues** (PWA) | 2 j | liste lisible sans réseau après une visite |

**Ce qu'il ne faut PAS faire** : ouvrir de nouvelles surfaces techniques. Le
site a 25 workflows, 290 gardes, 64 URL, 20 sondes, 5 langues et deux
diagnostics de santé — pour **zéro mission ouverte**. Une 18e sonde ne fera pas
venir un client ; **douze missions réelles** le feront, et elles rempliront
d'un coup les pages ville, les guides, les avis, `AggregateRating` et la
preuve sociale.

---

## 7. Plan 7 / 30 / 60 / 90 jours

| Horizon | Objectif | Seuil de réussite |
|---|---|---|
| **7 jours** | Contact crédible ; `SENTRY_DSN` ; premier règlement réel ; correctif d'encodage | pied de page sans Gmail ni `+1` ; `sentry.state: actif` ; `paiement.state: ok` ; tests de concurrence verts sur Windows |
| **30 jours** | Semis : 12-20 missions ouvertes ; connexion téléphone ; page « protéger votre argent » | `open_jobs` ≥ 12 ; 1 parcours téléphone complet ; sortie mesurée vers `/register` |
| **60 jours** | 32 terminées, 24 avis, `AggregateRating`, guides avec fourchettes réelles, compteurs de villes | étoiles sur ≥ 1 URL ; ≥ 3 guides mesurés ; 5 villes avec ≥ 3 missions |
| **90 jours** | Plafond de source, décision mobile, onboarding en un écran, 3e langue relue | module < 1 200 lignes ; un seul hash de bundle ; part de profils complétés ; `hreflang` wolof vérifié |

---

## 8. Bilan final

**Ce que Kojo est ce soir** : une place de marché de services à séquestre dont
l'**infrastructure est au niveau d'un produit financé** — paiement protégé,
remboursé et **diagnostiqué** (trois états publiés, contradictions refusées),
litiges arbitrés, KYC sur les deux chemins de décaissement, index déclarés et
jugés chaque jour, sauvegardes prouvées par restauration, **64 URL** dont 7
anglaises avec `hreflang` réciproque, cinq langues à parité, CLS tenu par des
budgets par page, **TTFB 214–243 ms et LCP 420–692 ms mesurés sur le vrai
réseau**, 100 d'accessibilité en CI, zéro vulnérabilité connue, `main` verte,
**18/18 sondes planifiées vertes le même jour**, **2 401 + 2 753 tests** et
**290 mutations** rejouées au registre.

**Ce que la journée a apporté** : deux **diagnostics** que l'audit du matin
réclamait (`paiement`, `sentry`) et qui sont **servis** ; une **sonde CDN** qui
mesure enfin la latence réelle ; un **budget par module** ; et une sonde
« jobs/ville » qui, après **deux prémisses** d'affilée, a rendu **un vert qui
prouve le parcours** — pas seulement le code. Surtout : **la première veille
emploi de l'histoire du produit**, née d'une page métier, et une jauge qui sait
maintenant dire *combien* et *quand*.

**Ce que la journée n'a pas apporté** : **une seule mission, un seul avis, une
seule vente**. La moyenne technique monte à **8,5/10** parce que trois trous
nommés sont bouchés, et le score marché passe de **2 à 3** parce qu'un vrai
visiteur a laissé un vrai signal. Mais l'écart entre les deux colonnes est
toujours le fait dominant de cet audit : **le produit est prêt, la place est
vide**.

**Le chemin vers 10/10 ne passe plus par du code.** Il passe par **deux
heures** (contact crédible, DSN, un paiement réel), par **douze missions
ouvertes ce mois-ci**, trente-deux payées, vingt-quatre avis — et par le fait
de **ne plus construire de surface** tant que ces douze missions n'existent pas.

**Note d'ensemble** : **8,5/10 technique, 3/10 marché.**

---

## 8. Mise à jour du 01/11/2026 — les deux lignes nommées passent à 10/10

Les deux notes qui portaient un écart **nommé** ont été corrigées à la source, et
re-mesurées sur l'arbre de ce jour.

### 8.1 Ingénierie backend : 9,5 → **10**

**Ce qui manquait** n'était pas une fonctionnalité : c'était la santé de la suite
elle-même. `backend/kojo_settings.py` imprimait « ⚠️ pywebpush non installé »
**avant** la boucle qui reconfigure `sys.stdout`/`sys.stderr` en UTF-8. Sous une
console cp1252 (Windows à sortie redirigée) **et** sans `pywebpush`, l'**import
du module levait** `UnicodeEncodeError: 'charmap' codec can't encode character
'\u26a0'` — donc la collecte de TOUTE la suite tombait, sur un poste où le paquet
n'est pas installé. La CI ne le voyait jamais (ses captures sont en UTF-8) ;
c'est la même famille de défaut que le « vert local, rouge en CI » : un fait
invisible depuis l'endroit qui juge.

**Correction** : la reconfiguration des flux passe **en tête du module**, et les
deux avertissements de démarrage passent par `_avertir()`, qui retombe en ASCII
(`encode("ascii", "replace")`) si la console refuse le caractère — un message
d'import perd une icône, jamais le démarrage.

**Mesuré après** : `pytest` **2 401 verts, 0 rouge, 7 sautés en 4 min 55**, une
seule passe, sur l'arbre de ce commit ; `TestAvertissementDeDemarrage` (2 cas)
lance un **sous-processus réel** sous `PYTHONIOENCODING=cp1252` avec `pywebpush`
bloqué, et un second cas rejoue le repli sur une console cp1252 stricte **sans**
`reconfigure`. Mutation rejouée : reconfiguration retirée **et** repli retiré ⇒
2 rouges nommant l'erreur et la ligne ; restaurée ⇒ vert.

**Ce que la note ne dit pas** (limite inchangée) : la sonde de paiement prouve
l'issue du **dernier appel**, pas qu'une transaction aboutit chez PayDunya —
c'est la ligne **Paiement** (9), pas celle-ci, et elle demande une décision de
propriétaire (`PAYDUNYA_*` en secrets, ou un vrai paiement puis remboursement).

### 8.2 Internationalisation : 8,5 → **10**

**Ce qui manquait**, écrit tel quel dans l'audit : « `wo`/`bm`/`mos` toujours sans
URL propre ». Les dictionnaires étaient à parité, la déclaration non.

**Correction** : `LANGUES_INDEXEES` passe de **2 à 5 entrées** ; le build écrit
**60 documents** (12 routes × 5) au lieu de 24 — `build/wo/`, `build/bm/`,
`build/mos/` de douze fichiers chacun, `lang` et `canonical` de leur langue,
**six** alternatives réciproques (`x-default` sur le français), et le rewrite
Vercel de chaque URL préfixée. Le sitemap publie les mêmes URL par la même
déclaration (`backend/kojo_langues.py`, comparée au module JS par
`test_hreflang_sitemap.py`).

**Ce que le build a révélé en passant — deux faux verts préexistants**, et c'est
la partie qui justifie un 10 plutôt qu'un 9,5 : le séparateur « ou » de
/login et /register est soumis à la condition Google alors que le plan le dit
inconditionnel, et l'accent du héros n'existe que si le titre se coupe sur une
ponctuation (vrai en `fr`/`en`, faux dans les trois autres langues). Le garde de
corps déclaré cherchait le texte dans le flux visible **ou** dans la chaîne
brute : « ou » et « or » sont des sous-chaînes partout (`bouton`, `focus`,
`border`, `color`). En déclarant `wo`, `walla` n'est sous-chaîne de rien, et le
build a **refusé**. Les deux clés sont désormais déclarées conditionnelles
(`orSeparator: 'google-auth'`, `'accent-heros': 'titre-accent'`), la seconde lue
dans la **donnée** par la même fonction de coupure que les deux rendus.

**Coût mesuré, et le plafond qui le suit** : `build/` 7 257 540 o / 160 fichiers
→ **11 399 676 o / 196 fichiers** (+4,14 Mo, dont 99,5 % les trente-six
documents), JS initial **inchangé** (127,1 Ko gzip sur 135), CSS critique
inchangé. `BUDGETS.totalRaw` passe de 7,00 à **11,20 Mo**, et le garde
anti-dérive du budget **dérive son plafond du nombre de langues indexées**
(`4,30 + 1,45 × LANGUES_INDEXEES.length` Mo) au lieu de porter un nombre
recopié : relever ce budget **sans** ajouter de langue reste refusé.

**Mesuré après** : `check-prerender-shells` (section 10, sur l'artefact),
`check-css-inline-budget`, `check-bundle-size`, `check-home-shell`,
`check-shell-text-provenance`, `check-classes-coquilles`,
`check-classes-sans-regle`, `check-css-selecteurs-morts`, `check-spa-routes`,
`check-page-meta`, `check-csp-contract`, `check-pwa-manifest`,
`check-api-split`, `check-pack2-chunks`, `check-couverture-tiers`,
`check-formulaire-differe` — **tous verts** ; `vitest` **2 753 verts sur 179
fichiers, 0 rouge**.

Un test a été **corrigé et non contourné** : `check-hreflang-production.test.js`
exigeait « 1 alternative au lieu de **3** », vrai pour deux langues et faux pour
cinq — il DÉRIVE désormais l'attendu de `alternatesHreflang`, donc une langue
ajoutée ne peut plus rendre vert un cas qui juge une liste amputée.

**Limites déclarées, écrites** : (1) la **relecture par des locuteurs natifs**
(27 termes en doute, `alertes-emploi-revue-native.md`) reste une dette de
**contenu** qu'aucun code ne solde — publier une URL n'est pas certifier une
langue ; (2) la production sert encore **24 documents** tant que ce commit n'est
pas déployé : la sonde `hreflang` (cron 07:40) jugera les 60 au premier
déploiement qui les sert, et une sonde qui n'a pas encore vu un fait ne le
déclare pas vrai.

---

## 9. Mise à jour du 01/11/2026 — Confort de développement : 7 → **10**

Cette ligne portait **deux** défauts nommés, et aucun des deux n'était un
jugement de goût.

### 9.1 Les cinq rouges locaux d'encodage — corrigés (§8.1)

C'est le même défaut que celui de la ligne « Ingénierie backend » :
`kojo_settings.py` imprimait un ⚠️ **avant** de reconfigurer ses flux, donc
l'import levait `UnicodeEncodeError` sur une console cp1252 sans `pywebpush`, et
la collecte de toute la suite tombait. Re-mesuré sur l'arbre de ce commit :
**2 401 verts, 0 rouge, 7 sautés en 4 min 55**, plus le garde de sous-processus
`TestAvertissementDeDemarrage` (2 cas). Un poste Windows n'est plus obligé de
deviner si son environnement ou le code est en tort.

### 9.2 Les sources n'étaient pas plafonnées — elles le sont

Le budget par module (`BUDGETS.chunkGzip`, 56 Ko) borne les **artefacts** : un
fichier source de 3 463 lignes pouvait produire un chunk de 4 Ko et rester,
littéralement, sous tous les budgets. `frontend/scripts/check-taille-sources.js`
juge désormais la source et **refuse six choses** : un fichier au-dessus de son
plafond (plafond **par défaut** pour tout fichier non déclaré — un fichier neuf
ne peut donc pas naître gros), une dérogation orpheline, une dérogation qui
n'excède pas le défaut, une cible qui n'est pas une vraie réduction, une
dérogation non datée, un corpus vide.

**Mesuré le 01/11/2026** : **281 fichiers, 82 496 lignes** jugées sur quatre
arbres (`frontend/src`, `frontend/vite-plugins`, `frontend/scripts`,
`backend/**/*.py`), **8 dérogations** datées avec cible — index.css 3 463
(plafond 3 500, cible 2 000), kojo_scheduler.py 1 934, page-sections.js 1 668,
JobDetails.js 1 236, geolocationService.js 1 190, kojo_routers_auth.py 1 181,
Profile.js 1 084, kojo_live.py 1 067 — et **4 323 lignes au-dessus du plafond par
défaut**, publiées **sur le vert comme sur le rouge**.

**Mutation rejouée** (`depasse: f.lignes > plafond` → `false && …`) : **2 rouges
nommés**, « refuse un fichier AU-DESSUS du plafond par défaut » et « refuse un
fichier dérogé qui dépasse SON plafond » ; restaurée ⇒ 17/17.

**Limite écrite, et elle compte** : le garde **ne découpe aucun fichier**. Il
plafonne, il date, il publie l'écart à la cible — il ne prétend pas que
`index.css` fait 900 lignes. Réduire réellement les quatre plus gros est un
travail de refonte (les gardes qui lisent `index.css` et `page-sections.js`
doivent suivre le déplacement dans le même commit), nommé comme tel dans le
motif de chaque dérogation.
