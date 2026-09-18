# -*- coding: utf-8 -*-
"""Régression : la sonde SPF/DKIM/DMARC (.github/scripts/check-email-auth.py).

La sonde lit les verdicts là où ils existent : l'en-tête
`Authentication-Results` que le récepteur pose à la RÉCEPTION. Ces tests
exercent les décisions pures (sélection de l'en-tête, lecture des verdicts,
verdict global, alias, annulation sans identifiants) sans réseau ni boîte :
c'est la partie qui décide, et celle qu'un changement de format Gmail ferait
casser en silence si elle n'était pas verrouillée.

Le format des fixtures est celui de Gmail (`mx.google.com; dkim=pass …;
spf=pass …; dmarc=pass …`), en-tête replié sur plusieurs lignes.
"""
import importlib.util
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPT = REPO_ROOT / ".github" / "scripts" / "check-email-auth.py"


def _load_probe():
    assert SCRIPT.exists(), f"{SCRIPT} absent — normalement commité"
    spec = importlib.util.spec_from_file_location("check_email_auth", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def probe():
    return _load_probe()


def gmail_headers(*results):
    """En-têtes d'un message reçu, avec les `Authentication-Results` donnés."""
    return "".join(f"Authentication-Results: {value}\r\n" for value in results).encode()


PASS = (
    "mx.google.com;\r\n"
    "       dkim=pass header.i=@kojoforafrica.cc.cd header.s=brevo2 header.b=Ab3dEf;\r\n"
    "       spf=pass (google.com: domain of bounces-470616010-2104611724@gx.d.sender-sib.com\r\n"
    "        designates 77.32.148.24 as permitted sender) smtp.mailfrom=bounces@gx.d.sender-sib.com;\r\n"
    "       dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=kojoforafrica.cc.cd"
)


class TestLectureDesVerdicts:
    def test_lit_les_trois_verdicts_dun_message_replie(self, probe):
        verdicts, transcript = probe.authentication_verdicts(gmail_headers(PASS))

        assert verdicts == {"dkim": "pass", "spf": "pass", "dmarc": "pass"}
        # Le transcript est la preuve imprimée : il doit rester lisible.
        assert "mx.google.com" in transcript
        assert "\r\n" not in transcript and "  " not in transcript

    def test_le_premier_en_tete_gagne_pas_un_autre_plus_bas(self, probe):
        """Un expéditeur peut ajouter son propre Authentication-Results.

        Lire le dernier reviendrait à croire un verdict écrit par celui qu'on
        vérifie. Seul le premier — celui du récepteur — fait foi.
        """
        forged = "mx.attaquant.test; spf=pass; dkim=pass; dmarc=pass"
        verdicts, transcript = probe.authentication_verdicts(
            gmail_headers("mx.google.com; dkim=fail; spf=pass; dmarc=fail", forged)
        )

        assert verdicts["dkim"] == "fail"
        assert verdicts["dmarc"] == "fail"
        assert "mx.google.com" in transcript

    def test_sans_en_tete_aucun_verdict(self, probe):
        verdicts, transcript = probe.authentication_verdicts(
            b"From: KOJO <noreply@kojoforafrica.cc.cd>\r\nTo: x@y.test\r\n"
        )

        assert verdicts == {} and transcript == ""

    def test_verdict_absent_nest_pas_un_pass(self, probe):
        """`Authentication-Results: mx.google.com; dkim=pass` ne dit rien de SPF."""
        verdicts, _ = probe.authentication_verdicts(gmail_headers("mx.google.com; dkim=pass"))

        assert verdicts == {"dkim": "pass"}
        assert probe.evaluate(verdicts) == [
            "spf=absent (aucun verdict dans Authentication-Results)",
            "dmarc=absent (aucun verdict dans Authentication-Results)",
        ]


class TestVerdictGlobal:
    def test_les_trois_pass_ne_laissent_aucun_manquement(self, probe):
        verdicts, _ = probe.authentication_verdicts(gmail_headers(PASS))

        assert probe.evaluate(verdicts) == []

    @pytest.mark.parametrize("mecanisme", ["spf", "dkim", "dmarc"])
    def test_un_softfail_ou_fail_est_nomme(self, probe, mecanisme):
        """Chaque mécanisme compte : DKIM peut passer pendant que DMARC échoue."""
        broken = PASS.replace(f"{mecanisme}=pass", f"{mecanisme}=fail")
        verdicts, _ = probe.authentication_verdicts(gmail_headers(broken))
        problems = probe.evaluate(verdicts)

        assert problems == [f"{mecanisme}=fail (attendu pass)"]

    def test_un_message_jamais_evalue_liste_les_trois(self, probe):
        problems = probe.evaluate({})

        assert len(problems) == 3
        assert all("absent" in problem for problem in problems)


class TestAliasEtAnnulation:
    def test_lalias_derive_ladresse_sans_perdre_le_plus(self, probe):
        """Gmail remet `user+tag@` dans la boîte `user@` : c'est ce qui permet de
        chercher LE message de ce run (`SEARCH TO`), et non celui d'hier."""
        alias = probe.probe_alias("kojoapp98@gmail.com", token="deadbeef")

        assert alias == "kojoapp98+kojo-probe-deadbeef@gmail.com"
        assert probe.probe_alias("kojoapp98@gmail.com", token="cafe") != alias

    def test_un_jeton_par_defaut_rend_lalias_unique(self, probe):
        premier = probe.probe_alias("boite@test.dev")
        second = probe.probe_alias("boite@test.dev")

        assert premier != second
        assert premier.startswith("boite+kojo-probe-") and premier.endswith("@test.dev")

    def test_une_adresse_sans_domaine_est_refusee(self, probe):
        with pytest.raises(ValueError):
            probe.probe_alias("pas-une-adresse")

    def test_sans_identifiants_la_sonde_sannule(self, probe):
        """Pas de secrets = pas de vérification : la sonde doit le DIRE, pas
        sortir verte en laissant croire que les trois verdicts ont été lus."""
        assert probe.credentials({}) is None
        assert probe.credentials({"KOJO_PROBE_IMAP_USER": "a@b.test"}) is None
        assert probe.credentials({"KOJO_PROBE_IMAP_PASSWORD": "secret"}) is None

    def test_les_identifiants_complets_donnent_lhote_par_defaut(self, probe):
        creds = probe.credentials(
            {"KOJO_PROBE_IMAP_USER": "kojoapp98@gmail.com", "KOJO_PROBE_IMAP_PASSWORD": "abcd efgh"}
        )

        assert creds["host"] == "imap.gmail.com"
        assert creds["user"] == "kojoapp98@gmail.com"
        assert creds["password"] == "abcd efgh"
