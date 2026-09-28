import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { usePageMeta } from '../utils/seo';
import TicketTracker from '../components/TicketTracker';
import RobotChat from '../components/RobotChat';
import { PAGE_SECTIONS } from '../config/page-sections';
import { IconePage, CLASSES_ICONE } from '../config/page-icons';

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
// Le glyphe de chaque ligne de contact est une icône DESSINÉE
// (src/config/page-icons.js), déclarée par le plan (`icone`) : la page et la
// coquille publiaient autrefois DEUX dessins différents — un composant lucide
// ici, l'emoji de la clé `iconContact*` là-bas. La liste des lignes n'a qu'un
// propriétaire, src/config/page-sections.js, et une cinquième ligne ajoutée
// là-bas ne peut plus manquer à cette page.

function DirectContactCard() {
  const { t } = useLanguage();
  // Le vocabulaire éditorial de la carte et de ses lignes est DÉCLARÉ dans le
  // plan : /contact lit les mêmes chaînes pour les mêmes quatre moyens de
  // contact, donc les deux pages ne peuvent pas s'habiller différemment.
  const {
    directCard, rows, carteClass, titreEntreeClass,
    listeContactClass, pastilleContactClass, etiquetteContactClass, valeurContactClass,
  } = PAGE_SECTIONS['/support'];

  return (
    <div className={carteClass}>
      <h2 className={`${titreEntreeClass} mb-1`}>{t(directCard.titleKey)}</h2>
      <p className="text-sm text-stone-500 mb-5">{t(directCard.subtitleKey)}</p>

      <div className={listeContactClass}>
        {rows.map((row) => {
          const interieur = (
            <>
              <span className={pastilleContactClass}>
                <IconePage nom={row.icone} classe={CLASSES_ICONE.ligne} />
              </span>
              <span>
                <span className={etiquetteContactClass}>{t(row.labelKey)}</span>
                <span className={`${valeurContactClass}${row.breakAll ? ' break-all' : ''}`}>
                  {row.value}
                </span>
              </span>
              {/* La flèche n'est peinte que si la ligne mène quelque part :
                  l'adresse postale n'a pas de destination, donc pas de
                  promesse. La condition est la MÊME dans la coquille. */}
              {row.href && <IconePage nom="flecheDroite" classe={CLASSES_ICONE.flecheLigne} />}
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
  const {
    titleKey, subtitleKey, subtitleClass, frameClass, modes, carteModeClass, pastilleModeClass,
    titreEntreeClass,
  } = PAGE_SECTIONS['/support'];

  return (
    <div className={frameClass}>
      <div className="mb-6 text-center">
        <h1 className="titre-page mb-2">{t(titleKey)}</h1>
        <p className={subtitleClass}>{t(subtitleKey)}</p>
      </div>

      <TicketTracker />

      {mode === null && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {modes.map((modeDuPlan, index) => (
            <button
              key={modeDuPlan.titleKey}
              // L'état ouvert par chaque carte : l'ordre du plan (robot, direct)
              // est celui que la coquille publie, donc les deux canaux peignent
              // les deux mêmes cartes dans le même ordre.
              onClick={() => setMode(index === 0 ? 'robot' : 'direct')}
              // Le survol d'une carte cliquable est porté par la classe
              // (`carte-editoriale-cliquable`), donc les deux canaux écrivent la
              // MÊME chaîne : la coquille n'a plus à reproduire un `hover:` de
              // React, qui ne se voyait qu'au pointeur de toute façon.
              className={carteModeClass}
            >
              <span className={pastilleModeClass}>
                <IconePage nom={modeDuPlan.icone} classe={CLASSES_ICONE.mode} />
              </span>
              <span className={titreEntreeClass}>{t(modeDuPlan.titleKey)}</span>
              <span className="text-xs text-stone-500">{t(modeDuPlan.subtitleKey)}</span>
            </button>
          ))}
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
      <p className="mt-6 text-center text-sm text-stone-500">
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
