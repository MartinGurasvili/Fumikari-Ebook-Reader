# Fumikari E-Reader - Online Ebook Reader

A modern e-reader web application built with React, TypeScript, and Vite. Specially designed for language learning with support for Migaku, Yomichan, and other browser extensions. Supports both PDF and EPUB files.

## ✨ Key Features

- **Drag and drop support** for PDFs and EPUBs
- **Automatic cover art fetching** from the internet
- **Accessibility features** and reading customization
- **Reading progress tracking** with progress bars
- **Migaku & Yomichan browser extension compatibility** for language learning
- **Iframe-free EPUB rendering** for better extension access
- **Sliding settings panel** with book management features
- **Hidden books functionality** for library organization

## 🔧 Migaku Extension Compatibility

This e-reader specifically addresses the issue where browser extensions (like Migaku for language learning) cannot access text content rendered in iframes. The app uses two different rendering approaches:

### For EPUB Files: DirectEpubReader
- **Direct DOM rendering**: Parses EPUB files manually using JSZip and renders content directly in the DOM
- **No iframes**: Text is fully accessible to browser extensions
- **Extension detection**: Automatically detects Migaku extension and optimizes rendering
- **Language detection**: Automatically detects content language for better extension integration
- **Chapter navigation**: Click-based and keyboard navigation support

### For PDF Files: Traditional Reader
- Uses pdf.js for PDF rendering (iframe-based)
- Note: PDF text accessibility for extensions may be limited due to PDF.js architecture

## 🚀 Getting Started

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

## 📁 Project Structure

```
src/
├── components/
│   ├── DirectEpubReader.tsx    # Iframe-free EPUB reader
│   ├── Reader.tsx              # Traditional iframe-based reader  
│   ├── FileDrop.tsx           # File upload component
│   └── ProgressBar.tsx        # Reading progress display
└── App.tsx                    # Main application component
```

## 🔧 Technical Details

### EPUB Rendering Approach
The `DirectEpubReader` component:
1. Downloads EPUB file
2. Extracts and parses using JSZip
3. Reads OPF manifest and spine for chapter order
4. Renders HTML content directly in DOM elements
5. Adds Migaku-specific attributes and events
6. Supports language detection and chapter navigation

### Dependencies
- `epubjs`: Traditional EPUB rendering (used for fallback)
- `jszip`: Direct EPUB file parsing and extraction
- `pdfjs-dist`: PDF file rendering
- `react-dropzone`: File upload functionality

## 🌐 Browser Extension Support

This app is specifically designed to work with language learning browser extensions like Migaku:
- Text content is rendered directly in the DOM (no iframes for EPUB)
- Proper language attributes are set on content elements
- Extension detection and optimization
- Custom events dispatched for extension integration

## 🎨 Accessibility & Customization

- Keyboard navigation support (arrow keys, page up/down)
- Click-based navigation (left/right side of screen)
- Responsive design for mobile and desktop
- Reading progress tracking and persistence
- Focus on accessibility and modern React/TypeScript best practices
