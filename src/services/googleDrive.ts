// Google Drive API integration with OAuth 2
interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime: string;
  size?: string;
}

interface GoogleAuthResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

class GoogleDriveService {
  private clientId: string;
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;
  private booksFolder: string | null = null;

  constructor() {
    this.clientId = import.meta.env.VITE_GOOGLEDRIVE || '';
    
    if (!this.clientId) {
      console.warn('⚠️ VITE_GOOGLEDRIVE environment variable not found. Google Drive functionality will be disabled.');
    }
    
    this.loadStoredAuth();
  }

  private loadStoredAuth() {
    const storedToken = localStorage.getItem('googleDriveAccessToken');
    const storedExpiry = localStorage.getItem('googleDriveTokenExpiry');
    
    if (storedToken && storedExpiry) {
      const expiry = parseInt(storedExpiry);
      if (Date.now() < expiry) {
        this.accessToken = storedToken;
        this.tokenExpiry = expiry;
      } else {
        this.clearStoredAuth();
      }
    }
  }

  private saveAuth(token: string, expiresIn: number) {
    this.accessToken = token;
    this.tokenExpiry = Date.now() + (expiresIn * 1000);
    
    localStorage.setItem('googleDriveAccessToken', token);
    localStorage.setItem('googleDriveTokenExpiry', this.tokenExpiry.toString());
  }

  private clearStoredAuth() {
    this.accessToken = null;
    this.tokenExpiry = null;
    this.booksFolder = null;
    
    localStorage.removeItem('googleDriveAccessToken');
    localStorage.removeItem('googleDriveTokenExpiry');
    localStorage.removeItem('googleDriveBooksFolder');
  }

  isAuthenticated(): boolean {
    return !!(this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry);
  }

  async authenticate(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.clientId) {
        reject(new Error('Google Drive client ID not configured. Please check your environment variables.'));
        return;
      }

      // Load Google Identity Services script
      if (!window.google) {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.onload = () => this.initializeAuth(resolve, reject);
        script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
        document.head.appendChild(script);
      } else {
        this.initializeAuth(resolve, reject);
      }
    });
  }

  private initializeAuth(resolve: (value: boolean) => void, reject: (reason: Error) => void) {
    try {
      if (!window.google?.accounts?.oauth2) {
        throw new Error('Google Identity Services not loaded');
      }
      
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: (response: GoogleAuthResponse) => {
          if (response.access_token) {
            this.saveAuth(response.access_token, response.expires_in);
            resolve(true);
          } else {
            reject(new Error('Failed to obtain access token'));
          }
        },
        error_callback: (error: any) => {
          console.error('OAuth error:', error);
          reject(new Error(`OAuth error: ${error.type || 'Unknown error'}`));
        }
      });

      tokenClient.requestAccessToken();
    } catch (error) {
      console.error('Authentication initialization error:', error);
      reject(new Error('Failed to initialize authentication'));
    }
  }

  disconnect() {
    this.clearStoredAuth();
    
    // Revoke the token if possible
    if (this.accessToken) {
      fetch(`https://oauth2.googleapis.com/revoke?token=${this.accessToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }).catch(error => {
        console.warn('Failed to revoke token:', error);
      });
    }
  }

  private async makeApiCall(endpoint: string, options: RequestInit = {}): Promise<any> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Google Drive');
    }

    const response = await fetch(`https://www.googleapis.com/drive/v3${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        this.clearStoredAuth();
        throw new Error('Google Drive authentication expired');
      }
      throw new Error(`Google Drive API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  private async findOrCreateBooksFolder(): Promise<string> {
    if (this.booksFolder) {
      console.log(`📁 Using cached books folder: ${this.booksFolder}`);
      return this.booksFolder;
    }

    // Check if books folder exists in localStorage
    const storedFolder = localStorage.getItem('googleDriveBooksFolder');
    if (storedFolder) {
      console.log(`📁 Found stored books folder ID: ${storedFolder}`);
      // Verify the stored folder still exists and is valid
      try {
        const folderInfo = await this.makeApiCall(`/files/${storedFolder}?fields=id,name,mimeType,trashed`);
        if (folderInfo && !folderInfo.trashed && folderInfo.mimeType === 'application/vnd.google-apps.folder') {
          this.booksFolder = storedFolder;
          console.log(`📁 Verified stored books folder: "${folderInfo.name}" (${storedFolder})`);
          return storedFolder;
        } else {
          console.log(`📁 Stored folder is invalid or trashed, removing from cache`);
          localStorage.removeItem('googleDriveBooksFolder');
        }
      } catch (error) {
        // Stored folder is invalid, clear it and continue
        console.log(`📁 Stored folder validation failed:`, error);
        localStorage.removeItem('googleDriveBooksFolder');
      }
    }

    try {
      console.log(`📁 Searching for books folders in Google Drive...`);
      // Search for existing 'books' or 'Books' folder (case-insensitive approach)
      const searchResponse = await this.makeApiCall(
        `/files?q=(name='books' or name='Books') and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name,parents)`
      );

      console.log(`📁 Search response:`, searchResponse);

      if (searchResponse.files && searchResponse.files.length > 0) {
        // Use the first found folder
        this.booksFolder = searchResponse.files[0].id;
        console.log(`📁 Found existing books folder: "${searchResponse.files[0].name}" (${this.booksFolder})`);
        if (searchResponse.files[0].parents) {
          console.log(`📁 Folder parents:`, searchResponse.files[0].parents);
        }
      } else {
        console.log('📁 No books folder found, creating one...');
        // Create books folder if it doesn't exist
        const createResponse = await this.makeApiCall('/files', {
          method: 'POST',
          body: JSON.stringify({
            name: 'books',
            mimeType: 'application/vnd.google-apps.folder'
          }),
        });
        this.booksFolder = createResponse.id;
        console.log(`📁 Created new books folder: ${this.booksFolder}`);
      }

      if (!this.booksFolder) {
        throw new Error('Failed to create books folder');
      }

      localStorage.setItem('googleDriveBooksFolder', this.booksFolder);
      return this.booksFolder;
    } catch (error) {
      console.error('Error finding/creating books folder:', error);
      throw new Error('Failed to access books folder in Google Drive');
    }
  }

  async listBooks(): Promise<{ id: string; fileName: string; size: number; modifiedTime: string }[]> {
    try {
      const booksFolder = await this.findOrCreateBooksFolder();
      console.log(`📚 Searching for books in folder: ${booksFolder}`);
      
      // First, let's see all files in the folder (for debugging)
      const allFilesResponse = await this.makeApiCall(
        `/files?q='${booksFolder}' in parents and trashed=false&fields=files(id,name,mimeType,size,modifiedTime)`
      );
      
      console.log(`📚 All files in books folder:`, allFilesResponse.files);
      
      // Now search specifically for book files
      const bookQuery = `'${booksFolder}' in parents and (mimeType='application/epub+zip' or mimeType='application/pdf' or name contains '.epub' or name contains '.pdf') and trashed=false`;
      console.log(`📚 Book search query: ${bookQuery}`);
      
      const response = await this.makeApiCall(
        `/files?q=${encodeURIComponent(bookQuery)}&fields=files(id,name,size,modifiedTime,mimeType)`
      );

      console.log(`📚 Book search response:`, response);

      const books = (response.files || []).map((file: GoogleDriveFile) => ({
        id: file.id,
        fileName: file.name,
        size: parseInt(file.size || '0'),
        modifiedTime: file.modifiedTime
      }));

      console.log(`📚 Found ${books.length} books in Google Drive:`, books.map((b: { fileName: string }) => b.fileName));
      return books;
    } catch (error) {
      console.error('Error listing books from Google Drive:', error);
      throw error;
    }
  }

  async getBookUrl(fileId: string): Promise<string> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Google Drive');
    }

    console.log(`📥 Getting book URL for file ID: ${fileId}`);
    console.log(`🔑 Using access token: ${this.accessToken ? 'present' : 'missing'}`);

    try {
      // First, verify the file exists and we have permission
      const fileInfo = await this.makeApiCall(`/files/${fileId}?fields=id,name,mimeType,size`);
      console.log(`📄 File info:`, fileInfo);

      // Download the file content and create a blob URL
      const arrayBuffer = await this.downloadFileContent(fileId);
      const mimeType = fileInfo.mimeType || 'application/octet-stream';
      const blob = new Blob([arrayBuffer], { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);
      
      console.log(`📥 Created blob URL for ${fileInfo.name}: ${blobUrl}`);
      return blobUrl;
    } catch (error) {
      console.error(`❌ Error getting book URL for file ${fileId}:`, error);
      throw new Error(`Failed to get book URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async downloadFileContent(fileId: string): Promise<ArrayBuffer> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Google Drive');
    }

    console.log(`📥 Downloading file content for file ID: ${fileId}`);

    try {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      console.log(`📥 Downloaded ${arrayBuffer.byteLength} bytes for file ${fileId}`);
      return arrayBuffer;
    } catch (error) {
      console.error(`❌ Error downloading file content for ${fileId}:`, error);
      throw error;
    }
  }

  async uploadBook(file: File): Promise<string> {
    const booksFolder = await this.findOrCreateBooksFolder();
    
    // Create file metadata
    const metadata = {
      name: file.name,
      parents: [booksFolder]
    };

    // Upload file using resumable upload
    const initResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    });

    if (!initResponse.ok) {
      throw new Error(`Failed to initialize upload: ${initResponse.statusText}`);
    }

    const uploadUrl = initResponse.headers.get('Location');
    if (!uploadUrl) {
      throw new Error('No upload URL received');
    }

    // Upload file content
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type,
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload file: ${uploadResponse.statusText}`);
    }

    const result = await uploadResponse.json();
    return result.id;
  }
}

// Extend window interface for Google Identity Services
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: any) => any;
        };
      };
    };
  }
}

export const googleDriveService = new GoogleDriveService();
export default googleDriveService;