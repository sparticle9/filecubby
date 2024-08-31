export async function isValidDownloadUrl(url: string, expectedContentType?: string, expectedSize?: number): Promise<boolean> {
  try {
    console.log(`Validating URL: ${url}`);
    const response = await fetch(url, { method: 'HEAD' });

    if (!response.ok) {
      console.log(`URL validation failed: HTTP status ${response.status}`);
      return false;
    }

    if (expectedContentType) {
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes(expectedContentType)) {
        console.log(`URL validation failed: Expected content type ${expectedContentType}, got ${contentType}`);
        return false;
      }
    }

    if (expectedSize !== undefined) {
      const contentLength = response.headers.get('content-length');
      if (!contentLength || parseInt(contentLength, 10) !== expectedSize) {
        console.log(`URL validation failed: Expected size ${expectedSize}, got ${contentLength}`);
        return false;
      }
    }

    console.log(`URL validated successfully: ${url}`);
    return true;
  } catch (error) {
    console.error('Error validating URL:', error);
    return false;
  }
}