#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mise en service de la sauvegarde EXTERNE — du bucket vide au premier run jugé.

POURQUOI CET OUTIL EXISTE

Le cluster de production est un M0 : Atlas n'y fournit aucune sauvegarde
continue, donc la seule restauration possible est le dépôt quotidien chiffré de
`.github/workflows/backup-db.yml` sur un bucket S3/R2 privé. Ce dépôt n'a de
valeur que s'il est VÉRIFIÉ, et quatre choses peuvent être fausses sans que
personne ne le voie avant le jour de la restauration :

  1. le bucket est PUBLIC (l'archive est chiffrée, mais sa présence et sa taille
     fuient, et une erreur de chiffrement un jour la publierait) ;
  2. les clés d'accès ne peuvent pas ÉCRIRE (le workflow échoue à 02:40, et la
     sonde du matin dit seulement « aucune sauvegarde ») ;
  3. la phrase secrète ne correspond pas à ce qu'on croit (le chiffrement
     réussit toujours ; c'est le DÉCHIFFREMENT qui prouve la phrase, et il se
     découvre au pire moment) ;
  4. un des six secrets n'est pas posé dans GitHub, donc le workflow sort en 2
     en nommant ce qui manque — c'est honnête, mais ce n'est pas une sauvegarde.

Cet outil juge les quatre AVANT le premier run, puis pose les secrets, déclenche
le workflow et lit le verdict des DEUX sondes. Il n'affiche JAMAIS une valeur de
secret : ni en argument (visible dans `ps`), ni à l'écran, ni dans un journal. Le
fichier de valeurs est LU, et rien de ce qu'il contient n'est réimprimé.

CE QU'IL NE FAIT PAS

Il ne CRÉE pas le bucket : l'API S3 de R2 n'implémente pas `CreateBucket`. Le
bucket se crée dans le tableau de bord du fournisseur, puis on colle ses accès
ici — l'outil DIT ce manque au lieu d'échouer sur une erreur de transport qui
ferait croire à un problème de réseau.

Usage :
    # 1. vérifier (bucket privé, clés qui écrivent, phrase qui déchiffre)
    python backend/scripts/preparer_sauvegarde_externe.py --fichier .backup-secrets.env
    # 2. poser les six secrets GitHub depuis ce même fichier
    python backend/scripts/preparer_sauvegarde_externe.py --fichier .backup-secrets.env --poser-secrets
    # 3. déclencher la sauvegarde et lire les deux verdicts
    python backend/scripts/preparer_sauvegarde_externe.py --declencher --depot <owner>/<repo>

`--mongo-externe` déclare que `MONGO_URL` ne passe PAS par ce poste : sa
PRÉSENCE dans la liste GitHub est vérifiée (un nom, pas une valeur), et sa
valeur n'est jamais lue. Exiger la chaîne de production ici obligerait à la
recopier dans un fichier pour rien — un secret qu'on recopie une fois de trop
finit dans un historique.

Toutes les valeurs viennent des variables d'environnement, ou du fichier déclaré
par `--fichier` (format `NOM=valeur`, commentaires `#`). Sortie : 0 tout est
prouvé ; 1 un fait est faux (le message nomme lequel) ; 2 rien n'a pu être jugé.
"""
import argparse
import json
import os
import re
import secrets as alea
import subprocess
import sys
import tempfile
import time
from pathlib import Path

WORKFLOW_SAUVEGARDE = ".github/workflows/backup-db.yml"
WORKFLOW_SONDE = ".github/workflows/atlas-backups-probe.yml"

# Un balayage de 61 Mo prend une minute ; au-delà de 20, quelque chose est cassé
# et doit rougir plutôt que patienter (même borne que le `timeout-minutes` du
# workflow : deux seuils pour un même fait finiraient par diverger).
ATTENTE_MAX_MINUTES = 20

MOTIF_SECRET = re.compile(r"\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}")


def _sortie_utf8():
    """Console Windows en cp1252 : un accent sortirait en `\\uFFFD`, et un refus
    illisible se lit comme un bug de l'outil, pas comme une prémisse."""
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def chemin_workflow(chemin=None):
    """Le workflow se trouve depuis N'IMPORTE QUEL répertoire courant.

    Lancé depuis la racine, il tombe sur le chemin tel quel ; lancé depuis
    `backend/` (là où vit le venv, donc là où on le lance vraiment), il le
    cherche à la racine du dépôt. Un outil qui ne marche que depuis un
    répertoire est un outil qu'on croit cassé.
    """
    candidats = [Path(chemin or WORKFLOW_SAUVEGARDE)]
    if chemin is None:
        candidats.append(Path(__file__).resolve().parents[2] / WORKFLOW_SAUVEGARDE)
    for candidat in candidats:
        if candidat.is_file():
            return candidat
    return candidats[0]


def secrets_attendus(texte_workflow):
    """Les noms de secrets que le workflow DÉCLARE — lus, jamais recopiés.

    Recopier la liste ici en ferait une seconde source : le jour où le workflow
    lira un septième secret, cet outil en poserait six en croyant avoir fini.
    """
    return sorted(set(MOTIF_SECRET.findall(texte_workflow or "")))


def lire_fichier(chemin):
    """`NOM=valeur` → dict. Commentaires, lignes vides, `export` et guillemets
    sont tolérés : un fichier qu'on doit reformater à la main est un fichier
    qu'on finit par coller ailleurs."""
    valeurs = {}
    with open(chemin, "r", encoding="utf-8-sig") as flux:
        for brute in flux:
            ligne = brute.strip()
            if not ligne or ligne.startswith("#") or "=" not in ligne:
                continue
            if ligne.startswith("export "):
                ligne = ligne[len("export "):].lstrip()
            nom, valeur = ligne.split("=", 1)
            nom = nom.strip()
            valeur = valeur.strip()
            if len(valeur) >= 2 and valeur[0] == valeur[-1] and valeur[0] in "\"'":
                valeur = valeur[1:-1]
            if nom:
                valeurs[nom] = valeur
    return valeurs


def manquantes(valeurs, attendus, externes=()):
    """Les noms absents ou VIDES. Un secret vide n'est pas un secret : le
    workflow le refuse aussi, donc le compter comme posé ici ferait diverger les
    deux juges.

    `externes` nomme ce qui n'est PAS fourni ici mais posé ailleurs (GitHub) :
    sa PRÉSENCE s'y vérifie, sa valeur n'est jamais lue. C'est le cas de
    `MONGO_URL` quand la chaîne de production ne transite pas par ce poste —
    l'exiger ici obligerait à la recopier pour rien, et un secret qu'on recopie
    finit dans un historique.
    """
    return [
        nom for nom in attendus
        if nom not in externes and not str(valeurs.get(nom) or "").strip()
    ]


def verdict_prive(statut, corps="", erreur=""):
    """Le bucket laisse-t-il lire un objet SANS authentification ?

    C'est la seule mesure qui distingue « privé » d'« on n'a pas regardé » :
    l'absence d'ACL publique ne se lit pas dans une réponse authentifiée (on a
    toujours le droit de lire ce qu'on vient d'écrire). 200 = PUBLIC, refus.

    R2 ne répond PAS 403 à un anonyme : il répond **400** avec
    `<Message>Authorization</Message>` (mesuré le 21/10/2026). Un 400 sans ce
    motif n'est PAS un refus — c'est une requête que le fournisseur n'a pas
    comprise, et la compter comme privée serait se donner un vert sur une
    surface aveugle.
    """
    if statut is None:
        return 2, f"[PREMISSE] Lecture anonyme impossible ({erreur}) : le caractère privé n'est PAS jugé."
    if statut == 200:
        return 1, (
            "[ERREUR] Le bucket est PUBLIC : un objet de contrôle a été lu SANS "
            "authentification. Aucune sauvegarde ne doit y être déposée avant "
            "d'avoir fermé l'accès public (R2 : désactiver « Public access » / "
            "le domaine r2.dev ; S3 : bloquer tout accès public)."
        )
    if statut in (401, 403, 404):
        # 404 : le fournisseur masque l'existence de l'objet — c'est un refus
        # aussi, et le confondre avec « objet absent » serait le seul vrai piège.
        return 0, f"[OK] Bucket privé (lecture anonyme refusée : HTTP {statut})."
    if statut == 400 and "Authorization" in str(corps or ""):
        return 0, "[OK] Bucket privé (R2 refuse l'anonyme : HTTP 400, motif « Authorization »)."
    return 2, (
        f"[PREMISSE] Réponse inattendue à la lecture anonyme (HTTP {statut}, "
        f"corps « {str(corps or '')[:80]} ») : rien n'est jugé."
    )


def verdict_cycle(ecriture, relecture, effacement, identique):
    """Les clés du workflow peuvent-elles écrire, relire et effacer ?"""
    if not ecriture:
        return 1, (
            "[ERREUR] Les clés ne peuvent pas ÉCRIRE dans le bucket : le run de "
            "02:40 échouerait au dépôt, et la sonde du matin ne dirait que "
            "« aucune sauvegarde ». Vérifier les droits du jeton (R2 : « Object "
            "Read & Write ») et le nom du bucket."
        )
    if not relecture:
        return 1, "[ERREUR] L'objet écrit n'a pas pu être RELU : un dépôt qu'on ne relit pas n'est pas vérifiable."
    if not identique:
        return 1, "[ERREUR] L'objet relu diffère de l'objet écrit : le stockage altère les octets."
    if not effacement:
        return 1, "[ERREUR] L'objet de contrôle n'a pas pu être EFFACÉ : la rétention ne peut pas être tenue."
    return 0, "[OK] Cycle complet prouvé (écriture, relecture identique, effacement)."


def verdict_phrase_secrete(ok, motif=""):
    """La phrase secrète DÉCHIFFRE-t-elle ce qu'elle chiffre ?

    Le chiffrement réussit avec n'importe quelle phrase : c'est le déchiffrement
    qui prouve qu'on garde la bonne. Le découvrir le jour de la restauration est
    la seule panne que cet outil existe pour rendre impossible.
    """
    if ok is None:
        return 2, f"[PREMISSE] Phrase secrète non éprouvée ({motif})."
    if not ok:
        return 1, (
            "[ERREUR] La phrase secrète ne déchiffre pas ce qu'elle chiffre "
            f"({motif}). Une archive chiffrée avec elle serait IRRÉCUPÉRABLE : "
            "corriger le secret avant le premier dépôt."
        )
    return 0, "[OK] Phrase secrète éprouvée (chiffrement puis déchiffrement identiques)."


def eprouver_phrase_secrete(phrase, openssl="openssl"):
    """`(ok, motif)` — chiffre un tampon connu puis le déchiffre, hors ligne.

    `openssl` absent est une PRÉMISSE (None), pas un échec : l'outil ne peut pas
    juger la phrase, il ne doit pas prétendre le contraire.
    """
    temoin = alea.token_bytes(64)
    with tempfile.TemporaryDirectory() as dossier:
        clair = os.path.join(dossier, "temoin.bin")
        chiffre = os.path.join(dossier, "temoin.enc")
        rendu = os.path.join(dossier, "temoin.out")
        with open(clair, "wb") as flux:
            flux.write(temoin)
        env = {**os.environ, "KOJO_PHRASE": phrase}
        try:
            subprocess.run(
                [openssl, "enc", "-aes-256-cbc", "-pbkdf2", "-salt",
                 "-in", clair, "-out", chiffre, "-pass", "env:KOJO_PHRASE"],
                check=True, capture_output=True, env=env,
            )
            subprocess.run(
                [openssl, "enc", "-d", "-aes-256-cbc", "-pbkdf2",
                 "-in", chiffre, "-out", rendu, "-pass", "env:KOJO_PHRASE"],
                check=True, capture_output=True, env=env,
            )
        except FileNotFoundError:
            return None, "openssl introuvable"
        except subprocess.CalledProcessError as exc:
            return False, (exc.stderr or b"").decode("utf-8", "replace").strip()[:120] or "openssl a refusé"
        with open(rendu, "rb") as flux:
            identique = flux.read() == temoin
        return identique, "" if identique else "octets différents"


def _client_s3(valeurs):
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=valeurs["BACKUP_S3_ENDPOINT"],
        aws_access_key_id=valeurs["BACKUP_S3_ACCESS_KEY_ID"],
        aws_secret_access_key=valeurs["BACKUP_S3_SECRET_KEY"],
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
    )


def _lecture_anonyme(url):
    """`(statut, corps, erreur)` d'une GET sans aucune signature.

    Le CORPS est lu : chez R2, c'est lui — `<Message>Authorization</Message>` —
    qui distingue « refusé » d'« incompris », et le statut seul (400 dans les
    deux cas) ne le dit pas.
    """
    try:
        import requests

        reponse = requests.get(url, timeout=15)
        return reponse.status_code, (reponse.text or "")[:200], ""
    except Exception as exc:  # noqa: BLE001 - toute panne est une prémisse
        return None, "", str(exc)


def _bucket_absent(exc):
    """Le fournisseur dit-il que le BUCKET n'existe pas (≠ clés refusées) ?"""
    texte = str(exc)
    return any(
        marque in texte
        for marque in ("NoSuchBucket", "NoSuchBucketError", "The specified bucket does not exist")
    )


def verifier(valeurs, attendus, externes=()):
    """Juge les quatre choses. Rend `(code, lignes)`."""
    code = 0
    lignes = []

    absents = manquantes(valeurs, attendus, externes)
    if absents:
        return 2, [
            "[PREMISSE] Rien n'a été jugé : "
            + ", ".join(absents)
            + " absent(s) du fichier ou de l'environnement (valeurs jamais affichées)."
        ]
    if externes:
        lignes.append(
            "[INFO] Non jugé ici (posé dans GitHub, valeur jamais lue) : "
            + ", ".join(sorted(externes))
            + "."
        )

    try:
        client = _client_s3(valeurs)
    except Exception as exc:  # noqa: BLE001
        return 2, [f"[PREMISSE] Client S3 indisponible : {exc}"]

    bucket = valeurs["BACKUP_S3_BUCKET"]
    endpoint = valeurs["BACKUP_S3_ENDPOINT"].rstrip("/")
    cle = f"controle/{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{alea.token_hex(6)}.bin"
    temoin = alea.token_bytes(256)

    ecriture = relecture = effacement = identique = False
    try:
        try:
            client.put_object(Bucket=bucket, Key=cle, Body=temoin, ContentType="application/octet-stream")
            ecriture = True
        except Exception as exc:  # noqa: BLE001
            if _bucket_absent(exc):
                return 1, [
                    f"[ERREUR] Le bucket « {bucket} » n'existe pas sur {endpoint}. "
                    "Créer le bucket dans le tableau de bord du fournisseur (R2 : "
                    "Storage → Create bucket, accès public désactivé ; l'API S3 de "
                    "R2 n'implémente pas CreateBucket), puis relancer cette vérification."
                ]
            if re.search(r"InvalidAccessKeyId|SignatureDoesNotMatch|AccessDenied", str(exc)):
                return 1, [
                    "[ERREUR] Les clés d'accès sont REFUSÉES par "
                    f"{endpoint} : le dépôt échouerait de la même façon à 02:40. "
                    "Régénérer le jeton du bucket et vérifier l'endpoint."
                ]
            return 2, [f"[PREMISSE] Écriture impossible : {type(exc).__name__} (ni refus de clé, ni bucket absent)."]

        statut, corps, erreur = _lecture_anonyme(f"{endpoint}/{bucket}/{cle}")
        code_prive, ligne = verdict_prive(statut, corps, erreur)
        if code_prive:
            code = code_prive
        lignes.append(ligne)

        try:
            recu = client.get_object(Bucket=bucket, Key=cle)["Body"].read()
            relecture = True
            identique = recu == temoin
        except Exception:  # noqa: BLE001
            relecture = False
    finally:
        try:
            client.delete_object(Bucket=bucket, Key=cle)
            effacement = True
        except Exception:  # noqa: BLE001
            effacement = False

    code_cycle, ligne_cycle = verdict_cycle(ecriture, relecture, effacement, identique)
    if code_cycle and not code:
        code = code_cycle
    lignes.append(ligne_cycle)

    ok, motif = eprouver_phrase_secrete(valeurs["BACKUP_PASSPHRASE"])
    code_phrase, ligne_phrase = verdict_phrase_secrete(ok, motif)
    if code_phrase and not code:
        code = code_phrase
    lignes.append(ligne_phrase)

    return code, lignes


def poser_secrets(valeurs, attendus, depot, externes=()):
    """Pose chaque secret par STDIN (`gh` ne le met donc pas dans `ps`), puis
    RELIT la liste : une pose qu'on n'a pas revue n'est pas une pose.

    Les noms `externes` ne sont pas posés ici, mais ils sont EXIGÉS dans la
    relecture : si `MONGO_URL` n'est pas dans GitHub, le run échouera à 02:40 en
    nommant un secret absent — et l'outil aurait dit « posés » à tort.
    """
    manques = manquantes(valeurs, attendus, externes)
    if manques:
        return 2, ["[PREMISSE] Aucun secret posé : " + ", ".join(manques) + " absent(s)."]

    poses = []
    for nom in [n for n in attendus if n not in externes]:
        try:
            subprocess.run(
                ["gh", "secret", "set", nom, "--repo", depot],
                input=valeurs[nom].encode("utf-8"), check=True, capture_output=True,
            )
        except FileNotFoundError:
            return 2, ["[PREMISSE] `gh` introuvable : les secrets n'ont pas été posés."]
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or b"").decode("utf-8", "replace").strip()[:200]
            return 2, [f"[PREMISSE] Pose de {nom} refusée : {detail} (valeur jamais affichée)."]
        poses.append(nom)

    # Relecture : le fait « posé » se mesure, il ne se suppose pas.
    try:
        sortie = _gh("secret", "list", "--repo", depot, "--json", "name", texte=True)
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        return 2, [f"[PREMISSE] Secrets posés ({len(poses)}) mais liste illisible : {exc}"]
    presents = set(re.findall(r'"name"\s*:\s*"([A-Z0-9_]+)"', sortie))
    absents = [nom for nom in attendus if nom not in presents]
    if absents:
        return 1, [
            f"[ERREUR] ABSENT(s) de la liste GitHub : {', '.join(absents)}. "
            "Le workflow sortira en 2 en les nommant — poser ceux qui manquent, "
            "puis relancer cette commande."
        ]
    detail = f"{len(poses)} secret(s) posés" + (f" (+{len(externes)} déjà en place)" if externes else "")
    return 0, [f"[OK] {detail} et relus dans {depot} : {', '.join(attendus)}."]


def _gh(*arguments, texte=False):
    sortie = subprocess.run(
        ["gh", *arguments], check=True, capture_output=True,
        text=texte if texte else False,
    )
    return sortie.stdout if texte else sortie.stdout.decode("utf-8", "replace")


def declencher(depot, ref, attente_minutes=ATTENTE_MAX_MINUTES):
    """Déclenche la sauvegarde, attend son verdict, puis celui de la sonde.

    Les deux verdicts sont RENDUS : un run vert dont la sonde refuse ne prouve
    pas la restauration, et une sonde verte sans run récent ne prouve rien du
    tout. On ne sort en 0 que si les deux disent oui.
    """
    lignes = []
    try:
        _gh("workflow", "run", "backup-db.yml", "--repo", depot, "--ref", ref)
        lignes.append(f"[INFO] {WORKFLOW_SAUVEGARDE} déclenché sur {ref}.")
    except FileNotFoundError:
        return 2, ["[PREMISSE] `gh` introuvable : rien n'a été déclenché."]
    except subprocess.CalledProcessError as exc:
        return 2, [f"[PREMISSE] Déclenchement refusé : {(exc.stderr or b'').decode('utf-8', 'replace').strip()[:200]}"]

    fini = False
    conclusion = ""
    echeance = time.time() + attente_minutes * 60
    while time.time() < echeance:
        time.sleep(15)
        try:
            sortie = _gh(
                "run", "list", "--repo", depot, "--workflow", "backup-db.yml",
                "--limit", "1", "--json", "status,conclusion,createdAt", texte=True,
            )
        except subprocess.CalledProcessError as exc:
            return 2, lignes + [f"[PREMISSE] Historique des runs illisible : {exc}"]
        runs = json.loads(sortie or "[]")
        if not runs:
            continue
        if runs[0].get("status") == "completed":
            fini = True
            conclusion = str(runs[0].get("conclusion") or "inconnue")
            break

    if not fini:
        return 2, lignes + [
            f"[PREMISSE] Aucun verdict après {attente_minutes} min : le run n'a pas "
            "conclu. Rien n'est jugé sur la sauvegarde (voir l'onglet Actions)."
        ]

    if conclusion != "success":
        return 1, lignes + [
            f"[ERREUR] Le run de sauvegarde s'est terminé en « {conclusion} » : "
            "aucune archive n'a été déposée. Le journal du run nomme l'étape fautive."
        ]
    lignes.append("[OK] Run de sauvegarde réussi (dump, restauration comparée, chiffrement, dépôt).")

    # La sonde, elle, juge la fraîcheur du dernier run RÉUSSI : c'est elle qui
    # décide si la restauration est possible aujourd'hui.
    try:
        _gh("workflow", "run", "atlas-backups-probe.yml", "--repo", depot, "--ref", ref)
    except subprocess.CalledProcessError as exc:
        return 2, lignes + [f"[PREMISSE] Sonde non déclenchée : {exc}"]
    lignes.append(f"[INFO] {WORKFLOW_SONDE} déclenché.")

    echeance = time.time() + 10 * 60
    while time.time() < echeance:
        time.sleep(10)
        try:
            sortie = _gh(
                "run", "list", "--repo", depot, "--workflow", "atlas-backups-probe.yml",
                "--limit", "1", "--json", "status,conclusion", texte=True,
            )
        except subprocess.CalledProcessError as exc:
            return 2, lignes + [f"[PREMISSE] Historique de la sonde illisible : {exc}"]
        runs = json.loads(sortie or "[]")
        if runs and runs[0].get("status") == "completed":
            conclusion_sonde = str(runs[0].get("conclusion") or "inconnue")
            if conclusion_sonde == "success":
                lignes.append("[OK] Sonde Atlas verte : sauvegarde externe FRAÎCHE et jugée.")
                return 0, lignes
            return 1, lignes + [
                f"[ERREUR] Sonde Atlas en « {conclusion_sonde} » : la sauvegarde "
                "existe peut-être, mais elle n'est pas jugée recevable — le run de "
                "la sonde nomme le motif (fraîcheur, prémisse Atlas, ou absence)."
            ]
    return 2, lignes + ["[PREMISSE] Sonde sans verdict après 10 min : rien n'est jugé."]


def main():
    _sortie_utf8()
    parseur = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parseur.add_argument("--fichier", help="fichier NOM=valeur (jamais affiché)")
    parseur.add_argument("--workflow", default=None, help="workflow dont les secrets sont LUS (défaut : celui du dépôt)")
    parseur.add_argument("--poser-secrets", action="store_true", help="poser les secrets GitHub")
    parseur.add_argument(
        "--mongo-externe", action="store_true",
        help="MONGO_URL n'est PAS fournie ici : sa présence dans GitHub est vérifiée, sa valeur jamais lue",
    )
    parseur.add_argument("--declencher", action="store_true", help="déclencher la sauvegarde puis la sonde")
    parseur.add_argument("--depot", default=os.environ.get("GITHUB_REPOSITORY", ""), help="owner/repo")
    parseur.add_argument("--ref", default="main", help="référence sur laquelle déclencher")
    parseur.add_argument("--attendre-minutes", type=int, default=ATTENTE_MAX_MINUTES)
    args = parseur.parse_args()

    valeurs = dict(os.environ)
    if args.fichier:
        try:
            valeurs.update(lire_fichier(args.fichier))
        except OSError as exc:
            print(f"[PREMISSE] Fichier illisible : {exc}", file=sys.stderr)
            return 2

    workflow = chemin_workflow(args.workflow)
    try:
        with open(workflow, "r", encoding="utf-8") as flux:
            attendus = secrets_attendus(flux.read())
    except OSError as exc:
        print(f"[PREMISSE] Workflow illisible ({workflow}) : {exc}", file=sys.stderr)
        return 2
    if not attendus:
        print(
            f"[PREMISSE] Aucun `secrets.*` lu dans {args.workflow} : la liste attendue "
            "est introuvable, donc rien n'est vérifié.",
            file=sys.stderr,
        )
        return 2

    externes = ("MONGO_URL",) if args.mongo_externe else ()

    if args.poser_secrets or args.declencher:
        if not args.depot:
            print("[PREMISSE] --depot (ou GITHUB_REPOSITORY) requis pour GitHub.", file=sys.stderr)
            return 2
        if args.poser_secrets:
            code, lignes = poser_secrets(valeurs, attendus, args.depot, externes)
            for ligne in lignes:
                print(ligne)
            if code:
                return code

    if args.declencher:
        code, lignes = declencher(args.depot, args.ref, args.attendre_minutes)
        for ligne in lignes:
            print(ligne)
        return code

    code, lignes = verifier(valeurs, attendus, externes)
    for ligne in lignes:
        print(ligne)
    if code == 1 and any("PUBLIC" in ligne for ligne in lignes):
        print(
            "\n::error title=Bucket de sauvegarde public::Aucune archive ne doit y "
            "être déposée tant que l'accès public n'est pas fermé."
        )
    return code


if __name__ == "__main__":
    sys.exit(main())
