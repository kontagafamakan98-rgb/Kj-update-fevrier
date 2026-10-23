# Audit général de Kojo — 23 octobre 2026 (révision 2)

> **Périmètre** : arbre de travail sur `main` (`a3539edc`) **plus six lots non
> commités** livrés aujourd'hui (paliers de commission, litiges publics, jauge de
> corpus, alerte « marché vide », alerte « missions sans proposition », hygiène
> sécurité) ; production
> `kojoforafrica.cc.cd` / `api.kojoforafrica.cc.cd` ; CI GitHub Actions.
> **Méthode** : mesures exécutées le jour de l'audit (production interrogée en
> HTTP réel, dépôt compté fichier par fichier, tests collectés) + lecture du code
> et des gardes. **Chaque constat porte sa preuve ; ce qui n'est pas mesuré est
> dit comme tel.**
>
> Révision 1 : même jour, avant les lots. Les notes ci-dessous en tiennent
> compte, et les écarts sont expliqués (§3).

---

## 1. Verdict en une page

Kojo est **une place de marché à séquestre remarquablement bien construite, qui
n'a toujours presque personne dedans**.

- Techniquement, le produit est **au-dessus** du standard d'un marché de niche :
  séquestre à deux temps, litiges tracés et arbitrage mesuré, RGPD outillé,
  cinq langues, pré-rendu SEO, sondes de production quotidiennes, sauvegardes
  restaurées et comparées, et désormais une alerte quand la place est vide.
- Commercialement, la place est **toujours vide** : `GET /api/jobs?status=open`
  rend `[]` aujourd'hui (HTTP 200, 1,38 s), le sitemap compte 10 URL dont
  **zéro fiche mission** et 2 profils.
- L'effort reste **déséquilibré** : 73 235 lignes de scripts de garde pour
  53 172 lignes de produit frontend (1,38 pour 1), 17 workflows, 276 mutations.

Le risque principal n'est ni la sécurité, ni la fiabilité, ni la performance :
c'est **l'absence de liquidité et de boucle d'acquisition**. Et il a un
corollaire : plus la place reste vide, plus les gardes vérifient un objet qui
n'existe pas — ce qui rend leurs verts de moins en moins informatifs.

| Axe | Note | Commentaire |
|---|---|---|
| Sécurité / conformité | 9/10 | Verrous de connexion, allowlists, RGPD, CSP, `security.txt`, Dependabot |
| Fiabilité d'exploitation | 9,5/10 | Sondes prod, sauvegardes testées, disjoncteur PayDunya, **alerte marché vide** |
| Qualité du code / tests | 8/10 | 1 963 tests backend collectés, 153 fichiers frontend, 276 mutations |
| Produit (fonctionnalités) | 8/10 | Parcours complet ; litiges visibles ; paliers prêts ; ni KYC ni inscription téléphone |
| Expérience / design | 7/10 | Anti-CLS, accessibilité testée, mais pages denses et un mur email |
| Mesure produit | 3/10 | `page_view` uniquement : aucune étape de tunnel n'est mesurée |
| Acquisition / SEO | 3/10 | Technique excellente, **rien à indexer** (0 mission) |
| Monétisation | 5/10 | Paliers livrés (0 % / 14 % / 8 %) mais **désactivés** ; un seul agrégateur |
| **Traction** | **1,5/10** | **0 mission ouverte le 23/10/2026 (déjà 0 le 12/10)** |

---

## 2. Mesures du jour

| Mesure | Valeur | Source |
|---|---|---|
| Missions ouvertes en production | **0** | `GET /api/jobs?status=open` → `[]`, HTTP 200, 1,38 s |
| URL au sitemap | **10** (0 fiche mission, 2 profils) | `GET /sitemap.xml` |
| Fichiers suivis | 979 | `git ls-files` |
| Backend Python (hors tests) | 203 fichiers, **71 262 lignes** | comptage |
| Tests backend | 113 fichiers, 39 420 lignes, **1 963 tests collectés** | `pytest --collect-only` |
| Frontend `src` | 229 fichiers, **53 172 lignes** | comptage |
| Scripts de garde frontend | 189 fichiers, **73 235 lignes** | comptage |
| E2E | 41 fichiers, 11 798 lignes | comptage |
| Tests frontend | 153 fichiers (59 `src`, 94 `scripts`) | comptage |
| Workflows CI | 17, dont **13 planifiés** (6 entre 07:04 et 07:32) | `.github/workflows` |
| Entrées de surface API | 141 | `backend/tests/surface/*.json` |
| Langues | 5 × **943 clés** (fr, en, wo, bm, mos) | `frontend/src/i18n` |
| Mutations de garde déclarées | **276** (74 python, 202 node) sur 141 gardes | `guard-proofs.json` |
| Empreintes d'état de référence | 105 | `etat-reference.json` |
| Fichiers ≥ 700 lignes | **35** | comptage |
| TODO / FIXME dans le code | 4 | `rg` |
| Alertes propriétaire automatiques | **4** (email, arbitrage, marché vide, missions sans proposition) | `kojo_scheduler` |
| Travail non commité | **28 fichiers modifiés + 10 nouveaux** | `git status` |

---

## 3. Livré depuis la révision 1 (6 lots, non commités)

Ces lots répondent à des propositions de la révision 1. Ils changent la note de
**monétisation** et de **fiabilité**, pas celle de la traction.

1. **Paliers de commission** (`kojo_commission.py`, route propriétaire, écran
   `OwnerCommissionTiers`, page de paiement qui DIT la remise). Défauts :
   0 % sur les 3 premières missions terminées, 8 % au-delà de 10, taux standard
   inchangé (14 %) — **désactivés par défaut** (`actif: false`), parce qu'activer
   une remise ne doit pas être l'effet de bord d'un déploiement. Le taux est
   **figé sur la facture** ; une panne de lecture retombe sur le standard **en
   nommant le motif**.
2. **Litiges visibles** : `disputes_total` / `disputes_lost` publiés sur le
   profil public du travailleur, même à zéro. C'est le seul chiffre négatif de la
   réputation, et il reste un **compteur**, jamais un taux inventé sur trois
   missions.
3. **Alerte « place de marché vide »** (`marche_vide_alert_once`, boucle
   `marche_vide_alert`) : 24 h de vide **continu**, une alerte par épisode, deux
   canaux, réarmée par le retour d'une mission. La mesure est une **durée** lue
   en base, donc un redémarrage ne remet pas le chronomètre à zéro.
4. **Jauge partagée** `kojo_missions_ouvertes` : la route `/metrics` et l'alerte
   lisent la **même** fonction de comptage — deux règles auraient fini par
   diverger.
5. **Alerte « missions ouvertes sans aucune proposition »**
   (`missions_sans_proposition_alert_once`) : le complément de la précédente —
   l'offre est là et personne ne postule. Missions de plus de 3 jours sans
   **aucune** candidature, une alerte par **croissance** de la file (le même
   nombre ne se répète pas), deux canaux, et deux prémisses déclarées (missions
   ou propositions illisibles : une panne de `job_proposals` ne doit pas faire
   croire que toutes les missions sont sans candidature).
6. **Hygiène** : `security.txt`, Dependabot, test des en-têtes de sécurité.

**Ce que ces lots ne changent pas** : il n'y a toujours aucune mission. Une
alerte ne crée pas d'offre ; elle rend le vide et l'absence de candidature
**impossibles à ignorer**, ce qui est une condition pour les corriger, pas le
correctif. Et l'alerte « missions sans proposition » prévient le **propriétaire**
— la relance du **client** ("votre mission n'a reçu aucune candidature") reste à
faire (§6.P1).

---

## 4. Ce qui est réellement solide (et rare)

1. **Séquestre à deux temps** : le travailleur déclare la fin, le client valide,
   sinon libération automatique à 7 jours — un **propriétaire unique** du
   versement (verrou CAS `held → releasing`), donc pas de double paiement.
2. **Litige tracé et arbitré** : ouverture motivée, réponse unique de l'autre
   partie, décision du propriétaire, gel des trois chemins de paiement, et
   **mesure de l'arbitrage** (délai, décisions sans réponse) publiée dans la
   file, avec une alerte quand l'arbitre tranche sans lire l'autre version.
3. **Sécurité de connexion à deux niveaux** : verrou par compte (credential
   stuffing) et plafond par réseau `/24` (password spraying), justifié par le
   CGNAT ouest-africain — un raisonnement qu'on ne trouve presque nulle part.
4. **RGPD opérationnel** : export et suppression complets, inventaire des
   collections, écarts déclarés (WhatsApp, numéro inconnu).
5. **Fiabilité mesurée, pas supposée** : sept sondes de production, sauvegarde
   externe chiffrée **restaurée et comparée** chaque nuit, sonde Atlas, sonde
   email, sonde assistant à trois sorties.
6. **Expérience soignée sur les cas difficiles** : anti-CLS par squelette dédié
   par route, accessibilité vérifiée en e2e, CSP identique côté build et
   documents pré-rendus, fiche partagée qui **démarre** l'application à froid.
7. **Cinq langues vraies** : le wolof est traduit (« Liggéey », « Bataaxal »),
   pas recopié du français ; 943 clés tenues à parité.
8. **Les erreurs coûteuses ont laissé des gardes** : décision de litige dont le
   paiement échoue, double versement, jeton dans une carte OG, marché vide…

---

## 5. Faiblesses, dans l'ordre de ce qui coûte

### C1. La place de marché est vide — constat bloquant, inchangé

**Preuve** : `[]` aujourd'hui, `[]` le 12/10, 9 URL de contenu sans une fiche.

**Effet** : aucun effet de réseau, aucun revenu, et les sondes SEO rendent des
**prémisses** au lieu d'un verdict. Un vert sur un corpus vide ne dit rien.

**Remède** : §6.P1 et §6.P2. Rien d'autre n'a d'effet comparable.

### C2. La vérification est devenue un second produit

**Preuve** : 73 235 lignes de gardes pour 53 172 lignes de `src` (1,38 : 1),
17 workflows, 276 mutations rejouées, 141 gardes pour 105 fichiers d'état de
référence, une CI d'environ 20 min par PR.

**Effet** : chaque évolution coûte plus cher en preuves qu'en fonctionnalité, et
le risque est le **théâtre de process** : un vert qui ne prouve plus rien
d'utile au client. Exemple mesuré : **six** sondes de production distinctes entre
07:04 et 07:32 (fiche, fiche interactive, profil, profil interactif, CSP,
assistant), auxquelles s'ajoutent sept autres crons (02:40, 06:17, 06:30, 06:45,
06:47, 06:52, 06:58) — treize passages quotidiens pour un seul verdict
d'ensemble.

### C3. Aucune boucle d'acquisition

**Preuve** : 10 URL indexables, aucun contenu éditorial, sitemap sans fiche. Le
parrainage existe mais ne peut pas tourner sans missions.

**Effet** : la croissance dépend d'un bouche-à-oreille non outillé.

### C4. Le mur email à l'inscription

**Preuve** : `UserRegister.email` est obligatoire (`EmailStr`), la vérification
se fait par code à 6 chiffres **par email** ; le téléphone est un champ libre.

**Effet** : le public visé vit sur WhatsApp, souvent sans boîte mail — et le
numéro, qui est le canal de **paiement**, n'est pas prouvé.

### C5. Confiance insuffisante pour des montants réels

**Preuve** : `rg "kyc|identity_verified"` → **0 résultat**. Aucun badge
« identité vérifiée ». Le taux de litige est désormais public (bien), mais aucune
identité ne l'est.

**Effet** : un client qui confie 50 000 FCFA à un inconnu n'a que le séquestre
comme garantie. C'est beaucoup ; ce n'est pas la même chose que savoir à qui il
parle.

### C6. Mesure produit quasi absente

**Preuve** : `analytics.js` n'émet que `page_view` (GA4 + Plausible, après
consentement). Aucune étape du tunnel n'est tracée.

**Effet** : impossible de savoir où meurt l'inscription ni combien de missions
publiées trouvent preneur — donc impossible d'améliorer la conversion autrement
qu'à l'intuition.

### C7. Monétisation encore mono-produit

**Preuve** : taux standard 14 %, un seul agrégateur (PayDunya), paliers livrés
mais **désactivés**, aucune offre additionnelle (mise en avant, abonnement,
assurance).

**Effet** : le seul revenu dépend d'un volume nul. Et 14 % se compare mal au
bouche-à-oreille gratuit tant que la valeur (garantie, volume) n'est pas visible.

### C8. Concentration de la complexité

**Preuve** : 35 fichiers ≥ 700 lignes ; les plus gros : `test_litige_trace.py`
1 591, `page-sections.js` 1 553, `kojo_job_disputes.py` 1 269,
`JobDetails.js` 1 205, `kojo_scheduler.py` 1 174, `kojo_routers_auth.py` 1 140,
`Profile.js` 1 084.

**Effet** : revue difficile, régressions concentrées, onboarding lent. Le coût
est déjà visible : aujourd'hui, ajouter une boucle d'alerte a demandé de toucher
`server.py`, le banc de charge, les réglages, la dérive Fly, l'état de référence
et la documentation — six endroits pour une fonction.

### C9. Qualité et latence de l'assistant

**Preuve** (mesurée à la révision 1 de cet audit, même jour) : la sonde a
répondu avec un modèle **gratuit** (`recursive/flint-v1.0:free`), 5 à 30 s par
réponse, budget de 200 appels/jour.

**Effet** : la première impression du support dépend d'un modèle gratuit. La
sonde quotidienne le rend visible ; elle ne le corrige pas.

### C10. Distribution mobile non outillée

**Preuve** : build Capacitor en CI, aucun parcours de publication (Play Store)
documenté. Le public est mobile-first.

### C11. Le travail d'aujourd'hui n'est pas commité — risque immédiat

**Preuve** : 23 fichiers modifiés, 9 nouveaux, aucun commit. L'alerte marché vide
n'existe **que dans l'arbre de travail** : elle ne tourne pas en production.

**Effet** : une manipulation malheureuse perd six lots, et les seules mesures
qui rendraient le vide et les missions sans candidature visibles restent lettre
morte.

---

## 6. Propositions, par impact décroissant

> Convention : **impact** = ce que ça change pour un utilisateur ou pour le
> revenu ; **effort** = jours-homme indicatifs. Une proposition sans mesure qui
> la prouve n'est pas une proposition, c'est une intention.

### P0. Committer et déployer les six lots (0,5 j)

L'alerte « marché vide » est le seul mécanisme du dépôt qui dira, sans qu'on
ouvre un tableau de bord, que la place est vide. Elle ne sert que déployée.
**Preuve d'effet** : la première notification propriétaire arrive ≈ 24 h après le
déploiement (une seule, puis silence jusqu'au retour d'une mission).

### P1. Amorcer la liquidité à la main (0–30 j, non-code)

Objectif : **20 missions réelles terminées** en 30 jours, dans **une** ville et
**trois** métiers (réparation, ménage, livraison/transport).

1. **Conciergerie** : publier à la place des clients (WhatsApp + back-office
   propriétaire existant), avec accord explicite.
2. **Relance client** : toute mission publiée **sans proposition depuis 2 h**
   déclenche une notification ciblée. Le moteur d'alertes existe, et la version
   PROPRIÉTAIRE est livrée (3 jours sans candidature) ; il manque la relance du
   **client** lui-même — c'est lui qui peut changer le prix ou la date.
3. **Garantie visible** : « payé sous 48 h après validation, sinon Kojo paie »,
   **sous le bouton de paiement**, pas seulement sur `/how-it-works`.
4. **Objectif hebdomadaire publié** au propriétaire : publiées, pourvues < 48 h,
   terminées, litiges.

**Preuve d'effet** : `kojo_missions_ouvertes` > 0 durablement, taux de pourvoi
< 48 h publié.

### P2. Inscription par téléphone, email facultatif (3–5 j)

1. Inscription **téléphone + OTP WhatsApp** (Kapso est déjà branché pour le
   support) ; l'email devient facultatif, requis plus tard pour le reçu.
2. Vérifier le numéro **au moment de l'ajout du compte mobile money** — c'est de
   toute façon le canal de paiement.
3. Connexion par téléphone **ou** email ; conserver Google.

**Preuve d'effet** : part des inscriptions terminées, temps médian d'inscription.
Aujourd'hui : non mesuré (§P3 d'abord, ou en même temps).

### P3. Mesurer cinq étapes du tunnel (2 j)

Cinq événements first-party, écrits côté serveur — `business_events` porte déjà
les jalons de mission, il s'agit d'ajouter ceux de l'acquisition :

| Événement | Question |
|---|---|
| `signup_started` / `signup_completed` | où meurt l'inscription ? |
| `job_posted` | combien de clients publient vraiment ? |
| `first_proposal_at` | en combien de temps une mission trouve preneur ? |
| `job_paid` | quel volume réel passe par le séquestre ? |
| `dispute_opened` | la confiance tient-elle ? |

Puis un tableau de bord propriétaire : **taux de pourvoi < 48 h**, **temps
jusqu'à la première proposition**, **taux de complétion**, **taux de litige**,
**commission encaissée**.

**Preuve d'effet** : ces cinq chiffres existent et sont publiés.

### P4. Rendre la confiance visible (5–8 j)

1. **Badge « identité vérifiée »** : pièce + selfie, vérification **manuelle**
   au début (50 profils = 2 h), prestataire ensuite. Affiché sur la fiche
   mission et le profil public.
2. **Exploiter le taux de litige déjà public** : sur la carte de proposition,
   pas seulement sur le profil — « 0 litige sur 12 missions ».
3. **Séquestre expliqué sous le bouton** : une phrase, pas une page.

**Preuve d'effet** : part des profils avec badge, part des missions pourvues
par un travailleur badgé.

### P5. Contenu qui répond à une recherche réelle (5 j)

1. **Pages métier × ville** générées par le pré-rendu existant, **uniquement
   quand N missions vivantes existent** (sinon `noindex`) — sinon on crée des
   pages vides, ce que Google pénalise.
2. **Trois guides** : « se faire payer sans compte bancaire », « combien facturer
   une réparation de frigo à Dakar », « comment choisir un plombier sans se faire
   arnaquer ». Chacun ramène vers une recherche filtrée.
3. **Parrainage visible** dès la première mission terminée, pas enterré dans le
   profil.

**Preuve d'effet** : URL indexables > 10, sessions organiques, inscriptions
attribuées au contenu.

### P6. Activer les paliers et publier le prix (0,5 j + décision)

Les paliers sont écrits et testés mais `actif: false`. Les activer (0 % sur trois
missions, 8 % au-delà de dix) et **l'afficher sur la page de paiement** transforme
un taux subi en argument : « vos trois premières missions sont sans commission ».
**Preuve d'effet** : part des missions au palier `lancement`, commission moyenne.

### P7. Play Store en canal interne (3 j)

AAB existant, inscription téléphone requise (§P2), mode « économie de données » :
images compressées, pas de carte avant demande. Le PWA et le push restent la
porte d'entrée.

**Preuve d'effet** : installation interne réussie, premiers utilisateurs actifs.

### P8. Réduire la dette de vérification (2 j)

1. **Fusionner les six sondes de 07:04 → 07:32** en un workflow à matrice : six
   runs pour un **seul verdict d'ensemble**, les sorties 0/1/2 restant
   séparées.
2. **E2E en deux vagues** : un sous-ensemble critique sur chaque PR, la suite
   complète la nuit — la couverture ne baisse pas, le temps de PR oui.
3. **Supprimer les preuves devenues muettes** : une sonde qui rend une prémisse
   depuis onze jours doit être remplacée par une alerte, pas conservée.

**Preuve d'effet** : durée de CI, nombre de workflows, nombre de prémisses.

### P9. Découper ce qui est déjà trop gros (continu)

`JobDetails` (1 205), `Profile` (1 084), `kojo_scheduler` (1 174),
`kojo_routers_auth` (1 140), `kojo_job_disputes` (1 269). Les panneaux
`DisputePanel` / `CompletionPanel` montrent la voie : un composant, un fichier, un
test.

**Preuve d'effet** : aucun fichier de production > 700 lignes hors données.

### P10. Assistant : un modèle qui ne fait pas attendre (0,5 j)

Payer quelques centimes par conversation, ou choisir un modèle gratuit plus
rapide, et **ajouter la latence à la sonde** (aujourd'hui elle juge le contenu,
pas le délai). Un support qui répond en 25 s coûte plus qu'il ne rapporte.

---

## 7. Plan 30 / 60 / 90 jours

**J1–J30 — faire vivre la place**
- P0 (committer/déployer), P1 (20 missions pilotes, 3 métiers, conciergerie),
  P3 (cinq événements), P6 (paliers activés et affichés).
- Relance client à 2 h ; garantie 48 h sous le bouton.

**J31–J60 — lever les freins**
- P2 (inscription téléphone + OTP WhatsApp, email facultatif).
- P4 (badge identité manuel sur les 50 premiers profils, litiges sur les cartes).
- P5 (trois guides + pages métier conditionnées au corpus).
- P8 (fusion des sondes, E2E en deux vagues).

**J61–J90 — monétiser et mesurer**
- Offre Entreprise (plusieurs recruteurs, factures), mise en avant d'annonce.
- P7 (Play Store canal interne), P9 (découpage), P10 (modèle d'assistant).
- Revue des cinq KPI : si le taux de pourvoi < 48 h reste sous 50 %, le problème
  est l'offre de travailleurs — pas le produit.

---

## 8. Bilan final

**Ce qui est fait est de très haute qualité, et ce n'est plus le problème.**
Kojo a résolu des choses que la plupart des places de marché africaines ratent :
le séquestre ne peut pas payer deux fois, un litige ne se referme pas sans
décision exécutée, une sauvegarde se restaure vraiment, une page partagée démarre
même à froid, un marché vide se signale tout seul, une offre sans candidature
aussi, et l'accessibilité comme le CLS sont mesurés. Les six lots d'aujourd'hui
ne sont pas de la décoration : ils ferment quatre angles morts (prix,
réputation, corpus, et la file des missions que personne ne regarde).

**Mais une place de marché n'est pas un logiciel : c'est une densité.** Les
mesures du 23/10 disent la même chose que celles du 12/10 : zéro mission
vivante, dix URL indexables, deux profils. Aucune sonde, aussi bien écrite
soit-elle, ne remplace une mission publiée. Le risque à moyen terme n'est pas
que Kojo casse : c'est qu'il devienne **un très beau système de vérification
autour d'une place vide**, où chaque vert rassure sur un objet que personne
n'utilise.

**Kojo deviendra attrayant par trois choses, dans cet ordre :**

1. **Une densité visible** — des missions réelles, dans une ville, trois métiers,
   amorcées à la main s'il le faut. C'est la seule preuve qui compte pour un
   visiteur comme pour Google.
2. **Quarante secondes pour s'inscrire** — téléphone + OTP WhatsApp, email plus
   tard. Le public n'a pas de boîte mail ; il a un numéro, et c'est déjà le canal
   de paiement.
3. **Une confiance qui se voit** — identité vérifiée, litiges publics sur les
   cartes, séquestre expliqué sous le bouton. Le séquestre protège l'argent ; il
   ne dit pas à qui on parle.

Si ces trois décisions sont prises, le reste du dépôt — qui est excellent, et
aujourd'hui **au-dessus du besoin** — devient un avantage décisif. Sinon, il
restera ce qu'il est : une des meilleures implémentations techniques du marché,
et une place toujours vide.
