import type { Lang } from '../i18n';

const SECOND = 1;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function relativeTime(epochSeconds: number, lang: Lang, now: number = Date.now()): string {
  const diffSec = Math.round(epochSeconds - now / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (abs < MINUTE) return rtf.format(Math.round(diffSec / SECOND), 'second');
  if (abs < HOUR) return rtf.format(Math.round(diffSec / MINUTE), 'minute');
  if (abs < DAY) return rtf.format(Math.round(diffSec / HOUR), 'hour');
  if (abs < WEEK) return rtf.format(Math.round(diffSec / DAY), 'day');
  if (abs < MONTH) return rtf.format(Math.round(diffSec / WEEK), 'week');
  if (abs < YEAR) return rtf.format(Math.round(diffSec / MONTH), 'month');
  return rtf.format(Math.round(diffSec / YEAR), 'year');
}

export function absoluteTime(epochSeconds: number, lang: Lang): string {
  return new Date(epochSeconds * 1000).toLocaleString(lang, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
