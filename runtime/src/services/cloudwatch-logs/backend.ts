import { HttpError } from "../../http-error.js";
import type {
  CloudWatchLogEvent,
  CloudWatchLogGroup,
  CloudWatchLogStream,
  CloudWatchLogsBackend,
} from "./types.js";

type LogStreamState = {
  details: CloudWatchLogStream;
  events: CloudWatchLogEvent[];
};

type LogGroupState = {
  details: CloudWatchLogGroup;
  streams: Map<string, LogStreamState>;
};

class InMemoryCloudWatchLogsBackend implements CloudWatchLogsBackend {
  private readonly groups = new Map<string, LogGroupState>();

  public createLogGroup(logGroupName: string, retentionInDays?: number): void {
    if (this.groups.has(logGroupName)) {
      throw new HttpError(400, "ResourceAlreadyExistsException", `The specified log group already exists: ${logGroupName}`);
    }
    this.getOrCreateGroup(logGroupName, Date.now(), retentionInDays);
  }

  public deleteLogGroup(logGroupName: string): void {
    if (!this.groups.has(logGroupName)) {
      throw new HttpError(400, "ResourceNotFoundException", `The specified log group does not exist: ${logGroupName}`);
    }
    this.groups.delete(logGroupName);
  }

  public putLogEvent(logGroupName: string, logStreamName: string, message: string, timestamp?: number): void {
    const eventTime = timestamp ?? Date.now();
    const group = this.getOrCreateGroup(logGroupName, eventTime);
    const stream = this.getOrCreateStream(group, logGroupName, logStreamName, eventTime);

    const event: CloudWatchLogEvent = {
      timestamp: eventTime,
      ingestionTime: Date.now(),
      message,
    };
    stream.events.push(event);
    stream.events.sort((left, right) => left.timestamp - right.timestamp);
    stream.details.lastIngestionTime = event.ingestionTime;
    stream.details.storedBytes = stream.events.reduce((sum, current) => sum + Buffer.byteLength(current.message, "utf8"), 0);
    group.details.storedBytes = [...group.streams.values()].reduce((sum, current) => sum + current.details.storedBytes, 0);
  }

  public describeLogGroups(logGroupNamePrefix?: string): CloudWatchLogGroup[] {
    const groups = [...this.groups.values()].map((group) => group.details);
    return groups
      .filter((group) => !logGroupNamePrefix || group.logGroupName.startsWith(logGroupNamePrefix))
      .sort((left, right) => left.logGroupName.localeCompare(right.logGroupName));
  }

  public describeLogStreams(logGroupName: string, logStreamNamePrefix?: string): CloudWatchLogStream[] {
    const group = this.groups.get(logGroupName);
    if (!group) {
      throw new HttpError(400, "ResourceNotFoundException", `The specified log group does not exist: ${logGroupName}`);
    }

    return [...group.streams.values()]
      .map((stream) => stream.details)
      .filter((stream) => !logStreamNamePrefix || stream.logStreamName.startsWith(logStreamNamePrefix))
      .sort((left, right) => left.logStreamName.localeCompare(right.logStreamName));
  }

  public getLogEvents(logGroupName: string, logStreamName: string): CloudWatchLogEvent[] {
    const group = this.groups.get(logGroupName);
    if (!group) {
      throw new HttpError(400, "ResourceNotFoundException", `The specified log group does not exist: ${logGroupName}`);
    }

    const stream = group.streams.get(logStreamName);
    if (!stream) {
      throw new HttpError(400, "ResourceNotFoundException", `The specified log stream does not exist: ${logStreamName}`);
    }

    return [...stream.events].sort((left, right) => left.timestamp - right.timestamp);
  }

  private getOrCreateGroup(logGroupName: string, creationTime: number, retentionInDays?: number): LogGroupState {
    const existing = this.groups.get(logGroupName);
    if (existing) {
      return existing;
    }

    const group: LogGroupState = {
      details: {
        logGroupName,
        creationTime,
        arn: `arn:aws:logs:us-east-1:000000000000:log-group:${logGroupName}`,
        storedBytes: 0,
        ...(retentionInDays ? { retentionInDays } : {}),
      },
      streams: new Map<string, LogStreamState>(),
    };
    this.groups.set(logGroupName, group);
    return group;
  }

  private getOrCreateStream(
    group: LogGroupState,
    logGroupName: string,
    logStreamName: string,
    creationTime: number,
  ): LogStreamState {
    const existing = group.streams.get(logStreamName);
    if (existing) {
      return existing;
    }

    const stream: LogStreamState = {
      details: {
        logStreamName,
        creationTime,
        arn: `arn:aws:logs:us-east-1:000000000000:log-group:${logGroupName}:log-stream:${logStreamName}`,
        storedBytes: 0,
      },
      events: [],
    };
    group.streams.set(logStreamName, stream);
    return stream;
  }
}

export function createCloudWatchLogsBackend(): CloudWatchLogsBackend {
  return new InMemoryCloudWatchLogsBackend();
}
