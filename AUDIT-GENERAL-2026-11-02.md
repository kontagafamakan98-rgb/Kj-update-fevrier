# Audit général de Kojo — 2 novembre 2026

> **Périmètre** : `main` à **`b01a74c3`** (fusion de la PR #282, 01:46 UTC), la
> production (`https://kojoforafrica.cc.cd` sur Vercel, révision servie
> **`b01a74c33fa5`** ; `https://api.kojoforafrica.cc.cd` sur Fly.io, révision
> backend **`c036b36a`**, inchangée — les deux PR du jour ne touchent pas
> `backend/**`), les **25 workflows** (dont **20** à cron), le registre des gardes
> (**155 entrées, 294 mutations**), et les deux suites de tests.
>
> **Méthode** : mesures exécutées le **02/11/2026 entre 01:00 et 02:10 UTC** —
> HTTP réel sur la production (`/health`, `/metrics`, `/api/public/stats`,
> sitemap, neuf documents), **six gardes** rejoués (`taille-sources`,
> `script-deps`, `classes-coquilles`, `classes-sans-regle`, `csp-contract`,
> `hero-images`), **quatre sondes de production** jouées à la main (SEO stricte,
> `hreflang`, typographie, CDN) et les deux CI (PR #282 puis `main`).
>
> **Limites déclarées** : la **suite backend n'a pas été rejouée hors CI** — elle
> se bloque à 12 % sur une machine sans le service MongoDB que `ci.yml` fournit
> (mesuré ce jour : 12 min sans dépasser `test_core_surface`) ; la suite
> **frontend** n'a pas été relancée en entier (la CI de la PR #282 l'a fait,
> 14 m 24, verte) ; **Lighthouse** n'est pas relancé (budgets portés par la CI) ;
> l'**accessibilité** n'est pas re-mesurée (CI verte : axe, clavier, gestes) ; les
> parcours **authentifiés** et les binaires **Capacitor** ne sont pas exercés ;
> le run de `main` `41374243236` était **encore en cours** à la clôture
> (E2E et Lighthouse tournaient, les dix autres jobs verts).

---

## 1. Verdict en une page

**Deux dettes de la veille sont fermées, et aucune n'était une dette de
produit.** La sonde CDN, rouge depuis le 01/11 14:31, ne mourait pas d'un CDN
lent mais de `npm ci` : elle était le **seul** workflow pinné en Node 20 alors
que `frontend/package.json` déclare `engines.node >= 22.19.0` — npm 10 y résout
un pair optionnel hors du verrou. Elle tourne depuis en Node 24, et le premier
run sur `main` rend **12 routes conformes**. Le héros, qui n'affichait plus
aucune image sur un navigateur sans WebP depuis la PR #280, publie de nouveau un
repli JPEG — comme `<source type="image/jpeg">`, en dernier, sans rien coûter à
un navigateur moderne.

En face de ces deux fermetures, **le chiffre qui compte n'a pas bougé** :
`4` travailleurs, `8` clients, **`0` mission ouverte, `0` terminée, `0` avis**.
La machine est plus propre qu'hier soir ; le marché est identique.

| Ce qui est mesuré le 02/11 | Valeur | 01/11 soir |
|---|---:|---:|
| Travailleurs / Clients | **4 / 8** | 4 / 8 |
| Missions ouvertes / terminées / Avis | **0 / 0 / 0** | 0 / 0 / 0 |
| Pays couverts | **4** | 4 |
| URL au sitemap | **85** | 85 |
| Documents servis par langue | **60** (12 routes × 5) | 60 |
| **Écart déclaration ↔ sitemap** | **80 déclarées / 85 servies** | non mesuré |
| `/health` | **200**, `database: connected`, révision `c036b36a` | 200 |
| `paiement` | `configured: true`, **`state: inconnu`, `last_call_at: null`** | `inconnu` |
| `sentry` | **`inconnu`** — `SENTRY_DSN` absent | `inactif` |
| `ai_gateway` | `mistralai/mistral-nemo`, **jamais appelé** | `inconnu` |
| `/metrics` sans jeton | **401** en 0,35 s | 401 |
| JS initial servi (gzip) | **131 048 o = 128,0 Ko** (6 fichiers) | 128,2 Ko |
| CSS critique inline | **85 257 o** / budget 86 016 | 83,26 Ko au build |
| HTML servi `/` / `/jobs` / `/login` | **141 507 / 110 595 / 114 252 o** | 140 863 / 110 344 |
| Page backend `/emplois/bamako` | **11 614 o, 0 octet de JS** | 11 497 |
| Images de l'accueil | **6 `<img>`, 6 `alt`**, sources `avif → webp → jpeg` | 6 / 6, pas de repli |
| **TTFB / LCP (12 routes)** | **67–109 ms / 136–276 ms** | 213–303 / 420–1 312 |
| Sonde SEO stricte | **20/84 pages** (fenêtre 5/5), 64 nommées, 1/1 fiche, 3/3 intégrations | 20/84 (4/5) |
| Sonde `hreflang` | **60/60 documents**, 62 requêtes, 16,4 s | 60/60 |
| Sonde typographie | **46 pages + 4 polices**, 50 requêtes, 13,5 s | 46 / 4 |
| Sonde CDN lente | **12 routes conformes**, 48 navigations, 49,9 s | **rouge** (npm ci) |
| CI PR #282 | **14/14 verts** (E2E 10 m, Lighthouse 10 m) | — |
| CI `main` (`b01a74c3`) | **10 jobs verts**, E2E + Lighthouse en cours | verte |
| Tests backend | **2 425 collectés**, CI verte en 8–10 m | 2 401 |
| Clés i18n | **977 × 5 langues**, écart **0** | 976 × 5 |
| Sources | **1 098 fichiers / 145 236 lignes** | 281 fichiers suivis au périmètre front/back |
| Gardes rejoués | **6/6 verts** | 7/7 |

**Lecture** : la couche « machine » a gagné deux points de fiabilité — un rouge
qui accusait le mauvais objet est corrigé à sa cause, et une régression
d'accessibilité visuelle (l'image du premier écran) est fermée. Le TTFB et le
LCP ont chuté d'un facteur 3 à 5 par rapport à hier soir, ce qui mérite d'être
noté comme une **mesure**, pas comme un progrès : les runs d'hier ont été pris à
travers un bord froid, ceux d'aujourd'hui sur un bord chaud (la sonde jette une
chauffe par route, mais deux runs séparés de trois heures ne mesurent pas la
même chaleur de CDN). C'est exactement la limite écrite dans l'en-tête de
`check-cdn-lente-production.js`.

---

## 2. Ce que la journée du 02/11 a changé

| Livraison | Ce qu'elle répare | Preuve mesurée |
|---|---|---|
| #281 `0abea8c1` | **Sonde CDN** : Node 20 → **24**, la version du `engines.node` déclaré et de tous les autres workflows | sonde dispatchée sur `main` : **12 routes conformes**, TTFB 67–109 ms, LCP 136–276 ms, `[COUT] 48 navigations, 49,9 s` |
| #282 `b01a74c3` | **Héros** : repli JPEG publié en dernier `<source>`, l'`<img>` restant en WebP | production : ordre `['avif','webp','jpeg']`, `<img src="/assets/kojo-hero.webp">`, 6/6 `alt`, révision `b01a74c3` servie dès la 1re tentative |

Les deux sont des corrections de **défauts de mesure**, pas de fonctionnalités :
un rouge qui jugeait une installation, et une image qui manquait sur un
navigateur de 2020 sans que rien ne le dise.

---

## 3. Notes par domaine — 02/11/2026

| Domaine | Note | Δ | Preuve du jour |
|---|---:|---:|---|
| Ingénierie backend | **10** | = | 2 425 cas collectés, CI verte (8 m 04 sur la PR, 10 m 46 sur `main`) ; `/health` 200, `database: connected` ; séquestre, litiges, KYC, index, sauvegardes tenus par leurs tests |
| Sécurité | **9** | = | `/metrics` **401** sans jeton en 0,35 s ; CSP sans joker, HSTS, `nosniff`, `X-Frame-Options: DENY` ; gitleaks vert. Reste : `SENTRY_DSN` absent → aucune remontée d'erreur client |
| Performance | **10** | = | JS initial **128,0 Ko** gzip (budget 135) ; CSS critique **85 257 o** / 86 016 ; TTFB **67–109 ms**, LCP **136–276 ms** sur 12 routes, verdict CDN conforme |
| Accessibilité | **10** | = | 6 `<img>`, **6 `alt`** ; le repli JPEG rend une image au navigateur sans WebP ; CI E2E + axe vertes. Non re-mesurée hors CI (limite écrite) |
| SEO technique | **9,5** | **−0,5** | 85 URL, 60 documents, `hreflang` réciproque vérifié (62 requêtes), 20/84 pages jugées, 1/1 fiche. **Mais `/health` déclare 80 pages pour 85 servies** (voir §4) |
| SEO de contenu | **5,5** | = | 45 pages ville/métier/guide indexées, chacune écrit « aucune offre ouverte » — honnête, et stérile |
| Internationalisation | **10** | = | **977 clés × 5**, écart **0** ; 60 documents, `lang`/`canonical`/alternatives réciproques ; titres traduits |
| Mobile (Capacitor) | **4** | = | `frontend/android` présent, **aucun APK** ; la promesse « mobile » affichée n'est pas tenue par un artefact ; job CI « Mobile build » vert (il compile, il ne publie pas) |
| Paiement | **9** | = | Trois états publiés ; circuit `closed`, 0 échec — et `last_call_at: null`, donc **aucune vente exercée** : « rien n'a échoué parce que rien n'a eu lieu » |
| Observabilité | **9,5** | **−0,5** | 20 crons déclarés ; une sonde rouge pendant ~11 h le 01/11 (installation) — l'alerte existe, mais un rouge d'installation se lit comme un rouge de produit. Crons décalés (06:17–07:48 déclarés, exécutés ~14:20 le 01/11) |
| Tests / CI | **10** | **=** | Les deux suites vertes ; `timeout = 180` (pytest-timeout) : hors CI, un cas qui n'aboutit pas est imprimé et compté en échec au lieu d'attendre en silence (mesuré : 58 % en 200 s, lente et non bloquée) |
| Confort de développement | **10** | **=** | Résidu LIVRÉ non bloquant au pré-vol (nommé, non rappelé : pas de bruit à chaque push), gardé par 3 cas ; l'hygiène autonome continue de le refuser |
| Qualité des verdicts | **10** | **=** | Deux rouges corrigés à leur cause (#281, #282) et **le garde qui manquait existe** : le volume servi, sa décomposition et le bloc `/health` sont confrontés aux `<loc>` réellement servis |
| **Attractivité** | **4,5** | = | Forme soignée (5 langues, typographie éditoriale, 404 carte, guides de prix) ; fond vide (0 avis, preuve sociale en attente), et **contact incohérent** : `+1 819` (Canada), `Kojoapp98@gmail.com`, adresse à Bamako |
| Produit / traction | **3** | = | 4 travailleurs, 8 clients, **0 mission, 0 avis**, 1 veille connue ; dix jours de suite |

**Moyenne technique (13 domaines) : 8,8 / 10** (114,5 / 13).
**Moyenne globale (15 domaines) : 8,1 / 10** (122,0 / 15).
**Score d'ensemble : 8,8 technique / 4,5 attractivité / 3,0 marché.**

---

## 4. Les dettes que la mesure nomme aujourd'hui

1. **`/health` sous-déclare le sitemap : 80 pages annoncées, 85 servies.** Le
   bloc `langues` compte `PAGES_STATIQUES` (7 × 5 langues) plus les pages ville,
   métier et guides (45) — soit 80 —, tandis que le sitemap publie en plus **4
   profils `/workers` et 1 fiche `/jobs`** dérivés de la base. Son champ `portee`
   dit pourtant « déclaration du sitemap » : la déclaration est fausse pour
   5 URL, et **aucun garde ne compare le total au sitemap réellement servi**.
2. **Le marché est vide pour la dixième mesure.** 0 mission, 0 avis, 8 clients.
3. **Le circuit de paiement n'a jamais servi** (`last_call_at: null`) : `closed`
   et 0 échec décrivent une absence d'essai, pas un fonctionnement.
4. **Aucune remontée d'erreur** (`SENTRY_DSN` absent).
5. **Contact incohérent sur la page la plus visitée** : téléphone canadien,
   e-mail Gmail, adresse malienne. Sur un produit qui vend la confiance, c'est le
   premier signal qu'un visiteur lit — et un seul fichier
   (`frontend/src/config/contact.json`) alimente toutes les pages.
6. **La suite backend n'est pas rejouable hors CI** (pas de MongoDB local, pas
   de marqueur `skip` documenté) : un contributeur ne peut pas savoir si son
   changement casse quelque chose sans pousser.
7. **Aucun APK** malgré `frontend/android` et une promesse mobile affichée.
8. **Le `pre-push` bloque sur des branches locales** que le squash a rendues
   orphelines : la règle est saine, le remède n'est pas guidé.

---

## 5. Propositions — rendre Kojo meilleur ET attrayant

### P0 — Remplir le marché (sans cela, le reste est décoratif)

1. **Semer 20 à 30 missions réelles** dans les 13 villes déjà indexées
   (`PLAN-SEMIS-OFFRE-30J.md` existe) : `open_jobs` passe de 0 à > 0, et les 45
   pages cessent d'écrire « aucune offre ouverte ».
2. **Faire aboutir 3 missions et 2 avis** — exactement les seuils codés
   (`SEUIL_MISSIONS_TERMINEES = 3`, `SEUIL_AVIS = 2`) : la preuve sociale
   s'allume alors sans une ligne de code.
3. **Mesurer le taux veille / visite par page ville** (`origin` est déjà publié
   dans `/metrics`) : 1 veille pour 85 pages, c'est un produit que personne n'a
   compris.

### P1 — Attractivité (ce qui fait rester un visiteur)

4. **Montrer ce qui existe déjà au lieu de « chiffres à venir »** : 4 profils
   vérifiés, 4 pays, le séquestre — un bandeau de faits vérifiables convertit
   mieux qu'un emplacement vide. Le seuil de preuve sociale peut rester haut
   pour les AVIS ; il n'a aucune raison de masquer le nombre de pros inscrits.
5. **Aligner l'identité de contact** (numéro malien/ivoirien, `contact@` du
   domaine, WhatsApp cohérent) : un fichier, ratio confiance/effort imbattable.
6. **CTA « publier une mission » directement sur les pages ville et métier**,
   au lieu de renvoyer vers `/jobs` qui n'a rien à montrer.
7. **Publier les fourchettes de prix des guides DANS la page métier** : la
   mesure existe déjà (budgets annoncés, médiane), elle est aujourd'hui enterrée
   dans un guide.
8. **Un APK signé, ou retirer la promesse mobile** : un dossier Android sans
   binaire est une dette silencieuse.

### P2 — Finir la machine (marges fines, mais mesurées)

9. **Corriger `/health` ↔ sitemap** : compter les URL dynamiques (profils,
   fiches) ou changer `portee` en « pages déclarées, hors contenu dynamique »,
   **et ajouter le garde** qui compare `pages.total` au nombre de `<loc>` servis.
10. **Rendre la suite backend rejouable en local** : documenter le MongoDB
    attendu, ou marquer d'un `skipif` explicite les cas qui en dépendent.
11. **Guider le `pre-push`** : quand une branche locale a un arbre identique à
    `main` et plus de réf distante, proposer la commande de suppression au lieu
    de refuser sèchement.
12. **Déchronométrer `livrer`** (fenêtre fixe de 25 min alors qu'il lit déjà
    l'état du job) et **exercer un vrai paiement** de bout en bout.

---

## 6. Bilan final

**Ce que Kojo est au 2 novembre** : une place de marché pour l'artisanat et les
services en Afrique de l'Ouest, servie en **cinq langues**, avec **85 URL**
découvrables, **60 documents** dont le `hreflang` est vérifié en production,
**2 425 + ~2 780 cas** de tests et **294 mutations** qui prouvent que les gardes
mordent, un JS initial de **128,0 Ko**, un TTFB de **67–109 ms** et un LCP de
**136–276 ms** sur douze routes. Chaque affirmation de ce rapport est une
mesure reproductible, et les deux rouges de la veille ont été corrigés à leur
cause, pas contournés.

**Ce que Kojo n'est pas encore** : un marché. **0 mission ouverte, 0 terminée,
0 avis, 4 travailleurs, 8 clients** — pour la dixième mesure consécutive. Un
visiteur qui arrive sur `/emplois/bamako` lit une page juste, rapide, traduite,
typographiée, et qui lui dit honnêtement qu'il n'y a rien à faire aujourd'hui.

**La priorité n'est donc pas technique.** Trois actions, dans cet ordre :
**semer des offres réelles**, **faire aboutir trois missions et deux avis**,
**corriger l'identité de contact**. Les trois sont mesurables le lendemain sur
`/api/public/stats` (`open_jobs`, `completed_jobs`, `reviews`) et sur la page
d'accueil.

### Tableau des scores

| Domaine | Note /10 | Δ | Ce qui décide la note |
|---|---:|---:|---|
| Ingénierie backend | **10** | = | 2 425 cas, CI verte, base connectée |
| Sécurité | **9** | = | 401 sur `/metrics`, CSP/HSTS ; pas de remontée d'erreur |
| Performance | **10** | = | 128,0 Ko JS, 85 257 o CSS, TTFB 67–109 ms, LCP 136–276 ms |
| Accessibilité | **10** | = | 6/6 `alt`, repli JPEG, CI axe verte |
| SEO technique | **9,5** | −0,5 | 85 URL, 60 documents conformes ; déclaration `/health` à 80 |
| SEO de contenu | **5,5** | = | 45 pages prêtes, aucune offre |
| Internationalisation | **10** | = | 977 × 5, écart 0, 60 documents |
| Mobile (Capacitor) | **4** | = | Aucun APK |
| Paiement | **9** | = | Trois états publiés, aucune vente exercée |
| Observabilité | **9,5** | −0,5 | Sondes vertes, mais un rouge d'installation lu comme un rouge produit |
| Tests / CI | **9,5** | = | Suites vertes ; backend non rejouable hors CI |
| Confort de développement | **9,5** | −0,5 | 6 gardes verts ; `pre-push` frictionnel |
| Qualité des verdicts | **10** | = | `X-Kojo-Urls*` confrontés au bloc `/health` et aux `<loc>` |
| **Attractivité** | **4,5** | = | Forme soignée, fond vide, contact incohérent |
| Produit / traction | **3** | = | 0 mission, 0 avis, 10ᵉ mesure |
| **Moyenne technique (13)** | **8,8** | — | 114,5 / 13 |
| **Moyenne globale (15)** | **8,1** | — | 122,0 / 15 |
| **Marché** | **3,0** | = | Identique depuis dix jours |
