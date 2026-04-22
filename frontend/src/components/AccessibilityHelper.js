/**
 * Accessibility Helper Component
 * Enhances accessibility for West African users including screen readers
 */

import { useEffect } from 'react';
import { devLog } from '../utils/env';

const AccessibilityHelper = () => {
  useEffect(() => {
    // Add skip to main content link for keyboard navigation
    addSkipLink();
    
    // Enhance focus visibility
    enhanceFocusVisibility();
    
    // Add ARIA live regions for dynamic content
    addLiveRegions();
    
    // Monitor and fix common accessibility issues
    const cleanupAccessibilityMonitor = monitorAccessibility();
    
    return () => {
      // Cleanup
      const skipLink = document.getElementById('skip-to-main');
      if (skipLink) skipLink.remove();
      if (typeof cleanupAccessibilityMonitor === 'function') {
        cleanupAccessibilityMonitor();
      }
    };
  }, []);

  return null;
};

function scheduleDeferredTask(task, delay = 2000) {
  let idleId = null;
  let animationFrameId = null;

  const runTask = () => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(() => task(), { timeout: delay });
      return;
    }

    if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = window.requestAnimationFrame(() => task());
      });
      return;
    }

    task();
  };

  runTask();

  return () => {
    if (idleId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(idleId);
    }

    if (animationFrameId !== null && typeof window !== 'undefined' && 'cancelAnimationFrame' in window) {
      window.cancelAnimationFrame(animationFrameId);
    }
  };
}

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
  if (process.env.NODE_ENV !== 'development') return () => {};

  return scheduleDeferredTask(() => {
    const issues = [];

    // Check for images without alt text
    const imagesWithoutAltCount = document.querySelectorAll('img:not([alt])').length;
    if (imagesWithoutAltCount > 0) {
      issues.push(`${imagesWithoutAltCount} images sans attribut alt`);
    }

    // Check for buttons without accessible text
    const buttons = document.querySelectorAll('button');
    let buttonsWithoutTextCount = 0;
    buttons.forEach((btn) => {
      const hasText = btn.textContent.trim().length > 0;
      const hasAriaLabel = btn.hasAttribute('aria-label');
      const hasAriaLabelledby = btn.hasAttribute('aria-labelledby');
      if (!hasText && !hasAriaLabel && !hasAriaLabelledby) {
        buttonsWithoutTextCount += 1;
      }
    });
    if (buttonsWithoutTextCount > 0) {
      issues.push(`${buttonsWithoutTextCount} boutons sans texte accessible`);
    }

    // Check for links without accessible text
    const links = document.querySelectorAll('a');
    let linksWithoutTextCount = 0;
    links.forEach((link) => {
      const hasText = link.textContent.trim().length > 0;
      const hasAriaLabel = link.hasAttribute('aria-label');
      if (!hasText && !hasAriaLabel) {
        linksWithoutTextCount += 1;
      }
    });
    if (linksWithoutTextCount > 0) {
      issues.push(`${linksWithoutTextCount} liens sans texte accessible`);
    }

    // Check for form inputs without labels
    const formFields = document.querySelectorAll('input, textarea, select');
    let inputsWithoutLabelsCount = 0;
    formFields.forEach((input) => {
      if (input.type === 'hidden' || input.type === 'submit') return;

      const hasId = Boolean(input.id);
      const hasLabel = hasId ? document.querySelector(`label[for="${input.id}"]`) : input.closest('label');
      const hasAriaLabel = input.hasAttribute('aria-label');
      const hasAriaLabelledby = input.hasAttribute('aria-labelledby');

      if (!hasLabel && !hasAriaLabel && !hasAriaLabelledby) {
        inputsWithoutLabelsCount += 1;
      }
    });
    if (inputsWithoutLabelsCount > 0) {
      issues.push(`${inputsWithoutLabelsCount} champs de formulaire sans label`);
    }

    // Contrast audit is intentionally disabled during normal page usage
    // because repeated getComputedStyle scans can trigger forced reflow warnings.

    // Log issues
    if (issues.length > 0) {
      devLog.warn('♿ Problèmes d\'accessibilité détectés:');
      issues.forEach(issue => devLog.warn(`  - ${issue}`));
    } else {
      devLog.info('✅ Aucun problème d\'accessibilité majeur détecté');
    }
  }, 2000);
}

/**
 * Basic color contrast checker
 */
function checkColorContrast() {
  return 0;
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
  
  if (!region) {
    return;
  }

  const applyMessage = () => {
    region.textContent = message;
  };

  region.textContent = '';

  if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(applyMessage);
    });
    return;
  }

  applyMessage();
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
