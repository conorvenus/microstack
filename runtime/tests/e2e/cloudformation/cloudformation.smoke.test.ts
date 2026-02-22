import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
} from "@aws-sdk/client-cloudformation";
import { CloudWatchLogsClient, DescribeLogStreamsCommand, GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DeleteFunctionCommand, InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { createMicrostackServer, type MicrostackServer } from "../../../src/index.js";

function createClientConfig(endpoint: string) {
  return {
    endpoint,
    region: "us-east-1",
    credentials: {
      accessKeyId: "test",
      secretAccessKey: "test",
    },
  };
}

function decodePayload(payload?: Uint8Array): unknown {
  if (!payload) {
    return undefined;
  }
  const raw = Buffer.from(payload).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : undefined;
}

describe("cloudformation e2e smoke", () => {
  let server: MicrostackServer;
  let cfn: CloudFormationClient;
  let lambda: LambdaClient;
  let logs: CloudWatchLogsClient;
  let s3: S3Client;

  beforeAll(async () => {
    server = await createMicrostackServer({ port: 0 });
    cfn = new CloudFormationClient(createClientConfig(server.endpoint));
    lambda = new LambdaClient(createClientConfig(server.endpoint));
    logs = new CloudWatchLogsClient(createClientConfig(server.endpoint));
    s3 = new S3Client({ ...createClientConfig(server.endpoint), forcePathStyle: true });
  });

  afterAll(async () => {
    cfn.destroy();
    lambda.destroy();
    logs.destroy();
    s3.destroy();
    await server.close();
  });

  it("cross-service: cfn-created lambda writes events queryable via cloudwatch logs", async () => {
    await cfn.send(
      new CreateStackCommand({
        StackName: "e2e-cfn-stack",
        TemplateBody: JSON.stringify({
          Resources: {
            Logs: {
              Type: "AWS::Logs::LogGroup",
              Properties: {
                LogGroupName: "/aws/lambda/e2e-cfn-fn",
              },
            },
            Fn: {
              Type: "AWS::Lambda::Function",
              DependsOn: "Logs",
              Properties: {
                FunctionName: "e2e-cfn-fn",
                Runtime: "nodejs20.x",
                Role: "arn:aws:iam::000000000000:role/lambda-role",
                Handler: "index.handler",
                Code: {
                  ZipFile:
                    "export async function handler(event){return {from:'cfn-e2e',value:event?.value??null};}",
                },
              },
            },
          },
        }),
      }),
    );

    const invocation = await lambda.send(
      new InvokeCommand({
        FunctionName: "e2e-cfn-fn",
        Payload: Buffer.from(JSON.stringify({ value: "ok" })),
      }),
    );
    expect(invocation.StatusCode).toBe(200);

    const streams = await logs.send(
      new DescribeLogStreamsCommand({
        logGroupName: "/aws/lambda/e2e-cfn-fn",
      }),
    );
    const streamName = streams.logStreams?.[0]?.logStreamName;
    expect(streamName).toBeDefined();

    const events = await logs.send(
      new GetLogEventsCommand({
        logGroupName: "/aws/lambda/e2e-cfn-fn",
        logStreamName: streamName!,
      }),
    );
    const messages = (events.events ?? []).map((event) => event.message ?? "");
    expect(messages.some((message) => message.includes('"from":"cfn-e2e"'))).toBe(true);

    await cfn.send(new DeleteStackCommand({ StackName: "e2e-cfn-stack" }));
  });

  it("cloudformation delete fails on non-empty managed s3 bucket", async () => {
    await cfn.send(
      new CreateStackCommand({
        StackName: "e2e-cfn-s3-stack",
        TemplateBody: JSON.stringify({
          Resources: {
            Bucket: {
              Type: "AWS::S3::Bucket",
              Properties: {
                BucketName: "e2e-cfn-s3-bucket",
              },
            },
          },
        }),
      }),
    );

    await s3.send(
      new PutObjectCommand({
        Bucket: "e2e-cfn-s3-bucket",
        Key: "data.txt",
        Body: "hello",
      }),
    );

    await cfn.send(new DeleteStackCommand({ StackName: "e2e-cfn-s3-stack" }));

    const failed = await cfn.send(new DescribeStacksCommand({ StackName: "e2e-cfn-s3-stack" }));
    expect(failed.Stacks?.[0]?.StackStatus).toBe("DELETE_FAILED");

    await s3.send(new DeleteObjectCommand({ Bucket: "e2e-cfn-s3-bucket", Key: "data.txt" }));
    await cfn.send(new DeleteStackCommand({ StackName: "e2e-cfn-s3-stack" }));

    const deleted = await cfn.send(new DescribeStacksCommand({ StackName: "e2e-cfn-s3-stack" }));
    expect(deleted.Stacks?.[0]?.StackStatus).toBe("DELETE_COMPLETE");
  });

  it("updates cfn stack lambda code and delete is idempotent when function missing", async () => {
    await cfn.send(
      new CreateStackCommand({
        StackName: "e2e-cfn-update-stack",
        TemplateBody: JSON.stringify({
          Resources: {
            Fn: {
              Type: "AWS::Lambda::Function",
              Properties: {
                FunctionName: "e2e-cfn-update-fn",
                Runtime: "nodejs20.x",
                Role: "arn:aws:iam::000000000000:role/lambda-role",
                Handler: "index.handler",
                Code: {
                  ZipFile: "export async function handler(){return {version:1};}",
                },
              },
            },
          },
        }),
      }),
    );

    const firstInvoke = await lambda.send(new InvokeCommand({ FunctionName: "e2e-cfn-update-fn" }));
    expect(decodePayload(firstInvoke.Payload)).toEqual({ version: 1 });

    await cfn.send(
      new UpdateStackCommand({
        StackName: "e2e-cfn-update-stack",
        TemplateBody: JSON.stringify({
          Resources: {
            Fn: {
              Type: "AWS::Lambda::Function",
              Properties: {
                FunctionName: "e2e-cfn-update-fn",
                Runtime: "nodejs20.x",
                Role: "arn:aws:iam::000000000000:role/lambda-role",
                Handler: "index.handler",
                Code: {
                  ZipFile: "export async function handler(){return {version:2};}",
                },
              },
            },
          },
        }),
      }),
    );

    const secondInvoke = await lambda.send(new InvokeCommand({ FunctionName: "e2e-cfn-update-fn" }));
    expect(decodePayload(secondInvoke.Payload)).toEqual({ version: 2 });

    await lambda.send(new DeleteFunctionCommand({ FunctionName: "e2e-cfn-update-fn" }));
    await cfn.send(new DeleteStackCommand({ StackName: "e2e-cfn-update-stack" }));

    const deleted = await cfn.send(new DescribeStacksCommand({ StackName: "e2e-cfn-update-stack" }));
    expect(deleted.Stacks?.[0]?.StackStatus).toBe("DELETE_COMPLETE");
  });
});
