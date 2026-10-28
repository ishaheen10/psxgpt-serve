import { useEffect, useState } from "react";
import { ThemeProvider, ThemeToggle } from "./Theme";
import { API_BASE_URL } from "../hooks/useWebSocket";
type Company = { Symbol: string; "Company Name": string; Industry: string };
export function EquitiesReportApp() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/api/tickers`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setCompanies)
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Company list could not load. Please reload to try again.");
      });
    return () => controller.abort();
  }, []);
  const visible = companies.filter((c) =>
    `${c.Symbol} ${c["Company Name"]} ${c.Industry}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <ThemeProvider>
      <main className="mx-auto max-w-5xl px-6 py-10 text-foreground">
        <nav className="mb-10 flex justify-between">
          <a href="/" className="text-sm underline">
            Back to research
          </a>
          <ThemeToggle />
        </nav>
        <h1 className="text-3xl font-semibold">Find a company</h1>
        <p className="mt-3 text-muted-foreground">
          Start with its available reports, then ask a focused question.
        </p>
        <input
          aria-label="Search companies"
          className="my-6 w-full rounded-xl border border-border bg-background p-3"
          placeholder="Company, symbol or industry"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <p className="mb-4 text-sm text-muted-foreground">
            {companies.length
              ? `${visible.length} companies`
              : "Loading companies…"}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((c) => (
            <a
              key={c.Symbol}
              href={`/?q=${encodeURIComponent(`Tell me about ${c["Company Name"]} (${c.Symbol}) using its latest available annual report. Explain the business, recent performance and key risks. Cite source pages.`)}`}
              className="rounded-xl border border-border p-4 hover:border-primary"
            >
              <strong>{c.Symbol}</strong>
              <p className="mt-1">{c["Company Name"]}</p>
              <p className="mt-2 text-xs text-muted-foreground">{c.Industry}</p>
            </a>
          ))}
        </div>
      </main>
    </ThemeProvider>
  );
}
