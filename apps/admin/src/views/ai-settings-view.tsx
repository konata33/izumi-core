import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BotIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  PlusIcon,
  SaveIcon,
  ServerIcon,
  Trash2Icon,
  WifiIcon,
} from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';

import { FeedbackAlert, type Notice } from '@/components/feedback-alert';
import { HeaderAction } from '@/components/header-action';
import { SettingsRow, SettingsSection } from '@/components/settings-layout';
import {
  core,
  CoreRequestError,
  type AiProviderInput,
  type AiProviderProfile,
  type AiProviderType,
} from '@/lib/core';
import { messageForError } from '@/lib/errors';
import { clearSession, getSession } from '@/lib/session';

type ProviderForm = {
  name: string;
  providerType: AiProviderType;
  baseUrl: string;
  model: string;
  apiKey: string;
};

const providerTypes: ReadonlyArray<readonly [AiProviderType, string]> = [
  ['claude', 'Claude'],
  ['openai-compatible', 'OpenAI-compatible'],
];

function blankProvider(): ProviderForm {
  return {
    name: '',
    providerType: 'claude',
    baseUrl: '',
    model: '',
    apiKey: '',
  };
}

function profileToForm(profile: AiProviderProfile): ProviderForm {
  return {
    name: profile.name,
    providerType: profile.providerType,
    baseUrl: profile.baseUrl ?? '',
    model: profile.model,
    apiKey: '',
  };
}

export function AiSettingsView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = getSession();
  const [selectedId, setSelectedId] = useState<string>('new');
  const [form, setForm] = useState<ProviderForm>(blankProvider);
  const [notice, setNotice] = useState<Notice>();

  const providersQuery = useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => core.listAiProviders(session!.accessToken),
    enabled: Boolean(session),
    retry: false,
  });

  const selected = useMemo(
    () => providersQuery.data?.find((profile) => profile.id === selectedId),
    [providersQuery.data, selectedId],
  );
  const isEnvironment = Boolean(selected?.isEnvironment);
  const isReadOnly = Boolean(selected?.readOnly);

  useEffect(() => {
    if (
      providersQuery.error instanceof CoreRequestError &&
      providersQuery.error.status === 401
    ) {
      clearSession();
      navigate('/auth', { replace: true });
    }
  }, [navigate, providersQuery.error]);

  useEffect(() => {
    if (selected) setForm(profileToForm(selected));
    else if (selectedId === 'new') setForm(blankProvider());
  }, [selected, selectedId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input: AiProviderInput = {
        name: form.name.trim(),
        providerType: form.providerType,
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      };
      return selected
        ? core.updateAiProvider(session!.accessToken, selected.id, input)
        : core.createAiProvider(session!.accessToken, input);
    },
    onSuccess: async (profile) => {
      setSelectedId(profile.id);
      setNotice({ kind: 'success', message: '模型配置已保存。' });
      await queryClient.invalidateQueries({ queryKey: ['ai-providers'] });
    },
    onError: (error) => setNotice({ kind: 'error', message: messageForError(error) }),
  });

  const testMutation = useMutation({
    mutationFn: () => core.testAiProvider(session!.accessToken, selected!.id),
    onSuccess: (result) =>
      setNotice({
        kind: result.ok ? 'success' : 'error',
        message: result.ok ? `连接正常 · ${result.latencyMs}ms` : '连接测试未通过。',
      }),
    onError: (error) => setNotice({ kind: 'error', message: messageForError(error) }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => core.deleteAiProvider(session!.accessToken, selected!.id),
    onSuccess: async () => {
      setSelectedId('new');
      setNotice({ kind: 'success', message: '模型配置已删除。' });
      await queryClient.invalidateQueries({ queryKey: ['ai-providers'] });
    },
    onError: (error) => setNotice({ kind: 'error', message: messageForError(error) }),
  });

  const busy =
    saveMutation.isPending || testMutation.isPending || deleteMutation.isPending;
  const canSave =
    !isReadOnly &&
    form.name.trim() &&
    form.baseUrl.trim() &&
    form.model.trim() &&
    (selected || form.apiKey.trim());

  function moveProviderType(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    current: AiProviderType,
  ) {
    const currentIndex = providerTypes.findIndex(([value]) => value === current);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? providerTypes.length - 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? (currentIndex - 1 + providerTypes.length) % providerTypes.length
            : event.key === 'ArrowRight' || event.key === 'ArrowDown'
              ? (currentIndex + 1) % providerTypes.length
              : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const group = event.currentTarget.closest('[role="radiogroup"]');
    const next = providerTypes[nextIndex][0];
    setForm((value) => ({ ...value, providerType: next }));
    requestAnimationFrame(() => {
      const radios = group?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      radios?.[nextIndex]?.focus({ preventScroll: true });
    });
  }

  return (
    <div className="mx-settings-detail mx-ai-settings">
      <header className="mx-settings-detail-header">
        <div className="mx-settings-detail-header-inner">
          <div>
            <p className="mx-page-kicker">协作工具</p>
            <h1 className="mx-settings-detail-title">AI 模型</h1>
          </div>
          {!isReadOnly ? (
            <HeaderAction
              display="label"
              label={saveMutation.isPending ? '正在保存…' : '保存配置'}
              variant="primary"
              disabled={busy || !canSave}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? (
                <LoaderCircleIcon className="mx-spin" />
              ) : (
                <SaveIcon />
              )}
            </HeaderAction>
          ) : null}
        </div>
      </header>

      <div className="mx-settings-detail-body mx-ai-settings-body">
        {notice ? <FeedbackAlert notice={notice} /> : null}
        {providersQuery.error ? (
          <FeedbackAlert
            notice={{ kind: 'error', message: messageForError(providersQuery.error) }}
          />
        ) : null}

        <div className="mx-ai-settings-layout">
          <aside aria-label="模型配置" className="mx-ai-profile-list">
            <div className="mx-ai-profile-list-heading">
              <span>连接</span>
              <span>{providersQuery.data?.length ?? 0}</span>
            </div>
            {providersQuery.isPending ? (
              <div className="mx-ai-profile-loading" aria-busy="true">
                正在读取配置…
              </div>
            ) : (
              providersQuery.data?.map((profile) => (
                <button
                  key={profile.id}
                  aria-current={selectedId === profile.id ? 'page' : undefined}
                  className={`mx-ai-profile-row${selectedId === profile.id ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => setSelectedId(profile.id)}
                >
                  {profile.isEnvironment ? <ServerIcon /> : <KeyRoundIcon />}
                  <span>
                    <strong>{profile.name}</strong>
                    <small>{profile.model}</small>
                  </span>
                </button>
              ))
            )}
            <button
              aria-current={selectedId === 'new' ? 'page' : undefined}
              className={`mx-ai-profile-row is-create${selectedId === 'new' ? ' is-active' : ''}`}
              type="button"
              onClick={() => setSelectedId('new')}
            >
              <PlusIcon />
              <span>
                <strong>添加连接</strong>
                <small>使用自己的 API key</small>
              </span>
            </button>
          </aside>

          <main className="mx-ai-profile-detail">
            <div className="mx-ai-profile-heading">
              <div aria-hidden="true" className="mx-ai-profile-symbol">
                {isEnvironment ? <ServerIcon /> : <BotIcon />}
              </div>
              <div>
                <p className="mx-page-kicker">
                  {isEnvironment ? '环境提供' : selected ? '个人连接' : '新的连接'}
                </p>
                <h2>{selected?.name || '连接一个模型'}</h2>
                <p>
                  {isEnvironment
                    ? '由部署环境管理，只能查看和测试。'
                    : '密钥只会发送给 Core，并以加密形式保存。'}
                </p>
              </div>
            </div>

            <form
              className="mx-settings-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (canSave && !busy) saveMutation.mutate();
              }}
            >
              <SettingsSection icon={<BotIcon />} title="模型">
                <SettingsRow htmlFor="ai-profile-name" label="配置名称">
                  <input
                    id="ai-profile-name"
                    className="mx-control"
                    disabled={isReadOnly}
                    placeholder="例如：写作助手"
                    value={form.name}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </SettingsRow>
                <SettingsRow label="服务类型">
                  <div
                    aria-label="服务类型"
                    className="mx-provider-type"
                    role="radiogroup"
                  >
                    {providerTypes.map(([value, label]) => (
                      <button
                        key={value}
                        aria-checked={form.providerType === value}
                        className={
                          form.providerType === value ? 'is-selected' : undefined
                        }
                        disabled={isReadOnly}
                        role="radio"
                        tabIndex={form.providerType === value ? 0 : -1}
                        type="button"
                        onClick={() =>
                          setForm((current) => ({ ...current, providerType: value }))
                        }
                        onKeyDown={(event) => moveProviderType(event, value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </SettingsRow>
                <SettingsRow htmlFor="ai-model" label="模型">
                  <input
                    id="ai-model"
                    className="mx-control"
                    disabled={isReadOnly}
                    placeholder="例如：claude-sonnet-4-5"
                    value={form.model}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, model: event.target.value }))
                    }
                  />
                </SettingsRow>
                <SettingsRow htmlFor="ai-base-url" label="API 地址">
                  <input
                    id="ai-base-url"
                    className="mx-control"
                    disabled={isReadOnly}
                    inputMode="url"
                    placeholder={
                      form.providerType === 'claude'
                        ? 'https://api.anthropic.com'
                        : 'https://api.example.com/v1'
                    }
                    value={form.baseUrl}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        baseUrl: event.target.value,
                      }))
                    }
                  />
                </SettingsRow>
              </SettingsSection>

              <SettingsSection icon={<KeyRoundIcon />} title="凭据">
                <SettingsRow htmlFor="ai-api-key" label="API key">
                  <input
                    id="ai-api-key"
                    autoComplete="off"
                    className="mx-control"
                    disabled={isReadOnly}
                    placeholder={selected?.maskedApiKey || '只在保存时写入'}
                    type="password"
                    value={form.apiKey}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, apiKey: event.target.value }))
                    }
                  />
                </SettingsRow>
              </SettingsSection>

              {selected ? (
                <div className="mx-ai-profile-actions">
                  <button
                    className="mx-button is-secondary"
                    disabled={busy}
                    type="button"
                    onClick={() => testMutation.mutate()}
                  >
                    {testMutation.isPending ? (
                      <LoaderCircleIcon className="mx-spin" />
                    ) : (
                      <WifiIcon />
                    )}
                    测试连接
                  </button>
                  {!isReadOnly ? (
                    <button
                      className="mx-button is-danger"
                      disabled={busy}
                      type="button"
                      onClick={() => deleteMutation.mutate()}
                    >
                      <Trash2Icon />
                      删除配置
                    </button>
                  ) : null}
                </div>
              ) : null}
            </form>
          </main>
        </div>
      </div>
    </div>
  );
}
