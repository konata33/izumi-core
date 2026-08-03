import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CloudIcon,
  HardDriveIcon,
  LoaderCircleIcon,
  SaveIcon,
  ShieldCheckIcon,
  WifiIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { FeedbackAlert, type Notice } from '@/components/feedback-alert';
import { HeaderAction } from '@/components/header-action';
import { SettingsRow, SettingsSection } from '@/components/settings-layout';
import {
  core,
  CoreRequestError,
  type StorageMode,
  type StorageSettings,
  type StorageSettingsInput,
} from '@/lib/core';
import { messageForError } from '@/lib/errors';
import { clearSession, getSession } from '@/lib/session';

type StorageForm = {
  mode: StorageMode;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  forcePathStyle: boolean;
};

const blankForm: StorageForm = {
  mode: 'local',
  endpoint: '',
  region: 'auto',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  publicBaseUrl: '',
  forcePathStyle: false,
};

function settingsToForm(settings: StorageSettings): StorageForm {
  return {
    mode: settings.mode,
    endpoint: settings.endpoint ?? '',
    region: settings.region ?? 'auto',
    bucket: settings.bucket ?? '',
    accessKeyId: settings.accessKeyId ?? '',
    secretAccessKey: '',
    publicBaseUrl: settings.publicBaseUrl ?? '',
    forcePathStyle: settings.forcePathStyle,
  };
}

export function StorageSettingsView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = getSession();
  const [form, setForm] = useState<StorageForm>(blankForm);
  const [notice, setNotice] = useState<Notice>();

  const settingsQuery = useQuery({
    queryKey: ['storage-settings'],
    queryFn: () => core.getStorageSettings(session!.accessToken),
    enabled: Boolean(session),
    retry: false,
  });

  useEffect(() => {
    if (settingsQuery.data) setForm(settingsToForm(settingsQuery.data));
  }, [settingsQuery.data]);

  useEffect(() => {
    if (
      settingsQuery.error instanceof CoreRequestError &&
      settingsQuery.error.status === 401
    ) {
      clearSession();
      navigate('/auth', { replace: true });
    }
  }, [navigate, settingsQuery.error]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input: StorageSettingsInput =
        form.mode === 'local'
          ? { mode: 'local' }
          : {
              mode: 's3',
              endpoint: form.endpoint.trim(),
              region: form.region.trim(),
              bucket: form.bucket.trim(),
              accessKeyId: form.accessKeyId.trim(),
              publicBaseUrl: form.publicBaseUrl.trim(),
              forcePathStyle: form.forcePathStyle,
              ...(form.secretAccessKey.trim()
                ? { secretAccessKey: form.secretAccessKey.trim() }
                : {}),
            };
      return core.updateStorageSettings(session!.accessToken, input);
    },
    onSuccess: async (settings) => {
      setForm(settingsToForm(settings));
      setNotice({ kind: 'success', message: '存储配置已保存。' });
      await queryClient.invalidateQueries({ queryKey: ['storage-settings'] });
    },
    onError: (error) => setNotice({ kind: 'error', message: messageForError(error) }),
  });

  const testMutation = useMutation({
    mutationFn: () => core.testStorageSettings(session!.accessToken),
    onSuccess: (result) =>
      setNotice({
        kind: 'success',
        message: `${result.mode === 'local' ? '本地目录' : 'S3'} 读写正常 · ${result.latencyMs}ms`,
      }),
    onError: (error) => setNotice({ kind: 'error', message: messageForError(error) }),
  });

  const busy = saveMutation.isPending || testMutation.isPending;
  const hasSavedSecret = Boolean(settingsQuery.data?.secretAccessKeyMasked);
  const canSave =
    form.mode === 'local' ||
    Boolean(
      form.endpoint.trim() &&
      form.region.trim() &&
      form.bucket.trim() &&
      form.accessKeyId.trim() &&
      form.publicBaseUrl.trim() &&
      (form.secretAccessKey.trim() || hasSavedSecret),
    );

  return (
    <div className="mx-settings-detail">
      <header className="mx-settings-detail-header">
        <div className="mx-settings-detail-header-inner">
          <div>
            <p className="mx-page-kicker">基础设施</p>
            <h1 className="mx-settings-detail-title">对象存储</h1>
          </div>
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
        </div>
      </header>

      <div className="mx-settings-detail-body">
        {notice ? <FeedbackAlert notice={notice} /> : null}
        {settingsQuery.error ? (
          <FeedbackAlert
            notice={{ kind: 'error', message: messageForError(settingsQuery.error) }}
          />
        ) : null}

        <form
          className="mx-settings-form mx-storage-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && canSave) saveMutation.mutate();
          }}
        >
          <SettingsSection icon={<HardDriveIcon />} title="存储方式">
            <SettingsRow label="存储模式">
              <fieldset className="mx-storage-mode">
                <legend className="sr-only">存储模式</legend>
                <label>
                  <input
                    checked={form.mode === 'local'}
                    name="storage-mode"
                    type="radio"
                    value="local"
                    onChange={() =>
                      setForm((current) => ({ ...current, mode: 'local' }))
                    }
                  />
                  <HardDriveIcon aria-hidden="true" />
                  本地存储
                </label>
                <label>
                  <input
                    checked={form.mode === 's3'}
                    name="storage-mode"
                    type="radio"
                    value="s3"
                    onChange={() => setForm((current) => ({ ...current, mode: 's3' }))}
                  />
                  <CloudIcon aria-hidden="true" />
                  S3 / R2
                </label>
              </fieldset>
            </SettingsRow>
            <SettingsRow label="当前地址">
              <p className="mx-storage-value">
                {form.mode === 'local'
                  ? settingsQuery.data?.localPublicBaseUrl || '由 Core 提供公开地址'
                  : form.publicBaseUrl || '保存后由对象存储提供公开地址'}
              </p>
            </SettingsRow>
          </SettingsSection>

          {form.mode === 's3' ? (
            <SettingsSection icon={<CloudIcon />} title="S3 / Cloudflare R2">
              <SettingsRow htmlFor="storage-endpoint" label="Endpoint">
                <input
                  id="storage-endpoint"
                  className="mx-control"
                  inputMode="url"
                  placeholder="https://<account-id>.r2.cloudflarestorage.com"
                  required
                  type="url"
                  value={form.endpoint}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      endpoint: event.target.value,
                    }))
                  }
                />
              </SettingsRow>
              <SettingsRow htmlFor="storage-region" label="Region">
                <input
                  id="storage-region"
                  className="mx-control"
                  required
                  value={form.region}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      region: event.target.value,
                    }))
                  }
                />
              </SettingsRow>
              <SettingsRow htmlFor="storage-bucket" label="Bucket">
                <input
                  id="storage-bucket"
                  className="mx-control"
                  required
                  value={form.bucket}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      bucket: event.target.value,
                    }))
                  }
                />
              </SettingsRow>
              <SettingsRow htmlFor="storage-access-key" label="Access Key ID">
                <input
                  id="storage-access-key"
                  autoComplete="off"
                  className="mx-control"
                  required
                  value={form.accessKeyId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      accessKeyId: event.target.value,
                    }))
                  }
                />
              </SettingsRow>
              <SettingsRow htmlFor="storage-secret-key" label="Secret Access Key">
                <input
                  id="storage-secret-key"
                  autoComplete="new-password"
                  className="mx-control"
                  placeholder={
                    settingsQuery.data?.secretAccessKeyMasked
                      ? `${settingsQuery.data.secretAccessKeyMasked}（留空保持不变）`
                      : '首次配置时必填'
                  }
                  required={!hasSavedSecret}
                  type="password"
                  value={form.secretAccessKey}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      secretAccessKey: event.target.value,
                    }))
                  }
                />
              </SettingsRow>
              <SettingsRow htmlFor="storage-public-url" label="公开地址">
                <input
                  id="storage-public-url"
                  className="mx-control"
                  inputMode="url"
                  placeholder="https://media.example.com"
                  required
                  type="url"
                  value={form.publicBaseUrl}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      publicBaseUrl: event.target.value,
                    }))
                  }
                />
              </SettingsRow>
              <SettingsRow label="兼容模式">
                <label className="mx-switch-row">
                  <input
                    checked={form.forcePathStyle}
                    type="checkbox"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        forcePathStyle: event.target.checked,
                      }))
                    }
                  />
                  使用 path-style URL（R2 通常无需开启）
                </label>
              </SettingsRow>
            </SettingsSection>
          ) : null}

          <SettingsSection icon={<ShieldCheckIcon />} title="连接检查">
            <SettingsRow label="已保存配置">
              <div className="mx-storage-test">
                <button
                  className="mx-button is-secondary"
                  disabled={busy || settingsQuery.isPending}
                  type="button"
                  onClick={() => testMutation.mutate()}
                >
                  {testMutation.isPending ? (
                    <LoaderCircleIcon className="mx-spin" />
                  ) : (
                    <WifiIcon />
                  )}
                  {testMutation.isPending ? '正在测试…' : '测试读写连接'}
                </button>
                <small>测试会写入并立即删除一个空探针对象。</small>
              </div>
            </SettingsRow>
          </SettingsSection>
        </form>
      </div>
    </div>
  );
}
