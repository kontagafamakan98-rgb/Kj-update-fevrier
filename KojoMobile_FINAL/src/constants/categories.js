export const JOB_CATEGORIES = [
  { key: 'plumbing', icon: '🔧', name: 'Plomberie' },
  { key: 'electrical', icon: '⚡', name: 'Électricité' },
  { key: 'construction', icon: '🏗️', name: 'Construction' },
  { key: 'cleaning', icon: '🧽', name: 'Nettoyage' },
  { key: 'gardening', icon: '🌱', name: 'Jardinage' },
  { key: 'tutoring', icon: '📚', name: 'Tutorat' },
  { key: 'cooking', icon: '👨‍🍳', name: 'Cuisine' },
  { key: 'transportation', icon: '🚗', name: 'Transport' }
];

export const getCategoryByKey = (key) => {
  return JOB_CATEGORIES.find(cat => cat.key === key);
};