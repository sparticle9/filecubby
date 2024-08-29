const MAGIC_NUMBERS: { [key: string]: string } = {
  // Images
  'ffd8ff': 'image/jpeg',
  '89504e47': 'image/png',
  '47494638': 'image/gif',
  '424d': 'image/bmp',
  '49492a00': 'image/tiff',
  '4d4d002a': 'image/tiff',
  '52494646': 'image/webp', // RIFF....WEBP
  // Audio
  'fff3': 'audio/mp3',
  'fff2': 'audio/mp3',
  'fffb': 'audio/mp3',
  '494433': 'audio/mp3', // ID3 tag
  '4f676753': 'audio/ogg',
  '664c6143': 'audio/flac',
  // Video
  '000001ba': 'video/mpeg',
  '000001b3': 'video/mpeg',
  '6674797069736f6d': 'video/mp4',
  '667479704d534e56': 'video/mp4',
  '1a45dfa3': 'video/webm',
  // Markdown
  '23204d61726b646f776e': 'text/markdown', // # Markdown
  '2d2d2d': 'text/markdown', // ---
};

export async function determineFileType(file: File): Promise<string> {
  // Use the file's type if available and not generic
  if (file.type && file.type !== 'application/octet-stream') {
    return file.type;
  }

  // If type is not available or generic, try to determine from the file extension
  const extension = file.name.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';  // Explicitly handle WebM
    case 'ogg':
      return 'video/ogg';
    case 'mov':
      return 'video/quicktime';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'pdf':
      return 'application/pdf';
    // Add more cases as needed
    default:
      return 'application/octet-stream'; // Default to binary data
  }
}
