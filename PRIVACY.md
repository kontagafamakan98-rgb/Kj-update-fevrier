# Politique de confidentialité et de conservation des données

Kojo met en relation des clients et des travailleurs au Sénégal. Ce document dit
quelles données le service conserve, pendant combien de temps, et par quel
mécanisme — en citant à chaque fois le fichier et le symbole qui portent
l'affirmation, pour qu'elle soit vérifiable plutôt que crue.

**Le tableau de la section 4 n'est pas écrit ici.** Il est engendré depuis le
code par `.github/scripts/check-privacy-policy.py`, et la CI refuse une
divergence entre les deux. Les autres sections sont du texte humain : elles
n'ont pas cette garantie, et les écarts connus sont nommés en section 7.

---

## 1. Données traitées

| Famille | Contenu | Où c'est déclaré |
| --- | --- | --- |
| Compte | email, nom, prénom, téléphone, mot de passe (haché), type d'utilisateur, pays, photo de profil, bio, compétences | `backend/kojo_models.py` (`User`) |
| Mission | titre, description, lieu et coordonnées GPS, statut, identifiants du client et du travailleur assigné | `backend/kojo_models.py` (`Job`) |
| Proposition | montant proposé, message, identifiant du travailleur | `job_proposals` |
| Message | contenu, expéditeur, destinataire, horodatage | `messages` |
| Paiement | montant, commission, méthode, statut, jeton de facture, identifiants internes (`payer_id`, `receiver_id`) | `backend/kojo_routers_payments.py` |
| Avis | note, commentaire, auteur, destinataire | `reviews` |
| Notification | titre, contenu, état de lecture | `notifications` |
| Appareil | jeton push (Android / web) | `push_tokens` |
| Support | nom, téléphone, email (facultatif), motif, message libre | `support_tickets` |
| Support WhatsApp | numéro, nom de profil WhatsApp, texte échangé avec l'assistant (les deux sens) | `whatsapp_messages` |
| Vérification | code OTP (haché), date de péremption ; jeton d'accès révoqué (identifiant seul) | `email_otps`, `revoked_tokens` |
| Livraison email | adresse email, fait de livraison reçu du fournisseur (rebond, plainte, livraison réussie), identifiant d'événement | `email_delivery_events`, `email_suppressions` |
| Alerte emploi | adresse email du compte, critères choisis (catégorie, ville, pays), jeton de désinscription | `job_alerts` |
| Assistant IA | compteur de dépense du jour : nombre d'appels et nombre de caractères de prompt, agrégés pour tout le service — aucun lien vers un compte, le chat n'est pas conservé | `ai_usage` |

La liste fait autorité dans le code : `USER_DATA_SOURCES`, `USER_DATA_BY_EMAIL`
et `NO_USER_DATA_COLLECTIONS` (`backend/kojo_routers_users.py`) classent
**toutes** les collections du backend, et un test échoue si une collection
nouvelle n'est pas classée. Autrement dit, ajouter une collection oblige à
trancher ici.

Les identifiants sont des UUID internes. Un paiement ne porte **aucune** PII :
ni nom, ni téléphone, ni email (`payer_id` et `receiver_id` sont des
identifiants de compte).

## 2. Sous-traitants

Kojo ne traite pas seul ces données : des prestataires font tourner le service.
Cette section est la liste de ceux que le code appelle, avec ce que chacun
reçoit et ce qu'il ne reçoit pas. Elle n'est pas une clause de style : un
prestataire appelé par le code et absent d'ici est refusé par
`backend/tests/test_sous_traitants_politique.py`, qui lit les domaines sortants
dans `backend/` et compare à cette liste.

| Sous-traitant | Ce qu'il fait pour Kojo | Ce qu'il reçoit | Où | Ce qu'il ne reçoit pas |
| --- | --- | --- | --- | --- |
| **Neon** (AI Gateway) | répond aux questions de l'assistant de `/support` (`backend/kojo_ai_gateway.py`) | les messages écrits dans le chat, l'historique de la conversation et les instructions du serveur | UE (région de la branche Neon) | ni identifiant de compte, ni email, ni téléphone : le chat ne demande aucune session |
| **Kapso** (WhatsApp Business) | relaie le support WhatsApp : reçoit le message du client et transmet sa réponse (`backend/kojo_whatsapp.py`) | le numéro WhatsApp du client, son nom de profil et le texte du message — dans les deux sens | hors UE, via l'API WhatsApp Business de Meta | ni identifiant de compte, ni email, ni moyen de paiement ; la conversation conservée par Kojo, elle, périme par sa règle de conservation (`WHATSAPP_MESSAGE_RETENTION_DAYS`, section 4) |
| **Resend**, **Brevo** ou **Gmail** (selon `EMAIL_PROVIDER`) | remettent les emails du service : vérification d'adresse, codes, alertes, réponse aux tickets (`backend/kojo_email.py`) | l'adresse du destinataire et le contenu du message envoyé | États-Unis (Resend) ou UE (Brevo), Google (Gmail) | ni mot de passe, ni moyen de paiement, ni position |
| **PayDunya** | encaisse les paiements et verse les travailleurs | montant, identifiant de facture, identifiants internes (`payment_id`, `job_id`, `payer_id`, `worker_id`), et pour la facture de collecte : nom, adresse email et numéro de téléphone du payeur (`backend/kojo_routers_payments.py`) | Sénégal | ni mot de passe, ni photo, ni contenu de message ; le document `payments` de Kojo, lui, ne garde aucune de ces coordonnées |
| **Cloudinary** | héberge les photos de profil et les preuves photo de fin de mission | les fichiers image envoyés par la personne | États-Unis | ni email, ni téléphone, ni coordonnées bancaires |
| **MongoDB Atlas** | héberge la base décrite en section 1 | tout ce que la section 1 liste | UE (région du cluster) | rien d'autre que la base : ce n'est pas un prestataire d'envoi |
| **Fly.io** | héberge le backend (`backend/fly.toml`, région `fra`) et ses journaux | les requêtes HTTP (adresse IP, en-têtes, identifiant de requête) et les journaux applicatifs | Francfort | le contenu du chat : la route et le client du gateway ne journalisent que la CAUSE d'une panne (`kojo_routers_support`, `kojo_ai_gateway`), et la conservation côté gateway est celle de Neon, hors de portée de ce dépôt |
| **Vercel** | sert le site et relaie `/api` vers le backend | les requêtes HTTP (adresse IP, agent), les journaux d'accès | réseau mondial, journaux aux États-Unis | aucune donnée applicative : le relais transmet la requête et la réponse sans les stocker |
| **Sentry** (optionnel, `SENTRY_DSN`) | reçoit les erreurs du backend quand il est configuré (`backend/server.py`) | la trace technique de l'erreur, sans PII par défaut (`send_default_pii=False`) | projet Sentry configuré | ni email, ni téléphone, ni corps de message — le drapeau est explicite dans le code |
| **Google** | connexion Google (SSO), quand `GOOGLE_CLIENT_ID` est configuré | le jeton d'identité Google (adresse, nom, identifiant Google), que le backend vérifie | Google | ni mot de passe Kojo, ni données de mission |

Trois conséquences, dites plutôt que déduites : un compte supprimé reste
référencé par les paiements chez PayDunya, qui garde la trace de la transaction
pour ses propres obligations, et la facture de collecte y a porté le nom et
l'adresse du payeur ; ce qui est écrit dans le chat de `/support` part chez le
gateway IA sans être conservé par Kojo, donc une demande de suppression ne peut
pas l'effacer après coup — la consommation y est COMPTÉE (section 1), pas
relue ; et la dépense de ce gateway est plafonnée par jour, pour que la facture
ne suive pas le trafic (`backend/kojo_ai_budget.py`).

## 3. Ce qui est effacé, et quand

### Suppression de compte — `DELETE /api/users/account`

Le compte est **anonymisé** plutôt que supprimé, pour préserver la trace
comptable des paiements qui le référencent :

- l'adresse est remplacée par une adresse de service en `@kojo.deleted`, le mot
  de passe, le nom, le prénom, la bio, les compétences, le téléphone, les
  coordonnées de paiement, l'identifiant Google et la photo de profil sont
  effacés ; les codes de parrainage et les permissions élevées sont retirés ;
- le document reçoit son **échéance de purge** (`purge_at`, demandée à la règle
  `users` au lieu d'être recopiée) : l'anonymisation n'est donc pas définitive,
  elle précède la disparition du document ;
- les **tickets support du compte sont supprimés** (pas anonymisés : leur
  message est du texte libre qui peut nommer ou situer la personne, donc
  effacer seulement les champs ne serait pas une garantie), ainsi que les
  **conversations WhatsApp rattachées au compte** — celles dont le numéro est le
  téléphone du compte (`kojo_whatsapp.compte_du_numero`) ; un numéro inconnu de
  Kojo n'a pas de `user_id`, donc il n'appartient à aucun compte supprimable et
  sa conversation périme par sa règle (section 7, écart 3) ;
- les **missions postées par le client sont closes** et perdent **toute**
  coordonnée — `shared_location`, `location.latitude`, `location.longitude`,
  `location.coordinates` et le point GeoJSON `geo` — par `$unset`, pour que la
  clé disparaisse au lieu de rester vide (`JOB_LOCATION_FIELDS`,
  `backend/kojo_routers_users.py`) ;
- les notifications, propositions, avis écrits, jetons push, **alertes emploi**
  (adresse et critères : elles n'ont plus de destinataire) et profil
  travailleur sont supprimés ; les sessions en cours ne peuvent plus se
  réauthentifier ;
- les **messages restent** au-delà de la suppression du compte — ils appartiennent aussi à l'autre partie — puis suivent l'échéance de la règle `messages` (section 4). Un message garde ce que son auteur a écrit ; rien ne peut en être retiré sans le réécrire ;
- le **nom du compte est retiré des notifications de l'autre partie** : les gabarits de proposition et d'acceptation l'interpolent à l'écriture (`backend/kojo_shared.py`), donc la copie vit dans la boîte du destinataire et survivrait à l'anonymisation. Elle est réécrite avec un libellé neutre (`NOM_COMPTE_SUPPRIME`) au moment de la suppression, la notification elle-même étant CONSERVÉE (le tiers garde l'information « une proposition a été reçue ») — `backend/tests/test_notifications_nom_compte_supprime.py` mesure les deux sens sur le flux mission réel.

### Droit d'accès — `GET /api/users/account/export`

L'export rend, collection par collection, tout ce qui référence le compte —
y compris ce qu'une autre partie a écrit à son sujet (un message reçu, un avis
reçu), parce que c'est une donnée personnelle de la personne qui le demande.
`password_hash` et `otp_hash` sont **retenus**, le motif est rendu dans la
réponse (`withheld`), et le plafond de `EXPORT_LIMIT_PER_COLLECTION`
documents par collection est signalé par `truncated` plutôt que silencieux.

## 4. Durées de conservation

Chaque ligne est engendrée depuis `backend/kojo_retention.py`, qui est aussi ce
dont `kojo_core.create_database_indexes` crée les index TTL. La durée publiée
est donc, par construction, celle que la base applique.

<!-- CONSERVATION:DEBUT -->
| Collection | Champ indexé | Durée de conservation | Durée portée par | Filtre de l'index | Ce que la purge supprime |
| --- | --- | --- | --- | --- | --- |
| `email_otps` | `expires_at` | 10 minutes | `EMAIL_OTP_EXPIRY_MINUTES` | aucun (toute la collection) | le code de vérification, qu'il ait servi ou non — l'index s'applique à la collection entière |
| `payments` | `expires_at` | 48 heures | `PAYMENT_PENDING_EXPIRY_HOURS` | `status` = `pending` et `expires_at` présent | le seul paiement resté `pending` (client parti, IPN perdu). Depuis que sortir de `pending` RETIRE `expires_at` (kojo_payments.maj_statut_collecte), l'invariant « porte `expires_at` = encore en attente » tient à l'ÉCRITURE : un paiement abouti ne porte plus d'échéance, et il n'est JAMAIS purgé (obligation comptable). La clause de statut reste un SECOND FILET pour les documents écrits avant ce changement, qui portent encore une échéance périmée |
| `notifications` | `created_at` (date de création) | 90 jours | `NOTIFICATION_RETENTION_DAYS` | aucun (toute la collection) | toute notification, lue ou non |
| `revoked_tokens` | `expire_at` | 24 heures | `JWT_EXPIRATION_HOURS` | aucun (toute la collection) | l'inscription au rebut d'un jeton révoqué, conservée jusqu'à l'expiration naturelle du jeton : le garder plus longtemps n'ajouterait rien, l'oublier plus tôt rouvrirait la session |
| `users` | `purge_at` | 90 jours | `DELETED_ACCOUNT_RETENTION_DAYS` | `deleted` = `True` et `purge_at` présent | le document d'un compte SUPPRIMÉ (anonymisé : plus aucune PII, mais l'identifiant interne qui référence les paiements) — un compte actif ne porte pas `purge_at` et n'est jamais purgé |
| `support_tickets` | `created_at` (date de création) | 365 jours | `SUPPORT_TICKET_RETENTION_DAYS` | aucun (toute la collection) | tout ticket support, résolu ou non — nom, téléphone, email et message libre, la donnée la plus identifiante du dépôt |
| `messages` | `timestamp` (date de création) | 730 jours | `MESSAGE_RETENTION_DAYS` | aucun (toute la collection) | tout message envoyé — il appartient aussi au destinataire, donc il survit à la suppression de compte, mais pas indéfiniment |
| `ai_usage` | `jour_debut` (date de création) | 90 jours | `AI_USAGE_RETENTION_DAYS` | aucun (toute la collection) | le compteur de dépense de l'assistant IA d'une journée — deux nombres (appels, caractères de prompt) et une date, aucun identifiant de personne ; la journée en cours est recréée à son premier appel |
| `whatsapp_messages` | `created_at` (date de création) | 90 jours | `WHATSAPP_MESSAGE_RETENTION_DAYS` | aucun (toute la collection) | tout message WhatsApp échangé avec le support — numéro, nom de profil et texte libre. Il sert de CONTEXTE à l'assistant et de trace à l'escalade, puis il n'a plus de raison d'être conservé : la demande, elle, survit dans le ticket qu'elle a ouvert |
| `email_delivery_events` | `recu_le` (date de création) | 90 jours | `EMAIL_DELIVERY_EVENT_RETENTION_DAYS` | aucun (toute la collection) | tout fait de livraison reçu du fournisseur (rebond, plainte, livraison réussie) — la trace qui explique pourquoi une adresse a été retenue, et qui n'a plus à être conservée ensuite : l'état (`email_suppressions`) lui survit et ne périme pas |
<!-- CONSERVATION:FIN -->

Quatre précisions que le tableau ne dit pas :

- **Les valeurs entre guillemets inverses sont les symboles qui portent la
  durée**, pas des chiffres recopiés. `EMAIL_OTP_EXPIRY_MINUTES` est
  surchargeable par variable d'environnement
  (`backend/kojo_settings.py:128`) : le tableau publie la valeur **par défaut
  du code**, celle qui s'applique si la variable n'est pas positionnée — et la
  CI tourne sans elle. Une durée déployée différente serait un écart de
  configuration, pas de code.
- **Un paiement n'est jamais purgé** une fois complété ou annulé : il ne porte
  pas d'`expires_at`, donc l'index TTL partiel ne le voit pas. C'est une
  obligation comptable, et c'est sans PII (section 1).
- **La purge a deux étages, et une seule règle.** L'index TTL de la base
  (`kojo_core.create_database_indexes`) garantit la mort du document même si
  l'application ne tourne plus ; le passage quotidien
  `kojo_scheduler.retention_purge_once` applique le MÊME filtre, dérivé de la
  même règle (`RegleDeConservation.query_de_purge`), ce qui rend la purge
  observable et vérifiable — `backend/tests/test_retention_purge.py` la mesure
  des deux côtés (ce qui doit disparaître, et ce qui doit survivre). Un index
  TTL seul ne s'exécuterait dans aucune suite de tests.
- **Les collections absentes de ce tableau ne sont purgées par aucun
  mécanisme** : `jobs`, `job_proposals`, `reviews`, `worker_profiles` et
  `push_tokens` ne disparaissent qu'avec le compte qui les porte (section 3), et
  un avis REÇU survit même à la suppression du compte qui l'a reçu — c'est le
  prix du choix de la section 3 : la note d'un travailleur doit rester vraie.
  `email_suppressions` en fait partie, et c'est DÉLIBÉRÉ : c'est la liste des
  adresses auxquelles le service a cessé d'écrire (rebond définitif, ou
  signalement comme indésirable). Elle ne périme pas parce qu'une adresse
  redevenue joignable est une **décision** — le propriétaire la lève
  (`POST /api/owner/email-suppressions/lever`) —, là où une horloge remettrait
  le service à écrire dans le vide, ce qui est exactement ce qu'elle existe
  pour empêcher.

## 5. Journalisation

Le backend écrit sur la sortie standard et, hors suite de tests, dans un fichier
rotatif (`kojo_backend.log`, 10 Mo × 6) — `backend/kojo_settings.py`. Ce fichier
ne vit jamais dans le dépôt : son chemin est ABSOLU et pointe le répertoire
temporaire du système, déplaçable ou désactivable par `KOJO_LOG_FILE`
(`stdout`/`off` pour n'écrire que sur la sortie standard). Sous pytest l'écriture
fichier est désactivée, donc une exécution de la suite ne laisse rien derrière
elle ; `.gitignore` (`*.log.*`) reste le filet contre un `git add -A` distrait.

## 6. Ce que cette politique ne couvre pas

- Elle décrit le **dépôt**, pas la configuration déployée : les variables
  d'environnement de production peuvent déplacer une durée (voir section 4) et
  les secrets ne sont pas dans ce document.
- Elle n'est pas un avis juridique. Elle décrit ce que le code fait, ce qui est
  la matière première d'une conformité, pas la conformité elle-même.

## 7. Écarts connus, nommés et vérifiables

Ces trois points sont des manques **actuels**, chacun vérifiable à la ligne
citée. Les taire ferait de ce document une affirmation non contrôlable.

1. **Les compteurs publics comptent les comptes supprimés**
   (`backend/kojo_routers_public.py:384-385` : `count_documents({"user_type":
   "worker"})`, sans filtre sur `deleted`) : le chiffre affiché inclut les
   comptes anonymisés.
2. **Une conversation WhatsApp d'un numéro inconnu n'est ni exportable ni
   effaçable par le compte** : elle n'est rattachée à un compte que lorsque le
   numéro WhatsApp **est** le téléphone du compte
   (`backend/kojo_whatsapp.py`, `compte_du_numero`). Une personne qui écrit
depuis un autre numéro n'a pas de compte à supprimer, donc sa conversation
   s'efface par sa règle de conservation (section 4) et non sur demande. Le rattachement est volontairement EXACT (chiffres identiques) :
   deviner un indicatif rattacherait la conversation au hasard, et elle
   partirait avec le mauvais compte.
3. **Trois journaux écrivent l'adresse en clair** :
   `backend/kojo_routers_auth.py:675`, `:956`, `backend/kojo_email.py:413`.
   Les corps de réponse des prestataires d'email, journalisés en cas d'échec
   (`kojo_email.py:273`, `:323`), peuvent également contenir l'adresse du
   destinataire.

## 8. Vérifier ce document

```bash
python3 .github/scripts/check-privacy-policy.py          # le tableau == le code ?
python3 .github/scripts/check-privacy-policy.py --write  # régénérer le tableau
```

`backend/tests/test_privacy_policy_guard.py` prouve que ce garde sait échouer :
une durée modifiée dans le code, une ligne retirée du document, une cellule
éditée à la main et une collection ajoutée sans ligne sont chacune refusées, en
nommant la collection et la colonne fautives.

L'effacement de la section 3 est lui aussi tenu par un invariant, et non par une
liste recopiée : `backend/kojo_routers_users.py` déclare `ANONYMISATION_CHAMPS`
(cet effacé, et par quelle valeur) et `CHAMPS_CONSERVES` (ce qui reste, et
pourquoi), et
`backend/tests/test_hardening_audit.py::test_delete_account_erases_identity_and_referral_pii`
exige que les deux tables couvrent **exactement** les champs du modèle `User`.
Ajouter un champ porteur d'identité sans trancher fait donc échouer la suite en
le nommant — et un champ classé « effacé » est vérifié sur sa valeur réelle,
puis balayé dans tout le document pour qu'aucune copie n'y survive.
