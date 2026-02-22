import type { CloudWatchLogsBackend } from "../cloudwatch-logs/types.js";
import type { LambdaBackend } from "../lambda/types.js";

export type CloudFormationStackStatus =
  | "CREATE_IN_PROGRESS"
  | "CREATE_COMPLETE"
  | "CREATE_FAILED"
  | "DELETE_IN_PROGRESS"
  | "DELETE_COMPLETE"
  | "DELETE_FAILED";

export type CloudFormationResourceStatus =
  | "CREATE_IN_PROGRESS"
  | "CREATE_COMPLETE"
  | "CREATE_FAILED"
  | "DELETE_IN_PROGRESS"
  | "DELETE_COMPLETE"
  | "DELETE_FAILED";

export type CreateStackInput = {
  stackName: string;
  templateBody: string;
};

export type StackSummary = {
  stackId: string;
  stackName: string;
  creationTime: string;
  stackStatus: CloudFormationStackStatus;
  stackStatusReason?: string;
};

export type StackResourceSummary = {
  stackName: string;
  stackId: string;
  logicalResourceId: string;
  physicalResourceId: string;
  resourceType: string;
  resourceStatus: CloudFormationResourceStatus;
  resourceStatusReason?: string;
  timestamp: string;
};

export type StackEvent = {
  eventId: string;
  stackName: string;
  stackId: string;
  logicalResourceId: string;
  physicalResourceId: string;
  resourceType: string;
  resourceStatus: CloudFormationResourceStatus;
  resourceStatusReason?: string;
  timestamp: string;
};

export type CreateStackOutput = StackSummary;

export type CloudFormationBackendDependencies = {
  lambdaBackend: LambdaBackend;
  cloudWatchLogsBackend: CloudWatchLogsBackend;
};

export interface CloudFormationBackend {
  createStack(input: CreateStackInput): Promise<CreateStackOutput>;
  describeStacks(stackName?: string): StackSummary[];
  describeStackResources(stackName: string): StackResourceSummary[];
  describeStackEvents(stackName: string): StackEvent[];
  getTemplate(stackName: string): string;
  deleteStack(stackName: string): Promise<void>;
}
