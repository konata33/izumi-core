import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type HeaderActionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: ReactNode;
  display?: 'icon' | 'label';
  label: string;
  variant?: 'default' | 'primary' | 'danger';
};

/**
 * mx-admin-style global toolbar action: icon-first, named by tooltip and aria.
 * Text buttons remain for in-content confirmation only.
 */
export const HeaderAction = forwardRef<HTMLButtonElement, HeaderActionProps>(
  function HeaderAction(
    {
      children,
      className = '',
      display = 'icon',
      label,
      variant = 'default',
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        aria-label={label}
        className={`mx-header-action is-${variant} is-${display}${className ? ` ${className}` : ''}`}
        title={label}
        type="button"
        {...props}
      >
        {children}
        {display === 'label' ? (
          <span className="mx-header-action-label">{label}</span>
        ) : null}
      </button>
    );
  },
);
