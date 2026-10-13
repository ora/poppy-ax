import Link from "next/link";
import { DomainForm } from "@/components/home/domain-form";
import { RichText } from "@/components/home/rich-text";
import { KeyIcon, ThreeSteps } from "@/components/home/three-steps";
import { CHECK_SECTION_ID } from "@/lib/check-anchor";
import { DOMAIN_MESSAGES } from "@/lib/domain";
import { homeContent } from "@/lib/home";
import "./home.css";

export default function HomePage() {
  const { heading, lede, status, check, compare, valetKey, steps, stands } = homeContent;
  return (
    <div className="home">
      <section id={CHECK_SECTION_ID} className="home__hero" aria-labelledby="home-title">
        <h1 id="home-title" className="display home__title">
          {heading}
        </h1>
        <div className="home__intro">
          <p className="home__status">{status}</p>
          <p className="lede">{lede}</p>
        </div>
        <DomainForm copy={check} fallbackMessages={DOMAIN_MESSAGES} />
      </section>

      <section className="home__section" aria-labelledby="compare-title">
        <h2 id="compare-title" className="home__section-title">
          {compare.heading}
        </h2>
        <div className="compare">
          {compare.columns.map((column) => (
            <article key={column.id} className="compare__column" data-column={column.id}>
              <h3 className="compare__title">{column.title}</h3>
              <p>{column.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home__section valet-key" aria-labelledby="valet-key-title">
        <KeyIcon className="valet-key__icon" />
        <h2 id="valet-key-title" className="home__section-title">
          {valetKey.heading}
        </h2>
        <p className="valet-key__text">{valetKey.text}</p>
      </section>

      <section className="home__section" aria-labelledby="steps-title">
        <h2 id="steps-title" className="home__section-title">
          {steps.heading}
        </h2>
        <ThreeSteps steps={steps} />
      </section>

      <section className="home__section" aria-labelledby="stands-title">
        <h2 id="stands-title" className="home__section-title">
          {stands.heading}
        </h2>
        <p className="home__stands-text">
          <RichText text={stands.text} />
        </p>
        <div className="home__actions">
          {stands.links.map((link, index) => (
            <Link
              key={link.href}
              href={link.href}
              className={`button ${index === 0 ? "button--primary" : "button--secondary"}`}
            >
              {link.text}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
