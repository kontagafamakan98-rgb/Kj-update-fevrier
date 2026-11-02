# -*- coding: utf-8 -*-
"""Faux gateway OpenAI-compatible — preuve à blanc, JAMAIS en production.

Pourquoi il existe : la chaîne complète (`kickoff` → sortie pydantic → validateur
→ fichiers) ne peut pas être vérifiée sans dépenser un jeton ni dépendre du
réseau. Ce serveur répond une complétion contenant un JSON choisi, ce qui permet
de prouver trois choses qu'un simple `--plan` ne prouve pas :

  * la sortie structurée est bien relue par pydantic (pas de prose autour) ;
  * une proposition INVALIDE (texte vide, placeholder perdu) est refusée par le
    validateur et atterrit dans `refusees.json` au lieu d'être publiée ;
  * les doutes sont numérotés à la suite du fichier de revue.

Il n'est importé par personne et n'ouvre qu'une boucle locale.
"""
from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

# Une proposition juste, une proposition INVALIDE (vide) et un doute : de quoi
# vérifier les trois branches en un seul appel.
# Les trois cas visent le scope `emailVerification` en wolof, et la preuve se
# lance avec `--fichiers emailVerification --langues wo --max 0` : le lot est
# alors TOUT le scope, donc ces clés y sont par construction.
REPONSE = {
    "propositions": [
        # Utile : le placeholder est conservé, la phrase est resserrée.
        {
            "fichier": "emailVerification",
            "cle": "welcomeToast",
            "langue": "wo",
            "texte": "Dalal ak jàmm {firstName} ! Sa kont sos nañu ko",
            "motif": "« konto » devient « kont », déjà employé ailleurs dans le fichier",
            "confiance": "moyenne",
        },
        # REFUS 1 : le placeholder `{email}` a disparu.
        {
            "fichier": "emailVerification",
            "cle": "sentTo",
            "langue": "wo",
            "texte": "Kood bi ñu yónnee ko ci email",
            "motif": "doit être refusée : `{email}` perdu",
            "confiance": "haute",
        },
        # REFUS 2 : valeur vide.
        {
            "fichier": "emailVerification",
            "cle": "resendIn",
            "langue": "wo",
            "texte": "",
            "motif": "doit être refusée : valeur vide",
            "confiance": "basse",
        },
    ],
    "doutes": [
        {
            "langue": "wo",
            "cle": "emailVerification.welcomeToast",
            "question": "« Sa kont sos nañu ko » est-il plus naturel que « Sa konto sos nañu ko » ?",
        }
    ],
}


class Repondeur(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802 — API de http.server
        longueur = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(longueur)
        corps = json.dumps(
            {
                "id": "faux-1",
                "object": "chat.completion",
                "created": 0,
                "model": "faux-modele",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": json.dumps(REPONSE, ensure_ascii=False),
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            },
            ensure_ascii=False,
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)

    def log_message(self, *_):  # silence : la sortie est lue par un humain
        return


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    HTTPServer(("127.0.0.1", port), Repondeur).serve_forever()
