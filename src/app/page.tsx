import { ui } from "@/lib/copy/wording";
import { MAX_QUERY } from "@/lib/website";

export default function SearchPage() {
  return (
    <>
      <h1>{ui.appName}</h1>
      <p className="muted">{ui.tagline}</p>
      <form action="/confirm" method="get" role="search">
        <label htmlFor="q">{ui.searchLabel}</label>
        <div className="field-row">
          <input id="q" name="q" type="search" required maxLength={MAX_QUERY} autoComplete="off" autoFocus placeholder="e.g. Patagonia" />
          <button type="submit">{ui.searchButton}</button>
        </div>
      </form>
    </>
  );
}
