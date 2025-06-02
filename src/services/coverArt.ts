// Cover art fetching service using Open Library API
export interface CoverSearchResult {
  coverUrl: string;
  source: string;
}

export class CoverArtService {
  private static readonly OPEN_LIBRARY_BASE = 'https://covers.openlibrary.org/b';
  private static readonly GOOGLE_BOOKS_API = 'https://www.googleapis.com/books/v1/volumes';
  
  // Fallback covers for famous books
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
      
      // First check fallback covers for famous books
      const fallbackCover = this.getFallbackCover(title);
      if (fallbackCover) {
        console.log(`✅ Found fallback cover for "${title}"`);
        return fallbackCover;
      }
      
      // Then try Google Books API for better matching
      const googleCover = await this.searchGoogleBooks(title, author);
      if (googleCover) {
        console.log(`✅ Found cover via Google Books:`, googleCover);
        return googleCover;
      }
      
      // Fallback to Open Library
      const openLibraryCover = await this.searchOpenLibrary(title, author);
      if (openLibraryCover) {
        console.log(`✅ Found cover via Open Library:`, openLibraryCover);
        return openLibraryCover;
      }
      
      console.log(`❌ No cover found for: "${title}"`);
      return null;
    } catch (error) {
      console.warn('Error fetching cover art:', error);
      return null;
    }
  }
  
  /**
   * Search using Google Books API
   */
  private static async searchGoogleBooks(title: string, author?: string): Promise<CoverSearchResult | null> {
    try {
      const query = author ? `"${title}" inauthor:"${author}"` : `"${title}"`;
      const url = `${this.GOOGLE_BOOKS_API}?q=${encodeURIComponent(query)}&maxResults=5`;
      
      console.log(`🔍 Google Books API request: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        }
      });
      
      if (!response.ok) {
        console.warn(`❌ Google Books API error: ${response.status} ${response.statusText}`);
        return null;
      }
      
      const data = await response.json();
      console.log(`📚 Google Books API response:`, data);
      
      if (data.items && data.items.length > 0) {
        // Try to find the best match
        for (const book of data.items) {
          const imageLinks = book.volumeInfo?.imageLinks;
          
          if (imageLinks) {
            // Prefer larger images
            const coverUrl = imageLinks.extraLarge || 
                            imageLinks.large || 
                            imageLinks.medium || 
                            imageLinks.thumbnail;
            
            if (coverUrl) {
              // Convert to HTTPS and return the first valid one
              const httpsUrl = coverUrl.replace('http://', 'https://');
              console.log(`🖼️ Found potential cover: ${httpsUrl}`);
              
              return {
                coverUrl: httpsUrl,
                source: 'Google Books'
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
   * Search using Open Library API
   */
  private static async searchOpenLibrary(title: string, author?: string): Promise<CoverSearchResult | null> {
    try {
      // Search for the book first
      let searchQuery = `title:${title}`;
      if (author) {
        searchQuery += ` author:${author}`;
      }
      
      const searchUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(searchQuery)}&limit=1`;
      const searchResponse = await fetch(searchUrl);
      const searchData = await searchResponse.json();
      
      if (searchData.docs && searchData.docs.length > 0) {
        const book = searchData.docs[0];
        
        // Try different cover options
        const coverId = book.cover_i;
        const isbn = book.isbn?.[0];
        const olid = book.key?.replace('/works/', '');
        
        if (coverId) {
          return {
            coverUrl: `${this.OPEN_LIBRARY_BASE}/id/${coverId}-L.jpg`,
            source: 'Open Library'
          };
        }
        
        if (isbn) {
          return {
            coverUrl: `${this.OPEN_LIBRARY_BASE}/isbn/${isbn}-L.jpg`,
            source: 'Open Library'
          };
        }
        
        if (olid) {
          return {
            coverUrl: `${this.OPEN_LIBRARY_BASE}/olid/${olid}-L.jpg`,
            source: 'Open Library'
          };
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
      
      // For fallback covers, assume they're valid
      if (url.includes('openlibrary.org')) {
        console.log(`✅ Open Library URL assumed valid: ${url}`);
        return true;
      }
      
      const response = await fetch(url, { 
        method: 'HEAD',
        headers: {
          'Accept': 'image/*',
          'User-Agent': 'Mozilla/5.0 (compatible; BookCoverFetcher/1.0)'
        },
        // Add timeout
        signal: AbortSignal.timeout(5000)
      });
      
      const isValid = response.ok;
      const contentType = response.headers.get('content-type');
      
      console.log(`📋 Validation result for ${url}: status=${response.status}, ok=${response.ok}, content-type=${contentType}`);
      
      // Be more lenient - some servers don't return proper content-type for HEAD requests
      return isValid;
    } catch (error) {
      console.warn(`❌ Cover URL validation failed for ${url}:`, error);
      // For timeout or network errors, assume the URL might be valid and let the browser handle it
      return true;
    }
  }
}
