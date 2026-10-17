# -*- coding: utf-8 -*-
"""Adresses email injoignables : de la signature du webhook jusqu'à l'envoi arrêté.

Ce que ces tests verrouillent, et pourquoi :

  • la SIGNATURE est la seule preuve d'identité d'une route publique : sans
    elle, n'importe qui pourrait faire retenir les adresses qu'il veut en
    annonçant « cette boîte a rebondi », donc faire taire les emails d'un tiers.
    Le contrat Svix est donc jugé sur ses cas de refus (en-têtes absents,
    signature fausse, horodatage périmé, secret absent ou illisible) autant que
    sur le cas qui passe ;
  • la FRAÎCHEUR est bornée : sans borne, une requête signée capturée une fois
    se rejoue à jamais — et rejouer suffit ici à retenir une adresse ;
  • l'IDEMPOTENCE (svix-id) empêche un rebond re-livré de compter deux fois,
    donc de fausser le compteur d'alertes ;
  • la CONSÉQUENCE est celle qui a été décidée : un rebond permanent et une
    plainte retiennent l'adresse, un rebond transitoire non (la boîte existe) ;
  • le FILTRE est au point de règle : une adresse retenue ne produit AUCUN
    appel au fournisseur, et une demande d'OTP le dit au lieu d'annoncer un code
    qui ne partira pas.
"""
import base64
import hashlib
import hmac
import logging
import time
from unittest.mock import AsyncMock, patch

import pytest

import kojo_email
import kojo_email_suppressions as suppressions
from kojo_email_suppressions import (
    WebhookRefuse,
    adresse_boite,
    adresse_supprimee,
    enregistrer_fait,
    lever_suppression,
    lire_fait,
    verifier_signature,
)
from tests.conftest import BASE_USER, db_find_one, register_and_login

SECRET = "whsec_" + base64.b64encode(b"secret-de-test-32-octets-de-long").decode()
CHEMIN = "/api/email/resend-webhook"


def _corps(type_evenement: str, **donnees) -> bytes:
    import json

    charge = {
        "type": type_evenement,
        "created_at": "2026-10-17T09:00:00.000Z",
        "data": {"email_id": "email-1", "to": ["destinataire@example.com"], **donnees},
    }
    return json.dumps(charge).encode("utf-8")


def _entetes(corps: bytes, *, id_evenement="msg_1", horodatage=None, secret=SECRET, version="v1"):
    """Des en-têtes Svix VALIDES pour ce corps (la signature est calculée ici)."""
    cle = base64.b64decode(secret[len("whsec_"):])
    instant = str(int(time.time()) if horodatage is None else int(horodatage))
    signe = ("%s.%s." % (id_evenement, instant)).encode("utf-8") + corps
    signature = base64.b64encode(hmac.new(cle, signe, hashlib.sha256).digest()).decode("ascii")
    return {
        "svix-id": id_evenement,
        "svix-timestamp": instant,
        "svix-signature": "%s,%s" % (version, signature),
    }


class TestSignature:
    """La seule preuve d'identité d'une route publique."""

    def test_signature_valide_rend_l_identifiant_de_l_evenement(self):
        corps = _corps("email.bounced")
        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET):
            identifiant = verifier_signature(corps, _entetes(corps, id_evenement="msg_42"))

        # L'identifiant est ce qui porte l'idempotence : le rendre ici, c'est ce
        # qui permet au reste de la chaîne de ne pas compter deux fois.
        assert identifiant == "msg_42"

    def test_secret_absent_refuse_en_503_et_nomme_la_variable(self):
        corps = _corps("email.bounced")
        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", ""):
            with pytest.raises(WebhookRefuse) as refus:
                verifier_signature(corps, _entetes(corps))

        assert refus.value.statut == 503
        assert "RESEND_WEBHOOK_SECRET" in refus.value.motif

    def test_secret_sans_prefixe_refuse_et_dit_le_format(self):
        corps = _corps("email.bounced")
        # Des en-têtes COMPLETS : c'est le FORMAT du secret qui est jugé ici, pas
        # l'absence d'en-têtes (qui refuserait avant, et pour une autre raison).
        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", "pas-un-secret-svix"):
            with pytest.raises(WebhookRefuse) as refus:
                verifier_signature(corps, _entetes(corps))

        assert refus.value.statut == 503
        assert "whsec_" in refus.value.motif

    def test_secret_dont_la_partie_base64_est_illisible_refuse(self):
        corps = _corps("email.bounced")
        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", "whsec_????"):
            with pytest.raises(WebhookRefuse) as refus:
                verifier_signature(corps, _entetes(corps))

        assert refus.value.statut == 503
        assert "base64" in refus.value.motif

    @pytest.mark.parametrize("absent", ["svix-id", "svix-timestamp", "svix-signature"])
    def test_en_tete_absent_est_nomme(self, absent):
        corps = _corps("email.complained")
        entetes = _entetes(corps)
        entetes.pop(absent)

        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET):
            with pytest.raises(WebhookRefuse) as refus:
                verifier_signature(corps, entetes)

        assert refus.value.statut == 401
        assert absent in refus.value.motif

    def test_signature_fausse_refusee(self):
        corps = _corps("email.bounced")
        entetes = _entetes(corps)
        # Une seule lettre change : la comparaison doit porter sur toute la
        # signature, pas sur un préfixe.
        entetes["svix-signature"] = entetes["svix-signature"][:-2] + "ab"

        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET):
            with pytest.raises(WebhookRefuse) as refus:
                verifier_signature(corps, entetes)

        assert refus.value.statut == 401
        assert "Resend" in refus.value.motif

    def test_signature_d_un_autre_secret_refusee(self):
        corps = _corps("email.bounced")
        autre = "whsec_" + base64.b64encode(b"un-autre-secret-de-32-octets-ok").decode()

        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET):
            with pytest.raises(WebhookRefuse):
                verifier_signature(corps, _entetes(corps, secret=autre))

    def test_corps_modifie_apres_signature_refuse(self):
        """Le corps est signé EN OCTETS : le re-sérialiser casserait la signature."""
        corps = _corps("email.bounced")
        entetes = _entetes(corps)

        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET):
            with pytest.raises(WebhookRefuse):
                verifier_signature(corps + b" ", entetes)

    def test_horodatage_perime_refuse_et_nomme_la_fenetre(self):
        corps = _corps("email.bounced")
        vieux = int(time.time()) - 3600
        entetes = _entetes(corps, horodatage=vieux)

        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET), \
             patch("kojo_email_suppressions.EMAIL_WEBHOOK_TOLERANCE_SECONDS", 300):
            with pytest.raises(WebhookRefuse) as refus:
                verifier_signature(corps, entetes)

        assert refus.value.statut == 401
        assert "fraîcheur" in refus.value.motif
        # La fenêtre tolérée est publiée : un refus qui ne dit pas sa borne
        # oblige à relire le code pour comprendre ce qui a échoué.
        assert "300" in refus.value.motif

    def test_horodatage_illisible_refuse(self):
        corps = _corps("email.bounced")
        entetes = _entetes(corps)
        entetes["svix-timestamp"] = "hier"

        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET):
            with pytest.raises(WebhookRefuse) as refus:
                verifier_signature(corps, entetes)

        assert refus.value.statut == 401
        assert "illisible" in refus.value.motif

    def test_plusieurs_signatures_accepte_celle_qui_correspond(self):
        """Pendant une rotation, `svix-signature` en porte plusieurs."""
        corps = _corps("email.bounced")
        entetes = _entetes(corps)
        valide = entetes["svix-signature"]
        entetes["svix-signature"] = "v1,c2lnbmF0dXJlLWZhdXNzZQ== %s" % valide

        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET):
            assert verifier_signature(corps, entetes) == "msg_1"

    def test_version_inconnue_refusee(self):
        """Une signature `v2` n'est pas une signature valide, même bien formée."""
        corps = _corps("email.bounced")
        entetes = _entetes(corps, version="v2")

        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET):
            with pytest.raises(WebhookRefuse):
                verifier_signature(corps, entetes)

    def test_en_tetes_insensibles_a_la_casse(self):
        """Les noms d'en-têtes HTTP n'ont pas de casse : un mapping ordinaire
        doit être lu comme `request.headers` l'est."""
        corps = _corps("email.delivered")
        entetes = {nom.upper(): valeur for nom, valeur in _entetes(corps).items()}

        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET):
            assert verifier_signature(corps, entetes) == "msg_1"


class TestLectureDuFait:
    """Ce que le fait du fournisseur devient dans le produit."""

    def test_rebond_permanent_retient_l_adresse(self):
        fait = lire_fait({
            "type": "email.bounced",
            "data": {
                "to": ["destinataire@example.com"],
                "bounce": {"type": "Permanent", "subType": "Suppressed", "message": "mailbox not found"},
            },
        })

        assert fait["motif"] == suppressions.MOTIF_REBOND_PERMANENT
        assert fait["email"] == "destinataire@example.com"
        assert fait["type_rebond"] == "Permanent"
        assert fait["sous_type"] == "Suppressed"

    def test_rebond_transitoire_ne_retient_pas(self):
        fait = lire_fait({
            "type": "email.bounced",
            "data": {"to": ["destinataire@example.com"], "bounce": {"type": "Transient"}},
        })

        assert fait["motif"] == suppressions.MOTIF_REBOND_TRANSITOIRE
        assert fait["motif"] not in suppressions.MOTIFS_QUI_SUPPRIMENT

    def test_type_de_rebond_illisible_ne_retient_pas(self):
        """Supprimer est irréversible : on ne le fait que sur un fait NOMMÉ."""
        fait = lire_fait({
            "type": "email.bounced",
            "data": {"to": ["destinataire@example.com"], "bounce": {}},
        })

        assert fait["motif"] == suppressions.MOTIF_REBOND_TRANSITOIRE

    def test_plainte_retient_l_adresse(self):
        fait = lire_fait({"type": "email.complained", "data": {"to": ["destinataire@example.com"]}})

        assert fait["motif"] == suppressions.MOTIF_PLAINTE
        assert fait["motif"] in suppressions.MOTIFS_QUI_SUPPRIMENT

    @pytest.mark.parametrize(
        "type_evenement,motif",
        [
            ("email.delivered", suppressions.MOTIF_LIVRAISON),
            ("email.delivery_delayed", suppressions.MOTIF_RETARD),
        ],
    )
    def test_livraison_et_retard_sont_lus(self, type_evenement, motif):
        fait = lire_fait({"type": type_evenement, "data": {"to": ["destinataire@example.com"]}})

        assert fait["motif"] == motif

    def test_type_non_suivi_rend_none(self):
        """`None` n'est pas un refus : Resend en envoie d'autres, et refuser
        ferait re-livrer indéfiniment un fait qui ne nous concerne pas."""
        assert lire_fait({"type": "email.opened", "data": {"to": ["a@b.cd"]}}) is None

    def test_destinataire_en_chaine_accepte_comme_en_liste(self):
        """Les exemples de Resend portent `data.to` en tableau ; une forme
        scalaire ne doit pas transformer la file de webhooks en 400."""
        fait = lire_fait({"type": "email.delivered", "data": {"to": "destinataire@example.com"}})

        assert fait["email"] == "destinataire@example.com"

    def test_etiquette_de_boite_retiree(self):
        """`a+tag@` et `a@` sont la même boîte : sinon une étiquette blanchirait
        une adresse retenue."""
        fait = lire_fait({
            "type": "email.bounced",
            "data": {"to": ["prenom+kojo-probe-1234@example.com"], "bounce": {"type": "Permanent"}},
        })

        assert fait["email"] == "prenom@example.com"

    def test_charge_utile_sans_data_refusee(self):
        with pytest.raises(WebhookRefuse) as refus:
            lire_fait({"type": "email.bounced"})

        assert refus.value.statut == 400
        assert "data" in refus.value.motif

    def test_charge_utile_sans_destinataire_refusee(self):
        """Un fait qui devait nous concerner et qu'on ne sait pas lire ne se
        tait pas : il est nommé (surface aveugle déclarée)."""
        with pytest.raises(WebhookRefuse) as refus:
            lire_fait({"type": "email.bounced", "data": {"to": []}})

        assert refus.value.statut == 400
        assert "destinataire" in refus.value.motif

    def test_charge_utile_non_objet_refusee(self):
        with pytest.raises(WebhookRefuse):
            lire_fait(["pas", "un", "objet"])


def _fait(type_evenement, email="destinataire@example.com", **donnees):
    charge = {"type": type_evenement, "data": {"to": [email]}}
    charge["data"].update(donnees)
    return lire_fait(charge)


class TestEnregistrement:
    """La conséquence du fait : retenue, comptage, idempotence."""

    @pytest.mark.asyncio
    async def test_rebond_permanent_retenu_et_journalise(self):
        bilan = await enregistrer_fait(
            _fait("email.bounced", bounce={"type": "Permanent", "message": "no such user"}),
            id_evenement="evt-permanent-1",
        )

        assert bilan["nouveau"] is True
        assert bilan["supprime"] is True

        retenue = await adresse_supprimee("destinataire@example.com")
        assert retenue is not None
        assert retenue["motif"] == suppressions.MOTIF_REBOND_PERMANENT
        assert retenue["faits"] == 1
        assert retenue["premier_fait_le"] is not None

        journal = await db_find_one("email_delivery_events", {"id_evenement": "evt-permanent-1"})
        assert journal is not None
        assert journal["motif"] == suppressions.MOTIF_REBOND_PERMANENT
        # `recu_le` est une DATE : la règle de conservation de ce journal est un
        # index TTL, et un index TTL ne mord pas sur une chaîne ISO.
        assert hasattr(journal["recu_le"], "year")

    @pytest.mark.asyncio
    async def test_plainte_retenue(self):
        bilan = await enregistrer_fait(_fait("email.complained"), id_evenement="evt-plainte-1")

        assert bilan["supprime"] is True
        retenue = await adresse_supprimee("destinataire@example.com")
        assert retenue["motif"] == suppressions.MOTIF_PLAINTE

    @pytest.mark.asyncio
    async def test_deuxieme_fait_ne_cree_pas_une_seconde_ligne(self):
        await enregistrer_fait(
            _fait("email.bounced", bounce={"type": "Permanent"}), id_evenement="evt-1"
        )
        premier = await adresse_supprimee("destinataire@example.com")
        await enregistrer_fait(
            _fait("email.complained"), id_evenement="evt-2"
        )
        second = await adresse_supprimee("destinataire@example.com")

        assert second["faits"] == 2
        assert second["premier_fait_le"] == premier["premier_fait_le"]
        assert second["motif"] == suppressions.MOTIF_PLAINTE

    @pytest.mark.asyncio
    async def test_rebond_transitoire_alerte_sans_retenir(self):
        with patch("kojo_email_suppressions.EMAIL_SOFT_BOUNCE_ALERT_THRESHOLD", 1):
            bilan = await enregistrer_fait(
                _fait("email.bounced", bounce={"type": "Transient"}), id_evenement="evt-transitoire-1"
            )

        assert bilan["supprime"] is False
        assert bilan["rebonds_consecutifs"] == 1
        assert bilan["alerte_due"] is True
        # La boîte existe : elle n'est PAS retenue.
        assert await adresse_supprimee("destinataire@example.com") is None

    @pytest.mark.asyncio
    async def test_l_alerte_tombe_a_chaque_multiple_du_seuil(self):
        with patch("kojo_email_suppressions.EMAIL_SOFT_BOUNCE_ALERT_THRESHOLD", 2):
            premiers = await enregistrer_fait(
                _fait("email.bounced", bounce={"type": "Transient"}), id_evenement="evt-t1"
            )
            deuxieme = await enregistrer_fait(
                _fait("email.bounced", bounce={"type": "Transient"}), id_evenement="evt-t2"
            )
            troisieme = await enregistrer_fait(
                _fait("email.delivery_delayed"), id_evenement="evt-t3"
            )
            quatrieme = await enregistrer_fait(
                _fait("email.bounced", bounce={"type": "Transient"}), id_evenement="evt-t4"
            )

        assert [b["rebonds_consecutifs"] for b in (premiers, deuxieme, troisieme, quatrieme)] == [1, 2, 3, 4]
        # Alerte aux multiples du seuil : la série se voit, sans spam.
        assert [b["alerte_due"] for b in (premiers, deuxieme, troisieme, quatrieme)] == [
            False, True, False, True,
        ]

    @pytest.mark.asyncio
    async def test_une_livraison_reussie_remet_le_compteur_a_zero(self):
        with patch("kojo_email_suppressions.EMAIL_SOFT_BOUNCE_ALERT_THRESHOLD", 3):
            await enregistrer_fait(
                _fait("email.bounced", bounce={"type": "Transient"}), id_evenement="evt-r1"
            )
            await enregistrer_fait(
                _fait("email.bounced", bounce={"type": "Transient"}), id_evenement="evt-r2"
            )
            await enregistrer_fait(_fait("email.delivered"), id_evenement="evt-r3")
            apres = await enregistrer_fait(
                _fait("email.bounced", bounce={"type": "Transient"}), id_evenement="evt-r4"
            )

        # Rien n'a été remis à zéro à la main : la réussite est la borne.
        assert apres["rebonds_consecutifs"] == 1
        assert apres["alerte_due"] is False

    @pytest.mark.asyncio
    async def test_re_livraison_du_meme_evenement_absorbe(self):
        fait = _fait("email.bounced", bounce={"type": "Permanent"})
        premier = await enregistrer_fait(fait, id_evenement="evt-double")
        second = await enregistrer_fait(fait, id_evenement="evt-double")

        assert premier["nouveau"] is True
        assert second["nouveau"] is False
        assert second["supprime"] is False
        # Un seul fait, donc un seul comptage : sinon un Rejeu gonflerait le
        # journal et l'alerte.
        journal = await db_find_one("email_delivery_events", {"id_evenement": "evt-double"})
        assert journal is not None
        retenue = await adresse_supprimee("destinataire@example.com")
        assert retenue["faits"] == 1

    @pytest.mark.asyncio
    async def test_course_avec_l_index_unique_absorbe_le_doublon(self):
        """L'index unique est la garantie, la lecture préalable le confort :
        deux workers qui insèrent en même temps ne comptent qu'une fois."""
        fait = _fait("email.complained")

        class Doublon(Exception):
            code = 11000

        with patch.object(
            suppressions.db["email_delivery_events"], "insert_one", AsyncMock(side_effect=Doublon())
        ):
            bilan = await enregistrer_fait(fait, id_evenement="evt-course")

        assert bilan["nouveau"] is False
        assert bilan["supprime"] is False

    @pytest.mark.asyncio
    async def test_panne_de_base_remonte(self):
        """Une panne d'écriture n'est PAS un doublon : la confondre avec un fait
        déjà traité ferait perdre silencieusement le fait."""
        fait = _fait("email.complained")

        with patch.object(
            suppressions.db["email_delivery_events"], "insert_one", AsyncMock(side_effect=RuntimeError("mongo down"))
        ):
            with pytest.raises(RuntimeError):
                await enregistrer_fait(fait, id_evenement="evt-panne")


class TestFiltreDeLEntree:
    """Le point de règle de l'envoi : plus rien ne part vers une adresse retenue."""

    @pytest.mark.asyncio
    async def test_envoi_vers_une_adresse_retenue_ne_touche_pas_le_fournisseur(self, caplog):
        await enregistrer_fait(
            _fait("email.bounced", bounce={"type": "Permanent"}), id_evenement="evt-filtre-1"
        )

        with patch("kojo_email.EMAIL_PROVIDER", "resend"), \
             patch("kojo_email.send_email_via_resend_api") as envoi, \
             caplog.at_level(logging.WARNING):
            resultat = await kojo_email.send_email_via_active_provider(
                "destinataire@example.com", "Sujet", "corps"
            )

        assert resultat is None
        envoi.assert_not_called()
        # Jamais silencieux : un envoi annulé se lit dans le journal.
        assert "adresse retenue" in caplog.text

    @pytest.mark.asyncio
    async def test_envoi_vers_une_adresse_libre_part_normalement(self):
        with patch("kojo_email.EMAIL_PROVIDER", "resend"), \
             patch("kojo_email.send_email_via_resend_api", return_value={"id": "x"}) as envoi:
            await kojo_email.send_email_via_active_provider(
                "libre@example.com", "Sujet", "corps"
            )

        envoi.assert_called_once()

    @pytest.mark.asyncio
    async def test_l_adresse_retenue_ne_bloque_pas_la_meme_boite_sous_une_autre_etiquette(self):
        await enregistrer_fait(
            _fait("email.complained", email="prenom@example.com"), id_evenement="evt-etiquette-1"
        )

        with patch("kojo_email.EMAIL_PROVIDER", "resend"), \
             patch("kojo_email.send_email_via_resend_api", return_value={"id": "x"}) as envoi:
            await kojo_email.send_email_via_active_provider(
                "prenom+autre-etiquette@example.com", "Sujet", "corps"
            )

        envoi.assert_not_called()

    @pytest.mark.asyncio
    async def test_otp_vers_une_adresse_retenue_est_refuse_et_le_dit(self, client):
        await enregistrer_fait(
            _fait("email.complained"), id_evenement="evt-otp-1"
        )

        with patch("kojo_email.send_email_via_active_provider", new_callable=AsyncMock) as envoi:
            resp = await client.post(
                "/api/auth/email/send-otp",
                json={"email": "destinataire@example.com", "purpose": "signup"},
            )

        assert resp.status_code == 409, resp.text
        # Le message dit QUOI faire, et il ne code pas en 5xx : la page affiche
        # le détail du serveur pour tout code inférieur à 500, et le repli
        # générique pour le reste.
        assert "injoignable" in resp.json()["detail"]
        assert "kojoapp98@gmail.com" in resp.json()["detail"]
        envoi.assert_not_called()
        # Aucun code n'a été fabriqué : un OTP qui ne partira pas ne s'écrit pas.
        assert await db_find_one("email_otps", {"email": "destinataire@example.com"}) is None


class TestWebhookHTTP:
    """La route telle que Resend l'appelle."""

    @pytest.mark.asyncio
    async def test_secret_non_configure_refuse_en_503(self, client):
        corps = _corps("email.bounced")
        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", ""):
            resp = await client.post(CHEMIN, content=corps, headers=_entetes(corps))

        assert resp.status_code == 503, resp.text
        assert "RESEND_WEBHOOK_SECRET" in resp.json()["detail"]["motif"]

    @pytest.mark.asyncio
    async def test_sans_signature_refuse_et_nomme_l_en_tete_manquant(self, client):
        corps = _corps("email.bounced")
        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET):
            resp = await client.post(CHEMIN, content=corps)

        assert resp.status_code == 401, resp.text
        motif = resp.json()["detail"]["motif"]
        assert "svix-id" in motif and "svix-signature" in motif

    @pytest.mark.asyncio
    async def test_rebond_permanent_retient_l_adresse(self, client):
        corps = _corps("email.bounced", bounce={"type": "Permanent", "subType": "Suppressed"})
        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET):
            resp = await client.post(CHEMIN, content=corps, headers=_entetes(corps, id_evenement="msg-http-1"))

        assert resp.status_code == 200, resp.text
        corps_reponse = resp.json()
        assert corps_reponse["status"] == "ok"
        assert corps_reponse["supprime"] is True
        # L'adresse n'est PAS recopiée dans la réponse : le corps peut être
        # journalisé côté fournisseur.
        assert "destinataire@example.com" not in resp.text
        assert await adresse_supprimee("destinataire@example.com") is not None

    @pytest.mark.asyncio
    async def test_re_livraison_du_meme_evenement_ne_compte_qu_une_fois(self, client):
        corps = _corps("email.complained")
        entetes = _entetes(corps, id_evenement="msg-http-2")

        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET):
            premier = await client.post(CHEMIN, content=corps, headers=entetes)
            second = await client.post(CHEMIN, content=corps, headers=entetes)

        assert premier.json()["nouveau"] is True
        assert second.json()["nouveau"] is False
        retenue = await adresse_supprimee("destinataire@example.com")
        assert retenue["faits"] == 1

    @pytest.mark.asyncio
    async def test_type_non_suivi_repond_200_en_le_nommant(self, client):
        """Refuser ferait re-livrer indéfiniment un fait qui ne nous concerne pas."""
        corps = _corps("email.opened")
        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET):
            resp = await client.post(CHEMIN, content=corps, headers=_entetes(corps))

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"status": "ignore", "type": "email.opened"}

    @pytest.mark.asyncio
    async def test_corps_illisible_refuse_en_400(self, client):
        corps = b"{pas du json"
        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET):
            resp = await client.post(CHEMIN, content=corps, headers=_entetes(corps))

        assert resp.status_code == 400, resp.text
        assert "JSON" in resp.json()["detail"]["motif"]

    @pytest.mark.asyncio
    async def test_la_route_ne_demande_aucune_session(self, client):
        """C'est un webhook : la signature remplace l'authentification, et une
        route qui exigerait un jeton ne recevrait jamais rien de Resend."""
        corps = _corps("email.delivered")
        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET):
            resp = await client.post(CHEMIN, content=corps, headers=_entetes(corps))

        assert resp.status_code == 200, resp.text


class TestAlerteProprietaire:
    """La moitié « au lieu d'accumuler des échecs silencieux ».

    Une adresse n'est retenue que sur un fait DÉFINITIF ; un rebond transitoire
    qui dure n'a donc aucune autre façon de se faire voir que cette alerte. La
    mesurer au niveau du module ne suffirait pas : ce qui compte est qu'elle
    PARTE, depuis la route, et qu'une alerte en panne ne fasse pas re-livrer le
    webhook pour toujours.
    """

    @pytest.mark.asyncio
    async def test_une_serie_de_rebonds_alerte_le_proprietaire(self, client):
        corps = _corps("email.bounced", bounce={"type": "Transient", "message": "mailbox full"})

        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET), \
             patch("kojo_email_suppressions.EMAIL_SOFT_BOUNCE_ALERT_THRESHOLD", 1), \
             patch("kojo_routers_email.OWNER_EMAIL", "proprietaire@kojo.sn"), \
             patch(
                 "kojo_routers_email.send_email_via_active_provider", new_callable=AsyncMock
             ) as alerte:
            resp = await client.post(CHEMIN, content=corps, headers=_entetes(corps))

        assert resp.status_code == 200, resp.text
        alerte.assert_awaited_once()
        destinataire, sujet, corps_alerte = alerte.await_args.args
        assert destinataire == "proprietaire@kojo.sn"
        assert "rebond" in sujet.lower()
        # L'adresse fautive est dans le message : sans elle, l'alerte dit
        # « quelque chose ne va pas » sans dire quoi corriger.
        assert "destinataire@example.com" in corps_alerte
        assert "mailbox full" in corps_alerte

    @pytest.mark.asyncio
    async def test_sous_le_seuil_aucune_alerte(self, client):
        """Un premier rebond transitoire est banal (boîte pleine) : alerter là
        rendrait l'alerte elle-même ignorée."""
        corps = _corps("email.bounced", bounce={"type": "Transient"})

        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET), \
             patch("kojo_email_suppressions.EMAIL_SOFT_BOUNCE_ALERT_THRESHOLD", 5), \
             patch("kojo_routers_email.OWNER_EMAIL", "proprietaire@kojo.sn"), \
             patch(
                 "kojo_routers_email.send_email_via_active_provider", new_callable=AsyncMock
             ) as alerte:
            resp = await client.post(CHEMIN, content=corps, headers=_entetes(corps))

        assert resp.status_code == 200, resp.text
        alerte.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_une_alerte_en_panne_ne_fait_pas_echouer_le_webhook(self, client):
        """L'alerte est best-effort : un 5xx ferait re-livrer le fait par Resend,
        et l'échec se répéterait à chaque re-livraison."""
        corps = _corps("email.bounced", bounce={"type": "Transient"})

        with patch("kojo_email_suppressions.RESEND_WEBHOOK_SECRET", SECRET), \
             patch("kojo_email_suppressions.EMAIL_SOFT_BOUNCE_ALERT_THRESHOLD", 1), \
             patch("kojo_routers_email.OWNER_EMAIL", "proprietaire@kojo.sn"), \
             patch(
                 "kojo_routers_email.send_email_via_active_provider",
                 new_callable=AsyncMock,
                 side_effect=RuntimeError("fournisseur indisponible"),
             ):
            resp = await client.post(CHEMIN, content=corps, headers=_entetes(corps))

        assert resp.status_code == 200, resp.text
        # Le fait est journalisé quand même : l'alerte a échoué, pas la réception.
        assert await db_find_one(
            "email_delivery_events", {"id_evenement": "msg_1"}
        ) is not None


class TestSurfaceProprietaire:
    """Voir ce qui est retenu, et le lever — sans écrire en base à la main."""

    @pytest.mark.asyncio
    async def test_non_proprietaire_ne_lit_pas_la_liste(self, client):
        user = await register_and_login(client, BASE_USER)
        resp = await client.get(
            "/api/owner/email-suppressions",
            headers={"Authorization": f"Bearer {user['access_token']}"},
        )

        assert resp.status_code == 403, resp.text

    @pytest.mark.asyncio
    async def test_le_proprietaire_voit_les_adresses_retenues_et_peut_les_lever(self, client):
        owner = await register_and_login(client, BASE_USER)
        entetes = {"Authorization": f"Bearer {owner['access_token']}"}
        await enregistrer_fait(
            _fait("email.bounced", bounce={"type": "Permanent", "subType": "Suppressed"}),
            id_evenement="evt-owner-1",
        )

        with patch("kojo_owner.OWNER_EMAIL", owner["user"]["email"]), \
             patch("kojo_owner.OWNER_USER_ID", owner["user"]["id"]):
            liste = await client.get("/api/owner/email-suppressions", headers=entetes)
            assert liste.status_code == 200, liste.text
            contenu = liste.json()

            assert contenu["total"] == 1
            assert contenu["tronque"] is False
            entree = contenu["suppressions"][0]
            assert entree["email"] == "destinataire@example.com"
            assert entree["motif"] == suppressions.MOTIF_REBOND_PERMANENT
            assert entree["faits"] == 1

            # La levée est une DÉCISION : après elle, plus rien n'est retenu.
            levee = await client.post(
                "/api/owner/email-suppressions/lever",
                json={"email": "destinataire@example.com"},
                headers=entetes,
            )
            assert levee.status_code == 200, levee.text
            assert levee.json() == {"email": "destinataire@example.com", "levee": True}

        assert await adresse_supprimee("destinataire@example.com") is None

        with patch("kojo_email.EMAIL_PROVIDER", "resend"), \
             patch("kojo_email.send_email_via_resend_api", return_value={"id": "x"}) as envoi:
            await kojo_email.send_email_via_active_provider(
                "destinataire@example.com", "Sujet", "corps"
            )
        envoi.assert_called_once()

    @pytest.mark.asyncio
    async def test_lever_une_adresse_non_retenue_est_un_fait_pas_un_echec(self, client):
        owner = await register_and_login(client, BASE_USER)
        entetes = {"Authorization": f"Bearer {owner['access_token']}"}

        with patch("kojo_owner.OWNER_EMAIL", owner["user"]["email"]), \
             patch("kojo_owner.OWNER_USER_ID", owner["user"]["id"]):
            resp = await client.post(
                "/api/owner/email-suppressions/lever",
                json={"email": "jamais-retenue@example.com"},
                headers=entetes,
            )

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"email": "jamais-retenue@example.com", "levee": False}


class TestNormalisation:
    """Une adresse retenue est une BOÎTE, pas une écriture."""

    @pytest.mark.parametrize(
        "entree,attendu",
        [
            ("  Prenom.Nom@Example.COM ", "prenom.nom@example.com"),
            ("prenom+tag@example.com", "prenom@example.com"),
            ("prenom+TAG+encore@example.com", "prenom@example.com"),
            ("pas-une-adresse", "pas-une-adresse"),
            ("", ""),
        ],
    )
    def test_adresse_de_boite(self, entree, attendu):
        assert adresse_boite(entree) == attendu

    @pytest.mark.asyncio
    async def test_une_adresse_vide_n_est_jamais_retenue(self):
        assert await adresse_supprimee("") is None
        assert await lever_suppression("") is False

    @pytest.mark.asyncio
    async def test_la_levée_accepte_la_forme_avec_etiquette(self):
        """Le propriétaire recopie ce qu'il a sous les yeux, étiquettes comprises."""
        await enregistrer_fait(
            _fait("email.bounced", email="prenom@example.com", bounce={"type": "Permanent"}),
            id_evenement="evt-normalisation-1",
        )

        assert await lever_suppression("Prenom+etiquette@Example.com") is True
        assert await adresse_supprimee("prenom@example.com") is None
