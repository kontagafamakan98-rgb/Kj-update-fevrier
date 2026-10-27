# -*- coding: utf-8 -*-
"""Régression : l'inscription demande UN nom et le téléphone est FACULTATIF.

Le défaut que ce test verrouille (26/10/2026)
---------------------------------------------
Le formulaire d'inscription demandait SEPT champs obligatoires, dont deux pour
le nom (`first_name` + `last_name`), une confirmation de mot de passe, et un
numéro de téléphone qui n'était jamais vérifié — un champ de CONTACT traité
comme un identifiant. Deux champs de nom obligent à décider où coupe un nom
(la règle « prénom puis nom » n'est pas universelle), la confirmation d'un mot
de passe ne prouve rien de plus que le révélateur déjà présent, et exiger un
téléphone ne protégeait rien : aucun OTP téléphone n'existe, aucune connexion
par téléphone n'existe.

Ce qui est verrouillé ici
-------------------------
1. Un nom en UN champ (`name`) suffit : le serveur le répartit (premier mot =
   prénom, le reste = nom), et c'est ce que la réponse PUBLIE ;
2. Un nom d'UN SEUL mot ne fabrique pas de nom de famille (« Awa Awa » serait
   une donnée fausse) : le nom de famille reste vide ;
3. Les champs HISTORIQUES restent acceptés (un ancien client, un script ou
   l'app native ne sont pas cassés par l'allègement) ;
4. Un compte se crée SANS téléphone, et le numéro fourni reste VALIDÉ : on ne
   troque pas une barrière contre un contact faux ;
5. Le nom reste EXIGÉ — l'allègement ne supprime pas la seule chose qui
   identifie une personne.

Ce que ce test ne prouve pas : que l'ÉCRAN n'affiche plus les deux champs ni la
confirmation (c'est `frontend/src/pages/__tests__/Register.test.jsx`), ni le
rendu de la coquille pré-rendue (sondes de géométrie et de texte).
"""
import pytest
from httpx import AsyncClient
from pydantic import ValidationError

from kojo_models import UserWithPayment, repartir_nom_complet
from tests.conftest import BASE_USER, issue_email_verification_token


def _sans_comptes(base: dict, email: str) -> dict:
    """Le compte minimal : pas de moyens de paiement (facultatifs depuis le 22/10)."""
    data = {cle: valeur for cle, valeur in base.items() if cle != "payment_accounts"}
    data["email"] = email
    return data


async def _inscrire(client: AsyncClient, data: dict):
    token = await issue_email_verification_token(client, data["email"])
    return await client.post(
        "/api/auth/register-verified",
        json={**data, "email_verification_token": token},
    )


def _nom_en_un_champ(email: str, nom: str) -> dict:
    """La charge utile que le formulaire allégé envoie réellement."""
    data = _sans_comptes(BASE_USER, email)
    data.pop("first_name", None)
    data.pop("last_name", None)
    data.pop("phone", None)
    data["name"] = nom
    return data


class TestLeNomEnUnChamp:
    def test_un_nom_de_deux_mots_donne_un_prenom_et_un_nom(self):
        assert repartir_nom_complet("Awa Diop") == ("Awa", "Diop")
        assert repartir_nom_complet("  Awa   Ndiaye Diop  ") == ("Awa", "Ndiaye Diop")

    def test_un_nom_d_un_seul_mot_ne_fabrique_pas_de_nom(self):
        """« Awa » ne devient pas « Awa Awa » : un nom inventé est une donnée fausse."""
        assert repartir_nom_complet("Awa") == ("Awa", "")
        assert repartir_nom_complet("") == ("", "")

    @pytest.mark.asyncio
    async def test_l_inscription_accepte_un_seul_champ_de_nom(self, client: AsyncClient):
        reponse = await _inscrire(client, _nom_en_un_champ("nom-complet@kojo.sn", "Awa Diop"))

        assert reponse.status_code == 200, reponse.text
        user = reponse.json()["user"]
        assert user["first_name"] == "Awa"
        assert user["last_name"] == "Diop"

    @pytest.mark.asyncio
    async def test_un_nom_d_un_seul_mot_cree_le_compte(self, client: AsyncClient):
        reponse = await _inscrire(client, _nom_en_un_champ("nom-un-mot@kojo.sn", "Awa"))

        assert reponse.status_code == 200, reponse.text
        user = reponse.json()["user"]
        assert user["first_name"] == "Awa"
        assert user["last_name"] == "", "un nom d'un seul mot ne doit pas être dupliqué"

    @pytest.mark.asyncio
    async def test_les_champs_historiques_restent_acceptes(self, client: AsyncClient):
        """L'allègement ne casse pas un client d'avant : `first_name`/`last_name`."""
        data = _sans_comptes(BASE_USER, "ancien-client@kojo.sn")
        data.pop("name", None)

        reponse = await _inscrire(client, data)

        assert reponse.status_code == 200, reponse.text
        user = reponse.json()["user"]
        assert user["first_name"] == BASE_USER["first_name"]
        assert user["last_name"] == BASE_USER["last_name"]

    @pytest.mark.asyncio
    async def test_un_nom_absent_reste_refuse(self, client: AsyncClient):
        """Ce que l'allègement retire, c'est la DEUXIÈME saisie, jamais la première."""
        data = _sans_comptes(BASE_USER, "sans-nom@kojo.sn")
        data.pop("first_name", None)
        data.pop("last_name", None)

        reponse = await _inscrire(client, data)

        assert reponse.status_code in (400, 422), reponse.text
        assert "access_token" not in reponse.text


class TestLeTelephoneFacultatif:
    @pytest.mark.asyncio
    async def test_un_compte_se_cree_sans_telephone(self, client: AsyncClient):
        data = _nom_en_un_champ("sans-telephone@kojo.sn", "Awa Diop")

        reponse = await _inscrire(client, data)

        assert reponse.status_code == 200, reponse.text
        assert reponse.json()["user"]["phone"] is None

    @pytest.mark.asyncio
    async def test_un_telephone_vide_vaut_pas_de_telephone(self, client: AsyncClient):
        data = _nom_en_un_champ("telephone-vide@kojo.sn", "Awa Diop")
        data["phone"] = "   "

        reponse = await _inscrire(client, data)

        assert reponse.status_code == 200, reponse.text
        assert reponse.json()["user"]["phone"] is None

    @pytest.mark.asyncio
    async def test_un_telephone_fourni_reste_valide(self, client: AsyncClient):
        """Facultatif n'est pas « n'importe quoi » : un contact faux serait pire."""
        data = _nom_en_un_champ("telephone-invalide@kojo.sn", "Awa Diop")
        data["phone"] = "+2211"

        reponse = await _inscrire(client, data)

        assert reponse.status_code in (400, 422), reponse.text
        assert "access_token" not in reponse.text

    def test_le_modele_normalise_le_telephone_absent(self):
        """Le modèle, seul : « pas de numéro » est `None`, jamais une chaîne vide."""
        modele = UserWithPayment(
            email="modele@kojo.sn",
            password="motdepasse123",
            name="Awa Diop",
            user_type="client",
            country="senegal",
            preferred_language="fr",
            legal_documents_accepted=True,
            legal_documents_version="v1.0.0-2024",
        )
        assert modele.phone is None
        assert (modele.first_name, modele.last_name) == ("Awa", "Diop")

    @pytest.mark.asyncio
    async def test_vider_son_telephone_dans_le_profil_reste_permis(self, client: AsyncClient):
        """Une valeur facultative à l'inscription ne devient pas obligatoire ensuite."""
        data = _nom_en_un_champ("profil-vide@kojo.sn", "Awa Diop")
        inscription = await _inscrire(client, data)
        assert inscription.status_code == 200, inscription.text
        entetes = {"Authorization": f"Bearer {inscription.json()['access_token']}"}

        mise_a_jour = await client.put(
            "/api/users/profile", json={"phone": ""}, headers=entetes
        )

        assert mise_a_jour.status_code == 200, mise_a_jour.text
        profil = await client.get("/api/auth/me", headers=entetes)
        assert profil.status_code == 200
        assert profil.json().get("phone") in (None, "")

    def test_le_modele_refuse_un_nom_d_un_caractere(self):
        with pytest.raises(ValidationError):
            UserWithPayment(
                email="modele-court@kojo.sn",
                password="motdepasse123",
                name="A",
                user_type="client",
                country="senegal",
                preferred_language="fr",
                legal_documents_accepted=True,
                legal_documents_version="v1.0.0-2024",
            )
