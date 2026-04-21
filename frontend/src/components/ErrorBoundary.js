import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { safeLog } from '../utils/env';

class ErrorBoundaryInner extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    safeLog.error('Error caught by ErrorBoundary:', error, errorInfo);
  }

  render() {
    const { t } = this.props;
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6 text-center">
            <div className="text-6xl mb-4">😵</div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">{t('unexpectedErrorTitle')}</h2>
            <p className="text-gray-600 mb-4">{t('unexpectedErrorText')}</p>
            <button onClick={() => window.location.reload()} className="bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 transition-colors">{t('refreshPage')}</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ErrorBoundary(props) {
  const { t } = useLanguage();
  return <ErrorBoundaryInner {...props} t={t} />;
}
