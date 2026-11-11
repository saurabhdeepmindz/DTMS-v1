import { S3Driver } from 'flydrive/drivers/s3';
import { registerStorageDriver } from '../../services/storageDriverRegistry.service.ts';
import { createS3StorageOptions } from '../aws-s3/s3Storage.utils.ts';

registerStorageDriver(
    's3-compatible',
    (visibility, connection, runtimeConfig) =>
        new S3Driver(createS3StorageOptions(visibility, connection, runtimeConfig, 's3-compatible'))
);
