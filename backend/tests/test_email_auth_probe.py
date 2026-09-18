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


class FausseSession:
    """Session IMAP simulée : `search` répond selon le numéro d'essai.

    Un double fidèle, et non un simple mouchard : la sonde n'utilise que
    `search` (TO), `fetch` (BODY.PEEK[HEADER]) et `logout`, donc le double doit
    porter exactement ce contrat — dont la forme `(typ, [(bytes, bytes)])` de
    `fetch`, qu'un double approximatif ne reproduirait pas.
    """

    def __init__(self, entete=None):
        self.entete = entete
        self.logout_appele = False

    def search(self, *_args):
        return ("OK", [b"12"] if self.entete else [b""])

    def fetch(self, *_args):
        return ("OK", [(b"12 (BODY[HEADER] {0}", self.entete or b"")])

    def logout(self):
        self.logout_appele = True


class SessionPerdue(FausseSession):
    def search(self, *_args):
        raise probe_error()


def probe_error():
    import imaplib

    return imaplib.IMAP4.error("session morte")


class TestSessionsNeuveAChaqueEssai:
    """Le défaut mesuré le 18/09/2026 : une session gardée ouverte ne voit
    JAMAIS le message arrivé après son ouverture (240 s d'essais), alors qu'une
    session ouverte après le trouve en 14 s — même message, mêmes identifiants.
    La sonde doit donc rouvrir une session à chaque essai.
    """

    def test_rouvre_une_session_a_chaque_essai(self, probe):
        sessions = []

        def fabrique(_creds):
            # La première session ne voit rien, la deuxième trouve le message.
            session = FausseSession(entete=b"Authentication-Results: mx.google.com; dkim=pass\r\n")
            if not sessions:
                session.entete = None
            sessions.append(session)
            return session

        entete = probe.fetch_probe_headers(
            {"host": "imap.test", "user": "u@test.dev", "password": "p"},
            "u+kojo-probe-1@test.dev",
            timeout=30,
            imap_factory=fabrique,
            sleep=lambda _s: None,
        )

        assert entete.startswith(b"Authentication-Results")
        assert len(sessions) == 2, "une session neuve doit etre ouverte a chaque essai"
        assert all(session.logout_appele for session in sessions), "chaque session est refermee"

    def test_une_session_qui_tombe_ne_condamne_pas_la_sonde(self, probe):
        sessions = []

        def fabrique(_creds):
            session = SessionPerdue() if not sessions else FausseSession(entete=b"Authentication-Results: ok\r\n")
            sessions.append(session)
            return session

        entete = probe.fetch_probe_headers(
            {"host": "imap.test", "user": "u@test.dev", "password": "p"},
            "u+kojo-probe-1@test.dev",
            timeout=30,
            imap_factory=fabrique,
            sleep=lambda _s: None,
        )

        assert entete == b"Authentication-Results: ok\r\n"
        assert len(sessions) == 2

    def test_un_refus_didentification_remonte_immediatement(self, probe):
        """Un mot de passe refusé est définitif : le retenter en boucle ferait
        attendre le délai complet pour un diagnostic qui tient en un message.
        """
        import imaplib

        essais = []

        def fabrique(_creds):
            essais.append(1)
            raise imaplib.IMAP4.error("[AUTHENTICATIONFAILED] Invalid credentials (Failure)")

        with pytest.raises(imaplib.IMAP4.error):
            probe.fetch_probe_headers(
                {"host": "imap.test", "user": "u@test.dev", "password": "faux"},
                "u+kojo-probe-1@test.dev",
                timeout=30,
                imap_factory=fabrique,
                sleep=lambda _s: None,
            )

        assert len(essais) == 1, "un refus d'identification ne se retente pas"

    def test_epuise_le_delai_en_rouvrant_des_sessions(self, probe):
        sessions = []
        horloge = iter([0, 0, 0, 5, 10, 20, 30])  # délai de 20 s franchi au 6e contrôle

        def fabrique(_creds):
            session = FausseSession()
            sessions.append(session)
            return session

        original = probe.time.monotonic
        probe.time.monotonic = lambda: next(horloge, 30)
        try:
            with pytest.raises(TimeoutError):
                probe.fetch_probe_headers(
                    {"host": "imap.test", "user": "u@test.dev", "password": "p"},
                    "u+kojo-probe-1@test.dev",
                    timeout=20,
                    imap_factory=fabrique,
                    sleep=lambda _s: None,
                )
        finally:
            probe.time.monotonic = original

        assert len(sessions) >= 2, "plusieurs sessions avant d'abandonner"


# ── Alignement DMARC ────────────────────────────────────────────────────────
# En-têtes d'un message RÉELLEMENT livré le 18/09/2026 : l'enveloppe est le
# domaine de rebond de Brevo, la signature porte le nôtre. C'est l'état mesuré,
# pas une hypothèse — et c'est pour ça que la phrase d'alignement existe.
LIVRE_AVANT = (
    b"Return-Path: <bounces-470616010-2104611724@gw.d.sender-sib.com>\r\n"
    b"DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=kojoforafrica.cc.cd;\r\n"
    b" q=dns/txt; s=brevo2; bh=WG3xHfKWanjvy9UEZH6MjGSMOp1cVuB7adV9zcRMJuU=;\r\n"
    b"From: \"KOJO\" <noreply@kojoforafrica.cc.cd>\r\n"
    b"To: <kojo-probe@test.dev>\r\n"
)


def with_envelope(host, from_domain="kojoforafrica.cc.cd", dkim="kojoforafrica.cc.cd"):
    """Mêmes en-têtes, enveloppe et `d=` remplacés — l'état APRÈS le changement."""
    return (
        f"Return-Path: <bounces@{host}>\r\n"
        f"DKIM-Signature: v=1; d={dkim}; s=brevo2;\r\n"
        f"From: \"KOJO\" <noreply@{from_domain}>\r\n"
    ).encode()


class TestAlignementDmarc:
    """`spf=pass` sur le domaine d'un tiers ne vaut RIEN pour DMARC."""

    def test_lit_les_trois_domaines_du_message_recu(self, probe):
        facts = probe.alignment_facts(LIVRE_AVANT)

        assert facts == {
            "from": "kojoforafrica.cc.cd",
            "envelope": "gw.d.sender-sib.com",
            "dkim": "kojoforafrica.cc.cd",
        }

    def test_un_spf_pass_non_aligne_est_dit_non_aligne(self, probe):
        verdicts = {"spf": "pass", "dkim": "pass", "dmarc": "pass"}
        notice = probe.alignment_notice(probe.alignment_facts(LIVRE_AVANT), verdicts)

        # Le fait mesuré : DMARC tient sur DKIM seul.
        assert "spf=pass NON aligné" in notice
        assert "gw.d.sender-sib.com" in notice and "kojoforafrica.cc.cd" in notice
        assert "dkim=pass aligné (d=kojoforafrica.cc.cd)" in notice

    def test_accepte_l_enveloppe_sur_un_sous_domaine_du_domaine(self, probe):
        """Ce que produira le sous-domaine brandé de Brevo (`mail.…`)."""
        facts = probe.alignment_facts(with_envelope("mail.kojoforafrica.cc.cd"))

        assert probe.is_aligned(facts["envelope"], facts["from"])
        assert "spf=pass aligné" in probe.alignment_notice(facts, {"spf": "pass", "dkim": "pass"})
        assert probe.alignment_problems(facts, {"spf": "pass"}, required=True) == []

    def test_refuse_un_domaine_qui_ressemble_au_notre(self, probe):
        """Un suffixe de chaîne ne doit pas passer pour un sous-domaine."""
        facts = probe.alignment_facts(with_envelope("kojoforafrica.cc.cd.attaquant.test"))

        assert not probe.is_aligned(facts["envelope"], facts["from"])
        assert probe.alignment_problems(facts, {"spf": "pass"}, required=True)

    def test_n_exige_rien_tant_que_l_exigence_n_est_pas_declaree(self, probe):
        facts = probe.alignment_facts(LIVRE_AVANT)

        assert probe.alignment_problems(facts, {"spf": "pass"}, required=False) == []
        assert probe.spf_alignment_required({"KOJO_REQUIRE_SPF_ALIGNMENT": "1"}) is True
        assert probe.spf_alignment_required({"KOJO_REQUIRE_SPF_ALIGNMENT": ""}) is False
        assert probe.spf_alignment_required({}) is False

    def test_un_spf_en_echec_ne_double_pas_l_erreur(self, probe):
        """`evaluate()` signale déjà un spf=fail : deux erreurs pour un fait
        brouilleraient la lecture du journal."""
        facts = probe.alignment_facts(LIVRE_AVANT)

        assert probe.alignment_problems(facts, {"spf": "fail"}, required=True) == []
