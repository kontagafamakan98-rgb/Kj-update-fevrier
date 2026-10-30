"""Le sitemap annonce-t-il les MÊMES langues que les documents pré-rendus ?

── Ce qui est vérifié, et pourquoi ces deux moitiés ──────────────────────────
Depuis le 30/10/2026 le frontend publie un document par langue indexée
(`/jobs` en français, `/en/jobs` en anglais) et chaque document porte ses
`<link rel="alternate" hreflang>`. Le sitemap doit énumérer les MÊMES URL :

- un sitemap qui n'annonce que le français dit au moteur que l'anglais
  n'existe pas ;
- un `hreflang` qui désigne une page que le sitemap n'énumère pas reste une
  déclaration que seul le crawl découvrira.

Les deux applications se déploient SÉPARÉMENT (Fly pour l'API, Vercel pour le
frontend) : aucun import partagé n'est possible. Ce n'est donc pas une
réutilisation qui les tient ensemble, c'est ce fichier — il lit la déclaration
du frontend (`frontend/src/config/langues-indexees.js`) et la compare à
`kojo_langues.LANGUES_INDEXEES`. Ajouter une langue d'un seul côté rougit ici,
au lieu de publier un sitemap qui ignore la moitié des documents.

── Ce que ces cas ne disent PAS ─────────────────────────────────────────────
Ils ne lisent pas le `build/` du frontend : que chaque document existe, porte le
bon `lang`, le bon canonical et exactement ses alternatives appartient à
`frontend/scripts/check-prerender-shells.js` (section « langues indexées »),
qui tourne sur l'artefact. Un test Python ne peut pas en juger à sa place.
"""

import re
from pathlib import Path

import pytest
from httpx import AsyncClient

import kojo_langues as langues

# La déclaration du frontend : la source de vérité de la liste, dans l'autre
# application. Lue comme du TEXTE (aucun exécuteur JS ici) — c'est sa forme
# déclarative qui est comparée, pas un comportement.
CHEMIN_DECLARATION_JS = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "config" / "langues-indexees.js"
)


def _langues_du_frontend() -> list[dict[str, str]]:
    """Les entrées de `LANGUES_INDEXEES` côté frontend, lues dans le module JS.

    Seules les entrées de la liste sont lues : le reste du fichier (fonctions,
    commentaires) n'a pas à être interprété, et une fonction ajoutée là-bas ne
    peut donc pas changer ce que ce test compare.
    """
    source = CHEMIN_DECLARATION_JS.read_text(encoding="utf-8")
    debut = source.index("export const LANGUES_INDEXEES = [")
    fin = source.index("];", debut)
    bloc = source[debut:fin]
    entrees = []
    for ligne in bloc.splitlines():
        if "code:" not in ligne:
            continue
        entree = {}
        for champ, cle in (("code", "code"), ("prefixe", "prefixe"), ("htmlLang", "htmlLang")):
            trouve = re.search(rf"{champ}: '([^']*)'", ligne)
            entree[cle] = trouve.group(1) if trouve else ""
        entrees.append(entree)
    return entrees


class TestLaDeclarationEstLaMemeDesDeuxCotes:
    def test_les_codes_sont_les_memes_dans_le_meme_ordre(self):
        assert langues.codes() == tuple(
            entree["code"] for entree in _langues_du_frontend()
        ), (
            "kojo_langues.LANGUES_INDEXEES et frontend/src/config/langues-indexees.js "
            "ne déclarent pas les mêmes langues : le sitemap et les documents "
            "pré-rendus ne peuvent plus annoncer le même ensemble d'URL"
        )

    def test_les_prefixes_sont_les_memes(self):
        frontend = {entree["code"]: entree["prefixe"] for entree in _langues_du_frontend()}
        assert {langue["code"]: langue["prefixe"] for langue in langues.LANGUES_INDEXEES} == frontend

    def test_la_langue_par_defaut_n_a_pas_de_prefixe(self):
        # C'est la règle qui garde l'URL d'avant : si `fr` recevait un préfixe,
        # toutes les URL françaises indexées changeraient d'adresse.
        assert langues.chemin_dans_la_langue("/jobs", langues.LANGUE_PAR_DEFAUT) == "/jobs"
        assert langues.chemin_dans_la_langue("/", langues.LANGUE_PAR_DEFAUT) == "/"

    def test_une_langue_prefixee_prefixe_le_chemin_sans_barre_finale(self):
        assert langues.chemin_dans_la_langue("/jobs", "en") == "/en/jobs"
        assert langues.chemin_dans_la_langue("/", "en") == "/en"


def _blocs_url(sitemap: str) -> list[str]:
    """Chaque `<url>…</url>` du sitemap, dans l'ordre publié."""
    return re.findall(r"<url>.*?</url>", sitemap, flags=re.S)


def _loc(bloc: str) -> str:
    return re.search(r"<loc>([^<]*)</loc>", bloc).group(1)


def _alternatives(bloc: str) -> list[tuple[str, str]]:
    return re.findall(
        r'<xhtml:link rel="alternate" hreflang="([^"]*)" href="([^"]*)"',
        bloc,
    )


@pytest.fixture
async def sitemap(client: AsyncClient) -> str:
    resp = await client.get("/api/sitemap.xml")
    assert resp.status_code == 200
    return resp.text


@pytest.mark.asyncio
class TestLeSitemapAnnonceChaqueLangue:
    async def test_chaque_page_bilingue_est_enumeree_dans_les_deux_langues(self, sitemap):
        locs = {_loc(bloc) for bloc in _blocs_url(sitemap)}
        for chemin in ("/jobs", "/", "/how-it-works", "/about", "/contact", "/privacy", "/terms"):
            for code in langues.codes():
                url = f"https://kojoforafrica.cc.cd{langues.chemin_dans_la_langue(chemin, code)}"
                assert url in locs, (
                    f"{url} manque au sitemap alors qu'un document pré-rendu le sert "
                    "(frontend/src/config/langues-indexees.js) : la version "
                    f"« {code} » de {chemin} n'a aucun chemin de découverte"
                )

    async def test_les_alternatives_sont_reciproques_et_portent_le_secours(self, sitemap):
        blocs = {_loc(bloc): bloc for bloc in _blocs_url(sitemap)}
        attendues = langues.alternatives("/jobs")
        for code in langues.codes():
            url = f"https://kojoforafrica.cc.cd{langues.chemin_dans_la_langue('/jobs', code)}"
            alternatives = _alternatives(blocs[url])
            publiees = [(hreflang, href.replace("https://kojoforafrica.cc.cd", "")) for hreflang, href in alternatives]
            assert publiees == attendues, (
                f"les alternatives de {url} ne sont pas celles de kojo_langues : "
                f"{publiees} au lieu de {attendues}"
            )
            # Le `x-default` désigne la langue par défaut, pas la langue de l'entrée.
            assert publiees[-1] == ("x-default", "/jobs")

    async def test_les_deux_entrees_de_la_famille_portent_la_meme_liste(self, sitemap):
        blocs = {_loc(bloc): bloc for bloc in _blocs_url(sitemap)}
        listes = set()
        for code in langues.codes():
            chemin = langues.chemin_dans_la_langue("/jobs", code)
            listes.add(tuple(_alternatives(blocs[f"https://kojoforafrica.cc.cd{chemin}"])))
        assert len(listes) == 1, (
            "les deux entrées du même page ne publient pas les mêmes alternatives — "
            "un hreflang réciproque est ce que Google exige, une liste divergente "
            "fait ignorer la déclaration"
        )

    async def test_une_page_monolingue_ne_declare_aucune_alternative(self, sitemap):
        # Les pages ville, métier et guides sont écrites en français seulement :
        # leur prêter un `hreflang` serait une déclaration fausse.
        for bloc in _blocs_url(sitemap):
            url = _loc(bloc)
            if "/emplois/" in url or "/metiers/" in url or "/guides/" in url:
                assert _alternatives(bloc) == [], (
                    f"{url} déclare des alternatives alors qu'elle n'existe qu'en français"
                )
