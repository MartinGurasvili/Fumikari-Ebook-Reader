import React from 'react';

interface CustomizationProps {
  fontSize: number;
  setFontSize: (size: number) => void;
  colorMode: 'light' | 'dark';
  setColorMode: (mode: 'light' | 'dark') => void;
}

const Customization: React.FC<CustomizationProps> = ({ fontSize, setFontSize, colorMode, setColorMode }) => (
  <section aria-label="Reading customization" style={{ margin: '24px 0' }}>
    <h2 tabIndex={0}>Reading Customization</h2>
    <label>
      Font Size:
      <input
        type="range"
        min={14}
        max={32}
        value={fontSize}
        onChange={e => setFontSize(Number(e.target.value))}
        aria-label="Font size"
      />
      <span>{fontSize}px</span>
    </label>
    <div>
      <label>
        <input
          type="radio"
          name="colorMode"
          value="light"
          checked={colorMode === 'light'}
          onChange={() => setColorMode('light')}
        />
        Light Mode
      </label>
      <label style={{ marginLeft: 16 }}>
        <input
          type="radio"
          name="colorMode"
          value="dark"
          checked={colorMode === 'dark'}
          onChange={() => setColorMode('dark')}
        />
        Dark Mode
      </label>
    </div>
  </section>
);

export default Customization;
