import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const sourceConfig = new URL('../wrangler.toml', import.meta.url);
const outPath = process.env.WRANGLER_CONFIG_OUT || 'wrangler.deploy.generated.toml';
const workerName = process.env.FILECUBBY_WORKER_NAME || 'filecubby';
const namespacePrefix = process.env.FILECUBBY_NAMESPACE_PREFIX || workerName;

const kvBindings = [
  ['TASKS', 'tasks'],
  ['USERS', 'users'],
  ['FILES', 'files'],
  ['FILE_DOWNLOAD_INFO', 'download-info'],
];

function runWrangler(args, options = {}) {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'],
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(output || `wrangler ${args.join(' ')} failed`);
  }
  return result.stdout?.trim() ?? '';
}

function namespaceList() {
  return JSON.parse(runWrangler(['kv', 'namespace', 'list'], { capture: true }));
}

function createNamespace(title) {
  const output = runWrangler(['kv', 'namespace', 'create', title], { capture: true });
  const id = output.match(/id = "([^"]+)"/)?.[1];
  if (!id) throw new Error(`Could not parse created KV namespace id for ${title}`);
  return id;
}

function namespaceIds() {
  let namespaces = namespaceList();
  const ids = new Map();

  for (const [binding, suffix] of kvBindings) {
    const title = `${namespacePrefix}-${suffix}`;
    let namespace = namespaces.find((entry) => entry.title === title);
    if (!namespace) {
      try {
        console.log(`Creating KV namespace ${title}.`);
        const id = createNamespace(title);
        ids.set(binding, id);
        continue;
      } catch (error) {
        if (!String(error.message).includes('already exists')) throw error;
        namespaces = namespaceList();
        namespace = namespaces.find((entry) => entry.title === title);
        if (!namespace) throw error;
      }
    }

    console.log(`Using KV namespace ${title} (${namespace.id}).`);
    ids.set(binding, namespace.id);
  }

  return ids;
}

function injectKvIds(configText, ids) {
  const kvBlocks = kvBindings.map(([binding]) => {
    const id = ids.get(binding);
    if (!id) throw new Error(`Missing KV namespace id for ${binding}`);
    return `[[kv_namespaces]]\nbinding = "${binding}"\nid = "${id}"\n`;
  }).join('\n');

  const withoutTemplateKv = configText
    .replace(/# KV namespaces[\s\S]*?before setup\.\n\n/, '')
    .replace(/\[\[kv_namespaces\]\][\s\S]*?(?=\n\[[^\[]|$)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();

  const varsIndex = withoutTemplateKv.indexOf('\n[vars]');
  if (varsIndex === -1) return `${withoutTemplateKv}\n\n${kvBlocks}\n`;

  return `${withoutTemplateKv.slice(0, varsIndex)}\n\n${kvBlocks}${withoutTemplateKv.slice(varsIndex)}\n`;
}

function main() {
  const outDir = outPath.includes('/') ? outPath.slice(0, outPath.lastIndexOf('/')) : '';
  if (outDir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const ids = namespaceIds();
  const configText = readFileSync(sourceConfig, 'utf8');
  writeFileSync(outPath, injectKvIds(configText, ids));
  console.log(`Wrote ${outPath}.`);

  runWrangler(['deploy', '--config', outPath]);
}

main();
