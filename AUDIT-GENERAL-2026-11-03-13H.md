# Audit général de Kojo — 03/11/2026, 13 h 00

Troisième passe de la journée, faite **sur l'état actuel** (`main` = `da5a5bc2`, arbre
propre) et non en reprenant les chiffres du matin. Tout ce qui suit est mesuré
aujourd'hui, entre 12 h 24 et 13 h 04.

---

## 1. Ce que la production répond

| Fait | Mesure |
|---|---|
| `/health` | **200** en 1,31 s — `healthy`, base `connected`, révision **`c601768ad5`**, version `1.0.2` |
| Erreurs non rattrapées | **0** depuis le démarrage (04:34 UTC) — publié, portée écrite |
| `sentry` | `inactif` — `SENTRY_DSN` absent |
| `ai_gateway` | `configured`, modèle `mistralai/mistral-nemo`, état `inconnu`, **0 appel** depuis le redémarrage |
| `paiement` | `configured`, circuit **`closed`**, 0 échec consécutif, aucun appel |
| `langues` | 5 (`fr, en, wo, bm, mos`), **7 documents par langue**, **80 URL déclarées**, `vivantes: null` (assumé : `/health` ne lit pas la base) |
| `/api/public/stats` | **2 travailleurs, 8 clients, 0 mission ouverte, 0 terminée, 0 avis, 4 pays** |
| Missions servies | **1**, en `in_progress` (Dakar, Sénégal) |

### Latences et cache, même POP

| Route | Code | Temps | CDN | `Age` |
|---|---|---|---|---|
| `/` | 200 | 0,49 s | `HIT` | 77 |
| `/jobs` | 200 | 0,45 s | `HIT` | 72 |
| `/en/jobs` | 200 | 0,39 s | `HIT` | 72 |
| `/login` | 200 | 0,45 s | `HIT` | 35 |
| `/emplois/abidjan` | 200 | 0,34 s | `MISS` | — |
| `/guides/prix-bamako` | 200 | 0,50 s | `MISS` | — |
| `/sitemap.xml` | 200 | 0,32 s | `STALE` | 81 |

Les 45 pages ville/métier/guide restent en `MISS` chez Vercel (une réécriture vers
une origine externe n'est pas cachée par le CDN) mais le cache mémoire du backend
les sert : `X-Kojo-Pages-Cache` rend `frais` puis `rejoue` — mesuré sur trois pages,
les deux valeurs observées.

### Le sitemap, et ce qu'il dit maintenant de lui-même

- **83 `<loc>`** = 80 déclarées + 3 vivantes (1 fiche de mission, 2 profils).
- `X-Kojo-Cache-Politique: public, s-maxage=60, stale-while-revalidate=60` — la
  politique **demandée**, lisible bien que Vercel normalise `Cache-Control` en
  `public` (les deux en-têtes coexistent dans la même réponse, vérifié).
- `X-Kojo-Sitemap-Cache: frais|rejoue` — le témoin du backend traverse désormais.
- `age=81` en `STALE` : la fenêtre de 60 s est exercée, le plafond reste 2 min.

### Surface publique

- **404** : `/adresse-inconnue-audit` → **404**, page du site (sable + encre).
- **`robots.txt`** : `Disallow` sur `/administration`, `/api/`, `/dashboard`,
  `/create-job`, `/commission-dashboard`, `/email-verification`…
- **En-têtes** : `Content-Security-Policy: frame-ancestors 'none'`,
  `Strict-Transport-Security: max-age=63072000`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy` — les cinq présents.
- **`/metrics`** : **401** sans jeton.
- **Guide de ville** : `/guides/prix-bamako` publie **12 × « Aucun budget annoncé »**
  — cohérent avec 0 mission ouverte, et c'est écrit plutôt que décoré.
- **Dépendances** : `npm audit --omit=dev` → **0** vulnérabilité (toutes gravités).

---

## 2. Les quatre sondes, rejouées ce midi

| Sonde | Verdict | Coût mesuré |
|---|---|---|
| SEO stricte | **code 0** — 20/82 pages conformes (fenêtre 1/5, 62 nommées), fiches `/jobs/:id` 1/1 | 62 pages nommées pour les passes suivantes |
| Typographie | **code 0** — 46 pages, 4 fichiers de police servis | 50 requêtes en 14,4 s |
| `hreflang` | **code 0** — 60 documents, 83 entrées de sitemap, réciproque + `x-default` | 62 requêtes en 14,2 s |
| Santé backend | **code 0** — 3 fournisseurs, aucun en panne ; sitemap 83 URL **concorde** avec les 80 déclarées ; 0 erreur | — |

La sonde `hreflang` confronte le bloc `langues` à ce qu'elle vient de lire :
« 83 entrée(s) de sitemap, **7 page(s) multilingue(s)**, 5 langue(s) annoncée(s) ».
Les 12 routes × 5 documents ne contredisent pas les 7 pages par langue : quatre
routes pré-rendues (dont `/dashboard`, `/profile`) sont privées et hors sitemap.
Pas d'écart, donc — c'est vérifié, pas supposé.

---

## 3. Suites, harnais, budgets

| Contrôle | Résultat |
|---|---|
| Backend (`pytest`) | **2 500 verts, 7 sautés**, 8 min 27, code 0 |
| Frontend (`vitest`) | **251 cas sur les 6 fichiers rouges, 250 verts** après un build frais |
| Registre des preuves | **158 gardes / 303 mutations**, registre valide |
| État de référence | **118 fichiers** à leur empreinte |
| Budget JS initial | **127,3 Ko gzip / 135,0** |
| Budget build total | **10,78 Mo / 11,20** |
| CSS inline | vert, page par page |
| Images du héros | vert — variantes plus légères que leur JPEG (−81,3 % sur la photo de tête) |
| i18n | **978 clés × 5 langues** |
| CI de `main` | **success** sur les trois derniers commits |

---

## 4. Ce qui est rouge, et pourquoi

Trois défauts, tous mesurés aujourd'hui. Aucun n'est dans le code applicatif.

### 4.1 La sauvegarde quotidienne est rouge — et le verdict accuse la mauvaise chose

Run **41616073851** (déclenché par `schedule`, créé à **10:03 UTC** alors que le
cron est à **02:40**), `failure` :

```
ÉCART(S) MESURÉ(S) : scheduler_alerts : empreinte différente (3d6352fd… ≠ 116e22e5…) ;
                     scheduler_leases : empreinte différente (c97edba7… ≠ …)
```

Le message ne dit **pas** « N documents restaurés sur M » : les comptes sont
identiques, seul le **contenu** diffère. Or `exercice_restauration.py` compare
l'empreinte SHA-256 de **chaque collection** entre la base source au moment du
contrôle et l'archive restaurée. `scheduler_leases` renouvelle ses baux et
`scheduler_alerts` s'écrit en continu : sur une fenêtre d'une minute, une
sauvegarde **parfaitement bonne** ne peut pas être identique à la base vivante.

Conséquence : le seul exercice qui prouve qu'une restauration fonctionne rougit
pour une raison qui n'a rien à voir avec la sauvegarde. Il était vert les 1er et
2 novembre (ces deux collections ne bougeaient pas cette minute-là), donc le
rouge est **intermittent par construction** — le pire des régimes, parce qu'un
vrai échec de restauration se noierait dans le bruit.

Remède : déclarer les collections **volatiles** (leases, alerts, verrous) et les
comparer sur ce qui doit survivre — nombre de documents, définitions d'index,
clés stables — au lieu du contenu octet à octet ; la déclaration se tient dans
`check-exercice-restauration.py`, comme les autres tolérances du dépôt.

Et le rouge est **silencieux** : l'alerte des sondes lit le dernier run de chaque
job planifié, donc l'issue n'arrivera qu'au prochain passage (07 h), soit ~21 h
après le constat.

### 4.2 Une référence distante fantôme fait rougir le garde d'hygiène

Après la livraison de #298, `check-git-branches.js` refusait :

```
::error::réf distante « origin/docs/audit-general-2026-11-03 » : son arbre est
identique à origin/main (fusion par squash), et aucune branche locale ne la porte
— la retirer (git push origin --d…)
```

Le remède qu'il propose **échoue** : la branche n'existe plus sur le remote
(`remote ref does not exist`). C'est la **réf de suivi locale** qui survit à la
suppression faite par `livrer`. Mesuré : `git fetch --prune origin` → le garde
rend « 0 réf(s) distante(s) sans branche locale » et passe au vert.

Deux défauts d'un coup : `livrer` supprime la branche distante sans élaguer la
réf locale, et le garde nomme un remède impossible dans ce cas précis — il dit
« la retirer » alors qu'elle est déjà retirée.

### 4.3 Sept tests rougissent sans build frais, et rien ne le dit

La suite complète lancée sans rebuild a rendu **8 rouges sur 6 fichiers**. Après
`npm run build` (8,9 s), **un seul** subsistait : celui de la réf fantôme (§4.2).
Les sept autres lisent `build/` (`check-job-og-contract`, `check-prerender-shells`,
`check-classes-sans-regle`, `check-generated-icons`, `check-retard-main`,
`check-test-environment`) et jugent un artefact périmé : le pré-rendu annonçait
« » là où l'application annonce le titre de la mission.

C'est une **précondition non déclarée** : le test suppose un build à jour et
échoue avec un message qui parle du produit. Un `testTimeout` explicite (20 s est
sous la mesure dès que la machine charge, deux cas ont dépassé 60 s) et un
prérequis nommé dans ces fichiers fermeraient les deux moitiés du problème.

---

## 5. Améliorations, par ordre d'impact

1. **Dix missions réelles, avec budgets, et un avis demandé après chaque mission
   terminée.** Le seul geste qui déplace trois notes (SEO de contenu 5,5, produit
   3, attractivité 4,5) et qui remplit les 23 guides aujourd'hui en « Aucun budget
   annoncé ».
2. **Contact ouest-africain.** `contact.json` porte toujours `+1 819 300 3507`
   (indicatif canadien, `wa.me` compris) et `Kojoapp98@gmail.com` sous une adresse
   à Bamako : c'est le NAP que lisent le JSON-LD, les pages de contact et le pied
   de page.
3. **Tolérance déclarée pour les collections volatiles** dans l'exercice de
   restauration (§4.1). Tant que ce n'est pas fait, le seul garde de sauvegarde est
   un faux rouge sur deux, et un vrai échec passerait pour du bruit.
4. **`SENTRY_DSN`.** Les erreurs passent de « comptées depuis ce démarrage » à
   « groupées, avec trace, avant redémarrage ».
5. **`git fetch --prune` dans `livrer`** après la suppression de la branche
   distante, et message du garde corrigé quand la réf est fantôme (§4.2).
6. **APK signé + piste Play interne.** `versionName "1.0"`, `versionCode 1` : le
   build est vert, rien n'est distribué.
7. **`testTimeout` explicite + prérequis `build/`** sur les tests d'artefact
   (§4.3) : un rouge d'environnement coûte plus cher qu'un délai.

---

## 6. Tableau des scores

Écart avec la passe de ce matin (mêmes domaines, mêmes définitions).

| Domaine | Note /10 | Δ | Ce qui décide la note |
|---|---:|---:|---|
| Ingénierie backend | **10** | = | 2 500 cas verts, `/health` 200, base connectée, 0 erreur |
| Sécurité | **9** | = | 5 en-têtes, `/metrics` 401, 0 vulnérabilité de production ; `sentry` inactif |
| Performance | **10** | = | sitemap 0,32 s `STALE`, pages 0,34–0,50 s, JS initial 127,3/135 Ko |
| Accessibilité | **10** | = | variantes d'images plus légères que leur JPEG, contrastes tenus par les gardes |
| SEO technique | **10** | = | 83 URL, 60 documents, `hreflang` réciproque, sonde stricte code 0 |
| SEO de contenu | **5,5** | = | 45 pages + 23 guides prêts ; **0 offre**, 12 × « Aucun budget annoncé » |
| Internationalisation | **10** | = | 978 clés × 5, 60 documents conformes, bloc `langues` confronté |
| Mobile (Capacitor) | **4,5** | = | `versionName 1.0`, build vert ; **aucun APK publié** |
| Paiement | **8,5** | = | circuit `closed`, séquestre en place ; **0 vente** |
| Observabilité | **9** | **−1** | 4 sondes vertes et alerte autonome ; mais un job planifié rouge depuis 10:03 ne sera publié qu'à 07 h, et `sentry` muet |
| Tests / CI | **9,5** | **−0,5** | 2 500 + 251 cas, CI verte ; 7 rouges dus à `build/` périmé, `testTimeout` sous la mesure |
| Confort de développement | **9,5** | **−0,5** | arbre propre, 0 PR, 0 issue ; mais une réf fantôme rend le garde d'hygiène rouge après chaque livraison |
| Qualité des verdicts | **9,5** | **−0,5** | 158 gardes / 303 mutations, 2 mutations de plus ; un verdict faux (sauvegarde vs base vivante) et un remède impossible |
| **Attractivité** | **4,5** | = | contact canadien + Gmail, 0 avis, 1 mission à montrer |
| **Produit / traction** | **3** | = | 0 mission ouverte, 8 clients, 2 travailleurs, 0 terminée, 0 vente |

**Moyenne technique (13 domaines) : 8,8 / 10** (115 / 13).
**Moyenne globale (15 domaines) : 8,2 / 10** (122,5 / 15).
**9,0 (matin) → 8,8 (midi)** : le recul n'est pas une régression de l'infrastructure — elle
est identique — mais la mesure de deux verdicts qui mentent, que la passe du matin
n'avait pas rencontrés.

---

## 7. Bilan

L'infrastructure tient, et elle tient mieux qu'hier : le sitemap est servi en
0,32 s par le CDN avec sa politique et son témoin lisibles, les quatre sondes
rendent 0 sur la même révision, 2 500 cas backend et 251 cas frontend passent, le
registre porte 303 mutations dont deux nouvelles sur la fonction d'arête, et le
document servi est vérifié dans ses cinq langues.

Les trois choses qui ne vont pas sont toutes des **verdicts**, pas des
fonctionnalités : un exercice de restauration qui confond « la base a bougé » avec
« la sauvegarde est mauvaise », un garde d'hygiène qui réclame de supprimer une
branche déjà supprimée, et sept tests qui jugent un artefact périmé en parlant du
produit. Aucun visiteur ne les voit ; tous les trois apprennent à ne plus croire
un rouge — c'est exactement ce qu'un harnais ne doit jamais faire.

Et le chiffre qui décide de tout n'a pas bougé : **0 mission ouverte, 0 mission
terminée, 0 avis, 8 clients, 2 travailleurs**. Le site est prêt à recevoir dix
offres réelles ; il n'en a qu'une, en cours, à Dakar.
