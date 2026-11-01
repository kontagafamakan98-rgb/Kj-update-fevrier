# Audit général de Kojo — 1er novembre 2026

> **Périmètre** : `main` à **`bd63c430`**, la production
> (`https://kojoforafrica.cc.cd` sur Vercel, `https://api.kojoforafrica.cc.cd`
> sur Fly.io, révision backend **`ff6e0856`**), les **25 workflows** (dont **20**
> à cron), le registre des gardes et les deux suites de tests.
> **Méthode** : mesures **exécutées le 01/11 entre 09:30 et 11:00 UTC**, après
> les trois livraisons du jour — HTTP réel sur la production (statuts, latences,
> tailles, sitemap, `/health`, `/metrics`, `/api/public/stats`), **quatre sondes
> de production jouées à la main** (`hreflang`, typographie, SEO stricte, CDN
> lente), **suite backend entière** (`pytest` : 2 401 verts, 7 sautés, 0 rouge,
> 12 min 37 s en une passe), **suite frontend entière** (`vitest run` : 180
> fichiers, 2 768 verts, 1 sauté, **7 rouges de charge rejoués en isolation :
> 177/177 verts**), **balayage planifié lu run par run**, lecture du code et de
> `git log`.
>
> **Limites déclarées** : **Lighthouse n'a pas été relancé** (les budgets sont
> ceux de la CI, verts sur `bd63c430`) ; l'**accessibilité** n'est pas
> re-mesurée aujourd'hui (portée par la CI verte) ; les parcours
> **authentifiés** ne sont pas rejoués hors sondes ; les binaires **Capacitor**
> ne sont ni reconstruits ni installés ; le jeton `/metrics` n'est pas sur cette
> machine (la collecte est lue dans le journal de son run) ; le **balayage
> planifié du 01/11 n'avait pas encore eu lieu** à l'heure de l'audit — les 18
> verdicts cités sont ceux du **31/10**.

---

## 1. Verdict en une page

**Le produit est servi dans cinq langues, et il n'a toujours rien à vendre.**
Aujourd'hui, Kojo a gagné une capacité réelle — `wo`, `bm` et `mos` ont une URL,
un `hreflang` réciproque et un document pré-rendu dans leur langue — et il a
perdu un faux rouge : la sonde SEO ne confond plus un délai réseau avec une page
absente. Ce qui n'a pas bougé, pour la neuvième mesure consécutive, c'est le
marché : **4 travailleurs, 8 clients, 0 mission ouverte, 0 mission terminée,
0 avis**, et **une** veille emploi, née le 31/10 d'une page métier.

| Ce qui est mesuré le 01/11 | Valeur | 31/10 |
|---|---:|---:|
| Travailleurs | **4** | 4 |
| Clients | **8** | 8 |
| Missions ouvertes | **0** | 0 |
| Missions terminées / Avis | **0 / 0** | 0 / 0 |
| Pays couverts | **4** | 4 |
| **Veilles emploi** | **1** (`origine=metier`, 31/10 11:14) | 1 |
| URL au sitemap | **85** (30 747 o), dont **210 `xhtml:link`**, **35 `x-default`** | 64 / 42 |
| — familles multilingues | **35 entrées** = 7 routes × 5 langues | 21 = 7 × 3 |
| — villes / métiers / guides | **13 / 9 / 23** (monolingues, par choix) | 13 / 9 / 23 |
| **Documents par langue servis** | **60** (12 routes × 5) — `lang`, `canonical`, alternatives conformes | 24 |
| `/health` | **200** en 1,25 s au premier appel, `database: connected`, révision **`ff6e0856`** | 0,55 s |
| `paydunya_circuit` | **`closed`**, 0 échec | `closed` |
| `paiement` | **`inconnu`** — jamais exercé depuis le déploiement (`last_call_at: null`) | `inconnu` |
| `sentry` | **`inactif`** — `SENTRY_DSN` absent | `inactif` |
| `ai_gateway` | `mistralai/mistral-nemo`, **`inconnu`** (compteur en mémoire, remis à zéro par le déploiement de 09:24) | `inconnu` |
| `/metrics` sans jeton | **401** en 102 ms | 401 |
| JS initial servi (gzip) | **131 156 o = 128,1 Ko**, 6 fichiers | 127,8 Ko |
| CSS critique inlinée | **85 257 o**, inchangée | 85 257 o |
| HTML servi `/` / `/jobs` / `/en/jobs` / `/wo/jobs` | **140 863 / 110 344 / 110 112 / 110 134 o** | 141 034 / 110 335 / 110 071 |
| Page backend `/emplois/bamako` | **11 497 o, 0 octet de JS** | 11 614 o |
| TTFB / LCP production (12 routes) | **215–231 ms / 516–912 ms** (pire : `/jobs`, 912 ms) | 214–243 / 420–692 |
| CI sur `main` | **verte** (`bd63c430`) | verte |
| Balayage planifié | **18 / 18 vertes** (31/10, 12:29→13:55 UTC) | 18 / 18 |
| Tests backend | **2 401 ✓ / 7 sautés / 0 rouge** en 12 min 37 s | 2 401 |
| Tests frontend | **2 768 ✓ / 180 fichiers / 1 sauté** ; 7 rouges **de charge**, 177/177 en isolation | 2 753 |
| Gardes déclarés (mutations) | **292** | 290 |
| Clés i18n | **976 × 5 langues**, **5 indexées** | 976 × 5, 5 |

**Lecture** : la couche « machine » est finie. Cinq langues servies, quatre
sondes de production vertes le même jour, 292 mutations déclarées, 2 401 + 2 768
cas verts. La couche « marché » est vide, et elle l'est depuis huit jours. Le
verdict de cet audit n'est donc pas technique : **Kojo est prêt à recevoir des
missions, et il n'en reçoit pas.**

---

## 2. Ce que le 01/11 a changé

**3 livraisons** sur `main`, toutes mesurées après déploiement.

| Livraison | Ce qu'elle apporte | Preuve |
|---|---|---|
| #273 `81fd53e8` | La sonde **jobs/ville client** lit le compte sur les **deux** origines (API et site) — elle rendait une prémisse à chaque run | 3 passes : 2 prémisses, puis **vert** avec le parcours complet |
| #274 `ff6e0856` | **Cinq langues INDEXÉES** (`fr`, `en`, `wo`, `bm`, `mos`) : 60 documents, rewrites Vercel, sitemap par la même déclaration, `x-default` ; **plafond des sources** (281 fichiers / 82 496 lignes, 8 dérogations datées) | sonde `hreflang` : **60/60 conformes**, 61 requêtes en 13,9 s ; `check-taille-sources` vert en CI |
| #275 `bd63c430` | La sonde SEO **sépare la prémisse de l'absence** : une page demandée deux fois, une erreur de transport persistante sort en **2** (`::warning` nommée) au lieu d'accuser le sitemap ; `livrer.py` nomme les deux causes | faux rouge du matin fermé : `main` repasse **verte**, la même étape rendant « 20/84 pages : conformes » |

**Effet mesuré sur les scores** : **Internationalisation** passe de « 10 sur
promesse » à « 10 sur artefact servi » (+0 en note, +1 en preuve) ; **SEO
technique** gagne 21 URL et 168 `xhtml:link` (note tenue à 10) ; **Qualité des
verdicts** entre au tableau à **9,5** — un faux rouge mesuré et fermé, un
traîneau de livraison qui s'abandonne encore sur une fenêtre fixe.

---

## 3. Notes par domaine — 01/11/2026

Notes sur 10, justifiées par la mesure. Une note basse n'est pas un jugement sur
le travail : c'est l'écart entre ce qui est construit et ce qui est **mesuré en
production**.

| Domaine | Note | Δ | Preuve du jour |
|---|---:|---:|---|
| Ingénierie backend | **10** | = | 136 fichiers de tests, **2 401 verts, 0 rouge, 7 sautés** en une passe ; `/health` 200, `database: connected` ; séquestre, litiges, KYC, index, sauvegardes prouvés ; **0 rouge local** (l'import cp1252 ne dépend plus du terminal) |
| Sécurité | **9** | = | `/metrics` **401** sans jeton ; CSP sans joker, HSTS, `nosniff`, `X-Frame-Options: DENY` ; gitleaks bloquant ; **aucun secret dans le HTML servi** (sonde d'exposition verte le 31/10). Reste : `SENTRY_DSN` absent, donc pas de remontée d'erreur — la sécurité n'y perd rien, l'exploitation si |
| Performance | **10** | = | JS initial **128,1 Ko gzip** (6 fichiers), CSS critique **85 257 o** ; **TTFB 215–231 ms**, **LCP 516–912 ms** sur 12 routes (48 navigations, 128,5 s), plafonds 1 500 / 4 000 ms ; Lighthouse vert en CI |
| Accessibilité | **10** | = | **Non re-mesurée aujourd'hui** — portée par la CI verte (axe + moteurs de gestes + clavier). Limite écrite, comme la dernière fois |
| SEO technique | **10** | = | **85 URL** au sitemap, `canonical` par langue, **210 `xhtml:link`** et **35 `x-default`** ; sonde stricte verte (`20/84` jugées, `64` au-delà du plafond — limite écrite) ; **60 documents** servis avec `lang` + alternatives réciproques |
| SEO de contenu | **5,5** | = | Les **45 pages** ville/métier/guide restent **sans offres** : elles répondent à « emploi Abidjan », elles n'ont rien à montrer. La veille née le 31/10 prouve que le levier fonctionne ; il n'est pas alimenté |
| Internationalisation | **10** | = (preuve +1) | **5 langues servies** : 60 documents conformes en production (61 requêtes, 13,9 s), `lang` et `canonical` propres à chaque langue, 6 alternatives réciproques, `x-default` ; **976 clés × 5** à parité ; titres réellement traduits (`Liggéey yu am`, `Baara minnu bɛ yen`, `Tʋʋma sẽn beẽ`) |
| Mobile (Capacitor) | **4** | = | `frontend/android` présent, **0 APK** dans l'arbre, décision ouverte depuis le 26/10 |
| Paiement | **9** | = | Trois états publiés (`ok` / `echec` / `inconnu`), contradictions entre les deux lectures du circuit refusées ; **`state: inconnu`, `last_call_at: null`** : aucune vente exercée depuis le déploiement |
| Observabilité | **10** | = | **18/18 sondes planifiées vertes** (31/10), collecte des métriques verte avec une provenance et un âge réels (`metier=1`, âge 0,1 j, seuil 30) ; `/metrics` fermé sans jeton. **Mesuré** : crons déclarés 06:17–07:48, exécutés **12:29–13:55** (≈ +6 h) — le verdict du matin est un verdict d'après-midi |
| Tests / CI | **10** | = | `main` verte (`bd63c430`) ; **2 401 + 2 768 cas** ; **292 mutations** déclarées ; la suite locale frontend rend 7 rouges **de charge** (6 fichiers de scripts) qui repassent **177/177** en isolation — donc mesurés, pas masqués |
| Confort de développement | **10** | = | Plafond par module (56 Ko) **et** plafond des **sources** (281 fichiers / 82 496 lignes, 8 dérogations datées, plafond par défaut pour tout fichier non déclaré) ; 0 rouge backend local ; `check-script-deps` verrouille 207 scripts |
| **Qualité des verdicts** | **9,5** | nouveau | Un faux rouge **mesuré et fermé** (#275 : délai réseau ≠ page absente, trois sorties 1 > 2 > 0) ; `livrer` nomme les deux causes d'un refus SEO. Reste : sa fenêtre CI de **25 min** a expiré sur un run de **28 min** aux checks tous verts, et le message dit encore « la CI a échoué ou expiré » |
| **Produit / traction** | **3** | = | **1 veille**, 4 travailleurs, 8 clients, **0 mission**, **0 avis** ; deux signaux de confiance contredisent le produit (email Gmail, téléphone **+1**) |

**Moyenne des treize domaines techniques : 9,0/10.**
**Score d'ensemble : 9,0 technique / 3 marché.**

---

## 4. Ce qui est solide (mesuré aujourd'hui, pas supposé)

1. **`main` est verte** (`bd63c430`, run `41296578589`, `success`) et la sonde
   SEO stricte y rend « **20/84 pages vérifiées : conformes** » — l'étape même
   qui était rouge le matin.
2. **La production sert les cinq langues** : 60 documents, 12 routes × 5
   langues, `lang`, `canonical` absolu et six alternatives **réciproques**,
   vérifiés par la sonde **et** à la main (`/wo/jobs` → `lang="wo"`,
   `Liggéey yu am · Kojo`, `canonical /wo/jobs`, montage React rempli).
3. **Le sitemap est symétrique** : 85 URL, dont **35 entrées portant les cinq
   langues** (7 routes × 5), 210 `xhtml:link`, 35 `x-default`, et **aucune**
   alternative sur les 45 pages monolingues — la sonde refuse l'inverse.
4. **Les 46 pages servies par le backend portent la typographie du site** :
   Inter au corps, Cormorant Garamond aux titres, 4 fichiers de police servis
   (`/fonts/*.woff2`, `font/woff2`), préchargements avec `crossorigin` —
   50 requêtes en 13,7 s, code 0.
5. **La performance tient sur le réseau réel** : 12 routes, TTFB 215–231 ms,
   LCP 516–912 ms pour des plafonds de 1 500 et 4 000 ms ; aucune route au-delà.
6. **Les pages servies par le backend ne paient toujours aucun JS** :
   `/emplois/bamako` = **11 497 o**, zéro script.
7. **Le poids initial est stable** : 131 156 o gzip (128,1 Ko) sur les 6
   fichiers chargés par `/`, CSS critique inchangé à l'octet près (85 257 o).
8. **Les tests tiennent** : 2 401 cas backend verts (12 min 37 s en une passe,
   sans parallélisation) et 2 768 cas frontend verts sur 180 fichiers ; les 7
   rouges de la passe complète sont **de la charge** — les 6 fichiers fautifs
   rejoués seuls rendent **177/177** en 117 s.
9. **La protection de `/metrics` est réelle** : 401 en 102 ms sans jeton.
10. **292 mutations déclarées** avec leur preuve d'échec, dans 25 workflows
    dont 20 planifiés : ce dépôt sait, pour presque chaque garde, montrer
    qu'il **peut** échouer.

---

## 5. Défauts restants, classés par coût

### P0 — ce qui empêche le produit de vivre

**1. La place est vide, pour la neuvième mesure consécutive.**
`open_jobs: 0`, `completed_jobs: 0`, `reviews: 0`, **4** travailleurs, **8**
clients, **4** pays. Les **45 pages** ville/métier/guide disent honnêtement
« aucune offre ouverte » — et elles sont désormais servies dans cinq langues
pour dire cela. **Coût : 100 % de la valeur potentielle.**
Correctif : [PLAN-SEMIS-OFFRE-30J.md](PLAN-SEMIS-OFFRE-30J.md), qui reste le
document le plus important du dépôt.

**2. Les deux signaux de confiance contredisent le produit — 6e audit.**
`frontend/src/config/contact.json` : email **`Kojoapp98@gmail.com`**, téléphone
**`+1 819 300 3507`** (indicatif **canadien**, y compris dans
`wa.me/18193003507`), sous une adresse « Hamdallaye ACI 2000, Bamako, Mali ».
Sur un produit qui prend de l'argent en séquestre, c'est le premier détail qu'un
client méfiant vérifie — et il est servi sur **toutes** les pages.
**Coût : crédibilité, donc conversion. Correctif : 30 minutes.**

**3. Aucun paiement n'a été exercé depuis le déploiement.**
`paiement.state: inconnu`, `last_call_at: null`, `last_success_at: null` : on
sait enfin **dire pourquoi** un paiement échouerait, et rien n'a été essayé.
**Coût : le seul chemin qui rapporte n'est pas prouvé en production.
Correctif : un règlement réel de bout en bout au montant minimum — 1 h.**

### P1 — ce qui coûte des visiteurs

**4. Les diagnostics publiés se remettent à zéro à chaque déploiement.**
`ai_gateway` et `paiement` lisent `inconnu` **après** chaque `fly deploy` : leur
état vit dans un dictionnaire de module (`kojo_ai_gateway._diagnostic`), pas en
base. Or c'est précisément après un déploiement qu'on veut savoir si le modèle
répond. Mesuré : la sonde de l'assistant était verte le 31/10 (elle poste sur
`/api/support/robot/chat`, qui traverse le gateway), et `/health` dit `inconnu`
le 01/11 parce que la machine a redémarré à 09:24. **Coût : un diagnostic muet
au pire moment. Correctif : persister le dernier verdict (une ligne Mongo) ou
faire exercer le chemin une fois par la vérification post-déploiement — 2 h.**

**5. Les crons de sondes arrivent avec ~6 h de retard.**
Déclarés `17 6`, `36 7`, `40 7`, `44 7`, `48 7` UTC ; observés les 30/10 et
31/10 entre **12:29 et 13:55 UTC**, en file les uns derrière les autres. Le
verdict « du matin » est un verdict d'après-midi, donc une régression livrée à
08:00 peut n'être vue que ~28 h plus tard. Mitigation déjà en place : la CI
post-fusion et `npm run livrer` lancent les mêmes sondes **au moment du
déploiement**. **Coût : latence de détection. Correctif : étaler les crons sur
des minutes distinctes et basses (déjà le cas — la file est côté GitHub), ou
n'en garder qu'un agrégateur quotidien — décision à prendre, 30 min.**

**6. La suite de tests frontend n'est pas déterministe en local.**
`vitest run` complet : **7 rouges sur 2 776 cas**, tous dans
`scripts/__tests__/*` (gardes qui lancent un sous-processus : `check-hero-images`,
`check-page-meta`, `check-prerender-shells` ×3, `check-shell-text-provenance`,
`check-workflows-lint`, `import-health`). Rejoués seuls : **177/177 verts**. La
CI est verte parce qu'elle ne court pas dans la même charge, mais un
développeur qui lance la suite complète voit sept rouges qui n'existent pas.
**Coût : confiance dans la suite. Correctif : sérialiser ces fichiers
(`fileParallelism: false` sur `scripts/__tests__`) ou relever leur délai de
sous-processus — 1 h.**

**7. Le traîneau de livraison s'abandonne sur une fenêtre fixe.**
`livrer.py` attend la CI **25 minutes** ; le run de ce matin a duré **28** (front
16 min 56, E2E 10 min 59, Lighthouse 10 min 50, en file) et tous les checks
étaient **verts** au moment de l'abandon. Le message dit « la CI a échoué ou
expiré », ce qui est faux dans ce cas. **Coût : une relance manuelle, et un
message qui accuse la CI. Correctif : lire l'état des checks plutôt que compter
les minutes, ou nommer la prémisse — 2 h.**

### P2 — dette assumée

**8. Mobile : 0 APK.** Décision ouverte depuis le 26/10 : publier, ou retirer
`frontend/android` du produit pour ne plus le porter.

**9. `SENTRY_DSN` absent** : les erreurs backend ne remontent nulle part ;
`/health` le dit (`state: inactif`), c'est donc un choix visible, pas un oubli.

**10. La sonde SEO stricte juge 20 des 84 pages** du sitemap à chaque passe
(plafond `MAX_PAGES`), et le dit. Les 64 autres ne sont couvertes par aucune
sonde de production.

**11. Les 27 termes wolof/bambara/mooré** restent à relire par des locuteurs
natifs : la parité des dictionnaires est prouvée, l'idiomatisme ne l'est pas.

---

## 6. Améliorations proposées, par effet attendu

| Priorité | Amélioration | Coût | Effet mesurable |
|---|---|---:|---|
| **1** | **Semer 10 missions réelles** (plan 30 j) et suivre `open_jobs` | 3 j | `open_jobs` 0 → 10 ; les 45 pages cessent d'être des pages vides ; première mission terminée + premier avis |
| **2** | **Contact crédible** : email sur le domaine, numéro malien (ou WhatsApp Business) | 30 min | disparaît le seul détail que tout client méfiant vérifie en premier |
| **3** | **Exercer un paiement réel** de bout en bout | 1 h | `paiement.state` `inconnu` → `ok` ; le chemin qui rapporte devient prouvé |
| **4** | **Persister les diagnostics** `ai_gateway` et `paiement` | 2 h | `/health` cesse de dire `inconnu` après chaque déploiement |
| **5** | **Fenêtre CI de `livrer`** : lire l'état au lieu de compter | 2 h | plus d'abandon sur un run vert mais en file |
| **6** | **Suite frontend déterministe** (sérialiser les gardes à sous-processus) | 1 h | 0 rouge local au lieu de 7 faux |
| **7** | **Sonde SEO tournante** : 20 pages par run, mais 84 couvertes en 5 runs | 2 h | couverture complète sous 5 jours, publiée |
| **8** | **Décider le mobile** : APK publié, ou `android/` retiré | 0,5 j | plus de dette qui pèse sans servir |
| **9** | **Relire les 27 termes** avec un locuteur natif | 1 j (externe) | les 5 langues deviennent crédibles à l'oral, pas seulement à l'écrit |
| **10** | **Un `hreflang` vérifié sur la PREVIEW d'une PR** | 0,5 j | un rewrite perdu se voit avant fusion, pas après déploiement |

---

## 7. Bilan final

**Ce qui est vrai ce soir** : Kojo est un produit **techniquement fini**. Cinq
langues servies et vérifiées sur 60 documents, 85 URL au sitemap avec 210
alternatives réciproques, 46 pages typographiées, 12 routes sous 231 ms de TTFB
et 912 ms de LCP, 2 401 + 2 768 cas verts, 292 mutations déclarées, 18 sondes
vertes, `/metrics` fermé, zéro rouge en local côté backend. Le niveau
d'exigence de ce dépôt — mesurer, nommer, prouver que le garde peut échouer —
tient, et la correction d'aujourd'hui (un délai réseau n'est pas une absence)
en est un exemple net : le faux rouge a été mesuré, fermé, et sa mutation
rejouée.

**Ce qui est vrai aussi** : en huit jours, le marché a produit **une** veille
emploi. Aucune mission, aucune offre, aucun avis, aucune vente. Le produit est
excellent à ne rien vendre. Les trois P0 ne sont pas des défauts d'ingénierie :
ce sont **10 missions à semer**, **un contact crédible**, **un paiement essayé**.
Le reste — diagnostics persistés, fenêtre de livraison, suite locale,
couverture des 84 pages — améliore la confiance dans la machine, pas l'arrivée
du premier client.

**Note d'ensemble : 9,0 / 10 sur la machine, 3 / 10 sur le marché.** La distance
entre les deux est le seul chantier qui compte.
