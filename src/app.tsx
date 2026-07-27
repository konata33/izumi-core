import { Navigate, Route, Routes, useLocation, useOutlet } from 'react-router-dom';

import { AppShell } from '@/components/app-shell';
import { getSession } from '@/lib/session';
import { AuthView } from '@/views/auth-view';
import { EditorView } from '@/views/editor-view';
import { ProfileView } from '@/views/profile-view';
import { PostsView } from '@/views/posts-view';

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
        <Route path="/posts/new" element={<EditorView />} />
        <Route path="/posts/:id" element={<EditorView />} />
        <Route path="/profile" element={<ProfileView />} />
      </Route>
      <Route path="/" element={<Navigate to="/posts" replace />} />
      <Route path="*" element={<Navigate to="/posts" replace />} />
    </Routes>
  );
}
