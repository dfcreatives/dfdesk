import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { sectionFromSlug, workspaceSections } from "@/shared/navigation";

const WorkspaceApp = lazy(() => import("@/features/workspace/WorkspaceApp"));
const ApiDocsPage = lazy(() => import("@/features/api-docs/ApiDocsPage"));

function RouteFallback({ label }: { label: string }) {
  return (
    <main className="login-page login-loading">
      <section className="login-card loading-card">{label}</section>
    </main>
  );
}

function WorkspaceRoute() {
  const { pathname } = useLocation();
  const slug = pathname.split("/").filter(Boolean)[0] ?? "overview";
  return (
    <Suspense fallback={<RouteFallback label="Loading Desk…" />}>
      <WorkspaceApp initialSection={sectionFromSlug(slug) ?? "Overview"} />
    </Suspense>
  );
}

export function AppRouter() {
  return (
    <Routes>
      <Route
        path="/api-docs"
        element={
          <Suspense fallback={<RouteFallback label="Loading API docs…" />}>
            <ApiDocsPage />
          </Suspense>
        }
      />
      <Route path="/" element={<WorkspaceRoute />} />
      {workspaceSections.map(({ slug }) => (
        <Route key={slug} path={`/${slug}`} element={<WorkspaceRoute />} />
      ))}
      <Route path="*" element={<Navigate replace to="/overview" />} />
    </Routes>
  );
}
