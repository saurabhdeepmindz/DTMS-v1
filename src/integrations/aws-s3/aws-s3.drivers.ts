import { S3Driver } from 'flydrive/drivers/s3';
import { registerStorageDriver } from '../../services/storageDriverRegistry.service.ts';
import { createS3StorageOptions } from './s3Storage.utils.ts';

registerStorageDriver(
    'aws-s3',
    (visibility, connection, runtimeConfig) =>
        new S3Driver(createS3StorageOptions(visibility, connection, runtimeConfig))
);
