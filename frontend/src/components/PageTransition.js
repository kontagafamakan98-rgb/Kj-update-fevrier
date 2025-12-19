import React from 'react';
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';

/**
 * PageTransition Component
 * Ajoute des animations fluides lors des changements de page
 * Note: Nécessite framer-motion (optionnel)
 * 
 * @component
 * @param {Object} props - Props du composant
 * @param {React.ReactNode} props.children - Contenu de la page
 * 
 * @example
 * <PageTransition>
 *   <YourPageContent />
 * </PageTransition>
 */
const PageTransition = ({ children }) => {
  // Vérifier si framer-motion est disponible
  if (typeof motion === 'undefined') {
    // Si framer-motion n'est pas installé, retourner juste les enfants
    return <>{children}</>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{
        duration: 0.3,
        ease: 'easeInOut'
      }}
    >
      {children}
    </motion.div>
  );
};

PageTransition.propTypes = {
  children: PropTypes.node.isRequired
};

export default PageTransition;
