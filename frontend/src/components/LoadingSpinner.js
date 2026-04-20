import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import PropTypes from 'prop-types';

const LoadingSpinner = ({ size = 'md', color = 'orange', className = '' }) => {
  const { t } = useLanguage();
  const label = t('loadingLabel');

  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
    xl: 'h-16 w-16'
  };

  const colorClasses = {
    orange: 'border-orange-500',
    blue: 'border-blue-500',
    green: 'border-green-500',
    white: 'border-white'
  };

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className={`animate-spin rounded-full border-b-2 ${sizeClasses[size]} ${colorClasses[color]}`} role="status" aria-label={label}>
        <span className="sr-only">{label}</span>
      </div>
    </div>
  );
};

LoadingSpinner.propTypes = {
  size: PropTypes.oneOf(['sm', 'md', 'lg', 'xl']),
  color: PropTypes.oneOf(['orange', 'blue', 'green', 'white']),
  className: PropTypes.string
};

LoadingSpinner.defaultProps = {
  size: 'md',
  color: 'orange',
  className: ''
};

export default LoadingSpinner;
