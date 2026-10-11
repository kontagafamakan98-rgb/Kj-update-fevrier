"""L'équilibre des balises du HTML que sert le BACKEND (kojo_balises.py).

Ce que ces tests mesurent, et ce qu'ils ne font PAS :

  1. PARITÉ — la règle Python rend, cas par cas, EXACTEMENT ce que la règle
     JavaScript du frontend rend (frontend/vite-plugins/prerender/balises.js) :
     mêmes problèmes, mêmes lignes, mêmes extraits, mêmes phrases. Le jeu de cas
     est un fichier partagé, produit par la règle JS ; deux implémentations sans
     jeu commun finissent par diverger sur un cas limite sans que personne le voie.
  2. LE REFUS — un document déséquilibré lève, et la phrase NOMME la balise.
  3. LES PAGES RÉELLES — la fiche mission et sa 404 sont équilibrées, y compris
     pour des titres et des descriptions hostiles (balises, guillemets, émojis).
     Le refus est prouvé sur une page réellement cassée, pas seulement sur une
     chaîne fabriquée pour l'occasion.
  4. LE CÂBLAGE — la route répond 500 (et journalise la balise) quand la page
     qu'elle s'apprête à servir est déséquilibrée.
  5. L'INVENTAIRE — chaque module qui écrit du HTML est déclaré ici. Un nouveau
     producteur fait rougir ce test jusqu'à ce qu'il soit ajouté, donc il ne peut
     pas être servi sans que son équilibre soit vérifié.

Ce qui n'est PAS mesuré ici : le navigateur (il répare le HTML — c'est
précisément pourquoi cette règle existe) et la conformité HTML complète.
"""

import json
import re
from pathlib import Path

import pytest
from fastapi import HTTPException

import kojo_routers_public
from kojo_balises import (
    DesequilibreHtml,
    decrire_desequilibre,
    desequilibres_des_balises,
    exiger_balises_equilibrees,
)
from kojo_job_og import job_og_html, job_og_html_404

BACKEND = Path(__file__).resolve().parent.parent
CAS = json.loads(
    (Path(__file__).parent / "fixtures" / "balises_equilibre_cas.json").read_text(encoding="utf-8")
)
BASE = "https://kojoforafrica.cc.cd"


def test_le_jeu_de_cas_couvre_chaque_type_de_defaut():
    # Un jeu de cas vide ou amputé donnerait une parité verte sans rien comparer.
    assert len(CAS) >= 20
    types = {p["type"] for cas in CAS for p in cas["attendu"]}
    assert types == {"non-fermee", "fermee-en-portee", "fermee-sans-ouverture", "non-terminee"}


@pytest.mark.parametrize("cas", CAS, ids=[c["nom"] for c in CAS])
def test_parite_avec_la_regle_javascript(cas):
    problemes = desequilibres_des_balises(cas["html"])
    assert problemes == cas["attendu"]
    assert [decrire_desequilibre(p) for p in problemes] == cas["messages"]


def test_le_refus_nomme_la_balise_qui_ne_se_referme_pas():
    html = "<section>\n<div>\nx\n</section>"
    with pytest.raises(DesequilibreHtml) as erreur:
        exiger_balises_equilibrees("la fiche de test", html, origine="test")
    message = str(erreur.value)
    assert "`<div>` ouvert ligne 2 est refermé en PORTÉE par `</section>` ligne 4" in message
    assert message.startswith("test : la fiche de test est DÉSÉQUILIBRÉ")


def test_un_document_equilibre_est_rendu_tel_quel():
    html = "<!DOCTYPE html><html><body><div><p>ok</p></div></body></html>"
    assert exiger_balises_equilibrees("la page", html) == html


@pytest.mark.parametrize(
    "titre",
    [
        "Plombier",
        "</div><div>injection",
        "A <b> & \"x\" 'y'",
        "\U0001F600" * 60,
    ],
)
def test_la_fiche_mission_est_equilibree_pour_des_titres_hostiles(titre):
    job = {"id": "job-1", "title": titre, "description": "</section> dans la description " * 12}
    assert desequilibres_des_balises(job_og_html(job, BASE)) == []


def test_la_page_404_est_equilibree():
    assert desequilibres_des_balises(job_og_html_404()) == []


def test_un_gabarit_casse_est_refuse_en_nommant_la_div_non_fermee():
    # La page RÉELLE, dont on retire la fermeture du conteneur : c'est le défaut
    # qu'aucune sonde de navigateur ne voit, puisque le parseur la répare.
    casse = job_og_html({"id": "job-2", "title": "Mission"}, BASE).replace(
        "</div>\n</body>", "</body>"
    )
    with pytest.raises(DesequilibreHtml) as erreur:
        exiger_balises_equilibrees("la fiche mission job-2", casse, origine="kojo_job_og")
    # Le conteneur `<div id="root">` reste ouvert : c'est `</body>` qui le referme
    # en portée, le cas que le parseur répare sans rien dire.
    assert "`<div>` ouvert ligne" in str(erreur.value)
    assert "est refermé en PORTÉE par `</body>`" in str(erreur.value)


class _CollectionFactice:
    """Remplace la collection des missions : une seule réponse, sans base."""

    def __init__(self, document):
        self._document = document

    async def find_one(self, *_args, **_kwargs):
        return self._document


class _BaseFactice:
    def __init__(self, document):
        self.jobs = _CollectionFactice(document)


@pytest.mark.asyncio
async def test_la_route_refuse_une_fiche_desequilibree_par_un_500(monkeypatch):
    job = {"id": "job-3", "title": "Mission", "status": "open"}
    monkeypatch.setattr(kojo_routers_public, "db", _BaseFactice(job))
    monkeypatch.setattr(
        kojo_routers_public,
        "job_og_html",
        lambda *_a, **_k: "<!DOCTYPE html><html><body><div>jamais fermée</body></html>",
    )
    with pytest.raises(HTTPException) as erreur:
        await kojo_routers_public.get_job_og_html("job-3")
    assert erreur.value.status_code == 500


@pytest.mark.asyncio
async def test_la_route_sert_une_fiche_equilibree(monkeypatch):
    job = {"id": "job-4", "title": "Mission", "status": "open"}
    monkeypatch.setattr(kojo_routers_public, "db", _BaseFactice(job))
    reponse = await kojo_routers_public.get_job_og_html("job-4")
    assert reponse.status_code == 200
    assert b"Mission" in reponse.body


@pytest.mark.asyncio
async def test_la_route_sert_la_404_equilibree_avec_noindex(monkeypatch):
    monkeypatch.setattr(kojo_routers_public, "db", _BaseFactice(None))
    reponse = await kojo_routers_public.get_job_og_html("absente")
    assert reponse.status_code == 404
    assert reponse.headers["x-robots-tag"] == "noindex"
    assert b"noindex, nofollow" in reponse.body


@pytest.mark.asyncio
async def test_la_route_refuse_une_404_desequilibree_par_un_500(monkeypatch):
    monkeypatch.setattr(kojo_routers_public, "db", _BaseFactice(None))
    monkeypatch.setattr(
        kojo_routers_public,
        "job_og_html_404",
        lambda: "<!DOCTYPE html><html><body><div></body></html>",
    )
    with pytest.raises(HTTPException) as erreur:
        await kojo_routers_public.get_job_og_html("absente")
    assert erreur.value.status_code == 500


def test_seuls_les_modules_declares_ecrivent_du_html():
    # Un producteur de HTML absent de cette liste ne serait vérifié par personne.
    producteurs = {
        nom.name
        for nom in BACKEND.glob("*.py")
        if re.search(r"text/html|<!DOCTYPE html>|<html", nom.read_text(encoding="utf-8"))
    }
    assert producteurs == {"kojo_job_og.py", "kojo_routers_public.py"}
