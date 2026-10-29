# Audit général de Kojo — 27 octobre 2026, soir

> **Périmètre** : production (`https://kojoforafrica.cc.cd` sur Vercel,
> `https://api.kojoforafrica.cc.cd` sur Fly.io), `main` à `59b3316e` (la purge
> de rétention extraite), et le dépôt entier.
> **Méthode** : mesures exécutées le 27/10/2026 entre **18:20 et 18:45 UTC** —
> HTTP réel (statuts, en-têtes, latences, HTML servi, poids transféré), API
> publique, appels réels à l'assistant support, sitemap, GitHub Actions et
> journaux du job CI (mongod compris), lecture du code.
> **Chaque constat porte sa mesure. Ce qui n'a pas été vérifié aujourd'hui est
> dit comme non vérifié.**
> **Non couvert** : les parcours authentifiés (OTP réels, paiement PayDunya de
> bout en bout, arbitrage, administration, messagerie), la liste RÉELLE des
> index de la base de production (pas de jeton Atlas sur ce poste), la mesure
> Lighthouse (non rejouée), les binaires mobiles installés.

---

## 1. Verdict en une page

L'ingénierie reste très au-dessus du marché qu'elle sert, et **le défaut le plus
coûteux trouvé ce soir n'est ni un test ni un garde : c'est l'indexation de la
base, qui s'arrête à la sixième ligne d'une fonction et personne ne le sait.**

| Mesuré le 27/10/2026 (18:20–18:45 UTC) | Valeur | Source |
|---|---:|---|
| Travailleurs / clients | **3 / 8** | `GET /api/public/stats` |
| Missions ouvertes / terminées / avis | **0 / 0 / 0** | idem |
| Mission **en cours** (la seule jamais créée) | **1** — Dakar, 20–25 000 FCFA, publiée le **23/10 19:00** | `GET /api/jobs?status=in_progress` |
| URL au sitemap | **43** (13 villes, 9 métiers, 10 guides, 3 profils, 1 fiche, 7 statiques) | `/sitemap.xml` |
| Assistant support | **200** aux 5 appels, en **4,4 s → 24,4 s** | appels directs |
| `/health` → `ai_gateway` | `state: ok`, `mistralai/mistral-nemo`, `last_success 18:28` | `/health` |
| Révision servie | `59b3316e…` = tête de `main` | `/health` |
| CI sur `main` (dernier run) | **12 jobs verts** | Actions |
| Issues ouvertes | **0** (l'alerte des sondes ne parle que sur un rouge) | GitHub |
| Commits sur `main`, 7 derniers jours | **58** | `git log` |
| Pages servies : TTFB / HTML compressé | 0,32–0,97 s / 29 Ko (`/`), 2,8 Ko (page ville) | curl |
| JS de l'accueil, transféré | **137 Ko** (7 fichiers, compressés) | curl |
| En-têtes de sécurité servis | **5** (CSP `frame-ancestors`, HSTS, nosniff, Referrer-Policy, Permissions-Policy) | `curl -I` |
| Surfaces fermées | `/docs` 404, `/openapi.json` 404, `/metrics` 401, CORS refuse une origine inconnue | curl |
| Tests | **125** fichiers backend + **72** frontend, 54 gardes, 18 workflows (14 planifiés) | dépôt |
| Code backend | 79 modules, **31 210 lignes**, 27 routeurs ; i18n **973 clés × 5 langues** ; **0** TODO/FIXME | dépôt |

**La phrase qui résume ce soir** : le site sait séquestrer l'argent, tracer un
litige, publier 32 pages indexables, répondre en trois langues de données — et
la **base de données sur laquelle tout cela repose n'a probablement pas les
index qu'elle déclare**, sans qu'aucune mesure ne le dise. À côté de ça, une
seule mission a jamais été créée, et elle est en cours depuis quatre jours.

---

## 2. Le fait du soir : l'indexation s'arrête à `google_sub`

### 2.1 La mesure

Dans le journal du job `Backend tests (Python + MongoDB)` du dernier run de
`main`, **mongod dit lui-même** :

```
"c":"INDEX", "msg":"Index build: failed",
"error": { "code": 11000,
  "errmsg": "E11000 duplicate key error collection: kojo_test.users
             index: google_sub_1 dup key: { google_sub: null }" }
```

Deux fois (deux connexions qui tentent la même construction). Ce n'est donc pas
le code qui se plaint : c'est **la base qui refuse l'index**.

### 2.2 Pourquoi elle refuse, et pourquoi c'est tous les index qui tombent

`backend/kojo_db.py` déclare l'index ainsi :

```python
await db.users.create_index("google_sub", unique=True, sparse=True)
```

`sparse` écarte les documents où le champ est **absent**, pas ceux où il vaut
`null` — et `unique` n'accepte alors **qu'un seul `null`**. Or
`register_user_verified` insère `user.model_dump()` (`kojo_routers_auth.py:677`),
et `User.google_sub` vaut `None` par défaut (`kojo_models.py:168`) : **chaque
compte créé sans Google porte `google_sub: null`**. Dès le deuxième compte,
l'index ne peut plus être construit.

Reproduit sur ce poste (mongomock 4.3.0) : deux documents à `google_sub: null`,
puis `create_index(unique=True, sparse=True)` → `DuplicateKeyError E11000`.

Et la conséquence est plus large que la ligne fautive, parce que **les ~71
déclarations d'index vivent dans UN SEUL `try`**, dont le `except` se contente
d'un `logger.warning` :

```python
except Exception as e:
    logger.warning(f"⚠️ Error creating indexes (may already exist): {e}")
```

Compté par AST sur le fichier : **5 déclarations avant** la ligne fautive,
**66 après** — dont `jobs` (13 : statut, catégorie, pays, tri budget, **index
texte**, **2dsphere**), `payments` (9), `reviews` (5), `messages` (5),
`job_proposals`, `job_alerts`, `business_events`, `whatsapp_messages`,
`push_tokens`, `revoked_tokens`, et **le bloc TTL de `RETENTION_RULES`**.
Une seule exception et **les 66 sont sautées, à chaque démarrage, en silence**.

### 2.3 Ce qui est certain, et ce qui reste à mesurer

**Certain** : le mécanisme (mesuré), l'entrée (11 comptes, dont au moins dix
créés sans Google, donc au moins deux `null`), et l'absence de toute mesure (`/health` ne publie
rien sur les index, aucune sonde ne les lit — vérifié par recherche sur
`backend/scripts` et `.github/workflows`).

**Non vérifié** : la liste réelle des index du cluster de production. Elle ne
se lit pas sans jeton Atlas. Deux cas, et les deux sont un défaut :
- les 66 index n'existent pas → les garanties de `SCALING.md` (recherche texte,
  tri par budget, alerte par compte, unicité des jalons) ne tiennent que sur de
  petites collections, et **rien ne les rétablira** ;
- ils existent depuis un déploiement antérieur → ils sont **figés à leur
  ancienne définition** (aucun ajout récent n'est passé), et la prochaine
  recréation (restauration d'archive, changement de cluster) les perdra.

**Ce que ça ne casse pas** : la rétention. La purge applicative
(`kojo_purge_retention.retention_purge_once`, extraite aujourd'hui) applique les
mêmes règles en code ; un index TTL manquant ne prolonge donc pas la
conservation — il retire le filet de sécurité et ajoute une charge de balayage.

**Effet secondaire mesuré, et c'est un piège** : la recherche `?q=` essaie
l'index texte puis **retombe sur un `$regex` en `except Exception`**
(`kojo_routers_jobs_listing.py:282-286`). Un index manquant ne rend donc pas une
erreur : il rend **une réponse plus lente, indiscernable** d'une réponse
indexée. `?q=fuite` répond 200 en 1,3 s sur une collection d'une mission — la
latence ne dit rien à cette taille.

### 2.4 Le remède, et sa preuve

1. **La bonne forme d'index** : `partialFilterExpression={"google_sub": {"$type": "string"}}`
   au lieu de `sparse` — un document sans `google_sub` (ou à `null`) n'entre
   pas dans l'index, et l'unicité ne porte que sur de vraies valeurs.
2. **Un `try` par index**, et un résumé au démarrage : « 71 déclarées,
   71 créées » ou la liste des échecs. Un échec ne doit plus emporter les
   suivants.
3. **Une sonde qui compare déclaré et réel** : `backend/scripts/check_index_db.py`
   + workflow quotidien, qui publie « 71/71 » ou « 66 manquants, dont *index
   texte* » ; la même ligne dans `/health` (`indexes: {declares: 71, presents: 71}`).
   *Preuve* : la sonde est verte sur un cluster neuf, et rouge quand on retire
   un index.

---

## 3. Notes par domaine — 27/10/2026, soir

| Domaine | Note | Preuve du soir |
|---|---:|---|
| Ingénierie backend | **9,5** | Séquestre, litiges, KYC, commission à paliers, purge extraite ; `/health` 200, base connectée, PayDunya `closed`, `ai_gateway` `ok` |
| **Base de données / indexation** | **4** | Échec de construction `google_sub` mesuré dans mongod (E11000), 66 déclarations sautées par un `try` unique, aucune sonde. **Nouveau domaine, et c'est la note la plus basse de l'audit** |
| Sécurité | **9** | 5 en-têtes servis, `/docs` et `/openapi.json` 404, `/metrics` 401, CORS strict, gitleaks bloquant |
| Performance servie | **9** | TTFB 0,32–0,97 s ; 24–29 Ko de HTML compressé ; 137 Ko de JS sur l'accueil — et pourtant les index qui porteraient cette performance en grand ne sont pas prouvés |
| Accessibilité | **9,5** | Lien d'évitement servi (« Aller au contenu principal »), 5 gardes de contraste calculés, parcours clavier + axe en CI |
| SEO technique | **9** | 43 URL au sitemap, pré-rendu, canonical, OG par fiche (carte 200, 4,3 Ko), `JobPosting` absent sur une mission non ouverte — règle tenue |
| SEO de contenu | **7** | 22 pages ville/métier + 10 guides écrits, honnêtes (« aucun budget annoncé ») — mais **aucun lien depuis l'accueil**, et un pré-rendu monolingue |
| Internationalisation | **8** | 973 clés × 5 langues à parité ; **aucune URL par langue** : la visibilité hors français est nulle |
| Assistant / support | **7** | Réparé (5 × 200, réponses justes et chiffrées) mais **4 à 24 s** ; une conversation réelle se joue au-delà de 10 s |
| Paiement | **7,5** | Orange Money ×4 pays + Wave ×2 seulement ; `bank_card` côté PayDunya ; paliers de commission **désactivés**, tarif par défaut **14 %** (`0.10` documenté dans `.env.example`) |
| Observabilité | **8** | `/health` publie désormais la cause du gateway, 14 sondes planifiées, **une alerte sur rouge** — mais aucune mesure sur les index ni sur la latence de l'assistant |
| Tests / CI | **9,5** | 12 jobs verts, 125 + 72 fichiers de tests, 54 gardes, run complet ≈ 27 min |
| Produit / traction | **2** | 3 travailleurs, 8 clients, 0 mission ouverte, 0 terminée, 0 avis, **1 mission en cours depuis 4 jours** |
| Confort de développement | **7** | Le découpage continue (purge sortie : 1 934 lignes restantes) ; restent `kojo_routers_auth.py` 1 181 et `JobDetails.js` 1 227 |

**Moyenne** : ≈ **8,6/10 technique**, **2/10 marché** (pondérée par ce qui fait
vivre une place de marché : ≈ 4,5).

---

## 4. Ce qui est solide (mesuré ce soir)

1. **Production alignée sur `main`** : `/health` rend `59b3316e…`, la tête de
   `main` ; base `connected` ; disjoncteur Paydunya `closed`.
2. **L'assistant est réparé et il est bon** : cinq appels, cinq 200, et la
   réponse à « comment suis-je payé » nomme le mécanisme (déclaration de fin,
   note de 20 caractères, 3 photos, validation client, mobile money, commission,
   libération à 7 jours). `/health` publie `state: ok` et l'horodatage.
3. **L'alerte des sondes fonctionne** : 0 issue ouverte alors que tout est vert —
   et 13 sondes planifiées lues chaque matin. La règle « on n'écrit que sur un
   rouge » tient.
4. **Le SEO de contenu est écrit, pas généré** : la page guide explique ce qui
   fait varier un prix, refuse d'inventer un montant, et publie un `Article`
   sans date inventée ; la page ville tire ses 13 villes du référentiel
   géographique et se maille aux 9 métiers et aux 10 guides (vérifié : 32 liens
   sortants de `/emplois/abidjan`).
5. **La performance est réelle** : 29 Ko de HTML compressé, 2,8 Ko pour une page
   ville, TTFB sous la seconde depuis un poste ouest-africain.
6. **Les surfaces sensibles restent fermées** : `/docs` et `/openapi.json` en
   404, `/metrics` en 401, CORS qui n'écho pas une origine inconnue.
7. **La discipline de garde tient dans la durée** : 0 TODO/FIXME dans notre
   code, 973 clés i18n à parité dans 5 langues, 13 checks requis, et une
   livraison complète (PR #239) qui a su refuser un test avant de le corriger.

---

## 5. Ce qui ne va pas

### F1 — L'indexation de la base s'arrête à la sixième déclaration · **P0**
Voir §2. `google_sub` unique+sparse refuse le deuxième `null` (E11000 mesuré
dans mongod) ; un `try` unique emporte les **66** déclarations suivantes ; rien
ne mesure les index ; le repli `$regex` masque l'absence d'index texte.

### F2 — Une seule mission a jamais existé, et elle est en cours · **P0**
`Fuite sous l'évier de la cuisine à réparer`, Dakar, 20–25 000 FCFA, publiée le
23/10 à 19:00, toujours `in_progress` le 27/10. Conséquence : `completed_jobs`
à 0, `reviews` à 0, donc ni preuve sociale, ni `AggregateRating`, ni boucle de
rétention. **Le séquestre, le litige, la commission et l'avis n'ont jamais été
exercés jusqu'au bout en production.**

### F3 — L'assistant répond en 4 à 24 s · **P1**
Cinq mesures : 4,4 s · 12,6 s · 24,4 s · 13,9 s · 23,5 s. Réponses justes, mais
une personne qui hésite sur « comment publier » attend jusqu'à 24 secondes. Le
modèle a été choisi pour son coût (~0,029 $/M) ; le plafond de sortie est à
2 000 jetons (`max_tokens`), ce qui allonge chaque réponse.

### F4 — Les 32 pages SEO ne sont liées par aucune page forte · **P1**
L'accueil sert **54 liens internes**, dont **zéro** vers `/emplois/*`,
`/metiers/*` ou `/guides/*` : les 32 pages n'existent que par le sitemap. Le
maillage existe depuis les pages ville (32 liens) et métier, pas depuis la page
qui reçoit le plus de liens externes.

### F5 — Un site en 5 langues dont le HTML est monolingue · **P2**
`<html lang="fr">`, `og:locale: fr_FR`, **aucun `hreflang`**, et une seule URL
par page : le français est seul indexable, alors que 973 clés existent en
anglais, wolof, bambara et mooré. Ce n'est pas un bug de traduction, c'est une
absence de surface.

### F6 — Le parrainage est codé, invisible et sans surface · **P2**
Le backend est complet (`GET /api/users/referral`, `/filleuls`, `/apply`,
récompense à la première mission terminée du filleul). Dans l'interface, il n'y
a **qu'un toast** si un code a été saisi à l'inscription (`EmailVerificationPage.js`) :
ni page d'invitation, ni code à partager, ni lien WhatsApp.

### F7 — Le barème de lancement est codé, désactivé, et contredit par la doc · **P2**
`DEFAUTS = {"actif": False, "lancement_taux_percent": 0.0, "recurrent_taux_percent": 8.0}`
(`kojo_commission.py`) : les trois premières missions pourraient être à 0 %,
elles ne le sont pas. Le taux de croisière par défaut est **14 %**
(`kojo_settings.py:267`) alors que `backend/.env.example` documente **0.10** —
deux chiffres pour un prix.

### F8 — Le prix de Kojo n'est pas une page · **P2**
La commission n'apparaît qu'au moment de payer (`/payment`) et dans le tableau
de bord. Un travailleur qui hésite n'a aucun endroit public où lire « combien
Kojo prend ».

### F9 — Un seul fournisseur par pays · **P2**
Orange Money couvre les 4 pays, **Wave seulement le Sénégal et la Côte d'Ivoire**
(`kojo_payments.py:36-44`). Au Mali et au Burkina, un seul portefeuille : une
panne Orange ferme le paiement, sans second chemin.

### F10 — La succession reste un point unique · **P2**
`CONTINUITE.md` : 9 services, **la même personne propriétaire et en accès de
secours**, cases « vérifié » vides.

---

## 6. Améliorations — pour rendre Kojo meilleur **et** attrayant

Classées par effet attendu. « Effort » = ingénierie ; « preuve » = ce qui dira
que c'est fait.

### Palier 1 — cette semaine (fiabilité + première mission)

**A1. Réparer l'indexation, et la mesurer (0,5 j).**
Index `partialFilterExpression` sur `google_sub`, un `try` par index, résumé au
démarrage, sonde `check_index_db.py` quotidienne + ligne dans `/health`.
*Preuve* : la sonde rend « 71/71 » et rougit quand on retire l'index texte.

**A2. Terminer la mission de Dakar (commercial, pas du code).**
Accompagner le client et le travailleur jusqu'à la déclaration de fin, la
validation et l'avis. C'est le seul geste qui fait passer `completed_jobs` de
0 à 1, et qui débloque preuve sociale, `AggregateRating` et le récit de vente.
*Preuve* : `/api/public/stats` publie 1, puis 3 ; un avis apparaît sur un profil.

### Palier 2 — dans le mois (conversion et acquisition)

**B1. Le téléphone d'abord, l'email en repli (3–5 j).**
Aujourd'hui `/register` demande une boîte mail et un code ; le marché vit sur
WhatsApp. OTP par WhatsApp (le relais Kapso est déjà branché pour le support) ou
SMS, email facultatif. *Preuve* : une inscription complète sans boîte mail,
mesurée en production.

**B2. Publier une mission par WhatsApp (2–3 j).**
Kapso reçoit déjà les messages. Un message « j'ai une fuite à Dakar, 25 000 »
ouvre un brouillon de mission que le mainteneur valide : le canal réel devient
un canal d'acquisition, sans nouvelle dépendance. *Preuve* : une mission
publiée depuis WhatsApp, avec son identifiant en base.

**B3. Rendre le prix visible et le lancement réel (1 j).**
Activer les paliers (`actif: true`, 0 % sur 3 missions, 8 % au-delà de 10),
aligner `PAYMENT_COMMISSION_RATE` et `.env.example`, et publier une page
« Combien Kojo prend » (5 langues, pré-rendue). *Preuve* : la page est au
sitemap, et un devis de première mission affiche 0 %.

**B4. Donner une surface au parrainage (1–2 j).**
Page « Inviter » dans le tableau de bord : code copiable, lien `wa.me` avec le
message, compteur de filleuls, et la règle affichée (récompense à la première
mission terminée). *Preuve* : un parrainage complet déclenche la récompense
existante, et un test couvre le chemin d'invitation.

**B5. Mailler les 32 pages depuis l'accueil (0,5 j).**
Une section « Emplois par ville » et une « Guides » dans le pied de page,
servies aussi dans les coquilles pré-rendues. *Preuve* : l'accueil porte au
moins 10 liens vers `/emplois/*` et 10 vers `/guides/*`, et un garde refuse un
sitemap qui publie une page non liée.

**B6. Accélérer l'assistant (0,5 j).**
`max_tokens` à ~400 pour une réponse de support, mesure de la latence médiane et
p95 dans `/metrics`, et un indicateur « réponse en cours » explicite au-delà de
3 s. *Preuve* : médiane sous 6 s sur 10 appels, publiée.

**B7. Une seconde voie de paiement par pays (2–4 j).**
Moov Money là où Wave n'existe pas (Mali, Burkina). *Preuve* : le devis propose
deux opérateurs dans les quatre pays.

### Palier 3 — quand le marché tourne

**C1. URLs par langue + `hreflang` (3–5 j).** Au moins `/en` pour les pages
statiques et les guides, `hreflang` réciproque et `x-default`. *Preuve* : le
sitemap publie deux langues, `hreflang` vérifié par un garde.

**C2. Guides par ville, mais seulement quand la ville a des missions (2 j).**
`/guides/prix-plomberie-abidjan` généré depuis la même déclaration que les pages
ville, **refusé** sous 3 missions réelles — pas de page creuse.

**C3. Un rapport hebdomadaire de cinq chiffres (0,5 j).** Le funnel GA4 existe
déjà ; une issue automatique le lundi avec missions créées, terminées, taux de
complétion, délai de première proposition, avis. *Preuve* : l'issue arrive, et
se tait quand la mesure est indisponible.

**C4. Un second humain par service (administratif).** Fermer les 9 lignes de
`CONTINUITE.md`, cases cochées après connexion réelle.

---

## 7. Ce que cet audit ne couvre pas

- **La liste réelle des index de production** : c'est le cœur de F1 et il faut
  un accès Atlas (ou la sonde d'A1) pour la lire. Le mécanisme, lui, est mesuré.
- **Les parcours authentifiés** : OTP réel, paiement PayDunya complet,
  arbitrage, administration, messagerie.
- **Lighthouse** : non rejoué ce soir (CI verte, dernière valeur datée du 26/10 :
  99 et 98).
- **`npm audit` / `pip-audit`** : non rejoués ici (le gate CI les couvre).
- **Les binaires mobiles** : construits en CI, non installés.

---

## 8. Bilan final

**Techniquement, Kojo est solide.** Ce soir : production alignée sur `main`,
12 jobs verts, 5 en-têtes servis, surfaces sensibles fermées, 29 Ko de HTML
compressé, 43 URL indexables écrites à la main, 973 clés en 5 langues, 197
fichiers de tests, 0 TODO. L'assistant qui était muet hier répond, et `/health`
publie désormais la cause d'une panne du gateway.

**Une fissure sérieuse apparaît sous cette solidité.** La base déclare 71 index
et refuse la sixième construction ; un `try` unique emporte les 66 suivantes ;
le repli de la recherche rend le manque invisible ; aucune sonde ne regarde.
Ce n'est pas un défaut de code visible dans l'interface — c'est la garantie de
performance et d'intégrité qui s'évapore **à mesure que les données grossissent**,
c'est-à-dire précisément quand Kojo commencera à marcher.

**Commercialement, Kojo n'a pas encore bougé.** 3 travailleurs, 8 clients,
1 mission créée le 23/10 et jamais terminée, 0 avis. Toute la mécanique est
prête et rien ne l'a exercée : le premier avis, le premier litre de preuve
sociale, la première commission.

**Les trois choses à faire, dans cet ordre :**
1. **Réparer et mesurer les index** (A1) — une demi-journée, et elle protège
   tout le reste.
2. **Finir la mission de Dakar** (A2) — commercial, et c'est ce qui transforme
   `completed_jobs: 0` en récit.
3. **Ouvrir la porte par le téléphone et WhatsApp** (B1, B2) — c'est le canal du
   marché ; l'email est un péage que personne ne franchit ici.

Le reste — prix visible, parrainage, maillage, seconde voie de paiement — vaut
la peine, mais **après** la première mission terminée. Tant que le compteur est
à zéro, tout le reste est de l'échafaudage.
