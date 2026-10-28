import { ThemeProvider, ThemeToggle } from "./Theme";
import { CHANGELOG } from "../content/changelog";

export function DocsApp({ archived = false }: { archived?: boolean }) {
  return (
    <ThemeProvider>
      <main className="mx-auto max-w-3xl px-6 py-10 text-foreground">
        <nav className="mb-10 flex items-center justify-between">
          <a href="/" className="text-sm underline">
            {archived ? "Home" : "Back to research"}
          </a>
          <ThemeToggle />
        </nav>
        <h1 className="text-3xl font-semibold">Research with sources</h1>
        <p className="mt-5 text-lg text-muted-foreground">
          Ask about a company, compare reports, or investigate a topic. Follow
          the source pages and build on the answer with follow-up questions.
        </p>
        <section id="engine" className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">
            How an answer comes together
          </h2>
          <ol className="list-decimal space-y-3 pl-6">
            <li>
              A focused question gets one answer. A broad question can become up
              to three independent sections.
            </li>
            <li>
              Each section searches relevant reports and reads original source
              pages.
            </li>
            <li>
              Progress shows what is being searched or read and what comes next.
              Sections appear as they are written.
            </li>
            <li>
              Follow-ups can reuse the pages already read. Open the citations to
              check the underlying evidence.
            </li>
          </ol>
        </section>
        <section id="database" className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Sources and limits</h2>
          <p>
            Research uses company filings, PSX announcements and economic
            documents. Dated PSX prices, share counts and market capitalizations
            remain available.
          </p>
          <p>
            Financial tables are read from report pages. Precomputed ratios,
            normalized financial statements and saved model calculations are
            currently bypassed.
          </p>
          <p>
            Coverage and reporting dates vary. Transcribed tables can contain
            errors. For material figures, check the linked original page; an
            answer should explain ambiguity rather than guess.
          </p>
          {!archived && (
            <a className="inline-block underline" href="/equities">
              Find a company
            </a>
          )}
        </section>
        <section id="changelog" className="mt-12">
          <h2 className="text-xl font-semibold">Changelog</h2>
          {CHANGELOG.map((change) => (
            <article
              key={change.id}
              id={`change-${change.id}`}
              className="border-b border-border py-6"
            >
              <p className="text-xs text-muted-foreground">{change.date}</p>
              <h3 className="mt-2 font-medium">{change.title}</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                {change.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      </main>
    </ThemeProvider>
  );
}
