import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  CheckIcon,
  Clock3Icon,
  FileTextIcon,
  EyeIcon,
  LoaderCircleIcon,
  MessageSquarePlusIcon,
  SendIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  StopCircleIcon,
  Undo2Icon,
  XIcon,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  Link,
  useBlocker,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';

import { AutosizeTitleField } from '@/components/autosize-title-field';
import { FeedbackAlert, type Notice } from '@/components/feedback-alert';
import { HeaderAction } from '@/components/header-action';
import { PageFrame } from '@/components/page-frame';
import type { RichPostEditorHandle } from '@/components/rich-post-editor';
import { StatusBadge } from '@/components/status-badge';
import {
  core,
  CoreRequestError,
  type AiDocumentProposal,
  type AiMessage,
  type RichDocument,
  type RichPost,
  type VersionedPost,
} from '@/lib/core';
import {
  applyTextScopedProposal,
  buildDraftInput,
  canApplySaveResult,
  createTextScopedProposal,
  inspectTextScopedProposal,
  reconcileAutosaveResponse,
  shouldBlockEditorNavigation,
  shouldScheduleAutosave,
  type AutosaveState,
} from '@/lib/editor-state';
import { fieldName, messageForError } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { clearSession, getSession } from '@/lib/session';

const RichPostEditor = lazy(() => import('@/components/rich-post-editor'));
const RichPostPreview = lazy(() => import('@/components/rich-post-preview'));

type FormField = 'title' | 'slug' | 'content' | 'excerpt' | 'section' | 'tagsText';
type EditorLocationState = { returnTo?: string };
type AuxiliaryPanel = 'settings' | 'preview' | 'ai';

type PostForm = {
  title: string;
  slug: string;
  document: RichDocument;
  plainText: string;
  excerpt: string;
  section: string;
  tagsText: string;
  status: 'draft' | 'published';
  hasUnpublishedChanges: boolean;
  contentMigrationState: 'native' | 'pending' | 'failed';
};

type Metadata = {
  createdAt?: string;
  updatedAt?: string;
  publishedAt: string | null;
  readingMinutes: number;
};

const EMPTY_DOCUMENT = {
  root: {
    children: [
      {
        children: [],
        direction: null,
        format: '',
        indent: 0,
        type: 'paragraph',
        version: 1,
        textFormat: 0,
        textStyle: '',
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
} as unknown as RichDocument;

function markdownFallback(markdown: string): RichDocument {
  const blocks = markdown
    .split(/\n{2,}/u)
    .map((value) => value.replace(/\s*\n\s*/gu, ' ').trim());
  return {
    root: {
      children: (blocks.length ? blocks : ['']).map((text) => ({
        children: text
          ? [
              {
                detail: 0,
                format: 0,
                mode: 'normal',
                style: '',
                text,
                type: 'text',
                version: 1,
              },
            ]
          : [],
        direction: null,
        format: '',
        indent: 0,
        type: 'paragraph',
        version: 1,
        textFormat: 0,
        textStyle: '',
      })),
      direction: null,
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  } as unknown as RichDocument;
}

function blankForm(): PostForm {
  return {
    title: '',
    slug: '',
    document: EMPTY_DOCUMENT,
    plainText: '',
    excerpt: '',
    section: '',
    tagsText: '',
    status: 'draft',
    hasUnpublishedChanges: false,
    contentMigrationState: 'native',
  };
}

function blankMetadata(): Metadata {
  return { publishedAt: null, readingMinutes: 1 };
}

function formSnapshot(form: PostForm) {
  return JSON.stringify({
    title: form.title,
    slug: form.slug,
    document: form.document,
    excerpt: form.excerpt,
    section: form.section,
    tagsText: form.tagsText,
  });
}

function normalizePost(post: RichPost): PostForm {
  return {
    title: post.title ?? '',
    slug: post.slug ?? '',
    document: post.document ?? markdownFallback(post.content ?? ''),
    plainText: post.content ?? '',
    excerpt: post.excerpt ?? '',
    section: post.section ?? '',
    tagsText: post.tags?.join(', ') ?? '',
    status: post.status,
    hasUnpublishedChanges: Boolean(post.hasUnpublishedChanges),
    contentMigrationState: post.contentMigrationState ?? 'native',
  };
}

export function EditorView() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = getSession();
  const [form, setForm] = useState<PostForm>(blankForm);
  const [metadata, setMetadata] = useState<Metadata>(blankMetadata);
  const [saveState, setSaveState] = useState<AutosaveState>('idle');
  const [notice, setNotice] = useState<Notice>();
  const [invalidFields, setInvalidFields] = useState<FormField[]>([]);
  const [auxiliary, setAuxiliary] = useState<AuxiliaryPanel>();
  const [editorEpoch, setEditorEpoch] = useState(0);
  const savedFormRef = useRef(formSnapshot(blankForm()));
  const etagRef = useRef('');
  const saveTimerRef = useRef<number | undefined>(undefined);
  const richEditorRef = useRef<RichPostEditorHandle>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const aiButtonRef = useRef<HTMLButtonElement>(null);
  const auxiliaryCloseRef = useRef<HTMLButtonElement>(null);
  const leaveDialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef(form);
  const idRef = useRef(id);
  const pendingCreatedIdRef = useRef<string | undefined>(undefined);
  const saveControllerRef = useRef<AbortController | undefined>(undefined);
  const saveOperationRef = useRef(0);
  const mutationEffectsEnabledRef = useRef(true);
  const returnTo = (location.state as EditorLocationState | null)?.returnTo ?? '/posts';

  formRef.current = form;
  if (id || !pendingCreatedIdRef.current) idRef.current = id;

  const postQuery = useQuery({
    queryKey: ['post', id],
    queryFn: () => core.getRichPost(session!.accessToken, id!),
    enabled: Boolean(id),
  });

  const isNew = !id;
  const isLoadingPost = Boolean(id) && postQuery.isPending;
  const isDirty = !isLoadingPost && formSnapshot(form) !== savedFormRef.current;
  const blocker = useBlocker(({ nextLocation }) =>
    shouldBlockEditorNavigation({
      currentSnapshot: formSnapshot(formRef.current),
      savedSnapshot: savedFormRef.current,
      nextPath: nextLocation.pathname,
      pendingCreatedId: pendingCreatedIdRef.current,
    }),
  );
  const loadError = postQuery.error ? messageForError(postQuery.error) : undefined;
  const editorContextTitle = form.title.trim() || (isNew ? '新文章' : '未命名');

  useEffect(() => {
    saveControllerRef.current?.abort();
    saveOperationRef.current += 1;
    mutationEffectsEnabledRef.current = true;
    if (id && pendingCreatedIdRef.current === id) {
      pendingCreatedIdRef.current = undefined;
    }
    if (id) return;
    const nextForm = blankForm();
    savedFormRef.current = formSnapshot(nextForm);
    etagRef.current = '';
    setForm(nextForm);
    setMetadata(blankMetadata());
    setSaveState('idle');
    setNotice(undefined);
    setInvalidFields([]);
    setEditorEpoch((value) => value + 1);
  }, [id]);

  useEffect(
    () => () => {
      mutationEffectsEnabledRef.current = false;
      saveOperationRef.current += 1;
      saveControllerRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!postQuery.data) return;
    applyVersionedPost(postQuery.data, true);
  }, [postQuery.data]);

  useEffect(() => {
    if (postQuery.error instanceof CoreRequestError && postQuery.error.status === 401) {
      clearSession();
      navigate('/auth', { replace: true });
    }
  }, [navigate, postQuery.error]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (saveState !== 'failed') return;
    const resumeWhenOnline = () => {
      setSaveState('idle');
      setNotice(undefined);
    };
    window.addEventListener('online', resumeWhenOnline);
    return () => window.removeEventListener('online', resumeWhenOnline);
  }, [saveState]);

  useEffect(() => {
    const hasMeaningfulContent = Boolean(
      form.title.trim() ||
      form.plainText.trim() ||
      form.slug.trim() ||
      form.excerpt.trim() ||
      form.section.trim() ||
      form.tagsText.trim(),
    );
    if (
      !shouldScheduleAutosave({
        dirty: isDirty,
        loading: isLoadingPost,
        meaningful: hasMeaningfulContent,
        isNew: !id,
        state: saveState,
      })
    ) {
      return;
    }

    setSaveState('waiting');
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void persistDraft();
    }, 800);
    return () => window.clearTimeout(saveTimerRef.current);
  }, [form, id, isDirty, isLoadingPost, saveState]);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const dialog = leaveDialogRef.current;
    if (!dialog?.open) dialog?.showModal();
  }, [blocker.state]);

  useEffect(() => {
    if (!auxiliary) return;
    requestAnimationFrame(() =>
      auxiliaryCloseRef.current?.focus({ preventScroll: true }),
    );
    const closeButton =
      auxiliary === 'settings'
        ? settingsButtonRef
        : auxiliary === 'preview'
          ? previewButtonRef
          : aiButtonRef;
    const keepFocusInModalDrawer = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setAuxiliary(undefined);
        requestAnimationFrame(() =>
          closeButton.current?.focus({ preventScroll: true }),
        );
        return;
      }
      if (event.key !== 'Tab') return;
      const drawer = document.getElementById('post-auxiliary');
      const focusable = drawer?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href]',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', keepFocusInModalDrawer);
    return () => window.removeEventListener('keydown', keepFocusInModalDrawer);
  }, [auxiliary]);

  const metadataRows = useMemo(
    () => [
      {
        label: '最近保存',
        value: metadata.updatedAt ? formatDate(metadata.updatedAt) : '尚未保存',
        icon: Clock3Icon,
      },
      ...(metadata.publishedAt
        ? [
            {
              label: '首次发布',
              value: formatDate(metadata.publishedAt),
              icon: CheckIcon,
            },
          ]
        : []),
      ...(metadata.createdAt
        ? [
            {
              label: '创建时间',
              value: formatDate(metadata.createdAt),
              icon: FileTextIcon,
            },
          ]
        : []),
      {
        label: '预计阅读',
        value: `${metadata.readingMinutes} 分钟`,
        icon: SparklesIcon,
      },
    ],
    [metadata],
  );

  function applyVersionedPost(value: VersionedPost, resetEditor = false) {
    const nextForm = normalizePost(value.post);
    savedFormRef.current = formSnapshot(nextForm);
    etagRef.current = value.etag;
    setForm(nextForm);
    setMetadata({
      createdAt: value.post.createdAt,
      updatedAt: value.post.updatedAt,
      publishedAt: value.post.publishedAt,
      readingMinutes: value.post.readingMinutes,
    });
    setSaveState('saved');
    if (resetEditor) setEditorEpoch((epoch) => epoch + 1);
  }

  function applyVersionMetadata(value: VersionedPost) {
    etagRef.current = value.etag;
    setMetadata({
      createdAt: value.post.createdAt,
      updatedAt: value.post.updatedAt,
      publishedAt: value.post.publishedAt,
      readingMinutes: value.post.readingMinutes,
    });
  }

  function applyCommandResponse(
    value: VersionedPost,
    submittedSnapshot: string,
  ): boolean {
    const responseForm = normalizePost(value.post);
    const currentForm = formRef.current;
    const reconciliation = reconcileAutosaveResponse({
      current: currentForm,
      currentSnapshot: formSnapshot(currentForm),
      response: responseForm,
      responseSnapshot: formSnapshot(responseForm),
      submittedSnapshot,
    });
    if (!reconciliation.stale) {
      applyVersionedPost(value);
      return false;
    }
    savedFormRef.current = submittedSnapshot;
    applyVersionMetadata(value);
    setForm((current) => ({
      ...current,
      status: value.post.status,
      hasUnpublishedChanges:
        value.post.status === 'published' ? true : value.post.hasUnpublishedChanges,
      contentMigrationState: value.post.contentMigrationState,
    }));
    setSaveState('waiting');
    return true;
  }

  function changeField(field: Exclude<FormField, 'content'>, value: string) {
    resumeAutosaveAfterOwnerEdit();
    setForm((current) => ({ ...current, [field]: value }));
    setInvalidFields((current) => current.filter((name) => name !== field));
  }

  function changeDocument(document: RichDocument, plainText: string) {
    resumeAutosaveAfterOwnerEdit();
    setForm((current) => ({ ...current, document, plainText }));
    if (plainText.trim()) {
      setInvalidFields((current) => current.filter((name) => name !== 'content'));
    }
  }

  function resumeAutosaveAfterOwnerEdit() {
    if (saveState !== 'failed') return;
    setSaveState('idle');
    setNotice(undefined);
  }

  function draftInput(source = formRef.current) {
    return buildDraftInput(source);
  }

  async function persistDraft(): Promise<VersionedPost | undefined> {
    if (!session || saveState === 'conflict') return undefined;
    window.clearTimeout(saveTimerRef.current);
    saveControllerRef.current?.abort();
    const controller = new AbortController();
    const operation = saveOperationRef.current + 1;
    saveOperationRef.current = operation;
    saveControllerRef.current = controller;
    const submittedForm = formRef.current;
    const submittedSnapshot = formSnapshot(submittedForm);
    setSaveState('saving');
    try {
      const currentId = idRef.current;
      const result = currentId
        ? await core.savePostDraft(
            session.accessToken,
            currentId,
            draftInput(submittedForm),
            etagRef.current,
            controller.signal,
          )
        : await core.createPostDraft(
            session.accessToken,
            draftInput(submittedForm),
            controller.signal,
          );
      if (
        !canApplySaveResult({
          active: mutationEffectsEnabledRef.current,
          aborted: controller.signal.aborted,
          operation,
          latestOperation: saveOperationRef.current,
        })
      ) {
        return undefined;
      }
      if (!currentId) {
        idRef.current = result.post.id;
        pendingCreatedIdRef.current = result.post.id;
      }
      const responseForm = normalizePost(result.post);
      const currentForm = formRef.current;
      const reconciliation = reconcileAutosaveResponse({
        current: currentForm,
        currentSnapshot: formSnapshot(currentForm),
        response: responseForm,
        responseSnapshot: formSnapshot(responseForm),
        submittedSnapshot,
      });
      if (reconciliation.stale) {
        savedFormRef.current = reconciliation.savedSnapshot;
        applyVersionMetadata(result);
        setForm((current) => ({
          ...current,
          slug: current.slug || result.post.slug,
          status: result.post.status,
          hasUnpublishedChanges: result.post.hasUnpublishedChanges,
          contentMigrationState: result.post.contentMigrationState,
        }));
        setSaveState('waiting');
      } else {
        applyVersionedPost(result);
      }
      await queryClient.invalidateQueries({ queryKey: ['posts'] });
      if (pendingCreatedIdRef.current && !reconciliation.stale) {
        const createdId = pendingCreatedIdRef.current;
        navigate(`/posts/${createdId}`, {
          replace: true,
          state: { returnTo },
        });
      }
      return reconciliation.stale ? undefined : result;
    } catch (error) {
      if (
        !canApplySaveResult({
          active: mutationEffectsEnabledRef.current,
          aborted: controller.signal.aborted,
          operation,
          latestOperation: saveOperationRef.current,
        })
      ) {
        return undefined;
      }
      if (error instanceof CoreRequestError && error.status === 401) {
        clearSession();
        navigate('/auth', { replace: true });
        return undefined;
      }
      if (error instanceof CoreRequestError && error.status === 412) {
        setSaveState('conflict');
        setNotice({
          kind: 'error',
          message: '服务器上已有更新。请选择加载服务器版本，或将当前内容另存为新草稿。',
        });
        return undefined;
      }
      setSaveState('failed');
      setNotice({
        kind: 'error',
        message: `${messageForError(error)} 当前内容仍保留在此页面。`,
      });
      return undefined;
    } finally {
      if (saveOperationRef.current === operation) {
        saveControllerRef.current = undefined;
      }
    }
  }

  function validatePublish(): { message: string; fields: FormField[] } | undefined {
    const required: Array<[FormField, string]> = [
      ['title', form.title],
      ['slug', form.slug],
      ['content', form.plainText],
      ['excerpt', form.excerpt],
      ['section', form.section],
    ];
    const missing = required
      .filter(([, value]) => !value.trim())
      .map(([field]) => field);
    if (missing.length)
      return {
        message: `发布前请填写：${missing.map(fieldName).join('、')}。`,
        fields: missing,
      };
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug)) {
      return {
        message: 'slug 只能使用小写字母、数字与单个连字符，例如 my-first-post。',
        fields: ['slug'],
      };
    }
    return undefined;
  }

  async function publish() {
    const validation = validatePublish();
    if (validation) {
      setInvalidFields(validation.fields);
      if (
        validation.fields.some((field) => field === 'excerpt' || field === 'section')
      ) {
        setAuxiliary('settings');
      }
      setNotice({ kind: 'error', message: validation.message });
      return;
    }
    if (!session) return;
    const saved = isDirty ? await persistDraft() : undefined;
    if (isDirty && !saved) return;
    const postId = saved?.post.id ?? id;
    const etag = saved?.etag ?? etagRef.current;
    if (!postId || !etag || saveState === 'conflict') return;
    const submittedSnapshot = formSnapshot(formRef.current);
    setSaveState('saving');
    setNotice({ kind: 'info', message: '正在发布文章…' });
    try {
      const result = await core.publishPost(session.accessToken, postId, etag);
      const stale = applyCommandResponse(result, submittedSnapshot);
      setNotice({
        kind: 'success',
        message: stale
          ? '已发布保存时的版本；刚输入的内容仍在工作稿中等待保存。'
          : form.status === 'published'
            ? '文章更新已发布。'
            : '文章已发布。',
      });
      await queryClient.invalidateQueries({ queryKey: ['posts'] });
    } catch (error) {
      setSaveState(
        error instanceof CoreRequestError && error.status === 412
          ? 'conflict'
          : 'failed',
      );
      setNotice({ kind: 'error', message: messageForError(error) });
    }
  }

  async function unpublish() {
    if (!session || !id) return;
    if (isDirty) {
      const saved = await persistDraft();
      if (!saved) return;
    }
    const submittedSnapshot = formSnapshot(formRef.current);
    setSaveState('saving');
    try {
      const result = await core.unpublishPost(session.accessToken, id, etagRef.current);
      applyCommandResponse(result, submittedSnapshot);
      setNotice({ kind: 'success', message: '文章已取消发布，工作稿仍然保留。' });
      await queryClient.invalidateQueries({ queryKey: ['posts'] });
    } catch (error) {
      setSaveState(
        error instanceof CoreRequestError && error.status === 412
          ? 'conflict'
          : 'failed',
      );
      setNotice({ kind: 'error', message: messageForError(error) });
    }
  }

  async function loadServerVersion() {
    if (!session || !id) return;
    const result = await core.getRichPost(session.accessToken, id);
    applyVersionedPost(result, true);
    setNotice({ kind: 'info', message: '已加载服务器上的最新版本。' });
  }

  async function forkLocalDraft() {
    if (!session || !id) return;
    setSaveState('saving');
    try {
      const result = await core.forkWorkingCopy(session.accessToken, id, draftInput());
      applyVersionedPost(result, true);
      setNotice({ kind: 'success', message: '当前内容已另存为新草稿。' });
      navigate(`/posts/${result.post.id}`, { replace: true, state: { returnTo } });
    } catch (error) {
      setSaveState('failed');
      setNotice({ kind: 'error', message: messageForError(error) });
    }
  }

  function closeAuxiliary() {
    const trigger =
      auxiliary === 'settings'
        ? settingsButtonRef
        : auxiliary === 'preview'
          ? previewButtonRef
          : aiButtonRef;
    setAuxiliary(undefined);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }

  const saveStatus = {
    idle: '尚未保存',
    waiting: '等待保存',
    saving: '正在保存草稿…',
    saved: form.hasUnpublishedChanges ? '草稿已保存 · 有未发布修改' : '已保存',
    failed: '保存失败',
    conflict: '发现版本冲突',
  }[saveState];

  return (
    <PageFrame
      actions={
        <div className="mx-actions">
          <span aria-live="polite" className={`mx-editor-save-state is-${saveState}`}>
            {saveState === 'saving' ? (
              <LoaderCircleIcon className="mx-spin" />
            ) : saveState === 'saved' ? (
              <CheckIcon />
            ) : (
              <Clock3Icon />
            )}
            <span className="mx-editor-save-state-label">{saveStatus}</span>
          </span>
          <HeaderAction
            ref={previewButtonRef}
            label="发布预览"
            aria-controls="post-auxiliary"
            aria-expanded={auxiliary === 'preview'}
            disabled={isLoadingPost}
            onClick={() =>
              setAuxiliary((value) => (value === 'preview' ? undefined : 'preview'))
            }
          >
            <EyeIcon />
          </HeaderAction>
          <HeaderAction
            ref={aiButtonRef}
            label="AI 协作"
            aria-controls="post-auxiliary"
            aria-expanded={auxiliary === 'ai'}
            disabled={isLoadingPost}
            onClick={() => setAuxiliary((value) => (value === 'ai' ? undefined : 'ai'))}
          >
            <SparklesIcon />
          </HeaderAction>
          <HeaderAction
            ref={settingsButtonRef}
            label="文章设置"
            aria-controls="post-auxiliary"
            aria-expanded={auxiliary === 'settings'}
            disabled={isLoadingPost}
            onClick={() =>
              setAuxiliary((value) => (value === 'settings' ? undefined : 'settings'))
            }
          >
            <SlidersHorizontalIcon />
          </HeaderAction>
          {form.status === 'draft' || form.hasUnpublishedChanges ? (
            <HeaderAction
              display="label"
              label={
                saveState === 'saving'
                  ? '正在处理…'
                  : form.status === 'published'
                    ? '发布更新'
                    : '发布文章'
              }
              variant="primary"
              disabled={saveState === 'saving' || isLoadingPost}
              onClick={() => void publish()}
            >
              {saveState === 'saving' ? (
                <LoaderCircleIcon className="mx-spin" />
              ) : (
                <SendIcon />
              )}
            </HeaderAction>
          ) : (
            <HeaderAction
              display="label"
              label="取消发布"
              variant="danger"
              disabled={saveState === 'saving' || isLoadingPost}
              onClick={() => void unpublish()}
            >
              <Undo2Icon />
            </HeaderAction>
          )}
        </div>
      }
      className="mx-editor-page"
      constrain={false}
      headerInert={Boolean(auxiliary)}
      title={
        <div className="mx-editor-toolbar-title">
          <button
            aria-label="返回文章列表"
            className="mx-editor-back"
            title="返回文章列表"
            type="button"
            onClick={() => navigate(returnTo)}
          >
            <ArrowLeftIcon />
          </button>
          <h1 className="sr-only">
            {isNew ? '新建文章' : `编辑文章：${editorContextTitle}`}
          </h1>
          <nav aria-label="文章编辑路径" className="mx-editor-breadcrumb">
            <span className="mx-editor-breadcrumb-parent">文章</span>
            <span aria-hidden="true" className="mx-editor-breadcrumb-separator">
              /
            </span>
            <span
              aria-current="page"
              className="mx-editor-breadcrumb-current"
              title={editorContextTitle}
            >
              {editorContextTitle}
            </span>
          </nav>
          {!isNew ? <StatusBadge status={form.status} /> : null}
        </div>
      }
    >
      <div className="mx-editor-surface">
        {form.contentMigrationState !== 'native' ? (
          <div className="mx-editor-notice">
            <FeedbackAlert
              notice={{
                kind: form.contentMigrationState === 'failed' ? 'error' : 'info',
                message:
                  form.contentMigrationState === 'failed'
                    ? '旧 Markdown 尚未能转换为结构化内容；原文已保留，请确认正文后再保存。'
                    : '正在将旧 Markdown 转换为结构化内容；原文会一直保留到转换完成。',
              }}
            />
          </div>
        ) : null}
        {notice ? (
          <div className="mx-editor-notice">
            <FeedbackAlert notice={notice} />
            {saveState === 'conflict' ? (
              <div className="mx-editor-conflict-actions">
                <button
                  className="mx-button is-secondary"
                  type="button"
                  onClick={() => void loadServerVersion()}
                >
                  加载服务器版本
                </button>
                <button
                  className="mx-button is-primary"
                  type="button"
                  onClick={() => void forkLocalDraft()}
                >
                  另存为新草稿
                </button>
              </div>
            ) : saveState === 'failed' ? (
              <button
                className="mx-button is-secondary"
                type="button"
                onClick={() => void persistDraft()}
              >
                重新保存
              </button>
            ) : null}
          </div>
        ) : null}
        {loadError ? (
          <div className="mx-editor-notice">
            <FeedbackAlert notice={{ kind: 'error', message: loadError }} />
          </div>
        ) : null}
        {isLoadingPost ? <EditorSkeleton /> : null}

        {!isLoadingPost && !loadError ? (
          <form
            inert={Boolean(auxiliary)}
            className="mx-write-editor"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void persistDraft();
            }}
          >
            <div className="mx-write-editor-scroll">
              <div className="mx-write-editor-header">
                <label className="sr-only" htmlFor="post-title">
                  文章标题
                </label>
                <AutosizeTitleField
                  autoFocus={isNew}
                  invalid={invalidFields.includes('title')}
                  value={form.title}
                  onChange={(value) => changeField('title', value)}
                  onMoveToContent={() => richEditorRef.current?.focus()}
                />
                <div className="mx-write-slug">
                  <span aria-hidden="true">/</span>
                  <label className="sr-only" htmlFor="post-slug">
                    文章 slug
                  </label>
                  <input
                    id="post-slug"
                    aria-invalid={invalidFields.includes('slug') || undefined}
                    autoComplete="off"
                    name="slug"
                    placeholder="保存后自动生成 slug"
                    spellCheck={false}
                    value={form.slug}
                    onChange={(event) =>
                      changeField('slug', event.target.value.toLowerCase())
                    }
                  />
                </div>
              </div>
              <div className="mx-write-editor-content">
                <span className="sr-only" id="post-content-label">
                  文章正文
                </span>
                <Suspense
                  fallback={
                    <div className="mx-rich-editor-loading" aria-busy="true">
                      正在准备写作画布…
                    </div>
                  }
                >
                  <RichPostEditor
                    key={editorEpoch}
                    ref={richEditorRef}
                    initialValue={form.document}
                    invalid={invalidFields.includes('content')}
                    onChange={changeDocument}
                  />
                </Suspense>
              </div>
            </div>
          </form>
        ) : null}

        {auxiliary ? (
          <button
            aria-label={`关闭${auxiliary === 'ai' ? ' AI 协作' : auxiliary === 'preview' ? '发布预览' : '文章设置'}`}
            className="mx-editor-drawer-backdrop"
            type="button"
            onClick={closeAuxiliary}
          />
        ) : null}
        <aside
          id="post-auxiliary"
          aria-hidden={!auxiliary}
          aria-label={
            auxiliary === 'ai'
              ? 'AI 协作'
              : auxiliary === 'preview'
                ? '发布预览'
                : '文章设置'
          }
          aria-modal={auxiliary ? true : undefined}
          className={`mx-editor-drawer${auxiliary ? ' is-open' : ''}${auxiliary === 'ai' ? ' is-ai' : ''}${auxiliary === 'preview' ? ' is-preview' : ''}`}
          inert={!auxiliary}
          role="dialog"
        >
          <header className="mx-editor-drawer-header">
            <div className="mx-editor-drawer-heading">
              {auxiliary === 'ai' ? (
                <SparklesIcon />
              ) : auxiliary === 'preview' ? (
                <EyeIcon />
              ) : (
                <SlidersHorizontalIcon />
              )}
              <h2>
                {auxiliary === 'ai'
                  ? 'AI 协作'
                  : auxiliary === 'preview'
                    ? '发布预览'
                    : '文章设置'}
              </h2>
            </div>
            <button
              ref={auxiliaryCloseRef}
              aria-label={`关闭${auxiliary === 'ai' ? ' AI 协作' : auxiliary === 'preview' ? '发布预览' : '文章设置'}`}
              className="mx-editor-drawer-close"
              type="button"
              onClick={closeAuxiliary}
            >
              <XIcon />
            </button>
          </header>
          {auxiliary === 'ai' ? (
            <AiWritingPanel
              currentDocument={form.document}
              currentText={form.plainText}
              postId={id}
              onAcceptDocument={(document) => {
                richEditorRef.current?.replaceDocument(document);
                changeDocument(document, extractDocumentText(document));
              }}
            />
          ) : auxiliary === 'preview' ? (
            <Suspense
              fallback={
                <div className="mx-rich-editor-loading" aria-busy="true">
                  正在准备发布预览…
                </div>
              }
            >
              <RichPostPreview
                accessToken={session!.accessToken}
                document={form.document}
                title={form.title}
              />
            </Suspense>
          ) : (
            <div className="mx-editor-drawer-body">
              <section className="mx-editor-settings-group">
                <div className="mx-editor-setting-row">
                  <label htmlFor="post-section">栏目</label>
                  <input
                    id="post-section"
                    aria-invalid={invalidFields.includes('section') || undefined}
                    autoComplete="off"
                    className="mx-control"
                    name="section"
                    placeholder="例如：写作"
                    value={form.section}
                    onChange={(event) => changeField('section', event.target.value)}
                  />
                </div>
                <div className="mx-editor-setting-row">
                  <label htmlFor="post-excerpt">摘要</label>
                  <textarea
                    id="post-excerpt"
                    aria-invalid={invalidFields.includes('excerpt') || undefined}
                    className="mx-control mx-textarea"
                    name="excerpt"
                    placeholder="一句让读者愿意停下来的引言。"
                    rows={3}
                    value={form.excerpt}
                    onChange={(event) => changeField('excerpt', event.target.value)}
                  />
                </div>
                <div className="mx-editor-setting-row">
                  <label htmlFor="post-tags">标签</label>
                  <input
                    id="post-tags"
                    autoComplete="off"
                    className="mx-control"
                    name="tags"
                    placeholder="写作, 网站, 随笔"
                    value={form.tagsText}
                    onChange={(event) => changeField('tagsText', event.target.value)}
                  />
                </div>
              </section>
              <section className="mx-editor-settings-group mx-editor-record-group">
                <div className="mx-editor-drawer-section-title">
                  <span>状态</span>
                  <StatusBadge status={form.status} />
                </div>
                <dl className="mx-records">
                  {metadataRows.map(({ label, value, icon: Icon }) => (
                    <div key={label} className="mx-record">
                      <Icon />
                      <div>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    </div>
                  ))}
                </dl>
              </section>
              {form.status === 'published' ? (
                <div className="mx-editor-publishing-actions">
                  <button
                    className="mx-button is-danger"
                    disabled={saveState === 'saving'}
                    type="button"
                    onClick={() => void unpublish()}
                  >
                    <Undo2Icon />
                    取消发布
                  </button>
                  <p>
                    公开页面会继续显示最近一次发布的版本，直到你发布更新或取消发布。
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </div>

      <dialog
        ref={leaveDialogRef}
        aria-labelledby="leave-editor-title"
        className="mx-leave-dialog"
        onCancel={(event) => {
          event.preventDefault();
          keepEditing();
        }}
      >
        <p className="mx-leave-dialog-kicker">草稿尚未同步</p>
        <h2 id="leave-editor-title">要离开这篇文章吗？</h2>
        <p>当前内容仍在此页面，离开后将不会保留未同步的修改。</p>
        <div className="mx-leave-dialog-actions">
          <button
            autoFocus
            className="mx-button is-secondary"
            type="button"
            onClick={keepEditing}
          >
            继续编辑
          </button>
          <button
            className="mx-button is-danger"
            type="button"
            onClick={discardChanges}
          >
            离开并放弃更改
          </button>
        </div>
      </dialog>
    </PageFrame>
  );

  function keepEditing() {
    leaveDialogRef.current?.close();
    if (blocker.state === 'blocked') blocker.reset();
  }

  function discardChanges() {
    leaveDialogRef.current?.close();
    if (blocker.state === 'blocked') {
      mutationEffectsEnabledRef.current = false;
      saveOperationRef.current += 1;
      saveControllerRef.current?.abort();
      blocker.proceed();
    }
  }
}

function extractDocumentText(document: RichDocument): string {
  const values: string[] = [];
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    if ('text' in value && typeof value.text === 'string') values.push(value.text);
    if ('children' in value && Array.isArray(value.children)) {
      for (const child of value.children) visit(child);
      if ('type' in value && value.type !== 'root') values.push('\n');
    }
  }
  visit(document.root);
  return values
    .join('')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function AiWritingPanel({
  currentDocument,
  currentText,
  onAcceptDocument,
  postId,
}: {
  currentDocument: RichDocument;
  currentText: string;
  onAcceptDocument: (document: RichDocument) => void;
  postId?: string;
}) {
  const session = getSession();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [message, setMessage] = useState('');
  const [stream, setStream] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [proposal, setProposal] = useState<AiDocumentProposal>();
  const [deciding, setDeciding] = useState(false);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const currentDocumentRef = useRef(currentDocument);
  currentDocumentRef.current = currentDocument;

  const sessionsQuery = useQuery({
    queryKey: ['ai-sessions', postId],
    queryFn: () => core.listAiSessions(session!.accessToken, postId!),
    enabled: Boolean(session && postId),
  });
  const providersQuery = useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => core.listAiProviders(session!.accessToken),
    enabled: Boolean(session),
    retry: false,
  });
  const sessionQuery = useQuery({
    queryKey: ['ai-session', selectedId],
    queryFn: () => core.getAiSession(session!.accessToken, selectedId!),
    enabled: Boolean(session && selectedId),
  });

  useEffect(() => {
    if (!selectedId && sessionsQuery.data?.[0]) setSelectedId(sessionsQuery.data[0].id);
  }, [selectedId, sessionsQuery.data]);

  useEffect(() => {
    const providers = providersQuery.data;
    if (!providers) return;
    if (selectedId && sessionQuery.data?.id !== selectedId) return;
    const sessionProviderId = sessionQuery.data?.providerProfileId;
    const fallbackId =
      providers.find((provider) => provider.isEnvironment)?.id ??
      providers[0]?.id ??
      '';
    setSelectedProviderId(
      sessionProviderId &&
        providers.some((provider) => provider.id === sessionProviderId)
        ? sessionProviderId
        : fallbackId,
    );
  }, [selectedId, providersQuery.data, sessionQuery.data]);

  useEffect(() => {
    const pending = sessionQuery.data?.toolDecisions
      .filter(
        (decision) =>
          decision.toolName === 'replace-document' &&
          decision.decision === 'pending' &&
          decision.payload.kind === 'replace-document',
      )
      .at(-1);
    setProposal(pending);
  }, [selectedId, sessionQuery.data]);

  async function newSession() {
    if (!postId || !session || !selectedProviderId) return;
    try {
      const created = await core.createAiSession(session.accessToken, postId, {
        providerProfileId: selectedProviderId,
      });
      setSelectedId(created.id);
      await queryClient.invalidateQueries({ queryKey: ['ai-sessions', postId] });
    } catch (cause) {
      setError(messageForError(cause));
    }
  }

  async function send() {
    const prompt = message.trim();
    if (
      !prompt ||
      !session ||
      !postId ||
      !selectedProviderId ||
      (selectedId && sessionQuery.data?.id !== selectedId)
    )
      return;
    const sourceDocument = currentDocument;
    const sourceText = currentText;
    let targetId = selectedId;
    try {
      if (!targetId) {
        const created = await core.createAiSession(session.accessToken, postId, {
          title: prompt.slice(0, 28),
          providerProfileId: selectedProviderId,
        });
        targetId = created.id;
        setSelectedId(created.id);
      }
      setMessage('');
      setStream('');
      setError(undefined);
      setProposal(undefined);
      setRunning(true);
      const controller = new AbortController();
      controllerRef.current = controller;
      let accumulated = '';
      let runId = '';
      for await (const event of core.runAiSession(
        session.accessToken,
        targetId,
        {
          message: [
            '只修改一个连续文本片段，不要改动文章节点结构。',
            '严格返回 JSON：{"before":"逐字摘自当前正文且只出现一次的原文","after":"替换后的文字"}。不要返回解释或 Markdown 围栏。',
            `用户要求：${prompt}`,
            `当前正文：\n${sourceText}`,
          ].join('\n\n'),
          providerProfileId: selectedProviderId,
        },
        controller.signal,
      )) {
        if (event.type === 'meta') runId = event.runId;
        else if (event.type === 'delta') {
          accumulated += event.delta;
          setStream(accumulated);
        } else if (event.type === 'done') runId = event.runId;
        else if (event.type === 'error') setError(event.message);
      }
      if (accumulated.trim() && runId) {
        const proposalResult = createTextScopedProposal(sourceDocument, accumulated);
        if (!proposalResult.ok) {
          setError(proposalResult.reason);
          return;
        }
        const pending = await core.recordAiDocumentProposal(
          session.accessToken,
          targetId,
          {
            runId,
            toolCallId: crypto.randomUUID(),
            toolName: 'replace-document',
            payload: {
              kind: 'replace-document',
              before: sourceDocument,
              after: proposalResult.document,
              summary: prompt,
            },
          },
        );
        setProposal(pending);
      }
      await queryClient.invalidateQueries({ queryKey: ['ai-session', targetId] });
      await queryClient.invalidateQueries({ queryKey: ['ai-sessions', postId] });
    } catch (cause) {
      if (!controllerRef.current?.signal.aborted) setError(messageForError(cause));
    } finally {
      setRunning(false);
      controllerRef.current = undefined;
    }
  }

  async function decide(decision: 'accepted' | 'rejected') {
    if (!proposal || !selectedId || !session) return;
    const application =
      decision === 'accepted'
        ? applyTextScopedProposal(
            currentDocumentRef.current,
            proposal.payload.before,
            proposal.payload.after,
          )
        : undefined;
    if (application && !application.ok) {
      setError(application.reason);
      return;
    }
    setDeciding(true);
    setError(undefined);
    try {
      await core.decideAiTool(session.accessToken, selectedId, proposal.id, decision);
      if (application?.ok) onAcceptDocument(application.document);
      setProposal(undefined);
      setStream('');
      await queryClient.invalidateQueries({ queryKey: ['ai-session', selectedId] });
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setDeciding(false);
    }
  }

  if (!postId) {
    return (
      <div className="mx-ai-empty">
        <SparklesIcon />
        <h3>先写下开头</h3>
        <p>文章第一次自动保存后，就可以围绕当前内容与 AI 协作。</p>
      </div>
    );
  }

  if (providersQuery.isPending) {
    return (
      <div className="mx-ai-empty" aria-busy="true">
        <LoaderCircleIcon className="mx-spin" />
        <h3>正在读取模型连接</h3>
      </div>
    );
  }

  if (providersQuery.error || !providersQuery.data?.length) {
    return (
      <div className="mx-ai-empty">
        <SparklesIcon />
        <h3>先连接 AI 模型</h3>
        <p>
          {providersQuery.error
            ? messageForError(providersQuery.error)
            : '添加一个模型连接后，才能在文章中使用 AI 写作助手。'}
        </p>
        <Link className="mx-button" to="/settings/ai">
          配置 AI 模型
        </Link>
      </div>
    );
  }

  const messages: AiMessage[] = sessionQuery.data?.messages ?? [];
  const providers = providersQuery.data;
  const sessionReady = !selectedId || sessionQuery.data?.id === selectedId;
  const proposalInspection = proposal
    ? inspectTextScopedProposal(proposal.payload.before, proposal.payload.after)
    : undefined;
  return (
    <div className="mx-ai-panel">
      <div className="mx-ai-session-bar">
        <div className="mx-ai-session-tabs" role="tablist" aria-label="AI 会话">
          {sessionsQuery.data?.map((item) => (
            <button
              key={item.id}
              aria-selected={selectedId === item.id}
              className={selectedId === item.id ? 'is-active' : undefined}
              role="tab"
              type="button"
              onClick={() => setSelectedId(item.id)}
            >
              {item.title}
            </button>
          ))}
        </div>
        <label className="mx-ai-provider-select">
          <span className="sr-only">AI 模型连接</span>
          <select
            aria-label="AI 模型连接"
            className="mx-control"
            disabled={running || !sessionReady}
            value={selectedProviderId}
            onChange={(event) => setSelectedProviderId(event.target.value)}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name} · {provider.model}
              </option>
            ))}
          </select>
        </label>
        <button
          aria-label="新建 AI 会话"
          className="mx-editor-drawer-close"
          type="button"
          onClick={() => void newSession()}
        >
          <MessageSquarePlusIcon />
        </button>
      </div>
      <div aria-live="polite" className="mx-ai-messages">
        {!messages.length && !stream ? (
          <div className="mx-ai-intro">
            <p className="mx-page-kicker">当前文章</p>
            <h3>从一次具体修改开始</h3>
            <p>
              例如：整理这一段的逻辑，保持原来的语气。AI
              的结构化修改会先进入审阅，不会直接覆盖正文。
            </p>
          </div>
        ) : null}
        {messages.map((item) => (
          <article key={item.id} className={`mx-ai-message is-${item.role}`}>
            <span>{item.role === 'user' ? '你' : 'AI'}</span>
            <p>{item.content}</p>
          </article>
        ))}
        {stream && !proposal ? (
          <article className="mx-ai-message is-assistant is-streaming">
            <span>AI</span>
            <p>{stream}</p>
          </article>
        ) : null}
        {proposal ? (
          <section aria-label="AI 修改预览" className="mx-ai-diff">
            <header>
              <div>
                <span>待审阅修改</span>
                <strong>{proposal.payload.summary}</strong>
              </div>
              <span>
                新增 {proposalInspection?.addedNodes ?? 0} · 移除{' '}
                {proposalInspection?.removedNodes ?? 0} · 保留{' '}
                {proposalInspection?.preservedNodes ?? 0}
              </span>
            </header>
            {proposalInspection && !proposalInspection.safe ? (
              <FeedbackAlert
                notice={{ kind: 'error', message: proposalInspection.reason }}
              />
            ) : null}
            <div className="mx-ai-diff-copy">
              <div>
                <span>原文片段</span>
                <del>
                  {proposalInspection?.safe
                    ? proposalInspection.beforeText
                    : extractDocumentText(proposal.payload.before) || '空白正文'}
                </del>
              </div>
              <div>
                <span>建议片段</span>
                <ins>
                  {proposalInspection?.safe
                    ? proposalInspection.afterText
                    : extractDocumentText(proposal.payload.after)}
                </ins>
              </div>
            </div>
            <div className="mx-ai-diff-actions">
              <button
                className="mx-button is-secondary"
                disabled={deciding}
                type="button"
                onClick={() => void decide('rejected')}
              >
                拒绝修改
              </button>
              <button
                className="mx-button"
                disabled={deciding || !proposalInspection?.safe}
                type="button"
                onClick={() => void decide('accepted')}
              >
                {deciding
                  ? '正在记录…'
                  : proposalInspection?.safe
                    ? '接受并应用'
                    : '无法安全应用'}
              </button>
            </div>
          </section>
        ) : null}
        {error ? <FeedbackAlert notice={{ kind: 'error', message: error }} /> : null}
      </div>
      <form
        className="mx-ai-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="ai-writing-prompt">
          给 AI 的要求
        </label>
        <textarea
          id="ai-writing-prompt"
          placeholder="描述你想如何修改当前文章…"
          rows={3}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (!running) void send();
            }
          }}
        />
        <div>
          <span>Enter 发送 · Shift + Enter 换行</span>
          {running ? (
            <button
              aria-label="停止生成"
              className="mx-ai-send"
              type="button"
              onClick={() => controllerRef.current?.abort()}
            >
              <StopCircleIcon />
            </button>
          ) : (
            <button
              aria-label="发送给 AI"
              className="mx-ai-send"
              disabled={!message.trim() || !selectedProviderId || !sessionReady}
              type="submit"
            >
              <SendIcon />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="mx-editor-skeleton" aria-busy="true">
      <div className="mx-editor-skeleton-main">
        <span className="mx-skeleton mx-skeleton-title" />
        <span className="mx-skeleton mx-skeleton-slug" />
        <span className="mx-skeleton mx-skeleton-markdown" />
      </div>
    </div>
  );
}
