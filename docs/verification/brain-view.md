# Brain pinned view

Settings → Appearance → Pinned panels → Pin Brain stores the Brain entry through the
workspace navigation record. Its reserved URL selects the built-in read-only view;
it does not frame the Graphify origin or put a credential in a URL.

The server exposes GET /api/workspace/brain to owner/admin callers only. It makes a
fixed-origin MCP recall request for BVS or coordinator records, limited to 20 results.
Other scopes, writes, redirects, oversized responses and malformed records are refused.
Record text is rendered as text, including HTML-looking content. The view shows saved
records and provenance; it does not claim individual bot activity is tracked.

OMB_BRAIN_VIEWER_TOKENS is a private JSON map with bvs and coordinator bearer values.
The server reads it once and removes it from process.env before spawning engine children.
Never include this value in the renderer, a pin URL, build context, screenshots or logs.
Personal credentials are not needed for this view. Missing configuration returns 503.

Verify with the existing isolated fixture environment:

    vitest run server/routes/brain-view.test.ts server/navigation.e2e.test.ts
    vitest run src/components/BrainPanel.test.ts src/components/WebPanelPage.test.ts
    vitest run src/lib/web-panel-sync.test.ts src/lib/web-panels.test.ts

The navigation fixture launches a temporary server and paired synthetic admin and
client-only devices. Verify forbidden access without contacting a real brain. Component
fixtures use synthetic records. Run the production renderer/server builds and packaged
server smoke before rollout. On actual devices, check which renderer is in use: remote
workspace windows can load the hosted UI; a companion window can retain its local UI.
Reloading the server UI does not prove that every installed desktop client was updated.

## Interactive Graph tab

The Graph tab uses Graphify to extract document headings and render the scoped record/source network. It does not infer semantic relationships or track per-bot activity. Up to 50 matching records are rendered; this is not a full-database graph. The pinned vis-network 9.1.6 dependency is integrity checked and embedded locally. The iframe permits scripts only, has no same-origin permission, and uses a content policy denying network access. Both views use the same admin-only, fixed-scope backend credential boundary.

Verify with the route and component tests plus `deployment/graphify-brain/test_graph_view.py` and the real-MCP transport test in `test_brain.py`. Live acceptance must include a visible graph, its community filters, and a return to Records without losing source access.
