const CONSOLE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Filecubby Console</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f8fafc; color: #111827; }
    main { max-width: 1080px; margin: 0 auto; padding: 32px 20px 56px; }
    header { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
    h1 { font-size: 28px; margin: 0; }
    h2 { font-size: 18px; margin: 0 0 12px; }
    section { border: 1px solid #d1d5db; border-radius: 8px; padding: 16px; margin: 16px 0; background: #fff; }
    label { display: grid; gap: 6px; font-size: 13px; color: #374151; }
    input, textarea { border: 1px solid #cbd5e1; border-radius: 6px; padding: 9px 10px; font: inherit; background: #fff; color: inherit; }
    textarea { min-height: 72px; resize: vertical; }
    button { border: 1px solid #0f766e; border-radius: 6px; padding: 9px 12px; background: #0f766e; color: white; font: inherit; cursor: pointer; }
    button.secondary { color: #0f766e; background: #fff; }
    button.danger { border-color: #b91c1c; background: #b91c1c; }
    .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    .muted { color: #6b7280; font-size: 13px; }
    .status { min-height: 20px; margin-top: 10px; color: #374151; }
    @media (prefers-color-scheme: dark) {
      body { background: #020617; color: #e5e7eb; }
      section, input, textarea, button.secondary { background: #0f172a; color: #e5e7eb; }
      section, input, textarea, th, td { border-color: #334155; }
      label, .status { color: #cbd5e1; }
      .muted { color: #94a3b8; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Filecubby Console</h1>
        <div class="muted">Session-local token management and collection setup.</div>
      </div>
      <button class="secondary" id="refresh">Refresh</button>
    </header>

    <section>
      <h2>Access</h2>
      <div class="grid">
        <label>API base URL <input id="baseUrl" autocomplete="off"></label>
        <label>Bearer token <input id="token" type="password" autocomplete="off"></label>
      </div>
      <div class="actions">
        <button id="saveAccess">Use for session</button>
        <button class="secondary" id="clearAccess">Clear</button>
      </div>
      <div class="status" id="status"></div>
    </section>

    <section>
      <h2>Collections</h2>
      <div class="grid">
        <label>Name <input id="collectionName"></label>
        <label>Slug <input id="collectionSlug"></label>
        <label>Default path <input id="collectionPath" placeholder="/"></label>
        <label>Tags <input id="collectionTags" placeholder="audio, drafts"></label>
      </div>
      <label>Description <textarea id="collectionDescription"></textarea></label>
      <div class="actions"><button id="createCollection">Create collection</button></div>
      <table>
        <thead><tr><th>Name</th><th>Path</th><th>Tags</th><th>ID</th><th></th></tr></thead>
        <tbody id="collections"></tbody>
      </table>
    </section>

    <section>
      <h2>Service Tokens</h2>
      <div class="grid">
        <label>Name <input id="tokenName"></label>
        <label>Note <input id="tokenNote"></label>
      </div>
      <div class="actions"><button id="createToken">Create token</button></div>
      <table>
        <thead><tr><th>Name</th><th>Status</th><th>Note</th><th>ID</th><th></th></tr></thead>
        <tbody id="tokens"></tbody>
      </table>
    </section>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    const status = (message) => { $('status').textContent = message || ''; };
    $('baseUrl').value = sessionStorage.getItem('filecubby.baseUrl') || location.origin + '/api/';
    $('token').value = sessionStorage.getItem('filecubby.token') || '';

    function baseUrl() {
      const value = $('baseUrl').value.trim().replace(/\\/+$/, '');
      return value.endsWith('/api') ? value + '/' : value + '/api/';
    }
    function authHeaders(extra = {}) {
      return { Authorization: 'Bearer ' + $('token').value.trim(), ...extra };
    }
    async function api(path, options = {}) {
      const response = await fetch(baseUrl() + path.replace(/^\\//, ''), {
        ...options,
        headers: authHeaders(options.headers || {}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.Code === 0) throw new Error(body.Message || 'Request failed');
      return body;
    }
    async function refresh() {
      if (!$('token').value.trim()) return status('Enter a token first.');
      status('Loading...');
      await Promise.all([loadCollections(), loadTokens()]);
      status('Loaded.');
    }
    async function loadCollections() {
      const result = await api('collections');
      $('collections').innerHTML = result.collections.map((item) => '<tr><td>' + escapeHtml(item.name) + '</td><td><code>' + escapeHtml(item.path || '/') + '</code></td><td>' + escapeHtml((item.tags || []).join(', ')) + '</td><td><code>' + item.id + '</code></td><td><button class="danger" data-delete-collection="' + item.id + '">Delete</button></td></tr>').join('');
    }
    async function loadTokens() {
      const result = await api('tokens');
      $('tokens').innerHTML = result.tokens.map((item) => '<tr><td>' + escapeHtml(item.name) + '</td><td>' + (item.enabled ? 'enabled' : 'disabled') + '</td><td>' + escapeHtml(item.note || '') + '</td><td><code>' + item.id + '</code></td><td><button class="secondary" data-toggle-token="' + item.id + '" data-enabled="' + item.enabled + '">' + (item.enabled ? 'Disable' : 'Enable') + '</button></td></tr>').join('');
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    }

    $('saveAccess').onclick = () => {
      sessionStorage.setItem('filecubby.baseUrl', $('baseUrl').value.trim());
      sessionStorage.setItem('filecubby.token', $('token').value.trim());
      refresh().catch((error) => status(error.message));
    };
    $('clearAccess').onclick = () => {
      sessionStorage.removeItem('filecubby.baseUrl');
      sessionStorage.removeItem('filecubby.token');
      $('token').value = '';
      status('Cleared.');
    };
    $('refresh').onclick = () => refresh().catch((error) => status(error.message));
    $('createCollection').onclick = async () => {
      const body = {
        name: $('collectionName').value,
        slug: $('collectionSlug').value,
        path: $('collectionPath').value || '/',
        tags: $('collectionTags').value,
        description: $('collectionDescription').value,
      };
      await api('collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      $('collectionName').value = ''; $('collectionSlug').value = ''; $('collectionDescription').value = '';
      await refresh();
    };
    $('createToken').onclick = async () => {
      const result = await api('tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('tokenName').value, note: $('tokenNote').value }) });
      status('Created token. New value: ' + result.token);
      $('tokenName').value = ''; $('tokenNote').value = '';
      await loadTokens();
    };
    document.body.onclick = async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const collectionId = target.dataset.deleteCollection;
      if (collectionId) {
        await api('collections/' + collectionId, { method: 'DELETE' });
        await loadCollections();
      }
      const tokenId = target.dataset.toggleToken;
      if (tokenId) {
        await api('tokens/' + tokenId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: target.dataset.enabled !== 'true' }) });
        await loadTokens();
      }
    };
  </script>
</body>
</html>`;

export function consoleHandler(c: any) {
  return c.html(CONSOLE_HTML);
}
