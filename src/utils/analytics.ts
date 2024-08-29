import { AnalyticsEngineDataset } from '@cloudflare/workers-types';

export async function writeAnalytics(
  analytics: AnalyticsEngineDataset,
  data: {
    action: 'upload' | 'download' | 'error',
    fileType?: string,
    fileSize?: number,
    responseTime?: number,
    errorType?: string,
    isChunked?: boolean
  }
) {
  if (!analytics) {
    console.error('Analytics engine is not defined');
    return;
  }

  const { action, fileType, fileSize, responseTime, errorType, isChunked } = data;
  
  try {
    await analytics.writeDataPoint({
      blobs: [action, fileType, errorType, isChunked ? 'chunked' : 'single'].filter(Boolean) as string[],
      doubles: [fileSize, responseTime].filter((v): v is number => typeof v === 'number'),
      indexes: [new Date().getTime()], // Add timestamp for time-based analysis
    });
    console.log('Analytics data point written successfully');
  } catch (error) {
    console.error('Error writing analytics data point:', error);
    // Re-throw the error so it can be caught in the calling function
    throw error;
  }
}