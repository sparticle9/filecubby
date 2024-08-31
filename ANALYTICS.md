# tgpan Analytics

This document outlines the analytics metrics collected by tgpan and how to use them for monitoring and improving the service.

## Analytics Design

tgpan uses Cloudflare's Analytics Engine to collect and analyze important metrics about file uploads, downloads, and errors. The analytics system is designed to be lightweight yet informative, providing key insights into the service's usage and performance.

- Get Started https://developers.cloudflare.com/analytics/analytics-engine/get-started/

### Metrics Collected

1. **Action Type**
   - Upload
   - Download
   - Error

2. **File Metadata**
   - File Type
   - File Size

3. **Performance**
   - Response Time

4. **Error Information**
   - Error Type (for error actions)

5. **Upload Method**
   - Chunked or Single File

6. **Timestamp**
   - Used for time-based analysis

### Data Structure

Each analytics data point consists of:

- **Blobs**: String values including action, file type, error type, and upload method
- **Doubles**: Numeric values including file size and response time
- **Indexes**: Timestamp for when the action occurred

## Using the Analytics

### Querying Data

You can query the analytics data using SQL through the Cloudflare dashboard or API. Here are some example queries:

1. Count of uploads and downloads:

```sql
SELECT blob1 AS action, COUNT() AS count
FROM tgpan_analytics
GROUP BY blob1
```

2. Total size of uploads and downloads:
sql
SELECT blob1 AS action, SUM(double1) AS total_size
FROM tgpan_analytics
GROUP BY blob1


3. Average response time for uploads and downloads:
sql
SELECT blob1 AS action, AVG(double2) AS avg_response_time
FROM tgpan_analytics
WHERE blob1 IN ('upload', 'download')
GROUP BY blob1


4. Error analysis:
```sql
SELECT blob3 AS error_type, COUNT() AS error_count
FROM tgpan_analytics
WHERE blob1 = 'error'
GROUP BY blob3
ORDER BY error_count DESC
```

5. Chunked vs single file uploads:
```sql
SELECT blob4 AS upload_type, COUNT() AS count
FROM tgpan_analytics
WHERE blob1 = 'upload'
GROUP BY blob4
```

6. Hourly upload/download activity:
```sql
SELECT
DATE_TRUNC('hour', TIMESTAMP_MILLIS(index1)) AS hour,
blob1 AS action,
COUNT() AS count
FROM tgpan_analytics
GROUP BY 1, 2
ORDER BY 1 DESC, 2
```

### Interpreting Results

- **Usage Patterns**: Analyze the number of uploads and downloads over time to identify peak usage periods and trends.
- **Performance Monitoring**: Keep an eye on average response times to ensure the service is performing well.
- **Error Tracking**: Regularly check the error analysis to identify and address common issues.
- **Storage Efficiency**: Compare the number of chunked vs single file uploads to understand how users are utilizing the service.
- **Capacity Planning**: Monitor the total size of uploaded files over time to plan for future storage needs.

## Extending Analytics

To add new metrics or modify existing ones:

1. Update the `writeAnalytics` function in `src/utils/analytics.ts`.
2. Modify the relevant handlers (e.g., `upload.ts`, `download.ts`) to include new data points.
3. Update your SQL queries to make use of the new data.

## Best Practices

- Regularly review analytics data to identify trends and potential issues.
- Use analytics insights to guide feature development and optimizations.
- Be mindful of privacy concerns and ensure no personally identifiable information is included in analytics data.
- Periodically review and optimize your analytics queries for performance.

By leveraging these analytics, you can gain valuable insights into tgpan's usage, performance, and areas for improvement, ultimately providing a better service to your users.