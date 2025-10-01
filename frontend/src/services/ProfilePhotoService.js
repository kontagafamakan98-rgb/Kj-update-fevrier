/**
 * ProfilePhotoService - Centralized service for profile photo management
 * Always uses backend for shared storage, no localStorage dependency
 */

import { usersAPI } from './api';
import { safeLog } from '../utils/env';

class ProfilePhotoService {
  /**
   * Get profile photo URL for any user (shared backend storage)
   * @param {string} userId - User ID to get photo for
   * @returns {Promise<string|null>} - Photo URL or null if no photo
   */
  async getPhotoUrl(userId) {
    try {
      if (!userId) {
        safeLog.warn('ProfilePhotoService: No userId provided');
        return null;
      }

      const response = await usersAPI.getUserProfilePhoto(userId);
      const photoUrl = response.photo_url;
      
      if (photoUrl) {
        // Ensure full URL with backend domain
        const fullUrl = photoUrl.startsWith('http') 
          ? photoUrl 
          : `${process.env.REACT_APP_BACKEND_URL}${photoUrl}`;
        
        // Add cache busting to ensure fresh images
        return `${fullUrl}?t=${Date.now()}`;
      }
      
      return null;
    } catch (error) {
      if (error.response?.status === 404) {
        // No photo found - this is normal
        safeLog.info(`ProfilePhotoService: No photo found for user ${userId}`);
        return null;
      }
      
      safeLog.error(`ProfilePhotoService: Error fetching photo for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Get current user's profile photo URL
   * @returns {Promise<string|null>} - Photo URL or null if no photo
   */
  async getCurrentUserPhotoUrl() {
    try {
      const response = await usersAPI.getProfilePhoto();
      const photoUrl = response.photo_url;
      
      if (photoUrl) {
        // Ensure full URL with backend domain
        const fullUrl = photoUrl.startsWith('http') 
          ? photoUrl 
          : `${process.env.REACT_APP_BACKEND_URL}${photoUrl}`;
        
        // Add cache busting to ensure fresh images
        return `${fullUrl}?t=${Date.now()}`;
      }
      
      return null;
    } catch (error) {
      if (error.response?.status === 404) {
        // No photo found - this is normal
        safeLog.info('ProfilePhotoService: No photo found for current user');
        return null;
      }
      
      safeLog.error('ProfilePhotoService: Error fetching current user photo:', error);
      return null;
    }
  }

  /**
   * Upload profile photo (current user only)
   * @param {File} file - Image file to upload
   * @param {Function} onProgress - Progress callback (optional)
   * @returns {Promise<Object>} - Upload result with photo_url
   */
  async uploadPhoto(file, onProgress = null) {
    try {
      if (!file) {
        throw new Error('No file provided');
      }

      // Validate file type
      if (!file.type.startsWith('image/')) {
        throw new Error('File must be an image (JPG, PNG, WEBP, etc.)');
      }

      // Validate file size (5MB max)
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Image must be less than 5MB');
      }

      // Create FormData
      const formData = new FormData();
      formData.append('file', file);

      // Upload to backend
      const response = await usersAPI.uploadProfilePhoto(formData);
      
      if (!response || !response.photo_url) {
        throw new Error('Invalid server response: photo_url missing');
      }

      safeLog.info('ProfilePhotoService: Photo uploaded successfully', response);
      return response;
    } catch (error) {
      safeLog.error('ProfilePhotoService: Upload error:', error);
      throw error;
    }
  }

  /**
   * Delete current user's profile photo
   * @returns {Promise<Object>} - Deletion result
   */
  async deletePhoto() {
    try {
      const response = await usersAPI.deleteProfilePhoto();
      safeLog.info('ProfilePhotoService: Photo deleted successfully');
      return response;
    } catch (error) {
      safeLog.error('ProfilePhotoService: Delete error:', error);
      throw error;
    }
  }

  /**
   * Generate preview URL for instant display (before upload)
   * @param {File} file - Image file
   * @returns {string} - Object URL for instant preview
   */
  generatePreviewUrl(file) {
    if (!file) return null;
    try {
      return URL.createObjectURL(file);
    } catch (error) {
      safeLog.error('ProfilePhotoService: Error creating preview URL:', error);
      return null;
    }
  }

  /**
   * Clean up preview URL to prevent memory leaks
   * @param {string} url - Object URL to revoke
   */
  revokePreviewUrl(url) {
    if (url && url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url);
      } catch (error) {
        safeLog.warn('ProfilePhotoService: Error revoking preview URL:', error);
      }
    }
  }

  /**
   * Generate default avatar URL based on user info
   * @param {Object} user - User object with name/email
   * @returns {string} - Data URL for default avatar
   */
  generateDefaultAvatar(user) {
    if (!user) return null;

    const initials = this.getUserInitials(user);
    const colors = ['#f97316', '#ef4444', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b'];
    const colorIndex = (user.id || user.email || '').length % colors.length;
    const backgroundColor = colors[colorIndex];

    // Create simple SVG avatar
    const svg = `
      <svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">
        <circle cx="64" cy="64" r="64" fill="${backgroundColor}"/>
        <text x="64" y="74" font-family="Arial, sans-serif" font-size="48" font-weight="bold" 
              fill="white" text-anchor="middle">${initials}</text>
      </svg>
    `;

    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  /**
   * Get user initials for default avatar
   * @param {Object} user - User object
   * @returns {string} - User initials
   */
  getUserInitials(user) {
    if (!user) return '?';

    if (user.first_name && user.last_name) {
      return `${user.first_name.charAt(0)}${user.last_name.charAt(0)}`.toUpperCase();
    }
    
    if (user.first_name) {
      return user.first_name.charAt(0).toUpperCase();
    }
    
    if (user.email) {
      return user.email.charAt(0).toUpperCase();
    }
    
    return '?';
  }
}

// Export singleton instance
const profilePhotoService = new ProfilePhotoService();
export default profilePhotoService;