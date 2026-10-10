"""Audit en LECTURE SEULE des documents legacy qui ne valident plus leur modèle.

Premier inventaire avant tout versionnement du schéma : il dit combien de
documents `users` ne valident plus `User` et combien de `jobs` ne valident plus
`JobPublic` (la vue publique, dont les fiches legacy sont écartées au
lecteur — voir AGENTS.md, « Données et métier »).

Garanties :
- aucune écriture : seules des lectures (`find`) sont faites ;
- le rapport donne des identifiants et les NOMS des champs en erreur, jamais
  leurs valeurs (ce sont des données personnelles : e-mail, nom, téléphone).

Usage (depuis `backend/`, avec MONGO_URL pointant vers la base à auditer) :
    python kojo_legacy_audit.py
"""

import asyncio
import json
from typing import Any, Dict, Iterable, List, Type

from pydantic import BaseModel, ValidationError

LIMITE_EXEMPLES = 20


def _identifiant(document: Dict[str, Any]) -> str:
    if document.get("id") is not None:
        return str(document["id"])
    return str(document.get("_id", "?"))


def auditer_documents(
    documents: Iterable[Dict[str, Any]],
    modele: Type[BaseModel],
    collection: str,
) -> Dict[str, Any]:
    """Valide chaque document contre `modele` et renvoie un rapport sans valeurs."""
    total = 0
    invalides: List[Dict[str, Any]] = []
    compte_par_champ: Dict[str, int] = {}

    for document in documents:
        total += 1
        try:
            modele.model_validate(document)
        except ValidationError as erreur:
            champs = sorted({
                ".".join(str(part) for part in e["loc"]) or "<racine>"
                for e in erreur.errors()
            })
            for champ in champs:
                compte_par_champ[champ] = compte_par_champ.get(champ, 0) + 1
            invalides.append({"id": _identifiant(document), "champs": champs})

    return {
        "collection": collection,
        "modele": modele.__name__,
        "total": total,
        "invalides": len(invalides),
        "champs_en_erreur": dict(sorted(compte_par_champ.items())),
        "exemples": invalides[:LIMITE_EXEMPLES],
    }


async def auditer_base(db) -> List[Dict[str, Any]]:
    """Audite `users` (User) et `jobs` (JobPublic). Lecture seule."""
    from kojo_models import JobPublic, User

    utilisateurs = await db.users.find({}).to_list(length=None)
    jobs = await db.jobs.find({"deleted": {"$ne": True}}).to_list(length=None)
    return [
        auditer_documents(utilisateurs, User, "users"),
        auditer_documents(jobs, JobPublic, "jobs"),
    ]


async def _principal() -> None:
    from kojo_db import db

    rapports = await auditer_base(db)
    print(json.dumps(rapports, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(_principal())
