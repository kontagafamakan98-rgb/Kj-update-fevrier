/**
 * Tests de rendu de ProfileEditForm (formulaire « Modifier » du profil).
 *
 * RÉGRESSION COUVERTE : le clic sur « Modifier » faisait planter l'app avec
 * « ReferenceError: getAvailableLanguagesForCountry is not defined » dans
 * ProfileEditForm (fonction du contexte de langue référencée hors de portée).
 * Ces tests rendent le formulaire tel quel : si la fonction venait à
 * disparaître de nouveau, le rendu lèverait une erreur et les tests
 * échoueraient immédiatement.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// --- Mocks : isole ProfileEditForm des providers lourds et du réseau ----

// useAuth : le sous-arbre (ProfilePhotoUploader) en a besoin pour savoir si
// la photo est éditable ; on fournit un user minimal, sans monter AuthProvider.
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', user_type: 'client' }, updateUser: vi.fn() }),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ show: vi.fn(), error: vi.fn(), success: vi.fn() }),
}));

// ProfilePhotoUploader charge la photo au montage : on évite tout appel
// réseau (l'endpoint backend n'existe pas dans l'environnement de test).
vi.mock('../../services/ProfilePhotoService', () => ({
  default: {
    getCurrentUserPhotoUrl: vi.fn().mockResolvedValue(null),
    getPhotoUrl: vi.fn().mockResolvedValue(null),
    revokePreviewUrl: vi.fn(),
    // Avatar par défaut généré pendant le rendu (aucune photo en base)
    generateDefaultAvatar: vi.fn().mockReturnValue('data:image/svg+xml;base64,test'),
  },
}));

// --- Imports réels (après les vi.mock, qui sont hoistés par Vitest) ----

import { LanguageProvider } from '../../contexts/LanguageContext';
import { ProfileEditForm } from '../Profile';
import fr from '../../i18n/fr.json';
import { makeScopedTranslator } from '../../utils/pack2PageI18n/profile';

const t = (key) => fr[key] ?? key;
// Même construction que la page Profile : pageT = traducteur scopé 'profile'.
const pageT = makeScopedTranslator('fr', t);

const baseProfile = {
  first_name: 'Jean',
  last_name: 'Dupont',
  phone: '+221771234567',
  preferred_language: 'fr',
  country: 'senegal',
  bio: '',
  skills: '',
  profile_photo: '',
};

const renderForm = (overrides = {}) => {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <LanguageProvider>
      <ProfileEditForm
        profile={{ ...baseProfile, ...(overrides.profile || {}) }}
        user={overrides.user || { id: 'user-1', user_type: 'client' }}
        onSave={onSave}
        onCancel={onCancel}
        pageT={pageT}
        t={t}
      />
    </LanguageProvider>
  );
  return { onSave, onCancel, ...utils };
};

describe('ProfileEditForm', () => {
  it('se rend sans planter (régression du crash « Modifier »)', () => {
    renderForm();

    // Champs préremplis depuis le profil
    expect(screen.getByDisplayValue('Jean')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Dupont')).toBeInTheDocument();
    // Le préfixe pays est affiché à part, le champ ne montre que le numéro local
    expect(screen.getByDisplayValue('771234567')).toBeInTheDocument();

    // Section photo de profil (ProfilePhotoUploader) présente
    expect(screen.getByText('Photo de profil')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choisir une photo' })).toBeInTheDocument();
  });

  it('affiche les langues du pays du profil (Sénégal → fr/en/wo)', () => {
    renderForm();

    const select = screen.getByLabelText('Langue préférée');
    const options = [...select.options].map((o) => o.textContent);
    expect(options).toEqual(['Français', 'English', 'Wolof']);
  });

  it('adapte les langues au pays du profil (Mali → fr/en/bm)', () => {
    renderForm({ profile: { country: 'mali' } });

    const select = screen.getByLabelText('Langue préférée');
    const options = [...select.options].map((o) => o.textContent);
    expect(options).toEqual(['Français', 'English', 'Bambara']);
  });

  it('appelle onSave avec les données du profil au clic sur « Enregistrer »', () => {
    const { onSave } = renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: 'Jean',
        last_name: 'Dupont',
        phone: '+221771234567',
        country: 'senegal',
      })
    );
  });

  it('ajoute des compétences en tags (Entrée ou bouton Ajouter) et les envoie en liste', () => {
    const { onSave } = renderForm({ profile: { user_type: 'worker' } });

    const skillInput = screen.getByLabelText('Compétences');

    // Ajout via la touche Entrée
    fireEvent.change(skillInput, { target: { value: 'Plomberie' } });
    fireEvent.keyDown(skillInput, { key: 'Enter' });

    // Ajout via le bouton Ajouter
    fireEvent.change(skillInput, { target: { value: 'Électricité' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));

    // Les chips s'affichent
    expect(screen.getByText('Plomberie')).toBeInTheDocument();
    expect(screen.getByText('Électricité')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    // Régression : le backend PUT /users/profile renvoie 400
    // « skills doit être une liste » quand skills est une chaîne.
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: ['Plomberie', 'Électricité'],
      })
    );
  });

  it('préremplit les compétences existantes en chips et les envoie en liste', () => {
    const { onSave } = renderForm({ profile: { user_type: 'worker', skills: ['Plomberie', 'Électricité'] } });

    expect(screen.getByText('Plomberie')).toBeInTheDocument();
    expect(screen.getByText('Électricité')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ skills: ['Plomberie', 'Électricité'] })
    );
  });

  it('supprime une compétence (chip ×) avant l\'envoi', () => {
    const { onSave } = renderForm({ profile: { user_type: 'worker', skills: ['Plomberie', 'Électricité'] } });

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer Plomberie' }));

    expect(screen.queryByText('Plomberie')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ skills: ['Électricité'] })
    );
  });

  it('appelle onCancel au clic sur « Annuler »', () => {
    const { onCancel } = renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
