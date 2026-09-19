import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { usePageMeta } from '../utils/seo';
import { CONTACT, mailtoHref, telHref } from '../config/contact';

/**
 * Page « Nous contacter ».
 *
 * « Contact » renvoyait à /support — une page de SUIVI de ticket, pas une page
 * de contact : un crawler (et un visiteur pressé) n'y trouvait ni adresse, ni
 * téléphone en clair, ni moyen d'écrire à l'éditeur du site. Les coordonnées
 * publiées ici viennent de src/config/contact.json, la même source que le pied
 * de page, la page Support et le LocalBusiness : le site ne peut pas publier
 * deux adresses différentes.
 */
export default function Contact() {
  const { t } = useLanguage();
  usePageMeta();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{t('contactTitle')}</h1>
        <p className="text-gray-600 mb-3">{t('contactIntro')}</p>
        <p className="text-sm text-gray-500 mb-6">{t('contactHelpText')}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a
            href={telHref}
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-orange-600">📞</span>
            <div>
              <div className="text-sm font-semibold text-gray-900">Appeler</div>
              <div className="text-xs text-gray-500">{CONTACT.phoneDisplay}</div>
            </div>
          </a>
          <a
            href={CONTACT.whatsappUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">💬</span>
            <div>
              <div className="text-sm font-semibold text-gray-900">WhatsApp</div>
              <div className="text-xs text-gray-500">{CONTACT.phoneDisplay}</div>
            </div>
          </a>
          <a
            href={mailtoHref}
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600">✉️</span>
            <div>
              <div className="text-sm font-semibold text-gray-900">Envoyer un e-mail</div>
              <div className="text-xs text-gray-500 break-all">{CONTACT.email}</div>
            </div>
          </a>
          {/* La fiche Google (adresse + itinéraire) est le lien de présence
              locale : c'est elle qu'un audit « Google Business Profile »
              cherche sur une page de contact. */}
          <a
            href={CONTACT.mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600">📍</span>
            <div>
              <div className="text-sm font-semibold text-gray-900">Adresse</div>
              <div className="text-xs text-gray-500">{CONTACT.address}</div>
            </div>
          </a>
        </div>

        <iframe
          src={CONTACT.mapsEmbedUrl}
          title={`Carte — Kojo, ${CONTACT.address}`}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="mt-6 w-full rounded-xl border border-gray-200"
          style={{ height: 320, border: 0 }}
        />

        <p className="mt-6 text-sm text-gray-500">
          <Link to="/about" className="text-orange-600 underline underline-offset-2">
            {t('aboutTitle')}
          </Link>
          {' · '}
          <Link to="/privacy" className="text-orange-600 underline underline-offset-2">
            {t('privacyTitle')}
          </Link>
          {' · '}
          <Link to="/support" className="text-orange-600 underline underline-offset-2">
            {t('support')}
          </Link>
        </p>
      </div>
    </div>
  );
}
