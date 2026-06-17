# VaultDrive — Production-Grade Cloud Storage Backend

VaultDrive is a portfolio-grade cloud storage backend engineered with Node.js, TypeScript, and Express. The project is focused on backend storage concepts rather than user interfaces, demonstrating advanced engineering practices around resumable chunked uploads, metadata caching, public secure sharing, content-addressable deduplication, and zero-copy versioning.

---

## Key Engineering Features

### 1. Layered Architecture & Separation of Concerns
VaultDrive implements a clean, layered architectural pattern:
*   **Controllers**: HTTP request/response parsing and parameters validation.
*   **Services**: Core business logic execution and operation orchestration.
*   **Repositories**: Data access layer wrapping all database queries, decoupling the core application logic from database schemas and the ORM (Prisma).

### 2. S3-Compatible Storage Abstraction
We define a decoupled `StorageProvider` interface. Binary blobs are handled by a `FilebaseStorageProvider` implementing the AWS SDK v3 client configuration (`https://s3.filebase.io`) with `region: auto` and `forcePathStyle: true`. 
Changing S3 providers (e.g. AWS S3, MinIO, Google Cloud Storage) requires only implementing the interface with zero changes to the service layer.

### 3. Content-Addressable Chunk Deduplication
To optimize storage footprints, files are split into block segments and hashed using SHA-256:
*   Every unique block is uploaded to Filebase under key `chunks/${chunkHash}`.
*   Before uploading any chunk, VaultDrive queries the DB for the hash. If a duplicate exists, it skips the network upload and increments a `referenceCount` on the metadata record (cross-user deduplication).
*   During file deletion, we decrement chunk reference counts and garbage collect (delete) binary assets from Filebase only when their `referenceCount` reaches zero.

### 4. Zero-Copy File Versioning
When uploading files with identical filenames, VaultDrive appends a new version rather than creating duplicate file entities.
*   **Restoring Versions**: Restoring a file to a previous version is a **zero-copy operation**. We create a new `FileVersion` record referencing the exact same chunks (and indices) as the target older version, instantly shifting the current pointer with zero bandwidth or storage overhead.

### 5. Resumable Chunked Upload Sessions
VaultDrive provides a resumable chunk upload API for robust uploads of large files:
*   Clients initiate a session via `POST /files/chunk/start` to declare total size and chunk targets.
*   Chunks can be uploaded in parallel or out of order.
*   Clients can resume aborted uploads by querying `/files/chunk/:sessionId/status`, which returns completed chunk indexes from Redis and DB.
*   **Sequential Assembly Hashing**: During completion, chunk streams are downloaded sequentially from object storage and piped to a SHA-256 builder. This computes the overall file integrity hash without loading large assets into the server's RAM.

### 6. Caching Layer (Cache-Aside & Background Sync)
Integrated with Redis (Valkey) to minimize database query stress:
*   **Metadata Caching**: Looks up `vaultdrive:file:${fileId}` first, populating on misses (5-min TTL) and evicting immediately on deletion.
*   **Share Link Performance**:
    *   **Unlimited links** are cached in Redis including file and chunk structures. Streaming downloads query Redis and run DB download count increments asynchronously in the background.
    *   **Limited links** (`maxDownloads` enforced) run synchronous, atomic database increments on download to prevent concurrency limit bypasses.

---

## Architectural Layout

```mermaid
graph TD
    Client[Web/API Client]
    Express[Express.js App]
    Redis[Redis/Valkey Cache]
    DB[(PostgreSQL Database)]
    Filebase[Filebase S3 Storage]

    Client -->|API Requests| Express
    Express <-->|Cache Check/Invalidate| Redis
    Express <-->|Transaction Queries| DB
    Express <-->|Download/Upload Streams| Filebase
```

---

## API Endpoints Reference

### Authentication
*   `POST /api/v1/auth/register`: Register user credentials. Returns JWT.
*   `POST /api/v1/auth/login`: Login user. Returns JWT.
*   `GET /api/v1/auth/me`: Retrieve profile of authenticated user.

### File Metadata & Standard Downloads (Authenticated)
*   `POST /api/v1/files/upload`: Single multipart file upload (automatically checks for versioning/dedup).
*   `GET /api/v1/files`: List user's files with offset pagination.
*   `GET /api/v1/files/:id`: Get metadata of a single file (cache-aside).
*   `GET /api/v1/files/:id/download`: Stream file binaries sequentially chunk-by-chunk.
*   `DELETE /api/v1/files/:id`: Safely delete file version metadata and clean up orphaned chunks.

### Public File Sharing (Unauthenticated Downloads)
*   `POST /api/v1/files/:id/share`: Generate a secure share link token (supports `expiresAt` and `maxDownloads`).
*   `GET /api/v1/share/:token`: Public endpoint to download shared files chunk-by-chunk.

### File Version Control (Authenticated)
*   `GET /api/v1/files/:id/versions`: Fetch full version history list.
*   `POST /api/v1/files/:id/restore/:versionId`: Perform zero-copy version restore.

### Resumable Chunk Uploads (Authenticated)
*   `POST /api/v1/files/chunk/start`: Initiate a resumable upload session.
*   `POST /api/v1/files/chunk/:sessionId/upload`: Upload individual chunk binary (multipart or octet-stream).
*   `GET /api/v1/files/chunk/:sessionId/status`: Get list of completed chunk indexes.
*   `POST /api/v1/files/chunk/:sessionId/complete`: finalize uploads, calculate hashes, and commit file.

---

## Database Entity Relations (Prisma)

*   `User`: Owns `File` and `UploadSession` records.
*   `File`: Tracks `filename`, `mimeType`, `totalSize`, and is linked to multiple `FileVersion` records.
*   `FileVersion`: Represents a snapshot of the file at a point in time, linking to multiple ordered `FileChunk` join records.
*   `Chunk`: Core deduplicated block representation. Unique by `sha256Hash` and `storageKey`, containing a `referenceCount`.
*   `FileChunk`: Connects `FileVersion` and `Chunk` with a `chunkIndex` preserving chunk assembly order.
*   `UploadSession`: Tracks state, expiry, and progress mapping for chunked uploads.
*   `ShareLink`: Tracks tokens, download caps, and access logs.

---

## Local Setup & Configuration

### Prerequisites
*   Node.js (v18+)
*   pnpm (v8+)
*   PostgreSQL & Redis

### 1. Environment Configurations
Create a `.env` file in the root folder using `.env.example` as a baseline:
```env
PORT=3000
DATABASE_URL="postgresql://username:password@localhost:5432/vaultdrive?schema=public"
REDIS_URL="redis://127.0.0.1:6379"
JWT_SECRET="generate-a-secure-random-secret"

# Filebase Credentials
FILEBASE_ACCESS_KEY="your-filebase-access-key"
FILEBASE_SECRET_KEY="your-filebase-secret-key"
FILEBASE_BUCKET="chunkvault"

CHUNK_SIZE_BYTES=5242880  # 5 MB Default
```

### 2. Installations & Database Sync
```bash
pnpm install
pnpm prisma:generate
npx prisma db push
```

### 3. Running App
```bash
pnpm dev
pnpm build
pnpm start
```