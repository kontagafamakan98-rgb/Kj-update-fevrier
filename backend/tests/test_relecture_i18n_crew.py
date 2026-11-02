# -*- coding: utf-8 -*-
"""L'outil de relecture native propose, refuse, et n'écrit rien (02/11/2026).

`outils/relecture-i18n/` fait relire les 14 dictionnaires de page (473 clés ×
3 langues) par une équipe CrewAI. Ce fichier tient les trois choses qu'un
rapport de relecture pourrait casser en silence :

  * les REFUS mécaniques : une proposition qui perd un placeholder, change un
    chiffre, vide une valeur ou recopie le français est refusée et publiée dans
    `refusees.json` — jamais appliquée « parce que le modèle l'a dit » ;
  * la SÉPARATION : l'outil n'écrit pas dans `frontend/src`, et `crewai` n'entre
    ni dans l'image de l'API ni dans ses imports de module — une relecture ne
    doit pas doubler la taille d'une machine Fly ;
  * la LECTURE des déclarations existantes : les exceptions sont lues dans
    `i18nLangue.test.js`, la numérotation des doutes continue celle du fichier
    de revue. Aucune de ces deux listes n'est recopiée.

Ces cas tournent SANS crewai, sans jeton et sans réseau : seule la couche
déterministe est jugée ici, et c'est voulu — le modèle, lui, ne se teste pas par
assertion.
"""
import ast
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
OUTIL = REPO / "outils" / "relecture-i18n"
MODULE = OUTIL / "relecture.py"


def _charger(nom, chemin):
    spec = importlib.util.spec_from_file_location(nom, chemin)
    module = importlib.util.module_from_spec(spec)
    sys.modules[nom] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def rl():
    return _charger("relecture_i18n_outil", MODULE)


# --------------------------------------------------------------------------
# La séparation : ni crewai dans l'API, ni import au chargement
# --------------------------------------------------------------------------

class TestSeparation:
    def test_le_module_ne_charge_pas_crewai(self, rl):
        assert "crewai" not in sys.modules, (
            "l'outil a chargé crewai à l'import : `--verifier` doit tourner "
            "sans la dépendance"
        )

    def test_aucun_import_lourd_au_niveau_du_module(self):
        arbre = ast.parse(MODULE.read_text(encoding="utf-8"))
        lourds = set()
        for noeud in arbre.body:
            if isinstance(noeud, ast.Import):
                lourds.update(alias.name.split(".")[0] for alias in noeud.names)
            elif isinstance(noeud, ast.ImportFrom) and noeud.module:
                lourds.add(noeud.module.split(".")[0])
        assert not (lourds & {"crewai", "pydantic"}), (
            f"import de module lourd en tête de fichier : {sorted(lourds)} — "
            "crewai et pydantic doivent rester paresseux"
        )

    def test_crewai_n_entre_pas_dans_l_image_de_l_api(self):
        exigences = (REPO / "backend" / "requirements.txt").read_text(encoding="utf-8")
        assert "crewai" not in exigences.lower(), (
            "crewai dans backend/requirements.txt : chromadb, lancedb et "
            "opentelemetry partiraient sur la machine Fly de l'API"
        )
        assert "crewai" not in (REPO / "backend" / "server.py").read_text(encoding="utf-8")

    def test_la_dependance_est_pincee_dans_son_propre_fichier(self):
        exigences = (OUTIL / "requirements.txt").read_text(encoding="utf-8")
        assert "crewai==1.15.33" in exigences


# --------------------------------------------------------------------------
# Le validateur : ce qui casse une page est refusé
# --------------------------------------------------------------------------

class TestValidateur:
    @pytest.mark.parametrize(
        "avant, apres, fr, attendu",
        [
            (
                "Dalal ak jàmm {firstName} ! Sa konto sos nañu ko",
                "Dalal ak jàmm ! Sa kont sos nañu ko",
                "Bienvenue {firstName} ! Votre compte est créé",
                "placeholder perdu : {firstName}",
            ),
            (
                "Code bi ñu yónnee ko ci {email}",
                "",
                "Code envoyé à {email}",
                "valeur vide",
            ),
            (
                "Code bi ñu yónnee ko ci {email}",
                "Code bi ñu yónnee ko ci {email} ak {autre}",
                "Code envoyé à {email}",
                "placeholder inventé : {autre}",
            ),
            (
                "Komision 14 % ci boppam",
                "Komision 20 % ci boppam",
                "Commission 14 % automatique",
                "chiffres modifiés : 14 → 20",
            ),
            (
                "Dëgg naa ne moom bii du dellu",
                "Dëgg naa ne moom bii n' du dellu",
                "J'ai compris que cette suppression ne revient pas",
                "apostrophe droite",
            ),
            (
                "Adresse email bii jëfandikoo nañu ko",
                "Cette adresse email est déjà utilisée",
                "Cette adresse email est déjà utilisée",
                "recopie du français",
            ),
            (
                "Baara kelen bɛ i ka ɲinini kan",
                "Baara kelen bɛ i ka ɲinini kan",
                "1 mission trouvée",
                "identique à la valeur actuelle",
            ),
        ],
    )
    def test_ce_qui_casse_une_page_est_refuse(self, rl, avant, apres, fr, attendu):
        refus = rl.valider_proposition(avant, apres, fr)
        assert any(attendu in motif for motif in refus), (
            f"« {attendu} » attendu, obtenu : {refus}"
        )

    def test_une_reecriture_juste_passe(self, rl):
        avant = "Dashboard - komision propriétaire"
        apres = "Tablo - komision boroom bi"
        fr = "Tableau de bord - commission propriétaire"
        assert rl.valider_proposition(avant, apres, fr) == []


# --------------------------------------------------------------------------
# Les indices : ce qui ordonne, et ce qui n'est pas une faute
# --------------------------------------------------------------------------

class TestIndices:
    def test_le_francais_reste_passe_devant(self, rl):
        assert rl.indices("Tableau de bord - commissionw", "Tableau de bord - commissions") != []

    def test_un_gabarit_neutre_n_est_pas_une_copie_du_francais(self, rl):
        assert rl.indices("{min} - {max} XOF", "{min} - {max} XOF") == []

    def test_la_negation_wolof_n_est_pas_du_francais(self, rl):
        valeur = "Dëgg naa ne moom bii du dellu"
        assert rl.indices(valeur, "J'ai compris que cette suppression ne revient pas") == []
        assert any("pièges" in note for note in rl.note_pour_agent(valeur))

    def test_un_emprunt_est_note_mais_pas_compte_comme_indice(self, rl):
        valeur = "Profil liggéeykat"
        indices = rl.indices(valeur, "Profil travailleur")
        assert not any("français" in indice for indice in indices)
        assert any("profil" in note for note in rl.note_pour_agent(valeur))

    def test_une_valeur_plus_courte_n_est_pas_une_anomalie(self, rl):
        assert rl.indices("Bɔli ma kɛ.", "La suppression a échoué") == []

    def test_un_allongement_est_signale(self, rl):
        long = "Baara kelen bɛ i ka ɲinini kan " * 3
        assert any(
            "longueur" in indice
            for indice in rl.indices(long, "1 mission trouvée dans votre ville")
        )


# --------------------------------------------------------------------------
# Les déclarations sont LUES, pas recopiées
# --------------------------------------------------------------------------

class TestDeclarations:
    def test_les_exceptions_viennent_du_test_de_langue(self, rl):
        exceptions = rl.lire_exceptions()
        assert {"mali", "kojo", "wave"} <= exceptions, (
            "les exceptions de `i18nLangue.test.js` n'ont pas été lues"
        )
        assert len(exceptions) >= 10

    def test_la_numerotation_des_doutes_continue(self, rl, tmp_path):
        revue = tmp_path / "revue.md"
        revue.write_text("1. premier doute\n2. second doute\n", encoding="utf-8")
        assert rl.numero_doute_suivant(revue) == 3

    def test_la_numerotation_sur_le_fichier_reel_suit_la_derniere(self, rl):
        assert rl.numero_doute_suivant() >= 37


# --------------------------------------------------------------------------
# La sortie : un lot borné, et rien dans frontend/src
# --------------------------------------------------------------------------

def _lot_exemple(rl):
    return [
        rl.Valeur(
            fichier="emailVerification",
            cle="welcomeToast",
            langue="wo",
            fr="Bienvenue {firstName} ! Votre compte est créé",
            en="Welcome {firstName} ! Your account is created",
            valeur="Dalal ak jàmm {firstName} ! Sa konto sos nañu ko",
        ),
        rl.Valeur(
            fichier="emailVerification",
            cle="sentTo",
            langue="wo",
            fr="Code envoyé à {email}",
            en="Code sent to {email}",
            valeur="Code bi ñu yónnee ko ci {email}",
        ),
        rl.Valeur(
            fichier="photoTest",
            cle="title",
            langue="bm",
            fr="Test des photos de profil",
            en="Profile photo test",
            valeur="Profil foto test",
        ),
    ]


class TestSortie:
    def test_le_lot_est_borne_et_priorise(self, rl):
        valeurs = _lot_exemple(rl)
        valeurs.append(
            rl.Valeur(
                fichier="commissionDashboard",
                cle="title",
                langue="wo",
                fr="Tableau de bord - commission propriétaire",
                en="Dashboard - owner commission",
                valeur="Dashboard - komision propriétaire",
            )
        )
        premier = rl.choisir_lot(valeurs, langues=("wo",), max_par_langue=1)
        second = rl.choisir_lot(valeurs, langues=("wo",), max_par_langue=1)
        assert premier == second, "le lot doit être reproductible"
        assert [v.cle for v in premier] == ["title"], (
            "la valeur qui porte un indice doit passer devant celles qui n'en ont aucun"
        )

    def test_le_plafond_est_par_langue(self, rl):
        lot = rl.choisir_lot(_lot_exemple(rl), langues=("wo", "bm"), max_par_langue=1)
        assert sorted(v.langue for v in lot) == ["bm", "wo"]

    def test_aucun_fichier_de_frontend_n_est_touche(self, rl, tmp_path):
        dictionnaires = rl.DICTIONNAIRES
        avant = {
            chemin.name: chemin.stat().st_mtime_ns
            for chemin in sorted(dictionnaires.glob("*.js"))
        }
        lot = _lot_exemple(rl)
        rl.ecrire_sortie(
            tmp_path,
            lot,
            [
                {
                    "fichier": "emailVerification",
                    "cle": "welcomeToast",
                    "langue": "wo",
                    "texte": "Dalal ak jàmm {firstName} ! Sa kont sos nañu ko",
                    "motif": "vocabulaire du fichier",
                    "confiance": "moyenne",
                },
                {
                    "fichier": "photoTest",
                    "cle": "title",
                    "langue": "bm",
                    "texte": "",
                    "motif": "refus attendu",
                    "confiance": "basse",
                },
            ],
            [{"langue": "wo", "cle": "emailVerification.welcomeToast", "question": "kont ou konto ?"}],
            {"genere_le": "2026-11-02T00:00:00+00:00", "modele": "modele-de-test",
             "caracteres": 10, "appels": 3},
        )
        apres = {
            chemin.name: chemin.stat().st_mtime_ns
            for chemin in sorted(dictionnaires.glob("*.js"))
        }
        assert avant == apres, "l'outil a écrit dans frontend/src"

        ecrits = sorted(chemin.name for chemin in tmp_path.iterdir())
        assert ecrits == ["differences.json", "doutes.md", "rapport.md", "refusees.json"]

        differences = json.loads((tmp_path / "differences.json").read_text(encoding="utf-8"))
        refusees = json.loads((tmp_path / "refusees.json").read_text(encoding="utf-8"))
        assert differences["compte"]["validees"] == 1
        assert differences["compte"]["refusees"] == 1
        assert refusees["refusees"][0]["refus"] == ["valeur vide"]


# --------------------------------------------------------------------------
# La preuve à blanc et l'extraction réelle
# --------------------------------------------------------------------------

class TestPreuveABlanc:
    def test_les_cas_du_faux_gateway_sont_refuses(self, rl):
        faux = _charger("faux_gateway_outil", OUTIL / "faux_gateway.py")
        avant = {
            "welcomeToast": "Dalal ak jàmm {firstName} ! Sa konto sos nañu ko",
            "sentTo": "Code bi ñu yónnee ko ci {email}",
            "resendIn": "Code bu bees ci {time}",
        }
        par_cle = {proposition["cle"]: proposition for proposition in faux.REPONSE["propositions"]}

        assert rl.valider_proposition(
            avant["welcomeToast"], par_cle["welcomeToast"]["texte"], "Bienvenue {firstName} !"
        ) == []
        assert any(
            "placeholder perdu" in motif
            for motif in rl.valider_proposition(avant["sentTo"], par_cle["sentTo"]["texte"], "Code envoyé à {email}")
        )
        assert "valeur vide" in rl.valider_proposition(
            avant["resendIn"], par_cle["resendIn"]["texte"], "Nouveau code dans {time}"
        )

    @pytest.mark.skipif(shutil.which("node") is None, reason="node absent : extraction impossible")
    def test_l_extraction_lit_les_vrais_modules(self, rl):
        export = rl.exporter()
        assert export["compte"]["fichiers"] == 14
        assert export["compte"]["valeurs"] == export["compte"]["cles"] * 3
        assert export["compte"]["cles"] >= 400, (
            f"473 clés mesurées le 02/11/2026, {export['compte']['cles']} lues"
        )
        assert set(export["langues"]) == {"wo", "bm", "mos"}
        assert all(valeur["valeur"].strip() for valeur in export["valeurs"])
