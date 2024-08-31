import { AnalyticsEngineDataset } from '@cloudflare/workers-types';

export async function writeAnalytics(
  analytics: AnalyticsEngineDataset,
  data: {
    action: 'download' | 'upload' | 'error',
    fileType?: string,
    fileSize?: number,
    isChunked?: boolean,
    requestReceivedTime?: number,
    metadataFetchTime?: number,
    streamPrepareTime?: number,
    chunkTimes?: number[],
    totalTime?: number,
    errorType?: string
  }
) {
  const { action, fileType, fileSize, isChunked, requestReceivedTime, metadataFetchTime, streamPrepareTime, chunkTimes, totalTime, errorType } = data;

  const blobs = [action, fileType, isChunked ? 'chunked' : 'single', errorType].filter(Boolean) as string[];
  const doubles = [fileSize, requestReceivedTime, metadataFetchTime, streamPrepareTime, totalTime].filter((v): v is number => typeof v === 'number');
  const indexes = [Date.now()];  // Current timestamp as index

  try {
    analytics.writeDataPoint({
      blobs,
      doubles,
      indexes
    });
  } catch (error) {
    console.error('Error writing analytics:', error);
  }
}