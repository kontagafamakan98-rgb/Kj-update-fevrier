/**
 * Le runtime annonce-t-il EXACTEMENT le texte de la table ?
 *
 * C'est le côté « app » de la comparaison app ↔ coquille : le garde
 * scripts/check-page-meta.js vérifie que chaque page de route appelle
 * usePageMeta() et que les coquilles du build portent le texte de la table ;
 * ce test-ci exerce le hook lui-même, avec le VRAI fournisseur de langue et le
 * VRAI dictionnaire, et lit ce qui atterrit dans <head>. Sans lui, « la page
 * annonce la table » reposerait sur une lecture de code.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { LanguageProvider } from '../../contexts/LanguageContext';
import { usePageMeta } from '../seo';
import { PAGE_META } from '../../config/page-meta';
import { ogCardFor } from '../../config/og-cards';
import fr from '../../i18n/fr.json';

const content = (key) => {
  const el = document.querySelector(`meta[name="${key}"], meta[property="${key}"]`);
  return el ? el.getAttribute('content') || '' : '';
};

const Announce = () => {
  usePageMeta();
  return <div>page</div>;
};

const renderAt = (route) => {
  window.history.replaceState({}, '', route);
  return render(
    <LanguageProvider>
      <Announce />
    </LanguageProvider>
  );
};

beforeEach(() => {
  cleanup();
  document.title = 'titre précédent';
  for (const tag of document.querySelectorAll('meta[name="description"], meta[property^="og:"], meta[property^="twitter:"], link[rel="canonical"]')) {
    tag.remove();
  }
});

describe('usePageMeta — le runtime annonce la table', () => {
  it('route par route, publie le titre et la description de la table', () => {
    const annonces = [];
    for (const [route, keys] of Object.entries(PAGE_META)) {
      renderAt(route);
      const title = fr[keys.title];
      const description = keys.description ? fr[keys.description] : '';
      expect(document.title, `route ${route}`).toBe(title);
      expect(content('description'), `route ${route}`).toBe(description);
      expect(content('og:title'), `route ${route}`).toBe(title);
      expect(content('og:description'), `route ${route}`).toBe(description);
      expect(content('twitter:title'), `route ${route}`).toBe(title);
      cleanup();
      annonces.push(`${route} → ${title}`);
    }

    // Les routes autrefois MUETTES au runtime, nommées : sans elles, une table
    // vide ferait passer la boucle précédente pour une preuve.
    expect(annonces).toContain('/register → Créer un compte — Kojo');
    expect(annonces).toContain('/forgot-password → Mot de passe oublié — Kojo');
    expect(annonces).toContain('/payment → Paiements sécurisés — Kojo');
  });

  it('public la carte et le canonical de la route courante', () => {
    renderAt('/login');

    expect(content('og:image')).toBe(`${window.location.origin}${ogCardFor('/login').image}`);
    expect(content('twitter:image')).toBe(`${window.location.origin}${ogCardFor('/login').image}`);
    const canonical = document.querySelector('link[rel="canonical"]');
    expect(canonical?.getAttribute('href')).toBe(`${window.location.origin}/login`);
  });

  it('ne touche à RIEN pour une route absente de la table', () => {
    // /dashboard est un écran client (app.html, noindex) : sa page garde la main,
    // le hook ne doit donc pas inventer un texte neutre qui entrerait en conflit
    // avec le gabarit nu.
    renderAt('/dashboard');

    expect(document.title).toBe('titre précédent');
    expect(content('description')).toBe('');
    expect(content('og:title')).toBe('');
  });

  it('accepte un texte de DONNÉE (fiche mission), qui prime sur la table', () => {
    window.history.replaceState({}, '', '/jobs/aaaa1111-bbbb-4222-8333-cccc44445555');
    render(
      <LanguageProvider>
        <JobMeta />
      </LanguageProvider>
    );

    expect(document.title).toBe('Réparation ordinateur — Kojo');
    expect(content('og:description')).toBe('Mission à Bamako');
  });
});

const JobMeta = () => {
  usePageMeta({ title: 'Réparation ordinateur — Kojo', description: 'Mission à Bamako' });
  return <div>mission</div>;
};
