/**
 * ArchiveApp - static site served after psxGPT was retired.
 * Built with `pnpm build:archive`; no API, auth or chat code is bundled.
 */

import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ThemeProvider, ThemeToggle } from '../Theme';
import { DocsApp } from '../DocsApp';
import learnings from '../../content/learnings.md?raw';

const REPOS = [
  { name: 'psxgpt-serve', href: 'https://github.com/ishaheen10/psxgpt-serve', blurb: 'Query engine, workers and this site' },
  { name: 'psxgpt-pipeline', href: 'https://github.com/ishaheen10/psxgpt-pipeline', blurb: 'Builds the corpus from filing PDFs' },
];

const GUIDES = [
  { href: '/guides/methodology.html', title: 'Methodology', blurb: 'Prototype to system: traceability, working files, quality loops and gold sets.' },
  { href: '/guides/pipeline_guide.html', title: 'Pipeline guide', blurb: 'How filing PDFs became searchable pages and structured rows.' },
  { href: '/guides/engine_guide.html', title: 'Query engine guide', blurb: 'Planner, retrieval, analyst assembly and debugging, as designed mid-2026.' },
];

const linkClass = 'underline underline-offset-2 hover:text-foreground';

function Shell({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <main className="mx-auto max-w-3xl px-6 py-10 text-foreground">
        <nav className="mb-10 flex flex-wrap items-center justify-between gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a href="/" className="font-semibold">psxGPT</a>
            <a href="/learnings" className={linkClass}>Learnings</a>
            <a href="/docs" className={linkClass}>Docs</a>
            <a href="/about" className={linkClass}>About</a>
          </div>
          <ThemeToggle />
        </nav>
        {children}
      </main>
    </ThemeProvider>
  );
}

function Home() {
  return (
    <Shell>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Retired October 2026</p>
      <h1 className="mt-3 text-3xl font-semibold">psxGPT</h1>
      <p className="mt-5 text-lg text-muted-foreground">
        psxGPT was a research assistant for Pakistan Stock Exchange companies. It read company filings, PSX
        announcements and economic documents, and answered with links to the exact source pages. The live service has
        been shut down. The write-ups and the code remain.
      </p>

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-semibold">What I learned</h2>
        <p className="text-muted-foreground">
          What worked, what didn&apos;t, and what I&apos;d do differently building a source-grounded research engine.
        </p>
        <a href="/learnings" className={linkClass}>Read the retrospective</a>
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-xl font-semibold">Guides</h2>
        <ul className="space-y-3">
          {GUIDES.map((guide) => (
            <li key={guide.href}>
              <a href={guide.href} className={`font-medium ${linkClass}`}>{guide.title}</a>
              <p className="text-sm text-muted-foreground">{guide.blurb}</p>
            </li>
          ))}
          <li>
            <a href="/docs" className={`font-medium ${linkClass}`}>Final docs and changelog</a>
            <p className="text-sm text-muted-foreground">How the last version answered questions, and every change along the way.</p>
          </li>
        </ul>
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-xl font-semibold">Run it yourself</h2>
        <p className="text-muted-foreground">
          The code is open source. You&apos;ll need your own Cloudflare account and model API keys; the pipeline rebuilds
          the corpus from public filings.
        </p>
        <ul className="space-y-3">
          {REPOS.map((repo) => (
            <li key={repo.name}>
              <a href={repo.href} className={`font-medium ${linkClass}`}>{repo.name}</a>
              <p className="text-sm text-muted-foreground">{repo.blurb}</p>
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}

function Learnings() {
  return (
    <Shell>
      <article className="leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_h1]:text-3xl [&_h1]:font-semibold [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-2 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mt-4 [&_p]:text-muted-foreground [&_li]:text-muted-foreground [&_strong]:text-foreground [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-6">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{learnings}</ReactMarkdown>
      </article>
    </Shell>
  );
}

function About() {
  return (
    <Shell>
      <h1 className="text-3xl font-semibold">Who made psxGPT</h1>
      <p className="mt-5 text-lg text-muted-foreground">
        psxGPT started with a simple question: how do I surface the most relevant source in the shortest possible time
        for a given question, and present its analysis well?
      </p>
      <div className="mt-8 space-y-4 text-muted-foreground">
        <p>
          I am an analyst at heart. Most of my career was spent on M&amp;A deals, teaching financial modeling, and helping
          build a tower-sharing company, with a few startup experiments along the way. psxGPT combined that love of
          modeling with programming, which I fell for a few years ago.
        </p>
        <p>
          I built it solo, from downloading PDFs to tracing exactly where a pipeline or an answer went wrong, and ran
          workshops so other analysts could build similar systems.
        </p>
        <p>
          <a href="https://www.linkedin.com/in/isfandiyar-shaheen-3a56a92/" className={linkClass} target="_blank" rel="noreferrer">LinkedIn</a>
          {' · '}
          <a href="https://twitter.com/AsfiShaheen" className={linkClass} target="_blank" rel="noreferrer">Twitter</a>
        </p>
      </div>
    </Shell>
  );
}

export function ArchiveApp() {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path === '/learnings') return <Learnings />;
  if (path === '/docs') return <DocsApp archived />;
  if (path === '/about') return <About />;
  return <Home />;
}
