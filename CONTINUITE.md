# Continuité — accès, secrets, procédure d'absence

Ce document dit **où** se trouvent les accès et **quoi** faire, jamais les valeurs
elles-mêmes. Aucun secret ne doit être écrit ici ni dans le dépôt.

Les identités de la section 1 sont renseignées. Ce qui reste à faire est
écrit ici plutôt que supposé :

- **Vérifier les accès** (cases `[ ]` de la section 1) : une identité écrite
  n'est pas un accès prouvé. La vérification se fait en se connectant, pas en
  relisant ce tableau.
- **Les deux DATES du journal (section 7)** : elles ne peuvent venir que de
  l'historique du fournisseur (releases Fly, journal des jetons GitHub) ; elles
  n'ont pas été inventées ici.

Un élément absent de ce document est un risque : le compléter est la première
action à faire.

## 1. Services et comptes

| Service | Rôle | Propriétaire du compte | Accès de secours | Vérifié |
|---|---|---|---|---|
| Fly.io (app `kojo-backend`) | Hébergement du backend | Famakan Kontaga | Famakan Kontaga | [ ] |
| Vercel (projet `kj-update-fevrier`) | Hébergement du frontend | Famakan Kontaga | Famakan Kontaga | [ ] |
| MongoDB Atlas | Base de données de production | Famakan Kontaga | Famakan Kontaga | [ ] |
| GitHub (dépôt + secrets Actions) | Code et CI/CD | Famakan Kontaga | Famakan Kontaga | [ ] |
| Cloudinary | Stockage des photos de profil | Famakan Kontaga | Famakan Kontaga | [ ] |
| PayDunya | Paiements et décaissements | Famakan Kontaga | Famakan Kontaga | [ ] |
| Brevo / Gmail (e-mails) | Envoi des e-mails transactionnels | Famakan Kontaga | Famakan Kontaga | [ ] |
| Sentry | Remontée des erreurs | Famakan Kontaga | Famakan Kontaga | [ ] |
| Nom de domaine (`kojoforafrica.cc.cd`) | DNS | Famakan Kontaga | Famakan Kontaga | [ ] |

Règle : chaque compte doit avoir **au moins deux personnes** capables de s'y
connecter, et l'adresse de récupération ne doit pas dépendre d'une seule boîte
mail personnelle.

**Écart connu au 10/10/2026** : la même personne est inscrite comme
propriétaire et comme accès de secours, donc la règle des deux personnes n'est
PAS satisfaite — un compte tenu par une seule personne reste un point de
défaillance unique, malgré un tableau rempli. Nommer une seconde personne par
service (ou constater qu'une même seconde personne couvre tous les services)
est la seule façon de fermer cet écart ; d'ici là, le tableau dit ce qu'il dit.

## 2. Où vivent les secrets

| Secret | Où il est défini | Conséquence d'une rotation |
|---|---|---|
| `MONGO_URL`, `JWT_SECRET`, `EMAIL_OTP_SECRET`, `VAPID_*`, clés PayDunya, `SENTRY_DSN` | Secrets Fly (`flyctl secrets set -a kojo-backend`) | `JWT_SECRET` : déconnecte tous les utilisateurs. **`EMAIL_OTP_SECRET` : ne jamais le changer** (invalide les jetons de vérification et les OTP en cours). |
| `OWNER_EMAIL`, `OWNER_USER_ID` | Secrets Fly | Voir la section 4 (identifiant du compte propriétaire). |
| `FLY_API_TOKEN` | Secrets GitHub Actions | Régénérer avec `flyctl tokens create deploy` puis remplacer le secret GitHub. |
| `KOJO_PROBE_IMAP_USER`, `KOJO_PROBE_IMAP_PASSWORD` | Secrets GitHub Actions | Mot de passe d'application Gmail : le révoquer et en créer un nouveau. |
| `VITE_API_URL` et autres `VITE_*` | Variables d'environnement Vercel | Rebuild du frontend requis après changement. |

Les valeurs ne figurent **ni dans le dépôt, ni dans les logs, ni dans ce document**.
En cas de doute sur une fuite, traiter le secret comme compromis.

## 3. Procédure de rotation d'un secret

1. Générer la nouvelle valeur (jamais dans un fichier du dépôt ni dans le chat).
2. La définir dans le fournisseur concerné (tableau ci-dessus).
3. Vérifier `flyctl logs -a kojo-backend` : le démarrage doit réussir.
4. Vérifier `https://api.kojoforafrica.cc.cd/health` (HTTP 200).
5. Consigner la date de rotation dans la section 6.

Si une rotation échoue, revenir à la valeur précédente : elle est conservée
dans le gestionnaire de mots de passe de l'équipe, pas dans le dépôt.

## 4. Compte propriétaire (OWNER)

Le compte propriétaire est résolu **par e-mail** (`OWNER_EMAIL`), l'identifiant
`OWNER_USER_ID` ne sert que de repli. Avant toute modification de ces deux
variables, vérifier que le compte existe en base avec cet e-mail.

## 5. Procédure en cas d'absence du mainteneur principal

1. Un second mainteneur accède aux comptes de la section 1 (vérifier les accès
   **avant** l'absence, pas pendant).
2. Surveiller l'état : `/health`, logs Fly, alertes Sentry.
3. En cas de panne backend : `flyctl status -a kojo-backend`, puis
   `flyctl releases` pour revenir à la version précédente si un déploiement
   est en cause.
4. En cas de problème de paiement : suspendre les décaissements plutôt que les
   laisser échouer en boucle, et contacter PayDunya avec les identifiants de
   transaction.
5. Ne jamais partager les secrets par e-mail ou message : utiliser le
   gestionnaire de mots de passe de l'équipe.

## 6. Panne du fournisseur de paiement (PayDunya)

Décision : pas de second fournisseur intégré pour l'instant. Procédure
écrite à la place :

1. Constater la panne : taux d'échec des paiements dans les logs Fly et
   statut du fournisseur.
2. Ne pas relancer en boucle les paiements en attente : les lister et les
   traiter une fois le service rétabli (les IPN PayDunya confirment les
   statuts réellement reçus).
3. Informer les utilisateurs concernés (missions en attente de paiement).
4. Ne jamais modifier manuellement un statut de paiement en base sans relever
   la transaction chez le fournisseur.

Re-évaluer la décision si les pannes dépassent quelques heures par mois.

## 7. Journal des opérations sensibles

| Date | Opération | Par qui | Notes |
|---|---|---|---|
| À RENSEIGNER | Dernière rotation de `JWT_SECRET` | | |
| À RENSEIGNER | Dernière révocation du token de déploiement Fly | | |
