# -*- coding: utf-8 -*-
"""La politique de confidentialité nomme-t-elle les prestataires que le code appelle ?

Un sous-traitant non déclaré est un trou que personne ne voit : le service
transmet des données à un tiers, et le document qui dit ce qui est traité se
tait. Ce fichier tient les deux moitiés de la liste :

  * chaque prestataire que le CODE appelle (prouvé par une trace dans
    `backend/`) doit être nommé dans la section « Sous-traitants » de
    PRIVACY.md — sinon la politique est incomplète ;
  * les prestataires d'INFRASTRUCTURE (hébergement de la base, du serveur, du
    site), qui ne s'appellent pas depuis une ligne de code, sont déclarés avec
    la preuve de leur existence (`fly.toml`, `vercel.json`) pour que leur
    absence du dépôt se voie aussi.

La même liste est publiée par la page /privacy (`privacyProcessorsBody`, cinq
langues) : la comparer au document évite qu'une correction faite d'un côté
laisse l'autre annoncer une liste périmée — l'écart exact que ce garde existe
pour supprimer.
"""
import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND = REPO_ROOT / "backend"
DOC = REPO_ROOT / "PRIVACY.md"
I18N = REPO_ROOT / "frontend" / "src" / "i18n"
SECTIONS_JS = REPO_ROOT / "frontend" / "src" / "config" / "page-sections.js"
LANGUES = ("fr", "en", "wo", "bm", "mos")

# Ce qui PROUVE l'usage d'un prestataire dans le code, et non ce qu'on croit
# savoir : une trace littérale (domaine, variable) et le module où elle vit.
# Une preuve qui disparaît du code fait échouer ce test — c'est ainsi que le
# garde reste vrai après un changement de fournisseur.
FOURNISSEURS = (
    # (nom publié, trace dans le code, fichiers qui la portent)
    ("Neon", "NEON_AI_GATEWAY_BASE_URL", ("kojo_ai_gateway.py", "kojo_settings.py")),
    ("Resend", "api.resend.com", ("kojo_email.py",)),
    ("Brevo", "api.brevo.com", ("kojo_email.py",)),
    ("Gmail", "gmail.googleapis.com", ("kojo_email.py",)),
    ("PayDunya", "app.paydunya.com", ("kojo_payments.py",)),
    ("Cloudinary", "api.cloudinary.com", ("kojo_settings.py",)),
    ("Google", "oauth2.googleapis.com", ("kojo_routers_auth.py",)),
    ("Sentry", "SENTRY_DSN", ("server.py",)),
)

# Les prestataires qu'aucune ligne de code n'appelle : leur usage est un
# hébergement. La preuve est le fichier de configuration qui le déploie.
INFRASTRUCTURE = (
    ("MongoDB Atlas", "backend/kojo_db.py"),
    ("Fly.io", "backend/fly.toml"),
    ("Vercel", "frontend/vercel.json"),
)

NOMS = tuple(nom for nom, _, _ in FOURNISSEURS) + tuple(nom for nom, _ in INFRASTRUCTURE)


def _section_sous_traitants(texte: str) -> str:
    """Le texte de la section, borné par le titre suivant.

    Vide si le titre a disparu : l'appelant doit alors refuser TOUS les noms,
    jamais conclure « rien à vérifier ».
    """
    lignes = texte.splitlines()
    debut = next(
        (
            index + 1
            for index, ligne in enumerate(lignes)
            if ligne.startswith("## ") and "sous-traitant" in ligne.lower()
        ),
        None,
    )
    if debut is None:
        return ""
    fin = next(
        (index for index in range(debut, len(lignes)) if lignes[index].startswith("## ")),
        len(lignes),
    )
    return "\n".join(lignes[debut:fin])


def _manquants(section: str, noms) -> list:
    """Les noms qui ne sont pas nommés dans la section (casse indifférente)."""
    texte = section.lower()
    return [nom for nom in noms if nom.lower() not in texte]


def _trace_presente(trace: str) -> bool:
    return any(trace in fichier.read_text(encoding="utf-8")
               for fichier in sorted(BACKEND.glob("*.py")))


@pytest.fixture(scope="module")
def section() -> str:
    return _section_sous_traitants(DOC.read_text(encoding="utf-8"))


class TestLaPolitiqueNommeLesPrestataires:
    def test_la_section_existe(self, section):
        assert section.strip(), (
            "PRIVACY.md n'a plus de section « Sous-traitants » : le garde ne "
            "peut rien vérifier, donc il refuse"
        )

    @pytest.mark.parametrize("nom, trace, fichiers", FOURNISSEURS)
    def test_chaque_prestataire_appele_est_declare(self, section, nom, trace, fichiers):
        assert _trace_presente(trace), (
            f"preuve périmée pour {nom} : « {trace} » ne vit plus dans backend/*.py — "
            f"mettre à jour FOURNISSEURS (le prestataire a peut-être changé)"
        )
        for nom_fichier in fichiers:
            assert (BACKEND / nom_fichier).is_file(), (
                f"{nom} : le fichier de preuve {nom_fichier} a disparu"
            )
        assert nom in section, (
            f"{nom} est appelé par le code et absent de la section « Sous-traitants » "
            f"de PRIVACY.md : la politique tairait un destinataire des données"
        )

    @pytest.mark.parametrize("nom, preuve", INFRASTRUCTURE)
    def test_l_infrastructure_est_nommee(self, section, nom, preuve):
        assert (REPO_ROOT / preuve).is_file(), (
            f"preuve périmée pour {nom} : {preuve} n'existe plus"
        )
        assert nom in section, (
            f"{nom} héberge le service mais n'est pas nommé dans la politique"
        )


class TestLeGardeSaitRefuser:
    def test_un_prestataire_appele_mais_non_nomme_est_refuse(self, section):
        """La preuve par la négative : la même extraction, avec un nom absent,
        doit le rendre — sinon le test ci-dessus passerait en n'examinant
        rien."""
        assert _manquants(section, NOMS) == []

        absent = "Stripe"
        assert _manquants(section, NOMS + (absent,)) == [absent]

    def test_une_section_absente_ne_conclut_pas(self):
        """Un document tronqué ne doit pas valider la liste : la section vide
        rend TOUS les noms manquants."""
        assert _section_sous_traitants("# Autre document\n\nRien ici.\n") == ""
        assert _manquants("", NOMS) == list(NOMS)

    def test_la_section_s_arrete_au_titre_suivant(self, section):
        """Une liste qui déborderait sur les sections suivantes rendrait le
        contrôle complaisant (un nom cité ailleurs suffirait)."""
        assert "## " not in section


class TestLaPagePubliquePublieLaMemeListe:
    def test_la_page_declare_une_section_sous_traitants(self):
        declaration = SECTIONS_JS.read_text(encoding="utf-8")

        assert "privacyProcessorsTitle" in declaration
        assert "privacyProcessorsBody" in declaration

    @pytest.mark.parametrize("langue", LANGUES)
    def test_chaque_langue_porte_la_section(self, langue):
        dictionnaire = json.loads((I18N / f"{langue}.json").read_text(encoding="utf-8"))

        assert dictionnaire.get("privacyProcessorsTitle", "").strip()
        assert dictionnaire.get("privacyProcessorsBody", "").strip()

    @pytest.mark.parametrize("langue", LANGUES)
    def test_la_page_nomme_les_memes_prestataires(self, langue):
        """Une marque est un nom propre : les cinq langues doivent la citer,
        sinon la moitié des visiteurs lit une liste incomplète."""
        corps = json.loads((I18N / f"{langue}.json").read_text(encoding="utf-8"))[
            "privacyProcessorsBody"
        ]

        assert _manquants(corps, NOMS) == [], (
            f"{langue} : la page /privacy ne cite pas {_manquants(corps, NOMS)}"
        )
