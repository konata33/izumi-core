import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftIcon, CheckIcon, Clock3Icon, FileTextIcon, LoaderCircleIcon, SaveIcon, SendIcon, SlidersHorizontalIcon, SparklesIcon, Undo2Icon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { FeedbackAlert, type Notice } from '@/components/feedback-alert';
import { HeaderAction } from '@/components/header-action';
import { PageFrame } from '@/components/page-frame';
import { StatusBadge } from '@/components/status-badge';
import { core, CoreRequestError, type Post, type PostStatus } from '@/lib/core';
import { fieldName, messageForError } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { clearSession, getSession } from '@/lib/session';

type SaveIntent = 'draft' | 'published' | 'unpublish';
type FormField = 'title' | 'slug' | 'content' | 'excerpt' | 'section' | 'tagsText';

type PostForm = {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  section: string;
  tagsText: string;
  status: PostStatus;
};

type Metadata = {
  createdAt?: string;
  updatedAt?: string;
  publishedAt: string | null;
  readingMinutes: number;
};

function blankForm(): PostForm {
  return { title: '', slug: '', content: '', excerpt: '', section: '', tagsText: '', status: 'draft' };
}

function blankMetadata(): Metadata {
  return { publishedAt: null, readingMinutes: 1 };
}

export function EditorView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = getSession();
  const [form, setForm] = useState<PostForm>(blankForm);
  const [metadata, setMetadata] = useState<Metadata>(blankMetadata);
  const [saving, setSaving] = useState<SaveIntent>();
  const [notice, setNotice] = useState<Notice>();
  const [invalidFields, setInvalidFields] = useState<FormField[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const postQuery = useQuery({
    queryKey: ['post', id],
    queryFn: () => core.getPost(session!.accessToken, id!),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!id) {
      setForm(blankForm());
      setMetadata(blankMetadata());
      setNotice(undefined);
      setInvalidFields([]);
    }
  }, [id]);

  useEffect(() => {
    if (postQuery.data) applyPost(postQuery.data);
  }, [postQuery.data]);

  useEffect(() => {
    if (postQuery.error instanceof CoreRequestError && postQuery.error.status === 401) {
      clearSession();
      navigate('/auth', { replace: true });
    }
  }, [navigate, postQuery.error]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setSettingsOpen(false);
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  const isNew = !id;
  const isLoadingPost = Boolean(id) && postQuery.isPending;
  const loadError = postQuery.error ? messageForError(postQuery.error) : undefined;
  const saveLabel = saving === 'draft' ? (form.status === 'published' ? '正在保存…' : '正在保存草稿…') : form.status === 'published' ? '保存更改' : '保存草稿';
  const publishLabel = saving === 'published' ? '正在发布…' : '发布文章';

  const metadataRows = useMemo(
    () => [
      { label: '最近保存', value: metadata.updatedAt ? formatDate(metadata.updatedAt) : '新建文章', icon: Clock3Icon },
      ...(metadata.publishedAt ? [{ label: '首次发布', value: formatDate(metadata.publishedAt), icon: CheckIcon }] : []),
      ...(metadata.createdAt ? [{ label: '创建时间', value: formatDate(metadata.createdAt), icon: FileTextIcon }] : []),
      { label: '预计阅读', value: `${metadata.readingMinutes} 分钟`, icon: SparklesIcon },
    ],
    [metadata],
  );

  function applyPost(post: Post) {
    setForm({ title: post.title, slug: post.slug, content: post.content, excerpt: post.excerpt, section: post.section, tagsText: post.tags.join(', '), status: post.status });
    setMetadata({ createdAt: post.createdAt, updatedAt: post.updatedAt, publishedAt: post.publishedAt, readingMinutes: post.readingMinutes });
  }

  function changeField(field: FormField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setInvalidFields((current) => current.filter((name) => name !== field));
  }

  function tags(): string[] {
    const unique = new Map<string, string>();
    for (const candidate of form.tagsText.split(',')) {
      const tag = candidate.trim();
      if (tag && !unique.has(tag.toLocaleLowerCase())) unique.set(tag.toLocaleLowerCase(), tag);
    }
    return [...unique.values()];
  }

  function validate(targetStatus: PostStatus): { message: string; fields: FormField[] } | undefined {
    const required: Array<[FormField, string]> = [
      ['title', form.title],
      ['slug', form.slug],
      ['content', form.content],
      ...(targetStatus === 'published' ? ([['excerpt', form.excerpt], ['section', form.section]] as Array<[FormField, string]>) : []),
    ];
    const missing = required.filter(([, value]) => !value.trim()).map(([field]) => field);
    if (missing.length) return { message: `请先填写：${missing.map(fieldName).join('、')}。`, fields: missing };
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug)) return { message: 'slug 只能使用小写字母、数字与单个连字符，例如 my-first-post。', fields: ['slug'] };
    return undefined;
  }

  async function save(intent: SaveIntent) {
    const targetStatus: PostStatus = intent === 'unpublish' ? 'draft' : intent === 'published' ? 'published' : form.status;
    const validation = intent === 'unpublish' ? undefined : validate(targetStatus);
    if (validation) {
      setInvalidFields(validation.fields);
      if (validation.fields.some((field) => field === 'excerpt' || field === 'section' || field === 'tagsText')) setSettingsOpen(true);
      setNotice({ kind: 'error', message: validation.message });
      return;
    }
    if (!session) {
      navigate('/auth', { replace: true });
      return;
    }

    setSaving(intent);
    setNotice({ kind: 'info', message: intent === 'published' ? '正在发布…' : '正在保存…' });
    try {
      const input = { title: form.title.trim(), slug: form.slug.trim(), content: form.content, excerpt: form.excerpt.trim(), section: form.section.trim(), tags: tags(), status: targetStatus };
      const post = id ? await core.updatePost(session.accessToken, id, input) : await core.createPost(session.accessToken, input);
      applyPost(post);
      queryClient.setQueryData(['post', post.id], post);
      await queryClient.invalidateQueries({ queryKey: ['posts'] });
      setNotice({ kind: 'success', message: intent === 'published' ? '文章已发布。' : intent === 'unpublish' ? '文章已取消发布。' : '草稿已保存。' });
      if (!id) navigate(`/posts/${post.id}`, { replace: true });
    } catch (error) {
      if (error instanceof CoreRequestError && error.status === 401) {
        clearSession();
        navigate('/auth', { replace: true });
        return;
      }
      setNotice({ kind: 'error', message: messageForError(error) });
    } finally {
      setSaving(undefined);
    }
  }

  function isInvalid(field: FormField) { return invalidFields.includes(field); }

  return (
    <PageFrame
      actions={(
        <div className="mx-actions">
          <HeaderAction label="文章设置" aria-controls="post-settings" aria-expanded={settingsOpen} disabled={isLoadingPost} onClick={() => setSettingsOpen((open) => !open)}>
            <SlidersHorizontalIcon />
          </HeaderAction>
          <HeaderAction label={saveLabel} disabled={Boolean(saving) || isLoadingPost} onClick={() => void save('draft')}>
            {saving === 'draft' ? <LoaderCircleIcon className="mx-spin" /> : <SaveIcon />}
          </HeaderAction>
          {form.status === 'draft' ? (
            <HeaderAction label={publishLabel} variant="primary" disabled={Boolean(saving) || isLoadingPost} onClick={() => void save('published')}>
              {saving === 'published' ? <LoaderCircleIcon className="mx-spin" /> : <SendIcon />}
            </HeaderAction>
          ) : (
            <HeaderAction label="取消发布" variant="danger" disabled={Boolean(saving) || isLoadingPost} onClick={() => void save('unpublish')}><Undo2Icon /></HeaderAction>
          )}
        </div>
      )}
      className="mx-editor-page"
      title={(
        <div className="mx-editor-toolbar-title">
          <Link aria-label="返回文章列表" className="mx-editor-back" title="返回文章列表" to="/posts"><ArrowLeftIcon /></Link>
          <h1 className="mx-content-page-title">{isNew ? '撰写新文章' : '编辑文章'}</h1>
          {!isNew ? <StatusBadge status={form.status} /> : null}
        </div>
      )}
    >

      <div className="mx-editor-surface">
        {notice ? <div className="mx-editor-notice"><FeedbackAlert notice={notice} /></div> : null}
        {loadError ? <div className="mx-editor-notice"><FeedbackAlert notice={{ kind: 'error', message: loadError }} /></div> : null}
        {isLoadingPost ? <EditorSkeleton /> : null}

        {!isLoadingPost && !loadError ? (
          <form className="mx-write-editor" noValidate onSubmit={(event) => { event.preventDefault(); void save('draft'); }}>
            <div className="mx-write-editor-scroll">
              <div className="mx-write-editor-header">
                <label className="sr-only" htmlFor="post-title">文章标题</label>
                <input id="post-title" aria-invalid={isInvalid('title') || undefined} autoComplete="off" autoFocus={isNew} className="mx-write-title" name="title" placeholder="输入标题…" required value={form.title} onChange={(event) => changeField('title', event.target.value)} />
                <div className="mx-write-slug">
                  <span aria-hidden="true">/</span>
                  <label className="sr-only" htmlFor="post-slug">文章 slug</label>
                  <input id="post-slug" aria-invalid={isInvalid('slug') || undefined} autoComplete="off" name="slug" placeholder="post-slug" required spellCheck={false} value={form.slug} onChange={(event) => changeField('slug', event.target.value.toLowerCase())} />
                </div>
              </div>
              <div className="mx-write-editor-content">
                <label className="sr-only" htmlFor="post-content">正文 Markdown</label>
                <textarea id="post-content" aria-invalid={isInvalid('content') || undefined} className="mx-write-markdown" name="content" placeholder={'# 从这里开始\n\n写下第一段。'} required spellCheck value={form.content} onChange={(event) => changeField('content', event.target.value)} />
              </div>
            </div>
          </form>
        ) : null}

        <aside id="post-settings" aria-hidden={!settingsOpen} aria-label="文章设置" className={`mx-editor-drawer${settingsOpen ? ' is-open' : ''}`}>
          <header className="mx-editor-drawer-header">
            <div className="mx-editor-drawer-heading"><SlidersHorizontalIcon /><h2>文章设置</h2></div>
            <button aria-label="关闭文章设置" className="mx-editor-drawer-close" title="关闭文章设置" type="button" onClick={() => setSettingsOpen(false)}><XIcon /></button>
          </header>
          <div className="mx-editor-drawer-body">
            <section className="mx-editor-settings-group">
              <div className="mx-editor-setting-row">
                <label htmlFor="post-section">栏目</label>
                <input id="post-section" aria-invalid={isInvalid('section') || undefined} autoComplete="off" className="mx-control" name="section" placeholder="例如：写作" value={form.section} onChange={(event) => changeField('section', event.target.value)} />
              </div>
              <div className="mx-editor-setting-row">
                <label htmlFor="post-excerpt">摘要</label>
                <textarea id="post-excerpt" aria-invalid={isInvalid('excerpt') || undefined} className="mx-control mx-textarea" name="excerpt" placeholder="一句让读者愿意停下来的引言。" rows={3} value={form.excerpt} onChange={(event) => changeField('excerpt', event.target.value)} />
              </div>
              <div className="mx-editor-setting-row">
                <label htmlFor="post-tags">标签</label>
                <input id="post-tags" autoComplete="off" className="mx-control" name="tags" placeholder="写作, 网站, 随笔" value={form.tagsText} onChange={(event) => changeField('tagsText', event.target.value)} />
              </div>
            </section>
            <section className="mx-editor-settings-group mx-editor-record-group">
              <div className="mx-editor-drawer-section-title"><span>状态</span><StatusBadge status={form.status} /></div>
              <dl className="mx-records">
                {metadataRows.map(({ label, value, icon: Icon }) => (
                  <div key={label} className="mx-record"><Icon /><div><dt>{label}</dt><dd>{value}</dd></div></div>
                ))}
              </dl>
            </section>
          </div>
        </aside>
      </div>
    </PageFrame>
  );
}

function EditorSkeleton() {
  return (
    <div className="mx-editor-skeleton" aria-busy="true">
      <div className="mx-editor-skeleton-main"><span className="mx-skeleton mx-skeleton-title" /><span className="mx-skeleton mx-skeleton-slug" /><span className="mx-skeleton mx-skeleton-markdown" /></div>
    </div>
  );
}
