/**
 * Accessibility Helper Component
 * Enhances accessibility for West African users including screen readers
 */

import { useEffect } from 'react';

const AccessibilityHelper = () => {
  useEffect(() => {
    // Add skip to main content link for keyboard navigation
    addSkipLink();
    
    // Enhance focus visibility
    enhanceFocusVisibility();
    
    // Add ARIA live regions for dynamic content
    addLiveRegions();
    
    // Monitor and fix common accessibility issues
    monitorAccessibility();
    
    return () => {
      // Cleanup
      const skipLink = document.getElementById('skip-to-main');
      if (skipLink) skipLink.remove();
    };
  }, []);

  return null;
};

/**
 * Add "Skip to main content" link for keyboard users
 */
function addSkipLink() {
  // Check if already exists
  if (document.getElementById('skip-to-main')) return;

  const skipLink = document.createElement('a');
  skipLink.id = 'skip-to-main';
  skipLink.href = '#main-content';
  skipLink.textContent = 'Aller au contenu principal';
  skipLink.className = 'skip-link';
  
  // Add styles
  const style = document.createElement('style');
  style.textContent = `
    .skip-link {
      position: absolute;
      top: -40px;
      left: 0;
      background: #ea580c;
      color: white;
      padding: 8px 16px;
      text-decoration: none;
      z-index: 10000;
      font-weight: 600;
      border-radius: 0 0 4px 0;
      transition: top 0.3s;
    }
    .skip-link:focus {
      top: 0;
    }
  `;
  
  document.head.appendChild(style);
  document.body.insertBefore(skipLink, document.body.firstChild);
  
  // Add main-content ID to main element if not exists
  const main = document.querySelector('main');
  if (main && !main.id) {
    main.id = 'main-content';
    main.setAttribute('role', 'main');
  }
}

/**
 * Enhance focus visibility for keyboard navigation
 */
function enhanceFocusVisibility() {
  // Add custom focus styles
  const style = document.createElement('style');
  style.textContent = `
    /* Enhanced focus visibility */
    *:focus-visible {
      outline: 3px solid #ea580c !important;
      outline-offset: 2px !important;
    }
    
    /* Remove default outline when not keyboard navigating */
    *:focus:not(:focus-visible) {
      outline: none;
    }
    
    /* High contrast focus for buttons */
    button:focus-visible,
    a:focus-visible,
    input:focus-visible,
    textarea:focus-visible,
    select:focus-visible {
      outline: 3px solid #ea580c !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 4px rgba(234, 88, 12, 0.2) !important;
    }
  `;
  
  document.head.appendChild(style);
}

/**
 * Add ARIA live regions for dynamic content announcements
 */
function addLiveRegions() {
  // Check if already exists
  if (document.getElementById('aria-live-polite')) return;

  // Polite live region (for non-critical updates)
  const politeRegion = document.createElement('div');
  politeRegion.id = 'aria-live-polite';
  politeRegion.setAttribute('aria-live', 'polite');
  politeRegion.setAttribute('aria-atomic', 'true');
  politeRegion.className = 'sr-only';
  
  // Assertive live region (for critical updates)
  const assertiveRegion = document.createElement('div');
  assertiveRegion.id = 'aria-live-assertive';
  assertiveRegion.setAttribute('aria-live', 'assertive');
  assertiveRegion.setAttribute('aria-atomic', 'true');
  assertiveRegion.className = 'sr-only';
  
  // Screen reader only styles
  const style = document.createElement('style');
  style.textContent = `
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border-width: 0;
    }
  `;
  
  document.head.appendChild(style);
  document.body.appendChild(politeRegion);
  document.body.appendChild(assertiveRegion);
}

/**
 * Monitor and log accessibility issues
 */
function monitorAccessibility() {
  // Only run in development
  if (process.env.NODE_ENV !== 'development') return;

  setTimeout(() => {
    const issues = [];

    // Check for images without alt text
    const imagesWithoutAlt = document.querySelectorAll('img:not([alt])');
    if (imagesWithoutAlt.length > 0) {
      issues.push(`${imagesWithoutAlt.length} images sans attribut alt`);
    }

    // Check for buttons without accessible text
    const buttonsWithoutText = Array.from(document.querySelectorAll('button')).filter(btn => {
      const hasText = btn.textContent.trim().length > 0;
      const hasAriaLabel = btn.hasAttribute('aria-label');
      const hasAriaLabelledby = btn.hasAttribute('aria-labelledby');
      return !hasText && !hasAriaLabel && !hasAriaLabelledby;
    });
    if (buttonsWithoutText.length > 0) {
      issues.push(`${buttonsWithoutText.length} boutons sans texte accessible`);
    }

    // Check for links without accessible text
    const linksWithoutText = Array.from(document.querySelectorAll('a')).filter(link => {
      const hasText = link.textContent.trim().length > 0;
      const hasAriaLabel = link.hasAttribute('aria-label');
      return !hasText && !hasAriaLabel;
    });
    if (linksWithoutText.length > 0) {
      issues.push(`${linksWithoutText.length} liens sans texte accessible`);
    }

    // Check for form inputs without labels
    const inputsWithoutLabels = Array.from(document.querySelectorAll('input, textarea, select')).filter(input => {
      if (input.type === 'hidden' || input.type === 'submit') return false;
      
      const hasLabel = document.querySelector(`label[for="${input.id}"]`);
      const hasAriaLabel = input.hasAttribute('aria-label');
      const hasAriaLabelledby = input.hasAttribute('aria-labelledby');
      
      return !hasLabel && !hasAriaLabel && !hasAriaLabelledby;
    });
    if (inputsWithoutLabels.length > 0) {
      issues.push(`${inputsWithoutLabels.length} champs de formulaire sans label`);
    }

    // Check color contrast (basic check)
    checkColorContrast();

    // Log issues
    if (issues.length > 0) {
      console.warn('♿ Problèmes d\'accessibilité détectés:');
      issues.forEach(issue => console.warn(`  - ${issue}`));
    } else {
      console.log('✅ Aucun problème d\'accessibilité majeur détecté');
    }
  }, 2000); // Wait for page to fully render
}

/**
 * Basic color contrast checker
 */
function checkColorContrast() {
  // This is a simplified check - full contrast checking requires more complex algorithms
  const textElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, a, button, span, div');
  let lowContrastCount = 0;

  textElements.forEach(el => {
    const style = window.getComputedStyle(el);
    const color = style.color;
    const backgroundColor = style.backgroundColor;
    
    // Skip if transparent or inherited
    if (backgroundColor === 'rgba(0, 0, 0, 0)' || backgroundColor === 'transparent') {
      return;
    }
    
    // Simple luminosity check (very basic)
    const colorLum = getLuminosity(color);
    const bgLum = getLuminosity(backgroundColor);
    const contrast = Math.max(colorLum, bgLum) / Math.min(colorLum, bgLum);
    
    if (contrast < 4.5) { // WCAG AA standard for normal text
      lowContrastCount++;
    }
  });

  if (lowContrastCount > 0) {
    console.warn(`♿ ${lowContrastCount} éléments avec potentiellement un faible contraste de couleur`);
  }
}

/**
 * Calculate luminosity of a color (simplified)
 */
function getLuminosity(color) {
  // Parse RGB values
  const rgb = color.match(/\d+/g);
  if (!rgb || rgb.length < 3) return 1;
  
  const [r, g, b] = rgb.map(Number);
  
  // Simplified luminosity calculation
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Utility function to announce message to screen readers
 * @param {string} message - Message to announce
 * @param {string} priority - 'polite' or 'assertive'
 */
export function announceToScreenReader(message, priority = 'polite') {
  const regionId = priority === 'assertive' ? 'aria-live-assertive' : 'aria-live-polite';
  const region = document.getElementById(regionId);
  
  if (region) {
    region.textContent = message;
    
    // Clear after announcement
    setTimeout(() => {
      region.textContent = '';
    }, 1000);
  }
}

/**
 * Add keyboard shortcuts
 */
export function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Alt + H: Go to home
    if (e.altKey && e.key === 'h') {
      e.preventDefault();
      window.location.href = '/';
    }
    
    // Alt + D: Go to dashboard
    if (e.altKey && e.key === 'd') {
      e.preventDefault();
      window.location.href = '/dashboard';
    }
    
    // Alt + J: Go to jobs
    if (e.altKey && e.key === 'j') {
      e.preventDefault();
      window.location.href = '/jobs';
    }
    
    // Alt + M: Go to messages
    if (e.altKey && e.key === 'm') {
      e.preventDefault();
      window.location.href = '/messages';
    }
    
    // Esc: Close modals/dialogs
    if (e.key === 'Escape') {
      const closeButtons = document.querySelectorAll('[data-dismiss], [aria-label="Close"]');
      if (closeButtons.length > 0) {
        closeButtons[0].click();
      }
    }
  });
}

export default AccessibilityHelper;
