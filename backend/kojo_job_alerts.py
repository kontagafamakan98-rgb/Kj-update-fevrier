# -*- coding: utf-8 -*-
"""Alertes emploi — « prévenez-moi quand une mission correspond ».

Deux canaux sortent d'ici : un email, et une notification in-app (plus le push
web quand l'appareil s'y est abonné). Les deux sont décrits ci-dessous.

POURQUOI CE MODULE EXISTE. Le produit n'avait aucun chemin de RETOUR : un
travailleur qui ouvrait `/jobs` une fois n'avait plus de raison de revenir, et
une mission publiée le lendemain ne le touchait que s'il repassait de lui-même.
Les concurrents de la région vendent précisément cette alerte, et le canal est
l'email — disponible sans application ni numéro WhatsApp vérifié, et déjà
outillé dans le dépôt (fournisseur actif, filtres d'adresses retenues,
planificateur avec bail).

CE QUI EST DÉCIDÉ ICI, ET NULLE PART AILLEURS :

  • UNE VEILLE PAR COMPTE (`user_id` unique). Plusieurs veilles par compte
    donneraient des emails qui se recoupent (deux critères qui matchent la même
    mission), et une désinscription qui n'en coupe qu'une. Un seul document
    rend la désinscription d'un clic et le dédoublonnage gratuit.
  • UN RÉSUMÉ, PAS UN FLOT. Le passage est périodique (`job_alert_digest_loop`,
    bail `job_alert_digest`) : dix missions publiées dans l'heure font UN email,
    pas dix. Une alerte qui enverrait à chaque publication serait indistinguishable
    d'un spam, et le premier réflexe serait de se désabonner.
  • LA FENÊTRE EST TEMPORELLE, jamais un état « déjà vu » par mission : le
    marqueur `last_notified_at` avance après chaque envoi, et la recherche ne
    regarde que les missions publiées APRÈS lui. Rien à stocker par couple
    (alerte, mission), rien qui puisse grossir sans borne.
  • L'EMAIL PASSE PAR LE POINT DE RÈGLE (`send_email_via_active_provider`), le
    seul endroit où les adresses RETENUES sont filtrées (`kojo_email_suppressions`).
    Une adresse injoignable ne produit donc aucun appel au fournisseur, et
    l'alerte n'est pas désactivée pour autant : c'est le propriétaire qui lève
    une adresse retenue, et une veille n'a pas à décider à sa place.
  • LE JETON DE DÉSINSCRIPTION EST UNE CAPACITÉ, stockée en clair comme
    `disburse_token` : il ne sert qu'à couper une veille, l'action est
    réversible d'un PUT, et le hacher empêcherait de ré-émettre un lien. Il est
    tiré par `secrets.token_urlsafe` (jamais `random`).
  • DEUX CANAUX, UN SEUL RÉSUMÉ. L'email seul ne touchait que ceux qui
    ouvrent leur boîte : le même passage dépose donc aussi une NOTIFICATION
    in-app (et un push aux appareils abonnés), qui ne dépend ni d'une adresse
    joignable ni d'un fournisseur email. Le résumé reste UN par passage sur les
    deux canaux — une notification par mission rendrait le centre de
    notifications illisible et ramènerait le flot que l'email évite.
  • AUCUN DOUBLON AVEC LE PUSH DE PUBLICATION. `_notify_matching_workers`
    (publication d'une mission, 30 travailleurs par spécialité ou pays) et
    cette veille annonçaient la MÊME mission au même travailleur. Une mission
    ne prévient donc qu'UNE fois : quand une veille ACTIVE répond déjà aux
    critères de la mission, c'est ELLE qui porte l'annonce, et le push de
    publication se tait pour ce compte (`comptes_couverts`, consultée avant sa
    boucle). Aucun état par couple (veille, mission) n'est écrit pour cela : la
    veille dit elle-même qu'elle couvre la mission, et son passage suivant la
    sert puisque `last_notified_at` n'a pas bougé. Le prix, DIT : un compte qui
    a une veille reçoit la mission au RÉSUMÉ suivant (au plus
    `JOB_ALERT_DIGEST_INTERVAL_MINUTES`) au lieu du push immédiat — c'est le
    canal qu'il a demandé. Les travailleurs SANS veille gardent le push de
    publication, inchangé, et la majorité d'entre eux n'en ont pas. Seconde
    conséquence, BORNÉE et déjà assumée par le résumé : `MAX_JOBS_PAR_EMAIL`
    missions par passage, les plus récentes — dans une heure qui en publierait
    davantage, les plus anciennes ne partent pas, et pour un compte en veille
    le push ne les couvre plus non plus.
  • LA FENÊTRE AVANCE SI AU MOINS UN CANAL A ABOUTI : la notification est
    écrite AVANT l'email, et son retour est LU (jamais supposé). Sans cela,
    deux échecs consécutifs feraient répéter la même alerte toutes les heures ;
    avec cela, une alerte déjà délivrée par un canal n'est pas renvoyée par
    l'autre. La notification renvoie vers la LISTE (`/jobs`), pas vers une
    fiche choisie à la place du travailleur : elle en résume plusieurs.

CE QUE CE MODULE N'ENVOIE PAS : l'adresse email n'est écrite qu'une fois, à
l'activation, et lue pour l'envoi. Elle n'est jamais rendue par la route de
lecture (une veille est une préférence, pas un annuaire). Les critères sont
bornés et comparés en mémoire sur une lecture elle-même bornée : sans critère,
la veille suit le PAYS du compte, jamais le monde entier.
"""
import secrets
from datetime import datetime, timezone
from typing import Optional

from kojo_core import db
from kojo_email import send_email_via_active_provider
from kojo_job_categories import _CATEGORY_TO_CANONICAL, _normalize_job_category
from kojo_models import NotificationType
from kojo_settings import BACKEND_PUBLIC_URL, FRONTEND_APP_URL, logger
from kojo_shared import notify_user_localized

# Une seule collection : l'état de la veille (`active`, critères, marqueur) et
# le jeton. Pas de journal des envois : le compteur suffit à expliquer une
# veille, et un journal par email serait une donnée de plus à purger.
COLLECTION = "job_alerts"

# Bornes, toutes choisies pour que le passage reste une lecture courte même si
# la base grandit : cinq missions par email (au-delà, le message devient une
# liste que personne ne lit), deux cents veilles par passage, deux cents
# missions examinées.
MAX_JOBS_PAR_EMAIL = 5
MAX_ALERTES_PAR_PASSAGE = 200
MAX_JOBS_EXAMINES = 200

# Bornes des critères : celles des champs qu'ils désignent (catégorie 50,
# ville 100, pays 50).
CATEGORIE_MAX = 50
VILLE_MAX = 100
PAYS_MAX = 50

# Origine publiée dans l'email : le site s'il est configuré (le lien doit
# atterrir sur la page, pas sur l'API), sinon l'API publique, sinon le
# développement local — un email dont le lien ne mène nulle part est pire que
# pas d'email.
SITE_PAR_DEFAUT = "https://kojoforafrica.cc.cd"


def _base_publique() -> str:
    """Origine des liens de l'email, sans slash final."""
    for candidat in (FRONTEND_APP_URL, BACKEND_PUBLIC_URL, SITE_PAR_DEFAUT):
        if candidat:
            return str(candidat).rstrip("/")
    return SITE_PAR_DEFAUT


def _texte(valeur, maximum: int = 100) -> str:
    """Chaîne nettoyée et bornée — jamais un type inattendu rendu tel quel."""
    if valeur is None or isinstance(valeur, bool):
        return ""
    return str(valeur).strip()[:maximum]


def _instant(valeur) -> Optional[datetime]:
    """Date d'un document (datetime OU chaîne ISO), ou None.

    Les documents importés portent parfois une chaîne : refuser l'un des deux
    formats ferait disparaître la fenêtre pour la moitié des missions sans
    erreur — donc la veille enverrait ou n'enverrait jamais, sans le dire.
    """
    if isinstance(valeur, datetime):
        return valeur if valeur.tzinfo else valeur.replace(tzinfo=timezone.utc)
    texte = _texte(valeur, 40)
    if not texte:
        return None
    try:
        return datetime.fromisoformat(texte.replace("Z", "+00:00"))
    except ValueError:
        return None


def _categorie_connue(valeur: str) -> bool:
    """Vrai si la valeur désigne une catégorie réelle du produit.

    `_normalize_job_category` ramène toute inconnue à « general » : l'accepter
    sans contrôle ferait d'une faute de frappe (« plombier ») une veille qui
    reçoit TOUTES les missions générales — un email juste assez plausible pour
    ne jamais être signalé.
    """
    texte = _texte(valeur, CATEGORIE_MAX).lower()
    if not texte:
        return True
    # La table est celle du produit : aucune liste recopiée, donc aucune
    # catégorie acceptée ici que les missions ne connaissent pas.
    return texte in _CATEGORY_TO_CANONICAL


def _ville_du_job(job: dict) -> str:
    location = job.get("location") if isinstance(job.get("location"), dict) else {}
    return _texte(location.get("city"), VILLE_MAX)


def correspond(alerte: dict, job: dict) -> bool:
    """Vrai si `job` répond à la veille — fonction PURE, donc éprouvable.

    Les trois critères sont indépendants : une catégorie seule, une ville seule,
    ou leur conjonction. Un critère absent ne filtre rien ; un critère présent
    et absent de la mission ne matche PAS (une veille « plomberie à Dakar » ne
    doit pas envoyer une électricité à Abidjan).
    """
    if not isinstance(job, dict) or not isinstance(alerte, dict):
        return False
    if job.get("deleted"):
        return False
    if str(job.get("status") or "open").lower() != "open":
        return False

    categorie = _texte(alerte.get("category"), CATEGORIE_MAX)
    if categorie and _normalize_job_category(categorie) != _normalize_job_category(
        job.get("category")
    ):
        return False

    ville = _texte(alerte.get("city"), VILLE_MAX)
    if ville and ville.casefold() != _ville_du_job(job).casefold():
        return False

    pays = _texte(alerte.get("country"), PAYS_MAX)
    if pays and pays.casefold() != _texte(job.get("country"), PAYS_MAX).casefold():
        return False

    return True


async def comptes_couverts(worker_ids, mission: dict) -> set:
    """Les comptes dont une veille ACTIVE couvre DÉJÀ cette mission.

    Le point de règle de l'anti-doublon : le push de publication appelle cette
    fonction AVANT de notifier, et retire de ses cibles les comptes rendus ici.
    Sans elle, le travailleur qui a activé une veille recevait le push de
    matching puis, moins d'une heure après, le résumé de la MÊME mission.

    Aucun état par couple (veille, mission) n'est écrit : la veille elle-même
    est la preuve que le compte sera servi par `passage_digest` — la mission
    est postérieure à `last_notified_at` (le push ne fait pas avancer cette
    fenêtre) et répond aux critères (c'est `correspond` qui le dit). Si la
    veille est coupée avant le passage suivant, l'annonce ne part plus : c'est
    le prix, déclaré ici — couper une veille, c'est demander à ne plus être
    prévenu.

    Lecture bornée : une seule requête pour au plus les cibles du push (30),
    et `correspond` reste la fonction PURE qui décide, pour que la règle du
    doublon ne puisse pas diverger de la règle de correspondance.
    """
    identifiants = []
    for identifiant in worker_ids or ():
        texte = _texte(identifiant, 200)
        # L'ordre est conservé (l'appelant notifie dans cet ordre) et un
        # doublon ne coûte qu'une comparaison.
        if texte and texte not in identifiants:
            identifiants.append(texte)
    if not identifiants or not isinstance(mission, dict):
        return set()

    veilles = await db[COLLECTION].find(
        {"user_id": {"$in": identifiants}, "active": True}
    ).to_list(None)
    return {
        veille.get("user_id")
        for veille in veilles
        if veille.get("user_id") and correspond(veille, mission)
    }


def vue(alerte: Optional[dict]) -> dict:
    """Ce qu'une veille expose à son propriétaire.

    Le JETON n'y est pas : il sert au lien de désinscription, et une route qui
    le rendrait le donnerait à tout script capable de lire la réponse. Il n'est
    pas perdu pour autant — un email déjà reçu le porte.
    """
    if not alerte:
        return {
            "active": False,
            "category": None,
            "city": None,
            "country": None,
            "sent_count": 0,
            "last_notified_at": None,
        }
    dernier = _instant(alerte.get("last_notified_at"))
    return {
        "active": bool(alerte.get("active")),
        "category": alerte.get("category") or None,
        "city": alerte.get("city") or None,
        "country": alerte.get("country") or None,
        "sent_count": int(alerte.get("sent_count") or 0),
        "last_notified_at": dernier.isoformat() if dernier else None,
    }


async def lire(user_id: str) -> dict:
    """La veille d'un compte, ou une veille inactive (jamais une 404).

    Une page qui demande « ai-je une alerte ? » n'a pas à distinguer « aucune »
    de « inconnue » : les deux se composent en `active: false`, et l'écran
    affiche le formulaire.
    """
    document = await db[COLLECTION].find_one({"user_id": user_id})
    return vue(document)


async def enregistrer(user_id: str, email: str, donnees: dict) -> dict:
    """Crée ou met à jour la veille du compte — un seul document.

    `email` est l'adresse du COMPTE au moment de l'écriture : c'est celle qui
    sera utilisée pour l'envoi, pas une adresse fournie par le client (sinon la
    route deviendrait un moyen d'envoyer des emails à un tiers).
    """
    donnees = donnees if isinstance(donnees, dict) else {}

    categorie = _texte(donnees.get("category"), CATEGORIE_MAX) or None
    if categorie and not _categorie_connue(categorie):
        raise ValueError(
            f"catégorie inconnue « {categorie} » — choisir une catégorie proposée par la liste des missions"
        )

    ville = _texte(donnees.get("city"), VILLE_MAX) or None
    pays = _texte(donnees.get("country"), PAYS_MAX) or None
    active = bool(donnees.get("active", True))

    maintenant = datetime.now(timezone.utc)
    existante = await db[COLLECTION].find_one({"user_id": user_id})

    changement = {
        "email": _texte(email, 200),
        "category": categorie,
        "city": ville,
        "country": pays,
        "active": active,
        "updated_at": maintenant,
    }

    # RÉACTIVATION : la fenêtre repart de MAINTENANT. Sans cela, une veille
    # laissée en pause trois semaines se réveillerait avec une pile de missions
    # périmées — que le travailleur n'a pas demandé à recevoir en une fois.
    if active and existante is not None and not existante.get("active"):
        changement["last_notified_at"] = maintenant

    # Le jeton manque aux veilles créées avant son introduction : il se pose à
    # la première activation, jamais à la lecture (une route de lecture qui
    # écrit est une route qui ne peut plus être mise en cache).
    pose_jeton = {}
    if active and not (existante or {}).get("token"):
        pose_jeton["token"] = secrets.token_urlsafe(32)

    try:
        await db[COLLECTION].update_one(
            {"user_id": user_id},
            {
                "$set": {**changement, **pose_jeton},
                "$setOnInsert": {
                    "created_at": maintenant,
                    "sent_count": 0,
                    "last_checked_at": None,
                },
            },
            upsert=True,
        )
    except Exception as exc:  # noqa: BLE001 - course d'insertion, pas une panne
        # Deux activations SIMULTANÉES (double clic, deux onglets) : l'index
        # unique `user_id` fait perdre l'une des deux insertions. Ce n'est pas
        # une erreur pour l'utilisateur — la veille existe, c'est tout — mais
        # une 500 le ferait croire à un échec et l'inviterait à recommencer.
        if getattr(exc, "code", None) != 11000:
            raise
        await db[COLLECTION].update_one(
            {"user_id": user_id}, {"$set": {**changement, **pose_jeton}}
        )

    document = await db[COLLECTION].find_one({"user_id": user_id})
    return vue(document)


async def desactiver(user_id: str) -> dict:
    """Coupe la veille SANS effacer ses critères.

    La désactivation réversible est une décision de produit : le lien d'un email
    ne demande pas de confirmer une perte, et un travailleur qui revient retrouve
    ce qu'il avait réglé.
    """
    maintenant = datetime.now(timezone.utc)
    await db[COLLECTION].update_one(
        {"user_id": user_id},
        {"$set": {"active": False, "updated_at": maintenant}},
    )
    document = await db[COLLECTION].find_one({"user_id": user_id})
    return vue(document)


async def desabonner_par_jeton(jeton: str) -> bool:
    """Coupe la veille désignée par un jeton d'email. Vrai si elle existait.

    Le jeton est comparé par une requête (index unique) : pas de `==` sur des
    chaînes secrètes dans le code applicatif, donc pas de comparaison
    chronométrée à exploiter.
    """
    texte = _texte(jeton, 200)
    if not texte:
        return False
    document = await db[COLLECTION].find_one({"token": texte})
    if not document:
        return False
    await desactiver(document.get("user_id"))
    return True


def _missions_correspondantes(alerte: dict, jobs: list, depuis: Optional[datetime]) -> list:
    """Les missions publiées APRÈS la fenêtre qui répondent aux critères.

    Tri par date de publication décroissante : les plus récentes d'abord, puis
    la borne de l'email. Une mission sans date lisible est ignorée plutôt que
    datée d'office — la dater de « maintenant » la ferait envoyer à chaque
    passage.
    """
    retenues = []
    for job in jobs:
        if not correspond(alerte, job):
            continue
        publiee = _instant(job.get("posted_at")) or _instant(job.get("created_at"))
        if publiee is None:
            continue
        if depuis is not None and publiee <= depuis:
            continue
        retenues.append((publiee, job))
    retenues.sort(key=lambda couple: couple[0], reverse=True)
    return [job for _, job in retenues[:MAX_JOBS_PAR_EMAIL]]


def _corps_email(alerte: dict, jobs: list) -> str:
    """Corps texte : les missions, leur ville, leur lien — et la sortie."""
    base = _base_publique()
    lignes = [
        "Bonjour,",
        "",
        "De nouvelles missions correspondent à votre alerte :",
        "",
    ]
    for job in jobs:
        titre = _texte(job.get("title"), 200) or "Mission"
        ville = _ville_du_job(job)
        identifiant = _texte(job.get("id"), 100)
        lien = f"{base}/jobs/{identifiant}" if identifiant else base
        lignes.append(f"- {titre}" + (f" ({ville})" if ville else ""))
        lignes.append(f"  {lien}")
    lignes.extend(
        [
            "",
            "Vous recevez cet email parce que vous avez activé une alerte emploi sur Kojo.",
            "Pour ne plus recevoir ces missions :",
            f"{base}/api/job-alerts/unsubscribe?token={_texte(alerte.get('token'), 200)}",
            "",
            "Kojo — services et travailleurs en Afrique de l'Ouest",
        ]
    )
    return "\n".join(lignes)


def _sujet(jobs: list) -> str:
    if len(jobs) == 1:
        return "KOJO — 1 nouvelle mission pour vous"
    return f"KOJO — {len(jobs)} nouvelles missions pour vous"


async def _notifier_veille(alerte: dict, jobs: list) -> bool:
    """Dépose la notification in-app et pousse le push. Vrai si la ligne EXISTE.

    Pourquoi ce canal : l'email ne touche que ceux qui ouvrent leur boîte, et
    une adresse retenue ou un fournisseur muet (`EMAIL_PROVIDER=none`) laisse la
    veille sans voie. La notification ne dépend d'aucun des deux.

    Une SEULE notification par passage, comme l'email : c'est un résumé, et
    quinze notifications pour quinze missions ramèneraient le flot que le
    résumé existe pour éviter.

    Le retour n'est pas décoratif : `notify_user` rend la ligne écrite ou `None`
    (destinataire supprimé, stockage en échec). C'est ce booléen qui autorise la
    fenêtre à avancer, donc une alerte délivrée ici ne repart pas au passage
    suivant. Une exception est avalée — un canal muet ne doit pas priver de
    l'autre — mais elle est COMPTÉE par l'appelant via ce `False`.
    """
    user_id = _texte(alerte.get("user_id"), 200)
    if not user_id or not jobs:
        return False

    premier = jobs[0] if isinstance(jobs[0], dict) else {}
    titre = _texte(premier.get("title"), 200) or "Mission"
    # Deux clés parce que l'interpolation ne sait pas accorder : « 1 missions »
    # est exactement le genre de détail qui fait douter du reste du message.
    cle = "job_alert_digest_one" if len(jobs) == 1 else "job_alert_digest_many"

    try:
        notification = await notify_user_localized(
            user_id=user_id,
            key=cle,
            notif_type=NotificationType.JOB_ALERT,
            # La notification RÉSUME plusieurs missions : elle renvoie vers la
            # LISTE, jamais vers une fiche choisie à la place du travailleur.
            related_type="job_alert",
            # `url` est lue par le service worker (`push-sw.js`) et par l'écran
            # au premier plan (`App.js`) : un clic atterrit sur `/jobs`, où les
            # filtres sont déjà ceux de la veille.
            push_data={"url": "/jobs", "type": "job_alert"},
            count=len(jobs),
            job_title=titre,
        )
    except Exception as exc:  # noqa: BLE001 - un canal muet ne prive pas de l'autre
        logger.warning(
            "⚠️ Alerte emploi : notification in-app non déposée (compte %s) : %s"
            % (user_id, exc)
        )
        return False

    return notification is not None


async def passage_digest(now: Optional[datetime] = None) -> dict:
    """Un passage : une lecture bornée des missions, un email par veille servie.

    Retourne un résumé mesurable (le banc et les tests le lisent) :
    `alertes`, `notifies` (notifications in-app déposées), `envoyes`, `missions`,
    `non_envoyes` (adresse retenue, ou envoi désactivé), `vides` (rien à
    envoyer) et `erreurs`. Aucune exception ne sort : une veille fautive ne doit
    pas empêcher les autres de partir, et un passage qui lève perdrait la
    fenêtre de TOUTES les veilles suivantes.
    """
    maintenant = now or datetime.now(timezone.utc)
    resume = {
        "alertes": 0,
        "notifies": 0,
        "envoyes": 0,
        "missions": 0,
        "non_envoyes": 0,
        "vides": 0,
        "erreurs": 0,
    }

    alertes = await db[COLLECTION].find({"active": True}).to_list(MAX_ALERTES_PAR_PASSAGE)
    resume["alertes"] = len(alertes)
    if not alertes:
        return resume

    # Une seule lecture des missions récentes, partagée par toutes les veilles :
    # une requête par veille ferait N lectures pour le même document.
    jobs = (
        await db.jobs.find({"status": "open", "deleted": {"$ne": True}})
        .sort("posted_at", -1)
        .to_list(MAX_JOBS_EXAMINES)
    )

    for alerte in alertes:
        depuis = _instant(alerte.get("last_notified_at")) or _instant(
            alerte.get("created_at")
        )
        correspondantes = _missions_correspondantes(alerte, jobs, depuis)

        if not correspondantes:
            resume["vides"] += 1
            # `last_checked_at` dit que le passage a eu lieu ; `last_notified_at`
            # ne bouge pas, sinon une mission publiée juste après serait sautée.
            await db[COLLECTION].update_one(
                {"user_id": alerte.get("user_id")},
                {"$set": {"last_checked_at": maintenant}},
            )
            continue

        # CANAL 1 — notification in-app + push. Il ne dépend NI d'une adresse
        # joignable NI du fournisseur email : c'est exactement ce qui manquait
        # pour un travailleur qui n'ouvre pas sa boîte.
        notifie = await _notifier_veille(alerte, correspondantes)
        if notifie:
            resume["notifies"] += 1

        # CANAL 2 — email, par le point de règle (adresses retenues filtrées là).
        email = _texte(alerte.get("email"), 200)
        email_traite = False
        if not email:
            resume["erreurs"] += 1
            logger.warning(
                "⚠️ Alerte emploi sans adresse email (compte %s) — email ignoré."
                % alerte.get("user_id")
            )
        else:
            try:
                envoye = await send_email_via_active_provider(
                    email, _sujet(correspondantes), _corps_email(alerte, correspondantes)
                )
            except Exception as exc:  # noqa: BLE001 - une veille fautive n'arrête pas les autres
                resume["erreurs"] += 1
                logger.warning(f"⚠️ Alerte emploi non envoyée (compte %s) : {exc}" % alerte.get("user_id"))
            else:
                # `None` = AUCUN envoi : adresse retenue par le filtre du point
                # de règle, ou envoi désactivé (EMAIL_PROVIDER=none). Ce n'est
                # pas une erreur — le point de règle a DÉCIDÉ — donc le canal
                # est traité, même sans email parti. Le prix, DIT : une fenêtre
                # marquée pendant que l'envoi était désactivé n'est pas
                # rattrapée plus tard ; et la notification in-app, elle, a bien
                # été déposée.
                email_traite = True
                if envoye is None:
                    resume["non_envoyes"] += 1
                else:
                    resume["envoyes"] += 1
                    resume["missions"] += len(correspondantes)

        # La fenêtre avance si AU MOINS UN canal a abouti. Deux échecs
        # consécutifs ne sont pas une panne à répéter toutes les heures, mais
        # une alerte DÉJÀ délivrée par un canal ne doit pas repartir par
        # l'autre : c'est la notification qui l'a livrée, la fenêtre le sait.
        avancement = {"$set": {"last_checked_at": maintenant}}
        if notifie or email_traite:
            avancement["$set"]["last_notified_at"] = maintenant
            avancement["$inc"] = {"sent_count": 1}
        await db[COLLECTION].update_one({"user_id": alerte.get("user_id")}, avancement)

    if resume["notifies"] or resume["envoyes"] or resume["non_envoyes"] or resume["erreurs"]:
        logger.info(
            "📨 Alertes emploi : %(notifies)d notification(s), %(envoyes)d email(s), "
            "%(missions)d mission(s), %(non_envoyes)d non envoyé(s), "
            "%(erreurs)d erreur(s) sur %(alertes)d veille(s)."
            % resume
        )
    return resume
