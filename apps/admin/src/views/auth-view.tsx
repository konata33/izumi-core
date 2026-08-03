import { ArrowRightIcon, LoaderCircleIcon, UserRoundIcon } from 'lucide-react';
import { AnimatePresence, type Variants, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { FeedbackAlert, type Notice } from '@/components/feedback-alert';
import {
  core,
  CoreRequestError,
  type OwnerAuthStatus,
  type PublicProfile,
} from '@/lib/core';
import { messageForError } from '@/lib/errors';
import { saveSession } from '@/lib/session';

const authEase = [0.22, 1, 0.36, 1] as const;

const revealVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.22, ease: authEase },
  },
};

const stateTransition = { duration: 0.2, ease: authEase };

type Point = {
  x: number;
  y: number;
};

type TwigTone = {
  alpha: number;
  width: number;
};

type TwigPalette = {
  rgb: string;
  stem: TwigTone;
  sprig: TwigTone;
  tip: TwigTone;
};

type BranchKind = keyof Omit<TwigPalette, 'rgb'>;

type BranchState = {
  direction: number;
  point: Point;
  depth: number;
};

type BranchSegment = {
  end: Point;
  kind: BranchKind;
  start: Point;
};

type BranchField = {
  segments: BranchSegment[];
};

type SafeZone = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

type AuthField = 'username' | 'password' | 'setup-token';
type AuthNotice = Notice & { field?: AuthField };

function readCanvasToken(styles: CSSStyleDeclaration, token: string, fallback: number) {
  const value = Number.parseFloat(styles.getPropertyValue(token));
  return Number.isFinite(value) ? value : fallback;
}

function createCanvasSeed() {
  const seed = new Uint32Array(1);
  crypto.getRandomValues(seed);
  return seed[0] || 0x6d2b79f5;
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0;

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function randomBetween(random: () => number, minimum: number, maximum: number) {
  return minimum + (maximum - minimum) * random();
}

function pointInSafeZone(point: Point, safeZone: SafeZone) {
  return (
    point.x >= safeZone.left &&
    point.x <= safeZone.right &&
    point.y >= safeZone.top &&
    point.y <= safeZone.bottom
  );
}

function pointInCanvas(point: Point, width: number, height: number) {
  const bleed = 28;
  return (
    point.x >= -bleed &&
    point.x <= width + bleed &&
    point.y >= -bleed &&
    point.y <= height + bleed
  );
}

function strokeBranchSegment(
  context: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  tone: TwigTone,
  rgb: string,
) {
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = tone.width;
  context.strokeStyle = `rgba(${rgb}, ${tone.alpha})`;
  context.stroke();
}

function createFormSafeZone(width: number, height: number): SafeZone {
  const isMobile = width < 600;
  const safeWidth = isMobile ? Math.max(0, width - 32) : Math.min(width * 0.72, 640);
  const safeHeight = isMobile
    ? Math.min(height * 0.68, 620)
    : Math.min(height * 0.72, 680);
  const guard = 6;

  return {
    left: (width - safeWidth) / 2 - guard,
    right: (width + safeWidth) / 2 + guard,
    top: (height - safeHeight) / 2 - guard,
    bottom: (height + safeHeight) / 2 + guard,
  };
}

function createEdgeBranchRoots(
  random: () => number,
  width: number,
  height: number,
): BranchState[] {
  const edge = 12;
  const randomMiddle = (size: number) =>
    randomBetween(random, size * 0.18, size * 0.82);

  const verticalEdges: BranchState[] = [
    {
      point: { x: randomMiddle(width), y: -edge },
      direction: Math.PI / 2 + randomBetween(random, -0.14, 0.14),
      depth: 0,
    },
    {
      point: { x: randomMiddle(width), y: height + edge },
      direction: -Math.PI / 2 + randomBetween(random, -0.14, 0.14),
      depth: 0,
    },
  ];

  if (width < 600) return verticalEdges;

  return [
    ...verticalEdges,
    {
      point: { x: -edge, y: randomMiddle(height) },
      direction: randomBetween(random, -0.14, 0.14),
      depth: 0,
    },
    {
      point: { x: width + edge, y: randomMiddle(height) },
      direction: Math.PI + randomBetween(random, -0.14, 0.14),
      depth: 0,
    },
  ];
}

function createGeneratedBranchField(
  width: number,
  height: number,
  seed: number,
): BranchField {
  const random = createSeededRandom(seed);
  const safeZone = createFormSafeZone(width, height);
  const isMobile = width < 600;
  const scale = Math.max(0.82, Math.min(Math.min(width / 1440, height / 960), 1.3));
  const maxDepth = Math.round((isMobile ? 48 : 70) * scale);
  const budget = isMobile ? 1_700 : 4_200;
  // This is only a runaway guard; the visual density comes from accumulated
  // generations, never a hand-drawn trunk or a fixed list of strands.
  const frontierLimit = isMobile ? 140 : 360;
  const segments: BranchSegment[] = [];
  let frontier = createEdgeBranchRoots(random, width, height);

  // Random origins enter from the canvas edges. Early generations establish
  // the field; after that, the branching rate settles so short trajectories
  // travel and overlap instead of exploding into a root-shaped tuft.
  while (frontier.length > 0 && segments.length < budget) {
    const next: BranchState[] = [];

    for (const branch of frontier) {
      if (segments.length >= budget || branch.depth >= maxDepth) break;

      const direction = branch.direction + randomBetween(random, -0.06, 0.06);
      const end = {
        x:
          branch.point.x +
          Math.cos(direction) * randomBetween(random, 4.8, 10.8) * scale,
        y:
          branch.point.y +
          Math.sin(direction) * randomBetween(random, 4.8, 10.8) * scale,
      };

      if (pointInSafeZone(end, safeZone) || !pointInCanvas(end, width, height))
        continue;

      const kind: BranchKind =
        branch.depth < maxDepth * 0.28
          ? 'stem'
          : branch.depth < maxDepth * 0.68
            ? 'sprig'
            : 'tip';
      segments.push({ start: branch.point, end, kind });

      const density =
        segments.length < 96 ? 0.93 : segments.length < 1_200 ? 0.54 : 0.43;

      for (const side of [-1, 1]) {
        if (random() >= density || next.length >= frontierLimit) continue;
        next.push({
          point: end,
          direction: direction + side * randomBetween(random, 0.07, 0.25),
          depth: branch.depth + 1,
        });
      }
    }

    frontier = next;
  }

  return { segments };
}

function drawGeneratedBranchField(
  context: CanvasRenderingContext2D,
  field: BranchField,
  palette: TwigPalette,
  progress: number,
) {
  const visibleCount = Math.ceil(field.segments.length * progress);

  for (const segment of field.segments.slice(0, visibleCount)) {
    strokeBranchSegment(
      context,
      segment.start,
      segment.end,
      palette[segment.kind],
      palette.rgb,
    );
  }
}

function drawBranchCanvas(canvas: HTMLCanvasElement, seed: number, progress = 1) {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.floor(bounds.width);
  const height = Math.floor(bounds.height);
  if (!width || !height) return;

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const canvasWidth = Math.floor(width * pixelRatio);
  const canvasHeight = Math.floor(height * pixelRatio);
  if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
  }

  const context = canvas.getContext('2d');
  if (!context) return;

  const styles = getComputedStyle(canvas);
  const palette = {
    rgb: styles.getPropertyValue('--mx-auth-branch-rgb').trim(),
    stem: {
      alpha: readCanvasToken(styles, '--mx-auth-branch-stem-alpha', 0.42),
      width: readCanvasToken(styles, '--mx-auth-branch-stem-width', 1.12),
    },
    sprig: {
      alpha: readCanvasToken(styles, '--mx-auth-branch-sprig-alpha', 0.28),
      width: readCanvasToken(styles, '--mx-auth-branch-sprig-width', 0.72),
    },
    tip: {
      alpha: readCanvasToken(styles, '--mx-auth-branch-tip-alpha', 0.18),
      width: readCanvasToken(styles, '--mx-auth-branch-tip-width', 0.46),
    },
  };

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  drawGeneratedBranchField(
    context,
    createGeneratedBranchField(width, height, seed),
    palette,
    progress,
  );
}

function AuthBranchCanvas({ reduceMotion }: { reduceMotion: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seedRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    seedRef.current ??= createCanvasSeed();

    const draw = () => drawBranchCanvas(canvas, seedRef.current!);
    draw();

    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <m.canvas
      animate={{ opacity: 1 }}
      aria-hidden="true"
      className="mx-auth-backdrop"
      initial={reduceMotion ? false : { opacity: 0 }}
      ref={canvasRef}
      style={{ transformOrigin: 'right center' }}
      transition={{ duration: 0.24, ease: authEase }}
    />
  );
}

function FieldFeedback({
  id,
  notice,
  reduceMotion,
}: {
  id: string;
  notice?: AuthNotice;
  reduceMotion: boolean;
}) {
  return (
    <AnimatePresence initial={!reduceMotion}>
      {notice ? (
        <m.p
          key={notice.message}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          className="mx-auth-field-feedback"
          exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -2 }}
          id={id}
          initial={reduceMotion ? false : { opacity: 0, y: 2 }}
          role="alert"
          transition={{ duration: 0.18, ease: authEase }}
        >
          {notice.message}
        </m.p>
      ) : null}
    </AnimatePresence>
  );
}

export function AuthView() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [authStatus, setAuthStatus] = useState<OwnerAuthStatus>();
  const [statusError, setStatusError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [profile, setProfile] = useState<PublicProfile>();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<AuthNotice>();

  useEffect(() => {
    let active = true;

    setAuthStatus(undefined);
    setStatusError(false);
    setProfile(undefined);
    setAvatarFailed(false);

    void core
      .getOwnerAuthStatus()
      .then(async (nextStatus) => {
        if (!active) return;

        setAuthStatus(nextStatus);
        setUsername(nextStatus.username ?? '');

        if (!nextStatus.initialized) return;

        try {
          const nextProfile = await core.getPublicProfile();
          if (active) setProfile(nextProfile);
        } catch {
          // A public profile is optional. Its absence never blocks login.
        }
      })
      .catch(() => {
        if (active) setStatusError(true);
      });

    return () => {
      active = false;
    };
  }, [reloadKey]);

  function validate(isSetup: boolean): AuthNotice | undefined {
    if (!username.trim())
      return { kind: 'error', field: 'username', message: '请输入用户名。' };
    if (/\s/u.test(username))
      return { kind: 'error', field: 'username', message: '用户名不能包含空格。' };
    if (!password) return { kind: 'error', field: 'password', message: '请输入密码。' };
    if (password.length < 12)
      return { kind: 'error', field: 'password', message: '密码至少 12 个字符。' };
    if (isSetup && !setupToken.trim())
      return { kind: 'error', field: 'setup-token', message: '请输入初始化令牌。' };
    return undefined;
  }

  function clearFieldNotice(field: AuthField) {
    setNotice((current) => (current?.field === field ? undefined : current));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>, isSetup: boolean) {
    event.preventDefault();
    const validationMessage = validate(isSetup);
    if (validationMessage) {
      setNotice(validationMessage);
      return;
    }

    setBusy(true);
    setNotice(undefined);
    try {
      const credentials = { username: username.trim(), password };
      const token = isSetup
        ? await core.setupOwner(credentials, setupToken.trim())
        : await core.login(credentials);

      saveSession(token);
      navigate('/posts', { replace: true });
    } catch (error) {
      if (
        error instanceof CoreRequestError &&
        error.code === 'OWNER_ALREADY_CONFIGURED'
      ) {
        setReloadKey((current) => current + 1);
      }
      const field =
        error instanceof CoreRequestError && error.code === 'INVALID_CREDENTIALS'
          ? 'password'
          : error instanceof CoreRequestError && error.code === 'SETUP_TOKEN_INVALID'
            ? 'setup-token'
            : undefined;
      setNotice({ kind: 'error', field, message: messageForError(error) });
    } finally {
      // Bootstrap credentials are only ever held for this request.
      setSetupToken('');
      setBusy(false);
    }
  }

  const loading = !authStatus && !statusError;
  const isSetup = authStatus ? !authStatus.initialized : false;
  const avatarUrl = !avatarFailed ? profile?.avatar.url : undefined;
  const busyLabel = isSetup ? '正在创建账户' : '正在登录';
  const actionLabel = isSetup ? '创建账户' : '登录';
  const usernameNotice = notice?.field === 'username' ? notice : undefined;
  const passwordNotice = notice?.field === 'password' ? notice : undefined;
  const tokenNotice = notice?.field === 'setup-token' ? notice : undefined;
  const formNotice = notice && !notice.field ? notice : undefined;

  return (
    <main className="mx-auth">
      <AuthBranchCanvas reduceMotion={Boolean(reduceMotion)} />
      <AnimatePresence initial={!reduceMotion} mode="wait">
        {loading ? (
          <m.section
            key="checking"
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            aria-live="polite"
            className="mx-auth-status"
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -8 }}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            transition={stateTransition}
          >
            <span aria-hidden="true" className="mx-auth-status-mark" />
            <p>正在检查配置</p>
          </m.section>
        ) : statusError ? (
          <m.section
            key="status-error"
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            aria-live="polite"
            className="mx-auth-status"
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -8 }}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            transition={stateTransition}
          >
            <FeedbackAlert
              notice={{
                kind: 'error',
                message: '无法读取管理员状态。检查 Core 是否正在运行。',
              }}
            />
            <m.button
              className="mx-auth-retry"
              type="button"
              whileHover={reduceMotion ? undefined : { y: -1 }}
              whileTap={reduceMotion ? undefined : { scale: 0.985 }}
              onClick={() => setReloadKey((current) => current + 1)}
            >
              重新检查
            </m.button>
          </m.section>
        ) : (
          <m.section
            key={isSetup ? 'setup' : 'login'}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            aria-labelledby="auth-title"
            className={`mx-auth-panel is-${isSetup ? 'setup' : 'login'}`}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -8 }}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            transition={stateTransition}
          >
            <m.header
              animate="visible"
              className="mx-auth-heading"
              initial={reduceMotion ? false : 'hidden'}
              variants={revealVariants}
            >
              <h1 id="auth-title">{isSetup ? '开始使用' : '登录'}</h1>
            </m.header>

            <m.div
              animate="visible"
              className="mx-auth-content"
              initial={reduceMotion ? false : 'hidden'}
              variants={revealVariants}
            >
              {!isSetup ? (
                <m.div
                  animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                  aria-hidden="true"
                  className="mx-auth-avatar"
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
                  transition={{ delay: 0.08, duration: 0.2, ease: authEase }}
                >
                  {avatarUrl ? (
                    <img alt="" src={avatarUrl} onError={() => setAvatarFailed(true)} />
                  ) : (
                    <UserRoundIcon />
                  )}
                </m.div>
              ) : null}

              <form
                noValidate
                className="mx-auth-form"
                onSubmit={(event) => submit(event, isSetup)}
              >
                <AnimatePresence initial={!reduceMotion} mode="wait">
                  {formNotice ? (
                    <m.div
                      key={formNotice.message}
                      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                      className="mx-auth-feedback"
                      exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
                      id="auth-feedback"
                      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                      transition={stateTransition}
                    >
                      <FeedbackAlert notice={formNotice} />
                    </m.div>
                  ) : null}
                </AnimatePresence>

                <div className="mx-auth-field-list">
                  <m.div
                    animate="visible"
                    className={`mx-auth-field${isSetup ? '' : ' is-readonly'}${usernameNotice ? ' is-invalid' : ''}`}
                    initial={reduceMotion ? false : 'hidden'}
                    variants={revealVariants}
                  >
                    <label className="sr-only" htmlFor="owner-username">
                      用户名
                    </label>
                    <div className="mx-auth-input-frame">
                      <input
                        id="owner-username"
                        aria-describedby={
                          usernameNotice ? 'auth-username-feedback' : undefined
                        }
                        aria-invalid={Boolean(usernameNotice) || undefined}
                        autoCapitalize="none"
                        autoComplete="username"
                        maxLength={64}
                        name="username"
                        readOnly={!isSetup}
                        required
                        spellCheck={false}
                        type="text"
                        value={username}
                        placeholder="用户名"
                        onChange={(event) => {
                          if (!isSetup) return;
                          setUsername(event.target.value);
                          clearFieldNotice('username');
                        }}
                      />
                    </div>
                    <FieldFeedback
                      id="auth-username-feedback"
                      notice={usernameNotice}
                      reduceMotion={Boolean(reduceMotion)}
                    />
                  </m.div>

                  <m.div
                    animate="visible"
                    className={`mx-auth-field${passwordNotice ? ' is-invalid' : ''}`}
                    initial={reduceMotion ? false : 'hidden'}
                    variants={revealVariants}
                  >
                    <label className="sr-only" htmlFor="owner-password">
                      密码
                    </label>
                    <div className="mx-auth-input-frame">
                      <input
                        id="owner-password"
                        aria-describedby={
                          passwordNotice ? 'auth-password-feedback' : undefined
                        }
                        aria-invalid={Boolean(passwordNotice) || undefined}
                        autoComplete={isSetup ? 'new-password' : 'current-password'}
                        minLength={12}
                        name="password"
                        placeholder="密码（至少 12 个字符）"
                        required
                        type="password"
                        value={password}
                        onChange={(event) => {
                          setPassword(event.target.value);
                          clearFieldNotice('password');
                        }}
                      />
                    </div>
                    <FieldFeedback
                      id="auth-password-feedback"
                      notice={passwordNotice}
                      reduceMotion={Boolean(reduceMotion)}
                    />
                  </m.div>

                  {isSetup ? (
                    <m.div
                      animate="visible"
                      className={`mx-auth-field${tokenNotice ? ' is-invalid' : ''}`}
                      initial={reduceMotion ? false : 'hidden'}
                      variants={revealVariants}
                    >
                      <label className="sr-only" htmlFor="owner-setup-token">
                        初始化令牌
                      </label>
                      <div className="mx-auth-input-frame">
                        <input
                          id="owner-setup-token"
                          aria-describedby={
                            tokenNotice ? 'auth-token-feedback' : undefined
                          }
                          aria-invalid={Boolean(tokenNotice) || undefined}
                          autoComplete="off"
                          name="setup-token"
                          placeholder="初始化令牌"
                          required
                          spellCheck={false}
                          type="password"
                          value={setupToken}
                          onChange={(event) => {
                            setSetupToken(event.target.value);
                            clearFieldNotice('setup-token');
                          }}
                        />
                      </div>
                      <FieldFeedback
                        id="auth-token-feedback"
                        notice={tokenNotice}
                        reduceMotion={Boolean(reduceMotion)}
                      />
                    </m.div>
                  ) : null}
                </div>

                <m.button
                  aria-label={busy ? busyLabel : actionLabel}
                  className="mx-auth-submit"
                  disabled={busy}
                  type="submit"
                  whileHover={busy || reduceMotion ? undefined : { y: -1 }}
                  whileTap={busy || reduceMotion ? undefined : { scale: 0.985 }}
                >
                  <AnimatePresence initial={false} mode="wait">
                    <m.span
                      className="mx-auth-submit-content"
                      key={busy ? 'busy' : 'ready'}
                      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                      exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
                      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                      transition={{ duration: 0.16, ease: authEase }}
                    >
                      <span>{busy ? busyLabel : actionLabel}</span>
                      {busy ? (
                        <LoaderCircleIcon className="mx-spin" />
                      ) : (
                        <ArrowRightIcon />
                      )}
                    </m.span>
                  </AnimatePresence>
                </m.button>
              </form>
            </m.div>
          </m.section>
        )}
      </AnimatePresence>
    </main>
  );
}
