# -*- coding: utf-8 -*-
"""L'ÉQUILIBRE DES BALISES du HTML que sert le BACKEND — la même règle que le
frontend, portée en Python.

POURQUOI. Le frontend refuse une coquille pré-rendue dont une balise ne se
referme pas (frontend/vite-plugins/prerender/balises.js) : un `</div>` manquant
est invisible à toute sonde de NAVIGATEUR, parce que le parseur HTML le répare
en silence. Le même défaut peut sortir du backend — la fiche mission
(/api/og/jobs/{id}) est lue par les crawlers de partage, qui ne font que LIRE le
document. Ce module applique donc au HTML du backend la règle que le frontend
applique au sien, et le refus nomme la balise fautive.

FRONTIÈRE. Module stdlib pur : il est importé par kojo_job_og.py, qui doit
rester importable par le job frontend (frontend/scripts/check-job-og-contract.js
lance `python3` sur ce dossier, sans FastAPI, sans MongoDB).

PARITÉ. La règle est la MÊME que celle du frontend, ligne à ligne. La preuve de
parité n'est pas une promesse : les deux implémentations lisent le même jeu de
cas (backend/tests/fixtures/balises_equilibre_cas.json, produit par la règle
JavaScript), et leurs deux tests le rejouent. Une divergence fait rougir l'un
des deux, en nommant le cas.

Les longueurs et les coupes d'extrait se comptent en UNITÉS UTF-16, comme en
JavaScript : un émoji compte pour deux, et un extrait coupé au milieu d'une
paire donne la même chaîne des deux côtés.
"""

import re

# Éléments HTML sans balise fermante (jamais empilés).
BALISES_VIDES = frozenset(
    "area base br col embed hr img input link meta param source track wbr".split()
)

# Éléments dont le contenu est du TEXTE, jamais du balisage.
BALISES_A_TEXTE_BRUT = frozenset(["script", "style", "textarea", "title"])

# Tête d'une balise : `</div`, `<div`, `<svg:path`…
TETE_DE_BALISE = re.compile(r"^<(/?)([a-zA-Z][a-zA-Z0-9:._-]*)")

# Balise auto-fermée : `/` puis `>` en fin de balise.
AUTO_FERMEE = re.compile(r"/\s*>\Z")

# Un extrait se lit debout : au-delà, il noie le refus au lieu de le préciser.
LONGUEUR_EXTRAIT = 120


class DesequilibreHtml(ValueError):
    """Le HTML publié par le backend porte une balise qui ne se referme pas."""


def _longueur_utf16(texte):
    """Longueur en unités de code UTF-16 (celle que compte JavaScript)."""
    return len(texte.encode("utf-16-le", "surrogatepass")) // 2


def _tronquer_utf16(texte, n):
    """Les `n` premières unités UTF-16 de `texte`, comme `slice(0, n)` en JS."""
    octets = texte.encode("utf-16-le", "surrogatepass")
    if len(octets) // 2 <= n:
        return texte
    return octets[: 2 * n].decode("utf-16-le", "surrogatepass")


def _extraire_brut(brut):
    """L'extrait d'une balise : tronqué à 120 unités, avec « … » si coupé."""
    if _longueur_utf16(brut) > LONGUEUR_EXTRAIT:
        return _tronquer_utf16(brut, LONGUEUR_EXTRAIT) + "…"
    return brut


def _fin_de_balise(texte, debut):
    """Index du `>` qui termine la balise, les guillemets d'attribut respectés."""
    guillemet = None
    for i in range(debut + 1, len(texte)):
        caractere = texte[i]
        if guillemet:
            if caractere == guillemet:
                guillemet = None
            continue
        if caractere in ('"', "'"):
            guillemet = caractere
            continue
        if caractere == ">":
            return i
    return -1


def desequilibres_des_balises(html):
    """Les balises du document qui ne s'équilibrent pas, dans l'ordre de lecture.

    Même contrat que la règle JavaScript : chaque problème est un dict avec
    `type` (non-fermee, fermee-en-portee, fermee-sans-ouverture, non-terminee),
    `balise`, `ligne`, `ligneFin`, `fermeePar` et `extrait`.
    """
    texte = str(html)
    problemes = []
    pile = []
    index = 0
    # La ligne est avancée de façon MONOTONE, comme côté JavaScript.
    ligne = 1
    curseur = 0

    def ligne_jusqua(position):
        nonlocal ligne, curseur
        ligne += texte.count("\n", curseur, position)
        curseur = position
        return ligne

    while index < len(texte):
        ouvrante = texte.find("<", index)
        if ouvrante == -1:
            break
        if texte.startswith("<!--", ouvrante):
            fin = texte.find("-->", ouvrante + 4)
            index = len(texte) if fin == -1 else fin + 3
            continue
        if texte.startswith("<!", ouvrante) or texte.startswith("<?", ouvrante):
            fin = texte.find(">", ouvrante)
            index = len(texte) if fin == -1 else fin + 1
            continue
        tete = TETE_DE_BALISE.match(texte[ouvrante : ouvrante + 80])
        if not tete:
            # Un `<` qui n'ouvre rien (comparaison, texte échappé à moitié) :
            # la lecture continue APRÈS lui.
            index = ouvrante + 1
            continue
        fin = _fin_de_balise(texte, ouvrante)
        if fin == -1:
            problemes.append(
                {
                    "type": "non-terminee",
                    "balise": tete.group(2).lower(),
                    "ligne": ligne_jusqua(ouvrante),
                    "ligneFin": None,
                    "fermeePar": None,
                    "extrait": _tronquer_utf16(texte[ouvrante:], LONGUEUR_EXTRAIT),
                }
            )
            break
        brut = texte[ouvrante : fin + 1]
        fermante = tete.group(1) == "/"
        nom = tete.group(2).lower()
        autofermee = AUTO_FERMEE.search(brut) is not None
        ligne_balise = ligne_jusqua(ouvrante)
        index = fin + 1

        if fermante:
            haut = pile[-1] if pile else None
            if haut and haut["balise"] == nom:
                pile.pop()
                continue
            rang = -1
            for i in range(len(pile) - 1, -1, -1):
                if pile[i]["balise"] == nom:
                    rang = i
                    break
            if rang == -1:
                problemes.append(
                    {
                        "type": "fermee-sans-ouverture",
                        "balise": nom,
                        "ligne": ligne_balise,
                        "ligneFin": None,
                        "fermeePar": None,
                        "extrait": _extraire_brut(brut),
                    }
                )
                continue
            # Le parseur referme les éléments restés ouverts : c'est LA façon
            # dont ce défaut se cache.
            for i in range(len(pile) - 1, rang, -1):
                problemes.append(
                    {
                        "type": "fermee-en-portee",
                        "balise": pile[i]["balise"],
                        "ligne": pile[i]["ligne"],
                        "ligneFin": ligne_balise,
                        "fermeePar": nom,
                        "extrait": _extraire_brut(pile[i]["extrait"]),
                    }
                )
            del pile[rang:]
            continue

        if nom in BALISES_VIDES or autofermee:
            continue
        pile.append({"balise": nom, "ligne": ligne_balise, "extrait": _extraire_brut(brut)})
        if nom in BALISES_A_TEXTE_BRUT:
            # Le contenu est du texte : on saute jusqu'à la fermeture, sans lire
            # un seul `<` de ce qu'il contient.
            reste = texte[index:].lower()
            fermeture = reste.find("</" + nom)
            if fermeture == -1:
                index = len(texte)
                continue
            index += fermeture

    for ouverte in pile:
        problemes.append(
            {
                "type": "non-fermee",
                "balise": ouverte["balise"],
                "ligne": ouverte["ligne"],
                "ligneFin": None,
                "fermeePar": None,
                "extrait": ouverte["extrait"],
            }
        )
    return problemes


def decrire_desequilibre(probleme):
    """Le problème écrit en clair, ou None s'il n'y en a pas."""
    if not probleme:
        return None
    ligne = f"ligne {probleme['ligne']}"
    extrait = f" — « {probleme['extrait']} »" if probleme.get("extrait") else ""
    if probleme["type"] == "non-fermee":
        return f"`<{probleme['balise']}>` ouvert {ligne} n'est JAMAIS refermé{extrait}"
    if probleme["type"] == "fermee-en-portee":
        return (
            f"`<{probleme['balise']}>` ouvert {ligne} est refermé en PORTÉE par "
            f"`</{probleme['fermeePar']}>` ligne {probleme['ligneFin']} au lieu de sa propre balise{extrait}"
        )
    if probleme["type"] == "fermee-sans-ouverture":
        return f"`</{probleme['balise']}>` {ligne} n'a AUCUNE ouverture{extrait}"
    return f"`<{probleme['balise']}>` ligne {probleme['ligne']} n'est pas terminé (aucun `>`){extrait}"


def exiger_balises_equilibrees(objet, html, *, origine="backend", maximum=3):
    """Le REFUS : un HTML déséquilibré n'est pas servi.

    Rend le document tel quel s'il tient, sinon lève DesequilibreHtml en NOMMANT
    la balise. `objet` dit de quoi il s'agit (« la fiche mission abc »), pour que
    le message se lise sans relire le document.
    """
    problemes = desequilibres_des_balises(html)
    if not problemes:
        return html
    details = " ; ".join(decrire_desequilibre(p) for p in problemes[:maximum])
    reste = f" (et {len(problemes) - maximum} autre(s))" if len(problemes) > maximum else ""
    raise DesequilibreHtml(
        f"{origine} : {objet} est DÉSÉQUILIBRÉ — {len(problemes)} balise(s) ne se referment pas : "
        f"{details}{reste}. Un document déséquilibré n'est PAS une erreur visible : le parseur le "
        "répare en silence, donc aucune sonde de navigateur ne peut le voir. Le défaut n'existe que "
        "pour qui LIT le document : un crawler de partage, un lecteur d'accessibilité."
    )
