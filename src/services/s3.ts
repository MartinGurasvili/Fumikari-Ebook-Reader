import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Initialize S3 Client
const s3Client = new S3Client({
  region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: import.meta.env.VITE_AWS_ACCESS_KEY_ID,
    secretAccessKey: import.meta.env.VITE_AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = import.meta.env.VITE_S3_BUCKET_NAME;

export async function uploadToS3(file: File, key: string): Promise<string> {
  if (!BUCKET_NAME) {
    throw new Error('S3 bucket name not configured');
  }

  try {
    // Convert File to Uint8Array instead of using Buffer
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: uint8Array,
      ContentType: file.type,
    });

    await s3Client.send(command);
    return key;
  } catch (error) {
    console.error('Error uploading to S3:', error);
    throw new Error('Failed to upload file to S3');
  }
}

export async function getSignedBookUrl(key: string): Promise<string> {
  if (!BUCKET_NAME) {
    throw new Error('S3 bucket name not configured');
  }

  if (!key) {
    throw new Error('No key provided for S3 object');
  }

  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return url;
  } catch (error) {
    console.error('Error getting signed URL:', error);
    throw new Error('Failed to get book URL from S3');
  }
}

export async function listBooksInS3(): Promise<{ key: string; fileName: string }[]> {
  if (!BUCKET_NAME) {
    throw new Error('S3 bucket name not configured');
  }

  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: 'books/',
    });

    const response = await s3Client.send(command);
    console.log('S3 list response:', response); // Debug logging

    if (!response.Contents) {
      console.log('No books found in S3');
      return [];
    }

    return response.Contents
      .filter(item => item.Key && item.Key !== 'books/')
      .map(item => ({
        key: item.Key!,
        fileName: item.Key!.split('/').pop() || ''
      }));
  } catch (error) {
    console.error('Error listing books from S3:', error);
    throw new Error('Failed to list books from S3');
  }
}
