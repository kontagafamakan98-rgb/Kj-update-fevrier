# -*- coding: utf-8 -*-
"""LES INDEX DE LA BASE, DÉCLARÉS ICI — une seule source pour les créer ET les juger.

POURQUOI CE MODULE EXISTE (mesuré le 27/10/2026)

`kojo_db.create_database_indexes()` créait ses ~70 index dans UN SEUL `try`.
Le sixième échouait, et les 66 suivants n'étaient jamais créés : les 13 index de
`jobs` (dont l'index TEXTE de la recherche et le point `2dsphere` du tri par
distance), les 9 de `payments`, les 5 de `reviews`, les TTL de conservation.
L'échec était avalé par un `logger.warning`, à chaque démarrage, et AUCUNE
sonde ne regardait — `/health` ne publiait rien. Le repli `$regex` de la
recherche masquait l'absence de l'index texte en répondant 200, plus lentement.

La cause du sixième échec : `create_index("google_sub", unique=True,
sparse=True)`. `sparse` écarte les documents où le champ est ABSENT, pas ceux où
il vaut `null` — et `unique` n'en accepte alors qu'un. Or l'inscription écrit
`google_sub: None` pour tout compte sans Google : au deuxième compte, l'index
devenait impossible (`E11000 duplicate key ... google_sub: null`). L'index est
donc PARTIEL, sur les seules valeurs de type chaîne : l'unicité demandée — un
compte Google ne s'attache qu'à un compte Kojo — reste entière.

CE QUE CE MODULE GARANTIT

  * UNE déclaration, lue par la création (`kojo_db`) ET par la sonde
    (`scripts/check_index_db.py`) : une liste recopiée dans la sonde jugerait
    des index que personne ne crée, et une liste recopiée dans la création
    créerait des index que personne ne juge ;
  * le NOM de chaque index est calculé comme MongoDB le fait (`champ_1`,
    `status_1_created_at_-1`), sauf quand la déclaration le fixe (index texte) :
    la sonde compare donc par NOM, et un index présent sous un autre nom est un
    index que les requêtes n'utilisent pas ;
  * les index TTL viennent de `kojo_retention.RETENTION_RULES` — la même règle
    que PRIVACY.md publie : une durée écrite des deux côtés finit par diverger.
"""
from typing import Dict, Iterable, List, Optional, Tuple

from kojo_recherche_missions import CHAMPS_TEXTE, LANGUE_TEXTE, NOM_INDEX_TEXTE
from kojo_retention import RETENTION_RULES


def nom_index(cle) -> str:
    """Le nom que MongoDB DONNE à un index — `email_1`, `status_1_created_at_-1`.

    Le calculer ici (plutôt que d'écrire 70 noms à la main) fait qu'un index
    ajouté ou renommé ne peut pas laisser derrière lui un nom que la sonde
    chercherait ailleurs.
    """
    if isinstance(cle, str):
        return f"{cle}_1"
    return "_".join(f"{champ}_{sens}" for champ, sens in cle)


def _declare(collection: str, cle, **options) -> Dict[str, object]:
    return {"collection": collection, "cle": cle, "options": options}


# ── Les index, par collection ───────────────────────────────────────────────
# L'ORDRE n'a pas d'importance pour la création (un `try` par entrée) ; il suit
# celui de la lecture des requêtes pour rester relisible.

INDEX_DECLARES: Tuple[Dict[str, object], ...] = (
    # ── users ───────────────────────────────────────────────────────────────
    _declare("users", "email", unique=True),
    _declare("users", "id", unique=True),
    _declare("users", "user_type"),
    _declare("users", "country"),
    _declare("users", [("email", 1), ("password_hash", 1)]),
    # UN compte Google pour un compte Kojo — et le filtre est un TYPE, pas
    # `sparse` : les comptes mot de passe écrivent `google_sub: None`, et un
    # `unique`+`sparse` n'en accepte qu'un seul (E11000, mesuré le 27/10/2026).
    _declare(
        "users",
        "google_sub",
        unique=True,
        partialFilterExpression={"google_sub": {"$type": "string"}},
    ),
    # ── jobs ────────────────────────────────────────────────────────────────
    _declare("jobs", "id", unique=True),
    _declare("jobs", "client_id"),
    # `GET /jobs?mine=assigned` filtre là-dessus : sans cet index, chaque
    # ouverture de « mes missions » balayait toute la collection.
    _declare("jobs", "assigned_worker_id"),
    _declare("jobs", "status"),
    _declare("jobs", "category"),
    _declare("jobs", "country"),
    _declare("jobs", [("status", 1), ("category", 1)]),
    _declare("jobs", [("status", 1), ("created_at", -1)]),
    _declare("jobs", [("created_at", -1)]),
    # Tri par BUDGET (`GET /jobs?tri=budget`) : sans lui, la liste était
    # entièrement triée en mémoire.
    _declare("jobs", [("status", 1), ("budget_max", -1)]),
    _declare("jobs", [("budget_max", -1)]),
    # Recherche par MOTS (`GET /jobs?q=`) : les `$regex` de repli ne peuvent pas
    # s'appuyer sur un index. Champs, langue et nom viennent de
    # `kojo_recherche_missions`, la même source que la requête.
    _declare(
        "jobs",
        [(champ, "text") for champ in CHAMPS_TEXTE],
        default_language=LANGUE_TEXTE,
        name=NOM_INDEX_TEXTE,
    ),
    # Rayon (`GET /jobs?lat=&lng=&radius_km=`) : un balayage complet sans lui.
    _declare("jobs", [("geo", "2dsphere")]),
    # ── job_proposals ───────────────────────────────────────────────────────
    _declare("job_proposals", "id", unique=True),
    _declare("job_proposals", "job_id"),
    _declare("job_proposals", "worker_id"),
    _declare("job_proposals", [("job_id", 1), ("worker_id", 1)]),
    # ── job_alerts ──────────────────────────────────────────────────────────
    # UNE veille par compte : deux activations simultanées (double clic, deux
    # onglets) inséreraient sinon deux documents, donc deux emails.
    _declare("job_alerts", "user_id", unique=True),
    _declare("job_alerts", "token", unique=True, sparse=True),
    _declare("job_alerts", "active"),
    # ── business_events ─────────────────────────────────────────────────────
    _declare("business_events", "cle", unique=True),
    _declare("business_events", "job_id"),
    _declare("business_events", "user_id"),
    # ── email_delivery_events ───────────────────────────────────────────────
    # `id_evenement` (`svix-id` de Resend) : c'est cette unicité qui absorbe une
    # re-livraison du même fait — sans elle, un rebond rejoué compterait deux
    # fois et l'alerte mentirait.
    _declare("email_delivery_events", "id_evenement", unique=True),
    _declare("email_delivery_events", "email"),
    # ── email_suppressions ──────────────────────────────────────────────────
    # `email` est normalisé : une adresse = un état.
    _declare("email_suppressions", "email", unique=True),
    # ── whatsapp_messages ───────────────────────────────────────────────────
    # Un message du fournisseur ne fait répondre qu'une fois, sur un canal où
    # l'on ne peut pas effacer.
    _declare("whatsapp_messages", "provider_message_id", unique=True),
    _declare("whatsapp_messages", [("conversation", 1), ("created_at", -1)]),
    # ── messages ────────────────────────────────────────────────────────────
    _declare("messages", "id", unique=True),
    _declare("messages", [("sender_id", 1), ("receiver_id", 1)]),
    _declare("messages", [("conversation_id", 1), ("timestamp", 1)]),
    _declare("messages", [("timestamp", -1)]),
    _declare("messages", "job_id"),
    # ── commissions ─────────────────────────────────────────────────────────
    _declare("commissions", "id", unique=True),
    _declare("commissions", "job_id"),
    _declare("commissions", "worker_id"),
    _declare("commissions", "status"),
    _declare("commissions", [("created_at", -1)]),
    # ── payments ────────────────────────────────────────────────────────────
    _declare("payments", "id", unique=True),
    _declare("payments", "job_id"),
    _declare("payments", "payer_id"),
    _declare("payments", "receiver_id"),
    _declare("payments", "status"),
    _declare("payments", "invoice_token", sparse=True),
    # `disburse_token` est relu par la re-vérification d'un décaissement (chemin
    # de l'argent) : sans index, chaque re-vérification balayait la collection.
    _declare("payments", "disburse_token", sparse=True),
    # Clé d'idempotence du checkout : c'est l'unicité qui rend un rejeu
    # inoffensif, pas seulement l'accélération.
    _declare("payments", "idempotency_key", unique=True, sparse=True),
    _declare("payments", [("created_at", -1)]),
    # ── support_tickets ─────────────────────────────────────────────────────
    _declare("support_tickets", "id", unique=True),
    _declare("support_tickets", "email"),
    _declare("support_tickets", [("status", 1), ("created_at", -1)]),
    # ── email_otps ──────────────────────────────────────────────────────────
    _declare("email_otps", [("email", 1), ("purpose", 1)], unique=True),
    _declare("email_otps", [("created_at", -1)]),
    # ── notifications ───────────────────────────────────────────────────────
    _declare("notifications", "id", unique=True),
    _declare("notifications", "user_id"),
    _declare("notifications", [("user_id", 1), ("is_read", 1)]),
    _declare("notifications", [("user_id", 1), ("created_at", -1)]),
    # ── reviews ─────────────────────────────────────────────────────────────
    _declare("reviews", "id", unique=True),
    _declare("reviews", "job_id"),
    _declare("reviews", "reviewee_id"),
    # Un avis par mission et par auteur : l'unicité porte la règle.
    _declare("reviews", [("job_id", 1), ("reviewer_id", 1)], unique=True),
    _declare("reviews", [("created_at", -1)]),
    # ── push_tokens ─────────────────────────────────────────────────────────
    _declare("push_tokens", "id", unique=True),
    _declare("push_tokens", "user_id"),
    _declare("push_tokens", [("user_id", 1), ("active", 1)]),
    # ── revoked_tokens ──────────────────────────────────────────────────────
    _declare("revoked_tokens", "jti", unique=True),
)


def declarations() -> List[Dict[str, object]]:
    """La liste COMPLÈTE : les index ci-dessus, puis les TTL de conservation.

    Une fonction, pas une constante : les règles de conservation sont lues au
    chargement du module voisin, et une seconde liste figée ici aurait divergé
    au premier changement de durée.
    """
    ttl = [
        _declare(regle.collection, regle.ttl_field, **regle.options_index())
        for regle in RETENTION_RULES
    ]
    return [dict(declare) for declare in INDEX_DECLARES] + ttl


def nom(declare: Dict[str, object]) -> str:
    """Le nom de l'index déclaré — fixé s'il est fourni, calculé sinon."""
    options = declare.get("options") or {}
    return str(options.get("name") or nom_index(declare["cle"]))


def _cle_normalisee(cle) -> Dict[str, object]:
    """La clé d'un index en `dict` — l'ordre des champs est déjà porté par le NOM.

    Comparer des listes rendrait un faux écart sur un simple ordre de lecture
    d'un `SON` ; le nom (`status_1_created_at_-1`) dit déjà la séquence, et deux
    ordres différents sont deux index différents, donc deux noms.
    """
    if isinstance(cle, str):
        return {cle: 1}
    return {champ: sens for champ, sens in cle}


def spec_attendue(declare: Dict[str, object]) -> Dict[str, object]:
    """Ce que `list_indexes()` DOIT rendre pour cet index, au champ près.

    Seuls les champs qui portent une RÈGLE sont comparés : `weights`,
    `textIndexVersion` et `background` sont des détails de stockage que MongoDB
    remplit lui-même et qui ne disent rien de l'usage d'un index.
    """
    options: Dict[str, object] = declare.get("options") or {}
    attendu: Dict[str, object] = {"cle": _cle_normalisee(declare["cle"])}
    for champ in ("unique", "sparse"):
        if options.get(champ):
            attendu[champ] = True
    for champ in ("partialFilterExpression", "expireAfterSeconds", "default_language"):
        if champ in options:
            attendu[champ] = _normaliser(options[champ])
    return attendu


def spec_presente(index_doc: Dict[str, object]) -> Dict[str, object]:
    """La même forme, lue d'un document `list_indexes()`."""
    presente: Dict[str, object] = {
        "cle": {champ: sens for champ, sens in (index_doc.get("key") or {}).items()}
    }
    for champ in ("unique", "sparse"):
        if index_doc.get(champ):
            presente[champ] = True
    for champ in ("partialFilterExpression", "expireAfterSeconds", "default_language"):
        if champ in index_doc:
            presente[champ] = _normaliser(index_doc[champ])
    return presente


def _normaliser(valeur):
    """Les documents Mongo reviennent en `SON` : on compare des `dict` simples."""
    if isinstance(valeur, dict) or hasattr(valeur, "items"):
        return {cle: _normaliser(item) for cle, item in valeur.items()}
    if isinstance(valeur, (list, tuple)):
        return [_normaliser(item) for item in valeur]
    return valeur


def comparer(declare: Dict[str, object], index_doc: Optional[Dict[str, object]]) -> List[str]:
    """Les ÉCARTS d'un index déclaré face à ce que la base porte. Vide = conforme.

    Chaque écart est NOMMÉ avec ses deux valeurs : « différent » ne dit pas quoi
    corriger, et un index unique qui a perdu son unicité laisse passer des
    doublons en silence.
    """
    if index_doc is None:
        return ["absent de la base (aucun index de ce nom)"]
    attendu = spec_attendue(declare)
    presente = spec_presente(index_doc)
    ecarts = []
    if presente["cle"] != attendu["cle"]:
        ecarts.append(f"clé {attendu['cle']} ≠ {presente['cle']}")
    for champ in ("unique", "sparse", "expireAfterSeconds", "default_language"):
        if presente.get(champ) != attendu.get(champ):
            ecarts.append(f"{champ} {attendu.get(champ)!r} ≠ {presente.get(champ)!r}")
    if presente.get("partialFilterExpression") != attendu.get("partialFilterExpression"):
        ecarts.append(
            "partialFilterExpression "
            f"{attendu.get('partialFilterExpression')!r} ≠ "
            f"{presente.get('partialFilterExpression')!r}"
        )
    return ecarts


# Codes MongoDB d'un index qui existe DÉJÀ sous le même nom avec d'autres
# options : c'est le seul cas que la création peut réparer elle-même (retirer
# puis recréer), et c'est exactement l'état laissé par l'ancien
# `google_sub` unique+sparse. Un 11000 (doublon réel) n'est PAS dans cette
# famille : il dit que les données contredisent la règle, pas que l'index est
# périmé, et retirer l'index ne le corrigerait pas.
CODES_CONFLIT_OPTIONS = (85, 86)


def conflit_d_options(erreur: BaseException) -> bool:
    """L'erreur dit-elle « même nom, autres options » ? Jamais deviné."""
    return getattr(erreur, "code", None) in CODES_CONFLIT_OPTIONS


def doublons(declares: Iterable[Dict[str, object]]) -> List[str]:
    """Les `collection.nom` déclarés PLUSIEURS fois — la dernière écraserait."""
    vus: Dict[Tuple[str, str], int] = {}
    for declare in declares:
        couple = (str(declare["collection"]), nom(declare))
        vus[couple] = vus.get(couple, 0) + 1
    return [f"{collection}.{nom_index_}" for (collection, nom_index_), n in vus.items() if n > 1]
