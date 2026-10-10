export function PageIntro({ heading, lede, display = false }: { heading: string; lede: string; display?: boolean }) {
  return (
    <div className="page-intro">
      <h1 className={display ? "display" : "page-title"}>{heading}</h1>
      <p className="lede">{lede}</p>
    </div>
  );
}
