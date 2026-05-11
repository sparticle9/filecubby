export async function writeAnalytics(
  analytics: AnalyticsEngineDataset,
  data: {
    action: 'download' | 'upload' | 'error',
    objectType?: string,
    objectSize?: number,
    isChunked?: boolean,
    requestReceivedTime?: number,
    metadataFetchTime?: number,
    streamPrepareTime?: number,
    chunkTimes?: number[],
    totalTime?: number,
    errorType?: string
  }
) {
  const { action, objectType, objectSize, isChunked, requestReceivedTime, metadataFetchTime, streamPrepareTime, chunkTimes, totalTime, errorType } = data;

  const blobs = [action, objectType, isChunked ? 'chunked' : 'single', errorType].filter(Boolean) as string[];
  const doubles = [objectSize, requestReceivedTime, metadataFetchTime, streamPrepareTime, totalTime].filter((v): v is number => typeof v === 'number');
  const indexes = [Date.now().toString()];

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
