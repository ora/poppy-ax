/**
 * Link to a new GitHub issue whose title is the page path, so a reader can
 * report a wrong sentence on the page they are reading.
 */
export function reportErrorHref(newIssueUrl: string, pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${newIssueUrl}?title=${encodeURIComponent(path)}`;
}
