import { IconePage } from '../config/page-icons';
import { useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
// Le lien interne AVEC la transition de vue native (components/LienVue.js).
import Link from '../components/LienVue';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import LoadingButton from '../components/LoadingButton';
import GoogleButton from '../components/GoogleButton';
import { isGoogleAuthEnabled } from '../utils/googleAuth';
import { clearRegistrationFlow } from '../utils/registrationFlowStorage';
import { makeScopedTranslator } from '../utils/pack2PageI18n/register';
import { usePageMeta } from '../utils/seo';
import { PAGE_SECTIONS } from '../config/page-sections';
import { MarqueKojo } from '../config/marque-kojo';

// ── CE QUI ENVOIE UN COMPTE VERS /payment-verification (20/10/2026) ────────
// La VÉRIFICATION EMAIL, et elle seule. Les comptes de paiement ne servent
// qu'au premier versement / premier paiement : les exiger à la connexion
// faisait passer un travailleur par DEUX comptes avant d'ouvrir son tableau de
// bord, pour un argent qu'il n'avait pas encore à recevoir. L'argent reste
// protégé : le backend refuse un décaissement sans compte. La règle est la
// même que celle de `ProtectedRoute` (App.js) — deux règles pour un même état
// finiraient par diverger.
const requiresRegistrationCompletion = (user) => {
  if (!user) return false;

  // `email_verified`, PAS `is_verified` : c'est le champ que lit la même porte
  // côté route protégée (`ProtectedRoute`, App.js). `is_verified` dit « le
  // minimum de comptes de paiement est atteint », or une inscription aboutit
  // SANS compte de paiement depuis le 22/10/2026 : juger sur lui renvoyait à
  // l'écran de paiement un compte parfaitement valide, à la connexion même.
  return !user.email_verified;
};

export default function Login() {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState('');
  const [loading, setLoading] = useState(false);

  const { login, loginWithGoogle } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const toast = useToast();
  const navigate = useNavigate();
  const forgotPasswordLabel = t('forgotPasswordLink');

  usePageMeta();
  const displayedError = useMemo(() => (errorKey ? t(errorKey) : error), [error, errorKey, t]);
  const pageT = makeScopedTranslator(currentLanguage, t);
  const pagePlan = PAGE_SECTIONS['/login'];
  const legalDocumentUrl = '/terms';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setErrorKey('');

    const result = await login(formData.email, formData.password);

    if (result.success) {
      clearRegistrationFlow();
      if (requiresRegistrationCompletion(result.user)) {
        toast.success(pageT('onboardingNotice'));
        navigate('/payment-verification', {
          state: {
            userData: result.user,
            resumeAfterLogin: true
          }
        });
      } else {
        toast.success(t('loginSuccess'));
        navigate('/dashboard');
      }
    } else {
      setError(result.error || t('loginFailed'));
      setErrorKey(result.errorKey || '');

      if (result.errorKey) {
        toast.error({ messageKey: result.errorKey });
      } else {
        toast.error(result.error || t('loginFailed'));
      }
    }

    setLoading(false);
  };

  const handleChange = (e) => {
    if (error) {
      setError('');
      setErrorKey('');
    }

    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const handleGoogle = async () => {
    setError('');
    setErrorKey('');
    const result = await loginWithGoogle();
    if (result.success) {
      clearRegistrationFlow();
      if (requiresRegistrationCompletion(result.user)) {
        toast.success(pageT('onboardingNotice'));
        navigate('/payment-verification', {
          state: {
            userData: result.user,
            resumeAfterLogin: true,
            fromGoogle: true,
          }
        });
      } else {
        toast.success(t('loginSuccess'));
        navigate('/dashboard');
      }
      return;
    }
    if (result.cancelled) return; // l'utilisateur a fermé la popup Google
    if (result.emailExists) {
      // Un compte existe déjà avec cet email : inviter à se connecter puis
      // lier Google depuis le profil (fusion sécurisée).
      setError(pageT('googleEmailExists'));
      return;
    }
    setError(result.error || t('loginFailed'));
    toast.error(result.error || t('loginFailed'));
  };

  return (
    <div className={pagePlan.frameClass}>
      <div className={pagePlan.colonneClass}>
        {/* La CARTE du formulaire (17/10/2026) : /login était la seule page
            publique sans carte, un formulaire nu posé sur le sable. La classe
            est déclarée dans le plan et publiée par la coquille, donc la
            bascule coquille → React ne change ni le fond ni le filet. */}
        <div className={pagePlan.carteClass}>
        <div>
          {/* La marque : un tracé partagé, pas la lettre « K » du dictionnaire
              (voir src/config/marque-kojo.js). Même pastille, même boîte. */}
          <MarqueKojo emplacement="entete" />
          {/* Titre de PAGE en h1 (et non h2) : un audit SEO exige un h1 unique
              par page, et un crawler qui exécute le JavaScript doit voir le même
              niveau que le shell statique pré-rendu (login.html). Les classes
              Tailwind sont identiques à celles d'origine — le rendu ne change
              pas, seule la sémantique est corrigée. */}
          <h1 className={pagePlan.titleClass}>
            {t(pagePlan.titleKey)}
          </h1>
        </div>

        <form className={pagePlan.formClass} onSubmit={handleSubmit}>
          {displayedError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {displayedError}
            </div>
          )}

          {/* ── LES RÉSEAUX D'ABORD (28/09/2026) ─────────────────────────────
              Le bouton Google vivait SOUS le formulaire : pour trouver le chemin
              le plus court, un visiteur devait d'abord traverser deux champs et
              un bouton. C'est l'INVERSE de /register, qui place le même bouton
              avant ses champs avec le même séparateur (`orSeparator`) — deux
              pages de compte, deux ordres, pour la même décision.

              Le séparateur coupe la ligne derrière son libellé avec SA propre
              pastille. Depuis la carte du formulaire (17/10/2026, `carteClass`
              du plan), cette pastille est posée sur la crème translucide de
              la carte et non sur le sable : l'écart avec un blanc pur est de
              3/255, donc invisible, et c'est la CARTE qui décide du contraste
              — la surface la plus sombre des deux. */}
          {isGoogleAuthEnabled() && (
            <>
              <GoogleButton onClick={handleGoogle} label={pageT(pagePlan.googleLoginKey)} />

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-sm">
                  {/* stone-500 et non stone-400 : le séparateur « ou » est du
                      TEXTE, et stone-400 n'atteint pas le 4,5:1 du seuil AA
                      (mesuré par Lighthouse sur /register, où le même
                      séparateur était en gray-400 : 2,54:1). stone-500 tient
                      4,80:1 sur la pastille et 4,56:1 sur la carte — la marge
                      est mince, donc elle est MESURÉE par Login.test.jsx sur
                      les deux surfaces, jamais supposée. */}
                  <span className="bg-white px-3 text-sm text-stone-500">{t('orSeparator') || 'ou'}</span>
                </div>
              </div>
            </>
          )}

          <div className={pagePlan.champsClass}>
            <div>
              <label htmlFor="email" className={pagePlan.labelClass}>
                {t(pagePlan.emailLabelKey)}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className={pagePlan.champClass}
                placeholder={t(pagePlan.emailLabelKey)}
                value={formData.email}
                onChange={handleChange}
              />
            </div>

            <div>
              <div className={pagePlan.ligneMotDePasseClass}>
                <label htmlFor="password" className={pagePlan.labelClass}>
                  {t(pagePlan.passwordLabelKey)}
                </label>
                <Link to="/forgot-password" className={pagePlan.lienMotDePasseClass}>
                  {forgotPasswordLabel}
                </Link>
              </div>
              <div className="relative mt-1">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  className={pagePlan.champMotDePasseClass}
                  placeholder={t(pagePlan.passwordLabelKey)}
                  value={formData.password}
                  onChange={handleChange}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-stone-400 hover:text-stone-700"
                  aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
          </div>

          <div>
            <LoadingButton
              type="submit"
              loading={loading}
              className={pagePlan.boutonClass}
            >
              {t(pagePlan.titleKey)}
            </LoadingButton>
          </div>

          <div className={pagePlan.encadreLegalClass}>
            <p className={pagePlan.legalNoticeClass}><IconePage nom={pagePlan.legalNoticeIcon} role="notice" /> {pageT(pagePlan.legalNoticeTitleKey)}</p>
            <a
              href={legalDocumentUrl}
              className={pagePlan.legalLienClass}
            >
              {pageT(pagePlan.legalConsentLinkKey)}
            </a>
            <p className={pagePlan.legalContactClass}>{pageT(pagePlan.legalContactLineKey)}</p>
          </div>

          <div className={pagePlan.noAccountClass}>
            <span className={pagePlan.noAccountTexteClass}>
              {t(pagePlan.noAccountKey)}{' '}
              <Link to="/register" className={pagePlan.lienInscriptionClass}>
                {t(pagePlan.registerKey)}
              </Link>
            </span>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}
