# -*- coding: utf-8 -*-
"""Un PASSAGE de purge de conservation, hors du planificateur.

Ce que ce module contient, et ce qu'il ne contient pas :

  * il contient `retention_purge_once` — le passage LUI-MÊME : il demande à
    chaque règle de `kojo_retention.RETENTION_RULES` son filtre
    (`RegleDeConservation.query_de_purge`, la MÊME règle que l'index TTL),
    supprime ce qui est dû, et rend {collection: documents supprimés} ;
  * il ne contient NI la boucle (`retention_purge_loop`), NI le bail
    (`executer_si_bail`), NI le sommeil : la cadence et la coordination entre
    instances restent dans `kojo_scheduler`, qui RÉEXPORTE le passage
    (`from kojo_purge_retention import retention_purge_once`). L'import reste
    donc valable à l'identique : `kojo_scheduler.retention_purge_once` EST
    l'objet de ce module, pas une copie.

Pourquoi il est sorti (27/10/2026) : le planificateur portait 1 952 lignes et
huit passages à échéance. La purge est le seul dont l'effet est DESTRUCTIF et
VÉRIFIABLE hors horloge — ses tests lui donnent un « maintenant » explicite —
et il était le seul à ne pouvoir être atteint qu'à travers une boucle
`while True`. Le sortir rend le passage importable, exécutable à la demande
(script d'exploitation, test, rejeu) sans rien changer au chemin de production.

Ce qui NE doit pas revenir ici : une dépendance au planificateur (le module
n'importe pas `kojo_scheduler`, sinon le cycle revient par la porte de
derrière), une durée recopiée (elles vivent dans `kojo_settings`, citées par
`kojo_retention`), et un `sleep` ou un bail (ce sont des décisions de cadence).

Garde : `backend/tests/test_purge_retention_module.py` — il rejoue les tests du
passage, vérifie que CHAQUE nom public est réexporté à l'identique par le
planificateur, que le code vit bien ici (et non dans le planificateur), et que
la boucle de production appelle cet objet-là.
"""

from datetime import datetime, timezone
from typing import Optional

from kojo_core import db
# Les durées de conservation ne sont pas recopiées : la purge demande à chaque
# règle son filtre, et cette règle porte aussi l'index TTL.
from kojo_retention import RETENTION_RULES
from kojo_settings import logger

__all__ = ["retention_purge_once"]


async def retention_purge_once(now: Optional[datetime] = None) -> dict:
    """Un passage de purge : supprime ce que les règles de conservation
    déclarent dû.

    Le filtre vient de `RegleDeConservation.query_de_purge` — la même règle que
    l'index TTL, donc la purge ne peut pas contredire la durée publiée. Un
    échec sur une collection n'empêche pas les autres : borner une collection
    ne doit pas dépendre de l'état d'une autre.

    Retourne {collection: documents supprimés} et ne logge que les passages non
    vides — un log quotidien qui dit « 0 » finit par être ignoré.
    """
    now = now or datetime.now(timezone.utc)
    supprimes = {}
    for regle in RETENTION_RULES:
        try:
            resultat = await db[regle.collection].delete_many(
                regle.query_de_purge(now)
            )
        except Exception as exc:
            logger.warning(f"⚠️ Purge de conservation impossible ({regle.collection}): {exc}")
            continue
        nombre = getattr(resultat, "deleted_count", 0) or 0
        if nombre:
            supprimes[regle.collection] = nombre
    if supprimes:
        logger.info(f"🧹 Purge de conservation: {supprimes}")
    return supprimes
