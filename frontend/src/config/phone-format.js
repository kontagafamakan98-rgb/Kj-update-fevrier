export const PHONE_NUMBER_MASK = 'XX XXX XX XX';
export const phoneNumberExample = (prefix = '---') => `${prefix} ${PHONE_NUMBER_MASK}`;

// Ce qu'affiche le préfixe du champ téléphone avant toute détection de pays :
// un tiret cadratin, la même valeur dans le composant Register et dans sa
// coquille. La coquille publiait `---` (le préfixe du MASQUE) là où la page
// affiche ce tiret : le premier paint contredisait donc l'hydratation, sur le
// même élément.
export const PHONE_PREFIX_FALLBACK = '—';
