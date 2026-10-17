# -*- coding: utf-8 -*-
"""Auto-alerte du fournisseur email ACTIF — `kojo_scheduler`.

Ce que ces cas tiennent, et pourquoi chacun est écrit :

  • LA SONDE RÉUTILISÉE — le passage juge avec `active_email_provider_health_probe`
    (kojo_email), celle que sert `/monitor/email`. Le cas remplace la sonde du
    module et constate que le verdict vient d'ELLE (fournisseur nommé, motif
    repris) : une seconde résolution du fournisseur actif ferait juger autre
    chose que ce que les envois suivent.
  • UNE SEULE ALERTE PAR PANNE — la promesse exacte : deux passages muets
    d'affilée n'envoient qu'une alerte ; le rétablissement ré-arme ; un motif
    qui change en restant muet est une NOUVELLE panne.
  • LES DEUX CANAUX — notification in-app (seul canal qui marche quand l'email
    est muet) et email best-effort, dont l'ÉCHEC est écrit au lieu d'être tu.
  • LE CÂBLAGE — la boucle passe par le bail comme les deux autres, et
    `server.py` la démarre (une boucle jamais lancée serait un vert de plus).

Le cas « fantôme » (OWNER_USER_ID absent de la base, compte réel trouvé par
email) est celui de la production : sans lui, l'alerte partirait vers un
identifiant que personne ne porte.
"""
import asyncio
import io
import pathlib
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

import kojo_scheduler
from tests.conftest import BASE_USER, db_find_one, register_and_login

MAINTENANT = datetime(2026, 10, 17, 9, 0, 0, tzinfo=timezone.utc)
COLLECTION = "scheduler_alerts"
SUJET = "email_provider"

# Un verdict de panne TOTALE : le fournisseur ne part pas (clé absente, transport
# injoignable, HTTP d'erreur, `EMAIL_PROVIDER=none`).
VERDICT_MUET = {
    "ok": False,
    "configured": False,
    "detail": "Brevo non configuré (BREVO_API_KEY)",
    "provider": "brevo",
}

# Un verdict d'EXPÉDITEUR inutilisable : la clé répond, mais aucun destinataire
# réel ne recevra (domaine non vérifié, expéditeur inactif, jeton révoqué).
VERDICT_MAL_CONFIGURE = {
    "ok": False,
    "configured": True,
    "detail": "domaine 'kojoforafrica.cc.cd' non vérifié (statut 'pending')",
    "provider": "resend",
}

VERDICT_SAIN = {
    "ok": True,
    "configured": True,
    "detail": "domaine vérifié",
    "provider": "brevo",
}


async def _etat():
    """L'état d'alerte persisté (ou None) — lu en base, jamais dans un mock."""
    return await db_find_one(COLLECTION, {"_id": SUJET})


async def _remise_a_zero():
    """État propre : ces cas écrivent le même document, et l'ordre d'exécution
    ne doit pas décider de leur verdict."""
    await kojo_scheduler.db[COLLECTION].delete_many({})


@pytest.mark.asyncio
class TestUneSeuleAlerteParPanne:
    async def test_fournisseur_sain_n_alerte_pas_et_ecrit_son_verdict(self):
        """Un fournisseur qui répond ne déclenche RIEN, et l'état le dit : sans
        cette écriture, un vert serait indiscernable d'un passage qui n'a pas
        tourné."""
        await _remise_a_zero()
        with patch("kojo_scheduler.active_email_provider_health_probe",
                   return_value=VERDICT_SAIN), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()) as notif, \
             patch("kojo_scheduler.send_email_via_active_provider", new_callable=AsyncMock) as email:
            resume = await kojo_scheduler.email_provider_auto_alert_once(now=MAINTENANT)

        assert resume == {
            "provider": "brevo",
            "sante": "ok",
            "alertes": 0,
            "retablissements": 0,
            "pannes_ignorees": 0,
        }
        notif.assert_not_awaited()
        email.assert_not_awaited()
        etat = await _etat()
        assert etat["sante"] == "ok"
        assert etat["detail"] == "domaine vérifié"

    async def test_panne_muette_alerte_une_fois_puis_se_tait(self):
        """La promesse, en deux passages : une alerte, puis le silence — sur la
        MÊME panne. Le second passage nomme le silence (`pannes_ignorees`), il
        ne se contente pas de ne rien faire."""
        await _remise_a_zero()
        with patch("kojo_scheduler.active_email_provider_health_probe",
                   return_value=VERDICT_MUET), \
             patch("kojo_scheduler.OWNER_EMAIL", "owner@kojo.sn"), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()) as notif, \
             patch("kojo_scheduler.send_email_via_active_provider", new_callable=AsyncMock) as email:
            premier = await kojo_scheduler.email_provider_auto_alert_once(now=MAINTENANT)
            second = await kojo_scheduler.email_provider_auto_alert_once(
                now=MAINTENANT + timedelta(minutes=15)
            )

        assert premier["alertes"] == 1
        assert premier["pannes_ignorees"] == 0
        assert second["alertes"] == 0
        assert second["pannes_ignorees"] == 1

        # Les deux canaux, une fois chacun — pas une fois par passage.
        assert notif.await_count == 1
        assert email.await_count == 1
        assert email.await_args.args[0] == "owner@kojo.sn"
        assert "brevo" in email.await_args.args[1]
        assert "muet" in email.await_args.args[1]

        # La notification in-app nomme le fournisseur et le motif : c'est elle
        # qui atteint le propriétaire quand l'email ne part pas.
        assert notif.await_args.kwargs["key"] == "owner_email_provider_down"
        assert notif.await_args.kwargs["provider"] == "brevo"
        assert notif.await_args.kwargs["motif"] == "muet"

        etat = await _etat()
        assert etat["sante"] == "muette"
        assert etat["signature"] == "brevo:muet"
        assert etat["panne_depuis"] == MAINTENANT
        assert etat["alerte_envoyee"] is True
        assert etat["alerte_erreur"] == ""
        # Le second passage rafraîchit la MESURE (dernière sonde) sans toucher
        # à la date d'alerte : c'est cette date qui borne la promesse.
        assert etat["derniere_sonde_at"] == MAINTENANT + timedelta(minutes=15)
        assert etat["alerte_envoyee_at"] == MAINTENANT

    async def test_retablissement_puis_nouvelle_panne_realerte(self):
        """Panune → sain → panne : DEUX alertes. Sans le réarmement, la seconde
        panne serait muette pour toujours — le pire des deux mondes, puisqu'une
        alerte a déjà été lue."""
        await _remise_a_zero()
        with patch("kojo_scheduler.OWNER_EMAIL", "owner@kojo.sn"), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()), \
             patch("kojo_scheduler.send_email_via_active_provider", new_callable=AsyncMock) as email:

            with patch("kojo_scheduler.active_email_provider_health_probe",
                       return_value=VERDICT_MUET):
                premiere = await kojo_scheduler.email_provider_auto_alert_once(now=MAINTENANT)

            with patch("kojo_scheduler.active_email_provider_health_probe",
                       return_value=VERDICT_SAIN):
                sain = await kojo_scheduler.email_provider_auto_alert_once(
                    now=MAINTENANT + timedelta(minutes=15)
                )

            with patch("kojo_scheduler.active_email_provider_health_probe",
                       return_value=VERDICT_MUET):
                seconde = await kojo_scheduler.email_provider_auto_alert_once(
                    now=MAINTENANT + timedelta(minutes=30)
                )

        assert premiere["alertes"] == 1
        assert sain["retablissements"] == 1
        assert seconde["alertes"] == 1
        assert email.await_count == 2
        etat = await _etat()
        assert etat["retabli_at"] == MAINTENANT + timedelta(minutes=15)
        assert etat["alerte_envoyee_at"] == MAINTENANT + timedelta(minutes=30)

    async def test_un_motif_qui_change_est_une_nouvelle_panne(self):
        """« muet » puis « mal-configure » : même fournisseur, panne TOUJOURS en
        cours, mais l'action à mener n'est plus la même. La taire perdrait le
        seul signal utile."""
        await _remise_a_zero()
        with patch("kojo_scheduler.OWNER_EMAIL", "owner@kojo.sn"), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()) as notif, \
             patch("kojo_scheduler.send_email_via_active_provider", new_callable=AsyncMock) as email:

            with patch("kojo_scheduler.active_email_provider_health_probe",
                       return_value=VERDICT_MUET):
                premier = await kojo_scheduler.email_provider_auto_alert_once(now=MAINTENANT)

            with patch("kojo_scheduler.active_email_provider_health_probe",
                       return_value=VERDICT_MAL_CONFIGURE):
                second = await kojo_scheduler.email_provider_auto_alert_once(
                    now=MAINTENANT + timedelta(minutes=15)
                )

            # Et un TROISIÈME passage avec le motif déjà alerté : silence.
            with patch("kojo_scheduler.active_email_provider_health_probe",
                       return_value=VERDICT_MAL_CONFIGURE):
                troisieme = await kojo_scheduler.email_provider_auto_alert_once(
                    now=MAINTENANT + timedelta(minutes=30)
                )

        assert premier["alertes"] == 1
        assert second["alertes"] == 1
        assert troisieme["alertes"] == 0
        assert troisieme["pannes_ignorees"] == 1
        assert notif.await_count == 2
        assert email.await_count == 2
        assert notif.await_args.kwargs["motif"] == "mal-configure"
        etat = await _etat()
        assert etat["signature"] == "resend:mal-configure"
        # Le motif a changé EN RESTANT muet : `panne_depuis` reste la date de
        # DÉBUT de la panne, pas celle du changement de motif.
        assert etat["panne_depuis"] == MAINTENANT


@pytest.mark.asyncio
class TestCanauxEtPreparation:
    async def test_l_alerte_part_sans_email_quand_le_fournisseur_est_muet(self):
        """Le cas normal d'une panne totale : l'email ne peut PAS partir. La
        notification in-app part quand même, et l'échec est ÉCRIT — un envoi
        manqué en silence ferait croire à une alerte reçue."""
        await _remise_a_zero()
        with patch("kojo_scheduler.active_email_provider_health_probe",
                   return_value=VERDICT_MUET), \
             patch("kojo_scheduler.OWNER_EMAIL", "owner@kojo.sn"), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()) as notif, \
             patch("kojo_scheduler.send_email_via_active_provider",
                   new_callable=AsyncMock,
                   side_effect=RuntimeError("Configuration Brevo incomplète: BREVO_API_KEY")):
            premier = await kojo_scheduler.email_provider_auto_alert_once(now=MAINTENANT)
            second = await kojo_scheduler.email_provider_auto_alert_once(
                now=MAINTENANT + timedelta(minutes=15)
            )

        assert premier["alertes"] == 1
        # Un échec d'envoi ne DOIT pas faire réessayer à chaque passage : la
        # promesse est « une seule fois par panne », pas « jusqu'à ce que ça
        # passe ».
        assert second["alertes"] == 0
        assert notif.await_count == 1
        etat = await _etat()
        assert etat["alerte_envoyee"] is False
        assert "BREVO_API_KEY" in etat["alerte_erreur"]

    async def test_owner_email_absent_est_dit_et_n_empeche_pas_la_notification(self):
        """`OWNER_EMAIL` vide (dev, ou secret oublié en prod) : on le NOMME au
        lieu de laisser croire que l'alerte est partie."""
        await _remise_a_zero()
        with patch("kojo_scheduler.active_email_provider_health_probe",
                   return_value=VERDICT_MUET), \
             patch("kojo_scheduler.OWNER_EMAIL", ""), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()) as notif, \
             patch("kojo_scheduler.send_email_via_active_provider", new_callable=AsyncMock) as email:
            resume = await kojo_scheduler.email_provider_auto_alert_once(now=MAINTENANT)

        assert resume["alertes"] == 1
        email.assert_not_awaited()
        assert notif.await_count == 1
        etat = await _etat()
        assert etat["alerte_envoyee"] is False
        assert etat["alerte_erreur"] == "OWNER_EMAIL non configuré"

    async def test_la_sonde_est_bien_celle_du_moniteur(self):
        """La sonde du passage est `kojo_email.active_email_provider_health_probe`,
        importée dans kojo_scheduler — donc la MÊME que `/monitor/email`. Un
        second chemin de résolution du fournisseur actif jugerait autre chose
        que ce que les envois suivent."""
        from kojo_email import active_email_provider_health_probe

        assert kojo_scheduler.active_email_provider_health_probe is active_email_provider_health_probe
        import server
        assert server.active_email_provider_health_probe is active_email_provider_health_probe

    async def test_l_alert_du_owner_resolu_par_email_atteint_le_compte_reel(self, client: AsyncClient):
        """Le scénario de production : le secret `OWNER_USER_ID` ne correspond à
        aucun compte, et le propriétaire est un vrai compte trouvé par email. La
        notification doit viser CE compte — sinon elle est écrite dans le vide."""
        await _remise_a_zero()
        owner = await register_and_login(client, BASE_USER)
        real_id = owner["user"]["id"]

        with patch("kojo_scheduler.active_email_provider_health_probe",
                   return_value=VERDICT_MUET), \
             patch("kojo_scheduler.OWNER_EMAIL", owner["user"]["email"]), \
             patch("kojo_owner.OWNER_EMAIL", owner["user"]["email"]), \
             patch("kojo_owner.OWNER_USER_ID", "kojo-owner-fantome"), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()) as notif, \
             patch("kojo_scheduler.send_email_via_active_provider", new_callable=AsyncMock) as email:
            await kojo_scheduler.email_provider_auto_alert_once(now=MAINTENANT)

        assert notif.await_args.kwargs["user_id"] == real_id
        assert email.await_args.args[0] == owner["user"]["email"]

    async def test_le_detail_conserve_est_borne(self):
        """Le détail est conservé pour être LU : une réponse d'API entière n'a
        rien à faire dans un document d'état."""
        await _remise_a_zero()
        verdict = dict(VERDICT_MUET, detail="x" * 5000)
        with patch("kojo_scheduler.active_email_provider_health_probe", return_value=verdict), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()), \
             patch("kojo_scheduler.send_email_via_active_provider", new_callable=AsyncMock):
            await kojo_scheduler.email_provider_auto_alert_once(now=MAINTENANT)

        etat = await _etat()
        assert len(etat["detail"]) == kojo_scheduler._EMAIL_ALERT_DETAIL_MAX


@pytest.mark.asyncio
class TestCablageDeLaBoucle:
    """Câblage : une boucle jamais lancée serait un vert de plus.

    Même modèle que `tests/test_scheduler_leases.py` : le bail d'abord (N
    machines Fly ne doivent pas alerter N fois), puis la ligne de `server.py`.
    """

    async def _une_iteration_de_boucle(self, boucle):
        sommeil = AsyncMock(side_effect=[None, asyncio.CancelledError()])
        with patch("kojo_scheduler.asyncio.sleep", sommeil):
            await boucle()

    async def test_la_boucle_passe_par_le_bail(self):
        executer = AsyncMock(return_value=None)
        with patch("kojo_scheduler.executer_si_bail", executer):
            await self._une_iteration_de_boucle(kojo_scheduler.email_provider_alert_loop)

        executer.assert_awaited_once()
        nom, duree, travail = executer.await_args.args
        assert nom == "email_provider_alert"
        assert duree == timedelta(minutes=kojo_scheduler.EMAIL_HEALTH_ALERT_INTERVAL_MINUTES)
        assert travail is kojo_scheduler.email_provider_auto_alert_once

    async def test_server_demarre_et_annule_la_boucle(self):
        source = io.open(
            pathlib.Path(__file__).resolve().parent.parent / "server.py",
            encoding="utf-8",
        ).read()
        assert "asyncio.create_task(email_provider_alert_loop())" in source, (
            "server.py doit DÉMARRER l'auto-alerte du fournisseur email — une "
            "boucle définie mais jamais lancée n'alerte personne."
        )
        assert "email_alert_task.cancel()" in source, (
            "et l'annuler au shutdown, comme les trois autres boucles."
        )
