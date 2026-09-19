# -*- coding: utf-8 -*-
"""La suppression de compte est-elle l'INVERSE de l'export RGPD ? Mesure, pas
affirmation.

Ce que « inverse » veut dire ici — et ce qu'il ne veut pas dire. L'export rend
chaque document dont L'UN des champs déclarés désigne le compte
(`USER_DATA_SOURCES`) : la suppression agit donc, elle aussi, par couple
(collection, champ), et c'est à cette maille qu'on peut dire son sort :

  * « effacé » — les documents que l'export rendait par ce champ ont disparu ;
  * « conservé » — le document est encore là ;
  * « anonymisé » — le document reste, les PII déclarées partent. Mesuré sur
    DEUX sources, et c'est délibéré : la table d'effacement (`ANONYMISATION_CHAMPS`)
    dit que l'endpoint applique sa table, et l'autre moitié de la politique
    (`CHAMPS_CONSERVES`, chacune avec sa raison) dit qu'aucune valeur rendue par
    l'export et non conservée ne se relit dans le document. Le second volet est
    celui qui survit au retrait d'une LIGNE de la première table — sans lui, un
    champ effaçable qui cesserait de l'être cesserait aussi d'être regardé ;
  * « conservé sans coordonnées » — le document reste, toute coordonnée part
    (`JOB_LOCATION_FIELDS`, lu sur le routeur) ;
  * « le lien est retiré » — le document reste, mais ce champ ne désigne plus le
    compte (une mission où il était travailleur assigné : les coordonnées sont
    celles du CLIENT, qui les garde).

La relation n'est DONC PAS l'égalité stricte « ce que l'export rend == ce que la
suppression efface » : les messages, les paiements et les commissions sont rendus
ET conservés, délibérément (co-détenus par l'autre partie, ou obligation
comptable — PRIVACY.md §2). Une égalité stricte serait fausse, et forcerait soit
à mentir sur le document, soit à supprimer des données co-détenues. Ce qui est
vrai, et que ce fichier mesure :

  1. COMPLÉTUDE — chaque couple (collection, champ) de l'export a un sort
     déclaré, et aucun sort ne décrit un couple que l'export n'interroge pas.
     Ajouter une source à l'export sans trancher son sort échoue donc en la
     nommant, au lieu de la laisser hors de toute vérification ;
  2. EFFET — le sort déclaré est celui que la suppression RÉELLE produit, mesuré
     sur les documents que l'export avait RENDUS (l'export d'abord, par son
     endpoint ; la suppression ensuite, par le sien). Un sort « conservé » est
     mesuré lui aussi : une suppression devenue PLUS agressive qu'annoncé rougit
     autant qu'une suppression devenue inerte ;
  3. NON-VACUITÉ — chaque couple avait bien rendu son document avant, sans quoi
     « tout est effacé » serait vrai d'une fixture vide.

Le seul fait que ce fichier DÉCLARE est le sort de chaque couple (le pendant
machine de PRIVACY.md §2) ; ce qui doit être effacé, le champ email des OTP et
la liste des couples viennent du routeur, jamais d'une copie.
"""
import server as _srv
from kojo_core import sanitize_email
from kojo_routers_users import (
    ANONYMISATION_CHAMPS,
    CHAMPS_CONSERVES,
    JOB_LOCATION_FIELDS,
    USER_DATA_BY_EMAIL,
    USER_DATA_BY_EMAIL_FIELD,
    USER_DATA_SOURCES,
)
from tests.conftest import BASE_USER, auth_headers, db_find_one, db_insert

EFFACE = "effacé"
CONSERVE = "conservé"
ANONYMISE = "anonymisé (les PII déclarées partent, le document reste)"
SANS_COORDONNEES = "conservé, toute coordonnée retirée"
LIEN_RETIRE = "conservé, ce champ ne désigne plus le compte"

# Le sort de chaque source de l'export. Déclaré ici, mesuré plus bas : c'est le
# contrat que PRIVACY.md §2 raconte en prose.
SORTS = {
    ("users", "id"): ANONYMISE,
    ("worker_profiles", "user_id"): EFFACE,
    ("jobs", "client_id"): SANS_COORDONNEES,
    ("jobs", "assigned_worker_id"): LIEN_RETIRE,
    ("job_proposals", "worker_id"): EFFACE,
    ("messages", "sender_id"): CONSERVE,
    ("messages", "receiver_id"): CONSERVE,
    ("payments", "payer_id"): CONSERVE,
    ("payments", "receiver_id"): CONSERVE,
    ("commissions", "worker_id"): CONSERVE,
    ("reviews", "reviewer_id"): EFFACE,
    ("reviews", "reviewee_id"): CONSERVE,
    ("notifications", "user_id"): EFFACE,
    ("support_tickets", "user_id"): EFFACE,
    ("push_tokens", "user_id"): EFFACE,
    ("email_otps", USER_DATA_BY_EMAIL_FIELD): CONSERVE,
}

COORDONNEES = {
    "location": {"latitude": 14.69, "longitude": -17.44, "coordinates": [-17.44, 14.69]},
    "shared_location": {"latitude": 14.69, "longitude": -17.44},
    "geo": {"type": "Point", "coordinates": [-17.44, 14.69]},
}


def _couples_de_l_export():
    """Les couples (collection, champ) que l'export interroge réellement."""
    couples = {
        (collection, champ)
        for collection, champs in USER_DATA_SOURCES
        for champ in champs
    }
    couples |= {(collection, USER_DATA_BY_EMAIL_FIELD) for collection in USER_DATA_BY_EMAIL}
    return couples


def _chemin(document, chemin):
    """Lit un chemin pointé (« location.latitude »)."""
    courant = document
    for part in chemin.split("."):
        if not isinstance(courant, dict) or part not in courant:
            return None
        courant = courant[part]
    return courant


def _valeurs_personnelles(compte_rendu):
    """Ce que l'export a rendu du compte et que la politique ne déclare PAS
    conservé : ces valeurs doivent avoir disparu du document après suppression.

    C'est le complément qui manquait au contrôle de la table d'effacement.
    Boucler sur `ANONYMISATION_CHAMPS` mesure « l'endpoint applique sa table »,
    mais reste vert si une ligne DISPARAÎT de la table : le champ cesse alors
    d'être regardé. Ici la source est l'autre moitié de la politique —
    `CHAMPS_CONSERVES`, qui porte une raison pour chaque champ qu'elle garde —
    donc un champ effaçable qui survit est vu, même absent de la table.
    """
    valeurs = set()

    def _descendre(noeud):
        if isinstance(noeud, dict):
            for valeur in noeud.values():
                _descendre(valeur)
        elif isinstance(noeud, (list, tuple)):
            for element in noeud:
                _descendre(element)
        elif isinstance(noeud, str) and noeud.strip():
            valeurs.add(noeud)
        elif isinstance(noeud, (int, float)) and not isinstance(noeud, bool) and noeud:
            valeurs.add(noeud)

    for champ, valeur in compte_rendu.items():
        if champ in CHAMPS_CONSERVES:
            continue
        _descendre(valeur)
    return valeurs


def _valeurs_lisibles(noeud, chemin="", sortie=None):
    """Toutes les valeurs feuilles d'un document, avec le chemin où chacune se
    lit — pour NOMMER l'endroit où une valeur a survécu."""
    if sortie is None:
        sortie = {}
    if isinstance(noeud, dict):
        for champ, valeur in noeud.items():
            _valeurs_lisibles(valeur, "%s.%s" % (chemin, champ) if chemin else str(champ), sortie)
    elif isinstance(noeud, (list, tuple)):
        for indice, element in enumerate(noeud):
            _valeurs_lisibles(element, "%s[%d]" % (chemin, indice), sortie)
    elif isinstance(noeud, (str, int, float)) and not isinstance(noeud, bool):
        sortie.setdefault(noeud, []).append(chemin)
    return sortie


def _documents_a_semer(user_id: str, email: str):
    """Un document par couple, désigné par SON champ et portant un `id` connu :
    c'est par cet `id` que le sort est mesuré après la suppression (le champ,
    lui, peut avoir été retiré du document — c'est même le cas d'un sort)."""
    return [
        (("worker_profiles", "user_id"), "worker_profiles",
         {"id": "profil-1", "user_id": user_id, "specialties": ["plomberie"]}),
        (("jobs", "client_id"), "jobs",
         {"id": "mission-du-client", "client_id": user_id,
          "assigned_worker_id": "worker-voisin", "status": "open", **COORDONNEES}),
        (("jobs", "assigned_worker_id"), "jobs",
         {"id": "mission-du-travailleur", "client_id": "client-voisin",
          "assigned_worker_id": user_id, "status": "in_progress", **COORDONNEES}),
        (("job_proposals", "worker_id"), "job_proposals",
         {"id": "proposition-1", "worker_id": user_id, "job_id": "mission-voisine"}),
        (("messages", "sender_id"), "messages",
         {"id": "message-envoye", "sender_id": user_id, "receiver_id": "compte-voisin"}),
        (("messages", "receiver_id"), "messages",
         {"id": "message-recu", "sender_id": "compte-voisin", "receiver_id": user_id}),
        # Paiements « completed / released » : terminés, donc AUCUN remboursement
        # n'est tenté par la suppression (aucun appel PayDunya dans ce test).
        (("payments", "payer_id"), "payments",
         {"id": "paiement-du-payeur", "payer_id": user_id,
          "receiver_id": "compte-voisin", "status": "completed",
          "payout_status": "released", "amount": 5000}),
        (("payments", "receiver_id"), "payments",
         {"id": "paiement-du-beneficiaire", "payer_id": "compte-voisin",
          "receiver_id": user_id, "status": "completed",
          "payout_status": "released", "amount": 5000}),
        (("commissions", "worker_id"), "commissions",
         {"id": "commission-1", "worker_id": user_id, "amount": 700}),
        (("reviews", "reviewer_id"), "reviews",
         {"id": "avis-ecrit", "reviewer_id": user_id,
          "reviewee_id": "compte-voisin", "rating": 5}),
        (("reviews", "reviewee_id"), "reviews",
         {"id": "avis-recu", "reviewer_id": "compte-voisin",
          "reviewee_id": user_id, "rating": 4}),
        (("notifications", "user_id"), "notifications",
         {"id": "notification-1", "user_id": user_id, "title": "Bienvenue"}),
        (("support_tickets", "user_id"), "support_tickets",
         {"id": "ticket-1", "user_id": user_id, "message": "Question"}),
        (("push_tokens", "user_id"), "push_tokens",
         {"id": "jeton-1", "user_id": user_id, "push_token": "jeton-de-test"}),
        (("email_otps", USER_DATA_BY_EMAIL_FIELD), "email_otps",
         {"id": "code-1", "email": email, "otp_hash": "condense"}),
    ]


def test_chaque_source_de_l_export_a_un_sort_declare():
    """COMPLÉTUDE : le visage inverse de `USER_DATA_SOURCES`. Une source rendue
    par l'export sans sort déclaré est une donnée dont personne n'a tranché le
    destin — et rien ne le dirait."""
    couples = _couples_de_l_export()

    assert set(SORTS) == couples, (
        "sources de l'export sans sort déclaré : %s | sorts qui ne décrivent "
        "aucune source : %s"
        % (sorted(couples - set(SORTS)), sorted(set(SORTS) - couples))
    )


async def test_la_suppression_est_l_inverse_de_l_export_couple_par_couple(client):
    """EFFET et NON-VACUITÉ, mesurés par les deux endpoints réels."""
    entetes = await auth_headers(client, BASE_USER)
    compte = await db_find_one("users", {"email": BASE_USER["email"]})
    user_id = compte["id"]
    email = sanitize_email(BASE_USER["email"])

    seeds = _documents_a_semer(user_id, email)
    for _, collection, document in seeds:
        await db_insert(collection, document)

    # --- AVANT : ce que l'export rend, par son propre endpoint --------------
    reponse_export = await client.get("/api/users/account/export", headers=entetes)
    assert reponse_export.status_code == 200, reponse_export.text
    export = reponse_export.json()

    def _valeur(couple):
        return email if couple[1] == USER_DATA_BY_EMAIL_FIELD else user_id

    manques = []
    rendus = {}
    for couple, collection, document in seeds:
        documents = export["collections"].get(collection, {}).get("documents", [])
        rendus[couple] = sorted(
            str(d.get("id")) for d in documents
            if str(d.get(couple[1])) == _valeur(couple)
        )
        if document["id"] not in rendus[couple]:
            manques.append(
                "%s : l'export n'a pas rendu %s par le champ « %s » — la fixture "
                "ne prouve rien" % (couple, document["id"], couple[1])
            )
    # Le compte lui-même sort sous `account`, hors du dictionnaire des
    # collections, donc il se vérifie à part : sans lui, le sort « anonymisé » ne
    # serait mesuré sur rien.
    assert export["account"], "l'export doit rendre le document de compte"
    rendus[("users", "id")] = [export["account"]["id"]]
    if not export["account"].get("first_name"):
        manques.append(
            "('users', 'id') : le compte est déjà sans prénom avant la "
            "suppression — l'effacement ne serait pas mesurable"
        )
    assert manques == [], "\n".join(manques)

    # Les valeurs du compte que la politique ne déclare pas conservées : c'est
    # "ce que l'export rend" pour ce couple, et dont l'inverse doit être mesuré.
    valeurs_personnelles = _valeurs_personnelles(export["account"])
    assert valeurs_personnelles, (
        "l'export n'a rendu aucune valeur non conservée du compte : le sort "
        "« anonymisé » ne serait mesuré sur rien (champs rendus : %s)"
        % sorted(export["account"])
    )
    adresse_rendue = export["account"].get("email")
    assert adresse_rendue, "l'export doit rendre l'adresse du compte"

    # --- LA SUPPRESSION, par son endpoint ----------------------------------
    reponse = await client.delete("/api/users/account", headers=entetes)
    assert reponse.status_code == 200, reponse.text

    # --- APRÈS : chaque document semé, retrouvé par son identifiant --------
    violations = []
    apres = {}
    for couple, collection, document in seeds:
        apres[document["id"]] = await _srv.db[collection].find_one({"id": document["id"]})

        sort = SORTS[couple]
        if sort == EFFACE and apres[document["id"]] is not None:
            violations.append(
                "%s : sort « effacé » mais %s survit à la suppression"
                % (couple, document["id"])
            )
        if sort != EFFACE and apres[document["id"]] is None:
            violations.append(
                "%s : sort « %s » mais %s a disparu" % (couple, sort, document["id"])
            )
        if sort == LIEN_RETIRE and apres[document["id"]] is not None:
            restant = apres[document["id"]].get(couple[1])
            if restant == user_id:
                violations.append(
                    "%s : le document survit mais garde le lien vers le compte "
                    "supprimé" % (couple,)
                )

    # ANONYMISE, premier volet : chaque champ de la table d'effacement porte la
    # valeur effacée (la table est LUE sur le routeur, jamais recopiée).
    compte_apres = await db_find_one("users", {"id": user_id})
    assert compte_apres is not None, "le document de compte doit survivre (anonymisé)"
    for champ, valeur_effacee in ANONYMISATION_CHAMPS.items():
        if compte_apres.get(champ) != valeur_effacee:
            violations.append(
                "users : sort « anonymisé » mais « %s » vaut %r au lieu de %r"
                % (champ, compte_apres.get(champ), valeur_effacee)
            )

    # ANONYMISE, second volet — l'inverse proprement dit, et celui qui survit à
    # une ligne retirée de la table : aucune valeur que l'export a rendue du
    # compte sans que la politique la déclare conservée ne doit se relire dans
    # le document anonymisé, où que ce soit. La valeur de l'adresse (conservée
    # « RÉÉCRITE », cf. sa raison) doit avoir disparu de la même façon.
    lisibles = _valeurs_lisibles(compte_apres)
    for valeur in sorted(valeurs_personnelles, key=str):
        if valeur in lisibles:
            violations.append(
                "users : sort « anonymisé » mais la valeur rendue par l'export "
                "%r se relit encore en %s" % (valeur, lisibles[valeur])
            )
    if adresse_rendue in lisibles:
        violations.append(
            "users : sort « anonymisé » mais l'adresse rendue par l'export se "
            "relit encore en %s" % lisibles[adresse_rendue]
        )

    # SANS_COORDONNEES : toutes les coordonnées déclarées ont disparu des
    # missions du client, et elles y étaient AVANT (sinon le retrait n'est pas
    # prouvé — c'est la non-vacuité de ce sort).
    mission_avant = next(
        document for _, collection, document in seeds
        if document["id"] == "mission-du-client"
    )
    presentes = [champ for champ in JOB_LOCATION_FIELDS
                 if _chemin(mission_avant, champ) is not None]
    assert presentes, (
        "la fixture ne portait aucune coordonnée : le retrait ne serait pas prouvé"
    )
    mission_apres = apres["mission-du-client"]
    assert mission_apres is not None, "la mission du client doit survivre (close)"
    for champ in JOB_LOCATION_FIELDS:
        if _chemin(mission_apres, champ) is not None:
            violations.append(
                "jobs/client_id : la coordonnée « %s » survit à la suppression" % champ
            )

    # ... et la seconde source, celle qui ne dépend PAS de la liste : les VALEURS
    # de coordonnées semées ne doivent se relire nulle part dans la mission. Un
    # champ retiré de `JOB_LOCATION_FIELDS` cesserait d'être regardé par la boucle
    # ci-dessus ; ici il est vu quand même, parce qu'on cherche les valeurs.
    valeurs_coordonnees = {
        valeur for valeur in _valeurs_lisibles(COORDONNEES)
        if isinstance(valeur, (int, float)) and not isinstance(valeur, bool)
    }
    assert valeurs_coordonnees, (
        "la fixture ne portait aucune valeur de coordonnée : le retrait ne serait "
        "pas prouvé"
    )
    lisibles_mission = _valeurs_lisibles(mission_apres)
    for valeur in sorted(valeurs_coordonnees):
        if valeur in lisibles_mission:
            violations.append(
                "jobs/client_id : la coordonnée %r se relit encore en %s"
                % (valeur, lisibles_mission[valeur])
            )

    assert violations == [], "\n".join(violations)


async def test_le_sort_conserve_est_mesure_lui_aussi(client):
    """Le sens qui manque le plus souvent : un sort « conservé » ne doit pas
    être une croyance. Ici on vérifie qu'un document CONSERVÉ (un message reçu)
    est bien encore là après la suppression — donc que le test précédent aurait
    vu sa disparition."""
    entetes = await auth_headers(client, BASE_USER)
    compte = await db_find_one("users", {"email": BASE_USER["email"]})
    await db_insert("messages", {
        "id": "message-temoin",
        "sender_id": "compte-voisin",
        "receiver_id": compte["id"],
        "content": "message co-détenu",
    })

    reponse = await client.delete("/api/users/account", headers=entetes)
    assert reponse.status_code == 200, reponse.text

    survivant = await _srv.db["messages"].find_one({"id": "message-temoin"})
    assert survivant is not None, (
        "un message reçu doit survivre à la suppression du compte destinataire"
    )
    assert survivant.get("content") == "message co-détenu", (
        "et il doit survivre INCHANGÉ : la suppression ne réécrit pas ce qui "
        "appartient aussi à l'autre partie"
    )
