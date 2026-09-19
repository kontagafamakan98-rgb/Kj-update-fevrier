# -*- coding: utf-8 -*-
"""Preuve que le garde des durées publiées sait échouer, et que le code n'a qu'un
propriétaire pour ces durées.

Ce que ce fichier EST, et ce qu'il n'est pas :

  * l'étape du job `backend-tests` (`.github/workflows/ci.yml`) est le SEUL
    exécutant du garde sur le DÉPÔT RÉEL — c'est là que le verdict `[OK]` et les
    `::error` sont publiés, donc là qu'un relecteur de PR les lit ;
  * ce fichier ne rejoue donc pas le garde sur les fichiers réels (ce serait la
    même preuve payée deux fois : la règle du 19/09 sur les preuves à double
    exécutant). Il éprouve ce que l'étape ne peut pas montrer — qu'un écart
    quelconque est REFUSÉ et NOMMÉ — en lançant le garde réel sur des COPIES
    mutées hors du dépôt, et il vérifie le câblage de l'étape.

Un garde dont on n'a jamais vu le rouge ne prouve rien : les cas ci-dessous
existent pour que « la politique et le code s'accordent » soit une mesure, pas
une croyance.
"""
import os
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND = REPO_ROOT / "backend"
GUARD = REPO_ROOT / ".github" / "scripts" / "check-privacy-policy.py"
DOC_NAME = "PRIVACY.md"
MODULE_RELATIF = Path("backend") / "kojo_retention.py"
COMMAND = "python .github/scripts/check-privacy-policy.py"
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "ci.yml"

DEBUT = "<!-- CONSERVATION:DEBUT -->"
FIN = "<!-- CONSERVATION:FIN -->"


def _lancer(racine: Path, *arguments: str):
    """Lance le garde RÉEL (CLI, code de retour, sortie) sur une racine donnée.

    `PYTHONPATH` porte le backend réel : la copie ne fournit que le module de
    conservation, celui qu'on mute — ses dépendances (`kojo_settings`, les
    validateurs d'environnement) restent celles du dépôt, donc ce n'est pas une
    réimplémentation qui serait testée ici.
    """
    environnement = dict(os.environ)
    environnement["PYTHONPATH"] = str(BACKEND)
    environnement["PYTHONDONTWRITEBYTECODE"] = "1"
    resultat = subprocess.run(
        [sys.executable, str(GUARD), "--repo-root", str(racine), *arguments],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        env=environnement, cwd=str(REPO_ROOT), stdin=subprocess.DEVNULL,
    )
    return resultat.returncode, (resultat.stdout or "") + (resultat.stderr or "")


def _remplacer(texte: str, avant: str, apres: str) -> str:
    """Mutation qui ÉCHOUE si elle n'a rien fait : une chaîne périmée ferait
    autrement un test vert qui n'éprouve plus rien."""
    assert texte.count(avant) == 1, f"mutation non applicable : {avant!r}"
    return texte.replace(avant, apres)


class CopieDuDepot:
    """Une racine temporaire : le document réel et une COPIE du module réel."""

    def __init__(self, tmp_path: Path):
        self.racine = tmp_path / "copie"
        (self.racine / "backend").mkdir(parents=True)
        self.document = self.racine / DOC_NAME
        self.module = self.racine / MODULE_RELATIF
        self.document.write_text(
            (REPO_ROOT / DOC_NAME).read_text(encoding="utf-8"), encoding="utf-8"
        )
        shutil.copy2(BACKEND / "kojo_retention.py", self.module)

    def texte_document(self) -> str:
        return self.document.read_text(encoding="utf-8")

    def ecrire_document(self, texte: str) -> None:
        self.document.write_text(texte, encoding="utf-8")

    def texte_module(self) -> str:
        # `open(..., newline="")` et non `Path.read_text(newline=…)` : ce mot-clé
        # n'existe qu'à partir de Python 3.13, et la CI tourne en 3.11.
        with open(self.module, "r", encoding="utf-8", newline="") as flux:
            return flux.read()

    def ecrire_module(self, texte: str) -> None:
        # newline="" : un aller-retour en mode texte convertit LF en CRLF sous
        # Windows, ce qui changerait le fichier sans changer une ligne de code.
        with open(self.module, "w", encoding="utf-8", newline="") as flux:
            flux.write(texte)


@pytest.fixture
def copie(tmp_path):
    return CopieDuDepot(tmp_path)


class TestRefus:
    """Chaque écart concevable : le garde doit rendre 1 ET nommer le coupable."""

    def test_la_copie_intacte_est_verte(self, copie):
        """L'état de référence. Sans lui, aucun rouge ci-dessous ne serait
        concluant : une copie cassée rougirait sous n'importe quelle mutation."""
        code, sortie = _lancer(copie.racine)

        assert code == 0, sortie
        assert "notifications=90 jours" in sortie

    def test_une_duree_changee_dans_le_code_est_refusee(self, copie):
        """Le cœur du garde : le code applique 30 jours, le document publie 90.
        La cause exacte doit être nommée (collection + colonne), sinon un
        relecteur doit recouper le tableau lui-même."""
        copie.ecrire_module(_remplacer(
            copie.texte_module(),
            "timedelta(days=NOTIFICATION_RETENTION_DAYS)",
            "timedelta(days=30)",
        ))

        code, sortie = _lancer(copie.racine)

        assert code == 1, sortie
        assert "notifications" in sortie
        assert "30 jours" in sortie and "90 jours" in sortie

    def test_une_ligne_retiree_du_document_est_refusee(self, copie):
        """Une donnée purgée que la politique ne nomme plus est exactement ce
        qu'un document de conformité ne doit pas pouvoir faire en silence."""
        lignes = [
            ligne for ligne in copie.texte_document().splitlines()
            if "`payments`" not in ligne
        ]
        copie.ecrire_document("\n".join(lignes) + "\n")

        code, sortie = _lancer(copie.racine)

        assert code == 1, sortie
        assert "payments" in sortie and "ABSENTE" in sortie
        assert "48 heures" in sortie

    def test_une_cellule_editee_a_la_main_est_refusee(self, copie):
        """Le chiffre modifié dans le document SEUL : le garde doit dire laquelle
        des deux sources il croit (le code) et ce que le document prétend."""
        copie.ecrire_document(_remplacer(
            copie.texte_document(), "| 48 heures |", "| 2 heures |"
        ))

        code, sortie = _lancer(copie.racine)

        assert code == 1, sortie
        assert "payments" in sortie
        assert "Durée de conservation" in sortie
        assert "2 heures" in sortie

    def test_une_collection_ajoutee_au_code_sans_ligne_est_refusee(self, copie):
        """Une règle neuve (une collection purgée) que le document ignore : le
        garde doit refuser, pas tolérer une publication incomplète."""
        regle = textwrap.dedent('''
            RegleDeConservation(
                collection="kojo_nouvelle_collection",
                ttl_field="expires_at",
                lifetime=timedelta(days=7),
                porte_par="EXEMPLE_RETENTION_DAYS",
                portee="une donnee que la politique ignore encore",
            ),
        ''')
        copie.ecrire_module(_remplacer(
            copie.texte_module(), "\n)\n\n\ndef regle_de(", f"{regle})\n\n\ndef regle_de("
        ))

        code, sortie = _lancer(copie.racine)

        assert code == 1, sortie
        assert "kojo_nouvelle_collection" in sortie and "ABSENTE" in sortie

    def test_une_ligne_que_le_code_ne_porte_pas_est_refusee(self, copie):
        """Le sens inverse : une ligne publiée alors qu'aucune règle ne la
        décrit. Soit le document invente, soit une règle a été retirée — dans
        les deux cas la politique annonce quelque chose que rien n'applique."""
        # `reviews` est choisie parce qu'AUCUNE règle ne la décrit : une ligne
        # pour une collection déjà gouvernée serait un écart de cellule, pas
        # une ligne inconnue (le test ne prouverait plus le même refus).
        ligne = (
            "| `reviews` | `created_at` | 5 ans | `EXEMPLE` | aucun | tout |"
        )
        copie.ecrire_document(
            copie.texte_document().replace(FIN, ligne + "\n" + FIN)
        )

        code, sortie = _lancer(copie.racine)

        assert code == 1, sortie
        assert "reviews" in sortie and "INCONNUE" in sortie

    def test_des_marqueurs_absents_sont_une_erreur(self, copie):
        """Sans délimitation, le bloc n'est plus vérifiable : le garde doit
        échouer plutôt que de considérer l'absence comme un accord."""
        copie.ecrire_document(
            copie.texte_document().replace(DEBUT, "").replace(FIN, "")
        )

        code, sortie = _lancer(copie.racine)

        assert code == 1, sortie
        assert "marqueurs" in sortie

    def test_un_module_absent_est_une_erreur(self, copie):
        """Un garde qui ne peut pas conclure ÉCHOUE : l'absence du module ne
        doit pas être lue comme « rien à signaler »."""
        copie.module.unlink()

        code, sortie = _lancer(copie.racine)

        assert code == 1, sortie
        assert "introuvable" in sortie

    def test_ecrire_regenere_le_bloc_et_redonne_un_garde_vert(self, copie):
        """`--write` est le geste de correction annoncé par le message d'échec :
        s'il ne réparait pas, l'échec serait un cul-de-sac."""
        copie.ecrire_document(_remplacer(
            copie.texte_document(), "| 48 heures |", "| 2 heures |"
        ))

        code_ecriture, sortie_ecriture = _lancer(copie.racine, "--write")
        code_verification, sortie_verification = _lancer(copie.racine)

        assert code_ecriture == 0, sortie_ecriture
        assert code_verification == 0, sortie_verification
        assert "| 48 heures |" in copie.texte_document()


class TestUnSeulProprietaire:
    """Les durées vivent à un seul endroit, et c'est vérifiable dans le code."""

    def test_kojo_core_ne_ecrit_plus_aucun_expire_after_seconds(self):
        """L'index TTL ET la durée viennent des règles : si un
        `expireAfterSeconds` littéral revenait dans kojo_core, il y aurait de
        nouveau deux endroits à tenir d'accord, et ce garde ne le verrait pas.

        Les lignes de commentaire sont écartées : elles CITENT le mot pour dire
        qu'il a disparu, ce qui n'est pas l'écrire."""
        source = (BACKEND / "kojo_core.py").read_text(encoding="utf-8")
        code = "\n".join(
            ligne for ligne in source.splitlines()
            if not ligne.strip().startswith("#")
        )

        assert "expireAfterSeconds" not in code
        assert "for regle in RETENTION_RULES" in code

    @pytest.mark.asyncio
    async def test_chaque_regle_cree_son_index_et_rien_d_autre(self, monkeypatch):
        """Le pont entre le tableau publié et la base : ce que PRIVACY.md annonce
        est ce que `create_database_indexes` pose réellement. Une règle sans
        index publierait une durée sans effet ; un index sans règle purgerait
        sans être publié."""
        import kojo_core
        from kojo_retention import RETENTION_RULES

        appels = []

        class CurseurFactice:
            """Le backfill géo de `create_database_indexes` parcourt
            `db.jobs.find(...)` : un curseur vide rend ce pas inerte sans
            exiger de lui qu'il échoue (un échec resterait dans un `except`
            silencieux, donc invisible ici)."""

            def limit(self, _nombre):
                return self

            def __aiter__(self):
                return self

            async def __anext__(self):
                raise StopAsyncIteration

        class CollectionFactice:
            def __init__(self, nom):
                self.nom = nom

            def find(self, *_args, **_kwargs):
                return CurseurFactice()

            async def create_index(self, champ, **options):
                appels.append((self.nom, champ, options))

        class BaseFactice:
            # Les deux accès coexistent dans kojo_core : `db.users` (attribut)
            # pour la plupart des index, `db[regle.collection]` (indice) pour le
            # bloc de conservation.
            def __getattr__(self, nom):
                return CollectionFactice(nom)

            def __getitem__(self, nom):
                return CollectionFactice(nom)

        async def disponible():
            return True

        monkeypatch.setattr(kojo_core, "db", BaseFactice())
        monkeypatch.setattr(kojo_core, "is_database_available", disponible)

        await kojo_core.create_database_indexes()

        index_ttl = [appel for appel in appels if "expireAfterSeconds" in appel[2]]
        attendus = {
            (regle.collection, regle.ttl_field): regle.expire_after_seconds
            for regle in RETENTION_RULES
        }
        obtenus = {(nom, champ): options["expireAfterSeconds"]
                   for nom, champ, options in index_ttl}

        assert obtenus == attendus, (
            "les index TTL ne sont plus ceux des règles : publier une durée "
            "n'aurait alors aucun effet sur la base"
        )
        # Le filtre partiel (paiements `pending`) doit survivre au passage : sans
        # lui, l'index purgerait des paiements complétés — donc des pièces
        # comptables, et la politique dirait le contraire.
        filters = {nom: options.get("partialFilterExpression")
                   for nom, _, options in index_ttl}
        assert filters["payments"] == {
            "status": "pending", "expires_at": {"$exists": True}
        }, (
            "le filtre partiel a disparu de l'index `payments` : il purgerait "
            "alors des paiements complétés, donc des pièces comptables — et la "
            "politique publie le contraire"
        )
        assert filters["email_otps"] is None, (
            "l'index `email_otps` ne doit porter aucun filtre : la politique "
            "annonce que TOUTE la collection est purgée"
        )

    def test_les_mots_des_durees_sont_calcules_pas_recopies(self):
        """Le document ne peut pas annoncer « 90 jours » après un passage à 30 :
        l'unité et le chiffre viennent de la valeur, et l'unité du symbole qui la
        porte est préférée pour que le document se lise contre le code."""
        from datetime import timedelta

        from kojo_retention import formater_duree, unite_du_symbole

        assert formater_duree(timedelta(days=90)) == "90 jours"
        assert formater_duree(timedelta(days=1)) == "1 jour"
        assert formater_duree(
            timedelta(hours=48), unite_du_symbole("PAYMENT_PENDING_EXPIRY_HOURS")
        ) == "48 heures"
        assert formater_duree(
            timedelta(minutes=10), unite_du_symbole("EMAIL_OTP_EXPIRY_MINUTES")
        ) == "10 minutes"
        assert unite_du_symbole("JWT_EXPIRATION_HOURS") == "heure"
        assert unite_du_symbole("SANS_SUFFIXE_CONNU") is None

    def test_le_document_ne_recopie_aucune_duree_hors_du_bloc_genere(self):
        """La prose du document n'a pas de garde : une durée qui y est répétée
        est un chiffre que personne ne relira. On refuse donc qu'une valeur
        engendrée apparaisse ailleurs que dans le bloc."""
        import kojo_retention

        texte = (REPO_ROOT / DOC_NAME).read_text(encoding="utf-8")
        debut, fin = texte.find(DEBUT), texte.find(FIN)
        assert debut != -1 and fin != -1, "les marqueurs ont disparu du document"
        prose = texte[:debut] + texte[fin + len(FIN):]

        recopiees = [
            formate
            for regle in kojo_retention.RETENTION_RULES
            for formate in (
                kojo_retention.formater_duree(regle.lifetime),
                kojo_retention.formater_duree(
                    regle.lifetime,
                    kojo_retention.unite_du_symbole(regle.porte_par),
                ),
            )
            if formate in prose
        ]

        assert recopiees == [], (
            f"durée(s) recopiée(s) dans la prose du document : {sorted(set(recopiees))}"
        )


class TestCablage:
    def test_le_seul_executeur_est_l_etape_du_job_backend(self):
        """La preuve est payée une fois par push, ici et nulle part ailleurs : le
        garde importe `kojo_retention`, donc `kojo_settings` — le job doit avoir
        installé `backend/requirements.txt`."""
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

        assert workflow.count(COMMAND) == 1, (
            "un second exécutant paierait deux fois la même preuve"
        )
        job = workflow.split("  backend-tests:", 1)[1].split("\n  frontend-build:", 1)[0]
        assert COMMAND in job, "le garde doit tourner là où le backend est installé"
        assert "-r requirements.txt" in job
