# Audit général de Kojo — 28 octobre 2026

> **Périmètre** : production (`https://kojoforafrica.cc.cd` sur Vercel,
> `https://kojo-backend.fly.dev` sur Fly.io), `main` à **`a84f6903`**, et l'arbre
> de travail local.
> **Méthode** : mesures exécutées le 28/10/2026 — HTTP réel (statuts, latences,
> sitemap, HTML servi), **Lighthouse mobile 3 runs sur `/` et 2 sur `/jobs`**,
> sondes CLS locales (`e2e/cadres-app.spec.js`, `e2e/cls-coquille-react.spec.js`)
> sur un build refait depuis `main`, GitHub Actions, lecture du code.
> **Limites déclarées** : la machine de mesure est **chargée** (autres processus
> et navigateurs), donc les chiffres Lighthouse du jour sont **bruités** — l'écart
> avec le 26/10 est publié sans être attribué. Les parcours authentifiés réels
> (paiement PayDunya de bout en bout, arbitrage, administration) ne sont pas
> rejoués ici ; les secrets ne sont pas lisibles depuis le dépôt ; les binaires
> mobiles ne sont pas installés.
> **Mise à jour du 28/10 (soir)** : `main` est passé à **`5b2e069f`** (#247, le
> cadre de `/payment` remplit l'écran en mobile). La mesure de **dispersion** qui
> instruit l'écart de performance (item 5 du §5.2) a été rejouée sur **cet**
> artefact : 5 runs par route, même build, aucun rebuild entre les runs.

---

## 1. Verdict en une page

**En 48 h, Kojo a gagné une surface de contenu et perdu zéro garantie technique.
Le marché, lui, n'a pas bougé d'un chiffre.**

| Ce qui est mesuré le 28/10/2026 | Valeur | Le 26/10 | Source |
|---|---:|---:|---|
| Travailleurs | **3** | 3 | `GET /api/public/stats` |
| Clients | **8** | 8 | idem |
| Missions ouvertes | **0** | 0 | `GET /api/jobs?status=open` → `[]` |
| Missions terminées | **0** | 0 | idem |
| Avis | **0** | 0 | idem |
| Pays couverts | **4** | 4 | idem |
| **URL au sitemap** | **56** | 13 | `/sitemap.xml` |
| — dont pages ville (`/emplois/*`) | **13** | 0 | idem |
| — dont pages métier (`/metiers/*`) | **9** | 0 | idem |
| — dont guides (`/guides/*`) | **23** | 0 | idem |
| Lighthouse mobile `/` (5 runs, **même artefact**) | **85 – 100** (médiane **95**) : 95/93/85/100/99 | 99 (3 runs) | `mesure-lighthouse-locale.mjs --runs 5` |
| Lighthouse mobile `/jobs` (5 runs, même artefact) | **80 – 100** (médiane **86**) : 80/86/100/90/86 | 98 (2 runs) | idem |
| CI Lighthouse — budgets (`main`) | **verte** : 14 URL, 42 runs | verte | Actions |
| CLS `/` et `/jobs` | **0,0000** | 0 | idem |
| Accessibilité / bonnes pratiques / SEO | **100 / 100 / 100** | 100 | idem |
| Poids transféré `/` et `/jobs` | **853 Ko / 380 Ko** | 852 / 377 | idem |
| `/api/public/stats` (3 relevés) | **0,48-0,50 s** | 1,07-1,10 s | `curl` |
| `/health` (3 relevés) | **0,63-0,81 s** | 0,62 | `curl` |
| CI sur `main` | **verte** (`a84f6903`) | 12/12 | Actions |
| Sondes vues vertes aujourd'hui | **sauvegardes externes, index de la base (×2), retrait des résidus** | 14 sondes vertes le 25/10 | Actions |

**Lecture** : la place de marché est toujours vide — **0 mission ouverte, 0
terminée, 0 avis, 3 travailleurs** —, et c'est toujours la seule chose qui
empêche Produit, SEO de contenu, preuve sociale et `JobPosting` de valoir quoi
que ce soit. Ce qui a changé, c'est que le site a désormais **45 pages qui
répondent à des recherches réelles** (« emploi Abidjan », « plombier Bamako »,
« prix plomberie Abidjan ») là où il n'en avait aucune : la capacité d'absorber
le trafic existe maintenant, elle attend des missions à montrer.

---

## 2. Ce que les 48 dernières heures ont réellement changé

20 commits sur `main`, tous mesurés dans les gardes du dépôt.

| Livraison | Ce qu'elle apporte | Preuve |
|---|---|---|
| #238 / #243 / #244 | **45 pages SEO** (13 villes, 9 métiers, 23 guides) servies par le backend, liées depuis l'accueil **et** le pied de page (donc depuis toutes les routes), présentes au sitemap | sitemap **56 URL** mesuré aujourd'hui ; `/guides/prix-abidjan` → 200, `<title>Prix à Abidjan : budgets annoncés — Kojo` |
| #240 / #241 / #242 | **Index de la base déclarés une fois**, créés un par un (un échec n'emporte plus les 66 suivants), et **jugés** par une sonde quotidienne | workflows « Index de la base » (×2) et « Retrait des index résiduels » **verts le 28/10** |
| #239 | La purge de rétention **sort de la boucle du planificateur** | `kojo_purge_retention.py` séparé |
| #235 | Le **502 de l'assistant nomme sa cause** (`/health.ai_gateway`) et une sonde rouge **ouvre une issue** | workflow `sondes-sante.yml` |
| #236 / #244 | Un litige **découpé** (`kojo_job_disputes.py` 1 269 → **863** lignes) et une mission mal exécutée orientée vers l'arbitrage | `wc -l` |
| #245 | Pied de page desktop **217 → 157 px** : CLS de `/payment` **0,0611 → 0,0376**, plafond redescendu de 0,07 à **0,06** | re-mesuré aujourd'hui : 0,0376 / 0,0331 desktop, 0,0496 mobile (plafond 0,06) |
| #227 / #229 / #226 | Preuve sociale **seuillée** (jamais un zéro publié), description sur chaque document pré-rendu, inscription allégée | `preuveSociale.js`, `check-prerender-shells.js` |

---

## 3. Notes par domaine — 28/10/2026

Notes sur 10, justifiées par la mesure. Une note basse n'est pas un jugement sur
le travail : c'est l'écart entre ce qui est construit et ce qui est **mesuré en
production**.

| Domaine | Note | Δ | Preuve du 28/10/2026 |
|---|---:|---:|---|
| Ingénierie backend | **9,5** | = | Séquestre à propriétaire unique, litiges découpés et tracés, KYC wallet sur les deux chemins de décaissement, index déclarés + sonde, rétention hors boucle ; `/health` 200, base connectée |
| Sécurité | **9** | = | Cookie `HttpOnly`+`Secure`+`SameSite=None`, CSRF double-submit sans jeton en stockage, verrou compte **et** réseau, gitleaks bloquant, `requirements.lock` à empreintes, en-têtes statiques complets |
| Performance | **10** | = | CLS **0,0000** aux deux tailles, TBT 24-169 ms, 853/380 Ko, budgets CI verts (14 URL / 42 runs) ; la médiane de 87 du matin était un **tirage**, pas une régression : 5 runs du **même** artefact donnent **85-100** sur `/` et **80-100** sur `/jobs` (Speed Index étendu de 2 097 et 1 099 ms), donc un point n'y est pas mesurable. Coût réel, nommé et **non** corrigé : le premier rendu de `/` porte une tâche longue de **1,5-2,4 s** (×4 CPU) |
| Accessibilité | **10** | = | Lighthouse a11y **100** sur `/` et `/jobs` ; contrastes mesurés par calcul (barre, pied de page, boutons pleins, maillage) ; parcours clavier et axe en CI |
| SEO technique | **9,5** | +0,5 | 56 URL au sitemap, canonical, OG/Twitter, pré-rendu de 12 documents, maillage entrant sur les 45 pages, sonde stricte en CI **et** après déploiement |
| SEO de contenu | **5** | **+3** | 45 pages réelles (villes, métiers, guides) contre 0 ; mais elles n'ont **presque rien à montrer** : 0 mission, 0 avis, guides qui écrivent « aucun budget annoncé » |
| Internationalisation | **8** | = | **976 clés × 5 langues**, parité vérifiée par test ; relecture par des natifs toujours non faite |
| Mobile (Capacitor) | **4** | = | Non re-mesuré aujourd'hui ; la décision « re-synchroniser ou ne plus suivre les artefacts » reste ouverte |
| Paiement | **8,5** | +0,5 | Devis affiché avant checkout, séquestre, remboursement, décision de litige qui n'enregistre **que si l'argent a bougé**, KYC wallet ; mode live/test non vérifiable sans secret |
| Observabilité | **9,5** | +0,5 | `/metrics` fermé par défaut, 3 causes de refus de flux publiées séparément, sonde d'index, sonde de sauvegardes avec fraîcheur, alerte des sondes par issue |
| Tests / CI | **10** | = | **130** fichiers de tests backend (**2 046** fonctions de test, 406 classes `Test`), **73** fichiers frontend, **29** specs e2e, **54** gardes frontend (+ 19 backend/CI, **73** au total), **280** mutations au registre ; CI verte sur `main` |
| Produit / traction | **2** | = | 0 mission ouverte, 0 terminée, 0 avis, 3 travailleurs — **inchangé depuis le 24/10** |
| Confort de développement | **6,5** | +0,5 | Litiges découpés (1 269 → 863) ; restent `kojo_scheduler.py` **1 934**, `JobDetails.js` **1 236**, `index.css` **3 443**, `page-sections.js` **1 600** |

**Moyenne** : moyenne simple des **douze** domaines techniques (tout sauf
« Produit / traction ») = **8,3/10** — contre **7,9** avec les notes du 26/10 —
et **2/10 sur le marché**, qui est le seul domaine que le code ne peut pas
remonter.

---

## 4. Ce qui est solide (mesuré, pas supposé)

1. **La production est cohérente** : le HTML servi annonce `a84f69030d…` (le SHA
   de `main`), `/health` rend `healthy` + `database: connected`, et le backend
   n'a pas bougé (`eda8d65a…`) parce qu'aucun fichier `backend/**` n'a changé —
   la livraison juge ce cas comme un déploiement attendu.
2. **La latence de `/api/public/stats` a réellement baissé** : **0,48 / 0,50 /
   0,48 s** aujourd'hui contre **1,07-1,10 s** le 26/10 — les cinq compteurs
   partent ensemble. C'est la première correction de l'audit précédent dont
   l'effet se mesure en production.
3. **Le CLS est nul sur les pages publiques** et la route qui posait problème est
   désormais tenue par la mesure : `/payment` **0,0376** desktop (plafond 0,06,
   marge 1,60×), `/login` **0,0000** (plafond 0,02), mobile inchangé.
4. **45 pages de contenu réellement servies**, liées depuis l'accueil et le pied
   de page : le sitemap ne peut pas annoncer une page qui répond 404 (même
   déclaration que les routes), et une page sans lien entrant rougit.
5. **Les index de la base sont jugés tous les jours** : 81 index déclarés (relevé
du 27/10 : **80/81 conformes**, l'écart étant un index texte jugé sur sa clé),
   comparés à `list_indexes()` (clé, unicité, filtre partiel, TTL, langue du
   texte), un écart nommant les deux valeurs ; un résidu mort a été **retiré**, et
   un index texte se juge sur ses **champs** (la clé que Mongo replie rendait
   rouge un index parfait).
6. **L'argent a un seul propriétaire par mouvement** : `liberer_sequestre` pour le
   versement, `execute_paydunya_refund` pour le remboursement ; une décision de
   litige dont le paiement échoue **ne referme pas** le désaccord et remonte en
   tête de file.
7. **Un titulaire de wallet se vérifie** : le nom déclaré est comparé au nom du
   compte, et la porte est appelée par les **deux** chemins qui font sortir de
   l'argent vers un travailleur.
8. **La preuve sociale ne peut plus mentir** : seuil de 3 missions terminées et
   2 avis, état d'attente déclaré en dessous, aucun zéro publié, aucun chiffre
   figé au build.
9. **Aucune vulnérabilité npm en production** (gate CI) et **aucun secret réel**
   sur l'historique complet (passe gitleaks du 20/10 : 2 115 commits, 21 constats,
   6 valeurs distinctes, toutes déclarées).
10. **Les sauvegardes sont prouvées, pas supposées** : dump → restauration →
    comparaison d'empreintes dans le workflow quotidien, et une sonde qui juge la
    **fraîcheur** du dernier run réussi sur un palier partagé (M0).

---

## 5. Défauts restants, classés par coût

### 5.1 P0 — ce qui empêche le produit de vivre

**1. La place de marché est vide.** Mesuré aujourd'hui, à l'identique du 26/10 :
`open_jobs: 0`, `completed_jobs: 0`, `reviews: 0`, **3** travailleurs, **8**
clients, **une** mission au total. Séquestre, arbitrage, KYC, support, 45 pages
SEO : tout tourne à vide. **Coût : 100 % de la valeur potentielle.** Correctif :
[PLAN-SEMIS-OFFRE-30J.md](PLAN-SEMIS-OFFRE-30J.md) — 50 missions réelles, 32
terminées, 24 avis, et la règle des 25 % (jamais plus d'un quart des missions
ouvertes sans proposition depuis 24 h).

**2. Deux signaux de confiance contredisent toujours le produit.** Mesuré dans
[contact.json](frontend/src/config/contact.json) et dans le pied de page servi :
email **`Kojoapp98@gmail.com`**, téléphone **`+1 819 300 3507`** (indicatif
canadien, et c'est aussi le numéro WhatsApp), pour une adresse affichée
« Hamdallaye ACI 2000, Bamako, Mali ». Sur un produit qui manipule de l'argent,
c'est le premier détail qu'un client méfiant vérifie. **Coût : crédibilité, donc
conversion.** Correctif 30 min : `support@kojoforafrica.cc.cd` (domaine déjà
vérifié chez le fournisseur d'email) + un numéro local.

*L'ancien P0 de l'inscription a été corrigé le 26/10 : neuf champs sont
devenus trois. Ce qui en reste est passé en §5.2, avec sa mesure.*

### 5.2 P1 — ce qui coûte des visiteurs

**3. L'identifiant réel du marché n'est pas un chemin d'entrée.** Depuis le
26/10 (#226), l'inscription s'est allégée — **un nom, un email, un mot de
passe**, et le téléphone est redevenu **facultatif** (`UserRegister.phone:
Optional`, « un champ de contact, pas un identifiant »). C'est un bon correctif de
friction, mais il laisse la question entière : les 14 routes `/auth` sont
email-OTP, mot de passe et Google (`/auth/email/*`, `/auth/login`,
`/auth/google`, `/auth/password/*`), **aucune ne prend un numéro**. Sur un marché
où l'on s'identifie par téléphone et où WhatsApp est déjà branché (Kapso), la
porte d'entrée la plus naturelle manque encore.

**4. Les 45 pages SEO sont vides de preuves.** Elles existent, elles sont liées,
elles sont propres — et elles disent honnêtement qu'elles n'ont rien :
`/guides/prix-abidjan` répond en **11 695 o** avec un vrai tableau de **10 `<tr>`**
(**9 lignes**, une par métier du catalogue, **13 en-têtes `scope`**), et « **Aucun
budget annoncé** » y apparaît **12 fois** : aucun budget n'a été mesuré sur Abidjan. La
règle est bonne (rien n'est inventé), le résultat est une page qui rassure sans
attirer. **Ce qui la remplit, c'est le semis** (§5.1), puis les avis.

**5. L'écart de performance du matin est INSTRUIT, et il n'existait pas.** Les
notations 87 (médiane de 3 runs) contre 99 le 26/10 ne décrivaient pas la page :
elles décrivaient l'hôte. Rejoué sur l'artefact exact de `main` (`5b2e069f`),
**5 runs par route, même build, aucun rebuild entre les runs** :

| Route | scores des 5 runs | min | médiane | max | étendue | Speed Index (ms) | σ SI | LCP (ms) |
|---|---|---:|---:|---:|---:|---|---:|---|
| `/` | 95 · 93 · 85 · 100 · 99 | **85** | **95** | **100** | **15** pts | 2 983 · 3 404 · 4 119 · 2 022 · 3 039 (étendue **2 097**) | 680 | 1 375-3 275 |
| `/jobs` | 80 · 86 · 100 · 90 · 86 | **80** | **86** | **100** | **20** pts | 3 019 · 2 492 · 1 920 · 2 683 · 2 900 (étendue **1 099**) | 386 | 1 445-4 860 |

Un instrument dont l'étendue vaut 15 à 20 points ne peut pas attribuer un point :
le **−1 est retiré** (la note revient à 10), et la règle est écrite dans
[AGENTS.md](AGENTS.md) pour que la prochaine session ne la reprenne pas à
l'envers. Le seul verdict qui compte ici est celui qui juge des VALEURS nommées
(LCP, TBT, CLS, poids) : les budgets de la CI sont **verts sur 14 URL / 42 runs**.

**Ce que la passe a trouvé et qui reste ouvert, en revanche** : le premier rendu
de `/` porte une **tâche longue de 1 511 à 2 445 ms** (×4 CPU) dont le coût est du
**style/layout** (3,3-5,1 s au total), attribué au **document** lui-même (le
document pré-rendu est peint en entier), là où `/jobs` n'en a pas (185 ms, style/
layout 535 ms). Ce n'est pas le pied de page — 32 liens ne coûtent pas 800 ms de
layout — et ce n'est pas le JS (évaluation de script 267-284 ms, vendor 204-211).
C'est le levier de performance **réel** de ce dépôt : à instruire par A/B dans la
même session (`mesure-lighthouse-locale.mjs --root`, un artefact élagué contre
l'artefact de `main`), pas à corriger au jugé.

**6. L'état vide de `/jobs` était la première phrase de la page la plus
stratégique.** Honnête, et décourageant : la promesse (« soyez prévenu avant les
autres ») n'était pas dans le titre. **CORRIGÉ le 28/10/2026** : le titre devient
la clé de PAGE `premierArrivantsTitle` (« Soyez prévenu avant les autres »), le
fait n'a pas bougé d'un cran — il ouvre le paragraphe (« Aucune mission n'est
ouverte aujourd'hui. ») — et les cinq langues portent leurs deux chaînes. Aucun
chiffre, aucune mission n'est inventée : la promesse est une OPTION (alerte
email, WhatsApp), pas un stock. Trois doutes de relecture par langue ajoutés au
chantier `frontend/src/i18n/alertes-emploi-revue-native.md`.

**7. Le mobile suivi n'est pas celui qui est servi.** Non re-vérifié aujourd'hui ;
la décision (re-synchroniser les artefacts Capacitor, ou cesser de les suivre)
reste ouverte depuis le 26/10.

### 5.3 P2 — hygiène, dette, exploitation

**8. `/photo-debug` était une route de diagnostic dans le binaire client**
(propriétaire seulement, donc pas une faille) : un chunk, une entrée de
`vercel.json`, et une demi-douzaine de gardes qui la suivaient. **CORRIGÉ le
28/10/2026** : la route est retirée du routage, la DÉCLARATION du `lazy()` est
conditionnée à `import.meta.env.DEV` comme celle de `MobileTest` (un `lazy()` au
niveau module fait émettre le chunk même si la route n'est pas montée), et les
deux rewrites + l'en-tête `X-Robots-Tag` sortent de `vercel.json` (la liste des
routes privées est DÉRIVÉE du routage : elle passe de neuf à huit entrées sans
qu'aucune ne soit recopiée). `PhotoTest.js` rejoint les `@source not` de
`src/index.css`, sinon sa seule classe propre (`max-h-96`) restait générée sans
porteur livré — c'est `check-css-selecteurs-morts.js` qui l'a nommée sur
`support.html` et `terms.html`.

**9. Quatre gros fichiers :** `kojo_scheduler.py` **1 934** lignes,
`index.css` **3 443**, `page-sections.js` **1 600**, `JobDetails.js` **1 236**.
Il existe des budgets de bundle, pas de budget de taille de module.

**10. Sentry reste optionnel et invérifiable d'ici.** `SENTRY_DSN` absent = aucune
remontée ; les erreurs backend ne vivent alors que dans les journaux Fly.

**11. Les 5 langues ne sont pas relues par des natifs.** 976 clés à parité, et
rien ne dit qu'un locuteur wolof/bambara/soninké a validé les chaînes (chantier
ouvert : `frontend/src/i18n/alertes-emploi-revue-native.md`).

### 5.4 Clos le 28/10/2026, et ce qui reste ouvert AVEC sa raison

| Item | État | Preuve |
|---|---|---|
| §5.2 **5** — écart de performance | **clos** (#248, déjà sur `main`) | 5 runs sur le MÊME artefact `5b2e069f` : étendue 15 pts sur `/`, 20 sur `/jobs`. Le `−1` est retiré, la note revient à **10** ; le levier réel (1,5-2,4 s de style/layout sur le document pré-rendu de `/`) reste OUVERT et passe en §6 item 15. |
| §5.2 **6** — état vide de `/jobs` | **corrigé** | `premierArrivantsTitle` (scope de page, 5 langues) est le titre ; « Aucune mission n'est ouverte aujourd'hui. » ouvre le paragraphe. `Jobs.test.jsx` juge les deux textes. |
| §5.3 **8** — `/photo-debug` | **corrigé** | Mesuré sur le build du jour : `assets/PhotoTest-*.js` **absent**, `0` occurrence de `photo-debug` dans `build/`, `max-h-96` **plus émis** dans la feuille, aucune ligne « photo » dans `robots.txt`. `check-classes-coquilles`, `check-classes-sans-regle`, `check-css-selecteurs-morts` et `check-prerender-shells` verts. |

Ce qui reste OUVERT, et pourquoi ce n'est pas fait ici :

- **§5.2 4 — les 45 pages vides de preuves.** Ce n'est pas un défaut de code :
  `/guides/prix-abidjan` dit « aucun budget annoncé » **parce qu'aucun budget
  n'existe**, et `kojo_pages_guides` refuse d'inventer un montant (garde
  `test_guides_editoriaux` : budget absent, nul, négatif ou non numérique est
  HORS mesure, et une ville sans budget n'emprunte pas celui de sa voisine).
  Remplir ces pages par du code voudrait dire fabriquer la preuve — exactement
  ce que la règle interdit. **Le correctif est le semis (§5.1 item 1)** ; le
  levier logiciel qui reste (§6 item 7, un bouton d'alerte emploi par page
  métier × ville) capture la demande sans mentir sur l'offre.
- **§5.2 7 — le mobile Capacitor n'est pas re-vérifié.** Rien ne se mesure ici :
  il faut un artefact Capacitor à jour et un appareil. La décision (re-synchroniser
  ou cesser de suivre) reste ouverte, et rien dans ce push ne la préempte.
- **§5.3 9 — quatre gros fichiers.** Il n'existe toujours **aucun budget de
  taille de module** ; découper `kojo_scheduler.py` (1 934 lignes de planificateur,
  leases et reprises) est un chantier de 2 j qui mérite sa propre PR et ses propres
  gardes, pas une fin de lot.
- **§5.3 10 — Sentry optionnel.** C'est une DÉCISION déclarée
  (`SENTRY_SETUP_GUIDE.md`, `SENTRY_DSN` absent = aucune remontée, rien ne casse),
  pas un bug : l'item s'ouvre en « brancher Sentry », pas en « réparer ».
- **§5.3 11 — pas de relecture native.** Il faut des locuteurs. Le chantier
  `alertes-emploi-revue-native.md` en porte maintenant **27** doutes numérotés,
  chacun avec la formule à trancher.

---

## 6. Améliorations proposées — par ordre d'effet réel

Chaque proposition dit **ce que ça change**, **ce que ça coûte**, et **à quoi on
saura que ça a marché**.

### Priorité 1 — ce qui remplit la place (semaines 1-4)

| # | Amélioration | Coût | Mesure de succès |
|---|---|---|---|
| 1 | **Semis d'offres** : 12-20 missions ouvertes réelles, servies en concierge (l'outil de relance existe déjà) | temps plein | `open_jobs` ≥ 12 ; **32** terminées ; **24** avis ; règle des 25 % tenue |
| 2 | **Contact crédible** : email du domaine + numéro local/WhatsApp dans `contact.json` | 30 min | pied de page servi sans « gmail.com » ni indicatif nord-américain |
| 3 | **Connexion par téléphone** (OTP WhatsApp, Kapso déjà branché), email en secours | 3-5 j | un compte créé et connecté sans email saisi |
| 4 | **Publier une mission depuis WhatsApp** : un lien `wa.me` qui ouvre une conversation pré-remplie, et le bot crée la mission | 2-3 j | part des missions créées via WhatsApp (jalon `business_events` dédié) |

### Priorité 2 — ce qui rend les 45 pages utiles (semaines 3-8)

| # | Amélioration | Coût | Mesure de succès |
|---|---|---|---|
| 5 | **Remplir les pages ville/métier par les missions réelles** (elles listent déjà les offres ouvertes : il faut qu'il y en ait) + bloc « X missions terminées dans cette ville » dès 3 | 2 j | ≥ 3 missions liées sur les 5 plus grandes villes |
| 6 | **`AggregateRating` + avis en page ville** dès 3 avis vérifiés (le contrat « aucun faux avis » tient : la table n'accepte qu'une mission terminée) | 1 j | étoiles visibles sur ≥ 1 URL indexée |
| 7 | **« Recevoir les missions de plombier à Bamako »** : un bouton d'alerte emploi **sur chaque page métier × ville** (l'outil existe, il n'est pas exposé là) | 1 j | abonnements créés depuis les pages SEO |
| 8 | **Page « Comment Kojo protège votre argent »** : séquestre, délais, arbitrage, remboursement — l'argument différenciant n'est aujourd'hui que dans les CGU | 1 j | sortie vers `/register` mesurée |

### Priorité 3 — ce qui rend le produit agréable et crédible (mois 2-3)

| # | Amélioration | Coût | Mesure de succès |
|---|---|---|---|
| 9 | **Onboarding travailleur en un écran** (métier + ville + photo, le reste facultatif) | 2-3 j | part des profils complétés |
| 10 | **Trancher le mobile** : re-synchroniser les artefacts Capacitor, ou arrêter de les suivre | 1 j | un seul hash de bundle dans le dépôt |
| 11 | **Budget de taille de module** (comme le budget de bundle) et découpage de `kojo_scheduler.py` | 2 j | garde rouge si un module dépasse son plafond |
| 12 | **Relecture native** des 5 langues par locuteurs, avec le chantier déjà ouvert comme point d'entrée | 3-5 j | 0 « copie du français » sur les nouvelles chaînes |
| 13 | **`/photo-debug` retiré** du bundle client | 2 h | absente de `vercel.json`, de `robots.txt` et du build |
| 14 | **Mode hors-ligne des missions déjà vues** (PWA) — utile là où la connexion est facturée et instable | 2 j | liste lisible sans réseau après une visite |
| 15 | **Alléger le premier rendu de `/`** : 1,5-2,4 s de tâche longue en style/layout sur le document pré-rendu (§5.2, item 5) — A/B `--root` d'un artefact élagué avant de toucher au code | 1-2 j | Speed Index médian < 2 500 ms sur 5 runs du même artefact |

**Ce qu'il ne faut PAS faire** : ajouter des fonctionnalités avant le semis. Ouvrir
trente pages de plus, ou un second moyen de paiement, pendant que `open_jobs`
vaut 0, ne change aucune note de marché — c'est exactement ce que la règle des
25 % du plan de semis existe pour empêcher.

---

## 7. Plan 30 / 60 / 90 jours

| Horizon | Objectif | Seuil de réussite |
|---|---|---|
| **7 jours** | Contact crédible, copie de l'état vide, `/photo-debug` retiré, décision mobile | pied de page sans Gmail ; 1 seul hash de bundle |
| **30 jours** | Semis : 12-20 ouvertes ; inscription par téléphone ; alerte emploi sur les pages ville/métier | `open_jobs` ≥ 12 ; 1 parcours téléphone complet |
| **60 jours** | 32 missions terminées, 24 avis, `AggregateRating`, pages ville peuplées, page « protéger votre argent » | étoiles sur ≥ 1 URL ; 5 villes avec ≥ 3 missions |
| **90 jours** | Onboarding en un écran, découpage du planificateur, relecture native des 5 langues | profils complétés en hausse ; module < 1 200 lignes ; 0 copie du français |

---

## 8. Bilan final

**Ce que Kojo est aujourd'hui** : une place de marché de services à séquestre,
techniquement au niveau d'un produit financé — paiement protégé, litiges
arbitrés et découpés, KYC du bénéficiaire, index de base déclarés et jugés,
sauvegardes prouvées par restauration, cinq langues à parité, CLS nul, 100
d'accessibilité, zéro vulnérabilité connue, CI verte et sondes quotidiennes — avec
**onze comptes, une mission en cours, zéro mission terminée et zéro avis**.

**Ce que 48 heures ont apporté** : 45 pages qui répondent à des recherches
réelles et un maillage qui les rend découvrables (sitemap 13 → **56** URL), la
latence du compteur d'accueil divisée par deux en production (**1,07 → 0,48 s**),
le CLS de `/payment` ramené sous son plafond (0,0611 → **0,0376**) et le plafond
redescendu à 0,06, des index de base désormais créés un par un et **vérifiés tous
les jours**.

**Ce que 48 heures n'ont pas apporté** : un seul client de plus. Le déséquilibre
reste entier — l'ingénierie a encore progressé, le marché non. **Le chemin vers
10/10 ne passe pas par du code** : il passe par douze missions ouvertes ce mois-ci,
trente-deux payées, vingt-quatre avis — et par trente minutes pour remplacer une
adresse Gmail et un numéro canadien.

**Note d'ensemble** : **8,3/10 technique, 2/10 marché** (contre 7,9 / 2 avec les
notes du 26/10, moyenne calculée de la même façon) ; **SEO de contenu 2 → 5** est
le seul mouvement de fond, et il est structurel : la capacité d'absorber le
trafic existe maintenant.
