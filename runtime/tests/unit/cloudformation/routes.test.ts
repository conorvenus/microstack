import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMicrostackServer, type MicrostackServer } from "../../../src/index.js";

const FORM_HEADERS = {
  "content-type": "application/x-www-form-urlencoded; charset=utf-8",
};

describe("cloudformation route mounting", () => {
  let server: MicrostackServer;

  beforeAll(async () => {
    server = await createMicrostackServer({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it("responds to query protocol create stack calls with xml", async () => {
    const templateBody = JSON.stringify({
      Resources: {
        Logs: {
          Type: "AWS::Logs::LogGroup",
          Properties: {
            LogGroupName: "/aws/lambda/routes-stack-fn",
          },
        },
      },
    });
    const body = new URLSearchParams({
      Action: "CreateStack",
      Version: "2010-05-15",
      StackName: "routes-stack",
      TemplateBody: templateBody,
    });
    const response = await fetch(`${server.endpoint}/`, {
      method: "POST",
      headers: FORM_HEADERS,
      body,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("xml");
    const text = await response.text();
    expect(text).toContain("<CreateStackResponse");
    expect(text).toContain("<StackId>");
  });

  it("returns cloudformation style errors for unknown actions", async () => {
    const body = new URLSearchParams({
      Action: "TotallyUnknownAction",
      Version: "2010-05-15",
    });
    const response = await fetch(`${server.endpoint}/`, {
      method: "POST",
      headers: FORM_HEADERS,
      body,
    });

    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain("<ErrorResponse");
    expect(text).toContain("<Code>InvalidAction</Code>");
  });

  it("responds to query protocol update stack calls with xml", async () => {
    const stackName = "routes-update-stack";
    const createTemplateBody = JSON.stringify({
      Resources: {
        Bucket: {
          Type: "AWS::S3::Bucket",
          Properties: {
            BucketName: "routes-update-bucket-v1",
          },
        },
      },
    });
    const createBody = new URLSearchParams({
      Action: "CreateStack",
      Version: "2010-05-15",
      StackName: stackName,
      TemplateBody: createTemplateBody,
    });
    const created = await fetch(`${server.endpoint}/`, {
      method: "POST",
      headers: FORM_HEADERS,
      body: createBody,
    });
    expect(created.status).toBe(200);

    const updateTemplateBody = JSON.stringify({
      Resources: {
        Bucket: {
          Type: "AWS::S3::Bucket",
          Properties: {
            BucketName: "routes-update-bucket-v2",
          },
        },
      },
    });
    const updateBody = new URLSearchParams({
      Action: "UpdateStack",
      Version: "2010-05-15",
      StackName: stackName,
      TemplateBody: updateTemplateBody,
    });
    const updated = await fetch(`${server.endpoint}/`, {
      method: "POST",
      headers: FORM_HEADERS,
      body: updateBody,
    });

    expect(updated.status).toBe(200);
    expect(updated.headers.get("content-type")).toContain("xml");
    const text = await updated.text();
    expect(text).toContain("<UpdateStackResponse");
    expect(text).toContain("<StackId>");
  });
});
