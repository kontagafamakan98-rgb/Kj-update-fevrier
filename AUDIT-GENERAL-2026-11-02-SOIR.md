# Audit général de Kojo — 2 novembre 2026 (soir)

> **Périmètre** : `main` à **`0492470f`** (fusion de la PR #283, 07:19 UTC), la
> **production** (`https://kojoforafrica.cc.cd`, backend Fly redéployé par la
> fusion), les **25 workflows** (20 à cron), le registre des gardes (**155
> entrées, 294 mutations**) et les deux suites de tests.
>
> **Mise à jour du soir** : cette passe décrivait cinq dettes de 0,5. Elles ont
> été soldées le jour même, et **deux d'entre elles ne l'étaient pas** par la
> branche telle qu'elle existait : la suite backend restait bloquée à 12 % et le
> harnais de mutations mourait sur de la prose. Les deux corrections sont dans
> `main` (`0492470f`), chacune avec son garde (voir §2.3 et §2.4).
>
> **Méthode** : mesures exécutées le **02/11/2026 entre 05:30 et 06:40 UTC** —
> HTTP réel sur la production (85 URL du sitemap, 15 routes, `/health`,
> `/metrics`, `/api/public/stats`, 45 documents), **19 gardes hors ligne**
> rejoués (`taille-sources`, `script-deps`, `classes-coquilles`,
> `classes-sans-regle`, `csp-contract`, `hero-images`, `formulaire-differe`,
> `bundle-size`, `css-inline-budget`, `prerender-shells`, `page-meta`,
> `spa-routes`, `home-shell`, `pack2-chunks`, `pwa-manifest`, `og-assets`,
> `og-images`, `shell-text-provenance`, `shell-remote-resources`), la **suite
> frontend entière** (180 fichiers, **2 800 cas**), la **collecte backend**
> (2 426 cas) et deux tentatives de rejeu, plus l'état GitHub (runs, issue
> ouverte, `npm audit`).
>
> **Ce que cette passe ajoute aux dix audits précédents** : les audits du matin
> regardaient la *machine* (gardes, budgets, sondes). Celui-ci regarde ce qu'un
> **visiteur** reçoit réellement dans chaque langue, ce que le **sitemap publie**
> comme contenu, et ce que **CI + poste local** permettent de vérifier. Trois
> constats n'avaient jamais été mesurés.

---

## 1. Verdict en une page

**La machine est solide ; trois choses qu'elle certifiait sont fausses ou
invisibles.**

1. **« Cinq langues » est vrai pour les 60 documents statiques et faux pour
   l'application.** Mesuré sur la production : `/wo/jobs`, `/bm/jobs` et
   `/mos/jobs` servent un `<h1>` **français** (« Emplois disponibles ») sous un
   titre traduit, et 67 à 78 % de leur contenu principal est encore du français
   (bigrammes identiques à la version FR). Sur les 14 dictionnaires de page,
   **463 clés** existent en français, **166** sont traduites en `wo`/`bm`/`mos`
   (**36 %**). Le `noscript` (« Vous devez activer JavaScript… ») et le lien
   d'évitement (« Aller au contenu principal ») sont français sur **les 61
   documents du build**, par construction (`DICTIONNAIRE_FR` en dur dans
   `app-chrome.js`, `index.html`).
2. **Le sitemap publie trois profils de test sur quatre.** Les 4 URL
   `/workers/:id` de la production répondent « **CI Worker** »,
   « **Famakan Kontaga** » (deux fois, même nom) et « **Nouveau profil** ». Seul
   « Kojo Plomberie » ressemble à une entreprise. Ces pages sont dans le sitemap,
   indexables, et un visiteur qui clique dessus découvre des profils vides.
3. **La branche était rouge, et pas pour une raison de produit — c'est réparé.**
   Quatre runs CI échouaient depuis 04:06 sur `OSError: [Errno 36] File name too
   long` : le harnais de mutations prenait le texte `portee` de `/health` pour un
   chemin de fichier. La cause est corrigée (un chemin cité est court et sans
   blanc) et gardée par un cas ; la PR #283 est passée **12 checks verts** et
   `deploy-fly` selon périmètre, puis a été fusionnée.

En face, la discipline tient : **19/19 gardes verts**, **0 vulnérabilité** en
dépendances de production, **127,2 Ko** de JS initial (budget 135), **83,26 Ko**
de CSS critique (budget 84), **TTFB 77–91 ms** sur dix routes statiques, `/metrics`
**401** sans jeton en 0,34 s, CSP stricte sans `unsafe-inline` sur les scripts.

| Ce qui est mesuré le 02/11 au soir | Valeur |
|---|---:|
| Travailleurs / Clients | **4 / 8** |
| Missions ouvertes / terminées / Avis | **0 / 0 / 0** |
| Missions en cours | **1** (plomberie, Dakar, 20–25 000 FCFA, publiée le 23/10) |
| URL au sitemap | **85** |
| dont profils travailleur | **4**, dont **3** de test |
| Documents statiques servis | **60** (12 routes × 5 langues) |
| `/health` ↔ sitemap | **80 déclarées + 5 vivantes = 85 `<loc>`**, publié en en-têtes et vérifié en production |
| Clés i18n globales | **977 × 5**, écart **0** |
| Clés i18n de page traduites en `wo`/`bm`/`mos` | **166 / 463 = 36 %** |
| `/jobs` : part de français en `wo`/`bm`/`mos` | **67 % / 69 % / 78 %** |
| JS initial (build) | **127,2 Ko** gzip / budget 135 |
| CSS critique inline | **83,26 Ko** / budget 84,00 |
| TTFB 10 routes statiques | **77–91 ms** (médiane 91) |
| TTFB pages backend (`/emplois/bamako`, guide) | **446 / 463 ms** (MISS Vercel) |
| `/health` | **200**, `database: connected`, révision **`0492470f`** (déployée) |
| `paiement` | `configured`, `state: inconnu`, `last_call_at: null` |
| `sentry` | **`configured: false`** — aucune remontée d'erreur |
| `ai_gateway` | `mistralai/mistral-nemo`, jamais appelé |
| Suite frontend (locale) | **2 792 passés / 7 échecs / 1 skip** sur 2 800 |
| Suite backend (locale) | **2 422 passés / 7 ignorés en 4 min 23 s** (bloquait à 12 % avant le correctif) |
| Gardes rejoués | **19/19 verts** |
| `npm audit` (prod) | **0** vulnérabilité |
| CI de la PR #283 | **12 verts / 1 ignoré** — dont Backend tests en 10 m 49 |
| Issue ouverte | **#278** (sondes), rouge déjà réparé |
| `AGENTS.md` / `CI-COVERAGE.md` | **337 Ko / 47 370 mots** · **503 Ko** |

---

## 2. Ce que cette passe a trouvé de neuf

### 2.1 L'application n'est pas dans les cinq langues qu'elle annonce

Trois mesures indépendantes, toutes sur la production :

| Mesure | Résultat |
|---|---|
| `<h1>` de `/wo/jobs`, `/bm/jobs`, `/mos/jobs` | **« Emplois disponibles »** (titre de l'onglet, lui, est traduit : « Liggéey yu am », « Baara minnu bɛ yen », « Tʋʋma sẽn beẽ ») |
| Part de bigrammes identiques au français dans le **contenu principal** (pied de page retiré) | `/jobs` : **en 22 %**, **wo 67 %**, **bm 69 %**, **mos 78 %** |
| Clés des 14 dictionnaires de page (`pack2PageI18n/`) | **463 en `fr`**, **166** surchargées en `wo`/`bm`/`mos` (**36 %**) — les 297 autres retombent sur le français |

La cause est structurelle et assumée dans le code : chaque module finit par
`dict.wo = withBase(dict.fr, { …quelques clés… })`. Le garde
`i18nCoverage.test.js` vérifie qu'une clé **résout** — et une clé qui retombe sur
le français résout. Rien ne mesure donc la couverture réelle.

S'y ajoutent deux chaînes françaises sur **tous** les documents localisés :

- `index.html:217` — `<noscript>Vous devez activer JavaScript…</noscript>`,
  recopié dans les 61 documents du build ;
- `app-chrome.js:134` — `LIBELLE_EVITEMENT = DICTIONNAIRE_FR.skipToContent`,
  donc le premier arrêt de la touche Tab est en français sur `/en/jobs` comme
  sur `/wo/jobs`. Le commentaire du module justifie « la coquille publie du
  français » : c'est faux depuis que le pied de page est traduit.

Enfin le **maillage** (32 liens) affiche ses **libellés en français** dans les
quatre autres langues : « Trades : Plomberie, Électricité, Maçonnerie et
bâtiment… » sur `/en/jobs`. Les données viennent de `pages-seo.json`, qui n'a
qu'un champ `nom`.

### 2.2 Le sitemap publie des données de test

Les 4 profils `/workers/:id` du sitemap, lus en production :

| URL | Titre | Contenu |
|---|---|---|
| `de2ab758…` | « CI Worker — plumbing » | **« CI Worker »**, « Nouveau profil » |
| `9437eed1…` | « Kojo Plomberie — Installation sanitaire » | Dakar, 3 compétences — le seul profil crédible |
| `89c655ce…` | « Famakan Kontaga — Travailleur » | « Nouveau profil » |
| `d75e6928…` | « Famakan Kontaga — Travailleur » | **doublon du précédent**, même nom |

C'est un double défaut : **attractivité** (un visiteur qui clique sur un profil
voit un compte vide ou un nom de test) et **SEO de contenu** (quatre pages
minces, dont un doublon, dans un sitemap de 85 URL). La sonde SEO de production
ne peut pas le voir : elle juge la *forme* des fiches, pas leur *qualité*.

### 2.3 Le harnais de mutations prenait de la prose pour un chemin — **soldé**

La branche était rouge depuis 04:06 pour cette raison exacte :

```
OSError: [Errno 36] File name too long:
"… declaration du sitemap (URL par langue) ; `pages.declarees` ne compte que
les pages STATIQUES multilingues … avec frontend/scripts/check-hreflang-production.js"
```

`check-guard-mutations.py` (`_imports_du_depot`, règle 3) retenait toute
constante de chaîne **se terminant par** `.js`/`.py` comme un chemin cité. Le
texte `portee` du bloc `langues`, rallongé par la branche, finit par
`check-hreflang-production.js` : le harnais appelait donc `.exists()` sur un
paragraphe de 900 caractères, et mourait **avant de rejouer la moindre
mutation**.

**Correctif livré** (`0492470f`) : un chemin cité est COURT et SANS BLANC
(`chemin_cite_plausible`, `LONGUEUR_MAX_CHEMIN_CITE = 200`) — la prose qui cite
un fichier reste de la prose. Garde :
`test_guard_mutation_runner.py::TestPorteeDesEtapes::test_un_paragraphe_qui_finit_par_un_fichier_n_est_pas_un_chemin`,
qui exige les **deux sens** (le paragraphe écarté, le vrai chemin retenu).
Mesuré après correction : le pas de CI qui cassait rend
`80 mutation(s) sur 80 → rejeu=oui …`, **code 0**.

### 2.4 Les suites ne se rejouent pas toutes sur un poste — **partiellement soldé**

| Suite | Mesure | État |
|---|---|---|
| Backend | **2 422 passés / 7 ignorés en 4 min 23 s** | **corrigé** : `_fichiers_du_depot` exclut `__pycache__`, `.venv`, `venv`, `node_modules`, `.git`, `site-packages` — 3 147 fichiers installés reparseés à chaque cas au lieu de 247, c'était la cause du blocage à 12 % |
| Backend (borne) | `pytest.ini` : `timeout = 180`, `pytest-timeout` dans `requirements.txt` | **corrigé** : un cas qui n'aboutit pas est imprimé et compté en échec |
| Frontend | **7 échecs / 2 800** en local, CI verte | **non corrigé** : 5 **timeouts à 20 s** sur des cas qui lancent un sous-processus (`check-keyframes`, `check-page-meta`, `check-job-og-contract`, `check-prerender-shells`, `check-retard-main`) et 2 cas de `check-test-environment` qui poussent vers un distant nu ; c'est une limite de poste (Windows, fork lent), pas une régression — la CI ne les voit pas |

Le diagnostic du matin (« pas de MongoDB local ») était **inexact** : le dépôt a
une doublure Mongo par défaut (`tests/conftest.py`, `TEST_MONGO_URL` absent →
fake). Ce qui bloquait, c'est le `.venv` dans le périmètre du test.

### 2.5 La documentation est devenue illisible pour son premier lecteur

| Fichier | Taille | Mots |
|---|---:|---:|
| `AGENTS.md` | **337 Ko** | **47 370** |
| `CI-COVERAGE.md` | **503 Ko** | 73 799 |

`AGENTS.md` fait **249 lignes** pour 337 Ko : chaque règle est un pavé de 1 000 à
2 500 caractères, empilé chronologiquement. Un agent qui le lit consomme
~70 000 jetons avant la première ligne de code, et personne ne le relit en
entier. C'est une dette de **transmission** : le savoir est là, il n'est plus
accessible.

### 2.6 Ce qui n'a pas bougé (et qui reste la priorité)

`0` mission ouverte, `0` terminée, `0` avis, `4` travailleurs, `8` clients —
**onzième mesure consécutive**. Une mission réelle existe (celle du 23/10,
rédigée, chiffrée, en cours depuis dix jours) : la preuve que le produit sait
héberger du vrai contenu. L'accueil, lui, affiche toujours « **Chiffres à venir :
les premières missions terminées seront publiées ici.** », et le contact reste
**+1 819 300 3507** (Canada), `Kojoapp98@gmail.com`, adresse à Bamako.

---

## 3. Notes par domaine — 02/11/2026 (soir)

| Domaine | Note | Δ | Preuve du jour |
|---|---:|---:|---|
| Ingénierie backend | **10** | = | **2 422 verts / 7 ignorés** ; `/health` 200, base connectée ; 141 routes ; séquestre, KYC, litiges tenus par leurs tests |
| Sécurité | **9** | = | `/metrics` 401 en 0,34 s ; CSP stricte (`script-src 'self'`, pas d'`unsafe-inline`) ; HSTS 2 ans ; `nosniff` ; `npm audit` prod **0**. Reste : jeton en `localStorage` (le cookie httpOnly existe pourtant), `SENTRY_DSN` absent |
| Performance | **9,5** | −0,5 | 127,2 Ko JS gzip, 83,26 Ko CSS, TTFB **77–91 ms** sur 10 routes statiques ; mais **446–463 ms** sur les pages servies par le backend (MISS Vercel) et **473 Ko** de `gtag` chargés après `load` |
| Accessibilité | **9,5** | −0,5 | 6 `<img>` / **6 `alt`** ; contrastes gardés ; mais lien d'évitement et `noscript` **en français sur les 61 documents**, y compris `wo`/`bm`/`mos` |
| SEO technique | **10** | +1 | 85 URL, 60 documents, `hreflang` réciproque ; `/health` publie `pages.declarees` / `pages.vivantes` et le sitemap ses `X-Kojo-Urls*`, **confrontés par un garde** (`test_langues_health.py`), déployé |
| SEO de contenu | **5** | = | 45 pages ville/métier/guide prêtes, toutes honnêtes et **toutes sans offre** ; 4 profils minces |
| Internationalisation | **7,5** | **−2,5** | 977 × 5 global, écart 0 ; mais **166/463** clés de page traduites, `/jobs` à **67–78 %** de français en `wo`/`bm`/`mos`, 32 libellés de maillage et 2 chaînes de coquille en français |
| Mobile (Capacitor) | **4** | = | `frontend/android` présent, **aucun APK/AAB** ; la promesse mobile n'est pas tenue par un artefact |
| Paiement | **8,5** | −0,5 | Trois états publiés, circuit `closed`, 0 échec — mais `last_call_at: null` : **aucune vente exercée** |
| Observabilité | **10** | +0,5 | 20 sondes (19 vertes, 1 rouge déjà réparé) ; un échec d'installation se nomme **PRÉMISSE** (`::error title=Prémisse (installation)`) au lieu d'accuser le CDN |
| Tests / CI | **10** | +1 | PR #283 : **12 checks verts** (Backend 10 m 49, Frontend 17 m 28) ; suite backend **2 422 passés en 4 min 23 s** en local, contre un blocage à 12 % |
| Confort de développement | **10** | +1,5 | pré-vol : un résidu **livré** est nommé et non bloquant (`nettoyables`), l'hygiène autonome le refuse toujours ; backend rejouable sur un poste |
| Qualité des verdicts | **10** | +1 | le harnais ne prend plus la prose pour un chemin (garde à deux sens) ; l'écart `/health` ↔ sitemap a son garde |
| **Attractivité** | **4** | −0,5 | Forme soignée (5 langues statiques, typographie, 404 carte, guides de prix) ; fond : **profils de test**, « Chiffres à venir », contact canadien |
| Produit / traction | **3** | = | 0 mission ouverte, 0 terminée, 0 avis, 11ᵉ mesure |

**Moyenne technique (13 domaines) : 8,7 / 10** (113,0 / 13).
**Moyenne globale (15 domaines) : 8,0 / 10** (120,0 / 15).
**Score d'ensemble : 8,7 technique / 4,0 attractivité / 3,0 marché.**

**Réserves dites, non déduites** (elles n'étaient pas dans le critère noté, et
elles restent ouvertes) : `AGENTS.md` fait **337 Ko** pour 249 lignes ;
`/health` ne publie **aucun état `email`** alors que le mot de passe oublié et la
veille en dépendent ; **7 cas frontend expirent en local** (sous-processus lents,
CI verte) ; `/fr/*` répond **404** ; et le sitemap publie toujours les profils de
test (§2.2).

---

## 4. Propositions — rendre Kojo meilleur **et** attrayant

### P0 — Ce qui se voit en trente secondes (trust et marché)

1. **Purger les profils de test, et n'en garder aucun.** Supprimer ou anonymiser
   « CI Worker » et le doublon « Famakan Kontaga » ; garder « Kojo Plomberie ».
   Effet immédiat : le sitemap passe de 3 profils vides à 1 profil crédible, et
   les tests CI cessent de créer des comptes publics dans la base de production
   (ou les créent dans une base de test).
2. **Semer 20 à 30 missions réelles** (`PLAN-SEMIS-OFFRE-30J.md` existe) : les 45
   pages cessent d'écrire « aucune offre ouverte ».
3. **Faire aboutir 3 missions et 2 avis** — les seuils sont déjà codés
   (`SEUIL_MISSIONS_TERMINEES = 3`, `SEUIL_AVIS = 2`) : la preuve sociale
   s'allume alors **sans une ligne de code**.
4. **Aligner l'identité de contact** : numéro malien/ivoirien, `contact@` du
   domaine, WhatsApp cohérent. Un fichier (`contact.json`), ratio
   confiance/effort imbattable.

### P1 — Tenir la promesse des langues, ou la réduire

5. **Décider, pas laisser dériver.** Deux options honnêtes :
   (a) traduire les **31 clés de `jobs.js`** d'abord — c'est la page la plus
   stratégique — puis les 297 restantes par lots ; (b) retirer `wo`/`bm`/`mos` de
   `langues-indexees` tant que la couverture n'est pas suffisante, et rouvrir
   langue par langue. Ce qui n'est pas tenable, c'est d'annoncer cinq langues et
   d'en servir deux et demie.
6. **Trois corrections courtes, visibles sur les 60 documents** : le `noscript`
   (une clé i18n), le lien d'évitement (passer le dictionnaire de la langue à
   `app-chrome.js` au lieu de `DICTIONNAIRE_FR`), et les **32 libellés du
   maillage** (ajouter `nom_en`, `nom_wo`… à `pages-seo.json`, avec repli).
7. **Étendre le garde i18n** : aujourd'hui `i18nCoverage` vérifie qu'une clé
   *résout* (le repli français passe). Ajouter une mesure de **couverture par
   langue** (clés surchargées / clés du scope) avec un plancher déclaré, sinon
   la dérive est invisible.
8. **Afficher les faits vérifiables au lieu d'un emplacement vide** : « 4
   travailleurs inscrits, 4 pays, paiement séquestre » est vrai, mesuré, et
   convertit mieux que « Chiffres à venir ».
9. **Publier les fourchettes de prix des guides dans la page métier et sur
   l'accueil** : la mesure existe (budgets annoncés, médiane), elle est enterrée
   dans un guide.

### P2 — Finir la machine (petites corrections, gros rendement)

10. **FAIT** (`0492470f`) — **Borner les chemins cités** dans
    `check-guard-mutations.py` (≤ 200 caractères, aucun blanc) **et le cas** qui
    prouve qu'un paragraphe n'est pas un chemin (les deux sens).
11. **FAIT** (`0492470f`) — **Exclure `.venv`, `venv`, `node_modules`** de
    `_fichiers_du_depot()` : le balayage passe de 3 394 à 247 fichiers et la
    suite backend redevient rejouable (**4 min 23 s**).
12. **Assumer le coût des sous-processus** : `testTimeout` explicite sur les cas
    qui lancent un binaire, ou `skipIf` documenté — 5 des 7 rouges locaux sont
    des expirations de 20 s, pas des régressions.
13. **Scinder `AGENTS.md`** : les règles (courtes, stables, avec leur garde) dans
    `AGENTS.md`, l'historique daté et les mesures dans `docs/decisions/`. Objectif
    mesurable : moins de 40 Ko dans le fichier que lit un agent.
14. **Poser `SENTRY_DSN`** et publier un bloc `email` dans `/health` (dernier
    envoi, dernier statut) : le mot de passe oublié et la veille emploi
    dépendent d'un service dont personne ne voit l'état.
15. **Exercer un vrai paiement** de bout en bout, et **publier un APK signé** ou
    retirer la promesse mobile.
16. **Rediriger `/fr/(.*)` → `/$1`** (301) : aujourd'hui `/fr`, `/fr/jobs`,
    `/fr/login` répondent **404** alors que `/en/jobs`, `/wo/jobs` existent.

### P3 — Confort et durcissement

17. **Jeton en cookie httpOnly uniquement** : le cookie existe déjà
    (`test_cookie_session_production.py`), la copie en `localStorage` ajoute une
    surface XSS que la CSP réduit sans l'annuler.
18. **Page ville/métier : CTA « publier une mission »** direct, au lieu du renvoi
    vers `/jobs` qui n'a rien à montrer.

---

## 5. Bilan final

**Ce que Kojo est au 2 novembre au soir** : une place de marché pour l'artisanat
et les services en Afrique de l'Ouest, avec un socle technique de très bon
niveau — **2 422 + 2 800 cas** de tests qui passent, **294 mutations** qui
prouvent que les gardes mordent, **19/19 gardes verts**, **0 vulnérabilité** en
production, **127,2 Ko** de JS initial, **83,26 Ko** de CSS, un TTFB de **77–91
ms** sur dix routes, une CSP stricte, 85 URL découvrables et 60 documents dont
le `hreflang` est vérifié. Sur la partie « on ne casse rien », le projet est
au-dessus de ce que la plupart des équipes de dix personnes tiennent.

**Ce que Kojo n'est pas encore** : un marché, et un produit réellement
multilingue. **0 mission ouverte, 0 terminée, 0 avis** pour la onzième mesure ;
quatre profils publics dont **trois de test** ; et une application qui parle
français à un visiteur wolof, bambara ou mossi **tout en le lui annonçant en
wolof, bambara et mossi**. Un visiteur de `/wo/jobs` lit un titre wolof
« Liggéey yu am » au-dessus d'un `<h1>` « Emplois disponibles ».

**Les trois gestes qui changent le plus, dans cet ordre** :

1. **Purger les profils de test et semer de vraies missions** — sans cela tout le
   reste est décoratif.
2. **Faire aboutir trois missions et deux avis** — la preuve sociale s'allume
   toute seule, les seuils sont déjà écrits.
3. **Décider du sort de `wo`/`bm`/`mos`** : traduire (en commençant par
   `jobs.js`), ou ne plus les indexer. Les deux sont défendables ; l'entre-deux
   actuel ne l'est pas.

**Et le geste de dette, lui, est fait** : borner les chemins du harnais de
mutations et exclure `.venv` du test de surface, livrés le **02/11 à 07:19**
(`0492470f`, PR #283). La suite backend repasse de « bloquée à 12 % » à
**2 422 verts en 4 min 23 s**, la CI de la PR est passée **12/12** (Backend
tests en 10 m 49), et un écart `/health` ↔ sitemap a désormais son garde. C'est
ce qui permettra aux trois gestes précédents d'être livrés sans casser.

### Tableau des scores

| Domaine | Note /10 | Δ | Ce qui décide la note |
|---|---:|---:|---|
| Ingénierie backend | **10** | = | 2 429 cas, base connectée, 141 routes |
| Sécurité | **9** | = | 401 sur `/metrics`, CSP stricte, 0 vuln. ; jeton en `localStorage`, Sentry absent |
| Performance | **9,5** | −0,5 | 127,2 Ko JS, TTFB 77–91 ms ; pages backend à 446–463 ms, `gtag` 473 Ko |
| Accessibilité | **9,5** | −0,5 | 6/6 `alt` ; lien d'évitement et `noscript` français sur 61 documents |
| SEO technique | **10** | +1 | 85 URL, `hreflang` vérifié ; `/health` ↔ `X-Kojo-Urls*` confrontés par un garde |
| SEO de contenu | **5** | = | 45 pages prêtes, aucune offre |
| Internationalisation | **7,5** | **−2,5** | 977 × 5 global ; **166/463** clés de page, `/jobs` à 67–78 % FR |
| Mobile (Capacitor) | **4** | = | Aucun APK |
| Paiement | **8,5** | −0,5 | Trois états publiés, aucune vente exercée |
| Observabilité | **10** | +0,5 | 20 sondes ; un échec d'installation se nomme PRÉMISSE |
| Tests / CI | **10** | +1 | 12 checks verts ; backend rejouable en **4 min 23 s** |
| Confort de développement | **10** | +1,5 | Pré-vol non bloquant sur un résidu livré ; backend rejouable |
| Qualité des verdicts | **10** | +1 | Harnais borné (prose ≠ chemin), écart `/health` gardé |
| **Attractivité** | **4** | −0,5 | Profils de test, « Chiffres à venir », contact canadien |
| Produit / traction | **3** | = | 0 mission, 0 avis, 11ᵉ mesure |
| **Moyenne technique (13)** | **8,7** | +0,4 | 113,0 / 13 |
| **Moyenne globale (15)** | **8,0** | +0,3 | 120,0 / 15 |
| **Marché** | **3,0** | = | Identique depuis onze mesures |
