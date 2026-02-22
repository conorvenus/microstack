import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readBody } from "../../server.js";
import type { CloudFormationBackend } from "./types.js";

class CloudFormationRouteError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  public constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type CloudFormationRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
) => Promise<boolean>;

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function responseMetadataXml(): string {
  return `<ResponseMetadata><RequestId>${randomUUID()}</RequestId></ResponseMetadata>`;
}

function sendXml(res: ServerResponse, statusCode: number, xmlBody: string): void {
  const payload = Buffer.from(xmlBody, "utf8");
  res.writeHead(statusCode, {
    "content-type": "text/xml; charset=utf-8",
    "content-length": String(payload.byteLength),
  });
  res.end(payload);
}

function sendErrorXml(res: ServerResponse, error: CloudFormationRouteError): void {
  sendXml(
    res,
    error.statusCode,
    `<?xml version="1.0" encoding="UTF-8"?>
<ErrorResponse>
  <Error>
    <Type>Sender</Type>
    <Code>${xmlEscape(error.code)}</Code>
    <Message>${xmlEscape(error.message)}</Message>
  </Error>
  <RequestId>${randomUUID()}</RequestId>
</ErrorResponse>`,
  );
}

function requireString(value: string | null, fieldName: string): string {
  if (!value || value.length === 0) {
    throw new CloudFormationRouteError("ValidationError", `${fieldName} is required`);
  }
  return value;
}

function toAwsTimestamp(value: string): string {
  return value;
}

export function createCloudFormationRouteHandler(backend: CloudFormationBackend): CloudFormationRouteHandler {
  return async (req, res, pathname, method) => {
    if (method !== "POST" || pathname !== "/") {
      return false;
    }

    const contentType = req.headers["content-type"];
    if (typeof contentType !== "string" || !contentType.includes("application/x-www-form-urlencoded")) {
      return false;
    }

    try {
      const raw = (await readBody(req)).toString("utf8");
      const params = new URLSearchParams(raw);
      const action = requireString(params.get("Action"), "Action");
      const version = requireString(params.get("Version"), "Version");

      if (version !== "2010-05-15") {
        throw new CloudFormationRouteError("ValidationError", `Unsupported CloudFormation version: ${version}`);
      }

      if (action === "CreateStack") {
        const stackName = requireString(params.get("StackName"), "StackName");
        const templateBody = requireString(params.get("TemplateBody"), "TemplateBody");
        const stack = await backend.createStack({ stackName, templateBody });
        sendXml(
          res,
          200,
          `<?xml version="1.0" encoding="UTF-8"?>
<CreateStackResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">
  <CreateStackResult>
    <StackId>${xmlEscape(stack.stackId)}</StackId>
  </CreateStackResult>
  ${responseMetadataXml()}
</CreateStackResponse>`,
        );
        return true;
      }

      if (action === "DescribeStacks") {
        const stackName = params.get("StackName") ?? undefined;
        const stacks = backend.describeStacks(stackName ?? undefined);
        const members = stacks
          .map(
            (stack) => `<member>
  <StackId>${xmlEscape(stack.stackId)}</StackId>
  <StackName>${xmlEscape(stack.stackName)}</StackName>
  <CreationTime>${xmlEscape(toAwsTimestamp(stack.creationTime))}</CreationTime>
  <StackStatus>${xmlEscape(stack.stackStatus)}</StackStatus>
  ${
    stack.stackStatusReason
      ? `<StackStatusReason>${xmlEscape(stack.stackStatusReason)}</StackStatusReason>`
      : ""
  }
</member>`,
          )
          .join("");
        sendXml(
          res,
          200,
          `<?xml version="1.0" encoding="UTF-8"?>
<DescribeStacksResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">
  <DescribeStacksResult>
    <Stacks>${members}</Stacks>
  </DescribeStacksResult>
  ${responseMetadataXml()}
</DescribeStacksResponse>`,
        );
        return true;
      }

      if (action === "DescribeStackResources") {
        const stackName = requireString(params.get("StackName"), "StackName");
        const resources = backend.describeStackResources(stackName);
        const members = resources
          .map(
            (resource) => `<member>
  <StackName>${xmlEscape(resource.stackName)}</StackName>
  <StackId>${xmlEscape(resource.stackId)}</StackId>
  <LogicalResourceId>${xmlEscape(resource.logicalResourceId)}</LogicalResourceId>
  <PhysicalResourceId>${xmlEscape(resource.physicalResourceId)}</PhysicalResourceId>
  <ResourceType>${xmlEscape(resource.resourceType)}</ResourceType>
  <ResourceStatus>${xmlEscape(resource.resourceStatus)}</ResourceStatus>
  ${
    resource.resourceStatusReason
      ? `<ResourceStatusReason>${xmlEscape(resource.resourceStatusReason)}</ResourceStatusReason>`
      : ""
  }
  <Timestamp>${xmlEscape(resource.timestamp)}</Timestamp>
</member>`,
          )
          .join("");
        sendXml(
          res,
          200,
          `<?xml version="1.0" encoding="UTF-8"?>
<DescribeStackResourcesResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">
  <DescribeStackResourcesResult>
    <StackResources>${members}</StackResources>
  </DescribeStackResourcesResult>
  ${responseMetadataXml()}
</DescribeStackResourcesResponse>`,
        );
        return true;
      }

      if (action === "DescribeStackEvents") {
        const stackName = requireString(params.get("StackName"), "StackName");
        const events = backend.describeStackEvents(stackName);
        const members = events
          .map(
            (event) => `<member>
  <EventId>${xmlEscape(event.eventId)}</EventId>
  <StackName>${xmlEscape(event.stackName)}</StackName>
  <StackId>${xmlEscape(event.stackId)}</StackId>
  <LogicalResourceId>${xmlEscape(event.logicalResourceId)}</LogicalResourceId>
  <PhysicalResourceId>${xmlEscape(event.physicalResourceId)}</PhysicalResourceId>
  <ResourceType>${xmlEscape(event.resourceType)}</ResourceType>
  <Timestamp>${xmlEscape(event.timestamp)}</Timestamp>
  <ResourceStatus>${xmlEscape(event.resourceStatus)}</ResourceStatus>
  ${event.resourceStatusReason ? `<ResourceStatusReason>${xmlEscape(event.resourceStatusReason)}</ResourceStatusReason>` : ""}
</member>`,
          )
          .join("");
        sendXml(
          res,
          200,
          `<?xml version="1.0" encoding="UTF-8"?>
<DescribeStackEventsResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">
  <DescribeStackEventsResult>
    <StackEvents>${members}</StackEvents>
  </DescribeStackEventsResult>
  ${responseMetadataXml()}
</DescribeStackEventsResponse>`,
        );
        return true;
      }

      if (action === "GetTemplate") {
        const stackName = requireString(params.get("StackName"), "StackName");
        const templateBody = backend.getTemplate(stackName);
        sendXml(
          res,
          200,
          `<?xml version="1.0" encoding="UTF-8"?>
<GetTemplateResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">
  <GetTemplateResult>
    <TemplateBody>${xmlEscape(templateBody)}</TemplateBody>
  </GetTemplateResult>
  ${responseMetadataXml()}
</GetTemplateResponse>`,
        );
        return true;
      }

      if (action === "DeleteStack") {
        const stackName = requireString(params.get("StackName"), "StackName");
        await backend.deleteStack(stackName);
        sendXml(
          res,
          200,
          `<?xml version="1.0" encoding="UTF-8"?>
<DeleteStackResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">
  <DeleteStackResult />
  ${responseMetadataXml()}
</DeleteStackResponse>`,
        );
        return true;
      }

      if (action === "UpdateStack") {
        const stackName = requireString(params.get("StackName"), "StackName");
        const templateBody = requireString(params.get("TemplateBody"), "TemplateBody");
        const stack = await backend.updateStack({ stackName, templateBody });
        sendXml(
          res,
          200,
          `<?xml version="1.0" encoding="UTF-8"?>
<UpdateStackResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">
  <UpdateStackResult>
    <StackId>${xmlEscape(stack.stackId)}</StackId>
  </UpdateStackResult>
  ${responseMetadataXml()}
</UpdateStackResponse>`,
        );
        return true;
      }

      throw new CloudFormationRouteError("InvalidAction", `Unknown action ${action}`);
    } catch (error) {
      if (error instanceof CloudFormationRouteError) {
        sendErrorXml(res, error);
        return true;
      }
      if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
        const err = error as { code?: unknown; message?: unknown };
        const code = typeof err.code === "string" ? err.code : "ValidationError";
        const message = typeof err.message === "string" ? err.message : "CloudFormation request failed";
        sendErrorXml(res, new CloudFormationRouteError(code, message));
        return true;
      }
      sendErrorXml(res, new CloudFormationRouteError("InternalFailure", "CloudFormation request failed", 500));
      return true;
    }
  };
}
