import { describe, expect, it } from "vitest";
import { createCloudWatchLogsBackend } from "../../../src/services/cloudwatch-logs/index.js";

describe("cloudwatch logs backend", () => {
  it("stores and returns events in timestamp order", () => {
    const backend = createCloudWatchLogsBackend();
    const groupName = "/aws/lambda/unit-fn";
    const streamName = "2026/01/01/[$LATEST]abc123";

    backend.putLogEvent(groupName, streamName, "later", 20);
    backend.putLogEvent(groupName, streamName, "first", 10);

    const groups = backend.describeLogGroups();
    expect(groups.map((group) => group.logGroupName)).toContain(groupName);

    const streams = backend.describeLogStreams(groupName);
    expect(streams.map((stream) => stream.logStreamName)).toContain(streamName);

    const events = backend.getLogEvents(groupName, streamName);
    expect(events.map((event) => event.message)).toEqual(["first", "later"]);
  });
});
