import React, { useEffect, useRef, useCallback, useState } from 'react';
import * as ePubModule from 'epubjs';

// Handle both default and named exports
const ePub = (ePubModule as any).default || ePubModule;

// Extend Window interface for chrome extension detection
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
  onLocationChange: (cfi: string) => void;
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
  if (/\b(el|la|de|que|y|a|en|un|es|se|no|te|lo|le|da|su|por|son|con|para|una|sobre|todo|pero|más|me|hasta|donde|quien|desde|porque|cuando)\\b/.test(sample)) {
    return 'es';
  }
  
  // French detection
  if (/\b(le|de|et|à|un|il|être|et|en|avoir|que|pour|dans|ce|son|une|sur|avec|ne|se|pas|tout|pouvoir|vous|par|grand|dans)\\b/.test(sample)) {
    return 'fr';
  }
  
  // German detection
  if (/\b(der|die|und|in|den|von|zu|das|mit|sich|des|auf|für|ist|im|dem|nicht|ein|eine|als|auch|es|an|werden|aus|er|hat|dass|sie|nach|wird|bei|einer|um|am|sind|noch|wie|einem|über|einen|so|zum|war|haben|nur|oder|aber|vor|zur|bis|unter|während|des)\\b/.test(sample)) {
    return 'de';
  }
  
  // Russian detection
  if (/[а-яё]/i.test(sample)) {
    return 'ru';
  }
  
  // Default to English
  return 'en';
};

export const Reader: React.FC<ReaderProps> = ({
  book,
  getBookUrl,
  onLocationChange,
}) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<any>(null);
  const bookRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canGoNext, setCanGoNext] = useState(false);
  const [canGoPrev, setCanGoPrev] = useState(false);
  const [migakuDetected, setMigakuDetected] = useState(false);

  // Initialize EPUB reader
  useEffect(() => {
    if (!viewerRef.current) return;
    
    // Prevent double initialization in React Strict Mode
    if (renditionRef.current) {
      console.log('Reader already initialized, skipping');
      return;
    }

    let isMounted = true;
    
    // Set up message listener for Migaku communication
    const handleMigakuMessages = (event: MessageEvent) => {
      if (event.data?.type?.startsWith('migaku-')) {
        console.log('Received Migaku message:', event.data);
      }
    };
    
    window.addEventListener('message', handleMigakuMessages);

    const initReader = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Detect Migaku extension
        const hasMigaku = detectMigakuExtension();
        setMigakuDetected(hasMigaku);
        if (hasMigaku) {
          console.log('Migaku extension detected, enabling compatibility features');
        }

        const url = await getBookUrl();

        // Create a new book instance with better error handling
        const epubBook = ePub(url, {
          openAs: 'epub'
        });
        bookRef.current = epubBook;

        // Wait for book to be ready with timeout
        await Promise.race([
          epubBook.ready,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Book loading timeout')), 30000)
          )
        ]);

        if (!isMounted) return;

        // Verify book is properly loaded
        if (!epubBook.spine || !epubBook.packaging) {
          throw new Error('Invalid EPUB file: missing required components');
        }

        // Create rendition with continuous flow for better Migaku compatibility
        const rendition = epubBook.renderTo(viewerRef.current!, {
          width: '100%',
          height: '100%',
          spread: 'none',
          manager: 'continuous',
          flow: 'scrolled',
          allowScriptedContent: false,
          allowPopups: false
        });

        renditionRef.current = rendition;

        // Wait for rendition to be ready before setting up hooks
        await rendition.started;

        // Initial display first
        await rendition.display(book.currentCfi || undefined);

        console.log('EPUB reader initialized successfully');

        // Enhanced Migaku integration with text extraction
        const enhanceMigakuCompatibility = () => {
          try {
            // Extract text from iframe content and mirror it for Migaku
            const iframes = viewerRef.current?.querySelectorAll('iframe');
            if (iframes) {
              iframes.forEach((iframe, index) => {
                // Add Migaku compatibility attributes
                iframe.setAttribute('data-epub-viewer', 'true');
                iframe.setAttribute('data-migaku-compatible', 'true');
                iframe.setAttribute('data-reader-type', 'epubjs');
                iframe.setAttribute('data-migaku-page', index.toString());
                iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
                iframe.classList.add('migaku-enabled-reader', 'epub-content-frame');

                // Wait for iframe content to load
                if (iframe.contentDocument || iframe.contentWindow) {
                  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                  if (iframeDoc && iframeDoc.readyState === 'complete') {
                    enhanceIframeContent(iframe, iframeDoc);
                    extractTextForMigaku(iframe, iframeDoc, index);
                  } else {
                    iframe.addEventListener('load', () => {
                      const doc = iframe.contentDocument || iframe.contentWindow?.document;
                      if (doc) {
                        enhanceIframeContent(iframe, doc);
                        extractTextForMigaku(iframe, doc, index);
                      }
                    });
                  }
                }
              });
              console.log('Applied enhanced iframe setup for Migaku compatibility');
            }
          } catch (enhancementError) {
            console.warn('Failed to apply iframe enhancements:', enhancementError);
          }
        };

        // Extract text content from iframe and create accessible mirror
        const extractTextForMigaku = (_iframe: HTMLIFrameElement, doc: Document, pageIndex: number) => {
          try {
            const textContent = doc.body?.textContent || '';
            const htmlContent = doc.body?.innerHTML || '';
            
            if (!textContent.trim()) return;

            // Create or update a hidden text mirror for Migaku to access
            let textMirror = document.getElementById(`migaku-text-mirror-${pageIndex}`);
            if (!textMirror) {
              textMirror = document.createElement('div');
              textMirror.id = `migaku-text-mirror-${pageIndex}`;
              textMirror.className = 'migaku-text-mirror';
              textMirror.setAttribute('data-migaku-parseable', 'true');
              textMirror.setAttribute('data-epub-page', pageIndex.toString());
              textMirror.style.cssText = `
                position: absolute;
                left: -9999px;
                top: -9999px;
                width: 1px;
                height: 1px;
                overflow: hidden;
                opacity: 0;
                pointer-events: none;
                font-size: 16px;
                line-height: 1.6;
                font-family: inherit;
              `;
              
              // Detect language
              const language = detectLanguageFromContent(textContent);
              if (language) {
                textMirror.setAttribute('lang', language);
                console.log(`Text mirror language set to: ${language}`);
              }
              
              viewerRef.current?.appendChild(textMirror);
            }

            // Update the mirror content with formatted text
            textMirror.innerHTML = htmlContent;
            
            // Add Migaku-specific attributes to all text elements in mirror
            const textElements = textMirror.querySelectorAll('p, div, span, h1, h2, h3, h4, h5, h6, td, th, li');
            textElements.forEach(element => {
              element.setAttribute('data-migaku-parseable', 'true');
              element.setAttribute('data-epub-content', 'true');
            });

            // Trigger Migaku scanning on the mirror element
            setTimeout(() => {
              const events = [
                'DOMContentLoaded',
                'DOMSubtreeModified',
                'migaku-scan-request'
              ];
              
              events.forEach(eventType => {
                const event = new Event(eventType, { bubbles: true, cancelable: true });
                textMirror!.dispatchEvent(event);
              });

              // Custom Migaku event with content details
              const migakuEvent = new CustomEvent('migaku-content-ready', {
                detail: {
                  source: 'epub-reader-mirror',
                  pageIndex: pageIndex,
                  textLength: textContent.length,
                  language: textMirror!.getAttribute('lang') || 'en'
                },
                bubbles: true
              });
              textMirror!.dispatchEvent(migakuEvent);

              console.log(`Created text mirror for page ${pageIndex} with ${textContent.length} characters`);
            }, 100);

          } catch (error) {
            console.warn('Failed to extract text for Migaku:', error);
          }
        };

        const enhanceIframeContent = (_iframe: HTMLIFrameElement, doc: Document) => {
          try {
            // Add language detection meta tags if not present
            const html = doc.documentElement;
            if (html) {
              // Try to detect language from existing lang attribute or content
              let language = html.getAttribute('lang') || 
                           doc.querySelector('meta[name="language"]')?.getAttribute('content') ||
                           doc.querySelector('meta[http-equiv="content-language"]')?.getAttribute('content');
              
              // If no language detected, try to infer from content
              if (!language) {
                const textContent = doc.body?.textContent || '';
                language = detectLanguageFromContent(textContent);
              }

              if (language) {
                html.setAttribute('lang', language);
                console.log(`Detected/Set language: ${language} for EPUB content`);
              }

              // Add Migaku-specific attributes to the document
              html.setAttribute('data-migaku-enabled', 'true');
              html.setAttribute('data-epub-reader', 'true');
              
              if (doc.body) {
                doc.body.setAttribute('data-migaku-content', 'true');
                doc.body.classList.add('migaku-parseable-content');
              }
            }
          } catch (error) {
            console.warn('Failed to enhance iframe content:', error);
          }
        };

        // Apply initial Migaku compatibility
        setTimeout(enhanceMigakuCompatibility, 500);

        // Setup event listeners for page navigation
        rendition.on('rendered', () => {
          setTimeout(enhanceMigakuCompatibility, 300);
        });

        rendition.on('relocated', () => {
          setTimeout(enhanceMigakuCompatibility, 300);
        });

        rendition.on('locationChanged', (location: any) => {
          if (location && location.start) {
            onLocationChange(location.start.cfi);
            
            // Update navigation state
            setCanGoNext(!location.atEnd);
            setCanGoPrev(!location.atStart);
          }
        });

        // Handle keyboard navigation
        const handleKeyNavigation = (event: KeyboardEvent) => {
          if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
            if (canGoPrev) {
              rendition.prev().catch(console.warn);
            }
          } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
            if (canGoNext) {
              rendition.next().catch(console.warn);
            }
          }
        };

        rendition.on('keyup', handleKeyNavigation);

        // Generate locations for progress tracking
        await epubBook.locations.generate(1024);
        
        setIsLoading(false);
        console.log('EPUB reader fully initialized with Migaku compatibility');

      } catch (err) {
        console.error('Failed to initialize EPUB reader:', err);
        setError(err instanceof Error ? err.message : 'Failed to load book');
        setIsLoading(false);
      }
    };

    initReader();

    return () => {
      isMounted = false;
      window.removeEventListener('message', handleMigakuMessages);
      
      // Cleanup text mirrors
      const textMirrors = document.querySelectorAll('[id^="migaku-text-mirror-"]');
      textMirrors.forEach(mirror => mirror.remove());
      
      if (renditionRef.current) {
        try {
          renditionRef.current.destroy();
        } catch (e) {
          console.warn('Error destroying rendition:', e);
        }
        renditionRef.current = null;
      }
      
      if (bookRef.current) {
        try {
          bookRef.current.destroy();
        } catch (e) {
          console.warn('Error destroying book:', e);
        }
        bookRef.current = null;
      }
    };
  }, [book.id, book.currentCfi]);

  const goToNext = useCallback(async () => {
    if (!renditionRef.current || !canGoNext) return;
    
    try {
      await renditionRef.current.next();
    } catch (error) {
      console.warn('Navigation error:', error);
      // Fallback navigation
      setTimeout(() => {
        if (renditionRef.current && canGoNext) {
          renditionRef.current.next().catch(console.warn);
        }
      }, 100);
    }
  }, [canGoNext]);

  const goToPrev = useCallback(async () => {
    if (!renditionRef.current || !canGoPrev) return;
    
    try {
      await renditionRef.current.prev();
    } catch (error) {
      console.warn('Navigation error:', error);
      // Fallback navigation
      setTimeout(() => {
        if (renditionRef.current && canGoPrev) {
          renditionRef.current.prev().catch(console.warn);
        }
      }, 100);
    }
  }, [canGoPrev]);

  const handleViewerClick = useCallback((event: React.MouseEvent) => {
    if (!renditionRef.current) return;
    
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const centerX = rect.width / 2;
    
    if (x < centerX) {
      goToPrev();
    } else {
      goToNext();
    }
  }, [goToNext, goToPrev]);

  if (error) {
    return (
      <div className="reader-container error">
        <div className="error-message">
          <h3>Error loading book</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="reader-container loading">
        <div className="loading-message">
          <div className="spinner"></div>
          <p>Loading book...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="reader-container">
      <div 
        ref={viewerRef} 
        className="epub-viewer"
        onClick={handleViewerClick}
        style={{ height: '100%', width: '100%' }}
      />
      
      <div className="reader-controls">
        <button 
          onClick={goToPrev} 
          disabled={!canGoPrev}
          className="nav-button prev-button"
          aria-label="Previous page"
        >
          ←
        </button>
        <button 
          onClick={goToNext} 
          disabled={!canGoNext}
          className="nav-button next-button"
          aria-label="Next page"
        >
          →
        </button>
      </div>
      
      {migakuDetected && (
        <div className="migaku-status">
          Migaku extension detected - Enhanced compatibility enabled
        </div>
      )}
    </div>
  );
};
