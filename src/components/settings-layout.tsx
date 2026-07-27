import type { ReactNode } from 'react';

type SettingsSectionProps = {
  children: ReactNode;
  icon: ReactNode;
  rowsClassName?: string;
  title: string;
};

type SettingsRowProps = {
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  label: ReactNode;
};

export function SettingsSection({ children, icon, rowsClassName, title }: SettingsSectionProps) {
  return (
    <section className="mx-settings-section" aria-label={title}>
      <div className="mx-settings-section-header">
        <div className="mx-settings-section-icon" aria-hidden="true">{icon}</div>
        <h2 className="mx-settings-section-title">{title}</h2>
      </div>
      <div className={`mx-settings-rows${rowsClassName ? ` ${rowsClassName}` : ''}`}>{children}</div>
    </section>
  );
}

export function SettingsRow({ children, className, htmlFor, label }: SettingsRowProps) {
  const labelClassName = 'mx-settings-row-label';

  return (
    <div className={`mx-settings-row${className ? ` ${className}` : ''}`}>
      {htmlFor ? <label className={labelClassName} htmlFor={htmlFor}>{label}</label> : <div className={labelClassName}>{label}</div>}
      <div className="mx-settings-row-control">{children}</div>
    </div>
  );
}
