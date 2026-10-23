# -*- coding: utf-8 -*-
"""Support WhatsApp (Kapso) : de la signature jusqu'au ticket d'escalade.

Ce que ces tests protègent, dans l'ordre où un défaut se paierait :

  * la SIGNATURE d'abord, et sur les octets reçus : sans elle, n'importe qui
    ferait répondre le numéro de Kojo à n'importe qui, aux frais du propriétaire.
    Un secret absent est un 503 NOMMÉ (ingestion désactivée), jamais un
    laisser-passer ;
  * l'IDEMPOTENCE : le fournisseur re-livre, le client ne doit pas recevoir
    deux fois la même réponse — sur un canal où l'on ne peut pas effacer ;
  * l'ESCALADE : quand l'assistant demande un humain, quand le budget est
    atteint, quand l'IA est en panne ou quand l'envoi est désactivé, un ticket
    est ouvert par le chemin unique (`kojo_support_tickets`) — et rien n'est
    promis au client en échange ;
  * l'envoi RATÉ n'est pas un succès (502 pour que le fournisseur re-livre), et
    le rejeu ne rouvre pas un second ticket ;
  * ce qui ne mérite pas qu'on écrive (écho de nos propres messages, média,
    événement inconnu) est acquitté en le NOMMANT, pas refusé.
"""
import hashlib
import hmac
import json

import pytest

import kojo_whatsapp as w
from kojo_ai_budget import MOTIF_COMPTEUR, MOTIF_PLAFOND, Reservation
from kojo_ai_gateway import AiGatewayError
from kojo_rate_limit import get_rate_limit_bucket
from tests.conftest import db_insert

CHEMIN = "/api/support/whatsapp/webhook"
SECRET = "secret-de-test-kapso"
EVENEMENT = w.EVENEMENT_MESSAGE


def _corps(**message) -> bytes:
    """Un webhook Kapso tel qu'il arrive : message + conversation."""
    charge = {
        "message": {
            "id": "wamid.1",
            "from": "221771234567",
            "type": "text",
            "text": {"body": "Bonjour, comment payer une mission ?"},
            "kapso": {"direction": "inbound"},
            **message,
        },
        "conversation": {"contact_name": "Awa Diop"},
    }
    return json.dumps(charge, ensure_ascii=False).encode("utf-8")


def _entetes(corps: bytes, secret: str = SECRET) -> dict:
    return {
        "X-Webhook-Event": EVENEMENT,
        "X-Webhook-Signature": hmac.new(secret.encode(), corps, hashlib.sha256).hexdigest(),
    }


def _brancher(monkeypatch, *, secret: str = SECRET, envoi_en_marche: bool = True):
    """Configure le webhook et remplace le réseau : modèle et envoi."""
    monkeypatch.setattr(w, "KAPSO_WEBHOOK_SECRET", secret)
    monkeypatch.setattr(w, "KAPSO_API_KEY", "cle-de-test" if envoi_en_marche else "")
    monkeypatch.setattr(w, "KAPSO_PHONE_NUMBER_ID", "123456" if envoi_en_marche else "")
    monkeypatch.setattr(w, "WHATSAPP_CONTEXT_MESSAGES", 6)
    envois = []

    def faux_envoi(destinataire, texte):
        envois.append((destinataire, texte))
        return {"messages": [{"id": "out-1"}]}

    monkeypatch.setattr(w, "envoyer_texte", faux_envoi)
    return envois


def _modele(monkeypatch, texte="Bonjour ! Une mission se paie par Orange Money ou Wave."):
    """Doublure du gateway, qui retient les prompts reçus."""
    recus = []

    def faux(messages, **kwargs):
        recus.append(messages)
        return texte

    monkeypatch.setattr(w, "chat_completion", faux)
    monkeypatch.setattr(w, "ia_configuree", lambda: True)
    return recus


async def _poster(client, corps: bytes, entetes=None):
    return await client.post(CHEMIN, content=corps, headers=entetes or _entetes(corps))


def _budget(refus):
    """Doublure de `reserver` : un verdict figé, sans toucher au compteur."""
    async def faux(caracteres):
        return refus

    return faux


# ---------------------------------------------------------------------------
# La signature
# ---------------------------------------------------------------------------


class TestSignature:
    async def test_sans_secret_l_ingestion_est_desactivee_et_le_dit(self, client, monkeypatch):
        """Un secret absent n'est pas un refus silencieux : c'est un 503 nommé."""
        corps = _corps()
        monkeypatch.setattr(w, "KAPSO_WEBHOOK_SECRET", "")

        reponse = await _poster(client, corps)

        assert reponse.status_code == 503, reponse.text
        assert "KAPSO_WEBHOOK_SECRET" in reponse.json()["detail"]["motif"]

    async def test_sans_en_tete_de_signature_la_requete_est_refusee(self, client, monkeypatch):
        corps = _corps()
        monkeypatch.setattr(w, "KAPSO_WEBHOOK_SECRET", SECRET)

        reponse = await _poster(client, corps, {"X-Webhook-Event": EVENEMENT})

        assert reponse.status_code == 401, reponse.text
        assert "X-Webhook-Signature" in reponse.json()["detail"]["motif"]

    async def test_une_signature_etrangere_est_refusee(self, client, monkeypatch):
        _brancher(monkeypatch)
        corps = _corps()

        reponse = await _poster(client, corps, _entetes(corps, secret="mauvais-secret"))

        assert reponse.status_code == 401, reponse.text
        assert "signature invalide" in reponse.json()["detail"]["motif"]

    async def test_la_signature_porte_sur_les_octets_recus(self, client, monkeypatch):
        """Un corps indenté reste valide : la signature porte sur ce qui est reçu."""
        _brancher(monkeypatch)
        _modele(monkeypatch)
        corps = json.dumps(json.loads(_corps()), indent=2).encode("utf-8")

        reponse = await _poster(client, corps)

        assert reponse.status_code == 200, reponse.text

    async def test_le_prefixe_sha256_est_accepte(self, client, monkeypatch):
        """`sha256=` préfixé par un relais : la MÊME empreinte écrite autrement."""
        _brancher(monkeypatch)
        _modele(monkeypatch)
        corps = _corps()
        entetes = _entetes(corps)
        entetes["X-Webhook-Signature"] = "sha256=" + entetes["X-Webhook-Signature"]

        reponse = await _poster(client, corps, entetes)

        assert reponse.status_code == 200, reponse.text


# ---------------------------------------------------------------------------
# Ce qui est acquitté sans réponse
# ---------------------------------------------------------------------------


class TestIngestion:
    async def test_l_echo_de_nos_propres_messages_ne_fait_pas_repondre(self, client, monkeypatch):
        """Le webhook reçoit aussi ce que le numéro envoie : le taire est le but."""
        _brancher(monkeypatch)
        recus = _modele(monkeypatch)
        corps = _corps(kapso={"direction": "outbound"})

        reponse = await _poster(client, corps)

        assert reponse.status_code == 200, reponse.text
        assert reponse.json()["status"] == "ignore"
        assert recus == [], "répondre à son propre message ferait parler le numéro à lui-même"

    async def test_une_enveloppe_groupee_est_traitee_message_par_message(self, client, monkeypatch):
        """En mode « buffering », `batch: true` et les charges utiles sont dans `data`."""
        envois = _brancher(monkeypatch)
        _modele(monkeypatch)
        premier = json.loads(_corps())
        second = json.loads(_corps(id="wamid.2", text={"body": "Et pour un remboursement ?"}))

        reponse = await _poster(
            client, json.dumps({"batch": True, "data": [premier, second]}).encode("utf-8")
        )

        assert reponse.status_code == 200, reponse.text
        assert len(reponse.json()["batch"]) == 2
        assert len(envois) == 2, "aucun message du lot ne doit être perdu"

    async def test_un_numero_partage_ou_un_autre_agent_repond_ne_double_pas_la_reponse(
        self, client, monkeypatch
    ):
        """`kapso.passive` : un autre agent traite déjà le message."""
        _brancher(monkeypatch)
        recus = _modele(monkeypatch)
        corps = _corps(kapso={"direction": "inbound", "passive": True})

        reponse = await _poster(client, corps)

        assert reponse.status_code == 200, reponse.text
        assert reponse.json()["status"] == "ignore"
        assert recus == []

    async def test_un_contact_sans_numero_est_joint_par_son_identite_business(self, client, monkeypatch):
        """Meta peut livrer un message SANS numéro : refuser le laisserait sans réponse."""
        envois = _brancher(monkeypatch)
        _modele(monkeypatch)
        corps = json.dumps({
            "message": {
                "id": "wamid.bsuid",
                "from_user_id": "US.13491208655302741918",
                "type": "text",
                "text": {"body": "Bonjour"},
                "kapso": {"direction": "inbound"},
            },
            "conversation": {"business_scoped_user_id": "US.13491208655302741918"},
        }).encode("utf-8")

        reponse = await _poster(client, corps)

        assert reponse.status_code == 200, reponse.text
        assert envois and envois[0][0] == "US.13491208655302741918", (
            "l'identité business-scoped doit être conservée telle quelle pour joindre le contact"
        )

    async def test_un_evenement_non_suivi_est_acquitte_en_le_nommant(self, client, monkeypatch):
        _brancher(monkeypatch)
        corps = _corps()
        entetes = _entetes(corps)
        entetes["X-Webhook-Event"] = "whatsapp.message.delivered"

        reponse = await _poster(client, corps, entetes)

        assert reponse.status_code == 200, reponse.text
        assert reponse.json() == {"status": "ignore", "event": "whatsapp.message.delivered"}

    async def test_un_message_sans_identifiant_est_refuse(self, client, monkeypatch):
        """Sans identifiant, une re-livraison ferait répondre deux fois."""
        _brancher(monkeypatch)
        corps = json.dumps({"message": {"type": "text", "from": "221771234567",
                                        "text": {"body": "Bonjour"}}}).encode("utf-8")

        reponse = await _poster(client, corps)

        assert reponse.status_code == 400, reponse.text

    async def test_un_media_recoit_une_demande_de_texte_sans_mobiliser_un_humain(self, client, monkeypatch):
        _brancher(monkeypatch)
        recus = _modele(monkeypatch)
        corps = _corps(type="image", text=None, kapso={"direction": "inbound", "content": "[image]"})

        reponse = await _poster(client, corps)

        assert reponse.status_code == 200, reponse.text
        assert reponse.json()["escalade"] is False
        assert recus == [], "un média ne se lit pas : aucun appel au modèle n'est utile"


# ---------------------------------------------------------------------------
# La réponse, l'escalade, et ce qu'elles coûtent
# ---------------------------------------------------------------------------


class TestReponse:
    async def test_la_reponse_part_au_bon_numero_et_est_tracee(self, client, monkeypatch):
        envois = _brancher(monkeypatch)
        recus = _modele(monkeypatch, "Une mission se paie par Orange Money ou Wave.")

        reponse = await _poster(client, _corps())

        assert reponse.status_code == 200, reponse.text
        assert reponse.json()["statut"] == "traite"
        assert envois and envois[0][0] == "221771234567"
        assert "Orange Money" in envois[0][1]
        assert recus, "le modèle doit être appelé pour une question en texte"

        message = await w.db["whatsapp_messages"].find_one({"provider_message_id": "wamid.1"})
        assert message["statut"] == "traite"
        assert message["direction"] == "in"
        sortant = await w.db["whatsapp_messages"].find_one({"provider_message_id": "out:wamid.1"})
        assert sortant["direction"] == "out"

    async def test_le_contexte_est_la_conversation_et_elle_seule(self, client, monkeypatch):
        _brancher(monkeypatch)
        recus = _modele(monkeypatch)
        await _poster(client, _corps())
        corps = _corps(id="wamid.2", text={"body": "Et avec la carte ?"})

        await _poster(client, corps)

        assert len(recus) == 2
        contextes = [tour["content"] for tour in recus[1]]
        assert any("Bonjour, comment payer une mission" in texte for texte in contextes), (
            "le message précédent doit être redonné au modèle"
        )
        assert any("Orange Money" in texte for texte in contextes), (
            "la réponse précédente doit aussi être là, sinon l'assistant se répète"
        )
        assert [tour["content"] for tour in recus[1]][-1] == "Et avec la carte ?"

    async def test_le_marqueur_ouvre_un_ticket_et_disparait_du_texte(self, client, monkeypatch):
        envois = _brancher(monkeypatch)
        _modele(monkeypatch, "Je transmets votre demande. " + w.TICKET_MARKER)

        reponse = await _poster(client, _corps())

        corps = reponse.json()
        assert corps["escalade"] is True
        assert corps["ticket_id"], "l'escalade doit produire un ticket"
        assert w.TICKET_MARKER not in envois[0][1], "la mécanique ne doit pas apparaître au client"
        ticket = await w.db["support_tickets"].find_one({"id": corps["ticket_id"]})
        assert ticket["channel"] == "whatsapp"
        assert ticket["phone"] == "221771234567"
        assert ticket["email"] is None, "un contact WhatsApp n'a pas d'adresse : on n'en invente pas"

    async def test_le_budget_atteint_escalade_sans_appeler_le_modele(self, client, monkeypatch):
        envois = _brancher(monkeypatch)
        recus = _modele(monkeypatch)
        monkeypatch.setattr(
            w, "reserver", _budget(Reservation(autorisee=False, motif=MOTIF_PLAFOND))
        )

        reponse = await _poster(client, _corps())

        corps = reponse.json()
        assert corps["escalade"] is True
        assert corps["motif"] == "budget_atteint"
        assert recus == [], "un plafond atteint ne dépense pas"
        assert envois and envois[0][1] == w.REPONSE_ESCALADE

    async def test_un_compteur_en_panne_escalade_aussi(self, client, monkeypatch):
        envois = _brancher(monkeypatch)
        _modele(monkeypatch)
        monkeypatch.setattr(
            w, "reserver", _budget(Reservation(autorisee=False, motif=MOTIF_COMPTEUR))
        )

        reponse = await _poster(client, _corps())

        assert reponse.json()["motif"] == "budget_indisponible"
        assert envois, "le client doit au moins recevoir un accusé de réception"

    async def test_une_panne_du_gateway_escalade_au_lieu_de_laisser_sans_reponse(self, client, monkeypatch):
        envois = _brancher(monkeypatch)

        def panne(messages, **kwargs):
            raise AiGatewayError("quota dépassé")

        monkeypatch.setattr(w, "chat_completion", panne)
        monkeypatch.setattr(w, "ia_configuree", lambda: True)

        reponse = await _poster(client, _corps())

        corps = reponse.json()
        assert corps["escalade"] is True
        assert corps["motif"] == "ia_en_panne"
        assert envois and envois[0][1] == w.REPONSE_ESCALADE
        assert "quota" not in envois[0][1], "la cause technique ne part pas au client"

    async def test_sans_envoi_configure_le_message_est_escalade_pas_acquitte(self, client, monkeypatch):
        """Pas de clé = pas de réponse. Le dire, et ouvrir un ticket."""
        envois = _brancher(monkeypatch, envoi_en_marche=False)
        _modele(monkeypatch)

        reponse = await _poster(client, _corps())

        corps = reponse.json()
        assert reponse.status_code == 200, reponse.text
        assert corps["statut"] == "non_envoye"
        assert corps["escalade"] is True
        assert envois == []

    async def test_un_envoi_refuse_repond_502_puis_le_rejeu_aboutit(self, client, monkeypatch):
        envois = _brancher(monkeypatch)
        _modele(monkeypatch)
        etats = {"appels": 0}

        def refuse(destinataire, texte):
            etats["appels"] += 1
            if etats["appels"] == 1:
                raise w.KapsoError("Kapso a refusé l'envoi (HTTP 500)")
            envois.append((destinataire, texte))
            return {"ok": True}

        monkeypatch.setattr(w, "envoyer_texte", refuse)
        monkeypatch.setattr(
            w, "reserver", _budget(Reservation(autorisee=True, appels=1, caracteres=10))
        )
        monkeypatch.setattr(w, "chat_completion", lambda messages, **k: "Réponse. " + w.TICKET_MARKER)
        monkeypatch.setattr(w, "ia_configuree", lambda: True)

        premier = await _poster(client, _corps())
        assert premier.status_code == 502, premier.text
        message = await w.db["whatsapp_messages"].find_one({"provider_message_id": "wamid.1"})
        assert message["statut"] == "echec", "un envoi raté ne doit pas se déclarer traité"

        second = await _poster(client, _corps())

        assert second.status_code == 200, second.text
        assert len(envois) == 1, "le rejeu doit envoyer la réponse manquante"
        tickets = await w.db["support_tickets"].find({}).to_list(10)
        assert len(tickets) == 1, "le rejeu ne doit pas rouvrir un second ticket"

    async def test_un_refus_definitif_escalade_au_lieu_de_re_livrer(self, client, monkeypatch):
        """Un 4xx se reproduirait à l'identique : re-livrer repaierait le modèle."""
        _brancher(monkeypatch)
        _modele(monkeypatch, "Voici la réponse, sans besoin d'humain.")

        def refuse_definitif(destinataire, texte):
            raise w.KapsoError("Kapso a refusé l'envoi (HTTP 400)", transitoire=False)

        monkeypatch.setattr(w, "envoyer_texte", refuse_definitif)

        reponse = await _poster(client, _corps())

        corps = reponse.json()
        assert reponse.status_code == 200, "un refus définitif ne se répare pas en re-livrant"
        assert corps["statut"] == "echec"
        assert corps["escalade"] is True
        assert corps["ticket_id"], "le client n'a rien reçu : un humain doit le voir"
        assert corps["envoi"] == "envoi_refuse_definitif"

    async def test_une_re_livraison_ne_repond_pas_deux_fois(self, client, monkeypatch):
        envois = _brancher(monkeypatch)
        _modele(monkeypatch)

        await _poster(client, _corps())
        second = await _poster(client, _corps())

        assert second.status_code == 200, second.text
        assert second.json()["status"] == "deja_traite"
        assert len(envois) == 1, "une re-livraison ne doit pas envoyer une seconde réponse"

    async def test_la_conversation_suit_le_compte_quand_le_numero_est_le_sien(self, client, monkeypatch):
        """Le rattachement existe pour l'export et la suppression de compte."""
        _brancher(monkeypatch)
        _modele(monkeypatch)
        await db_insert("users", {
            "id": "compte-awa", "email": "awa@example.com", "phone": "+221771234567",
        })

        await _poster(client, _corps())

        message = await w.db["whatsapp_messages"].find_one({"provider_message_id": "wamid.1"})
        assert message["user_id"] == "compte-awa"


# ---------------------------------------------------------------------------
# L'envoi Kapso (le seul chemin qui sort du dépôt)
# ---------------------------------------------------------------------------


class _Reponse:
    def __init__(self, status_code=200, corps=None):
        self.status_code = status_code
        self.text = json.dumps(corps or {})

    def json(self):
        return json.loads(self.text)


class TestEnvoi:
    """Le contrat d'appel : URL, en-tête, corps, et ce qu'un refus devient."""

    def test_l_envoi_vise_l_endpoint_du_numero_avec_la_cle_en_entete(self, monkeypatch):
        monkeypatch.setattr(w, "KAPSO_API_KEY", "cle-de-test")
        monkeypatch.setattr(w, "KAPSO_PHONE_NUMBER_ID", "123456")
        appels = []

        def faux_post(url, json=None, headers=None, timeout=None):
            appels.append((url, json, headers, timeout))
            return _Reponse(200, {"messages": [{"id": "out-1"}]})

        monkeypatch.setattr(w.requests, "post", faux_post)

        w.envoyer_texte("+221 77 123 45 67", "Bonjour")

        url, charge, entetes, delai = appels[0]
        assert url == "https://api.kapso.ai/meta/whatsapp/v24.0/123456/messages"
        assert entetes["X-API-Key"] == "cle-de-test"
        assert charge["to"] == "221771234567", "le numéro part en chiffres, sans espaces ni +"
        assert charge["type"] == "text" and charge["text"]["body"] == "Bonjour"
        assert delai and delai > 0, "un envoi sans délai peut bloquer le worker"

    def test_un_5xx_est_transitoire_un_4xx_est_definitif(self, monkeypatch):
        monkeypatch.setattr(w, "KAPSO_API_KEY", "cle-de-test")
        monkeypatch.setattr(w, "KAPSO_PHONE_NUMBER_ID", "123456")

        monkeypatch.setattr(w.requests, "post", lambda *a, **k: _Reponse(503, {"erreur": "panne"}))
        with pytest.raises(w.KapsoError) as transitoire:
            w.envoyer_texte("221771234567", "Bonjour")
        assert transitoire.value.transitoire is True

        monkeypatch.setattr(w.requests, "post", lambda *a, **k: _Reponse(400, {"erreur": "destinataire"}))
        with pytest.raises(w.KapsoError) as definitif:
            w.envoyer_texte("221771234567", "Bonjour")
        assert definitif.value.transitoire is False

    def test_sans_configuration_aucun_appel_ne_part(self, monkeypatch):
        monkeypatch.setattr(w, "KAPSO_API_KEY", "")
        monkeypatch.setattr(w, "KAPSO_PHONE_NUMBER_ID", "")
        appels = []
        monkeypatch.setattr(w.requests, "post", lambda *a, **k: appels.append(1))

        with pytest.raises(w.KapsoError):
            w.envoyer_texte("221771234567", "Bonjour")
        assert appels == []


# ---------------------------------------------------------------------------
# La borne de débit
# ---------------------------------------------------------------------------


def test_le_webhook_a_son_propre_plafond():
    """Le webhook ne doit pas tomber dans le bucket serré des tickets."""
    assert get_rate_limit_bucket("/api/support/whatsapp/webhook") == ("support-whatsapp", 120, 1)
    assert get_rate_limit_bucket("/api/support/tickets") == ("support", 10, 5)
