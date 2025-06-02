import React from 'react';

interface ProgressBarProps {
  progress: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ progress }) => {
  const percentage = Math.round(progress * 100);
  
  return (
    <div className="book-progress-bar">
      <div className="progress-track">
        <div 
          className="progress-fill"
          style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
        />
      </div>
      <span className="progress-text">{percentage}%</span>
    </div>
  );
};
