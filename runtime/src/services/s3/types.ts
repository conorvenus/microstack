export type S3BucketSummary = {
  name: string;
  creationDate: string;
};

export type S3HeadBucketOutput = {
  name: string;
  creationDate: string;
};

export type S3ObjectSummary = {
  key: string;
  etag: string;
  size: number;
  lastModified: string;
};

export type S3HeadObjectOutput = {
  etag: string;
  contentLength: number;
  contentType: string;
  lastModified: string;
};

export type S3GetObjectOutput = S3HeadObjectOutput & {
  body: Uint8Array;
};

export type S3ListObjectsV2Input = {
  prefix?: string;
  continuationToken?: string;
  maxKeys?: number;
};

export type S3ListObjectsV2Output = {
  name: string;
  prefix: string;
  continuationToken?: string;
  maxKeys: number;
  keyCount: number;
  isTruncated: boolean;
  nextContinuationToken?: string;
  contents: S3ObjectSummary[];
};

export interface S3Backend {
  createBucket(name: string): S3HeadBucketOutput;
  listBuckets(): S3BucketSummary[];
  headBucket(name: string): S3HeadBucketOutput;
  deleteBucket(name: string): void;
  putObject(bucket: string, key: string, body: Uint8Array, contentType?: string): S3HeadObjectOutput;
  getObject(bucket: string, key: string): S3GetObjectOutput;
  headObject(bucket: string, key: string): S3HeadObjectOutput;
  deleteObject(bucket: string, key: string): void;
  listObjectsV2(bucket: string, input?: S3ListObjectsV2Input): S3ListObjectsV2Output;
}
