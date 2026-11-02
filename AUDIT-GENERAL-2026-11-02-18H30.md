# Audit général — Kojo, 02/11/2026 18 h 30 UTC

**Méthode.** Nouvelle passe, pas une relecture de celle de 16 h 30. Tout ce qui
suit a été mesuré dans l'heure : `GET /health`, `GET /sitemap.xml`,
`GET /api/public/stats`, trois TTFB par route, les trois sondes de production du
dépôt exécutées à la main, la CI de `main`, l'état des workflows planifiés et
leurs derniers runs, et l'arbre de travail. Les chiffres de tests viennent de la
CI sur `ee0f9b59` plus une collecte locale.

---

## 1. Les deux rouges, et l'un des deux n'est pas de la production

`gh issue list --search kojo-sondes-sante` → **issue #278, ouverte**, créée le
01/11/2026 à 14:33, réécrite le 02/11 à 17:28 : **2 sondes sur 19 en échec**.

| Sonde | Ce qu'elle dit | Qui a tort |
|---|---|---|
| `Backend health probe (daily)` | « `/health` se contredit : `pages.total=None` mais `urls_par_langue` totalise 80 » | **la sonde** |
| `Collecte des métriques (daily)` | « acquisition JAMAIS DÉMARRÉE : `kojo_alertes_emploi_plus_recente_timestamp_seconds` vaut 0 » | **le produit** |

### 1.1 La sonde de santé lit un champ supprimé

`/health` sert aujourd'hui :

```json
"langues": { "pages": { "multilingues": 7, "monolingues": 45, "declarees": 80, "vivantes": null },
             "urls_par_langue": { "fr": 52, "en": 7, "wo": 7, "bm": 7, "mos": 7 } }
```

`pages.total` n'existe plus : il a été **renommé** le 01/11 en `declarees` (les
80 pages statiques) + `vivantes: null` (les fiches, que `/health` ne lit pas en
base). Or [check_health_probe.py:278](backend/scripts/check_health_probe.py#L278)
compare encore `pages.get("total")` à la somme des URL : 68 lignes de sonde
accusent donc la production d'une contradiction qui n'existe que dans la sonde.
La sonde est rouge depuis le 01/11 — **un jour entier** —, et l'alerte a nommé
la panne correctement, mais personne n'a suivi : la boucle humaine ne s'est pas
fermée.

C'est exactement la classe de défaut que ce dépôt combat ailleurs (« une prose
qui finit par un nom de fichier n'est pas un chemin ») : **un garde qui n'a pas
suivi sa déclaration juge un autre objet que celui qui est servi**.

### 1.2 La collecte prouve que la veille n'a jamais tourné

`kojo_alertes_emploi_plus_recente_timestamp_seconds = 0` : aucune alerte emploi
datée n'a jamais été créée en production. Ce n'est pas une panne, c'est le
produit qui n'a pas commencé — et la sonde le dit honnêtement. C'est la
deuxième face du chiffre qui commande tout l'audit (§ 3).

---

## 2. Ce qui va bien, re-mesuré ce soir

| Fait | Mesure |
|---|---|
| `/health` | **200 en 0,63 s**, `healthy`, base `connected`, révision `82b70c9c` |
| `ai_gateway` | **`ok`**, modèle `mistralai/mistral-nemo`, `last_success_at` **17:23:50** — premier succès réel mesuré depuis l'incident 429 du 27/10 |
| Sitemap | **83** `<loc>`, `X-Kojo-Urls: 83` = **80 déclarées + 3 vivantes** |
| Documents par langue | **60 conformes** (`lang`, `canonical`, `hreflang` réciproque, `x-default`), sitemap 83 entrées dont 7 pages multilingues — **62 requêtes en 7,2 s** |
| Bloc `langues` de `/health` confronté au sitemap | **concordant** (7 multilingues, 5 langues, 80 déclarées) |
| Typographie | **46 pages** (13 villes, 9 métiers, 23 guides, 404) : Inter au corps, Cormorant aux titres, 4 polices servies — **50 requêtes en 14,3 s** |
| Sonde SEO stricte | **verte** : canonical et hôte conformes, 20/82 pages (fenêtre 5/5), 62 nommées, **1 fiche `/jobs/:id`**, intégrations **3/4** (Plausible facultatif absent) |
| TTFB × 3 | `/jobs` **0,31–0,36 s**, `/en/jobs` **0,31 s**, `/emplois/abidjan` **0,49–0,64 s** |
| CI de `main` | **verte** sur `ee0f9b59` : 15:48 → 16:16, **28 min 3 s**, 12 checks + `deploy-fly` |
| Tests | **2 387 passés**, 48 ignorés (CI) ; **2 468 collectés** en local avec les 26 cas neufs |
| Workflows planifiés | **28** actifs (dont `CI`, `Dependabot` et les passes manuelles) |
| Alerte des sondes | **fonctionne seule** : issue #278 ouverte, empreinte stable, se refermera au vert |

---

## 3. Le chiffre qui commande tout (13ᵉ mesure)

```json
{"workers":2,"clients":8,"open_jobs":0,"completed_jobs":0,"reviews":0,"countries":4}
```

**0 mission ouverte, 0 terminée, 0 avis.** Et depuis ce soir, ce n'est plus une
observation : la sonde des métriques le **prouve** côté acquisition
(`…_plus_recente_timestamp_seconds = 0`). Les 45 pages ville/métier/guide, les
5 langues, les 12 routes pré-rendues, tout cela décrit une place de marché où
l'on ne trouve rien à acheter.

---

## 4. L'arbre de travail n'est pas commité

`git status` : `AGENTS.md` modifié, **4 fichiers non suivis** —
`outils/relecture-i18n/` (l'équipe de relecture), `backend/tests/test_relecture_i18n_crew.py`
(26 cas), `frontend/src/utils/__tests__/i18nLanguePages.test.js` (3 cas), et cet
audit. **La CI ne les exécute donc pas** : le trou de langue des dictionnaires
de page est fermé dans l'arbre, pas sur `main`. Tant que ce n'est pas commité,
aucun point de plus ne peut être compté honnêtement.

---

## 5. Tableau des scores

| Domaine | Note /10 | Δ | Ce qui décide la note |
|---|---:|---:|---|
| Ingénierie backend | **10** | = | `/health` 200, base connectée, 2 387 cas verts, séquestre et litiges tenus |
| Sécurité | **9** | = | `/metrics` 401, CSP stricte, HSTS 2 ans ; jeton en `localStorage`, `sentry: inactif` |
| Performance | **9,5** | = | TTFB 0,31–0,64 s ; pages backend non cachées à l'arête ; 127 Ko de JS |
| Accessibilité | **10** | = | 6/6 `alt`, lien d'évitement et `noscript` dans la langue du document (60 documents) |
| SEO technique | **10** | = | 83 URL, 60 documents, `hreflang` réciproque vérifié, `/health` ↔ sitemap concordants |
| SEO de contenu | **5,5** | = | 45 pages prêtes ; **aucune offre** (13ᵉ mesure) |
| Internationalisation | **9,5** | = | 469/473 clés de page, garde de langue des pages **écrit mais non commité** ; 32 libellés de maillage en français |
| Mobile (Capacitor) | **4,5** | = | `assembleDebug` vert ; **aucun APK publié**, aucun AAB |
| Paiement | **8,5** | = | Circuit `closed`, mais `last_call_at: null` : **aucune vente exercée** |
| Observabilité | **9,5** | **−0,5** | 28 workflows, alerte autonome qui a nommé la panne ; **une sonde rouge depuis un jour sur un champ qu'elle lit encore** |
| Tests / CI | **10** | = | 12 checks verts sur `main` en 28 min ; 26 + 3 cas neufs non commités |
| Confort de développement | **10** | = | Pré-vol non bloquant, backend rejouable (2 468 collectés en 4,1 s) |
| Qualité des verdicts | **9,5** | **−0,5** | Le harnais est borné et les mutations rejouées ; **une sonde accuse la production d'avoir supprimé un champ qu'elle-même lit encore** |
| **Attractivité** | **4,5** | = | Contact canadien, « Chiffres à venir », 10 valeurs françaises en dette déclarée |
| **Produit / traction** | **3** | = | 0 mission, 0 avis, 2 travailleurs, **et la preuve qu'aucune alerte emploi n'a jamais été créée** |

**Moyenne technique (13 domaines) : 8,9 / 10** (115,5 / 13 — contre 9,0 à 16 h 30).
**Moyenne globale (15 domaines) : 8,2 / 10** (123 / 15 — contre 8,3).
**Score d'ensemble : 8,9 technique / 4,5 attractivité / 3,0 marché.**

Un audit qui ne baisse jamais ne mesure rien : cette passe trouve **deux
défauts réels** que celle de 16 h 30 n'avait pas vus (la sonde de santé et la
veille jamais démarrée), et elle ne compte pas les 29 cas neufs tant qu'ils ne
sont pas sur `main`. Les deux baisses viennent du même mot : un garde doit
suivre sa déclaration.

---

## 6. Plan proposé

### 7 jours — ce qui remet la CI d'équerre

1. **Réparer `check_health_probe.py`** : lire `pages.declarees` (et `vivantes`),
   et **ajouter le garde qui manquait** — un test qui compare les champs lus par
   la sonde à ceux que `bloc_langues` publie réellement, pour qu'un renommage ne
   puisse plus rendre une sonde muette ou menteuse. L'issue #278 doit se refermer
   par le vert, pas par une modification manuelle.
2. **Décider pour la collecte des métriques** : soit une alerte emploi réelle est
   créée (et la sonde passe verte), soit sa règle est requalifiée en `notice`
   « acquisition non démarrée », avec le motif écrit — un rouge permanent
   apprend à ignorer les rouges.
3. **Committer** l'outil de relecture et le garde de langue des pages, pour que
   la CI les exécute.
4. **Publier une mission ouverte réelle** : le seul geste qui déplace SEO de
   contenu, produit et attractivité.
5. **Contact ouest-africain** et **seconde ligne des profils** (le métier au lieu
   de « Nouveau profil »).

### 30 jours — ce qui rend le produit meilleur

6. **Faire relire les 469 valeurs** par un locuteur de chaque langue, trancher
   les doutes (37 au dernier comptage) et signer le fichier de revue.
7. **Exercer une vente** de bout en bout (`last_call_at` n'est pas une option).
8. **Poser `SENTRY_DSN`** et une alerte 5xx ; poser `VITE_PLAUSIBLE_DOMAIN`.
9. **Servir les 45 pages ville/métier/guide** sans repasser par le backend à
   chaque requête (cache à l'arête ou build).
10. **Publier l'APK** en artefact de CI, et poser la question de l'AAB signé.

---

*Audit du 02/11/2026, 18 h 30 UTC. Sondes exécutées : `check-hreflang-production.js`
(62 requêtes, 7,2 s), `check-typo-pages-production.js` (50 requêtes, 14,3 s),
`check-seo-production.js --strict` (fenêtre 5/5). Comparé à
`AUDIT-GENERAL-2026-11-02-NUIT.md`.*
