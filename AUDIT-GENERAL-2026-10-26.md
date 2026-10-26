# Audit général de Kojo — 26 octobre 2026

> **Périmètre** : production (`https://kojoforafrica.cc.cd` sur Vercel,
> `https://kojo-backend.fly.dev` sur Fly.io), `main` à `33d14fe3`, et l'arbre de
> travail local.
> **Méthode** : mesures exécutées le 26/10/2026 — HTTP réel (latences, en-têtes,
> HTML servi), Lighthouse mobile sur la production, GitHub Actions (jobs et
> sondes), lecture du code. **Chaque constat porte sa mesure ; ce qui n'a pas été
> vérifié est dit comme non vérifié.**
> **Ce que cet audit ne couvre pas** : les parcours authentifiés (inscription
> réelle avec livraison d'OTP, paiement PayDunya de bout en bout, arbitrage,
> administration), les binaires mobiles installés, et la configuration des
> secrets (elle n'est pas lisible depuis le dépôt).

---

## 1. Verdict en une page

Kojo est **une place de marché à séquestre dont l'ingénierie a dépassé le
marché qu'elle sert**. Le déséquilibre n'a pas bougé depuis le 24/10 : il s'est
même creusé, parce que le produit a gagné des fonctions (KYC portefeuille,
modération des comptes, équipe support, funnel GA, scrape Prometheus, partage de
mission) pendant que la place restait vide.

| Ce qui est mesuré le 26/10/2026 | Valeur | Source |
|---|---:|---|
| Travailleurs | **3** | `GET /api/public/stats` |
| Clients | **8** | idem |
| Missions ouvertes | **0** | `GET /api/jobs?status=open` → `[]` |
| Missions terminées | **0** | `/api/public/stats` |
| Avis | **0** | idem |
| Missions au total | **1** (en cours) | `GET /api/jobs` |
| URL au sitemap | **12** (8 statiques + 1 fiche + 3 profils) | `/sitemap.xml` |
| Pays couverts | 4 | `/api/public/stats` |
| Lighthouse mobile `/` | **99 / 100 / 100 / 100** | mesure du jour |
| Lighthouse mobile `/jobs` | **98 / 100 / 100 / 100** | mesure du jour |
| Jobs CI sur `main` | **12 / 12 verts** | Actions, `33d14fe3` |
| Sondes quotidiennes | **14 vertes** | Actions, 25/10 |

En face de « 0 mission terminée », le dépôt porte : séquestre à deux temps,
litiges tracés avec arbitrage, verrou de connexion par compte **et** par réseau,
KYC du titulaire du wallet mobile money, modération des comptes, équipe support
avec rôles, bus SSE + Redis, 5 langues à parité (974 clés × 5), 119 fichiers de
tests backend, 69 fichiers de tests frontend, 14 sondes de production.

**Le produit est en avance sur son marché, et c'est mesuré tous les jours par
`/api/public/stats`.** Tant que `completed_jobs` vaut 0, aucun levier de
croissance ne peut s'enclencher : pas d'avis (donc pas de preuve sociale, pas de
`AggregateRating`), pas de `JobPosting` servi (les fiches pourvues n'en portent
pas, par contrat), pas de rétention, pas de bouche-à-oreille.

---

## 2. Notes par domaine — 26/10/2026

Notes sur 10, justifiées par la mesure. Une note basse n'est pas un jugement sur
le travail : c'est l'écart entre ce qui est construit et ce qui est **observé en
production**.

| Domaine | Note | Preuve du 26/10/2026 |
|---|---:|---|
| Ingénierie backend | **9,5** | Séquestre, litiges, KYC wallet, modération, RBAC support ; `/health` 200, base connectée, PayDunya `closed` |
| Sécurité | **9** | En-têtes statiques désormais complets, gitleaks bloquant, verrou compte + réseau, allowlists publiques, `requirements.lock` à empreintes |
| Performance | **10** | `/` 99, `/jobs` 98 (LCP 1,8 s / 2,2 s, TBT 20 ms, CLS 0) — contre **65 et 1 750 ms de TBT** sur `/jobs` le 24/10 |
| Accessibilité | **10** | Lighthouse a11y 100 sur les deux pages, parcours clavier + axe en CI |
| SEO technique | **9** | Pré-rendu fiche/profil, canonical, OG/Twitter, `JobPosting` (contrat hors ligne), sitemap ; `/terms` manquait (corrigé aujourd'hui) |
| SEO de contenu | **2** | 12 URL, 1 fiche, 3 profils, 0 avis : il n'y a presque rien à classer |
| Internationalisation | **8** | 974 clés × 5 langues, parité vérifiée ; traductions non relues par des natifs |
| Mobile (Capacitor) | **4** | Trois générations de bundles coexistent (voir §5.6) |
| Paiement | **8** | Devis affiché avant checkout, séquestre, remboursement, KYC wallet ; mode live/test non vérifiable sans secret |
| Observabilité | **9** | `/metrics` fermé par défaut (401 sans jeton), 9 familles de flux, scrape Prometheus documenté + fichier exécutable, 14 sondes, funnel GA à liste blanche |
| Tests / CI | **10** | 12/12 jobs verts, mutations de gardes rejouées, 14 sondes quotidiennes |
| Produit / traction | **2** | 0 mission ouverte, 0 terminée, 0 avis, 3 travailleurs |
| Confort de développement | **6** | L'appareil de garde reste plus gros que le code produit ; deux modules dépassent 1 200 lignes |

**Moyenne pondérée par ce qui fait vivre une place de marché : ≈ 8,3/10
technique, 2/10 marché.**

---

## 3. Ce qui est solide (mesuré, pas supposé)

1. **La production est saine et cohérente.** Le HTML servi annonce
   `33d14fe392cafbd72dacce32f42befb336a8fee0` — le SHA de `main` — et `/health`
   rend le même SHA, `database: connected`, `paydunya_circuit.state: closed`.
   Aucune dérive frontend/backend.
2. **Les en-têtes statiques sont complets** : `Content-Security-Policy:
   frame-ancestors 'none'`, `Strict-Transport-Security: max-age=63072000`,
   `X-Content-Type-Options: nosniff`, `Referrer-Policy:
   strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(self),
   microphone=(), camera=()`. C'était le trou du 24/10 ; il est fermé.
3. **La performance est désormais une force sur toute la surface.** Lighthouse
   mobile sur la production : `/` **99** (LCP 1,8 s, TBT 20 ms, CLS 0, 852 Kio)
   et `/jobs` **98** (LCP 2,2 s, TBT 20 ms, CLS 0, 377 Kio). Le 24/10, `/jobs`
   valait 65 avec 1 750 ms de TBT : la page la plus lourde du site est devenue
   une page rapide, et c'est la mesure qui le dit, pas une intention.
4. **La fiche mission dit la même chose à un crawler et à un navigateur.** H1
   statique = `job.title` seul (le titre de page ne fuit plus), description
   coupée sur le dernier **espace** à 148 points de code et terminée par « … »
   (plus de mot tranché), canonical, `og:url`, deux cartes OG.
5. **Le `JobPosting` est implémenté et jugé** — et son absence aujourd'hui est
   une leçon de produit : le contrat exige qu'il soit **absent** sur une mission
   `in_progress` (une mission pourvue n'est pas une annonce). La seule mission
   vivante est en cours, donc Google Jobs ne voit rien. Ce n'est pas un défaut
   de code, c'est le reflet exact de §1.
6. **La preuve sociale ne s'invente pas.** `preuveSociale.js` publie un zéro
   mesuré, refuse tout repli chiffré et formate selon la langue ; l'accueil ne
   sert plus « 1 000+ travailleurs ».
7. **La liste vide publique ne ment plus.** Les trois fausses annonces
   `DemoJobsEmptyState` ont disparu : `/jobs` affiche un constat honnête et trois
   issues réelles (publier, recevoir les missions par email, WhatsApp) — vérifié
   dans le DOM de production.
8. **Le sitemap est servi par le backend**, pas par un fichier figé : il énumère
   les fiches `open` et `in_progress` et les profils publiables, avec l'hôte
   attendu.
9. **`/metrics` est fermé par défaut** : 401 sans jeton (mesuré), et les trois
   causes de refus de flux sont publiées séparément avec la saturation.
10. **Aucune vulnérabilité npm en production** : `npm audit --omit=dev` →
    0/0/0/0/0.
11. **La CI est un vrai verrou** : 12 jobs verts sur `main`, dont E2E Chromium,
    Lighthouse sur 16 URL, gitleaks, `pip-audit` sur le lock, drift d'environnement
    Fly, et 14 sondes quotidiennes vertes le 25/10.

---

## 4. Ce qui a été corrigé aujourd'hui

Deux défauts mesurés, tous deux dans
[kojo_routers_public.py](backend/kojo_routers_public.py), corrigés sans toucher
à une route, à un schéma ou à une réponse.

### 4.1 `/api/public/stats` : cinq allers-retours pour un chiffre

**Mesuré** : 1,072 s / 1,096 s / 1,082 s en chaud sur
`https://kojo-backend.fly.dev/api/public/stats`, quand `/metrics` (qui ne touche
pas la base) répond en 0,334 s et `/health` en 0,617 s. Les cinq compteurs
étaient lus **l'un après l'autre** : cinq allers-retours vers Atlas pour le
premier chiffre que lit la page d'accueil.

**Correction** : les cinq `count_documents` partent ensemble
(`asyncio.gather`) — mêmes requêtes, mêmes index, **un** temps de réseau. Aucune
valeur n'est mémorisée : la fraîcheur reste celle du `Cache-Control:
public, max-age=60, s-maxage=60` déjà déclaré, et une lecture en échec propage
l'exception comme avant (un 500 nommé, jamais un zéro qui aurait l'air d'un
fait).

**Vérifié** : `pytest tests/test_public_radius.py tests/test_seo_discovery.py
tests/test_route_surface.py` → **57 cas verts**. La latence de production après
déploiement reste **à re-mesurer** (même commande `curl`, trois relevés) — je ne
l'annonce pas comme acquise.

### 4.2 `/terms` était indexable mais absent du sitemap

**Mesuré** : `https://kojoforafrica.cc.cd/terms` → **200**, HTML de
**105 553 o**, `<title>Conditions générales d'utilisation — Kojo</title>`,
`robots: index, follow`. Le sitemap ne la citait pas, alors que son commentaire
annonçait « les trois pages de confiance », que `/privacy` — sa jumelle
juridique — y était, et qu'une page indexable absente du sitemap est explorée
plus tard et plus rarement.

**Correction** : `/terms` entre dans la liste statique
(`changefreq: yearly`, `priority: 0.4`), et le commentaire dit désormais
**quatre** pages de confiance, avec la mesure qui a motivé l'ajout. Le sitemap
passe de 8 à 9 URL statiques (13 au total aujourd'hui).

### 4.3 Une docstring citait un garde qui n'existe pas

La docstring de `get_public_stats` renvoyait à `tests/test_public_stats.py`,
**fichier inexistant** : les gardes réels sont dans `tests/test_public_radius.py`
(`test_public_stats_ne_publie_que_des_compteurs` et trois voisins). Une règle
qui cite un garde introuvable se lit comme gardée alors qu'on ne sait plus où.
La citation pointe maintenant le bon fichier, et le fait est dit dans la
docstring.

**Portée** : ces trois corrections sont **locales et testées**, mais **pas
déployées** — elles attendent une livraison (`npm run livrer`) pour être
mesurables en production.

---

## 5. Défauts restants, classés par coût

### 5.1 P0 — ce qui empêche le produit de vivre

**1. La place de marché est vide, et aucun code ne la remplira.**
`open_jobs: 0`, `completed_jobs: 0`, `reviews: 0`, **une** mission au total (en
cours), 3 travailleurs, 8 clients. Toute la valeur construite (séquestre, litige,
KYC, support, SEO) tourne à vide. **Coût : 100 % de la valeur potentielle.**
Correctif : [PLAN-SEMIS-OFFRE-30J.md](PLAN-SEMIS-OFFRE-30J.md), inchangé et
toujours valable — 50 missions réelles, 32 terminées, 24 avis, et la règle des
25 % (jamais plus d'un quart des missions ouvertes sans proposition depuis 24 h).
**C'est la seule action qui fait passer Produit de 2 à 8.**

**2. Deux signaux de confiance visibles contredisent le produit.**
Mesuré dans le pied de page de la production : l'email de contact est
**`Kojoapp98@gmail.com`** et le téléphone est **`+1 819 300 3507`** (indicatif
canadien), pour une place de marché dont l'adresse affichée est
« Hamdallaye ACI 2000, Bamako, Mali ». Sur un produit qui manipule de l'argent
et publie une politique de confidentialité nommant ses sous-traitants, une boîte
Gmail comme unique contact et un numéro à huit fuseaux de là sont les deux
premiers détails qu'un client méfiant vérifie. **Coût : crédibilité, donc
conversion.** Correctif, 30 minutes : `support@kojoforafrica.cc.cd` (le domaine
est déjà vérifié chez le fournisseur d'email) + un numéro local/WhatsApp, dans la
source unique [contact.json](frontend/src/config/contact.json).

**3. L'inscription demande neuf champs et un email vérifié, dans un marché où
l'identifiant est le téléphone.** Mesuré sur `/register` en production :
`user_type` (2 radios), `country`, `first_name`, `last_name`, `email`,
`phone`, `password`, `confirmPassword`, case légale — plus « S'inscrire avec
Google ». Le téléphone est **exigé** mais **jamais vérifié**, et il n'existe
**aucune** route de connexion par téléphone : les 14 routes `/auth` sont email
OTP, mot de passe et Google. Autrement dit : on collecte l'identifiant réel du
marché sans jamais s'en servir. **Hypothèse (non mesurée, faute de trafic) :
c'est le premier frein de conversion.**

### 5.2 P1 — ce qui coûte des visiteurs

**4. Le SEO de contenu n'a rien à indexer.** 13 URL, 1 fiche, 3 profils, 0 avis.
Le `JobPosting` est prêt mais ne se déclenche que sur une mission `open` : sans
mission ouverte, Google Jobs ne voit rien. Aucune page par métier × ville
(« plombier à Bamako »), qui est pourtant la requête réelle de ce marché.
Correctif après le semis : 9 métiers × 3 villes, pré-rendus depuis les
catégories et les pays déjà déclarés.

**5. L'état vide de `/jobs` est honnête mais décourageant.** Le titre affiché est
« Aucun job disponible pour le moment. » — vrai, et placé en tête de la page la
plus stratégique du site. Les trois issues existent (publier, recevoir les
missions, WhatsApp), mais la promesse (« soyez prévenu avant les autres ») n'est
pas dans le titre. Changement de copie, 5 langues, sans mensonge.

**6. Le mobile suivi n'est pas celui qui est servi.** Trois générations
coexistent : `index-DlUJxnnU.js` dans `frontend/android/.../assets` **et**
`frontend/ios/App/App/public/assets`, `index-Cpu4vSWo.js` dans le build local,
`index-wCWXB7_g.js` en production. La CI fait `npx cap sync android`, **jamais
iOS**. Soit les binaires publiés sont anciens, soit les dossiers suivis ne
servent à rien : dans les deux cas il faut trancher (et c'est une décision de
livraison, pas de code).

**7. La preuve sociale affiche des zéros.** `preuveSociale.js` publie un zéro
mesuré — doctrine assumée (« 0 % publié reste une mesure »). Sur un accueil qui
vend la confiance, « 0 mission terminée · 0 avis » en dit long. La règle
honnête existe aussi : n'afficher la bande mesurée qu'à partir d'un plancher
(par exemple 3 missions terminées) et, en dessous, publier la promesse plutôt
que le compteur — en le DISANT (« les premiers chiffres s'afficheront dès les
premières missions terminées »).

### 5.3 P2 — hygiène, dette, exploitation

**8. `/photo-debug` reste une route de diagnostic dans le binaire client**
(propriétaire seulement, donc pas une faille) : un chunk et une entrée de plus
dans `vercel.json`, `robots.txt` et une demi-douzaine de gardes.

**9. Deux modules dépassent 1 200 lignes** (`kojo_scheduler.py` 1 952,
`kojo_job_disputes.py` 1 269), plus `JobDetails.js` (1 236), `index.css`
(3 422) et `page-sections.js` (1 553). Les budgets existent pour le bundle ; il
n'en existe pas pour la taille d'un module.

**10. Sentry est optionnel et invérifiable d'ici.** `SENTRY_DSN` absent = aucune
remontée d'erreur (no-op) ; les erreurs backend ne vivent alors que dans les
journaux Fly. À confirmer côté secrets.

**11. Traductions non relues.** 974 clés × 5 langues, parité parfaite, mais rien
ne dit qu'un locuteur wolof/bambara/soninké a relu les chaînes (le chantier est
ouvert : `frontend/src/i18n/alertes-emploi-revue-native.md`).

---

## 6. Plan pour atteindre 10/10

Le 10/10 ne s'atteint pas par du code : les deux notes à 2 sont la traction et le
contenu indexable, et les deux dépendent de missions réelles servies.

| Horizon | Ce qui monte la note | Coût |
|---|---|---|
| **Cette semaine** | Contact crédible (email du domaine + numéro local) ; copie de l'état vide ; décision mobile (re-synchroniser ou ne plus suivre les artefacts) ; supprimer `/photo-debug` | 1 j |
| **30 jours** | Inscription par téléphone (OTP WhatsApp, Kapso déjà branché) avec email en secours ; retrait de `confirmPassword` ; plancher de preuve sociale | 3-5 j |
| **30 jours (opération)** | 12-20 missions ouvertes semées, 32 terminées, 24 avis — la seule chose qui fasse bouger Produit, SEO de contenu, `JobPosting`, preuve sociale et rétention | temps plein (concierge) |
| **60 jours** | Pages métier × ville (9 × 3), pré-rendues ; `AggregateRating` dès les premiers avis ; relance des clients sans proposition (l'outil existe déjà) | 3-4 j |
| **90 jours** | Découpage des deux gros modules ; budget de taille de fichier ; relecture native des 5 langues | 3 j |

**Ordre non négociable** : la traction d'abord. Ouvrir 30 URL métier × ville
avant d'avoir servi dix missions produirait trente pages vides — exactement ce
que la règle des 25 % du plan de semis existe pour empêcher.

---

## 7. Bilan final

**Ce que Kojo est aujourd'hui** : une place de marché de services à séquestre,
techniquement au niveau d'un produit financé — paiement protégé, litiges
arbitrés, KYC du bénéficiaire, modération, support à rôles, cinq langues,
98-99 de performance mobile, zéro vulnérabilité connue, 12 jobs de CI verts et
14 sondes quotidiennes — avec **onze comptes, une mission en cours, zéro mission
terminée et zéro avis**.

**Ce que l'audit a trouvé de réparable en une heure** : cinq allers-retours
MongoDB pour un compteur de page d'accueil, une page juridique indexable absente
du sitemap, et une docstring qui citait un garde inexistant. Les trois sont
corrigés et testés (57 cas) ; la latence de production sera re-mesurée après
livraison.

**Ce qui reste, et qui n'est pas du ressort du code** : remplir la place. Une
place de marché vide ne se distingue pas d'une place de marché abandonnée, et
aucun travail d'ingénierie ne change ce fait. Les deux signaux de confiance
(Gmail, numéro canadien) coûtent trente minutes et valent plus que dix
fonctionnalités.

**Note d'ensemble** : **8,3/10 technique, 2/10 marché**. Le chemin vers 10 est
tracé, il passe par dix missions payées et vingt-quatre avis, pas par une
nouvelle fonctionnalité.
