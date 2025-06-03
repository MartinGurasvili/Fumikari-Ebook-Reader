// Cover art fetching service using Open Library API
export interface CoverSearchResult {
  coverUrl: string;
  source: string;
}

export class CoverArtService {
  private static readonly OPEN_LIBRARY_BASE = 'https://covers.openlibrary.org/b';
  private static readonly GOOGLE_BOOKS_API = 'https://www.googleapis.com/books/v1/volumes';
  
  // Fallback covers for famous books - updated to higher resolution
  private static readonly FALLBACK_COVERS: Record<string, string> = {
    'the great gatsby': 'https://covers.openlibrary.org/b/isbn/9780743273565-L.jpg',
    'to kill a mockingbird': 'https://covers.openlibrary.org/b/isbn/9780060935467-L.jpg',
    '1984': 'https://covers.openlibrary.org/b/isbn/9780451524935-L.jpg',
    'pride and prejudice': 'https://covers.openlibrary.org/b/isbn/9780141439518-L.jpg',
    'the catcher in the rye': 'https://covers.openlibrary.org/b/isbn/9780316769174-L.jpg',
    'animal farm': 'https://covers.openlibrary.org/b/isbn/9780451526342-L.jpg',
    'brave new world': 'https://covers.openlibrary.org/b/isbn/9780060850524-L.jpg',
    'lord of the flies': 'https://covers.openlibrary.org/b/isbn/9780571056866-L.jpg'
  };
  
  /**
   * Search for book cover by title and author
   */
  static async searchCover(title: string, author?: string): Promise<CoverSearchResult | null> {
    try {
      console.log(`🔍 Searching cover for: "${title}" by "${author || 'Unknown'}"`);
      
      // First try Google Books API for highest quality images
      const googleCover = await this.searchGoogleBooks(title, author);
      if (googleCover) {
        console.log(`✅ Found high-res cover via Google Books:`, googleCover);
        return googleCover;
      }
      
      // Then try Open Library with enhanced resolution
      const openLibraryCover = await this.searchOpenLibrary(title, author);
      if (openLibraryCover) {
        console.log(`✅ Found cover via Open Library:`, openLibraryCover);
        return openLibraryCover;
      }
      
      // Finally check fallback covers
      const fallbackCover = this.getFallbackCover(title);
      if (fallbackCover) {
        console.log(`✅ Found fallback cover for "${title}"`);
        return fallbackCover;
      }
      
      console.log(`❌ No cover found for: "${title}"`);
      return null;
    } catch (error) {
      console.warn('Error fetching cover art:', error);
      return null;
    }
  }
  
  /**
   * Search using Google Books API - prioritize highest resolution
   */
  private static async searchGoogleBooks(title: string, author?: string): Promise<CoverSearchResult | null> {
    try {
      const query = author ? `"${title}" inauthor:"${author}"` : `"${title}"`;
      const url = `${this.GOOGLE_BOOKS_API}?q=${encodeURIComponent(query)}&maxResults=10&projection=lite`;
      
      console.log(`🔍 Google Books API request: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; BookCoverFetcher/1.0)'
        }
      });
      
      if (!response.ok) {
        console.warn(`❌ Google Books API error: ${response.status} ${response.statusText}`);
        return null;
      }
      
      const data = await response.json();
      console.log(`📚 Google Books API response:`, data);
      
      if (data.items && data.items.length > 0) {
        // Try to find the best match with highest resolution
        for (const book of data.items) {
          const imageLinks = book.volumeInfo?.imageLinks;
          
          if (imageLinks) {
            // Priority order for highest resolution (Google Books resolutions)
            let coverUrl = null;
            
            // Try to get the highest resolution available
            if (imageLinks.extraLarge) {
              coverUrl = imageLinks.extraLarge;
              console.log(`🖼️ Found extra large cover (${coverUrl})`);
            } else if (imageLinks.large) {
              coverUrl = imageLinks.large;
              console.log(`🖼️ Found large cover (${coverUrl})`);
            } else if (imageLinks.medium) {
              coverUrl = imageLinks.medium;
              console.log(`🖼️ Found medium cover (${coverUrl})`);
            } else if (imageLinks.thumbnail) {
              // Enhance thumbnail by modifying URL parameters
              coverUrl = this.enhanceGoogleBooksUrl(imageLinks.thumbnail);
              console.log(`🖼️ Enhanced thumbnail cover (${coverUrl})`);
            }
            
            if (coverUrl) {
              // Convert to HTTPS and return the first valid one
              const httpsUrl = coverUrl.replace('http://', 'https://');
              
              return {
                coverUrl: httpsUrl,
                source: 'Google Books (High-Res)'
              };
            }
          }
        }
      }
      
      return null;
    } catch (error) {
      console.warn('Google Books API error:', error);
      return null;
    }
  }
  
  /**
   * Enhance Google Books thumbnail URLs to get higher resolution
   */
  private static enhanceGoogleBooksUrl(thumbnailUrl: string): string {
    // Remove size restrictions and zoom parameters to get higher resolution
    let enhancedUrl = thumbnailUrl
      .replace(/&zoom=\d+/g, '&zoom=1')
      .replace(/&img=\d+/g, '&img=1')
      .replace(/&fife=w\d+-h\d+/g, '&fife=w800-h1200')
      .replace(/&source=gbs_api/g, '&source=gbs_api&fife=w800-h1200');
    
    // If no fife parameter exists, add it for higher resolution
    if (!enhancedUrl.includes('fife=')) {
      enhancedUrl += '&fife=w800-h1200';
    }
    
    console.log(`🔧 Enhanced URL: ${thumbnailUrl} → ${enhancedUrl}`);
    return enhancedUrl;
  }
  
  /**
   * Search using Open Library API - request highest resolution
   */
  private static async searchOpenLibrary(title: string, author?: string): Promise<CoverSearchResult | null> {
    try {
      // Search for the book first
      let searchQuery = `title:${title}`;
      if (author) {
        searchQuery += ` author:${author}`;
      }
      
      const searchUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(searchQuery)}&limit=5`;
      console.log(`🔍 Open Library search: ${searchUrl}`);
      
      const searchResponse = await fetch(searchUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; BookCoverFetcher/1.0)'
        }
      });
      const searchData = await searchResponse.json();
      
      if (searchData.docs && searchData.docs.length > 0) {
        // Try multiple books to find the best cover
        for (const book of searchData.docs) {
          const coverId = book.cover_i;
          const isbn = book.isbn?.[0];
          const olid = book.key?.replace('/works/', '');
          
          // Priority: Cover ID > ISBN > OLID
          if (coverId) {
            // Try different sizes, largest first
            const sizes = ['L', 'M', 'S']; // Large, Medium, Small
            for (const size of sizes) {
              const coverUrl = `${this.OPEN_LIBRARY_BASE}/id/${coverId}-${size}.jpg`;
              console.log(`🖼️ Trying Open Library cover: ${coverUrl}`);
              
              // Test if this size exists
              try {
                const testResponse = await fetch(coverUrl, { 
                  method: 'HEAD',
                  signal: AbortSignal.timeout(3000)
                });
                if (testResponse.ok) {
                  return {
                    coverUrl,
                    source: `Open Library (${size === 'L' ? 'Large' : size === 'M' ? 'Medium' : 'Small'})`
                  };
                }
              } catch (e) {
                console.warn(`❌ Size ${size} not available for cover ID ${coverId}`);
              }
            }
          }
          
          if (isbn) {
            // Try ISBN-based covers
            const sizes = ['L', 'M', 'S'];
            for (const size of sizes) {
              const coverUrl = `${this.OPEN_LIBRARY_BASE}/isbn/${isbn}-${size}.jpg`;
              try {
                const testResponse = await fetch(coverUrl, { 
                  method: 'HEAD',
                  signal: AbortSignal.timeout(3000)
                });
                if (testResponse.ok) {
                  return {
                    coverUrl,
                    source: `Open Library ISBN (${size === 'L' ? 'Large' : size === 'M' ? 'Medium' : 'Small'})`
                  };
                }
              } catch (e) {
                console.warn(`❌ ISBN cover size ${size} not available for ${isbn}`);
              }
            }
          }
          
          if (olid) {
            // Try OLID-based covers
            const coverUrl = `${this.OPEN_LIBRARY_BASE}/olid/${olid}-L.jpg`;
            try {
              const testResponse = await fetch(coverUrl, { 
                method: 'HEAD',
                signal: AbortSignal.timeout(3000)
              });
              if (testResponse.ok) {
                return {
                  coverUrl,
                  source: 'Open Library OLID (Large)'
                };
              }
            } catch (e) {
              console.warn(`❌ OLID cover not available for ${olid}`);
            }
          }
        }
      }
      
      return null;
    } catch (error) {
      console.warn('Open Library API error:', error);
      return null;
    }
  }
  
  /**
   * Get fallback cover for famous books
   */
  private static getFallbackCover(title: string): CoverSearchResult | null {
    const normalizedTitle = title.toLowerCase().trim();
    const coverUrl = this.FALLBACK_COVERS[normalizedTitle];
    
    if (coverUrl) {
      return {
        coverUrl,
        source: 'Fallback Library'
      };
    }
    
    return null;
  }
  
  /**
   * Extract title and author from filename
   */
  static extractBookInfo(filename: string): { title: string; author?: string } {
    // Remove file extension more thoroughly
    const nameWithoutExt = filename.replace(/\.(epub|pdf|txt|mobi|azw3?)$/i, '').trim();
    
    // Common patterns: "Title - Author", "Author - Title", "Title by Author"
    const patterns = [
      /^(.+?)\s*-\s*(.+)$/,           // "Title - Author" or "Author - Title"
      /^(.+?)\s+by\s+(.+)$/i,        // "Title by Author"
      /^([^([]+)\s*[\([].+$/,        // "Title (Series)" - just take title part
    ];
    
    for (const pattern of patterns) {
      const match = nameWithoutExt.match(pattern);
      if (match) {
        const [, part1, part2] = match;
        
        // Clean up the parts
        const cleanPart1 = part1.trim();
        const cleanPart2 = part2 ? part2.trim() : undefined;
        
        // Heuristic: if part1 is much shorter, it's likely the author
        if (cleanPart2 && cleanPart1.length < cleanPart2.length * 0.6) {
          return { title: cleanPart2, author: cleanPart1 };
        } else {
          return { title: cleanPart1, author: cleanPart2 };
        }
      }
    }
    
    // If no pattern matches, just use the whole filename as title
    return { title: nameWithoutExt };
  }
  
  /**
   * Validate if a cover URL is accessible
   */
  static async validateCoverUrl(url: string): Promise<boolean> {
    try {
      console.log(`🔍 Validating cover URL: ${url}`);
      
      const response = await fetch(url, { 
        method: 'HEAD',
        headers: {
          'Accept': 'image/*',
          'User-Agent': 'Mozilla/5.0 (compatible; BookCoverFetcher/1.0)'
        },
        // Add timeout
        signal: AbortSignal.timeout(8000) // Increased timeout for higher resolution images
      });
      
      const isValid = response.ok;
      const contentType = response.headers.get('content-type');
      const contentLength = response.headers.get('content-length');
      
      console.log(`📋 Validation result for ${url}: status=${response.status}, ok=${response.ok}, content-type=${contentType}, size=${contentLength} bytes`);
      
      // Additional check: if it's a very small image, it might be a placeholder
      if (isValid && contentLength) {
        const size = parseInt(contentLength);
        if (size < 1000) { // Less than 1KB is likely a placeholder
          console.warn(`⚠️ Image too small (${size} bytes), likely a placeholder`);
          return false;
        }
      }
      
      return isValid;
    } catch (error) {
      console.warn(`❌ Cover URL validation failed for ${url}:`, error);
      // For timeout or network errors, assume the URL might be valid and let the browser handle it
      return true;
    }
  }
}
