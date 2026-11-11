# S3-compatible storage and Cloudflare R2

AWS S3, S3 compatible and Cloudflare R2 are separate providers. The AWS S3 connection asks for AWS credentials and a region. The S3 compatible connection requires the provider's S3 API endpoint, credentials and signing region, including `auto` when appropriate. Custom endpoints default to path-style addressing (`endpoint/bucket/key`); open Advanced to choose virtual hosted addressing (`bucket.endpoint/key`) when required by the provider.

Cloudflare R2 has a dedicated connection. Enter the Account ID and the R2 Access Key ID / Secret Access Key. The driver derives `https://<account-id>.r2.cloudflarestorage.com`, uses region `auto`, and disables object ACL commands. A Cloudflare management API token is not an R2 Secret Access Key.

Use separate private and public buckets. For R2 public files, enable a custom domain or an `r2.dev` domain on the public bucket and enter that domain as the Public bucket URL during setup. The authenticated S3 API endpoint cannot serve anonymous public downloads. Private downloads and browser uploads use signed API URLs. Configure bucket CORS for the editor and application origins, with `PUT`, `GET`, `HEAD`, the upload request headers, and exposed `ETag`.

The drivers support the existing storage operations: reads, streamed reads/writes, metadata, listing, copy, move, delete, signed downloads, and signed PUT uploads. A public CDN URL can include a path prefix; file path segments are URL-encoded. Bucket checks preserve AWS checks for native AWS and use the configured endpoint for compatible providers without calling AWS public-access-block APIs.

## Self-hosted configuration

Without `STORAGE_CONNECTION_ID`, set the following variables in each runtime environment:

| Provider      | Variables                                                                                                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS S3        | `STORAGE_INTEGRATION=aws-s3`, `AWS_S3_REGION`, `AWS_S3_ACCESS_KEY_ID`, `AWS_S3_SECRET_ACCESS_KEY`                                                                                                                    |
| S3 compatible | `STORAGE_INTEGRATION=s3-compatible`, `S3_COMPATIBLE_REGION`, `S3_COMPATIBLE_ACCESS_KEY_ID`, `S3_COMPATIBLE_SECRET_ACCESS_KEY`, `S3_COMPATIBLE_ENDPOINT`; optionally `S3_COMPATIBLE_FORCE_PATH_STYLE=true` or `false` |
| R2            | `STORAGE_INTEGRATION=cloudflare`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ACCESS_KEY_ID`, `CLOUDFLARE_SECRET_ACCESS_KEY`                                                                                                |

All providers use `STORAGE_PRIVATE_BUCKET`, optionally `STORAGE_PUBLIC_BUCKET`, and optionally `STORAGE_CDN_URL`. R2 requires `STORAGE_CDN_URL` when public storage is used. Keep access credentials on the server. Connected editor projects continue to resolve connection credentials and storage settings independently for editor, staging, and production.

Custom endpoints use the S3 compatible provider and its `S3_COMPATIBLE_*` variables. `AWS_S3_ENDPOINT` and `AWS_S3_FORCE_PATH_STYLE` configure the separate WeWeb tenant-bucket proxy; customer AWS S3 storage ignores them.
