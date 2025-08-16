import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';

export default function Home() {
  const { t } = useLanguage();
  const { user } = useAuth();

  const categories = [
    { key: 'plumbing', icon: '🔧' },
    { key: 'electrical', icon: '⚡' },
    { key: 'construction', icon: '🏗️' },
    { key: 'cleaning', icon: '🧽' },
    { key: 'gardening', icon: '🌱' },
    { key: 'tutoring', icon: '📚' }
  ];

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="bg-gradient-to-r from-orange-600 to-orange-700 text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-6xl font-bold mb-6">
            {t('heroTitle')}
          </h1>
          <p className="text-xl md:text-2xl mb-8 opacity-90">
            {t('heroSubtitle')}
          </p>
          <div className="space-x-4">
            {!user ? (
              <>
                <Link 
                  to="/register"
                  className="bg-white text-orange-600 hover:bg-gray-100 px-8 py-3 rounded-lg font-semibold text-lg inline-block"
                >
                  {t('getStarted')}
                </Link>
                <Link 
                  to="/jobs"
                  className="border-2 border-white text-white hover:bg-white hover:text-orange-600 px-8 py-3 rounded-lg font-semibold text-lg inline-block"
                >
                  {t('jobs')}
                </Link>
              </>
            ) : (
              <Link 
                to="/dashboard"
                className="bg-white text-orange-600 hover:bg-gray-100 px-8 py-3 rounded-lg font-semibold text-lg inline-block"
              >
                {t('dashboard')}
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Categories Section */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            {t('categories')}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
            {categories.map((category) => (
              <Link
                key={category.key}
                to={`/jobs?category=${category.key}`}
                className="bg-white rounded-lg shadow-md p-6 text-center hover:shadow-lg transition-shadow"
              >
                <div className="text-4xl mb-3">{category.icon}</div>
                <h3 className="font-medium text-gray-900">{t(category.key)}</h3>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="bg-orange-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">💼</span>
              </div>
              <h3 className="text-xl font-semibold mb-2">Trouvez du travail</h3>
              <p className="text-gray-600">Découvrez des opportunités dans votre région</p>
            </div>
            <div className="text-center">
              <div className="bg-orange-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">🤝</span>
              </div>
              <h3 className="text-xl font-semibold mb-2">Connectez-vous</h3>
              <p className="text-gray-600">Échangez directement avec clients et travailleurs</p>
            </div>
            <div className="text-center">
              <div className="bg-orange-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">💰</span>
              </div>
              <h3 className="text-xl font-semibold mb-2">Paiements sécurisés</h3>
              <p className="text-gray-600">Orange Money et Wave intégrés</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}