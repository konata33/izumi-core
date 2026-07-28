import { useQuery } from '@tanstack/react-query';
import { FileTextIcon, LogOutIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, UserRoundIcon } from 'lucide-react';
import { AnimatePresence, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { core } from '@/lib/core';
import { clearSession, getSession } from '@/lib/session';

type AppShellProps = {
  children: ReactNode;
  contentKey: string;
};

type NavigationProps = {
  avatar?: { alt: string; url: string };
  displayName: string;
  onLogout: () => void;
  onNavigate?: () => void;
  onToggleDesktop?: () => void;
  motionId: string;
};

function initials(value: string) {
  return value.trim().slice(0, 2).toLocaleUpperCase() || 'IZ';
}

function UserAvatar({ avatar, displayName }: Pick<NavigationProps, 'avatar' | 'displayName'>) {
  return (
    <span aria-hidden="true" className="mx-user-avatar">
      <span className="mx-user-avatar-fallback">{initials(displayName)}</span>
      {avatar ? <img alt="" src={avatar.url} onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : null}
    </span>
  );
}

function Navigation({ avatar, displayName, onLogout, onNavigate, onToggleDesktop, motionId }: NavigationProps) {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const onPosts = location.pathname.startsWith('/posts');
  const onProfile = location.pathname === '/profile';

  function activeSurface(active: boolean) {
    if (!active) return null;

    if (reduceMotion) return <span aria-hidden="true" className="mx-navigation-active-surface" />;

    return (
      <m.span
        aria-hidden="true"
        className="mx-navigation-active-surface"
        layoutId={motionId}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      />
    );
  }

  return (
    <>
      <header className="mx-sidebar-header">
        <details className="mx-user-menu">
          <summary aria-label="打开账户菜单" className="mx-user-trigger">
            <UserAvatar avatar={avatar} displayName={displayName} />
            <span className="mx-user-name">{displayName}</span>
          </summary>
          <div className="mx-user-popover" role="menu">
            <p className="mx-user-popover-name">{displayName}</p>
            <div className="mx-user-popover-divider" />
            <button className="mx-user-popover-item mx-user-popover-logout" role="menuitem" type="button" onClick={onLogout}>
              <LogOutIcon />
              退出登录
            </button>
          </div>
        </details>
        {onToggleDesktop ? (
          <button aria-label="收起导航" className="mx-sidebar-collapse" title="收起导航" type="button" onClick={onToggleDesktop}>
            <PanelLeftCloseIcon />
          </button>
        ) : null}
      </header>

      <nav aria-label="主导航" className="mx-navigation">
        <div className="mx-navigation-group">
          <Link className={`mx-navigation-item${onPosts ? ' is-active' : ''}`} to="/posts" onClick={onNavigate}>
            {activeSurface(onPosts)}
            <FileTextIcon />
            <span className="mx-navigation-label">文章</span>
          </Link>
        </div>
        <div className="mx-navigation-group">
          <Link className={`mx-navigation-item${onProfile ? ' is-active' : ''}`} to="/profile" onClick={onNavigate}>
            {activeSurface(onProfile)}
            <UserRoundIcon />
            <span className="mx-navigation-label">个人资料</span>
          </Link>
        </div>
      </nav>
    </>
  );
}

export function AppShell({ children, contentKey }: AppShellProps) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const profileQuery = useQuery({
    queryKey: ['owner-profile'],
    queryFn: () => core.getOwnerProfile(session!.accessToken),
    enabled: Boolean(session),
    retry: false,
  });
  const displayName = profileQuery.data?.displayName ?? 'Izumi';
  const avatar = profileQuery.data?.avatar;

  function logout() {
    clearSession();
    navigate('/auth', { replace: true });
  }

  return (
    <div className="mx-app-shell">
      <aside className={`mx-sidebar${desktopCollapsed ? ' is-collapsed' : ''}`}>
        <Navigation avatar={avatar} displayName={displayName} motionId="desktop-navigation-active" onLogout={logout} onToggleDesktop={() => setDesktopCollapsed(true)} />
      </aside>

      <button aria-label="关闭导航" className={`mx-mobile-backdrop${mobileOpen ? ' is-open' : ''}`} type="button" onClick={() => setMobileOpen(false)} />
      <aside className={`mx-mobile-sheet${mobileOpen ? ' is-open' : ''}`}>
        <span aria-hidden="true" className="mx-mobile-sheet-handle" />
        <Navigation avatar={avatar} displayName={displayName} motionId="mobile-navigation-active" onLogout={logout} onNavigate={() => setMobileOpen(false)} />
      </aside>

      <section className={`mx-workspace${desktopCollapsed ? ' is-expanded' : ''}`}>
        <a className="mx-skip-link" href="#main-content">跳至主要内容</a>
        <header className="mx-workspace-header">
          <button
            aria-label={desktopCollapsed ? '展开导航' : '打开导航'}
            className={`mx-workspace-toggle${desktopCollapsed ? ' is-desktop-visible' : ''}`}
            title={desktopCollapsed ? '展开导航' : '打开导航'}
            type="button"
            onClick={() => {
              if (desktopCollapsed) setDesktopCollapsed(false);
              else setMobileOpen(true);
            }}
          >
            <PanelLeftOpenIcon />
          </button>
        </header>
        <main id="main-content" className={`mx-workspace-main${location.pathname === '/profile' ? ' is-settings-view' : ' is-content-view'}`}>
          <AnimatePresence initial={false} mode="wait">
            <m.div
              key={contentKey}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              className="mx-content-transition"
              exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -3 }}
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 4 }}
              transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
            >
              {children}
            </m.div>
          </AnimatePresence>
        </main>
      </section>
    </div>
  );
}
