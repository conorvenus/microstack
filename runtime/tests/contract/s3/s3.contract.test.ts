import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createMicrostackServer, type MicrostackServer } from "../../../src/index.js";

async function streamToString(body: unknown): Promise<string> {
  if (!body || typeof body !== "object") {
    return "";
  }

  const stream = body as AsyncIterable<Uint8Array>;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function createClient(endpoint: string): S3Client {
  return new S3Client({
    endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: "test",
      secretAccessKey: "test",
    },
  });
}

describe("S3 contract (AWS SDK)", () => {
  let server: MicrostackServer;
  let s3: S3Client;

  beforeAll(async () => {
    server = await createMicrostackServer({ port: 0 });
    s3 = createClient(server.endpoint);
  });

  afterAll(async () => {
    s3.destroy();
    await server.close();
  });

  it("supports bucket and object lifecycle via aws sdk", async () => {
    await s3.send(new CreateBucketCommand({ Bucket: "contract-s3-bucket" }));

    const listedBuckets = await s3.send(new ListBucketsCommand({}));
    expect((listedBuckets.Buckets ?? []).map((bucket) => bucket.Name)).toContain("contract-s3-bucket");

    await s3.send(
      new PutObjectCommand({
        Bucket: "contract-s3-bucket",
        Key: "hello.txt",
        Body: "hello-contract",
        ContentType: "text/plain",
      }),
    );

    const head = await s3.send(
      new HeadObjectCommand({
        Bucket: "contract-s3-bucket",
        Key: "hello.txt",
      }),
    );
    expect(head.ContentLength).toBe(14);
    expect(head.ContentType).toBe("text/plain");
    expect(head.ETag).toBeDefined();

    const get = await s3.send(
      new GetObjectCommand({
        Bucket: "contract-s3-bucket",
        Key: "hello.txt",
      }),
    );
    expect(await streamToString(get.Body)).toBe("hello-contract");

    const listObjects = await s3.send(
      new ListObjectsV2Command({
        Bucket: "contract-s3-bucket",
      }),
    );
    expect((listObjects.Contents ?? []).map((item) => item.Key)).toContain("hello.txt");

    await s3.send(new DeleteObjectCommand({ Bucket: "contract-s3-bucket", Key: "hello.txt" }));
    await s3.send(new DeleteBucketCommand({ Bucket: "contract-s3-bucket" }));
  });

  it("returns BucketNotEmpty when deleting a non-empty bucket", async () => {
    await s3.send(new CreateBucketCommand({ Bucket: "contract-non-empty" }));
    await s3.send(new PutObjectCommand({ Bucket: "contract-non-empty", Key: "x.txt", Body: "x" }));

    await expect(s3.send(new DeleteBucketCommand({ Bucket: "contract-non-empty" }))).rejects.toMatchObject({
      name: "BucketNotEmpty",
    });

    await s3.send(new DeleteObjectCommand({ Bucket: "contract-non-empty", Key: "x.txt" }));
    await s3.send(new DeleteBucketCommand({ Bucket: "contract-non-empty" }));
  });
});
