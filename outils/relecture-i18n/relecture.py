# -*- coding: utf-8 -*-
"""Relecture native assistée des dictionnaires de page (wolof, bambara, mooré).

Ce que ce module fait, et ce qu'il ne fait PAS.

Quatre cent soixante-treize clés de page sont traduites en trois langues dans
`frontend/src/utils/pack2PageI18n/*.js` (14 fichiers). Le MÉCANIQUE est refusé
par la CI : `i18nCoverage.test.js` (présence des clés),
`i18nScopeHygiene.test.js` (override identique au français) et
`i18nLanguePages.test.js` — ajouté le 02/11/2026 —, qui refuse un mot français
CERTAIN (adresse, tableau, bord, propriétaire, automatique, inscription,
bouton, fichier) dans une valeur de page et ne tolère que quatre cas de dette
motivée, dans les pages de diagnostic. Ce qu'aucun test ne peut prouver, c'est
le NATUREL : « Tablo - komision boroom bi » est-il du wolof qu'on parle ? C'est
le seul jugement que ce module prépare, et il ne le rend pas lui-même — une
equipe d'agents propose, un locuteur natif signe.

Trois couches, volontairement séparées :

  * l'EXTRACTION est déterministe (`exporter.mjs`) : elle importe les vrais
    modules et rend un JSON. Aucune regex sur du code source.
  * les INDICES sont déterministes aussi, et ce ne sont pas des verdicts : un
    mot français resté, un placeholder perdu, un chiffre qui a bougé, une
    longueur qui double. Ils servent à ORDONNER la relecture (on ne peut pas
    relire 1 419 valeurs dans une seule passe) et à informer l'agent, jamais à
    condamner une valeur — « du » est la négation du wolof, pas du français, et
    `profil`, `email`, `client` sont des emprunts que ces trois langues
    emploient dans des phrases parfaitement traduites.
  * la PROPOSITION est de l'équipe (crewai) : trois lexicographes relisent
    chacun sa langue, un vérificateur confronte au français, un arbitre tranche
    et nomme les doutes. Toute proposition repasse ensuite dans le validateur
    déterministe : une proposition qui perd un `{placeholder}`, change un
    chiffre ou remet une apostrophe droite est REFUSÉE et publiée dans
    `refusees.json`, pas silencieusement corrigée.

La règle qui tient tout : `frontend/src/**` n'est JAMAIS écrit. La sortie va
dans `outils/relecture-i18n/sortie/`, un humain relit, et c'est lui qui applique.
Le fichier `frontend/src/i18n/alertes-emploi-revue-native.md` reste « NON SIGNÉ »
tant qu'un locuteur n'a pas tranché.

Pourquoi hors de `backend/` : `crewai` tire chromadb, lancedb, opentelemetry,
instructor et le SDK openai. L'image Fly de l'API n'a rien à y gagner, et
`requirements.txt` est audité par la CI. Ce module n'importe crewai qu'au
moment d'exécuter l'équipe (`--plan`, `--executer`) : `--verifier` tourne sans
crewai, sans pydantic et sans jeton.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

RACINE = Path(__file__).resolve().parents[2]
DICTIONNAIRES = RACINE / "frontend" / "src" / "utils" / "pack2PageI18n"
EXPORTEUR = Path(__file__).with_name("exporter.mjs")
SORTIE_DEFAUT = Path(__file__).with_name("sortie")
REVUE_NATIVE = RACINE / "frontend" / "src" / "i18n" / "alertes-emploi-revue-native.md"

LANGUES = ("wo", "bm", "mos")
NOM_LANGUE = {"wo": "wolof", "bm": "bambara", "mos": "mooré"}

# Le DÉFAUT est le modèle MESURÉ en production le 27/10/2026 (200 en 0,6 s en
# français, ~0,029 $/M de jetons d'entrée). `claude-haiku-4-5` rend 400 sur ce
# gateway et un modèle gratuit se met en file — c'est écrit dans AGENTS.md.
MODELE_DEFAUT = "mistralai/mistral-nemo"

# Le plafond n'est pas une politesse : `kojo_ai_budget` borne la dépense du
# service en production, mais rien ne bornerait un lancement local qui enverrait
# 1 419 valeurs d'un coup.
PLAFOND_CARACTERES_DEFAUT = 300_000

PLACEHOLDER = re.compile(r"\{(\w+)\}")
CHIFFRES = re.compile(r"\d+(?:[.,]\d+)?")
MOT = re.compile(r"[^\W\d_]+", re.UNICODE)

# La liste des valeurs qu'un test déclare déjà légitimes (`EXCEPTIONS` de
# `i18nLangue.test.js`) est LUE là-bas, jamais recopiée : un nom propre ajouté
# d'un côté ne doit pas devenir un indice de l'autre.
LISTE_EXCEPTIONS = RACINE / "frontend" / "src" / "utils" / "__tests__" / "i18nLangue.test.js"
EXCEPTION_LIGNE = re.compile(r"^\s*\['((?:[^'\\]|\\.)*)',\s*'([^']+)'\]\s*,?\s*$")

# Codes et unités qui s'écrivent pareil dans les trois langues : une valeur qui
# ne contient QUE cela (et des placeholders) n'a rien à traduire, et proposer
# une « traduction » de `{min} - {max} XOF` ne ferait que casser un gabarit.
NEUTRES = {"XOF", "FCFA", "EUR", "USD", "ID", "PIN", "SMS", "PDF", "USSD", "API", "KOJO"}

# Mots dont le français est CERTAIN dans une phrase wolof/bambara/mooré : ils
# nomment une notion que ces trois langues disent autrement, et les onze
# valeurs corrigées le 02/11/2026 venaient tous de là.
MOTS_FRANCAIS = {
    "adresse": "ces langues disent « email » seul, jamais « adresse email »",
    "tableau": "« tableau de bord » n'a pas de traduction partielle",
    "bord": "idem : la locution entière est française",
    "propriétaire": "trois formes existent déjà (boroom, tigi, soabã)",
    "automatique": "adjectif français ; le wolof dit « ci boppam »",
    "inscription": "la langue dit « bindu » (wo) / « s'inscrire » (bm)",
    "fichier": "« fichier » est français ; l'emprunt n'est pas attesté ici",
    "bouton": "« bouton » est français ; l'interface dit « butoŋ » (bm)",
}

# Emprunts ASSUMÉS : présents dans des valeurs parfaitement traduites, donc un
# indice, jamais une faute. Les agents reçoivent la liste pour ne pas les
# « corriger » et dégrader une phrase correcte.
EMPRUNTS = {
    "profil", "email", "client", "commission", "compte", "paiement", "code",
    "pin", "wallet", "notification", "dashboard", "service", "message", "photo",
}

# Pièges mesurés : des mots qui RESSEMBLENT à du français sans en être.
PIEGES = {
    "du": "négation du wolof (« du dellu » = ne revient pas), pas l'article français",
    "bi": "déterminant wolof, pas le français « bis »",
    "ci": "préposition wolof (« ci » = dans/sur)",
    "na": "marque du wolof, pas le français « na »",
    "la": "locatif bambara/wolof",
    "ka": "marque du bambara, pas le français « ça »",
}


# --------------------------------------------------------------------------
# Normalisation et indices
# --------------------------------------------------------------------------

def normaliser(texte: str) -> str:
    """Compare deux textes sans se laisser arrêter par la casse ni les accents."""
    decompose = unicodedata.normalize("NFD", str(texte or ""))
    sans_accent = "".join(c for c in decompose if unicodedata.category(c) != "Mn")
    return " ".join(sans_accent.lower().split())


def _mots(texte: str) -> list[str]:
    return [m.lower() for m in MOT.findall(str(texte or ""))]


def lire_exceptions(chemin: Path = LISTE_EXCEPTIONS) -> set[str]:
    """Les valeurs que `i18nLangue.test.js` déclare déjà légitimes.

    Si la forme de la déclaration change, on le DIT au lieu de rendre une liste
    vide en silence : une liste vide ferait remonter trente « copies du
    français » qui n'en sont pas, et personne ne saurait pourquoi.
    """
    if not chemin.exists():
        raise SystemExit(f"la déclaration des exceptions est introuvable : {chemin}")
    valeurs = {
        normaliser(m.group(1).replace("\\'", "'"))
        for m in (EXCEPTION_LIGNE.match(ligne) for ligne in chemin.read_text(encoding="utf-8").splitlines())
        if m
    }
    if len(valeurs) < 10:
        raise SystemExit(
            f"la forme de `EXCEPTIONS` a changé dans {chemin.name} "
            f"({len(valeurs)} entrée(s) lue(s)) : mettre à jour lire_exceptions"
        )
    return valeurs


def est_neutre(valeur: str) -> bool:
    """Vrai si la valeur ne porte aucun mot à traduire (codes, unités, symboles)."""
    reste = PLACEHOLDER.sub(" ", str(valeur or ""))
    lettres = set(_mots(reste))
    return not (lettres - {code.lower() for code in NEUTRES})


def indices(valeur: str, fr: str, en: str | None = None, exceptions: set[str] | None = None) -> list[str]:
    """Les signaux qui justifient de relire cette valeur EN PREMIER.

    Ce ne sont pas des fautes : aucun de ces indices ne condamne une valeur, et
    l'équipe a le droit de conclure « rien à changer ». Ils sont ordonnés du
    plus lourd au plus léger, dans un ordre stable pour que la sortie soit
    diff-able d'une passe à l'autre.
    """
    trouves: list[str] = []
    mots = _mots(valeur)
    exceptions = exceptions if exceptions is not None else _exceptions()
    neutre = est_neutre(valeur) or normaliser(valeur) in exceptions

    perdus = sorted(set(PLACEHOLDER.findall(str(fr or ""))) - set(PLACEHOLDER.findall(valeur)))
    ajoutes = sorted(set(PLACEHOLDER.findall(valeur)) - set(PLACEHOLDER.findall(str(fr or ""))))
    if perdus:
        trouves.append("placeholder perdu : " + ", ".join("{" + p + "}" for p in perdus))
    if ajoutes:
        trouves.append("placeholder ajouté : " + ", ".join("{" + p + "}" for p in ajoutes))

    chiffres_fr = CHIFFRES.findall(str(fr or ""))
    chiffres_valeur = CHIFFRES.findall(valeur)
    if chiffres_fr != chiffres_valeur:
        trouves.append(
            "chiffres divergents : "
            + " ".join(chiffres_fr or ["aucun"])
            + " → "
            + " ".join(chiffres_valeur or ["aucun"])
        )

    for mot in sorted(set(mots)):
        if mot in MOTS_FRANCAIS and not neutre:
            trouves.append(f"français : « {mot} » — {MOTS_FRANCAIS[mot]}")

    if neutre:
        pass
    elif normaliser(valeur) == normaliser(fr) and normaliser(fr) != "":
        trouves.append("copie du français")
    elif en and normaliser(valeur) == normaliser(en) and normaliser(en) != normaliser(fr):
        trouves.append("copie de l'anglais")

    if "'" in valeur:
        trouves.append("apostrophe droite : le dépôt emploie « ’ »")

    # Seul l'ALLONGEMENT est un indice. Mesuré le 02/11/2026 : une valeur
    # bambara plus courte que le français est la règle, pas l'anomalie
    # (« Bɔli ma kɛ. » pour « La suppression a échoué »), et la signaler
    # remplissait le lot de phrases justes. Le raccourcissement part donc en
    # note pour l'agent, pas en indice de priorité.
    if len(valeur) > 2.2 * max(len(fr), 1) and len(fr) > 20:
        trouves.append("longueur : plus du double du français")

    # Les emprunts et les pièges ne sont pas dans `indices` : ils n'ordonnent
    # rien. Ils partent dans le prompt, où l'agent en a besoin pour ne pas
    # « corriger » une phrase juste.
    return trouves


def note_pour_agent(valeur: str, fr: str = "") -> list[str]:
    """Ce que l'agent doit savoir AVANT de proposer, et qui n'est pas un indice."""
    notes: list[str] = []
    mots = set(_mots(valeur))
    emprunts = sorted(mots & EMPRUNTS)
    if emprunts:
        notes.append(
            "emprunts assumés (ne pas les traduire sans certitude) : " + ", ".join(emprunts)
        )
    if fr and len(valeur) < 0.45 * max(len(fr), 1) and len(fr) > 30:
        notes.append(
            "plus courte que le français : c'est normal dans ces langues, ne pas rallonger"
        )
    pieges = sorted(mots & set(PIEGES))
    if pieges:
        notes.append(
            "pièges : "
            + " ; ".join(f"« {p} » = {PIEGES[p]}" for p in pieges)
        )
    return notes


# --------------------------------------------------------------------------
# Validation d'une proposition — le garde qui ne dépend d'aucun modèle
# --------------------------------------------------------------------------

def valider_proposition(avant: str, apres: str, fr: str, en: str | None = None) -> list[str]:
    """Motifs de REFUS d'une proposition. Liste vide = elle peut être publiée.

    Un agent peut proposer une phrase meilleure qui casse la page : un
    `{firstName}` perdu s'affiche vide, un chiffre changé promet un autre
    montant, une apostrophe droite sort de la typographie du site. Ces trois
    fautes sont mécaniquement détectables, donc elles ne sont jamais laissées
    à l'appréciation du modèle.
    """
    refus: list[str] = []
    apres = str(apres or "")
    avant = str(avant or "")

    if not apres.strip():
        refus.append("valeur vide")
        return refus

    if apres == avant:
        refus.append("identique à la valeur actuelle (aucun apport)")

    manquants = sorted(set(PLACEHOLDER.findall(avant)) - set(PLACEHOLDER.findall(apres)))
    ajoutes = sorted(set(PLACEHOLDER.findall(apres)) - set(PLACEHOLDER.findall(avant)))
    if manquants:
        refus.append("placeholder perdu : " + ", ".join("{" + p + "}" for p in manquants))
    if ajoutes:
        refus.append("placeholder inventé : " + ", ".join("{" + p + "}" for p in ajoutes))

    if CHIFFRES.findall(avant) != CHIFFRES.findall(apres):
        refus.append(
            "chiffres modifiés : "
            + " ".join(CHIFFRES.findall(avant) or ["aucun"])
            + " → "
            + " ".join(CHIFFRES.findall(apres) or ["aucun"])
        )

    if "'" in apres and "'" not in avant:
        refus.append("apostrophe droite « ' » introduite")

    if normaliser(apres) == normaliser(fr) and normaliser(avant) != normaliser(fr):
        refus.append("recopie du français")

    if "\n" in apres and "\n" not in avant:
        refus.append("saut de ligne introduit (valeur affichée sur une ligne)")

    if len(avant) > 20 and len(apres) > 3 * len(avant):
        refus.append("triple la longueur de la valeur affichée")

    return refus


# --------------------------------------------------------------------------
# Extraction et sélection du lot
# --------------------------------------------------------------------------

_EXCEPTIONS: set[str] | None = None


def _exceptions() -> set[str]:
    global _EXCEPTIONS
    if _EXCEPTIONS is None:
        _EXCEPTIONS = lire_exceptions()
    return _EXCEPTIONS


@dataclass
class Valeur:
    fichier: str
    cle: str
    langue: str
    fr: str
    en: str | None
    valeur: str

    @property
    def signaux(self) -> list[str]:
        return indices(self.valeur, self.fr, self.en, _exceptions())

    def cle_complete(self) -> str:
        return f"{self.fichier}.{self.cle}"


def exporter() -> dict[str, Any]:
    """Lance `exporter.mjs` et rend son JSON. Une erreur de node est DITE."""
    if not EXPORTEUR.exists():
        raise SystemExit(f"exporteur introuvable : {EXPORTEUR}")
    resultat = subprocess.run(
        ["node", str(EXPORTEUR)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(RACINE),
    )
    if resultat.returncode != 0:
        detail = (resultat.stderr or "").strip().splitlines()
        raise SystemExit(
            "l'extraction a échoué (node) :\n" + "\n".join(detail[-6:] or ["aucun détail"])
        )
    try:
        return json.loads(resultat.stdout)
    except json.JSONDecodeError as erreur:
        raise SystemExit(f"l'extracteur n'a pas rendu du JSON : {erreur}") from erreur


def charger(chemin: Path | None = None) -> dict[str, Any]:
    """Charge un export existant, sinon en produit un."""
    if chemin:
        return json.loads(Path(chemin).read_text(encoding="utf-8"))
    return exporter()


def valeurs_de(export: dict[str, Any]) -> list[Valeur]:
    valeurs = [
        Valeur(
            fichier=str(v["fichier"]),
            cle=str(v["cle"]),
            langue=str(v["langue"]),
            fr=str(v["fr"]),
            en=None if v.get("en") is None else str(v["en"]),
            valeur=str(v["valeur"]),
        )
        for v in export.get("valeurs", [])
        if str(v.get("valeur") or "").strip()
    ]
    langues = tuple(export.get("langues") or LANGUES)
    return [v for v in valeurs if v.langue in langues]


def choisir_lot(
    valeurs: Sequence[Valeur],
    langues: Iterable[str] = LANGUES,
    max_par_langue: int = 40,
    fichiers: Iterable[str] | None = None,
) -> list[Valeur]:
    """Le lot à relire maintenant : les valeurs les plus signalées d'abord.

    Le tri est TOTAL (signaux, fichier, clé) : deux exécutions sur le même
    export rendent le même lot, donc un rapport est reproductible.
    """
    langues = tuple(langues)
    gardes = set(fichiers or ())
    retenus: list[Valeur] = []
    for langue in langues:
        candidates = [
            v for v in valeurs if v.langue == langue and (not gardes or v.fichier in gardes)
        ]
        candidates.sort(key=lambda v: (-len(v.signaux), v.fichier, v.cle))
        retenus.extend(candidates[: max(0, max_par_langue)])
    return retenus


def lexique(valeurs: Sequence[Valeur], langue: str, max_mots: int = 60) -> str:
    """Les mots que CETTE langue emploie déjà, du plus fréquent au plus rare.

    Sans lui, trois lexicographes différents proposeraient trois mots pour la
    même notion, et le dictionnaire perdrait la cohérence que la relecture du
    20/10/2026 avait justement rétablie (un même verbe pour « activer »).
    """
    frequences: dict[str, int] = {}
    for valeur in valeurs:
        if valeur.langue != langue:
            continue
        for mot in _mots(valeur.valeur):
            if len(mot) < 4 or mot.isdigit():
                continue
            if mot in MOTS_FRANCAIS:
                continue
            frequences[mot] = frequences.get(mot, 0) + 1
    classement = sorted(frequences.items(), key=lambda p: (-p[1], p[0]))[:max_mots]
    return " · ".join(mot for mot, _ in classement)


# --------------------------------------------------------------------------
# L'équipe
# --------------------------------------------------------------------------

ROLE_COMMUN = (
    "Tu relis des chaînes d'interface pour une place de marché d'artisans en "
    "Afrique de l'Ouest. Ces langues sont le wolof, le bambara et le mooré. "
    "Tu ne traduis jamais le français mot à mot : tu écris la phrase qu'un "
    "locuteur écrirait, avec le vocabulaire que le dictionnaire emploie déjà."
)


def _llm(factice: bool = False):
    """Construit le LLM du gateway NEON, ou refuse en nommant ce qui manque.

    `factice=True` n'est utilisé que par `--plan` : on assemble les agents et
    les tâches sans qu'aucun appel ne parte, donc sans jeton. Les valeurs
    factices ne peuvent pas atteindre un vrai service (hôte `.invalid`).
    """
    # crewai envoie des traces à `telemetry.crewai.com:4319` par défaut. Ce
    # dépôt déclare ses sous-traitants (`test_sous_traitants_politique.py`) :
    # une télémétrie non demandée n'a rien à y faire, donc on la coupe AVANT
    # l'import, et le plan n'attend pas un réseau qu'on n'utilise pas.
    os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("OTEL_SDK_DISABLED", "true")
    from crewai import LLM  # import paresseux : `--verifier` n'a pas besoin de crewai

    base = os.environ.get("NEON_AI_GATEWAY_BASE_URL", "").strip()
    jeton = os.environ.get("NEON_AI_GATEWAY_TOKEN", "").strip()
    modele = os.environ.get("NEON_AI_GATEWAY_MODEL", MODELE_DEFAUT).strip() or MODELE_DEFAUT

    manquants = [
        nom
        for nom, valeur in (
            ("NEON_AI_GATEWAY_BASE_URL", base),
            ("NEON_AI_GATEWAY_TOKEN", jeton),
        )
        if not valeur
    ]
    if manquants and not factice:
        raise SystemExit(
            "l'équipe ne peut pas être lancée sans le gateway : "
            + ", ".join(manquants)
            + " absent(s) de l'environnement. `--verifier` et `--plan` fonctionnent sans jeton."
        )
    if manquants:
        base = base or "https://gateway.invalid/v1"
        jeton = jeton or "plan-sans-jeton"

    # `custom_openai=True` route vers le client OpenAI-compatible en gardant
    # l'identifiant EXACT du modèle (`mistralai/mistral-nemo`). Sans lui,
    # crewai tenterait LiteLLM pour un préfixe inconnu, et LiteLLM n'est pas
    # une dépendance de ce paquet.
    return LLM(
        model=modele,
        custom_openai=True,
        base_url=base,
        api_key=jeton,
        temperature=0.2,
    )


def _modeles():
    """Schémas pydantic de la sortie — construits ici pour rester optionnels."""
    from typing import Literal

    from pydantic import BaseModel, Field

    class Proposition(BaseModel):
        fichier: str = Field(description="le scope du dictionnaire, ex. register")
        cle: str = Field(description="la clé traduite, ex. duplicateEmailError")
        langue: str = Field(description="wo, bm ou mos")
        texte: str = Field(description="la valeur proposée, prête à être publiée")
        motif: str = Field(description="pourquoi, en une phrase, sans jargon")
        confiance: Literal["haute", "moyenne", "basse"]

    class Doute(BaseModel):
        langue: str
        cle: str = Field(description="fichier.cle, ou la clé seule si le doute est général")
        question: str = Field(description="ce qu'un locuteur natif doit trancher")

    class Relecture(BaseModel):
        propositions: list[Proposition] = Field(default_factory=list)
        doutes: list[Doute] = Field(default_factory=list)

    return Proposition, Doute, Relecture


def _bloc_valeurs(lot: Sequence[Valeur], langue: str) -> str:
    """Le lot d'une langue, en JSONL : le format qu'un modèle lit le mieux."""
    lignes = []
    for valeur in lot:
        if valeur.langue != langue:
            continue
        lignes.append(
            json.dumps(
                {
                    "fichier": valeur.fichier,
                    "cle": valeur.cle,
                    "fr": valeur.fr,
                    "en": valeur.en,
                    "actuel": valeur.valeur,
                    "indices": valeur.signaux,
                    "notes": note_pour_agent(valeur.valeur, valeur.fr),
                },
                ensure_ascii=False,
            )
        )
    return "\n".join(lignes)


def construire_equipe(
    lot: Sequence[Valeur],
    toutes: Sequence[Valeur],
    modele: str | None = None,
    factice: bool = False,
):
    """Assemble les agents et les tâches. Rend `(crew, caracteres, appels)`."""
    from crewai import Agent, Crew, Process, Task

    Proposition, Doute, Relecture = _modeles()
    llm = _llm(factice=factice)
    langues = [langue for langue in LANGUES if any(v.langue == langue for v in lot)]

    agents_relecture = {}
    taches_relecture = []
    for langue in langues:
        nom = NOM_LANGUE[langue]
        agents_relecture[langue] = Agent(
            role=f"Lexicographe {nom}",
            goal=(
                f"Réécrire en {nom} les chaînes fautives du lot, avec le vocabulaire "
                f"que le dictionnaire emploie déjà, et signaler tout ce qui demande "
                f"l'arbitrage d'un locuteur natif."
            ),
            backstory=(
                f"{ROLE_COMMUN} Tu parles {nom} couramment. Tu sais qu'un mot qui "
                f"ressemble au français n'est pas forcément du français — « du » est "
                f"la négation du wolof, « profil » et « email » sont des emprunts "
                f"assumés. Tu préfères laisser une valeur intacte et poser un doute "
                f"plutôt que d'inventer une tournure."
            ),
            llm=llm,
            verbose=False,
            allow_delegation=False,
        )
        taches_relecture.append(
            Task(
                description=(
                    f"Relis ces valeurs en {nom}. Chaque ligne est un objet JSON :\n"
                    f"{{fichier, cle, fr, en, actuel, indices, notes}}.\n\n"
                    f"Lexique déjà employé par le dictionnaire en {nom} :\n"
                    f"{lexique(toutes, langue)}\n\n"
                    f"Valeurs à relire :\n{_bloc_valeurs(lot, langue)}\n\n"
                    f"Règles :\n"
                    f"- ne propose une réécriture QUE si la phrase actuelle est fautive, "
                    f"ambiguë ou non naturelle en {nom} ; une valeur juste se laisse telle quelle ;\n"
                    f"- garde EXACTEMENT les {{placeholders}} et les chiffres ;\n"
                    f"- emploie l'apostrophe typographique « ’ », jamais « ' » ;\n"
                    f"- reste sur une seule ligne, de longueur comparable à l'actuelle ;\n"
                    f"- n'invente aucun nom propre ni nom de marque ;\n"
                    f"- si tu hésites entre deux tournures, choisis la plus sûre et "
                    f"ajoute un doute qui dit ce qu'un locuteur doit trancher.\n\n"
                    f"Rends un objet JSON avec les clés `propositions` et `doutes`, "
                    f"sans texte autour."
                ),
                expected_output=(
                    "Un JSON {propositions: [...], doutes: [...]} où chaque proposition "
                    "porte fichier, cle, langue, texte, motif et confiance."
                ),
                agent=agents_relecture[langue],
            )
        )

    verificateur = Agent(
        role="Vérificateur de fidélité",
        goal=(
            "Confronter chaque proposition au français d'origine et refuser celles "
            "qui changent le sens, perdent une variable ou inventent une promesse."
        ),
        backstory=(
            f"{ROLE_COMMUN} Tu ne parles pas nécessairement les trois langues, et tu "
            f"ne prétends pas le faire : tu juges la FIDÉLITÉ — le français promet-il "
            f"la même chose ? le placeholder est-il là ? le chiffre est-il le même ? "
            f"la phrase dit-elle au lecteur ce que le bouton fait ?"
        ),
        llm=llm,
        verbose=False,
        allow_delegation=False,
    )
    tache_verification = Task(
        description=(
            "Reprends les propositions des lexicographes. Pour chacune, compare au "
            "`fr` de la valeur d'origine : sens, promesse, montant, placeholder, "
            "longueur d'affichage. Refuse celles qui changent le sens ou le chiffre, "
            "et garde les autres. Rends le JSON consolidé {propositions, doutes}."
        ),
        expected_output="Le même JSON, filtré, avec la liste des refus motivés en doutes.",
        agent=verificateur,
        context=taches_relecture,
    )

    arbitre = Agent(
        role="Arbitre de la relecture",
        goal=(
            "Rendre une liste unique de propositions, sans doublon, avec une "
            "confiance honnête et des doutes numérotables pour un locuteur natif."
        ),
        backstory=(
            f"{ROLE_COMMUN} Ton défaut n'est pas de trancher, c'est de DIRE quand tu "
            f"ne sais pas. Une proposition à confiance basse qui reste dans la liste "
            f"doit venir avec son doute ; sinon elle sort."
        ),
        llm=llm,
        verbose=False,
        allow_delegation=False,
    )
    tache_arbitrage = Task(
        description=(
            "Consolide la relecture vérifiée. Dédoublonne (une proposition par "
            "fichier.cle.langue), garde la meilleure, et rends au plus 40 propositions. "
            "Chaque doute doit être une QUESTION qu'un locuteur natif peut trancher, "
            "pas un constat vague. N'ajoute aucune proposition que le vérificateur "
            "n'a pas vue."
        ),
        expected_output="Un objet Relecture : propositions à confiance graduée + doutes.",
        agent=arbitre,
        context=[tache_verification],
        output_pydantic=Relecture,
    )

    crew = Crew(
        agents=[*agents_relecture.values(), verificateur, arbitre],
        tasks=[*taches_relecture, tache_verification, tache_arbitrage],
        process=Process.sequential,
        verbose=False,
    )
    caracteres = sum(
        len(t.description) + len(t.expected_output or "") for t in crew.tasks
    )
    appels = len(crew.tasks)
    return crew, caracteres, appels


# --------------------------------------------------------------------------
# Sortie
# --------------------------------------------------------------------------

def numero_doute_suivant(chemin: Path = REVUE_NATIVE) -> int:
    """Numérote la suite des doutes du fichier de revue, sans repartir de 1."""
    if not chemin.exists():
        return 1
    numeros = [int(n) for n in re.findall(r"(?m)^\s*(\d+)\.\s", chemin.read_text(encoding="utf-8"))]
    return (max(numeros) + 1) if numeros else 1


def ecrire_sortie(
    dossier: Path,
    lot: Sequence[Valeur],
    propositions: Sequence[dict[str, Any]],
    doutes: Sequence[dict[str, Any]],
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Écrit les quatre fichiers de sortie. N'écrit RIEN dans `frontend/src`."""
    dossier = Path(dossier)
    dossier.mkdir(parents=True, exist_ok=True)

    par_cle = {(v.fichier, v.cle, v.langue): v for v in lot}
    validees: list[dict[str, Any]] = []
    refusees: list[dict[str, Any]] = []

    for proposition in propositions:
        cle = (
            str(proposition.get("fichier", "")),
            str(proposition.get("cle", "")),
            str(proposition.get("langue", "")),
        )
        origine = par_cle.get(cle)
        if origine is None:
            refusees.append(
                {
                    **proposition,
                    "refus": ["valeur hors du lot envoyé (l'agent a inventé une clé)"],
                }
            )
            continue
        motifs = valider_proposition(
            origine.valeur, str(proposition.get("texte", "")), origine.fr, origine.en
        )
        if motifs:
            refusees.append(
                {
                    "fichier": origine.fichier,
                    "cle": origine.cle,
                    "langue": origine.langue,
                    "avant": origine.valeur,
                    "apres": proposition.get("texte", ""),
                    "motif_agent": proposition.get("motif", ""),
                    "refus": motifs,
                }
            )
        else:
            validees.append(
                {
                    "fichier": origine.fichier,
                    "cle": origine.cle,
                    "langue": origine.langue,
                    "avant": origine.valeur,
                    "apres": proposition.get("texte", ""),
                    "motif": proposition.get("motif", ""),
                    "confiance": proposition.get("confiance", "basse"),
                    "signaux": origine.signaux,
                }
            )

    differences = {
        "genere_le": meta.get("genere_le"),
        "modele": meta.get("modele"),
        "compte": {
            "lot": len(lot),
            "propositions_recues": len(propositions),
            "validees": len(validees),
            "refusees": len(refusees),
            "doutes": len(doutes),
        },
        "note": (
            "Propositions NON APPLIQUÉES. `frontend/src/**` n'a pas été modifié : "
            "un locuteur natif relit, tranche, puis applique."
        ),
        "propositions": validees,
    }
    (dossier / "differences.json").write_text(
        json.dumps(differences, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (dossier / "refusees.json").write_text(
        json.dumps({"genere_le": meta.get("genere_le"), "refusees": refusees},
                   ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    premier = numero_doute_suivant()
    date = datetime.now(timezone.utc).strftime("%d/%m/%Y")
    titre_doutes = (
        f"doute n° {premier}"
        if len(doutes) <= 1
        else f"doutes n° {premier} à {premier + len(doutes) - 1}"
    )
    bloc = [
        f"## Relecture assistée du {date} — {titre_doutes}",
        "",
        (
            "Ces doutes viennent d'une équipe d'agents, pas d'un locuteur natif. "
            "Ils sont NUMÉROTÉS dans la suite du fichier ; la signature reste à faire."
        ),
        "",
    ]
    if not doutes:
        bloc.append("_Aucun doute posé sur ce lot._")
    for position, doute in enumerate(doutes):
        bloc.append(
            f"{premier + position}. **{NOM_LANGUE.get(str(doute.get('langue')), doute.get('langue'))}"
            f", `{doute.get('cle')}`** — {doute.get('question')}"
        )
    bloc.append("")
    (dossier / "doutes.md").write_text("\n".join(bloc), encoding="utf-8")

    rapport = [
        f"# Rapport de relecture — {meta.get('genere_le')}",
        "",
        f"- Modèle : `{meta.get('modele')}`",
        f"- Lot envoyé : **{len(lot)}** valeur(s) — {meta.get('caracteres', 0)} caractères, "
        f"{meta.get('appels', 0)} appel(s) au gateway",
        f"- Propositions reçues : **{len(propositions)}**",
        f"- Validées mécaniquement : **{len(validees)}**",
        f"- Refusées par le validateur : **{len(refusees)}**",
        f"- Doutes : **{len(doutes)}**",
        "",
        "## Ce que ce rapport ne dit pas",
        "",
        "- Il ne dit pas que la traduction est JUSTE : un modèle ne remplace pas un locuteur.",
        "- Il ne dit pas que les valeurs hors lot sont conformes : seul le lot est jugé.",
        "- Il n'a modifié aucun fichier de `frontend/src` : les propositions sont des données.",
        "",
    ]
    (dossier / "rapport.md").write_text("\n".join(rapport), encoding="utf-8")

    return differences["compte"]


# --------------------------------------------------------------------------
# Ligne de commande
# --------------------------------------------------------------------------

def _utf8() -> None:
    """Force UTF-8 sur les flux : la console Windows ne sait pas écrire « ŋ ».

    Mesuré le 02/11/2026 sur cp1252 : `UnicodeEncodeError` sur la première
    valeur bambara venue, donc une revue qui s'arrête au premier `ŋ`.
    """
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):  # flux déjà encodé différemment
            pass


def _liste(texte: str) -> list[str]:
    return [morceau.strip() for morceau in str(texte or "").split(",") if morceau.strip()]


def main(argv: Sequence[str] | None = None) -> int:
    analyseur = argparse.ArgumentParser(
        description="Relecture native assistée des dictionnaires de page (wo, bm, mos)."
    )
    analyseur.add_argument(
        "--verifier",
        action="store_true",
        help="mode par défaut : exporte, ordonne et affiche le lot, sans appeler aucun modèle",
    )
    analyseur.add_argument("--plan", action="store_true", help="assemble l'équipe sans l'exécuter")
    analyseur.add_argument("--executer", action="store_true", help="lance la relecture réelle")
    analyseur.add_argument("--langues", default=",".join(LANGUES))
    analyseur.add_argument("--fichiers", default="")
    analyseur.add_argument("--max", type=int, default=40, help="valeurs par langue (0 = toutes)")
    analyseur.add_argument("--sortie", default=str(SORTIE_DEFAUT))
    analyseur.add_argument("--valeurs", default="", help="réutilise un export JSON existant")
    analyseur.add_argument("--plafond-caracteres", type=int, default=PLAFOND_CARACTERES_DEFAUT)

    _utf8()
    options = analyseur.parse_args(argv)
    langues = tuple(_liste(options.langues)) or LANGUES
    inconnues = [langue for langue in langues if langue not in LANGUES]
    if inconnues:
        raise SystemExit(f"langue(s) inconnue(s) : {', '.join(inconnues)}")

    export = charger(Path(options.valeurs) if options.valeurs else None)
    toutes = valeurs_de(export)
    if not toutes:
        raise SystemExit("aucune valeur extraite : l'extracteur n'a rien rendu")

    lot = choisir_lot(
        toutes,
        langues=langues,
        max_par_langue=10_000 if options.max == 0 else options.max,
        fichiers=_liste(options.fichiers) or None,
    )
    if not lot:
        raise SystemExit("lot vide : aucun fichier ou aucune langue ne correspond")

    signalees = sum(1 for valeur in lot if valeur.signaux)

    if not options.plan and not options.executer:
        print(
            f"{len(lot)} valeur(s) sélectionnée(s) sur {len(toutes)} "
            f"({signalees} porteuse(s) d'au moins un indice) — rien n'a été envoyé."
        )
        for langue in langues:
            du_lot = [v for v in lot if v.langue == langue]
            print(f"\n{NOM_LANGUE[langue]} : {len(du_lot)} valeur(s)")
            for valeur in du_lot[:15]:
                marque = "; ".join(valeur.signaux) or "aucun indice"
                print(f"  - {valeur.cle_complete()} : « {valeur.valeur} » [{marque}]")
            if len(du_lot) > 15:
                print(f"  … et {len(du_lot) - 15} autre(s)")
        print(
            "\nPour relire réellement : --plan (assemble, n'appelle rien) "
            "ou --executer (appelle le gateway)."
        )
        return 0

    crew, caracteres, appels = construire_equipe(lot, toutes, factice=options.plan)
    if caracteres > options.plafond_caracteres:
        raise SystemExit(
            f"refus : {caracteres} caractères dépassent le plafond de "
            f"{options.plafond_caracteres}. Réduire --max, ou relever le plafond en connaissance."
        )

    print(
        f"équipe assemblée : {len(crew.agents)} agents, {len(crew.tasks)} tâches, "
        f"{caracteres} caractères, {appels} appel(s) — lot de {len(lot)} valeur(s)"
    )
    if options.plan:
        for tache in crew.tasks:
            print(f"  · {tache.agent.role} : {tache.description.splitlines()[0][:90]}…")
        print("plan seulement : rien n'a été envoyé au gateway.")
        return 0

    resultat = crew.kickoff()
    modele = os.environ.get("NEON_AI_GATEWAY_MODEL", MODELE_DEFAUT) or MODELE_DEFAUT

    sortie = getattr(resultat, "pydantic", None)
    if sortie is None:
        raise SystemExit("l'arbitre n'a pas rendu de sortie structurée : rien n'est publié")
    propositions = [p.model_dump() for p in getattr(sortie, "propositions", [])]
    doutes = [d.model_dump() for d in getattr(sortie, "doutes", [])]

    compte = ecrire_sortie(
        Path(options.sortie),
        lot,
        propositions,
        doutes,
        {
            "genere_le": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "modele": modele,
            "caracteres": caracteres,
            "appels": appels,
        },
    )
    print(json.dumps(compte, ensure_ascii=False))
    print(f"sortie écrite dans {options.sortie} — rien n'a été appliqué à frontend/src")
    return 0


if __name__ == "__main__":
    sys.exit(main())
