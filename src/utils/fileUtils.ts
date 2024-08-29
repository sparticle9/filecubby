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
  // Check content (magic numbers)
  const buffer = await file.slice(0, 16).arrayBuffer();
  const header = Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  for (const [magic, type] of Object.entries(MAGIC_NUMBERS)) {
    if (header.startsWith(magic.toLowerCase())) {
      return type;
    }
  }

  // Additional checks for text-based files
  const textBasedExtensions = {
    'md': 'text/markdown',
    'markdown': 'text/markdown',
    'json': 'application/json',
    'yaml': 'text/yaml',
    'yml': 'text/yaml',
    'txt': 'text/plain'
  };

  const fileExtension = file.name.split('.').pop()?.toLowerCase();
  if (fileExtension && textBasedExtensions[fileExtension]) {
    return textBasedExtensions[fileExtension];
  }

  // If content check fails, use the file's reported MIME type
  if (file.type && file.type !== 'application/octet-stream') {
    return file.type;
  }

  // As a last resort, fall back to extension-based detection
  switch (fileExtension) {
    case 'pdf':
      return 'application/pdf';
    case 'm4a':
      return 'audio/m4a';
    default:
      return 'application/octet-stream';
  }
}
