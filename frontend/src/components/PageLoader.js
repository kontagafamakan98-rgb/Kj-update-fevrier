import React from 'react';
import LoadingSpinner from './LoadingSpinner';

const PageLoader = ({ message = 'Chargement...' }) => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <div className="text-center space-y-4">
        <LoadingSpinner size="xl" color="orange" />
        <p className="text-gray-600 text-lg">{message}</p>
      </div>
    </div>
  );
};

export default PageLoader;
