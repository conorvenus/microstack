import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { DashboardPage } from "@/features/dashboard/pages/DashboardPage";
import { LambdaFunctionsPage } from "@/features/lambda/pages/LambdaFunctionsPage";

function App(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/lambda" element={<LambdaFunctionsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
