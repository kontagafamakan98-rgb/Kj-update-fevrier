# -*- coding: utf-8 -*-
"""Les EFFETS EXTERNES des endpoints « missions », déclarés à un seul endroit.

Pourquoi un module pour six appels : ces six-là SORTENT du processus — un push,
un message, une écriture de séquestre, un ordre de versement à PayDunya. Ils
sont donc les seuls que les tests doivent substituer, et ils l'étaient via
`kojo_routers_jobs.<nom>` : découper le routeur en modules aurait dispersé ce
point de substitution en cinq copies, une par module, avec cinq occasions
d'en oublier une (et un oubli ne rougit pas — `patch` sur un nom que personne
n'appelle est simplement sans effet).

Ils sont donc rassemblés ici, et appelés en ATTRIBUT (`effets.notify_...`) et
non importés nom à nom : c'est ce qui rend la substitution effective quel que
soit le module d'endpoints qui déclenche l'effet.
"""
from kojo_payments import (
    create_paydunya_disburse_invoice, maj_sequestre, submit_paydunya_disburse_invoice,
)
from kojo_shared import (
    _dispatch_address_to_worker, _send_payment_pending_to_worker, notify_user_localized,
)

__all__ = [
    "notify_user_localized",
    "_send_payment_pending_to_worker",
    "_dispatch_address_to_worker",
    "create_paydunya_disburse_invoice",
    "submit_paydunya_disburse_invoice",
    "maj_sequestre",
]
