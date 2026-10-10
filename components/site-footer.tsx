import { content } from "@/lib/content";
import { IndependentLabel } from "./independent-label";
import { ReportErrorLink } from "./report-error-link";

export function SiteFooter() {
  const { license } = content;
  return (
    <footer className="site-footer">
      <IndependentLabel className="site-footer__label" />
      <ul className="site-footer__links" aria-label={content.footerNavLabel}>
        <li>
          <a href={content.draft.href}>{content.draft.text}</a>
        </li>
        <li>
          <ReportErrorLink />
        </li>
      </ul>
      <p className="site-footer__license">
        {license.before}
        <a href={license.code.href}>{license.code.text}</a>
        {license.middle}
        <a href={license.content.href}>{license.content.text}</a>
        {license.after}
      </p>
    </footer>
  );
}
