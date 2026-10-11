import { CheckProgress, type CheckProgressCopy } from "@/components/audit/check-progress";
import { AUDIT_TITLE_ID } from "@/lib/check-progress";
import { DomainForm } from "@/components/home/domain-form";
import { homeContent } from "@/lib/home";
import { auditContent, type ResultView } from "@/lib/audit";
import { fill } from "@/lib/template";

const t = auditContent;

/** Only the words the client component needs, so the rest of content/audit.json stays on the server. */
const progressCopy: CheckProgressCopy = { ...t.progress, button: t.checkAgain.button };

/** The question the page answers first, above the domain. */
function Question() {
  return <p className="audit__question">{t.verdict.question}</p>;
}

/** The page heading: the domain, then the one line answer. */
export function AuditHeading({ domain, verdict, kind }: { domain: string; verdict?: string; kind?: string }) {
  return (
    <header className="audit__head">
      <Question />
      {/* Focus lands here when a new result arrives, so it is read out. */}
      <h1 id={AUDIT_TITLE_ID} className="audit__title" tabIndex={-1}>
        <span className="audit__domain">{domain}</span>
        {verdict && (
          <>
            <span className="visually-hidden">: </span>
            <span className="audit__verdict" data-kind={kind}>
              {verdict}
            </span>
          </>
        )}
      </h1>
    </header>
  );
}

function Facts({ view }: { view: ResultView }) {
  return (
    <dl className="audit__facts" aria-label={t.verdict.factsLabel}>
      {view.tiers.map((tier) => (
        <div key={tier.key}>
          <dt>{tier.label}</dt>
          <dd>{tier.text}</dd>
        </div>
      ))}
      <div>
        <dt>{t.verdict.profile}</dt>
        <dd>
          <code>{view.profile}</code>
          <span className="audit__help"> ({t.verdict.profileHelp})</span>
        </dd>
      </div>
      <div>
        <dt>{t.verdict.lastRun}</dt>
        <dd>
          <time dateTime={view.lastRun.iso} title={view.lastRun.absolute}>
            {view.lastRun.relative}
          </time>
          <span className="audit__help"> ({view.lastRun.absolute})</span>
        </dd>
      </div>
    </dl>
  );
}

function FixFirst({ view }: { view: ResultView }) {
  const s = t.fixFirst;
  const invitation = t.verdict.invitation;
  return (
    <section className="audit__section" aria-labelledby="fix-first">
      <h2 id="fix-first" className="audit__section-title">
        {s.question}
      </h2>
      {view.invitation ? (
        <p className="audit__invitation">
          {fill(invitation.before, { domain: view.domain })}
          <a href={invitation.href}>{invitation.linkText}</a>
          {invitation.after}
        </p>
      ) : view.fixFirst.length === 0 ? (
        <p className="audit__plain">{view.fixFirstEmpty}</p>
      ) : (
        <>
          <p className="audit__intro">{s.intro}</p>
          <ol className="fix-list" role="list">
            {view.fixFirst.map((row) => (
              <li key={row.id} className="fix">
                <h3 className="fix__title">
                  <span className="tag" data-severity={row.severity}>
                    {row.severity}
                  </span>{" "}
                  {row.title}
                </h3>
                <p className="fix__what">{row.whatFailed}</p>
                {row.why && <p className="fix__why">{row.why}</p>}
                {row.note && (
                  <p className="fix__note">
                    <span className="fix__note-label">{s.saw}</span> {row.note}
                  </p>
                )}
                <p className="fix__links">
                  <a href={row.setupStep}>{s.fixLink}</a>
                  {row.specUrl && <a href={row.specUrl}>{s.specLink}</a>}
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function NotChecked({ view }: { view: ResultView }) {
  const s = t.notChecked;
  return (
    <section className="audit__section" aria-labelledby="not-checked">
      <h2 id="not-checked" className="audit__section-title">
        {s.question}
      </h2>
      {view.unmeasured.length > 0 && (
        <div className="unmeasured">
          <h3 className="unmeasured__title">{s.unmeasured.title}</h3>
          <p className="audit__intro">{s.unmeasured.intro}</p>
          <ul className="unmeasured__list" role="list">
            {view.unmeasured.map((row) => (
              <li key={row.id}>
                <p className="unmeasured__name">
                  <span className="tag" data-severity={row.severity}>
                    {row.severity}
                  </span>{" "}
                  {row.title}
                </p>
                <p className="unmeasured__why">
                  {s.unmeasured.why} {row.reasonText}.
                </p>
                {row.note && (
                  <p className="fix__note">
                    <span className="fix__note-label">{t.fixFirst.saw}</span> {row.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="audit__intro">{s.intro}</p>
      <div className="unchecked">
        {view.unchecked.map((group) => {
          const words = s.groups[group.level];
          return (
            <details key={group.level} className="unchecked__group">
              <summary>
                <span className="unchecked__name">{words.title}</span>{" "}
                <span className="unchecked__count">{fill(s.count, { n: group.rows.length })}</span>
              </summary>
              <p className="unchecked__intro">
                {words.intro}
                {"href" in words && (
                  <>
                    {" "}
                    <a href={words.href}>{words.linkText}</a>.
                  </>
                )}
              </p>
              <ul className="unchecked__list" role="list">
                {group.rows.map((row) => (
                  <li key={row.id}>{row.title}</li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </section>
  );
}

/** The whole answer for a domain with a stored result. */
export function AuditResult({ view }: { view: ResultView }) {
  const again = view.checkAgain;
  const notes = {
    available: fill(t.checkAgain.available, { relative: view.lastRun.relative }),
    waiting: fill(t.checkAgain.waiting, {
      time: again.availableAt?.absolute ?? "",
      relative: again.availableAt?.relative ?? "",
    }),
    opened: t.checkAgain.opened,
  };
  return (
    <article className="audit">
      <AuditHeading domain={view.domain} verdict={view.headline.text} kind={view.headline.kind} />
      {view.explain && <p className="audit__explain">{view.explain}</p>}
      <Facts view={view} />
      <CheckProgress
        domain={view.domain}
        autoStart={false}
        lastRun={view.lastRun.iso}
        available={again.available}
        availableAt={again.availableAt?.iso ?? null}
        notes={notes}
        copy={progressCopy}
      />
      {view.passingLine && (
        <p className="audit__passing">
          {t.passing.before}
          <a href={fill(t.passing.href, { domain: view.domain })}>{t.passing.linkText}</a>
        </p>
      )}
      <FixFirst view={view} />
      <NotChecked view={view} />
      <p className="audit__report">
        <a href={view.reportUrl}>{t.report.linkText}</a> {t.report.host}.
      </p>
    </article>
  );
}

/** No result yet: start a check at once. */
export function AuditNotScanned({ domain }: { domain: string }) {
  return (
    <article className="audit">
      <AuditHeading domain={domain} />
      <p className="audit__explain">{t.notScanned.lede}</p>
      <CheckProgress domain={domain} autoStart lastRun={null} copy={progressCopy} />
      <noscript>
        <p className="audit__plain">{t.notScanned.noscript}</p>
      </noscript>
    </article>
  );
}

/** Ora gave no usable answer. Never shows its own text. */
export function AuditUnavailable({ domain, retryAfterSeconds }: { domain: string; retryAfterSeconds?: number }) {
  const message =
    retryAfterSeconds !== undefined
      ? fill(t.error.busy, { seconds: retryAfterSeconds })
      : fill(t.error.lede, { domain });
  return (
    <article className="audit">
      <AuditHeading domain={domain} />
      <p className="audit__explain" role="status">
        {message}
      </p>
      <p>
        <a className="button button--primary" href={`/audit/${domain}`}>
          {t.error.retry}
        </a>
      </p>
    </article>
  );
}

/** A domain that can't be checked: why, in the domain box's own words, and the box to try again. */
export function AuditInvalid({ message }: { message: string }) {
  return (
    <article className="audit">
      <header className="audit__head">
        <h1 className="audit__title">
          <span className="audit__domain">{t.invalid.heading}</span>
        </h1>
      </header>
      <DomainForm copy={homeContent.check} initialMessage={message} />
    </article>
  );
}
