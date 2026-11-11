import { GCSDriver } from 'flydrive/drivers/gcs';
import { registerStorageDriver } from '../../services/storageDriverRegistry.service.ts';

registerStorageDriver(
    'google-cloud-storage',
    (visibility: 'public' | 'private', connection: ConnectionConfig, runtimeConfig: StorageRuntimeConfig) =>
        new GCSDriver({
            credentials: {
                project_id: connection?.projectId,
                client_email: connection?.clientEmail,
                private_key: connection?.privateKey,
            },
            bucket: visibility === 'private' ? runtimeConfig?.privateBucket : runtimeConfig?.publicBucket,
            visibility,
            usingUniformAcl: true,
        })
);
