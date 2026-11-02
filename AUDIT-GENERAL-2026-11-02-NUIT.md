# Audit général — Kojo, 02/11/2026 (nuit)

**Méthode.** Rien n'est noté qui n'ait été mesuré dans cette passe. Les chiffres
de production viennent de requêtes réelles sur `https://kojoforafrica.cc.cd` et
`https://api.kojoforafrica.cc.cd` (02/11/2026, 16:20–16:30 UTC), plus les trois
sondes de production du dépôt exécutées à la main (`check-hreflang-production`,
`check-typo-pages-production`, `check-seo-production --strict`). Les chiffres de
tests viennent de la CI de `main` sur `ee0f9b59`. Ce qui est **lu** (et non
mesuré) est signalé. Ce qui **n'est pas** jugé est signalé aussi.

---

## 1. Ce qui a changé depuis l'audit du soir (mesuré)

| Fait | Soir | Maintenant | Preuve |
|---|---|---|---|
| Profils de test publics | 4 profils, dont « CI Worker » et un doublon | **2**, disparus du sitemap **et** de la base | sitemap 83 `<loc>`, `X-Kojo-Urls-Vivantes: 3`, `/api/public/stats` → `workers: 2` |
| La CI recrée des comptes publics | possible (défaut = `kojo_db`) | **refus de démarrer** la suite hors base `_test` | `test_isolation_base_de_test.py` (7 cas), PR #285 |
| Lien d'évitement et `<noscript>` | français sur les 61 documents | **dans la langue du document**, sur les 60 documents | `check-prerender-shells` section 10 + 2 refus rejoués ; mesuré sur `/en/jobs` et `/wo/jobs` en production |
| Clés de page traduites (`wo`/`bm`/`mos`) | 166 / 473 | **469 / 473** (4 exceptions déclarées) | `i18nCoverage.test.js`, `/jobs` à 31/31 clés |
| Revue native de ces traductions | ne couvrait pas les dictionnaires de page | **section 02/11 + 9 doutes** ; 11 valeurs françaises corrigées | `src/i18n/alertes-emploi-revue-native.md` |

C'est +2,5 en internationalisation, +0,5 en accessibilité, et le fait de fond qui
valait −0,5 en attractivité.

---

## 2. Constats — ce qui bloque, dans l'ordre

### P0 — ce qui se voit en trente secondes

1. **Aucune mission ouverte.** `open_jobs: 0`, `completed_jobs: 0`, `reviews: 0`
   (API publique, 16:23). C'est la **douzième** mesure consécutive. Tout le reste
   de cet audit tourne autour de ce chiffre : les 45 pages ville/métier/guide
   sont prêtes, honnêtes, et sans offre à montrer. Le plan de semis existe
   (`PLAN-SEMIS-OFFRE-30J.md`) ; il n'est pas exécuté.
2. **La preuve sociale de l'accueil dit encore « Chiffres à venir ».** La règle
   (seuil de 3 missions et 2 avis) est écrite et défendable, mais la première
   phrase de la page la plus stratégique annonce une absence. Un fait mesuré et
   vérifiable (« paiement sous séquestre », « 5 langues », « 45 pages de prix
   publiées d'après les budgets annoncés ») convertit mieux qu'une promesse de
   chiffres futurs.
3. **Le contact public est canadien** : `+1 819 300 3507`, adresse à Bamako.
   Pour un client de Dakar ou Abidjan, c'est le détail qui fait refermer l'onglet.
   Un numéro ouest-africain (ou un WhatsApp seul) ne coûte rien et se vérifie.
4. **La seconde ligne d'un profil public dit « Nouveau profil »** même quand la
   bio est complète (mesuré sur `/workers/9437eed1…` : `h1` « Kojo Plomberie »,
   puis « Nouveau profil », alors que la `<meta description>` porte la vraie
   bio). `worker_meta_lines()` publie ce repli dès qu'il n'y a ni note ni
   mission — c'est-à-dire sur **tous** les profils d'une plateforme qui démarre.

### P1 — la qualité visible, à un cran en dessous

5. **Les 32 libellés du maillage** (`src/config/pages-seo.json`) restent en
   français dans les quatre autres langues : « Plomberie, Électricité… » sur
   `/en/jobs`. Limite déclarée de la livraison du jour, pas un oubli.
6. **Les 469 traductions ne sont pas relues par un locuteur natif.** Statut
   « NON SIGNÉ » assumé ; les neuf doutes sont écrits, personne ne les a tranchés.
7. **Aucune vente exercée.** `/health` → `paiement: { state: "inconnu",
   last_call_at: null }`, circuit `closed`. Trois états publiés, zéro
   transaction : le circuit n'est pas prouvé en production.
8. **Mobile : l'APK est construit, jamais distribué.** Le job
   `Mobile build (Capacitor + Android)` est vert et lance `./gradlew
   assembleDebug`, mais aucun `upload-artifact` ne publie l'APK, et il n'y a ni
   AAB ni signature de release. La promesse mobile n'a pas d'artefact à montrer.
9. **Sentry absent** (`sentry.configured: false`) : une exception backend ne
   remonte nulle part. Le bloc `/health` le dit, ce qui vaut mieux qu'un silence,
   mais ça ne remplace pas une alerte.

### P2 — la dette qui ne se voit pas

10. **`AGENTS.md` fait 337 Ko pour ~250 lignes** (et `CI-COVERAGE.md` 503 Ko).
    Un agent qui le lit consomme des dizaines de milliers de jetons avant la
    première ligne de code ; un humain ne le relit pas. C'est une dette de
    transmission, pas de qualité.
11. **Les pages servies par le backend ne sont pas cachées à l'arête.** Mesuré :
    Vercel réécrit l'en-tête du rewrite externe en `max-age=0, must-revalidate`,
    donc `s-maxage=1800` du backend ne sert à rien chez lui. Écart mesuré ce
    soir : 0,65–0,75 s (pages backend) contre 0,51–0,53 s (statiques) ; à 12:44
    les mêmes pages répondaient en 0,30–0,32 s — la variance réseau domine, mais
    l'écart systématique reste.
12. **`/fr/jobs` répond 404.** L'URL française n'est pas préfixée (choix
    assumé), donc taper le préfixe donne une 404 au lieu d'une redirection.
13. **Le jeton de session vit dans `localStorage`** alors qu'un cookie httpOnly
    existe pour la session. Une XSS lirait le jeton.
14. **Plausible absent** (`VITE_PLAUSIBLE_DOMAIN` non posée) : la sonde SEO le
    dit en `notice`, facultatif, mais il n'y a donc pas de mesure d'audience
    indépendante de GA4.

---

## 3. Ce qui va bien, et qui est mesuré ce soir

- **Sitemap et cohérence** : 83 `<loc>`, `X-Kojo-Urls: 83` =
  `Declarees: 80` + `Vivantes: 3`. Deux profils, une fiche de mission.
- **Internationalisation servie** : 60 documents (12 routes × 5 langues), chacun
  avec son `lang`, son `canonical` et la **même** liste `hreflang` réciproque,
  `x-default` compris — **62 requêtes en 18,0 s**, code 0. Le bloc `langues` de
  `/health` est confronté à ce que la sonde vient de mesurer.
- **Typographie** : 46 pages (13 villes, 9 métiers, 23 guides, la 404) servent
  Inter au corps et Cormorant Garamond aux titres, préchargent leurs fichiers
  (`crossorigin` compris) et les 4 `.woff2` répondent — **50 requêtes en 14,6 s**.
- **SEO technique** : sonde stricte verte, 20/82 pages jugées cette passe
  (fenêtre 5/5 tournante, 62 nommées et reportées), 1 fiche `/jobs/:id`,
  intégrations 3/4 (Plausible facultatif), canonical et hôte conformes, 404
  propre sur une URL inconnue.
- **Accessibilité** : 6 `<img>` / **6 `alt` non vides** sur `/`, contrastes
  gardés par test, lien d'évitement présent et **traduit**.
- **Sécurité** : `/metrics` **401** ; CSP stricte déclarée dans le document
  (`default-src 'self'`, `script-src 'self'` + Google/gtag/PostHog, pas
  d'`unsafe-inline`) ; HSTS `max-age=63072000` ; `nosniff` ;
  `referrer-policy: strict-origin-when-cross-origin`.
- **Volume de tests** : **2 387** backend (48 ignorés) et **2 803** frontend
  (2 ignorés, 180 fichiers) sur la CI de `main` — 12 checks verts + `deploy-fly`,
  **28 min 3 s**.
- **Budgets** : JS initial **127,3 Ko gzip / 135**, CSS **83,26 Ko / 84**, build
  **10,78 Mo / 11,20**.
- **Observabilité** : **20** workflows planifiés, et un `/health` qui publie
  désormais `langues`, `ai_gateway`, `paiement`, `sentry` avec un motif
  actionnable — une panne se nomme au lieu de se deviner.

---

## 4. Tableau des scores

| Domaine | Note /10 | Δ | Ce qui décide la note |
|---|---:|---:|---|
| Ingénierie backend | **10** | = | 2 387 cas verts, base connectée, `/health` 200, séquestre et litiges tenus par leurs tests |
| Sécurité | **9** | = | `/metrics` 401, CSP stricte, HSTS 2 ans, 0 vuln. ; jeton en `localStorage`, Sentry absent |
| Performance | **9,5** | = | 127,3 Ko JS gzip ; TTFB 0,51–0,75 s ce soir (0,30–0,32 s à 12:44) ; pages backend non cachées à l'arête |
| Accessibilité | **10** | **+0,5** | 6/6 `alt` ; lien d'évitement **et** `noscript` dans la langue du document sur les 60 documents |
| SEO technique | **10** | = | 83 URL, 60 documents, `hreflang` réciproque vérifié, `/health` ↔ `X-Kojo-Urls*` confrontés |
| SEO de contenu | **5,5** | **+0,5** | 45 pages prêtes ; les profils de test sont sortis du sitemap (4 → 2) ; **toujours aucune offre** |
| Internationalisation | **9,5** | **+2** | 977 × 5 globales, **469/473** clés de page, `/jobs` à 31/31 ; restent 32 libellés de maillage et la revue native |
| Mobile (Capacitor) | **4,5** | **+0,5** | `assembleDebug` vert en CI ; **aucun APK publié**, aucun AAB, pas de signature de release |
| Paiement | **8,5** | = | Trois états publiés, circuit `closed` — et `last_call_at: null` : **aucune vente exercée** |
| Observabilité | **10** | = | 20 sondes planifiées ; `/health` publie `langues`, `ai_gateway`, `paiement`, `sentry` avec motif |
| Tests / CI | **10** | = | 12 checks verts sur `main`, 2 387 + 2 803 cas, run complet en 28 min |
| Confort de développement | **10** | = | Pré-vol non bloquant, backend rejouable, état de référence déclaré avec motif daté |
| Qualité des verdicts | **10** | = | Deux gardes de plus sur l'artefact (chaînes d'accessibilité, couverture i18n), mutations rejouées |
| **Attractivité** | **4,5** | **+0,5** | Profils de test disparus ; restent « Chiffres à venir », le contact canadien et « Nouveau profil » sur un profil complet |
| Produit / traction | **3** | = | 0 mission ouverte, 0 terminée, 0 avis, 2 travailleurs, 8 clients — 12ᵉ mesure |

**Moyenne technique (13 domaines) : 9,0 / 10** (116,5 / 13 — contre 8,7 au soir).
**Moyenne globale (15 domaines) : 8,3 / 10** (124,0 / 15 — contre 8,0 au soir).
**Score d'ensemble : 9,0 technique / 4,5 attractivité / 3,0 marché.**

### Réserves dites, non déduites dans le tableau

- `AGENTS.md` = 337 Ko, `CI-COVERAGE.md` = 503 Ko.
- `/health` ne publie **aucun état `email`** alors que le mot de passe oublié et
  la veille en dépendent.
- 7 cas frontend expirent **en local** sur ce poste (sous-processus lents), la CI
  ne les voit pas.
- `/fr/jobs` → 404.
- Les 32 libellés du maillage restent français hors `fr`.
- Les traductions `wo`/`bm`/`mos` ne sont pas signées par un locuteur natif.

---

## 5. Plan proposé

### 7 jours — ce qui change la perception

1. **Publier une mission ouverte réelle** (celle du 23/10 est en cours depuis dix
   jours) : c'est le seul geste qui déplace à la fois SEO de contenu, produit et
   attractivité.
2. **Remplacer « Chiffres à venir »** par un fait mesuré, et le tenir : le seuil
   de publication reste la règle, la phrase d'attente devient une affirmation
   vérifiable.
3. **Contact ouest-africain** (numéro ou WhatsApp), adresse inchangée.
4. **Seconde ligne des profils** : publier le métier, pas « Nouveau profil ».
5. **Publier l'APK debug en artefact de CI** (un `upload-artifact` de plus), et
   poser la question de l'AAB signé.

### 30 jours — ce qui rend le produit meilleur

6. **Traduire les 32 libellés du maillage** (champ par langue dans
   `pages-seo.json`, deux rendus à suivre, gardes déjà en place).
7. **Faire relire les 469 valeurs** par un locuteur de chaque langue, trancher
   les neuf doutes écrits, contresigner le fichier.
8. **Exercer une vente de bout en bout** en sandbox, puis en réel : le circuit
   n'est pas prouvé tant que `last_call_at` est `null`.
9. **Poser `SENTRY_DSN`** et une alerte sur les 5xx ; poser
   `VITE_PLAUSIBLE_DOMAIN` pour une mesure d'audience indépendante.
10. **Servir les 45 pages ville/métier/guide depuis le build** (ou derrière un
    cache qui les garde) : c'est le seul vrai levier sur les 0,65–0,75 s.
11. **Découper `AGENTS.md`** en un index court + des fichiers par domaine, pour
    que la connaissance redevienne lisible.

---

*Audit conduit le 02/11/2026 à 16:30 UTC. Les sondes exécutées et leurs coûts
sont dans leurs rapports respectifs ; les scores sont comparés à l'audit du même
jour au soir (`AUDIT-GENERAL-2026-11-02-SOIR.md`).*
