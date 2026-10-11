/**
 * Fill `{name}` placeholders in a content string. A placeholder with no value
 * is left as written, so a missing value shows up in review instead of
 * vanishing.
 */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : whole,
  );
}

/**
 * A wait in words, for "Try again in {wait}": seconds under a minute and a
 * half, whole minutes (rounded up) under an hour and a half, then hours.
 */
export function waitText(seconds: number): string {
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (seconds < 90) return unit(Math.max(1, Math.ceil(seconds)), "second");
  if (seconds < 5400) return unit(Math.ceil(seconds / 60), "minute");
  return unit(Math.round(seconds / 3600), "hour");
}
