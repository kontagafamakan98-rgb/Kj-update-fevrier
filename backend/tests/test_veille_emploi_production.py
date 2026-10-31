# -*- coding: utf-8 -*-
"""Régression : la variante travailleur du compte CI et l'écriture d'une veille réelle.

POURQUOI CES PREUVES. Deux choses sont apparues le 31/10/2026, et aucune ne se
voit à l'œil nu :

  * `/metrics` publie la fraîcheur des veilles emploi depuis le 30/10, son
    lecteur quotidien est vert, et la jauge vaut **0** — « aucune veille datée,
    jamais ». La sonde juge la MÉCANIQUE de la collecte, pas son OBJET ;
  * `PUT /job-alerts` est réservé aux TRAVAILLEURS, et le seul compte que la CI
    savait provisionner était un CLIENT : la route refusait donc en 403, ce qui
    n'explique rien à qui lit un run rouge.

Ce que ces cas mesurent, dans l'ordre où le workflow les exécute :

  * le compte `--type worker` est un travailleur VÉRIFIÉ, avec deux moyens de
    paiement et une compétence — sans quoi il serait renvoyé vers
    /payment-verification, ou ne pourrait proposer sur aucune mission ;
  * la variante CLIENT est inchangée (le compte Lighthouse en dépend) ;
  * un type inconnu LÈVE au lieu de créer un client : un `--type worker` mal
    orthographié produirait sinon un compte dont le 403 n'explique rien ;
  * le script d'écriture refuse AVANT toute requête une provenance hors
    vocabulaire ou des identifiants absents — et une seule provenance hors
    vocabulaire suffit à ce que zéro requête ne parte ;
  * il juge la CHARGE rendue, pas le 200 : une veille inactive, une provenance
    réécrite par le serveur (`$setOnInsert`) ou une relecture qui dit autre
    chose sont trois refus nommés ;
  * une passe ENTIÈRE est jouée contre un serveur HTTP réel : le corps envoyé
    est bien celui que la route attend, et le jeton part en en-tête `Bearer`.

Ce que ces cas ne mesurent PAS : la production. Écrire dans la vraie base est le
geste du workflow (`workflow_dispatch`), pas d'une suite de tests — un test qui
écrirait une veille en production en créerait une par exécution, et la jauge
mesurerait la CI au lieu des visiteurs.
"""
import importlib.util
import json
import sys
import threading
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import bcrypt
import pytest

RACINE = Path(__file__).resolve().parents[2]
SCRIPT_PROVISION = RACINE / "backend" / "scripts" / "provision_ci_test_account.py"
SCRIPT_SEMENCE = RACINE / "backend" / "scripts" / "semer_alerte_emploi.py"
WORKFLOW = RACINE / ".github" / "workflows" / "veille-emploi-production.yml"

# Planchers de LECTURE : sous ces tailles, le fichier lu n'est pas celui qu'on
# croit juger (fichier vidé, chemin déplacé) et les assertions qui suivent
# seraient des preuves de rien.
PLANCHER_PROVISION = 6000
PLANCHER_SEMENCE = 8000
PLANCHER_WORKFLOW = 2000

ETAT = {
    "active": True,
    "origin": "metier",
    "category": "plumbing",
    "city": "Bamako",
    "country": "mali",
    "sent_count": 0,
    "last_notified_at": None,
}


def _charger(chemin: Path, nom: str):
    """Importe un script par chemin, comme le font les autres gardes du dépôt."""
    if nom in sys.modules:
        return sys.modules[nom]
    spec = importlib.util.spec_from_file_location(nom, chemin)
    module = importlib.util.module_from_spec(spec)
    sys.modules[nom] = module
    spec.loader.exec_module(module)
    return module


provision = _charger(SCRIPT_PROVISION, "provision_ci_test_account")
semence = _charger(SCRIPT_SEMENCE, "semer_alerte_emploi")

TEXTE_WORKFLOW = WORKFLOW.read_text(encoding="utf-8")
TEXTE_PROVISION = SCRIPT_PROVISION.read_text(encoding="utf-8")


class _Faux:
    """Un serveur scripté : enregistre les appels, rend les réponses données."""

    def __init__(self, reponses=(), erreur=None):
        self.appels = []
        self.reponses = list(reponses)
        self.erreur = erreur

    def __call__(self, base, methode, chemin, corps=None, *, token="", timeout=20):
        self.appels.append({"methode": methode, "chemin": chemin, "corps": corps, "token": token})
        if self.erreur is not None:
            raise self.erreur
        if not self.reponses:
            raise AssertionError("appel inattendu : %s %s" % (methode, chemin))
        return self.reponses.pop(0)

    def methode(self, nom):
        return [appel for appel in self.appels if appel["methode"] == nom]


def _login_ok(type_compte="worker"):
    return (200, {"access_token": "jeton-test", "user": {"user_type": type_compte}})


def _veille(**changements):
    charge = dict(ETAT)
    charge.update(changements)
    return (200, charge)


def _ecrire(faux, **options):
    """Une passe du script, avec les trois appels attendus par défaut."""
    options.setdefault("email", "ci-worker@kojo.sn")
    options.setdefault("mot_de_passe", "secret-de-test")
    return semence.verifier(http=faux, **options)


class TestLeCompteTravailleurCI:
    """La variante demandée par `PUT /job-alerts` — et rien de plus."""

    def test_le_travailleur_est_verifie_et_utilisable(self):
        doc = provision.build_verified_worker_doc("ci-worker@kojo.sn", "secret-de-test")

        assert doc["user_type"] == "worker"
        assert doc["is_verified"] is True and doc["email_verified"] is True
        # Deux moyens de paiement : le minimum exigé d'un travailleur
        # (`required_minimum: 2`). En dessous, la page mesurée serait
        # /payment-verification, pas la page voulue.
        assert doc["payment_accounts_count"] == len(doc["payment_accounts"]) == 2
        # Un travailleur sans compétence ne peut proposer sur aucune mission.
        assert doc["skills"], "les compétences ne peuvent pas être vides"
        # Aucun historique inventé sur la fiche publique.
        assert doc["bio"] is None and doc["rating"] == 0.0 and doc["total_reviews"] == 0
        assert bcrypt.checkpw(
            "secret-de-test".encode("utf-8"), doc["password_hash"].encode("utf-8")
        ), "le login doit accepter le mot de passe inséré"

    def test_la_variante_client_est_inchangee(self):
        """Le compte Lighthouse dépend de l'ancien comportement, mot pour mot."""
        doc = provision.build_verified_client_doc("ci@kojo.sn", "secret-de-test")

        assert doc["user_type"] == "client"
        assert doc["payment_accounts_count"] == 1
        assert doc["skills"] == [] and doc["bio"] is None
        assert doc["last_name"] == "Lighthouse"

    def test_le_type_par_defaut_reste_client(self):
        """Sans `--type`, la provision reste celle que la CI connaît."""
        assert provision.build_verified_doc("client", "a@kojo.sn", "secret")["user_type"] == "client"

    def test_un_type_inconnu_leve_au_lieu_de_devenir_un_client(self):
        with pytest.raises(ValueError) as refus:
            provision.build_verified_doc("workers", "a@kojo.sn", "secret")

        assert "worker" in str(refus.value), "le refus doit nommer la valeur attendue"

    def test_la_rotation_ne_fait_pas_redescendre_un_travailleur_en_client(self):
        """Le `$set` de la mise à jour reprend le rôle : sinon un 403 imprévisible."""
        assert '"user_type": doc["user_type"]' in TEXTE_PROVISION
        assert '"payment_accounts_count": doc["payment_accounts_count"]' in TEXTE_PROVISION


class TestLEcritureEnProduction:
    """Ce que le script juge — et ce qu'il refuse avant d'envoyer quoi que ce soit."""

    def test_une_provenance_hors_vocabulaire_ne_produit_aucune_requete(self, capsys):
        faux = _Faux([_login_ok()])

        code = _ecrire(faux, origine="villes")

        assert code == 1
        assert faux.appels == [], "le refus doit tomber AVANT la première requête"
        sortie = capsys.readouterr().out
        assert "HORS VOCABULAIRE" in sortie
        # La liste est citée : un refus muet obligerait à lire le module.
        for origine in semence.ORIGINES:
            assert origine in sortie

    def test_sans_identifiants_le_refus_nomme_les_secrets(self, capsys, monkeypatch):
        monkeypatch.delenv(semence.NOM_EMAIL, raising=False)
        monkeypatch.delenv(semence.NOM_MOT_DE_PASSE, raising=False)
        faux = _Faux([_login_ok()])

        code = semence.verifier(http=faux, email="", mot_de_passe="")

        assert code == 1
        assert faux.appels == []
        sortie = capsys.readouterr().out
        assert semence.NOM_EMAIL in sortie and semence.NOM_MOT_DE_PASSE in sortie

    def test_la_passe_complete_ecrit_puis_relit(self):
        faux = _Faux([_login_ok(), _veille(), _veille()])

        code = _ecrire(faux, origine="metier", categorie="plumbing", ville="Bamako")

        assert code == 0
        assert [appel["methode"] for appel in faux.appels] == ["POST", "PUT", "GET"]
        # Le jeton ne part Avec la connexion, mais partout ailleurs.
        assert faux.appels[0]["token"] == ""
        assert faux.appels[1]["token"] == faux.appels[2]["token"] == "jeton-test"
        corps = faux.appels[1]["corps"]
        assert corps == {
            "category": "plumbing",
            "city": "Bamako",
            "country": "mali",
            "active": True,
            "origin": "metier",
        }

    def test_un_403_nomme_le_type_de_compte_et_le_remede(self, capsys):
        """Le défaut du 31/10 : la veille est réservée aux travailleurs."""
        faux = _Faux([
            _login_ok("client"),
            (403, {"detail": "Les alertes emploi sont réservées aux travailleurs"}),
        ])

        code = _ecrire(faux)

        assert code == 1
        sortie = capsys.readouterr().out
        assert "--type worker" in sortie
        assert "client" in sortie, "le rôle réellement connecté doit être dit"

    def test_un_200_sans_veille_active_est_un_refus(self, capsys):
        faux = _Faux([_login_ok(), _veille(active=False)])

        code = _ecrire(faux)

        assert code == 1
        assert "SANS VEILLE ACTIVE" in capsys.readouterr().out

    def test_une_provenance_reecrite_par_le_serveur_est_un_refus(self, capsys):
        """`$setOnInsert` : une autre provenance veut dire que la veille existait."""
        faux = _Faux([_login_ok(), _veille(origin="directe")])

        code = _ecrire(faux, origine="metier")

        assert code == 1
        sortie = capsys.readouterr().out
        assert "PROVENANCE" in sortie and "setOnInsert" in sortie

    def test_une_relecture_qui_diverge_est_un_refus(self, capsys):
        """Le 200 du PUT ne suffit pas : c'est le GET qui prouve l'écriture."""
        faux = _Faux([_login_ok(), _veille(), _veille(city="Abidjan")])

        code = _ecrire(faux, ville="Bamako")

        assert code == 1
        assert "NE SE RELIT PAS" in capsys.readouterr().out

    def test_un_transport_mort_est_une_premisse(self, capsys):
        faux = _Faux(erreur=semence.Premisse("API injoignable (URLerror: timeout)"))

        code = _ecrire(faux)

        assert code == 2, "un transport injoignable n'est ni un vert ni un refus du code"
        assert "PREMISSE" in capsys.readouterr().out

    def test_une_base_inutilisable_est_une_premisse(self):
        faux = _Faux([_login_ok()])

        assert _ecrire(faux, base="ftp://exemple") == 2
        assert faux.appels == []

    def test_les_provenances_sont_celles_du_serveur(self):
        """La copie ne peut pas dériver : elle est comparée à la déclaration."""
        from kojo_job_alerts import ORIGINES_ALERTE

        assert semence.ORIGINES == ORIGINES_ALERTE


class TestLaPasseReelle:
    """Une passe ENTIÈRE sur un serveur HTTP réel : le corps part comme prévu."""

    def test_le_script_parle_a_un_vrai_serveur(self):
        recus = []

        class Serveur(BaseHTTPRequestHandler):
            def log_message(self, *args):  # silence : un test ne parle pas
                pass

            def _rendre(self, charge, statut=200):
                corps = json.dumps(charge).encode("utf-8")
                self.send_response(statut)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(corps)))
                self.end_headers()
                self.wfile.write(corps)

            def _lire(self):
                longueur = int(self.headers.get("Content-Length") or 0)
                brut = self.rfile.read(longueur).decode("utf-8")
                return json.loads(brut) if brut else None

            def do_POST(self):
                recus.append(("POST", self.path, self.headers.get("Authorization"), self._lire()))
                self._rendre({"access_token": "jeton-reel", "user": {"user_type": "worker"}})

            def do_PUT(self):
                corps = self._lire()
                document = dict(ETAT)
                document.update(corps or {})
                recus.append(("PUT", self.path, self.headers.get("Authorization"), corps))
                self._rendre(document)

            def do_GET(self):
                recus.append(("GET", self.path, self.headers.get("Authorization"), None))
                self._rendre(dict(ETAT))

        serveur = ThreadingHTTPServer(("127.0.0.1", 0), Serveur)
        fil = threading.Thread(target=serveur.serve_forever, daemon=True)
        fil.start()
        try:
            base = "http://127.0.0.1:%d" % serveur.server_address[1]
            code = semence.verifier(
                base=base,
                email="ci-worker@kojo.sn",
                mot_de_passe="secret-de-test",
                categorie="plumbing",
                ville="Bamako",
                pays="mali",
                origine="metier",
                timeout=10,
            )
        finally:
            serveur.shutdown()
            serveur.server_close()
            fil.join(timeout=5)

        assert code == 0, "la passe doit être conforme contre un serveur qui répond juste"
        assert [appel[0] for appel in recus] == ["POST", "PUT", "GET"]
        assert recus[0][1] == "/api/auth/login"
        assert recus[1][1] == recus[2][1] == "/api/job-alerts"
        # Le jeton part en en-tête `Bearer` sur les DEUX appels authentifiés —
        # en clair dans l'URL, il finirait dans les journaux d'accès.
        assert recus[1][2] == recus[2][2] == "Bearer jeton-reel"
        assert recus[1][3]["origin"] == "metier"
        assert recus[1][3]["active"] is True


class TestLeWorkflow:
    """Ce que le workflow de production doit être — et ce qu'il ne doit pas."""

    def test_les_fichiers_lus_sont_ceux_qu_on_croit_juger(self):
        assert len(TEXTE_WORKFLOW) > PLANCHER_WORKFLOW
        assert len(TEXTE_PROVISION) > PLANCHER_PROVISION
        assert len(SCRIPT_SEMENCE.read_text(encoding="utf-8")) > PLANCHER_SEMENCE

    def test_il_est_dispatchable_et_pas_planifie(self):
        """Un cron ferait mesurer la fraîcheur de la CI au lieu des visiteurs."""
        assert "workflow_dispatch:" in TEXTE_WORKFLOW
        assert "schedule:" not in TEXTE_WORKFLOW

    def test_il_provisionne_en_travailleur_avant_d_ecrire(self):
        creation = TEXTE_WORKFLOW.index("provision_ci_test_account.py")
        ecriture = TEXTE_WORKFLOW.index("semer_alerte_emploi.py")

        assert creation < ecriture, "écrire avant de créer le compte ne peut pas marcher"
        assert "--type worker" in TEXTE_WORKFLOW, "un client recevrait un 403"

    def test_il_nomme_les_secrets_et_refuse_sans_eux(self):
        for secret in ("MONGO_URL", "VEILLE_EMPLOI_EMAIL", "VEILLE_EMPLOI_PASSWORD"):
            assert "secrets.%s" % secret in TEXTE_WORKFLOW
            assert "gh secret set" in TEXTE_WORKFLOW

    def test_les_entrees_passent_par_l_environnement(self):
        """Une saisie libre ne doit pas pouvoir être lue comme du shell."""
        for entree in ("categorie", "ville", "pays", "origine"):
            assert "${{ inputs.%s }}" % entree in TEXTE_WORKFLOW
        assert '--categorie "$CATEGORIE"' in TEXTE_WORKFLOW

    def test_il_ne_demande_que_la_lecture_du_depot(self):
        assert "permissions:" in TEXTE_WORKFLOW
        assert "contents: read" in TEXTE_WORKFLOW
