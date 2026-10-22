# -*- coding: utf-8 -*-
"""Les envois d'emails passent-ils TOUS par le point qui porte le filtre ?

Ce que ce fichier empêche, mesuré sur la source réelle des modules du produit :

  * un module qui appelle directement un fournisseur
    (`send_email_via_brevo_api` / `_resend_api` / `_gmail_api`) contourne
    `send_email_via_active_provider` — donc le filtre des adresses retenues
    (rebonds définitifs, plaintes). Le produit recommencerait à écrire dans le
    vide pour ce chemin-là, et rien ne rougirait : c'est exactement le défaut
    que la chaîne des webhooks existe pour fermer ;
  * une URL d'envoi écrite ailleurs que dans les deux fichiers qui la
    possèdent, c'est la même contournement par une autre porte (un
    `requests.post` vers le fournisseur, sans passer par les constantes) ;
  * et le filtre lui-même : le point de règle doit RÉELLEMENT consulter les
    adresses retenues. Un `adresse_supprimee` qui disparaît de son corps
    laisserait tout le reste au vert.

PÉRIMÈTRE — les modules `backend/kojo_*.py`, c'est-à-dire le produit. Les
outils de `backend/scripts/` et les tests en sont exclus, et c'est déclaré ici :
`backend/scripts/send_test_email_resend.py` appelle délibérément l'API Resend en
direct (c'est une sonde d'exploitation, à adresse explicite, pas un envoi
produit). Le plancher de lecture refuse de conclure si le périmètre est vide —
un globbing cassé rendrait sinon ce garde vert en ne regardant rien.
"""
import inspect
import re
from pathlib import Path

import pytest

import kojo_email

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Les fonctions d'envoi par fournisseur : elles ne doivent être appelées que par
# `send_email_via_active_provider`, dans kojo_email.py.
ENVOIS_PAR_FOURNISSEUR = (
    "send_email_via_brevo_api",
    "send_email_via_resend_api",
    "send_email_via_gmail_api",
)

# Les URL d'envoi, et les SEULS fichiers qui peuvent les écrire.
URLS_D_ENVOI = {
    "https://api.brevo.com/v3/smtp/email": ("kojo_settings.py", "kojo_email.py"),
    "https://api.resend.com/emails": ("kojo_settings.py", "kojo_email.py"),
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send": ("kojo_email.py",),
}

# Le point de règle, et la fonction qu'il doit consulter.
POINT_DE_REGLE = "send_email_via_active_provider"
CONSULTATION = "adresse_supprimee"

# Sous ce nombre de modules lus, le périmètre est cassé, pas le dépôt : on refuse
# de conclure plutôt que de passer au vert sur un scan vide.
PLANCHER_MODULES = 20


def _modules_du_produit():
    """Les modules `backend/kojo_*.py`, lus depuis le disque (jamais une liste)."""
    return sorted(BACKEND_DIR.glob("kojo_*.py"))


def _sources():
    return {chemin.name: chemin.read_text(encoding="utf-8") for chemin in _modules_du_produit()}


class TestPerimetre:
    def test_le_perimetre_est_reellement_lu(self):
        sources = _sources()

        assert len(sources) >= PLANCHER_MODULES, (
            "modules du produit lus : %d — le scan ne regarde pas au bon endroit "
            "(attendu au moins %d)" % (len(sources), PLANCHER_MODULES)
        )
        # Deux témoins : le point de règle et l'ingestion des webhooks.
        assert "kojo_email.py" in sources
        assert "kojo_routers_email.py" in sources


class TestAucunEnvoiNeContourneLePointDeRegle:
    def test_aucun_module_du_produit_n_appelle_un_fournisseur_en_direct(self):
        """Hors `kojo_email.py`, un appel direct est un envoi SANS filtre."""
        fautes = []
        for nom, source in _sources().items():
            if nom == "kojo_email.py":
                continue  # c'est le point de règle : c'est LUI qui choisit
            for fonction in ENVOIS_PAR_FOURNISSEUR:
                for ligne_no, ligne in enumerate(source.splitlines(), start=1):
                    if ligne.strip().startswith("#"):
                        continue
                    if re.search(r"\b%s\s*\(" % fonction, ligne):
                        fautes.append("%s:%d appelle %s()" % (nom, ligne_no, fonction))

        assert fautes == [], (
            "envoi(s) qui contournent %s — donc le filtre des adresses retenues : "
            "%s. Un envoi produit doit passer par le point de règle ; si l'appelant "
            "est un OUTIL et non le produit, le sortir de backend/kojo_*.py."
            % (POINT_DE_REGLE, " | ".join(fautes))
        )

    def test_aucune_url_d_envoi_ailleurs_que_dans_ses_deux_maisons(self):
        fautes = []
        for nom, source in _sources().items():
            for ligne_no, ligne in enumerate(source.splitlines(), start=1):
                if ligne.strip().startswith("#"):
                    continue
                for url, maisons in URLS_D_ENVOI.items():
                    if url in ligne and nom not in maisons:
                        fautes.append(
                            "%s:%d écrit l'URL d'envoi %s (maisons déclarées : %s)"
                            % (nom, ligne_no, url, ", ".join(maisons))
                        )

        assert fautes == [], (
            "URL(s) d'envoi hors de leurs fichiers : %s — un `requests.post` vers "
            "le fournisseur depuis un autre module est le même contournement que "
            "l'appel direct" % " | ".join(fautes)
        )

    def test_les_maisons_declarees_existent_toujours(self):
        """Une déclaration périmée (fichier renommé) rendrait le refus ci-dessus
        silencieux, donc le garde décoratif."""
        sources = _sources()
        inconnues = [
            maison for maisons in URLS_D_ENVOI.values() for maison in maisons
            if maison not in sources
        ]

        assert inconnues == [], (
            "fichier(s) déclaré(s) comme maison d'une URL d'envoi introuvable(s) : %s"
            % sorted(set(inconnues))
        )


class TestLeFiltreEstBienAuPointDeRegle:
    def test_le_point_de_regle_consulte_les_adresses_retenues(self):
        """Sans cette consultation, tout le reste du dépôt peut être vert alors
        qu'aucune adresse retenue n'est réellement épargnée."""
        source = inspect.getsource(kojo_email.send_email_via_active_provider)

        assert CONSULTATION in source, (
            "%s n'appelle plus %s : le filtre des adresses retenues n'est plus "
            "sur le chemin des envois" % (POINT_DE_REGLE, CONSULTATION)
        )

    def test_le_point_de_regle_est_asynchrone(self):
        """Le filtre lit la base : un point de règle synchrone ne pourrait pas
        la consulter, donc l'asynchronie est une propriété du filtre."""
        assert inspect.iscoroutinefunction(kojo_email.send_email_via_active_provider), (
            "%s est redevenu synchrone : il ne peut alors plus consulter les "
            "adresses retenues" % POINT_DE_REGLE
        )

    def test_le_filtre_ne_repond_pas_par_une_exception(self):
        """Un envoi annulé rend None et le journalise : lever ici ferait échouer
        les alertes propriétaire, qui sont best-effort par construction."""
        source = inspect.getsource(kojo_email.send_email_via_active_provider)

        assert "return None" in source
        assert "logger.warning" in source

    def test_les_modules_du_produit_qui_envoient_passent_par_le_point_de_regle(self):
        """Le pendant positif du premier refus : les envois RÉELS du produit
        (alertes propriétaire, OTP) sont là, et ils passent par le point de règle.

        Sans cette mesure, supprimer TOUS les envois rendrait les trois refus
        ci-dessus verts en ne mesurant plus rien.
        """
        sources = _sources()
        appelants = {
            nom for nom, source in sources.items()
            if re.search(r"\b%s\s*\(" % POINT_DE_REGLE, source)
        }

        # L'alerte propriétaire d'un ticket support vit dans
        # `kojo_support_tickets` (propriétaire unique de l'ouverture, partagé
        # par le formulaire web et l'escalade WhatsApp) : c'est donc LUI qui
        # doit paraître ici, et `kojo_routers_support.py` ne l'envoie plus
        # lui-même — le déplacer ailleurs redeviendrait un envoi hors règle.
        assert appelants >= {
            "kojo_email.py", "kojo_payments.py", "kojo_support_tickets.py",
            "kojo_scheduler.py",
        }, (
            "modules qui passent par %s : %s — un envoi produit a disparu, ou il a "
            "été déplacé hors du point de règle"
            % (POINT_DE_REGLE, sorted(appelants))
        )


@pytest.mark.parametrize("url,maisons", sorted(URLS_D_ENVOI.items()))
def test_les_urls_declarees_sont_bien_celles_du_fournisseur(url, maisons):
    """La table ci-dessus est confrontée au code : une URL mal recopiée ferait
    porter le refus sur une chaîne qui n'existe nulle part, donc jamais."""
    source = "\n".join(_sources().get(maison, "") for maison in maisons)

    assert url in source, (
        "l'URL %s n'apparaît nulle part dans %s : le refus correspondant ne peut "
        "jamais mordre" % (url, ", ".join(maisons))
    )
