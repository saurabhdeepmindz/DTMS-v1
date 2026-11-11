import { S3Driver } from 'flydrive/drivers/s3';
import { registerStorageDriver } from '../../services/storageDriverRegistry.service.ts';
import { createS3StorageOptions } from '../aws-s3/s3Storage.utils.ts';

registerStorageDriver(
    'cloudflare',
    (visibility: 'public' | 'private', connection: ConnectionConfig, runtimeConfig: StorageRuntimeConfig) =>
        new S3Driver(createS3StorageOptions(visibility, connection, runtimeConfig, 'cloudflare'))
);
