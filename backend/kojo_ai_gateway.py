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
import requests

from kojo_settings import (
    AI_GATEWAY_BASE_URL,
    AI_GATEWAY_MODEL,
    AI_GATEWAY_TIMEOUT_SECONDS,
    AI_GATEWAY_TOKEN,
)

# Chemin du dialecte unifié, compatible avec TOUS les modèles du catalogue
# (le dialecte natif `/anthropic` ou `/openai` n'est utile que pour les
# fonctionnalités propres à un fournisseur — pensées étendues, cache de
# prompt — dont l'assistant support n'a pas besoin).
CHAT_COMPLETIONS_PATH = "/v1/chat/completions"


class AiGatewayError(RuntimeError):
    """Échec d'un appel au gateway (réseau, statut HTTP, réponse inexploitable).

    Type PROPRE au module : l'appelant décide du statut HTTP (502), sans
    inspecter le message ni confondre une panne du gateway avec un bug du
    handler.
    """


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
    max_tokens: int = 700,
) -> str:
    """Demande une réponse au modèle et rend son texte.

    SYNCHRONE (requests) : à appeler via `asyncio.to_thread` depuis une route
    async. Lève `AiGatewayError` avec la cause nommée (statut HTTP, réseau,
    corps illisible, réponse sans texte) — jamais avec le jeton.

    Args:
        messages: liste de dicts `{"role": …, "content": …}` (rôles `system`,
            `user`, `assistant`).
        temperature: créativité du modèle ; basse = réponses factuelles.
        max_tokens: plafond de la réponse — borne le coût d'un appel public.
    """
    if not is_configured():
        raise AiGatewayError("gateway non configuré (NEON_AI_GATEWAY_BASE_URL / NEON_AI_GATEWAY_TOKEN absents)")

    url = f"{_valeur_nette(AI_GATEWAY_BASE_URL).rstrip('/')}{CHAT_COMPLETIONS_PATH}"
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
        raise AiGatewayError(f"appel au gateway impossible ({type(exc).__name__})")

    if response.status_code != 200:
        # Le corps d'erreur du gateway nomme le problème (modèle absent du
        # catalogue, quota, jeton révoqué) : tronqué, c'est le seul diagnostic
        # utile en production.
        raise AiGatewayError(
            f"gateway HTTP {response.status_code} : {response.text[:200]}"
        )

    try:
        payload = response.json()
        content = payload["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        raise AiGatewayError("réponse du gateway sans texte exploitable")

    if not isinstance(content, str) or not content.strip():
        raise AiGatewayError("réponse du gateway vide")

    return content.strip()
