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
