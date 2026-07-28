import type { ReactNode } from 'react';

type PageFrameProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  subtitle?: ReactNode;
  title: ReactNode;
};

export function PageFrame({ actions, children, className, subtitle, title }: PageFrameProps) {
  const heading = typeof title === 'string'
    ? <h1 className="mx-content-page-title">{title}</h1>
    : title;

  return (
    <section className={`mx-content-page${className ? ` ${className}` : ''}`}>
      <header className="mx-content-page-header">
        <div className="mx-content-page-heading">
          {heading}
          {subtitle ? <div className="mx-content-page-subtitle">{subtitle}</div> : null}
        </div>
        {actions ? <div className="mx-content-page-actions">{actions}</div> : null}
      </header>
      <div className="mx-content-page-body">{children}</div>
    </section>
  );
}
