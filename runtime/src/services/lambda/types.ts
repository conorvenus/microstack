export type FunctionConfig = {
  functionName: string;
  runtime: string;
  role: string;
  handler: string;
  timeout: number;
  environment: Record<string, string>;
  zipFile: Uint8Array;
  codeSha256: string;
  version: number;
  lastModified: string;
};

export type CreateFunctionInput = {
  FunctionName: string;
  Runtime: string;
  Role: string;
  Handler: string;
  Timeout?: number;
  Environment?: {
    Variables?: Record<string, string>;
  };
  Code?: {
    ZipFile?: string;
  };
};

export type UpdateFunctionConfigurationInput = {
  Runtime?: string;
  Role?: string;
  Handler?: string;
  Timeout?: number;
  Environment?: {
    Variables?: Record<string, string>;
  };
};

export type UpdateFunctionCodeInput = {
  ZipFile?: string;
};

export type InvokeResult = {
  payload: Uint8Array;
  functionError?: string;
};

export type InvocationLogRecord = {
  functionName: string;
  requestId: string;
  timestamp: number;
  payload: Uint8Array;
  functionError?: string;
};

export type InvocationLogger = (record: InvocationLogRecord) => void | Promise<void>;

export interface LambdaBackend {
  createFunction(input: CreateFunctionInput): FunctionConfig;
  getFunction(name: string): FunctionConfig;
  listFunctions(): FunctionConfig[];
  deleteFunction(name: string): void;
  updateFunctionConfiguration(name: string, input: UpdateFunctionConfigurationInput): FunctionConfig;
  updateFunctionCode(name: string, input: UpdateFunctionCodeInput): FunctionConfig;
  invokeFunction(name: string, payload: Buffer): Promise<InvokeResult>;
}
