import type { ButtonHTMLAttributes, ReactNode } from 'react';

type HeaderActionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: ReactNode;
  label: string;
  variant?: 'default' | 'primary' | 'danger';
};

/**
 * mx-admin-style global toolbar action: icon-first, named by tooltip and aria.
 * Text buttons remain for in-content confirmation only.
 */
export function HeaderAction({ children, className = '', label, variant = 'default', ...props }: HeaderActionProps) {
  return (
    <button
      aria-label={label}
      className={`mx-header-action is-${variant}${className ? ` ${className}` : ''}`}
      title={label}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}
