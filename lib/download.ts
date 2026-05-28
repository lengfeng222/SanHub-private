'use client';

function buildDownloadUrl(url: string): string {
  try {
    const normalized = new URL(url, window.location.origin);
    if (normalized.pathname.startsWith('/api/media/')) {
      normalized.searchParams.set('download', '1');
      return normalized.toString();
    }
    return normalized.toString();
  } catch {
    return url;
  }
}

/**
 * Converts a base64 data URL to a Blob.
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64Data] = dataUrl.split(',');
  const mimeMatch = header.match(/data:([^;]+)/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  
  const byteString = atob(base64Data);
  const arrayBuffer = new ArrayBuffer(byteString.length);
  const uint8Array = new Uint8Array(arrayBuffer);
  
  for (let i = 0; i < byteString.length; i++) {
    uint8Array[i] = byteString.charCodeAt(i);
  }
  
  return new Blob([arrayBuffer], { type: mimeType });
}

/**
 * Fetches a remote asset as a blob and triggers a client-side download.
 * Supports both remote URLs and base64 data URLs.
 */
export async function downloadAsset(url: string, filename: string): Promise<void> {
  let blob: Blob;

  if (url.startsWith('data:')) {
    blob = dataUrlToBlob(url);
  } else {
    const requestUrl = buildDownloadUrl(url);
    try {
      const response = await fetch(requestUrl, {
        credentials: 'include',
        redirect: 'follow',
      });
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }
      blob = await response.blob();
      if (blob.size === 0) {
        throw new Error('Downloaded empty file');
      }
    } catch (error) {
      if (requestUrl.startsWith('/api/media/')) {
        const directLink = document.createElement('a');
        directLink.href = `${requestUrl}${requestUrl.includes('?') ? '&' : '?'}download=1&open=1`;
        directLink.target = '_blank';
        directLink.rel = 'noopener noreferrer';
        document.body.appendChild(directLink);
        directLink.click();
        directLink.remove();
        return;
      }

      const fallbackLink = document.createElement('a');
      fallbackLink.href = requestUrl;
      fallbackLink.download = filename;
      fallbackLink.target = '_blank';
      fallbackLink.rel = 'noopener noreferrer';
      document.body.appendChild(fallbackLink);
      fallbackLink.click();
      fallbackLink.remove();
      return;
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
