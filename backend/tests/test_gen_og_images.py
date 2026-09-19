# -*- coding: utf-8 -*-
"""Régression : les REFUS du générateur de cartes Open Graph
(frontend/scripts/gen-og-images.py).

Ces refus sont ce qui empêche une carte d'annoncer autre chose que sa page : la
carte DESSINE le titre et la description de sa route, résolus dans
src/i18n/fr.json. Deux règles rendent ce fichier durablement utile : chaque cas est
un refus, ou l'invariant qui le rend tenable ; et aucun fait que le GÉNÉRATEUR
possède — champs exigés, police, colonne, lignes réservées — n'y est recopié, aucune
assertion ne portant sur la FORMULATION d'un message (elle nomme le coupable pris
dans son entrée : fichier, champ, clé i18n, route, mot).

Le module est chargé par son CHEMIN et son `CARDS_DIR` redirigé vers un dossier
temporaire : aucun fichier du dépôt n'est écrit, et rien ne dépend d'une police
installée ni d'une image produite. La capacité de ce fichier à échouer est mesurée
par .github/scripts/check-og-test-mutations.py.
"""
import importlib.util
import json
import shutil
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
GENERATOR_PATH = REPO_ROOT / "frontend" / "scripts" / "gen-og-images.py"
DICTIONARY_PATH = REPO_ROOT / "frontend" / "src" / "i18n" / "fr.json"


def _load_generator():
    spec = importlib.util.spec_from_file_location("gen_og_images", GENERATOR_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Le module exercé, chargé une fois : la liste des champs exigés doit être connue à
# la COLLECTE (voir le parametrize plus bas), donc pas par une fixture.
GENERATOR = _load_generator()

# Une carte complète : la route servie, les clés i18n des textes de cette page, et
# ses deux sorties. Chacun de ces cinq noms attend une VALEUR (un chemin, une clé, un
# fichier) qu'aucun test ne peut inventer ; ce qui compte est le mode d'échec, et il
# est bruyant — un sixième champ exigé fait rougir deux cas, mesuré.
CARD = {
    "route": "/jobs",
    "title": "jobsMetaTitle",
    "description": "jobsMetaDescription",
    "wide": "og-jobs.png",
    "square": "og-jobs-square.png",
}


def _scratch():
    return GENERATOR.ImageDraw.Draw(GENERATOR.Image.new("RGB", (8, 8)))


def _title_font():
    """La police que la wide réserve à son titre, telle que LAYOUTS la déclare."""
    return GENERATOR.fonts_for("wide")["title"]


@pytest.fixture(scope="module")
def dictionary():
    with open(DICTIONARY_PATH, encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture
def cards_dir(tmp_path, monkeypatch):
    """Écrit CES cartes-là dans un dossier temporaire et y branche le générateur :
    `CARDS_DIR` est le seul chemin par lequel il les découvre."""

    def _fill(cards):
        directory = tmp_path / "og-cards"
        if directory.exists():
            shutil.rmtree(directory)  # chaque appel part d'un état neuf
        directory.mkdir()
        for name, card in cards.items():
            with open(directory / name, "w", encoding="utf-8") as handle:
                json.dump(card, handle, ensure_ascii=False)
        monkeypatch.setattr(GENERATOR, "CARDS_DIR", str(directory))
        return directory

    return _fill


class TestDeuxCartesPourUneRoute:
    def test_refuse_la_seconde_et_n_ecrit_rien(self, cards_dir, tmp_path):
        """Le refus tombe à la LECTURE des cartes, donc avant le premier PNG : rien
        n'est écrit à moitié. Ce n'est pas un refus de tout — deux routes distinctes
        restent acceptées."""
        cards_dir(
            {
                "premiere.json": CARD,
                "seconde.json": {**CARD, "wide": "autre.png", "square": "autre-square.png"},
            }
        )
        out_dir = tmp_path / "public"
        manifest = tmp_path / "og-assets.manifest.json"

        with pytest.raises(SystemExit) as failure:
            GENERATOR.main(out_dir=str(out_dir), manifest_path=str(manifest))

        message = str(failure.value)
        assert "premiere.json" in message and "seconde.json" in message
        assert list(out_dir.rglob("*")) == [] and not manifest.exists()

        cards_dir(
            {
                "jobs.json": CARD,
                "login.json": {**CARD, "route": "/login", "wide": "b.png", "square": "b-square.png"},
            }
        )
        assert [card["route"] for card in GENERATOR.load_cards()] == ["/jobs", "/login"]


class TestChampDeCarteManquant:
    @pytest.mark.parametrize("missing", GENERATOR.REQUIRED_CARD_KEYS)
    def test_nomme_le_fichier_et_le_champ_manquant(self, cards_dir, missing):
        """Un cas par champ EXIGÉ, lu sur le générateur : un sixième champ ajouté
        là-bas est couvert ici sans toucher à ce fichier."""
        cards_dir({"jobs.json": {key: value for key, value in CARD.items() if key != missing}})

        with pytest.raises(SystemExit) as failure:
            GENERATOR.load_cards()

        message = str(failure.value)
        assert "jobs.json" in message and missing in message

    def test_un_champ_blanc_compte_comme_manquant(self, cards_dir):
        """«   » ne nomme aucune route, aucune clé, aucun PNG."""
        cards_dir({"jobs.json": {**CARD, "description": "   "}})

        with pytest.raises(SystemExit) as failure:
            GENERATOR.load_cards()

        message = str(failure.value)
        assert "jobs.json" in message and "description" in message

    def test_une_carte_incomplete_est_nommee_pas_sautee(self, cards_dir):
        """Les cartes valides du dossier ne font pas oublier la fautive : la sauter
        sortirait une page du périmètre sans que rien ne le dise."""
        cards_dir({"valide.json": CARD, "cassee.json": {**CARD, "route": ""}})

        with pytest.raises(SystemExit) as failure:
            GENERATOR.load_cards()

        assert "cassee.json" in str(failure.value)

    def test_refuse_une_route_qui_nest_pas_un_chemin_absolu(self, cards_dir):
        """La route est la clé de la table route → carte, et le garde CI la compare à
        des chemins absolus : « jobs » n'y désignerait aucune page."""
        cards_dir({"carte.json": {**CARD, "route": "jobs"}})

        with pytest.raises(SystemExit) as failure:
            GENERATOR.load_cards()

        message = str(failure.value)
        assert "carte.json" in message and "jobs" in message

    def test_refuse_un_dossier_sans_aucune_carte(self, cards_dir):
        """Zéro carte est une erreur, jamais un succès : un générateur qui ne dessine
        rien laisserait croire que tout est à jour."""
        cards_dir({})

        with pytest.raises(SystemExit):
            GENERATOR.load_cards()


class TestTexteDeLaPage:
    @pytest.mark.parametrize(
        "value",
        [None, "", "   ", {"texte": "objet"}, ["titre"]],
        ids=["absente", "vide", "blanche", "objet", "liste"],
    )
    def test_refuse_une_cle_de_texte_absente_vide_ou_non_textuelle(self, value):
        """La carte dessine le texte DE SA PAGE : une clé que le dictionnaire ne porte
        pas doit refuser la génération, pas produire une carte muette."""
        sample = {"jobsMetaDescription": "Trouvez un travailleur qualifié près de chez vous."}
        if value is not None:
            sample["jobsMetaTitle"] = value

        with pytest.raises(SystemExit) as failure:
            GENERATOR.page_texts({"source": "og-cards/jobs.json", **CARD}, sample)

        assert "jobsMetaTitle" in str(failure.value)

    def test_refuse_la_description_et_rend_les_textes_du_dictionnaire(self, dictionary):
        """Une description absente publierait une carte à qui il manque sa phrase de
        partage. Et quand la clé existe, le texte vient du dictionnaire sans
        transformation — ce qui autorise le garde CI à comparer le manifeste à
        fr.json."""
        card = {"source": "og-cards/jobs.json", **CARD}

        with pytest.raises(SystemExit) as failure:
            GENERATOR.page_texts(card, {"jobsMetaTitle": "Emplois disponibles — Kojo"})

        assert "jobsMetaDescription" in str(failure.value)
        assert GENERATOR.page_texts(card, dictionary) == {
            "title": dictionary[CARD["title"]],
            "description": dictionary[CARD["description"]],
        }


class TestTexteQueLaCarteNePeutPasPorter:
    """Un texte tronqué annoncerait MOINS que sa page : le générateur refuse de
    dessiner ce qu'il ne peut pas porter ENTIER. Les textes des deux refus sont
    absurdes (80 « A », 400 mots) pour que le verdict ne dépende pas de la police
    trouvée sur la machine — la mesure change, le refus non."""

    def test_refuse_un_mot_plus_large_que_la_colonne(self):
        with pytest.raises(SystemExit) as failure:
            GENERATOR.wrap_text(_scratch(), "A" * 80, _title_font(), 200, 3, "probe")

        assert "A" * 80 in str(failure.value)

    def test_refuse_un_texte_plus_long_que_la_carte(self):
        """Et le repli ne change pas le texte : rejointes par une espace, les lignes
        d'un texte qui tient redonnent ce texte — sinon une carte pourrait annoncer
        autre chose que sa page en restant « conforme ». Le titre d'une page doit
        tenir dans la colonne et les lignes que LAYOUTS lui réservent."""
        with pytest.raises(SystemExit):
            GENERATOR.wrap_text(_scratch(), "mot " * 400, _title_font(), 200, 3, "probe")

        text = "Trouvez un travailleur qualifié près de chez vous."
        lines = GENERATOR.wrap_text(
            _scratch(),
            text,
            _title_font(),
            GENERATOR.measure_width("wide"),
            GENERATOR.LAYOUTS["wide"]["title"]["max_lines"],
            "probe",
        )

        assert " ".join(lines) == text


class TestMiseEnPageEtCarte:
    @pytest.mark.parametrize("render,kind", [("render_wide", "wide"), ("render_square", "square")])
    def test_les_lignes_reservees_tiennent_dans_la_carte(self, render, kind):
        """L'invariant qui donne son sens au filet ci-dessous : ce que LAYOUTS réserve
        au titre et à la description tient dans la carte."""
        reserved = GENERATOR.LAYOUTS[kind]

        getattr(GENERATOR, render)(
            reserved["title"]["max_lines"] * ["ligne"],
            reserved["description"]["max_lines"] * ["ligne"],
        )

    @pytest.mark.parametrize("render,kind", [("render_wide", "wide"), ("render_square", "square")])
    def test_refuse_un_bloc_plus_haut_que_la_carte(self, render, kind):
        """Filet derrière les lignes réservées, et pour la CONSTANTE : un bloc quatre
        fois plus haut que réservé est refusé plutôt que dessiné par-dessus le logo et
        le bord. Aucune carte réelle ne l'atteint."""
        reserved = GENERATOR.LAYOUTS[kind]

        with pytest.raises(SystemExit):
            getattr(GENERATOR, render)(
                reserved["title"]["max_lines"] * 4 * ["ligne"],
                reserved["description"]["max_lines"] * 4 * ["ligne"],
            )
