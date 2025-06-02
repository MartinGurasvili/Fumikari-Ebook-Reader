import React from 'react';

interface CoverArtProps {
  coverUrl: string | null;
  alt?: string;
}

const CoverArt: React.FC<CoverArtProps> = ({ coverUrl, alt = 'Book cover' }) => {
  if (!coverUrl) return null;
  return (
    <img
      src={coverUrl}
      alt={alt}
      style={{ maxWidth: 200, margin: '16px auto', display: 'block' }}
    />
  );
};

export default CoverArt;
