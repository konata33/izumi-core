import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation, useOutlet } from 'react-router-dom';

import { AppShell } from '@/components/app-shell';
import { getSession } from '@/lib/session';
import { AuthView } from '@/views/auth-view';
import { ProfileView } from '@/views/profile-view';
import { PostsView } from '@/views/posts-view';

const EditorView = lazy(() =>
  import('@/views/editor-view').then((module) => ({ default: module.EditorView })),
);
const AiSettingsView = lazy(() =>
  import('@/views/ai-settings-view').then((module) => ({
    default: module.AiSettingsView,
  })),
);

function RouteFallback() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-route-fallback">
      正在准备页面…
    </div>
  );
}

function AuthRoute() {
  return getSession() ? <Navigate to="/posts" replace /> : <AuthView />;
}

function ProtectedLayout() {
  const location = useLocation();
  const outlet = useOutlet();

  if (!getSession()) return <Navigate to="/auth" replace />;

  return <AppShell contentKey={location.pathname}>{outlet}</AppShell>;
}

export function App() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthRoute />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/posts" element={<PostsView />} />
        <Route
          path="/posts/new"
          element={
            <Suspense fallback={<RouteFallback />}>
              <EditorView />
            </Suspense>
          }
        />
        <Route
          path="/posts/:id"
          element={
            <Suspense fallback={<RouteFallback />}>
              <EditorView />
            </Suspense>
          }
        />
        <Route path="/profile" element={<ProfileView />} />
        <Route
          path="/settings/ai"
          element={
            <Suspense fallback={<RouteFallback />}>
              <AiSettingsView />
            </Suspense>
          }
        />
      </Route>
      <Route path="/" element={<Navigate to="/posts" replace />} />
      <Route path="*" element={<Navigate to="/posts" replace />} />
    </Routes>
  );
}
