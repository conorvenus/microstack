import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStackEventsCommand,
  DescribeStackResourcesCommand,
  DescribeStacksCommand,
  GetTemplateCommand,
  UpdateStackCommand,
} from "@aws-sdk/client-cloudformation";
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { InvokeCommand, LambdaClient, DeleteFunctionCommand, GetFunctionCommand } from "@aws-sdk/client-lambda";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
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

describe("CloudFormation contract (AWS SDK)", () => {
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

  it("create/describe/getTemplate/delete stack for lambda + logs resources", async () => {
    const templateBody = JSON.stringify({
      Resources: {
        Logs: {
          Type: "AWS::Logs::LogGroup",
          Properties: {
            LogGroupName: "/aws/lambda/contract-cfn-fn",
            RetentionInDays: 14,
          },
        },
        Fn: {
          Type: "AWS::Lambda::Function",
          DependsOn: "Logs",
          Properties: {
            FunctionName: "contract-cfn-fn",
            Runtime: "nodejs20.x",
            Role: "arn:aws:iam::000000000000:role/lambda-role",
            Handler: "index.handler",
            Timeout: 3,
            Code: {
              ZipFile: "export async function handler(){return {source:'contract-cfn'};}",
            },
          },
        },
      },
    });

    const created = await cfn.send(
      new CreateStackCommand({
        StackName: "contract-cfn-stack",
        TemplateBody: templateBody,
      }),
    );
    expect(created.StackId).toBeDefined();

    const stacks = await cfn.send(new DescribeStacksCommand({ StackName: "contract-cfn-stack" }));
    expect(stacks.Stacks?.[0]?.StackStatus).toBe("CREATE_COMPLETE");

    const resources = await cfn.send(
      new DescribeStackResourcesCommand({
        StackName: "contract-cfn-stack",
      }),
    );
    const resourceTypes = (resources.StackResources ?? []).map((resource) => resource.ResourceType);
    expect(resourceTypes).toEqual(expect.arrayContaining(["AWS::Lambda::Function", "AWS::Logs::LogGroup"]));

    const fn = await lambda.send(new GetFunctionCommand({ FunctionName: "contract-cfn-fn" }));
    expect(fn.Configuration?.FunctionName).toBe("contract-cfn-fn");

    const groups = await logs.send(
      new DescribeLogGroupsCommand({
        logGroupNamePrefix: "/aws/lambda/contract-cfn-fn",
      }),
    );
    expect((groups.logGroups ?? []).map((group) => group.logGroupName)).toContain("/aws/lambda/contract-cfn-fn");

    const template = await cfn.send(new GetTemplateCommand({ StackName: "contract-cfn-stack" }));
    expect(template.TemplateBody).toContain("\"AWS::Lambda::Function\"");

    const events = await cfn.send(new DescribeStackEventsCommand({ StackName: "contract-cfn-stack" }));
    expect((events.StackEvents ?? []).length).toBeGreaterThan(0);

    await cfn.send(new DeleteStackCommand({ StackName: "contract-cfn-stack" }));
    const deleted = await cfn.send(new DescribeStacksCommand({ StackName: "contract-cfn-stack" }));
    expect(deleted.Stacks?.[0]?.StackStatus).toBe("DELETE_COMPLETE");
  });

  it("creates and exposes cloudformation-managed s3 bucket", async () => {
    await cfn.send(
      new CreateStackCommand({
        StackName: "contract-cfn-s3-stack",
        TemplateBody: JSON.stringify({
          Resources: {
            Bucket: {
              Type: "AWS::S3::Bucket",
              Properties: {
                BucketName: "contract-cfn-s3-bucket",
              },
            },
          },
        }),
      }),
    );

    const resources = await cfn.send(new DescribeStackResourcesCommand({ StackName: "contract-cfn-s3-stack" }));
    expect((resources.StackResources ?? []).map((item) => item.ResourceType)).toContain("AWS::S3::Bucket");

    const headed = await s3.send(new HeadBucketCommand({ Bucket: "contract-cfn-s3-bucket" }));
    expect(headed.$metadata.httpStatusCode).toBe(200);

    await cfn.send(new DeleteStackCommand({ StackName: "contract-cfn-s3-stack" }));
  });

  it("fails stack creation for unsupported resource types", async () => {
    await cfn.send(
      new CreateStackCommand({
        StackName: "contract-cfn-fail-stack",
        TemplateBody: JSON.stringify({
          Resources: {
            Table: {
              Type: "AWS::DynamoDB::Table",
              Properties: {
                TableName: "contract-cfn-fail",
              },
            },
          },
        }),
      }),
    );

    const stacks = await cfn.send(new DescribeStacksCommand({ StackName: "contract-cfn-fail-stack" }));
    expect(stacks.Stacks?.[0]?.StackStatus).toBe("CREATE_FAILED");
    expect(stacks.Stacks?.[0]?.StackStatusReason).toContain("Unsupported resource type");
  });

  it("accepts yaml TemplateBody from CloudFormation client", async () => {
    await cfn.send(
      new CreateStackCommand({
        StackName: "contract-cfn-yaml-stack",
        TemplateBody: `
Resources:
  Fn:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: contract-cfn-yaml-fn
      Runtime: nodejs20.x
      Role: arn:aws:iam::000000000000:role/lambda-role
      Handler: index.handler
      Timeout: 3
      Code:
        ZipFile: "export async function handler(event){return {echo:event?.echo ?? null};}"
`,
      }),
    );

    const stacks = await cfn.send(new DescribeStacksCommand({ StackName: "contract-cfn-yaml-stack" }));
    expect(stacks.Stacks?.[0]?.StackStatus).toBe("CREATE_COMPLETE");
  });

  it("updates stack template and updates lambda behavior", async () => {
    await cfn.send(
      new CreateStackCommand({
        StackName: "contract-cfn-update-stack",
        TemplateBody: JSON.stringify({
          Resources: {
            Fn: {
              Type: "AWS::Lambda::Function",
              Properties: {
                FunctionName: "contract-cfn-update-fn",
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

    const firstInvoke = await lambda.send(new InvokeCommand({ FunctionName: "contract-cfn-update-fn" }));
    expect(decodePayload(firstInvoke.Payload)).toEqual({ version: 1 });

    await cfn.send(
      new UpdateStackCommand({
        StackName: "contract-cfn-update-stack",
        TemplateBody: JSON.stringify({
          Resources: {
            Fn: {
              Type: "AWS::Lambda::Function",
              Properties: {
                FunctionName: "contract-cfn-update-fn",
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

    const stacks = await cfn.send(new DescribeStacksCommand({ StackName: "contract-cfn-update-stack" }));
    expect(stacks.Stacks?.[0]?.StackStatus).toBe("UPDATE_COMPLETE");

    const secondInvoke = await lambda.send(new InvokeCommand({ FunctionName: "contract-cfn-update-fn" }));
    expect(decodePayload(secondInvoke.Payload)).toEqual({ version: 2 });
  });

  it("deletes stack successfully even when function was removed outside cloudformation", async () => {
    await cfn.send(
      new CreateStackCommand({
        StackName: "contract-cfn-delete-missing-fn-stack",
        TemplateBody: JSON.stringify({
          Resources: {
            Fn: {
              Type: "AWS::Lambda::Function",
              Properties: {
                FunctionName: "contract-delete-missing-fn",
                Runtime: "nodejs20.x",
                Role: "arn:aws:iam::000000000000:role/lambda-role",
                Handler: "index.handler",
                Code: {
                  ZipFile: "export async function handler(){return {ok:true};}",
                },
              },
            },
          },
        }),
      }),
    );

    await lambda.send(new DeleteFunctionCommand({ FunctionName: "contract-delete-missing-fn" }));
    await cfn.send(new DeleteStackCommand({ StackName: "contract-cfn-delete-missing-fn-stack" }));

    const stacks = await cfn.send(new DescribeStacksCommand({ StackName: "contract-cfn-delete-missing-fn-stack" }));
    expect(stacks.Stacks?.[0]?.StackStatus).toBe("DELETE_COMPLETE");
  });
});
