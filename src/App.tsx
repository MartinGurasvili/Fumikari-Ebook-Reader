import { useState, useEffect, useMemo, useCallback } from 'react';
import { Reader } from './components/Reader.tsx';
import { DirectEpubReader } from './components/DirectEpubReader';
import { FileDrop } from './components/FileDrop';
import { ProgressBar } from './components/ProgressBar';
import { ThemeToggle } from './components/ThemeToggle';
import { uploadToS3, getSignedBookUrl, listBooksInS3 } from './services/s3';
import { CoverArtService } from './services/coverArt';
import './App.css';

const BOOKS_KEY = 'reader-books';
const STORAGE_PREFIX = 'reader-';
const APP_STATE_KEY = 'reader-app-state';

// Utility function to clean up book title display
const getCleanBookTitle = (fileName: string): string => {
  return fileName.replace(/\.(epub|pdf|txt|mobi|azw3?)$/i, '').trim();
};

export interface Book {
  id: string;
  fileName: string;
  coverUrl: string | null;
  s3Key: string; // Changed from fileData to s3Key
  progress: number;
  currentPage: number;
  currentCfi?: string;
  type: 'epub' | 'pdf';
}

function App() {
  console.log('🚀 App component loaded');
  const [library, setLibrary] = useState<Book[]>([]);
  const [currentBookId, setCurrentBookId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedCovers, setFailedCovers] = useState<Set<string>>(new Set());
  const [isLoadingCovers, setIsLoadingCovers] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [settings, setSettings] = useState({
    hideDebugButtons: false,
    hideCoverFetchButton: false,
    compactView: false
  });
  const [hiddenBooks, setHiddenBooks] = useState<Set<string>>(new Set());
  const [showHiddenBooks, setShowHiddenBooks] = useState<boolean>(false);

  const currentBook = useMemo(() => 
    library.find(book => book.id === currentBookId),
    [library, currentBookId]
  );

  // Separate visible and hidden books
  const visibleBooks = useMemo(() => 
    library.filter(book => !hiddenBooks.has(book.id)),
    [library, hiddenBooks]
  );

  const hiddenBooksArray = useMemo(() => 
    library.filter(book => hiddenBooks.has(book.id)),
    [library, hiddenBooks]
  );

  // Function to fetch missing cover art for existing books
  const fetchMissingCovers = useCallback(async (books: Book[]) => {
    const booksNeedingCovers = books.filter(book => !book.coverUrl);
    
    if (booksNeedingCovers.length === 0) {
      console.log('📚 All books already have cover art');
      return;
    }
    
    console.log(`🖼️ Fetching cover art for ${booksNeedingCovers.length} books...`);
    setIsLoadingCovers(true);
    
    // Process books in batches to avoid rate limiting
    const batchSize = 3;
    for (let i = 0; i < booksNeedingCovers.length; i += batchSize) {
      const batch = booksNeedingCovers.slice(i, i + batchSize);
      
      const processBook = async (book: Book) => {
        try {
          console.log(`🔍 Processing cover for: "${book.fileName}"`);
          const bookInfo = CoverArtService.extractBookInfo(book.fileName);
          console.log(`📖 Extracted book info:`, bookInfo);
          
          const coverResult = await CoverArtService.searchCover(bookInfo.title, bookInfo.author);
          console.log(`🖼️ Cover search result:`, coverResult);
          
          if (coverResult && await CoverArtService.validateCoverUrl(coverResult.coverUrl)) {
            console.log(`✅ Found valid cover for "${book.fileName}" from ${coverResult.source}: ${coverResult.coverUrl}`);
            
            setLibrary(prev => {
              const updated = prev.map(b => 
                b.id === book.id ? { ...b, coverUrl: coverResult.coverUrl } : b
              );
              console.log(`📚 Updated library for book ${book.id}:`, updated.find(b => b.id === book.id));
              return updated;
            });
            
            return true;
          } else {
            console.log(`❌ No valid cover found for "${book.fileName}" (validation failed or no result)`);
          }
        } catch (error) {
          console.warn(`❌ Failed to fetch cover for "${book.fileName}":`, error);
        }
        return false;
      };
      
      await Promise.all(batch.map(processBook));
      
      // Small delay between batches
      if (i + batchSize < booksNeedingCovers.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    setIsLoadingCovers(false);
  }, [setLibrary]);

  // Load app state first (settings, hidden books, etc.)
  useEffect(() => {
    const appStateJson = localStorage.getItem(APP_STATE_KEY);
    
    if (appStateJson) {
      try {
        const appState = JSON.parse(appStateJson);
        
        if (appState.currentBookId) {
          setCurrentBookId(appState.currentBookId);
        }
        if (appState.settings) {
          setSettings(appState.settings);
        }
        if (appState.hiddenBooks && Array.isArray(appState.hiddenBooks)) {
          setHiddenBooks(new Set(appState.hiddenBooks));
        }
      } catch (error) {
        console.error('Error loading app state:', error);
      }
    }
  }, []); // Run once on mount

  // Load books from both localStorage and S3
  useEffect(() => {
    const loadBooks = async () => {
      setError(null);
      try {
        console.log('📚 Loading books from storage...');
        
        // First load metadata from localStorage
        const storedBooksJson = localStorage.getItem(BOOKS_KEY);
        let storedBooks: Book[] = storedBooksJson ? JSON.parse(storedBooksJson) : [];
        
        // Then get list of books from S3
        const s3Books = await listBooksInS3();
        
        // Merge S3 books with stored books
        const updatedLibrary = s3Books.map(s3Book => {
          // Try to find existing metadata
          const existingBook = storedBooks.find(stored => stored.s3Key === s3Book.key);
          if (existingBook) {
            return existingBook;
          }
          
          // Create new book entry if not found
          const fileType = s3Book.fileName.toLowerCase().endsWith('.pdf') ? 'pdf' as const : 'epub' as const;
          const newBook = {
            id: crypto.randomUUID(),
            fileName: s3Book.fileName,
            coverUrl: null,
            s3Key: s3Book.key,
            progress: 0,
            currentPage: 1,
            currentCfi: undefined,
            type: fileType
          } satisfies Book;
          return newBook;
        });

        // FOR TESTING: Add multiple mock books if library is empty
        if (updatedLibrary.length === 0) {
          console.log('📖 No books found, adding mock books for testing...');
          const mockBooks: Book[] = [
            {
              id: 'test-book-1',
              fileName: 'The Great Gatsby - F. Scott Fitzgerald.epub',
              coverUrl: null,
              s3Key: 'test/gatsby.epub',
              progress: 0.3,
              currentPage: 5,
              type: 'epub'
            },
            {
              id: 'test-book-2',
              fileName: 'To Kill a Mockingbird - Harper Lee.epub',
              coverUrl: null,
              s3Key: 'test/mockingbird.epub',
              progress: 0.7,
              currentPage: 12,
              type: 'epub'
            },
            {
              id: 'test-book-3',
              fileName: '1984 by George Orwell.epub',
              coverUrl: null,
              s3Key: 'test/1984.epub',
              progress: 0.1,
              currentPage: 2,
              type: 'epub'
            },
            {
              id: 'test-book-4',
              fileName: 'Pride and Prejudice - Jane Austen.epub',
              coverUrl: null,
              s3Key: 'test/pride.epub',
              progress: 0.5,
              currentPage: 8,
              type: 'epub'
            },
            {
              id: 'test-book-5',
              fileName: 'The Catcher in the Rye - J.D. Salinger.pdf',
              coverUrl: null,
              s3Key: 'test/catcher.pdf',
              progress: 0.2,
              currentPage: 3,
              type: 'pdf'
            }
          ];
          updatedLibrary.push(...mockBooks);
          console.log('✅ Mock books added for testing');
        }
        
        setLibrary(updatedLibrary);
        
        // Restore last opened book
        const lastBookId = localStorage.getItem(`${STORAGE_PREFIX}lastBookId`);
        if (lastBookId && updatedLibrary.some(b => b.id === lastBookId)) {
          setCurrentBookId(lastBookId);
        }

        // Save merged library back to localStorage
        localStorage.setItem(BOOKS_KEY, JSON.stringify(updatedLibrary));
        
        // Fetch cover art for books that don't have covers yet (always run for testing)
        console.log('🎬 Starting cover fetching process...');
        await fetchMissingCovers(updatedLibrary);
        console.log('🎬 Cover fetching completed');
      } catch (error) {
        console.error('Error loading books:', error);
        setError(error instanceof Error ? error.message : 'Failed to load books. Please check your connection and try again.');
      }
    };

    loadBooks();
  }, [fetchMissingCovers]); // Add fetchMissingCovers as dependency to prevent stale closure


  const handleLocationChange = useCallback((bookId: string, cfi: string): void => {
    setLibrary(prev => prev.map(book => {
      if (book.id !== bookId) return book;
      
      // Extract page number from CFI if it's from DirectEpubReader
      let currentPage = book.currentPage;
      if (cfi.startsWith('page-')) {
        const pageIndex = parseInt(cfi.replace('page-', ''));
        if (!isNaN(pageIndex)) {
          currentPage = pageIndex + 1; // Convert 0-based index to 1-based page number
        }
      }
      
      return { ...book, currentCfi: cfi, currentPage };
    }));
  }, []);

  const handleProgressUpdate = useCallback((bookId: string, progress: number): void => {
    setLibrary(prev => prev.map(book => 
      book.id === bookId ? { ...book, progress } : book
    ));
  }, []);

  // Memoize the getBookUrl function to prevent unnecessary re-renders
  const getBookUrlForCurrentBook = useCallback(async (): Promise<string> => {
    if (!currentBook) {
      throw new Error('No current book selected');
    }
    
    // FOR TESTING: Return a fake URL for mock books
    if (currentBook.id === 'test-book-1') {
      console.log('📖 Returning mock URL for test book');
      return 'data:text/plain;base64,UEsDBAoAAAAAA'; // Invalid but won't crash
    }
    
    return await getSignedBookUrl(currentBook.s3Key);
  }, [currentBook]);

  // Memoize the callback functions to prevent DirectEpubReader from remounting
  const handleCurrentBookLocationChange = useCallback((cfi: string) => {
    if (currentBookId) {
      handleLocationChange(currentBookId, cfi);
    }
  }, [currentBookId, handleLocationChange]);

  const handleCurrentBookProgressUpdate = useCallback((progress: number) => {
    if (currentBookId) {
      handleProgressUpdate(currentBookId, progress);
    }
  }, [currentBookId, handleProgressUpdate]);

  const handleFileDrop = useCallback(async (file: File) => {
    try {
      setError(null);
      
      // Generate a unique key for S3
      const s3Key = `books/${crypto.randomUUID()}/${file.name}`;
      
      // Upload file to S3
      await uploadToS3(file, s3Key);

      // Extract book info for cover art search
      const bookInfo = CoverArtService.extractBookInfo(file.name);
      
      // Try to fetch cover art
      let coverUrl: string | null = null;
      try {
        const coverResult = await CoverArtService.searchCover(bookInfo.title, bookInfo.author);
        if (coverResult && await CoverArtService.validateCoverUrl(coverResult.coverUrl)) {
          coverUrl = coverResult.coverUrl;
          console.log(`✅ Found cover art from ${coverResult.source}:`, coverUrl);
        }
      } catch (coverError) {
        console.warn('Failed to fetch cover art:', coverError);
      }

      const newBook: Book = {
        id: crypto.randomUUID(),
        fileName: file.name,
        coverUrl,
        s3Key,
        progress: 0,
        currentPage: 1,
        type: file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'epub'
      };

      setLibrary(prev => [...prev, newBook]);
      setCurrentBookId(newBook.id);
    } catch (error) {
      console.error('Error processing file:', error);
      setError(error instanceof Error ? error.message : 'Failed to upload book. Please try again.');
    }
  }, []);

  // Persist library changes
  useEffect(() => {
    if (library.length > 0) {
      localStorage.setItem(BOOKS_KEY, JSON.stringify(library));
    }
  }, [library]);

  // Persist current book
  useEffect(() => {
    if (currentBookId) {
      localStorage.setItem(`${STORAGE_PREFIX}lastBookId`, currentBookId);
    }
  }, [currentBookId]);

  // Save app state to localStorage
  const saveAppState = useCallback(() => {
    const appState = {
      currentBookId,
      settings,
      hiddenBooks: Array.from(hiddenBooks)
    };
    localStorage.setItem(APP_STATE_KEY, JSON.stringify(appState));
  }, [currentBookId, settings, hiddenBooks]);

  // Save state when any relevant state changes
  useEffect(() => {
    saveAppState();
  }, [saveAppState]);

  // Handle escape key to close settings
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showSettings) {
        setShowSettings(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showSettings]);

  const handleBookSelect = useCallback((bookId: string) => {
    setCurrentBookId(bookId);
  }, []);

  // Book management functions
  const handleHideBook = useCallback((bookId: string) => {
    setHiddenBooks(prev => new Set(prev).add(bookId));
  }, []);

  const handleShowBook = useCallback((bookId: string) => {
    setHiddenBooks(prev => {
      const newSet = new Set(prev);
      newSet.delete(bookId);
      return newSet;
    });
  }, []);

  // Handle image loading errors
  const handleImageError = useCallback((bookId: string, coverUrl: string) => {
    console.warn(`❌ Failed to load cover for book ${bookId}: ${coverUrl}`);
    setFailedCovers(prev => new Set(prev).add(bookId));
    
    // Clear the cover URL from the book to prevent retry
    setLibrary(prev => prev.map(book => 
      book.id === bookId ? { ...book, coverUrl: null } : book
    ));
  }, []);

  // Handle successful image load
  const handleImageLoad = useCallback((bookId: string, coverUrl: string) => {
    console.log(`✅ Successfully loaded cover for book ${bookId}: ${coverUrl}`);
    setFailedCovers(prev => {
      const newSet = new Set(prev);
      newSet.delete(bookId);
      return newSet;
    });
  }, []);

  return (
    <div className="app">
      {error ? (
        <div className="error-message" role="alert">
          {error}
          <button 
            onClick={() => window.location.reload()}
            className="retry-button"
          >
            Retry
          </button>
        </div>
      ) : currentBook ? (
        <div className="reader-view">
          {/* Back button to return to library */}
          <button 
              onClick={() => setCurrentBookId(null)}
              className="back-button"
              aria-label="Back to library"
            >
              ← Back to Library
            </button>
          
          
          <div className="reader-content">
            {currentBook.type === 'epub' ? (
              <DirectEpubReader
                book={currentBook}
                getBookUrl={getBookUrlForCurrentBook}
                onLocationChange={handleCurrentBookLocationChange}
                onProgressUpdate={handleCurrentBookProgressUpdate}
                onBackToLibrary={() => setCurrentBookId(null)}
              />
            ) : (
              <Reader
                book={currentBook}
                getBookUrl={getBookUrlForCurrentBook}
                onLocationChange={handleCurrentBookLocationChange}
                onProgressUpdate={handleCurrentBookProgressUpdate}
                onBackToLibrary={() => setCurrentBookId(null)}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="library-view">
          <div className="library-header">
            <h1>Your Books</h1>
            <div className="header-controls">
              <button 
                onClick={() => setShowSettings(!showSettings)}
                className="settings-button"
                aria-label="Settings"
                title="Settings"
              >
                ⚙️
              </button>
              <ThemeToggle />
            </div>
          </div>
          
          {library.length > 0 ? (
            <>
              {/* Visible Books */}
              <div className={`book-grid ${settings.compactView ? 'compact' : ''}`}>
                {visibleBooks.map(book => (
                  <div 
                    key={book.id}
                    className={`book-card ${settings.compactView ? 'compact' : ''}`}
                    role="button"
                    tabIndex={0}
                  >
                    <div 
                      className="book-content"
                      onClick={() => handleBookSelect(book.id)}
                    >
                      <div className="book-cover">
                        {book.coverUrl && !failedCovers.has(book.id) ? (
                          <img 
                            src={book.coverUrl} 
                            alt={`Cover of ${getCleanBookTitle(book.fileName)}`}
                            onLoad={() => handleImageLoad(book.id, book.coverUrl!)}
                            onError={() => handleImageError(book.id, book.coverUrl!)}
                          />
                        ) : null}
                        <div 
                          className="book-cover-placeholder"
                          style={{ 
                            display: (book.coverUrl && !failedCovers.has(book.id)) ? 'none' : 'flex' 
                          }}
                        >
                          <span>{getCleanBookTitle(book.fileName).charAt(0).toUpperCase()}</span>
                        </div>
                      </div>
                      <div className="book-info">
                        <h3>{getCleanBookTitle(book.fileName)}</h3>
                        <div className="book-progress">
                          <ProgressBar progress={book.progress} />
                        </div>
                      </div>
                    </div>
                    <button
                      className="book-action-button hide-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleHideBook(book.id);
                      }}
                      aria-label={`Hide ${getCleanBookTitle(book.fileName)}`}
                      title="Hide book"
                    >
                      👁️‍🗨️
                    </button>
                  </div>
                ))}
              </div>

              {/* Hidden Books Section */}
              {hiddenBooksArray.length > 0 && (
                <div className="hidden-books-section">
                  <button
                    className="hidden-books-toggle"
                    onClick={() => setShowHiddenBooks(!showHiddenBooks)}
                    aria-expanded={showHiddenBooks}
                  >
                    <span>Hidden Books ({hiddenBooksArray.length})</span>
                    <span className={`toggle-icon ${showHiddenBooks ? 'expanded' : ''}`}>▼</span>
                  </button>
                  
                  {showHiddenBooks && (
                    <div className={`book-grid hidden-books ${settings.compactView ? 'compact' : ''}`}>
                      {hiddenBooksArray.map(book => (
                        <div 
                          key={book.id}
                          className={`book-card hidden ${settings.compactView ? 'compact' : ''}`}
                          role="button"
                          tabIndex={0}
                        >
                          <div 
                            className="book-content"
                            onClick={() => handleBookSelect(book.id)}
                          >
                            <div className="book-cover">
                              {book.coverUrl && !failedCovers.has(book.id) ? (
                                <img 
                                  src={book.coverUrl} 
                                  alt={`Cover of ${getCleanBookTitle(book.fileName)}`}
                                  onLoad={() => handleImageLoad(book.id, book.coverUrl!)}
                                  onError={() => handleImageError(book.id, book.coverUrl!)}
                                />
                              ) : null}
                              <div 
                                className="book-cover-placeholder"
                                style={{ 
                                  display: (book.coverUrl && !failedCovers.has(book.id)) ? 'none' : 'flex' 
                                }}
                              >
                                <span>{getCleanBookTitle(book.fileName).charAt(0).toUpperCase()}</span>
                              </div>
                            </div>
                            <div className="book-info">
                              <h3>{getCleanBookTitle(book.fileName)}</h3>
                              <div className="book-progress">
                                <ProgressBar progress={book.progress} />
                              </div>
                            </div>
                          </div>
                          <button
                            className="book-action-button show-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleShowBook(book.id);
                            }}
                            aria-label={`Show ${getCleanBookTitle(book.fileName)}`}
                            title="Show book"
                          >
                            👁️
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <FileDrop onFileDrop={handleFileDrop} />
          )}
          
          {/* Settings Panel Overlay */}
          {showSettings && (
            <>
              <div 
                className="settings-overlay"
                onClick={() => setShowSettings(false)}
                aria-hidden="true"
              />
              <div className="settings-panel">
                <div className="settings-header">
                  <h3>Library Settings</h3>
                  <button
                    className="close-settings-button"
                    onClick={() => setShowSettings(false)}
                    aria-label="Close settings"
                  >
                    ✕
                  </button>
                </div>
                
                <div className="settings-content">
                  <div className="settings-section">
                    <h4>Display Options</h4>
                    <div className="settings-grid">
                      <label className="setting-item">
                        <input
                          type="checkbox"
                          checked={settings.compactView}
                          onChange={(e) => setSettings(prev => ({ ...prev, compactView: e.target.checked }))}
                        />
                        <span>Compact view</span>
                      </label>
                    </div>
                  </div>

                  <div className="settings-section">
                    <h4>Library Actions</h4>
                    <div className="library-actions">
                      <button 
                        onClick={() => fetchMissingCovers(library)}
                        className="fetch-covers-btn"
                        disabled={isLoadingCovers || library.filter(book => !book.coverUrl).length === 0}
                      >
                        {isLoadingCovers ? '⏳ Fetching Covers...' : `🖼️ Fetch Missing Covers (${library.filter(book => !book.coverUrl).length})`}
                      </button>
                      <button 
                        onClick={() => {
                          console.log('📚 Current library state:', library);
                          console.log('❌ Failed covers:', Array.from(failedCovers));
                          console.log('🔒 Hidden books:', Array.from(hiddenBooks));
                          console.log('📖 App state in localStorage:', localStorage.getItem(APP_STATE_KEY));
                          library.forEach(book => {
                            console.log(`📖 Book "${book.fileName}": coverUrl="${book.coverUrl}", failed=${failedCovers.has(book.id)}, hidden=${hiddenBooks.has(book.id)}`);
                          });
                        }}
                        className="debug-btn"
                      >
                        🐛 Debug State
                      </button>
                    </div>
                  </div>

                  
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
