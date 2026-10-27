# -*- coding: utf-8 -*-
"""Passerelle IA (Neon AI Gateway) — un seul credential pour les modèles.

L'assistant de /support répondait jusqu'ici par un questionnaire figé : ce
module est le SEUL endroit qui parle au modèle, pour que changer de modèle,
de branche Neon ou de fournisseur ne touche à rien d'autre.

Le gateway est un endpoint compatible OpenAI : l'hôte de branche
(`NEON_AI_GATEWAY_BASE_URL`, sans chemin) reçoit `/v1/chat/completions`, avec
le jeton Neon en `Authorization: Bearer`. Aucune clé de fournisseur n'existe
côté Kojo, et le jeton ne quitte JAMAIS le serveur : le navigateur n'appelle
que `/api/support/robot/chat` (voir `kojo_routers_support.robot_chat`).

Deux règles qui expliquent la forme de ce fichier :

  * `requests` est SYNCHRONE. L'appelant le sort de l'event loop
    (`asyncio.to_thread`, comme les appels PayDunya de
    `kojo_routers_payments`) : un POST réseau de 30 s dans une coroutine
    bloquerait tous les autres visiteurs du worker.
  * Le message d'erreur porte la CAUSE, jamais le jeton ni l'hôte : une erreur
    de gateway est fréquente (quota, modèle retiré du catalogue) et doit être
    diagnosticable depuis les journaux, sans fuiter de secret.
"""
import time
from datetime import datetime, timezone

import requests

from kojo_settings import (
    AI_GATEWAY_BASE_URL,
    AI_GATEWAY_MODEL,
    AI_GATEWAY_TIMEOUT_SECONDS,
    AI_GATEWAY_TOKEN,
    logger,
)

# Chemin du dialecte unifié, compatible avec TOUS les modèles du catalogue
# (le dialecte natif `/anthropic` ou `/openai` n'est utile que pour les
# fonctionnalités propres à un fournisseur — pensées étendues, cache de
# prompt — dont l'assistant support n'a pas besoin).
CHAT_COMPLETIONS_PATH = "/v1/chat/completions"

# Plafond ABSOLU d'un nouvel essai après troncature. Un modèle qui raisonne
# peut épuiser n'importe quelle borne sur une question longue : le nouvel essai
# ne doit donc pas être « la même borne, une fois de plus », mais une borne
# doublée ET bornée, sinon un raisonnement en boucle ferait payer l'attente
# sans jamais rendre de réponse.
PLAFOND_JETONS_MAX = 4096


class AiGatewayError(RuntimeError):
    """Échec d'un appel au gateway (réseau, statut HTTP, réponse inexploitable).

    Type PROPRE au module : l'appelant décide du statut HTTP (502), sans
    inspecter le message ni confondre une panne du gateway avec un bug du
    handler.
    """


# ── L'ÉTAT DU DERNIER APPEL, PUBLIÉ PAR /health ────────────────────────────
#
# Pourquoi ce bloc existe, et ce qu'il a coûté de ne pas l'avoir : mesuré le
# 27/10/2026, `POST /api/support/robot/chat` a rendu **502 en une seconde, cinq
# fois sur cinq**, pendant que la sonde quotidienne était rouge depuis la veille.
# Le code journalisait la cause (`gateway HTTP <statut> : <corps>`) — mais la
# lire demande un accès aux journaux Fly, donc la seule chose que le site disait
# de sa propre panne était « l'assistant n'a pas pu répondre ». Une panne qui ne
# se lit qu'avec un accès privilégié est une panne qui dure.
#
# Le remède n'est pas d'exposer le corps d'erreur (il peut nommer l'hôte ou un
# identifiant de branche) : c'est de garder la CAUSE CLASSÉE — un statut, un
# genre d'échec — et de la publier sur `/health`, à côté du circuit PayDunya qui
# suit exactement la même règle. Aucun jeton, aucun hôte, aucun corps :
# `last_status` et `cause` suffisent à choisir entre « renouveler le jeton »,
# « recharger le crédit » et « corriger le modèle », et c'est tout ce dont un
# diagnostic a besoin.
#
# L'état est PAR PROCESS, comme les compteurs de `/metrics` et pour la même
# raison : le dépôt refuse `WEB_CONCURRENCY > 1` sans Redis. Il est remis à zéro
# au redémarrage — un déploiement qui rend l'assistant guéri ne doit pas garder
# l'échec d'avant, et `state: "inconnu"` le dit au lieu de faire passer un
# silence pour un vert.
_diagnostic = {
    "cause": "",
    "last_status": None,
    "consecutive_failures": 0,
    "last_failure_at": None,
    "last_success_at": None,
}

# Ce que chaque statut veut dire pour qui doit RÉPARER, écrit une fois. Un
# dictionnaire de phrases plutôt qu'un message générique : « 401 » et « 402 »
# n'appellent pas la même personne (renouveler un jeton ; recharger un compte).
MOTIFS_PAR_STATUT = {
    400: (
        "requête refusée (400) : modèle ou paramètre refusé — vérifier "
        "NEON_AI_GATEWAY_MODEL dans le catalogue"
    ),
    401: "jeton refusé (401) : renouveler NEON_AI_GATEWAY_TOKEN",
    402: "crédit épuisé (402) : recharger le compte du gateway",
    403: "accès refusé (403) : jeton sans droit sur cette branche",
    404: "modèle ou branche introuvable (404) : vérifier NEON_AI_GATEWAY_MODEL",
    # 429 observé le 27/10/2026 sur le modèle GRATUIT `recursive/flint-v1.0:free` :
    # le corps disait « is temporarily rate-limited upstream … or add your own
    # key ». Ce n'est donc pas toujours le quota du COMPTE, et le motif le dit :
    # le remède est de choisir un modèle payant du catalogue, ou de réessayer.
    429: (
        "modèle saturé chez le fournisseur (429) : les modèles libres se mettent "
        "en file — configurer un modèle payant dans NEON_AI_GATEWAY_MODEL, ou réessayer"
    ),
}

# Ce que chaque genre d'échec veut dire, quand il n'y a pas de statut à lire.
MOTIFS_PAR_CAUSE = {
    "non_configure": (
        "gateway non configuré : NEON_AI_GATEWAY_BASE_URL ou "
        "NEON_AI_GATEWAY_TOKEN absent"
    ),
    "reseau": "gateway injoignable (réseau) : vérifier l'hôte de branche",
    "illisible": "réponse du gateway sans texte exploitable",
    "tronquee": "réponse tronquée par le plafond de jetons",
    "vide": "réponse du gateway vide",
}


def _attente_429(response) -> float:
    """L'attente avant de rejouer un 429 : son en-tête, borné à 5 s.

    Un `Retry-After` lisible l'emporte ; une valeur absente, non numérique ou
    déraisonnable retombe sur 1,5 s. Le plafond existe pour qu'un fournisseur
    qui annoncerait 120 s ne bloque pas une requête publique pendant deux
    minutes — au-delà de 5 s, mieux vaut le dire au visiteur que l'attendre.
    """
    try:
        valeur = float((getattr(response, "headers", None) or {}).get("Retry-After", ""))
    except (TypeError, ValueError):
        return 1.5
    return max(0.5, min(valeur, 5.0))


def _maintenant() -> str:
    """L'instant en ISO 8601 UTC — la forme que `/health` publie déjà (timestamp)."""
    return datetime.now(timezone.utc).isoformat()


def _noter_echec(cause: str, statut=None) -> None:
    """Mémorise un échec : genre, statut, et le compteur consécutif.

    Appelée sur CHAQUE chemin de sortie en erreur, y compris celui du gateway
    non configuré : une fonctionnalité éteinte est un état, pas un silence.
    """
    _diagnostic["cause"] = cause
    _diagnostic["last_status"] = int(statut) if isinstance(statut, int) else None
    _diagnostic["consecutive_failures"] += 1
    _diagnostic["last_failure_at"] = _maintenant()


def _noter_succes() -> None:
    """Un appel réussi remet le compteur à zéro et date le dernier succès.

    Le genre d'échec précédent est CONSERVÉ : il date `last_failure_at` et
    explique une reprise qui vient d'avoir lieu — l'effacer ferait perdre la
    seule trace d'une panne récente, alors que `state` dit déjà « ok ».
    """
    _diagnostic["consecutive_failures"] = 0
    _diagnostic["last_success_at"] = _maintenant()


def _motif(cause: str, statut) -> str:
    """La phrase actionnable d'un échec, ou vide quand il n'y en a pas."""
    if isinstance(statut, int):
        if statut in MOTIFS_PAR_STATUT:
            return MOTIFS_PAR_STATUT[statut]
        if statut >= 500:
            return f"gateway en panne ({statut}) : incident côté fournisseur"
    return MOTIFS_PAR_CAUSE.get(cause, "")


def diagnostic() -> dict:
    """L'état du dernier appel, publiable tel quel (aucun secret, aucun hôte).

    `state` a TROIS valeurs, jamais deux : `ok` (le dernier appel a réussi),
    `echec` (le dernier appel a échoué) et `inconnu` (aucun appel depuis le
    démarrage). Un gateway jamais appelé ne doit pas se lire comme un gateway
    sain — c'est la règle du dépôt : un vert qui n'a rien mesuré est un silence.
    """
    cause = _diagnostic["cause"]
    statut = _diagnostic["last_status"]
    if _diagnostic["consecutive_failures"] > 0:
        etat = "echec"
    elif _diagnostic["last_success_at"]:
        etat = "ok"
    else:
        etat = "inconnu"
    return {
        "configured": is_configured(),
        "model": AI_GATEWAY_MODEL,
        "state": etat,
        "cause": cause,
        "motif": _motif(cause, statut) if etat == "echec" else "",
        "last_status": statut,
        "consecutive_failures": _diagnostic["consecutive_failures"],
        "last_failure_at": _diagnostic["last_failure_at"],
        "last_success_at": _diagnostic["last_success_at"],
    }


def reinitialiser() -> None:
    """Remet l'état à zéro (démarrage, ou test qui isole son scénario)."""
    _diagnostic.update({
        "cause": "",
        "last_status": None,
        "consecutive_failures": 0,
        "last_failure_at": None,
        "last_success_at": None,
    })


def _valeur_nette(valeur: str) -> str:
    """Valeur débarrassée de ses espaces — le nettoyage est ICI, pas seulement
    dans `kojo_settings`.

    `kojo_settings` nettoie déjà ce qu'il lit, mais ce module peut être
    reconfiguré sans lui (monkeypatch d'un test, injection directe) et un jeton
    collé depuis un gestionnaire de secrets arrive souvent avec une fin de
    ligne. Un jeton blanc passerait alors pour configuré et produirait un
    en-tête `Bearer    ` refusé par le gateway — une panne à 401 pour une
    variable « présente ». La règle « un jeton blanc n'est pas un jeton » est
    donc tenue à l'endroit où elle sert.
    """
    return (valeur or "").strip()


def is_configured() -> bool:
    """Le gateway est-il configuré (hôte ET jeton réellement présents) ?

    Faux dès qu'une des deux variables manque ou est vide/Blanche après
    nettoyage : l'appelant répond alors 503 et /support retombe sur le
    questionnaire, au lieu d'un 500 qui accuserait le code.
    """
    return bool(_valeur_nette(AI_GATEWAY_BASE_URL) and _valeur_nette(AI_GATEWAY_TOKEN))


def chat_completion(
    messages: list,
    *,
    temperature: float = 0.2,
    max_tokens: int = 2000,
) -> str:
    """Demande une réponse au modèle et rend son texte.

    SYNCHRONE (requests) : à appeler via `asyncio.to_thread` depuis une route
    async. Lève `AiGatewayError` avec la cause nommée (statut HTTP, réseau,
    corps illisible, réponse tronquée par le plafond, réponse sans texte) —
    jamais avec le jeton.

    Args:
        messages: liste de dicts `{"role": …, "content": …}` (rôles `system`,
            `user`, `assistant`).
        temperature: créativité du modèle ; basse = réponses factuelles.
        max_tokens: plafond de la réponse — borne le coût d'un appel public.

            MESURÉ le 23/10/2026 sur le modèle de production : 610 à 750 jetons
            partent dans le RAISONNEMENT avant le premier mot de la réponse, et
            ces jetons comptent dans le même plafond. À 700, la réponse était
            coupée en pleine phrase (`finish_reason: length`) — ou absente, ce
            qui rendait un 502 « réponse vide » pour un modèle qui répondait
            très bien. 2 000 laisse la place au raisonnement ET à la réponse, et
            un dépassement est rejoué UNE fois avec une borne doublée (voir
            `PLAFOND_JETONS_MAX`) plutôt que rendu au visiteur en 502.
    """
    if not is_configured():
        _noter_echec("non_configure")
        raise AiGatewayError("gateway non configuré (NEON_AI_GATEWAY_BASE_URL / NEON_AI_GATEWAY_TOKEN absents)")

    url = f"{_valeur_nette(AI_GATEWAY_BASE_URL).rstrip('/')}{CHAT_COMPLETIONS_PATH}"

    # DEUX essais au plus, jamais une boucle : le premier avec la borne de
    # l'appelant, le second — UNIQUEMENT si le plafond a coupé la réponse — avec
    # une borne doublée. Mesuré le 23/10/2026 : le modèle de production a épuisé
    # 2 000 jetons en raisonnement sur une question d'une phrase, et le client
    # recevait un 502 alors que la réponse arrivait au second essai. Un échec de
    # transport ou un statut non 200 ne se rejoue pas : seul le plafond est
    # rejouable, parce que lui seul est un défaut de BORNE, pas de service.
    for tentative in range(2):
        try:
            response = requests.post(
                url,
                headers={
                    "Authorization": f"Bearer {_valeur_nette(AI_GATEWAY_TOKEN)}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": AI_GATEWAY_MODEL,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
                timeout=AI_GATEWAY_TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            # La cause réseau nommée, l'hôte réduit à son domaine : un journal de
            # production ne doit pas porter l'identifiant de branche en clair.
            _noter_echec("reseau")
            raise AiGatewayError(f"appel au gateway impossible ({type(exc).__name__})")

        if response.status_code != 200:
            # ── Le 429 est REJOUABLE (27/10/2026) ────────────────────────────
            # Mesuré ce jour sur le modèle gratuit de production : deux
            # questions sur trois passaient, la troisième rendait 429 avec
            # « temporarily rate-limited upstream, please retry shortly ». Le
            # code la rendait au visiteur en 502 instantané, alors que le
            # fournisseur demandait une seconde d'attente. Un 429 est donc
            # rejoué UNE fois, dans le budget d'essais qui existe déjà (aucune
            # boucle) ; un second 429 garde sa cause et son statut.
            if response.status_code == 429 and tentative == 0:
                attente = _attente_429(response)
                logger.warning(
                    "⚠️ Assistant IA : gateway 429 (modèle saturé), nouvel essai dans %.1f s",
                    attente,
                )
                time.sleep(attente)
                continue
            # Le corps d'erreur du gateway nomme le problème (modèle absent du
            # catalogue, quota, jeton révoqué) : tronqué, c'est le seul
            # diagnostic utile en production.
            _noter_echec("http", response.status_code)
            raise AiGatewayError(
                f"gateway HTTP {response.status_code} : {response.text[:200]}"
            )

        try:
            payload = response.json()
            choice = payload["choices"][0]
            content = choice["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            _noter_echec("illisible")
            raise AiGatewayError("réponse du gateway sans texte exploitable")

        # Un plafond atteint n'est PAS une réponse : rendre le texte coupé ferait
        # envoyer au client une phrase interrompue, et lire `content` vide ferait
        # accuser le modèle d'être muet alors qu'il a seulement raisonné trop
        # longtemps. La cause est donc nommée avant les deux.
        if isinstance(choice, dict) and choice.get("finish_reason") == "length":
            if tentative == 0 and max_tokens < PLAFOND_JETONS_MAX:
                nouveau_plafond = min(max_tokens * 2, PLAFOND_JETONS_MAX)
                logger.warning(
                    "⚠️ Assistant IA : réponse tronquée à %s jetons, nouvel essai à %s",
                    max_tokens,
                    nouveau_plafond,
                )
                max_tokens = nouveau_plafond
                continue
            _noter_echec("tronquee")
            raise AiGatewayError(
                f"réponse tronquée par le plafond de {max_tokens} jetons (finish_reason=length)"
            )

        if not isinstance(content, str) or not content.strip():
            _noter_echec("vide")
            raise AiGatewayError("réponse du gateway vide")

        _noter_succes()
        return content.strip()
