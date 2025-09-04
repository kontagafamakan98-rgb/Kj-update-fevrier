import React from 'react';

const MechanicRequirements = ({ job, showTitle = true, compact = false }) => {
  // Vérifier s'il y a des exigences de mécanicien
  const hasRequirements = typeof job.mechanic_must_bring_parts !== "undefined" || 
                          typeof job.mechanic_must_bring_tools !== "undefined" ||
                          job.parts_and_tools_notes;

  if (!hasRequirements) {
    return null;
  }

  if (compact) {
    // Version compacte pour les listes
    return (
      <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
        <div className="flex items-center mb-2">
          <span className="text-sm mr-2">🔧</span>
          <span className="text-xs font-medium text-orange-800">Informations importantes :</span>
        </div>
        <div className="text-xs text-orange-700 space-y-1">
          {typeof job.mechanic_must_bring_parts !== "undefined" && (
            <div className="flex items-center">
              <span className="mr-2">🔩</span>
              <span>Pièces : {job.mechanic_must_bring_parts ? 
                <span className="font-medium text-green-700">À apporter</span> : 
                <span className="font-medium text-blue-700">Fournies</span>
              }</span>
            </div>
          )}
          {job.typeof mechanic_must_bring_tools !== "undefined" && (
            <div className="flex items-center">
              <span className="mr-2">🛠️</span>
              <span>Outils : {job.mechanic_must_bring_tools ? 
                <span className="font-medium text-green-700">À apporter</span> : 
                <span className="font-medium text-blue-700">Fournis</span>
              }</span>
            </div>
          )}
          {job.parts_and_tools_notes && (
            <div className="flex items-start">
              <span className="mr-2 mt-0.5">📝</span>
              <span className="text-orange-600">{job.parts_and_tools_notes}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Version complète pour les détails
  return (
    <div className="bg-gradient-to-r from-orange-50 to-red-50 border border-orange-200 rounded-lg p-6">
      {showTitle && (
        <div className="flex items-center mb-4">
          <span className="text-2xl mr-3">🔧</span>
          <h3 className="text-lg font-semibold text-orange-900">
            Informations Importantes pour le Mécanicien
          </h3>
        </div>
      )}
      
      <div className="space-y-4">
        {/* Pièces */}
        {job.typeof mechanic_must_bring_parts !== "undefined" && (
          <div className="flex items-center justify-between p-4 bg-white border border-orange-200 rounded-lg">
            <div className="flex items-center">
              <span className="text-xl mr-3">🔩</span>
              <div>
                <h4 className="font-medium text-gray-900">Pièces de rechange</h4>
                <p className="text-sm text-gray-600">Composants nécessaires à la réparation</p>
              </div>
            </div>
            <div className={`px-4 py-2 rounded-full text-sm font-medium ${
              job.mechanic_must_bring_parts 
                ? 'bg-green-100 text-green-800' 
                : 'bg-blue-100 text-blue-800'
            }`}>
              {job.mechanic_must_bring_parts ? '✅ À apporter par le mécanicien' : '🏠 Fournies par le client'}
            </div>
          </div>
        )}

        {/* Outils */}
        {job.typeof mechanic_must_bring_tools !== "undefined" && (
          <div className="flex items-center justify-between p-4 bg-white border border-orange-200 rounded-lg">
            <div className="flex items-center">
              <span className="text-xl mr-3">🛠️</span>
              <div>
                <h4 className="font-medium text-gray-900">Outils et équipements</h4>
                <p className="text-sm text-gray-600">Outils spécialisés pour l'intervention</p>
              </div>
            </div>
            <div className={`px-4 py-2 rounded-full text-sm font-medium ${
              job.mechanic_must_bring_tools 
                ? 'bg-green-100 text-green-800' 
                : 'bg-blue-100 text-blue-800'
            }`}>
              {job.mechanic_must_bring_tools ? '✅ À apporter par le mécanicien' : '🏠 Fournis par le client'}
            </div>
          </div>
        )}

        {/* Notes supplémentaires */}
        {job.parts_and_tools_notes && (
          <div className="p-4 bg-white border border-orange-200 rounded-lg">
            <div className="flex items-start">
              <span className="text-xl mr-3 mt-1">📝</span>
              <div className="flex-1">
                <h4 className="font-medium text-gray-900 mb-2">Notes supplémentaires</h4>
                <p className="text-gray-700 text-sm leading-relaxed">
                  {job.parts_and_tools_notes}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Message d'alerte */}
        <div className="p-4 bg-orange-100 border border-orange-300 rounded-lg">
          <div className="flex items-start">
            <span className="text-xl mr-3">⚠️</span>
            <div>
              <h4 className="font-medium text-orange-900 mb-1">Important</h4>
              <p className="text-sm text-orange-800">
                Merci de bien vérifier ces informations avant d'accepter la mission. 
                Contactez le client si vous avez des questions sur les pièces ou outils requis.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MechanicRequirements;