# -*- coding: utf-8 -*-
"""La CSP du site est PUBLIÉE par les documents pré-rendus.

Ce que ces cas prouvent, et pourquoi ils ne pouvaient pas vivre ailleurs :

  • les quatre documents (`/jobs/:id`, sa 404, `/workers/:id`, sa 404) portent la
    politique dans leur `<head>`, AVANT toute ressource — une politique posée
    après le `<script type="module">` ne s'appliquerait pas au script ;
  • la politique publiée est celle de `construire_csp` pour l'environnement du
    process (c'est ce que la production fera), et elle ne contient JAMAIS
    `frame-ancestors` — une balise `<meta>` l'ignore, et les navigateurs
    l'avertissent en console à chaque chargement ;
  • l'attribut est échappé pour ce qui le fermerait (`&`, `<`, `>`, `"`) et PAS
    pour l'apostrophe : la politique en contient par construction (`'self'`), et
    un `&apos;` rendrait les octets servis différents de ceux de la meta du
    build pour la MÊME politique — donc la comparaison de production comparerait
    deux encodages au lieu de deux politiques.

Ce que ces cas ne peuvent PAS prouver : que les DEUX DÉPLOIEMENTS portent les
mêmes valeurs. C'est la sonde de production (`check-csp-documents-production.js`)
qui lit la politique du site et celle des documents, et refuse l'écart.
"""

import pytest

from kojo_csp import (
    ENV_GA,
    ENV_ORIGINE_API,
    ENV_PLAUSIBLE,
    GA_MOTIF,
    balise_csp,
    construire_csp,
    csp_du_site,
)
from kojo_job_og import job_og_html, job_og_html_404
from kojo_worker_og import worker_og_html, worker_og_html_404

BASE = "https://kojoforafrica.cc.cd"
ORIGINE_API = "https://api.kojo.test"

# Les balises qui font DÉMARRER l'application : la CSP doit les précéder.
BALISE_MODULE = '<script type="module"'
BALISE_FEUILLE = '<link rel="stylesheet"'
BALISE_CSP = '<meta http-equiv="Content-Security-Policy" content="'

MISSION = {"id": "ref-csp", "title": "Réparer une pompe", "description": "Fuite au plafond."}
PROFIL = {"id": "ref-csp", "name": "Awa", "city": "Ouagadougou"}


@pytest.fixture()
def environnement(monkeypatch):
    """Les trois réglages du backend, posés pour la durée du cas."""
    monkeypatch.setenv(ENV_ORIGINE_API, ORIGINE_API)
    monkeypatch.setenv(ENV_PLAUSIBLE, "site.kojo.test")
    monkeypatch.setenv(ENV_GA, "G-ABC123")
    return {
        "origine": ORIGINE_API,
        "plausible": "site.kojo.test",
        "ga": "G-ABC123",
    }


def _politique_publiee(document: str) -> str:
    """La politique d'un document, ou '' s'il n'en publie aucune."""
    debut = document.find(BALISE_CSP)
    if debut < 0:
        return ""
    debut += len(BALISE_CSP)
    fin = document.find('" />', debut)
    assert fin > debut, "balise CSP sans fin d'attribut"
    return (
        document[debut:fin]
        .replace("&quot;", '"')
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
    )


def _documents():
    """Les quatre documents pré-rendus, nommés comme la sonde les nomme."""
    return [
        ("jobs", job_og_html(MISSION, BASE)),
        ("jobs 404", job_og_html_404()),
        ("workers", worker_og_html(PROFIL, BASE)),
        ("workers 404", worker_og_html_404()),
    ]


class TestPolitique:
    def test_la_politique_est_une_chaine_stable(self):
        """Golden : la chaîne EXACTE que `construireCsp` doit rendre en JS.

        C'est le maillon qui rend la copie acceptable : si l'un des deux côtés
        ajoute, retire ou réordonne une source, le contrat hors ligne rougit sur
        un écart d'octets — pas sur une intention.
        """
        assert construire_csp(
            api_origin=ORIGINE_API,
            plausible_domain="site.kojo.test",
            ga_measurement_id="G-ABC123",
        ) == (
            "default-src 'self'; "
            "script-src 'self' https://accounts.google.com https://plausible.io "
            "https://www.googletagmanager.com; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob: https://res.cloudinary.com "
            "https://tile.openstreetmap.org https://www.google-analytics.com; "
            "connect-src 'self' " + ORIGINE_API + " https://accounts.google.com "
            "https://www.google-analytics.com https://region1.google-analytics.com; "
            "frame-src 'self' https://www.google.com https://www.openstreetmap.org "
            "https://accounts.google.com; "
            "font-src 'self' data:; object-src 'none'; base-uri 'self'; "
            "worker-src 'self'; manifest-src 'self'"
        )

    def test_frame_ancestors_n_est_jamais_dans_une_meta(self):
        # Il est IGNORÉ dans une balise <meta> (avertissement console) : il vit
        # dans l'en-tête HTTP de frontend/vercel.json.
        assert "frame-ancestors" not in construire_csp(api_origin=ORIGINE_API)

    def test_un_identifiant_ga_invalide_n_ouvre_rien(self):
        politique = construire_csp(
            api_origin=ORIGINE_API, plausible_domain="", ga_measurement_id="UA-123456-1"
        )
        assert "googletagmanager" not in politique
        assert "google-analytics" not in politique
        assert GA_MOTIF.fullmatch("G-ABC123")

    def test_l_origine_est_normalisee(self):
        assert construire_csp(api_origin="  https://api.kojo.test//  ") == construire_csp(
            api_origin="https://api.kojo.test"
        )

    def test_sans_origine_aucune_source_vide(self):
        politique = construire_csp(api_origin="")
        assert "connect-src 'self' https://accounts.google.com" in politique
        assert "  " not in politique  # aucun jeton vide ne laisse un double espace


class TestEnvironnement:
    def test_les_trois_reglages_alimentent_la_politique(self, environnement):
        politique = csp_du_site()
        assert environnement["origine"] in politique
        assert "https://plausible.io" in politique
        assert "https://www.googletagmanager.com" in politique

    def test_sans_reglage_la_politique_se_reduit(self, monkeypatch):
        for cle in (ENV_ORIGINE_API, ENV_PLAUSIBLE, ENV_GA):
            monkeypatch.delenv(cle, raising=False)
        politique = csp_du_site()
        assert "plausible.io" not in politique
        assert "googletagmanager" not in politique
        assert "connect-src 'self' https://accounts.google.com" in politique

    def test_l_echappement_de_l_attribut_conserve_les_apostrophes(self):
        # La politique est pleine de `'self'` : un `&apos;` la rendrait différente
        # des octets servis par le build pour la MÊME politique.
        balise = balise_csp("default-src 'self'")
        assert "&#x27;" not in balise and "&apos;" not in balise
        assert """content="default-src 'self'" """ in balise

    def test_l_echappement_ferme_l_attribut_sur_les_caracteres_dangereux(self):
        balise = balise_csp('img-src "x" & <y>')
        assert 'content="img-src &quot;x&quot; &amp; &lt;y&gt;"' in balise


class TestDocuments:
    @pytest.mark.parametrize("nom", ["jobs", "jobs 404", "workers", "workers 404"])
    def test_chaque_document_publie_la_politique_du_site(self, environnement, nom):
        document = dict(_documents())[nom]
        attendue = construire_csp(
            api_origin=environnement["origine"],
            plausible_domain=environnement["plausible"],
            ga_measurement_id=environnement["ga"],
        )
        assert _politique_publiee(document) == attendue, nom

    @pytest.mark.parametrize("nom", ["jobs", "workers"])
    def test_la_politique_precede_les_ressources(self, environnement, nom):
        document = dict(_documents())[nom]
        position_csp = document.find(BALISE_CSP)
        assert position_csp > 0, nom
        assert position_csp < document.find(BALISE_MODULE), nom
        assert position_csp < document.find(BALISE_FEUILLE), nom
        # Dans la TÊTE, jamais dans le corps.
        assert position_csp < document.find("</head>"), nom
        assert position_csp < document.find("<body>"), nom

    def test_les_documents_suivent_l_environnement(self, monkeypatch):
        """Un réglage changé change la politique SERVIE — pas seulement l'entête."""
        monkeypatch.setenv(ENV_ORIGINE_API, ORIGINE_API)
        monkeypatch.delenv(ENV_GA, raising=False)
        sans_ga = _politique_publiee(job_og_html(MISSION, BASE))

        monkeypatch.setenv(ENV_GA, "G-XYZ789")
        avec_ga = _politique_publiee(job_og_html(MISSION, BASE))

        assert "googletagmanager" not in sans_ga
        assert "googletagmanager" in avec_ga
        assert sans_ga != avec_ga
