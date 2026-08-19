import { esc } from '../escape.js';
import { flashFor } from '../messages.js';

export function layout(opts: { title: string; flashCode?: string | undefined; body: string }): string {
  const flash = flashFor(opts.flashCode);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(opts.title)} · Workflow Inbox</title>
  <style>
    :root {
      color-scheme: light dark;
      --gap: 1rem;
      --radius: 10px;
      --bg: #f5f6fa;
      --surface: #ffffff;
      --fg: #14181f;
      --muted: #5b6472;
      --border: #e3e6ec;
      --accent: #4338ca;
      --accent-fg: #ffffff;
      --accent-soft: #eef0fd;
      --danger: #b91c1c;
      --danger-fg: #ffffff;
      --danger-soft: #fdecec;
      --danger-border: #f3c6c6;
      --success: #15803d;
      --success-soft: #e7f7ec;
      --success-border: #bfe6cc;
      --status-pending-bg: #eef0f3;   --status-pending-fg: #475569;
      --status-claimed-bg: #dbeafe;   --status-claimed-fg: #1d4ed8;
      --status-completed-bg: #dcfce7; --status-completed-fg: #15803d;
      --status-cancelled-bg: #fee2e2; --status-cancelled-fg: #b91c1c;
      --priority-urgent: #b91c1c;
      --priority-high: #c2410c;
      --priority-normal: var(--fg);
      --priority-low: var(--muted);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0c0e13;
        --surface: #151822;
        --fg: #e7e9ee;
        --muted: #9aa3b2;
        --border: #262b37;
        --accent: #a5b4fc;
        --accent-fg: #0c0e13;
        --accent-soft: #1c2140;
        --danger: #fca5a5;
        --danger-fg: #2a0a0a;
        --danger-soft: #2a1414;
        --danger-border: #4a2323;
        --success: #86efac;
        --success-soft: #12291b;
        --success-border: #234a30;
        --status-pending-bg: #1b202a;   --status-pending-fg: #9aa5b1;
        --status-claimed-bg: #16233d;   --status-claimed-fg: #93c5fd;
        --status-completed-bg: #10291c; --status-completed-fg: #86efac;
        --status-cancelled-bg: #331414; --status-cancelled-fg: #fca5a5;
        --priority-urgent: #fca5a5;
        --priority-high: #fdba74;
        --priority-normal: var(--fg);
        --priority-low: var(--muted);
      }
    }

    * { box-sizing: border-box; }
    body { font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: var(--bg); color: var(--fg); }
    .page { max-width: 60rem; margin: 0 auto; padding: 1.5rem var(--gap) 4rem; }

    header.top { background: var(--surface); border-bottom: 1px solid var(--border); padding: 1rem var(--gap); }
    header.top .brand { max-width: 60rem; margin: 0 auto; font-weight: 700; font-size: 1.15rem; letter-spacing: -0.01em; }

    /* Never remove the focus ring; make it unmissable instead. */
    :focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

    h1 { font-size: 1.5rem; margin: 0 0 0.25rem; letter-spacing: -0.01em; }
    h2 { font-size: 1.1rem; margin-top: 2rem; }

    table { border-collapse: collapse; width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
    caption { caption-side: top; text-align: left; font-weight: 600; color: var(--muted); font-size: 0.85rem; padding: 0.75rem 1rem; }
    th, td { text-align: left; padding: 0.7rem 1rem; border-bottom: 1px solid var(--border); }
    tbody tr:last-child td, tbody tr:last-child th { border-bottom: none; }
    tbody tr:hover { background: var(--accent-soft); }
    th[scope="row"] a { color: var(--fg); font-weight: 600; text-decoration: none; }
    th[scope="row"] a:hover { color: var(--accent); text-decoration: underline; }

    .status { display: inline-block; padding: 0.15rem 0.65rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600; text-transform: capitalize; }
    .status[data-status="pending"]   { background: var(--status-pending-bg);   color: var(--status-pending-fg); }
    .status[data-status="claimed"]   { background: var(--status-claimed-bg);   color: var(--status-claimed-fg); }
    .status[data-status="completed"] { background: var(--status-completed-bg); color: var(--status-completed-fg); }
    .status[data-status="cancelled"] { background: var(--status-cancelled-bg); color: var(--status-cancelled-fg); }

    .priority { font-weight: 600; }
    .priority[data-priority="urgent"] { color: var(--priority-urgent); }
    .priority[data-priority="high"]   { color: var(--priority-high); }
    .priority[data-priority="normal"] { color: var(--priority-normal); font-weight: 400; }
    .priority[data-priority="low"]    { color: var(--priority-low); font-weight: 400; }

    .flash { padding: 0.85rem 1rem; border-radius: var(--radius); margin-block: var(--gap); font-weight: 500; border: 1px solid transparent; }
    .flash[data-tone="error"]   { color: var(--danger);  background: var(--danger-soft);  border-color: var(--danger-border); }
    .flash[data-tone="success"] { color: var(--success); background: var(--success-soft); border-color: var(--success-border); }

    button, .btn { font: inherit; padding: 0.55rem 1.1rem; cursor: pointer; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--fg); }
    button:hover, .btn:hover { border-color: var(--accent); }
    .btn-primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); font-weight: 600; }
    .btn-primary:hover { filter: brightness(1.08); }
    .btn-danger { background: var(--danger-soft); color: var(--danger); border-color: var(--danger-border); }
    .btn-danger:hover { background: var(--danger); color: var(--danger-fg); }

    fieldset { border: 1px solid var(--border); border-radius: var(--radius); margin-block: var(--gap); padding: 1rem; background: var(--surface); }
    legend { font-weight: 600; padding: 0 0.4rem; }
    label { font-weight: 500; }
    .radio-option { display: inline-flex; align-items: center; margin-right: 1.25rem; font-weight: 400; cursor: pointer; }
    input[type="radio"] { margin-right: 0.35rem; }
    input[type="text"], textarea, select {
      font: inherit; padding: 0.5rem 0.65rem; border-radius: 6px; border: 1px solid var(--border);
      background: var(--bg); color: var(--fg); width: 100%; max-width: 32rem;
    }

    .hint { font-size: 0.85rem; color: var(--muted); }

    dl.meta { display: grid; grid-template-columns: max-content 1fr; gap: 0.4rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem 1.25rem; margin-block: 1rem; }
    dl.meta dt { color: var(--muted); font-weight: 500; }
    dl.meta dd { margin: 0; }

    nav a { color: var(--accent); text-decoration: none; font-weight: 500; }
    nav a:hover { text-decoration: underline; }

    .skip { position: absolute; left: -999px; top: 0; }
    .skip:focus { left: 0.5rem; top: 0.5rem; z-index: 10; background: var(--surface); color: var(--fg); padding: 0.5rem 1rem; border-radius: 6px; box-shadow: 0 2px 10px rgba(0, 0, 0, .2); }
    .visually-hidden {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }

    @media (prefers-reduced-motion: no-preference) {
      .flash { transition: opacity 0.2s; }
      button, .btn { transition: filter .15s, border-color .15s; }
    }
  </style>
</head>
<body>
  <a href="#main" class="skip">Skip to content</a>
  <header class="top"><div class="brand">Workflow Inbox</div></header>

  <div class="page">
    <!-- Announced by screen readers after a redirect, without stealing focus. -->
    <div role="status" aria-live="polite">
      ${flash ? `<p class="flash" data-tone="${flash.tone}">${esc(flash.text)}</p>` : ''}
    </div>

    <main id="main" tabindex="-1">
      ${opts.body}
    </main>
  </div>

  <script type="module">
    // Guard against a double-click while the round-trip is in flight. The server is already
    // safe; this just removes the confusing second spinner.
    for (const form of document.querySelectorAll('form[method="post"]')) {
      form.addEventListener('submit', () => {
        for (const button of form.querySelectorAll('button[type="submit"]')) {
          button.disabled = true;
          button.textContent = 'Working…';
        }
      }, { once: true });
    }
  </script>
</body>
</html>`;
}
