<p align="center">
  <img src="fumikari.png" alt="Fumikari Logo" width="180" height="180" />
</p>

# Fumikari E-Reader

A modern, accessible e-reader web app for Google Drive. Fumikari lets you read EPUB and PDF books stored in your Google Drive, with features designed for language learners and a focus on accessibility and customization.

---

## 🚀 How It Works

1. **Create a `books` folder in your Google Drive** (all lowercase).
2. **Add your EPUB and PDF files** to this folder.
3. **Connect Fumikari to your Google Drive** (via the app UI).
4. **Browse and read your books** directly in your browser.

Fumikari will automatically detect and display all supported books in your Drive's `books` folder.

---

## ✨ Features

- **Google Drive integration**: Your library is always in sync with your Drive.
- **Drag and drop support** for PDFs and EPUBs (from Drive).
- **Automatic cover art fetching** from the internet.
- **Reading progress tracking** with progress bars.
- **Migaku & Yomichan browser extension compatibility** for language learning.
- **Iframe-free EPUB rendering** for full extension access.
- **Customizable reading experience** (compact view, double-page, etc).
- **Hidden books**: Organize your library by hiding books.
- **Accessible UI**: Keyboard navigation, ARIA labels, and responsive design.

---

## 🗂️ Google Drive Setup

- **Required:** You must have a folder named `books` in the root of your Google Drive.
- Add your EPUB and PDF files to this folder.
- The app will only show books from this folder.

---

## 🛠️ Getting Started

### Prerequisites

- Node.js (v16+)
- npm or yarn
- A Google account

### Installation

```bash
git clone https://github.com/yourusername/fumikari.git
cd fumikari
npm install
npm run dev
```

### First Use

1. Open the app in your browser.
2. Click "Connect to Google Drive" and authorize access.
3. If you haven't already, create a `books` folder in your Google Drive and add books.
4. Your library will appear automatically.

---

## 📚 Project Structure

```
src/
├── components/
│   ├── DirectEpubReader.tsx    # Iframe-free EPUB reader
│   ├── Reader.tsx              # PDF reader
│   ├── FileDrop.tsx            # File upload (future)
│   └── ProgressBar.tsx         # Reading progress
├── services/                   # Google Drive, cover art, etc.
└── App.tsx                     # Main app logic
```

---

## 🔧 Technical Details

- **Google Drive API**: Used for authentication and file access.
- **Direct EPUB rendering**: EPUBs are parsed and rendered directly in the DOM (no iframes).
- **PDF.js**: Used for PDF rendering.
- **Cover Art**: Fumikari fetches cover images for your books automatically.
- **Progress Sync**: Reading progress is saved locally for each book.

---

## 🌐 Extension Support

- **Migaku, Yomichan, etc.**: EPUB content is rendered directly in the DOM for full compatibility with language-learning browser extensions.

---

## ♿ Accessibility & Customization

- Keyboard navigation and ARIA labels throughout.
- Responsive design for desktop and mobile.
- Reading settings: compact view, double-page, and more.

---

## ❓ FAQ

**Q: Why can't I see my books?**  
A: Make sure you have a folder named `books` (all lowercase) in your Google Drive and that your EPUB/PDF files are inside it.

**Q: Is my data private?**  
A: Yes. Fumikari only accesses your Google Drive files with your permission and never stores your data externally.

---

## 📝 License

MIT

---

<p align="center">
  <img src="fumikari.png" alt="Fumikari Logo" width="120" height="120" />
  <br />
  <b>Fumikari</b> — Read anywhere, from your Google Drive.
</p>
