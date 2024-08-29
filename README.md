# tgpan: Serverless Telegram-based File Storage System

## Overview

tgpan is a serverless file storage system that leverages Telegram's infrastructure for storing files. It provides a simple API for uploading and downloading files, with the actual file data being stored in Telegram channels or groups. This approach allows for virtually unlimited, free file storage with the reliability of Telegram's infrastructure.

## Key Features

- Serverless architecture using Cloudflare Workers
- File upload and download via API
- Support for large file uploads through chunking
- Flexible file expiration system
- User management system with admin capabilities
- Integration with Telegram for file storage

## API Endpoints

- `POST /api/upload`: Upload a file (authenticated)
- `POST /api/pic`: Upload an image (supports both token query param and Authorization header)
- `GET /d/:fileId`: Download a file (public access)
- `POST /api/del`: Delete a file (authenticated)
- `POST /api/users/create` or `PUT /api/users/create`: Create a new user (admin only)
- `POST /api/users/update` or `PUT /api/users/update`: Update a user (admin only)
- `POST /api/users/delete`: Delete a user (admin only)

## Setup and Deployment

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/tgpan.git
   cd tgpan
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Configure `wrangler.toml` with your Cloudflare and Telegram credentials:
   - Set your `BOT_TOKEN` and `CHANNEL_ID`
   - Configure D1 database and KV namespace IDs

4. Initialize the database:
   ```
   npm run init-db
   ```

5. Create an admin user:
   ```
   npm run init-admin
   ```

6. Deploy to Cloudflare Workers:
   ```
   wrangler deploy
   ```

## Usage

### Uploading a File

default no expir

```
curl -X POST https://your-worker.workers.dev/api/upload \
-H "Authorization: Bearer YOUR_USER_TOKEN" \
-F "file=@/path/to/your/file" \
-F "expiryHours=24" # Optional: Set expiry time in hours
```

### Uploading an Image
```
curl -X POST https://your-worker.workers.dev/api/pic \
-H "Authorization: Bearer YOUR_USER_TOKEN" \
-F "image=@/path/to/your/image.jpg" \
-F "expiryHours=24" # Optional: Set expiry time in hours
```
Alternatively, you can use the `token` query parameter:
```
curl -X POST "https://your-worker.workers.dev/api/pic?token=YOUR_USER_TOKEN" \
-F "image=@/path/to/your/image.jpg"
```

### Downloading a File
```
curl https://your-worker.workers.dev/d/FILE_ID
```

Add `?dl=true` to force download instead of inline display.

### User Management(admin only)

```
curl -X POST https://your-worker.workers.dev/api/users/create \
-H "Authorization: Bearer ADMIN_TOKEN" \
-H "Content-Type: application/json" \
-d '{"username": "newuser"}'
```


## Configuration Options

- `CHUNK_SIZE`: Maximum size of a single file chunk (default: 10MB)
- `PIC_MAX_SIZE`: Maximum size for images uploaded via `/api/pic` (default: 30MB)

These can be adjusted in the `wrangler.toml` file.

## Database Schema

The system uses a D1 database with two tables:

### Users Table
- `id`: TEXT PRIMARY KEY
- `token`: TEXT UNIQUE NOT NULL
- `username`: TEXT UNIQUE NOT NULL
- `enabled`: BOOLEAN NOT NULL DEFAULT TRUE

### Files Table
- `id`: TEXT PRIMARY KEY
- `userId`: TEXT NOT NULL
- `filename`: TEXT NOT NULL
- `size`: INTEGER NOT NULL
- `chunks`: INTEGER NOT NULL
- `chunkIds`: TEXT NOT NULL (JSON array of chunk IDs)
- `expiresAt`: DATETIME
- `fileType`: TEXT NOT NULL
- `uploadedAt`: DATETIME NOT NULL

## Limitations and Considerations

- Maximum file size is limited by Telegram's restrictions (currently 2GB per file).
- File storage duration is subject to Telegram's data retention policies.
- Ensure compliance with Telegram's terms of service when using this system.

## Contributing

Contributions are welcome! Please fork the repository and submit a pull request with your changes.

## License

This project is licensed under the MIT License. See the LICENSE file for details.