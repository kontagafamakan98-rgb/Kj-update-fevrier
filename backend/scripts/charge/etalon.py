# -*- coding: utf-8 -*-
"""Étalon : un serveur ASGI qui ne fait RIEN, pour calibrer le générateur.

Sans cet étalon, un palier qui plafonne ne dit pas si c'est l'application ou
le client de mesure qui sature. Le générateur ne vaut que ce que son propre
plafond laisse voir.

    python scripts/charge/etalon.py --port 8991
"""

import argparse

import uvicorn


async def app(scope, receive, send):
    if scope["type"] != "http":
        return
    await send(
        {
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"content-type", b"application/json")],
        }
    )
    await send({"type": "http.response.body", "body": b'{"ok": true}'})


def main():
    parseur = argparse.ArgumentParser()
    parseur.add_argument("--port", type=int, default=8991)
    args = parseur.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
