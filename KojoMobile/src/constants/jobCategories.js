export const JOB_CATEGORIES = [
  {
    id: 'plumbing',
    name: 'Plomberie',
    nameEnglish: 'Plumbing',
    icon: '🔧',
    color: '#3b82f6'
  },
  {
    id: 'electrical',
    name: 'Électricité',
    nameEnglish: 'Electrical',
    icon: '⚡',
    color: '#f59e0b'
  },
  {
    id: 'construction',
    name: 'Construction',
    nameEnglish: 'Construction',
    icon: '🏗️',
    color: '#ef4444'
  },
  {
    id: 'cleaning',
    name: 'Nettoyage',
    nameEnglish: 'Cleaning',
    icon: '🧹',
    color: '#10b981'
  },
  {
    id: 'gardening',
    name: 'Jardinage',
    nameEnglish: 'Gardening',
    icon: '🌱',
    color: '#84cc16'
  },
  {
    id: 'tutoring',
    name: 'Tutorat',
    nameEnglish: 'Tutoring',
    icon: '📚',
    color: '#8b5cf6'
  },
  {
    id: 'cooking',
    name: 'Cuisine',
    nameEnglish: 'Cooking',
    icon: '👨‍🍳',
    color: '#f97316'
  },
  {
    id: 'transportation',
    name: 'Transport',
    nameEnglish: 'Transportation',
    icon: '🚗',
    color: '#06b6d4'
  },
  {
    id: 'security',
    name: 'Sécurité',
    nameEnglish: 'Security',
    icon: '🛡️',
    color: '#64748b'
  },
  {
    id: 'beauty',
    name: 'Beauté',
    nameEnglish: 'Beauty',
    icon: '💄',
    color: '#ec4899'
  }
];

export const getCategoryById = (id) => {
  return JOB_CATEGORIES.find(category => category.id === id);
};