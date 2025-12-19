/**
 * Image Optimization Utilities for West Africa
 * Optimized for slow networks (2G/3G)
 */

import { devLog } from './env';

/**
 * Compress and resize image before upload
 * @param {File} file - Original image file
 * @param {Object} options - Compression options
 * @returns {Promise<Blob>} Compressed image blob
 */
export async function compressImage(file, options = {}) {
  const {
    maxWidth = 800,
    maxHeight = 800,
    quality = 0.7, // Lower quality for West Africa networks
    format = 'image/jpeg' // JPEG is more compatible and smaller
  } = options;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onload = () => {
        // Calculate new dimensions while maintaining aspect ratio
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth || height > maxHeight) {
          const aspectRatio = width / height;
          
          if (width > height) {
            width = maxWidth;
            height = width / aspectRatio;
          } else {
            height = maxHeight;
            width = height * aspectRatio;
          }
        }
        
        // Create canvas and draw resized image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        
        // Enable image smoothing for better quality
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // Draw image on canvas
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert to blob with compression
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to compress image'));
            }
          },
          format,
          quality
        );
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };
      
      img.src = e.target.result;
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsDataURL(file);
  });
}

/**
 * Get optimized image dimensions for profile photos
 * @param {number} width - Original width
 * @param {number} height - Original height
 * @returns {Object} Optimized dimensions
 */
export function getOptimizedDimensions(width, height) {
  const MAX_SIZE = 400; // Profile photos don't need to be huge
  
  if (width <= MAX_SIZE && height <= MAX_SIZE) {
    return { width, height };
  }
  
  const aspectRatio = width / height;
  
  if (width > height) {
    return {
      width: MAX_SIZE,
      height: Math.round(MAX_SIZE / aspectRatio)
    };
  } else {
    return {
      width: Math.round(MAX_SIZE * aspectRatio),
      height: MAX_SIZE
    };
  }
}

/**
 * Convert image to WebP format if supported
 * @param {File} file - Original image file
 * @returns {Promise<Blob>} WebP image blob or original if not supported
 */
export async function convertToWebP(file) {
  // Check if WebP is supported
  const canvas = document.createElement('canvas');
  const isWebPSupported = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
  
  if (!isWebPSupported) {
    console.log('WebP not supported, using JPEG');
    return compressImage(file, { format: 'image/jpeg' });
  }
  
  return compressImage(file, { format: 'image/webp', quality: 0.8 });
}

/**
 * Validate image file before upload
 * @param {File} file - Image file to validate
 * @returns {Object} Validation result
 */
export function validateImageFile(file) {
  const errors = [];
  
  // Check file type
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    errors.push('Format non supporté. Utilisez JPG, PNG ou WebP.');
  }
  
  // Check file size (max 5MB for West Africa)
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    errors.push('Image trop volumineuse. Maximum 5MB.');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Create a thumbnail from image file
 * @param {File} file - Original image file
 * @returns {Promise<string>} Data URL of thumbnail
 */
export async function createThumbnail(file) {
  const blob = await compressImage(file, {
    maxWidth: 150,
    maxHeight: 150,
    quality: 0.6
  });
  
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsDataURL(blob);
  });
}

/**
 * Progressive image loading helper
 * @param {string} src - Image source URL
 * @returns {Promise<HTMLImageElement>} Loaded image element
 */
export function loadImageProgressively(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    // Add loading attribute for lazy loading
    img.loading = 'lazy';
    
    img.onload = () => resolve(img);
    img.onerror = reject;
    
    img.src = src;
  });
}

/**
 * Calculate estimated upload time based on file size and network speed
 * @param {number} fileSizeBytes - File size in bytes
 * @param {string} networkType - Network type (2G, 3G, 4G, wifi)
 * @returns {number} Estimated time in seconds
 */
export function estimateUploadTime(fileSizeBytes, networkType = '3G') {
  // Average speeds in bytes per second for West Africa
  const speeds = {
    '2G': 25 * 1024, // 25 KB/s
    '3G': 100 * 1024, // 100 KB/s
    '4G': 500 * 1024, // 500 KB/s
    'wifi': 1024 * 1024 // 1 MB/s
  };
  
  const speed = speeds[networkType] || speeds['3G'];
  return Math.ceil(fileSizeBytes / speed);
}

/**
 * Format file size for display
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) {
    return bytes + ' B';
  } else if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' KB';
  } else {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}
