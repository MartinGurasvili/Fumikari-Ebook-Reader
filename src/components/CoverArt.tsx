import React, { useState, useEffect, useCallback } from 'react';

interface CoverArtProps {
  bookId: string;
  fileName: string;
  coverUrl: string | null;
  onImageLoad?: (bookId: string, coverUrl: string) => void;
  onImageError?: (bookId: string, coverUrl: string) => void;
  className?: string;
  size?: 'small' | 'medium' | 'large' | 'xl';
}

export const CoverArt: React.FC<CoverArtProps> = ({
  bookId,
  fileName,
  coverUrl,
  onImageLoad,
  onImageError,
  className = '',
  size = 'medium'
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [currentUrl, setCurrentUrl] = useState<string | null>(coverUrl);

  // Reset error state when coverUrl changes
  useEffect(() => {
    if (coverUrl !== currentUrl) {
      setCurrentUrl(coverUrl);
      setHasError(false);
      setIsLoading(!!coverUrl);
    }
  }, [coverUrl, currentUrl]);

  const handleImageLoad = useCallback(() => {
    setIsLoading(false);
    setHasError(false);
    if (onImageLoad && currentUrl) {
      onImageLoad(bookId, currentUrl);
    }
  }, [bookId, currentUrl, onImageLoad]);

  const handleImageError = useCallback(() => {
    setIsLoading(false);
    setHasError(true);
    if (onImageError && currentUrl) {
      onImageError(bookId, currentUrl);
    }
  }, [bookId, currentUrl, onImageError]);

  const getCleanBookTitle = (fileName: string): string => {
    return fileName.replace(/\.(epub|pdf|txt|mobi|azw3?)$/i, '').trim();
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'small': return 'w-16 h-24';
      case 'medium': return 'w-32 h-48';
      case 'large': return 'w-48 h-72';
      case 'xl': return 'w-64 h-96';
      default: return 'w-32 h-48';
    }
  };

  return (
    <div className={`book-cover ${className}`}>
      {currentUrl && !hasError ? (
        <img 
          src={currentUrl} 
          alt={`Cover of ${getCleanBookTitle(fileName)}`}
          onLoad={handleImageLoad}
          onError={handleImageError}
          className={`cover-image ${getSizeClasses()} ${isLoading ? 'loading' : ''}`}
        />
      ) : (
        <div className={`book-cover-placeholder ${getSizeClasses()}`}>
          <span>{getCleanBookTitle(fileName).charAt(0).toUpperCase()}</span>
        </div>
      )}
    </div>
  );
};