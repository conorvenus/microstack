import type { ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";

export function AppBreadcrumbs(): ReactElement {
  const { pathname } = useLocation();
  const onLambdaPage = pathname.startsWith("/lambda");

  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-400">
      <ol className="flex items-center gap-2">
        {onLambdaPage ? (
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
        ) : (
          <li aria-current="page" className="text-slate-100">
            Dashboard
          </li>
        )}
      </ol>
    </nav>
  );
}
