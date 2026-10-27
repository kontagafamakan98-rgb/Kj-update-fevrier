# -*- coding: utf-8 -*-
"""La sonde des index compare la DÉCLARATION à la base, et refuse de juger sans elle.

Ce que ces cas tiennent, et pourquoi chacun existe :

  * la sonde lit la MÊME déclaration que la création (`kojo_index_declares`) :
    `google_sub` doit y être PARTIEL, pas `unique`+`sparse` — c'est la panne du
    27/10/2026, et un retour en arrière doit rougir ici ;
  * un index ABSENT, une clé différente, une unicité perdue ou un filtre partiel
    disparu sont des ÉCARTS nommés avec les deux valeurs — « différent » ne dit
    pas quoi corriger ;
  * une collection illisible, une base injoignable, une déclaration tronquée ou
    un `MONGO_URL` absent sont des PRÉMISSES (code 2) : une surface aveugle se
    déclare, elle ne vaut pas un vert ;
  * un index présent mais NON déclaré est publié en `[INFO]` : c'est souvent le
    résidu d'un index qu'on vient de changer, et ce n'est pas un rouge ;
  * le workflow quotidien lance la sonde, sans `continue-on-error`, avec le
    secret `MONGO_URL` et le LOCK (empreintes vérifiées) — une étape qui ne peut
    pas échouer ne surveille rien.
"""
import importlib.util
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parents[2]
SCRIPT = RACINE / "backend" / "scripts" / "check_index_db.py"
WORKFLOW = RACINE / ".github" / "workflows" / "index-db-probe.yml"


def _charger():
    spec = importlib.util.spec_from_file_location("check_index_db", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def sonde():
    return _charger()


def _declares(sonde):
    return sonde.index_declares.declarations()


def _document(declare, nom_module):
    spec = nom_module.spec_attendue(declare)
    document = {"name": nom_module.nom(declare), "key": dict(spec["cle"])}
    for champ in (
        "unique",
        "sparse",
        "partialFilterExpression",
        "expireAfterSeconds",
        "default_language",
        # Les CHAMPS d'un index texte sont portés par `weights` : sans lui, le
        # fixture d'un index texte conforme serait jugé « champs texte … ≠ [] ».
        "weights",
    ):
        if champ in spec:
            document[champ] = spec[champ]
    return document


def _etats_conformes(sonde):
    declares = _declares(sonde)
    etats = {}
    for declare in declares:
        collection = str(declare["collection"])
        document = _document(declare, sonde.index_declares)
        etats.setdefault(collection, {"index": {}})
        etats[collection]["index"][document["name"]] = document
    return etats


# ── Ce que la sonde juge ───────────────────────────────────────────────────

def test_une_base_conforme_donne_un_vert(sonde):
    code, lignes = sonde.juger(_declares(sonde), _etats_conformes(sonde))
    texte = "\n".join(lignes)
    assert code == 0, texte
    assert "conformes" in texte
    # Le COÛT de la passe est publié même quand tout va bien : une sonde muette
    # sur ce qu'elle a lu ne permet aucun arbitrage.
    assert "index déclarés sur" in texte


def test_un_index_absent_est_un_ecart_nomme(sonde):
    etats = _etats_conformes(sonde)
    del etats["users"]["index"]["email_1"]
    code, lignes = sonde.juger(_declares(sonde), etats)
    texte = "\n".join(lignes)
    assert code == 1
    assert "users.email_1" in texte and "absent" in texte


def test_une_unicite_perdue_est_nommee_avec_les_deux_valeurs(sonde):
    etats = _etats_conformes(sonde)
    del etats["payments"]["index"]["idempotency_key_1"]["unique"]
    code, lignes = sonde.juger(_declares(sonde), etats)
    texte = "\n".join(lignes)
    assert code == 1
    assert "payments.idempotency_key_1" in texte
    assert "unique True ≠ None" in texte, texte


def test_un_filtre_partiel_disparu_est_nomme(sonde):
    etats = _etats_conformes(sonde)
    del etats["users"]["index"]["google_sub_1"]["partialFilterExpression"]
    code, lignes = sonde.juger(_declares(sonde), etats)
    texte = "\n".join(lignes)
    assert code == 1
    assert "google_sub_1" in texte and "partialFilterExpression" in texte


def test_un_index_non_declare_est_publie_sans_etre_un_rouge(sonde):
    etats = _etats_conformes(sonde)
    etats["users"]["index"]["ancien_index_1"] = {"name": "ancien_index_1", "key": {"ancien": 1}}
    code, lignes = sonde.juger(_declares(sonde), etats)
    texte = "\n".join(lignes)
    assert code == 0, texte
    assert "NON déclarés" in texte and "users.ancien_index_1" in texte


def test_une_collection_absente_est_un_ecart(sonde):
    etats = _etats_conformes(sonde)
    etats["users"] = {"index": {}}
    code, lignes = sonde.juger(_declares(sonde), etats)
    assert code == 1
    assert any("users." in ligne and "absent" in ligne for ligne in lignes)


def test_une_collection_illisible_est_une_premisse(sonde):
    etats = _etats_conformes(sonde)
    etats["users"] = {"erreur": "timeout"}
    code, lignes = sonde.juger(_declares(sonde), etats)
    assert code == 2
    assert "PREMISSE" in "\n".join(lignes)


def test_une_declaration_tronquee_refuse_de_conclure(sonde):
    declarations = _declares(sonde)[:5]
    code, lignes = sonde.juger(declarations, _etats_conformes(sonde))
    assert code == 2
    assert "tronquée" in "\n".join(lignes)


def test_aucune_collection_lue_est_une_premisse(sonde):
    code, lignes = sonde.juger(_declares(sonde), {})
    assert code == 2
    assert "Aucun verdict" in "\n".join(lignes)


def test_le_script_sort_en_2_sans_mongo_url(sonde, monkeypatch):
    """Une prémisse se DÉCLARE : sans connexion, aucun verdict n'est rendu.

    En PROCESSUS, pas en sous-processus : `kojo_settings` charge `backend/.env`
    au premier import, et un sous-processus irait donc se connecter à la base
    que ce fichier désigne — un test ne touche pas la production.
    """
    import contextlib
    import io

    monkeypatch.delenv("MONGO_URL", raising=False)
    tampon = io.StringIO()
    with contextlib.redirect_stderr(tampon):
        code = sonde.main([])
    assert code == 2
    assert "MONGO_URL" in tampon.getvalue()
    assert "PREMISSE" in tampon.getvalue()


def test_une_declaration_illisible_est_une_premisse_nommee(sonde, monkeypatch):
    """La déclaration ne se lit pas → PRÉMISSE (2), jamais un vert ni un écart.

    Cas mesuré le 27/10/2026, au premier run du workflow : la CI n'avait pas le
    profil d'environnement que réclame l'import des durées de conservation, et
    le TRACEBACK sortait en code 1 — lu comme « au moins un index non
    conforme » alors qu'aucun index n'avait été lu. Le code 1 est un verdict ;
    ici il n'y avait rien à juger.
    """
    import contextlib
    import io

    monkeypatch.setenv("MONGO_URL", "mongodb://exemple.invalide")
    monkeypatch.setattr(sonde, "index_declares", None)
    monkeypatch.setattr(
        sonde,
        "ERREUR_DECLARATION",
        RuntimeError("JWT_SECRET environment variable is not set"),
    )
    tampon = io.StringIO()
    with contextlib.redirect_stderr(tampon):
        code = sonde.main([])

    sortie = tampon.getvalue()
    assert code == 2, sortie
    assert "PREMISSE" in sortie and "ILLISIBLE" in sortie
    # La cause est nommée : « illisible » sans elle n'envoie vers aucun remède.
    assert "JWT_SECRET" in sortie


# ── Le câblage ─────────────────────────────────────────────────────────────


def test_le_workflow_donne_a_la_sonde_un_profil_capable_d_importer_la_declaration():
    """Le run quotidien doit pouvoir LIRE la déclaration qu'il juge.

    Sans profil, `kojo_settings` refuse de démarrer en production sans
    `JWT_SECRET` et la sonde tombe avant tout verdict (mesuré le 27/10/2026).
    Le profil est celui de la suite de tests, et aucun secret factice n'est
    posé : la sonde ne démarre pas l'application.
    """
    texte = WORKFLOW.read_text(encoding="utf-8")
    assert "APP_ENV: test" in texte, "le workflow doit fournir le profil d'import"
    assert "APP_ENV: production" not in texte

def test_le_workflow_lance_la_sonde_sans_etape_qui_ne_peut_pas_echouer():
    texte = WORKFLOW.read_text(encoding="utf-8")
    assert "scripts/check_index_db.py" in texte
    assert "continue-on-error" not in texte, (
        "une sonde dont l'échec est toléré ne surveille rien"
    )
    assert "|| true" not in texte
    assert "schedule:" in texte and "cron:" in texte
    assert "MONGO_URL: ${{ secrets.MONGO_URL }}" in texte


def test_le_workflow_installe_le_lock_avec_empreintes():
    texte = WORKFLOW.read_text(encoding="utf-8")
    assert "pip install --require-hashes -r requirements.lock" in texte, (
        "une sonde qui juge la production s'installe vérifiée, comme le déploiement"
    )
    assert "-r requirements.txt" not in texte


def test_la_sonde_n_imprime_jamais_la_chaine_de_connexion():
    """Une chaîne de connexion dans un journal est une fuite de mot de passe."""
    texte = SCRIPT.read_text(encoding="utf-8")
    assert "{uri}" not in texte, "la sonde ne doit pas afficher la chaîne de connexion"
