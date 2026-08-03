import type { ReactNode } from 'react';

type PageFrameProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  constrain?: boolean;
  headerInert?: boolean;
  subtitle?: ReactNode;
  title: ReactNode;
};

export function PageFrame({
  actions,
  children,
  className,
  constrain = true,
  headerInert = false,
  subtitle,
  title,
}: PageFrameProps) {
  const heading =
    typeof title === 'string' ? (
      <h1 className="mx-content-page-title">{title}</h1>
    ) : (
      title
    );

  return (
    <section className={`mx-content-page${className ? ` ${className}` : ''}`}>
      <header className="mx-content-page-header" inert={headerInert}>
        <div
          className={`mx-content-page-header-inner${constrain ? ' is-constrained' : ''}`}
        >
          <div className="mx-content-page-heading">
            {heading}
            {subtitle ? (
              <div className="mx-content-page-subtitle">{subtitle}</div>
            ) : null}
          </div>
          {actions ? <div className="mx-content-page-actions">{actions}</div> : null}
        </div>
      </header>
      <div className="mx-content-page-body">
        {constrain ? (
          <div className="mx-content-page-body-inner">{children}</div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
