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


def paiement(state="inconnu", **extra):
    """Bloc `paiement` de /health, cohérent par défaut avec un circuit fermé.

    `inconnu` est le défaut parce que c'est l'état d'une production qui n'a pas
    encore encaissé depuis son déploiement : configuré, jamais exercé.
    """
    bloc = {
        "configured": True,
        "state": state,
        "cause": "",
        "motif": "",
        "last_status": None,
        "consecutive_failures": 0,
        "failure_threshold": 5,
        "circuit": "closed",
        "remaining_cooldown_seconds": 0,
        "last_call_at": None,
        "last_failure_at": None,
        "last_success_at": None,
    }
    bloc.update(extra)
    return bloc


def langues(codes=("fr", "en", "wo", "bm", "mos"), documents=7, monolingues=45):
    """Bloc `langues` de /health, cohérent par défaut avec 5 langues.

    Les cinq codes sont ceux de la production du 01/11/2026 ; `documents` est le
    nombre de pages multilingues (7 dans `PAGES_STATIQUES`) et `monolingues` les
    villes, métiers et guides, qui ne comptent que dans la langue par défaut.
    """
    urls = {code: documents for code in codes}
    urls[codes[0]] = documents + monolingues
    return {
        "indexees": list(codes),
        "defaut": codes[0],
        "documents_par_langue": {code: documents for code in codes},
        "urls_par_langue": urls,
        "pages": {
            "multilingues": documents,
            "monolingues": monolingues,
            "total": documents * len(codes) + monolingues,
        },
        "alternatives_par_page": len(codes) + 1,
        "portee": (
            "declaration du sitemap (URL par langue) ; les documents servis — "
            "lang, canonical, reciprocite des hreflang — se lisent sur l'origine "
            "du site, avec frontend/scripts/check-hreflang-production.js"
        ),
    }


def sante_ok(**extra):
    payload = {
        "status": "healthy",
        "database": "connected",
        "paydunya_circuit": {
            "state": "closed",
            "consecutive_failures": 0,
            "remaining_cooldown_seconds": 0,
        },
        "paiement": paiement(),
        "langues": langues(),
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
        "paiement": paiement(),
        "langues": langues(),
        "revision": "abcdef1234"
    }
    with patch("urllib.request.urlopen",
               side_effect=[make_fake_response(200, payload), email_ok(), composite_ok()]):
        assert probe.check_health(HEALTH_URL) == 0


def test_check_health_fails_on_paydunya_open(probe, capsys):
    # Le refus doit NOMMER le circuit ouvert, pas seulement rendre 1 : depuis le
    # diagnostic de paiement (31/10/2026) le même incident rend aussi le bloc
    # `paiement` en échec, donc un simple `== 1` restait vrai la branche
    # « circuit ouvert » neutralisée — la mutation déclarée
    # (`health-probe: paydunya open tolere`) ne prouvait plus rien.
    payload = {
        "status": "healthy",
        "database": "connected",
        "paydunya_circuit": {
            "state": "open",
            "consecutive_failures": 5,
            "remaining_cooldown_seconds": 60
        },
        "paiement": paiement(
            state="echec",
            cause="reseau",
            motif="circuitPaydunya ouvert",
            circuit="open",
            consecutive_failures=5,
            remaining_cooldown_seconds=60,
        ),
    }
    with patch("urllib.request.urlopen",
               side_effect=[make_fake_response(200, payload), email_ok(), composite_ok()]):
        assert probe.check_health(HEALTH_URL) == 1
    assert "CIRCUIT BREAKER PAYDUNYA OUVERT" in capsys.readouterr().out


def test_check_health_fails_on_database_disconnected(probe):
    payload = {
        "status": "healthy",
        "database": "disconnected",
        "paydunya_circuit": {
            "state": "closed",
            "consecutive_failures": 0
        },
        "paiement": paiement(),
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


# ---------------------------------------------------------------------------
# Diagnostic de paiement : trois états, pas deux
# ---------------------------------------------------------------------------

def test_paiement_non_configure_fait_echouer_et_nomme_le_remede(probe, capsys):
    """Clés absentes : `closed` + 0 échec le lisait comme un paiement sain.

    Mesuré le 31/10/2026 par l'audit : « `paydunya_circuit: closed`, 0 échec
    consécutif ; mode live non vérifiable sans secret » — trois situations pour
    une seule lecture. Le bloc `paiement` les sépare, et cette sonde refuse la
    première : sans clés, aucun paiement ne peut aboutir.
    """
    with patch("urllib.request.urlopen", side_effect=[
        sante_ok(paiement=paiement(
            "echec",
            configured=False,
            cause="non_configure",
            motif="paiement non configuré : PAYDUNYA_MASTER_KEY, PAYDUNYA_PRIVATE_KEY "
                   "ou PAYDUNYA_TOKEN absent",
        )),
        email_ok(),
        composite_ok(),
    ]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 1
    assert "PAIEMENT NON CONFIGURE" in sortie
    assert "PAYDUNYA_MASTER_KEY" in sortie


def test_paiement_en_echec_publie_son_motif(probe, capsys):
    """Un échec sans motif public ne se répare pas : il doit sortir du run."""
    with patch("urllib.request.urlopen", side_effect=[
        sante_ok(paiement=paiement(
            "echec", cause="cles_refusees", last_status=401,
            motif="PayDunya refuse les clés (401/403) : renouveler PAYDUNYA_MASTER_KEY",
        )),
        email_ok(),
        composite_ok(),
    ]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 1
    assert "PAIEMENT EN ECHEC" in sortie
    assert "cles_refusees" in sortie and "renouveler" in sortie


def test_paiement_jamais_exerce_n_est_pas_une_panne(probe, capsys):
    """`inconnu` = configuré, aucune vente depuis le déploiement.

    Ce n'est PAS un rouge : le site n'a pas encore encaissé, et une sonde qui
    rougirait là-dessus dirait « panne » à la place de « zéro vente ». Le fait
    est publié, et la distinction avec `ok` reste lisible.
    """
    with patch("urllib.request.urlopen", side_effect=[sante_ok(), email_ok(), composite_ok()]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 0
    assert "[WARN] Paiement" in sortie
    assert "aucun appel depuis le demarrage" in sortie


def test_paiement_ok_publie_le_dernier_appel(probe, capsys):
    with patch("urllib.request.urlopen", side_effect=[
        sante_ok(paiement=paiement(
            "ok", last_status=200,
            last_call_at="2026-10-31T14:00:00+00:00",
            last_success_at="2026-10-31T14:00:00+00:00",
        )),
        email_ok(),
        composite_ok(),
    ]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 0
    assert "[OK] Paiement" in sortie and "2026-10-31T14:00:00" in sortie


def test_un_backend_sans_diagnostic_de_paiement_echoue_en_disant_de_redeployer(probe, capsys):
    """Une révision antérieure au diagnostic ne doit pas passer pour saine."""
    payload = {
        "status": "healthy",
        "database": "connected",
        "paydunya_circuit": {"state": "closed", "consecutive_failures": 0,
                             "remaining_cooldown_seconds": 0},
    }
    with patch("urllib.request.urlopen",
               side_effect=[make_fake_response(200, payload), email_ok(), composite_ok()]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 1
    assert "anterieure au diagnostic de paiement" in sortie


def test_un_bloc_paiement_incomplet_nomme_le_champ_absent(probe, capsys):
    bloc = paiement()
    del bloc["motif"]
    with patch("urllib.request.urlopen",
               side_effect=[sante_ok(paiement=bloc), email_ok(), composite_ok()]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 1
    assert "incomplet" in sortie and "motif" in sortie


def test_un_health_qui_se_contredit_echoue(probe, capsys):
    """Deux lectures du même circuit dans la même réponse doivent s'accorder."""
    with patch("urllib.request.urlopen", side_effect=[
        sante_ok(paiement=paiement(consecutive_failures=3)),
        email_ok(),
        composite_ok(),
    ]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 1
    assert "se contredit" in sortie and "consecutive_failures" in sortie


def test_un_composite_qui_contredit_le_diagnostic_echoue(probe, capsys):
    """Le composite est une SECONDE lecture : la désaccord doit sortir."""
    composite = make_fake_response(200, {
        "service": "composite",
        "circuit": "degraded",
        "total": 4,
        "down": 1,
        "threshold": 2,
        "providers": {
            "paydunya": {"circuit": "down"},
            "email": {"circuit": "ok", "provider": "resend"},
            "brevo": {"circuit": "ok"},
            "cloudinary": {"circuit": "ok"},
        },
    })
    with patch("urllib.request.urlopen", side_effect=[sante_ok(), email_ok(), composite]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 1
    assert "composite /monitor dit paydunya 'down'" in sortie


# ---------------------------------------------------------------------------
# Langues servies : un appel couvre le VOLUME que la sonde hreflang mesure
# ---------------------------------------------------------------------------

def test_les_langues_servies_sont_publiees_et_comptees(probe, capsys):
    """Le bloc doit pouvoir se lire sans lancer la sonde hreflang."""
    with patch("urllib.request.urlopen",
               side_effect=[sante_ok(), email_ok(), composite_ok()]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 0
    assert "Langues : 5" in sortie
    assert "7 document(s) par langue" in sortie
    assert "80 URL" in sortie


def test_un_backend_sans_bloc_langues_echoue_en_disant_de_redeployer(probe, capsys):
    """Une révision antérieure au bloc ne doit pas passer pour une couverture."""
    payload = {
        "status": "healthy",
        "database": "connected",
        "paydunya_circuit": {"state": "closed", "consecutive_failures": 0,
                             "remaining_cooldown_seconds": 0},
        "paiement": paiement(),
    }
    with patch("urllib.request.urlopen",
               side_effect=[make_fake_response(200, payload), email_ok(), composite_ok()]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 1
    assert "ne publie pas de bloc 'langues'" in sortie
    assert "redeployer" in sortie


def test_un_volume_de_langues_qui_ne_tombe_pas_juste_echoue(probe, capsys):
    """`pages.total` et la somme des URL par langue décrivent le MÊME ensemble."""
    bloc = langues()
    bloc["pages"] = {**bloc["pages"], "total": 999}
    with patch("urllib.request.urlopen",
               side_effect=[sante_ok(langues=bloc), email_ok(), composite_ok()]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 1
    assert "se contredit" in sortie and "pages.total" in sortie


def test_une_langue_sans_document_est_refusee(probe, capsys):
    """Une langue indexée qui n'annonce aucun document n'a pas d'URL à servir."""
    bloc = langues()
    bloc["documents_par_langue"] = {**bloc["documents_par_langue"], "mos": 0}
    with patch("urllib.request.urlopen",
               side_effect=[sante_ok(langues=bloc), email_ok(), composite_ok()]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 1
    assert "mos" in sortie and "aucun document" in sortie


def test_un_volume_sans_portee_est_refuse(probe, capsys):
    """Un compte publié sans portée se lit comme une mesure des documents."""
    bloc = langues()
    bloc["portee"] = "   "
    with patch("urllib.request.urlopen",
               side_effect=[sante_ok(langues=bloc), email_ok(), composite_ok()]):
        code = probe.check_health(HEALTH_URL)

    sortie = capsys.readouterr().out
    assert code == 1
    assert "portee" in sortie
