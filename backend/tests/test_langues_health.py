# -*- coding: utf-8 -*-
"""Le bloc `langues` de /health : ce que le sitemap publie, langue par langue.

── Ce que ce bloc existe pour fermer (01/11/2026) ────────────────────────────
Savoir combien de langues ont une URL propre, et combien de documents chacune,
demandait la sonde `hreflang` de production : 61 requêtes et 11 s pour lire
60 documents. Un seul appel à `/health` doit répondre à la question de VOLUME —
les cinq langues, et le nombre de documents que chacune publie —, sans quoi un
lecteur qui veut ce chiffre doit lancer une sonde entière.

── Ce qu'il publie, et ce qu'il ne publie pas ────────────────────────────────
Il publie la DÉCLARATION du sitemap : les codes de `kojo_langues`, les pages
multilingues de `PAGES_STATIQUES` (la liste que le sitemap énumère) et les pages
monolingues de `kojo_pages_metier` / `kojo_pages_guides`. Il ne lit AUCUN
document : le `lang` d'un document, son `canonical`, la réciprocité des
`hreflang` et le fait qu'une page réponde vraiment se lisent sur l'origine du
SITE (frontend/scripts/check-hreflang-production.js). `portee`, dans la réponse,
le dit plutôt que de le taire — c'est la règle que `/health` applique déjà à
`sentry` et à `ai_gateway`.

── Pourquoi la confrontation au sitemap est le cas qui compte ────────────────
Un bloc qui compterait sa PROPRE liste pourrait rester cohérent avec lui-même en
publiant un volume faux. Le cas `test_le_bloc_et_le_sitemap_comptent_la_meme_chose`
lit donc le sitemap réellement servi (`GET /api/sitemap.xml`), résout chaque
`<loc>` et chaque `hreflang` vers sa langue, et exige que les deux comptages
tombent juste — c'est ce qui fait du bloc une lecture de la MÊME déclaration, et
non une seconde déclaration à tenir d'accord.
"""

import json
import re

import pytest
from httpx import AsyncClient

import kojo_langues as langues
import kojo_pages_guides as pages_guides
import kojo_pages_metier as pages_metier
from kojo_sitemap_declaration import PAGES_STATIQUES, bloc_langues

BLOCS_URL = re.compile(r"<url>(.*?)</url>", re.S)
LOC = re.compile(r"<loc>([^<]+)</loc>")
ALTERNATIVES = re.compile(
    r'<xhtml:link rel="alternate" hreflang="([^"]*)" href="([^"]*)"'
)
# Une fiche (mission ou profil) est DYNAMIQUE : elle n'appartient à aucune des
# deux familles de la déclaration, donc elle est hors du comptage comparé.
DYNAMIQUE = re.compile(r"^/(?:jobs|workers)/[^/]+$")


def _chemin(url: str) -> str:
    """Le chemin d'une URL absolue du sitemap (« /en/jobs », « /jobs »)."""
    reste = url.split("://", 1)[-1]
    return "/" + reste.split("/", 1)[1] if "/" in reste else "/"


def _langue_du_chemin(chemin: str) -> str:
    """La langue d'un chemin, d'après les PRÉFIXES de la déclaration.

    Un chemin qui ne porte aucun préfixe est dans la langue par défaut : c'est
    la langue dont l'URL n'a pas bougé (`prefixe` vide), donc la seule qui n'a
    rien à annoncer. Le préfixe se lit dans `LANGUES_INDEXEES` et non via
    `chemin_dans_la_langue("")`, qui rend `/` pour la langue par défaut.
    """
    for langue in langues.LANGUES_INDEXEES:
        prefixe = langue["prefixe"]
        if prefixe and (chemin == f"/{prefixe}" or chemin.startswith(f"/{prefixe}/")):
            return langue["code"]
    return langues.LANGUE_PAR_DEFAUT


def _chemins_declares() -> set[str]:
    """Les chemins monolingues, lus dans la MÊME déclaration que leurs routes."""
    return {chemin for chemin, _f, _p in pages_metier.urls_sitemap()} | {
        chemin for chemin, _f, _p in pages_guides.urls_sitemap()
    }


class TestLeBlocPublieLaDeclaration:
    def test_les_cinq_langues_dans_l_ordre_declare(self):
        bloc = bloc_langues()

        assert bloc["indexees"] == list(langues.codes())
        assert bloc["defaut"] == langues.LANGUE_PAR_DEFAUT
        assert set(bloc["documents_par_langue"]) == set(langues.codes())
        assert set(bloc["urls_par_langue"]) == set(langues.codes())

    def test_une_page_multilingue_compte_un_document_par_langue(self):
        bloc = bloc_langues()

        for code in langues.codes():
            assert bloc["documents_par_langue"][code] == len(PAGES_STATIQUES), (
                f"la langue « {code} » annonce "
                f"{bloc['documents_par_langue'][code]} document(s) pour "
                f"{len(PAGES_STATIQUES)} page(s) statique(s) : une page qui perd "
                "sa version traduite ne serait plus visible dans ce bloc"
            )

    def test_les_pages_monolingues_ne_comptent_que_dans_la_langue_par_defaut(self):
        bloc = bloc_langues()
        multilingues = len(PAGES_STATIQUES)
        monolingues = len(_chemins_declares())

        assert bloc["pages"] == {
            "multilingues": multilingues,
            "monolingues": monolingues,
            "declarees": multilingues * len(langues.codes()) + monolingues,
            # `None` et non 0 : /health ne lit pas la base, donc il ne compte
            # pas les fiches et profils que le sitemap ajoute depuis elle.
            "vivantes": None,
        }
        assert bloc["urls_par_langue"][langues.LANGUE_PAR_DEFAUT] == multilingues + monolingues
        for code in langues.codes():
            if code == langues.LANGUE_PAR_DEFAUT:
                continue
            assert bloc["urls_par_langue"][code] == multilingues, (
                f"« {code} » n'a pas de page monolingue : ses villes, métiers et "
                "guides n'existent qu'en français, et le bloc ne doit pas en "
                "inventer une traduction"
            )

    def test_les_alternatives_comptent_le_secours(self):
        bloc = bloc_langues()

        assert bloc["alternatives_par_page"] == len(langues.codes()) + 1, (
            "une page multilingue déclare une alternative par langue ET "
            "`x-default` : un compte sans le secours annoncerait une réciprocité "
            "que la page ne porte pas"
        )

    def test_la_portee_dit_ce_que_le_bloc_ne_lit_pas(self):
        """Un volume publié sans portée se lirait comme une mesure des documents."""
        portee = bloc_langues()["portee"]

        assert "declaration" in portee
        assert "check-hreflang-production.js" in portee, (
            "le bloc doit NOMMER la sonde qui lit les documents, sinon un "
            "lecteur peut croire que `/health` a vérifié les balises"
        )
        assert "canonical" in portee
        assert "X-Kojo-Urls" in portee, (
            "le bloc déclare un volume qui n'est PAS celui du sitemap : s'il ne "
            "nomme pas l'en-tête qui publie le volume servi, l'écart se lit "
            "comme une dette au lieu d'une famille ajoutée depuis la base"
        )

    def test_aucune_url_ni_hote_dans_un_bloc_public(self):
        """`/health` est PUBLIQUE : le bloc ne publie que des compteurs et des codes."""
        texte = json.dumps(bloc_langues())

        assert "http" not in texte
        assert "kojoforafrica" not in texte


class TestLaDerivationNeRecopieRien:
    def test_une_langue_ajoutee_a_la_declaration_apparait_sans_toucher_au_bloc(self, monkeypatch):
        """La liste des langues est LUE : une sixième langue compte d'elle-même."""
        six = langues.LANGUES_INDEXEES + (
            {"code": "ff", "prefixe": "ff", "html_lang": "ff"},
        )
        monkeypatch.setattr(langues, "LANGUES_INDEXEES", six)

        bloc = bloc_langues()

        assert "ff" in bloc["indexees"]
        assert bloc["documents_par_langue"]["ff"] == len(PAGES_STATIQUES)
        assert bloc["urls_par_langue"]["ff"] == len(PAGES_STATIQUES)
        assert bloc["alternatives_par_page"] == len(six) + 1
        assert bloc["pages"]["declarees"] == len(PAGES_STATIQUES) * len(six) + bloc["pages"]["monolingues"]


class TestLeBlocEtLeSitemapComptentLaMemeChose:
    """Le cas qui fait du bloc une LECTURE de la déclaration, pas une copie."""

    @pytest.mark.asyncio
    async def test_chaque_entree_multilingue_est_comptee_dans_sa_langue(self, client: AsyncClient):
        bloc = bloc_langues()
        resp = await client.get("/api/sitemap.xml")
        assert resp.status_code == 200

        par_langue = {code: 0 for code in langues.codes()}
        alternatives_attendues = set()
        for entree in BLOCS_URL.findall(resp.text):
            liens = ALTERNATIVES.findall(entree)
            if not liens:
                continue
            loc = _chemin(LOC.search(entree).group(1))
            par_langue[_langue_du_chemin(loc)] += 1
            for hreflang, href in liens:
                if hreflang == langues.LANGUE_DE_SECOURS:
                    continue
                chemin = _chemin(href)
                alternatives_attendues.add((hreflang, chemin))
                assert _langue_du_chemin(chemin) == hreflang, (
                    f"`{href}` est déclaré en « {hreflang} » : son préfixe dit autre chose"
                )

        assert par_langue == bloc["documents_par_langue"], (
            "le sitemap servi et le bloc `langues` de /health ne comptent pas les "
            f"mêmes documents : sitemap {par_langue} / bloc "
            f"{bloc['documents_par_langue']}"
        )
        # Une page par langue ET par chemin statique, chacune portant toutes ses
        # alternatives : la réciprocité n'est pas recomptée ici (elle appartient
        # à test_hreflang_sitemap.py), le VOLUME l'est.
        assert len(alternatives_attendues) == len(PAGES_STATIQUES) * len(langues.codes())

    @pytest.mark.asyncio
    async def test_les_pages_monolingues_servies_sont_celles_declarees(self, client: AsyncClient):
        resp = await client.get("/api/sitemap.xml")
        assert resp.status_code == 200

        servies = set()
        for entree in BLOCS_URL.findall(resp.text):
            if ALTERNATIVES.findall(entree):
                continue
            loc = _chemin(LOC.search(entree).group(1))
            if DYNAMIQUE.match(loc):
                continue
            servies.add(loc)

        assert servies == _chemins_declares(), (
            "le bloc compte des pages monolingues que le sitemap ne sert pas (ou "
            "l'inverse) : les villes, métiers et guides doivent sortir de la MÊME "
            "déclaration que leurs routes"
        )


class TestLaReponseDeHealth:
    @pytest.fixture(scope="class")
    def client_health(self):
        from fastapi.testclient import TestClient

        import server

        return TestClient(server.app)

    def test_health_publie_le_bloc(self, client_health):
        reponse = client_health.get("/health")

        assert reponse.status_code == 200
        bloc = reponse.json().get("langues")
        assert isinstance(bloc, dict), "/health ne publie pas de bloc `langues`"
        assert bloc["indexees"] == list(langues.codes())
        assert bloc["defaut"] == langues.LANGUE_PAR_DEFAUT

    def test_les_deux_routes_de_health_publient_le_meme_bloc(self, client_health):
        """`/health` et `/api/health` partagent un payload : pas de dérive."""
        direct = client_health.get("/health").json()["langues"]
        via_api = client_health.get("/api/health").json()["langues"]

        assert direct == via_api

    def test_le_bloc_repond_au_volume_sans_lancer_la_sonde(self, client_health):
        """Un appel doit suffire : langues, documents par langue, total."""
        bloc = client_health.get("/health").json()["langues"]

        assert len(bloc["indexees"]) == len(langues.codes()) >= 2
        assert all(nombre >= 1 for nombre in bloc["documents_par_langue"].values())
        assert bloc["pages"]["declarees"] == sum(bloc["urls_par_langue"].values())


class TestLeVolumeServiNEstPasLeVolumeDeclare:
    """L'écart entre /health et le sitemap est MESURÉ, borné et gardé.

    Mesuré le 02/11/2026 : `/health` déclarait 80 pages, le sitemap en servait
    85 — quatre profils travailleur et une fiche de mission, ajoutés depuis la
    base. Rien ne le mesurait : un lecteur ne pouvait pas savoir si l'écart
    était une famille non déclarée ou une dette, et le champ s'appelait
    `total`, donc il affirmait ce qu'il ne comptait pas. Le sitemap publie
    désormais son volume servi et sa décomposition ; ce cas exige que les
    trois nombres tombent juste contre les `<loc>` RÉELLEMENT servis.
    """

    @pytest.mark.asyncio
    async def test_le_sitemap_publie_le_volume_servi_et_sa_decomposition(self, client: AsyncClient):
        resp = await client.get("/api/sitemap.xml")
        assert resp.status_code == 200

        servies = [_chemin(loc) for loc in LOC.findall(resp.text)]
        declarees = int(resp.headers["X-Kojo-Urls-Declarees"])
        vivantes = int(resp.headers["X-Kojo-Urls-Vivantes"])

        assert int(resp.headers["X-Kojo-Urls"]) == len(servies) == declarees + vivantes, (
            "le volume annoncé par les en-têtes n'est pas le nombre de <loc> servis"
        )
        assert vivantes == sum(1 for chemin in servies if DYNAMIQUE.match(chemin)), (
            "`X-Kojo-Urls-Vivantes` doit compter EXACTEMENT les fiches et profils "
            "servis : une page déclarée comptée comme vivante masquerait une "
            "famille que le sitemap a cessé de publier"
        )
        assert declarees == bloc_langues()["pages"]["declarees"], (
            "le sitemap et /health ne comptent pas la même déclaration : "
            f"sitemap {declarees} / bloc {bloc_langues()['pages']['declarees']}"
        )
