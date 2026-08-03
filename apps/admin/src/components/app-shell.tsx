import { useQuery } from '@tanstack/react-query';
import {
  FileTextIcon,
  HardDriveIcon,
  LogOutIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SparklesIcon,
  UserRoundIcon,
} from 'lucide-react';
import { AnimatePresence, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  onDismiss?: () => void;
  onNavigate?: () => void;
  onToggleDesktop?: () => void;
  motionId: string;
};

function initials(value: string) {
  return value.trim().slice(0, 2).toLocaleUpperCase() || 'IZ';
}

function UserAvatar({
  avatar,
  displayName,
}: Pick<NavigationProps, 'avatar' | 'displayName'>) {
  return (
    <span aria-hidden="true" className="mx-user-avatar">
      <span className="mx-user-avatar-fallback">{initials(displayName)}</span>
      {avatar ? (
        <img
          alt=""
          src={avatar.url}
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      ) : null}
    </span>
  );
}

function Navigation({
  avatar,
  displayName,
  onLogout,
  onDismiss,
  onNavigate,
  onToggleDesktop,
  motionId,
}: NavigationProps) {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const onPosts = location.pathname.startsWith('/posts');
  const onProfile = location.pathname === '/profile';
  const onAiSettings = location.pathname === '/settings/ai';
  const onStorageSettings = location.pathname === '/settings/storage';

  function activeSurface(active: boolean) {
    if (!active) return null;

    if (reduceMotion)
      return <span aria-hidden="true" className="mx-navigation-active-surface" />;

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
            <button
              className="mx-user-popover-item mx-user-popover-logout"
              role="menuitem"
              type="button"
              onClick={onLogout}
            >
              <LogOutIcon />
              退出登录
            </button>
          </div>
        </details>
        {onToggleDesktop || onDismiss ? (
          <button
            aria-label={onDismiss ? '关闭导航' : '收起导航'}
            className="mx-sidebar-collapse"
            data-mobile-nav-close={onDismiss ? true : undefined}
            title={onDismiss ? '关闭导航' : '收起导航'}
            type="button"
            onClick={onDismiss ?? onToggleDesktop}
          >
            <PanelLeftCloseIcon />
          </button>
        ) : null}
      </header>

      <nav aria-label="主导航" className="mx-navigation">
        <div className="mx-navigation-group">
          <Link
            aria-current={onPosts ? 'page' : undefined}
            className={`mx-navigation-item${onPosts ? ' is-active' : ''}`}
            to="/posts"
            onClick={onNavigate}
          >
            {activeSurface(onPosts)}
            <FileTextIcon />
            <span className="mx-navigation-label">文章</span>
          </Link>
        </div>
        <div className="mx-navigation-group">
          <Link
            aria-current={onProfile ? 'page' : undefined}
            className={`mx-navigation-item${onProfile ? ' is-active' : ''}`}
            to="/profile"
            onClick={onNavigate}
          >
            {activeSurface(onProfile)}
            <UserRoundIcon />
            <span className="mx-navigation-label">个人资料</span>
          </Link>
          <Link
            aria-current={onAiSettings ? 'page' : undefined}
            className={`mx-navigation-item${onAiSettings ? ' is-active' : ''}`}
            to="/settings/ai"
            onClick={onNavigate}
          >
            {activeSurface(onAiSettings)}
            <SparklesIcon />
            <span className="mx-navigation-label">AI 模型</span>
          </Link>
          <Link
            aria-current={onStorageSettings ? 'page' : undefined}
            className={`mx-navigation-item${onStorageSettings ? ' is-active' : ''}`}
            to="/settings/storage"
            onClick={onNavigate}
          >
            {activeSurface(onStorageSettings)}
            <HardDriveIcon />
            <span className="mx-navigation-label">对象存储</span>
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
  const mobileDialogRef = useRef<HTMLDialogElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileCloseTimerRef = useRef<number>(undefined);
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

  function openMobileNavigation() {
    const dialog = mobileDialogRef.current;
    if (!dialog || dialog.open) return;
    window.clearTimeout(mobileCloseTimerRef.current);
    dialog.showModal();
    requestAnimationFrame(() => {
      setMobileOpen(true);
      requestAnimationFrame(() =>
        dialog
          .querySelector<HTMLElement>('[data-mobile-nav-close]')
          ?.focus({ preventScroll: true }),
      );
    });
  }

  function closeMobileNavigation() {
    const dialog = mobileDialogRef.current;
    if (!dialog?.open) return;
    setMobileOpen(false);
    window.clearTimeout(mobileCloseTimerRef.current);
    mobileCloseTimerRef.current = window.setTimeout(
      () => {
        dialog.close();
        mobileTriggerRef.current?.focus({ preventScroll: true });
      },
      reduceMotion ? 0 : 200,
    );
  }

  useEffect(() => () => window.clearTimeout(mobileCloseTimerRef.current), []);

  useEffect(() => {
    const mobileViewport = window.matchMedia('(max-width: 768px)');
    const closeAtDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) return;
      window.clearTimeout(mobileCloseTimerRef.current);
      mobileDialogRef.current?.close();
      setMobileOpen(false);
    };
    mobileViewport.addEventListener('change', closeAtDesktop);
    return () => mobileViewport.removeEventListener('change', closeAtDesktop);
  }, []);

  return (
    <div className="mx-app-shell">
      <aside
        className={`mx-sidebar${desktopCollapsed ? ' is-collapsed' : ''}`}
        inert={mobileOpen}
      >
        <Navigation
          avatar={avatar}
          displayName={displayName}
          motionId="desktop-navigation-active"
          onLogout={logout}
          onToggleDesktop={() => setDesktopCollapsed(true)}
        />
      </aside>

      <dialog
        ref={mobileDialogRef}
        aria-label="主导航"
        aria-modal="true"
        className={`mx-mobile-sheet${mobileOpen ? ' is-open' : ''}`}
        onCancel={(event) => {
          event.preventDefault();
          closeMobileNavigation();
        }}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientY < bounds.top) closeMobileNavigation();
        }}
      >
        <span aria-hidden="true" className="mx-mobile-sheet-handle" />
        <Navigation
          avatar={avatar}
          displayName={displayName}
          motionId="mobile-navigation-active"
          onDismiss={closeMobileNavigation}
          onLogout={logout}
          onNavigate={closeMobileNavigation}
        />
      </dialog>

      <section
        className={`mx-workspace${desktopCollapsed ? ' is-expanded' : ''}`}
        inert={mobileOpen}
      >
        <a className="mx-skip-link" href="#main-content">
          跳至主要内容
        </a>
        <header className="mx-workspace-header">
          <button
            ref={mobileTriggerRef}
            aria-label={desktopCollapsed ? '展开导航' : '打开导航'}
            className={`mx-workspace-toggle${desktopCollapsed ? ' is-desktop-visible' : ''}`}
            title={desktopCollapsed ? '展开导航' : '打开导航'}
            type="button"
            onClick={() => {
              if (desktopCollapsed) setDesktopCollapsed(false);
              else openMobileNavigation();
            }}
          >
            <PanelLeftOpenIcon />
          </button>
        </header>
        <main
          id="main-content"
          className={`mx-workspace-main${location.pathname === '/profile' || location.pathname.startsWith('/settings/') ? ' is-settings-view' : ' is-content-view'}`}
        >
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
