import { useQuery } from '@tanstack/react-query';
import { PencilLineIcon, PlusIcon, RefreshCwIcon, SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { FeedbackAlert } from '@/components/feedback-alert';
import { HeaderAction } from '@/components/header-action';
import { PageFrame } from '@/components/page-frame';
import { StatusBadge } from '@/components/status-badge';
import { StatusFilter, type FilterStatus } from '@/components/status-filter';
import { core, CoreRequestError, type PostList } from '@/lib/core';
import { messageForError } from '@/lib/errors';
import { formatDate, formatShortDate } from '@/lib/format';
import { clearSession, getSession } from '@/lib/session';

const emptyPosts: PostList = { items: [], page: 1, size: 20, total: 0 };

export function PostsView() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = getSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [inputModality, setInputModality] = useState<'keyboard' | 'pointer'>(
    'keyboard',
  );
  const filterParam = searchParams.get('status');
  const filter: FilterStatus =
    filterParam === 'draft' || filterParam === 'published' ? filterParam : 'all';
  const query = searchParams.get('q') ?? '';
  const normalizedQuery = query.trim();
  const requestedPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const returnTo = `${location.pathname}${location.search}`;

  const postsQuery = useQuery({
    queryKey: ['posts', filter, page, normalizedQuery],
    queryFn: () =>
      core.listPosts(session!.accessToken, {
        page,
        size: 20,
        status: filter === 'all' ? undefined : filter,
        q: normalizedQuery || undefined,
      }),
  });

  useEffect(() => {
    if (
      postsQuery.error instanceof CoreRequestError &&
      postsQuery.error.status === 401
    ) {
      clearSession();
      navigate('/auth', { replace: true });
    }
  }, [navigate, postsQuery.error]);

  useEffect(() => {
    const usePointer = () => setInputModality('pointer');
    const useKeyboard = () => setInputModality('keyboard');
    window.addEventListener('pointerdown', usePointer, true);
    window.addEventListener('keydown', useKeyboard, true);
    return () => {
      window.removeEventListener('pointerdown', usePointer, true);
      window.removeEventListener('keydown', useKeyboard, true);
    };
  }, []);

  useEffect(() => {
    const serialized = sessionStorage.getItem('izumi:posts-scroll-position');
    if (!serialized) return;

    try {
      const saved = JSON.parse(serialized) as { path?: string; top?: number };
      if (saved.path !== returnTo || typeof saved.top !== 'number') return;
      requestAnimationFrame(() =>
        window.scrollTo({ top: saved.top, behavior: 'instant' }),
      );
      sessionStorage.removeItem('izumi:posts-scroll-position');
    } catch {
      sessionStorage.removeItem('izumi:posts-scroll-position');
    }
  }, [returnTo]);

  const posts = postsQuery.data ?? emptyPosts;
  const totalPages = Math.max(1, Math.ceil(posts.total / posts.size));
  const visiblePosts = posts.items;

  function rememberListPosition() {
    sessionStorage.setItem(
      'izumi:posts-scroll-position',
      JSON.stringify({ path: returnTo, top: window.scrollY }),
    );
  }

  function chooseFilter(next: FilterStatus) {
    if (next === filter) return;
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next === 'all') params.delete('status');
      else params.set('status', next);
      params.delete('page');
      return params;
    });
  }

  function choosePage(nextPage: number) {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (nextPage === 1) params.delete('page');
      else params.set('page', String(nextPage));
      return params;
    });
  }

  function changeSearch(value: string) {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      const next = value.trim();
      if (next) params.set('q', value);
      else params.delete('q');
      params.delete('page');
      return params;
    });
  }

  const error = postsQuery.error ? messageForError(postsQuery.error) : undefined;
  const noResults =
    !postsQuery.isPending && !postsQuery.error && visiblePosts.length === 0;
  const editorState = { returnTo };

  return (
    <PageFrame
      actions={
        <div className="mx-actions">
          <HeaderAction
            label="刷新文章列表"
            disabled={postsQuery.isFetching}
            onClick={() => void postsQuery.refetch()}
          >
            <RefreshCwIcon className={postsQuery.isFetching ? 'mx-spin' : undefined} />
          </HeaderAction>
          <Link
            aria-label="新建文章"
            className="mx-header-action is-primary is-label"
            state={editorState}
            title="新建文章"
            to="/posts/new"
            onClick={rememberListPosition}
          >
            <PlusIcon />
            <span className="mx-header-action-label">新建文章</span>
          </Link>
        </div>
      }
      subtitle={postsQuery.isPending ? '正在载入' : `${posts.total} 篇`}
      className="mx-list-page"
      title="文章"
    >
      <div className="mx-list-toolbar">
        <label className="mx-search" data-focus-modality={inputModality}>
          <SearchIcon aria-hidden="true" />
          <span className="sr-only">搜索全部文章</span>
          <input
            aria-label="搜索全部文章"
            autoComplete="off"
            className="mx-search-input"
            name="post-search"
            placeholder="搜索标题、摘要或标签…"
            value={query}
            onChange={(event) => changeSearch(event.target.value)}
          />
        </label>
        <StatusFilter
          disabled={postsQuery.isPending}
          value={filter}
          onValueChange={chooseFilter}
        />
      </div>

      {error ? (
        <div className="mx-post-error">
          <FeedbackAlert notice={{ kind: 'error', message: error }} />
          <button
            className="mx-button is-secondary"
            type="button"
            onClick={() => void postsQuery.refetch()}
          >
            <RefreshCwIcon />
            重新连接
          </button>
        </div>
      ) : null}

      {postsQuery.isPending ? <PostsSkeleton /> : null}

      {!postsQuery.isPending && !error && visiblePosts.length > 0 ? (
        <>
          <section className="mx-post-desktop-table" aria-label="文章列表">
            <table className="mx-table">
              <thead>
                <tr>
                  <th className="mx-table-title-cell">文章</th>
                  <th className="hide-tablet">归档</th>
                  <th className="hide-mobile">状态</th>
                  <th className="hide-tablet mx-table-right">最近编辑</th>
                  <th className="mx-table-actions hide-mobile">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visiblePosts.map((post) => (
                  <tr key={post.id}>
                    <td className="mx-table-title-cell">
                      <Link
                        className="mx-table-title"
                        state={editorState}
                        to={`/posts/${post.id}`}
                        onClick={rememberListPosition}
                      >
                        {post.title}
                      </Link>
                      {post.excerpt ? (
                        <p className="mx-table-excerpt">{post.excerpt}</p>
                      ) : null}
                      <p className="mx-table-slug">/{post.slug}</p>
                    </td>
                    <td className="hide-tablet">
                      <div className="mx-table-archive">
                        {post.section ? (
                          <span>{post.section}</span>
                        ) : (
                          <span className="mx-table-muted">未归档</span>
                        )}
                        {post.tags.length ? (
                          <span className="mx-table-tags">
                            {post.tags.slice(0, 2).join(' · ')}
                            {post.tags.length > 2 ? ` · +${post.tags.length - 2}` : ''}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="hide-mobile">
                      <StatusBadge status={post.status} />
                    </td>
                    <td className="hide-tablet mx-table-right">
                      <time
                        className="mx-table-date"
                        dateTime={post.updatedAt}
                        title={formatDate(post.updatedAt)}
                      >
                        {formatShortDate(post.updatedAt)}
                      </time>
                    </td>
                    <td className="mx-table-actions hide-mobile">
                      <Link
                        className="mx-row-edit"
                        state={editorState}
                        to={`/posts/${post.id}`}
                        onClick={rememberListPosition}
                      >
                        <PencilLineIcon />
                        编辑
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {posts.total > posts.size ? (
              <div className="mx-pagination">
                <button
                  className="mx-button is-secondary is-small"
                  disabled={page === 1}
                  type="button"
                  onClick={() => choosePage(page - 1)}
                >
                  上一页
                </button>
                <span className="mx-pagination-label">
                  第 {page} / {totalPages} 页
                </span>
                <button
                  className="mx-button is-secondary is-small"
                  disabled={page === totalPages}
                  type="button"
                  onClick={() => choosePage(page + 1)}
                >
                  下一页
                </button>
              </div>
            ) : null}
          </section>
          <MobilePostList
            items={visiblePosts}
            onOpen={rememberListPosition}
            state={editorState}
          />
        </>
      ) : null}

      {noResults ? (
        <section
          className={`mx-empty${query || filter !== 'all' ? ' is-filtered' : ''}`}
        >
          {query ? (
            <>
              <p className="mx-empty-kicker">没有匹配结果</p>
              <h2>换一个关键词试试</h2>
              <button
                className="mx-button is-secondary"
                type="button"
                onClick={() => changeSearch('')}
              >
                清除搜索
              </button>
            </>
          ) : filter !== 'all' ? (
            <>
              <p className="mx-empty-kicker">当前筛选为空</p>
              <h2>还没有{filter === 'draft' ? '草稿' : '已发布文章'}</h2>
              <button
                className="mx-button is-secondary"
                type="button"
                onClick={() => chooseFilter('all')}
              >
                查看全部文章
              </button>
            </>
          ) : (
            <>
              <p className="mx-empty-kicker">0 篇文章</p>
              <h2>从第一篇文章开始</h2>
              <p>标题、正文与发布信息都会在独立写作页中完成。</p>
              <Link
                className="mx-button"
                state={editorState}
                to="/posts/new"
                onClick={rememberListPosition}
              >
                <PlusIcon />
                开始第一篇文章
              </Link>
            </>
          )}
        </section>
      ) : null}
    </PageFrame>
  );
}

function MobilePostList({
  items,
  onOpen,
  state,
}: {
  items: PostList['items'];
  onOpen: () => void;
  state: { returnTo: string };
}) {
  return (
    <section aria-label="文章列表" className="mx-post-mobile-list">
      {items.map((post) => (
        <article key={post.id} className="mx-post-mobile-item">
          <div className="mx-post-mobile-copy">
            <Link
              className="mx-post-mobile-title"
              state={state}
              to={`/posts/${post.id}`}
              onClick={onOpen}
            >
              {post.title}
            </Link>
            {post.excerpt ? (
              <p className="mx-post-mobile-excerpt">{post.excerpt}</p>
            ) : null}
            <div className="mx-post-mobile-meta">
              {post.section ? <span>{post.section}</span> : null}
              <time dateTime={post.updatedAt} title={formatDate(post.updatedAt)}>
                {formatShortDate(post.updatedAt)}
              </time>
              <StatusBadge status={post.status} />
            </div>
          </div>
          <Link
            aria-label={`编辑 ${post.title}`}
            className="mx-post-mobile-edit"
            state={state}
            title="编辑文章"
            to={`/posts/${post.id}`}
            onClick={onOpen}
          >
            <PencilLineIcon />
          </Link>
        </article>
      ))}
    </section>
  );
}

function PostsSkeleton() {
  return (
    <div className="mx-list-skeleton" aria-label="正在加载文章列表" aria-busy="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="mx-list-skeleton-row">
          <div className="mx-list-skeleton-copy">
            <span className="mx-skeleton mx-list-skeleton-title" />
            <span className="mx-skeleton mx-list-skeleton-slug" />
          </div>
          <span className="mx-skeleton mx-list-skeleton-badge" />
        </div>
      ))}
    </div>
  );
}
