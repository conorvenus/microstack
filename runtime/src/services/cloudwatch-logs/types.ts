export type CloudWatchLogGroup = {
  logGroupName: string;
  creationTime: number;
  arn: string;
  storedBytes: number;
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
  putLogEvent(logGroupName: string, logStreamName: string, message: string, timestamp?: number): void;
  describeLogGroups(logGroupNamePrefix?: string): CloudWatchLogGroup[];
  describeLogStreams(logGroupName: string, logStreamNamePrefix?: string): CloudWatchLogStream[];
  getLogEvents(logGroupName: string, logStreamName: string): CloudWatchLogEvent[];
}
