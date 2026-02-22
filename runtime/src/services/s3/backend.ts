import { createHash } from "node:crypto";
import { HttpError } from "../../http-error.js";
import type {
  S3Backend,
  S3GetObjectOutput,
  S3HeadBucketOutput,
  S3HeadObjectOutput,
  S3ListObjectsV2Input,
  S3ListObjectsV2Output,
} from "./types.js";

type ObjectRecord = {
  key: string;
  body: Uint8Array;
  etag: string;
  contentType: string;
  lastModified: string;
};

type BucketRecord = {
  name: string;
  creationDate: string;
  objects: Map<string, ObjectRecord>;
};

class InMemoryS3Backend implements S3Backend {
  private readonly buckets = new Map<string, BucketRecord>();

  public createBucket(name: string): S3HeadBucketOutput {
    this.validateBucketName(name);
    if (this.buckets.has(name)) {
      throw new HttpError(409, "BucketAlreadyOwnedByYou", `The requested bucket name is not available: ${name}`);
    }
    const creationDate = new Date().toISOString();
    this.buckets.set(name, {
      name,
      creationDate,
      objects: new Map<string, ObjectRecord>(),
    });
    return { name, creationDate };
  }

  public listBuckets(): S3HeadBucketOutput[] {
    return [...this.buckets.values()]
      .map((bucket) => ({ name: bucket.name, creationDate: bucket.creationDate }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  public headBucket(name: string): S3HeadBucketOutput {
    const bucket = this.requireBucket(name);
    return { name: bucket.name, creationDate: bucket.creationDate };
  }

  public deleteBucket(name: string): void {
    const bucket = this.requireBucket(name);
    if (bucket.objects.size > 0) {
      throw new HttpError(409, "BucketNotEmpty", `The bucket you tried to delete is not empty: ${name}`);
    }
    this.buckets.delete(name);
  }

  public putObject(bucketName: string, key: string, body: Uint8Array, contentType?: string): S3HeadObjectOutput {
    const bucket = this.requireBucket(bucketName);
    this.validateObjectKey(key);
    const payload = Buffer.from(body);
    const record: ObjectRecord = {
      key,
      body: payload,
      etag: createHash("md5").update(payload).digest("hex"),
      contentType: contentType && contentType.length > 0 ? contentType : "application/octet-stream",
      lastModified: new Date().toISOString(),
    };
    bucket.objects.set(key, record);
    return this.toHeadObjectOutput(record);
  }

  public getObject(bucketName: string, key: string): S3GetObjectOutput {
    const object = this.requireObject(bucketName, key);
    return {
      ...this.toHeadObjectOutput(object),
      body: Buffer.from(object.body),
    };
  }

  public headObject(bucketName: string, key: string): S3HeadObjectOutput {
    return this.toHeadObjectOutput(this.requireObject(bucketName, key));
  }

  public deleteObject(bucketName: string, key: string): void {
    const bucket = this.requireBucket(bucketName);
    bucket.objects.delete(key);
  }

  public listObjectsV2(bucketName: string, input: S3ListObjectsV2Input = {}): S3ListObjectsV2Output {
    const bucket = this.requireBucket(bucketName);
    const prefix = input.prefix ?? "";
    const maxKeys = this.parseMaxKeys(input.maxKeys);
    const continuationToken = input.continuationToken;

    const keys = [...bucket.objects.keys()].filter((key) => key.startsWith(prefix)).sort((left, right) => left.localeCompare(right));
    let startIndex = 0;
    if (continuationToken) {
      startIndex = keys.findIndex((key) => key > continuationToken);
      if (startIndex === -1) {
        startIndex = keys.length;
      }
    }

    const selectedKeys = keys.slice(startIndex, startIndex + maxKeys);
    const isTruncated = startIndex + selectedKeys.length < keys.length;
    const nextContinuationToken = isTruncated ? selectedKeys[selectedKeys.length - 1] : undefined;

    return {
      name: bucket.name,
      prefix,
      ...(continuationToken ? { continuationToken } : {}),
      maxKeys,
      keyCount: selectedKeys.length,
      isTruncated,
      ...(nextContinuationToken ? { nextContinuationToken } : {}),
      contents: selectedKeys.map((key) => {
        const object = bucket.objects.get(key);
        if (!object) {
          throw new HttpError(500, "InternalError", `Object state missing for key ${key}`);
        }
        return {
          key: object.key,
          etag: object.etag,
          size: object.body.byteLength,
          lastModified: object.lastModified,
        };
      }),
    };
  }

  private toHeadObjectOutput(object: ObjectRecord): S3HeadObjectOutput {
    return {
      etag: object.etag,
      contentLength: object.body.byteLength,
      contentType: object.contentType,
      lastModified: object.lastModified,
    };
  }

  private parseMaxKeys(value: number | undefined): number {
    if (value === undefined) {
      return 1000;
    }
    if (!Number.isInteger(value) || value < 0) {
      throw new HttpError(400, "InvalidArgument", "max-keys must be a non-negative integer");
    }
    return value;
  }

  private requireBucket(name: string): BucketRecord {
    const bucket = this.buckets.get(name);
    if (!bucket) {
      throw new HttpError(404, "NoSuchBucket", `The specified bucket does not exist: ${name}`);
    }
    return bucket;
  }

  private requireObject(bucketName: string, key: string): ObjectRecord {
    const bucket = this.requireBucket(bucketName);
    const object = bucket.objects.get(key);
    if (!object) {
      throw new HttpError(404, "NoSuchKey", `The specified key does not exist: ${key}`);
    }
    return object;
  }

  private validateBucketName(name: string): void {
    if (!name || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name)) {
      throw new HttpError(400, "InvalidBucketName", `The specified bucket is not valid: ${name}`);
    }
  }

  private validateObjectKey(key: string): void {
    if (!key || key.length === 0) {
      throw new HttpError(400, "InvalidArgument", "Object key must be a non-empty string");
    }
  }
}

export function createS3Backend(): S3Backend {
  return new InMemoryS3Backend();
}
