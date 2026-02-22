import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { CloudWatchLogGroupsPage } from "@/features/cloudwatch-logs/pages/CloudWatchLogGroupsPage";
import { CloudWatchLogStreamPage } from "@/features/cloudwatch-logs/pages/CloudWatchLogStreamPage";
import { DashboardPage } from "@/features/dashboard/pages/DashboardPage";
import { LambdaFunctionDetailPage } from "@/features/lambda/pages/LambdaFunctionDetailPage";
import { LambdaFunctionsPage } from "@/features/lambda/pages/LambdaFunctionsPage";

function App(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/lambda" element={<LambdaFunctionsPage />} />
      <Route path="/lambda/:functionName" element={<LambdaFunctionDetailPage />} />
      <Route path="/cloudwatch/logs" element={<CloudWatchLogGroupsPage />} />
      <Route path="/cloudwatch/logs/:logGroupName" element={<CloudWatchLogStreamPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
