# -*- coding: utf-8 -*-
"""Exposition Prometheus des compteurs DÉJÀ tenus par le produit.

POURQUOI CE MODULE. Les compteurs de panne existent depuis plus longtemps que ce
fichier — `bus_stats()`, `rate_limit_stats()`, `revocation_stats()`,
`partage_stats()` — mais ils n'étaient lisibles qu'en Python, par quelqu'un qui
savait déjà où regarder. Une dérive LENTE (replis Redis qui montent, reprises
d'abonnement qui s'accumulent, échecs de révocation) ne se voyait donc qu'en
ouvrant un shell : c'est exactement ce qu'un tableau de bord existe pour
remplacer. Ce module rend ces chiffres en TEXTE, sur une route, avec un jeton.

CE QUI EST EXPOSÉ, ET RIEN DE PLUS : les compteurs que les modules tiennent
déjà. Aucune mesure n'est inventée ici, et aucune requête n'est ajoutée au
chemin d'une requête utilisateur — `rendre()` ne lit que des dictionnaires en
mémoire et quelques constantes.

CE QUI N'EST PAS EXPOSÉ : aucune valeur LIBRE en étiquette. Une date ISO ou un
identifiant y créerait une série par valeur, donc une fuite de cardinalité que
Prometheus paie en mémoire. Les dates sortent en `..._timestamp_seconds`
(jauges), jamais en label — et il n'y a aujourd'hui aucun label du tout : ces
compteurs sont ceux du PROCESS, et Prometheus ajoute lui-même `instance`/`job`.

PROTECTION. Le jeton (`METRICS_TOKEN`, en-tête `Authorization: Bearer`) est
comparé en TEMPS CONSTANT. Son absence n'ouvre rien : la route répond 503
nommée plutôt que de publier la topologie interne à qui passe — un endpoint de
métriques ouvert est une surface aveugle de plus, pas une observation. La
collecte (scrape Prometheus, secret Fly, cadence) est DÉCLARÉE dans
`backend/METRIQUES.md`, et un test la relit pour qu'une famille ajoutée ici ne
puisse pas rester non documentée.

CE QUE CES CHIFFRES NE DISENT PAS : ils sont PAR PROCESS. Sur une machine à
plusieurs workers, un scrape ne voit que celui qui répond — le dépôt tourne à un
seul process (l'application refuse `WEB_CONCURRENCY > 1` sans `REDIS_URL`, et le
bus comme le registre de flux vivent dans Redis précisément pour ça).
"""
import hmac
import math
from datetime import datetime
from typing import List, Optional

from kojo_auth_core import revocation_stats
from kojo_live import (
    MAX_STREAMS_PER_USER,
    MAX_STREAMS_TOTAL,
    active_streams,
    bus_actif,
    bus_stats,
    comptes_satures,
    partage_stats,
    refus_stats,
)
from kojo_rate_limit import rate_limit_en_redis, rate_limit_stats
from kojo_scheduler import relance_stats
from kojo_settings import METRICS_TOKEN

# Chemin et type de contenu : ceux que Prometheus attend d'une cible HTTP.
# `version=0.0.4` est le format texte d'exposition ; Starlette n'ajoute pas de
# second `charset` puisque celui-ci y est déjà.
CHEMIN = "/metrics"
CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"
SCHEMA_AUTORISATION = "Bearer"


def jeton_attendu() -> str:
    """Jeton configuré sur CETTE machine — vide quand les métriques sont fermées."""
    return str(METRICS_TOKEN or "").strip()


def jeton_valide(entete: Optional[str]) -> bool:
    """Vrai si l'en-tête `Authorization` porte le jeton configuré.

    Comparaison en temps constant (`hmac.compare_digest`, comme la signature des
    webhooks) : une comparaison `==` laisse mesurer le préfixe correct octet par
    octet. Sans jeton configuré, rien n'est valide — la route refuse AVANT, mais
    cette fonction ne doit jamais devenir une porte ouverte si elle est appelée
    seule.

    Un en-tête non-ASCII est refusé sans lever : encodé en UTF-8, il ne peut de
    toute façon pas égaler un jeton (qui est de l'ASCII imprimable).
    """
    attendu = jeton_attendu()
    if not attendu or not entete:
        return False
    schema, separateur, presente = entete.partition(" ")
    if not separateur or schema.strip().lower() != SCHEMA_AUTORISATION.lower():
        return False
    return hmac.compare_digest(
        presente.strip().encode("utf-8", "ignore"),
        attendu.encode("utf-8", "ignore"),
    )


def _epoch(valeur) -> float:
    """Date (ISO ou epoch) → secondes epoch ; 0.0 si absente ou illisible.

    Une date illisible vaut 0 — « jamais » — et non « maintenant » : la dater
    d'office ferait croire à une panne récente qui n'a pas eu lieu.
    """
    if isinstance(valeur, bool):
        return 0.0
    if isinstance(valeur, (int, float)):
        return float(valeur) if math.isfinite(float(valeur)) else 0.0
    texte = str(valeur or "").strip()
    if not texte:
        return 0.0
    try:
        return datetime.fromisoformat(texte.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _nombre(valeur) -> str:
    """Valeur d'une jauge au format texte de Prometheus (bool → 1/0)."""
    if isinstance(valeur, bool):
        return "1" if valeur else "0"
    if isinstance(valeur, (int, float)):
        nombre = float(valeur)
        if not math.isfinite(nombre):
            return "0"
        return str(int(nombre)) if nombre.is_integer() else repr(nombre)
    return "0"


def _compteur(valeur) -> str:
    """Valeur d'un compteur : entier, jamais négatif (`reset` remet à zéro)."""
    try:
        nombre = int(valeur or 0)
    except (TypeError, ValueError):
        return "0"
    return str(max(0, nombre))


def rendre(corpus: Optional[dict] = None) -> str:
    """Texte d'exposition Prometheus (format texte 0.0.4).

    Une famille par chiffre : `# HELP` dit ce que le chiffre signifie quand il
    monte, `# TYPE` dit comment le lire (un compteur qui redescend est un bug,
    une jauge qui ne bouge pas n'en est pas un). Les valeurs viennent des
    accesseurs des modules propriétaires — aucune recopie d'état ici.

    `corpus` porte les chiffres que la BASE seule connaît (aujourd'hui le
    nombre de missions ouvertes). Il est calculé par la ROUTE, pas ici : ce
    module reste sans I/O, et un scrape ne dépend que d'une lecture faite une
    fois, au moment où le texte est rendu. Absent (tests unitaires, ou lecture
    en panne), la jauge n'est pas publiée — une valeur inventée à 0 se lirait
    comme une place de marché vide.
    """
    bus = bus_stats()
    partage = partage_stats()
    refus = refus_stats()
    limites = rate_limit_stats()
    revocation = revocation_stats()

    lignes: List[str] = []

    def compteur(nom: str, aide: str, valeur) -> None:
        lignes.append("# HELP %s %s" % (nom, aide))
        lignes.append("# TYPE %s counter" % nom)
        lignes.append("%s %s" % (nom, _compteur(valeur)))

    def jauge(nom: str, aide: str, valeur) -> None:
        lignes.append("# HELP %s %s" % (nom, aide))
        lignes.append("# TYPE %s gauge" % nom)
        lignes.append("%s %s" % (nom, _nombre(valeur)))

    # ── Bus temps réel (Redis pub/sub) ─────────────────────────────────────
    compteur(
        "kojo_live_bus_publies_total",
        "Evenements deposes par ce process, localement puis proposes au bus.",
        bus.get("publies"),
    )
    compteur(
        "kojo_live_bus_recus_total",
        "Evenements recus d'un AUTRE process par le bus.",
        bus.get("recus"),
    )
    compteur(
        "kojo_live_bus_echo_total",
        "Evenements ignores parce qu'ils venaient de ce process (anti-doublon).",
        bus.get("echo"),
    )
    compteur(
        "kojo_live_bus_illisibles_total",
        "Enveloppes de bus illisibles, ignorees et comptees.",
        bus.get("illisibles"),
    )
    compteur(
        "kojo_live_bus_repli_total",
        "Publications ou souscriptions du bus qui ont echoue puis ete retentees.",
        bus.get("repli"),
    )
    compteur(
        "kojo_live_bus_perdus_total",
        "Evenements perdus par le bus (tampon plein) — jamais l'evenement local.",
        bus.get("perdus"),
    )
    compteur(
        "kojo_live_bus_ecoutes_total",
        "Souscriptions du bus etablies, la premiere comprise.",
        bus.get("ecoutes"),
    )
    compteur(
        "kojo_live_bus_reprises_total",
        "Fenetres ou ce process n'ecoutait pas : la perte d'abonne est declaree.",
        bus.get("reprises"),
    )
    compteur(
        "kojo_live_bus_resyncs_total",
        "Relectures de reparation demandees sur les flux locaux.",
        bus.get("resyncs"),
    )
    jauge(
        "kojo_live_bus_actif",
        "1 si le bus partage est branche dans ce process (0 sinon).",
        bus_actif(),
    )

    # ── Flux SSE ───────────────────────────────────────────────────────────
    jauge(
        "kojo_live_flux_actifs",
        "Flux SSE ouverts dans ce process.",
        active_streams(),
    )
    jauge(
        "kojo_live_flux_plafond_processus",
        "Plafond de flux du process (MAX_STREAMS_TOTAL).",
        MAX_STREAMS_TOTAL,
    )
    jauge(
        "kojo_live_flux_plafond_compte",
        "Plafond de flux par compte (MAX_STREAMS_PER_USER).",
        MAX_STREAMS_PER_USER,
    )
    compteur(
        "kojo_live_flux_reserves_total",
        "Places de flux admises par le registre partage.",
        partage.get("reserves"),
    )
    compteur(
        "kojo_live_flux_refus_total",
        "Flux refuses par le registre partage (plafond du compte).",
        partage.get("refus"),
    )
    compteur(
        "kojo_live_flux_repli_total",
        "Admissions faites par le plafond LOCAL, registre partage injoignable.",
        partage.get("repli"),
    )
    # Un 503 de CAPACITE n'est pas une panne, c'est le produit qui se protege :
    # mais il ne se voyait nulle part. Les trois causes sont separees parce que
    # leur remede differe : le compte doit fermer des onglets, le process a
    # besoin d'une machine de plus, le registre partage compte les workers.
    compteur(
        "kojo_live_flux_refus_local_total",
        "Flux refuses par le plafond LOCAL du compte, avant le registre partage.",
        refus.get("compte_local"),
    )
    compteur(
        "kojo_live_flux_refus_processus_total",
        "Flux refuses parce que le process est au plafond MAX_STREAMS_TOTAL.",
        refus.get("processus"),
    )
    jauge(
        "kojo_live_comptes_satures",
        "Comptes ayant atteint MAX_STREAMS_PER_USER dans ce process.",
        comptes_satures(),
    )

    # ── Rate-limiter ───────────────────────────────────────────────────────
    compteur(
        "kojo_rate_limit_replis_total",
        "Bascules Redis vers memoire du rate-limiter.",
        limites.get("replis"),
    )
    jauge(
        "kojo_rate_limit_en_memoire",
        "1 si le rate-limiter est retombe en memoire apres une panne Redis.",
        limites.get("en_memoire", False),
    )
    jauge(
        "kojo_rate_limit_en_redis",
        "1 si les compteurs de limites sont partages par Redis EN CE MOMENT.",
        rate_limit_en_redis(),
    )
    jauge(
        "kojo_rate_limit_derniere_panne_timestamp_seconds",
        "Derniere bascule memoire du rate-limiter (0 = aucune).",
        _epoch(limites.get("derniere_panne")),
    )
    jauge(
        "kojo_rate_limit_alerte_envoyee_timestamp_seconds",
        "Derniere alerte proprietaire sur un repli memoire (0 = aucune).",
        _epoch(limites.get("alerte_envoyee_le")),
    )

    # ── Revocation de jeton (repli fail-open) ──────────────────────────────
    compteur(
        "kojo_revocation_verifications_total",
        "Verifications de revocation abouties (liste noire lue).",
        revocation.get("verifications"),
    )
    compteur(
        "kojo_revocation_echecs_total",
        "Verifications de revocation impossibles : jeton accepte sans liste noire.",
        revocation.get("echecs"),
    )
    jauge(
        "kojo_revocation_dernier_echec_timestamp_seconds",
        "Dernier echec de verification de revocation (0 = aucun).",
        _epoch(revocation.get("dernier_echec")),
    )

    # ── Relance client (le compteur du process, pas son effet) ─────────────
    # Ces deux-là disent ce que CE process a envoyé ; ils ne disent rien de ce
    # que les relances ont PRODUIT. L'effet (missions relancées ayant reçu une
    # candidature APRÈS la relance) se lit sur l'historique, dans
    # `GET /owner/relances/mesures` — un compteur qui monte ne prouve pas qu'il
    # sert, et c'est précisément la question posée à cette mesure.
    relances = relance_stats()
    compteur(
        "kojo_relances_envoyees_total",
        "Relances client envoyees par ce process (une par mission, apres le seuil).",
        relances.get("envoyees"),
    )
    compteur(
        "kojo_relances_echecs_total",
        "Relances dont l'envoi a echoue : la mission reste a relancer au passage suivant.",
        relances.get("echecs"),
    )

    # ── Corpus (lu en base par la route, jamais ici) ────────────────────────
    # C'est la mesure qui manquait le plus : le 23/10/2026 la production
    # comptait ZÉRO mission ouverte, et aucun tableau de bord ne le disait —
    # les sondes de SEO rendaient des prémisses pendant onze jours. Une place
    # de marché vide est un incident d'exploitation, et il se publie comme tel.
    if corpus is not None and corpus.get("missions_ouvertes") is not None:
        jauge(
            "kojo_missions_ouvertes",
            "Missions ouvertes en base (place de marche VIDE quand la valeur est 0).",
            corpus.get("missions_ouvertes"),
        )

    # Le format texte se termine par un saut de ligne : un corps sans lui est
    # encore lisible, mais un client strict peut refuser la derniere ligne.
    return "\n".join(lignes) + "\n"
