import type { ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";

export function AppBreadcrumbs(): ReactElement {
  const { pathname } = useLocation();
  const onLambdaRoot = pathname === "/lambda";
  const onLambdaDetailPage = pathname.startsWith("/lambda/");
  const lambdaPathSegment = onLambdaDetailPage ? pathname.split("/")[2] : undefined;
  const lambdaName = lambdaPathSegment ? decodeURIComponent(lambdaPathSegment) : null;
  const onCloudWatchLogsRoot = pathname === "/cloudwatch/logs";
  const onCloudWatchLogGroupPage = pathname.startsWith("/cloudwatch/logs/");
  const logGroupPathSegment = onCloudWatchLogGroupPage ? pathname.split("/")[3] : undefined;
  const logGroupName = logGroupPathSegment ? decodeURIComponent(logGroupPathSegment) : null;

  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-400">
      <ol className="flex items-center gap-2">
        {onLambdaRoot ? (
          <>
            <li>
              <Link to="/" className="rounded-sm text-slate-300 transition hover:text-slate-100 focus-visible:outline-none">
                Dashboard
              </Link>
            </li>
            <li aria-hidden="true" className="text-slate-600">
              /
            </li>
            <li aria-current="page" className="text-slate-100">
              Lambda
            </li>
          </>
        ) : onLambdaDetailPage ? (
          <>
            <li>
              <Link to="/" className="rounded-sm text-slate-300 transition hover:text-slate-100 focus-visible:outline-none">
                Dashboard
              </Link>
            </li>
            <li aria-hidden="true" className="text-slate-600">
              /
            </li>
            <li>
              <Link to="/lambda" className="rounded-sm text-slate-300 transition hover:text-slate-100 focus-visible:outline-none">
                Lambda
              </Link>
            </li>
            <li aria-hidden="true" className="text-slate-600">
              /
            </li>
            <li aria-current="page" className="text-slate-100">
              {lambdaName ?? "Function"}
            </li>
          </>
        ) : onCloudWatchLogsRoot ? (
          <>
            <li>
              <Link to="/" className="rounded-sm text-slate-300 transition hover:text-slate-100 focus-visible:outline-none">
                Dashboard
              </Link>
            </li>
            <li aria-hidden="true" className="text-slate-600">
              /
            </li>
            <li aria-current="page" className="text-slate-100">
              CloudWatch Logs
            </li>
          </>
        ) : onCloudWatchLogGroupPage ? (
          <>
            <li>
              <Link to="/" className="rounded-sm text-slate-300 transition hover:text-slate-100 focus-visible:outline-none">
                Dashboard
              </Link>
            </li>
            <li aria-hidden="true" className="text-slate-600">
              /
            </li>
            <li>
              <Link
                to="/cloudwatch/logs"
                className="rounded-sm text-slate-300 transition hover:text-slate-100 focus-visible:outline-none"
              >
                CloudWatch Logs
              </Link>
            </li>
            <li aria-hidden="true" className="text-slate-600">
              /
            </li>
            <li aria-current="page" className="text-slate-100">
              {logGroupName ?? "Log Group"}
            </li>
          </>
        ) : (
          <li aria-current="page" className="text-slate-100">
            Dashboard
          </li>
        )}
      </ol>
    </nav>
  );
}
