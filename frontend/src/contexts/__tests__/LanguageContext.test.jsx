/**
 * LA LANGUE DEMANDÉE PAR L'ADRESSE — `?lang=en`.
 *
 * ── Pourquoi ce fichier existe ─────────────────────────────────────────────
 * Les 45 pages servies par le backend (villes, métiers, guides) portent dans
 * leur en-tête les cinq langues du site : c'est la seule surface où un visiteur
 * venu d'un moteur de recherche peut dire dans quelle langue il veut lire le
 * site, puisqu'il n'y a ni barre de navigation ni sélecteur de langue sur ces
 * pages. Leur lien mène à `/?lang=<code>`, et RIEN ne le lisait : un choix
 * affiché qui ne change rien est pire qu'un choix absent.
 *
 * Ce que ces cas verrouillent, et dans quel ordre :
 *
 *   1. une langue CONNUE demandée par l'adresse est celle que la page parle ;
 *   2. une langue INCONNUE est ignorée — jamais traduite en « la première »,
 *      sinon `?lang=de` ferait parler le site en français en prétendant avoir
 *      obéi ;
 *   3. l'ADRESSE gagne sur le réglage gardé (le clic est une intention
 *      explicite, le stockage un état ancien) ;
 *   4. sans adresse, le réglage gardé reste maître — c'est le comportement
 *      d'avant, il ne doit pas régresser ;
 *   5. la langue demandée est GARDÉE : sans cela, le lien n'aurait servi
 *      qu'une page, et la navigation suivante repartirait en français.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider, useLanguage } from '../LanguageContext';

/** Ce que la page dit de sa langue : le code courant, lu dans le contexte. */
function Sonde() {
  const { currentLanguage } = useLanguage();
  return <span data-testid="langue">{currentLanguage}</span>;
}

const adresse = (recherche) => {
  window.history.replaceState({}, '', `/${recherche}`);
};

const monter = () =>
  render(
    <LanguageProvider>
      <Sonde />
    </LanguageProvider>
  );

const langueAffichee = () => screen.getByTestId('langue').textContent;

describe('LanguageContext — la langue demandée par l’adresse', () => {
  beforeEach(() => {
    window.localStorage.clear();
    adresse('');
  });

  afterEach(() => {
    window.localStorage.clear();
    adresse('');
  });

  it('parle la langue demandée quand elle existe', () => {
    adresse('?lang=en');
    monter();
    expect(langueAffichee()).toBe('en');
  });

  it('ignore une langue que le site ne propose pas', () => {
    adresse('?lang=de');
    monter();
    expect(langueAffichee()).toBe('fr');
  });

  it('fait gagner l’adresse sur le réglage gardé', () => {
    window.localStorage.setItem('language', 'wo');
    adresse('?lang=bm');
    monter();
    expect(langueAffichee()).toBe('bm');
  });

  it('garde le réglage quand aucune langue n’est demandée', () => {
    window.localStorage.setItem('language', 'mos');
    monter();
    expect(langueAffichee()).toBe('mos');
  });

  it('retient la langue de l’adresse pour la suite de la visite', async () => {
    adresse('?lang=en');
    monter();
    // L'écriture est faite dans un effet : elle suit le premier rendu.
    await waitFor(() => expect(window.localStorage.getItem('language')).toBe('en'));
  });
});
