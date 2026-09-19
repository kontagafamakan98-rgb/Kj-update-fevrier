# Politique de confidentialité et de conservation des données

Kojo met en relation des clients et des travailleurs au Sénégal. Ce document dit
quelles données le service conserve, pendant combien de temps, et par quel
mécanisme — en citant à chaque fois le fichier et le symbole qui portent
l'affirmation, pour qu'elle soit vérifiable plutôt que crue.

**Le tableau de la section 3 n'est pas écrit ici.** Il est engendré depuis le
code par `.github/scripts/check-privacy-policy.py`, et la CI refuse une
divergence entre les deux. Les autres sections sont du texte humain : elles
n'ont pas cette garantie, et les écarts connus sont nommés en section 6.

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
| Support | nom, téléphone, email, motif, message libre | `support_tickets` |
| Vérification | code OTP (haché), date de péremption ; jeton d'accès révoqué (identifiant seul) | `email_otps`, `revoked_tokens` |

La liste fait autorité dans le code : `USER_DATA_SOURCES`, `USER_DATA_BY_EMAIL`
et `NO_USER_DATA_COLLECTIONS` (`backend/kojo_routers_users.py`) classent
**toutes** les collections du backend, et un test échoue si une collection
nouvelle n'est pas classée. Autrement dit, ajouter une collection oblige à
trancher ici.

Les identifiants sont des UUID internes. Un paiement ne porte **aucune** PII :
ni nom, ni téléphone, ni email (`payer_id` et `receiver_id` sont des
identifiants de compte).

## 2. Ce qui est effacé, et quand

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
  effacer seulement les champs ne serait pas une garantie) ;
- les **missions postées par le client sont closes** et perdent **toute**
  coordonnée — `shared_location`, `location.latitude`, `location.longitude`,
  `location.coordinates` et le point GeoJSON `geo` — par `$unset`, pour que la
  clé disparaisse au lieu de rester vide (`JOB_LOCATION_FIELDS`,
  `backend/kojo_routers_users.py`) ;
- les notifications, propositions, avis écrits, jetons push et profil
  travailleur sont supprimés ; les sessions en cours ne peuvent plus se
  réauthentifier ;
- les **messages restent** au-delà de la suppression du compte — ils appartiennent aussi à l'autre partie — puis suivent l'échéance de la règle `messages` (section 3). Un message garde ce que son auteur a écrit ; rien ne peut en être retiré sans le réécrire ;
- le **nom du compte est retiré des notifications de l'autre partie** : les gabarits de proposition et d'acceptation l'interpolent à l'écriture (`backend/kojo_shared.py`), donc la copie vit dans la boîte du destinataire et survivrait à l'anonymisation. Elle est réécrite avec un libellé neutre (`NOM_COMPTE_SUPPRIME`) au moment de la suppression, la notification elle-même étant CONSERVÉE (le tiers garde l'information « une proposition a été reçue ») — `backend/tests/test_notifications_nom_compte_supprime.py` mesure les deux sens sur le flux mission réel.

### Droit d'accès — `GET /api/users/account/export`

L'export rend, collection par collection, tout ce qui référence le compte —
y compris ce qu'une autre partie a écrit à son sujet (un message reçu, un avis
reçu), parce que c'est une donnée personnelle de la personne qui le demande.
`password_hash` et `otp_hash` sont **retenus**, le motif est rendu dans la
réponse (`withheld`), et le plafond de `EXPORT_LIMIT_PER_COLLECTION`
documents par collection est signalé par `truncated` plutôt que silencieux.

## 3. Durées de conservation

Chaque ligne est engendrée depuis `backend/kojo_retention.py`, qui est aussi ce
dont `kojo_core.create_database_indexes` crée les index TTL. La durée publiée
est donc, par construction, celle que la base applique.

<!-- CONSERVATION:DEBUT -->
| Collection | Champ indexé | Durée de conservation | Durée portée par | Filtre de l'index | Ce que la purge supprime |
| --- | --- | --- | --- | --- | --- |
| `email_otps` | `expires_at` | 10 minutes | `EMAIL_OTP_EXPIRY_MINUTES` | aucun (toute la collection) | le code de vérification, qu'il ait servi ou non — l'index s'applique à la collection entière |
| `payments` | `expires_at` | 48 heures | `PAYMENT_PENDING_EXPIRY_HOURS` | `status` = `pending` et `expires_at` présent | le seul paiement resté `pending` (client parti, IPN perdu) — un paiement complété ou annulé ne porte pas `expires_at` et n'est JAMAIS purgé (obligation comptable) |
| `notifications` | `created_at` (date de création) | 90 jours | `NOTIFICATION_RETENTION_DAYS` | aucun (toute la collection) | toute notification, lue ou non |
| `revoked_tokens` | `expire_at` | 24 heures | `JWT_EXPIRATION_HOURS` | aucun (toute la collection) | l'inscription au rebut d'un jeton révoqué, conservée jusqu'à l'expiration naturelle du jeton : le garder plus longtemps n'ajouterait rien, l'oublier plus tôt rouvrirait la session |
| `users` | `purge_at` | 90 jours | `DELETED_ACCOUNT_RETENTION_DAYS` | `deleted` = `True` et `purge_at` présent | le document d'un compte SUPPRIMÉ (anonymisé : plus aucune PII, mais l'identifiant interne qui référence les paiements) — un compte actif ne porte pas `purge_at` et n'est jamais purgé |
| `support_tickets` | `created_at` (date de création) | 365 jours | `SUPPORT_TICKET_RETENTION_DAYS` | aucun (toute la collection) | tout ticket support, résolu ou non — nom, téléphone, email et message libre, la donnée la plus identifiante du dépôt |
| `messages` | `timestamp` (date de création) | 730 jours | `MESSAGE_RETENTION_DAYS` | aucun (toute la collection) | tout message envoyé — il appartient aussi au destinataire, donc il survit à la suppression de compte, mais pas indéfiniment |
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
  `push_tokens` ne disparaissent qu'avec le compte qui les porte (section 2), et
  un avis REÇU survit même à la suppression du compte qui l'a reçu — c'est le
  prix du choix de la section 2 : la note d'un travailleur doit rester vraie.

## 4. Journalisation

Le backend écrit sur la sortie standard et, hors suite de tests, dans un fichier
rotatif (`kojo_backend.log`, 10 Mo × 6) — `backend/kojo_settings.py`. Ce fichier
ne vit jamais dans le dépôt : son chemin est ABSOLU et pointe le répertoire
temporaire du système, déplaçable ou désactivable par `KOJO_LOG_FILE`
(`stdout`/`off` pour n'écrire que sur la sortie standard). Sous pytest l'écriture
fichier est désactivée, donc une exécution de la suite ne laisse rien derrière
elle ; `.gitignore` (`*.log.*`) reste le filet contre un `git add -A` distrait.

## 5. Ce que cette politique ne couvre pas

- Elle décrit le **dépôt**, pas la configuration déployée : les variables
  d'environnement de production peuvent déplacer une durée (voir section 3) et
  les secrets ne sont pas dans ce document.
- Elle n'est pas un avis juridique. Elle décrit ce que le code fait, ce qui est
  la matière première d'une conformité, pas la conformité elle-même.

## 6. Écarts connus, nommés et vérifiables

Ces deux points sont des manques **actuels**, chacun vérifiable à la ligne
citée. Les taire ferait de ce document une affirmation non contrôlable.

1. **Les compteurs publics comptent les comptes supprimés**
   (`backend/kojo_routers_public.py:384-385` : `count_documents({"user_type":
   "worker"})`, sans filtre sur `deleted`) : le chiffre affiché inclut les
   comptes anonymisés.
2. **Trois journaux écrivent l'adresse en clair** :
   `backend/kojo_routers_auth.py:675`, `:956`, `backend/kojo_email.py:413`.
   Les corps de réponse des prestataires d'email, journalisés en cas d'échec
   (`kojo_email.py:273`, `:323`), peuvent également contenir l'adresse du
   destinataire.

## 7. Vérifier ce document

```bash
python3 .github/scripts/check-privacy-policy.py          # le tableau == le code ?
python3 .github/scripts/check-privacy-policy.py --write  # régénérer le tableau
```

`backend/tests/test_privacy_policy_guard.py` prouve que ce garde sait échouer :
une durée modifiée dans le code, une ligne retirée du document, une cellule
éditée à la main et une collection ajoutée sans ligne sont chacune refusées, en
nommant la collection et la colonne fautives.

L'effacement de la section 2 est lui aussi tenu par un invariant, et non par une
liste recopiée : `backend/kojo_routers_users.py` déclare `ANONYMISATION_CHAMPS`
(cet effacé, et par quelle valeur) et `CHAMPS_CONSERVES` (ce qui reste, et
pourquoi), et
`backend/tests/test_hardening_audit.py::test_delete_account_erases_identity_and_referral_pii`
exige que les deux tables couvrent **exactement** les champs du modèle `User`.
Ajouter un champ porteur d'identité sans trancher fait donc échouer la suite en
le nommant — et un champ classé « effacé » est vérifié sur sa valeur réelle,
puis balayé dans tout le document pour qu'aucune copie n'y survive.
