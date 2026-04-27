// Shared bits for the Master Creations sub-pages. Extracted out
// of the original single-page Masters tab so each master can live
// at its own /masters/<section> URL (deep-linkable, breadcrumb-able)
// without copy-pasting the form/table/toolbar primitives.

import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';

export const FIELD =
  'mt-1 w-full bg-card text-fg border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus';
export const LABEL = 'block text-sm font-medium';
export const HELP = 'mt-1 text-xs text-muted-fg';

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

export function StatusLine({
  saving,
  error,
  saved,
}: {
  saving: boolean;
  error: string | null;
  saved: boolean;
}) {
  const { t } = useI18n();
  if (error) return <span className="text-sm text-danger">{error}</span>;
  if (saving) return <span className="text-sm text-muted-fg">{t('common.saving')}</span>;
  if (saved) return <span className="text-sm text-success">{t('common.saved')}</span>;
  return null;
}

export function Toolbar({
  addLabel,
  showAdd,
  onToggle,
}: {
  addLabel: string;
  showAdd: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onToggle}
        className="text-sm bg-primary hover:bg-primary-hover text-primary-fg rounded px-3 py-1.5 min-h-[40px]"
      >
        {showAdd ? t('common.cancel') : addLabel}
      </button>
    </div>
  );
}

export function FormActions({
  saving,
  error,
  saved,
  onCancel,
}: {
  saving: boolean;
  error: string | null;
  saved: boolean;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 pt-1">
      <button
        type="submit"
        disabled={saving}
        className="bg-primary hover:bg-primary-hover text-primary-fg rounded px-3 py-1.5 text-sm min-h-[40px] disabled:opacity-60"
      >
        {saving ? t('common.saving') : t('common.confirm')}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="bg-card hover:bg-card-hover text-fg border border-border rounded px-3 py-1.5 text-sm min-h-[40px]"
      >
        {t('common.cancel')}
      </button>
      <StatusLine saving={saving} error={error} saved={saved} />
    </div>
  );
}

export type Row = {
  key: number | string;
  cells: Array<string | number>;
  onEdit?: () => void;
};

export function Table({
  head,
  rows,
  loading,
  empty,
}: {
  head: string[];
  rows: Row[];
  loading: boolean;
  empty?: string;
}) {
  const { t } = useI18n();
  if (loading) {
    return <div className="text-sm text-muted-fg">{t('common.loading')}</div>;
  }
  if (rows.length === 0) {
    return <div className="text-sm text-muted-fg">{empty ?? t('master.empty')}</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-fg">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="font-medium py-2 pr-3 border-b border-border">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border last:border-0">
              {r.cells.map((cell, i) => (
                <td key={i} className="py-2 pr-3 align-top">{cell}</td>
              ))}
              <td className="py-2 pr-0 align-top text-right">
                {r.onEdit && (
                  <button
                    type="button"
                    onClick={r.onEdit}
                    className="text-sm text-primary hover:underline"
                  >
                    {t('master.action.edit')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Header used by every /masters/<section> page. Mirrors PondDetail's
// back-link style so the back affordance is consistent across the app.
export function MasterPageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const { t } = useI18n();
  return (
    <header className="space-y-1">
      <Link to="/masters" className="text-sm text-muted-fg hover:text-fg">
        ‹ {t('master.back')}
      </Link>
      <h1 className="text-xl font-semibold">{title}</h1>
      {description && <p className="text-sm text-muted-fg">{description}</p>}
    </header>
  );
}
