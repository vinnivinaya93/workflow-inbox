import type { InboxItemListResult } from '../../../application/use-cases/ListInboxItems.js';
import { attr, esc } from '../escape.js';
import { layout } from './layout.js';

const DUE_FORMAT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function inboxListPage(opts: {
  result: InboxItemListResult;
  actor: string;
  status: string;
  flashCode?: string | undefined;
}): string {
  const { items, nextCursor } = opts.result;

  const rows = items
    .map(
      (item) => `
      <tr>
        <th scope="row"><a href="/items/${attr(item.id)}">${esc(item.title)}</a></th>
        <td>${esc(item.kindLabel)}</td>
        <td>${esc(item.priority)}</td>
        <td><span class="status">${esc(item.status)}</span></td>
        <td>${item.dueAt ? `<time datetime="${attr(item.dueAt)}">${esc(DUE_FORMAT.format(new Date(item.dueAt)))}</time>` : '—'}</td>
        <td>${
          item.availableActions.includes('complete')
            ? `<a href="/items/${attr(item.id)}">Open<span class="visually-hidden"> ${esc(item.title)}</span></a>`
            : esc(item.completion?.outcome ?? item.status)
        }</td>
      </tr>`,
    )
    .join('');

  const body = `
    <h1>Pending actions</h1>
    <p class="hint">Signed in as <strong>${esc(opts.actor)}</strong>.</p>

    <form method="get" action="/">
      <fieldset>
        <legend>Filter</legend>
        <label for="status">Status</label>
        <select id="status" name="status">
          ${['open', 'pending', 'claimed', 'completed', 'cancelled']
            .map((s) => `<option value="${attr(s)}"${s === opts.status ? ' selected' : ''}>${esc(s)}</option>`)
            .join('')}
        </select>
        <button type="submit">Apply</button>
      </fieldset>
    </form>

    ${
      items.length === 0
        ? `<p>Nothing needs your attention right now.</p>`
        : `<table>
             <caption>${items.length} item${items.length === 1 ? '' : 's'}${nextCursor ? ' (more available)' : ''}</caption>
             <thead>
               <tr>
                 <th scope="col">Action</th><th scope="col">Type</th><th scope="col">Priority</th>
                 <th scope="col">Status</th><th scope="col">Due</th><th scope="col"></th>
               </tr>
             </thead>
             <tbody>${rows}</tbody>
           </table>`
    }

    ${nextCursor ? `<p><a href="/?status=${attr(opts.status)}&cursor=${attr(nextCursor)}">Next page</a></p>` : ''}
  `;

  return layout({ title: 'Pending actions', flashCode: opts.flashCode, body });
}
