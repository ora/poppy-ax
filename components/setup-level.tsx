import type { MDXComponents, MDXContent } from "mdx/types";
import { TrackedLink } from "@/components/analytics/tracked-link";
import { Children, isValidElement, type ReactNode } from "react";
import { groupedRows, setupContent, stepId, type SetupLevel } from "@/lib/setup";
import { displayTitle } from "@/lib/rows";

/** The plain text inside a heading, for its id. */
export function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return Children.toArray(node)
    .map((child) => (isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : textOf(child)))
    .join("");
}

function mdxComponentsFor(levelId: string): MDXComponents {
  return {
    // Code blocks scroll sideways inside themselves on a phone, so they must be
    // reachable by keyboard to scroll.
    pre: (props) => <pre tabIndex={0} {...props} />,
    // Each step gets a stable id, so row explanations can link to the step that fixes them.
    h3: ({ children, ...props }) => (
      <h3 id={stepId(levelId, textOf(children))} {...props}>
        {children}
      </h3>
    ),
    // Says what a code block shows, and whether it is a whole document or an excerpt.
    CodeLabel: ({ children }: { children?: ReactNode }) => <p className="code-label">{children}</p>,
  };
}

function checksSummary(level: SetupLevel): string {
  const { checksSummary: t } = setupContent.page;
  const total = level.rows.length;
  const today = groupedRows(level).find((entry) => entry.group === "today")?.rows.length ?? 0;
  const template = today === total ? t.all : today === 0 ? t.none : t.some;
  return template.replace("{count}", String(total)).replace("{today}", String(today));
}

export function LevelNav({ levels }: { levels: SetupLevel[] }) {
  const { page } = setupContent;
  return (
    <nav aria-label={page.navLabel} className="level-nav">
      <ol role="list">
        {levels.map((level) => (
          <li key={level.id}>
            <a href={`#${level.id}`}>
              <span className="level-nav__number" aria-hidden="true">
                {level.number}
              </span>
              <span className="visually-hidden">{`${page.levelPrefix} ${level.number}: `}</span>
              <span className="level-nav__title">{level.title}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function LevelSection({ level, Body }: { level: SetupLevel; Body: MDXContent }) {
  const { page } = setupContent;
  const titleId = `${level.id}-title`;
  return (
    <section id={level.id} data-level={level.number} aria-labelledby={titleId} className="level">
      <header className="level__head">
        <span className="level__number" aria-hidden="true">
          {level.number}
        </span>
        <h2 id={titleId} className="level__title">
          <span className="visually-hidden">{`${page.levelPrefix} ${level.number}: `}</span>
          {level.title}
        </h2>
        <p className="level__summary">{level.summary}</p>
        <dl className="level__facts">
          <div>
            <dt>{page.sizeLabel}</dt>
            <dd>{level.size}</dd>
          </div>
          <div>
            <dt>{page.checksLabel}</dt>
            <dd>
              <a href={`#${level.id}-checks`}>{checksSummary(level)}</a>
            </dd>
          </div>
        </dl>
      </header>
      <div className="prose">
        <Body components={mdxComponentsFor(level.id)} />
      </div>
      <LevelChecks level={level} />
    </section>
  );
}

function LevelChecks({ level }: { level: SetupLevel }) {
  const { page } = setupContent;
  const headingId = `${level.id}-checks`;
  return (
    <div className="level-checks">
      <h3 id={headingId}>{page.checksHeading}</h3>
      <p>{page.checksIntro}</p>
      {groupedRows(level).map(({ group, rows }) => (
        <details key={group} open={group === "today"}>
          <summary>
            {page.groups[group]} <span className="level-checks__count">({rows.length})</span>
          </summary>
          <ul>
            {rows.map((row) => (
              <li key={row.id}>
                <code>{row.id}</code> {displayTitle(row.id, row.title)}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

export function HostedNote() {
  const { hosted } = setupContent.page;
  return (
    <aside className="hosted-note" aria-label={hosted.label}>
      <p>
        {hosted.before}
        <TrackedLink href={hosted.href} event="waitlist_clicked">
          {hosted.linkText}
        </TrackedLink>
      </p>
    </aside>
  );
}

/** What a site owner needs before level 1, so the size of the job is clear up front. */
export function NeedsList() {
  const { needs } = setupContent.page;
  return (
    <section className="needs" aria-labelledby="needs-title">
      <h2 id="needs-title" className="needs__title">
        {needs.heading}
      </h2>
      <ul className="needs__list">
        {needs.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
