# -*- coding: utf-8 -*-
"""Régression : l'outil de politique DMARC (backend/scripts/dmarc_policy.py).

Ce qui est verrouillé ici, c'est ce qui décide : l'échelle des paliers, le délai
d'observation (déduit du `updated_at` du DNS, pas d'un fichier d'état qu'on
oublierait de tenir), le fait que le retour arrière existe et conserve `rua`, et
le parseur de la réponse DNS — une lecture qui renverrait une liste vide
produirait un « rien n'est propagé » indistinguable d'une vraie absence.
"""
import importlib.util
import struct
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPT = REPO_ROOT / "backend" / "scripts" / "dmarc_policy.py"
# `_dmarc.kojoforafrica.cc.cd` : la longueur des libellés compte, un octet de
# trop et le parseur lit la suite du paquet comme un nom.
DNS_NAME = b"\x06_dmarc\x0dkojoforafrica\x02cc\x02cd\x00"


def _load_policy():
    assert SCRIPT.exists(), f"{SCRIPT} absent — normalement commité"
    spec = importlib.util.spec_from_file_location("dmarc_policy", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def policy():
    return _load_policy()


def dns_packet(answer_txt, compressed=True):
    """Réponse DNS minimale : 1 question + 1 TXT (nom compressé ou non)."""
    header = struct.pack(">HHHHHH", 0x4B4F, 0x8180, 1, 1, 0, 0)
    question = DNS_NAME + struct.pack(">HH", 16, 1)
    name = b"\xc0\x0c" if compressed else DNS_NAME
    rdata = bytes([len(answer_txt)]) + answer_txt.encode()
    answer = name + struct.pack(">HHIH", 16, 1, 300, len(rdata)) + rdata
    return header + question + answer


class TestEchelleDesPaliers:
    def test_lobservation_ne_rejette_rien(self, policy):
        assert policy.build_record("observe") == "v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com"

    def test_le_dernier_palier_nannonce_pas_pct_100(self, policy):
        """`pct` absent vaut 100 (RFC 7489 §6.3) : l'écrire serait du bruit."""
        assert policy.build_record("full") == "v=DMARC1; p=quarantine; rua=mailto:rua@dmarc.brevo.com"

    def test_le_palier_intermediaire_porte_son_pourcentage(self, policy):
        assert policy.build_record("canary") == "v=DMARC1; p=quarantine; pct=10; rua=mailto:rua@dmarc.brevo.com"
        assert policy.build_record("half") == "v=DMARC1; p=quarantine; pct=50; rua=mailto:rua@dmarc.brevo.com"

    @pytest.mark.parametrize("stage", ["observe", "canary", "half", "full"])
    def test_chaque_palier_garde_ladresse_de_rapports(self, policy, stage):
        """Sans `rua`, la montée perd son instrument de mesure : plus aucun
        rapport agrégé pour décider si le palier suivant est raisonnable."""
        assert "rua=mailto:rua@dmarc.brevo.com" in policy.build_record(stage)

    def test_les_paliers_ne_rejettent_jamais_plus_que_quarantine(self, policy):
        """Une politique `reject` n'est pas dans l'échelle : elle ne peut donc
        pas être publiée par cette commande."""
        assert all(stage["policy"] in ("none", "quarantine") for stage in policy.STAGES)


class TestLectureDunRecordPublie:
    def test_decompose_les_balises_et_les_espaces(self, policy):
        tags = policy.parse_record(" v=DMARC1 ;  p=quarantine ; pct=10 ; rua=mailto:x@y.z ")

        assert tags == {"v": "DMARC1", "p": "quarantine", "pct": 10, "rua": "mailto:x@y.z"}

    def test_un_pct_illisible_ne_fait_pas_planter(self, policy):
        assert policy.parse_record("v=DMARC1; p=quarantine; pct=beaucoup")["pct"] is None

    @pytest.mark.parametrize(
        "content,attendu",
        [
            ("v=DMARC1; p=none; rua=mailto:r@d", "observe"),
            ("v=DMARC1; p=quarantine; pct=10; rua=mailto:r@d", "canary"),
            ("v=DMARC1; p=quarantine; pct=50; rua=mailto:r@d", "half"),
            ("v=DMARC1; p=quarantine; rua=mailto:r@d", "full"),
        ],
    )
    def test_reconnait_chaque_palier(self, policy, content, attendu):
        assert policy.stage_of(content) == attendu

    def test_un_record_etranger_nest_pas_une_etape(self, policy):
        """`p=reject` (ou un `pct` inconnu) a peut-être été posé à la main : la
        montée doit le DIRE au lieu de deviner une étape."""
        assert policy.stage_of("v=DMARC1; p=reject; rua=mailto:r@d") is None
        assert policy.stage_of("v=DMARC1; p=quarantine; pct=25; rua=mailto:r@d") is None
        assert policy.stage_of("") is None

    def test_lordre_de_lechelle_est_respecte(self, policy):
        assert policy.next_stage("observe") == "canary"
        assert policy.next_stage("canary") == "half"
        assert policy.next_stage("half") == "full"
        assert policy.next_stage("full") is None
        assert policy.next_stage(None) is None


class TestDelaiDObservation:
    NOW = datetime(2026, 9, 25, 12, 0, 0, tzinfo=timezone.utc)

    def stamp(self, days_ago):
        return (self.NOW - timedelta(days=days_ago)).strftime("%Y-%m-%d %H:%M:%S")

    def test_le_temps_est_lu_dans_lhorodatage(self, policy):
        assert policy.days_since(self.stamp(0), now=self.NOW) == 0
        assert policy.days_since(self.stamp(7), now=self.NOW) == 7
        # L'état local est écrit en ISO UTC ; les deux formats doivent se lire.
        assert policy.days_since("2026-09-18T12:00:00Z", now=self.NOW) == 7

    def test_un_horodatage_illisible_le_dit(self, policy):
        with pytest.raises(ValueError):
            policy.days_since("hier")

    def test_la_premiere_montee_est_permise_immediatement(self, policy):
        """L'observation, c'est le palier à 10 % lui-même : rester en `p=none`
        une semaine de plus consiste simplement à ne pas lancer la commande — et
        aucune horloge n'est nécessaire pour ce premier pas."""
        assert policy.ramp_blocked_by("observe", None, now=self.NOW) is None

    def test_un_palier_observe_trop_court_bloque_la_suite(self, policy):
        blocked = policy.ramp_blocked_by("canary", self.stamp(3), now=self.NOW)

        assert blocked is not None and "3 jour(s) sur 7" in blocked and "half" in blocked

    def test_un_palier_observe_assez_long_laisse_passer(self, policy):
        assert policy.ramp_blocked_by("canary", self.stamp(7), now=self.NOW) is None
        assert policy.ramp_blocked_by("half", self.stamp(3), now=self.NOW) is None

    def test_un_palier_non_date_bloque_au_lieu_de_deviner(self, policy):
        """Sans horodatage, le délai d'observation est invérifiable : monter
        quand même reviendrait à supposer qu'on a observé."""
        blocked = policy.ramp_blocked_by("canary", None, now=self.NOW)

        assert blocked is not None and "non datée" in blocked and "rollback" in blocked

    def test_la_derniere_etape_ne_monte_plus(self, policy):
        blocked = policy.ramp_blocked_by("full", self.stamp(30), now=self.NOW)

        assert blocked is not None and "terminée" in blocked

    def test_un_record_inconnu_bloque_la_montee(self, policy):
        blocked = policy.ramp_blocked_by(None, self.stamp(0), now=self.NOW)

        assert blocked is not None and "non reconnu" in blocked


class TestHorlogeDObservation:
    """DNSHE ne date pas ses enregistrements : l'horloge vit donc dans un état
    local, et le DNS reste prioritaire s'il expose un jour un horodatage."""

    def test_letat_local_est_relu(self, policy, tmp_path):
        path = tmp_path / "state.json"

        policy.write_state("canary", "2026-09-25T12:00:00Z", path)

        assert policy.read_state(path) == {"stage": "canary", "published_at": "2026-09-25T12:00:00Z"}

    def test_un_etat_absent_ou_illisible_ne_plante_pas(self, policy, tmp_path):
        assert policy.read_state(tmp_path / "absent.json") == {}
        broken = tmp_path / "broken.json"
        broken.write_text("pas du json", encoding="utf-8")
        assert policy.read_state(broken) == {}

    def test_letat_date_letape_seulement_sil_la_decrit(self, policy):
        state = {"stage": "canary", "published_at": "2026-09-25T12:00:00Z"}

        assert policy.policy_started_at({}, state, "canary") == "2026-09-25T12:00:00Z"
        # L'étape a changé hors de l'outil : l'état ne dit plus rien d'elle.
        assert policy.policy_started_at({}, state, "half") is None

    def test_un_horodatage_dns_prime_sur_letat_local(self, policy):
        state = {"stage": "canary", "published_at": "2026-09-25T12:00:00Z"}

        assert policy.policy_started_at({"updated_at": "2026-09-01 00:00:00"}, state, "canary") == "2026-09-01 00:00:00"


class TestRetourArriere:
    def test_le_retour_arriere_revient_en_observation(self, policy):
        """Le chemin de retour est `observe` : aucun rejet possible, et `rua`
        reste en place pour continuer à recevoir les rapports."""
        assert policy.build_record("observe") == "v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com"

    def test_le_retour_arriere_est_une_vraie_baisse(self, policy):
        assert policy.parse_record(policy.build_record("observe"))["p"] == "none"
        assert policy.parse_record(policy.build_record("canary"))["p"] == "quarantine"

    def test_le_ttl_court_borne_le_retour_arriere(self, policy):
        """Le TTL est ce qui borne le temps entre la republication et le moment
        où le monde voit `p=none` : il doit rester court."""
        assert policy.FAST_TTL <= 600


class TestPropagation:
    """Juste après une écriture, un résolveur peut servir l'ancienne valeur
    pendant son TTL : le message doit dire « en cours », pas « raté »."""

    RECORD = "v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com"

    def test_un_record_deja_servi_est_annonce_comme_propage(self, policy):
        report = policy.propagation_report("_dmarc.d", self.RECORD, resolve=lambda _n: [self.RECORD])

        assert report.startswith("propagé")

    def test_un_cache_retarde_nest_pas_un_echec(self, policy):
        report = policy.propagation_report(
            "_dmarc.d", self.RECORD, resolve=lambda _n: ["v=DMARC1; p=quarantine; pct=10; rua=mailto:r@d"]
        )

        assert "en cours de propagation" in report and self.RECORD not in report

    def test_une_absence_de_reponse_est_dite_comme_telle(self, policy):
        report = policy.propagation_report("_dmarc.d", self.RECORD, resolve=lambda _n: [])

        assert "pas encore servi" in report

    def test_un_resolveur_injoignable_ne_fait_pas_echouer_la_publication(self, policy):
        """La vue DNS est un confort : la perdre doit produire une phrase, pas
        une exception qui ferait croire que l'écriture a échoué."""
        def explosion(_name):
            raise TimeoutError("timed out")

        report = policy.propagation_report("_dmarc.d", self.RECORD, resolve=explosion)

        assert "vue DNS indisponible" in report and "fait foi" in report


class TestLectureDuDnsServi:
    def test_lit_un_txt_avec_nom_compresse(self, policy):
        record = "v=DMARC1; p=quarantine; pct=10; rua=mailto:rua@dmarc.brevo.com"

        assert policy.parse_dns_txt_response(dns_packet(record)) == [record]

    def test_lit_un_txt_avec_nom_complet(self, policy):
        record = "v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com"

        assert policy.parse_dns_txt_response(dns_packet(record, compressed=False)) == [record]

    def test_une_reponse_sans_reponse_ne_rend_rien(self, policy):
        """Le cas « pas encore propagé » doit être une liste vide, pas une
        exception ni une valeur inventée."""
        packet = struct.pack(">HHHHHH", 0x4B4F, 0x8180, 1, 0, 0, 0) + DNS_NAME + struct.pack(">HH", 16, 1)

        assert policy.parse_dns_txt_response(packet) == []
