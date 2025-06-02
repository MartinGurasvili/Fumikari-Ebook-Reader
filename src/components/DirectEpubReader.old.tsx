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
  s3Key: string;
  progress: number;
  currentPage: number;
  currentCfi?: string;
  type: 'epub' | 'pdf';
}

interface ReaderProps {
  book: Book;
  getBookUrl: () => Promise<string>;
  onLocationChange: (cfi: string) => void;
  onProgressUpdate: (progress: number) => void;
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

// Simple language detection based on common words and patterns
const detectLanguageFromContent = (text: string): string => {
  const sample = text.substring(0, 1000).toLowerCase();
  
  // Japanese detection (hiragana, katakana, kanji)
  if (/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(sample)) {
    return 'ja';
  }
  
  // Chinese detection (simplified/traditional Chinese characters)
  if (/[\u4e00-\u9fff]/.test(sample)) {
    return 'zh';
  }
  
  // Korean detection (Hangul)
  if (/[\uac00-\ud7af]/.test(sample)) {
    return 'ko';
  }
  
  // Spanish detection
  if (/\b(el|la|de|que|y|a|en|un|es|se|no|te|lo|le|da|su|por|son|con|para|una|sobre|todo|pero|más|me|hasta|donde|quien|desde|porque|cuando)\b/.test(sample)) {
    return 'es';
  }
  
  // French detection
  if (/\b(le|de|et|à|un|il|être|et|en|avoir|que|pour|dans|ce|son|une|sur|avec|ne|se|pas|tout|pouvoir|vous|par|grand|dans)\b/.test(sample)) {
    return 'fr';
  }
  
  // German detection
  if (/\b(der|die|und|in|den|von|zu|das|mit|sich|des|auf|für|ist|im|dem|nicht|ein|eine|als|auch|es|an|werden|aus|er|hat|dass|sie|nach|wird|bei|einer|um|am|sind|noch|wie|einem|über|einen|so|zum|war|haben|nur|oder|aber|vor|zur|bis|unter|während|des)\b/.test(sample)) {
    return 'de';
  }
  
  // Russian detection
  if (/[а-яё]/i.test(sample)) {
    return 'ru';
  }
  
  // Default to English
  return 'en';
};

const DirectEpubReaderComponent: React.FC<ReaderProps> = ({
  book,
  getBookUrl,
  onLocationChange,
  onProgressUpdate,
}) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const initializationRef = useRef<string | null>(null);
  const mountedRef = useRef<boolean>(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<EpubPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [metadata, setMetadata] = useState<EpubMetadata | null>(null);
  const [migakuDetected, setMigakuDetected] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [textSettings, setTextSettings] = useState<TextSettings>({
    fontSize: 18,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    lineHeight: 1.6,
    margin: 40,
    theme: 'light'
  });

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
      const pageHeight = window.innerHeight - 200; // Account for navigation
      
      chapters.forEach((chapter, chapterIndex) => {
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
          
          // Test if adding this element would exceed page height
          tempContainer.innerHTML = currentPageContent + elementHtml;
          
          if (tempContainer.scrollHeight > pageHeight && currentPageContent.trim() !== '') {
            // Current page is full, save it and start a new page
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
        
        const { chapters: parsedChapters, metadata: parsedMetadata } = await parseWithTimeout as any;

        if (!mountedRef.current) {
          console.log('⚠️ Component unmounted during parsing, aborting...');
          return;
        }

        if (!parsedChapters || parsedChapters.length === 0) {
          throw new Error('No readable chapters found in EPUB file');
        }

        console.log('📚 Setting parsed chapters and metadata...');
        setChapters(parsedChapters);
        setMetadata(parsedMetadata);
        
        // Start from the first chapter or saved position
        setCurrentChapterIndex(0);
        
        setIsLoading(false);
        console.log('🎉 Direct EPUB reader initialized successfully with', parsedChapters.length, 'chapters');

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

  }, [book.id]); // Only depend on book.id to prevent infinite loops

  // Render current chapter
  useEffect(() => {
    if (!viewerRef.current || chapters.length === 0 || isLoading) return;

    const currentChapter = chapters[currentChapterIndex];
    if (!currentChapter) return;

    // Clear previous content
    viewerRef.current.innerHTML = '';

    // Create chapter container
    const chapterContainer = document.createElement('div');
    chapterContainer.className = 'epub-chapter';
    chapterContainer.setAttribute('data-chapter-id', currentChapter.id);
    chapterContainer.setAttribute('data-chapter-index', currentChapterIndex.toString());
    
    // Set language for Migaku
    if (metadata?.language) {
      chapterContainer.setAttribute('lang', metadata.language);
    } else {
      // Detect language from content
      const detectedLang = detectLanguageFromContent(currentChapter.content);
      chapterContainer.setAttribute('lang', detectedLang);
    }

    // Add Migaku-specific attributes
    if (migakuDetected) {
      chapterContainer.setAttribute('data-migaku-parseable', 'true');
      chapterContainer.setAttribute('data-epub-content', 'true');
      chapterContainer.setAttribute('data-epub-chapter', currentChapterIndex.toString());
      chapterContainer.classList.add('migaku-enabled-content');
    }

    // Set chapter content
    chapterContainer.innerHTML = currentChapter.content;

    // Add Migaku attributes to all text elements
    if (migakuDetected) {
      const textElements = chapterContainer.querySelectorAll('p, div, span, h1, h2, h3, h4, h5, h6, td, th, li, blockquote, pre');
      textElements.forEach(element => {
        element.setAttribute('data-migaku-parseable', 'true');
        element.setAttribute('data-epub-text', 'true');
      });
    }

    // Append to viewer
    viewerRef.current.appendChild(chapterContainer);

    // Trigger Migaku events
    if (migakuDetected) {
      setTimeout(() => {
        // Dispatch content ready events for Migaku
        const events = [
          new Event('DOMContentLoaded', { bubbles: true }),
          new CustomEvent('migaku-content-ready', {
            detail: {
              source: 'direct-epub-reader',
              chapterIndex: currentChapterIndex,
              chapterTitle: currentChapter.title,
              language: chapterContainer.getAttribute('lang')
            },
            bubbles: true
          })
        ];

        events.forEach(event => {
          chapterContainer.dispatchEvent(event);
          document.dispatchEvent(event);
        });

        console.log(`Chapter ${currentChapterIndex + 1} rendered for Migaku: ${currentChapter.title}`);
      }, 100);
    }

    // Update progress
    const progress = chapters.length > 0 ? (currentChapterIndex + 1) / chapters.length : 0;
    onProgressUpdate(progress);

    // Update location (using chapter index as CFI equivalent)
    onLocationChange(`chapter-${currentChapterIndex}`);

  }, [currentChapterIndex, chapters, metadata, migakuDetected, isLoading, onProgressUpdate, onLocationChange]);

  // Navigation functions
  const goToNext = useCallback(() => {
    if (currentChapterIndex < chapters.length - 1) {
      setCurrentChapterIndex(prev => prev + 1);
    }
  }, [currentChapterIndex, chapters.length]);

  const goToPrev = useCallback(() => {
    if (currentChapterIndex > 0) {
      setCurrentChapterIndex(prev => prev - 1);
    }
  }, [currentChapterIndex]);

  const handleViewerClick = useCallback((event: React.MouseEvent) => {
    const rect = viewerRef.current!.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const isLeftSide = x < rect.width / 2;
    
    if (isLeftSide && currentChapterIndex > 0) {
      goToPrev();
    } else if (!isLeftSide && currentChapterIndex < chapters.length - 1) {
      goToNext();
    }
  }, [currentChapterIndex, chapters.length, goToNext, goToPrev]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goToPrev();
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        goToNext();
      } else if (event.key === 'Escape') {
        setShowChapterList(false);
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (showChapterList && !(event.target as Element).closest('.chapter-info')) {
        setShowChapterList(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleClickOutside);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [goToNext, goToPrev, showChapterList]);

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
            // Retry initialization
            setTimeout(() => {
              const retryInit = async () => {
                try {
                  initializationRef.current = book.id;
                  const url = await getBookUrl();
                  const { chapters: parsedChapters, metadata: parsedMetadata } = await parseEpub(url);
                  setChapters(parsedChapters);
                  setMetadata(parsedMetadata);
                  setCurrentChapterIndex(0);
                  setIsLoading(false);
                } catch (retryErr) {
                  setError(retryErr instanceof Error ? retryErr.message : 'Failed to load book');
                  setIsLoading(false);
                  initializationRef.current = null;
                }
              };
              retryInit();
            }, 100);
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
      className={`direct-epub-reader ${migakuDetected ? 'migaku-enabled' : ''}`}
      data-migaku-reader={migakuDetected}
      data-epub-reader="direct"
    >
      {isLoading && (
        <div className="reader-loading">
          <div className="loading-spinner"></div>
          <p>Loading book... (ID: {book.id})</p>
          <p>Status: {initializationRef.current === book.id ? 'Initializing' : 'Waiting'}</p>
        </div>
      )}
      
      <div 
        ref={viewerRef}
        className="epub-content-viewer"
        onClick={handleViewerClick}
        data-migaku-content-area={migakuDetected}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'auto',
          padding: '2rem',
          backgroundColor: '#ffffff',
          color: '#333333',
          lineHeight: '1.6',
          fontSize: '18px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          cursor: 'pointer',
          userSelect: 'text'
        }}
      />
      
      {/* Chapter navigation */}
      <div className="chapter-navigation">
        <button 
          onClick={goToPrev} 
          disabled={currentChapterIndex === 0}
          className="chapter-nav-button prev-button"
          aria-label="Previous chapter"
          title={currentChapterIndex > 0 ? `Go to: ${chapters[currentChapterIndex - 1]?.title || 'Previous chapter'}` : 'No previous chapter'}
        >
          <span className="nav-icon">←</span>
          <span className="nav-text">Previous</span>
        </button>
        
        <div className="chapter-info">
          {chapters.length > 0 && (
            <div className="chapter-details">
              <button 
                className="chapter-dropdown-toggle"
                onClick={() => setShowChapterList(!showChapterList)}
                title="Select chapter"
                aria-label="Chapter selection menu"
              >
                <div className="chapter-counter">
                  {currentChapterIndex + 1} / {chapters.length}
                </div>
                {chapters[currentChapterIndex] && (
                  <div className="chapter-title" title={chapters[currentChapterIndex].title}>
                    {chapters[currentChapterIndex].title}
                  </div>
                )}
                <span className="dropdown-arrow">{showChapterList ? '▲' : '▼'}</span>
              </button>
              
              {showChapterList && (
                <div className="chapter-dropdown">
                  <div className="chapter-list">
                    {chapters.map((chapter, index) => (
                      <button
                        key={chapter.id}
                        className={`chapter-item ${index === currentChapterIndex ? 'current' : ''}`}
                        onClick={() => {
                          setCurrentChapterIndex(index);
                          setShowChapterList(false);
                        }}
                        title={chapter.title}
                      >
                        <span className="chapter-number">{index + 1}</span>
                        <span className="chapter-name">{chapter.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        
        <button 
          onClick={goToNext} 
          disabled={currentChapterIndex >= chapters.length - 1}
          className="chapter-nav-button next-button"
          aria-label="Next chapter"
          title={currentChapterIndex < chapters.length - 1 ? `Go to: ${chapters[currentChapterIndex + 1]?.title || 'Next chapter'}` : 'No next chapter'}
        >
          <span className="nav-text">Next</span>
          <span className="nav-icon">→</span>
        </button>
      </div>
      
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
