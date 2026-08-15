import { describe, it, expect } from 'vitest';
import { mapPaymentAccountErrorToField } from '../paymentAccountErrors';

describe('mapPaymentAccountErrorToField', () => {
  it('mappe « Numéro Orange Money invalide » sur le champ orange_money', () => {
    expect(mapPaymentAccountErrorToField('Numéro Orange Money invalide')).toEqual({
      field: 'orange_money',
      message: 'Numéro Orange Money invalide',
    });
  });

  it('mappe « Numéro Wave invalide » sur le champ wave', () => {
    expect(mapPaymentAccountErrorToField('Numéro Wave invalide')).toEqual({
      field: 'wave',
      message: 'Numéro Wave invalide',
    });
  });

  it('mappe « Informations de compte bancaire invalides » sur bank_account', () => {
    expect(mapPaymentAccountErrorToField('Informations de compte bancaire invalides')).toEqual({
      field: 'bank_account',
      message: 'Informations de compte bancaire invalides',
    });
  });

  it('retourne null pour une erreur sans champ précis (minimum requis)', () => {
    expect(
      mapPaymentAccountErrorToField(
        'Les clients doivent lier au moins 1 moyen de paiement (Orange Money, Wave ou Compte bancaire)'
      )
    ).toBeNull();
  });

  it('retourne null pour un message vide ou absent', () => {
    expect(mapPaymentAccountErrorToField('')).toBeNull();
    expect(mapPaymentAccountErrorToField(null)).toBeNull();
    expect(mapPaymentAccountErrorToField(undefined)).toBeNull();
  });
});
