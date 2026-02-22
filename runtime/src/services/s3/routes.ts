import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "../../http-error.js";
import { readBody } from "../../server.js";
import type { S3Backend, S3ListObjectsV2Output } from "./types.js";

export type S3RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
) => Promise<boolean>;

const RESERVED_FIRST_SEGMENTS = new Set(["microstack", "2015-03-31"]);

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sendXml(res: ServerResponse, statusCode: number, body: string, headers?: Record<string, string>): void {
  const payload = Buffer.from(body, "utf8");
  res.writeHead(statusCode, {
    "content-type": "application/xml",
    "content-length": String(payload.byteLength),
    ...headers,
  });
  res.end(payload);
}

function sendEmpty(res: ServerResponse, statusCode: number, headers?: Record<string, string>): void {
  res.writeHead(statusCode, headers);
  res.end();
}

function sendObject(res: ServerResponse, statusCode: number, body: Uint8Array, headers?: Record<string, string>): void {
  const payload = Buffer.from(body);
  res.writeHead(statusCode, {
    "content-length": String(payload.byteLength),
    ...headers,
  });
  res.end(payload);
}

function toErrorStatus(code: string, fallback: number): number {
  if (code === "NoSuchBucket" || code === "NoSuchKey") {
    return 404;
  }
  if (code === "BucketAlreadyOwnedByYou" || code === "BucketNotEmpty") {
    return 409;
  }
  if (code === "InvalidBucketName" || code === "InvalidArgument") {
    return 400;
  }
  return fallback;
}

function sendErrorXml(
  res: ServerResponse,
  errorCode: string,
  message: string,
  statusCode: number,
  resource?: string,
): void {
  sendXml(
    res,
    statusCode,
    `<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>${xmlEscape(errorCode)}</Code>
  <Message>${xmlEscape(message)}</Message>
  ${resource ? `<Resource>${xmlEscape(resource)}</Resource>` : ""}
  <RequestId>${randomUUID()}</RequestId>
</Error>`,
  );
}

function parsePath(pathname: string): { bucket?: string; key?: string } {
  const parts = pathname.split("/").filter((part) => part.length > 0).map((part) => decodeURIComponent(part));
  if (parts.length === 0) {
    return {};
  }
  if (parts.length === 1) {
    const bucket = parts[0];
    return bucket ? { bucket } : {};
  }
  const bucket = parts[0];
  if (!bucket) {
    return {};
  }
  return {
    bucket,
    key: parts.slice(1).join("/"),
  };
}

function buildListBucketsXml(buckets: Array<{ name: string; creationDate: string }>): string {
  const members = buckets
    .map(
      (bucket) => `<Bucket>
      <Name>${xmlEscape(bucket.name)}</Name>
      <CreationDate>${xmlEscape(bucket.creationDate)}</CreationDate>
    </Bucket>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Owner>
    <ID>000000000000</ID>
    <DisplayName>microstack</DisplayName>
  </Owner>
  <Buckets>${members}</Buckets>
</ListAllMyBucketsResult>`;
}

function buildListObjectsV2Xml(output: S3ListObjectsV2Output): string {
  const contents = output.contents
    .map(
      (item) => `<Contents>
      <Key>${xmlEscape(item.key)}</Key>
      <LastModified>${xmlEscape(item.lastModified)}</LastModified>
      <ETag>&quot;${xmlEscape(item.etag)}&quot;</ETag>
      <Size>${item.size}</Size>
      <StorageClass>STANDARD</StorageClass>
    </Contents>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${xmlEscape(output.name)}</Name>
  <Prefix>${xmlEscape(output.prefix)}</Prefix>
  ${output.continuationToken ? `<ContinuationToken>${xmlEscape(output.continuationToken)}</ContinuationToken>` : ""}
  <KeyCount>${output.keyCount}</KeyCount>
  <MaxKeys>${output.maxKeys}</MaxKeys>
  <IsTruncated>${output.isTruncated ? "true" : "false"}</IsTruncated>
  ${output.nextContinuationToken ? `<NextContinuationToken>${xmlEscape(output.nextContinuationToken)}</NextContinuationToken>` : ""}
  ${contents}
</ListBucketResult>`;
}

function toHttpDate(iso: string): string {
  return new Date(iso).toUTCString();
}

export function createS3RouteHandler(backend: S3Backend): S3RouteHandler {
  return async (req, res, pathname, method) => {
    if (method === "POST") {
      return false;
    }

    const parsedUrl = new URL(req.url ?? "/", "http://localhost");
    const listType = parsedUrl.searchParams.get("list-type");
    const prefix = parsedUrl.searchParams.get("prefix") ?? undefined;
    const continuationToken = parsedUrl.searchParams.get("continuation-token") ?? undefined;
    const maxKeysRaw = parsedUrl.searchParams.get("max-keys");

    try {
      const { bucket, key } = parsePath(pathname);

      if (bucket && RESERVED_FIRST_SEGMENTS.has(bucket)) {
        return false;
      }

      if (!bucket && method === "GET") {
        sendXml(res, 200, buildListBucketsXml(backend.listBuckets()));
        return true;
      }

      if (!bucket) {
        return false;
      }

      if (!key && method === "PUT") {
        backend.createBucket(bucket);
        sendEmpty(res, 200);
        return true;
      }

      if (!key && method === "HEAD") {
        backend.headBucket(bucket);
        sendEmpty(res, 200);
        return true;
      }

      if (!key && method === "DELETE") {
        backend.deleteBucket(bucket);
        sendEmpty(res, 204);
        return true;
      }

      if (!key && method === "GET" && listType === "2") {
        const listInput: { prefix?: string; continuationToken?: string; maxKeys?: number } = {};
        if (prefix !== undefined) {
          listInput.prefix = prefix;
        }
        if (continuationToken !== undefined) {
          listInput.continuationToken = continuationToken;
        }
        if (maxKeysRaw !== null) {
          listInput.maxKeys = maxKeysRaw.length === 0 ? Number.NaN : Number(maxKeysRaw);
        }
        const listed = backend.listObjectsV2(bucket, listInput);
        sendXml(res, 200, buildListObjectsV2Xml(listed));
        return true;
      }

      if (!key && method === "GET") {
        return false;
      }

      if (!key) {
        return false;
      }

      if (method === "PUT") {
        const body = await readBody(req);
        const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : undefined;
        const stored = backend.putObject(bucket, key, body, contentType);
        sendEmpty(res, 200, {
          etag: `"${stored.etag}"`,
        });
        return true;
      }

      if (method === "GET") {
        const object = backend.getObject(bucket, key);
        sendObject(res, 200, object.body, {
          "content-type": object.contentType,
          etag: `"${object.etag}"`,
          "last-modified": toHttpDate(object.lastModified),
        });
        return true;
      }

      if (method === "HEAD") {
        const object = backend.headObject(bucket, key);
        sendEmpty(res, 200, {
          "content-length": String(object.contentLength),
          "content-type": object.contentType,
          etag: `"${object.etag}"`,
          "last-modified": toHttpDate(object.lastModified),
        });
        return true;
      }

      if (method === "DELETE") {
        backend.deleteObject(bucket, key);
        sendEmpty(res, 204);
        return true;
      }

      return false;
    } catch (error) {
      if (error instanceof HttpError) {
        sendErrorXml(res, error.code, error.message, toErrorStatus(error.code, error.statusCode), pathname);
        return true;
      }
      const err = error as Error;
      sendErrorXml(res, "InternalError", err.message || "S3 request failed", 500, pathname);
      return true;
    }
  };
}
