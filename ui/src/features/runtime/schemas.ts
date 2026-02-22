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

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type LambdaFunction = z.infer<typeof lambdaFunctionSchema>;
export type LambdaListResponse = z.infer<typeof lambdaListResponseSchema>;
