# Audit général de Kojo — 24 octobre 2026

> **Périmètre** : production `https://kojoforafrica.cc.cd` (Vercel) et
> `https://api.kojoforafrica.cc.cd` (Fly.io, région `fra`), plus l'arbre de
> travail sur `main` (`aed1ef76`, PR #207).
> **Méthode** : mesures exécutées le 24/10/2026 (HTTP réel, Lighthouse mobile,
> Chromium réel profilé au CDP, DNS, GitHub Actions, comptage du dépôt) +
> lecture du code. **Chaque constat porte sa preuve ; ce qui n'est pas mesuré
> est dit comme tel.**
> **État du dépôt** : 27 fichiers modifiés et 5 nouveaux **non commités**
> (lot « administration des comptes » + retouches auth) — donc absents de la
> production.

---

## 1. Verdict en une page

Kojo est **une place de marché à séquestre très bien construite, qui n'a
toujours personne dedans**.

Le déséquilibre est mesurable et il est net :

| Ce qui est mesuré | Valeur |
|---|---|
| Missions ouvertes (`GET /api/jobs?status=open`) | **0** |
| Missions terminées (`/api/public/stats`) | **0** |
| Avis | **0** |
| Travailleurs | **3** |
| Clients | **8** |
| Missions en cours | **1** |
| URL au sitemap | **12** (dont 1 fiche mission, 3 profils) |

En face : séquestre à deux temps, litiges tracés avec arbitrage mesuré,
verrou de connexion par compte **et** par réseau, SSE avec bus Redis, 42 130
lignes de tests backend, 73 385 lignes de scripts de garde, 5 langues,
Lighthouse 98/100/100/100 sur l'accueil.

**Le produit est en avance sur son marché.** Le prochain point de levier n'est
pas une fonctionnalité : c'est **dix missions réellement terminées**. Tant
qu'elles n'existent pas, tout le reste (SEO, avis, preuve sociale, rétention)
tourne à vide — et certains écrans le disent mal (voir §4.3).

---

## 2. Notes par domaine

Notes sur 10, justifiées par la mesure en colonne de droite. Une note basse
n'est pas un jugement sur le travail : c'est l'écart entre ce qui est construit
et ce qui est **observé en production**.

| Domaine | Note | Preuve / mesure du 24/10/2026 |
|---|---|---|
| Ingénierie backend | **9** | Séquestre à deux temps, litiges, arbitrage mesuré, 120 fichiers de tests (42 130 LOC), `/health` 200 + DB connectée |
| Sécurité | **8** | Cookie `HttpOnly`+`Secure`+`SameSite=None`, CSRF double-submit, verrou compte + réseau, gitleaks bloquant. Manque : en-têtes statiques (voir §5.8), pas de KYC |
| Performance (accueil) | **9,5** | Lighthouse mobile : **98** / FCP 1,5 s / LCP 2,3 s / TBT 30 ms / CLS 0 / 396 Kio |
| Performance (`/jobs`) | **6** | Lighthouse mobile : **65** / LCP 3,3 s / **TBT 1 750 ms** / 374 Kio (un passage) |
| Accessibilité | **9** | Lighthouse a11y 100 + parcours axe sur 10 routes publiques + lien d'évitement jugé au clavier |
| SEO technique | **8** | 3 blocs JSON-LD, canonical, OG/Twitter, sitemap, robots, pré-rendu mission/profil. Manque : `JobPosting`, H1 statique faux |
| SEO de contenu | **2** | 12 URL indexables, 1 fiche mission, 3 profils, 0 avis : rien à classer |
| Internationalisation | **7** | 963 clés × 5 langues, garde anti-copie du français. Trou : textes en dur (voir §5.3) |
| Mobile (Capacitor) | **4** | Bundles suivis **périmés** dans `frontend/android` et `frontend/ios` ; `cap sync` Android seulement en CI |
| Paiement | **8** | PayDunya circuit `closed`, devis de commission affiché avant paiement, séquestre, remboursement. Mode live/test non vérifiable sans secret |
| Observabilité | **7** | `/monitor` 200 (3 fournisseurs, 0 en panne), `/metrics` **503 nommé** (fermé par défaut), 13 sondes quotidiennes. Trou : pas d'événements de funnel |
| Tests / CI | **9** | CI `main` 22 min 42 s, PR 15 min 35 s, 10 checks requis, mutations de gardes rejouées |
| Produit / traction | **2** | 0 mission ouverte, 0 terminée, 0 avis après plusieurs mois |
| Confort de développement | **6** | Appareil de garde (~1,9× le code produit) : très sûr, coûteux à faire évoluer |

---

## 3. Ce qui est solide (mesuré, pas supposé)

1. **La production répond et elle est saine.** `/health` → 200, `database:
   connected`, version `1.0.2`, révision `786635c`, `paydunya_circuit.state =
   closed`, 0 échec consécutif.
2. **Les fournisseurs sont vivants.** `/monitor` → 200, `total: 3`, `down: 0` :
   PayDunya `ok`, email `ok` (« HTTP 200, expéditeur `noreply@kojoforafrica.cc.cd`
   actif »), et un troisième probe.
3. **L'email d'authentification est correctement authentifié.** SPF
   `include:spf.brevo.com`, **DKIM présent** (`brevo1`/`brevo2._domainkey` en
   CNAME vers Brevo), DMARC `p=quarantine`. L'hypothèse « les OTP partent en
   spam faute de DKIM » est **fausse** — vérifié aujourd'hui.
4. **L'accueil est excellent techniquement.** Lighthouse mobile
   **98 / 100 / 100 / 100**, LCP 2,3 s, TBT 30 ms, CLS 0, 396 Kio, 3 blocs
   JSON-LD (Organization, WebSite + SearchAction, LocalBusiness), CSP en balise,
   15 balises OG, 5 Twitter.
5. **Les en-têtes de l'API sont complets** : `X-Content-Type-Options`,
   `Referrer-Policy: strict-origin-when-cross-origin`,
   `Permissions-Policy: geolocation=(self), microphone=(), camera=()`,
   `HSTS max-age=31536000; includeSubDomains`, CORS avec credentials limité à
   `https://kojoforafrica.cc.cd`.
6. **Le verrouillage de connexion dit la vérité.** Compte verrouillé → 429 +
   `Retry-After` + message français ; email inconnu → 401 (pas d'annuaire) ;
   réseau saturé → goutte-à-goutte 429, jamais blocage.
7. **Le paiement est transparent avant l'engagement.** `Payment.js` lit un devis
   réel (`getQuote`) et affiche `paymentTotalClient` **et** `paymentCommission`
   avant le checkout ; au re-checkout, une commission qui a changé est détectée
   (`freshQuote.commission_amount !== previousCommission`).
8. **`/metrics` est fermé par défaut** : 503 nommé sans jeton, jamais 200 muet.
9. **Aucune vulnérabilité npm en production** : `npm audit --omit=dev` →
   `{info:0, low:0, moderate:0, high:0, critical:0, total:0}`.
10. **La préversion Vercel redirige proprement** : `kj-update-fevrier.vercel.app`
    → **308** vers `https://kojoforafrica.cc.cd/`.

---

## 4. Défauts classés par coût

### 4.1 P0 — ce qui empêche le produit de vivre

**1. La place de marché est vide, et c'est le seul chiffre qui compte.**
`open_jobs: 0`, `completed_jobs: 0`, `reviews: 0`, 3 travailleurs, 8 clients.
Aucune mission n'a jamais été terminée sur la plateforme. Conséquence en chaîne :
pas d'avis (donc pas de preuve sociale), sitemap à 12 URL (donc pas de SEO),
pas de rétention, pas de bouche-à-oreille. **Coût : 100 % de la valeur
potentielle.** Correctif : acquisition manuelle (voir §6).

**2. L'inscription exige un email, et l'email est un identifiant faible ici.**
Mesuré : aucune connexion par téléphone dans `kojo_routers_auth.py` (pas de
route `phone`/`sms`), pas de vérification téléphonique. Le téléphone est
pourtant déjà collecté à l'inscription (`Register.js`), déjà utilisé comme clé
de rattachement WhatsApp (`compte_du_numero`), et le pays est déjà connu.
**Hypothèse (non mesurée) : c'est le premier frein de conversion.** Correctif :
OTP par WhatsApp (Kapso est déjà branché) ou SMS, avec l'email en secours.

**3. Un visiteur anonyme voit trois missions… qui n'existent pas.**
`Jobs.js` monte `DemoJobsEmptyState` quand `!user && onglet Découvrir && aucun
filtre && 0 résultat`. Cet état affiche trois cartes marquées « Exemple », avec
des textes **en français en dur** (« Découvrez le type de missions publiées sur
Kojo », « Ces exemples montrent le fonctionnement de la plateforme… »,
« Exemple »), donc non traduits dans les 4 autres langues. Deux effets : la
première impression est « les annonces sont fausses », et la promesse
multilingue du site casse sur la page la plus stratégique. Correctif : remplacer
par un état « Soyez parmi les premiers » + CTA WhatsApp/publication, traduit.

### 4.2 P1 — ce qui coûte des visiteurs (SEO / acquisition)

**4. Aucune donnée structurée `JobPosting` sur les fiches mission.**
Mesuré sur `https://kojoforafrica.cc.cd/jobs/c7b740c2-1be5-40c8-a1f3-f2fec7c807aa` :
`JobPosting` → **0 occurrence**, `application/ld+json` → **0**. Les fiches sont
donc invisibles pour Google Jobs, qui est le canal d'acquisition gratuit le plus
direct pour une place de marché d'emploi. Correctif : un bloc `JobPosting`
(titre, description, `datePosted`, `validThrough`, `jobLocation`, `baseSalary`,
`hiringOrganization`) dans `kojo_job_og.py`, avec un contrat hors ligne comme
celui de `check-job-og-contract.js`.

**5. Le `<h1>` pré-rendu n'est pas celui de l'application.**
Statique : `<h1>Fuite sous l'évier de la cuisine à réparer - Kojo</h1>`.
React (`JobDetails.js`) : `<h1 className="titre-page mb-2">{job.title}</h1>`.
Le crawler et l'utilisateur ne lisent donc pas le même H1, et le titre de page
fuit dans le titre principal. Correctif : `h1` = `job.title` seul dans
`kojo_job_og.py`.

**6. La description de fiche est coupée au milieu d'un mot.**
Mesuré : `« … Il faut localiser la fuite, remplacer le. »` — coupe à 150 points
de code sans respect du mot. Correctif : couper sur le dernier espace avant la
limite (dans les deux copies, `jobSeo.js` et `kojo_job_og.py`, jugées par le
contrat existant).

**7. Le sitemap n'a rien à proposer.** 12 URL, dont 1 fiche et 3 profils.
Ce n'est pas un défaut de code : c'est le symptôme de P0-1.

### 4.3 P2 — sécurité, performance, hygiène

**8. Les en-têtes statiques Vercel sont incomplets.** Sur le HTML de
`https://kojoforafrica.cc.cd/` : `Content-Security-Policy: frame-ancestors
'none'`, `HSTS`, mais **pas de `X-Content-Type-Options`**, **pas de
`Referrer-Policy`**, **pas de `Permissions-Policy`**. L'API les a ; le site non.
Correctif : trois entrées dans `frontend/vercel.json` (§headers), 10 minutes.

**9. `/photo-debug` est une route de diagnostic qui reste dans le binaire
client — et une correction de cet audit.** `GET /photo-debug` → **200**, mais
c'est la coque `app.html` servie à toute route d'application : la route
elle-même est derrière `OwnerOnlyRoute` (`App.js`), donc **ce n'est pas une page
publique**. Le coût réel est le chunk `PhotoTest` livré en production et une
route de debug dans l'application. Priorité basse (nettoyage, pas sécurité).

**10. `vercel.json` à la racine est un piège.** Il déclare
`"rewrites": [{"source": "/(.*)", "destination": "/index.html"}]` avec
`outputDirectory: frontend/build`. S'il était un jour pris pour configuration
du projet, **tout** passerait par `index.html` : plus de proxy `/api`, plus de
fiche mission pré-rendue, plus de `/sitemap.xml`. La production utilise
`frontend/vercel.json` (46 rewrites explicites) — mais le fichier racine
n'apporte rien et peut coûter très cher. Correctif : le supprimer.

**11. `/jobs` est 20 fois plus bloquante que l'accueil.** Lighthouse mobile :
**65**, LCP 3,3 s, **TBT 1 750 ms** (contre 30 ms sur `/`), 374 Kio.
Mesure directe en Chromium réel bridé ×4 (CDP) : 5 longues tâches
(50 / 233 / 162 / 135 / 70 ms, ~650 ms cumulés), attribuées au rendu React
(ordonnanceur) et au chunk `Jobs`. Autrement dit : le score 65 est une
**estimation par simulation**, mais la page est réellement la plus lourde du
site. Correctif : sortir `AlerteEmploi`/`CountrySelector` du chemin critique,
mémoïser les filtres, vérifier que la carte n'est pas chargée hors mode carte.

**12. Le mobile suivi est périmé.** `frontend/build/assets/index-DuUFnvjo.js`
(build courant) contre `index-DlUJxnnU.js` dans `frontend/android/.../assets` et
`frontend/ios/.../assets`. La CI fait `npx cap sync android`, **jamais iOS**.
Deux lectures possibles : les binaires publiés sont anciens, ou les dossiers
suivis ne servent à rien. Dans les deux cas, il faut trancher.

**13. La documentation décrit un produit qui n'est pas déployé.** `AGENTS.md`
décrit `/administration` au présent ; la production répond **404** sur
`/administration`, et le lot (27 modifiés + 5 nouveaux, dont
`kojo_comptes_admin.py`, `Administration.js`, `test_administration_comptes.py`)
n'est **pas commité**. Ce n'est pas un mensonge du document : c'est une dérive
entre l'arbre de travail et `main` qui, si elle se prolonge, fera perdre du
travail.

**14. Le JSON-LD `LocalBusiness` décrit une autre entreprise.** Téléphone
`+18193003507` (indicatif américain), email `Kojoapp98@gmail.com`,
`availableLanguage: [fr, en]` alors que le site sert 5 langues. Correctif :
téléphone ivoirien/malien réel, email du domaine, 5 langues.

**15. Pas de KYC, paliers de commission inactifs, pas de funnel analytique.**
`kyc|identity_verified` → 0 occurrence ; `OwnerCommissionTiers` affiche
« Appliquer les paliers (désactivés, le taux standard s'applique à tout le
monde) » et `kojo_commission` a `actif: False` ; l'analytique n'émet que
`page_view`. Les trois sont des **choix**, pas des bugs — mais ils coûtent :
sans palier de lancement à 0 %, le premier travailleur n'a aucune raison de
payer 14 % ; sans événements de funnel, personne ne sait où l'inscription
perd ses visiteurs.

**16. L'appareil de garde coûte plus cher que le produit.** 73 385 LOC de
scripts de garde + 42 130 LOC de tests backend + 11 876 LOC d'e2e ≈ 127 000
lignes, contre ≈ 67 000 lignes de code produit. CI `main` : 22 min 42 s.
Ce n'est pas un défaut de qualité — c'est un **coût de velocité** qu'il faut
connaître avant d'ajouter la 193ᵉ garde.

---

## 5. Propositions classées (impact / effort)

| # | Proposition | Impact | Effort | Preuve du besoin |
|---|---|---|---|---|
| 1 | **Amener 10 missions réelles** (démarchage direct, WhatsApp, bouche-à-oreille) et les faire aboutir jusqu'au paiement | ★★★★★ | ★★★★ | 0 mission terminée |
| 2 | **Connexion par téléphone (OTP WhatsApp via Kapso)**, email en secours | ★★★★★ | ★★★ | aucune route téléphone ; 3 travailleurs |
| 3 | **Activer le palier de lancement à 0 %** (`actif: True`) pour les premières missions | ★★★★ | ★ | paliers codés mais inactifs |
| 4 | **`JobPosting` JSON-LD** sur les fiches + contrat hors ligne | ★★★★ | ★★ | 0 occurrence mesurée |
| 5 | **Remplacer l'état vide de `/jobs`** (3 fausses annonces, français en dur) par un état « premiers arrivants » traduit + CTA WhatsApp | ★★★★ | ★★ | `DemoJobsEmptyState` monté pour tout anonyme |
| 6 | **Événements de funnel** : `signup_started`, `otp_sent`, `otp_verified`, `job_created`, `proposal_sent`, `payment_started`, `payment_completed` | ★★★★ | ★★ | seul `page_view` aujourd'hui |
| 7 | **Corriger le H1 pré-rendu et la coupe de description** | ★★★ | ★ | mesures §4.2 |
| 8 | **En-têtes statiques** (XCTO, Referrer-Policy, Permissions-Policy) | ★★★ | ★ | absents sur le HTML |
| 9 | **Supprimer `vercel.json` racine** (et, en second, la route `/photo-debug`) | ★★★ | ★ | piège catch-all ; route debug `owner-only` livrée dans le bundle |
| 10 | **Alléger `/jobs`** (TBT 1 750 ms simulé) | ★★★ | ★★★ | Lighthouse 65 |
| 11 | **Trancher le mobile** : reconstruire les bundles suivis ou les supprimer ; ajouter `cap sync ios` ou assumer | ★★ | ★★ | hash `index-DlUJxnnU` périmé |
| 12 | **Corriger le JSON-LD `LocalBusiness`** (téléphone, email, 5 langues) | ★★ | ★ | +1 819… et gmail.com |
| 13 | **Committer et déployer le lot administration** | ★★ | ★ | 32 fichiers non commités, `/administration` 404 |
| 14 | **Preuve sociale honnête** : remplacer les emplacements d'avis vides par la garantie de séquestre, les étapes réelles, et les 3 profils existants | ★★★ | ★★ | 0 avis, 0 mission terminée |

### Ce qu'il ne faut **pas** faire maintenant
- Ajouter des fonctionnalités de confiance (KYC complet, scores, badges) avant
  d'avoir une mission à protéger.
- Programmatic SEO : il n'y a pas d'inventaire à mailler.
- Nouvelles gardes de CI : le ratio est déjà de 1,9 pour 1.

---

## 6. Plan 30 / 60 / 90 jours

**Jours 0–30 — réparer la porte d'entrée et amorcer l'offre**
- Committer/déployer le lot administration (13).
- Lot « quick wins » : 4, 5, 7, 8, 9, 12 (une seule PR, tous mesurés).
- Activer le palier de lancement 0 % (3).
- Instrumenter le funnel (6) — sans quoi rien de ce qui suit ne sera mesurable.
- **Objectif commercial** : 10 missions publiées à la main, 30 profils de
  travailleurs créés avec eux (photo, métier, ville, tarif indicatif).

**Jours 30–60 — retirer la friction d'identité**
- OTP téléphone via WhatsApp (2), email en secours.
- Prise de mission par WhatsApp (« poste ta mission en 3 messages ») : Kapso et
  l'assistant support existent déjà, il manque la création de mission.
- **Objectif** : 10 missions terminées, 10 avis réels, première preuve sociale
  affichable sur l'accueil.

**Jours 60–90 — rendre la croissance répétable**
- Alléger `/jobs` (10) une fois qu'il y a de vraies annonces à afficher.
- Trancher le mobile (11) ; viser un binaire à jour, ou retirer les dossiers.
- SEO sur inventaire réel : `JobPosting`, sitemap qui grandit, pages métier/ville
  seulement quand elles ont du contenu.
- **Objectif** : 50 missions terminées cumulées, taux de complétion mesuré,
  premier travailleur récurrent (palier « récurrent » atteint).

---

## 7. « Je n'arrive pas à me connecter » — ce qui est prouvé, ce qui ne l'est pas

**Prouvé aujourd'hui, en HTTP réel :**
- `POST /api/auth/login` avec un email inconnu → **401** `{"detail":"Invalid
  credentials"}` (comportement attendu, pas une panne).
- `GET /api/auth/me` sans session → **401**.
- Préflight CORS → **200**, `Allow-Origin: https://kojoforafrica.cc.cd`,
  `Allow-Credentials: true`, `X-CSRFToken` autorisé.
- Cookie de session : `HttpOnly`, `Secure`, `SameSite=None`, sans `Domain`
  (host-only), durée = 24 h (`AUTH_COOKIE_MAX_AGE = JWT_EXPIRATION_HOURS × 3600`).
- Le fournisseur email répond **200** et l'expéditeur est actif (Donc les OTP
  peuvent partir).
- Compte verrouillé → **429** + `Retry-After` + message français ; réseau saturé
  → 429 également.

**Non prouvé : la cause de VOTRE échec.** Je n'ai pas créé de compte en
production (l'inscription exige un OTP reçu par email), donc je n'ai pas pu
faire le tour complet cookie → `/auth/me` → dashboard. Les candidats, par ordre
de probabilité :
1. **Verrouillage de compte** : 8 échecs → 429 jusqu'à 60 min, **même avec le
   bon mot de passe**. L'écran affiche le message du serveur mais **pas** le
   délai `Retry-After` (aucune référence à `429` dans `Login.js`).
2. **Session expirée** : le cookie et le JWT vivent 24 h — une session de la
   veille est morte.
3. **Connexion Google** : chemin séparé (`loginWithGoogle`), dépendant de
   `accounts.google.com` et de la CSP ; un échec y ressemble à un échec de
   connexion.
4. **Panne transitoire** au moment de l'essai (déploiement Fly/Vercel).

**À me donner pour trancher** : l'URL exacte utilisée, le mode (mot de passe ou
Google), le message affiché à l'écran, et l'heure. Avec ça, le code de réponse
et le `X-Request-ID` de la réponse disent la cause en une requête.

**Correctif recommandé, indépendant de la cause** : afficher le délai
`Retry-After` en clair (« Réessayez dans 12 minutes ») au lieu de « quelques
minutes », et ajouter un lien « Ce n'est pas moi » vers la réinitialisation.

---

## 8. Bilan

Kojo n'a pas un problème de qualité. Il a un problème de **substance** : la
plateforme est meilleure que ce qu'elle sert.

- Ce qui est construit est **rare** : séquestre à deux temps, litiges tracés et
  arbitrage mesuré, verrouillage par compte et par réseau, SSE avec bus Redis,
  5 langues, accessibilité 100, 42 000 lignes de tests backend.
- Ce qui est **mesuré** est brutal : 0 mission ouverte, 0 mission terminée,
  0 avis, 3 travailleurs.
- Ce qui **coûte** aujourd'hui n'est pas visible dans Lighthouse : c'est un
  visiteur qui arrive sur `/jobs`, voit trois fausses annonces en français, et
  repart. Puis un référencement à 12 URL qui ne peut rien ramener, puisqu'il n'y
  a rien à référencer.

Trois choses, dans cet ordre, changent la trajectoire :
1. **Dix missions réelles terminées** (démarchage, WhatsApp, 0 % de commission).
2. **Le téléphone comme identité** (OTP WhatsApp), parce que l'email n'est pas
   l'identifiant dominant en Afrique de l'Ouest.
3. **Le funnel instrumenté**, pour que la prochaine décision soit une mesure et
   non une intuition.

Le reste — `JobPosting`, en-têtes, H1, performance de `/jobs`, JSON-LD — est du
travail propre, rapide et vérifiable, qui ne produira des visiteurs que le jour
où il y aura des missions à leur montrer.

---

## 9. Annexe — ce que cet audit ne mesure pas

- **Secrets déployés** : mode PayDunya (test/live), `SENTRY_DSN`, `REDIS_URL`,
  `JWT_SECRET`, `METRICS_TOKEN`. `flyctl` est installé mais non authentifié ;
  `vercel` est absent. Non vérifiable sans vos accès.
- **Parcours connecté complet** (dashboard, messages, paiement réel) : exige un
  compte vérifié.
- **Sauvegardes Atlas** : le runbook déclare un cluster M0 sans PITR et une
  restauration externe ; je n'ai pas interrogé l'API Atlas.
- **CrUX / données de terrain** : pas de jeton API ; les chiffres Lighthouse
  sont des mesures de laboratoire (un passage par page).
- **Rendu visuel** (géométrie, contraste perçu) : les parcours e2e du dépôt le
  couvrent en local, pas depuis ici.
