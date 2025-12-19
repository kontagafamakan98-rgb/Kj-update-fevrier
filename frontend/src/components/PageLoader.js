import React from 'react';
import PropTypes from 'prop-types';
import LoadingSpinner from './LoadingSpinner';

/**
 * PageLoader Component
 * Écran de chargement pleine page pour les transitions
 * 
 * @component
 * @param {Object} props - Props du composant
 * @param {string} props.message - Message à afficher
 * 
 * @example
 * <PageLoader message="Chargement de votre dashboard..." />
 */
const PageLoader = ({ message = 'Chargement...' }) => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <div className="text-center space-y-4">
        <LoadingSpinner size="xl" color="orange" />
        <p className="text-gray-600 text-lg font-medium">{message}</p>
      </div>
    </div>
  );
};

PageLoader.propTypes = {
  message: PropTypes.string
};

PageLoader.defaultProps = {
  message: 'Chargement...'
};

export default PageLoader;
