import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { usePageTitle } from '../utils/seo';

const STEPS = [
  {
    icon: '📝',
    title: '1. Publiez ou postulez',
    description:
      'Le client décrit sa mission (plomberie, électricité, mécanique, construction…) avec son budget. Les travailleurs qualifiés de la région postulent en quelques secondes depuis leur téléphone.',
  },
  {
    icon: '🛡️',
    title: '2. Choisissez et payez en séquestre',
    description:
      'Le client choisit le travailleur qui lui convient et paie via Orange Money, Wave ou carte bancaire. L’argent est bloqué sur le compte sécurisé Kojo : ni le client, ni le travailleur, ne peut y toucher avant la fin de la mission.',
  },
  {
    icon: '✅',
    title: '3. Travail terminé = paiement libéré',
    description:
      'Quand la mission est terminée, le client valide et l’argent est versé automatiquement au travailleur. Simple, transparent, sans litige ni mauvaise surprise.',
  },
];

const FAQ = [
  {
    q: 'Pourquoi payer en séquestre ?',
    a: "Le séquestre protège les deux côtés : le client est sûr que l'argent n'est débloqué qu'une fois la mission terminée, et le travailleur est sûr d'être payé. C'est la garantie de confiance qui manque à la plupart des plateformes.",
  },
  {
    q: 'Quels moyens de paiement ?',
    a: 'Orange Money (Sénégal, Mali, Burkina Faso, Côte d’Ivoire), Wave (Sénégal, Côte d’Ivoire) et la carte bancaire.',
  },
  {
    q: 'Comment le travailleur est-il payé ?',
    a: "Dès que le client valide la mission terminée, le montant séquestré (moins la commission Kojo, affichée avant paiement) est versé automatiquement sur le compte mobile money du travailleur.",
  },
  {
    q: 'Que se passe-t-il en cas de problème ?',
    a: "Le paiement reste bloqué tant que la mission n'est pas validée. En cas de désaccord, l'équipe Kojo intervient via le support. Si une mission est annulée avant le début, le client est remboursé automatiquement.",
  },
  {
    q: 'Est-ce que Kojo parle ma langue ?',
    a: 'Oui : français, anglais, wolof, bambara et mooré. Chacun peut utiliser l’application dans sa langue.',
  },
];

export default function HowItWorks() {
  const { t } = useLanguage();
  usePageTitle('Comment ça marche — Kojo');

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="bg-gradient-to-br from-orange-600 via-orange-700 to-red-600 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16 text-center">
          <h1 className="text-3xl md:text-4xl font-bold mb-4">Comment ça marche ?</h1>
          <p className="text-lg opacity-90 max-w-2xl mx-auto">
            Trouver un travailleur ou une mission en Afrique de l'Ouest, en toute confiance,
            grâce au paiement sécurisé Kojo.
          </p>
        </div>
      </section>

      {/* Étapes */}
      <section className="py-12 md:py-16 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map((step) => (
              <div key={step.title} className="rounded-2xl border border-gray-100 shadow-sm p-6">
                <div className="bg-orange-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">{step.icon}</span>
                </div>
                <h2 className="text-lg font-semibold text-gray-900 text-center mb-3">{step.title}</h2>
                <p className="text-gray-600 text-sm">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Escrow détaillé */}
      <section className="py-12 md:py-16 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl border-2 border-emerald-200 bg-emerald-50 p-8 md:p-10">
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="text-5xl">🛡️</div>
              <div>
                <h2 className="text-2xl md:text-3xl font-bold text-emerald-900 mb-3">Le paiement séquestre, c'est quoi ?</h2>
                <p className="text-emerald-800">
                  Quand vous payez sur Kojo, l'argent n'est <strong>pas envoyé directement au travailleur</strong>.
                  Il est <strong>bloqué sur un compte sécurisé</strong> (le séquestre) tant que la mission n'est pas
                  terminée. Ce n'est qu'après votre validation que le montant est libéré en faveur du travailleur.
                </p>
                <ul className="mt-4 space-y-2 text-emerald-800 text-sm">
                  <li>✅ Le client paie une fois, au début — aucun paiement en liquide risqué.</li>
                  <li>✅ Le travailleur est certain d'être payé à la fin.</li>
                  <li>✅ En cas d'annulation avant le début, remboursement automatique.</li>
                  <li>✅ La commission Kojo est affichée avant chaque paiement.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-12 md:py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 text-center mb-8">Questions fréquentes</h2>
          <div className="space-y-4">
            {FAQ.map((item) => (
              <details key={item.q} className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 group">
                <summary className="cursor-pointer font-semibold text-gray-900 list-none flex items-center justify-between gap-4">
                  {item.q}
                  <span className="text-orange-600 transition-transform group-open:rotate-45 text-xl leading-none">+</span>
                </summary>
                <p className="mt-3 text-sm text-gray-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-12 md:py-16 bg-gradient-to-r from-orange-600 to-red-600 text-white">
        <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">Prêt à commencer ?</h2>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register?type=client" className="bg-white text-orange-600 hover:bg-gray-100 px-8 py-4 rounded-xl font-semibold transition">
              {t('lookingForServices')}
            </Link>
            <Link to="/register?type=worker" className="border-2 border-white text-white hover:bg-white hover:text-orange-600 px-8 py-4 rounded-xl font-semibold transition">
              {t('offerServices')}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
