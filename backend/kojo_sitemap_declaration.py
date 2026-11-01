# -*- coding: utf-8 -*-
"""Ce que le SITEMAP déclare — et le volume que `/health` en publie.

── Pourquoi ce module existe (01/11/2026) ────────────────────────────────────
Deux questions se répondaient en lançant une sonde de production entière :

1. « Quelles pages statiques le site publie-t-il dans chaque langue ? » — c'était
   une liste écrite dans `kojo_routers_public`, au milieu de la route du sitemap.
2. « Combien de langues, et combien de documents chacune ? » — 61 requêtes et
   11 s de sonde `hreflang` pour le lire.

La liste et le compte ont donc UN propriétaire : ce module. Le sitemap l'énumère
(`PAGES_STATIQUES`), `/health` en publie le volume (`bloc_langues`). Deux copies
auraient divergé au premier ajout de page, et l'un des deux compteurs aurait
publié un nombre faux sans que rien ne rougisse — c'est la raison pour laquelle
la liste n'est plus locale à la route.

── Ce que `bloc_langues` publie, et ce qu'il ne publie pas ───────────────────
Il publie la DÉCLARATION : les codes de `kojo_langues`, les pages multilingues
de `PAGES_STATIQUES`, et les pages monolingues de `kojo_pages_metier` /
`kojo_pages_guides` (villes, métiers, guides : écrites en français, sans version
traduite, donc comptées dans la langue par défaut seulement — c'est le fait qui
les décrit, pas un oubli).

Il ne lit AUCUN document : le `lang` d'une page servie, son `canonical`, la
réciprocité de ses `hreflang` et le fait qu'elle réponde vraiment se lisent sur
l'origine du SITE, avec `frontend/scripts/check-hreflang-production.js`. Le champ
`portee` le dit DANS la réponse, pour qu'aucun lecteur ne prenne le volume pour
la mesure — c'est la règle que `/health` applique déjà à `sentry` et
`ai_gateway` : publier ce qu'on a mesuré, nommer ce qu'on n'a pas mesuré.
"""

from __future__ import annotations

import kojo_langues as langues
import kojo_pages_guides as pages_guides
import kojo_pages_metier as pages_metier

# ── Les pages STATIQUES pré-rendues, une seule fois ──────────────────────────
# `(chemin, changefreq, priorité)` — le chemin reste RELATIF : l'URL publiée se
# DÉRIVE de la langue (`kojo_langues`), jamais recopiée cinq fois avec un `/en`
# devant. Ces sept pages sont les mêmes dans toutes les langues indexées : le
# frontend en publie un document par langue (`/jobs` et `/en/jobs`), et chacun
# déclare ses `hreflang` (vite-plugins/prerender/hreflang.js). Le sitemap doit
# annoncer les MÊMES URL et porter les MÊMES alternatives — un sitemap qui
# n'énumère que le français dit au moteur que l'anglais n'existe pas, et un
# `hreflang` que seul le crawl découvre est une déclaration à moitié servie.
#
# `/login` et `/register` n'y sont PAS (27/10/2026) : ce sont deux FORMULAIRES,
# aucun moteur ne les classe sur une intention de recherche, et les annoncer en
# `weekly` + 0,8 les présentait comme les pages les plus importantes du site
# après l'accueil et les missions — deux des neuf entrées statiques décrivaient
# une porte, pas un contenu. Ils restent indexables (une recherche de marque
# « kojo connexion » doit tomber dessus, et un `noindex` les ferait disparaître) :
# c'est leur PRIORITÉ dans le sitemap qui était fausse, pas leur existence.
#
# `/terms` MANQUAIT (mesuré le 26/10/2026) : la page répond 200, elle est
# pré-rendue, sa balise `robots` vaut `index, follow` et son HTML pèse
# 105 553 o — mais le sitemap ne la citait pas, alors que son commentaire
# annonçait « les trois pages de confiance » et que /privacy, sa jumelle
# juridique, y était. Une page indexable absente du sitemap n'est pas cachée :
# elle est explorée moins tôt et moins souvent — et un sitemap qui n'énumère pas
# ce qu'il prétend énumérer se lit comme complet à tort.
PAGES_STATIQUES: tuple[tuple[str, str, str], ...] = (
    ("/", "daily", "1.0"),
    ("/how-it-works", "monthly", "0.7"),
    ("/jobs", "hourly", "0.9"),
    # Les QUATRE pages de confiance : un moteur (et une régie publicitaire)
    # cherche à savoir qui édite le site, comment le joindre, ce qu'il fait des
    # données ET à quelles conditions il le fait. Elles existent en pages
    # pré-rendues depuis le 19/09/2026 ; les lister ici est ce qui les rend
    # DÉCOUVRABLES sans lien entrant.
    ("/about", "monthly", "0.6"),
    ("/contact", "monthly", "0.6"),
    ("/privacy", "yearly", "0.4"),
    ("/terms", "yearly", "0.4"),
)


def bloc_langues() -> dict:
    """Le bloc `langues` de `/health` : combien de langues, combien de documents.

    ── Ce que ce bloc ferme ─────────────────────────────────────────────────
    Le volume publié par langue — cinq langues, et le nombre de documents que
    chacune sert — ne se lisait qu'en lançant la sonde `hreflang` de production.
    Un seul appel à `/health` répond désormais à cette question de VOLUME, ce
    qui suffit à voir une langue qui perd ses pages ou qui n'en a jamais eu.

    ── Ce qu'il ne dit pas ──────────────────────────────────────────────────
    Voir le module : c'est une DÉCLARATION, et `portee` l'écrit dans la réponse.

    ── Aucun chiffre recopié ────────────────────────────────────────────────
    Les codes et les préfixes viennent de `kojo_langues.LANGUES_INDEXEES`, les
    pages multilingues de `PAGES_STATIQUES`, et les pages ville, métier et
    guides de leur `urls_sitemap()` — la même déclaration que leurs routes. Une
    ville ajoutée au référentiel, ou une page statique ajoutée au sitemap,
    change ce bloc sans qu'on y touche.

    Returns:
        dict: `indexees`, `defaut`, `documents_par_langue`, `urls_par_langue`,
        `pages`, `alternatives_par_page` et `portee` — aucun secret, aucune URL.
    """
    codes = langues.codes()
    multilingues = len(PAGES_STATIQUES)
    # Les pages écrites en FRANÇAIS seulement : villes, métiers et guides n'ont
    # aucune version traduite, donc elles ne comptent que dans la langue par
    # défaut — c'est le fait qui les décrit, pas un oubli.
    monolingues = len(pages_metier.urls_sitemap()) + len(pages_guides.urls_sitemap())
    urls = {code: multilingues for code in codes}
    urls[langues.LANGUE_PAR_DEFAUT] = urls.get(langues.LANGUE_PAR_DEFAUT, 0) + monolingues
    return {
        "indexees": list(codes),
        "defaut": langues.LANGUE_PAR_DEFAUT,
        # Une page multilingue publie un document PAR LANGUE : c'est ce nombre
        # qu'on lit ici, identique pour les cinq tant que `PAGES_STATIQUES` reste
        # la seule déclaration (tests/test_langues_health.py le prouve en le
        # confrontant au sitemap réellement servi).
        "documents_par_langue": {code: multilingues for code in codes},
        "urls_par_langue": urls,
        "pages": {
            "multilingues": multilingues,
            "monolingues": monolingues,
            "total": multilingues * len(codes) + monolingues,
        },
        "alternatives_par_page": len(langues.alternatives(PAGES_STATIQUES[0][0])),
        "portee": (
            "declaration du sitemap (URL par langue) ; les documents servis — "
            "lang, canonical, reciprocite des hreflang — se lisent sur l'origine "
            "du site, avec frontend/scripts/check-hreflang-production.js"
        ),
    }
