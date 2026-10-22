# Plan de semis de l'offre — 30 jours, 50 missions réelles

Rédigé le **21/10/2026**. Il exécute la ligne 20 du plan de l'audit
(`AUDIT-GENERAL-2026-10-20.md`, §0.6-1 : « semer l'offre ») et il est calibré
pour **une personne à temps plein** — le concierge — plus le propriétaire pour
l'arbitrage et les paiements.

Hypothèse de marché, réversible en un paramètre : **Dakar**. Le code la désigne
comme marché principal (`backend/kojo_models.py`, `Country.SENEGAL` : « Pays
principal - Dakar hub tech »). C'est une hypothèse, pas une mesure : la
première action de J-7 est de la vérifier sur le pays réel des 7 clients et des
2 travailleurs existants (`GET /owner/users-management`, champ `by_country`).
Si la réponse est Bamako, le plan se rejoue à Bamako sans changer une ligne
d'ici. Ce qui ne se rejoue pas, c'est d'ouvrir trois villes avec deux
travailleurs : cela ne produit pas trois marchés, cela produit trois déserts.

---

## 0. Ce que le plan engage, et ce qu'il refuse

| Engage | Refuse |
|---|---|
| 50 missions **réelles** : un client nommé, vérifié par téléphone, une adresse réelle, un budget qu'il a accepté de payer, un travailleur qui se déplace | Toute mission de démonstration publiée en production (`DemoJobsEmptyState` reste un état de liste, jamais une donnée) |
| **40 des 50** passent par le séquestre PayDunya (le cœur du produit) ; les 10 autres sont déclarées « hors séquestre » et comptées à part | Compter une mission cash comme preuve du produit : elle prouve la demande, pas le modèle |
| **≥ 150 propositions** déposées, **≥ 32 missions terminées**, **≥ 24 avis** | Acheter des avis, gonfler un profil, créer un compte travailleur sans personne derrière |
| Un **bench** de travailleurs par catégorie **avant** chaque publication (section 5) | Publier 50 annonces puis chercher qui répond : 50 annonces sans proposition rendent la place **plus** morte qu'avec 12 annonces pourvues |

Ces refus ne sont pas de la prudence : ce sont les seuls faits qu'un visiteur
vérifie en trente secondes (section 3). Les falsifier se paie au premier client
qui appelle.

---

## 1. Point de départ, mesuré

| Grandeur | Valeur au 21/10/2026 | Source |
|---|---:|---|
| Missions ouvertes | **0** | `GET /api/jobs?status=open` (relevé du 12/10/2026, `AUDIT-GENERAL-2026-10-20.md` §0.7) |
| Missions terminées / avis | 0 / 0 | audit §0.7 |
| Clients | 7 | audit §0.7 |
| Travailleurs | **2** | audit §0.7 |
| Catégories | 10 (dont `general`), soit 9 métiers | `backend/kojo_job_categories.py` |
| Pays couverts | 4 (Sénégal, Mali, Burkina, Côte d'Ivoire) | `backend/kojo_models.py` |
| Commission | 14 % | `PAYMENT_COMMISSION_RATE` |
| Budget média | **0 FCFA** (le coût du plan est du temps, pas de la publicité) | — |

Conséquence directe : **le goulot n'est pas l'offre, c'est le bench**. Deux
travailleurs ne peuvent pas servir une mission, encore moins cinquante. La
première semaine (J-7 → J0) est donc du recrutement pur, et le recrutement
continue ensuite **par catégorie, avant** la vague qui l'ouvre.

---

## 2. Cinq contraintes du produit qui décident du plan

Ces règles vivent dans le code et ne se contournent pas ; chacune impose un
geste précis au semis.

1. **Le pays de la mission est celui du compte client.**
   `job.country = current_user.country` (`backend/kojo_routers_jobs_creation.py`),
   et le formulaire `/create-job` n'a **aucun champ pays**. Une mission à Dakar
   exige donc un **compte client `senegal`**, créé avant la publication.
   *Impose* : à l'inscription assistée, le pays se choisit avec le client, pas
   par défaut.

2. **Le push de publication touche au plus 30 travailleurs.**
   `cibles[:30]`, spécialité d'abord, pays en repli
   (`_notify_matching_workers`). *Impose* : au-delà de 30 travailleurs dans une
   catégorie, le surplus ne reçoit **rien** par ce canal — il dépend de la
   veille (point 3). Le bench utile d'une catégorie est donc borné à ~30, et
   c'est la veille qui porte les autres.

3. **Un travailleur en veille reçoit l'annonce au résumé, pas au push.**
   `job_alert_digest_loop`, `JOB_ALERT_DIGEST_INTERVAL_MINUTES` = 60, cinq
   missions par email au plus, plus une notification in-app et le push des
   appareils abonnés (`backend/kojo_job_alerts.py`). Le module mesure aussi le
   prix : une veille coupée entre la publication et le résumé **perd**
   l'annonce. *Impose* : activer la veille de **chaque** travailleur recruté,
   le jour de son inscription, sinon les missions ne dépendent que de sa
   mémoire à rouvrir `/jobs`.

4. **La mission ne se ferme pas toute seule.** Le travailleur déclare la fin
   (note ≥ 20 caractères, 3 photos Cloudinary au plus), le client valide, et à
   défaut `completion_auto_release_loop` libère à **7 jours**
   (`COMPLETION_AUTO_RELEASE_DAYS`). Un litige gèle la libération et se tranche
   en **5 jours** (`LITIGE_DECISION_DAYS`). *Impose* : le concierge relance la
   validation à J+2, jamais à J+7 — l'échéance est un filet, pas un délai de
   travail.

5. **Aucune route d'administration ne publie à la place d'un client.**
   `POST /jobs` exige le rôle CLIENT ; il n'existe ni « publier pour autrui »
   ni file de modération. *Impose* : la conciergerie publie **avec** le client
   connecté (partage d'écran, téléphone, ou visite), jamais par usurpation. Ce
   qui coûte du temps est aussi ce qui rend la mission réelle : le client a vu
   son annonce, il connaît son budget.

---

## 3. L'unité de crédibilité : la mission pourvue, pas la mission publiée

Un visiteur — client ou travailleur — vérifie quatre choses, dans cet ordre :

1. la liste `/jobs` a des missions **récentes** (publiées dans les 7 jours) ;
2. la fiche `/jobs/:id` a des **propositions**, et un travailleur nommé ;
3. le profil `/workers/:id` a une **mission terminée** et un **avis** ;
4. le prix affiché est un budget réel, pas un « à négocier ».

D'où **la règle des 25 %**, qui gouverne tout le plan :

> À aucun moment plus de **25 % des missions ouvertes** ne doivent avoir
> **zéro proposition depuis plus de 24 h**. Si le seuil est franchi : **arrêt
> des publications**, appel au bench, reprise quand il redescend.

C'est la seule métrique qui distingue un semis d'une illusion. Une place de
marché qui affiche 40 annonces dont 30 muettes n'est pas « en amorçage » : elle
est visiblement abandonnée, et c'est plus cher qu'un catalogue court.

Corollaire de volume : **12 à 20 missions ouvertes à la fois**, pas 50. Les 50
se publient en quatre vagues ; une vague ne s'ouvre que si la précédente a été
servie.

---

## 4. Le calcul des 50

| Élément | Valeur | Comment elle est obtenue |
|---|---:|---|
| Missions publiées | **50** | 4 vagues (10 + 14 + 14 + 12) |
| dont séquestre PayDunya | **40** (80 %) | objectif ; les 10 autres sont déclarées hors séquestre |
| Propositions déposées | **≥ 150** | 3 par mission en moyenne — c'est aussi le seuil de bench |
| Missions attribuées | **≥ 40** (80 %) | une mission sans attribution est un échec de bench, pas de demande |
| Missions terminées | **≥ 32** (64 % des publiées) | déclaration + validation, ou libération auto |
| Avis déposés | **≥ 24** (75 % des terminées) | un avis par mission terminée, demandé à J+1 |
| Panier moyen visé | **22 000 FCFA** | plomberie/électricité 15–40 k, ménage 8–20 k, peinture 25–80 k, menuiserie 20–60 k, froid 15–50 k |
| Volume d'affaires | **≈ 1,1 M FCFA** | 50 × 22 000 |
| Commission | **≈ 154 000 FCFA** | 14 % |
| Bench à J14 / J30 | **26 / 60 travailleurs** | 12 → 26 → 42 → 60 ; 3 minimum par catégorie ouverte, 6 à 7 par catégorie ensuite |

Ce n'est **pas** un plan de revenus : 154 000 FCFA ne paient pas un mois de
concierge. C'est un plan de **preuve** — 32 missions terminées avec avis, un
taux de service mesurable, et une réponse à la seule question qui compte pour
la suite : *est-ce que des gens paient pour ça, et reviennent ?*

---

## 5. Les quatre vagues, jour par jour

### J-7 → J0 — préparation (aucune publication)

- Recruter **12 travailleurs** sur **2 catégories** (`plumbing`, `electrical`),
  5 communes maximum : Plateau, Médina, Grand Yoff, Parcelles Assainies,
  Ouakam. Un travailleur = profil complet (photo, spécialités, zone, téléphone
  vérifié) + **veille emploi activée**.
- Recruter **4 clients** de conciergerie (commerçants, immeubles, familles) avec
  une mission identifiée et un budget accepté.
- Nommer **deux marraines métier** (une plombière ou un plombier, un
  électricien) : elles valident la qualité du travail et répondent au bench.
- Instrumenter : le tableau de bord de la section 8 est rempli **à vide** une
  fois avant J1. Un instrument qu'on découvre le jour du lancement mesure mal.

**Porte J0** : 12 profils complets, 12 veilles actives, 4 budgets écrits.

### Vague 1 — J1 à J7 : 10 missions, 100 % conciergerie

| Jour | Missions | Geste |
|---|---:|---|
| J1 | 2 | publication assistée (le client est au téléphone, connecté) |
| J2 | 2 | idem + activation des veilles des 12 |
| J3 | 2 | première attribution ; appel au travailleur dans l'heure |
| J4 | 2 | première déclaration de fin ; validation du client à J+2 |
| J5 | 1 | premier avis demandé |
| J6 | 1 | premier litige éventuel : tranché en 48 h |
| J7 | 0 | **bilan de vague**, aucune publication |

**Porte J7** (les cinq doivent tenir) : ≥ 8 missions avec ≥ 1 proposition en
moins de 4 h · délai médian de première proposition **≤ 90 min** · ≥ 8
attributions · ≥ 6 terminées · ≥ 4 avis. Sinon : pas de vague 2, on répare le
bench.

### Vague 2 — J8 à J14 : 14 missions, +2 catégories (`cleaning`, `carpentry`)

- Bench porté à **26** travailleurs (6 à 7 par catégorie), +2 communes
  (Guédiawaye, Pikine).
- **10 missions de conciergerie, 4 en autonomie** : le client publie seul après
  un lien et une phrase d'explication. C'est le test du formulaire, pas du
  concierge.
- Première mesure de **répétition** : un client de vague 1 qui republie compte
  double dans la preuve (demande récurrente).

**Porte J14** : ≥ 24 missions cumulées, ≥ 19 attribuées, ≥ 14 terminées,
≥ 11 avis, règle des 25 % jamais franchie, **un** client revenu.

### Vague 3 — J15 à J21 : 14 missions, +2 catégories (`mechanics`, `computing`)

- Bench **42**. Densité avant étendue : on reste sur 5 communes.
- **7 conciergerie, 7 autonomes.** Objectif : que la moitié de la vague ne
  doive **rien** au concierge, sinon le semis ne survit pas à son départ.
- Première revue de qualité : les 3 missions les plus mal notées sont relues
  avec la marraine métier, et la cause est écrite (prix, délai, accueil).

**Porte J21** : ≥ 38 missions cumulées, ≥ 31 attribuées, ≥ 24 terminées,
≥ 18 avis, taux de missions pourvues ≥ 80 %, aucun litige ouvert > 48 h.

### Vague 4 — J22 à J30 : 12 missions, tenue et mesure

- Bench **60**, **huit des neuf métiers** (`construction` et `gardening` en
  appoint ; `tutoring` reste hors périmètre, faute de bench).
- **4 conciergerie, 8 autonomes.** Le concierge sort du chemin critique.
- Le travail de la vague est la **rétention** : rappeler les 12 clients les plus
  actifs pour une seconde mission (le coût d'acquisition le plus bas du plan),
  et faire relire les 3 profils travailleurs les plus visités.

**Porte J30** : 50 missions publiées, ≥ 40 attribuées, ≥ 32 terminées, ≥ 24
avis, ≥ 10 clients revenus ou recommandés, et **zéro** mission ouverte de plus
de 14 jours sans proposition.

---

## 6. Les écrans, un par un

Chaque ligne est un écran qui **existe** aujourd'hui : le plan ne demande pas
d'écran nouveau pour tenir les 30 jours, il demande les sept ajouts classés en
section 9.

| Écran | Ce qu'il porte dans le semis | Geste du concierge | Ce qui manque |
|---|---|---|---|
| `/register` | création du compte client **et** travailleur ; le **pays** décide celui de la mission | inscription assistée, au téléphone, pays choisi avec la personne | rien de bloquant ; un champ « commune » aiderait |
| `/create-job` | titre, description (repli automatique à 20 caractères), adresse, budget | pré-remplissage depuis la conversation WhatsApp, puis **relecture par le client** | pas de champ pays (voulu) ; pas de brouillon |
| `/jobs` | la vitrine : missions récentes, puces de catégorie, sélecteur de pays | doit afficher 12–20 missions ouvertes, **jamais** 50 | pas de bouton « partager » (section 9-4) |
| `/jobs/:id` | propositions, séquestre expliqué, litige, panneau de fin | c'est ici que la crédibilité se gagne ou se perd : ne pas publier sans 3 travailleurs prêts | le compteur de propositions n'est pas exposé à l'extérieur |
| `/profile` (travailleur) | photo, spécialités, zone, téléphone : ce que le matching lit | compléter **avec** le travailleur avant J-7, jamais à sa place | pas de champ « commune » distinct de la zone |
| `/workers/:id` | preuve travailleur : identité pro, stats, 10 derniers avis | compléter les profils **avant** la première mission ; l'avis arrive après | pas de note du **client** (écart connu de l'audit) |
| `/messages` | la relation après attribution (flux temps réel) | un message du concierge le jour de l'attribution, un le jour de la fin | rien |
| Cloche + centre de notifications | `proposal_received`, `proposal_accepted`, `job_alert`, fin de mission | vérifier que le client a **vu** la proposition (appel si non) | pas de relance « proposition en attente » côté travailleur |
| `/jobs` onglet « Mes missions » | côté client : ses annonces publiées et leur état | rappeler au client où voir ses propositions | pas de vue « missions sans réponse » |
| `/commission-dashboard` | cockpit propriétaire : commissions, utilisateurs, litiges, journal de mission | revue de 15 min chaque matin | pas de liste des missions ouvertes (section 9-1) |
| Emails | résumé de veille (60 min), proposition reçue, fin de mission | surveiller les adresses retenues (`/owner/email-suppressions`) | pas de relance d'avis |

Deux écrans décident du plan, et méritent d'être dits séparément.

**`/jobs`** est un argument de vente, pas un index. Une liste de 40 annonces
dont 30 muettes se lit « personne ne travaille ici ». Douze missions récentes,
chacune avec deux ou trois propositions, se lit « ça marche ». D'où le plafond
de 20 missions ouvertes et la règle des 25 % : **on cache la rareté en
réduisant le catalogue, jamais en le gonflant**.

**`/jobs/:id`** est la page qu'on colle dans WhatsApp. Elle a déjà sa carte Open
Graph rendue par le backend (`/og/jobs/{id}`) : un lien partagé montre **le
titre et le début de la description**, pas le budget — celui-ci se lit au clic,
sur la fiche. C'est le seul canal de partage existant, et il suffit. Le
concierge envoie **le lien de la fiche**, jamais une capture d'écran : la fiche
est la preuve.

---

## 7. Les relances

Sept relances, chacune avec un moment, un canal et un écran d'arrivée. **Trois
mécanismes existent déjà** (R1, R2, et la notification de déclaration en R5) ;
**quatre relances sont manuelles** pendant les 30 jours. Deux d'entre elles
deviennent les ajouts 2 et 3 de la section 9 (mission muette, avis) ; les deux
autres (R4, R7) restent des appels, et c'est voulu : un travailleur se relance
au téléphone, pas par une notification de plus.

| # | Moment | À qui | Canal | Mécanisme | Arrivée |
|---|---|---|---|---|---|
| R1 | publication | travailleurs de la catégorie (≤ 30) | push + in-app | **existe** : `_notify_matching_workers` | `/jobs/:id` |
| R2 | dans l'heure (résumé) | travailleurs en veille | email + in-app | **existe** : `job_alert_digest_loop` | `/jobs` |
| R3 | +24 h si 0 proposition | concierge (pas le client) | tableau de bord / appel | **manuel** (section 9-2) | `/jobs/:id` |
| R4 | +2 h après proposition | travailleur qui n'a pas répondu | WhatsApp | **manuel** | `/messages` |
| R5 | à la déclaration de fin, puis **+48 h** si non validé | client | push à J+0, appel à J+2 | **existe** à J+0 (`completion_marked_client`) ; rappel +48 h **manuel** | `CompletionPanel` |
| R6 | +24 h après clôture | client, pour l'avis | email / WhatsApp | **manuel** (section 9-3) | `/workers/:id` |
| R7 | +7 j après clôture | client qui a déjà terminé une mission | WhatsApp / appel | **manuel** (répétition) | `/create-job` |

Ce qui rend ces relances supportables — et c'est le produit qui l'impose :
**une annonce par mission et par personne** (le push et la veille ne se
doublent pas), **un résumé par heure** au plus, et **aucune relance de
validation avant J+2**. Une relance qui arrive trop tôt ou deux fois est lue
comme du démarchage, et le premier réflexe est de couper la veille — ce que le
module mesure comme une perte définitive de l'annonce.

### Les textes (FR, à adapter en wo/bm/mos pour les travailleurs)

**R1/R2 — annonce (déjà rédigée par le produit).** Ne pas la doubler d'un
message générique : si le travailleur a une veille, il reçoit le résumé.

**R3 — au bench, quand une mission est muette (> 24 h).**
> Bonjour {prénom}, une mission {catégorie} est ouverte à {commune} :
> {titre}, {budget} FCFA. Personne n'a encore proposé. Tu es disponible
> cette semaine ? Réponds-moi, je t'aide à déposer ta proposition.

**R4 — au travailleur qui a proposé et n'a pas de réponse.**
> {prénom}, ta proposition sur « {titre} » est bien arrivée chez le client.
> Il compare encore. Je le relance aujourd'hui ; si tu as une question sur le
> budget, écris-lui dans la discussion de la mission.

**R5 — au client, 48 h après la déclaration de fin.**
> Bonjour {prénom}, {travailleur} a déclaré la mission « {titre} » terminée
> (photos et compte rendu dans l'application). Validez-vous le travail ? La
> validation libère le paiement ; sans réponse, il est libéré automatiquement
> au bout de 7 jours.

**R6 — au client, 24 h après la clôture.**
> Merci pour « {titre} ». Un avis de 30 secondes aide {travailleur} à trouver
> ses prochaines missions — et il reste visible sur son profil public. Vous
> pouvez aussi republier en deux minutes si vous avez un autre besoin.

**R7 — la relance qui compte le plus, à J+7 après la clôture.**
> {prénom}, votre mission « {titre} » est terminée et payée. Un autre besoin
> cette semaine ? Je peux republier la même annonce avec vous en deux minutes.

---

## 8. Le tableau de bord quotidien (15 minutes)

Quatre chiffres, deux vérifications, une décision. Toujours dans le même ordre.

| # | Chiffre | Où | Seuil d'alerte |
|---|---|---|---|
| 1 | missions ouvertes | `GET /api/jobs?status=open` | < 12 ou > 20 |
| 2 | missions ouvertes **sans proposition** depuis 24 h | liste + fiches | **> 25 %** → arrêt des publications |
| 3 | propositions déposées hier / délai médian de la 1re | fiches des missions publiées la veille | médian > 4 h |
| 4 | missions terminées + avis | `GET /owner/commission-stats`, journal de mission | 0 terminée sur 48 h alors que 3 sont attribuées |
| V1 | litiges ouverts et leur âge | `/owner/litiges` | un litige > 48 h |
| V2 | décaissements incertains | `/owner/stuck-payouts` | un seul suffit |
| D | décision du jour | — | publier / ne pas publier / appeler le bench |

Le tableau de bord **est** le plan : sans lui, le semis devient une suite de
publications et la règle des 25 % se découvre trop tard.

**Contrôle hebdomadaire, déjà outillé** : la sonde SEO stricte
(`frontend/scripts/check-seo-production.js --strict`) publie « 0 fiche jugée »
tant que la production n'a aucune mission vivante. À partir de J7, elle doit
juger de **vraies fiches**. Si elle reste à zéro alors que des missions sont
ouvertes, ce n'est pas le semis qui a échoué : c'est la découvrabilité
(sitemap, statut, `JobPublic`), et cela se corrige avant de publier la suite.

### Seuils de passage (récapitulatif)

| Fin de | Missions cumulées | Terminées | Avis | Missions pourvues | Autres |
|---|---:|---:|---:|---:|---|
| J7 | 10 | ≥ 6 | ≥ 4 | ≥ 80 % | médian 1re proposition ≤ 90 min |
| J14 | 24 | ≥ 14 | ≥ 11 | ≥ 80 % | 1 client revenu |
| J21 | 38 | ≥ 24 | ≥ 18 | ≥ 80 % | 0 litige > 48 h |
| J30 | 50 | ≥ 32 | ≥ 24 | ≥ 80 % | 10 clients revenus ; 0 mission > 14 j muette |

---

## 9. Ce qu'il faut construire pour que ça tienne

Classé par effet sur les 30 jours, pas par élégance. Les quatre premiers
tiennent en une semaine de travail et remplacent des gestes manuels qui, sinon,
seront oubliés au troisième jour.

| # | Ajout | Pourquoi maintenant | Effort |
|---|---|---|---|
| 1 | **Vue propriétaire des missions ouvertes** : âge, nombre de propositions, dernier événement (lecture seule, `GET /owner/missions?statut=open`) | le cockpit actuel ne liste pas ce que le semis produit ; sans elle, le chiffre 2 de la section 8 se lit à la main | S |
| 2 | **Alerte « mission sans proposition »** au propriétaire, une fois par mission et par 24 h (boucle de planificateur, même forme que `email_provider_alert_loop`) | c'est la règle des 25 % rendue mécanique ; une alerte qu'on doit penser à chercher n'existe pas | S |
| 3 | **Relance d'avis à J+1** après clôture (in-app + email, une seule fois) | 24 avis sont la preuve travailleur ; aujourd'hui rien ne les demande | S |
| 4 | **Bouton « Partager »** sur la carte et la fiche : lien OG + `wa.me/?text=` (aucune API) | le seul canal de croissance du plan ; un lien qui montre le titre et la description se partage seul | S |
| 5 | **Compteur de bench** par catégorie et commune (lecture `worker_profiles`) | décide *quoi* publier ; peut vivre dans la vue 1 | S |
| 6 | **Pages ville × métier** (une dizaine d'URL indexables aujourd'hui) | croissance organique, hors des 30 jours : à lancer en vague 3 pour un effet à J60 | M |
| 7 | **Note du client** | l'écart connu : le client n'est pas évalué, donc sa fiabilité n'est visible nulle part | M |

---

## 10. Risques et garde-fous

| Risque | Signe | Réponse |
|---|---|---|
| Publier plus vite que le bench | > 25 % de missions muettes à 24 h | arrêt des publications, appels au bench, reprise sous le seuil |
| Le concierge devient le produit | vague 3 avec < 50 % de missions autonomes | former 2 clients « relais », publier leurs missions en direct |
| Une mission meurt (client injoignable) | pas de proposition acceptée à J+3 | retrait par le client (`DELETE /jobs/{id}`), rappel, aucune republication déguisée |
| Faux sentiment de traction | missions ouvertes > 20, aucune terminée | le tableau de bord compte les **terminées**, jamais les publiées |
| Paiement qui bloque l'entrée | clients qui refusent le séquestre | 10 missions hors séquestre autorisées, déclarées, jamais maquillées |
| Auto-libération payée sans validation | missions libérées à J+7 sans avis client | validation relancée à J+2 (R5) ; litige ouvert dès désaccord |
| Bench concentré | 80 % des travailleurs sur une catégorie | recrutement par catégorie **avant** sa vague, pas après |
| Litige non tranché | un litige > 48 h | arbitrage propriétaire le jour même (fenêtre de 5 jours) |

---

## 11. Bilan à J30

**Réussi** si, et seulement si : 50 missions publiées, **≥ 32 terminées**,
**≥ 24 avis**, ≥ 80 % des missions pourvues, médian de première proposition
sous 90 min, **10 clients revenus**, et la règle des 25 % jamais tenue plus de
48 h. Alors la preuve est faite, et deux choses deviennent possibles : ouvrir
Bamako ou Abidjan (avec le même bench d'abord), et vendre un argument mesuré au
lieu d'une démonstration.

**Presque** si les missions partent mais que les avis manquent : le problème est
la boucle de preuve (ajout 3), pas la demande.

**Échec** si moins de 20 missions terminées : la demande existe mais le bench ne
suit pas, ou les prix sont hors marché. Dans les deux cas, la réponse est un
mois de plus **sur deux catégories**, pas une troisième ville.

**Ce que ce plan ne prouve pas**, et qu'il faut écrire plutôt que laisser
croire : la rétention au-delà de 30 jours (un client qui revient une fois n'est
pas un client fidèle), la disposition à payer la commission une fois le
séquestre devenu habituel, la stabilité des revenus d'un travailleur, et la
significativité de 50 missions — c'est un ordre de grandeur, pas une étude.

À publier à J30, avec des chiffres et pas des adjectifs : le nombre de missions
terminées, le délai médian de première proposition, le taux de missions
pourvues, les 24 avis, et ce que les clients ont dit en R7. C'est le seul
document qui autorise la vague suivante.

---

## Annexe — journal de semis (une ligne par mission)

Le concierge le tient à la main ; il devient la source du bilan et, plus tard,
la spécification de la vue propriétaire.

| date | id mission | client | catégorie | commune | budget | canal | propositions | 1re prop. (min) | attribuée | terminée | avis | note |
|---|---|---|---:|---:|---:|---|---:|---:|---|---|---|---|
| | | | | | | conciergerie / autonome | | | oui/non | oui/non | oui/non | |
