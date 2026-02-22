import { z } from "zod";

export const healthResponseSchema = z
  .object({
    status: z.string().optional(),
  })
  .passthrough();

export const lambdaFunctionSchema = z
  .object({
    FunctionName: z.string(),
    Runtime: z.string(),
    LastModified: z.string(),
  })
  .passthrough();

export const lambdaListResponseSchema = z.object({
  Functions: z.array(lambdaFunctionSchema),
});

export const lambdaFunctionConfigurationSchema = z
  .object({
    FunctionName: z.string(),
    Runtime: z.string(),
    Role: z.string(),
    Handler: z.string(),
    Timeout: z.number(),
    LastModified: z.string(),
    Environment: z
      .object({
        Variables: z.record(z.string()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const getLambdaFunctionResponseSchema = z.object({
  Configuration: lambdaFunctionConfigurationSchema,
});

export const cloudWatchLogGroupSchema = z
  .object({
    logGroupName: z.string(),
    creationTime: z.number(),
    arn: z.string(),
    storedBytes: z.number(),
  })
  .passthrough();

export const cloudWatchLogStreamSchema = z
  .object({
    logStreamName: z.string(),
    creationTime: z.number(),
    arn: z.string(),
    storedBytes: z.number(),
    lastIngestionTime: z.number().optional(),
  })
  .passthrough();

export const cloudWatchLogEventSchema = z
  .object({
    timestamp: z.number(),
    ingestionTime: z.number(),
    message: z.string(),
  })
  .passthrough();

export const describeLogGroupsResponseSchema = z.object({
  logGroups: z.array(cloudWatchLogGroupSchema),
});

export const describeLogStreamsResponseSchema = z.object({
  logStreams: z.array(cloudWatchLogStreamSchema),
});

export const getLogEventsResponseSchema = z.object({
  events: z.array(cloudWatchLogEventSchema),
  nextForwardToken: z.string().optional(),
  nextBackwardToken: z.string().optional(),
});

export const invokeLambdaResultSchema = z.object({
  statusCode: z.number(),
  executedVersion: z.string().optional(),
  functionError: z.string().optional(),
  payloadText: z.string(),
  payloadJson: z.unknown().optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type LambdaFunction = z.infer<typeof lambdaFunctionSchema>;
export type LambdaListResponse = z.infer<typeof lambdaListResponseSchema>;
export type LambdaFunctionConfiguration = z.infer<typeof lambdaFunctionConfigurationSchema>;
export type GetLambdaFunctionResponse = z.infer<typeof getLambdaFunctionResponseSchema>;
export type CloudWatchLogGroup = z.infer<typeof cloudWatchLogGroupSchema>;
export type CloudWatchLogStream = z.infer<typeof cloudWatchLogStreamSchema>;
export type CloudWatchLogEvent = z.infer<typeof cloudWatchLogEventSchema>;
export type DescribeLogGroupsResponse = z.infer<typeof describeLogGroupsResponseSchema>;
export type DescribeLogStreamsResponse = z.infer<typeof describeLogStreamsResponseSchema>;
export type GetLogEventsResponse = z.infer<typeof getLogEventsResponseSchema>;
export type InvokeLambdaResult = z.infer<typeof invokeLambdaResultSchema>;
