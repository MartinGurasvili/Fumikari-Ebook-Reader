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
  onBackToLibrary?: () => void;
  onProgressUpdate?: (bookId: string, progress: number, currentCfi: string, currentPage: number) => void;
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
  
  // Japanese detection
  if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(sample)) {
    return 'ja';
  }
  
  // Chinese detection
  if (/[\u4E00-\u9FFF]/.test(sample)) {
    return 'zh';
  }
  
  // Korean detection
  if (/[\uAC00-\uD7AF]/.test(sample)) {
    return 'ko';
  }
  
  // Spanish detection
  if (/\b(el|la|los|las|un|una|de|en|que|y|es|se|no|te|lo|le|da|su|por|son|con|para|al|una|su|del|las|la|una|es|en|él|ese|era|hasta|sin|sobre|ser|tiene|durante|antes|lugar|ella|caso|tiempo|persona|año|día|mundo|vida|hombre|estado|parte|niño|contra|esto|algo|alguien|yo|muy|puede|decir|cada|gran|aquí|donde|bien|poco|todo|mismo|otro|mucho|tanto|menos|mejor|mayor|mientras|cualquier|sea|bajo|manera|desde|cuando|hacer|cada|poder|gobierno|país|grupo|trabajo|mano|número|parte|sistema|caso|ser|haber|hacer|tener|decir|ir|saber|ver|dar|quedar|estar|poder|poner|pasar|llamar|llegar|deber|parecer|creer|seguir|llevar|dejar|sentir|hablar|traer|vivir|morir|escuchar|pedir|caer|leer|conocer|empezar|servir|sacar|necesitar|mantener|resultar|parecer|comenzar|encontrar|convertir|conseguir|recordar|terminar|permitir|aparecer|crear|considerar|ganar|suponer|entender|volver|desarrollar|escribir|perder|producir|ocurrir|ofrecer|recibir|cambiar|presentar|explicar|abrir|decidir|cerrar|salir|venir|realizar|intentar|usar|jugar|pensar|estudiar|incluir|continuar|establecer|añadir|formar|aplicar|aprender|responder|trabajar|ayudar|existir)\\b/.test(sample)) {
    return 'es';
  }
  
  // French detection
  if (/\b(le|de|et|à|un|il|être|et|en|avoir|que|pour|dans|ce|son|une|sur|avec|ne|se|pas|tout|plus|pouvoir|par|je|son|que|bien|autre|après|savoir|grand|prendre|aller|voir|en|faire|sans|deux|très|là|venir|un|où|homme|même|dire|elle|temps|quel|eau|peu|sous|écrire|tenir|jouer|ou|comme|donner|mais|demander|grande|premier|fois)\\b/.test(sample)) {
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
  onBackToLibrary,
  onProgressUpdate,
}) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<any>(null);
  const bookRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canGoNext, setCanGoNext] = useState(false);
  const [canGoPrev, setCanGoPrev] = useState(false);
  const [migakuDetected, setMigakuDetected] = useState(false);
  const [currentProgress, setCurrentProgress] = useState(book.progress);

  // Debounced progress saving to avoid too frequent updates
  const saveProgressTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const lastSavedProgressRef = useRef<{ progress: number; cfi: string; page: number } | null>(null);
  
  const saveProgress = useCallback((cfi: string, progress: number, page: number) => {
    // Update local state immediately
    setCurrentProgress(progress);
    
    // Skip if progress hasn't changed significantly
    const lastSaved = lastSavedProgressRef.current;
    if (lastSaved && 
        Math.abs(lastSaved.progress - progress) < 0.01 && 
        lastSaved.cfi === cfi) {
      return;
    }
    
    if (saveProgressTimeoutRef.current) {
      clearTimeout(saveProgressTimeoutRef.current);
    }
    
    saveProgressTimeoutRef.current = setTimeout(() => {
      try {
        if (onProgressUpdate) {
          onProgressUpdate(book.id, progress, cfi, page);
          lastSavedProgressRef.current = { progress, cfi, page };
          console.log(`✅ Progress saved: ${Math.round(progress * 100)}% (Page ${page}, CFI: ${cfi.substring(0, 50)}...)`);
        } else {
          console.warn('⚠️ onProgressUpdate callback not provided - progress not saved');
        }
      } catch (error) {
        console.error('❌ Failed to save progress:', error);
      }
    }, 1000); // Save after 1 second of no navigation
  }, [book.id, onProgressUpdate]);

  // Immediate progress save function for critical moments
  const saveProgressImmediately = useCallback((cfi: string, progress: number, page: number) => {
    try {
      setCurrentProgress(progress);
      if (onProgressUpdate) {
        onProgressUpdate(book.id, progress, cfi, page);
        lastSavedProgressRef.current = { progress, cfi, page };
        console.log(`🚀 Progress saved immediately: ${Math.round(progress * 100)}% (Page ${page})`);
      }
    } catch (error) {
      console.error('❌ Failed to save progress immediately:', error);
    }
  }, [book.id, onProgressUpdate]);

  // Manual progress calculation helper
  const calculateCurrentProgress = useCallback(() => {
    try {
      if (!renditionRef.current || !bookRef.current?.locations?.total) {
        return null;
      }
      
      const currentLocation = renditionRef.current.currentLocation();
      if (!currentLocation?.start) {
        return null;
      }
      
      const currentLocationIndex = currentLocation.start.location;
      const totalLocations = bookRef.current.locations.total;
      const progress = Math.max(0, Math.min(1, currentLocationIndex / totalLocations));
      const currentCfi = currentLocation.start.cfi;
      
      // Get current page number from spine
      const spineItem = bookRef.current.spine.get(currentLocation.start.href);
      const currentPage = spineItem ? bookRef.current.spine.items.indexOf(spineItem) + 1 : 1;
      
      return { progress, currentCfi, currentPage };
    } catch (error) {
      console.warn('Failed to calculate current progress:', error);
      return null;
    }
  }, []);

  // Navigation functions with explicit progress tracking
  const goToNext = useCallback(async () => {
    if (!renditionRef.current || !canGoNext) return;
    try {
      await renditionRef.current.next();
      
      // Force progress calculation after navigation
      setTimeout(() => {
        const progressData = calculateCurrentProgress();
        if (progressData) {
          console.log('📍 Manual progress update after next navigation');
          saveProgress(progressData.currentCfi, progressData.progress, progressData.currentPage);
        }
      }, 100);
    } catch (err) {
      console.warn('Error navigating to next page:', err);
      // Fallback navigation
      if (renditionRef.current && canGoNext) {
        renditionRef.current.next().catch(console.warn);
      }
    }
  }, [canGoNext, calculateCurrentProgress, saveProgress]);

  const goToPrev = useCallback(async () => {
    if (!renditionRef.current || !canGoPrev) return;
    try {
      await renditionRef.current.prev();
      
      // Force progress calculation after navigation
      setTimeout(() => {
        const progressData = calculateCurrentProgress();
        if (progressData) {
          console.log('📍 Manual progress update after prev navigation');
          saveProgress(progressData.currentCfi, progressData.progress, progressData.currentPage);
        }
      }, 100);
    } catch (err) {
      console.warn('Error navigating to previous page:', err);
      // Fallback navigation
      if (renditionRef.current && canGoPrev) {
        renditionRef.current.prev().catch(console.warn);
      }
    }
  }, [canGoPrev, calculateCurrentProgress, saveProgress]);

  // Initialize EPUB reader
  useEffect(() => {
    if (!viewerRef.current) return;
    
    // Prevent double initialization in React Strict Mode
    if (renditionRef.current) {
      console.log('Reader already initialized, skipping');
      return;
    }

    let isMounted = true;
    let blobUrl: string | null = null;
    
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
        blobUrl = url; // Store for cleanup

        // Create a new book instance
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

        // Initial display
        await rendition.display(book.currentCfi || undefined);

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
                const checkAndEnhance = () => {
                  try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                    if (iframeDoc && iframeDoc.readyState === 'complete') {
                      enhanceIframeContent(iframe, iframeDoc);
                      extractTextForMigaku(iframe, iframeDoc, index);
                    }
                  } catch (e) {
                    console.warn('Cannot access iframe content due to security restrictions:', e);
                  }
                };

                if (iframe.contentDocument || iframe.contentWindow) {
                  checkAndEnhance();
                } else {
                  iframe.addEventListener('load', checkAndEnhance);
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

        // Set up event handlers
        const handleKeyNavigation = (event: KeyboardEvent) => {
          if (event.key === 'ArrowLeft' && canGoPrev) {
            event.preventDefault();
            goToPrev();
          } else if (event.key === 'ArrowRight' && canGoNext) {
            event.preventDefault();
            goToNext();
          } else if (event.key === 'Escape' && onBackToLibrary) {
            onBackToLibrary();
          }
        };

        // Generate locations for progress tracking
        await epubBook.locations.generate(1024);
        console.log(`📍 Generated ${epubBook.locations.total} locations for progress tracking`);

        // Enhanced relocated handler with progress saving
        const handleRelocated = (location: any) => {
          console.log('📍 Relocated event fired:', location);
          setCanGoNext(!location?.atEnd);
          setCanGoPrev(!location?.atStart);
          
          // Calculate and save progress
          if (location && epubBook.locations.total > 0) {
            const currentLocation = location.start.location;
            const totalLocations = epubBook.locations.total;
            const progress = Math.max(0, Math.min(1, currentLocation / totalLocations));
            const currentCfi = location.start.cfi;
            
            // Get current page number from spine
            const spineItem = epubBook.spine.get(location.start.href);
            const currentPage = spineItem ? epubBook.spine.items.indexOf(spineItem) + 1 : 1;
            
            console.log(`📍 Reader relocated: ${Math.round(progress * 100)}% (${currentLocation}/${totalLocations}), Page ${currentPage}`);
            
            // Save progress with debouncing
            saveProgress(currentCfi, progress, currentPage);
          } else {
            console.warn('⚠️ Location data incomplete for progress tracking:', location);
          }
        };

        rendition.on('relocated', handleRelocated);

        // Apply Migaku enhancements when content is rendered
        setTimeout(enhanceMigakuCompatibility, 500);

        rendition.on('rendered', () => {
          setTimeout(enhanceMigakuCompatibility, 300);
        });

        rendition.on('keyup', handleKeyNavigation);

        setIsLoading(false);
        console.log('EPUB reader initialized successfully with progress tracking');

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
      
      // Save progress immediately on unmount
      if (renditionRef.current && bookRef.current?.locations?.total > 0) {
        try {
          const currentLocation = renditionRef.current.currentLocation();
          if (currentLocation?.start) {
            const progress = currentLocation.start.location / bookRef.current.locations.total;
            const spineItem = bookRef.current.spine.get(currentLocation.start.href);
            const currentPage = spineItem ? bookRef.current.spine.items.indexOf(spineItem) + 1 : 1;
            
            console.log('💾 Saving progress on unmount...');
            saveProgressImmediately(currentLocation.start.cfi, progress, currentPage);
          }
        } catch (error) {
          console.warn('Failed to save progress on unmount:', error);
        }
      }
      
      // Clear any pending progress saves
      if (saveProgressTimeoutRef.current) {
        clearTimeout(saveProgressTimeoutRef.current);
      }
      
      // Clean up blob URL to prevent memory leaks
      if (blobUrl && blobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(blobUrl);
        console.log('🧹 Cleaned up blob URL:', blobUrl);
      }
      
      // Clean up text mirrors
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
    };
  }, [book.id, book.currentCfi, getBookUrl, onBackToLibrary, saveProgress, saveProgressImmediately, goToNext, goToPrev]);

  // Handle viewer clicks for navigation
  const handleViewerClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    
    // Don't navigate if clicking on interactive elements
    if (target.tagName === 'A' || target.tagName === 'BUTTON' || target.closest('a, button')) {
      return;
    }
    
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const width = rect.width;
    
    // Click on left side goes to previous page, right side goes to next page
    if (x < width * 0.3 && canGoPrev) {
      goToPrev();
    } else if (x > width * 0.7 && canGoNext) {
      goToNext();
    }
  }, [canGoPrev, canGoNext, goToPrev, goToNext]);

  if (isLoading) {
    return (
      <div className="reader-container loading">
        <div className="reader-header">
          <button 
            onClick={onBackToLibrary}
            className="back-button"
            aria-label="Back to Library"
          >
            ← Back to Library
          </button>
          <h1 className="book-title">{book.fileName}</h1>
        </div>
        <div className="reader-loading">
          <div className="loading-spinner" aria-hidden="true"></div>
          <p>Loading your book...</p>
          {migakuDetected && (
            <p className="migaku-status">Migaku extension detected - enhanced features enabled</p>
          )}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="reader-container error">
        <div className="reader-header">
          <button 
            onClick={onBackToLibrary}
            className="back-button"
            aria-label="Back to Library"
          >
            ← Back to Library
          </button>
          <h1 className="book-title">{book.fileName}</h1>
        </div>
        <div className="reader-error">
          <h2>Failed to Load Book</h2>
          <p>{error}</p>
          <button onClick={onBackToLibrary} className="retry-button">
            Return to Library
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="reader-container">
      <div className="reader-header">
        <button 
          onClick={onBackToLibrary}
          className="back-button"
          aria-label="Back to Library"
        >
          ← Back to Library
        </button>
        <h1 className="book-title">{book.fileName}</h1>
        <div className="progress-info">
          <span className="progress-text">
            {Math.round(currentProgress * 100)}% complete
          </span>
          {migakuDetected && (
            <span className="migaku-indicator" title="Migaku extension active">
              🔤
            </span>
          )}
        </div>
      </div>
      
      <div className="reader-content">
        <div 
          ref={viewerRef}
          className="epub-viewer"
          onClick={handleViewerClick}
          role="main"
          aria-label="Book content"
          tabIndex={0}
        />
        
        <div className="reader-controls">
          <button
            onClick={goToPrev}
            disabled={!canGoPrev}
            className="nav-button prev-button"
            aria-label="Previous page"
          >
            ← Previous
          </button>
          
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${currentProgress * 100}%` }}
              aria-hidden="true"
            />
          </div>
          
          <button
            onClick={goToNext}
            disabled={!canGoNext}
            className="nav-button next-button"
            aria-label="Next page"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
};
