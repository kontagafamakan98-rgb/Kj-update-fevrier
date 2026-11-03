# Audit général de Kojo — 02/11/2026, 23 h 45

Révision auditée : **`a6fb84a3c4`** (fusion de la PR #291), backend Fly et frontend Vercel à jour.
Tout ce qui suit est **remesuré ce soir** : production, CI, arbre de travail, harnais de gardes.

---

## 1. Ce que la production répond

| Mesure | Valeur |
|---|---|
| `/health` | **200** en 0,64 s — `status: healthy`, `database: connected`, révision `a6fb84a3c4` |
| `/sitemap.xml` | **200** en 0,72 s — **83 URL** (`X-Kojo-Urls`), 80 déclarées, 3 vivantes |
| `/api/public/stats` | **200** en 0,47 s — 2 travailleurs, 8 clients, **0 mission ouverte**, 0 terminée, **0 avis**, 4 pays |
| `/metrics` sans jeton | **401** (inchangé) |
| `/` | 200 en 0,49 s, `X-Vercel-Cache: HIT`, 141 507 o |
| `/jobs`, `/how-it-works`, `/en/jobs` | 200 en **0,32 s** (pré-rendus) |
| `/emplois/abidjan`, `/metiers/plomberie`, `/guides/prix-bamako` | 200 en **0,49–0,53 s**, `X-Kojo-Pages-Cache: frais|rejoue` |
| 404 | **404** en 0,42 s, 2 669 o, typographie du site |

### Ce que le document servi contient

- `/` : `lang="fr"`, **6 `hreflang`**, `canonical` absolu, **3 blocs JSON-LD**, **6 `<img>`, 6 avec un `alt` non vide, 0 JPEG, 5 WebP**.
- `/en/jobs` : `lang="en"`, `canonical` `/en/jobs`, titre traduit (« Available Jobs · Kojo »).
- Pages backend : taxes de police **Inter** (corps) et **Cormorant Garamond** (titres), 2 préchargements, 4 fichiers `.woff2` servis.
- `/emplois/abidjan` : « **Aucune offre ouverte à Abidjan pour le moment** » — la page dit ce qu'elle n'a pas mesuré, elle ne décore pas.
- Sitemap : 5 langues × 7 pages avec `x-default` (35 entrées alternatives), **45 pages monolingues** (13 villes, 9 métiers, 23 guides), **1 fiche mission**, **2 profils publics**.

### Les quatre blocs de diagnostic

| Bloc | État | Lecture |
|---|---|---|
| `erreurs` | `ok`, `total: 0` | **neuf ce soir** — compté depuis 23:38:13, portée écrite (compteurs du process) |
| `sentry` | `inactif` | `SENTRY_DSN` absent — limite écrite, plus un angle mort : les erreurs remontent désormais par `/health` |
| `paiement` | `inconnu` | `last_call_at: null` — circuit `closed`, **aucune vente exercée depuis ce déploiement** |
| `ai_gateway` | `inconnu` | `mistralai/mistral-nemo` configuré, **aucun appel depuis 23:38** |
| `langues` | 5 langues, 7 documents chacune, 80 pages déclarées | confronté au sitemap par la sonde `hreflang` : concordant |

---

## 2. Les sondes de production, rejouées ce soir

| Sonde | Verdict | Coût |
|---|---|---|
| `check-seo-production.js --strict` | **code 0** — 20/82 pages conformes (fenêtre 5/5, 62 nommées), 1/1 fiche mission ; GA4 + Search Console présents ; Plausible absent (facultatif) | 1 passe |
| `check-typo-pages-production.js` | **code 0** — 46 pages servent Inter + Cormorant, préchargent, 4 fichiers répondent | 50 requêtes, 13,3 s |
| `check-hreflang-production.js` | **code 0** — 60 documents (12 routes × 5 langues), `lang`/`canonical`/alternatives réciproques, sitemap symétrique, bloc `langues` confronté | 62 requêtes, 14,7 s |
| `check_health_probe.py` | **code 0** — dont la nouvelle ligne `[OK] Erreurs non rattrapées : aucune depuis le démarrage` | 4 requêtes |

Aucune de ces quatre passes ne rapporte un échec. C'est la première fois que les quatre tournent sur la même révision le même soir, et la seule qui aurait pu mentir — la sonde de santé — est aussi celle qui vient d'apprendre à refuser une exception.

---

## 3. CI, harnais, arbre de travail

- **11 checks** sur la tête de PR #291, **tous verts** avant fusion (la livraison refuse un rouge) ; sur le commit de fusion, 9 terminés verts, **E2E et Lighthouse encore en cours** à l'heure de l'audit.
- **2 503 cas backend** collectés en 4,31 s.
- **2 808 cas frontend** (181 fichiers) : **2 805 passés, 2 échecs d'ENVIRONNEMENT** — un test de dépôt `git` réel qui expire à 20 s sur cette machine, et le garde d'hygiène des branches qui **nomme des résidus réels** (voir §4). Aucun n'est un échec de la CI : les deux sont verts sur le run de PR.
- **157 gardes / 300 mutations** déclarés ; **2 mutations neuves** ce soir, rejouées rouges puis restaurées ; **117 fichiers** à leur état de référence.
- **0 issue ouverte, 0 PR ouverte.**

---

## 4. Trois défauts trouvés ce soir

1. **Résidus de branches, nommés par le garde du dépôt.** 5 branches locales dont les commits n'existent dans aucune réf distante (`audit/general-2026-11-02-soir`, `feat/diagnostic-paiement-health`, `fix/health-sitemap-volume`, `fix/heros-repli-jpeg`, `wip/cls-barre`), 2 branches fusionnées à supprimer, 1 réf distante dont l'arbre est identique à `main` (`origin/perf/erreurs-cache-pages-i18n`, fusion par squash). Coût : le test d'hygiène rougit sur le dépôt réel, et le pré-vol de push nomme ces branches à chaque envoi.
2. **Le sitemap n'est pas caché.** 0,72 s à chaque crawl, pour un document dont la déclaration ne change qu'aux publications. Les 45 pages ont reçu leur cache ce soir ; le sitemap, non.
3. **Deux diagnostics restent `inconnu`.** `ai_gateway` et `paiement` ne peuvent passer à `ok` que par un appel réel : aucune vente n'a été exercée et l'assistant n'a pas été appelé depuis le redéploiement. Un `inconnu` honnête, mais qui dit que ces chemins ne sont pas prouvés en production.

---

## 5. Ce qui a changé depuis 22 h

- **Performance 9,5 → 10** : cache mémoire des 45 pages (TTL 60 s, borné, témoin, compteurs), mesuré `rejoue` à 0,34–0,49 s contre 0,65–0,94 s avant.
- **Internationalisation 9,5 → 10** : dette i18n soldée (0 clé, vocabulaire déjà attesté : `nataal`, `ja`, `foto`, `butoŋ`).
- **Observabilité 9,5 → 10** : erreurs non rattrapées comptées, publiées dans `/health` et `/metrics`, refusées par la sonde en nommant classe, famille et date.
- **Confort de développement 10 → 9,5** : les résidus de branches sont un fait mesuré, pas une hypothèse.

---

## 6. Plan proposé, par ordre d'impact

1. **Publier 10 missions réelles** avec des budgets et 2–3 travailleurs : c'est le seul geste qui déplace SEO de contenu (5,5 → 8), produit (3 → 6) et attractivité (4,5 → 7) ensemble, et il remplit les guides (`Aucun budget annoncé` disparaît).
2. **Contact ouest-africain** : numéro Mali/CI et `contact@kojoforafrica.cc.cd` au lieu de `+1 819` et Gmail.
3. **Une vente réelle de bout en bout**, puis remboursement : `paiement.state` passe de `inconnu` à `ok` et PayDunya est exercé pour de vrai.
4. **Poser `SENTRY_DSN`** : cinq minutes, et les erreurs cessent d'être seulement comptées — elles sont groupées, avec trace.
5. **APK signé + fiche Play interne** : `assembleDebug` est vert, rien n'est distribué ; mobile 4,5 → 7.
6. **Nettoyer les résidus de branches** nommés au §4, et cacher le sitemap comme les pages (même module, clé `sitemap`).
7. **Demander un avis aux 8 clients** après chaque mission terminée : 0 avis aujourd'hui, et c'est le seul signal de confiance que la page d'accueil ne peut pas inventer.

---

## 7. Tableau des scores

| Domaine | Note /10 | Δ | Ce qui décide la note |
|---|---:|---:|---|
| Ingénierie backend | **10** | = | `/health` 200 en 0,64 s, base connectée, 2 503 cas collectés |
| Sécurité | **9** | = | `/metrics` 401, CSP (méta stricte + `frame-ancestors` en en-tête), HSTS 2 ans ; `sentry: inactif` |
| Performance | **10** | **+0,5** | pages backend 0,34–0,49 s en `rejoue` (0,65–0,94 avant) ; pré-rendu 0,32 s ; 136 Ko de JS initial |
| Accessibilité | **10** | = | 6/6 `alt` non vides, 0 JPEG dans le document, lien d'évitement et `noscript` localisés |
| SEO technique | **10** | = | 83 URL, 60 documents, `hreflang` réciproque mesuré, sonde stricte code 0 |
| SEO de contenu | **5,5** | = | 45 pages et 23 guides prêts ; **0 offre ouverte** — toutes les villes disent « aucune offre » |
| Internationalisation | **10** | **+0,5** | 978 clés × 5, dette **0**, 14 scopes de page, 60 documents conformes |
| Mobile (Capacitor) | **4,5** | = | `versionName 1.0`, build CI vert ; **aucun APK/AAB publié** |
| Paiement | **8,5** | = | circuit `closed`, `last_call_at: null` : **aucune vente exercée** |
| Observabilité | **10** | **+0,5** | 4 sondes vertes ce soir, alerte autonome, erreurs comptées et refusées ; Sentry reste à poser |
| Tests / CI | **10** | = | 11 checks verts sur la PR, 2 503 + 2 808 cas, 157 gardes / 300 mutations |
| Confort de développement | **9,5** | **−0,5** | le garde d'hygiène nomme 5 branches non publiées, 2 fusionnées et 1 réf distante périmée |
| Qualité des verdicts | **10** | = | 300 mutations, les 2 neuves rejouées rouges ; le garde de contrat qui manquait existe |
| **Attractivité** | **4,5** | = | contact canadien + Gmail, 0 avis, 0 offre à montrer ; 5 langues et GA4 présents |
| **Produit / traction** | **3** | = | 0 mission ouverte (1 en cours), 8 clients, 2 travailleurs, 0 avis, 0 vente |

**Moyenne technique (13 domaines) : 9,0 / 10** (116,5 / 13).
**Moyenne globale (15 domaines) : 8,3 / 10** (124 / 15).
**Score d'ensemble : 9,0 technique / 4,5 attractivité / 3,0 marché.**

Trois notes montent, une baisse : c'est le profil d'un dépôt qui gagne en vitesse et en honnêteté, et qui n'a toujours pas de marché. Le prochain point ne s'obtient pas en réparant un garde — il s'obtient en publiant une offre, puis en demandant un avis.

---

## 8. Corrections appliquées dans la foulée (02/11/2026, après 23 h 45)

Les deux défauts de tenue du dépôt sont traités, et un seul des deux est
mesurable sans redéployer.

**Résidus de branches — corrigé, mesuré.** `git fetch --prune` a retiré de
lui-même la réf distante dont l'arbre était identique à `main` (GitHub supprime
la branche à la fusion). Chaque tête non publiée a été **taguée**
`archive/<branche>` AVANT `git branch -D` — supprimer une branche à commits
uniques sans archive perdrait du travail, et pousser cinq branches mortes pour
satisfaire un garde polluerait le distant. Les tags `archive/audit-general-2026-11-02-soir`,
`archive/feat-diagnostic-paiement-health`, `archive/fix-health-sitemap-volume`,
`archive/fix-heros-repli-jpeg`, `archive/wip-cls-barre` gardent les cinq têtes,
et les deux branches i18n déjà fusionnées sont supprimées. Le cas du garde qui
rougissait (`valide l’hygiène des branches sur le dépôt réel sans erreur`)
**repasse vert**, rejoué à 23:57.

**Sitemap — caché, mêmes règles que les pages.** `/sitemap.xml` passe par
`kojo_pages_cache` (clé `("sitemap", "xml", base)`), avec le corps ET les trois
en-têtes `X-Kojo-Urls*` rendus puis cachés **ensemble** : un en-tête ne peut pas
décrire un autre corps après un rejeu. Témoin `X-Kojo-Sitemap-Cache:
frais|rejoue`, `tests/conftest.py` vide le cache à chaque cas (sinon un test qui
publie une mission lirait le sitemap du précédent), et deux cas neufs le
prouvent — dont « le volume rejoué est celui du corps ». **Et l'invalidation
n'est pas laissée aux routes** : un middleware ASGI vide la famille `sitemap`
sur toute écriture RÉUSSIE sous `/api`. Mesuré en le mettant en place : sans
elle, deux cas existants rougissaient — la purge d'un compte laissait son profil
public une minute de trop (`test_purge_compte_proprietaire.py`) et la
suppression d'une mission laissait sa fiche dans le sitemap
(`test_job_og_cycle.py`). Les deux repassent verts, et les 45 pages gardent leur
minute. Coût de production mesuré après livraison, pas avant.
