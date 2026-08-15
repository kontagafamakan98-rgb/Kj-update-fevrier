import React from 'react';

// Composant de base Skeleton
export const Skeleton = ({ className = '', width, height }) => {
  const style = {};
  if (width) style.width = width;
  if (height) style.height = height;

  return (
    <div
      className={`animate-pulse bg-gray-200 rounded ${className}`}
      style={style}
    />
  );
};

// Skeleton pour une carte de job
export const JobCardSkeleton = () => {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <Skeleton className="h-10 w-24" />
      </div>
      
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </div>
      
      <div className="flex items-center justify-between pt-4 border-t">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-28" />
      </div>
    </div>
  );
};

// Skeleton pour une carte de profil
export const ProfileCardSkeleton = () => {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center space-x-4 mb-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
      
      <div className="flex gap-2 mt-4">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
      </div>
    </div>
  );
};

// Skeleton pour un message
export const MessageSkeleton = () => {
  return (
    <div className="flex items-start space-x-3 p-4 hover:bg-gray-50">
      <Skeleton className="h-12 w-12 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
};

// Skeleton pour une liste
export const ListSkeleton = ({ count = 3, type = 'job' }) => {
  const SkeletonComponent = {
    job: JobCardSkeleton,
    profile: ProfileCardSkeleton,
    message: MessageSkeleton
  }[type] || JobCardSkeleton;

  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonComponent key={index} />
      ))}
    </div>
  );
};

// Skeleton pour un tableau
export const TableSkeleton = ({ rows = 5, cols = 4 }) => {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
        <div className="flex gap-4">
          {Array.from({ length: cols }).map((_, index) => (
            <Skeleton key={index} className="h-4 flex-1" />
          ))}
        </div>
      </div>
      
      {/* Rows */}
      <div className="divide-y divide-gray-200">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="px-6 py-4">
            <div className="flex gap-4">
              {Array.from({ length: cols }).map((_, colIndex) => (
                <Skeleton key={colIndex} className="h-4 flex-1" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Skeleton pour un formulaire
export const FormSkeleton = ({ fields = 4 }) => {
  return (
    <div className="space-y-6">
      {Array.from({ length: fields }).map((_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <Skeleton className="h-10 w-32" />
    </div>
  );
};

export default Skeleton;
