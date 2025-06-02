import { useState, useEffect, useMemo, useCallback } from 'react';
import { Reader } from './components/Reader.tsx';
import { DirectEpubReader } from './components/DirectEpubReader';
import { ProgressBar } from './components/ProgressBar';
import { ThemeToggle } from './components/ThemeToggle';
import { googleDriveService } from './services/googleDrive';
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
  googleDriveId: string; 
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
    compactView: false,
    doublePageView: false // NEW: double page view setting
  });
  const [hiddenBooks, setHiddenBooks] = useState<Set<string>>(new Set());
  const [showHiddenBooks, setShowHiddenBooks] = useState<boolean>(false);
  const [isGoogleDriveAuthenticated, setIsGoogleDriveAuthenticated] = useState<boolean>(false);

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
          // Don't automatically restore the current book, just remember it
          // setCurrentBookId(appState.currentBookId);
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
    // Check Google Drive authentication status
    setIsGoogleDriveAuthenticated(googleDriveService.isAuthenticated());
  }, []); // Run once on mount

  // Load books from both localStorage and Google Drive
  useEffect(() => {
    const loadBooks = async () => {
      setError(null);
      if (!isGoogleDriveAuthenticated) {
        // Don't load books if not authenticated, show connect button instead
        setLibrary([]); // Clear library if not authenticated
        return;
      }
      try {
        console.log('📚 Loading books from storage...');
        
        // First load metadata from localStorage
        const storedBooksJson = localStorage.getItem(BOOKS_KEY);
        let storedBooks: Book[] = storedBooksJson ? JSON.parse(storedBooksJson) : [];
        
        // Then get list of books from Google Drive
        const driveBooks = await googleDriveService.listBooks();
        
        // Merge Google Drive books with stored books
        const updatedLibrary = driveBooks.map(driveBook => {
          // Try to find existing metadata
          const existingBook = storedBooks.find(stored => stored.googleDriveId === driveBook.id);
          if (existingBook) {
            return {
              ...existingBook,
              fileName: driveBook.fileName, // Update filename in case it changed in Drive
              // size and modifiedTime could also be updated if needed
            };
          }
          
          // Create new book entry if not found
          const fileType = driveBook.fileName.toLowerCase().endsWith('.pdf') ? 'pdf' as const : 'epub' as const;
          const newBook = {
            id: crypto.randomUUID(), // Use a local UUID for the book entry
            fileName: driveBook.fileName,
            coverUrl: null,
            googleDriveId: driveBook.id, // Store Google Drive file ID
            progress: 0,
            currentPage: 1,
            currentCfi: undefined,
            type: fileType
          } satisfies Book;
          return newBook;
        });
        
        setLibrary(updatedLibrary);
        
        // Restore last opened book (but don't auto-open, just remember for later)
        const lastBookId = localStorage.getItem(`${STORAGE_PREFIX}lastBookId`);
        if (lastBookId && updatedLibrary.some(b => b.id === lastBookId)) {
          // Don't automatically open the book, just remember it was the last one
          // setCurrentBookId(lastBookId);
        }

        // Save merged library back to localStorage
        localStorage.setItem(BOOKS_KEY, JSON.stringify(updatedLibrary));
        
        // Fetch cover art for books that don't have covers yet
        console.log('🎬 Starting cover fetching process...');
        await fetchMissingCovers(updatedLibrary);
        console.log('🎬 Cover fetching completed');
      } catch (error) {
        console.error('Error loading books from Google Drive:', error);
        if (error instanceof Error && error.message.includes('authentication expired')) {
          setIsGoogleDriveAuthenticated(false); // Update auth state
          setError('Google Drive session expired. Please reconnect.');
        } else {
          setError(error instanceof Error ? error.message : 'Failed to load books from Google Drive. Please check your connection and try again.');
        }
      }
    };

    loadBooks();
  }, [fetchMissingCovers, isGoogleDriveAuthenticated]); // Add isGoogleDriveAuthenticated


  // Memoize the getBookUrl function to prevent unnecessary re-renders
  const getBookUrlForCurrentBook = useCallback(async (): Promise<string> => {
    if (!currentBook) {
      throw new Error('No current book selected');
    }
    
    console.log(`📖 Getting URL for book: ${currentBook.fileName} (Google Drive ID: ${currentBook.googleDriveId})`);
    
    try {
      const url = await googleDriveService.getBookUrl(currentBook.googleDriveId);
      console.log(`✅ Successfully got book URL for ${currentBook.fileName}`);
      return url;
    } catch (error) {
      console.error(`❌ Failed to get book URL for ${currentBook.fileName}:`, error);
      throw error;
    }
  }, [currentBook]);

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

  // Handle progress updates from the reader
  const handleProgressUpdate = useCallback((bookId: string, progress: number, currentCfi: string, currentPage: number) => {
    console.log(`📊 Progress update received: ${bookId} - ${Math.round(progress * 100)}% (Page ${currentPage})`);
    
    setLibrary(prev => {
      const updatedLibrary = prev.map(book => 
        book.id === bookId 
          ? { ...book, progress, currentPage, currentCfi }
          : book
      );
      
      // Save to localStorage immediately
      localStorage.setItem(BOOKS_KEY, JSON.stringify(updatedLibrary));
      
      return updatedLibrary;
    });
  }, []);

  // Handle going back to library with immediate progress save
  const handleBackToLibrary = useCallback(() => {
    console.log('📚 Returning to library, ensuring progress is saved...');
    
    // Give a moment for any pending progress saves to complete
    setTimeout(() => {
      setCurrentBookId(null);
    }, 100);
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

  const handleConnectGoogleDrive = async () => {
    try {
      setError(null);
      const success = await googleDriveService.authenticate();
      setIsGoogleDriveAuthenticated(success);
      if (!success) {
        setError("Failed to connect to Google Drive.");
      }
    } catch (authError) {
      console.error("Google Drive authentication error:", authError);
      setError(authError instanceof Error ? authError.message : "Failed to connect to Google Drive.");
    }
  };

  const handleDisconnectGoogleDrive = () => {
    googleDriveService.disconnect();
    setIsGoogleDriveAuthenticated(false);
    setLibrary([]); // Clear library on disconnect
    setCurrentBookId(null); // Clear current book
    localStorage.removeItem(BOOKS_KEY); // Clear stored books
    localStorage.removeItem(`${STORAGE_PREFIX}lastBookId`); // Clear last book ID
    // Optionally, clear other related localStorage items
  };

  const handleRefreshLibrary = async () => {
    if (!isGoogleDriveAuthenticated) return;
    
    try {
      setError(null);
      console.log('🔄 Refreshing library...');
      
      // Clear cached folder ID to force a fresh search
      localStorage.removeItem('googleDriveBooksFolder');
      
      // Reload books
      const driveBooks = await googleDriveService.listBooks();
      console.log('📚 Refreshed books:', driveBooks);
      
      // Create new library from fresh data
      const updatedLibrary = driveBooks.map(driveBook => {
        const fileType = driveBook.fileName.toLowerCase().endsWith('.pdf') ? 'pdf' as const : 'epub' as const;
        return {
          id: crypto.randomUUID(),
          fileName: driveBook.fileName,
          coverUrl: null,
          googleDriveId: driveBook.id,
          progress: 0,
          currentPage: 1,
          currentCfi: undefined,
          type: fileType
        } satisfies Book;
      });
      
      setLibrary(updatedLibrary);
      localStorage.setItem(BOOKS_KEY, JSON.stringify(updatedLibrary));
      
    } catch (error) {
      console.error('Error refreshing library:', error);
      setError(error instanceof Error ? error.message : 'Failed to refresh library');
    }
  };

  // Listen for doublePageViewChange event and update app state
  useEffect(() => {
    const handler = (e: any) => {
      if (typeof e.detail === 'boolean') {
        setSettings(prev => ({ ...prev, doublePageView: e.detail }));
      }
    };
    window.addEventListener('doublePageViewChange', handler);
    return () => window.removeEventListener('doublePageViewChange', handler);
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
          
          
          
          <div className="reader-content">
            {currentBook.type === 'epub' ? (
              <DirectEpubReader
                book={currentBook}
                getBookUrl={getBookUrlForCurrentBook}
                onBackToLibrary={handleBackToLibrary}
                onProgressUpdate={handleProgressUpdate}
              />
            ) : (
              <Reader
                book={currentBook}
                getBookUrl={getBookUrlForCurrentBook}
                onBackToLibrary={handleBackToLibrary}
                onProgressUpdate={handleProgressUpdate}
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
          
          {!isGoogleDriveAuthenticated ? (
            <div className="google-drive-connect">
              <p>Connect to Google Drive to access your books.</p>
              <button onClick={handleConnectGoogleDrive} className="connect-button">
                Connect to Google Drive
              </button>
            </div>
          ) : library.length > 0 ? (
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
            // Updated message for when library is empty and authenticated
            <div className="empty-library-message">
              <p>No books found in your Google Drive 'books' folder.</p>
              <p>Add EPUB or PDF files to the 'books' folder in your Google Drive, then refresh the app.</p>
            </div>
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
                      {isGoogleDriveAuthenticated && (
                        <>
                          <button 
                            onClick={handleRefreshLibrary}
                            className="refresh-library-btn"
                          >
                            🔄 Refresh Library
                          </button>
                          <button 
                            onClick={() => fetchMissingCovers(library)}
                            className="fetch-covers-btn"
                            disabled={isLoadingCovers || library.filter(book => !book.coverUrl).length === 0}
                          >
                            {isLoadingCovers ? '⏳ Fetching Covers...' : `🖼️ Fetch Missing Covers (${library.filter(book => !book.coverUrl).length})`}
                          </button>
                        </>
                      )}
                      <button 
                        onClick={() => {
                          console.log('📚 Current library state:', library);
                          console.log('❌ Failed covers:', Array.from(failedCovers));
                          console.log('🔒 Hidden books:', Array.from(hiddenBooks));
                          console.log('📖 App state in localStorage:', localStorage.getItem(APP_STATE_KEY));
                          console.log('🔐 Google Drive auth status:', googleDriveService.isAuthenticated());
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

                  <div className="settings-section">
                    <h4>Google Drive</h4>
                    {isGoogleDriveAuthenticated ? (
                      <button onClick={handleDisconnectGoogleDrive} className="disconnect-button">
                        Disconnect Google Drive
                      </button>
                    ) : (
                      <button onClick={handleConnectGoogleDrive} className="connect-button">
                        Connect to Google Drive
                      </button>
                    )}
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
