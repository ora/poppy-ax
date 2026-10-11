import Link from "next/link";
import { CheckASiteLink } from "@/components/home/check-a-site";
import { DomainForm } from "@/components/home/domain-form";
import { RichText } from "@/components/home/rich-text";
import { ThreeSteps } from "@/components/home/three-steps";
import { DOMAIN_MESSAGES } from "@/lib/domain";
import { homeContent } from "@/lib/home";
import "./home.css";

const CHECK_SECTION_ID = "check";

export default function HomePage() {
  const { heading, lede, check, story, steps, actions } = homeContent;
  return (
    <div className="home">
      <section id={CHECK_SECTION_ID} className="home__hero" aria-labelledby="home-title">
        <h1 id="home-title" className="display home__title">
          {heading}
        </h1>
        <p className="lede">{lede}</p>
        <DomainForm copy={check} fallbackMessages={DOMAIN_MESSAGES} />
      </section>

      <section className="story" aria-label={story.label}>
        {story.beats.map((beat) => (
          <article key={beat.id} className="story__beat" aria-labelledby={`beat-${beat.id}`}>
            <h2 id={`beat-${beat.id}`} className="story__title">
              {beat.title}
            </h2>
            <div className="story__body">
              {beat.paragraphs.map((paragraph, index) => (
                <p key={index}>
                  <RichText text={paragraph} />
                </p>
              ))}
              {"link" in beat && beat.link && (
                <p className="story__link">
                  <a href={beat.link.href}>
                    {beat.link.text}
                    <span aria-hidden="true"> -&gt;</span>
                  </a>
                </p>
              )}
            </div>
          </article>
        ))}
      </section>

      <section className="home__steps" aria-labelledby="steps-title">
        <h2 id="steps-title" className="home__steps-title">
          {steps.heading}
        </h2>
        <ThreeSteps steps={steps} />
        <div className="home__actions">
          <CheckASiteLink sectionId={CHECK_SECTION_ID} text={actions.check.text} />
          <Link href={actions.setup.href} className="button button--secondary">
            {actions.setup.text}
          </Link>
        </div>
      </section>
    </div>
  );
}
