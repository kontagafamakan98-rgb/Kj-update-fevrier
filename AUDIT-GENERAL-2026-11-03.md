# Audit général de Kojo — 03/11/2026

Révision auditée : **`cbf0f5f2`** (`main`, fusion de la PR #295). Le backend Fly
tourne sur **`c601768a`** (PR #294) — normal : #295 n'a touché que `AGENTS.md`,
la fonction d'arête et son test, aucun fichier `backend/**`, donc `deploy-fly`
a été `skipped`.

Tout ce qui suit a été **remesuré dans cette passe** : production, sondes,
suites de tests, harnais de gardes, état du dépôt. Aucun chiffre recopié d'un
rapport précédent.

---

## 1. Ce que la production répond

| Mesure | Valeur |
|---|---|
| `/health` (origine API) | **200** en 1,13 s — `healthy`, base `connected`, `version 1.0.2`, révision `c601768a` |
| `/sitemap.xml` (site, fonction d'arête) | **200** en **0,30–0,37 s**, `X-Vercel-Cache: HIT`, `Age` 15–16 s, **83 URL** (80 déclarées + 3 vivantes), 30 353 o |
| `/sitemap.xml`, premier crawl d'un POP | **200** en **2,19 s**, `MISS` — le trajet jusqu'à Fly, payé une fois par POP |
| `/api/sitemap.xml` (origine backend, inchangé) | 200 en 0,42 s |
| `/api/public/stats` | **200** en 0,56 s — 2 travailleurs, 8 clients, **0 mission ouverte**, 0 terminée, **0 avis**, 4 pays |
| `/metrics` (origine API) | **401** sans jeton |
| `/` | 200 en 0,47 s, `HIT`, 141 507 o |
| `/jobs`, `/en/jobs` | 200 en **0,38 s**, `HIT` |
| `/emplois/abidjan`, `/guides/prix-bamako` | 200 en **0,49–0,54 s** |
| URL inconnue | **404** en 0,31 s, 2 685 o |

### En-têtes de sécurité (mesurés sur `/`)

`frame-ancestors 'none'` (CSP), `Strict-Transport-Security: max-age=63072000`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` bornée. `robots.txt` : 11 `Disallow` (toutes les routes
privées) et `Sitemap:` absolu.

### Les blocs de diagnostic de `/health`

| Bloc | État | Lecture |
|---|---|---|
| `erreurs` | `ok`, `total: 0`, `depuis 04:34:37` | aucune exception non rattrapée depuis le démarrage du processus, portée écrite |
| `sentry` | `inactif` | `SENTRY_DSN` absent — les erreurs sont comptées, jamais groupées avec trace |
| `langues` | 5 langues, 7 documents chacune, 45 monolingues, 80 déclarées, 6 alternatives | confronté au sitemap servi par la sonde `hreflang` |
| `paydunya_circuit` | `closed`, 0 échec | circuit fermé, seuil 5 |

---

## 2. Les quatre sondes de production, rejouées

| Sonde | Verdict | Coût |
|---|---|---|
| `check-seo-production.js --strict` | **code 0** — 20/83 pages de la fenêtre 1/5, 62 nommées pour les passes suivantes, fiches `/jobs/:id` jugées | 1 passe |
| `check-typo-pages-production.js` | **code 0** — 46 pages servent Inter + Cormorant, préchargent leurs fichiers, 4 `.woff2` répondent | 50 requêtes, 12,7 s |
| `check-hreflang-production.js` | **code 0** — 60 documents (12 routes × 5 langues), `lang`/`canonical`/alternatives réciproques, sitemap symétrique, bloc `langues` confronté | 62 requêtes, 13,0 s |
| `check_health_probe.py` | **code 0** — production saine, MongoDB, PayDunya, fournisseur email | 4 requêtes |

---

## 3. CI, tests, harnais

- **CI `main`** : 3 derniers runs **verts** (25 min 52 s pour le dernier) ;
  PR #295 — **12 SUCCESS, 1 SKIPPED** avant fusion.
- **Backend** : **2 500 passés, 7 ignorés** en 7 min 30 s (145 fichiers de tests).
- **Frontend** : **2 820 cas collectés**, **2 811 passés**, 0 échec réel ;
  8 fichiers ont expiré à 20 s pendant la passe complète lancée **sous charge
  parallèle** (trois suites en même temps sur ce poste) et **tous repassent
  verts en isolation** : `check-test-environment` 57 cas, `check-retard-main`
  33, et six autres (250 cas au total). Mesuré, pas supposé.
- **105 fichiers de test** dans `frontend/scripts/__tests__`, **157 gardes /
  301 mutations** déclarés, **117 fichiers** à leur état de référence (périmètre
  dérivé des mutations déclarées).
- **Bundle** : JS initial **127,3 Ko gzip** / 135 · plus gros chunk 64,3 Ko /
  200 · build 10,78 Mo / 11,20. **CSS critique** : 83,26 Ko / 84,00 (14 documents).
- **978 clés** i18n × 5 langues, 25 workflows, 0 issue ouverte, 0 PR ouverte.
- **Dépendances** : `npm audit --omit=dev` → **0 vulnérabilité**.
- **Hygiène des branches** : le garde qui rougissait le 02/11 annonce
  aujourd'hui « **aucun résidu** » (0 branche non publiée, 0 réf distante
  orpheline) après les tags `archive/*` et le `fetch --prune`.

---

## 4. Ce que la nouvelle couche a coûté — et ce qu'elle a caché

Le sitemap est passé au CDN le 03/11. Trois faits mesurés, un défaut réel.

1. **Gain tenu.** `HIT` à 0,30–0,37 s, `Age` 15–16 s : l'aller-retour POP→Fly
   et les lectures Mongo ne sont plus payés à chaque crawl, seulement au premier
   de chaque POP (2,19 s mesuré).
2. **Le témoin du backend a disparu de la surface publique.** La fonction
   recopie les trois en-têtes de volume mais **pas** `X-Kojo-Sitemap-Cache`,
   qui dit `frais`/`rejoue` chez Fly. Or c'est exactement ce qui distingue
   « le CDN a rafraîchi depuis l'origine » de « le CDN a resservi la mémoire du
   backend ». Le fait reste lisible sur `/api/sitemap.xml`, mais plus à l'URL
   que tout le monde interroge. — **Corrigé (#297)** : le témoin est transporté
   comme les volumes, et **jamais inventé** quand l'amont se tait (deux cas).
3. **`Cache-Control` observé : `public`**, pas `s-maxage=60, stale-while-revalidate=60`.
   Vercel normalise l'en-tête de sa fonction d'arête : la fraîcheur écrite dans
   le module n'est pas celle qu'un observateur peut lire. Elle se mesure par
   `Age` (15–16 s, monté à 191 s pendant un rafraîchissement), jamais par
   l'en-tête. — **Corrigé (#297)** : la politique DEMANDÉE est publiée dans
   `X-Kojo-Cache-Politique`, que la plateforme ne réécrit pas, et un test exige
   qu'elle soit **égale** au `Cache-Control` demandé. Deux faits séparés : la
   politique est la demande, `Age` reste la mesure.

**Corrigé dans la foulée (03/11, 09 h 43, #296).** Le plafond de fraîcheur
(`s-maxage` + fenêtre stale) valait 6 min — une copie de cinq minutes servie à
un crawler pour éviter une revalidation qui coûte **0,41 s** chez le backend.
La fenêtre passe à 60 s, donc **2 min au pire**, et le garde borne désormais le
plafond au lieu de constater la présence de la directive : une fenêtre revenue
à 300 rougit (mutation rejouée, un rouge nommé, restaurée). Re-mesuré en
production après livraison : `MISS` → 21 → 41 → **63 s `STALE`** → 21 s `HIT`,
sur **26 lectures en 13 min**, sans qu'aucun `Age` ne dépasse **63 s** ; le
corps sert toujours **83 URL** avec ses trois `X-Kojo-Urls` et
`Content-Type: application/xml`. La `STALE` visible à 63 s est le fait neuf :
la fenêtre de 60 s est réellement exercée par le rafraîchissement, au lieu
d'être une tolérance où l'`Age` dérivait à 191 s puis 296 s.

**Le défaut de verdict** : `sitemap-vercel.test.js` (13 cas) existe et tourne,
mais le garde **n'était pas déclaré** dans `guard-proofs.json` (157 gardes,
`grep sitemap-vercel` → 0) et aucun de ses deux fichiers n'entrait dans l'état de
référence (117 fichiers, périmètre dérivé des mutations). Autrement dit : la
règle la plus récente — « le corps est transporté à l'identique, une erreur ne
se cache jamais » — était la seule du dépôt dont **aucune mutation ne prouvait
qu'elle peut rougir**, et dont les octets pouvaient dériver sans que rien ne le
dise.

**Corrigé (#297).** `frontend/api/sitemap.js` est déclaré comme PORTEUR de la
règle (`role: garde`, `invoque_par: test`, preuve `sitemap-vercel.test.js`),
avec deux mutations qui ont réellement rougi, rejouées par le harnais :
`s-maxage=60 → 3600` + `stale=300` → 4 cas nommés (« expected 3600 to be 60 »),
et `'cache-control': 'no-store' → 'public, s-maxage=60'` → les deux cas de 502
(« expected 'public, s-maxage=60' to be 'no-store' »). Le registre passe à
**158 gardes / 303 mutations**, l'état de référence à **118 fichiers**. Limite
dite : la preuve elle-même n'entre pas au périmètre (le harnais ne mute que le
fichier déclaré) ; une assertion qui ne rougirait plus est attrapée par le
motif `attend`, pas par une empreinte.

---

## 5. Ce que le dépôt tient toujours, et ce qui reste

**Tient** : 60 documents pré-rendus en 5 langues avec `hreflang` réciproque ;
45 pages ville/métier/guide servies par le backend, typographiées comme le site ;
83 URL au sitemap sans entrée morte déclarée ; 301 mutations rejouées ; zéro
exception en production ; 0 vulnérabilité de dépendance ; arbre propre.

**Reste, dans l'ordre de ce que ça rapporte** :

1. **Publier 10 missions réelles avec budgets, et demander un avis après chaque
   mission terminée.** C'est le seul geste qui déplace trois notes à la fois
   (SEO de contenu 5,5, produit 3, attractivité 4,5) et il fait disparaître les
   « Aucun budget annoncé » des 23 guides.
2. **Contact ouest-africain** : `contact.json` porte encore `+1 819 300 3507`
   et `Kojoapp98@gmail.com` — un numéro canadien et une boîte Gmail pour un
   marché malien/ivoirien, et c'est le NAP que lisent le JSON-LD et les pages.
3. ~~**Déclarer `sitemap-vercel` au registre, avec une mutation.**~~ **Fait (#297)** :
   deux mutations rejouées (plafond de fraîcheur, erreur qui se cache), registre
   à 158 gardes / 303 mutations, état de référence à 118 fichiers.
4. ~~**Transmettre `X-Kojo-Sitemap-Cache`** depuis la fonction.~~ **Fait (#297)**,
   avec une liste séparée `ENTETES_TEMOIN` — c'est un témoin, pas un volume — et
   avec la politique demandée publiée à part dans `X-Kojo-Cache-Politique`,
   puisque Vercel normalise `Cache-Control`. Mesuré après livraison :
   `X-Kojo-Sitemap-Cache: frais` puis `rejoue` à l'origine, `rejoue` sur un MISS
   forcé de la fonction, et la politique présente sur les trois.
5. **Poser `SENTRY_DSN`** : les erreurs passent de « comptées » à « groupées,
   avec trace ».
6. **APK signé + piste Play interne** : `versionName 1.0`, `assembleDebug` vert
   en CI, rien n'est distribué.
7. **`testTimeout` explicite** sur les 8 fichiers à sous-processus `git` réels
   (`check-test-environment`, `check-retard-main`, …) : 20 s est sous la mesure
   dès que la machine est chargée, et un rouge d'environnement coûte plus cher
   qu'un délai.

---

## 6. Tableau des scores

| Domaine | Note /10 | Δ | Ce qui décide la note |
|---|---:|---:|---|
| Ingénierie backend | **10** | = | 2 500 cas verts, `/health` 200, base connectée, révision servie |
| Sécurité | **9** | = | CSP `frame-ancestors`, HSTS 2 ans, `/metrics` 401, 0 vulnérabilité ; `sentry: inactif` |
| Performance | **10** | = | sitemap **0,30–0,37 s en HIT** (0,72 s avant le CDN), pré-rendu 0,38 s, pages backend 0,49–0,54 s, JS initial 127,3 Ko |
| Accessibilité | **10** | = | 6/6 `alt` non vides, 0 JPEG dans le document, lien d'évitement localisé |
| SEO technique | **10** | = | 83 URL, 60 documents, `hreflang` réciproque mesuré, sonde stricte code 0 |
| SEO de contenu | **5,5** | = | 45 pages + 23 guides prêts ; **0 offre ouverte** — toutes les villes disent « aucune offre » |
| Internationalisation | **10** | = | 978 clés × 5, 14 scopes, 60 documents conformes |
| Mobile (Capacitor) | **4,5** | = | `versionName 1.0`, build CI vert ; **aucun APK/AAB publié** |
| Paiement | **8,5** | = | circuit `closed`, séquestre et litiges tenus ; **aucune vente exercée** |
| Observabilité | **10** | = | 4 sondes vertes, alerte autonome, erreurs comptées ; le témoin du backend reste lisible sur son origine |
| Tests / CI | **10** | = | 2 500 + 2 811 cas, 12 checks verts, 157 gardes / 301 mutations |
| Confort de développement | **10** | **+0,5** | le garde d'hygiène annonce « aucun résidu » ; arbre propre, 0 PR, 0 issue |
| Qualité des verdicts | **10** | = | le garde `sitemap-vercel` (13 cas) est déclaré, avec **2 mutations rejouées** (#297) |
| **Attractivité** | **4,5** | = | contact canadien + Gmail, 0 avis, 0 offre à montrer ; 5 langues et GA4 présents |
| **Produit / traction** | **3** | = | 0 mission ouverte, 8 clients, 2 travailleurs, 0 avis, 0 vente |

**Moyenne technique (13 domaines) : 9,0 / 10** (117,5 / 13 après #297).
**Moyenne globale (15 domaines) : 8,3 / 10** (125 / 15).
**Score d'ensemble : 9,0 technique / 4,5 attractivité / 3,0 marché.**

Deux mouvements opposés s'annulent exactement : le dépôt gagne 0,5 en tenue
(les résidus de branches sont soldés) et perd 0,5 en qualité de verdict (le
garde le plus récent n'est pas prouvé). La moyenne ne bouge pas parce que le
calcul le dit, pas parce qu'on a arrondi.

---

## 7. Bilan

L'infrastructure est finie. Ce n'est plus une impression : quatre sondes
tournent sur la même révision et rendent 0, le sitemap coûte désormais un
aller-retour d'arête au lieu d'un trajet jusqu'à Francfort, 5 311 cas de test
et 301 mutations tiennent les règles, et le document servi est mesuré dans ses
six langues, ses 60 documents et ses 45 pages.

Le seul chiffre qui n'a pas bougé depuis trois audits est aussi le seul qui
compte : **0 mission ouverte, 0 avis, 0 vente**. Aucun garde ne le répare. Il se
déplace en publiant dix offres réelles, en changeant le numéro de téléphone pour
un numéro que les clients peuvent appeler, puis en demandant un avis à chaque
fin de mission.
