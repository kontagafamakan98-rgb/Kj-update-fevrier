# Audit général de Kojo — rédigé le 20/10/2026, révisé le 21/10/2026

Périmètre de la révision : `main` @ `876e810c`, **plus 13 fichiers non commités**
(le renommage du badge, cf. §0.8). Cet audit lit le **code réel**, les gardes, les
workflows et les documents d'exploitation du dépôt. Les relevés de production de
la révision ont été pris le 21/10/2026 et sont datés ; ce qui n'a pas été mesuré
est dit comme tel.

---

## 0. Révision du 21/10/2026

### 0.1 Ce qui a changé depuis la rédaction (et qui n'est plus une dette)

| Dette du 20/10 | État au 21/10 | Preuve |
|---|---|---|
| §3.1 « la restauration est impossible » | **RÉSOLU pour l'essentiel** : l'archive quotidienne est déposée chiffrée sur un bucket privé, **restaurée dans une base de travail et comparée à la source** (405 documents, 20 collections le 21/10), puis **relue depuis le dépôt** (empreinte SHA-256, déchiffrement, flux gzip complet). Sonde de fraîcheur (36 h) verte. Reste : Atlas M0, donc pas de PITR — la granularité est « la dernière sauvegarde », et une règle de rétention/immutabilité du bucket n'est pas exercée. | Runs `39567417671` (sauvegarde), `39568167151` (sonde Atlas) ; étape 13 « Relire le dépôt déposé ». |
| §3.4 « le badge Vérifié ne vérifie pas une identité » | **RÉSOLU sur le mensonge** : les libellés disent « Moyens de paiement renseignés », l'infobulle dit « l'identité n'est pas vérifiée », et un garde refuse le retour des trois anciennes clés. Reste : aucune vérification d'identité n'existe (pièce + selfie), donc aucun badge de confiance **fort** n'est disponible. | `frontend/src/utils/__tests__/badgePaiementHonnete.test.js` (5 cas, mutation prouvée) ; 5 dictionnaires. |
| §3.5 « séquestre sans échéance » | **RÉSOLU** : déclaration par le travailleur (note ≥ 20 caractères + 3 photos), validation par le client, **libération automatique à 7 jours** (`COMPLETION_AUTO_RELEASE_DAYS`), un seul propriétaire du versement (`liberer_sequestre`, verrou CAS), trois jalons `business_events`. Reste : **pas de litige tracé** (état, échéance, décision), et la fenêtre de contestation n'existe pas. | `backend/kojo_job_completion.py`, `frontend/src/components/CompletionPanel.js`. |

### 0.2 Ce qui n'a pas changé, vérifié le 21/10/2026

- **§3.2 Détection** : les sept crons de production tombent toujours entre 02:40 et
  06:58 (`backup-db` 02:40, SEO 06:17, santé 06:30, Atlas 06:45, session 06:47,
  jeton 06:52, SSE 06:58). Une panne à 07:00 est vue le lendemain. Aucun moniteur
  externe n'est déclaré dans le dépôt.
- **§3.3 Accès** : `CONTINUITE.md` dit toujours que le propriétaire et l'accès de
  secours sont la même personne, et la colonne « Vérifié » reste vide.
- **§3.6 Signalement / blocage** : toujours absent du produit (`signalement|report|abuse`
  ne trouve que des commentaires de gardes et des messages d'erreur).
- **§3.7 Client noté** : le backend sait stocker un avis travailleur → client
  (`test_worker_reviews_client`), mais **aucune surface ne publie la note du client**
  sur la fiche de mission : `JobDetails.js` monte `JobReviews` pour les avis de la
  mission, pas une réputation d'acheteur.
- **§3.8 Recherche** : `GET /jobs` fait toujours un `$regex` sur titre + description
  et trie par `created_at` seul (`kojo_routers_jobs_listing.py:110-141`). Aucun index
  texte, pas de tri budget/distance/pertinence, pas de total.
- **§3.9 Partage WhatsApp** : `wa.me` n'existe que comme **lien de contact** du pied
  de page et de /contact. Aucun bouton de partage de mission ni de profil.
- **§3.10 Push demandé à froid** : `AuthContext` appelle toujours
  `registerPushSubscription` à l'établissement de session (lignes 393 et 492), donc
  hors interaction.
- **§3.11 Preuve sociale** : les faux compteurs (« 1 000+ travailleurs ») ont bien
  été retirés — la bande de faits ne publie plus que « 4 pays » et « 7j/7 », qui sont
  vérifiables — mais `/public/stats` n'est **lu nulle part** (`getStats` est exporté
  et jamais appelé) : aucune donnée réelle n'est affichée à la place.
- **§3.12 Accessibilité** : `axe-core` n'est qu'une dépendance transitive ; aucun
  scan en CI, aucun lien d'évitement (`skip`) dans `App.js`.
- **§3.13 PSP unique**, **§3.15 pas de préproduction** (`staging` n'apparaît que dans
  cet audit), **§3.16 magasins** (l'APK est construit en CI, aucune publication
  déclarée), **§3.17 entonnoir** (`analytics.js` n'émet que `page_view`) : inchangés.
- **§3.14 Gros fichiers** : `geolocationService.js` 1 174, `Profile.js` 1 084,
  `JobDetails.js` 1 079 (il a **grossi** de 80 lignes avec le séquestre à deux temps),
  `Register.js` 900.

### 0.3 Nouveauté à auditer : l'assistant IA de /support

Depuis le 20/10, `backend/kojo_ai_gateway.py` fait passer l'assistant de /support
par un LLM (`claude-haiku-4-5` par défaut) via le **Neon AI Gateway**, avec
`POST /api/support/robot/chat`. Ce qui est bien fait : le jeton ne quitte jamais le
serveur, le client ne peut pas écrire le rôle `system`, l'appel est sorti de
l'event loop (`asyncio.to_thread`), l'assistant est **désactivé** (503 nommé) sans
jeton, le prompt lui interdit explicitement l'accès aux données de compte, et la
route est limitée à **20 requêtes / 5 min par IP**.

Deux trous :

1. **Aucun plafond de dépense.** La limite par IP borne le débit, pas la facture :
   une attaque distribuée, ou un simple pic, se paie par requête sans budget
   global ni coupure automatique.
2. **Sous-traitant non déclaré.** Rien dans `PRIVACY.md` ne nomme de
   sous-traitant — ni Neon/gateway, ni Resend, ni PayDunya, ni Cloudinary, ni
   Vercel, ni Atlas. Le chat est sans état côté Kojo (aucun stockage), mais ce que
   le visiteur écrit part chez un tiers, et la politique ne le dit pas.

### 0.4 Le dépôt en chiffres, mesurés le 21/10/2026

| Mesure | 20/10 | 21/10 |
|---|---:|---:|
| Modules backend applicatifs / lignes | 61 / 20 301 | **62 / 20 882** |
| Tests backend (fichiers / lignes) | 95 / 30 621 | **101 / 33 484** (1,6× la prod) |
| Outils d'ops backend (`backend/scripts`) | — | **18 fichiers / 5 358 lignes** |
| Frontend applicatif (fichiers / lignes, hors tests) | — | **161 / 35 069** |
| Tests frontend unitaires | 132 | **134** : 52 dans `src/` (10 176 lignes) + 82 pour les gardes |
| Specs e2e | 27 | **27 specs / 39 fichiers / 11 445 lignes** |
| Gardes et sondes maison | 80 | **85 fichiers / 33 084 lignes** — autant que l'app |
| Gardes déclarés / mutations rejouées | 80 / — | **129 / 237** (74 en CI, 47 en test, 8 assumés sans exécution) |
| Workflows CI | 11 | **11** |
| Endpoints HTTP | 109 | **113** |
| Pages / composants | 25 / 46 | **25 / 46** |
| Langues / clés i18n | 5 / 932 | **5 / 932** |
| Dépendances vulnérables (prod) | — | **0** (`npm audit --omit=dev`), **0** (`pip-audit -r requirements.lock`) |

### 0.5 La production, mesurée le 21/10/2026 (14:17 UTC)

| Sonde | Résultat |
|---|---|
| `GET /health` | **200**, `database: connected`, révision **`876e810c`** = `main` servie, circuit PayDunya `closed` |
| `GET /api/jobs?status=open` | **`[]`** |
| `GET /api/public/stats` | `workers: 2`, `clients: 7`, **`open_jobs: 0`**, **`completed_jobs: 0`**, **`reviews: 0`**, `countries: 4` |
| `sitemap.xml` | **10 URL** : 8 pages + **2 fiches travailleur** (les deux comptes réels) |
| `robots.txt` | correct (`/api/`, `/dashboard`, `/messages`… refusés) |
| CI et sondes du jour | **vertes** : CI sur `876e810c`, SEO, santé backend, sauvegardes Atlas, sauvegarde externe, session, jeton, SSE |

**Ce que ce relevé dit, et qui domine tout le reste :** la plateforme est saine et
**personne ne l'utilise**. Sept clients, deux travailleurs, **zéro mission
terminée, zéro avis, zéro mission ouverte**. Le problème n'est plus technique.

### 0.6 Propositions, repriorisées au 21/10/2026

Les propositions 1, 4, 6 et une moitié de 5 sont faites (voir §0.1). Le nouvel
ordre, par impact réel sur les chiffres de §0.5 :

| # | Proposition | Pourquoi maintenant |
|---:|---|---|
| 1 | **Semer l'offre** : conciergerie des 50 premières missions (ville par ville), publication assistée, relance des 7 clients existants | Avec 0 mission terminée, rien d'autre ne produit d'effet mesurable ; c'est la seule action qui change `open_jobs` |
| 2 | **Litige tracé** (état, échéance, décision owner, journal) — la moitié non faite du séquestre | La libération automatique paie sans arbitrer ; le désaccord n'a toujours pas de procédure |
| 3 | **Surveillance minute + astreinte écrite** (moniteur externe **déclaré** dans le dépôt) | La cécité reste de 24 h sur une plateforme qui manipule de l'argent |
| 4 | **Deuxième personne sur chaque accès** | Inchangé, et c'est le risque le plus difficile à réparer après coup |
| 5 | **Signaler / bloquer** (message, mission, profil → ticket) | Fonction de sécurité de base, effort S |
| 6 | **Client noté, affiché sur la fiche** | Le stockage existe déjà ; il manque l'agrégat et la surface |
| 7 | **Partage WhatsApp** de la mission et du profil | Les OG sont prêts ; c'est le canal réel du marché |
| 8 | **Push demandé au bon moment** | Canal de retour déjà construit, brûlé au premier écran |
| 9 | **Recherche utile** (index texte, tri, total, sauvegardes) | Le cœur de l'usage travailleur, et le seul remède durable au `LIKE` |
| 10 | **Vraie vérification d'identité** (pièce + selfie ou appel vidéo) | Le mensonge est parti ; un badge fort reste à construire |
| 11 | **Budget et sous-traitance de l'assistant IA** (plafond global, liste des sous-traitants dans la politique) | Nouveau depuis le 20/10, non borné financièrement et non déclaré |
| 12 | **Pages ville × métier** + sitemap (10 URL aujourd'hui) | Croissance organique sans canal payant |
| 13 | Accessibilité outillée (axe en CI, lien d'évitement) · 14. préproduction · 15. découpage des quatre gros fichiers · 16. entonnoir produit · 17. second PSP · 18. magasins | Inchangés, après ce qui débloque l'usage |

### 0.7 Bilan révisé

| Domaine | 20/10 | 21/10 | Ce qui a bougé |
|---|---:|---:|---|
| Vérification / qualité | 10 | **10** | 33 484 lignes de tests pour 20 882 de prod, 129 gardes, 237 mutations, 0 vulnérabilité connue |
| Sécurité | 9 | **9** | Inchangé ; l'assistant IA est borné par IP, pas par budget |
| Paiement | 8 | **9** | Séquestre à deux temps avec échéance et preuve ; reste un seul PSP et pas de litige |
| SEO / acquisition technique | 9 | **9** | Révision servie = `main`, OG missions + profils, 10 URL indexables |
| Expérience / design | 7 | **7** | Inchangé ; accessibilité toujours non outillée |
| Confiance produit | 5 | **6** | Badge honnête + échéance de libération ; manquent litige, signalement, client noté |
| Liquidité / croissance | 3 | **2** | Mesuré : 0 mission ouverte, 0 terminée, 0 avis, 2 travailleurs, 7 clients |
| Exploitation / continuité | 4 | **5** | Sauvegarde déposée, restaurée, relue, fraîcheur jugée ; détection toujours quotidienne, un seul détenteur d'accès |

**Verdict (21/10/2026).** L'ingénierie n'est plus le sujet : elle est au niveau
d'un dépôt financé, et elle vient de fermer trois de ses quatre trous les plus
coûteux en deux jours. **Le sujet est l'usage.** Une place de marché avec sept
clients, deux travailleurs et zéro mission terminée n'a pas un problème de code :
elle a un problème d'offre, de preuve et de bouche-à-oreille. Tant que
`open_jobs` vaut 0, chaque nouvelle fonctionnalité est un coût sans effet mesurable.

Les trois actions qui changent le plus, dans l'ordre : **semer l'offre** (§0.6-1),
**tracer le litige** (§0.6-2), **réduire la cécité et le facteur Bus** (§0.6-3 et 4).

### 0.8 État de l'arbre de travail (risque de processus, pas de code)

Au moment de la rédaction, le renommage du badge (§0.1, §3.4) n'était pas
commité : 13 fichiers modifiés sur `main` (5 dictionnaires, Dashboard, Profile,
WorkerProfile, JobDetails, `workerTrustLevel.js`, `AGENTS.md`, la revue native) et
1 nouveau test non suivi, plus ce document. **Ils partent maintenant dans la même
PR** (le badge comme premier commit, cet audit comme second) : une modification
qui reste sur le disque échappe à la CI, donc à ses gardes, et le risque n'était
pas le code mais la livraison.

---

## Périmètre de la rédaction du 20/10/2026

Relevé de l'époque : `main` @ `e37cf12c`, arbre propre. Les chiffres et constats
ci-dessous sont ceux du 20/10, conservés tels quels ; là où ils ont changé, c'est
§0 qui fait foi (et le dit).

L'objectif n'est pas de féliciter l'ingénierie (elle est solide) mais de nommer
ce qui empêche Kojo d'être **meilleur et attrayant** : la confiance entre les
deux côtés de la place de marché, la découverte des missions, et la liquidité.

---

## 1. Le dépôt en chiffres (20/10/2026 — voir §0.4 pour le relevé du 21/10)

| Mesure | Valeur | Comment elle a été lue |
|---|---:|---|
| Modules backend applicatifs | **61** | `backend/kojo_*.py` + `server.py` |
| Lignes backend applicatif | **20 301** | idem |
| Lignes de tests backend | **30 621** (95 fichiers) | `backend/tests/test_*.py` — **1,5× le code de production** |
| Fichiers frontend | **210** (44 519 lignes) | `frontend/src` |
| Pages | **25** | `frontend/src/pages` |
| Composants | **46** | `frontend/src/components` |
| Tests frontend | **132 fichiers** + **27 specs** e2e | `*.test.js*`, `frontend/e2e/*.spec.js` |
| Gardes / sondes maison | **80** | `frontend/scripts/*.js|mjs` |
| Workflows CI | **11** | `.github/workflows` |
| Endpoints HTTP | **109** | décorateurs `@router.*` des routeurs (hors `include_router`) |
| Langues / clés i18n | **5** / **932** | `frontend/src/i18n/*.json` |
| Commission | **14 %** | `PAYMENT_COMMISSION_RATE` |
| Capacité machine | **~85 rps**, 256 Mo | `backend/SCALING.md` |

---

## 2. Ce qui est déjà au-dessus du marché (à ne pas casser)

1. **La vérification est un produit, pas une intention.** Registre de mutations
   (`guard-proofs.json`), gardes qui refusent de conclure sous leurs planchers de
   lecture, sondes de production qui distinguent « vert » de « rien mesuré ».
   C'est rare, et c'est ce qui permet de livrer vite sans se mentir.
2. **Sécurité d'authentification sérieuse** : jeton web en cookie httpOnly (rien
   en stockage), CSRF ré-échoé sans lire le cookie, verrou **par compte** ET
   plafond **par réseau** pour le credential stuffing et le spraying, liste noire
   de jetons fail-open *assumé et compté*.
3. **Paiement** : séquestre, idempotence du checkout, allowlist de sérialisation,
   IPN signés, anti-double-versement par CAS. Le chemin de l'argent est le mieux
   gardé du dépôt.
4. **Temps réel** : SSE avec battement de cœur, bus Redis optionnel, `resync`
   après panne, plafonds par compte atomiques en Redis. Le sondage à l'horloge a
   été supprimé, pas maquillé.
5. **SEO / partage / pré-rendu** : coquilles pré-rendues, OG dynamiques (missions
   **et** profils travailleurs), sitemap à deux sources, sondes strictes.
6. **Performance mesurée par route** : budgets LCP/CLS par page, géométrie LCP
   déclarée, budgets CSS inline, bancs de charge.
7. **RGPD tenu** : export, suppression, anonymisation, adresses en rebond,
   durées publiées dérivées du code de rétention.

---

## 3. Les dettes réelles, par gravité

### P0 — ce qui peut coûter l'entreprise

**3.1 La restauration est impossible aujourd'hui.**
Le cluster est un **M0** : ni Cloud Backup, ni PITR. La seule restauration
possible est externe, et le workflow de sauvegarde n'a **jamais** pu produire
d'archive : six secrets manquent (`MONGO_URL`, `BACKUP_S3_*`,
`BACKUP_PASSPHRASE`). Les deux rouges de la CI (`Sauvegarde externe vérifiée`,
`Sauvegardes Atlas`) échouent **par prémisse** — c'est correct, et c'est le
signal le plus important du dépôt. Un incident de données, aujourd'hui, n'a pas
de retour arrière.

**3.2 La détection d'incident peut prendre 24 h.**
La seule sonde d'application **versionnée** (`backend-health-probe.yml`) tourne
**une fois par jour, à 06:30**. Les autres crons de production tombent dans la
même heure : SEO 06:17, Atlas 06:45, session 06:47, jeton 06:52, SSE 06:58. Une
panne totale à 07:00 est vue le lendemain. `fly.toml` mentionne un moniteur externe
(UptimeRobot/Render) comme couverture de la disponibilité, mais **rien de ce
moniteur n'est déclaré dans le dépôt** : ce n'est pas vérifiable ici, donc ce
n'est pas prouvé.

**3.3 Une seule personne détient tous les accès.**
`CONTINUITE.md` le dit lui-même : propriétaire **et** accès de secours sont la
même personne sur les neuf services, et les cases « Vérifié » sont vides. Un
accident personnel arrête la plateforme, les paiements et les données.

### P1 — ce qui bloque la confiance et la croissance

**3.4 Le badge « Vérifié » ne vérifie pas une identité.**
`is_verified` est posé quand l'utilisateur a **deux moyens de paiement au bon
format** (`kojo_validation.validate_payment_accounts`). Le tableau de bord et le
profil public l'affichent avec un bouclier vert. Un nouvel inscrit qui saisit
deux numéros est « vérifié » sans qu'aucune pièce, aucun numéro ni aucun
entretien n'ait été contrôlé. Sur une place de marché, c'est exactement le badge
qui ne doit pas mentir.

**3.5 Le séquestre n'a ni échéance ni litige.**
`POST /jobs/{id}/complete` est **la seule** libération : elle est déclenchée par
le client. Il n'existe ni « travailleur marque terminé », ni délai de validation,
ni fenêtre de contestation, ni preuve de réalisation (photo, check-list), ni
arbitrage tracé. Conséquences symétriques :
- client injoignable ou indécis → l'argent reste séquestré **indéfiniment**, le
  travailleur n'a aucun recours automatique (le balayeur existant ne traite que
  les versements **en échec**, pas une libération jamais demandée) ;
- client mécontent → il ne clique pas, ou supprime la mission (remboursement) ;
  le travailleur a travaillé pour rien, sans procédure.
Un ticket support est le seul recours, et il n'a pas d'état ni d'échéance.

**3.6 Aucun signalement, aucun blocage.**
Une recherche sur `signalement|signaler|report|abuse` ne trouve **rien** côté
produit. Un utilisateur qui reçoit un message abusif ou repère une annonce
frauduleuse n'a pas de bouton. Pour une place de marché qui met en relation des
inconnus qui se paient, c'est une fonction de sécurité, pas un confort.

**3.7 Le client n'est jamais noté.**
Les travailleurs sont notés (avis liés à une mission terminée, unicité en base).
`JobDetails.js` n'affiche **aucune** évaluation du client : le travailleur postule
à l'aveugle sur la fiabilité de celui qui paie. La réciprocité est le geste de
confiance le moins cher et le plus rentable d'une place de marché.

**3.8 La découverte est un `LIKE` déguisé.**
`GET /jobs` fait une `$regex` sur titre + description, **trie uniquement par
`created_at`**, plafonne à 100, ne renvoie **aucun total**, n'a **pas d'index
texte**, pas de tri par budget / distance / fraîcheur / note, pas de recherche
sauvegardée. Les alertes emploi (livrées le 20/10) compensent en partie, mais
seulement pour qui les active. Un travailleur qui cherche « plomberie Dakar » ne
peut pas trier par pertinence ni par proximité.

**3.9 Aucun partage WhatsApp d'une mission ou d'un profil.**
`wa.me` n'existe que comme **lien de contact** dans le pied de page. Or, en
Afrique de l'Ouest, une annonce se diffuse par WhatsApp bien avant Google. Les
cartes OG sont prêtes (images dynamiques, titres, canonical) : il manque le
bouton qui les met dans une conversation.

**3.10 La permission push est demandée à froid.**
`AuthContext.establishSession` et l'auto-connexion après inscription appellent
`Notification.requestPermission()` immédiatement. Chrome exige une interaction
utilisateur pour un prompt utile ; demandé à l'arrivée, il est souvent ignoré ou
refusé — et un refus est **définitif** au niveau du navigateur. C'est le canal de
rétention le plus puissant du produit, brûlé au premier écran.

**3.11 La preuve sociale est statique, et parfois invérifiable.**
L'accueil publie des chiffres (`STATS`) figés dans la déclaration de page, alors
que le backend expose `GET /public/stats` (travailleurs, clients, missions
ouvertes, missions terminées, avis, pays). Le relevé du 12/10/2026 donne
`open_jobs: 0`. Afficher « 1 000+ » à côté d'une liste vide est le meilleur moyen
de perdre la confiance dès la première visite. Un chiffre doit venir d'une
mesure, ou ne pas être écrit.

### P2 — qualité, portée, exploitation

**3.12 Accessibilité non mesurée globalement.** Pas de scan axe en CI, pas de
lien d'évitement clavier (l'audit de conformité le note « à ajouter »), `alt`
contrôlé à la main. Les contrastes ne sont vérifiés que sur des composants
nommés.

**3.13 Un seul fournisseur de paiement.** PayDunya pour l'encaissement **et** le
décaissement. La décision est écrite et argumentée (`CONTINUITE.md` §6), mais une
panne de plusieurs heures paralyse la place entière.

**3.14 Quatre fichiers portent trop.** `geolocationService.js` (1 174 lignes),
`Profile.js` (1 076), `JobDetails.js` (999), `Register.js` (900). Ce ne sont pas
des fichiers « sales » — ils sont testés — mais ce sont les quatre endroits où
une modification coûte le plus cher, et où une régression se glisse le plus
facilement.

**3.15 Aucune préproduction backend.** Les workflows ne déclarent aucun
environnement `staging` : chaque fusion sur `main` qui touche `backend/**` part
en production. Le frontend a les previews Vercel ; l'API n'a rien.

**3.16 Les applications natives ne sont pas publiées.** `frontend/android` et
`frontend/ios` existent, la CI construit l'Android, mais rien ne déclare de
publication en magasin ni de liens profonds (`kojoforafrica.cc.cd/jobs/x` →
application). Sur ce marché, une app installée change la rétention.

### P3 — mesure produit

**3.17 Pas d'entonnoir.** GA4 est optionnel et branché après consentement, mais
aucun événement métier n'est suivi (inscription terminée, première candidature,
première mission publiée, premier paiement). On sait qu'une page est lente ; on
ne sait pas **où les gens abandonnent**.

---

## 4. Propositions, classées par impact / effort

| # | Proposition | Impact | Effort | Pourquoi maintenant |
|---:|---|---|---|---|
| 1 | **Brancher la sauvegarde externe** (bucket R2/S3 + six secrets) et laisser la sonde juger sur un fait | Critique | S | Deux rouges de CI disparaissent par la mesure, pas par le silence |
| 2 | **Surveillance minute par minute** (moniteur externe déclaré + `/health` + `/monitor`), astreinte écrite | Critique | S | Réduit la cécité de 24 h à 1–5 min |
| 3 | **Deuxième personne sur chaque accès** (Fly, Vercel, Atlas, GitHub, PayDunya, Cloudinary) | Critique | M (humain) | `CONTINUITE.md` nomme cet écart lui-même |
| 4 | **Séquestre à deux temps** : travailleur marque terminé + preuve, client valide, **libération automatique à J+n**, fenêtre de contestation | Très fort | M | Ferme le trou où le travailleur travaille sans être payé |
| 5 | **Litige tracé** (état, échéance, décision owner, historique dans `business_events`) | Très fort | M | Remplace « un ticket et de la bonne volonté » |
| 6 | **Badge honnête** : renommer l'actuel en « moyens de paiement renseignés », et ajouter une vraie vérification (pièce + selfie ou appel vidéo) | Très fort | M | Un badge qui ment coûte plus cher que pas de badge |
| 7 | **Signaler / bloquer** depuis messages, mission, profil → ticket support | Fort | S | Sécurité de base d'une mise en relation |
| 8 | **Noter le client** (même mécanique que les avis travailleur) et l'afficher sur la fiche | Fort | S | Réciprocité = confiance, et filtre les mauvais payeurs |
| 9 | **Recherche utile** : index texte MongoDB, tri pertinence / budget / distance / fraîcheur, total, recherches sauvegardées | Fort | M | Le cœur de l'usage travailleur |
| 10 | **Pages ville × métier** (`/jobs/plombier-dakar`) générées depuis les catégories et le sitemap existants | Fort | M | Croissance organique sans nouveau canal |
| 11 | **Partage WhatsApp** sur mission et profil public (`navigator.share` + repli `wa.me`) | Fort | S | Le canal réel du marché, et les OG sont déjà prêts |
| 12 | **Permission push au bon moment** (après première candidature ou activation d'une alerte), avec écran d'explication | Fort | XS | Double le taux d'acceptation, coût quasi nul |
| 13 | **Preuve sociale mesurée** : lire `/public/stats` après hydratation, garder la coquille statique comme repli | Moyen | S | Honnêteté + crédibilité immédiate |
| 14 | **Accessibilité outillée** : axe-core en CI sur les routes publiques + lien d'évitement | Moyen | S | Rend la qualité visible, élargit l'audience |
| 15 | **Préproduction backend** (app Fly `kojo-backend-staging`, base séparée) | Moyen | M | Les migrations et l'argent ne se testent pas en prod |
| 16 | **Découper les quatre gros fichiers** (hooks + sous-composants, sans changer l'UI) | Moyen | M | Réduit le coût de chaque évolution |
| 17 | **Entonnoir produit** (5 événements, sans PII, respect du consentement) | Moyen | S | On arrête de deviner où l'on perd les gens |
| 18 | **Second PSP ou agrégateur** pour l'encaissement | Moyen | L | La panne PayDunya devient dégradée, pas totale |
| 19 | **Publication Play Store + liens profonds** | Moyen | L | Rétention et notifications natives |
| 20 | **Plan de liquidité** (amorçage de l'offre par ville/métier, conciergerie des 50 premières missions) | **Le plus fort** | M | Sans missions, le reste est décoratif |

---

## 5. Feuille de route

**30 jours — arrêter de saigner**
1. Sauvegarde externe (prop. 1) · 2. surveillance minute (2) · 3. second accès (3)
· 12. push au bon moment · 11. partage WhatsApp · 6. badge honnête · 7.
signaler/bloquer · 14. axe + lien d'évitement · 13. preuve sociale mesurée.

**60 jours — rendre la place crédible**
4. séquestre à deux temps + libération automatique · 5. litige tracé · 8. client
noté · 9. recherche utile · 10. pages ville × métier · 17. entonnoir.

**90 jours — tenir la charge**
15. préproduction · 16. découpage · 18. second PSP · 19. magasins · 20. plan de
liquidité exécuté (offre semée, missions conciergerie).

---

## 6. Bilan au 20/10/2026 (remplacé par §0.7)

| Domaine | Note | Justification mesurée |
|---|---:|---|
| Vérification / qualité | **10/10** | 30 621 lignes de tests pour 20 301 de production ; gardes qui prouvent leur propre échec |
| Sécurité | **9/10** | verrous compte + réseau, CSRF sans cookie lisible, secrets scannés et épinglés ; reste la dépendance à un seul humain |
| Paiement | **8/10** | séquestre, idempotence, CAS, IPN ; mais un seul PSP et pas d'échéance de libération |
| SEO / acquisition technique | **9/10** | pré-rendu, OG dynamiques, sitemap à deux sources, sondes strictes |
| Expérience / design | **7/10** | rythme et budgets tenus, états vides soignés, 5 langues ; accessibilité non outillée |
| Confiance produit | **5/10** | badge trompeur, pas de litige, pas de signalement, client non noté |
| Liquidité / croissance | **3/10** | `open_jobs: 0` au 12/10/2026, aucun partage social d'annonce, aucun plan d'amorçage |
| Exploitation / continuité | **4/10** | aucune restauration possible, détection jusqu'à 24 h, un seul détenteur d'accès |

**Verdict.** Kojo est, techniquement, l'un des dépôts les mieux tenus que l'on
puisse auditer : la discipline de mesure y est supérieure à celle de la plupart
des équipes financées. Le problème n'est plus là. **Le code est prêt pour
100 000 utilisateurs ; le produit n'est pas encore prêt pour 1 000.** Ce qui
manque n'est pas de l'ingénierie, c'est de la confiance entre les deux côtés
(badge honnête, séquestre avec échéance, litige, signalement, client noté) et de
la liquidité (missions réelles, partage WhatsApp, pages locales, amorçage de
l'offre).

**Les trois actions qui changent le plus, dans l'ordre (au 20/10 — remplacées par
celles de §0.7 le 21/10) :**
1. **Restaurer la base** (prop. 1) — sans cela, tout le reste est un pari.
2. **Séquestre à deux temps + litige** (prop. 4 et 5) — c'est la raison pour
   laquelle un travailleur acceptera de travailler, et un client de payer.
3. **Semer l'offre** (prop. 20) — 50 missions réelles valent mieux que dix
   nouvelles fonctionnalités.

---

## 7. Ce que cet audit ne dit pas

- La rédaction du 20/10 ne mesurait **pas** la production en direct ; la
  **révision du 21/10** l'a fait (§0.5 : santé, révision servie, missions
  ouvertes, statistiques publiques, sitemap, sondes du jour). Ce qui reste non
  mesuré : le trafic réel, les conversions, le coût d'exploitation mensuel et
  l'usage de l'assistant IA.
- Il ne juge pas la **qualité des traductions** `wo`/`bm`/`mos` (propositions,
  relecture native non faite) ni la pertinence commerciale du taux de 14 %.
- Il ne prouve pas l'absence des risques qu'il nomme par recherche de code :
  un mécanisme de litige existant hors du dépôt (support humain, WhatsApp)
  resterait invisible ici.
- Les deux rouges de sauvegarde du 20/10 n'étaient pas des défauts de code mais
  des **prémisses** (secrets absents). Depuis le 21/10 la sauvegarde existe, et
  les deux workflows sont **verts** : ce qui reste non jugé n'est pas le code de
  sauvegarde, c'est la **rétention/immutabilité du bucket** et la rotation de la
  phrase secrète (aucun exercice daté de déchiffrement avec l'ancienne clé).
