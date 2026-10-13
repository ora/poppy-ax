import { MainNav } from "./main-nav";
import { Wordmark } from "./wordmark";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__bar">
        <Wordmark />
        <MainNav />
      </div>
    </header>
  );
}
