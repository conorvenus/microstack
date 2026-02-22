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
});
