# La refonte en trois PR — le découpage, et ce que chacune prouve

Passation du 22/10/2026. Le travail de refonte est aujourd'hui dans **un seul
arbre non commité**. Ce document le découpe en trois PR livrables séparément,
dans cet ordre, chacune verte toute seule : une PR qui ne peut pas être relue
seule n'est pas une PR, c'est un lot.

Le critère du découpage n'est pas la taille, c'est **ce que la revue peut
juger** : la première PR rend l'accessibilité mesurable (donc jugeable), la
deuxième remplace des chiffres décoratifs par des chiffres mesurés, la
troisième rend visible un travail déjà livré et dit ce qui reste bridé.

---

## PR 1 — « L'accessibilité devient une mesure » (S)

Ce qui manquait : le dépôt mesurait des pixels, des classes et des textes, et
jamais si une page était atteignable au clavier ou lisible par un lecteur
d'écran. L'audit du 22/10/2026 le disait sans détour.

**Périmètre**

- Scan axe (WCAG 2.1 A/AA) dans un vrai Chromium sur les **dix routes
  publiques** ; `serious`/`critical` refusés, `minor`/`moderate` publiés.
- Deux cas qui **injectent** le défaut (image sans `alt`, bouton sans nom) et
  exigent que le même analyseur le trouve — la preuve que le scan mord.
- Lien d'évitement : `#contenu-principal`, libellé lu dans `fr.skipToContent`
  (5 langues), rendu par React **et** par la coquille pré-rendue.
- Parcours clavier : premier arrêt de Tab, activation qui déplace le focus
  dans `main`, tabulation suivante qui y reste — sur `/` et `/jobs`, plus le
  document servi **sans JavaScript**.
- Contraste par **jetons** : `orange-600` → `#c2410c`, `orange-700` →
  `#9a3412`, pastilles d'état et sélection passées en variables, mesurées par
  `scripts/contraste-jetons.js`.
- Note Lighthouse `categories:accessibility` ≥ 0,95 dans le socle mobile
  (`scripts/lhci-cls-budgets.cjs`) : elle ne dépend pas du CPU, donc elle ne
  bénéficie pas du « meilleur des 3 runs ».
- `aria-label="Google Maps"` retiré du lien d'adresse (WCAG 2.5.3 : le nom
  accessible contredisait le texte visible), page **et** coquille.

**Fichiers**

```
frontend/e2e/accessibilite-routes-publiques.spec.js      (neuf)
frontend/e2e/clavier-parcours-public.spec.js             (neuf)
frontend/scripts/contraste-jetons.js                     (neuf)
frontend/scripts/__tests__/contraste-jetons.test.js      (neuf)
frontend/scripts/lhci-cls-budgets.cjs
frontend/scripts/__tests__/lhci-cls-budgets.test.js
frontend/scripts/__tests__/check-app-chrome.test.js
frontend/scripts/__tests__/check-classes-coquilles.test.js
frontend/src/index.css
frontend/src/App.js
frontend/src/config/classes-chrome.js
frontend/vite-plugins/prerender/app-chrome.js
frontend/src/i18n/{fr,en,wo,bm,mos}.json      (skipToContent)
frontend/package.json, package-lock.json      (@axe-core/playwright)
.github/workflows/ci.yml                      (commentaire du job e2e)
AGENTS.md                                     (une puce)
```

**Ce que la revue peut vérifier elle-même**

```
cd frontend && npx playwright test \
  e2e/accessibilite-routes-publiques.spec.js e2e/clavier-parcours-public.spec.js \
  --project=chromium          # 17 passed
cd frontend && npx vitest run scripts/__tests__/contraste-jetons.test.js
```

**Ce qu'elle ne juge pas, écrit** : les routes authentifiées, la matrice des
moteurs (Chromium seul), le rendu visuel, les règles WCAG hors A/AA.

---

## PR 2 — « L'accueil prouve ce qu'il mesure, et le vide a un visage » (S)

Ce qui manquait : la bande de faits du héros ne portait que des constantes
recopiées, et une liste vide se lisait comme une page cassée.

**Périmètre**

- `utils/preuveSociale.js` : la SEULE règle qui décide ce que la bande
  affiche. Un `0` mesuré est publié (`0` reste une mesure), une mesure absente
  laisse le texte déclaré « — », aucun repli chiffré n'existe, et le séparateur
  de milliers appartient à `Intl`, donc à la langue.
- `page-sections.js` : trois entrées de plus (`measuredWorkers`,
  `measuredCompletedJobs`, `measuredReviews`) dont la valeur publiée est « — ».
  La coquille ne peut pas appeler l'API au build : elle publie « pas mesuré
  ici », jamais un chiffre figé qui aurait l'air mesuré.
- `Home.js` lit `GET /api/public/stats` après montage et remplace le tiret
  **dans le même nœud** (même boîte, même classe) : aucun décalage de mise en
  page, aucun squelette. Un échec réseau laisse les tirets, sans erreur d'écran.
- État vide **dessiné** (`Jobs.js`) : pictogramme, phrase, et l'action qui
  existe déjà (`Effacer les filtres`) sous le constat ; l'état vide anonyme
  garde `DemoJobsEmptyState` (exemples + inscription).
- Les clés i18n de cet état (`emptyFiltered`, `emptyHint`, `clearFilters`).

**Fichiers**

```
frontend/src/utils/preuveSociale.js                      (neuf)
frontend/src/utils/__tests__/preuveSociale.test.js       (neuf)
frontend/src/config/page-sections.js
frontend/src/pages/Home.js
frontend/vite-plugins/prerender/shells-home.js
frontend/scripts/__tests__/faits-support.test.js
frontend/src/pages/Jobs.js
frontend/src/utils/pack2PageI18n/jobs.js
frontend/src/pages/__tests__/Jobs.test.jsx
frontend/src/pages/__tests__/home-local-seo.test.jsx
```

**Ce que la revue peut vérifier elle-même**

```
cd frontend && npx vitest run src/utils/__tests__/preuveSociale.test.js \
  scripts/__tests__/faits-support.test.js src/pages/__tests__/Jobs.test.jsx
cd frontend && npm run build && node scripts/check-prerender-shells.js
```

Le second commandement est celui qui compte : la bande doit publier « — » dans
la coquille et un chiffre dans la page montée, **sans** que la géométrie
comparée coquille ↔ React ne bouge.

---

## PR 3 — « Le mobile est bridé, et le verre se voit » (L)

Ce qui manquait : le site a une couche de verre (barre, panneau, toasts,
bandeau de consentement, barre mobile) jugée depuis le 19/10/2026, mais rien ne
la rendait visible dans une revue ; et l'app native exposait un push Web qui
n'arrive jamais dans une WebView.

**Périmètre**

- `MOBILE.md` : ce que le dépôt construit, ce qui est **bridé et pourquoi**
  (tableau), ce qui reste à faire pour le magasin (compte, signature, revue,
  passe sur appareil réel) — c'est-à-dire ce qui ne s'automatise pas d'ici.
- `pushRegistration.js` : `isPushSupported()` retourne `false` dans
  `isNativeShell()` **avant** toute demande de permission. Sans ce bridage, la
  WebView (Chromium) répondait « oui », l'abonnement partait au backend et la
  permission était consommée pour un push qui n'arrive jamais.
- Les surfaces de verre ne sont pas re-créées : elles sont **nommées** là où
  elles vivent, et leur contraste reste mesuré par `verre-contraste.js` (le
  pire cas composé au-dessus du sable ET de l'encre).

**Fichiers**

```
frontend/MOBILE.md                                       (neuf)
frontend/src/utils/pushRegistration.js
frontend/src/utils/__tests__/pushRegistration.test.js    (neuf)
```

**Ce que la revue peut vérifier elle-même**

```
cd frontend && npx vitest run src/utils/__tests__/pushRegistration.test.js \
  scripts/__tests__/verre-contraste.test.js
```

**Ce qui reste hors du dépôt, écrit** : la publication en magasin (compte
développeur, signature, fiche, revue Apple/Google) et la passe sur un appareil
physique. Aucune des deux ne peut être prouvée par une CI.

---

## Ordre, dépendances, et ce qui n'est PAS dans ces trois PR

1. **PR 1 d'abord** : elle installe la mesure. Les deux suivantes arrivent donc
   avec un filet déjà tendu (axe, clavier, contraste, note Lighthouse), et une
   régression visuelle se voit dans la PR qui la cause.
2. PR 2 et PR 3 sont indépendantes entre elles. PR 2 touche l'accueil et la
   liste ; PR 3 touche le mobile et le push.
3. L'arbre actuel porte aussi du travail qui **n'appartient à aucune des trois
   PR** et doit voyager séparément (il a ses propres gardes, déjà vertes) :
   inscription sans compte de paiement (`kojo_validation.py`,
   `kojo_routers_auth.py`, `EmailVerificationPage.js`, `Dashboard.js`),
   recherche et tri des missions (`kojo_routers_jobs_listing.py`,
   `kojo_recherche_missions.py`, `useJobsData.js`, `publicJobsPrefetch.js`,
   `kojo_db.py`), rayon géographique (`test_public_radius.py`), et les puces
   `AGENTS.md` correspondantes. Les mélanger à la refonte rendrait chaque PR
   relue pour deux sujets à la fois.

## Relevés du 22/10/2026 (ce qui a réellement tourné)

| Commande | Résultat |
| --- | --- |
| `npx playwright test … --project=chromium` (les deux specs d'accessibilité) | **17 passed** — 10 routes, 2 preuves d'injection, 5 cas clavier |
| `npx vitest run …/contraste-jetons, verre-contraste, preuveSociale, faits-support, pushRegistration, i18n*` | **45 passed** |
| `npx vitest run check-app-chrome, check-classes-coquilles, lhci-cls-budgets, check-css-inline-budget` | **93 passed** |
| `npx vitest run useJobsData, Jobs, publicJobsPrefetch, home-local-seo, pages-render, cadres-app` | **102 passed** |
| `npm run build` | **exit 0** (8,5 s) |
| `node scripts/check-prerender-shells.js` | **exit 0** — 12 pages aux balises équilibrées |
| `node scripts/check-classes-sans-regle.js` | **exit 0** — 722 classes distinctes confrontées |
| `node scripts/check-css-selecteurs-morts.js` | **exit 0** — 13 331 règles |
| `node scripts/check-shell-text-provenance.js` | **exit 0** — 396 fragments |
| `node scripts/check-css-inline-budget.js`, `check-page-meta.js`, `check-keyframes-animations.js` | **exit 0** |
| `pytest tests/test_jobs_recherche.py test_public_radius.py test_fake_db_fidelity.py test_inscription_sans_paiement.py` | **84 passed** |

`frontend/scripts/__tests__/check-prerender-shells.test.js` a MORDU sur ce lot,
au bon endroit : ses fixtures ne contenaient pas `src/i18n/fr.json`, que
`vite-plugins/prerender/app-chrome.js` lit par `process.cwd()` pour le libellé
du lien d'évitement — 42 cas tombaient donc sur un ENOENT qui ne parlait que
d'outillage. Les fixtures COPIENT désormais le dictionnaire du dépôt (même
raison que les modules de pré-rendu copiés : la règle doit porter sur du vrai
code), et les 51 cas passent, sur Windows comme en CI.
