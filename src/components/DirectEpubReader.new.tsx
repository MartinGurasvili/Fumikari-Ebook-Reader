import React, { useEffect, useRef, useCallback, useState } from 'react';
import JSZip from 'jszip';

// Extend Window interface for Migaku extension detection
declare global {
  interface Window {
    chrome?: {
      runtime?: any;
    };
    migaku?: any;
  }
}

interface Book {
  id: string;
  fileName: string;
  coverUrl: string | null;
  googleDriveId: string;
  progress: number;
  currentPage: number;
  currentCfi?: string;
  type: 'epub' | 'pdf';
}

interface ReaderProps {
  book: Book;
  getBookUrl: () => Promise<string>;
  doublePageView?: boolean; // NEW PROP
}

interface EpubChapter {
  id: string;
  title: string;
  content: string;
  href: string;
}

interface EpubPage {
  id: string;
  content: string;
  chapterTitle: string;
  pageNumber: number;
}

interface EpubMetadata {
  title: string;
  author: string;
  language: string;
}

interface TextSettings {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  margin: number;
  theme: 'light' | 'dark' | 'sepia';
}

// Utility function to detect Migaku extension
const detectMigakuExtension = (): boolean => {
  try {
    return !!(
      window.chrome?.runtime ||
      document.querySelector('[data-migaku]') ||
      document.querySelector('.migaku-main') ||
      window.migaku
    );
  } catch {
    return false;
  }
};

const DirectEpubReaderComponent: React.FC<ReaderProps> = ({
  book,
  getBookUrl,
  doublePageView = false // NEW PROP
}) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const initializationRef = useRef<string | null>(null);
  const mountedRef = useRef<boolean>(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<EpubPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [migakuDetected, setMigakuDetected] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [textSettings, setTextSettings] = useState<TextSettings>({
    fontSize: 18,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    lineHeight: 1.6,
    margin: 40,
    theme: 'light'
  });

  // Add local state for doublePageView toggle
  const [localDoublePageView, setLocalDoublePageView] = useState(doublePageView);

  // Set mounted ref on mount and cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      console.log('🧹 DirectEpubReader unmounting for book:', book.id);
    };
  }, [book.id]);

  // Function to split content into pages based on viewport size
  const splitIntoPages = useCallback((chapters: EpubChapter[], settings: TextSettings): EpubPage[] => {
    const pages: EpubPage[] = [];
    
    // Create a temporary container to measure text
    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'absolute';
    tempContainer.style.top = '-9999px';
    tempContainer.style.left = '-9999px';
    tempContainer.style.width = `${window.innerWidth - (settings.margin * 2)}px`;
    tempContainer.style.fontSize = `${settings.fontSize}px`;
    tempContainer.style.fontFamily = settings.fontFamily;
    tempContainer.style.lineHeight = settings.lineHeight.toString();
    tempContainer.style.visibility = 'hidden';
    document.body.appendChild(tempContainer);
    
    try {
      // Make page splitting more aggressive so pages fit the viewport and don't require scrolling
      const pageHeight = Math.floor((window.innerHeight - 240) * 0.92); // 8% smaller than before
      chapters.forEach((chapter) => {
        // Parse chapter content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = chapter.content;
        
        // Get all text nodes and elements
        const elements = Array.from(tempDiv.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, blockquote, pre, li'));
        if (elements.length === 0) {
          elements.push(tempDiv); // Use the whole content if no specific elements found
        }
        
        let currentPageContent = '';
        let pageNumber = 1;
        
        elements.forEach((element) => {
          const elementHtml = element.outerHTML || element.textContent || '';
          tempContainer.innerHTML = currentPageContent + elementHtml;
          if (tempContainer.scrollHeight > pageHeight && currentPageContent.trim() !== '') {
            pages.push({
              id: `page-${pages.length + 1}`,
              content: currentPageContent,
              chapterTitle: chapter.title,
              pageNumber: pageNumber
            });
            currentPageContent = elementHtml;
            pageNumber++;
          } else {
            currentPageContent += elementHtml;
          }
        });
        
        // Add the remaining content as the last page of this chapter
        if (currentPageContent.trim() !== '') {
          pages.push({
            id: `page-${pages.length + 1}`,
            content: currentPageContent,
            chapterTitle: chapter.title,
            pageNumber: pageNumber
          });
        }
      });
    } finally {
      document.body.removeChild(tempContainer);
    }
    
    return pages;
  }, []);

  // Parse EPUB file
  const parseEpub = useCallback(async (url: string) => {
    try {
      console.log('🔍 Starting EPUB parsing for:', book.fileName);
      console.log('📍 URL:', url);
      
      console.log('📡 Fetching EPUB file...');
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch EPUB: ${response.status} ${response.statusText}`);
      }
      
      console.log('✅ File fetched successfully, size:', response.headers.get('content-length') || 'unknown');
      console.log('📦 Converting to array buffer...');
      
      const arrayBuffer = await response.arrayBuffer();
      console.log('✅ Array buffer created, size:', arrayBuffer.byteLength, 'bytes');
      
      console.log('🗜️ Initializing JSZip...');
      const zip = new JSZip();
      
      console.log('📂 Loading ZIP contents...');
      const epub = await zip.loadAsync(arrayBuffer);
      console.log('✅ ZIP loaded successfully');
      
      // Log all files in the EPUB for debugging
      const fileNames = Object.keys(epub.files);
      console.log('📋 Files in EPUB:', fileNames.length, 'files');
      console.log('📋 File list (first 10):', fileNames.slice(0, 10));

      // Read container.xml to find the OPF file
      console.log('🔍 Looking for container.xml...');
      const containerFile = epub.file('META-INF/container.xml');
      if (!containerFile) {
        console.error('❌ container.xml not found');
        console.error('📋 Available files:', fileNames);
        throw new Error('Invalid EPUB: container.xml not found');
      }
      console.log('✅ Found container.xml');
      
      console.log('📖 Reading container.xml...');
      const containerContent = await containerFile.async('text');
      console.log('✅ Container content loaded, length:', containerContent.length);
      
      const containerDoc = new DOMParser().parseFromString(containerContent, 'text/xml');
      const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
      
      console.log('✅ Found OPF path:', opfPath);
      if (!opfPath) {
        console.error('❌ OPF path not found in container.xml');
        console.log('📄 Container content:', containerContent);
        throw new Error('Invalid EPUB: OPF file path not found');
      }

      // Read the OPF file
      console.log('🔍 Looking for OPF file:', opfPath);
      const opfFile = epub.file(opfPath);
      if (!opfFile) {
        console.error('❌ OPF file not found:', opfPath);
        throw new Error('Invalid EPUB: OPF file not found');
      }
      console.log('✅ Found OPF file');

      console.log('📖 Reading OPF content...');
      const opfContent = await opfFile.async('text');
      console.log('✅ OPF content loaded, length:', opfContent.length);
      
      const opfDoc = new DOMParser().parseFromString(opfContent, 'text/xml');

      // Extract metadata
      console.log('📊 Extracting metadata...');
      const titleElement = opfDoc.querySelector('metadata title, title');
      const authorElement = opfDoc.querySelector('metadata creator, creator');
      const languageElement = opfDoc.querySelector('metadata language, language');

      const epubMetadata: EpubMetadata = {
        title: titleElement?.textContent || book.fileName,
        author: authorElement?.textContent || 'Unknown Author',
        language: languageElement?.textContent || 'en'
      };
      console.log('✅ Metadata extracted:', epubMetadata);

      // Get the base path for relative URLs
      const basePath = opfPath.substring(0, opfPath.lastIndexOf('/') + 1);
      console.log('📁 Base path:', basePath);

      // Parse spine to get reading order
      console.log('📚 Parsing spine items...');
      const spineItems = Array.from(opfDoc.querySelectorAll('spine itemref'));
      const manifestItems = Array.from(opfDoc.querySelectorAll('manifest item'));

      console.log(`📚 Found ${spineItems.length} spine items and ${manifestItems.length} manifest items`);
      
      const epubChapters: EpubChapter[] = [];

      for (let i = 0; i < spineItems.length; i++) {
        const spineItem = spineItems[i];
        console.log(`📖 Processing spine item ${i + 1}/${spineItems.length}...`);
        
        const idref = spineItem.getAttribute('idref');
        console.log('🔍 Looking for manifest item with id:', idref);
        
        const manifestItem = manifestItems.find(item => item.getAttribute('id') === idref);
        
        if (manifestItem) {
          const href = manifestItem.getAttribute('href');
          if (href) {
            const fullPath = basePath + href;
            console.log('📄 Reading chapter file:', fullPath);
            
            const chapterFile = epub.file(fullPath);
            
            if (chapterFile) {
              try {
                const chapterContent = await chapterFile.async('text');
                console.log('✅ Chapter content loaded, length:', chapterContent.length);
                
                // Parse chapter content to extract text and clean it up
                const doc = new DOMParser().parseFromString(chapterContent, 'text/html');
                
                // Remove script tags and other non-content elements
                const scripts = doc.querySelectorAll('script, style, meta, link');
                scripts.forEach(el => el.remove());

                // Get title from chapter or use filename
                const titleElement = doc.querySelector('title, h1, h2');
                const title = titleElement?.textContent || `Chapter ${epubChapters.length + 1}`;

                // Get body content
                const bodyElement = doc.querySelector('body');
                const content = bodyElement ? bodyElement.innerHTML : chapterContent;

                epubChapters.push({
                  id: idref || `chapter-${epubChapters.length}`,
                  title: title.trim(),
                  content: content,
                  href: fullPath
                });
                
                console.log('✅ Chapter added:', title.trim());
              } catch (chapterError) {
                console.warn('⚠️ Error processing chapter:', fullPath, chapterError);
              }
            } else {
              console.warn('⚠️ Chapter file not found:', fullPath);
            }
          } else {
            console.warn('⚠️ No href attribute for manifest item:', idref);
          }
        } else {
          console.warn('⚠️ Manifest item not found for spine item:', idref);
        }
      }

      console.log('✅ EPUB parsing completed!');
      console.log('📚 Total chapters extracted:', epubChapters.length);
      
      if (epubChapters.length === 0) {
        throw new Error('No readable chapters found in EPUB');
      }

      return { chapters: epubChapters, metadata: epubMetadata };
    } catch (err) {
      console.error('❌ Error parsing EPUB:', err);
      console.error('❌ Stack trace:', err instanceof Error ? err.stack : 'No stack trace');
      throw new Error(`Failed to parse EPUB: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, []); // Remove book.fileName dependency to prevent infinite loops

  // Initialize reader
  useEffect(() => {
    console.log('🔄 DirectEpubReader useEffect triggered for book:', book.id);
    
    if (!viewerRef.current) {
      console.log('⚠️ viewerRef.current is null, waiting...');
      return;
    }
    
    // Prevent duplicate initialization for the same book
    if (initializationRef.current === book.id) {
      console.log('📚 Book already initialized, skipping...');
      return;
    }

    console.log('🏗️ Setting up initialization for book:', book.id);

    const initReader = async () => {
      try {
        console.log('🚀 Initializing DirectEpubReader for book:', book.id);
        
        // Mark this book as being initialized
        initializationRef.current = book.id;
        
        if (!mountedRef.current) {
          console.log('⚠️ Component not mounted, aborting initialization...');
          return;
        }
        
        setIsLoading(true);
        setError(null);

        // Detect Migaku extension
        console.log('🔍 Detecting Migaku extension...');
        const hasMigaku = detectMigakuExtension();
        setMigakuDetected(hasMigaku);
        if (hasMigaku) {
          console.log('✅ Migaku extension detected - Direct DOM rendering enabled');
        } else {
          console.log('ℹ️ No Migaku extension detected');
        }

        console.log('🌐 Getting book URL...');
        const url = await getBookUrl();
        console.log('✅ Book URL obtained:', url);
        
        // Check if component is still mounted AND book ID hasn't changed
        if (!mountedRef.current || initializationRef.current !== book.id) {
          console.log('⚠️ Component unmounted or book changed after getting URL, aborting...');
          return;
        }
        
        // Add timeout to prevent infinite loading
        console.log('⏰ Starting EPUB parsing with 30-second timeout...');
        const parseWithTimeout = Promise.race([
          parseEpub(url),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('EPUB parsing timeout after 30 seconds')), 30000)
          )
        ]);
        
        const { chapters: parsedChapters } = await parseWithTimeout as any;

        if (!mountedRef.current) {
          console.log('⚠️ Component unmounted during parsing, aborting...');
          return;
        }

        if (!parsedChapters || parsedChapters.length === 0) {
          throw new Error('No readable chapters found in EPUB file');
        }

        console.log('📚 Splitting content into pages...');
        const epubPages = splitIntoPages(parsedChapters, textSettings);
        console.log('📄 Created', epubPages.length, 'pages');

        setPages(epubPages);
        
        // Start from the first page or saved position
        setCurrentPageIndex(0);
        
        setIsLoading(false);
        console.log('🎉 Direct EPUB reader initialized successfully with', epubPages.length, 'pages');

      } catch (err) {
        if (!mountedRef.current) {
          console.log('⚠️ Component unmounted during error handling, ignoring error...');
          return;
        }
        
        console.error('❌ Failed to initialize EPUB reader:', err);
        console.error('❌ Error details:', err instanceof Error ? err.stack : 'No stack trace');
        setError(err instanceof Error ? err.message : 'Failed to load book');
        setIsLoading(false);
        // Reset initialization ref on error so it can be retried
        initializationRef.current = null;
      }
    };

    initReader();

  }, [book.id, splitIntoPages, parseEpub, getBookUrl, textSettings]);

  // Re-split into pages when text settings change
  useEffect(() => {
    if (pages.length > 0) {
      console.log('🔄 Text settings changed, re-splitting into pages...');
      // We need to reconstruct chapters from pages to re-split
      // For now, let's just trigger a re-initialization
      initializationRef.current = null;
    }
  }, [textSettings, pages.length]);

  // Render current page
  useEffect(() => {
    if (!viewerRef.current || pages.length === 0 || isLoading) return;

    viewerRef.current.innerHTML = '';

    if (localDoublePageView) {
      // Render two pages side by side
      const leftPage = pages[currentPageIndex];
      const rightPage = pages[currentPageIndex + 1];
      const container = document.createElement('div');
      container.className = 'epub-content-viewer double-page';
      container.style.display = 'flex';
      container.style.justifyContent = 'center';
      container.style.alignItems = 'stretch';
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.overflow = 'hidden'; // Only allow scroll if overflow

      [leftPage, rightPage].forEach((page, idx) => {
        if (!page) return;
        const pageContainer = document.createElement('div');
        pageContainer.className = 'epub-page';
        pageContainer.setAttribute('data-page-id', page.id);
        pageContainer.setAttribute('data-page-index', (currentPageIndex + idx).toString());
        pageContainer.innerHTML = page.content;
        pageContainer.style.flex = '1 1 0';
        pageContainer.style.overflow = 'auto'; // Allow scroll fallback if Migaku/overflow
        pageContainer.style.maxWidth = '50%';
        pageContainer.style.boxSizing = 'border-box';
        container.appendChild(pageContainer);
      });
      viewerRef.current.appendChild(container);
    } else {
      // Single page view (default)
      const currentPage = pages[currentPageIndex];
      if (!currentPage) return;
      const pageContainer = document.createElement('div');
      pageContainer.className = 'epub-page';
      pageContainer.setAttribute('data-page-id', currentPage.id);
      pageContainer.setAttribute('data-page-index', currentPageIndex.toString());
      pageContainer.innerHTML = currentPage.content;
      pageContainer.style.overflow = 'auto';
      viewerRef.current.appendChild(pageContainer);
    }
  }, [currentPageIndex, pages, isLoading, localDoublePageView]);

  // Navigation functions
  const goToNext = useCallback(() => {
    if (currentPageIndex < pages.length - 1) {
      setCurrentPageIndex(prev => prev + 1);
    }
  }, [currentPageIndex, pages.length]);

  const goToPrev = useCallback(() => {
    if (currentPageIndex > 0) {
      setCurrentPageIndex(prev => prev - 1);
    }
  }, [currentPageIndex]);

  // Keyboard navigation (removed click navigation)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goToPrev();
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        goToNext();
      } else if (event.key === 'Escape') {
        setShowSettings(false);
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (showSettings && !(event.target as Element).closest('.settings-panel')) {
        setShowSettings(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleClickOutside);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [goToNext, goToPrev, showSettings]);

  if (error) {
    return (
      <div className="reader-error">
        <h3>Error loading book</h3>
        <p>{error}</p>
        <p>Please try refreshing the page or selecting a different book.</p>
        <button 
          onClick={() => {
            setError(null);
            setIsLoading(true);
            // Reset initialization ref to allow retry
            initializationRef.current = null;
          }}
          style={{
            marginTop: '1rem',
            padding: '0.5rem 1rem',
            background: '#2196f3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div 
      className={`direct-epub-reader ${migakuDetected ? 'migaku-enabled' : ''} theme-${textSettings.theme}`}
      data-migaku-reader={migakuDetected}
      data-epub-reader="direct"
    >
      {isLoading && (
        <div className="reader-loading">
          <div className="loading-spinner"></div>
          <p>Loading book... (ID: {book.id})</p>
          <p>Status: {initializationRef.current === book.id ? 'Parsing and splitting into pages' : 'Waiting'}</p>
        </div>
      )}
      
      <div 
        ref={viewerRef}
        className="epub-content-viewer"
        data-migaku-content-area={migakuDetected}
        style={{
          width: '100%',
          height: 'calc(100vh - 120px)',
          overflow: 'hidden', // No scrolling
          position: 'relative',
          userSelect: 'text'
        }}
      />
      
      {/* Page navigation */}
      <div className="page-navigation">
        <button 
          onClick={goToPrev} 
          disabled={currentPageIndex === 0}
          className="page-nav-button prev-button"
          aria-label="Previous page"
          title="Previous page"
        >
          <span className="nav-icon">←</span>
          <span className="nav-text">Previous</span>
        </button>
        
        <div className="page-info">
          {pages.length > 0 && (
            <div className="page-details">
              <div className="page-counter">
                Page {currentPageIndex + 1} of {pages.length}
              </div>
              {pages[currentPageIndex] && (
                <div className="chapter-title" title={pages[currentPageIndex].chapterTitle}>
                  {pages[currentPageIndex].chapterTitle}
                </div>
              )}
            </div>
          )}
        </div>
        
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className="settings-button"
          aria-label="Reading settings"
          title="Customize reading experience"
        >
          <span className="nav-icon">⚙️</span>
          <span className="nav-text">Settings</span>
        </button>
        
        <button 
          onClick={goToNext} 
          disabled={currentPageIndex >= pages.length - 1}
          className="page-nav-button next-button"
          aria-label="Next page"
          title="Next page"
        >
          <span className="nav-text">Next</span>
          <span className="nav-icon">→</span>
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="settings-panel">
          <h3>Reading Settings</h3>
          
          <div className="setting-group">
            <label>Font Size</label>
            <input 
              type="range" 
              min="12" 
              max="32" 
              value={textSettings.fontSize}
              onChange={(e) => setTextSettings(prev => ({ ...prev, fontSize: parseInt(e.target.value) }))}
            />
            <span>{textSettings.fontSize}px</span>
          </div>
          
          <div className="setting-group">
            <label>Line Height</label>
            <input 
              type="range" 
              min="1.2" 
              max="2.5" 
              step="0.1"
              value={textSettings.lineHeight}
              onChange={(e) => setTextSettings(prev => ({ ...prev, lineHeight: parseFloat(e.target.value) }))}
            />
            <span>{textSettings.lineHeight}</span>
          </div>
          
          <div className="setting-group">
            <label>Margin</label>
            <input 
              type="range" 
              min="20" 
              max="80" 
              value={textSettings.margin}
              onChange={(e) => setTextSettings(prev => ({ ...prev, margin: parseInt(e.target.value) }))}
            />
            <span>{textSettings.margin}px</span>
          </div>
          
          <div className="setting-group">
            <label>Font Family</label>
            <select 
              value={textSettings.fontFamily}
              onChange={(e) => setTextSettings(prev => ({ ...prev, fontFamily: e.target.value }))}
            >
              <option value="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">System Default</option>
              <option value="Georgia, serif">Georgia</option>
              <option value="'Times New Roman', serif">Times New Roman</option>
              <option value="Arial, sans-serif">Arial</option>
              <option value="'Courier New', monospace">Courier New</option>
            </select>
          </div>
          
          <div className="setting-group">
            <label>Theme</label>
            <div className="theme-buttons">
              <button 
                className={textSettings.theme === 'light' ? 'active' : ''}
                onClick={() => setTextSettings(prev => ({ ...prev, theme: 'light' }))}
              >
                Light
              </button>
              <button 
                className={textSettings.theme === 'dark' ? 'active' : ''}
                onClick={() => setTextSettings(prev => ({ ...prev, theme: 'dark' }))}
              >
                Dark
              </button>
              <button 
                className={textSettings.theme === 'sepia' ? 'active' : ''}
                onClick={() => setTextSettings(prev => ({ ...prev, theme: 'sepia' }))}
              >
                Sepia
              </button>
            </div>
          </div>

          <div className="setting-group">
            <label>
              <input
                type="checkbox"
                checked={localDoublePageView}
                onChange={e => {
                  setLocalDoublePageView(e.target.checked);
                  if (typeof window !== 'undefined' && window.dispatchEvent) {
                    window.dispatchEvent(new CustomEvent('doublePageViewChange', { detail: e.target.checked }));
                  }
                }}
              />
              Double Page View
            </label>
          </div>
        </div>
      )}
      
      {migakuDetected && (
        <div className="migaku-status">
          <span>🟢 Migaku extension detected - Direct text access enabled</span>
        </div>
      )}
    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders
export const DirectEpubReader = React.memo(DirectEpubReaderComponent, (prevProps, nextProps) => {
  // Only re-render if book.id changes
  return prevProps.book.id === nextProps.book.id;
});
