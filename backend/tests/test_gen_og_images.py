# -*- coding: utf-8 -*-
"""Régression : les REFUS du générateur de cartes Open Graph
(frontend/scripts/gen-og-images.py).

Ce qui est verrouillé ici, c'est ce qui empêche une carte d'annoncer autre chose
que sa page. La carte DESSINE le titre et la description de sa route, résolus
dans src/i18n/fr.json ; si le générateur acceptait une donnée incohérente, il
écrirait un PNG que personne ne pourrait reproduire, et le garde CI
(frontend/scripts/check-og-assets.js) comparerait des lignes consignées dans le
manifeste à un dictionnaire qui ne les explique plus.

Deux fichiers mentionnaient déjà ce script (check-og-assets.test.js,
check-og-images.test.js) sans jamais l'exécuter : ils n'en lisaient que le nom.
Un refus perdu y serait donc passé vert — or c'est exactement ce refus qui tient
l'égalité carte ↔ page.

Cinq familles sont exercées, toutes VÉRIFIABLES SANS POLICE DE RÉFÉRENCE ET SANS
IMAGE PRODUITE — c'est le point : la CI n'a ni Arial ni les PNG committés, alors
que ces invariants décident de ce que les cartes disent :

1. deux fichiers de carte pour la MÊME route (la seconde serait perdue sans bruit) ;
2. un champ de carte manquant ou vide, une route qui n'est pas un chemin absolu,
   un dossier sans aucune carte (zéro carte est une erreur, pas un succès) ;
3. une clé i18n absente, vide ou d'un autre type que du texte ;
4. un texte que la carte ne peut pas porter : mot seul plus large que la colonne,
   ou plus de lignes que la mise en page n'en réserve — tronquer serait annoncer
   MOINS que la page sans que rien ne le dise ;
5. un bloc de texte plus haut que la carte elle-même.

La quatrième famille s'éprouve avec des textes ABSURDES (80 « A », 400 mots) :
la mesure change avec la police trouvée sur la machine, le refus non.

Le module est chargé par son CHEMIN (scripts/ n'est pas un paquet) et son dossier
de cartes est redirigé vers un dossier temporaire : aucun fichier du dépôt n'est
écrit. Les faits que le GÉNÉRATEUR possède — les champs qu'une carte doit
déclarer, la police du titre — sont LUS sur le module et jamais recopiés ici :
une liste écrite de mémoire deviendrait fausse le jour où le générateur exige un
champ de plus, et c'est précisément le silence que cette passe existe pour
supprimer.
"""
import importlib.util
import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
GENERATOR_PATH = REPO_ROOT / "frontend" / "scripts" / "gen-og-images.py"
# La langue des coquilles pré-rendues : c'est d'elle que la carte tire le texte
# de sa page, donc celui que lit un crawler sans JavaScript.
DICTIONARY_PATH = REPO_ROOT / "frontend" / "src" / "i18n" / "fr.json"


def _load_generator():
    spec = importlib.util.spec_from_file_location("gen_og_images", GENERATOR_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Le module exercé, chargé une seule fois : la liste des champs exigés doit être
# connue à la COLLECTE (voir `parametrize` ci-dessous), donc pas par une fixture.
GENERATOR = _load_generator()

# Une carte complète, servie par la page /jobs : la route, les clés i18n du titre
# et de la description de cette page, et ses deux sorties.
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
    """La police que la wide réserve à son titre, telle que `LAYOUTS` la déclare
    — jamais une taille recopiée ici, qui cesserait de suivre la mise en page."""
    return GENERATOR.fonts_for("wide")["title"]


@pytest.fixture(scope="module")
def dictionary():
    """Le dictionnaire français, tel que le générateur le lit."""
    with open(DICTIONARY_PATH, encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture
def cards_dir(tmp_path, monkeypatch):
    """Écrit des fichiers de carte dans un dossier temporaire et y branche le
    générateur. `CARDS_DIR` est le seul chemin par lequel il découvre les cartes :
    le rediriger suffit à éprouver la découverte sans approcher le dépôt."""

    def _fill(cards):
        directory = tmp_path / "og-cards"
        directory.mkdir(parents=True, exist_ok=True)
        for name, card in cards.items():
            with open(directory / name, "w", encoding="utf-8") as handle:
                json.dump(card, handle, ensure_ascii=False)
        monkeypatch.setattr(GENERATOR, "CARDS_DIR", str(directory))
        return directory

    return _fill


class TestDeuxCartesPourUneRoute:
    def test_refuse_la_seconde_en_nommant_les_deux_fichiers(self, cards_dir):
        """Sans ce refus, la seconde carte disparaîtrait du manifeste sans bruit :
        un fichier de données ajouté que rien ne dessinerait, et une page dont la
        carte est en réalité un autre visuel."""
        cards_dir(
            {
                "premiere.json": CARD,
                "seconde.json": {**CARD, "wide": "autre.png", "square": "autre-square.png"},
            }
        )

        with pytest.raises(SystemExit) as failure:
            GENERATOR.load_cards()

        message = str(failure.value)
        assert "premiere.json" in message and "seconde.json" in message
        assert CARD["route"] in message

    def test_deux_routes_differentes_sont_acceptees(self, cards_dir):
        """Non-vacuité : le refus ci-dessus ne doit pas être un refus de tout."""
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
        incomplete = {key: value for key, value in CARD.items() if key != missing}
        cards_dir({"jobs.json": incomplete})

        with pytest.raises(SystemExit) as failure:
            GENERATOR.load_cards()

        message = str(failure.value)
        assert "jobs.json" in message and missing in message

    def test_un_champ_blanc_compte_comme_manquant(self, cards_dir):
        """`"  "` ne nomme aucune route, aucune clé, aucun PNG : la carte serait
        dessinée avec du néant, donc elle est refusée comme un champ absent."""
        cards_dir({"jobs.json": {**CARD, "description": "   "}})

        with pytest.raises(SystemExit) as failure:
            GENERATOR.load_cards()

        assert "jobs.json" in str(failure.value) and "description" in str(failure.value)

    def test_une_carte_incomplete_est_nommee_pas_sautee(self, cards_dir):
        """Les autres cartes du dossier ne doivent pas faire oublier la fautive :
        la sauter sortirait une page du périmètre sans que rien ne le dise."""
        cards_dir({"valide.json": CARD, "cassee.json": {**CARD, "route": ""}})

        with pytest.raises(SystemExit) as failure:
            GENERATOR.load_cards()

        assert "cassee.json" in str(failure.value)

    def test_refuse_une_route_qui_nest_pas_un_chemin_absolu(self, cards_dir):
        """La route est la clé de la table route → carte, et le garde CI la
        compare à des chemins qui commencent par « / » : « jobs » n'y désignerait
        aucune page."""
        cards_dir({"jobs.json": {**CARD, "route": "jobs"}})

        with pytest.raises(SystemExit) as failure:
            GENERATOR.load_cards()

        message = str(failure.value)
        assert "jobs.json" in message and "« jobs »" in message

    def test_refuse_un_dossier_sans_aucune_carte(self, cards_dir):
        """Zéro carte est une erreur, jamais un succès : un générateur qui ne
        dessine rien laisserait croire que tout est à jour."""
        cards_dir({})

        with pytest.raises(SystemExit):
            GENERATOR.load_cards()


class TestTexteDeLaPage:
    """La carte dessine le texte DE SA PAGE : une clé que le dictionnaire ne
    porte pas doit refuser la génération, pas produire une carte muette."""

    @pytest.mark.parametrize(
        "value",
        [None, "", "   ", {"texte": "objet"}, ["titre"]],
        ids=["absente", "vide", "blanche", "objet", "liste"],
    )
    def test_refuse_une_cle_absente_vide_ou_non_textuelle(self, value):
        sample = {"jobsMetaDescription": "Trouvez un travailleur qualifié près de chez vous."}
        if value is not None:
            sample["jobsMetaTitle"] = value

        with pytest.raises(SystemExit) as failure:
            GENERATOR.page_texts({"source": "og-cards/jobs.json", **CARD}, sample)

        assert "jobsMetaTitle" in str(failure.value)

    def test_refuse_la_description_tout_autant_que_le_titre(self):
        """Les deux champs passent par la même vérification : une description
        absente publierait une carte à qui il manque sa phrase de partage."""
        sample = {"jobsMetaTitle": "Emplois disponibles — Kojo"}

        with pytest.raises(SystemExit) as failure:
            GENERATOR.page_texts({"source": "og-cards/jobs.json", **CARD}, sample)

        assert "jobsMetaDescription" in str(failure.value)

    def test_rend_exactement_les_textes_du_dictionnaire(self, dictionary):
        """Non-vacuité, et l'invariant qui rend le garde CI possible : c'est le
        dictionnaire qui fait le texte, sans transformation — le manifeste peut
        donc consigner des lignes que le garde recompose et compare à fr.json."""
        card = {"source": "og-cards/jobs.json", **CARD}

        assert GENERATOR.page_texts(card, dictionary) == {
            "title": dictionary[CARD["title"]],
            "description": dictionary[CARD["description"]],
        }


class TestTexteQueLaCarteNePeutPasPorter:
    """Un texte tronqué annoncerait MOINS que sa page sans que rien ne le dise :
    le générateur refuse donc de dessiner ce qu'il ne peut pas porter ENTIER.

    Les textes sont choisis absurdes pour que le verdict ne dépende pas de la
    police trouvée sur la machine : sur un runner sans Arial, la police de repli
    mesure autrement, mais pas au point de faire tenir 80 « A » dans 200 px ni
    400 mots en 3 lignes."""

    def test_refuse_un_mot_plus_large_que_la_colonne(self):
        with pytest.raises(SystemExit) as failure:
            GENERATOR.wrap_text(_scratch(), "A" * 80, _title_font(), 200, 3, "probe")

        message = str(failure.value)
        assert "A" * 80 in message and "200" in message

    def test_refuse_un_texte_qui_demande_plus_de_lignes_que_prevu(self):
        with pytest.raises(SystemExit) as failure:
            GENERATOR.wrap_text(_scratch(), "mot " * 400, _title_font(), 200, 3, "probe")

        assert "3 disponibles" in str(failure.value)

    def test_un_texte_qui_tient_rend_des_lignes_qui_le_reconstituent(self):
        """L'invariant qui rend l'égalité du garde CI possible : le retour à la
        ligne ne change pas le texte, il ne fait que le plier. Rejointes par une
        espace, les lignes doivent redonner le texte publié par la page — sinon une
        carte annoncerait autre chose que sa page en restant « conforme »."""
        text = "Trouvez un travailleur qualifié près de chez vous."

        lines = GENERATOR.wrap_text(_scratch(), text, _title_font(), 4000, 3, "probe")

        assert " ".join(lines) == text

    @pytest.mark.parametrize(
        "render,format_annonce",
        [("render_wide", "carte wide"), ("render_square", "carte carrée")],
    )
    def test_refuse_un_bloc_plus_haut_que_la_carte(self, render, format_annonce):
        """Second FILET, qu'aucune carte n'atteint : le maximum de lignes que
        `LAYOUTS` réserve (3 au titre, 4 à la description) tient dans la carte —
        340 px sur 550 pour la wide, 380 sur 670 pour la carrée. Ces deux cas
        restent donc pour la CONSTANTE : ils rougissent si la mise en page
        s'élargit sans que la carte grandisse, pas pour un texte réel."""
        lines = ["ligne"] * 40

        with pytest.raises(SystemExit) as failure:
            getattr(GENERATOR, render)(lines, lines)

        assert format_annonce in str(failure.value)


class TestRienNEstDessineQuandLaDonneeEstRefusee:
    def test_main_refuse_avant_d_ecrire_le_moindre_png(self, cards_dir, tmp_path):
        """Le refus doit tomber à la LECTURE des données : un dossier de sortie à
        moitié rempli — une carte écrite, l'autre refusée — serait l'état que le
        manifeste ne saurait plus décrire."""
        cards_dir(
            {
                "premiere.json": CARD,
                "seconde.json": {**CARD, "wide": "autre.png", "square": "autre-square.png"},
            }
        )
        out_dir = tmp_path / "public"
        manifest = tmp_path / "og-assets.manifest.json"

        with pytest.raises(SystemExit):
            GENERATOR.main(out_dir=str(out_dir), manifest_path=str(manifest))

        assert list(out_dir.rglob("*")) == []
        assert not manifest.exists()
