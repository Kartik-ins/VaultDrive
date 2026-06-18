# VaultDrive — Production-Grade Cloud Storage Backend

A cloud storage backend built with **Node.js**, **TypeScript**, and **Express**, focused on backend infrastructure rather than UI. VaultDrive demonstrates production-level engineering around resumable uploads, content-addressable deduplication, zero-copy versioning, metadata caching, and secure public sharing.

---

## Key Engineering Features

### 1. Layered Architecture

VaultDrive follows a clean separation of concerns across three layers:

- **Controllers** — Parse HTTP requests, validate parameters, and shape responses.
- **Services** — Execute core business logic and orchestrate cross-cutting operations.
- **Repositories** — Encapsulate all database queries, decoupling application logic from Prisma and the underlying schema.

### 2. S3-Compatible Storage Abstraction

A `StorageProvider` interface decouples binary storage from the rest of the application. The default implementation targets **Filebase** via the AWS SDK v3 (`https://s3.filebase.io`, `region: auto`, `forcePathStyle: true`).

Swapping to AWS S3, MinIO, or GCS requires only a new interface implementation — zero changes to the service layer.

### 3. Content-Addressable Chunk Deduplication

Files are split into fixed-size blocks and hashed with **SHA-256** to minimize storage footprint:

- Each unique block is stored in Filebase under the key `chunks/${chunkHash}`.
- Before uploading, VaultDrive checks the database for an existing hash. If a match is found, the upload is skipped and the existing chunk's `referenceCount` is incremented — enabling cross-user deduplication.
- On file deletion, chunk reference counts are decremented. Chunks are garbage-collected from Filebase only when their `referenceCount` reaches zero.

### 4. Zero-Copy File Versioning

Uploading a file with an identical filename appends a new version rather than creating a duplicate entity.

- **Restoring a version** is a zero-copy operation: a new `FileVersion` record is created that references the same chunks (and indices) as the target version — no data transfer or storage overhead.

### 5. Resumable Chunked Uploads

A session-based API supports robust, resumable uploads for large files:

1. The client initiates a session via `POST /files/chunk/start`, declaring the total size and chunk count.
2. Chunks can be uploaded **in parallel** and **out of order**.
3. Aborted uploads are resumed by querying `/files/chunk/:sessionId/status`, which returns completed chunk indices from Redis and the database.
4. On completion, chunk streams are downloaded **sequentially** from object storage and piped through a SHA-256 builder to compute the file's integrity hash without buffering large payloads in memory.

### 6. Caching Layer (Cache-Aside with Background Sync)

Redis (Valkey) reduces database load through targeted caching:

- **Metadata caching** — File metadata is looked up at `vaultdrive:file:${fileId}` first, populated on cache miss (5-minute TTL), and evicted immediately on deletion.
- **Unlimited share links** — Cached in Redis with their full file and chunk structures. Downloads are streamed from cache while download-count increments run asynchronously in the background.
- **Limited share links** (`maxDownloads` enforced) — Use synchronous, atomic database increments on each download to prevent concurrency-based limit bypasses.

---

## Architecture

```mermaid
graph TD
    Client[Web / API Client]
    Express[Express.js App]
    Redis[Redis / Valkey Cache]
    DB[(PostgreSQL)]
    Filebase[Filebase S3 Storage]

    Client -->|API Requests| Express
    Express <-->|Cache Check / Invalidate| Redis
    Express <-->|Transactional Queries| DB
    Express <-->|Stream Upload / Download| Filebase
```

---

## API Reference

### Authentication

| Method | Endpoint                  | Description                          |
|--------|---------------------------|--------------------------------------|
| POST   | `/api/v1/auth/register`   | Register a new user. Returns a JWT.  |
| POST   | `/api/v1/auth/login`      | Authenticate a user. Returns a JWT.  |
| GET    | `/api/v1/auth/me`         | Retrieve the authenticated user's profile. |

### Files (Authenticated)

| Method | Endpoint                        | Description                                             |
|--------|---------------------------------|---------------------------------------------------------|
| POST   | `/api/v1/files/upload`          | Upload a file (multipart). Handles versioning and dedup automatically. |
| GET    | `/api/v1/files`                 | List the user's files with offset-based pagination.     |
| GET    | `/api/v1/files/:id`             | Get file metadata (served from cache when available).   |
| GET    | `/api/v1/files/:id/download`    | Stream the file by sequentially assembling its chunks.  |
| DELETE | `/api/v1/files/:id`             | Delete a file version and garbage-collect orphaned chunks. |

### Public Sharing (Unauthenticated)

| Method | Endpoint                        | Description                                             |
|--------|---------------------------------|---------------------------------------------------------|
| POST   | `/api/v1/files/:id/share`       | Generate a share link with optional `expiresAt` and `maxDownloads`. |
| GET    | `/api/v1/share/:token`          | Download a shared file via its token.                   |

### Version Control (Authenticated)

| Method | Endpoint                                  | Description                            |
|--------|-------------------------------------------|----------------------------------------|
| GET    | `/api/v1/files/:id/versions`              | List the full version history.         |
| POST   | `/api/v1/files/:id/restore/:versionId`    | Restore to a previous version (zero-copy). |

### Resumable Uploads (Authenticated)

| Method | Endpoint                                    | Description                                    |
|--------|---------------------------------------------|------------------------------------------------|
| POST   | `/api/v1/files/chunk/start`                 | Initiate a resumable upload session.           |
| POST   | `/api/v1/files/chunk/:sessionId/upload`     | Upload an individual chunk (multipart or octet-stream). |
| GET    | `/api/v1/files/chunk/:sessionId/status`     | Check which chunk indices have been uploaded.  |
| POST   | `/api/v1/files/chunk/:sessionId/complete`   | Finalize the session: hash, validate, and commit the file. |

---

## Data Model (Prisma)

| Entity            | Role                                                                                      |
|-------------------|-------------------------------------------------------------------------------------------|
| **User**          | Owns `File` and `UploadSession` records.                                                  |
| **File**          | Stores `filename`, `mimeType`, and `totalSize`. Links to multiple `FileVersion` records.  |
| **FileVersion**   | A point-in-time snapshot of a file, linked to ordered `FileChunk` join records.           |
| **Chunk**         | A deduplicated block, unique by `sha256Hash` and `storageKey`, with a `referenceCount`.   |
| **FileChunk**     | Joins `FileVersion` to `Chunk` with a `chunkIndex` to preserve assembly order.            |
| **UploadSession** | Tracks session state, expiry, and chunk-level progress for resumable uploads.             |
| **ShareLink**     | Stores tokens, download caps, expiry, and access logs.                                    |

---

## Local Setup

### Prerequisites

- Node.js v18+
- pnpm v8+
- PostgreSQL & Redis

### 1. Configure Environment

Create a `.env` file from the example template:

```env
PORT=3000
DATABASE_URL="postgresql://username:password@localhost:5432/vaultdrive?schema=public"
REDIS_URL="redis://127.0.0.1:6379"
JWT_SECRET="generate-a-secure-random-secret"

# Filebase Credentials
FILEBASE_ACCESS_KEY="your-filebase-access-key"
FILEBASE_SECRET_KEY="your-filebase-secret-key"
FILEBASE_BUCKET="chunkvault"

CHUNK_SIZE_BYTES=5242880  # 5 MB default
```

### 2. Install Dependencies & Sync Database

```bash
pnpm install
pnpm prisma:generate
npx prisma db push
```

### 3. Run

```bash
pnpm dev      # Development server
pnpm build    # Production build
pnpm start    # Start production server
```