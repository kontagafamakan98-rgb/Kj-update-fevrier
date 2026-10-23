# -*- coding: utf-8 -*-
"""Gardes de la sonde de l'assistant support en production.

Ce que ces tests protègent : la sonde doit REFUSER en nommant la cause — un
502 du gateway, une réponse vide, une réponse qui n'oriente vers aucune étape —
et ne jamais rendre un vert qui n'a rien mesuré. Les trois cas sont ceux qui
ont réellement eu lieu le 23/10/2026.
"""
import importlib.util
import json
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "backend" / "scripts" / "check_ai_assistant_probe.py"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ai-assistant-probe.yml"
URL = "https://exemple.test/api/support/robot/chat"

REPONSE_PUBLICATION = (
    "Pour publier une mission : connecte-toi, puis tableau de bord → « Publier un emploi » "
    "(/create-job) : titre, description, categorie, budget. Les travailleurs postulent ensuite."
)
REPONSE_PAIEMENT = (
    "Le versement est automatique : il faut un compte mobile money (Orange Money en priorite, "
    "sinon Wave) dans le profil. Sans validation du client, la liberation arrive au bout de 7 jours."
)
REPONSE_LITIGE = (
    "Ouvre un litige depuis la mission (« Ouvrir un litige ») avec un motif de 20 caracteres "
    "minimum : le paiement est gele, l'autre partie repond une fois, le proprietaire tranche."
)


def _charger_sonde():
    spec = importlib.util.spec_from_file_location("check_ai_assistant_probe", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _reponse(statut=200, payload=None, texte=None):
    doublure = MagicMock()
    doublure.status = statut
    if texte is not None:
        doublure.read.return_value = texte.encode("utf-8")
    else:
        doublure.read.return_value = json.dumps(payload or {}).encode("utf-8")
    doublure.__enter__.return_value = doublure
    doublure.__exit__.return_value = False
    return doublure


def _ok(reply):
    return _reponse(200, {"reply": reply, "ticket_suggested": False, "model": "modele-de-test"})


def _questions_envoyees(req):
    return json.loads(req.data.decode("utf-8"))


# ---------------------------------------------------------------------------
# Le verdict nominal
# ---------------------------------------------------------------------------

def test_les_trois_parcours_conformes_rendent_vert(capsys):
    sonde = _charger_sonde()
    envoyees = []

    def urlopen(req, timeout=None):
        envoyees.append(_questions_envoyees(req))
        return [_ok(REPONSE_PUBLICATION), _ok(REPONSE_PAIEMENT), _ok(REPONSE_LITIGE)][len(envoyees) - 1]

    with patch("urllib.request.urlopen", side_effect=urlopen):
        assert sonde.verifier_assistant(URL) == 0

    sortie = capsys.readouterr().out
    assert "[OK] publication" in sortie
    assert "[OK] paiement" in sortie
    assert "[OK] litige" in sortie
    assert "SUCCESS" in sortie

    # Les trois questions RÉELLES partent, en français, avec une seule voix user.
    assert [e["messages"][0]["content"] for e in envoyees] == [
        q["question"] for q in sonde.QUESTIONS_DE_REFERENCE
    ]
    assert all(e["language"] == "fr" for e in envoyees)
    assert all(e["messages"][0]["role"] == "user" for e in envoyees)


def test_les_questions_couvrent_les_trois_parcours_demandes():
    sonde = _charger_sonde()
    cles = {q["cle"] for q in sonde.QUESTIONS_DE_REFERENCE}

    assert {"publication", "paiement", "litige"} <= cles, (
        "les trois parcours de référence sont la raison d'être de la sonde : "
        "un parcours oublié ne serait mesuré nulle part"
    )


# ---------------------------------------------------------------------------
# Les trois défauts mesurés le 23/10/2026
# ---------------------------------------------------------------------------

def test_un_502_est_refuse_en_le_nommant(capsys):
    sonde = _charger_sonde()
    panne = _reponse(502, {"detail": "L'assistant n'a pas pu répondre. Réessayez ou déposez une demande."})

    with patch("urllib.request.urlopen", return_value=panne):
        assert sonde.verifier_assistant(URL) == 1

    sortie = capsys.readouterr().out
    assert "HTTP 502" in sortie
    assert "L'assistant n'a pas pu repondre" in sortie.replace("é", "e").replace("û", "u")
    assert "PAS CONFORME" in sortie


def test_une_reponse_vide_est_refusee(capsys):
    sonde = _charger_sonde()

    with patch("urllib.request.urlopen", return_value=_ok("   ")):
        assert sonde.verifier_assistant(URL) == 1

    sortie = capsys.readouterr().out
    assert "vide ou trop courte" in sortie


def test_une_reponse_sans_l_etape_attendue_est_refusee_en_la_nommant(capsys):
    """La réponse est longue et polie, mais elle n'oriente vers aucune action."""
    sonde = _charger_sonde()
    vague = "Je comprends votre souci. Je ne peux pas voir votre dossier, je transmets a l'equipe."

    with patch("urllib.request.urlopen", return_value=_ok(vague)):
        assert sonde.verifier_assistant(URL) == 1

    sortie = capsys.readouterr().out
    assert "etape attendue absente" in sortie
    assert "create-job" in sortie, "l'étape attendue doit être nommée pour être réparée"
    assert "servi" in sortie, "un extrait de ce qui a été servi rend l'échec exploitable"


def test_un_503_est_refuse_en_nommant_l_indisponibilite(capsys):
    """Assistant éteint ou gateway muet : ce n'est pas une forme à corriger."""
    sonde = _charger_sonde()

    with patch(
        "urllib.request.urlopen",
        return_value=_reponse(503, {"detail": "L'assistant est temporairement indisponible."}),
    ):
        assert sonde.verifier_assistant(URL) == 1

    sortie = capsys.readouterr().out
    assert "HTTP 503" in sortie
    assert "indisponible" in sortie


# ---------------------------------------------------------------------------
# Le texte doit être FINAL : brouillon, répétition, marqueur visible
# ---------------------------------------------------------------------------


def test_un_brouillon_de_raisonnement_est_refuse(capsys):
    """Le modèle a rendu « Wait, should I include ticket? » avant sa réponse."""
    sonde = _charger_sonde()
    fuite = (
        "Wait, should I include ticket? No, the user only asks how to publish.\n\n"
        + REPONSE_PUBLICATION
    )

    with patch("urllib.request.urlopen", return_value=_ok(fuite)):
        assert sonde.verifier_assistant(URL) == 1

    sortie = capsys.readouterr().out
    assert "texte non final" in sortie
    assert "brouillon" in sortie
    assert "Wait" in sortie, "le marqueur fautif doit être nommé pour être réparé"


def test_une_reponse_repete_est_refusee(capsys):
    """La même phrase servie deux fois : le doublon, pas la reprise."""
    sonde = _charger_sonde()

    with patch("urllib.request.urlopen", return_value=_ok(REPONSE_PAIEMENT + "\n\n" + REPONSE_PAIEMENT)):
        assert sonde.verifier_assistant(URL) == 1

    sortie = capsys.readouterr().out
    assert "repetition" in sortie
    assert REPONSE_PAIEMENT[:40] in sortie, "la phrase répétée est citée"


def test_le_marqueur_d_escalade_visible_est_refuse(capsys):
    """Le serveur doit RETIRER le marqueur : s'il sort, la mécanique est visible."""
    sonde = _charger_sonde()

    with patch("urllib.request.urlopen", return_value=_ok(REPONSE_LITIGE + " [KOJO_TICKET]")):
        assert sonde.verifier_assistant(URL) == 1

    sortie = capsys.readouterr().out
    assert "marqueur visible" in sortie
    assert "KOJO_TICKET" in sortie


def test_une_prose_legitime_n_est_pas_un_brouillon():
    """Un mot français courant (« attendez », « en fait ») est une prose normale."""
    sonde = _charger_sonde()

    assert sonde._defauts_de_forme(REPONSE_PAIEMENT) == []
    assert sonde._defauts_de_forme(
        "Attendez la validation du client. En fait, tout est automatique apres 7 jours."
    ) == [], "juger le fond ferait rougir une réponse honnête"


# ---------------------------------------------------------------------------
# Trois sorties, jamais deux
# ---------------------------------------------------------------------------

def test_un_429_du_produit_est_une_premisse_et_pas_un_vert(capsys):
    """Budget du jour atteint : le produit fait son travail, la sonde ne juge pas."""
    sonde = _charger_sonde()

    with patch("urllib.request.urlopen", return_value=_reponse(429, {"detail": "Budget atteint"})):
        assert sonde.verifier_assistant(URL) == 2

    sortie = capsys.readouterr().out
    assert "PREMISSE" in sortie
    assert "budget" in sortie
    assert "SUCCESS" not in sortie, "une prémisse ne publie pas un vert"


def test_une_url_inutilisable_est_une_premisse_sans_requete():
    sonde = _charger_sonde()

    with patch("urllib.request.urlopen", side_effect=AssertionError("aucun appel attendu")):
        assert sonde.verifier_assistant("") == 2


def test_un_transport_coupe_est_un_refus_nomme(capsys):
    sonde = _charger_sonde()

    with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("connexion refusee")):
        assert sonde.verifier_assistant(URL) == 1

    sortie = capsys.readouterr().out
    assert "injoignable" in sortie


# ---------------------------------------------------------------------------
# Le câblage : le workflow pose bien cette question, chaque jour
# ---------------------------------------------------------------------------

def test_le_workflow_lance_la_sonde_chaque_jour_sans_echappatoire():
    texte = WORKFLOW.read_text(encoding="utf-8")

    assert "cron: '32 7 * * *'" in texte, "la sonde doit tourner chaque jour, à l'heure déclarée"
    assert "python backend/scripts/check_ai_assistant_probe.py" in texte, (
        "le workflow doit exécuter CETTE sonde, pas une variante"
    )
    assert "continue-on-error" not in texte, (
        "une étape qui ne peut pas échouer rendrait la sonde décorative"
    )
    assert "|| true" not in texte
