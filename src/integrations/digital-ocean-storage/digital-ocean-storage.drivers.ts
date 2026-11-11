import { S3Driver } from 'flydrive/drivers/s3';
import { registerStorageDriver } from '../../services/storageDriverRegistry.service.ts';

registerStorageDriver(
    'digital-ocean-storage',
    (visibility: 'public' | 'private', connection: ConnectionConfig, runtimeConfig: StorageRuntimeConfig) =>
        new S3Driver({
            credentials: {
                accessKeyId: connection?.accessKeyId,
                secretAccessKey: connection?.secretAccessKey,
            },
            endpoint: 'https://sgp1.digitaloceanspaces.com',
            region: connection?.region,
            bucket: visibility === 'private' ? runtimeConfig?.privateBucket : runtimeConfig?.publicBucket,
            visibility,
            supportsACL: false,
        })
);
