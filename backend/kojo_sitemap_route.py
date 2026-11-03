# -*- coding: utf-8 -*-
"""LE SITEMAP SERVI : sa construction, ses trois en-têtes de volume, son cache.

Pourquoi ce module existe : le constructeur du sitemap vivait dans
`kojo_routers_public.py`, qui a franchi le plafond de 1 000 lignes en recevant
le cache (02/11/2026 au soir). Le découpage n'est pas cosmétique — la règle du
dépôt est qu'un fichier de plus de 1 000 lignes n'est plus relu, et le sitemap
est un bloc de DÉCLARATION : il énumère ce que le site publie, il ne sert aucune
donnée utilisateur, il n'a donc rien à faire au milieu des routeurs de fiches.

Ce que ce module garde tel quel, et c'est le point : la liste des pages ne se
recopie jamais. `PAGES_STATIQUES` (une langue par entrée), `pages_metier` et
`pages_guides` sont les MÊMES déclarations que les routes correspondantes, donc
une ville ajoutée au référentiel apparaît ici sans qu'on touche à ce fichier.

Le CACHE, mesuré le soir du 02/11/2026 : `/sitemap.xml` rendait **0,72 s** à
chaque crawl pour une déclaration qui ne change qu'aux publications, et Vercel
ne met pas en cache la réécriture `/sitemap.xml → /api/sitemap.xml` (origine
externe, même constat que les 45 pages ville/métier/guide) : le `s-maxage=3600`
déjà envoyé ne protégeait que le navigateur. Le corps ET ses trois en-têtes de
volume sont donc rendus puis cachés ENSEMBLE — un en-tête qui décrirait un autre
corps après un rejeu serait pire que pas de cache du tout.
"""
from fastapi import Response

from kojo_core import db
from kojo_identifiants import identifiant_public
from kojo_job_og import escape_xml
# Les langues qui ont une URL propre, et la forme des alternatives `hreflang` :
# une seule déclaration (kojo_langues.py), comparée à celle du frontend par
# backend/tests/test_hreflang_sitemap.py.
import kojo_langues as langues
import kojo_pages_cache as pages_cache
import kojo_pages_guides as pages_guides
import kojo_pages_metier as pages_metier
# La déclaration du sitemap (pages statiques) et le bloc `langues` de /health :
# un seul proprietaire, pour que l'enumeration et le compte ne puissent pas
# diverger (cf. kojo_sitemap_declaration.py).
from kojo_sitemap_declaration import PAGES_STATIQUES

# Les trois volumes sont nommés une fois : la route les cache, /health les
# confronte, et une faute de frappe dans l'un des deux ferait publier un
# en-tête absent plutôt qu'un chiffre faux.
ENTETES_VOLUME = (
    "X-Kojo-Urls",
    "X-Kojo-Urls-Declarees",
    "X-Kojo-Urls-Vivantes",
)


async def _construire_sitemap(base: str) -> Response:
    """Sitemap dynamique : liste statique du site + toutes les fiches de
    mission PUBLIQUES (/jobs/:id) encore ouvertes ou en cours — les seules
    pages métier indexables (les autres statuts sont privés/terminés).

    Sert du XML réel (text/xml) pour que Google puisse crawler les fiches
    exactes, au lieu du sitemap statique Vercel qui n'énumérait que la home.
    Le Vercel rewrite /sitemap.xml → /api/sitemap.xml (vercel.json) achemine
    le crawler jusqu'ici.

    Args:
        base: l'origine publique du site, sans barre oblique finale — elle est
            passée par l'appelant pour que `canonical` et `loc` sortent en
            absolu, et pour que deux origines ne puissent pas se mélanger.

    Returns:
        Response: XML (text/xml) — le sitemap complet, pas un objet JSON.
    """
    # `/login` et `/register` en sont SORTIS le 27/10/2026. Ce sont deux
    # FORMULAIRES : aucun moteur ne les classe sur une intention de recherche, et
    # les annoncer en `weekly` + 0,8 les présentait comme les pages les plus
    # importantes du site après l'accueil et les missions — mesuré le 27/10, deux
    # des neuf entrées statiques décrivaient une porte, pas un contenu. Ils
    # restent indexables (une recherche de marque « kojo connexion » doit tomber
    # dessus, et un `noindex` la ferait disparaître) : c'est leur PRIORITÉ dans le
    # sitemap qui était fausse, pas leur existence.
    # ── Une ENTRÉE PAR LANGUE INDEXÉE (30/10/2026) ────────────────────
    # La liste des pages statiques vit dans `kojo_sitemap_declaration`
    # (`PAGES_STATIQUES`) : ce sitemap l'énumère, et le bloc `langues` de
    # `/health` en compte les documents par langue (01/11/2026). Deux copies de
    # cette liste auraient divergé au premier ajout de page — l'une des deux
    # aurait publié un compte faux sans que rien ne rougisse.
    static_paths = PAGES_STATIQUES
    # `(url, chemin, freq, priorité)` : `chemin` n'est renseigné que pour les
    # pages qui ONT une alternative par langue. Les pages ville, métier et guides
    # sont écrites en français (aucune version anglaise n'existe) : elles gardent
    # `None`, donc aucune alternative — une page monolingue ne déclare pas de
    # `hreflang`, c'est le fait qui la décrit.
    static_urls = [
        (base + langues.chemin_dans_la_langue(chemin, code), chemin, freq, prio)
        for chemin, freq, prio in static_paths
        for code in langues.codes()
    ]

    # ── Les pages VILLE et MÉTIER (27/10/2026) ───────────────────────────────
    # Elles viennent de `kojo_pages_metier.urls_sitemap()`, c'est-à-dire de la
    # MÊME déclaration que les routes `/api/pages/villes|metiers/{slug}` : une
    # URL publiée ici répond forcément, et un slug renommé ne peut pas laisser
    # derrière lui une entrée morte (un sitemap qui renvoie des 404 fait perdre
    # la confiance du crawler sur tout le fichier).
    static_urls += [
        (base + chemin, None, freq, prio)
        for chemin, freq, prio in pages_metier.urls_sitemap()
    ]

    # ── Les GUIDES ÉDITORIAUX (27/10/2026) ──────────────────────────────────
    # Même règle : la liste sort de `kojo_pages_guides.urls_sitemap()`, la même
    # déclaration que la route `/api/pages/guides/{slug}`. Sans eux, le site
    # n'aurait, pour « combien coûte un plombier », que des listes d'offres à
    # classer ; avec eux, une page répond à la question posée avant l'offre.
    static_urls += [
        (base + chemin, None, freq, prio)
        for chemin, freq, prio in pages_guides.urls_sitemap()
    ]

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        'xmlns:mobile="http://www.google.com/schemas/sitemap-mobile/1.0" '
        'xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ]
    for url, chemin, changefreq, priority in static_urls:
        # Les alternatives d'une page bilingue. Elles sont écrites pour CHAQUE
        # langue de la famille, `x-default` compris — la réciproque que Google
        # exige (une page qui pointe l'autre sans être pointée en retour est
        # ignorée) et la même liste dans les deux entrées, par construction.
        alternatives = "".join(
            f'<xhtml:link rel="alternate" hreflang="{escape_xml(code_langue)}" '
            f'href="{escape_xml(base + chemin_langue)}"/>'
            for code_langue, chemin_langue in langues.alternatives(chemin)
        ) if chemin else ""
        lines.append(
            f"  <url><loc>{escape_xml(url)}</loc>"
            f"{alternatives}"
            f"<changefreq>{changefreq}</changefreq>"
            f"<priority>{priority}</priority><mobile:mobile/></url>"
        )

    # Fiches missions publiques (ouvertes/en cours). Limite raisonnable :
    # sitemap de 10k URLs max — on sert les plus récentes.
    cursor = db.jobs.find(
        {"status": {"$in": ["open", "in_progress"]}, "deleted": {"$ne": True}},
        {"id": 1, "updated_at": 1},
    ).sort("created_at", -1).limit(9000)
    async for job in cursor:
        lines.append(
            f"  <url><loc>{escape_xml(base)}/jobs/{escape_xml(job['id'])}</loc>"
            f"<lastmod>{str(job.get('updated_at') or job.get('created_at') or '')[:10]}</lastmod>"
            f"<changefreq>daily</changefreq><priority>0.8</priority><mobile:mobile/></url>"
        )

    # Profils TRAVAILLEURS publics. Depuis le 20/10/2026, /workers/:id est une
    # page pré-rendue par le backend (rewrite Vercel /workers/(.*)) : sans
    # entrée ici, elle ne serait découverte que par un lien entrant — c'est-à-
    # dire, en pratique, jamais. Seuls les profils qui publient un NOM sont
    # listés (une page sans nom n'a rien à indexer), les plus récents d'abord.
    # Limite : le sitemap reste sous les 50 000 URL du format, missions
    # comprises.
    curseur = db.users.find(
        {
            "user_type": "worker",
            "deleted": {"$ne": True},
            "first_name": {"$nin": [None, ""]},
        },
        {"id": 1, "_id": 1, "created_at": 1},
    ).sort("created_at", -1).limit(4000)
    async for worker in curseur:
        # `identifiant_public` : un compte importé peut ne porter que `_id`, et
        # un identifiant vide ne désignerait aucune page.
        identifiant = identifiant_public(worker)
        if not identifiant:
            continue
        lines.append(
            f"  <url><loc>{escape_xml(base)}/workers/{escape_xml(identifiant)}</loc>"
            f"<lastmod>{str(worker.get('created_at') or '')[:10]}</lastmod>"
            f"<changefreq>weekly</changefreq><priority>0.6</priority><mobile:mobile/></url>"
        )

    lines.append("</urlset>")
    body = "\n".join(lines)
    # Le VOLUME SERVI, decompose en ce que la DECLARATION compte et ce que la
    # BASE ajoute. Mesure du 02/11/2026 : `/health` declarait 80 pages et ce
    # sitemap en servait 85 (quatre profils travailleur, une fiche de mission),
    # sans qu'aucun champ ne dise d'ou venait l'ecart — un lecteur ne pouvait
    # pas distinguer une famille non declaree d'une dette. Ces trois en-tetes
    # rendent l'ecart LISIBLE et BORNE ; `tests/test_langues_health.py` les
    # confronte au bloc `langues` de /health ET aux `<loc>` reellement servis.
    # Une fiche est `/jobs/<id>`, un profil `/workers/<id>` ; `/jobs` (la liste)
    # n'a pas de barre oblique finale et n'entre donc pas dans `vivantes`.
    total_servi = sum(1 for ligne in lines if "<loc>" in ligne)
    vivantes = sum(1 for ligne in lines if "/jobs/" in ligne or "/workers/" in ligne)
    # Cache court : les missions changent peu souvent, mais une fiche peut
    # être clôturée — on ne sert jamais une photo de plus de 1h.
    return Response(
        content=body,
        media_type="application/xml",
        headers={
            "Cache-Control": "public, max-age=3600, s-maxage=3600",
            "X-Kojo-Urls": str(total_servi),
            "X-Kojo-Urls-Declarees": str(total_servi - vivantes),
            "X-Kojo-Urls-Vivantes": str(vivantes),
        },
    )


async def servir(base: str) -> Response:
    """Le sitemap de `base`, servi une fois par minute (02/11/2026).

    Args:
        base: l'origine publique du site, sans barre oblique finale.

    Returns:
        Response: XML (text/xml) avec ses trois en-têtes de volume et le témoin
        `X-Kojo-Sitemap-Cache: frais|rejoue`.
    """
    async def _rendre() -> dict:
        construit = await _construire_sitemap(base)
        return {
            "corps": construit.body,
            "volumes": {nom: construit.headers[nom] for nom in ENTETES_VOLUME},
        }

    document, rejoue = await pages_cache.obtenir(("sitemap", "xml", base), _rendre)
    return Response(
        content=document["corps"],
        media_type="application/xml",
        headers={
            # Le crawler garde 1 h, le cache serveur 60 s : jamais plus vieux chez
            # nous que chez lui, et une fiche clôturée disparaît de la version
            # servie à la minute suivante.
            "Cache-Control": "public, max-age=3600, s-maxage=3600",
            **document["volumes"],
            "X-Kojo-Sitemap-Cache": "rejoue" if rejoue else "frais",
        },
    )
