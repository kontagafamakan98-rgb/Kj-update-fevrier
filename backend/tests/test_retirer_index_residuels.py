# -*- coding: utf-8 -*-
"""Les index RÉSIDUELS sont retirés — et la sonde cesse alors de les publier.

Ce que ces cas tiennent, et pourquoi chacun existe :

  * la liste `RESIDUS_CONNUS` (dans `kojo_index_declares`) contient
    `messages.created_at_-1`, un index sur un champ qu'aucun chemin de code
    n'écrit ni ne lit — c'est la mesure du 27/10/2026, et c'est ce qui justifie
    le retrait plutôt qu'une déclaration ;
  * un résidu qui deviendrait DÉCLARÉ est REFUSÉ : le script ne doit jamais
    défaire une déclaration, sinon il deviendrait un outil qui démonte la base
    au lieu de la nettoyer ;
  * une liste de résidus VIDÉE ne vaut pas un vert (prémisse, code 2) : « rien
    à retirer » et « je ne sais plus quoi retirer » ne se lisent pas pareil ;
  * le retrait est VÉRIFIÉ par relecture de `list_indexes()` — un
    `drop_index()` qui réussit en laissant l'index laisserait la sonde publier
    le résidu sans que personne ne relie les deux ;
  * sans `--appliquer`, la passe n'ÉCRIT rien : c'est prouvé sur une fausse
    base, parce que la seule autre façon de le prouver serait d'écrire ;
  * `MONGO_URL` absent et base injoignable sont des prémisses (code 2), et la
    chaîne de connexion n'est jamais imprimée.
"""
import importlib.util
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parents[2]
SCRIPT = RACINE / "backend" / "scripts" / "retirer_index_residuels.py"
SONDE = RACINE / "backend" / "scripts" / "check_index_db.py"
DECLARES = RACINE / "backend" / "kojo_index_declares.py"


def _charger(chemin, nom):
    spec = importlib.util.spec_from_file_location(nom, chemin)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def script():
    return _charger(SCRIPT, "retirer_index_residuels")


@pytest.fixture(scope="module")
def declares():
    return _charger(DECLARES, "kojo_index_declares_residus")


# ── Une base factice : vrai `list_indexes()`, faux disque ───────────────────

class FausseCollection:
    def __init__(self, noms, drop_effectif=True):
        self.noms = list(noms)
        self.drop_effectif = drop_effectif
        self.retires = []

    def drop_index(self, nom):
        self.retires.append(nom)
        if self.drop_effectif and nom in self.noms:
            self.noms.remove(nom)

    def list_indexes(self):
        return [{"name": nom} for nom in self.noms]


class FausseBase:
    def __init__(self, **collections):
        self.collections = collections

    def __getitem__(self, nom):
        return self.collections[nom]

    def command(self, *_args, **_kwargs):
        return {"ok": 1}

    def list_collection_names(self):
        # `check_index_db.lire_etats` interroge cette liste AVANT chaque
        # collection : sans elle, la fausse base rendrait une prémisse au lieu
        # de l'état qu'on veut éprouver.
        return list(self.collections)


def _base_avec_residu(drop_effectif=True):
    return FausseBase(
        messages=FausseCollection(["_id_", "created_at_-1"], drop_effectif=drop_effectif)
    )


def _etat(*noms):
    return {"messages": {"index": {nom: {"name": nom} for nom in noms}}}


# ── La déclaration ─────────────────────────────────────────────────────────

def test_le_residu_mesure_est_declare_et_nomme_comme_mongodb(script, declares):
    noms = [declares.nom(residu) for residu in declares.RESIDUS_CONNUS]
    assert "created_at_-1" in noms, (
        "le résidu mesuré le 27/10/2026 (messages.created_at_-1) doit figurer dans "
        f"RESIDUS_CONNUS pour être retiré ; lu : {noms}"
    )


def test_un_residu_n_est_jamais_un_index_declare(script, declares):
    """Le script REFUSE un nom déclaré — la liste ne doit donc pas le contenir."""
    decl = {(str(d["collection"]), declares.nom(d)) for d in declares.declarations()}
    collisions = [
        (str(r["collection"]), declares.nom(r))
        for r in declares.RESIDUS_CONNUS
        if (str(r["collection"]), declares.nom(r)) in decl
    ]
    assert collisions == [], (
        "résidu(s) DÉCLARÉ(s) : la déclaration et la liste de retrait se "
        f"contredisent — {collisions}"
    )


def test_chaque_residu_vise_une_collection_declaree(declares):
    """Une faute de frappe dans la collection viserait une base inexistante, et
    le script rendrait « déjà absent » sur une collection qui n'existe pas."""
    collections = {str(d["collection"]) for d in declares.declarations()}
    inconnues = [
        str(r["collection"]) for r in declares.RESIDUS_CONNUS
        if str(r["collection"]) not in collections
    ]
    assert inconnues == [], f"résidu(s) sur collection(s) non déclarée(s) : {inconnues}"


def test_chaque_residu_dit_sa_mesure_et_son_motif(declares):
    """Un retrait qui ne dit pas CE QU'ON A MESURÉ est un « nettoyage » qu'on
    rejouera sans savoir pourquoi."""
    fautes = []
    for residu in declares.RESIDUS_CONNUS:
        nom = declares.nom(residu)
        motif = str(residu.get("motif") or "")
        if len(motif) < 40:
            fautes.append(f"{nom} : motif de {len(motif)} caractères, il ne dit rien")
        if not str(residu.get("mesure") or "").count("/") == 2:
            fautes.append(f"{nom} : aucune date de mesure (JJ/MM/AAAA)")
    assert fautes == [], "\n  ".join(fautes)


# ── Le plan (pur) ──────────────────────────────────────────────────────────

def test_un_residu_present_est_a_retirer(script, declares):
    code, lignes, a_retirer = script.planifier(
        declares.RESIDUS_CONNUS, declares.declarations(), _etat("_id_", "created_at_-1")
    )
    assert code == 0, "\n".join(lignes)
    assert a_retirer == [("messages", "created_at_-1")]


def test_un_residu_deja_absent_n_est_pas_reclame(script, declares):
    """Une seconde passe est SANS EFFET : sinon le script serait un rouge
    permanent, et un rouge permanent s'apprend à être ignoré."""
    code, lignes, a_retirer = script.planifier(
        declares.RESIDUS_CONNUS, declares.declarations(), _etat("_id_")
    )
    assert code == 0, "\n".join(lignes)
    assert a_retirer == []
    assert "déjà absent" in "\n".join(lignes)


def test_un_residu_devenu_declare_est_refuse(script, declares):
    """LE cas qui protège la déclaration : retirer un index utile serait pire
    que de publier un `[INFO]` de trop."""
    declares_avec_residu = list(declares.declarations()) + [
        {"collection": "messages", "cle": [("created_at", -1)], "options": {}}
    ]
    code, lignes, a_retirer = script.planifier(
        declares.RESIDUS_CONNUS, declares_avec_residu, _etat("_id_", "created_at_-1")
    )
    texte = "\n".join(lignes)
    assert code == 1, texte
    assert a_retirer == [], "un nom déclaré a été mis dans la file de retrait"
    assert "DÉCLARÉ" in texte


def test_une_collection_illisible_ne_retire_rien(script, declares):
    code, lignes, a_retirer = script.planifier(
        declares.RESIDUS_CONNUS,
        declares.declarations(),
        {"messages": {"erreur": "timeout"}},
    )
    assert code == 2, "\n".join(lignes)
    assert a_retirer == []
    assert "timeout" in "\n".join(lignes)


def test_une_collection_non_interrogee_ne_retire_rien(script, declares):
    code, lignes, a_retirer = script.planifier(declares.RESIDUS_CONNUS, declares.declarations(), {})
    assert code == 2, "\n".join(lignes)
    assert a_retirer == []


def test_une_liste_de_residus_videe_ne_vaut_pas_un_vert(script, declares):
    """« Rien à retirer » et « je ne sais plus quoi retirer » ne se lisent pas
    pareil : la liste est une surface, et une surface aveugle se déclare."""
    code, lignes, a_retirer = script.planifier((), declares.declarations(), _etat("created_at_-1"))
    assert code == 2, "\n".join(lignes)
    assert a_retirer == []
    assert "tronquée" in "\n".join(lignes)


# ── Le retrait (vérifié par relecture) ─────────────────────────────────────

def test_le_retrait_est_verifie_absent_par_relecture(script):
    base = _base_avec_residu()
    code, lignes = script.appliquer(base, [("messages", "created_at_-1")])
    assert code == 0, "\n".join(lignes)
    assert base["messages"].retires == ["created_at_-1"]
    assert base["messages"].noms == ["_id_"]
    assert "absent de `list_indexes()`" in "\n".join(lignes)


def test_un_drop_qui_reussit_sans_retirer_est_un_rouge(script):
    """`drop_index()` peut réussir en laissant l'index : croire son code de
    retour ferait annoncer « retiré » sur un résidu que la sonde publierait
    encore."""
    base = _base_avec_residu(drop_effectif=False)
    code, lignes = script.appliquer(base, [("messages", "created_at_-1")])
    assert code == 1, "\n".join(lignes)
    assert "TOUJOURS présent" in "\n".join(lignes)


# ── La passe complète, sur une fausse base ─────────────────────────────────

def test_sans_appliquer_la_passe_n_ecrit_rien(script, monkeypatch):
    """La passe par défaut SIMULE. Prouvé sur une fausse base : c'est le seul
    moyen de le prouver sans écrire pour de vrai."""
    monkeypatch.setenv("MONGO_URL", "mongodb://exemple.invalide")
    base = _base_avec_residu()
    code = script.executer([], fabrique=lambda _uri, _delai: base)
    assert code == 0
    assert base["messages"].retires == [], "la simulation a écrit dans la base"
    assert base["messages"].noms == ["_id_", "created_at_-1"]


def test_avec_appliquer_la_passe_retire_et_verifie(script, monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://exemple.invalide")
    base = _base_avec_residu()
    code = script.executer(["--appliquer"], fabrique=lambda _uri, _delai: base)
    assert code == 0
    assert base["messages"].retires == ["created_at_-1"]
    assert base["messages"].noms == ["_id_"]


def test_la_passe_est_idempotente(script, monkeypatch):
    """Deux passes : la seconde ne trouve plus rien et ne prétend pas avoir agi."""
    monkeypatch.setenv("MONGO_URL", "mongodb://exemple.invalide")
    base = _base_avec_residu()
    assert script.executer(["--appliquer"], fabrique=lambda _uri, _delai: base) == 0
    assert script.executer(["--appliquer"], fabrique=lambda _uri, _delai: base) == 0
    assert base["messages"].retires == ["created_at_-1"], "un second retrait a été tenté"


def test_le_script_sort_en_2_sans_mongo_url(script, monkeypatch, capsys):
    monkeypatch.delenv("MONGO_URL", raising=False)
    code = script.executer(["--appliquer"], fabrique=lambda _uri, _delai: _base_avec_residu())
    assert code == 2
    assert "MONGO_URL" in capsys.readouterr().err


def test_une_base_injoignable_est_une_premisse(script, monkeypatch, capsys):
    monkeypatch.setenv("MONGO_URL", "mongodb://exemple.invalide")

    def fabrique(_uri, _delai):
        raise RuntimeError("serveur introuvable")

    code = script.executer(["--appliquer"], fabrique=fabrique)
    assert code == 2
    tampon = capsys.readouterr()
    assert "injoignable" in tampon.err
    assert "mongodb://exemple.invalide" not in tampon.err, "la chaîne de connexion a fuité"


def test_le_script_partage_le_lecteur_de_la_sonde(script):
    """Le même `lire_etats()` que la sonde : deux lectures différentes des mêmes
    index finiraient par ne plus dire la même chose."""
    sonde = _charger(SONDE, "check_index_db_pour_residus")
    assert hasattr(sonde, "lire_etats")


def test_le_script_est_declare_comme_outil_dans_le_registre():
    """Tout script du dépôt est déclaré (rôle `garde` ou `outil`) : il écrit dans
    la BASE, il ne prononce aucun verdict sur l'arbre."""
    import json

    registre = json.loads(
        (RACINE / ".github" / "scripts" / "guard-proofs.json").read_text(encoding="utf-8")
    )
    entrees = {
        g["chemin"]: g for g in registre["gardes"]
        if g["chemin"].endswith("retirer_index_residuels.py")
    }
    assert entrees, "backend/scripts/retirer_index_residuels.py absent du registre"
    entree = entrees["backend/scripts/retirer_index_residuels.py"]
    assert entree["role"] == "outil"
    assert len(entree.get("motif") or "") >= 40, "un outil doit dire pourquoi ce n'est pas un garde"
