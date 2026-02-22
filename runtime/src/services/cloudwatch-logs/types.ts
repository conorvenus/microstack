export type CloudWatchLogGroup = {
  logGroupName: string;
  creationTime: number;
  arn: string;
  storedBytes: number;
  retentionInDays?: number;
};

export type CloudWatchLogStream = {
  logStreamName: string;
  creationTime: number;
  arn: string;
  storedBytes: number;
  lastIngestionTime?: number;
};

export type CloudWatchLogEvent = {
  timestamp: number;
  ingestionTime: number;
  message: string;
};

export interface CloudWatchLogsBackend {
  createLogGroup(logGroupName: string, retentionInDays?: number): void;
  deleteLogGroup(logGroupName: string): void;
  putLogEvent(logGroupName: string, logStreamName: string, message: string, timestamp?: number): void;
  describeLogGroups(logGroupNamePrefix?: string): CloudWatchLogGroup[];
  describeLogStreams(logGroupName: string, logStreamNamePrefix?: string): CloudWatchLogStream[];
  getLogEvents(logGroupName: string, logStreamName: string): CloudWatchLogEvent[];
}
