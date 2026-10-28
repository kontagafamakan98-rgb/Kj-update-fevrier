# -*- coding: utf-8 -*-
"""Les ÉTATS d'un litige — un vocabulaire, pas un comportement.

Pourquoi ce module existe (27/10/2026)
-------------------------------------
Deux modules ont besoin de ces cinq mots : `kojo_job_disputes`, qui fait AVANCER
un litige, et `kojo_mesures_arbitrage`, qui le COMPTE. Les uns et les autres
doivent nommer exactement les mêmes états — une mesure qui compterait
`"resolved"` là où la machine écrit `"tranche"` publierait un zéro, et un zéro
publié se lit comme un fait.

Laisser les constantes dans `kojo_job_disputes` obligeait les mesures à importer
le module qui ARGENTE (ce qui recréait le mélange que le découpage défaisait) ;
les recopier dans les mesures créait deux vérités. Ce fichier est donc la
seule définition, et il ne contient AUCUNE logique : ni fonction, ni accès à la
base. Il ne peut donc pas créer de cycle d'import.
"""

OUVERT = "open"
RETIRE = "withdrawn"
TRANCHE = "resolved"
EXPIRE = "expired"
ECHEC = "decision_failed"

__all__ = ["OUVERT", "RETIRE", "TRANCHE", "EXPIRE", "ECHEC"]
