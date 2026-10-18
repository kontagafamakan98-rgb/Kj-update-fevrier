# -*- coding: utf-8 -*-
"""Le bus partagé, PROUVÉ par deux workers uvicorn réels et un vrai Redis.

Ce que les doubles ne pouvaient pas dire
----------------------------------------
`tests/test_live_bus.py` porte le PROTOCOLE du bus (publication, anti-écho,
enveloppe illisible, tampon plein, reprise) avec un `FauxRedis` en mémoire :
c'est ce qui rend ces cas rapides et sans dépendance. C'est aussi ce qui les
laisse muets sur la seule chose que le bus promet — un événement publié dans un
process atteint un flux servi par un AUTRE process. Un double peut se tromper de
la même façon que le code qu'il double, et rien ne le dirait.

Ici il n'y a pas de double : deux `uvicorn` sur deux ports, une vraie base
(MongoDB), un vrai serveur Redis, et le chemin du produit de bout en bout —
`POST /api/messages` sur le worker A, `GET /api/messages/stream` sur le worker B.
Le message reçu sur B est comparé, par son IDENTIFIANT, à celui que A a renvoyé :
c'est le même document, pas un contenu qui se ressemble.

Ce qui est mesuré
-----------------
1. **Le contrôle local** (A publie, flux sur A) : la livraison en mémoire
   fonctionne. S'il rougit, le défaut est dans le fan-out ou dans le flux, PAS
   dans le bus — le test le dit au lieu de faire chercher au mauvais endroit.
2. **La traversée** (A publie, flux sur B) : A ne sert aucun flux de ce compte,
   donc l'événement ne peut venir que du bus. C'est la promesse du bus.
3. **Le même identifiant des deux côtés** : le flux rend le document écrit, donc
   il est marquable comme lu et supprimable (une ligne inventée ferait un 404).

Ce que ce test ne dit pas
-------------------------
- Rien du débit ni de la latence du bus : c'est le rôle du banc
  `scripts/charge/mesure_push.py`, qui mesure, lui, sous charge.
- Rien d'une machine Fly à plusieurs workers : le bus y est le même, mais la
  topologie réseau (deux machines, un Redis managé) ne se rejoue pas ici.
- Rien d'une perte en cours de route : la réparation (relecture) est couverte
  par `tests/test_live_bus.py`, pas par ce fichier.

Prémisses (aucun verdict rendu ici)
-----------------------------------
`TEST_REDIS_URL` et `TEST_MONGO_URL` sont le MANDAT : posés, ce fichier juge ;
absents, il se déclare — en le disant, jamais en vert. Le job `backend-tests`
lance ce fichier dans une étape dédiée (un service `redis` à côté du `mongodb`
existant), et le DERNIER cas de ce fichier vérifie que cette étape existe
encore : un test que plus personne n'exécute serait un silence de plus.

La suite principale garde `REDIS_URL=""` : c'est le produit SANS bus, que ses
autres cas éprouvent. Ce fichier ne change donc rien à leur verdict.
"""
from __future__ import annotations

import contextlib
import http.client
import json
import os
import re
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

import pytest
import requests

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
CI = REPO_ROOT / ".github" / "workflows" / "ci.yml"

# Le fichier tel qu'il doit être lancé, et le job qui doit le lancer.
FICHIER_TEST = "tests/test_live_bus_deux_workers.py"
JOB = "backend-tests"
IMAGE_REDIS = "redis:7"
PORT_REDIS = "6379"

# Ce que le journal d'un worker doit contenir pour dire que SON bus est attaché.
# `kojo_live.start_bus` écrit « Temps réel : bus partagé sur le canal « … »
# (REDIS_URL) ». La phrase française est cherchée telle quelle ; le fragment ASCII
# « (REDIS_URL) » sert de repli si un encodage de console échappe les accents
# (`\u00e9`), ce qui rendrait la phrase introuvable pour une mauvaise raison.
JOURNAL_BUS = "bus partagé sur le canal"
JOURNAL_BUS_ASCII = "(REDIS_URL)"

# Deux démarrages complets (index Mongo, sondes, planificateurs) sur un runner
# partagé : large, mais borné. Une borne qui expire est un ÉCHEC nommé, jamais
# une attente silencieuse.
DEMARRAGE_SECONDES = 90.0
# Réception : très au-delà d'un aller-retour Redis local (sous la milliseconde),
# et le battement de cœur (2 s dans ce harnais) rend la boucle attentive.
RECEPTION_SECONDES = 20.0


# ---------------------------------------------------------------------------
# Prémisses
# ---------------------------------------------------------------------------


def _exiger_premisses() -> None:
    """Déclare le test inapplicable quand le mandat n'est pas posé.

    Un skip ici n'est pas un vert : c'est un refus de juger, nommé, avec sa
    cause. En CI le job pose les deux variables, donc le skip ne peut pas
    masquer une panne du service `redis` — celle-là échouera franchement.
    """
    manquants = [
        nom
        for nom in ("TEST_REDIS_URL", "TEST_MONGO_URL")
        if not (os.environ.get(nom) or "").strip()
    ]
    if manquants:
        pytest.skip(
            "prémisse (aucun verdict rendu ici) : %s absent(s) — ce fichier ne "
            "juge le bus que là où un vrai Redis et une vraie base sont servis "
            "(étape dédiée du job %s)." % (" et ".join(manquants), JOB)
        )


# ---------------------------------------------------------------------------
# Les deux workers
# ---------------------------------------------------------------------------


def _port_libre() -> int:
    """Un port TCP libre, choisi par le système puis relâché pour uvicorn."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as prise:
        prise.bind(("127.0.0.1", 0))
        return int(prise.getsockname()[1])


def _lire(chemin: Path) -> str:
    """Le journal d'un worker. `errors="replace"` : un octet douteux ne doit pas
    casser le diagnostic (c'est justement ce qu'on lit quand ça va mal)."""
    if not chemin.exists():
        return ""
    with open(chemin, "r", encoding="utf-8", errors="replace") as flux:
        return flux.read()


class Worker:
    """Un process `uvicorn` RÉEL, sur son port, avec son journal à lui.

    Chaque worker a son propre journal (et `KOJO_LOG_FILE=0` pour couper le
    journal rotatif partagé) : deux process qui écriraient dans le même fichier
    se disputeraient les rotations, et la preuve « le bus est attaché ICI »
    deviendrait illisible au moment précis où on en a besoin.
    """

    def __init__(self, nom: str, dossier: Path):
        self.nom = nom
        self.port = _port_libre()
        self.journal = dossier / ("%s.log" % nom)
        self.processus: subprocess.Popen | None = None
        self._sortie = None

    @property
    def base(self) -> str:
        return "http://127.0.0.1:%d" % self.port

    def demarrer(self, redis_url: str) -> None:
        """Démarre le worker. L'environnement du test est HÉRITÉ : `MONGO_URL`,
        `JWT_SECRET` et `EMAIL_PROVIDER` sont ceux que `conftest.py` a posés, donc
        les enfants voient la même base et le même secret que le parent."""
        env = dict(os.environ)
        env.update(
            {
                "PYTHONIOENCODING": "utf-8",
                "PYTHONUNBUFFERED": "1",
                "REDIS_URL": redis_url,
                "WEB_CONCURRENCY": "1",
                # Un battement de cœur court rend la boucle de lecture attentive
                # sans jamais faire croire à un événement (c'est un COMMENTAIRE).
                "KOJO_SSE_HEARTBEAT_SECONDS": "2",
                "DISABLE_TRUSTED_HOST_MIDDLEWARE": "true",
                "APP_ENV": "test",
                "EMAIL_PROVIDER": "none",
                # Pas de journal rotatif : deux workers sur le même fichier.
                "KOJO_LOG_FILE": "0",
            }
        )
        self._sortie = open(self.journal, "wb")
        self.processus = subprocess.Popen(
            # `uvicorn.run(..., log_config=None)` et PAS la ligne de commande :
            # la CLI installe la configuration de journalisation d'uvicorn, qui
            # VIDE les gestionnaires de la racine — donc la sortie du backend
            # (`logging.basicConfig`, posée à l'import) n'écrirait plus nulle
            # part, et son journal serait muet sans que rien ne le dise.
            [
                sys.executable,
                "-c",
                (
                    "import sys, uvicorn; "
                    "uvicorn.run('server:app', host='127.0.0.1', "
                    "port=int(sys.argv[1]), log_config=None)"
                ),
                str(self.port),
            ],
            cwd=str(BACKEND_DIR),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=self._sortie,
            stderr=subprocess.STDOUT,
        )

    def queue_journal(self, lignes: int = 40) -> str:
        """Les dernières lignes du journal — citées dans chaque échec."""
        contenu = _lire(self.journal).splitlines()
        return "\n".join(contenu[-lignes:]) or "(journal vide)"

    def _verifier_vivant(self) -> None:
        assert self.processus is not None, "worker %s non démarré" % self.nom
        code = self.processus.poll()
        if code is not None:
            raise AssertionError(
                "le worker %s est mort au démarrage (code %s). Dernières lignes "
                "de son journal :\n%s"
                % (self.nom, code, self.queue_journal())
            )

    def attendre_pret(self, delai: float = DEMARRAGE_SECONDES) -> None:
        """Attend que `/api/health` réponde 200 ET que la base soit connectée.

        La base est une PRÉMISSE du test : sans elle le `POST /api/messages`
        échouerait en 500 et on chercherait le défaut dans le bus.
        """
        fin = time.monotonic() + delai
        while time.monotonic() < fin:
            self._verifier_vivant()
            try:
                reponse = requests.get("%s/api/health" % self.base, timeout=2)
                if reponse.status_code == 200:
                    charge = reponse.json()
                    assert charge.get("database") == "connected", (
                        "le worker %s répond mais sa base n'est pas connectée "
                        "(%s) : le test ne pourrait rien juger du bus."
                        % (self.nom, charge.get("database"))
                    )
                    return
            except requests.RequestException:
                pass
            time.sleep(0.2)
        raise AssertionError(
            "le worker %s n'a pas répondu sur /api/health en %.0f s. Dernières "
            "lignes de son journal :\n%s"
            % (self.nom, delai, self.queue_journal())
        )

    def attendre_bus(self, delai: float = 30.0) -> None:
        """Exige la PREUVE que CE process a attaché le bus.

        Sans elle, une traversée qui échoue ferait accuser le produit alors que
        la cause serait une prémière panne (paquet `redis` absent, URL
        injoignable). Le journal du process le dit, et le test le cite.
        """
        fin = time.monotonic() + delai
        while time.monotonic() < fin:
            self._verifier_vivant()
            journal = _lire(self.journal)
            if JOURNAL_BUS in journal or JOURNAL_BUS_ASCII in journal:
                return
            time.sleep(0.2)
        raise AssertionError(
            "le worker %s n'a pas attaché le bus partagé (aucune ligne « %s » en "
            "%.0f s) : REDIS_URL=%r injoignable, ou paquet `redis` absent de "
            "l'interpréteur qui sert ce worker. Journal :\n%s"
            % (
                self.nom,
                JOURNAL_BUS,
                delai,
                os.environ.get("TEST_REDIS_URL"),
                self.queue_journal(),
            )
        )

    def arreter(self) -> None:
        """Arrête le process, puis ferme son journal. Idempotent."""
        if self.processus is not None and self.processus.poll() is None:
            self.processus.terminate()
            try:
                self.processus.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.processus.kill()
                self.processus.wait(timeout=10)
        if self._sortie is not None:
            self._sortie.close()
            self._sortie = None


# ---------------------------------------------------------------------------
# Le flux SSE, lu comme le client le lit
# ---------------------------------------------------------------------------


class Flux:
    """Un `GET …/stream` ouvert, lu trame par trame (`fetch`, pas `EventSource`).

    Le client du produit lit ce flux par `fetch` + `ReadableStream` ; ici
    `http.client` joue le même rôle : un vrai GET, un vrai corps qui arrive par
    morceaux, et aucune requête derrière.
    """

    def __init__(self, worker: Worker, jeton: str, chemin: str):
        self.worker = worker
        self.connexion = http.client.HTTPConnection(
            "127.0.0.1", worker.port, timeout=60
        )
        self.connexion.request(
            "GET",
            chemin,
            headers={
                "Authorization": "Bearer %s" % jeton,
                "Accept": "text/event-stream",
            },
        )
        self.reponse = self.connexion.getresponse()

    def ouvrir(self) -> "Flux":
        assert self.reponse.status == 200, (
            "le flux du worker %s a répondu %s (corps : %r)"
            % (self.worker.nom, self.reponse.status, self.reponse.read(300))
        )
        return self

    def _trame(self) -> tuple[str, object]:
        """Lit UNE trame. Rend ("", None) quand la trame n'annonce rien."""
        nom = None
        donnees = None
        while True:
            brut = self.reponse.readline()
            if not brut:
                raise AssertionError(
                    "le flux du worker %s s'est fermé avant l'événement attendu. "
                    "Journal :\n%s" % (self.worker.nom, self.worker.queue_journal())
                )
            ligne = brut.decode("utf-8", "replace").rstrip("\r\n")
            if not ligne:
                return (nom or "", donnees)
            if ligne.startswith(":"):
                continue  # battement de cœur : aucune requête, aucun événement
            if ligne.startswith("event:"):
                nom = ligne[len("event:") :].strip()
            elif ligne.startswith("data:"):
                donnees = json.loads(ligne[len("data:") :].strip())

    def attendre(self, evenement: str, delai: float = RECEPTION_SECONDES):
        """Attend un événement NOMMÉ, en rendant sa charge."""
        fin = time.monotonic() + delai
        while time.monotonic() < fin:
            nom, donnees = self._trame()
            if nom == evenement:
                return donnees
        raise AssertionError(
            "aucun événement « %s » reçu en %.0f s sur le worker %s "
            "(flux vivant : le battement de cœur arrive). Journal :\n%s"
            % (
                evenement,
                delai,
                self.worker.nom,
                self.worker.queue_journal(),
            )
        )

    def fermer(self) -> None:
        try:
            self.connexion.close()
        except Exception:  # noqa: BLE001 - fermeture best-effort en teardown
            pass


# ---------------------------------------------------------------------------
# Données de contrôle
# ---------------------------------------------------------------------------


def _compte(email: str) -> dict:
    """Un document utilisateur VALIDE, construit par le MODÈLE du produit.

    Écrit à la main, un document de contrôle pourrait ne plus valider `User`
    après un changement de modèle, et `get_current_user` répondrait 401 : le
    test accuserait le bus pour un document périmé. Ici c'est le modèle qui le
    fabrique, donc l'écart est impossible.
    """
    from kojo_models import (
        Country,
        Language,
        User,
        UserType,
    )

    return User(
        email=email,
        first_name="Awa",
        last_name="Traore",
        user_type=UserType.CLIENT,
        country=Country.MALI,
        preferred_language=Language.FRENCH,
        legal_documents_accepted=True,
    ).model_dump(mode="json")


def _jeton(compte: dict) -> str:
    """Le jeton que `/auth/login` aurait rendu : MÊME producteur, même secret.

    Le fabriquer avec `create_access_token` plutôt qu'à la main garde ce test
    honnête quand la forme du jeton change (`pwdv`, `jti`, expiration).
    """
    from kojo_auth_core import create_access_token

    return create_access_token(
        {"sub": compte["id"], "email": compte["email"], "pwdv": 0}
    )


def _envoyer_message(worker: Worker, jeton: str, destinataire: str, contenu: str) -> dict:
    """Envoie un message par l'API RÉELLE, sur CE worker. Rend le document créé."""
    reponse = requests.post(
        "%s/api/messages" % worker.base,
        json={"receiver_id": destinataire, "content": contenu},
        headers={"Authorization": "Bearer %s" % jeton},
        timeout=30,
    )
    assert reponse.status_code == 200, (
        "l'envoi du message a répondu %s sur le worker %s (%s)"
        % (reponse.status_code, worker.nom, reponse.text[:400])
    )
    return reponse.json()


# ---------------------------------------------------------------------------
# LE banc : deux workers réels, un vrai Redis, une vraie base
# ---------------------------------------------------------------------------


class Banc:
    """Deux workers démarrés, deux comptes jetables, et leurs jetons."""

    def __init__(self, tmp_path: Path, base, compte_a: dict, compte_b: dict):
        self.base = base
        self.marque = uuid.uuid4().hex[:8]
        self.compte_a = compte_a
        self.compte_b = compte_b
        self.jeton_a = ""
        self.jeton_b = ""
        self.worker_a = Worker("worker-a", tmp_path)
        self.worker_b = Worker("worker-b", tmp_path)

    def demarrer(self) -> "Banc":
        self.jeton_a = _jeton(self.compte_a)
        self.jeton_b = _jeton(self.compte_b)
        for worker in (self.worker_a, self.worker_b):
            worker.demarrer(os.environ["TEST_REDIS_URL"].strip())
            worker.attendre_pret()
            worker.attendre_bus()
        return self

    def arreter(self) -> None:
        self.worker_b.arreter()
        self.worker_a.arreter()


@contextlib.contextmanager
def banc_deux_workers(tmp_path):
    """Le banc complet, et le ménage garanti — les workers meurent TOUJOURS."""
    _exiger_premisses()

    import pymongo

    marque = uuid.uuid4().hex[:8]
    compte_a = _compte("awa.%s@example.com" % marque)
    compte_b = _compte("koffi.%s@example.com" % marque)
    base = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    base.users.insert_many([compte_a, compte_b])
    banc = Banc(tmp_path, base, compte_a, compte_b)
    try:
        yield banc.demarrer()
    finally:
        banc.arreter()
        ids = [compte_a["id"], compte_b["id"]]
        base.users.delete_many({"id": {"$in": ids}})
        base.messages.delete_many({"sender_id": {"$in": ids}})
        base.notifications.delete_many({"user_id": {"$in": ids}})


def test_un_message_traverse_le_bus_entre_deux_workers(tmp_path):
    """Le bus, mesuré là où il sert : d'un process à l'autre."""
    with banc_deux_workers(tmp_path) as banc:
        # 1) CONTRÔLE LOCAL — la livraison en mémoire, sur le worker qui publie.
        #    S'il rougit, le défaut est dans le fan-out ou le flux, pas dans le bus.
        flux = Flux(banc.worker_a, banc.jeton_b, "/api/messages/stream").ouvrir()
        try:
            flux.attendre("ready", 10)
            contenu_local = "local-%s" % banc.marque
            cree_local = _envoyer_message(
                banc.worker_a, banc.jeton_a, banc.compte_b["id"], contenu_local
            )
            recu_local = flux.attendre("message")
            assert recu_local["id"] == cree_local["id"], (
                "le flux local a rendu un autre message que celui qui vient d'être "
                "écrit (attendu %s, reçu %s)" % (cree_local["id"], recu_local.get("id"))
            )
        finally:
            flux.fermer()

        # 2) LA TRAVERSÉE — le message part du worker A, le flux vit sur B.
        #    A ne sert AUCUN flux de ce compte : l'événement ne peut venir que du
        #    bus partagé. C'est exactement la promesse que le double ne portait pas.
        flux = Flux(banc.worker_b, banc.jeton_b, "/api/messages/stream").ouvrir()
        try:
            flux.attendre("ready", 10)
            contenu_traverse = "traverse-%s" % banc.marque
            cree = _envoyer_message(
                banc.worker_a, banc.jeton_a, banc.compte_b["id"], contenu_traverse
            )
            recu = flux.attendre("message")
            assert recu["id"] == cree["id"], (
                "le flux du worker B a reçu un autre message que celui publié par A "
                "(attendu %s, reçu %s)" % (cree["id"], recu.get("id"))
            )
            assert recu["content"] == contenu_traverse
            assert recu["receiver_id"] == banc.compte_b["id"]
        finally:
            flux.fermer()


def test_le_plafond_de_flux_est_celui_du_compte_pas_du_worker(tmp_path):
    """Quatre flux PAR WORKER deviendraient seize : le plafond est partagé.

    Deux flux sur chaque worker épuisent les quatre places du COMPTE. Le
    cinquième, demandé au worker qui n'en sert que deux (donc loin de SON
    plafond local), est refusé : c'est le registre partagé qui décide.

    Ce que ce cas ne fait PAS, et pourquoi : il ne prouve pas ici qu'un flux
    FERMÉ rend sa place. Mesuré le 18/10/2026 : fermer la connexion côté client
    (`http.client`) n'est pas vu comme une déconnexion par uvicorn 0.30 + h11 —
    la tâche de réponse n'est pas annulée, donc son `finally` ne s'exécute pas
    (vérifié hors dépôt, avec une application de trois lignes). Attendre un effet
    qui ne vient jamais ferait de ce cas un flake déguisé. La libération est donc
    prouvée là où elle est DÉTERMINISTE — `tests/test_live_streams_partages.py`,
    qui ferme le corps du flux comme le fait Starlette quand le serveur annule
    la réponse —, et ce cas-ci prouve le PARTAGE du plafond.
    """
    with banc_deux_workers(tmp_path) as banc:
        ouverts = []
        try:
            for worker in (
                banc.worker_a,
                banc.worker_b,
                banc.worker_a,
                banc.worker_b,
            ):
                flux = Flux(worker, banc.jeton_b, "/api/messages/stream")
                assert flux.reponse.status == 200, (
                    "le flux %d du compte a été refusé avant le plafond (%s)"
                    % (len(ouverts) + 1, flux.reponse.read(300))
                )
                ouverts.append(flux)

            refused = Flux(banc.worker_b, banc.jeton_b, "/api/messages/stream")
            try:
                assert refused.reponse.status == 503, (
                    "un cinquième flux a été ACCEPTÉ sur un worker qui n'en sert "
                    "que deux : le plafond est resté celui du process (status %s)"
                    % refused.reponse.status
                )
                assert refused.reponse.getheader("Retry-After") == "60", (
                    "le refus n'est pas un refus nommé (Retry-After absent)"
                )
            finally:
                refused.fermer()

        finally:
            for flux in ouverts:
                flux.fermer()


# ---------------------------------------------------------------------------
# Le fichier est-il lancé ? (ce cas tourne aussi SANS Redis)
# ---------------------------------------------------------------------------

JOB_HEADER = re.compile(r"^  ([A-Za-z0-9_-]+):\s*$")
STEP_HEADER = re.compile(r"^ {6}- (?P<reste>.*)$")
CLE_VALEUR = re.compile(r"^(?P<indent> +)(?P<cle>[A-Za-z0-9_-]+):(?P<valeur>.*)$")
# Formes de bloc scalaire YAML : `run: |`, `run: >-`…
BLOCS = ("|", ">", "|-", ">-")

# Plancher de lecture : sous ce nombre de lignes, c'est le LECTEUR qui est cassé
# (mise en forme du workflow changée), pas le dépôt qui a perdu son étape.
MIN_LIGNES_CI = 500


def _bloc_job(texte: str, job: str) -> list:
    """Les lignes d'un job, bornées par le job suivant (même lecteur que
    `tests/test_seo_probe_post_deploy.py` : `PyYAML` n'est pas une dépendance
    du dépôt, et un lecteur fautif doit se voir dans un plancher de lecture)."""
    lignes = texte.splitlines()
    debut = None
    for index, ligne in enumerate(lignes):
        entete = JOB_HEADER.match(ligne)
        if entete and entete.group(1) == job:
            debut = index + 1
            break
    assert debut is not None, (
        "job « %s » introuvable dans %s : le lecteur ne voit rien, il ne peut "
        "donc rien verrouiller." % (job, CI.name)
    )
    fin = len(lignes)
    for index in range(debut, len(lignes)):
        if JOB_HEADER.match(lignes[index]):
            fin = index
            break
    return lignes[debut:fin]


def _etapes(lignes: list) -> list:
    """Les étapes d'un bloc de job : une liste de dictionnaires clé → valeur.

    Un bloc scalaire (`run: |`) est déplié et dé-indenté, pour que la COMMANDE
    soit comparable telle quelle (et pas seulement « quelque part dans l'étape »,
    où un commentaire suffirait).
    """
    resultat = []
    courante = None
    cle_scalaire = None
    indentation = 0
    for ligne in lignes:
        entete = STEP_HEADER.match(ligne)
        if entete:
            courante = {}
            resultat.append(courante)
            cle_scalaire = None
            reste = entete.group("reste").strip()
            if ":" in reste:
                cle, valeur = reste.split(":", 1)
                courante[cle.strip()] = valeur.strip()
            continue
        if courante is None:
            continue
        correspondance = CLE_VALEUR.match(ligne)
        if correspondance:
            cle = correspondance.group("cle")
            valeur = correspondance.group("valeur").strip()
            if valeur in BLOCS:
                cle_scalaire = cle
                indentation = len(correspondance.group("indent"))
                courante[cle] = []
                continue
            cle_scalaire = None
            courante[cle] = valeur
            continue
        if cle_scalaire is not None:
            corps = ligne.strip()
            if corps and len(ligne) - len(ligne.lstrip()) > indentation:
                courante[cle_scalaire].append(corps)
    return resultat


def _texte(valeur) -> str:
    if isinstance(valeur, list):
        return "\n".join(valeur)
    return valeur or ""


def test_le_workflow_lance_ce_fichier_avec_un_vrai_redis():
    """Un test que personne ne lance est un silence — celui-là se déclare lancé.

    Sans ce cas, supprimer l'étape dédiée de `ci.yml` ne ferait rougir personne :
    le fichier serait collecté par la suite principale, s'y déclarerait
    inapplicable (pas de `TEST_REDIS_URL`), et le job resterait vert alors que
    plus rien ne prouve la traversée du bus. Ce cas tourne, lui, dans la suite
    principale : il ne demande ni Redis ni base.
    """
    assert CI.exists(), "workflow introuvable : %s" % CI
    with open(CI, "r", encoding="utf-8", newline="") as flux:
        texte = flux.read()
    assert len(texte.splitlines()) >= MIN_LIGNES_CI, (
        "lecture suspecte de %s (%d lignes, plancher %d) : le lecteur est cassé, "
        "il ne peut rien verrouiller."
        % (CI.name, len(texte.splitlines()), MIN_LIGNES_CI)
    )

    lignes = _bloc_job(texte, JOB)
    bloc = "\n".join(lignes)

    # 1) Un VRAI Redis à côté du MongoDB déjà servi par ce job.
    assert re.search(r"^\s+redis:\s*$", bloc, re.M), (
        "le job %s ne déclare aucun service « redis » : le bus ne serait jugé "
        "contre rien." % JOB
    )
    assert re.search(r"image:\s*%s\b" % re.escape(IMAGE_REDIS), bloc), (
        "le service redis du job %s n'utilise pas l'image %s."
        % (JOB, IMAGE_REDIS)
    )
    assert re.search(r"-\s*%s:%s" % (PORT_REDIS, PORT_REDIS), bloc), (
        "le service redis du job %s n'expose pas le port %s : l'étape dédiée ne "
        "pourrait pas l'atteindre." % (JOB, PORT_REDIS)
    )

    # 2) UNE étape lance ce fichier, avec le mandat posé.
    etapes = [etape for etape in _etapes(lignes) if FICHIER_TEST in _texte(etape.get("run"))]
    assert len(etapes) == 1, (
        "attendu exactement une étape de %s lançant %s, trouvé %d : deux "
        "invocations divergeraient, aucune n'en ferait rien."
        % (JOB, FICHIER_TEST, len(etapes))
    )
    etape = etapes[0]
    assert "TEST_REDIS_URL" in etape and "redis://" in etape["TEST_REDIS_URL"], (
        "l'étape qui lance %s ne pose pas TEST_REDIS_URL : le test se déclarerait "
        "inapplicable et le job resterait vert sans avoir rien prouvé."
        % FICHIER_TEST
    )
    assert "TEST_MONGO_URL" in etape, (
        "l'étape qui lance %s ne pose pas TEST_MONGO_URL : les deux workers "
        "n'auraient pas de base, et le test ne prouverait rien." % FICHIER_TEST
    )

    # 3) Aucune soupape : un rouge qui ne rougit pas est le silence de F9.
    assert "continue-on-error" not in etape, (
        "l'étape de %s qui prouve le bus est tolérante à l'échec "
        "(continue-on-error) : elle ne prouverait plus rien." % JOB
    )
    assert "|| true" not in _texte(etape.get("run")), (
        "la commande de l'étape qui prouve le bus est neutralisée (|| true)."
    )
