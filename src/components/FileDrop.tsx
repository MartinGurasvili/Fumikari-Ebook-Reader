import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

interface FileDropProps {
  onFileDrop: (file: File) => void;
}

export const FileDrop: React.FC<FileDropProps> = ({ onFileDrop }) => {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file && (file.type === 'application/pdf' || file.type === 'application/epub+zip')) {
      onFileDrop(file);
    }
  }, [onFileDrop]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/epub+zip': ['.epub']
    },
    multiple: false
  });

  return (
    <div
      {...getRootProps()}
      className={`dropzone ${isDragActive ? 'active' : ''}`}
      style={{
        border: '2px dashed #888',
        borderRadius: 8,
        padding: 32,
        margin: '32px 0',
        textAlign: 'center',
        outline: 'none',
      }}
    >
      <input {...getInputProps()} />
      {isDragActive ? (
        <p>Drop your book here...</p>
      ) : (
        <p>Drag and drop a PDF or EPUB file here, or click to select a file</p>
      )}
    </div>
  );
};
