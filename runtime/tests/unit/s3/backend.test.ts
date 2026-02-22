import { describe, expect, it } from "vitest";
import { HttpError } from "../../../src/http-error.js";
import { createS3Backend } from "../../../src/services/s3/index.js";

describe("s3 backend", () => {
  it("handles bucket lifecycle and listing", () => {
    const backend = createS3Backend();

    backend.createBucket("unit-bucket");

    const buckets = backend.listBuckets();
    expect(buckets.map((bucket) => bucket.name)).toContain("unit-bucket");

    const head = backend.headBucket("unit-bucket");
    expect(head.name).toBe("unit-bucket");

    backend.deleteBucket("unit-bucket");
    expect(backend.listBuckets().map((bucket) => bucket.name)).not.toContain("unit-bucket");
  });

  it("rejects duplicate bucket creation", () => {
    const backend = createS3Backend();
    backend.createBucket("dup-bucket");

    expect(() => backend.createBucket("dup-bucket")).toThrowError(HttpError);
  });

  it("rejects deleting non-empty buckets", () => {
    const backend = createS3Backend();
    backend.createBucket("non-empty");
    backend.putObject("non-empty", "hello.txt", Buffer.from("hello"));

    expect(() => backend.deleteBucket("non-empty")).toThrowError(HttpError);
  });

  it("handles object CRUD with binary payload and metadata", () => {
    const backend = createS3Backend();
    backend.createBucket("objects");

    const payload = Buffer.from([0, 1, 2, 255]);
    backend.putObject("objects", "bin/data.bin", payload, "application/octet-stream");

    const head = backend.headObject("objects", "bin/data.bin");
    expect(head.contentLength).toBe(4);
    expect(head.contentType).toBe("application/octet-stream");
    expect(head.etag).toMatch(/^[a-f0-9]{32}$/i);

    const object = backend.getObject("objects", "bin/data.bin");
    expect(Buffer.from(object.body)).toEqual(payload);

    backend.deleteObject("objects", "bin/data.bin");
    expect(() => backend.headObject("objects", "bin/data.bin")).toThrowError(HttpError);
  });

  it("lists objects with prefix and stable sort order", () => {
    const backend = createS3Backend();
    backend.createBucket("list-bucket");

    backend.putObject("list-bucket", "a/2.txt", Buffer.from("2"));
    backend.putObject("list-bucket", "a/1.txt", Buffer.from("1"));
    backend.putObject("list-bucket", "b/1.txt", Buffer.from("x"));

    const listed = backend.listObjectsV2("list-bucket", { prefix: "a/" });
    expect(listed.contents.map((item) => item.key)).toEqual(["a/1.txt", "a/2.txt"]);
  });

  it("throws not found errors for missing bucket and object", () => {
    const backend = createS3Backend();

    expect(() => backend.headBucket("missing")).toThrowError(HttpError);

    backend.createBucket("existing");
    expect(() => backend.getObject("existing", "missing.txt")).toThrowError(HttpError);
  });
});
