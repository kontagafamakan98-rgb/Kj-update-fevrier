/**
 * CARTE « ALERTES EMPLOI » — le seul chemin de RETOUR du produit.
 *
 * Pourquoi elle existe. Un travailleur qui ouvre `/jobs` une fois n'avait plus
 * de raison de revenir : une mission publiée le lendemain ne le touchait que
 * s'il repassait de lui-même. Le backend résume désormais les nouvelles missions
 * aux veilles actives (`kojo_job_alerts.passage_digest`, boucle planifiée) ;
 * cette carte est le seul endroit où une veille s'active, se règle et se coupe
 * SANS passer par un lien d'email.
 *
 * Ce qu'elle ne décide pas : les critères proposés. La liste des catégories
 * vient de la page qui la monte (`categories`), c'est-à-dire de la même source
 * que les filtres de `/jobs` — deux listes divergeraient, et une veille sur une
 * catégorie que la page n'affiche pas ne se réglerait jamais. Le PAYS vient du
 * compte (`user.country`) : la veille suit le pays où la personne travaille,
 * pas une saisie libre qui enverrait des missions d'un autre marché.
 *
 * Ce qu'elle n'affiche pas : l'adresse email. Elle n'est pas une préférence
 * réglable — l'alerte écrit celle du compte, et le backend ne la rend jamais.
 */
import { useEffect, useState } from 'react';

import { CHAMP, CHAMP_SELECTEUR } from '../config/classes-champ';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../services/api';

const AlerteEmploi = ({ categories = [], pays = '' }) => {
  const { t } = useLanguage();
  const toast = useToast();

  const [etat, setEtat] = useState('chargement'); // chargement | pret | erreur
  const [alerte, setAlerte] = useState({ active: false, category: '', city: '' });
  const [categorie, setCategorie] = useState('');
  const [ville, setVille] = useState('');
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        const donnees = await api.get('/job-alerts');
        if (!vivant) return;
        setAlerte(donnees || { active: false });
        setCategorie((donnees && donnees.category) || '');
        setVille((donnees && donnees.city) || '');
        setEtat('pret');
      } catch (_error) {
        // La carte n'est pas la page : une lecture impossible laisse le
        // formulaire inerte et le DIT, au lieu de faire échouer `/jobs`.
        if (vivant) setEtat('erreur');
      }
    })();
    return () => {
      vivant = false;
    };
  }, []);

  const enregistrer = async (event) => {
    event.preventDefault();
    setEnvoi(true);
    try {
      const donnees = await api.put('/job-alerts', {
        category: categorie || null,
        city: ville.trim() || null,
        country: pays || null,
        active: true,
      });
      setAlerte(donnees || { active: true });
      setEtat('pret');
      toast.success(t('jobAlertSaved'));
    } catch (error) {
      toast.error((error && error.message) || t('jobAlertError'));
    } finally {
      setEnvoi(false);
    }
  };

  const couper = async () => {
    setEnvoi(true);
    try {
      const donnees = await api.delete('/job-alerts');
      setAlerte(donnees || { active: false });
      toast.success(t('jobAlertStopped'));
    } catch (error) {
      toast.error((error && error.message) || t('jobAlertError'));
    } finally {
      setEnvoi(false);
    }
  };

  if (etat === 'chargement') {
    // Même hauteur que la carte prête : la page ne saute pas quand la veille
    // arrive (règle anti-CLS du dépôt).
    return <div className="carte-publique carte-editoriale mb-6 h-36 animate-pulse" aria-busy="true" />;
  }

  if (etat === 'erreur') {
    return (
      <p className="carte-publique carte-editoriale mb-6 text-sm text-stone-600" role="status">
        {t('jobAlertUnavailable')}
      </p>
    );
  }

  return (
    <section className="carte-publique carte-editoriale mb-6" aria-labelledby="alerte-emploi-titre">
      <h2 id="alerte-emploi-titre" className="text-base font-semibold text-stone-900">
        {t('jobAlertTitle')}
      </h2>
      <p className="mt-1 text-sm text-stone-600">{t('jobAlertIntro')}</p>

      {alerte.active && (
        <p className="mt-2 text-sm font-medium text-emerald-700">{t('jobAlertActive')}</p>
      )}

      <form className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={enregistrer}>
        <div className="sm:w-48">
          <label htmlFor="alerte-categorie" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">
            {t('jobAlertCategory')}
          </label>
          <select
            id="alerte-categorie"
            value={categorie}
            onChange={(event) => setCategorie(event.target.value)}
            className={CHAMP_SELECTEUR}
          >
            <option value="">{t('allCategories')}</option>
            {categories
              .filter((candidat) => candidat && candidat.value)
              .map((candidat) => (
                <option key={candidat.value} value={candidat.value}>
                  {candidat.label}
                </option>
              ))}
          </select>
        </div>

        <div className="flex-1">
          <label htmlFor="alerte-ville" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">
            {t('jobAlertCity')}
          </label>
          <input
            id="alerte-ville"
            type="text"
            value={ville}
            onChange={(event) => setVille(event.target.value)}
            placeholder={t('jobAlertCityPlaceholder')}
            className={CHAMP}
          />
        </div>

        <button
          type="submit"
          disabled={envoi}
          className="rounded-lg bg-orange-700 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-orange-800 disabled:opacity-60"
        >
          {alerte.active ? t('jobAlertUpdate') : t('jobAlertSave')}
        </button>
        {alerte.active && (
          <button
            type="button"
            onClick={couper}
            disabled={envoi}
            className="rounded-lg border border-stone-300 px-4 py-2.5 font-semibold text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-60"
          >
            {t('jobAlertStop')}
          </button>
        )}
      </form>
    </section>
  );
};

export default AlerteEmploi;
