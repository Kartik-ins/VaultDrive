/**
 * @file Storage provider factory.
 *
 * Returns the active StorageProvider instance. Currently always returns
 * FilebaseStorageProvider. To add a new provider (e.g., LocalStorageProvider
 * for testing), add a condition here — no service-layer changes needed.
 *
 * This is a factory function rather than a simple export so we can
 * eventually support runtime provider selection via environment variables.
 */

import { StorageProvider } from '../types/index';
import { FilebaseStorageProvider } from './filebase.provider';

// Singleton instance — reused across all service calls
let storageInstance: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!storageInstance) {
    storageInstance = new FilebaseStorageProvider();
  }
  return storageInstance;
}
