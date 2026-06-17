/**
 * @file Storage provider interface.
 *
 * This is the core abstraction that decouples VaultDrive from any specific
 * object storage vendor. All file/chunk storage operations go through this
 * interface, allowing the underlying provider to be swapped without changing
 * any service-layer code.
 *
 * Current implementation: FilebaseStorageProvider (S3-compatible)
 * Future possibilities: AWS S3, Google Cloud Storage, MinIO, local filesystem
 */

export { StorageProvider } from '../types/index';
