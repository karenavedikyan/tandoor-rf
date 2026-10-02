import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { S3Client, GetObjectCommand, PutObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

/** Only server configuration chooses an endpoint/bucket. Never accept URLs from catalog data. */
export function s3Config() {
  const bucket = process.env.CATALOG_IMAGE_S3_BUCKET?.trim();
  const endpoint = process.env.CATALOG_IMAGE_S3_ENDPOINT?.trim();
  const accessKeyId = process.env.CATALOG_IMAGE_S3_ACCESS_KEY;
  const secretAccessKey = process.env.CATALOG_IMAGE_S3_SECRET_KEY;
  if (!bucket || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) ||
      endpoint !== "https://s3.twcstorage.ru" || !accessKeyId || !secretAccessKey) {
    throw new Error("Catalog S3 configuration unavailable.");
  }
  return { bucket, endpoint, accessKeyId, secretAccessKey };
}

export function s3Enabled(): boolean {
  return process.env.CATALOG_IMAGE_STORAGE_BACKEND === "s3";
}

let cached: { signature: string; client: S3Client } | undefined;
function client(): S3Client {
  const c = s3Config();
  const signature = createHash("sha256").update(JSON.stringify(c)).digest("hex");
  if (!cached || cached.signature !== signature) {
    cached?.client.destroy();
    cached = { signature, client: new S3Client({
      region: "ru-1", endpoint: c.endpoint, forcePathStyle: true, maxAttempts: 2,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
      requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, socketTimeout: 15000 }),
      requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    }) };
  }
  return cached.client;
}

export function s3PreviewKey(storagePath: string): { key: string; hash: string } {
  const { bucket } = s3Config();
  const prefix = `s3://${bucket}/`;
  if (!s3Enabled() || !storagePath.startsWith(prefix)) throw new Error("Invalid catalog S3 path.");
  const key = storagePath.slice(prefix.length);
  const m = /^previews\/([a-f0-9]{2})\/([a-f0-9]{64})\.webp$/.exec(key);
  if (!m || m[1] !== m[2]!.slice(0, 2)) throw new Error("Invalid catalog S3 path.");
  return { key, hash: m[2]! };
}

export async function checkS3Storage(): Promise<void> {
  const { bucket } = s3Config();
  await client().send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(20000) });
}

export async function collectBoundedBody(body: Readable, expected: number, limit: number): Promise<Buffer> {
  if (!Number.isSafeInteger(expected) || expected <= 0 || expected > limit) {
    body.destroy(); throw new Error("Stored preview size invalid.");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of body) {
      const b = Buffer.from(chunk);
      bytes += b.length;
      if (bytes > expected || bytes > limit) throw new Error("Stored preview exceeds limit.");
      chunks.push(b);
    }
    if (bytes !== expected) throw new Error("Incomplete stored preview.");
    return Buffer.concat(chunks);
  } finally { body.destroy(); }
}

export async function readS3Preview(storagePath: string, limit: number): Promise<Buffer> {
  const { key, hash } = s3PreviewKey(storagePath);
  const response = await client().send(new GetObjectCommand({ Bucket: s3Config().bucket, Key: key }),
    { abortSignal: AbortSignal.timeout(20000) });
  if (!(response.Body instanceof Readable)) throw new Error("Stored preview unavailable.");
  const buffer = await collectBoundedBody(response.Body, response.ContentLength ?? 0, limit);
  if (createHash("sha256").update(buffer).digest("hex") !== hash) throw new Error("Stored preview hash mismatch.");
  return buffer;
}

export async function writeS3Preview(hash: string, buffer: Buffer): Promise<string> {
  const storagePath = `s3://${s3Config().bucket}/previews/${hash.slice(0, 2)}/${hash}.webp`;
  const { key } = s3PreviewKey(storagePath);
  if (createHash("sha256").update(buffer).digest("hex") !== hash) throw new Error("Preview hash mismatch.");
  await client().send(new PutObjectCommand({
    Bucket: s3Config().bucket, Key: key, Body: buffer, ContentLength: buffer.length,
    ContentType: "image/webp", CacheControl: "private, max-age=86400",
  }), { abortSignal: AbortSignal.timeout(20000) });
  // S3 PUT is atomic. Never publish the DB asset until its bytes have been read back.
  await readS3Preview(storagePath, buffer.length);
  return storagePath;
}
