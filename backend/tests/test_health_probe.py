import importlib.util
import json
from pathlib import Path
from unittest.mock import patch, MagicMock
import urllib.error
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "backend" / "scripts" / "check_health_probe.py"
HEALTH_URL = "https://example.com/health"


def _charger_probe():
    spec = importlib.util.spec_from_file_location("check_health_probe", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def probe():
    return _charger_probe()


def make_fake_response(status_code=200, json_data=None):
    mock_resp = MagicMock()
    mock_resp.status = status_code
    body = json.dumps(json_data or {}).encode('utf-8')
    mock_resp.read.return_value = body
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = False
    return mock_resp


def sante_ok(**extra):
    payload = {
        "status": "healthy",
        "database": "connected",
        "paydunya_circuit": {
            "state": "closed",
            "consecutive_failures": 0,
            "remaining_cooldown_seconds": 0,
        },
    }
    payload.update(extra)
    return make_fake_response(200, payload)


def email_ok(provider="resend"):
    return make_fake_response(200, {
        "service": "email",
        "provider": provider,
        "circuit": "ok",
        "configured": True,
        "detail": "HTTP 200, domaine « kojoforafrica.cc.cd » domaine vérifié",
    })


def email_down(provider="resend", detail="expéditeur inutilisable : domaine « x » statut 'pending'"):
    return make_fake_response(503, {
        "service": "email",
        "provider": provider,
        "circuit": "down",
        "configured": True,
        "detail": detail,
    })


def composite_ok(total=4, seuil=2):
    return make_fake_response(200, {
        "service": "composite",
        "circuit": "ok",
        "total": total,
        "down": 0,
        "threshold": seuil,
        "providers": {
            "paydunya": {"circuit": "ok"},
            "email": {"circuit": "ok", "provider": "resend"},
            "brevo": {"circuit": "ok"},
            "cloudinary": {"circuit": "ok"},
        },
    })


def composite_503(noms=("email", "cloudinary"), seuil=2):
    providers = {nom: {"circuit": "down"} for nom in noms}
    providers["paydunya"] = {"circuit": "ok"}
    return make_fake_response(503, {
        "service": "composite",
        "circuit": "degraded",
        "total": len(providers),
        "down": len(noms),
        "threshold": seuil,
        "providers": providers,
    })


# ---------------------------------------------------------------------------
# /health : contrat d'origine, inchangé
# ---------------------------------------------------------------------------

def test_check_health_success(probe):
    payload = {
        "status": "healthy",
        "database": "connected",
        "paydunya_circuit": {
            "state": "closed",
            "consecutive_failures": 0,
            "remaining_cooldown_seconds": 0
        },
        "revision": "abcdef1234"
    }
    with patch("urllib.request.urlopen",
               side_effect=[make_fake_response(200, payload), email_ok(), composite_ok()]):
        assert probe.check_health(HEALTH_URL) == 0


def test_check_health_fails_on_paydunya_open(probe):
    payload = {
        "status": "healthy",
        "database": "connected",
        "paydunya_circuit": {
            "state": "open",
            "consecutive_failures": 5,
            "remaining_cooldown_seconds": 60
        }
    }
    with patch("urllib.request.urlopen",
               side_effect=[make_fake_response(200, payload), email_ok(), composite_ok()]):
        assert probe.check_health(HEALTH_URL) == 1


def test_check_health_fails_on_database_disconnected(probe):
    payload = {
        "status": "healthy",
        "database": "disconnected",
        "paydunya_circuit": {
            "state": "closed",
            "consecutive_failures": 0
        }
    }
    with patch("urllib.request.urlopen",
               side_effect=[make_fake_response(200, payload), email_ok(), composite_ok()]):
        assert probe.check_health(HEALTH_URL) == 1


def test_check_health_fails_on_http_error(probe):
    with patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError("url", 500, "Server Error", {}, None)):
        assert probe.check_health(HEALTH_URL) == 1


# ---------------------------------------------------------------------------
# Fournisseur email : le fait qu'un utilisateur découvrait en attendant son code
# ---------------------------------------------------------------------------

def test_email_muet_fait_echouer_et_nomme_la_cause(probe, capsys):
    """Le détail du fournisseur doit sortir dans l'échec : un job rouge qui dit
    seulement « 503 » ne dit pas s'il faut regarder la clé, le DNS ou l'OAuth."""
    with patch("urllib.request.urlopen",
               side_effect=[sante_ok(), email_down("resend"), composite_ok()]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 1
    assert "FOURNISSEUR EMAIL MUET" in sortie
    assert "provider=resend" in sortie
    assert "statut 'pending'" in sortie


def test_email_provider_none_fait_echouer(probe, capsys):
    muet = make_fake_response(503, {
        "service": "email",
        "provider": "none",
        "circuit": "down",
        "configured": False,
        "detail": "EMAIL_PROVIDER=none : aucun fournisseur actif, aucun email ne part",
    })
    with patch("urllib.request.urlopen", side_effect=[sante_ok(), muet, composite_ok()]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 1
    assert "provider=none" in sortie
    assert "aucun fournisseur actif" in sortie


def test_email_200_mais_verdict_down_est_incoherent_et_echoue(probe, capsys):
    """Une sonde qui répond 200 en disant « down » est le silence qu'on ferme."""
    incoherent = make_fake_response(200, {
        "service": "email",
        "provider": "brevo",
        "circuit": "down",
        "configured": True,
        "detail": "expéditeur inutilisable",
    })
    with patch("urllib.request.urlopen",
               side_effect=[sante_ok(), incoherent, composite_ok()]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 1
    assert "incoherente" in sortie


def test_email_503_mais_verdict_ok_est_incoherent_et_echoue(probe, capsys):
    """L'autre sens : un 503 qui se dirait « ok » ne doit pas passer pour sain."""
    incoherent = make_fake_response(503, {
        "service": "email",
        "provider": "resend",
        "circuit": "ok",
        "configured": True,
        "detail": "HTTP 200, domaine vérifié",
    })
    with patch("urllib.request.urlopen",
               side_effect=[sante_ok(), incoherent, composite_ok()]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 1
    assert "incoherente" in sortie


def test_sonde_email_absente_fait_echouer_en_le_disant(probe, capsys):
    """Un backend déployé sans la route ne doit pas passer pour un fournisseur sain."""
    with patch("urllib.request.urlopen",
               side_effect=[sante_ok(),
                            urllib.error.HTTPError("u", 404, "Not Found", {}, None),
                            composite_ok()]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 1
    assert "ne porte pas encore cette sonde" in sortie


# ---------------------------------------------------------------------------
# Composite : le seuil décide, et une panne isolée n'échoue pas
# ---------------------------------------------------------------------------

def test_composite_au_dela_du_seuil_echoue_et_nomme_les_pannes(probe, capsys):
    with patch("urllib.request.urlopen",
               side_effect=[sante_ok(), email_ok(), composite_503(("email", "cloudinary"))]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 1
    assert "PRODUCTION DEGRADEE" in sortie
    assert "email" in sortie and "cloudinary" in sortie


def test_composite_degrade_sous_le_seuil_avertit_sans_echouer(probe, capsys):
    """Le contrat du composite : une panne isolée qui flappe n'alerte pas."""
    degrade = make_fake_response(200, {
        "service": "composite",
        "circuit": "degraded",
        "total": 4,
        "down": 1,
        "threshold": 2,
        "providers": {
            "paydunya": {"circuit": "ok"},
            "email": {"circuit": "ok", "provider": "resend"},
            "brevo": {"circuit": "down"},
            "cloudinary": {"circuit": "ok"},
        },
    })
    with patch("urllib.request.urlopen", side_effect=[sante_ok(), email_ok(), degrade]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 0
    assert "[WARN]" in sortie and "brevo" in sortie


def test_composite_503_sans_fournisseur_down_ne_conclut_pas(probe, capsys):
    muet = make_fake_response(503, {
        "service": "composite",
        "circuit": "degraded",
        "total": 4,
        "down": 2,
        "threshold": 2,
        "providers": {},
    })
    with patch("urllib.request.urlopen", side_effect=[sante_ok(), email_ok(), muet]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 1
    assert "sans fournisseur down identifiable" in sortie


# ---------------------------------------------------------------------------
# Les deux moniteurs sont dérivés de l'origine de --url
# ---------------------------------------------------------------------------

def test_les_moniteurs_sont_derives_de_l_url_de_sante(probe):
    demandees = []

    def urlopen_espion(req, timeout=None):
        demandees.append(req.full_url)
        return [sante_ok(), email_ok(), composite_ok()][len(demandees) - 1]

    with patch("urllib.request.urlopen", side_effect=urlopen_espion):
        assert probe.check_health("https://api.kojoforafrica.cc.cd/health") == 0

    assert demandees == [
        "https://api.kojoforafrica.cc.cd/health",
        "https://api.kojoforafrica.cc.cd/monitor/email",
        "https://api.kojoforafrica.cc.cd/monitor",
    ]


def test_l_origine_ne_garde_pas_le_chemin_ni_la_requete(probe):
    assert probe._origine("https://hote.test/api/v1/health?x=1") == "https://hote.test"
    assert probe._url_de("https://hote.test/", "/monitor/email") == "https://hote.test/monitor/email"
