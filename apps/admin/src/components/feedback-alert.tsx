import { CircleAlertIcon, CircleCheckBigIcon, InfoIcon } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';

export type Notice = {
  kind: 'error' | 'success' | 'info';
  message: string;
};

export function FeedbackAlert({ notice }: { notice: Notice }) {
  const Icon =
    notice.kind === 'error'
      ? CircleAlertIcon
      : notice.kind === 'success'
        ? CircleCheckBigIcon
        : InfoIcon;
  const reduceMotion = useReducedMotion();

  return (
    <m.div
      key={`${notice.kind}:${notice.message}`}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      className={`mx-notice is-${notice.kind}`}
      initial={reduceMotion ? false : { opacity: 0, y: -4 }}
      aria-live={notice.kind === 'error' ? 'assertive' : 'polite'}
      role={notice.kind === 'error' ? 'alert' : 'status'}
      transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
    >
      <Icon />
      <p>{notice.message}</p>
    </m.div>
  );
}
