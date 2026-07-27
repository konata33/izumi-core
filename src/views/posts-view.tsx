import { useQuery } from '@tanstack/react-query';
import { FilePenLineIcon, PencilLineIcon, PlusIcon, RefreshCwIcon, SearchIcon } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { FeedbackAlert } from '@/components/feedback-alert';
import { HeaderAction } from '@/components/header-action';
import { PageFrame } from '@/components/page-frame';
import { StatusBadge } from '@/components/status-badge';
import { core, CoreRequestError, type PostList, type PostStatus } from '@/lib/core';
import { messageForError } from '@/lib/errors';
import { formatDate, formatShortDate } from '@/lib/format';
import { clearSession, getSession } from '@/lib/session';

type FilterStatus = 'all' | PostStatus;

const filters: ReadonlyArray<{ value: FilterStatus; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
];

const emptyPosts: PostList = { items: [], page: 1, size: 20, total: 0 };

export function PostsView() {
  const navigate = useNavigate();
  const session = getSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const filterParam = searchParams.get('status');
  const filter = filters.some(({ value }) => value === filterParam) ? (filterParam as FilterStatus) : 'all';
  const query = searchParams.get('q') ?? '';
  const requestedPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const postsQuery = useQuery({
    queryKey: ['posts', filter, page],
    queryFn: () => core.listPosts(session!.accessToken, { page, size: 20, status: filter === 'all' ? undefined : filter }),
  });

  useEffect(() => {
    if (postsQuery.error instanceof CoreRequestError && postsQuery.error.status === 401) {
      clearSession();
      navigate('/auth', { replace: true });
    }
  }, [navigate, postsQuery.error]);

  const posts = postsQuery.data ?? emptyPosts;
  const totalPages = Math.max(1, Math.ceil(posts.total / posts.size));
  const visiblePosts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return posts.items;

    return posts.items.filter((post) => [post.title, post.slug, post.section, ...post.tags]
      .filter(Boolean)
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)));
  }, [posts.items, query]);
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
      return params;
    });
  }

  const error = postsQuery.error ? messageForError(postsQuery.error) : undefined;
  const noResults = !postsQuery.isPending && !postsQuery.error && visiblePosts.length === 0;

  return (
    <PageFrame
      actions={(
        <div className="mx-actions">
            <HeaderAction label="刷新文章列表" disabled={postsQuery.isFetching} onClick={() => void postsQuery.refetch()}>
              <RefreshCwIcon className={postsQuery.isFetching ? 'mx-spin' : undefined} />
            </HeaderAction>
            <Link aria-label="新建文章" className="mx-header-action is-primary" title="新建文章" to="/posts/new"><PlusIcon /></Link>
        </div>
      )}
      className="mx-list-page"
      title="文章"
    >

        <div className="mx-filterbar mx-list-filterbar">
          <label className="mx-search">
            <SearchIcon />
            <input aria-label="搜索当前页文章" className="mx-control" placeholder="搜索当前页文章" value={query} onChange={(event) => changeSearch(event.target.value)} />
          </label>
          <label className="mx-list-status">
            <span className="sr-only">文章状态筛选</span>
            <select aria-label="文章状态筛选" className="mx-control" value={filter} onChange={(event) => chooseFilter(event.target.value as FilterStatus)}>
              {filters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>

        {error ? (
          <div className="mx-post-error">
            <FeedbackAlert notice={{ kind: 'error', message: error }} />
            <button className="mx-button is-secondary" type="button" onClick={() => void postsQuery.refetch()}><RefreshCwIcon />重新连接</button>
          </div>
        ) : null}

        {postsQuery.isPending ? <PostsSkeleton /> : null}

        {!postsQuery.isPending && !error && visiblePosts.length > 0 ? (
          <>
            <section className="mx-table-wrap mx-post-desktop-table" aria-label="文章列表">
              <table className="mx-table">
              <thead>
                <tr>
                  <th className="mx-table-title-cell">标题</th>
                  <th className="hide-mobile">栏目</th>
                  <th className="hide-tablet">标签</th>
                  <th className="hide-mobile">状态</th>
                  <th className="hide-tablet">创建于</th>
                  <th className="hide-tablet mx-table-right">修改于</th>
                  <th className="mx-table-actions hide-mobile"><span className="sr-only">操作</span></th>
                </tr>
              </thead>
              <tbody>
                {visiblePosts.map((post) => (
                  <tr key={post.id}>
                    <td className="mx-table-title-cell">
                      <Link className="mx-table-title" to={`/posts/${post.id}`}>{post.title}</Link>
                      <p className="mx-table-slug">/{post.slug}</p>
                    </td>
                    <td className="hide-mobile"><span className="mx-table-muted">{post.section || '—'}</span></td>
                    <td className="hide-tablet"><span className="mx-table-muted">{post.tags.length ? post.tags.join(' · ') : '—'}</span></td>
                    <td className="hide-mobile"><StatusBadge status={post.status} /></td>
                    <td className="hide-tablet"><time className="mx-table-date" dateTime={post.createdAt} title={formatDate(post.createdAt)}>{formatShortDate(post.createdAt)}</time></td>
                    <td className="hide-tablet mx-table-right"><time className="mx-table-date" dateTime={post.updatedAt} title={formatDate(post.updatedAt)}>{formatShortDate(post.updatedAt)}</time></td>
                    <td className="mx-table-actions hide-mobile"><Link className="mx-button is-quiet is-small" to={`/posts/${post.id}`}><PencilLineIcon />编辑</Link></td>
                  </tr>
                ))}
              </tbody>
              </table>
              {posts.total > posts.size ? (
                <div className="mx-pagination">
                  <button className="mx-button is-secondary is-small" disabled={page === 1} type="button" onClick={() => choosePage(page - 1)}>上一页</button>
                  <span className="mx-pagination-label">{page} / {totalPages}</span>
                  <button className="mx-button is-secondary is-small" disabled={page === totalPages} type="button" onClick={() => choosePage(page + 1)}>下一页</button>
                </div>
              ) : null}
            </section>
            <MobilePostList items={visiblePosts} />
          </>
        ) : null}

        {noResults ? (
          <section className="mx-empty">
            <div className="mx-empty-inner">
              <span className="mx-empty-icon"><FilePenLineIcon /></span>
              <h2>{query ? '没有匹配的文章' : filter === 'all' ? '还没有文章' : `还没有${filter === 'draft' ? '草稿' : '已发布文章'}`}</h2>
              <p>{query ? '尝试其他关键词。' : filter === 'all' ? '开始写第一篇文章。' : '切换筛选，或新建文章。'}</p>
              {filter === 'all' ? <Link className="mx-button" to="/posts/new"><PlusIcon />新建文章</Link> : null}
            </div>
          </section>
        ) : null}
    </PageFrame>
  );
}

function MobilePostList({ items }: { items: PostList['items'] }) {
  return (
    <section aria-label="文章列表" className="mx-post-mobile-list">
      {items.map((post) => (
        <article key={post.id} className="mx-post-mobile-item">
          <div className="mx-post-mobile-copy">
            <Link className="mx-post-mobile-title" to={`/posts/${post.id}`}>{post.title}</Link>
            <div className="mx-post-mobile-meta">
              {post.section ? <span className="mx-post-mobile-section">{post.section}</span> : null}
              <time dateTime={post.updatedAt} title={formatDate(post.updatedAt)}>{formatShortDate(post.updatedAt)}</time>
              <StatusBadge status={post.status} />
            </div>
          </div>
          <Link aria-label={`编辑 ${post.title}`} className="mx-post-mobile-edit" title="编辑文章" to={`/posts/${post.id}`}><PencilLineIcon /></Link>
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
          <div className="mx-list-skeleton-copy"><span className="mx-skeleton mx-list-skeleton-title" /><span className="mx-skeleton mx-list-skeleton-slug" /></div>
          <span className="mx-skeleton mx-list-skeleton-badge" />
        </div>
      ))}
    </div>
  );
}
