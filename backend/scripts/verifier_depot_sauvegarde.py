#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Relecture du DÉPÔT de sauvegarde — ce qu'on récupérerait vraiment.

POURQUOI CETTE ÉTAPE EXISTE

Jusqu'au 21/10/2026, `backup-db.yml` prouvait l'archive LOCALE : elle était
restaurée, comparée à la source, chiffrée, puis déposée. Rien ne prouvait
l'OBJET DÉPOSÉ — celui qu'on téléchargerait le jour d'une perte. Quatre choses
peuvent être fausses là-bas sans que le run s'en aperçoive :

  1. l'objet n'est pas celui qu'on vient d'envoyer (mauvais chemin, écrasement
     par un autre run, upload partiel) ;
  2. son empreinte ne correspond plus à celle publiée dans le résumé du run ;
  3. le chiffrement n'est pas déchiffrable avec la phrase secrète qu'on garde ;
  4. le clair n'est pas l'archive gzip de `mongodump` (tronquée, vide, autre
     chose).

La preuve a été faite À LA MAIN le 21/10/2026 (objet retéléchargé, empreinte
identique, `openssl enc -d`, `gzip -t`) ; cet outil la rend AUTOMATIQUE, donc
quotidienne, et c'est la différence entre une preuve et une intention.

CE QU'IL NE FAIT PAS

Il ne restaure pas : `mongorestore` sur l'objet déposé demanderait une seconde
base de travail, et la restauration est déjà jugée sur le runner (source contre
archive restaurée). Ici on juge la CHAÎNE du dépôt : identité, déchiffrement,
intégrité du flux.

Le clair n'est JAMAIS écrit sur disque : `openssl` le rend sur sa sortie
standard et le décompresseur le consomme par blocs — une archive de 61 Mo ne
passe donc ni par un fichier temporaire ni par la mémoire du process.

Usage :
    python backend/scripts/verifier_depot_sauvegarde.py \\
        --fichier /tmp/relecture.enc \\
        --envoye /tmp/kojo.archive.enc \\
        --empreinte "$(cat /tmp/kojo.archive.sha256)"

Sortie : 0 tout est prouvé ; 1 un fait est faux (le message nomme lequel) ;
2 rien n'a pu être jugé (prémisse nommée). Aucune valeur de secret n'est
imprimée : ni la phrase, ni le contenu de l'archive.
"""
import argparse
import hashlib
import os
import re
import shutil
import subprocess
import sys
import zlib

MOTIF_EMPREINTE = re.compile(r"^[0-9a-f]{64}$")


def _sortie_utf8():
    """Console Windows en cp1252 : un accent sortirait en `\\uFFFD`, et un refus
    illisible se lit comme un bug de l'outil, pas comme un fait mesuré."""
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def empreinte_fichier(chemin, taille_bloc=1 << 20):
    """SHA-256 d'un fichier, lu par blocs (une archive ne tient pas en mémoire)."""
    condensat = hashlib.sha256()
    with open(chemin, "rb") as flux:
        while True:
            bloc = flux.read(taille_bloc)
            if not bloc:
                break
            condensat.update(bloc)
    return condensat.hexdigest()


def dechiffrer_et_valider_gzip(chemin, phrase, taille_bloc=1 << 20):
    """Déchiffre en FLUX et valide le flux gzip du clair.

    Rend `(code, ligne)` : 0 le clair est un flux gzip COMPLET, 1 un fait est
    faux (déchiffrement refusé, flux invalide, tronqué ou vide), 2 prémisse.

    La validation se fait sur le FLUX (`decompressobj(31)` = gzip) et non sur le
    seul en-tête : une archive tronquée commence par la bonne signature et
    échouerait au moment de la restauration, c'est-à-dire au pire moment.
    """
    openssl = shutil.which("openssl")
    if not openssl:
        return 2, "[PREMISSE] `openssl` introuvable : le clair ne peut pas être obtenu."

    env = dict(os.environ, BACKUP_PASSPHRASE=phrase)
    try:
        process = subprocess.Popen(
            [
                openssl, "enc", "-d", "-aes-256-cbc", "-pbkdf2",
                "-in", chemin,
                "-pass", "env:BACKUP_PASSPHRASE",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )
    except OSError as exc:  # noqa: BLE001 - toute panne d'outil est une prémisse
        return 2, f"[PREMISSE] `openssl` n'a pas pu démarrer : {exc}"

    decompresseur = zlib.decompressobj(31)
    octets_clairs = 0
    try:
        while True:
            bloc = process.stdout.read(taille_bloc)
            if not bloc:
                break
            try:
                # Le clair est jeté : on ne garde que sa LONGUEUR. La mémoire du
                # runner ne dépend donc pas de la taille de la base.
                octets_clairs += len(decompresseur.decompress(bloc))
            except zlib.error as exc:
                process.kill()
                process.wait()
                # Deux causes possibles, et les deux se corrigent AVANT une
                # restauration : le message les nomme toutes les deux plutôt que
                # de deviner. Un mauvais mot de passe en AES-CBC ne lève pas
                # toujours une erreur de padding (une fois sur 256 environ) : il
                # rend des octets quelconques, donc « ce n'est pas du gzip » est
                # la seule chose qui soit VRAIE dans ce cas.
                return 1, (
                    "[ERREUR] le clair déchiffré n'est pas un flux gzip "
                    f"({exc}) : l'objet déposé n'est pas l'archive de mongodump, "
                    "ou la phrase secrète n'ouvre pas cet objet."
                )
        octets_clairs += len(decompresseur.flush())
        code_retour = process.wait()
        detail = (process.stderr.read() or b"").decode("utf-8", "replace").strip()[:200]
    finally:
        for flux in (process.stdout, process.stderr):
            try:
                flux.close()
            except (AttributeError, OSError):
                pass

    if code_retour != 0:
        return 1, (
            "[ERREUR] déchiffrement REFUSÉ par openssl"
            + (f" ({detail})" if detail else "")
            + " : la phrase secrète gardée n'ouvre pas cet objet, ou l'objet est"
            " altéré — les deux se découvriraient le jour de la restauration."
        )
    if not decompresseur.eof:
        return 1, (
            "[ERREUR] le flux gzip est INCOMPLET : l'objet déposé est tronqué "
            f"({octets_clairs} o décompressés avant la coupure)."
        )
    if octets_clairs == 0:
        return 1, "[ERREUR] le clair déchiffré est VIDE : l'archive déposée ne contient rien."
    return 0, f"[OK] clair déchiffré et flux gzip valide ({octets_clairs} o décompressés)."


def main(argv=None):
    _sortie_utf8()
    parseur = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parseur.add_argument("--fichier", required=True, help="copie RETÉLÉCHARGÉE du dépôt")
    parseur.add_argument(
        "--envoye",
        help="le fichier qui vient d'être déposé : la relecture doit en différer",
    )
    parseur.add_argument("--empreinte", required=True, help="SHA-256 publié de l'objet déposé")
    args = parseur.parse_args(argv)

    lignes = []

    if not os.path.isfile(args.fichier):
        print(f"[PREMISSE] rien n'a été jugé : {args.fichier} absent ou illisible.", file=sys.stderr)
        print("[PREMISSE] rien n'a été jugé : la relecture n'a pas de fichier.", file=sys.stderr)
        return 2
    if os.path.getsize(args.fichier) == 0:
        print("[PREMISSE] rien n'a été jugé : l'objet retéléchargé fait 0 octet.", file=sys.stderr)
        return 2
    if not MOTIF_EMPREINTE.match((args.empreinte or "").strip().lower()):
        print(
            "[PREMISSE] rien n'a été jugé : l'empreinte publiée n'a pas la forme "
            "d'un SHA-256 (64 caractères hexadécimaux).",
            file=sys.stderr,
        )
        return 2

    # La relecture ne vaut que si elle lit AUTRE CHOSE que ce qu'on vient
    # d'envoyer : sur le même fichier, elle prouverait le disque du runner, pas
    # le dépôt. `samefile` couvre le chemin identique comme le lien matériel.
    if args.envoye and os.path.isfile(args.envoye):
        try:
            identique = os.path.samefile(args.fichier, args.envoye)
        except OSError:
            identique = os.path.abspath(args.fichier) == os.path.abspath(args.envoye)
        if identique:
            print(
                "[PREMISSE] rien n'a été jugé : `--fichier` est le fichier qui vient "
                "d'être envoyé — une relecture du même fichier ne prouve pas le dépôt.",
                file=sys.stderr,
            )
            return 2

    attendue = args.empreinte.strip().lower()
    try:
        obtenue = empreinte_fichier(args.fichier)
    except OSError as exc:
        print(f"[PREMISSE] rien n'a été jugé : lecture impossible ({exc}).", file=sys.stderr)
        return 2

    if obtenue != attendue:
        lignes.append(
            "[ERREUR] empreinte du dépôt DIFFÉRENTE de celle publiée "
            f"({obtenue[:16]}… contre {attendue[:16]}…) : l'objet retéléchargé "
            "n'est pas celui que le run a mesuré."
        )
        code = 1
    else:
        lignes.append(f"[OK] empreinte du dépôt identique à celle publiée ({obtenue[:16]}…).")
        code = 0

    phrase = os.environ.get("BACKUP_PASSPHRASE", "")
    if not phrase:
        print(
            "[PREMISSE] rien n'a été jugé : BACKUP_PASSPHRASE absente — la moitié "
            "chiffrement ne peut pas être éprouvée (l'empreinte, elle, l'a été).",
            file=sys.stderr,
        )
        for ligne in lignes:
            print(ligne)
        return 2

    code_gzip, ligne_gzip = dechiffrer_et_valider_gzip(args.fichier, phrase)
    lignes.append(ligne_gzip)
    if code == 0 and code_gzip:
        code = code_gzip

    for ligne in lignes:
        print(ligne)
    if code == 1:
        print(
            "\n::error title=Dépôt de sauvegarde non prouvé::"
            "L'objet déposé ne se relit pas comme l'archive du jour — le run est "
            "rouge parce que la preuve manque, pas parce qu'elle a coûté cher."
        )
    elif code == 2:
        print("\n::error title=Dépôt de sauvegarde non jugé::Prémisse nommée ci-dessus.")
    return code


if __name__ == "__main__":
    sys.exit(main())
