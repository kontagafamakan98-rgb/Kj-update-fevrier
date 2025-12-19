import React from 'react';
import PropTypes from 'prop-types';

/**
 * LoadingSpinner Component
 * Affiche un spinner de chargement animé réutilisable
 * 
 * @component
 * @param {Object} props - Props du composant
 * @param {('sm'|'md'|'lg'|'xl')} props.size - Taille du spinner (défaut: 'md')
 * @param {('orange'|'blue'|'green'|'white')} props.color - Couleur du spinner (défaut: 'orange')
 * @param {string} props.className - Classes CSS additionnelles
 * 
 * @example
 * <LoadingSpinner size="lg" color="orange" />
 */
const LoadingSpinner = ({ size = 'md', color = 'orange', className = '' }) => {
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
      <div
        className={`animate-spin rounded-full border-b-2 ${sizeClasses[size]} ${colorClasses[color]}`}
        role="status"
        aria-label="Chargement"
      >
        <span className="sr-only">Chargement...</span>
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
