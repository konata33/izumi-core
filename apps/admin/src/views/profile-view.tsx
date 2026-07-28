import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Link2Icon,
  LoaderCircleIcon,
  PencilLineIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
  UserRoundIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { siGithub, siX, type SimpleIcon } from 'simple-icons/icons';

import { FeedbackAlert, type Notice } from '@/components/feedback-alert';
import { HeaderAction } from '@/components/header-action';
import { SettingsRow, SettingsSection } from '@/components/settings-layout';
import { core, CoreRequestError, type OwnerProfile, type ReplaceProfileInput } from '@/lib/core';
import { messageForError } from '@/lib/errors';
import { clearSession, getSession } from '@/lib/session';

type LinkKind = ReplaceProfileInput['links'][number]['kind'];
type ProfileLink = { kind: LinkKind; url: string };
type ProfileField = 'displayName' | 'headline' | 'bio' | 'avatarUrl' | 'githubUrl' | 'xUrl';

type ProfileForm = {
  displayName: string;
  headline: string;
  bio: string;
  avatarUrl: string;
  selectedLinkKinds: LinkKind[];
  links: Record<LinkKind, string>;
};

const linkOptions = [
  { kind: 'github' as const, label: 'GitHub', placeholder: 'https://github.com/your-name', brand: siGithub, field: 'githubUrl' as const },
  { kind: 'x' as const, label: 'X', placeholder: 'https://x.com/your-name', brand: siX, field: 'xUrl' as const },
];

function blankForm(): ProfileForm {
  return { displayName: '', headline: '', bio: '', avatarUrl: '', selectedLinkKinds: [], links: { github: '', x: '' } };
}

function toForm(profile: OwnerProfile): ProfileForm {
  return {
    displayName: profile.displayName,
    headline: profile.headline,
    bio: profile.bio,
    avatarUrl: profile.avatar.url,
    selectedLinkKinds: profile.links.map((link: ProfileLink) => link.kind),
    links: {
      github: profile.links.find((link: ProfileLink) => link.kind === 'github')?.url ?? '',
      x: profile.links.find((link: ProfileLink) => link.kind === 'x')?.url ?? '',
    },
  };
}

function isPlainText(value: string) { const trimmed = value.trim(); return Boolean(trimmed) && !/[<>]/.test(trimmed); }
function isLoopbackHost(hostname: string) { return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'; }
function hasAllowedAvatarUrl(value: string) {
  try { const url = new URL(value.trim()); return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname)); } catch { return false; }
}
function hasHttpsUrl(value: string) { try { return new URL(value.trim()).protocol === 'https:'; } catch { return false; } }
function avatarAltFor(displayName: string) { return `${displayName.trim() || '个人'} 的头像`; }
function initials(value: string) { return value.trim().slice(0, 2).toLocaleUpperCase() || 'IZ'; }
function compactLink(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

function BrandIcon({ icon }: { icon: SimpleIcon }) {
  return <svg aria-hidden="true" className="mx-brand-icon" viewBox="0 0 24 24"><path d={icon.path} /></svg>;
}

export function ProfileView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = getSession();
  const [form, setForm] = useState<ProfileForm>(blankForm);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [invalidFields, setInvalidFields] = useState<ProfileField[]>([]);
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [linkToFocus, setLinkToFocus] = useState<LinkKind>();
  const [editingLinkKinds, setEditingLinkKinds] = useState<LinkKind[]>([]);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const linkInputRefs = useRef<Partial<Record<LinkKind, HTMLInputElement>>>({});
  const savedAvatarUrlRef = useRef('');
  const savedLinksRef = useRef<Record<LinkKind, string>>({ github: '', x: '' });

  const profileQuery = useQuery({ queryKey: ['owner-profile'], queryFn: () => core.getOwnerProfile(session!.accessToken), retry: false });
  const profileMissing = profileQuery.error instanceof CoreRequestError && profileQuery.error.code === 'PROFILE_NOT_CONFIGURED';
  const loadError = profileQuery.error && !profileMissing ? messageForError(profileQuery.error) : undefined;

  useEffect(() => {
    if (!profileQuery.data) return;
    const nextForm = toForm(profileQuery.data);
    setForm(nextForm);
    savedAvatarUrlRef.current = nextForm.avatarUrl;
    setEditingAvatar(false);
    savedLinksRef.current = nextForm.links;
    setEditingLinkKinds([]);
    setInvalidFields([]);
  }, [profileQuery.data]);

  useEffect(() => {
    if (profileQuery.error instanceof CoreRequestError && profileQuery.error.status === 401) {
      clearSession();
      navigate('/auth', { replace: true });
    }
  }, [navigate, profileQuery.error]);

  useEffect(() => {
    if (editingAvatar) avatarInputRef.current?.focus();
  }, [editingAvatar]);

  useEffect(() => {
    if (!linkToFocus || !form.selectedLinkKinds.includes(linkToFocus)) return;
    linkInputRefs.current[linkToFocus]?.focus();
    setLinkToFocus(undefined);
  }, [form.selectedLinkKinds, linkToFocus]);

  function changeField(field: ProfileField, value: string) {
    setForm((current) => {
      if (field === 'githubUrl') return { ...current, links: { ...current.links, github: value } };
      if (field === 'xUrl') return { ...current, links: { ...current.links, x: value } };
      return { ...current, [field]: value };
    });
    setInvalidFields((current) => current.filter((name) => name !== field));
  }

  function openLinkEditor(kind: LinkKind) {
    setForm((current) => current.selectedLinkKinds.includes(kind)
      ? current
      : { ...current, selectedLinkKinds: [...current.selectedLinkKinds, kind] });
    setEditingLinkKinds((current) => current.includes(kind) ? current : [...current, kind]);
    setLinkToFocus(kind);
    setInvalidFields((current) => current.filter((field) => field !== 'githubUrl' && field !== 'xUrl'));
  }

  function openAvatarEditor() {
    setEditingAvatar(true);
    setInvalidFields((current) => current.filter((field) => field !== 'avatarUrl'));
  }

  function cancelAvatarEdit() {
    setForm((current) => ({ ...current, avatarUrl: savedAvatarUrlRef.current }));
    setEditingAvatar(false);
    setInvalidFields((current) => current.filter((field) => field !== 'avatarUrl'));
  }

  function cancelLinkEdit(kind: LinkKind) {
    const savedUrl = savedLinksRef.current[kind];
    setForm((current) => ({
      ...current,
      links: { ...current.links, [kind]: savedUrl },
      selectedLinkKinds: savedUrl
        ? current.selectedLinkKinds.includes(kind) ? current.selectedLinkKinds : [...current.selectedLinkKinds, kind]
        : current.selectedLinkKinds.filter((value) => value !== kind),
    }));
    setEditingLinkKinds((current) => current.filter((value) => value !== kind));
    setInvalidFields((current) => current.filter((field) => field !== 'githubUrl' && field !== 'xUrl'));
  }

  function removeLink(kind: LinkKind) {
    setForm((current) => ({ ...current, selectedLinkKinds: current.selectedLinkKinds.filter((value) => value !== kind) }));
    setEditingLinkKinds((current) => current.filter((value) => value !== kind));
    setInvalidFields((current) => current.filter((field) => field !== 'githubUrl' && field !== 'xUrl'));
  }

  function validate(): { message: string; fields: ProfileField[] } | undefined {
    const required: Array<[ProfileField, string]> = [['displayName', form.displayName], ['headline', form.headline], ['bio', form.bio], ['avatarUrl', form.avatarUrl]];
    const missing = required.filter(([, value]) => !value.trim()).map(([field]) => field);
    if (missing.length) return { message: '请先填写显示名称、个人标题、个人简介和头像地址。', fields: missing };
    const plainTextFields = required.filter(([field]) => field !== 'avatarUrl').filter(([, value]) => !isPlainText(value)).map(([field]) => field);
    if (plainTextFields.length) return { message: '文字字段不能只包含空白，也不能包含 HTML 括号。', fields: plainTextFields };
    if (!hasAllowedAvatarUrl(form.avatarUrl)) return { message: '头像地址需要是 HTTPS 绝对地址；本地开发时允许 localhost HTTP。', fields: ['avatarUrl'] };
    const invalidLinks = form.selectedLinkKinds.filter((kind) => !hasHttpsUrl(form.links[kind])).map((kind) => (kind === 'github' ? 'githubUrl' : 'xUrl') as ProfileField);
    if (invalidLinks.length) return { message: 'GitHub 与 X 地址必须是 HTTPS 绝对地址。', fields: invalidLinks };
    return undefined;
  }

  async function save() {
    const validation = validate();
    if (validation) {
      setInvalidFields(validation.fields);
      if (validation.fields.includes('avatarUrl')) setEditingAvatar(true);
      setNotice({ kind: 'error', message: validation.message });
      return;
    }
    if (!session) { navigate('/auth', { replace: true }); return; }

    const input: ReplaceProfileInput = {
      displayName: form.displayName.trim(), headline: form.headline.trim(), bio: form.bio.trim(),
      avatar: { url: form.avatarUrl.trim(), alt: avatarAltFor(form.displayName) },
      links: form.selectedLinkKinds.map((kind) => ({ kind, url: form.links[kind].trim() })),
    };
    setSaving(true);
    setNotice({ kind: 'info', message: '正在保存…' });
    try {
      const profile = await core.replaceProfile(session.accessToken, input);
      const nextForm = toForm(profile);
      setForm(nextForm);
      savedAvatarUrlRef.current = nextForm.avatarUrl;
      setEditingAvatar(false);
      savedLinksRef.current = nextForm.links;
      setEditingLinkKinds([]);
      setInvalidFields([]);
      queryClient.setQueryData(['owner-profile'], profile);
      setNotice({ kind: 'success', message: '已保存，公开页将在约一分钟内更新。' });
    } catch (error) {
      if (error instanceof CoreRequestError && error.status === 401) { clearSession(); navigate('/auth', { replace: true }); return; }
      setNotice({ kind: 'error', message: messageForError(error) });
    } finally {
      setSaving(false);
    }
  }

  function isInvalid(field: ProfileField) { return invalidFields.includes(field); }

  return (
    <div className="mx-settings-detail">
      <header className="mx-settings-detail-header">
        <h1 className="mx-settings-detail-title">资料</h1>
        {!profileQuery.isPending && !loadError ? (
          <HeaderAction label="保存资料" disabled={saving} form="profile-editor" type="submit">
            {saving ? <LoaderCircleIcon className="mx-spin" /> : <SaveIcon />}
          </HeaderAction>
        ) : null}
      </header>

      <div className="mx-settings-detail-body">
        {notice ? <div className="mx-profile-notice"><FeedbackAlert notice={notice} /></div> : null}
        {loadError ? <div className="mx-profile-notice"><FeedbackAlert notice={{ kind: 'error', message: loadError }} /></div> : null}
        {profileQuery.isPending ? <ProfileSkeleton /> : null}

        {!profileQuery.isPending && !loadError ? (
          <form id="profile-editor" className="mx-settings-form" noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <SettingsSection icon={<UserRoundIcon />} title="公开资料">
              <SettingsRow htmlFor="profile-display-name" label="显示名称">
                <input id="profile-display-name" aria-invalid={isInvalid('displayName') || undefined} autoComplete="name" className="mx-control" name="display-name" placeholder="例如：Konata" required value={form.displayName} onChange={(event) => changeField('displayName', event.target.value)} />
              </SettingsRow>
              <SettingsRow htmlFor="profile-headline" label="个人标题">
                <input id="profile-headline" aria-invalid={isInvalid('headline') || undefined} className="mx-control" name="headline" placeholder="例如：Hello, I'm Konata." required value={form.headline} onChange={(event) => changeField('headline', event.target.value)} />
              </SettingsRow>
              <SettingsRow htmlFor="profile-bio" label="个人简介">
                <textarea id="profile-bio" aria-invalid={isInvalid('bio') || undefined} className="mx-control mx-textarea" name="bio" placeholder="用一两句话介绍你正在做什么。" required rows={3} value={form.bio} onChange={(event) => changeField('bio', event.target.value)} />
              </SettingsRow>
              <SettingsRow htmlFor={editingAvatar ? 'profile-avatar-url' : undefined} label="头像">
                <div className="mx-avatar-url-control">
                  <span aria-hidden="true" className="mx-profile-avatar">
                    <span>{initials(form.displayName)}</span>
                    {form.avatarUrl ? <img alt="" src={form.avatarUrl} onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : null}
                  </span>
                  {editingAvatar ? (
                    <>
                      <div className="mx-avatar-url-input">
                        <input ref={avatarInputRef} id="profile-avatar-url" aria-describedby={isInvalid('avatarUrl') ? 'profile-avatar-error' : undefined} aria-invalid={isInvalid('avatarUrl') || undefined} className="mx-control" inputMode="url" name="avatar-url" placeholder="https://example.com/avatar.png" required type="url" value={form.avatarUrl} onChange={(event) => changeField('avatarUrl', event.target.value)} />
                        {isInvalid('avatarUrl') ? <p id="profile-avatar-error" className="mx-field-error">请输入 HTTPS 图片地址</p> : null}
                      </div>
                      <button aria-label="取消编辑头像" className="mx-inline-action" type="button" onClick={cancelAvatarEdit}><XIcon />取消</button>
                    </>
                  ) : (
                    <button aria-label={form.avatarUrl ? '更换头像' : '添加头像'} className="mx-inline-action mx-avatar-change" type="button" onClick={openAvatarEditor}>
                      {form.avatarUrl ? <><PencilLineIcon />更换</> : <><PlusIcon />添加头像</>}
                    </button>
                  )}
                </div>
              </SettingsRow>
            </SettingsSection>

            <SettingsSection icon={<Link2Icon />} rowsClassName="mx-social-link-list" title="个人链接">
                {linkOptions.map(({ kind, label, placeholder, brand, field }) => {
                  const configured = form.selectedLinkKinds.includes(kind);
                  const editing = editingLinkKinds.includes(kind);

                  return (
                    <SettingsRow key={kind} className={`mx-social-link-row${configured ? ' is-configured' : ''}${editing ? ' is-editing' : ''}`} label={<span className="mx-social-link-platform"><BrandIcon icon={brand} /><span>{label}</span></span>}>
                      <div aria-label={`${label} 主页链接`} className="mx-social-link-content">
                        {editing ? (
                          <div className="mx-social-link-address">
                            <label className="sr-only" htmlFor={`profile-link-${kind}`}>{label} 链接地址</label>
                            <input
                              ref={(node) => { linkInputRefs.current[kind] = node ?? undefined; }}
                              id={`profile-link-${kind}`}
                              aria-invalid={isInvalid(field) || undefined}
                              className="mx-control mx-social-link-control"
                              inputMode="url"
                              name={`${kind}-url`}
                              placeholder={placeholder}
                              required
                              type="url"
                              value={form.links[kind]}
                              onChange={(event) => changeField(field, event.target.value)}
                            />
                          </div>
                        ) : configured ? (
                          <span className="mx-social-link-value" title={form.links[kind]}>{compactLink(form.links[kind])}</span>
                        ) : null}
                        <div className="mx-social-link-actions">
                          {editing ? (
                            <button aria-label={`取消编辑 ${label} 链接`} className="mx-inline-action" type="button" onClick={() => cancelLinkEdit(kind)}><XIcon />取消</button>
                          ) : configured ? (
                            <>
                              <button aria-label={`编辑 ${label} 链接`} className="mx-inline-action" type="button" onClick={() => openLinkEditor(kind)}><PencilLineIcon />编辑</button>
                              <button aria-label={`移除 ${label} 链接`} className="mx-inline-action is-danger" type="button" onClick={() => removeLink(kind)}><Trash2Icon />移除</button>
                            </>
                          ) : (
                            <button aria-label={`添加 ${label} 链接`} className="mx-inline-action mx-social-link-add" type="button" onClick={() => openLinkEditor(kind)}><PlusIcon />添加链接</button>
                          )}
                        </div>
                      </div>
                    </SettingsRow>
                  );
                })}
            </SettingsSection>
          </form>
        ) : null}

        {loadError ? <div className="mx-profile-retry"><button className="mx-button is-secondary" type="button" onClick={() => void profileQuery.refetch()}><RefreshCwIcon />重新连接</button></div> : null}
      </div>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="mx-profile-skeleton" aria-busy="true">
      <span className="mx-skeleton mx-skeleton-label" />
      <div className="mx-profile-skeleton-main"><span className="mx-skeleton mx-skeleton-field" /><span className="mx-skeleton mx-skeleton-field" /><span className="mx-skeleton mx-skeleton-area" /><span className="mx-skeleton mx-skeleton-field" /></div>
    </div>
  );
}
