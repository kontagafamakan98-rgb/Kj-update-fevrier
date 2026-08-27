import { useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import LoadingButton from '../components/LoadingButton';
import GoogleButton from '../components/GoogleButton';
import { clearRegistrationFlow } from '../utils/registrationFlowStorage';
import { makeScopedTranslator } from '../utils/pack2PageI18n/register';
import { usePageTitle, usePageOpenGraph, ogImageUrl } from '../utils/seo';

const requiresRegistrationCompletion = (user) => {
  if (!user) return false;

  const minimumRequired = user?.user_type === 'worker' ? 2 : 1;
  return !user.is_verified || Number(user.payment_accounts_count || 0) < minimumRequired;
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
  const forgotPasswordLabelMap = {
    fr: 'Mot de passe oublié ?',
    en: 'Forgot password?',
    wo: 'Fàtte nga sa baatu jàll ?',
    bm: 'I ye mot de passe ɲinɛna wa ?',
    mos: 'Fo ye mot de passe wã yɩɩda ye?'
  };
  const forgotPasswordLabel = forgotPasswordLabelMap[currentLanguage] || forgotPasswordLabelMap.fr;

  // SEO / OG par route : la page login a son propre titre, description et
  // image de partage (og-login.png) — distincts de l'accueil.
  usePageTitle(t('loginMetaTitle'));
  usePageOpenGraph({
    title: t('loginMetaTitle'),
    description: t('loginMetaDescription'),
    image: ogImageUrl('/og-login.png'),
  });
  const displayedError = useMemo(() => (errorKey ? t(errorKey) : error), [error, errorKey, t]);
  const pageT = makeScopedTranslator(currentLanguage, t);
  const legalDocumentUrl = '/legal/kojo_politique_confidentialite_et_cgu_fusionnees.docx';

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
        toast.success(t('loginSuccess') + ' 🎉');
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
        toast.success(t('loginSuccess') + ' 🎉');
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
    <div className="min-h-full flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-orange-600">
            <span className="text-white text-xl font-bold">K</span>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            {t('login')}
          </h2>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {displayedError && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">
              {displayedError}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                {t('email')}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500 focus:z-10 sm:text-sm"
                placeholder={t('email')}
                value={formData.email}
                onChange={handleChange}
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  {t('password')}
                </label>
                <Link to="/forgot-password" className="text-sm font-medium text-orange-600 hover:text-orange-500">
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
                  className="appearance-none relative block w-full px-3 py-2 pr-10 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500 focus:z-10 sm:text-sm"
                  placeholder={t('password')}
                  value={formData.password}
                  onChange={handleChange}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
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
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50"
            >
              {t('login')}
            </LoadingButton>
          </div>

          <GoogleButton onClick={handleGoogle} label={pageT('googleLogin')} />

          <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-2">
            <p className="text-sm font-semibold text-orange-900">📜 {pageT('legalNoticeTitle')}</p>
            <a
              href={legalDocumentUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center text-sm font-medium text-orange-700 hover:text-orange-800 underline"
            >
              {pageT('legalConsentLink')}
            </a>
            <p className="text-xs text-gray-600">{pageT('legalContactLine')}</p>
          </div>

          <div className="text-center">
            <span className="text-sm text-gray-600">
              {t('noAccount')}{' '}
              <Link to="/register" className="font-medium text-orange-600 hover:text-orange-500">
                {t('register')}
              </Link>
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
