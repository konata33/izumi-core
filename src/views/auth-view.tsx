import { ArrowRightIcon, KeyRoundIcon, LoaderCircleIcon, LockKeyholeIcon, ShieldCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { FeedbackAlert, type Notice } from '@/components/feedback-alert';
import { core, CoreRequestError } from '@/lib/core';
import { messageForError } from '@/lib/errors';
import { saveSession } from '@/lib/session';

type Mode = 'login' | 'setup';

export function AuthView() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();

  function chooseMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setSetupToken('');
    setNotice(undefined);
  }

  function validate(): string | undefined {
    if (!email.trim()) return '请输入管理员邮箱。';
    if (!password) return '请输入密码。';
    if (password.length < 12) return '密码至少需要 12 个字符。';
    if (mode === 'setup' && !setupToken.trim()) return '请输入初始化令牌。';
    return undefined;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationMessage = validate();
    if (validationMessage) {
      setNotice({ kind: 'error', message: validationMessage });
      return;
    }

    setBusy(true);
    setNotice(undefined);
    try {
      const token = mode === 'login'
        ? await core.login({ email: email.trim(), password })
        : await core.setupOwner({ email: email.trim(), password }, setupToken.trim());

      saveSession(token);
      navigate('/posts', { replace: true });
    } catch (error) {
      if (error instanceof CoreRequestError && error.code === 'OWNER_ALREADY_CONFIGURED') setMode('login');
      setNotice({ kind: 'error', message: messageForError(error) });
    } finally {
      // Bootstrap credentials are only ever held for this request.
      setSetupToken('');
      setBusy(false);
    }
  }

  const isSetup = mode === 'setup';

  return (
    <main className="mx-auth">
      <aside className="mx-auth-aside" aria-label="Izumi 管理后台">
        <div className="mx-auth-mark">
          <span className="mx-auth-mark-symbol">IZ</span>
          Izumi
        </div>
        <h1 className="mx-auth-aside-title">内容管理</h1>
        <p className="mx-auth-aside-note">仅限管理员访问</p>
      </aside>

      <section className="mx-auth-content" aria-labelledby="auth-title">
        <div className="mx-auth-panel">
          <h2 id="auth-title" className="mx-auth-heading">{isSetup ? '首次初始化' : '登录'}</h2>
          <p className="mx-auth-subheading">{isSetup ? '创建管理员账户' : '使用管理员账户继续'}</p>

          <div aria-label="账户操作" className="mx-segmented" role="tablist">
            <button aria-selected={!isSetup} className={`mx-segmented-button${!isSetup ? ' is-active' : ''}`} role="tab" type="button" onClick={() => chooseMode('login')}>登录</button>
            <button aria-selected={isSetup} className={`mx-segmented-button${isSetup ? ' is-active' : ''}`} role="tab" type="button" onClick={() => chooseMode('setup')}>首次初始化</button>
          </div>

          <form className="mx-auth-form" noValidate onSubmit={submit}>
            {notice ? <FeedbackAlert notice={notice} /> : null}

            <div className="mx-field">
              <label className="mx-label" htmlFor="owner-email">管理员邮箱</label>
              <input id="owner-email" autoComplete="email" className="mx-control" inputMode="email" name="email" placeholder="you@example.com" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>

            <div className="mx-field">
              <label className="mx-label" htmlFor="owner-password">密码</label>
              <input id="owner-password" autoComplete={isSetup ? 'new-password' : 'current-password'} className="mx-control" minLength={12} name="password" placeholder="至少 12 个字符" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>

            {isSetup ? (
              <div className="mx-field">
                <label className="mx-label" htmlFor="owner-setup-token">初始化令牌</label>
                <input id="owner-setup-token" autoComplete="off" className="mx-control" name="setup-token" placeholder="粘贴 OWNER_SETUP_TOKEN" required spellCheck={false} type="password" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} />
                <p className="mx-help"><ShieldCheckIcon /> 仅用于当前请求，不会写入浏览器存储。</p>
              </div>
            ) : null}

            <button className="mx-button is-block" disabled={busy} type="submit">
              {busy ? <LoaderCircleIcon className="mx-spin" /> : isSetup ? <KeyRoundIcon /> : <LockKeyholeIcon />}
              {busy ? (isSetup ? '正在初始化…' : '正在登录…') : isSetup ? '创建管理员' : '登录'}
              {!busy ? <ArrowRightIcon /> : null}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
