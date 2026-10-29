# Audit général de Kojo — 27 octobre 2026

> **Périmètre** : production (`https://kojoforafrica.cc.cd` sur Vercel,
> `https://api.kojoforafrica.cc.cd` sur Fly.io), `main` à `617cc6b9`, et l'arbre
> de travail local (propre, sur `main`, sans PR ouverte).
> **Méthode** : mesures exécutées le 27/10/2026 entre 05:40 et 06:00 UTC — HTTP
> réel (statuts, en-têtes, latences, HTML servi), API publique, sitemap,
> `robots.txt`, GitHub Actions (runs et sondes), sonde de l'assistant support,
> et lecture du code. **Chaque constat porte sa mesure ; ce qui n'a pas été
> vérifié aujourd'hui est dit comme non vérifié.**
> **Ce que cet audit ne couvre pas** : les parcours authentifiés (inscription
> réelle avec livraison d'OTP, paiement PayDunya de bout en bout, arbitrage,
> administration, messagerie), les binaires mobiles installés, la configuration
> des secrets (illisible depuis le dépôt), et la mesure Lighthouse (non
> rejouée aujourd'hui — voir §4 pour la dernière valeur datée).

---

## 1. Verdict en une page

Kojo est **une place de marché à séquestre dont l'ingénierie a dépassé le
marché qu'elle sert**. Le déséquilibre est le même que le 26/10, et il s'est
même creusé d'un cran : une fonction payante est **en panne en production**
depuis la veille, et personne ne l'a vue.

| Ce qui est mesuré le 27/10/2026 | Valeur | Source |
|---|---:|---|
| Travailleurs | **3** | `GET /api/public/stats` |
| Clients | **8** | idem |
| Missions ouvertes | **0** | `GET /api/jobs?status=open` → `[]` |
| Missions terminées | **0** | `/api/public/stats` |
| Avis | **0** | idem |
| Pays couverts | 4 | idem |
| URL au sitemap | **13** (9 statiques + 1 fiche + 3 profils) | `/sitemap.xml` |
| Assistant support (`/api/support/robot/chat`) | **502 en 0,8–1,0 s, 5 fois sur 5** | sonde + 2 appels directs |
| Sonde `ai-assistant-probe` (cron) | **ROUGE depuis le 26/10 14:31** | Actions |
| CI sur `main` (5 derniers runs) | **5 / 5 verts** | Actions |
| Sondes quotidiennes (hors assistant) | **13 vertes** | Actions, 26/10 |
| Charge d'une clé i18n | **973 clés × 5 langues** | `fr.json` |
| Fichiers de tests | **72 frontend + 120 backend** | `src/**/*.test.*`, `tests/test_*.py` |
| Scripts de garde frontend | **54** (`check-*.js`) | `frontend/scripts/` |
| Latence servie (poste → Vercel) | `/` **0,58 s** · `/jobs` **0,34 s** (TTFB) | curl |
| En-têtes statiques | **6 / 6** attendus présents | `curl -I` |
| Sécurité des surfaces publiques | `/docs` **404**, `/openapi.json` **404**, `/metrics` **401** sans jeton, CORS n'écho pas une origine inconnue | curl |
| Révision servie | `617cc6b9…` = tête de `main` | HTML servi |
| Version backend | `8e30049498ec`, base connectée, PayDunya `closed` | `/health` |

**La phrase qui résume l'écart** : le site sait séquestrer l'argent, tracer un
litige, arbitrer, publier une fiche pour un crawler, et il ne sait pas encore
répondre à « comment publier une mission ? » — la seule question que se pose un
nouveau venu. Le 27/10, l'assistant qui devait y répondre rend 502 en une
seconde, et le seul signal de cette panne est un cron rouge que personne ne lit.

---

## 2. Le fait du jour : l'assistant support est muet en production

| Moment | Mesure | Résultat |
|---|---|---|
| 27/10 05:48 | `check_ai_assistant_probe.py` (3 questions de référence : publier, être payé, litige) | **3 × 502** |
| 27/10 05:52 | `POST /api/support/robot/chat` « Comment publier une mission ? » | **502 en 1,00 s** |
| 27/10 05:53 | idem « Comment suis-je payé ? » | **502 en 0,80 s** |
| 26/10 14:31 | run `ai-assistant-probe` | **échec** (24/10 et 25/10 : succès) |

**Ce que la mesure dit avec certitude** : le refus est **immédiat** (0,8–1,0 s),
très loin du délai d'attente de 30 s (`AI_GATEWAY_TIMEOUT_SECONDS`). Ce n'est
donc ni un modèle lent, ni une réponse tronquée par le plafond de jetons — les
deux causes identifiées le 23/10. Le gateway **refuse l'appel** : jeton, quota,
modèle absent du catalogue, ou compte sans crédit. Le code nomme d'ailleurs ces
quatre cas dans son journal (`gateway HTTP <statut> : …`), sans jamais publier
le jeton.

**Ce que la mesure ne dit pas** : *lequel* des quatre. La cause exacte est dans
la ligne de log Fly (`flyctl logs -a kojo-backend`), et il n'y a pas de jeton
`flyctl` sur ce poste. La distinguer demande une minute à qui a l'accès — voir
l'amélioration **A1**.

**Conséquence produit** : deux surfaces publiques répondent « L'assistant n'a
pas pu répondre. Réessayez ou déposez une demande. » — la page `/support`, et le
canal WhatsApp (relais Kapso), qui est le canal réel de ce marché. Un visiteur
qui pose sa première question reçoit une panne.

**Conséquence de méthode** : la sonde a fait son travail (elle est rouge, elle
nomme la question et le statut). Le maillon qui a manqué est celui qui **va
voir** le rouge. Sur 17 workflows, 14 sont des sondes planifiées : un cron rouge
n'est pas une alerte.

---

## 3. Notes par domaine — 27/10/2026

Notes sur 10, justifiées par la mesure. Une note basse n'est pas un jugement sur
le travail : c'est l'écart entre ce qui est construit et ce qui est **observé en
production**.

| Domaine | Note | Preuve du 27/10/2026 |
|---|---:|---|
| Ingénierie backend | **9,5** | Séquestre, litiges, KYC wallet, modération, équipe support ; `/health` 200, base connectée, PayDunya `closed` |
| Sécurité | **9** | `/docs` et `/openapi.json` 404, `/metrics` 401 sans jeton, CORS n'écho pas une origine inconnue, 6/6 en-têtes statiques, gitleaks bloquant sur les PR |
| Performance | **9,5** | TTFB 0,58 s (`/`) et 0,34 s (`/jobs`) depuis un poste ouest-africain ; dernière mesure Lighthouse mobile (26/10) : 99 et 98. **Non rejouée aujourd'hui** |
| Accessibilité | **9,5** | 4 gardes de contraste mesurés (navbar, `/login`, pied de page, barre du bas), parcours clavier + axe en CI. Dernier défaut fermé le 27/10 (icônes de la barre du bas, 1,54:1 → 4,57:1) |
| SEO technique | **9** | Pré-rendu des 12 coquilles + 404, canonical, OG/Twitter, `JobPosting` sous contrat, sitemap servi par le backend, `robots.txt` cohérent |
| SEO de contenu | **6** | **29 URL** statiques (13 avant) : **22 pages ville et métier** publiées le 27/10 — 13 villes du référentiel géographique, 9 métiers — avec titre, description, introduction écrite, `h1`, JSON-LD `CollectionPage`/`ItemList` et maillage ville ↔ métier ; `/login` et `/register` retirés du sitemap. **Reste** : aucun guide, aucune page par besoin, et des listes encore vides tant qu'il n'y a pas de mission |
| Internationalisation | **8** | 973 clés × 5 langues, parité vérifiée par garde ; traductions non relues par des natifs |
| Mobile (Capacitor) | **7** | `cap sync` + Gradle **dans la CI** (vérifié dans `ci.yml`) ; bundle natif non installé ni testé ici |
| Paiement | **8** | Séquestre, remboursement, KYC wallet, devis avant checkout ; mode live non vérifiable sans secret |
| Observabilité | **7,5** | `/metrics` fermé par défaut, 9 familles de flux, scrape documenté, 14 sondes quotidiennes — **mais aucune alerte** : la panne de l'assistant date de la veille et n'a été vue par personne |
| Tests / CI | **9,5** | 5/5 runs verts sur `main`, 72 + 120 fichiers de tests, 54 gardes frontend ; run complet ≈ **27 min** |
| Produit / traction | **1,5** | 0 mission ouverte, 0 terminée, 0 avis, 3 travailleurs, 8 clients ; **et l'assistant qui devait convertir est en panne** |
| Confort de développement | **6,5** | 54 scripts de garde pour 26 pages, 17 workflows. `kojo_job_disputes.py` découpé le 27/10 (**1 269 → 863** lignes, états et mesures sortis) ; restent **`JobDetails.js` 1 227** et `kojo_scheduler.py` 1 952 — le découpage du planificateur n'a pas été tenté (il porte des passes à échéance, un découpage à l'aveugle y casserait des garanties) |

**Moyenne** : ≈ **9,0/10 technique**, **1,5/10 marché** (pondérée par ce qui fait
vivre une place de marché : ≈ 4,5).

---

## 4. Ce qui est solide (mesuré aujourd'hui, ou daté)

1. **Production alignée sur `main`.** Le HTML servi annonce
   `617cc6b9d445147d0fd5e3e5db3f42075e4fd77e`, la tête de `main`. `/health`
   répond `8e30049498ec`, base connectée, disjoncteur PayDunya fermé. Aucune
   dérive frontend/backend.
2. **Les en-têtes statiques sont complets** : CSP `frame-ancestors 'none'`,
   HSTS 63 072 000 s, `nosniff`, `strict-origin-when-cross-origin`,
   `Permissions-Policy` avec `geolocation=(self)`. Vérifié à l'instant, pas
   recopié d'un audit précédent.
3. **Les surfaces sensibles du backend sont fermées** : `/docs` et
   `/openapi.json` rendent **404** en production, `/metrics` **401** sans jeton
   et **401** avec un jeton faux, et le CORS ne renvoie
   `access-control-allow-origin` que pour l'origine du site — pas pour
   `https://evil.example`.
4. **La performance est une force, pas une intention** : TTFB 0,58 s sur `/` et
   0,34 s sur `/jobs` depuis un poste ivoirien, 134 Ko et 103 Ko de HTML
   pré-rendu. Dernière mesure Lighthouse mobile (26/10) : **99** et **98**, CLS
   0,0000, TBT 20 ms. *Non rejouée dans cet audit.*
5. **La CI est un vrai verrou** : 5 runs consécutifs verts sur `main`, dont E2E
   (trois moteurs), le lint des workflows, la sonde d'inventaire des étapes
   informatives, le scan de secrets épinglé et vérifié, et le build Android.
6. **Le contraste est désormais mesuré, pas supposé** : cinq gardes le calculent
   sur la surface réellement peinte (carte composite de `/login`, verre de la
   barre, fond opaque `bg-orange-50` de l'onglet actif, verre du pied de page).
   Le défaut trouvé le 27/10 (icônes de la barre du bas à 1,54:1) n'a pas été
   trouvé à l'œil : il l'a été par une mesure.
7. **La parcelle honnêteté tient** : `/jobs` vide affiche un constat et trois
   issues réelles, la bande de preuve sociale refuse tout chiffre non mesuré,
   et les fiches pourvues ne publient pas de `JobPosting`.
8. **Les sauvegardes externes tournent** : `backup-db.yml` vert le 26/10
   (dump → restauration comparée → chiffrement → dépôt privé), et
   `atlas-backups-probe` vert le 26/10.

---

## 5. Ce qui ne va pas (chaque point porte sa mesure)

### F1 — L'assistant support est en panne, et rien ne l'a signalé · **P0**
502 en 0,8–1,0 s, 5 fois sur 5, sonde rouge depuis le 26/10 14:31. Deux
surfaces publiques concernées (`/support` et WhatsApp). Cause probable : jeton,
quota ou catalogue côté Neon AI Gateway — non distinguable sans le log Fly.

### F2 — Le marché est vide, donc rien de ce qui est construit ne sert · **P0**
0 mission ouverte, 0 terminée, 0 avis, 3 travailleurs. Les mécanismes à deux
temps (séquestre, litige, KYC wallet, commission) n'ont **jamais** été exercés
par une vraie transaction, et une place vide n'a pas de preuve à montrer.

### F3 — 200 appels d'IA par jour, pour un canal WhatsApp · **P1**
`NEON_AI_GATEWAY_DAILY_CALLS` par défaut = **200** (avec 250 000 caractères de
prompt). C'est un plafond de démonstration : à 50 conversations par jour et
trois messages chacune, le canal se ferme avant midi. Le plafond est réglable
par variable d'environnement — c'est un arbitrage, pas un chantier.

### F4 — Le SEO de contenu n'a presque rien à classer · **P1** — *traité en partie le 27/10/2026*
13 URL, dont 2 formulaires (`/login`, `/register`, tous deux `index, follow` et
au sitemap). Aucune URL par ville, par métier ou par besoin. Avec 4 pays et
zéro mission vivante, il n'y a rien à capter — et les pages par ville sans
mission réelle seraient des pages creuses.

**Ce qui a été fait.** `/emplois/{ville}` et `/metiers/{metier}` existent :
**22 pages** dont les villes sont **dérivées** de `kojo_geo_data` (aucune
seconde liste) et les métiers du catalogue de catégories. Chacune porte un
titre, une description qui compte les offres **réellement** ouvertes, une
introduction écrite, un `h1`, un JSON-LD `CollectionPage`/`ItemList`, la liste
liée des missions et le maillage ville ↔ métier. Le sitemap passe de 13 à
**29 URL** et ne cite plus les deux formulaires. Le vide est DIT (« aucune
offre ouverte »), jamais masqué — garde : `backend/tests/test_pages_metier_seo.py`
(18 cas).

**Ce qui reste pour viser 10.** Les listes resteront vides tant qu'il n'y a pas
de mission : 22 pages de contenu réel valent mieux que 13 pages génériques,
mais elles ne remplacent pas l'offre. Manquent aussi les guides (« combien
coûte un plombier à Abidjan »), les pages par besoin, et les données
structurées `FAQPage` sur ces guides.

### F5 — L'inscription passe par l'email et un code · **P1**
`/register` demande un compte, un email, un mot de passe, un code OTP, un pays,
une langue, une photo (facultative), puis les comptes de paiement (facultatifs
depuis le 22/10). Or ce marché vit sur WhatsApp et le téléphone, pas sur la
boîte mail ; le canal WhatsApp existe déjà (Kapso) mais uniquement pour le
support. C'est la friction la plus chère : elle tombe avant tout le reste.

### F6 — La preuve sociale est au repos, et le restera · **P2**
Sous les seuils (3 missions terminées, 2 avis), la ligne affiche « chiffres à
venir ». C'est honnête et c'est un écran vide à l'endroit où un visiteur cherche
une raison de faire confiance. Les seuils sont justes ; ce qui manque est une
**autre** preuve, qui ne dépende pas de compteurs.

### F7 — Une sonde rouge n'est pas une alerte · **P1**
14 sondes planifiées, 1 rouge depuis la veille, 0 notification envoyée. Les
scénarios de panne couverts sont excellents ; le maillon « quelqu'un
l'apprend » n'existe pas. Le remède ne demande aucune dépendance nouvelle :
ouvrir une **issue GitHub** depuis le workflow (aucun secret à créer), ou
poser un webhook Slack en secret si l'équipe préfère Slack.

### F8 — La succession reste un point unique · **P2**
`CONTINUITE.md` le dit lui-même : les 9 services (Fly, Vercel, Atlas, GitHub,
Cloudinary, PayDunya, email, Sentry, domaine) ont **le même propriétaire et la
même personne en accès de secours**, et les cases « vérifié » sont vides. Ce
n'est pas un défaut de code ; c'est le risque qui rend tous les autres
irréversibles.

---

## 6. Améliorations proposées

Classées par effet attendu, pas par élégance. « Effort » est une estimation
d'ingénierie, « preuve » est ce qui dira si c'est fait.

### P0 — cette semaine

**A1. Diagnostiquer et réparer l'assistant (2 h).**
Lire la ligne `gateway HTTP …` dans les logs Fly, puis, selon le statut :
renouveler `NEON_AI_GATEWAY_TOKEN`, vérifier le crédit du compte Neon, ou
remettre un modèle réellement présent au catalogue (`claude-haiku-4-5`).
*Preuve* : `python backend/scripts/check_ai_assistant_probe.py` sort en 0, et
le run `ai-assistant-probe` repasse au vert. Rien d'autre ne compte.

**A2. Faire du rouge une alerte, pas un état (demi-journée).**
Un seul workflow « santé des sondes » qui lit la conclusion des 14 crons et
envoie **un** message (Slack, déjà connecté) avec la sonde, la cause et l'URL
du run — et qui ne renvoie rien quand tout est vert. Un canal qui parle tous les
jours se fait muet ; un canal qui parle le jour où quelque chose casse est lu.
*Preuve* : une panne simulée (sonde forcée en échec) produit un message nommé.

**A3. Remplir le marché à la main, avant d'écrire une ligne de code (1 semaine).**
Objectif : **10 missions réelles** dans **une** ville et **deux** métiers
(Bamako, plomberie et ménage, par exemple). Le mainteneur collecte la demande
par WhatsApp, publie la mission lui-même, accompagne le paiement. C'est du
travail commercial, pas du produit — et c'est la seule chose qui fasse passer
`completed_jobs` de 0 à 1, puis à 3, ce qui débloque les avis, la preuve
sociale, `AggregateRating`, et la crédibilité de tout le reste.
*Preuve* : `/api/public/stats` publie `completed_jobs: 1`, puis 3, et les
premiers avis apparaissent sur les profils.

### P1 — dans le mois

**B1. Inscrire et se connecter par téléphone (3–5 j).**
OTP par SMS/WhatsApp (le relais Kapso existe déjà, mais un envoi OTP est un
message UTILITAIRE : vérifier son gabarit et son coût avant de l'emprunter),
email facultatif ou en repli, même mécanique de vérification que le circuit
actuel. L'email devient un détail de profil, pas une porte.
*Preuve* : un parcours d'inscription complet sans boîte mail, mesuré en
production, et un garde qui refuse une inscription dont le téléphone n'est pas
vérifié.

**B2. Une preuve qui ne dépende pas des compteurs (2 j).**
Sur l'accueil, remplacer/compléter la ligne de preuve par ce qui est vrai
aujourd'hui : les missions accompagnées par le mainteneur (avec l'accord des
personnes), les métiers couverts, le fonctionnement du séquestre expliqué en
trois phrases, et les moyens de paiement réellement acceptés. Aucun chiffre qui
ne soit mesuré — la règle de `preuveSociale.js` reste la bonne ; c'est la
**source** de preuve qui manque, pas la règle.
*Preuve* : l'accueil affiche une preuve non nulle et non inventée, et un garde
vérifie qu'elle ne contient aucun compteur sous les seuils.

**B3. Ouvrir le SEO quand il y aura de quoi le remplir (3 j, après A3).**
Pages `ville × métier` (`/bamako/plomberie`) **uniquement** si la ville compte
au moins 3 missions réelles ; sinon la page n'existe pas (pas de page creuse,
pas de `noindex` qui traîne). Retirer `/login` et `/register` du sitemap : deux
formulaires n'ont rien à y faire.
*Preuve* : le sitemap grandit avec les missions réelles, et le garde de
découvrabilité refuse une page ville sans mission.

**B4. Relever le plafond d'IA et le surveiller (1 h).**
Passer `NEON_AI_GATEWAY_DAILY_CALLS` à une valeur qui tienne un vrai canal
(500–1 000), garder `NEON_AI_GATEWAY_DAILY_PROMPT_CHARS` comme garde-fou de
coût, et publier le compteur du jour dans `/metrics` (le module de budget tient
déjà les compteurs).
*Preuve* : une famille `kojo_ai_appels_jour` sur `/metrics`, et zéro 429 de
budget sur une journée de test.

### P2 — quand le marché tourne

**C1. Deux personnes par service (1 j, administratif).** Fermer l'écart de
`CONTINUITE.md` : un second accès réel sur Fly, Vercel, Atlas, GitHub,
PayDunya, Cloudinary, Sentry et le domaine, cases cochées après connexion.
*Preuve* : les 9 lignes du tableau passent à `[x]` avec un second nom.

**C2. Exercer la restauration sur le chemin Atlas (2 h).** L'exercice daté
(18/10) est local (`mongodump`/`mongorestore`) ; le cluster est un M0 sans
Cloud Backup, donc la seule restauration possible est **externe**. Rejouer
l'exercice depuis l'archive S3/R2 chiffrée, et dater le résultat dans
`backend/SAUVEGARDES_ATLAS.md`.
*Preuve* : `check-exercice-restauration.py` voit un exercice externe daté, et
l'empreinte SHA-256 de la base restaurée égale celle de l'archive.

**C3. Rangez les gardes (2–3 j).** 54 scripts de garde pour 26 pages : le coût
d'entretien commence à dépasser la valeur de quelques-uns. Un lanceur unique
`npm run gardes` par famille (SEO, contraste/CLS, workflows, i18n) et un
inventaire qui refuse un garde non classé — la même discipline que
`informative-steps.json`, appliquée aux gardes eux-mêmes.

---

## 7. Ce que cet audit ne couvre pas

- **Lighthouse** : non rejoué aujourd'hui (30–60 min de machine). La dernière
  valeur datée est celle du 26/10 : 99 sur `/`, 98 sur `/jobs`.
- **Les parcours authentifiés** : inscription avec OTP réel, paiement PayDunya
  de bout en bout, arbitrage d'un litige, administration, messagerie. Aucun
  n'est exercé ici : ils demandent des comptes et des secrets.
- **`npm audit` / `pip-audit`** : non rejoués aujourd'hui (dernier relevé
  connu : 0 vulnérabilité en production côté npm).
- **Le log du backend** : pas de jeton `flyctl` sur ce poste, donc la cause
  exacte du 502 n'est pas nommée — c'est l'objet d'A1.
- **Les binaires mobiles** : la CI construit l'APK, mais aucun appareil n'a été
  utilisé ici.

---

## 8. Bilan

**Techniquement, Kojo est prêt.** Mesuré aujourd'hui : production alignée sur
`main`, 5 runs de CI verts d'affilée, 6 en-têtes de sécurité sur 6, surfaces
sensibles fermées, CORS strict, TTFB sous 0,6 s, 973 clés i18n à parité dans
5 langues, 192 fichiers de tests, 14 sondes de production, un contraste calculé
au lieu d'être estimé. Ce n'est pas une promesse, c'est un relevé.

**Commercialement, Kojo n'a pas commencé.** 3 travailleurs, 8 clients,
0 mission ouverte, 0 terminée, 0 avis, 13 URL. Aucun levier de croissance ne
peut s'enclencher tant que `completed_jobs` vaut 0 : pas d'avis, pas de preuve,
pas de rétention, pas de bouche-à-oreille — et le référencement n'a rien à
classer.

**Et le 27/10 ajoute une leçon de méthode** : le seul composant qui parlait au
visiteur au moment où il hésite est tombé hier après-midi, et le dépôt le
savait — la sonde était rouge. Ce qui a manqué n'est ni un test ni un garde :
c'est quelqu'un qui l'apprenne. Les 14 sondes sont un système de mesure ; il
leur manque un destinataire.

**Les trois choses à faire, dans cet ordre** :
1. **Réparer l'assistant** (A1) et **brancher les alertes** (A2) — un jour.
2. **Remplir le marché à la main** (A3) : 10 missions, une ville, deux métiers —
   c'est le seul chantier qui change la nature du produit.
3. **Ouvrir la porte par le téléphone** (B1) une fois qu'il y a quelque chose à
   trouver de l'autre côté.

Le reste — SEO programmatique, preuve sociale enrichie, plafonds d'IA, gardes
rangés — vaut la peine, mais **après** la première mission terminée. Tant que
`completed_jobs` est à 0, tout le reste est de l'échafaudage.

---

## 9. Suite du 27/10 — ce qui a été fait sur A1 et A2

**A2 (le rouge devient une alerte) est fait et prouvé hors production.**
`.github/workflows/sondes-sante.yml` + `.github/scripts/alerte_sondes.py`
(07:50 UTC, après la dernière sonde de 07:32) : la liste des jobs planifiés est
**lue** (13 le 27/10, sauvegardes comprises), l'alerte s'exclut elle-même, un run
`cancelled` n'est pas un rouge, la même panne ne réécrit pas l'issue (empreinte),
un rétablissement la referme avec un commentaire, une journée verte n'écrit
**rien**, et une prémisse (jeton, API, plancher de lecture) sort en 2 en le
disant. Garde : `backend/tests/test_sondes_sante_workflow.py`, 23 cas ; trois
mutations rejouées (auto-surveillance, journée verte qui écrit, `cancelled`
compté rouge) ont chacune fait rougir un cas nommé.

**A1 est à moitié fait, et la moitié qui manque n'est pas du code.**
La forme de la requête a été vérifiée contre le catalogue public de Neon
(`claude-haiku-4-5`, `max_tokens`) : elle est correcte, donc l'échec est côté
COMPTE (jeton, crédit ou quota), pas dans notre appel. Ce qui a été fait :
`/health` publie désormais `ai_gateway` — cause classée et motif actionnable
(401 → renouveler le jeton, 402 → recharger le crédit, 400/404 → corriger le
modèle, 429 → quota, 5xx → fournisseur) — sans jamais porter le jeton, l'hôte ni
le corps d'erreur. Garde : `backend/tests/test_ai_gateway_diagnostic.py`, 13 cas.

Ce qui reste, et qui demande un accès que ce poste n'a pas : lire la cause et
agir dessus. Deux chemins, au choix : `flyctl logs -a kojo-backend | grep
"gateway HTTP"` avec l'accès Fly, ou, une fois ce changement déployé,
`curl -s https://api.kojoforafrica.cc.cd/health | jq .ai_gateway` — le bloc
donne le statut exact et la phrase qui dit quoi faire. **Tant que ce n'est pas
fait, la sonde reste rouge et c'est la vérité** : aucun vert n'a été fabriqué.
