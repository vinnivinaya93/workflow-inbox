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
    :root { color-scheme: light dark; --gap: 1rem; --line: color-mix(in srgb, currentColor 20%, transparent); }
    body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 60rem; padding: var(--gap); }
    /* Never remove the focus ring; make it unmissable instead. */
    :focus-visible { outline: 3px solid Highlight; outline-offset: 2px; }
    table { border-collapse: collapse; width: 100%; }
    caption { text-align: left; font-weight: 600; padding-block: 0.5rem; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--line); }
    .status { display: inline-block; padding: 0.1rem 0.5rem; border: 1px solid var(--line); border-radius: 999px; font-size: 0.85rem; }
    .flash { padding: 0.75rem 1rem; border-left: 4px solid currentColor; margin-block: var(--gap); }
    .flash[data-tone="error"] { color: #b3261e; }
    .flash[data-tone="success"] { color: #1b5e20; }
    button { font: inherit; padding: 0.4rem 0.9rem; cursor: pointer; }
    fieldset { border: 1px solid var(--line); margin-block: var(--gap); }
    .hint { font-size: 0.875rem; opacity: 0.8; }
    .skip { position: absolute; left: -999px; top: 0; }
    .skip:focus { left: 0.5rem; top: 0.5rem; z-index: 1; background: Canvas; color: CanvasText; padding: 0.5rem 1rem; }
    .visually-hidden {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }
    @media (prefers-reduced-motion: no-preference) { .flash { transition: opacity 0.2s; } }
  </style>
</head>
<body>
  <a href="#main" class="skip">Skip to content</a>
  <header><strong>Workflow Inbox</strong></header>

  <!-- Announced by screen readers after a redirect, without stealing focus. -->
  <div role="status" aria-live="polite">
    ${flash ? `<p class="flash" data-tone="${flash.tone}">${esc(flash.text)}</p>` : ''}
  </div>

  <main id="main" tabindex="-1">
    ${opts.body}
  </main>

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
