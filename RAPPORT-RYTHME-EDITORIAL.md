# Rapport — le rythme éditorial, pages publiques contre pages d'application

Mesuré le **09/10/2026**, branche `feat/design-ux-accueil`, sur le build servi par
`vite preview` (Chromium, 412×823 et 1350×940). **20 relevés, 20 verts.**

Le système de rythme existe et il est propre : cinq jetons sur `:root`, trois
classes qui les portent (`section-publique`, `cadre-page`, `carte-publique`) et
un propriétaire déclaré pour chacun. Ce rapport porte sur ce qui **reste** : les
endroits où la valeur peinte n'est pas celle que les jetons déclarent, et ceux
où rien ne tient les deux familles d'accord.

---

## 1. Protocole, et ce qu'il permet d'affirmer

**Sonde** : `frontend/e2e/_mesure-rythme.spec.js` (temporaire, supprimée après
relevé — comme `_mesure-squelettes.spec.js` et les `_sonde-*` avant elle). Elle
n'assertait rien : elle **publiait**. Le jugement est dans ce document, pas dans
le code.

```bash
cd frontend
VITE_API_URL=http://127.0.0.1:8123/api npm run build   # URL de la fixture, sinon la connexion retombe sur /login
npx playwright test e2e/_mesure-rythme.spec.js --project=chromium
# → 20 passed (20.4s)
```

Sans la variable, les cinq routes d'application échouent (mesuré : `Expected
pattern /.*dashboard.*/ · Received "http://127.0.0.1:4173/login"`) et l'on ne
mesure que la moitié publique — c'est ce qui s'est produit au premier essai.

- **10 routes** : 5 publiques (`/`, `/jobs`, `/about`, `/how-it-works`,
  `/support`), 5 d'application (`/dashboard`, `/profile`, `/messages`,
  `/create-job`, `/jobs/playtest-job-1`), ces dernières **connectées par la
  fixture** (`connexionALaFixture`, le seul propriétaire du parcours).
- **2 tailles** : 412×823 et 1350×940.
- Ce que la sonde lit : les **cinq jetons calculés**, le rembourrage et les
  marges **peints** (`getComputedStyle`), les **boîtes** (`getBoundingClientRect`
  + `scrollY`), et des **bords d'ENCRE** — la première et la dernière boîte qui
  portent du texte de feuille. Un écart d'encre est ce que l'œil perçoit ; un
  écart de boîte est ce que le CSS écrit. Les deux sont relevés.

Toutes les valeurs ci-dessous sont **peintes** (arrondies au centième), jamais
recopiées d'une déclaration — sauf la ligne de `--rythme-tete` du tableau
suivant, signalée comme calculée.

---

## 2. Le socle déjà aligné — ce qui n'est PAS un écart

Les cinq jetons sont sur `:root`, donc **identiques sur les 20 relevés**, et
leur évaluation est la même partout :

| jeton | 412 px | 1350 px | d'où vient le nombre |
|---|---|---|---|
| `--rythme-page` | **40.23** | **59** | déduit du padding peint du cadre (`pad-haut` de la racine `.cadre-page`) |
| `--rythme-section` | **60.36** | **88.5** | lu : `padding-block` peint de `.section-publique` |
| `--rythme-bloc` | **24.14** | **35.4** | lu : `margin-bottom` peint de `.titre-section` |
| `--rythme-carte` | **22.08** | **28.65** | lu : `padding` peint de `.carte-publique` et `.encart` |
| `--rythme-tete` | *32.19* | *47.2* | **calculé** sur la déclaration (`clamp`) : aucun relevé ne l'égale (§5) |

`getComputedStyle` sur un jeton personnalisé rend le **texte** de la déclaration
(`clamp(2.5rem, 2rem + 2vw, 4rem)`), pas la longueur utilisée : les quatre
premières lignes sont donc les valeurs *peintes par les éléments que les jetons
gouvernent*, et la dernière est une arithmétique sur la déclaration.

Et l'**entrée de page est la chose la mieux tenue du site** : la distance
barre → premier contenu vaut `--rythme-page` sur **7 des 10 routes**, aux deux
tailles, à l'identique.

| route | entrée 412 | entrée 1350 | verdict |
|---|---|---|---|
| `/` | 177.23 | 340.61 | héros (pas de section) |
| `/jobs` | 40.23 | 59 | = `--rythme-page` |
| `/about` | 40.23 | 59 | = `--rythme-page` |
| `/support` | 40.23 | 59 | = `--rythme-page` |
| `/dashboard` | 40.23 | 59 | = `--rythme-page` |
| `/messages` | 40.23 | 59 | = `--rythme-page` |
| `/create-job` | 40.23 | 59 | = `--rythme-page` |
| `/jobs/:id` | 40.23 | 59 | = `--rythme-page` |
| `/how-it-works` | 60.36 | 88.5 | porte `--rythme-section` (bande de tête) |
| `/profile` | 73.23 | 92 | `--rythme-page` **+ 33 px** (bandeau orange `py-8`, 32 px, plus l'amorce de ligne du titre) |

`/profile` est donc la seule route d'application dont le premier contenu est
33 px plus bas que celui de ses quatre sœurs — le bandeau du profil ajoute son
rembourrage par-dessus le pas de page (72.23 px attendus pour 40.23 + 32,
mesuré 73.23 : l'écart d'un pixel est l'amorce de ligne du `h1`, dont
l'interligne dépasse la taille de 0,68 px). Ce n'est pas une faute en soi, mais c'est
la seule entrée de l'application qui ne se superpose pas aux autres.

---

## 3. Écart 1 — le pas ENTRE les blocs n'est lu que par 2 routes sur 10

C'est l'écart principal, et il n'est pas « public contre application » : il
coupe les deux familles.

**Mesuré** — nombre d'éléments `.section-publique` peint par route :

`/` **7** · `/how-it-works` **4** · `/jobs` **0** · `/about` **0** ·
`/support` **0** · les 5 routes d'application **0**.

Le pas vertical entre deux blocs frères, relevé sur le premier niveau de chaque
route :

| route | écarts peints entre blocs frères (412 px) |
|---|---|
| `/` | `60.36` × 7 (une par `.section-publique` ; le héros et la clôture `cta-final` ne portent pas le pas, ils sont à `pad 0/0` — écarts d'encre relevés : `579.94` · `416.97` · `219.8` · `219.79` · `155.78` · `133.72` · `132.72`) |
| `/how-it-works` | non observable (voir §7) |
| `/jobs` | `24` × 5 |
| `/about` | `16` · `32` · `40` · `40` |
| `/support` | `24` × 4 |
| `/dashboard` | `32` × 4 |
| `/create-job` | `16` · `24` |
| `/messages` | `16` |
| `/jobs/:id` | `24` |
| `/profile` | aucun (un seul enfant au premier niveau) |

Autrement dit : **la même grandeur (le pas entre deux blocs) vaut 88.5 px sur
`/` et 24 px sur `/jobs`** — un facteur **3,7** au desktop, **2,5** au mobile —
et 8 routes sur 10 doivent être tenues d'accord **à la main**, par des
utilitaires `mb-*`, tandis qu'une retouche de `--rythme-section` ne les atteint
pas.

Le compte exact côté application : les 4 valeurs `32` du tableau de bord, les
`16`/`24` du formulaire, le `16` de la messagerie et le `24` de la fiche de
mission **ne sont produits par aucun jeton** — sauf `32`, qui est à **0,19 px**
de `--rythme-tete` (32.19 au mobile) sans être lui : c'est `mb-8`.

---

## 4. Écart 2 — la carte : le jeton est lu par 3 routes publiques, et par une seule carte d'application

**Relevé des rembourrages RÉELLEMENT peints** (valeur mobile / desktop, nombre
d'occurrences) :

| route | rembourrages peints |
|---|---|
| `/` | `22.08 / 28.65` × 3 (`carte-publique`) · **`12 / 16`** × 4 (`carte-editoriale-cliquable … px-4 py-3`) |
| `/about` | `22.08 / 28.65` × 3 (`carte-publique`) · `22.08 / 28.65` × 1 (`encart`) |
| `/support` | `22.08 / 28.65` × 4 (`carte-publique`) |
| `/jobs` | `24 / 24` × 12 (`carte-editoriale … p-6`) |
| `/dashboard` | `24 / 24` × 4 (`p-6`) · **`0 / 0`** × 2 (`.carte-editoriale.mb-8`) |
| `/jobs/:id` | `24 / 24` × 4 (`p-6`) · `22.08 / 28.65` × 1 (`encart`) |
| `/create-job` | `24 / 24` × 1 (`p-6`) |
| `/profile` | **`0 / 0`** × 1 (`.carte-editoriale.overflow-hidden`) |
| `/messages` | **`0 / 0`** × 1 (`.carte-editoriale.overflow-hidden.h-[75vh].flex`) |

Trois faits, chacun mesuré :

1. **Aucune des `carte-editoriale` de l'application ne lit `--rythme-carte`** :
   sur les cinq routes, un seul élément le lit (l'`encart` de `/jobs/:id`,
   22.08 / 28.65). Partout ailleurs, `p-6` — 24 px **fixes**. Le jeton vaut
   22.08 au mobile et 28.65 au desktop ; l'écart de `p-6` avec lui est de
   **+1,92 px au mobile et −4,65 px au desktop** : un rembourrage fixe s'écarte
   du jeton d'autant plus que la fenêtre grandit, là où le jeton, lui, est
   fluide.
2. **Census statique** (`src/`, 147 fichiers livrés, littéraux de `className`) :
   **51 `carte-editoriale`** — `p-6` **34 fois**, `p-4` **2 fois** (`16 px`,
   `Dashboard.js:271`, `JobDetails.js`), `p-8` **1 fois** (`32 px`, `Payment.js`),
   **14 sans rembourrage vertical explicite** (dont plusieurs sont des
   conteneurs structurels `overflow-hidden` dont l'enfant porte le rembourrage,
   et `ForgotPassword.js` qui prend le jeton via `carte-publique`). Trois
   régimes de rembourrage pour un seul dessin de carte.
3. **La divergence existe AUSSI à l'intérieur d'une page publique** : sur `/`,
   la même classe `carte-editoriale-cliquable` est peinte à **22.08 / 28.65**
   (× 3) et à **16 / 12** (× 4, `Home.js:174` — `px-4 py-3`). Un facteur 1,8 sur
   le rembourrage horizontal, 2,4 sur le vertical, dans la même page, pour le
   même objet visuel.

---

## 5. Écart 3 — le titre : deux vocabulaires, et sept pas « titre → corps »

**Deux échelles de `h1` cohabitent**, mesurées :

| route(s) | classe du `h1` | 412 px | 1350 px |
|---|---|---|---|
| `/` | `.titre-heros` | **34.01** | **56** |
| `/profile` | `.titre-heros` | **34.01** | **56** |
| les 8 autres | `.titre-page` | 31.46 | 44 |

`/profile` est la **seule route d'application alignée sur l'échelle du héros** —
et, au desktop, son titre est **12 px plus grand** que celui des quatre autres
pages de l'application. Les autres titres du site (mesurés aussi) :
`.titre-section` **25.04 / 36**, `nom-de-ligne` **22 / 24**, `.titre-entree`
**20 / 20**.

**Ce qu'un titre laisse avant le corps qu'il annonce** — sept valeurs pour une
seule relation :

| route | écart au contenu (412 / 1350) |
|---|---|
| `/` | 20 / 24 (h1) · 24.14 / 35.4 (h2 `.titre-section`) |
| `/how-it-works` | 16 / 16 (h1) · **0 / 0** (h2) |
| `/about` | 16 / 16 (h1) · 8 / 8 (h2) |
| `/support` | 8 / 8 (h1) · **4 / 4** (h2 `.titre-entree`) |
| `/jobs` | 8 / 8 |
| `/jobs/:id` | 8 / 8 (h1) · 16 / 16 (h2) |
| `/messages` | 16 / 16 |
| `/create-job` | 16 / 16 |
| `/dashboard` | **4 / 4** |
| `/profile` | **null** (voir §6) |

Valeurs distinctes : **0 · 4 · 8 · 16 · 20 · 24.14 · 35.4**. Le pas le plus
serré (**4 px**, `/dashboard` et `/support`) et le plus large (**35.4 px**,
`/`) diffèrent d'un facteur **8,9** pour la même relation.

À noter : **aucun relevé n'égale `--rythme-tete`** (32.19 / 47.2). Ses trois
consommateurs déclarés dans la feuille (`.heros-grille` : 1297, `.entree-section`
: 1738, `.panneau-sequestre` : 2265) vivent sur `/` (où le `gap` de la grille est
horizontal au desktop) et sur `/how-it-works` (invisible à la sonde, §7). Le
jeton n'est donc pas prouvé mort — il est **non observable sur ces 20 relevés**,
et c'est une limite de l'instrument, pas une conclusion.

---

## 6. Anomalies mesurées, à ne pas laisser passer pour du rythme

- **Deux écarts NÉGATIFS sur `/profile`** : `−39.81 px` (h1 desktop, `−38` au
  mobile) et `−38 px` (le second `h2`, **aux deux tailles**). Une valeur négative
  signifie que le frère suivant commence **au-dessus** du bas du titre : les
  boîtes se recouvrent. C'est l'effet de la rangée `flex items-center` du bandeau
  (photo + colonne de titre) sur un relevé qui raisonne en frères — d'où aussi
  les `écart au CONTENU = null` de cette route. Ce n'est pas un défaut de rythme,
  mais c'est le seul endroit du site où la mesure « titre → corps » ne s'applique
  pas, et un lecteur du relevé doit le savoir.
- **La sortie de page varie d'un facteur 6,3** (desktop : 59 px pour `/jobs`, 371.5 pour `/messages`) **et 4,1** (mobile : 136.23 pour `/jobs`, 555.49 pour `/messages`) — dernier contenu → pied de page :

| route | 412 | 1350 |
|---|---|---|
| `/jobs` | 136.23 | **59** |
| `/support` | 138.23 | 61 |
| `/about` | 138.23 | 155.08 |
| `/dashboard` | 160.23 | 83 |
| `/create-job` | 161.23 | 84 |
| `/jobs/:id` | 161.23 | 158.37 |
| `/profile` | 182.23 | 117 |
| `/` | 278.36 | 210.48 |
| `/messages` | **555.49** | 371.5 |
| `/how-it-works` | 2 590.98 | 2 223.7 | *(non interprétable, §7)* |

  `/messages` est le cas net : sa carte mesure `h-[75vh]` (617.25 px au mobile),
  et le pied de page est 555 px plus bas. Ce n'est pas le rythme qui décide ici,
  c'est `min-h-screen` — mais l'écart public/application sur cette grandeur
  (59 px pour `/jobs` desktop, 555 px pour `/messages` mobile) reste le plus
  grand du relevé.
- **`/jobs` : `SORTIE` 59 px au desktop**, c'est-à-dire un pied de page collé au
  dernier élément. C'est le point que la réserve `min-h-screen` de la coquille
  vise (et elle le fait) ; côté React, la valeur mesurée ne doit jamais devenir
  nulle sans que quelqu'un le voie.

---

## 7. Ce que la sonde ne peut pas dire (limites de l'instrument)

- **`/how-it-works` n'a qu'un seul palier visible** (`max-w-4xl…` h 266.94) alors
  que la route peint 4 `.section-publique`. Les sections différées
  (`content-visibility: auto`) ne se posent pas dans la fenêtre de mesure, donc
  son **écart entre blocs et sa sortie de page ne sont pas interprétables**
  (2 590.98 / 2 223.7 px). Ce chiffre est publié ici pour être *écarté*, pas
  cité.
- Les écarts internes à des conteneurs (le `gap` du héros, `.entree-section`,
  `.panneau-sequestre`) ne sont pas relevés : la sonde ne regarde que le premier
  niveau de la racine. D'où l'angle mort de `--rythme-tete` (§5).
- **Cinq routes ne sont pas dans le périmètre** — `/payment`, `/register`,
  `/forgot-password`, `/email-verification` et les écrans d'administration
  (`CommissionDashboard`, `TicketTracker`, `PhotoTest`) portent pourtant des
  cartes. `/payment` redirige vers `/login` sans session (c'est déjà écrit dans
  `e2e/texte-coquille-react.spec.js`). Le relevé porte sur 10 routes, pas sur le
  site.

---

## 8. Pourquoi ces écarts subsistent : rien ne les juge

Recherche sur `scripts/`, `src/**/__tests__/` et `e2e/` : les seules mentions du
vocabulaire sont `cadre-page` — une classe, jamais une valeur.

- `e2e/cadres-app.spec.js:252` **déclare explicitement l'angle mort** :
  > « Les jetons NON géométriques (`cadre-page`, `min-h-screen`) sont ignorés
  > sans lever : ce sont des pas verticaux, **dont la sonde ne juge pas la
  > valeur**. »

  Ce fichier assertait donc la largeur, la gouttière, le centrage et le CLS, et
  **pas un seul pixel de rythme**.
- `src/components/__tests__/cadres-app.test.jsx` vérifie que `frameClass`
  *contient* `cadre-page` — une chaîne.
- `scripts/__tests__/check-lcp-geometrie.test.js` recopie des `frameClass`
  contenant `cadre-page` : c'est la géométrie LCP, pas le pas.
- Aucun fichier ne compare **une valeur peinte** à `--rythme-section`,
  `--rythme-bloc`, `--rythme-tete` ou `--rythme-carte`. Aucun ne refuse une
  carte `p-6` sans `carte-publique`.

Le trou est exactement celui que décrit le §3 : **le pas est déclaré une fois et
lu à la main huit fois** — et ce que la sonde de cadre a explicitement refusé de
juger est ce que huit routes doivent tenir d'accord sans elle.

---

## 9. Synthèse, par ordre de grandeur

| # | écart | mesure | routes concernées |
|---|---|---|---|
| 1 | le pas entre blocs n'est pas lu par le jeton | 88.5 px contre 24 px (facteur 3,7 au desktop) | 8 / 10 |
| 2 | la carte ne lit pas le jeton | 24 px fixe contre 22.08→28.65 px fluide | 4 / 5 en application (un `encart` sur `/jobs/:id` l'atteint) ; 51 `carte-editoriale`, 34 en `p-6` |
| 3 | « titre → corps » prend 7 valeurs | 4 px à 35.4 px (facteur 8,9) | 10 / 10 |
| 4 | deux échelles de `h1` | 31.46/44 contre 34.01/56 | `/profile` seul du côté du héros |
| 5 | valeurs hors échelle | 20 px (`space-y-5`) sous le plus petit pas (24.14) · 40 px (`mb-10`) · 32 px à 0,19 px de `--rythme-tete` | application surtout |
| 6 | entrée de page | 33 px de plus que les quatre autres | `/profile` seul |
| 7 | sortie de page | 59 → 371.5 px au desktop (×6,3) · 136.23 → 555.49 au mobile (×4,1) | 9 / 10 |
| 8 | aucun garde | `cadres-app.spec.js:252` le dit lui-même | — |

---

## 10. APRÈS — les cinq routes d'application lisent les jetons (09/10/2026)

Périmètre : les écarts **#1 (le pas entre blocs)** et **#2 (le rembourrage des
cartes)**, sur les cinq routes d'application. Le §3 les donnait à 32 · 24 · 16 ·
8 px — trois valeurs qu'aucun jeton ne produit — et le §4 mesurait **24 px
fixes** là où `--rythme-carte` vaut 22,08 → 28,65 px.

DEUX classes et une extension : `.tete-app` et `.bloc-app` (le pas d'un écran,
`src/index.css`) ; `.carte-publique` est posée sur les cartes, et `.carte-cotes`
(inset horizontal seul) sur les rangées INTERNES d'une carte — un en-tête à
filet pleine largeur, un bandeau — parce que leur mesure verticale est un pas
interne et que seul l'alignement au filet doit être commun.

### 10.1 Le même relevé, rejoué (sonde supprimée après usage)

Jetons **résolus** (mêmes qu'au §2, retrouvés par une autre sonde) :
`tete` 32,19 / 47,2 · `bloc` 24,14 / 35,4 · `carte` 22,08 / 28,65.

| route | AVANT (§3, §4, §5) | APRÈS — peint, 412 / 1350 |
|---|---|---|
| `/dashboard` | pas 32 × 4 · titre → corps 4 · cartes `p-6` | en-tête → corps **32,19 / 47,2** (tête) · blocs **24,14 / 35,4** (bloc) ×3 · 4 cartes + 3 rangées **22,08 / 28,65** |
| `/profile` | entrée +33 · un seul bloc · rembourrage 0 | 1 bloc (dernier, donc sans pas) · 9 rangées **H 22,08 / 28,65** (leur `py` reste 24 / 32 : pas interne, §4 annexe) |
| `/messages` | titre → carte 16 | titre → carte **32,19 / 47,2** (tête) · la carte des fils n'a pas de rembourrage propre (deux volets à la cible) |
| `/create-job` | 16 · 24 · carte `p-6` | titre → chapeau **24,14 / 35,4** (bloc) · chapeau → formulaire **32,19 / 47,2** (tête) · carte **22,08 / 28,65** |
| `/jobs/:id` | retour → grille 24 · cartes `p-6` | retour → grille **24,14 / 35,4** (bloc) · 4 cartes + l'`encart` **22,08 / 28,65** |

Aucun relevé de pas n'est HORS JETON : les valeurs peintes sont celles des trois
jetons, aux deux tailles. Le titre du tableau de bord, qui restait collé à sa
première carte (4 px d'encre, §3), laisse maintenant `--rythme-tete`.

### 10.2 Ce qui n'a PAS été touché, et pourquoi

- **Le pas INTERNE d'un groupe** : les champs d'un formulaire (`space-y-5`), les
  titres d'une carte (`mb-4`), les rangées d'une liste, les volets de la
  messagerie (un fil de discussion a sa propre échelle, `px-4`/`p-4`). C'est la
  frontière déjà écrite dans `src/config/app-cadres.js` : un écran règle ses
  BLOCS, la page règle son intérieur.
- **Deux cartes imbriquées** gardent leur `p-4` (la boîte d'options de mission
  dans la discussion, l'en-tête de l'aperçu cartographique de `/create-job`) :
  une carte DANS une carte est une autre relation, et son rembourrage plus
  serré est ce qui la distingue de celle qui la porte.
- La dernière carte de `/dashboard` reste `bg-white rounded-lg shadow` : c'est
  un DESSIN (elle n'est pas une carte à filet), pas un pas. Le jour où elle
  prendra le dessin du site, elle prendra `carte-publique` avec.

### 10.3 Le garde — et les deux mutations rejouées

Le §8 disait « aucun garde » et citait la sonde de cadre qui DÉCLARAIT l'angle
mort. Les trois règles vivent maintenant dans `e2e/cadres-app.spec.js`, le
fichier qui ouvre déjà ces cinq routes par la fixture aux deux tailles (aucune
visite ajoutée) :

1. **le pas** — la marge peinte de chaque bloc de premier niveau doit valoir 0,
   `--rythme-tete` ou `--rythme-bloc` (tolérance 0,6 px) ;
2. **le rembourrage** — chaque carte visible doit valoir 0 ou `--rythme-carte`
   en tête, et `--rythme-carte` à gauche (la règle qui autorise la rangée
   interne au rembourrage vertical serré) ;
3. **trois contreparties** — le jeton doit se RÉSOUDRE en pixels, au moins un
   bloc doit porter un pas (contre un zéro de mort), et au moins une carte doit
   être lue. La contrepartie du pas ne s'applique qu'à une route de plus d'un
   bloc : `/profile` n'en a qu'un (sa carte, la dernière), et exiger un pas là
   demanderait à une page d'une section d'espacer quelque chose.

Vert sur l'arbre : **20/20** (`cadres-app.spec.js`, 25 s). Deux mutations
rejouées, chacune rougissant SON message, puis restaurées (`src/index.css`
inchangé, `rythme-bloc` de nouveau 10 occurrences, build rejoué) :

- `.bloc-app { margin-bottom: var(--rythme-bloc) }` → **`1rem`** : rouge
  *« le bloc « grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 bloc-app »
  laisse 16 px avant le suivant — aucun jeton ne produit cette valeur (tête 32,19
  / bloc 24,14) »* ;
- `.carte-publique { padding: var(--rythme-carte) }` → **`1.5rem`** : rouge
  *« la carte « carte-editoriale carte-publique » rembourre 24 px en tête et
  24 px à gauche pour un jeton de 22,08 px »*.

### 10.4 Non-régression mesurée

- **CLS : 20/20 verts, valeurs inchangées** (Chromium, fixture) : `/dashboard` et
  `/profile` 0,0039 pour 0,06 · `/messages` 0,0039 pour 0,02 · `/create-job`
  0,0039 pour 0,02 · `/jobs/:id` 0,0164 pour 0,04. Les décalages nommés restent
  ceux d'avant (la barre du bas et ses items, le pied de page de `/jobs/:id`).
- **LCP : le diagnostic de cette passe était INCOMPLET, et il est corrigé au
  §11.** Deux sondes avaient rendu l'aire du HÉROS de l'accueil (69 920 /
  306 870 px²) avec un élément `img.cadre-image` absent du DOM de la route ;
  j'en avais conclu à un défaut d'instrument. La cause réelle est ailleurs, et
  elle est plus intéressante : ces sondes mesuraient sur `vite preview`, qui ne
  connaît AUCUNE règle de `vercel.json` — `/dashboard` y retombait sur
  `index.html`, la coquille de l'ACCUEIL, dont le héros était peint puis détaché
  par React. L'instrument décrivait fidèlement le mauvais document. Le §11 donne
  l'instrument qui sert la coquille de la PRODUCTION et la comparaison avant /
  après, faite : **l'élément LCP est le même sur les dix cas**, horodaté au
  premier paint, à une exception d'aire près, nommée.
- **vitest : 1 503 ✓ / 1 ✗** (101 fichiers). Le rouge est
  `check-test-environment` (pré-vol de push, dépôt réel) : **49/49 en isolation**,
  il dépend de la charge et du réseau de l'hôte. Un cas RÉEL a rougi pendant la
  passe et a été corrigé, pas contourné : `ProfileCountryDetection.test.jsx`
  désignait sa section par `.px-6.py-6.border-b.border-gray-200` — le test
  recopiait donc la mesure que la carte n'écrit plus, et il prend maintenant la
  rangée par son TITRE.
- Deux sondes temporaires (`e2e/_sonde-rythme-app.spec.js`,
  `e2e/_sonde-lcp-app.spec.js`) ont été supprimées après relevé ; c'est
  `check-juges-de-temps` qui l'a exigé, en refusant leur `waitForTimeout` — le
garde a mordu sur l'outil de mesure, ce qui est son travail.

---

## 11. Le LCP des cinq routes d'application : l'instrument, et la comparaison

Le §10 laissait le LCP des cinq routes **non mesuré**, sur un diagnostic qui
s'est révélé incomplet. Ce qui suit est l'instrument qui tient, les deux défauts
qu'il a fallu fermer pour y arriver, et la comparaison avant / après.

### 11.1 Les deux défauts de l'instrument, mesurés

1. **La coquille servie n'était pas celle de la production.** `vite preview` ne
   connaît aucune règle de `vercel.json` : `/dashboard` y retombait sur
   `index.html` — la coquille de l'ACCUEIL. Le héros était donc peint, puis
   détaché par React : le relevé rendait son aire (69 920 / 306 870 px²) avec un
   élément ABSENT du document, alors que la page mesurée n'a aucune image.
   Vérifié sur l'artefact : `build/index.html` publie `kojo-hero-480.avif`
   (2 occurrences), `build/app.html` n'en publie aucune (sa seule occurrence de
   `cadre-image` est une règle CSS). La production, elle, envoie `/dashboard`
   sur `/app.html` — c'est la table de `vercel.json`, lue par `matchRewrite`.
2. **La session semée était incomplète.** `storageState()` ne porte ni le
   `sessionStorage` ni le second stockage que `getAuthToken` lit pourtant : un
   contexte semé par lui seul repartait vers `/login` (mesuré : les DIX cas
   expirés sur `waitForSelector('.cadre-page')`).

Et un piège de plus, mesuré avant d'adopter le remède : **servir le document
par `route.fulfill` rend la page INORIGINE** — les cinq appels `/api/…` de la
fixture tombaient en `net::ERR_FAILED`, contre cinq 200 dès que le document
n'était plus intercepté. Le remède retenu est `route.continue` vers le fichier
de la coquille : le SERVEUR répond, avec ses vrais en-têtes.

### 11.2 L'instrument : `e2e/lcp-app.spec.js` (10 cas, 27 s, dans la CI)

| ce qui le rend fiable | pourquoi |
|---|---|
| la coquille vient de `vercel.json`, **lue** | `matchRewrite`, le même lecteur que `scripts/vercel-rewrite-server.js` : la table de la production, jamais recopiée |
| la coquille est servie par le **serveur** | `route.continue` vers `/app.html` ; `fulfill` rendait la page inorigine (cf. 11.1) |
| **contexte neuf**, page de mesure **vierge** | `page.goto(chemin)` est la PREMIÈRE navigation de ce document : la seule peinture qu'il puisse avoir enregistrée est la sienne |
| session semée **hors mesure** | deux stockages repris de la page de connexion, reposés par `addInitScript` — sans connaître le nom de la clé |
| observateur posé **avant** la navigation | le protocole de `e2e/lcp-geometrie.spec.js` |
| attente = **stabilité** de la mise en page | `attendreLaStabilite` (condition), pas de délai fixe — `check-juges-de-temps` refuse le reste |
| le relevé **se refuse** | élément plus dans le document, route non atteinte, ou aire vivante ≠ aire enregistrée → ROUGE, jamais un chiffre |

Ce sont ces trois refus qui ont NOMMÉ les deux défauts, au lieu de produire un
faux chiffre — c'est tout l'intérêt de l'instrument.

### 11.3 Avant / après : le même élément LCP, sur les dix cas

« Avant » n'est pas une pièce historique : la passe a reconstruit l'état
précédent (valeurs fixes : 32 px sur `/dashboard`, 16 · 24 sur `/create-job`,
16 sur `/messages`, 24 sur `/jobs/:id`, `p-6` pour les cartes, `px-6` pour les
rangées de `/profile`), rebâti, mesuré, puis restauré et rebâti — les chiffres
« après » ci-dessous sont ceux du dernier run, sur l'arbre restauré.

| route @ taille | AVANT — élément LCP (aire, t) | APRÈS — élément LCP (aire, t) | écart |
|---|---|---|---|
| `/dashboard` mobile | `<H1>` « Bienvenue, Demo! » 8 626 px², t=1228 | le même, **8 626**, t=1236 | identique |
| `/dashboard` desktop | `<H1>` « Bienvenue, Demo! » 17 172, t=1228 | le même, **17 172**, t=1220 | identique |
| `/profile` mobile | `<P>` « Aucun avis pour le moment… » 11 174, cadre 330×40 | le même, **11 211**, cadre 333,84×40 | **+37 px² (+0,33 %)** : re-justification (inset 24 → 22,08) |
| `/profile` desktop | `<H1>` « Demo Worker » 20 944 | le même, **21 012** | +68 px² (+0,32 %), même cause |
| `/messages` mobile | `<H1>` « Messages » 4 256, t=1188 | le même, **4 256**, t=1184 | identique |
| `/messages` desktop | `<H1>` « Messages » 8 478, t=1192 | le même, **8 478**, t=1236 | identique |
| `/create-job` mobile | `<P>` chapeau 11 792, y=153,95 | le même, **11 792**, y=162,09 | identique, **descendu de 8,14 px** (le pas de tête) |
| `/create-job` desktop | `<H1>` « Publier un job » 13 446 | le même, **13 446** | identique |
| `/jobs/:id` mobile | `<P>` « L'argent est bloqué… » 30 361, y=537,75 | le même, **30 361**, y=534,05 | identique |
| `/jobs/:id` desktop | `<H1>` « Mission de démonstration 1 » 26 136, cadre 483,22×45,75 | le même, **28 800**, cadre 482,64×**91,5** | **+10,2 %** : le titre passe sur DEUX lignes (l'inset de carte 24 → 28,65 rétrécit la colonne de 9,3 px) |

Trois faits à retenir, et un seul à surveiller :

- **l'élément élu ne change pas** sur les dix cas (les mêmes nœuds, aux deux
tailles), et chaque relevé reste horodaté au premier paint + ~100 ms :
l'alignement du rythme ne ré-élit rien ;
- **la position verticale peut descendre** (chapeau de `/create-job` : 8,14 px),
mais ces routes ne sont pas pré-rendues : il n'y a aucune coquille à égaler, donc
un déplacement n'a pas de coût LCP — c'est le CLS qui le jugerait, et il est
inchangé (§10.4) ;
- **le seul écart d'aire qui compte** est celui du titre de mission en desktop :
+10,2 % parce qu'il tient maintenant sur deux lignes. Rien ne le refuse (le
titre reste peint au premier paint), mais c'est une conséquence VISIBLE de
l'inset de carte, et elle est écrite ici pour ne pas être redécouverte.

Limite assumée : pour `/jobs/:id`, la coquille servie est `app.html` et non la
page OG produite par le BACKEND (`/jobs/(.*) → /api/og/jobs/$1`), ce poste n'ayant
pas ce route. L'écart est déclaré dans le journal du test, à chaque run.

### 11.4 Ce que l'aire LCP ne juge pas

Un **plafond** d'aire demande une table mesurée, comme
`scripts/lhci-cls-budgets.cjs` le fait pour le CLS. Le test ne juge donc pas une
magnitude : il juge la VALIDITÉ du relevé, et publie le chiffre (règle du dépôt :
un vert sans chiffre ne prouve rien). Fixer un plafond est une décision à part,
qui demande un relevé sur plusieurs runs — pas une ligne ajoutée le même jour.
