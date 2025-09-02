// Service pour les fonctionnalités propriétaire - ACCÈS RESTREINT
class OwnerService {
  constructor() {
    this.API_BASE = process.env.REACT_APP_BACKEND_URL + '/api/owner';
  }

  // Vérifier les headers d'autorisation
  getAuthHeaders() {
    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('Token d\'authentification manquant');
    }
    
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  // Obtenir les statistiques de commission (propriétaire uniquement)
  async getCommissionStats() {
    try {
      console.log('🔐 Récupération stats commission (propriétaire)...');
      
      const response = await fetch(`${this.API_BASE}/commission-stats`, {
        method: 'GET',
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement');
        }
        throw new Error(`Erreur serveur: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Stats commission récupérées:', data);
      return data;
      
    } catch (error) {
      console.error('❌ Erreur stats commission:', error);
      throw error;
    }
  }

  // Obtenir les informations de debug (propriétaire uniquement)
  async getDebugInfo() {
    try {
      console.log('🔐 Récupération infos debug (propriétaire)...');
      
      const response = await fetch(`${this.API_BASE}/debug-info`, {
        method: 'GET',
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement');
        }
        throw new Error(`Erreur serveur: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Infos debug récupérées:', data);
      return data;
      
    } catch (error) {
      console.error('❌ Erreur infos debug:', error);
      throw error;
    }
  }

  // Obtenir la gestion des utilisateurs (propriétaire uniquement)
  async getUsersManagement() {
    try {
      console.log('🔐 Récupération gestion utilisateurs (propriétaire)...');
      
      const response = await fetch(`${this.API_BASE}/users-management`, {
        method: 'GET',
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement');
        }
        throw new Error(`Erreur serveur: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Gestion utilisateurs récupérée:', data);
      return data;
      
    } catch (error) {
      console.error('❌ Erreur gestion utilisateurs:', error);
      throw error;
    }
  }

  // Mettre à jour les paramètres de commission (propriétaire uniquement)
  async updateCommissionSettings(settings) {
    try {
      console.log('🔐 Mise à jour paramètres commission (propriétaire)...', settings);
      
      const response = await fetch(`${this.API_BASE}/update-commission-settings`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(settings)
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement');
        }
        throw new Error(`Erreur serveur: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Paramètres commission mis à jour:', data);
      return data;
      
    } catch (error) {
      console.error('❌ Erreur mise à jour commission:', error);
      throw error;
    }
  }

  // Vérifier si l'utilisateur actuel est le propriétaire
  async checkOwnerAccess() {
    try {
      // Essayer d'accéder aux infos debug pour vérifier les permissions
      await this.getDebugInfo();
      return true;
    } catch (error) {
      console.log('👤 Utilisateur normal détecté (pas propriétaire)');
      return false;
    }
  }

  // Obtenir le statut propriétaire depuis le localStorage
  isFamakanLoggedIn() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return false;

      // Décoder le token JWT (simple, sans vérification de signature)
      const payload = JSON.parse(atob(token.split('.')[1]));
      const isFamakan = payload.sub === 'famakan_kontaga_master_2024' && payload.email === 'kontagamakan@gmail.com';
      
      console.log('🔍 Vérification Famakan Kontaga Master:', isFamakan ? '✅ FAMAKAN KONTAGA MASTER' : '👤 Utilisateur normal');
      return isFamakan;
      
    } catch (error) {
      console.error('Erreur vérification Famakan:', error);
      return false;
    }
  }
}

export default new OwnerService();