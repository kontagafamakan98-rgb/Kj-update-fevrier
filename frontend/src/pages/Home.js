import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { getAllCountries } from '../components/CountryDisplay';
import FlagIcon from '../components/FlagIcon';
import { usePageMeta } from '../utils/seo';
import { publicAPI } from '../services/apiEndpoints';
import { safeLog } from '../utils/env';
// Le corps de l'accueil (catégories, promesses, étapes) est DÉCLARÉ une fois :
// src/config/page-sections.js, que le build lit pour écrire la coquille
// pré-rendue. Ce composant en DÉRIVE au lieu de tenir sa propre liste.
import { PAGE_SECTIONS } from '../config/page-sections';
import { CONTACT, SOCIAL_LINKS, mailtoHref, telHref } from '../config/contact';
import MapEmbed from '../components/MapEmbed';

export default function Home() {
  const { t } = useLanguage();
  const { user } = useAuth();
  usePageMeta();

  // Chiffres réels depuis /public/stats (repli sur des valeurs génériques
  // si l'appel échoue, pour ne jamais bloquer l'affichage de la landing).
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let cancelled = false;
    publicAPI.getStats()
      .then((data) => { if (!cancelled) setStats(data); })
      .catch((err) => { safeLog.error('Stats load error', err); });
    return () => { cancelled = true; };
  }, []);

  // Catégories, promesses, étapes et chiffres : lus dans la déclaration du
  // corps de la page (src/config/page-sections.js) — la MÊME que le build
  // utilise pour écrire la coquille pré-rendue. Recopiées ici, elles pouvaient
  // diverger : une promesse ajoutée à la page ne paraissait pas pour un crawler
  // sans JavaScript, et rien ne rougissait. `labelKey` est aussi le code de
  // catégorie canonique du backend (kojo_routers_jobs.py) : le libellé affiché
  // et le filtre de /jobs sortent de la même valeur.
  const {
    categories, promises, steps, stats: STATS, escrowIconKey,
    // Le héros : même clé i18n et mêmes classes que la coquille pré-rendue
    // (src/config/page-sections.js). Le titre de ce héros est l'élément LCP de
    // « / » : la coquille le peint avant le JavaScript, et React reconstruit
    // ensuite EXACTEMENT la même boîte — c'est cette égalité qui fait que
    // Chrome garde pour LCP la peinture de la coquille au lieu d'en enregistrer
    // une seconde, plus tardive, déclenchée par le JavaScript.
    titleKey: heroTitleKey,
    subtitleKey: heroSubtitleKey,
    heroTitleClass,
    heroSubtitleClass,
  } = PAGE_SECTIONS['/'];

  // La FAÇADE de la carte : le MÊME contrôle que /contact, lu dans la MÊME
  // déclaration (les classes, le libellé et le glyphe de la carte n'ont qu'un
  // propriétaire, comme les glyphes du bloc de contact plus bas, qui viennent
  // déjà des `actions` de /contact). L'accueil publiait l'iframe
  // `output=embed` en `loading="lazy"` : mesuré (Lighthouse 12.6.1, pile de la
  // CI, Chrome 152), `loading="lazy"` n'empêche rien — le navigateur charge une
  // iframe dès qu'elle approche du viewport, et sur desktop elle y est déjà. Le
  // premier écran tire alors ~300 Ko de tiers et le LCP de la page (une de NOS
  // peintures) est repoussé, l'`elementRenderDelay` entrant dans le graphe LCP
  // simulé de Lantern. Le contrôle ci-dessous ne monte l'iframe qu'à l'appui.
  const {
    mapButtonKey, mapIconKey, mapFrameClass, mapControlClass,
  } = PAGE_SECTIONS['/contact'];

  // Le titre de l'iframe montée à l'appui (même clé que /contact).
  const titreDeLaCarte = t('mapIframeTitle').replace('{address}', CONTACT.address);

  // Lecture des chiffres par clé de libellé : `fallback` est la valeur affichée
  // avant /public/stats, `suffix` la marque qui suit le chiffre. Aucune seconde
  // liste — la déclaration est lue telle quelle. Déclaré AVANT les trois
  // `statX` ci-dessous, qui le lisent.
  const STAT = Object.fromEntries(STATS.map((stat) => [stat.labelKey, stat]));

  const statWorkers = stats?.workers != null ? stats.workers : STAT.activeWorkers.fallback;
  const statCompleted = stats?.completed_jobs != null ? stats.completed_jobs : STAT.completedProjects.fallback;
  const statCountries = stats?.countries != null ? stats.countries : STAT.countriesCovered.fallback;

  // Les pays : la liste ET la couleur de carte viennent du référentiel partagé
  // (src/config/countries.js), que le build lit aussi pour écrire la coquille.
  const countries = getAllCountries();

  return (
    <div className="min-h-screen">
      {/* Hero Section - Mobile Optimized */}
      <section className="bg-gradient-to-br from-orange-600 via-orange-700 to-red-600 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-black bg-opacity-10"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 md:py-24">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 text-xs sm:text-sm font-medium text-white ring-1 ring-inset ring-white/25 mb-6">
              <span aria-hidden="true">{t('iconEscrow')}</span>
              {t('escrowBannerTitle')}
            </span>
            <h1 className={heroTitleClass}>
              {t(heroTitleKey)}
            </h1>
            <p className={heroSubtitleClass}>
              {t(heroSubtitleKey)}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              {!user ? (
                <>
                  <Link 
                    to="/register"
                    className="w-full sm:w-auto bg-white text-orange-600 hover:bg-orange-50 px-8 py-4 rounded-xl font-semibold text-lg shadow-xl transform transition hover:-translate-y-0.5"
                  >
                    {t('getStarted')}
                  </Link>
                  <Link 
                    to="/jobs"
                    className="w-full sm:w-auto border-2 border-white text-white hover:bg-white hover:text-orange-600 px-8 py-4 rounded-xl font-semibold text-lg transition"
                  >
                    {t('viewJobs')}
                  </Link>
                </>
              ) : (
                <Link 
                  to="/dashboard"
                  className="w-full sm:w-auto bg-white text-orange-600 hover:bg-orange-50 px-8 py-4 rounded-xl font-semibold text-lg shadow-xl transform transition hover:-translate-y-0.5"
                >
                  {t('myDashboard')}
                </Link>
              )}
            </div>

            {/* Bandeau de confiance : trois repères qui répondent aux deux
                questions d'un visiteur qui hésite (l'argent est-il protégé ?
                comment ça marche ?). Textes et glyphes viennent du dictionnaire,
                comme le reste de l'accueil. */}
            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-white/90">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true">{t('iconEscrow')}</span>
                {t('escrowTrustTitle')}
              </span>
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true">{t('iconPromiseSecurePayments')}</span>
                {t('securePayments')}
              </span>
              <Link
                to="/how-it-works"
                className="font-semibold text-white underline underline-offset-4 hover:text-orange-100"
              >
                {t('howItWorksLink')}
              </Link>
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
              {t('availableIn4Countries')}
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              {t('kojoConnectsDescription')}
            </p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
            {countries.map((country, index) => (
              /* Carte informative : ni curseur main ni effet de survol — ces
                 cartes ne sont pas cliquables, et le laisser croire coûte plus
                 qu'il ne rapporte. */
              <div
                key={index}
                className={`${country.color} rounded-2xl p-6 text-center shadow-md ring-1 ring-inset ring-black/5`}
              >
                <div className="flex justify-center mb-3">
                  <FlagIcon country={country.code} className="w-14 h-10 md:w-20 md:h-14" showEmoji={false} />
                </div>
                <h3 className="font-semibold text-gray-900 text-sm md:text-base">{country.name}</h3>
                <p className="text-xs text-gray-600 mt-1">{t('servicesAvailable')}</p>
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
              {t('popularServices')}
            </h2>
            <p className="text-gray-600">
              {t('findServiceYouNeed')}
            </p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-6">
            {categories.map((category) => (
              <Link
                key={category.labelKey}
                to={`/jobs?category=${category.labelKey}`}
                className="group bg-white rounded-2xl shadow-md ring-1 ring-inset ring-black/5 p-6 text-center transition hover:shadow-lg hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              >
                <div
                  className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-orange-50 text-3xl md:text-4xl transition group-hover:scale-110"
                  aria-hidden="true"
                >
                  {t(category.iconKey)}
                </div>
                <h3 className="font-medium text-gray-900 text-sm md:text-base">{t(category.labelKey)}</h3>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section - Mobile First */}
      <section className="py-12 md:py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {promises.map(({ iconKey, titleKey, descriptionKey }) => (
              <div
                key={titleKey}
                className="rounded-2xl border border-gray-100 bg-gray-50/60 p-6 text-center shadow-sm transition hover:shadow-md hover:bg-white"
              >
                <div className="bg-orange-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                  <span className="text-2xl" aria-hidden="true">{t(iconKey)}</span>
                </div>
                <h3 className="text-xl font-semibold mb-4 text-gray-900">{t(titleKey)}</h3>
                <p className="text-gray-600">
                  {t(descriptionKey)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comment ça marche - Mobile First */}
      <section className="py-12 md:py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4">{t('howItWorksTitle')}</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              {t('homeHowItWorksSubtitle')}
            </p>
          </div>

          {/* Les trois étapes sont NUMÉROTÉES (1 → 2 → 3) : c'est ce qui en
              fait une marche à suivre plutôt qu'une liste de promesses. Le
              numéro vient du dictionnaire (stepNumber1…), comme sa pastille,
              donc les deux canaux publient le même chiffre. */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {steps.map(({ iconKey, numberKey, titleKey, descriptionKey }) => (
              <div
                key={titleKey}
                className="relative bg-white rounded-2xl shadow-md ring-1 ring-inset ring-black/5 p-6 pt-8 text-center"
              >
                <span className="absolute -top-4 left-1/2 -translate-x-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-orange-600 text-sm font-bold text-white shadow-md">
                  {t(numberKey)}
                </span>
                <div className="bg-orange-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl" aria-hidden="true">{t(iconKey)}</span>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">{t(titleKey)}</h3>
                <p className="text-gray-600 text-sm">
                  {t(descriptionKey)}
                </p>
              </div>            ))}
          </div>
        </div>
      </section>

      {/* Escrow Trust - Mobile First */}
      <section className="py-12 md:py-16 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl border-2 border-emerald-200 bg-emerald-50 p-8 md:p-10 shadow-sm">
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="text-5xl" aria-hidden="true">{t(escrowIconKey)}</div>
              <div className="text-center md:text-left">
                <h2 className="text-2xl md:text-3xl font-bold text-emerald-900 mb-3">{t('escrowTrustTitle')}</h2>
                <p className="text-emerald-800">
                  {t('escrowTrustText')}
                </p>
                <p className="text-emerald-700 mt-3 text-sm">
                  {t('escrowTrustBullets')}
                </p>
                <Link
                  to="/how-it-works"
                  className="mt-4 inline-block rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  {t('learnMore')}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Call to Action - Mobile Optimized */}
      <section className="py-12 md:py-16 bg-gradient-to-r from-orange-600 to-red-600 text-white">
        <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-6">
            {t('joinThousands')}
          </h2>
          <p className="text-lg md:text-xl mb-8 opacity-90">
            {t('startConnectingToday')}
          </p>
          
          {!user && (
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link 
                to="/register?type=client"
                className="bg-white text-orange-600 hover:bg-orange-50 px-8 py-4 rounded-xl font-semibold shadow-xl transform transition hover:-translate-y-0.5"
              >
                {t('lookingForServices')}
              </Link>
              <Link 
                to="/register?type=worker"
                className="border-2 border-white text-white hover:bg-white hover:text-orange-600 px-8 py-4 rounded-xl font-semibold transition"
              >
                {t('offerServices')}
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Stats Section - Mobile Friendly */}
      <section className="py-12 md:py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8 text-center rounded-2xl bg-white p-8 shadow-md ring-1 ring-inset ring-black/5">
            <div>
              <div className="text-3xl md:text-4xl font-bold text-orange-600 mb-2">{statWorkers.toLocaleString()}{STAT.activeWorkers.suffix}</div>
              <div className="text-sm md:text-base text-gray-600">{t(STAT.activeWorkers.labelKey)}</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-bold text-orange-600 mb-2">{statCompleted.toLocaleString()}{STAT.completedProjects.suffix}</div>
              <div className="text-sm md:text-base text-gray-600">{t(STAT.completedProjects.labelKey)}</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-bold text-orange-600 mb-2">{statCountries}</div>
              <div className="text-sm md:text-base text-gray-600">{t(STAT.countriesCovered.labelKey)}</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-bold text-orange-600 mb-2">{STAT.customerSupport.fallback}</div>
              <div className="text-sm md:text-base text-gray-600">{t(STAT.customerSupport.labelKey)}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Qui sommes-nous : le contenu de fond de l'accueil. Un audit de
          référencement reprochait à la page d'accueil ses 401 mots — un moteur
          n'y trouvait pas de quoi comprendre qui édite le site. Le même bloc
          est rendu par la coquille statique (vite.config.js), avec les mêmes
          clés i18n : un crawler sans JavaScript le lit aussi. */}
      <section className="py-12 md:py-16 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4">{t('homeAboutTitle')}</h2>
          <p className="text-gray-600 mb-4">{t('homeAboutText1')}</p>
          <p className="text-gray-600">{t('homeAboutText2')}</p>
          <p className="mt-6 text-sm">
            <Link to="/about" className="text-orange-600 underline underline-offset-2">
              {t('aboutTitle')}
            </Link>
            {' · '}
            <Link to="/contact" className="text-orange-600 underline underline-offset-2">
              {t('contactTitle')}
            </Link>
            {' · '}
            <Link to="/privacy" className="text-orange-600 underline underline-offset-2">
              {t('privacyTitle')}
            </Link>
          </p>
        </div>
      </section>

      {/* Contact (N.A.P. + liens cliquables + Google Maps) : section réelle,
          identique à la coquille statique de l'accueil pour le SEO local et
          l'accessibilité en un appui sur mobile. */}
      <section className="py-12 md:py-16 bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4">{t('contactTitle')}</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">{t('homeContactText')}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl mx-auto">
            <a href={telHref} className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-orange-600">
                {t('iconContactCall')}
              </span>
              <div>
                <div className="text-sm font-semibold text-gray-900">{t('homeContactCall')}</div>
                <div className="text-xs text-gray-500">{CONTACT.phoneDisplay}</div>
              </div>
            </a>
            <a href={CONTACT.whatsappUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                {t('iconContactWhatsapp')}
              </span>
              <div>
                <div className="text-sm font-semibold text-gray-900">{t('contactWhatsapp')}</div>
                <div className="text-xs text-gray-500">{CONTACT.phoneDisplay}</div>
              </div>
            </a>
            <a href={mailtoHref} className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                {t('iconContactSendEmail')}
              </span>
              <div>
                <div className="text-sm font-semibold text-gray-900">{t('contactSendEmail')}</div>
                <div className="text-xs text-gray-500 break-all">{CONTACT.email}</div>
              </div>
            </a>
            <a
              href={CONTACT.mapsUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Google Maps"
              title="Google Maps"
              className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                {t('iconContactAddress')}
              </span>
              <div>
                <div className="text-sm font-semibold text-gray-900">{t('contactAddress')}</div>
                <div className="text-xs text-gray-500">{CONTACT.address}</div>
              </div>
            </a>
          </div>

          {SOCIAL_LINKS.length > 0 && (
            <div className="mt-8 rounded-2xl border border-gray-200 bg-gray-50 p-6 text-center">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">{t('homeContactFollow')}</h3>
              <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-orange-700">
                {SOCIAL_LINKS.map((social) => (
                  <a
                    key={social.key}
                    href={social.url}
                    target="_blank"
                    rel="me noreferrer"
                    className="font-medium hover:text-orange-800 underline underline-offset-2"
                  >
                    {social.label}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* La carte : un CONTRÔLE d'abord, l'iframe à l'appui — le MÊME
              composant et les MÊMES classes que /contact, lues dans la même
              déclaration. Le feu vert d'un audit « carte intégrée » est
              préservé (le contrôle mène à la fiche Google, et l'iframe
              `output=embed` est montée à l'appui), mais aucun octet tiers
              n'entre plus dans le premier écran ni dans le LCP de l'accueil. */}
          <MapEmbed
            src={CONTACT.mapsEmbedUrl}
            href={CONTACT.mapsUrl}
            title={titreDeLaCarte}
            label={t(mapButtonKey)}
            icon={t(mapIconKey)}
            frameClass={mapFrameClass}
            controlClass={mapControlClass}
          />
        </div>
      </section>
    </div>
  );
}