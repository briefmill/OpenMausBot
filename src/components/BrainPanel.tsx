import { useEffect, useState } from "react";
import { Brain, RefreshCw, Search } from "lucide-react";
import { api } from "@/state/api";
import { BRAIN_VIEW_PATH, BRAIN_VIEW_SCOPES, BRAIN_SCOPE_LABELS, type BrainView, type BrainGraphView, type BrainViewScope } from "../../shared/brain-view";

export function BrainPanel() {
  const [scope, setScope] = useState<BrainViewScope>("bvs");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<BrainView>();
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState("");
  const [view, setView] = useState<"records" | "graph">("records");
  const [graph, setGraph] = useState<BrainGraphView>();
  useEffect(() => {
    const abort = new AbortController(); setData(undefined); setGraph(undefined); setSelected(undefined); setError("");
    api<BrainView | BrainGraphView>(`${BRAIN_VIEW_PATH}?scope=${scope}&query=${encodeURIComponent(query)}&view=${view}`, { signal: abort.signal })
      .then(value => { if (!abort.signal.aborted) { if ("html" in value) setGraph(value); else { setData(value); setSelected(value.records[0]?.id); } } }, () => {
        if (!abort.signal.aborted) setError("Brain is unavailable or this device does not have admin access. No data was changed.");
      });
    return () => abort.abort();
  }, [scope, query, refresh, view]);
  const record = data?.records.find(item => item.id === selected);
  return <main aria-label="Brain" className="flex min-h-0 min-w-0 flex-1 flex-col bg-app text-ink">
    <header className="flex flex-wrap items-center gap-3 border-b border-hairline p-4">
      <Brain size={20} /><h1 className="text-lg font-semibold">Brain</h1>
      <span className="text-sm text-ink-secondary">Graphify · saved knowledge</span>
      <button type="button" className="ui-button ml-auto" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} />Refresh</button>
    </header>
    <div role="group" aria-label="Brain views" className="flex gap-2 px-4 pt-3">
      <button type="button" className="ui-button" aria-pressed={view === "records"} onClick={() => setView("records")}>Records</button>
      <button type="button" className="ui-button" aria-pressed={view === "graph"} onClick={() => setView("graph")}>Graph</button>
    </div>
    <p className="px-4 pt-3 text-sm text-ink-secondary">Read-only records and their sources. Per-bot reads and writes are not yet tracked here.</p>
    <form className="flex flex-wrap gap-2 p-4" onSubmit={event => { event.preventDefault(); setQuery(draft.trim()); setRefresh(value => value + 1); }}>
      <label className="flex items-center gap-2 text-sm">Scope<select aria-label="Brain scope" className="rounded border border-hairline bg-app p-2" value={scope} onChange={event => setScope(event.target.value as BrainViewScope)}>{BRAIN_VIEW_SCOPES.map(value => <option key={value} value={value}>{BRAIN_SCOPE_LABELS[value]}</option>)}</select></label>
      <input aria-label="Search brain" className="min-w-32 flex-1 rounded border border-hairline bg-app px-3" placeholder="Search a client or topic" maxLength={200} value={draft} onChange={event => setDraft(event.target.value)} />
      <button className="ui-button" type="submit"><Search size={14} />Search</button>
    </form>
    {error ? <p role="alert" className="px-4 text-danger">{error}</p> : view === "graph" ? graph ? <>
      <p role="status" className="px-4 pb-2 text-xs text-ink-secondary">Showing {graph.recordCount} matching records, up to 50 · {graph.nodes} nodes · {graph.edges} connections. {graph.basis}</p>
      <iframe title="Interactive Graphify brain graph" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={graph.html} className="min-h-[500px] w-full flex-1 border-0" />
    </> : <p role="status" className="px-4">Building Graphify view…</p> : !data ? <p role="status" className="px-4">Loading saved knowledge…</p> : <>
      <p role="status" className="px-4 pb-3 text-xs text-ink-secondary">Showing {data.records.length} matching records, up to {data.limit}. Retrieved {new Date(data.fetchedAt).toLocaleString()}.</p>
      <div className="grid min-h-0 flex-1 overflow-auto md:grid-cols-[minmax(220px,1fr)_2fr]">
        <nav aria-label="Brain records" className="overflow-auto border-r border-hairline p-3">
          {data.records.length === 0 && <p>No matching records. Try a different search.</p>}
          {data.records.map(item => <button type="button" key={item.id} aria-pressed={item.id === selected} className={`mb-2 block w-full rounded border p-3 text-left text-sm ${item.id === selected ? "border-ink bg-ink/5" : "border-hairline"}`} onClick={() => setSelected(item.id)}>{item.title}</button>)}
        </nav>
        {record && <article aria-label="Selected brain record" className="min-w-0 overflow-auto p-4">
          <h2 className="text-base font-semibold">{record.title}</h2>
          <svg role="img" aria-label="This record is linked to its recorded source" viewBox="0 0 500 95" className="my-3 w-full max-w-xl text-ink-secondary">
            <path d="M110 45 H320" stroke="currentColor" strokeWidth="2" />
            <circle cx="65" cy="45" r="35" fill="none" stroke="currentColor" /><text x="65" y="49" textAnchor="middle" fill="currentColor" fontSize="12">Record</text>
            <rect x="320" y="15" width="145" height="60" rx="10" fill="none" stroke="currentColor" /><text x="392" y="49" textAnchor="middle" fill="currentColor" fontSize="12">Source document</text>
            <text x="215" y="32" textAnchor="middle" fill="currentColor" fontSize="11">recorded from</text>
          </svg>
          <dl className="mb-4 text-xs text-ink-secondary"><dt>Source</dt><dd className="break-all">{record.source}</dd><dt className="mt-2">Original snapshot</dt><dd>{record.occurred_at ? new Date(record.occurred_at * 1000).toLocaleString() : "Not recorded"}</dd><dt className="mt-2">Saved</dt><dd>{new Date(record.created * 1000).toLocaleString()}</dd></dl>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{record.body}</pre>
        </article>}
      </div>
    </>}
  </main>;
}
