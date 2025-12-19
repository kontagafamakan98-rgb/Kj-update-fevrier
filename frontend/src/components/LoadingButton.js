import React from 'react';
import PropTypes from 'prop-types';
import LoadingSpinner from './LoadingSpinner';

/**
 * LoadingButton Component
 * Bouton avec état de chargement intégré
 * 
 * @component
 * @param {Object} props - Props du composant
 * @param {React.ReactNode} props.children - Contenu du bouton
 * @param {boolean} props.loading - État de chargement
 * @param {boolean} props.disabled - État désactivé
 * @param {string} props.className - Classes CSS additionnelles
 * @param {('white'|'orange'|'blue'|'green')} props.spinnerColor - Couleur du spinner
 * 
 * @example
 * <LoadingButton loading={isSubmitting} onClick={handleSubmit}>
 *   Sauvegarder
 * </LoadingButton>
 */
const LoadingButton = ({ 
  children, 
  loading = false, 
  disabled = false,
  className = '',
  spinnerColor = 'white',
  ...props 
}) => {
  return (
    <button
      {...props}
      disabled={loading || disabled}
      className={`relative ${className} ${loading ? 'cursor-wait' : ''}`}
    >
      <span className={loading ? 'invisible' : ''}>
        {children}
      </span>
      
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <LoadingSpinner size="sm" color={spinnerColor} />
        </div>
      )}
    </button>
  );
};

LoadingButton.propTypes = {
  children: PropTypes.node.isRequired,
  loading: PropTypes.bool,
  disabled: PropTypes.bool,
  className: PropTypes.string,
  spinnerColor: PropTypes.oneOf(['white', 'orange', 'blue', 'green'])
};

LoadingButton.defaultProps = {
  loading: false,
  disabled: false,
  className: '',
  spinnerColor: 'white'
};

export default LoadingButton;
