import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
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

describe("s3 e2e smoke", () => {
  let server: MicrostackServer;
  let s3: S3Client;

  beforeAll(async () => {
    server = await createMicrostackServer({ port: 0 });
    s3 = new S3Client({
      endpoint: server.endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: "test",
        secretAccessKey: "test",
      },
    });
  });

  afterAll(async () => {
    s3.destroy();
    await server.close();
  });

  it("create -> put -> get -> delete object -> delete bucket", async () => {
    await s3.send(new CreateBucketCommand({ Bucket: "e2e-s3-bucket" }));

    await s3.send(
      new PutObjectCommand({
        Bucket: "e2e-s3-bucket",
        Key: "smoke.txt",
        Body: "smoke-data",
      }),
    );

    const get = await s3.send(new GetObjectCommand({ Bucket: "e2e-s3-bucket", Key: "smoke.txt" }));
    expect(await streamToString(get.Body)).toBe("smoke-data");

    await s3.send(new DeleteObjectCommand({ Bucket: "e2e-s3-bucket", Key: "smoke.txt" }));
    await s3.send(new DeleteBucketCommand({ Bucket: "e2e-s3-bucket" }));
  });
});
