// Keep application-generated dates, times, and relative labels in English even
// when the browser or operating system uses another locale.
export const UI_LOCALE = "en-US";

export function formatUiDateTime(timestamp: string, now = new Date()) {
  const time = new Date(timestamp);
  if (Number.isNaN(time.getTime())) return timestamp;
  const pad = (value: number) => String(value).padStart(2, "0");
  const year =
    time.getFullYear() === now.getFullYear() ? "" : `${time.getFullYear()}-`;
  return `${year}${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat(UI_LOCALE, {
  numeric: "auto",
});

export function formatUiRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
) {
  return relativeTimeFormatter.format(value, unit);
}
