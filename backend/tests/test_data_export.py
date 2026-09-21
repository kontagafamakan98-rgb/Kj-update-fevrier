"""L'export RGPD rend-il TOUT ce que le dépôt conserve pour un compte ?

Deux propriétés différentes :

- le CONTENU : chaque collection qui référence le compte apparaît dans l'export,
  avec ses documents — et rien de ceux d'un AUTRE compte ;
- la COMPLÉTUDE : la liste des sources ne peut pas vieillir en silence. Le
  dernier test relit le code du backend et exige que TOUTE collection qui y est
  utilisée soit classée — soit « porte des données d'un utilisateur », soit
  « n'en porte aucune ». Ajouter une collection oblige donc à trancher ici,
  au lieu de la voir manquer à l'export sans que rien ne le dise.

Limite connue et écrite : cette relecture cherche les usages LITTÉRAUX
(`db.<nom>.`). Une collection atteinte seulement par une constante
(`db[_CIRCUIT_COLLECTION]`) n'est pas vue par le scan — elle est classée
explicitement ci-dessous, et le test vérifie que ce nom-là est bien classé.
"""
import inspect
import pathlib
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from kojo_routers_users import (
    EXPORT_WITHHELD_FIELDS,
    NO_USER_DATA_COLLECTIONS,
    USER_DATA_BY_EMAIL,
    USER_DATA_SOURCES,
    export_my_data,
)
from tests.conftest import BASE_USER, db_find_one, db_insert, register_and_login

EXPORT_URL = "/api/users/account/export"
BACKEND_DIR = pathlib.Path(__file__).resolve().parent.parent

# Les collections que l'endpoint lit LUI-MÊME (par opposition à celles de
# USER_DATA_SOURCES, parcourues par la table) : lues dans son code, jamais
# recopiées ici — sinon le test pourrait affirmer un rendu qui n'existe plus.
NON_SOURCE_RENDERINGS = set(
    re.findall(r"db\.([a-z_]+)\.", inspect.getsource(export_my_data))
)

# Le nom de la collection du disjoncteur PayDunya, atteinte par constante (voir
# kojo_payments._CIRCUIT_COLLECTION) : aucune donnée d'utilisateur, mais le scan
# ne la voit pas, donc ce test l'exige explicitement.
CONSTANT_ONLY_COLLECTIONS = ("paydunya_circuit",)

# `users` est rendu sous la clé `account` plutôt que dans `collections`, et
# `USER_DATA_BY_EMAIL` se lit avec l'adresse du compte : aucun des deux ne se
# sème comme un document par identifiant.
SOURCES_SANS_FIXTURE_PAR_ID = ("users",) + tuple(USER_DATA_BY_EMAIL)


async def _seed_account_data(uid: str, email: str) -> dict:
    """Un document dans chaque collection qui référence le compte.

    La liste vient de `USER_DATA_SOURCES`, pas d'une copie : une source ajoutée
    demain est couverte sans que ce test ait à être retouché — et le contrôle
    de non-vacuité plus bas refuse une source qui n'aurait pas de document.
    """
    inserted = {}
    for collection, fields in USER_DATA_SOURCES:
        if collection in SOURCES_SANS_FIXTURE_PAR_ID or not fields:
            continue
        doc_id = str(uuid.uuid4())
        await db_insert(collection, {"id": doc_id, fields[0]: uid})
        inserted[collection] = doc_id
    await db_insert("email_otps", {
        "email": email,
        "purpose": "signup",
        "otp_hash": "hash-qui-ne-doit-pas-sortir",
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
    })
    return inserted


@pytest.mark.asyncio
async def test_export_rend_chaque_collection_du_compte(client: AsyncClient):
    """Chaque collection qui référence le compte apparaît, avec SON document."""
    user = await register_and_login(client, BASE_USER)
    headers = {"Authorization": f"Bearer {user['access_token']}"}
    uid = user["user"]["id"]
    inserted = await _seed_account_data(uid, BASE_USER["email"])

    # Non-vacuité du périmètre : la fixture doit couvrir TOUTE source qui se lit
    # par identifiant, sinon les assertions ci-dessous ne prouveraient rien pour
    # la source manquante.
    attendues = {name for name, _ in USER_DATA_SOURCES} - set(SOURCES_SANS_FIXTURE_PAR_ID)
    assert set(inserted) == attendues

    resp = await client.get(EXPORT_URL, headers=headers)
    assert resp.status_code == 200, resp.text
    payload = resp.json()

    assert payload["user_id"] == uid
    for collection, doc_id in inserted.items():
        entry = payload["collections"][collection]
        # Non-vacuité : la collection ET le document attendus, pas seulement
        # une clé présente.
        assert entry["count"] >= 1, f"{collection} absente de l'export"
        assert doc_id in [doc["id"] for doc in entry["documents"]], (
            f"{collection} : le document du compte n'est pas dans l'export"
        )

    # Les collections lues par email (USER_DATA_BY_EMAIL) doivent être rendues
    # comme les autres : classées « autrement » n'est pas « absentes ».
    for collection in USER_DATA_BY_EMAIL:
        entry = payload["collections"][collection]
        assert entry["count"] >= 1, f"{collection} absente de l'export"
        assert all(doc["email"] == BASE_USER["email"] for doc in entry["documents"])

    # Aucune collection plafonnée ici : l'export doit dire s'il l'était.
    assert all(entry["truncated"] is False for entry in payload["collections"].values())


@pytest.mark.asyncio
async def test_export_ne_rend_pas_les_donnees_d_un_autre_compte(client: AsyncClient):
    """Un export qui rendrait tout à tout le monde passerait le test du contenu :
    celui-ci exige l'isolement."""
    user = await register_and_login(client, BASE_USER)
    headers = {"Authorization": f"Bearer {user['access_token']}"}
    uid = user["user"]["id"]

    other = await register_and_login(client, {**BASE_USER, "email": "autre@kojo.sn"})
    other_uid = other["user"]["id"]
    other_job_id = str(uuid.uuid4())
    await db_insert("jobs", {"id": other_job_id, "client_id": other_uid})

    await _seed_account_data(uid, BASE_USER["email"])

    resp = await client.get(EXPORT_URL, headers=headers)
    assert resp.status_code == 200, resp.text
    exported_ids = {
        doc.get("id")
        for entry in resp.json()["collections"].values()
        for doc in entry["documents"]
    }
    assert other_job_id not in exported_ids, "mission d'un autre compte dans l'export"


@pytest.mark.asyncio
async def test_export_ne_laisse_sortir_aucun_secret(client: AsyncClient):
    """Le fichier est téléchargé et conservé par la personne : ni le condensé du
    mot de passe ni celui d'un code OTP en attente ne doivent y figurer."""
    user = await register_and_login(client, BASE_USER)
    headers = {"Authorization": f"Bearer {user['access_token']}"}
    uid = user["user"]["id"]
    await _seed_account_data(uid, BASE_USER["email"])

    resp = await client.get(EXPORT_URL, headers=headers)
    assert resp.status_code == 200, resp.text
    payload = resp.json()

    account = payload["account"]
    assert account is not None and account["email"] == BASE_USER["email"], (
        "le compte lui-même doit figurer dans ses données"
    )
    for collection, fields in EXPORT_WITHHELD_FIELDS.items():
        assert payload["withheld"][collection] == list(fields)
    assert "password_hash" not in account
    for doc in payload["collections"]["email_otps"]["documents"]:
        assert "otp_hash" not in doc

    # Le nom du fichier identifie le compte, il ne sert pas un autre export.
    assert f"kojo-donnees-{uid}.json" in resp.headers.get("content-disposition", "")


@pytest.mark.asyncio
async def test_export_signale_une_collection_plafonnee(client: AsyncClient, monkeypatch):
    """Une collection plus longue que le plafond doit le DIRE : un export
    d'accès incomplet qui se tait ne serait pas un droit d'accès."""
    # Le plafond est lu par l'endpoint : on patche le module où il est UTILISÉ
    # (la façade ne fait que ré-exporter le nom, elle ne le lit pas).
    import kojo_routers_users_account

    monkeypatch.setattr(kojo_routers_users_account, "EXPORT_LIMIT_PER_COLLECTION", 1)
    user = await register_and_login(client, BASE_USER)
    headers = {"Authorization": f"Bearer {user['access_token']}"}
    uid = user["user"]["id"]
    for _ in range(2):
        await db_insert("jobs", {"id": str(uuid.uuid4()), "client_id": uid})

    payload = (await client.get(EXPORT_URL, headers=headers)).json()
    jobs = payload["collections"]["jobs"]
    assert jobs["count"] == 2
    assert len(jobs["documents"]) == 1, "le plafond doit borner la réponse"
    assert jobs["truncated"] is True, "un export incomplet doit le signaler"


@pytest.mark.asyncio
async def test_export_exige_une_session(client: AsyncClient):
    """L'export ne se sert à personne sans jeton : c'est la donnée de quelqu'un."""
    resp = await client.get(EXPORT_URL)
    assert resp.status_code in (401, 403), resp.text


def test_toute_collection_du_backend_est_classee():
    """Le garde de complétude : toute collection utilisée dans le code doit être
    classée, sinon une collection ajoutée demain manquerait à l'export (ou
    porterait des données d'utilisateur sans que personne ne l'ait décidé)."""
    used = set()
    for path in sorted(BACKEND_DIR.glob("*.py")):
        used.update(re.findall(r"db\.([a-z_]+)\.", path.read_text(encoding="utf-8")))

    assert used, "aucune collection trouvée : le scan ne regarde pas au bon endroit"

    exported = {name for name, _ in USER_DATA_SOURCES}
    by_email = set(USER_DATA_BY_EMAIL)
    no_data = set(NO_USER_DATA_COLLECTIONS) | set(CONSTANT_ONLY_COLLECTIONS)
    unclassified = sorted(used - exported - by_email - no_data)
    assert not unclassified, (
        f"collection(s) non classée(s) pour l'export RGPD : {unclassified} — "
        f"tranche : données d'un utilisateur par identifiant (USER_DATA_SOURCES), "
        f"par un autre chemin (USER_DATA_BY_EMAIL), ou aucune "
        f"(NO_USER_DATA_COLLECTIONS)"
    )

    # Une collection ne peut pas être de deux familles : ce serait deux réponses
    # à la même question, et l'export comme le commentaire mentiraient.
    familles = (("USER_DATA_SOURCES", exported), ("USER_DATA_BY_EMAIL", by_email))
    for (nom_a, a), (nom_b, b) in (
        (familles[0], familles[1]),
        (familles[0], ("NO_USER_DATA_COLLECTIONS", no_data)),
        (familles[1], ("NO_USER_DATA_COLLECTIONS", no_data)),
    ):
        assert not (a & b), f"{sorted(a & b)} classée à la fois {nom_a} et {nom_b}"

    # Chaque source doit nommer au moins un champ de rattachement, sinon la
    # requête serait vide et la collection rendrait toujours zéro document.
    for name, fields in USER_DATA_SOURCES:
        assert fields, f"{name} ne nomme aucun champ de rattachement"

    # Toute famille « rendue autrement » doit être réellement rendue par
    # l'endpoint : c'est ce qui distingue ce classement d'un fourre-tout.
    for collection in USER_DATA_BY_EMAIL:
        assert collection in NON_SOURCE_RENDERINGS, (
            f"{collection} est classée comme rendue autrement, mais l'endpoint ne la rend pas"
        )
