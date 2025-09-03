import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { getAllCountries } from '../components/CountryDisplay';

export default function Home() {
  const { t } = useLanguage();
  const { user } = useAuth();

  const categories = [
    { key: 'plumbing', icon: '🔧' },
    { key: 'electrical', icon: '⚡' },
    { key: 'mechanics', icon: '🔩' },
    { key: 'construction', icon: '🏗️' },
    { key: 'cleaning', icon: '🧽' },
    { key: 'gardening', icon: '🌱' },
    { key: 'tutoring', icon: '📚' },
    { key: 'computing', icon: '💻' }
  ];

  const countries = getAllCountries().map((country, index) => ({
    ...country,
    color: ['bg-green-100', 'bg-yellow-100', 'bg-red-100', 'bg-orange-100'][index]
  }));

  return (
    <div className="min-h-screen">
      {/* Hero Section - Mobile Optimized */}
      <section className="bg-gradient-to-br from-orange-600 via-orange-700 to-red-600 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-black bg-opacity-10"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20">
          <div className="text-center">
            <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold mb-4 md:mb-6 leading-tight">
              Connecter les travailleurs et clients en Afrique de l'Ouest
            </h1>
            <p className="text-lg md:text-xl lg:text-2xl mb-8 opacity-90 max-w-3xl mx-auto">
              Trouvez des services de qualité ou offrez vos compétences au Mali, Sénégal, Burkina Faso et Côte d'Ivoire
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              {!user ? (
                <>
                  <Link 
                    to="/register"
                    className="w-full sm:w-auto bg-white text-orange-600 hover:bg-gray-100 px-8 py-4 rounded-xl font-semibold text-lg shadow-lg transform transition hover:scale-105"
                  >
                    Commencer maintenant
                  </Link>
                  <Link 
                    to="/jobs"
                    className="w-full sm:w-auto border-2 border-white text-white hover:bg-white hover:text-orange-600 px-8 py-4 rounded-xl font-semibold text-lg transition"
                  >
                    Voir les emplois
                  </Link>
                </>
              ) : (
                <Link 
                  to="/dashboard"
                  className="w-full sm:w-auto bg-white text-orange-600 hover:bg-gray-100 px-8 py-4 rounded-xl font-semibold text-lg shadow-lg transform transition hover:scale-105"
                >
                  Mon tableau de bord
                </Link>
              )}
            </div>
          </div>
        </div>
        
        {/* Decorative elements */}
        <div className="absolute top-0 left-0 w-64 h-64 bg-white bg-opacity-5 rounded-full -translate-x-32 -translate-y-32"></div>
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-white bg-opacity-5 rounded-full translate-x-48 translate-y-48"></div>
      </section>

      {/* Countries Coverage Section - Mobile First */}
      <section className="py-12 md:py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4">
              Disponible dans 4 pays
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Kojo connecte les travailleurs et clients à travers l'Afrique de l'Ouest
            </p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
            {countries.map((country, index) => (
              <div
                key={index}
                className={`${country.color} rounded-2xl p-6 text-center transform transition hover:scale-105 cursor-pointer shadow-md hover:shadow-lg`}
              >
                <div className="flex justify-center mb-3">
                  <div className="text-6xl md:text-8xl">{country.flag}</div>
                </div>
                <h3 className="font-semibold text-gray-900 text-sm md:text-base">{country.name}</h3>
                <p className="text-xs text-gray-600 mt-1">Services disponibles</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Categories Section - Mobile Optimized */}
      <section className="py-12 md:py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4">
              Services populaires
            </h2>
            <p className="text-gray-600">
              Trouvez le service dont vous avez besoin
            </p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 md:gap-6">
            {categories.map((category) => (
              <Link
                key={category.key}
                to={`/jobs?category=${category.key}`}
                className="bg-white rounded-2xl shadow-md p-6 text-center hover:shadow-lg transform transition hover:scale-105"
              >
                <div className="text-3xl md:text-4xl mb-3">{category.icon}</div>
                <h3 className="font-medium text-gray-900 text-sm md:text-base">{t(category.key)}</h3>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section - Mobile First */}
      <section className="py-12 md:py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
            <div className="text-center">
              <div className="bg-orange-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-2xl">💼</span>
              </div>
              <h3 className="text-xl font-semibold mb-4 text-gray-900">Trouvez du travail</h3>
              <p className="text-gray-600">
                Découvrez des opportunités dans votre région et développez votre activité
              </p>
            </div>
            
            <div className="text-center">
              <div className="bg-orange-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-2xl">🤝</span>
              </div>
              <h3 className="text-xl font-semibold mb-4 text-gray-900">Connectez-vous</h3>
              <p className="text-gray-600">
                Échangez directement avec clients et travailleurs via notre messagerie
              </p>
            </div>
            
            <div className="text-center">
              <div className="bg-orange-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-2xl">💰</span>
              </div>
              <h3 className="text-xl font-semibold mb-4 text-gray-900">Paiements sécurisés</h3>
              <p className="text-gray-600">
                Orange Money, Wave et autres méthodes de paiement intégrées
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Call to Action - Mobile Optimized */}
      <section className="py-12 md:py-16 bg-gradient-to-r from-orange-600 to-red-600 text-white">
        <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-6">
            Rejoignez des milliers d'utilisateurs
          </h2>
          <p className="text-lg md:text-xl mb-8 opacity-90">
            Commencez dès aujourd'hui à connecter avec des clients ou travailleurs qualifiés
          </p>
          
          {!user && (
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link 
                to="/register?type=client"
                className="bg-white text-orange-600 hover:bg-gray-100 px-8 py-4 rounded-xl font-semibold transform transition hover:scale-105"
              >
                Je cherche des services
              </Link>
              <Link 
                to="/register?type=worker"
                className="border-2 border-white text-white hover:bg-white hover:text-orange-600 px-8 py-4 rounded-xl font-semibold transition"
              >
                Je propose mes services
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Stats Section - Mobile Friendly */}
      <section className="py-12 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-3xl md:text-4xl font-bold text-orange-600 mb-2">1000+</div>
              <div className="text-sm md:text-base text-gray-600">Travailleurs actifs</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-bold text-orange-600 mb-2">500+</div>
              <div className="text-sm md:text-base text-gray-600">Projets complétés</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-bold text-orange-600 mb-2">4</div>
              <div className="text-sm md:text-base text-gray-600">Pays couverts</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-bold text-orange-600 mb-2">24/7</div>
              <div className="text-sm md:text-base text-gray-600">Support client</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}