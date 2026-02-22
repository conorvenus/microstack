import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CloudFormationClient, CreateStackCommand, DeleteStackCommand } from "@aws-sdk/client-cloudformation";
import { CloudWatchLogsClient, DescribeLogStreamsCommand, GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
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

describe("cloudformation e2e smoke", () => {
  let server: MicrostackServer;
  let cfn: CloudFormationClient;
  let lambda: LambdaClient;
  let logs: CloudWatchLogsClient;

  beforeAll(async () => {
    server = await createMicrostackServer({ port: 0 });
    cfn = new CloudFormationClient(createClientConfig(server.endpoint));
    lambda = new LambdaClient(createClientConfig(server.endpoint));
    logs = new CloudWatchLogsClient(createClientConfig(server.endpoint));
  });

  afterAll(async () => {
    cfn.destroy();
    lambda.destroy();
    logs.destroy();
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
});
