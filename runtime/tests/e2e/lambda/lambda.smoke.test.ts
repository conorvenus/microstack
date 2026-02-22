import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CreateFunctionCommand,
  DeleteFunctionCommand,
  InvokeCommand,
  LambdaClient,
  UpdateFunctionCodeCommand,
} from "@aws-sdk/client-lambda";
import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import AdmZip from "adm-zip";
import { createMicrostackServer, type MicrostackServer } from "../../../src/index.js";

function createFunctionZip(source: string): Uint8Array {
  const zip = new AdmZip();
  zip.addFile("index.mjs", Buffer.from(source, "utf8"));
  return zip.toBuffer();
}

function decodePayload(payload?: Uint8Array): unknown {
  if (!payload) {
    return undefined;
  }
  return JSON.parse(Buffer.from(payload).toString("utf8"));
}

describe("lambda e2e smoke", () => {
  let server: MicrostackServer;
  let client: LambdaClient;
  let logsClient: CloudWatchLogsClient;

  beforeAll(async () => {
    server = await createMicrostackServer({ port: 0 });
    client = new LambdaClient({
      endpoint: server.endpoint,
      region: "us-east-1",
      credentials: {
        accessKeyId: "test",
        secretAccessKey: "test",
      },
    });
    logsClient = new CloudWatchLogsClient({
      endpoint: server.endpoint,
      region: "us-east-1",
      credentials: {
        accessKeyId: "test",
        secretAccessKey: "test",
      },
    });
  });

  afterAll(async () => {
    client.destroy();
    logsClient.destroy();
    await server.close();
  });

  it("create -> invoke -> update -> invoke -> delete", async () => {
    await client.send(
      new CreateFunctionCommand({
        FunctionName: "smoke-fn",
        Runtime: "nodejs20.x",
        Role: "arn:aws:iam::000000000000:role/lambda-role",
        Handler: "index.handler",
        Code: {
          ZipFile: createFunctionZip("export async function handler() { return { version: 1 }; }"),
        },
      }),
    );

    const firstInvoke = await client.send(new InvokeCommand({ FunctionName: "smoke-fn" }));
    expect(decodePayload(firstInvoke.Payload)).toEqual({ version: 1 });

    await client.send(
      new UpdateFunctionCodeCommand({
        FunctionName: "smoke-fn",
        ZipFile: createFunctionZip("export async function handler() { return { version: 2 }; }"),
      }),
    );

    const secondInvoke = await client.send(new InvokeCommand({ FunctionName: "smoke-fn" }));
    expect(decodePayload(secondInvoke.Payload)).toEqual({ version: 2 });

    await client.send(new DeleteFunctionCommand({ FunctionName: "smoke-fn" }));
  });

  it("cross-service: lambda invocation output is queryable from cloudwatch logs", async () => {
    await client.send(
      new CreateFunctionCommand({
        FunctionName: "cross-service-fn",
        Runtime: "nodejs20.x",
        Role: "arn:aws:iam::000000000000:role/lambda-role",
        Handler: "index.handler",
        Code: {
          ZipFile: createFunctionZip(`
            export async function handler() {
              throw new Error("cross-service-boom");
            }
          `),
        },
        Timeout: 2,
      }),
    );

    const invocation = await client.send(new InvokeCommand({ FunctionName: "cross-service-fn" }));
    expect(invocation.FunctionError).toBe("Unhandled");

    const logGroupName = "/aws/lambda/cross-service-fn";
    const streams = await logsClient.send(new DescribeLogStreamsCommand({ logGroupName }));
    const streamName = streams.logStreams?.[0]?.logStreamName;
    expect(streamName).toBeDefined();

    const events = await logsClient.send(
      new GetLogEventsCommand({
        logGroupName,
        logStreamName: streamName!,
      }),
    );
    const messages = (events.events ?? []).map((event) => event.message ?? "");
    expect(messages.some((message) => message.includes('"errorMessage":"cross-service-boom"'))).toBe(true);

    await client.send(new DeleteFunctionCommand({ FunctionName: "cross-service-fn" }));
  });
});
