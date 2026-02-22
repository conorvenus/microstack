import { describe, expect, it } from "vitest";
import { createCloudWatchLogsBackend } from "../../../src/services/cloudwatch-logs/index.js";
import { createCloudFormationBackend } from "../../../src/services/cloudformation/index.js";
import { createLambdaBackend } from "../../../src/services/lambda/index.js";
import { createS3Backend } from "../../../src/services/s3/index.js";

const INLINE_HANDLER = "export async function handler(event){return {ok:true,event};}";

function createBackend() {
  const logs = createCloudWatchLogsBackend();
  const lambda = createLambdaBackend();
  const s3 = createS3Backend();
  return {
    backend: createCloudFormationBackend({ lambdaBackend: lambda, cloudWatchLogsBackend: logs, s3Backend: s3 }),
    s3,
  };
}

describe("cloudformation backend", () => {
  it("creates stack resources for lambda and logs, then describes stack state", async () => {
    const { backend } = createBackend();
    const stack = await backend.createStack({
      stackName: "unit-stack",
      templateBody: JSON.stringify({
        Resources: {
          FnLogs: {
            Type: "AWS::Logs::LogGroup",
            Properties: {
              LogGroupName: "/aws/lambda/unit-stack-fn",
              RetentionInDays: 7,
            },
          },
          Fn: {
            Type: "AWS::Lambda::Function",
            DependsOn: "FnLogs",
            Properties: {
              FunctionName: "unit-stack-fn",
              Runtime: "nodejs20.x",
              Role: "arn:aws:iam::000000000000:role/lambda-role",
              Handler: "index.handler",
              Timeout: 3,
              Code: {
                ZipFile: INLINE_HANDLER,
              },
            },
          },
        },
      }),
    });

    expect(stack.stackStatus).toBe("CREATE_COMPLETE");
    const described = backend.describeStacks("unit-stack");
    expect(described).toHaveLength(1);
    expect(described[0]?.stackStatus).toBe("CREATE_COMPLETE");

    const resources = backend.describeStackResources("unit-stack");
    expect(resources.map((resource) => resource.logicalResourceId).sort()).toEqual(["Fn", "FnLogs"]);
    expect(resources.map((resource) => resource.resourceStatus)).toEqual(
      expect.arrayContaining(["CREATE_COMPLETE"]),
    );
  });

  it("creates S3 bucket resources", async () => {
    const { backend } = createBackend();

    const created = await backend.createStack({
      stackName: "s3-stack",
      templateBody: JSON.stringify({
        Resources: {
          Bucket: {
            Type: "AWS::S3::Bucket",
            Properties: {
              BucketName: "unit-cfn-s3-bucket",
            },
          },
        },
      }),
    });

    expect(created.stackStatus).toBe("CREATE_COMPLETE");
    const resources = backend.describeStackResources("s3-stack");
    expect(resources.map((resource) => resource.resourceType)).toContain("AWS::S3::Bucket");
    expect(resources[0]?.physicalResourceId).toBe("unit-cfn-s3-bucket");
  });

  it("fails stack creation for unsupported resource types", async () => {
    const { backend } = createBackend();

    await backend.createStack({
      stackName: "unsupported-stack",
      templateBody: JSON.stringify({
        Resources: {
          Table: {
            Type: "AWS::DynamoDB::Table",
            Properties: {
              TableName: "x",
            },
          },
        },
      }),
    });

    const described = backend.describeStacks("unsupported-stack");
    expect(described[0]?.stackStatus).toBe("CREATE_FAILED");
    expect(described[0]?.stackStatusReason).toContain("Unsupported resource type");
  });

  it("rejects unsupported properties for supported resource types", async () => {
    const { backend } = createBackend();
    await expect(
      backend.createStack({
        stackName: "invalid-props-stack",
        templateBody: JSON.stringify({
          Resources: {
            Fn: {
              Type: "AWS::Lambda::Function",
              Properties: {
                FunctionName: "invalid-props-fn",
                Runtime: "nodejs20.x",
                Role: "arn:aws:iam::000000000000:role/lambda-role",
                Handler: "index.handler",
                Code: { ZipFile: INLINE_HANDLER },
                MemorySize: 128,
              },
            },
          },
        }),
      }),
    ).rejects.toMatchObject({
      code: "ValidationError",
    });
  });

  it("rejects unsupported properties for s3 bucket", async () => {
    const { backend } = createBackend();

    await expect(
      backend.createStack({
        stackName: "invalid-s3-props-stack",
        templateBody: JSON.stringify({
          Resources: {
            Bucket: {
              Type: "AWS::S3::Bucket",
              Properties: {
                BucketName: "invalid-s3-props",
                AccessControl: "Private",
              },
            },
          },
        }),
      }),
    ).rejects.toMatchObject({
      code: "ValidationError",
    });
  });

  it("rejects circular dependencies", async () => {
    const { backend } = createBackend();
    await expect(
      backend.createStack({
        stackName: "cycle-stack",
        templateBody: JSON.stringify({
          Resources: {
            A: {
              Type: "AWS::Logs::LogGroup",
              DependsOn: "B",
              Properties: { LogGroupName: "/aws/lambda/a" },
            },
            B: {
              Type: "AWS::Logs::LogGroup",
              DependsOn: "A",
              Properties: { LogGroupName: "/aws/lambda/b" },
            },
          },
        }),
      }),
    ).rejects.toMatchObject({
      code: "ValidationError",
    });
  });

  it("records stack and resource events", async () => {
    const { backend } = createBackend();
    await backend.createStack({
      stackName: "events-stack",
      templateBody: JSON.stringify({
        Resources: {
          Logs: {
            Type: "AWS::Logs::LogGroup",
            Properties: { LogGroupName: "/aws/lambda/events-stack-fn" },
          },
        },
      }),
    });

    const events = backend.describeStackEvents("events-stack");
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((event) => event.resourceType === "AWS::CloudFormation::Stack")).toBe(true);
    expect(events.some((event) => event.resourceType === "AWS::Logs::LogGroup")).toBe(true);
  });

  it("fails delete stack for non-empty s3 bucket", async () => {
    const { backend, s3 } = createBackend();

    await backend.createStack({
      stackName: "non-empty-delete-stack",
      templateBody: JSON.stringify({
        Resources: {
          Bucket: {
            Type: "AWS::S3::Bucket",
            Properties: {
              BucketName: "non-empty-delete-bucket",
            },
          },
        },
      }),
    });

    const bucketResource = backend.describeStackResources("non-empty-delete-stack")[0];
    expect(bucketResource?.physicalResourceId).toBe("non-empty-delete-bucket");

    s3.putObject("non-empty-delete-bucket", "x.txt", Buffer.from("x"));
    await expect(backend.deleteStack("non-empty-delete-stack")).resolves.toBeUndefined();

    const stack = backend.describeStacks("non-empty-delete-stack")[0];
    expect(stack?.stackStatus).toBe("DELETE_FAILED");
    expect(stack?.stackStatusReason).toContain("not empty");
  });

  it("accepts yaml TemplateBody for supported resources", async () => {
    const { backend } = createBackend();
    const yamlTemplate = `
Resources:
  Fn:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: yaml-unit-fn
      Runtime: nodejs20.x
      Role: arn:aws:iam::000000000000:role/lambda-role
      Handler: index.handler
      Timeout: 3
      Code:
        ZipFile: "export async function handler(event){return {echo:event?.echo ?? null};}"
`;

    const stack = await backend.createStack({
      stackName: "yaml-unit-stack",
      templateBody: yamlTemplate,
    });

    expect(stack.stackStatus).toBe("CREATE_COMPLETE");
    const resources = backend.describeStackResources("yaml-unit-stack");
    expect(resources.map((resource) => resource.resourceType)).toContain("AWS::Lambda::Function");
  });
});
