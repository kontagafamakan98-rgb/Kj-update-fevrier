"""L'équilibre des balises du HTML que sert le BACKEND (kojo_balises.py).

Ce que ces tests mesurent, et ce qu'ils ne font PAS :

  1. PARITÉ — la règle Python rend, cas par cas, EXACTEMENT ce que la règle
     JavaScript du frontend rend (frontend/vite-plugins/prerender/balises.js) :
     mêmes problèmes, mêmes lignes, mêmes extraits, mêmes phrases. Le jeu de cas
     est un fichier partagé, produit par la règle JS ; deux implémentations sans
     jeu commun finissent par diverger sur un cas limite sans que personne le voie.
  2. LE REFUS — un document déséquilibré lève, et la phrase NOMME la balise.
  3. LES PAGES RÉELLES — la fiche mission, sa 404, le profil travailleur et sa
     404 sont équilibrés, y compris pour des noms et des descriptions hostiles
     (balises, guillemets, émojis). Le refus est prouvé sur une page réellement
     cassée, pas seulement sur une chaîne fabriquée pour l'occasion.
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
from kojo_worker_og import worker_og_html, worker_og_html_404

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


TRAVAILLEUR = {
    "id": "worker-1",
    "first_name": "Awa",
    "last_name": "Diop",
    "city": "Dakar",
    "skills": ["plomberie"],
    "bio": "Artisan plombier.",
    "stats": {"missions_completed": 2, "rating_average": 4.7, "rating_count": 2},
}


@pytest.mark.parametrize(
    "nom_du_travailleur",
    [
        "Awa Diop",
        "</div><div>injection",
        "A <b> & \"x\" 'y'",
        "\U0001F600" * 30,
    ],
)
def test_le_profil_travailleur_est_equilibre_pour_des_noms_hostiles(nom_du_travailleur):
    """Le profil pré-rendu est lu par les crawlers : il tient ses balises."""
    worker = {
        **TRAVAILLEUR,
        "first_name": nom_du_travailleur,
        "bio": "</section> dans la bio " * 12,
    }
    assert desequilibres_des_balises(worker_og_html(worker, BASE)) == []


def test_la_page_404_du_profil_est_equilibree():
    assert desequilibres_des_balises(worker_og_html_404()) == []


def _profil_factice(document):
    """Doublure de `profil_public` : la vue publique, sans base."""

    async def _profil(_worker_id):
        return document

    return _profil


@pytest.mark.asyncio
async def test_la_route_du_profil_refuse_une_page_desequilibree_par_un_500(monkeypatch):
    """La même règle que la fiche mission, sur le second producteur de HTML."""
    monkeypatch.setattr(kojo_routers_public, "profil_public", _profil_factice(TRAVAILLEUR))
    monkeypatch.setattr(
        kojo_routers_public,
        "worker_og_html",
        lambda *_a, **_k: "<!DOCTYPE html><html><body><div>jamais fermée</body></html>",
    )
    with pytest.raises(HTTPException) as erreur:
        await kojo_routers_public.get_worker_og_html("worker-1")
    assert erreur.value.status_code == 500


@pytest.mark.asyncio
async def test_la_route_du_profil_sert_la_404_equilibree_avec_noindex(monkeypatch):
    monkeypatch.setattr(kojo_routers_public, "profil_public", _profil_factice(None))
    reponse = await kojo_routers_public.get_worker_og_html("absent")
    assert reponse.status_code == 404
    assert reponse.headers["x-robots-tag"] == "noindex"
    assert b"noindex, nofollow" in reponse.body


def test_seuls_les_modules_declares_ecrivent_du_html():
    # Un producteur de HTML absent de cette liste ne serait vérifié par personne.
    producteurs = {
        nom.name
        for nom in BACKEND.glob("*.py")
        if re.search(r"text/html|<!DOCTYPE html>|<html", nom.read_text(encoding="utf-8"))
    }
    # `kojo_routers_job_alerts.py` produit le HTML du RÉSUMÉ d'alertes emploi
    # (email), pas un document servi : il entre dans l'inventaire pour la même
    # raison que les autres, et parce qu'un producteur tu est exactement ce que
    # ce test existe pour empêcher.
    # LES PAGES VILLE, MÉTIER ET GUIDES (27/10/2026). Elles ne sont pas des
    # coquilles de l'application : elles écrivent leur document de bout en bout,
    # donc elles entrent dans l'inventaire comme les fiches. Leur équilibre est
    # vérifié juste au-dessus, sur des titres hostiles compris.
    assert producteurs == {
        "kojo_job_og.py",
        "kojo_worker_og.py",
        "kojo_pages_metier.py",
        "kojo_pages_guides.py",
        "kojo_routers_job_alerts.py",
        "kojo_routers_public.py",
    }


def test_les_pages_de_contenu_sont_equilibrees():
    """Les documents VILLE, MÉTIER et GUIDE passent la même règle que les fiches.

    Sans cette vérification, les deux modules seraient déclarés producteurs sans
    qu'aucun document réel ne soit mesuré — la déclaration dirait « vérifié »
    d'une chose que personne n'a lue.
    """
    import kojo_pages_guides as guides
    import kojo_pages_metier as pages

    origine = "https://kojoforafrica.cc.cd"
    hostile = {
        "id": "j1",
        "title": '<script>alert("x")</script> & <img src=x onerror=alert(1)>',
        "budget": 25000,
        "currency": "FCFA",
        "location": {"city": "Abidjan"},
        "created_at": "2026-10-20T10:00:00",
    }
    documents = {
        "ville": pages.document(pages.trouver_ville("abidjan"), "ville", origine, [hostile]),
        "metier": pages.document(pages.trouver_metier("plomberie"), "metier", origine, [hostile]),
        "metier vide": pages.document(pages.trouver_metier("menage"), "metier", origine, []),
        "404 ville": pages.document_introuvable(origine),
        "guide prix": guides.document(guides.trouver_guide("prix-plomberie"), origine, [hostile]),
        "guide prix vide": guides.document(guides.trouver_guide("prix-menage"), origine, []),
        "guide choisir": guides.document(guides.trouver_guide("choisir-un-artisan"), origine, []),
        "404 guide": guides.document_introuvable(origine),
    }
    for nom, doc in documents.items():
        assert exiger_balises_equilibrees(nom, doc) == doc, nom
        assert desequilibres_des_balises(doc) == [], nom
