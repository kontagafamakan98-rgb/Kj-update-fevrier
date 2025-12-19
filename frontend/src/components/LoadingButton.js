import React from 'react';
import LoadingSpinner from './LoadingSpinner';

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

export default LoadingButton;
