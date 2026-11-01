# Audit général de Kojo — 1er novembre 2026, soirée

> **Périmètre** : `main` à **`64d112c5`**, la production
> (`https://kojoforafrica.cc.cd` sur Vercel, `https://api.kojoforafrica.cc.cd`
> sur Fly.io, révision backend **`ff6e0856`** — inchangée depuis 09:24, les trois
> PR du jour n'ont pas touché `backend/**`), les **25 workflows** (dont **20** à
> cron), les **293 mutations** déclarées au registre des gardes, et les deux
> suites de tests.
>
> **Méthode** : mesures **exécutées le 01/11 entre 12:00 et 12:50 UTC**, après
> la troisième livraison du jour — suite backend entière (`pytest` :
> **2 401 verts, 7 sautés, 0 rouge** en 12 min 12 s), suite frontend entière
> (`vitest run` : 180 fichiers, **2 781 cas**, 10 rouges **de charge** rejoués
> **235/235 verts en isolation**), **build complet** (1 min 51 s) puis **sept
> gardes** rejoués (`taille-sources`, `script-deps`, `classes-coquilles`,
> `csp-contract`, `bundle-size`, `css-inline-budget`, `prerender-shells`),
> **HTTP réel** sur la production (`/health`, `/metrics`, `/api/public/stats`,
> sitemap, sept documents, JS initial gzip), et **cinq sondes de production
> jouées à la main** : SEO stricte sur les **cinq passes** (84 pages), `hreflang`
> (60 documents), typographie (46 pages + 4 polices), CDN lente (12 routes,
> 48 navigations).
>
> **Limites déclarées** : **Lighthouse n'a pas été relancé** (les budgets sont
> ceux de la CI, verte sur `64d112c5`) ; l'**accessibilité** n'est pas
> re-mesurée ce soir (portée par la CI verte : axe, moteurs de gestes, clavier) ;
> les parcours **authentifiés** ne sont pas rejoués hors sondes ; les binaires
> **Capacitor** ne sont ni reconstruits ni installés ; le jeton `/metrics` n'est
> pas sur cette machine ; le **balayage planifié du 01/11 n'avait pas encore eu
> lieu** à l'heure de l'audit (crons déclarés 06:17–07:48, exécutés ces jours-ci
> entre **12:29 et 13:55 UTC** — les 18 verdicts cités sont ceux du **31/10**).

---

## 1. Verdict en une page

**La machine de mesure est finie ; le marché ne l'est pas, et il n'a pas bougé
depuis neuf jours.** Ce soir, Kojo juge **84 pages sur 84** en cinq passes au
lieu de vingt par passe (`20 → 84`, angle mort fermé), il sert **cinq langues**
avec un `hreflang` réciproque vérifié en production, et il porte **2 401 + 2 781
cas verts** avec **293 mutations** rejouables. En face, la même mesure dit
**4 travailleurs, 8 clients, 0 mission ouverte, 0 mission terminée, 0 avis** —
et donc une bande de preuve sociale qui affiche « chiffres à venir » parce que
c'est la vérité (seuils codés : 3 missions terminées, 2 avis).

| Ce qui est mesuré le 01/11 au soir | Valeur | 01/11 matin |
|---|---:|---:|
| Travailleurs | **4** | 4 |
| Clients | **8** | 8 |
| Missions ouvertes | **0** | 0 |
| Missions terminées / Avis | **0 / 0** | 0 / 0 |
| Pays couverts | **4** | 4 |
| Veilles emploi | **1** (`origine=metier`, 31/10 11:14) | 1 |
| URL au sitemap | **85** (30 747 o), dont **210 `xhtml:link`**, **35 `x-default`** | 85 / 210 / 35 |
| **Pages jugées par la sonde SEO stricte** | **84 / 84 en 5 passes**, 0 défaut, 0 prémisse | **20 / 84**, 64 nommées hors plafond |
| Documents par langue servis | **60** (12 routes × 5), `lang` + `canonical` + alternatives | 60 |
| `/health` | **200** en 1 138 ms (premier appel), `database: connected`, révision **`ff6e0856`** | 200 en 1 250 ms |
| `paydunya_circuit` | **`closed`**, 0 échec | `closed` |
| `paiement` | **`configured: true`, `state: inconnu`** — aucune vente exercée | `inconnu` |
| `sentry` | **`configured: false`, `state: inactif`** — `SENTRY_DSN` absent | `inactif` |
| `ai_gateway` | `mistralai/mistral-nemo`, **`inconnu`** | `inconnu` |
| `/metrics` sans jeton | **401** en 100 ms | 401 |
| JS initial servi (gzip) | **131 275 o = 128,2 Ko** sur `/` (6 fichiers) ; **135,9 Ko** sur `/jobs` | 128,1 Ko |
| JS initial au build (garde) | **127,1 Ko** / budget 135 ; total **10,87 Mo** / 11,20 | 127,1 |
| Plus gros module hors critique | **47,5 Ko** (vendor-leaflet) / plafond 56 | 47,5 |
| CSS critique inlinée | **83,26 Ko**, 1 139 règles (budget 84,00) ; 404 : 1,43 Ko | 83,26 Ko |
| HTML servi `/` / `/jobs` / `/en/jobs` / `/wo/jobs` | **140 863 / 110 344 / 110 112 / 110 134 o** | 140 863 / 110 344 / 110 112 / 110 134 |
| Page backend `/emplois/bamako` / `/metiers/plomberie` / `/guides/prix-bamako` | **11 497 / 10 761 / 14 498 o, 0 octet de JS** | 11 497 / — / — |
| TTFB / LCP production (12 routes) | **213–303 ms / 420–1 312 ms** (pire médiane : `/jobs`, 1 312 ms ; max 2 216 ms) | 215–231 / 516–912 |
| CI sur `main` | **verte** (`64d112c5`) | verte (`bd63c430`) |
| Sondes planifiées | **18 / 18 vertes** (31/10) | 18 / 18 |
| Tests backend | **2 401 ✓ / 7 sautés / 0 rouge** en 12 min 12 s | 2 401 |
| Tests frontend | **2 781 cas** : 2 770 ✓, 1 sauté, **10 rouges de charge → 235/235 verts en isolation** | 2 768, 7 de charge |
| Mutations déclarées | **293** | 292 |
| Clés i18n | **976 × 5 langues**, 5 indexées | 976 × 5 |
| Sources | **281 fichiers / 82 496 lignes**, 8 dérogations datées | idem |

**Lecture** : la couche « machine » a encore gagné aujourd'hui — un angle mort
de couverture fermé, une prémisse distinguée d'une absence, cinq langues
prouvées sur l'origine. La couche « marché » est identique à la veille, et à il
y a neuf jours. Le verdict de cet audit n'est donc pas technique : **Kojo sait
mesurer ce qu'il sert ; il n'a rien à servir.**

---

## 2. Ce que la journée du 01/11 a changé

**Trois livraisons** sur `main`, toutes mesurées après déploiement.

| Livraison | Ce qu'elle apporte | Preuve du soir |
|---|---|---|
| #274 `ff6e0856` | **Cinq langues indexées** (`fr`, `en`, `wo`, `bm`, `mos`) : 60 documents pré-rendus dans leur langue, rewrites Vercel, schedule par la même déclaration, `x-default` ; **plafond des sources** (281 fichiers / 82 496 lignes) | sonde `hreflang` : **60/60 conformes**, 85 entrées de sitemap, 61 requêtes en **11,1 s** |
| #275 `bd63c430` | La sonde SEO **sépare la prémisse de l'absence** : une page demandée deux fois, une erreur de transport persistante sort en **2** (`::warning` nommée) au lieu d'accuser le sitemap | `main` repassée verte ; le faux rouge du matin ne peut plus se reproduire (3 cas de test) |
| #276 `64d112c5` | La fenêtre de `MAX_PAGES` **tourne** : **84 pages → 5 passes**, graine `GITHUB_RUN_NUMBER`, et le verdict **nomme les pages qu'il n'a pas jugées** | **5 passes jouées à la main : 20/84 conformes chacune, 0 défaut → 84/84** ; la passe 5 boucle proprement (81..84 + 1..16) |

**Effet mesuré sur les notes** : **SEO technique** passe de « 10 sur promesse »
à « 10 sur couverture » (+0 de note, +1 de preuve : plus aucune page indexée
n'est hors de portée d'une sonde). **Qualité des verdicts** gagne l'aveu
explicite de ce qui n'est pas jugé mais **perd 0,5** : la suite frontend a rendu
**10 rouges de charge** ce soir (contre 7 ce matin) — ils repassent tous en
isolation, donc ce n'est pas une régression, mais c'est une fragilité mesurée
d'une suite qui lance de vrais sous-processus `git`/`node`.

---

## 3. Notes par domaine — 01/11/2026 au soir

Notes sur 10, justifiées par la mesure. Une note basse n'est pas un jugement sur
le travail : c'est l'écart entre ce qui est construit et ce qui est **mesuré en
production**.

| Domaine | Note | Δ matin | Preuve du soir |
|---|---:|---:|---|
| Ingénierie backend | **10** | = | 136 fichiers de tests, **2 401 verts, 7 sautés, 0 rouge** en une passe ; `/health` 200, `database: connected` ; séquestre, litiges, KYC, index, sauvegardes prouvés |
| Sécurité | **9** | = | `/metrics` **401** sans jeton ; CSP sans joker, HSTS, `nosniff`, `X-Frame-Options: DENY` ; gitleaks bloquant ; aucun secret dans le HTML servi. Reste : `SENTRY_DSN` absent, donc aucune remontée d'erreur — la sécurité n'y perd rien, l'exploitation si |
| Performance | **10** | = | JS initial **127,1 Ko** au build (budget 135) / **128,2 Ko** servi ; plus gros module **47,5 Ko** (plafond 56) ; CSS critique **83,26 Ko** pour 84,00 ; **TTFB 213–303 ms**, **LCP 420–1 312 ms** sur 12 routes, verdict CDN **conforme** (plafonds 1 500 / 4 000 ms) |
| Accessibilité | **10** | = | **Non re-mesurée ce soir** — portée par la CI verte (axe + moteurs de gestes + clavier). Limite écrite, comme les deux dernières fois |
| SEO technique | **10** | = (preuve +1) | **85 URL**, `canonical` par langue, **210 `xhtml:link`**, **35 `x-default`** ; **84/84 pages jugées** en 5 passes, 0 défaut, 0 prémisse ; **60 documents** conformes en production ; **46 pages backend** conformes en typographie (50 requêtes, 13,6 s) |
| SEO de contenu | **5,5** | = | Les **45 pages** ville/métier/guide existent, sont indexées, ont un guide de prix dérivé des budgets réels — et **n'ont aucune offre à montrer** : « aucune offre ouverte » est écrit, ce qui est honnête et ne convertit pas |
| Internationalisation | **10** | = | **976 clés × 5** langues à parité ; **5 langues servies** (60 documents, `lang`/`canonical` propres, 6 alternatives réciproques, `x-default`) ; titres réellement traduits ; aucun texte de coquille non résolu |
| Mobile (Capacitor) | **4** | = | `frontend/android` présent, **0 APK** produit (`app/build/outputs/apk` absent), décision ouverte depuis le 26/10 — la promesse « mobile » n'est pas tenue par un artefact |
| Paiement | **9** | = | Trois états publiés (`ok` / `echec` / `inconnu`), contradictions entre les deux lectures du circuit refusées ; **`state: inconnu`, aucune vente exercée** : le circuit est `closed` avec 0 échec, ce qui veut dire « rien n'a échoué parce que rien n'a eu lieu » |
| Observabilité | **10** | = | **18 / 18 sondes planifiées vertes** ; collecte des métriques verte avec une provenance et un âge réels ; `/metrics` fermé sans jeton ; l'alerte des sondes écrit une issue sur un rouge et se referme au vert. **Mesuré** : crons déclarés 06:17–07:48, exécutés **12:29–13:55** (≈ +6 h) — le verdict du matin est un verdict d'après-midi |
| Tests / CI | **9,5** | **−0,5** | `main` verte (`64d112c5`) ; **2 401 + 2 781 cas** ; **293 mutations** ; mais **10 rouges de charge** mesurés ce soir (7 fichiers qui lancent de vrais `git`/`node`), **235/235 verts** en isolation — la suite n'est pas fausse, elle est fragile sous charge |
| Confort de développement | **10** | = | Plafond par module (56 Ko) **et** plafond des sources (281 fichiers / 82 496 lignes, 8 dérogations datées, plafond par défaut pour tout fichier non déclaré) ; **7 gardes verts ce soir après build** ; `check-script-deps` verrouille 207 scripts |
| Qualité des verdicts | **9,5** | = | Un faux rouge **mesuré et fermé** (#275) ; une couverture qui **s'avoue** au lieu de se taire (#276 : 64 pages nommées, passe 4/5, 5 passes annoncées) ; `livrer` nomme les deux causes d'un refus. Reste : sa fenêtre CI de **25 min** a expiré sur un run de **28 min** aux checks tous verts |
| **Attractivité (nouveau)** | **4,5** | nouveau | Côté forme : 5 langues, typographie éditoriale sur 46 pages, carte 404 soignée, sitemap de 85 URL. Côté fond : **0 avis, 0 mission terminée**, une bande de preuve sociale en **état d'attente** (seuils 3 / 2), un **téléphone `+1`** et un **e-mail Gmail** sur un site dont l'adresse est à **Bamako** |
| Produit / traction | **3** | = | 4 travailleurs, 8 clients, **0 mission ouverte**, **0 terminée**, **0 avis**, **1 veille** ; 22 pages ville/métier et 23 guides répondent à une recherche qui n'a rien à livrer |

**Moyenne des treize domaines techniques : 9,0 / 10** (116,5 / 13).
**Moyenne des quinze domaines : 8,3 / 10** (124,0 / 15).
**Score d'ensemble : 9,0 technique / 4,5 attractivité / 3,0 marché.**

---

## 4. Les dettes que la mesure nomme ce soir

1. **Le marché est vide pour la neuvième mesure consécutive.** 0 mission, 0 avis.
   Tout le reste de cet audit décrit une machine qui fonctionne et qui regarde
   passer zéro transaction.
2. **Le circuit de paiement n'a jamais servi** (`paiement.state: inconnu`,
   `last_call_at: null`). `closed` + 0 échec ne prouve pas que payer marche : ça
   prouve que personne n'a essayé.
3. **Aucune remontée d'erreur** (`SENTRY_DSN` absent, `sentry.state: inactif`) :
   une panne côté client se découvre par une sonde planifiée, pas par une alerte.
4. **L'incohérence de contact est visible sur la page la plus visitée** :
   adresse **Bamako (Mali)**, téléphone **+1 819** (Canada), e-mail
   **Kojoapp98@gmail.com**. Sur un marché qui vend la confiance, c'est le premier
   signal qu'un visiteur lit.
5. **La suite frontend est sensible à la charge** : 10 rouges de délai mesurés
   quand `pytest` tourne en parallèle, 0 en isolation — la CI est verte, le poste
   de travail ne l'est pas toujours.
6. **`livrer` s'abandonne sur une fenêtre fixe** (25 min) alors qu'elle lit déjà
   l'état du job : un run de 28 min aux checks verts a produit un refus.
7. **Aucun APK** malgré un dossier `frontend/android` et une promesse mobile
   affichée — décision ouverte depuis le 26/10.

---

## 5. Propositions — pour rendre Kojo meilleur et attrayant

Classées par **effet attendu sur le seul chiffre qui compte** (missions
terminées, avis, veilles), puis par coût.

### P0 — Remplir le marché (sans cela, tout le reste est décor)

1. **Semer 20 à 30 missions réelles dans les 13 villes déjà indexées.** Le plan
   existe (`PLAN-SEMIS-OFFRE-30J.md`) ; les **45 pages** ville/métier/guide et
   les **60 documents** en 5 langues n'attendent que des offres pour cesser
   d'écrire « aucune offre ouverte ». Effet mesurable : `open_jobs: 0 → > 0` sur
   `/api/public/stats`, et des pages qui deviennent des points d'entrée réels.
2. **Convertir les 12 inscrits en 3 missions terminées + 2 avis.** Ce sont
   exactement les seuils codés (`SEUIL_MISSIONS_TERMINEES = 3`,
   `SEUIL_AVIS = 2`) : en dessous, l'accueil publie « chiffres à venir » — par
   honnêteté. Au-dessus, la preuve sociale s'allume d'elle-même, sans une ligne
   de code.
3. **Alimenter les veilles** : 1 veille pour 84 pages indexées, c'est le ratio
   d'un produit que personne n'a compris. La veille née d'une page métier le
   31/10 prouve que le lien fonctionne ; il faut mesurer le taux
   veille / visite sur les pages ville (le champ `origin` est déjà publié dans
   `/metrics`, il n'attend qu'un lecteur dans un tableau de bord).

### P1 — Réparer la confiance (une heure à un jour, chacune)

4. **Poser `SENTRY_DSN`** (`fly secrets set`, puis redéployer) : `sentry.state`
   passera de `inactif` à `ok` au premier événement, et l'exploitation cessera
   de dépendre des seules sondes.
5. **Exercer un vrai paiement de bout en bout** en production (le circuit est
   `closed`, 0 échec — donc rien à réparer, tout à prouver). Le résultat sera
   publié par `/health` : `paiement.state` quittera `inconnu`, et une vente
   réelle vaut mieux que cent tests.
6. **Aligner l'identité de contact** : adresse du domaine (`contact@…`), numéro
   malien ou ivoirien, WhatsApp cohérent. Un seul fichier
   (`frontend/src/config/contact.json`) alimente toutes les pages — c'est le
   meilleur ratio confiance / effort du dépôt.
7. **Trancher le mobile** : soit un APK signé et publié, soit retirer la
   promesse. Un dossier Android sans binaire est une dette silencieuse.

### P2 — Finir la machine (marges déjà minces, mais mesurées)

8. **Déchronométrer `livrer`** : il lit déjà l'état du job de déploiement ; la
   fenêtre de 25 min devrait être une borne sur la **lecture**, pas un compte à
   rebours. Mesuré : un run de 28 min, tous checks verts, refusé.
9. **Rendre la suite frontend insensible à la charge** : les 7 fichiers qui
   lancent de vrais sous-processus `git`/`node` dépassent 20 s quand la machine
   travaille (10 rouges mesurés). Deux options honnêtes : relevER leur
   `testTimeout` (il est déjà à 20–60 s ailleurs) ou les regrouper dans un shard
   séquentiel. Ne pas toucher aux assertions.
10. **Étendre l'échantillonnage tournant aux fiches `/jobs/:id`** (aujourd'hui
   3 au plafond, 1 seule au sitemap) : la même mécanique de fenêtre existe
   maintenant et se réutilise — c'est le prochain angle mort déclaré.
11. **Abaisser la latence de `/jobs`** : c'est la seule route dont la médiane
   LCP dépasse la seconde (1 312 ms, max 2 216 ms) alors que `/` est à 484 ms.
   6 candidats LCP sur cette route : la liste des missions arrive après coup.

---

## 6. Bilan final

**Ce que Kojo est ce soir** : une place de marché pour l'artisanat et les
services en Afrique de l'Ouest, servie dans **cinq langues**, avec **84 pages
découvrables** toutes jugées par une sonde stricte, **85 URL** au sitemap,
**2 401 + 2 781 cas verts**, **293 mutations** qui prouvent que les gardes
mordent, et une production mesurée à **213–303 ms de TTFB** et **420–1 312 ms de
LCP**. C'est un produit dont l'ingénierie tient, et dont chaque affirmation est
adossée à une mesure reproductible.

**Ce que Kojo n'est pas encore** : un marché. **0 mission ouverte, 0 terminée,
0 avis, 1 veille, 4 travailleurs, 8 clients** — pour la neuvième mesure. Le
produit est prêt à recevoir des missions ; il n'en reçoit pas. Tant que ce
chiffre est à zéro, chaque point gagné ailleurs (une langue, une sonde, un
garde) améliore la machine sans améliorer l'expérience d'un visiteur : il
arrive sur une page ville soignée, typographiée, traduite en cinq langues, qui
lui dit honnêtement qu'il n'y a rien.

**La priorité n'est donc pas technique.** Trois actions, dans cet ordre :
**semer des offres réelles**, **faire aboutir trois missions et deux avis**
(les seuils de la preuve sociale sont déjà codés), **corriger l'identité de
contact** (téléphone `+1` et e-mail Gmail sur une adresse à Bamako). Les trois
sont mesurables le lendemain : `open_jobs`, `completed_jobs`, `reviews` sur
`/api/public/stats`, et l'état de la bande de preuve sociale sur `/`.

### Tableau des scores

| Domaine | Note /10 | Δ matin | Ce qui décide la note |
|---|---:|---:|---|
| Ingénierie backend | **10** | = | 2 401 cas verts, 0 rouge, `/health` 200, données connectées |
| Sécurité | **9** | = | 401 sur `/metrics`, CSP/HSTS, gitleaks ; pas de remontée d'erreur |
| Performance | **10** | = | 127,1 Ko JS initial, 83,26 Ko CSS, TTFB 213–303 ms, LCP ≤ 1 312 ms |
| Accessibilité | **10** | = | CI verte (axe, clavier, gestes) — non re-mesurée ce soir |
| SEO technique | **10** | = | 85 URL, 84/84 jugées, 210 `xhtml:link`, 60 documents conformes |
| SEO de contenu | **5,5** | = | 45 pages prêtes, aucune offre à montrer |
| Internationalisation | **10** | = | 976 clés × 5, 60 documents servis et réciproques |
| Mobile (Capacitor) | **4** | = | Dossier Android, aucun APK, décision ouverte |
| Paiement | **9** | = | Trois états publiés ; aucune vente exercée (`inconnu`) |
| Observabilité | **10** | = | 18/18 sondes vertes, alerte auto, `/metrics` fermé |
| Tests / CI | **9,5** | −0,5 | 5 182 cas, 293 mutations ; 10 rouges de charge sous parallélisme |
| Confort de développement | **10** | = | Plafonds par module et par source, 7 gardes verts, 207 scripts verrouillés |
| Qualité des verdicts | **9,5** | = | Prémisse ≠ absence, couverture avouée ; fenêtre de 25 min encore fixe |
| **Attractivité** | **4,5** | nouveau | Forme soignée, fond vide ; contact incohérent (+1 / Gmail / Bamako) |
| Produit / traction | **3** | = | 0 mission, 0 avis, 1 veille, 4 travailleurs, 8 clients |
| **Moyenne technique (13)** | **9,0** | = | 116,5 / 13 |
| **Moyenne globale (15)** | **8,3** | = | 124,0 / 15 |
| **Marché** | **3,0** | = | Neuvième mesure identique |
