import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, Mail, MapPin, MessageCircle, Bot, ArrowLeft } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { usePageMeta } from '../utils/seo';
import TicketTracker from '../components/TicketTracker';
import RobotChat from '../components/RobotChat';
import { PAGE_SECTIONS } from '../config/page-sections';

// Tous les textes de cette page — et de ses deux composants — sont des CLÉS des
// dictionnaires existants du dépôt (src/i18n/*.json) : la page les résout au
// runtime, dans la langue de l'utilisateur, et la coquille pré-rendue les
// résout au build depuis src/i18n/fr.json. Le dictionnaire local de cinq langues
// qui vivait ici a été supprimé : il dupliquait ces cinq dictionnaires, et cinq
// de ses textes (ceux de la carte de suivi) étaient recopiés une troisième fois
// en français dans la coquille (vite-plugins/prerender-route-meta.js). Ce que
// src/config/page-sections.js déclare désormais, ce sont les CLÉS que /support
// publie — plus aucun texte.
//
// Les textes de validation vivent dans src/components/RobotChat.js et
// src/components/TicketTracker.js, qui les résolvent de la même façon.
//
// Le glyphe de chaque ligne de contact est, lui, côté PRODUIT : la coquille
// publie l'emoji du plan (`shellIconKey`, résolu par t() ici et par T() dans la
// coquille), un artefact pour un crawler sans JavaScript que le navigateur
// n'affiche jamais. Une ligne déclarée sans glyphe ici apparaît quand même, avec
// celui du plan — la liste des lignes n'a donc qu'un propriétaire,
// src/config/page-sections.js, et une cinquième ligne ajoutée là-bas ne peut
// plus manquer à cette page.
const GLYPHES = {
  contactCall: Phone,
  contactWhatsapp: MessageCircle,
  contactSendEmail: Mail,
  contactAddress: MapPin,
};

function DirectContactCard() {
  const { t } = useLanguage();
  const { directCard, rows } = PAGE_SECTIONS['/support'];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-1">{t(directCard.titleKey)}</h2>
      <p className="text-sm text-gray-500 mb-5">{t(directCard.subtitleKey)}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {rows.map((row) => {
          const Glyphe = GLYPHES[row.labelKey];
          const interieur = (
            <>
              <span className={`flex h-10 w-10 items-center justify-center rounded-full ${row.badgeClass}`}>
                {Glyphe ? <Glyphe size={18} /> : t(row.shellIconKey)}
              </span>
              <div>
                <div className="text-sm font-semibold text-gray-900">{t(row.labelKey)}</div>
                <div className={`text-xs text-gray-500${row.breakAll ? ' break-all' : ''}`}>
                  {row.value}
                </div>
              </div>
            </>
          );

          return row.href ? (
            <a
              key={row.labelKey}
              href={row.href}
              {...(row.external ? { target: '_blank', rel: 'noreferrer' } : {})}
              className={row.rowClass}
            >
              {interieur}
            </a>
          ) : (
            <div key={row.labelKey} className={row.rowClass}>
              {interieur}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const Support = () => {
  const { t } = useLanguage();
  usePageMeta();
  const [mode, setMode] = useState(null); // null | 'robot' | 'direct'
  const { titleKey, subtitleKey } = PAGE_SECTIONS['/support'];

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{t(titleKey)}</h1>
        <p className="text-gray-600">{t(subtitleKey)}</p>
      </div>

      <TicketTracker />

      {mode === null && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <button
            onClick={() => setMode('robot')}
            className="flex flex-col items-center gap-3 rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm hover:border-orange-300 hover:shadow-md transition-all"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-100 text-orange-600"><Bot size={24} /></span>
            <span className="font-semibold text-gray-900">{t('supportRobotTitle')}</span>
            <span className="text-xs text-gray-500">{t('supportRobotSubtitle')}</span>
          </button>
          <button
            onClick={() => setMode('direct')}
            className="flex flex-col items-center gap-3 rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm hover:border-orange-300 hover:shadow-md transition-all"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><Phone size={24} /></span>
            <span className="font-semibold text-gray-900">{t('supportDirectTitle')}</span>
            <span className="text-xs text-gray-500">{t('supportDirectSubtitle')}</span>
          </button>
        </div>
      )}

      {mode === 'robot' && (
        <div className="mb-6">
          <RobotChat onBack={() => setMode(null)} />
        </div>
      )}

      {mode === 'direct' && (
        <div className="mb-4">
          <button onClick={() => setMode(null)} className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft size={16} /> {t('supportBack')}
          </button>
        </div>
      )}

      <DirectContactCard />

      {/* Maillage interne : le support mène au fonctionnement du service et à
          la liste des missions. Le shell statique (vite.config.js) rend
          EXACTEMENT ce bloc — sinon la ligne disparaîtrait au montage React. */}
      <p className="mt-6 text-center text-sm text-gray-500">
        <Link to="/how-it-works" className="text-orange-600 underline underline-offset-2">
          {t('howItWorksTitle')}
        </Link>
        {' · '}
        <Link to="/jobs" className="text-orange-600 underline underline-offset-2">
          {t('viewJobs')}
        </Link>
      </p>
    </div>
  );
};

export default Support;
