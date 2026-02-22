import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import { load as parseYaml } from "js-yaml";
import { HttpError } from "../../http-error.js";
import type { CloudWatchLogsBackend } from "../cloudwatch-logs/types.js";
import type { CreateFunctionInput, LambdaBackend } from "../lambda/types.js";
import type { S3Backend } from "../s3/types.js";
import type {
  CloudFormationBackend,
  CloudFormationBackendDependencies,
  CloudFormationResourceStatus,
  CloudFormationStackStatus,
  CreateStackInput,
  UpdateStackInput,
  StackEvent,
  StackResourceSummary,
  StackSummary,
} from "./types.js";

type JsonRecord = Record<string, unknown>;
type ResourceRecord = {
  stackName: string;
  stackId: string;
  logicalResourceId: string;
  physicalResourceId: string;
  resourceType: string;
  resourceStatus: CloudFormationResourceStatus;
  resourceStatusReason?: string;
  timestamp: string;
};

type StackRecord = {
  stackId: string;
  stackName: string;
  templateBody: string;
  creationTime: string;
  stackStatus: CloudFormationStackStatus;
  stackStatusReason?: string;
  resources: ResourceRecord[];
  events: StackEvent[];
  creationOrder: string[];
};

type TemplateResource = {
  Type: string;
  Properties?: JsonRecord;
  DependsOn?: string | string[];
};

type TemplateDocument = {
  Resources: Record<string, TemplateResource>;
};

class CloudFormationValidationError extends HttpError {
  public constructor(message: string) {
    super(400, "ValidationError", message);
  }
}

const LAMBDA_ALLOWED_PROPERTIES = new Set([
  "FunctionName",
  "Runtime",
  "Role",
  "Handler",
  "Code",
  "Timeout",
  "Environment",
]);
const LOG_GROUP_ALLOWED_PROPERTIES = new Set(["LogGroupName", "RetentionInDays"]);
const S3_BUCKET_ALLOWED_PROPERTIES = new Set(["BucketName"]);

class InMemoryCloudFormationBackend implements CloudFormationBackend {
  private readonly lambdaBackend: LambdaBackend;
  private readonly cloudWatchLogsBackend: CloudWatchLogsBackend;
  private readonly s3Backend: S3Backend;
  private readonly stacksByName = new Map<string, StackRecord>();

  public constructor(deps: CloudFormationBackendDependencies) {
    this.lambdaBackend = deps.lambdaBackend;
    this.cloudWatchLogsBackend = deps.cloudWatchLogsBackend;
    this.s3Backend = deps.s3Backend;
  }

  public async createStack(input: CreateStackInput): Promise<StackSummary> {
    const stackName = input.stackName;
    this.validateStackName(stackName);
    if (this.stacksByName.has(stackName)) {
      throw new CloudFormationValidationError(`Stack with id ${stackName} already exists`);
    }

    const template = this.parseTemplate(input.templateBody);
    this.validateTemplate(template);
    const order = this.computeCreationOrder(template.Resources);

    const createdAt = new Date().toISOString();
    const stackId = `arn:aws:cloudformation:us-east-1:000000000000:stack/${stackName}/${randomUUID()}`;
    const stack: StackRecord = {
      stackId,
      stackName,
      templateBody: input.templateBody,
      creationTime: createdAt,
      stackStatus: "CREATE_IN_PROGRESS",
      resources: [],
      events: [],
      creationOrder: [],
    };
    this.stacksByName.set(stackName, stack);
    this.addStackEvent(stack, "CREATE_IN_PROGRESS");

    for (const logicalResourceId of order) {
      const templateResource = template.Resources[logicalResourceId];
      if (!templateResource) {
        throw new CloudFormationValidationError(`Resource not found in template: ${logicalResourceId}`);
      }
      const timestamp = new Date().toISOString();
      const placeholder: ResourceRecord = {
        stackName: stack.stackName,
        stackId: stack.stackId,
        logicalResourceId,
        physicalResourceId: logicalResourceId,
        resourceType: templateResource.Type,
        resourceStatus: "CREATE_IN_PROGRESS",
        timestamp,
      };
      stack.resources.push(placeholder);
      this.addResourceEvent(stack, placeholder, "CREATE_IN_PROGRESS");

      try {
        const physicalResourceId = await this.createResource(stack, logicalResourceId, templateResource);
        const completeTime = new Date().toISOString();
        placeholder.physicalResourceId = physicalResourceId;
        placeholder.resourceStatus = "CREATE_COMPLETE";
        placeholder.timestamp = completeTime;
        this.addResourceEvent(stack, placeholder, "CREATE_COMPLETE");
        stack.creationOrder.push(logicalResourceId);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown resource provisioning failure";
        const failedTime = new Date().toISOString();
        placeholder.resourceStatus = "CREATE_FAILED";
        placeholder.resourceStatusReason = reason;
        placeholder.timestamp = failedTime;
        this.addResourceEvent(stack, placeholder, "CREATE_FAILED", reason);
        stack.stackStatus = "CREATE_FAILED";
        stack.stackStatusReason = reason;
        this.addStackEvent(stack, "CREATE_FAILED", reason);
        return this.toStackSummary(stack);
      }
    }

    stack.stackStatus = "CREATE_COMPLETE";
    this.addStackEvent(stack, "CREATE_COMPLETE");
    return this.toStackSummary(stack);
  }

  public describeStacks(stackName?: string): StackSummary[] {
    if (stackName) {
      const stack = this.requireStack(stackName);
      return [this.toStackSummary(stack)];
    }
    return [...this.stacksByName.values()].map((stack) => this.toStackSummary(stack));
  }

  public describeStackResources(stackName: string): StackResourceSummary[] {
    const stack = this.requireStack(stackName);
    return stack.resources.map((resource) => ({ ...resource }));
  }

  public describeStackEvents(stackName: string): StackEvent[] {
    const stack = this.requireStack(stackName);
    return [...stack.events];
  }

  public getTemplate(stackName: string): string {
    return this.requireStack(stackName).templateBody;
  }

  public async updateStack(input: UpdateStackInput): Promise<StackSummary> {
    const stack = this.requireStack(input.stackName);
    const currentTemplate = this.parseTemplate(stack.templateBody);
    const nextTemplate = this.parseTemplate(input.templateBody);
    this.validateTemplate(nextTemplate);
    const nextOrder = this.computeCreationOrder(nextTemplate.Resources);

    const previousTemplateBody = stack.templateBody;
    const previousCreationOrder = [...stack.creationOrder];
    const previousResources = stack.resources.map((resource) => ({ ...resource }));

    stack.stackStatus = "UPDATE_IN_PROGRESS";
    delete stack.stackStatusReason;
    this.addStackEvent(stack, "UPDATE_IN_PROGRESS");

    try {
      await this.deleteResourcesByOrder(stack, [...previousCreationOrder].reverse(), true);
      stack.resources = [];
      stack.creationOrder = [];
      stack.templateBody = input.templateBody;

      for (const logicalResourceId of nextOrder) {
        const templateResource = nextTemplate.Resources[logicalResourceId];
        if (!templateResource) {
          throw new CloudFormationValidationError(`Resource not found in template: ${logicalResourceId}`);
        }
        const timestamp = new Date().toISOString();
        const placeholder: ResourceRecord = {
          stackName: stack.stackName,
          stackId: stack.stackId,
          logicalResourceId,
          physicalResourceId: logicalResourceId,
          resourceType: templateResource.Type,
          resourceStatus: "UPDATE_IN_PROGRESS",
          timestamp,
        };
        stack.resources.push(placeholder);
        this.addResourceEvent(stack, placeholder, "UPDATE_IN_PROGRESS");

        try {
          const physicalResourceId = await this.createResource(stack, logicalResourceId, templateResource);
          const completeTime = new Date().toISOString();
          placeholder.physicalResourceId = physicalResourceId;
          placeholder.resourceStatus = "UPDATE_COMPLETE";
          placeholder.timestamp = completeTime;
          this.addResourceEvent(stack, placeholder, "UPDATE_COMPLETE");
          stack.creationOrder.push(logicalResourceId);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Unknown resource update failure";
          const failedTime = new Date().toISOString();
          placeholder.resourceStatus = "UPDATE_FAILED";
          placeholder.resourceStatusReason = reason;
          placeholder.timestamp = failedTime;
          this.addResourceEvent(stack, placeholder, "UPDATE_FAILED", reason);
          throw error;
        }
      }

      stack.stackStatus = "UPDATE_COMPLETE";
      delete stack.stackStatusReason;
      this.addStackEvent(stack, "UPDATE_COMPLETE");
      return this.toStackSummary(stack);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown stack update failure";
      stack.stackStatus = "UPDATE_FAILED";
      stack.stackStatusReason = reason;
      this.addStackEvent(stack, "UPDATE_FAILED", reason);

      stack.stackStatus = "UPDATE_ROLLBACK_IN_PROGRESS";
      this.addStackEvent(stack, "UPDATE_ROLLBACK_IN_PROGRESS", reason);

      try {
        await this.deleteResourcesByOrder(stack, [...stack.creationOrder].reverse(), true);
        stack.templateBody = previousTemplateBody;
        stack.resources = previousResources.map((resource) => ({ ...resource, resourceStatus: "CREATE_IN_PROGRESS" }));
        stack.creationOrder = [];
        const previousTemplate = currentTemplate;
        const previousOrder = this.computeCreationOrder(previousTemplate.Resources);
        stack.resources = [];

        for (const logicalResourceId of previousOrder) {
          const templateResource = previousTemplate.Resources[logicalResourceId];
          if (!templateResource) {
            throw new CloudFormationValidationError(`Resource not found in template: ${logicalResourceId}`);
          }
          const placeholder: ResourceRecord = {
            stackName: stack.stackName,
            stackId: stack.stackId,
            logicalResourceId,
            physicalResourceId: logicalResourceId,
            resourceType: templateResource.Type,
            resourceStatus: "CREATE_IN_PROGRESS",
            timestamp: new Date().toISOString(),
          };
          stack.resources.push(placeholder);
          this.addResourceEvent(stack, placeholder, "CREATE_IN_PROGRESS");

          const physicalResourceId = await this.createResource(stack, logicalResourceId, templateResource);
          placeholder.physicalResourceId = physicalResourceId;
          placeholder.resourceStatus = "CREATE_COMPLETE";
          placeholder.timestamp = new Date().toISOString();
          this.addResourceEvent(stack, placeholder, "CREATE_COMPLETE");
          stack.creationOrder.push(logicalResourceId);
        }

        stack.stackStatus = "UPDATE_ROLLBACK_COMPLETE";
        delete stack.stackStatusReason;
        this.addStackEvent(stack, "UPDATE_ROLLBACK_COMPLETE");
      } catch (rollbackError) {
        const rollbackReason = rollbackError instanceof Error ? rollbackError.message : "Unknown rollback failure";
        stack.stackStatus = "UPDATE_ROLLBACK_FAILED";
        stack.stackStatusReason = rollbackReason;
        this.addStackEvent(stack, "UPDATE_ROLLBACK_FAILED", rollbackReason);
      }

      return this.toStackSummary(stack);
    }
  }

  public async deleteStack(stackName: string): Promise<void> {
    const stack = this.requireStack(stackName);
    if (stack.stackStatus === "DELETE_COMPLETE") {
      return;
    }

    stack.stackStatus = "DELETE_IN_PROGRESS";
    this.addStackEvent(stack, "DELETE_IN_PROGRESS");

    const failedReason = await this.deleteResourcesByOrder(stack, [...stack.creationOrder].reverse(), false);
    if (failedReason) {
      stack.stackStatus = "DELETE_FAILED";
      stack.stackStatusReason = failedReason;
      this.addStackEvent(stack, "DELETE_FAILED", failedReason);
      return;
    }

    stack.stackStatus = "DELETE_COMPLETE";
    delete stack.stackStatusReason;
    this.addStackEvent(stack, "DELETE_COMPLETE");
  }

  private async deleteResourcesByOrder(
    stack: StackRecord,
    logicalIds: string[],
    suppressFailure: boolean,
  ): Promise<string | undefined> {
    for (const logicalResourceId of logicalIds) {
      const resource = stack.resources.find((item) => item.logicalResourceId === logicalResourceId);
      if (!resource) {
        continue;
      }
      const inProgressTime = new Date().toISOString();
      resource.resourceStatus = "DELETE_IN_PROGRESS";
      resource.timestamp = inProgressTime;
      this.addResourceEvent(stack, resource, "DELETE_IN_PROGRESS");

      try {
        await this.deleteResource(resource);
        const completeTime = new Date().toISOString();
        resource.resourceStatus = "DELETE_COMPLETE";
        delete resource.resourceStatusReason;
        resource.timestamp = completeTime;
        this.addResourceEvent(stack, resource, "DELETE_COMPLETE");
      } catch (error) {
        if (this.isIgnorableDeleteError(resource.resourceType, error)) {
          const completeTime = new Date().toISOString();
          resource.resourceStatus = "DELETE_COMPLETE";
          delete resource.resourceStatusReason;
          resource.timestamp = completeTime;
          this.addResourceEvent(stack, resource, "DELETE_COMPLETE");
          continue;
        }

        const reason = error instanceof Error ? error.message : "Unknown resource deletion failure";
        const failedTime = new Date().toISOString();
        resource.resourceStatus = "DELETE_FAILED";
        resource.resourceStatusReason = reason;
        resource.timestamp = failedTime;
        this.addResourceEvent(stack, resource, "DELETE_FAILED", reason);
        if (suppressFailure) {
          return reason;
        }
        return reason;
      }
    }
    return undefined;
  }

  private isIgnorableDeleteError(resourceType: string, error: unknown): boolean {
    const code =
      typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    if (!code) {
      return false;
    }
    if (resourceType === "AWS::Lambda::Function" && code === "ResourceNotFoundException") {
      return true;
    }
    if (resourceType === "AWS::Logs::LogGroup" && code === "ResourceNotFoundException") {
      return true;
    }
    if (resourceType === "AWS::S3::Bucket" && code === "NoSuchBucket") {
      return true;
    }
    return false;
  }

  private toStackSummary(stack: StackRecord): StackSummary {
    return {
      stackId: stack.stackId,
      stackName: stack.stackName,
      creationTime: stack.creationTime,
      stackStatus: stack.stackStatus,
      ...(stack.stackStatusReason ? { stackStatusReason: stack.stackStatusReason } : {}),
    };
  }

  private requireStack(stackName: string): StackRecord {
    const stack = this.stacksByName.get(stackName);
    if (!stack) {
      throw new CloudFormationValidationError(`Stack with id ${stackName} does not exist`);
    }
    return stack;
  }

  private parseTemplate(templateBody: string): TemplateDocument {
    let parsed: unknown;
    try {
      parsed = JSON.parse(templateBody);
    } catch {
      try {
        parsed = parseYaml(templateBody);
      } catch {
        throw new CloudFormationValidationError("TemplateBody must be valid JSON or YAML");
      }
    }

    if (!parsed || typeof parsed !== "object") {
      throw new CloudFormationValidationError("TemplateBody must be a JSON or YAML object");
    }

    const record = parsed as JsonRecord;
    if (!record.Resources || typeof record.Resources !== "object" || Array.isArray(record.Resources)) {
      throw new CloudFormationValidationError("Template format error: Resources is required");
    }

    return {
      Resources: record.Resources as Record<string, TemplateResource>,
    };
  }

  private validateTemplate(template: TemplateDocument): void {
    for (const [logicalId, resource] of Object.entries(template.Resources)) {
      if (!resource || typeof resource !== "object") {
        throw new CloudFormationValidationError(`Template format error: Resource ${logicalId} must be an object`);
      }
      if (typeof resource.Type !== "string" || resource.Type.length === 0) {
        throw new CloudFormationValidationError(`Template format error: Resource ${logicalId} is missing Type`);
      }
      this.validateDependsOn(logicalId, resource.DependsOn, template.Resources);
      this.validateProperties(logicalId, resource.Type, resource.Properties ?? {});
    }
  }

  private validateDependsOn(
    logicalId: string,
    dependsOn: string | string[] | undefined,
    resources: Record<string, TemplateResource>,
  ): void {
    if (dependsOn === undefined) {
      return;
    }
    const values = Array.isArray(dependsOn) ? dependsOn : [dependsOn];
    if (values.length === 0 || values.some((value) => typeof value !== "string" || value.length === 0)) {
      throw new CloudFormationValidationError(`Template format error: DependsOn on ${logicalId} must be string or string[]`);
    }
    for (const dep of values) {
      if (!resources[dep]) {
        throw new CloudFormationValidationError(`Template format error: DependsOn target ${dep} does not exist`);
      }
    }
  }

  private validateProperties(logicalId: string, resourceType: string, properties: JsonRecord): void {
    if (resourceType === "AWS::Lambda::Function") {
      this.validateAllowedProperties(logicalId, resourceType, properties, LAMBDA_ALLOWED_PROPERTIES);
      this.requireStringProperty(properties, "FunctionName", logicalId, resourceType);
      this.requireStringProperty(properties, "Runtime", logicalId, resourceType);
      this.requireStringProperty(properties, "Role", logicalId, resourceType);
      this.requireStringProperty(properties, "Handler", logicalId, resourceType);
      const code = this.requireRecordProperty(properties, "Code", logicalId, resourceType);
      const codeKeys = Object.keys(code);
      if (!codeKeys.includes("ZipFile")) {
        throw new CloudFormationValidationError(
          `Template format error: Unsupported or missing property on ${logicalId} (${resourceType}): Code.ZipFile`,
        );
      }
      if (codeKeys.some((key) => key !== "ZipFile")) {
        throw new CloudFormationValidationError(
          `Template format error: Unsupported property on ${logicalId} (${resourceType}): Code.${codeKeys.find((key) => key !== "ZipFile")}`,
        );
      }
      if (properties.Environment !== undefined) {
        const env = this.requireRecordProperty(properties, "Environment", logicalId, resourceType);
        const envKeys = Object.keys(env);
        if (envKeys.some((key) => key !== "Variables")) {
          throw new CloudFormationValidationError(
            `Template format error: Unsupported property on ${logicalId} (${resourceType}): Environment.${envKeys.find((key) => key !== "Variables")}`,
          );
        }
      }
      return;
    }

    if (resourceType === "AWS::Logs::LogGroup") {
      this.validateAllowedProperties(logicalId, resourceType, properties, LOG_GROUP_ALLOWED_PROPERTIES);
      this.requireStringProperty(properties, "LogGroupName", logicalId, resourceType);
      return;
    }

    if (resourceType === "AWS::S3::Bucket") {
      this.validateAllowedProperties(logicalId, resourceType, properties, S3_BUCKET_ALLOWED_PROPERTIES);
      this.requireStringProperty(properties, "BucketName", logicalId, resourceType);
      return;
    }

    // Unsupported types fail during create to reflect stack failure behavior.
  }

  private validateAllowedProperties(
    logicalId: string,
    resourceType: string,
    properties: JsonRecord,
    allowed: Set<string>,
  ): void {
    for (const key of Object.keys(properties)) {
      if (!allowed.has(key)) {
        throw new CloudFormationValidationError(
          `Template format error: Unsupported property on ${logicalId} (${resourceType}): ${key}`,
        );
      }
    }
  }

  private requireRecordProperty(
    properties: JsonRecord,
    key: string,
    logicalId: string,
    resourceType: string,
  ): JsonRecord {
    const value = properties[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new CloudFormationValidationError(
        `Template format error: Property ${key} on ${logicalId} (${resourceType}) must be an object`,
      );
    }
    return value as JsonRecord;
  }

  private requireStringProperty(properties: JsonRecord, key: string, logicalId: string, resourceType: string): string {
    const value = properties[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new CloudFormationValidationError(
        `Template format error: Property ${key} on ${logicalId} (${resourceType}) must be a non-empty string`,
      );
    }
    return value;
  }

  private computeCreationOrder(resources: Record<string, TemplateResource>): string[] {
    const order: string[] = [];
    const state = new Map<string, "visiting" | "visited">();

    const visit = (logicalId: string): void => {
      const current = state.get(logicalId);
      if (current === "visited") {
        return;
      }
      if (current === "visiting") {
        throw new CloudFormationValidationError("Template format error: circular DependsOn reference detected");
      }
      state.set(logicalId, "visiting");
      const resource = resources[logicalId];
      if (!resource) {
        throw new CloudFormationValidationError(`Template format error: missing resource ${logicalId}`);
      }
      const deps = resource.DependsOn === undefined ? [] : Array.isArray(resource.DependsOn) ? resource.DependsOn : [resource.DependsOn];
      for (const dep of deps) {
        visit(dep);
      }
      state.set(logicalId, "visited");
      order.push(logicalId);
    };

    for (const logicalId of Object.keys(resources)) {
      visit(logicalId);
    }
    return order;
  }

  private async createResource(stack: StackRecord, logicalId: string, resource: TemplateResource): Promise<string> {
    if (resource.Type === "AWS::Logs::LogGroup") {
      const resolvedProperties = this.resolveValue(resource.Properties ?? {}, stack) as JsonRecord;
      const logGroupName = this.requireStringValue(resolvedProperties.LogGroupName, "LogGroupName", logicalId);
      const retentionRaw = resolvedProperties.RetentionInDays;
      if (retentionRaw !== undefined && typeof retentionRaw !== "number") {
        throw new CloudFormationValidationError(`Template format error: RetentionInDays on ${logicalId} must be a number`);
      }
      this.cloudWatchLogsBackend.createLogGroup(logGroupName, typeof retentionRaw === "number" ? retentionRaw : undefined);
      return logGroupName;
    }

    if (resource.Type === "AWS::Lambda::Function") {
      const resolvedProperties = this.resolveValue(resource.Properties ?? {}, stack) as JsonRecord;
      const functionName = this.requireStringValue(resolvedProperties.FunctionName, "FunctionName", logicalId);
      const runtime = this.requireStringValue(resolvedProperties.Runtime, "Runtime", logicalId);
      const role = this.requireStringValue(resolvedProperties.Role, "Role", logicalId);
      const handler = this.requireStringValue(resolvedProperties.Handler, "Handler", logicalId);
      const timeoutRaw = resolvedProperties.Timeout;
      if (timeoutRaw !== undefined && typeof timeoutRaw !== "number") {
        throw new CloudFormationValidationError(`Template format error: Timeout on ${logicalId} must be a number`);
      }

      const code = this.requireRecordValue(resolvedProperties.Code, "Code", logicalId);
      const inlineSource = this.requireStringValue(code.ZipFile, "Code.ZipFile", logicalId);
      const environment = resolvedProperties.Environment === undefined ? undefined : this.requireRecordValue(resolvedProperties.Environment, "Environment", logicalId);
      const variables =
        environment && environment.Variables !== undefined
          ? this.requireStringMapValue(environment.Variables, "Environment.Variables", logicalId)
          : undefined;

      const zipBuffer = this.createLambdaZip(inlineSource);
      const input: CreateFunctionInput = {
        FunctionName: functionName,
        Runtime: runtime,
        Role: role,
        Handler: handler,
        Code: {
          ZipFile: zipBuffer.toString("base64"),
        },
        ...(typeof timeoutRaw === "number" ? { Timeout: timeoutRaw } : {}),
        ...(variables ? { Environment: { Variables: variables } } : {}),
      };
      this.lambdaBackend.createFunction(input);
      return functionName;
    }

    if (resource.Type === "AWS::S3::Bucket") {
      const resolvedProperties = this.resolveValue(resource.Properties ?? {}, stack) as JsonRecord;
      const bucketName = this.requireStringValue(resolvedProperties.BucketName, "BucketName", logicalId);
      this.s3Backend.createBucket(bucketName);
      return bucketName;
    }

    throw new Error(`Unsupported resource type: ${resource.Type}`);
  }

  private async deleteResource(resource: ResourceRecord): Promise<void> {
    if (resource.resourceType === "AWS::Lambda::Function") {
      this.lambdaBackend.deleteFunction(resource.physicalResourceId);
      return;
    }
    if (resource.resourceType === "AWS::Logs::LogGroup") {
      this.cloudWatchLogsBackend.deleteLogGroup(resource.physicalResourceId);
      return;
    }
    if (resource.resourceType === "AWS::S3::Bucket") {
      this.s3Backend.deleteBucket(resource.physicalResourceId);
      return;
    }
  }

  private resolveValue(value: unknown, stack: StackRecord): unknown {
    if (value === null || value === undefined) {
      return value;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.resolveValue(item, stack));
    }
    if (typeof value !== "object") {
      return value;
    }

    const record = value as JsonRecord;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === "Ref") {
      return this.resolveRef(record.Ref, stack);
    }
    if (keys.length === 1 && keys[0] === "Fn::GetAtt") {
      return this.resolveGetAtt(record["Fn::GetAtt"], stack);
    }
    if (keys.some((key) => key.startsWith("Fn::"))) {
      throw new CloudFormationValidationError(`Unsupported intrinsic function: ${keys.find((key) => key.startsWith("Fn::"))}`);
    }
    const out: JsonRecord = {};
    for (const [key, item] of Object.entries(record)) {
      out[key] = this.resolveValue(item, stack);
    }
    return out;
  }

  private resolveRef(value: unknown, stack: StackRecord): string {
    if (typeof value !== "string" || value.length === 0) {
      throw new CloudFormationValidationError("Ref must be a non-empty string");
    }
    const resource = stack.resources.find((item) => item.logicalResourceId === value && item.resourceStatus === "CREATE_COMPLETE");
    if (!resource) {
      throw new CloudFormationValidationError(`Ref target does not exist or is unresolved: ${value}`);
    }
    return resource.physicalResourceId;
  }

  private resolveGetAtt(value: unknown, stack: StackRecord): string {
    let logicalId: string | undefined;
    let attribute: string | undefined;
    if (typeof value === "string") {
      const parts = value.split(".");
      if (parts.length === 2) {
        logicalId = parts[0];
        attribute = parts[1];
      }
    }
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string") {
      logicalId = value[0];
      attribute = value[1];
    }
    if (!logicalId || !attribute) {
      throw new CloudFormationValidationError("Fn::GetAtt must be a two-part value");
    }
    const resource = stack.resources.find((item) => item.logicalResourceId === logicalId && item.resourceStatus === "CREATE_COMPLETE");
    if (!resource) {
      throw new CloudFormationValidationError(`Fn::GetAtt target does not exist or is unresolved: ${logicalId}`);
    }
    if (attribute !== "Arn") {
      throw new CloudFormationValidationError(`Unsupported attribute ${attribute} on ${logicalId}`);
    }
    if (resource.resourceType === "AWS::Lambda::Function") {
      return `arn:aws:lambda:us-east-1:000000000000:function:${resource.physicalResourceId}`;
    }
    if (resource.resourceType === "AWS::Logs::LogGroup") {
      return `arn:aws:logs:us-east-1:000000000000:log-group:${resource.physicalResourceId}`;
    }
    if (resource.resourceType === "AWS::S3::Bucket") {
      return `arn:aws:s3:::${resource.physicalResourceId}`;
    }
    throw new CloudFormationValidationError(`Unsupported Fn::GetAtt target type: ${resource.resourceType}`);
  }

  private addStackEvent(stack: StackRecord, status: CloudFormationResourceStatus, reason?: string): void {
    stack.events.unshift({
      eventId: randomUUID(),
      stackName: stack.stackName,
      stackId: stack.stackId,
      logicalResourceId: stack.stackName,
      physicalResourceId: stack.stackId,
      resourceType: "AWS::CloudFormation::Stack",
      resourceStatus: status,
      ...(reason ? { resourceStatusReason: reason } : {}),
      timestamp: new Date().toISOString(),
    });
  }

  private addResourceEvent(
    stack: StackRecord,
    resource: ResourceRecord,
    status: CloudFormationResourceStatus,
    reason?: string,
  ): void {
    stack.events.unshift({
      eventId: randomUUID(),
      stackName: stack.stackName,
      stackId: stack.stackId,
      logicalResourceId: resource.logicalResourceId,
      physicalResourceId: resource.physicalResourceId,
      resourceType: resource.resourceType,
      resourceStatus: status,
      ...(reason ? { resourceStatusReason: reason } : {}),
      timestamp: new Date().toISOString(),
    });
  }

  private validateStackName(stackName: string): void {
    if (!stackName || stackName.length > 128 || !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(stackName)) {
      throw new CloudFormationValidationError(`Invalid stack name: ${stackName}`);
    }
  }

  private createLambdaZip(source: string): Buffer {
    const zip = new AdmZip();
    zip.addFile("index.mjs", Buffer.from(source, "utf8"));
    return zip.toBuffer();
  }

  private requireRecordValue(value: unknown, fieldName: string, logicalId: string): JsonRecord {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new CloudFormationValidationError(`Template format error: ${fieldName} on ${logicalId} must be an object`);
    }
    return value as JsonRecord;
  }

  private requireStringValue(value: unknown, fieldName: string, logicalId: string): string {
    if (typeof value !== "string" || value.length === 0) {
      throw new CloudFormationValidationError(`Template format error: ${fieldName} on ${logicalId} must be a non-empty string`);
    }
    return value;
  }

  private requireStringMapValue(value: unknown, fieldName: string, logicalId: string): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new CloudFormationValidationError(`Template format error: ${fieldName} on ${logicalId} must be an object`);
    }
    const record = value as JsonRecord;
    const out: Record<string, string> = {};
    for (const [key, item] of Object.entries(record)) {
      if (typeof item !== "string") {
        throw new CloudFormationValidationError(`Template format error: ${fieldName}.${key} on ${logicalId} must be a string`);
      }
      out[key] = item;
    }
    return out;
  }
}

export function createCloudFormationBackend(deps: CloudFormationBackendDependencies): CloudFormationBackend {
  return new InMemoryCloudFormationBackend(deps);
}
