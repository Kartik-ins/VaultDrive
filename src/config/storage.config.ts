/**
 * @file S3 client configuration for Filebase.
 *
 * Design decision: Filebase is S3-compatible, so we use the standard AWS SDK
 * v3 with a custom endpoint. This means switching to real AWS S3, MinIO, or
 * any other S3-compatible service requires only changing this config file —
 * the storage provider implementation stays identical.
 *
 * The region is set to "auto" as Filebase doesn't use AWS regions.
 * forcePathStyle is required for S3-compatible services that don't support
 * virtual-hosted-style bucket addressing.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { serverConfig } from './index';

export const s3Client = new S3Client({
  endpoint: 'https://s3.filebase.io',
  region: 'auto',
  credentials: {
    accessKeyId: serverConfig.FILEBASE_ACCESS_KEY,
    secretAccessKey: serverConfig.FILEBASE_SECRET_KEY,
  },
  forcePathStyle: true,
});

export const BUCKET_NAME = serverConfig.FILEBASE_BUCKET;
