import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMicrostackServer, type MicrostackServer } from "../../../src/index.js";

function hasXmlHeader(contentType: string | null): boolean {
  return typeof contentType === "string" && contentType.includes("xml");
}

describe("s3 route mounting", () => {
  let server: MicrostackServer;

  beforeAll(async () => {
    server = await createMicrostackServer({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it("serves ListBuckets as xml", async () => {
    const response = await fetch(`${server.endpoint}/`);

    expect(response.status).toBe(200);
    expect(hasXmlHeader(response.headers.get("content-type"))).toBe(true);
    const text = await response.text();
    expect(text).toContain("<ListAllMyBucketsResult");
  });

  it("supports bucket and object operations via path-style URLs", async () => {
    const createBucket = await fetch(`${server.endpoint}/routes-bucket`, { method: "PUT" });
    expect(createBucket.status).toBe(200);

    const putObject = await fetch(`${server.endpoint}/routes-bucket/hello.txt`, {
      method: "PUT",
      headers: {
        "content-type": "text/plain",
      },
      body: "hello-routes",
    });
    expect(putObject.status).toBe(200);

    const headObject = await fetch(`${server.endpoint}/routes-bucket/hello.txt`, { method: "HEAD" });
    expect(headObject.status).toBe(200);
    expect(headObject.headers.get("etag")).toBeTruthy();

    const getObject = await fetch(`${server.endpoint}/routes-bucket/hello.txt`);
    expect(getObject.status).toBe(200);
    expect(await getObject.text()).toBe("hello-routes");

    const listObjects = await fetch(`${server.endpoint}/routes-bucket?list-type=2`);
    expect(listObjects.status).toBe(200);
    const listXml = await listObjects.text();
    expect(listXml).toContain("<ListBucketResult");
    expect(listXml).toContain("<Key>hello.txt</Key>");

    const deleteObject = await fetch(`${server.endpoint}/routes-bucket/hello.txt`, { method: "DELETE" });
    expect(deleteObject.status).toBe(204);

    const deleteBucket = await fetch(`${server.endpoint}/routes-bucket`, { method: "DELETE" });
    expect(deleteBucket.status).toBe(204);
  });

  it("returns s3-style errors", async () => {
    const missingBucket = await fetch(`${server.endpoint}/missing-bucket`, { method: "HEAD" });
    expect(missingBucket.status).toBe(404);

    const response = await fetch(`${server.endpoint}/missing-bucket/missing.txt`);
    expect(response.status).toBe(404);
    expect(hasXmlHeader(response.headers.get("content-type"))).toBe(true);
    const text = await response.text();
    expect(text).toContain("<Error>");
    expect(text).toContain("<Code>NoSuchBucket</Code>");
  });
});
