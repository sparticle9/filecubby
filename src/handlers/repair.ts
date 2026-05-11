import { Context } from 'hono'
import { Env } from '../index'
import { DEFAULT_NAMESPACE_ID, ObjectMetadata, getObjectMetadata, saveObjectMetadata } from '../db'
import { TELEGRAM_BACKEND, filecubbyMarker } from '../utils/metadata'

interface ImportChunk {
  chunkId: string;
  index: number;
  total: number;
  fileUniqueId?: string;
  messageId?: number;
  name?: string;
  type?: string;
}

export async function importTelegramMetadata(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  const overwrite = body.overwrite === true;
  const limit = clamp(parseInt(String(body.limit || '100'), 10), 1, 100);
  const offset = Number.isFinite(Number(body.offset)) ? Number(body.offset) : undefined;
  const marker = filecubbyMarker(c.env);

  const url = new URL(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/getUpdates`);
  url.searchParams.set('limit', String(limit));
  if (offset !== undefined) {
    url.searchParams.set('offset', String(offset));
  }

  const response = await fetch(url.toString());
  const payload: any = await response.json();
  if (!payload.ok) {
    return c.json({ Code: 0, Message: `Telegram getUpdates failed: ${payload.description || response.statusText}` }, 502);
  }

  const manifests = new Map<string, { messageId?: number; data: any }>();
  const chunks = new Map<string, ImportChunk[]>();
  let scanned = 0;
  let nextOffset: number | undefined;

  for (const update of payload.result || []) {
    scanned += 1;
    if (typeof update.update_id === 'number') {
      nextOffset = update.update_id + 1;
    }
    const message = update.message || update.channel_post || update.edited_message || update.edited_channel_post;
    if (!message) continue;

    const text = typeof message.text === 'string' ? message.text : '';
    const caption = typeof message.caption === 'string' ? message.caption : '';
    const manifest = parseTaggedPayload(text, marker, 'manifest');
    if (manifest?.id) {
      manifests.set(manifest.id, { messageId: message.message_id, data: manifest });
    }

    const chunk = parseTaggedPayload(caption, marker, 'chunk');
    const document = message.document;
    if (chunk?.id && document?.file_id) {
      const list = chunks.get(chunk.id) || [];
      list.push({
        chunkId: document.file_id,
        fileUniqueId: document.file_unique_id,
        messageId: message.message_id,
        index: Math.max(0, Number(chunk.part || 1) - 1),
        total: Number(chunk.total || 1),
        name: document.file_name,
        type: document.mime_type,
      });
      chunks.set(chunk.id, list);
    }
  }

  const imported: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const [id, manifest] of manifests) {
    const existing = await getObjectMetadata(c.env.FILES, id);
    if (existing && !overwrite) {
      skipped.push({ id, reason: 'metadata exists' });
      continue;
    }

    const fileChunks = (chunks.get(id) || []).sort((a, b) => a.index - b.index);
    const total = Number(manifest.data.chunks || fileChunks[0]?.total || 0);
    if (!total || fileChunks.length < total) {
      skipped.push({ id, reason: `incomplete chunks ${fileChunks.length}/${total || '?'}` });
      continue;
    }

    const chunkIds = new Array(total).fill(null);
    const chunkMessageIds = new Array(total).fill(null);
    for (const chunk of fileChunks) {
      if (chunk.index >= 0 && chunk.index < total) {
        chunkIds[chunk.index] = chunk.chunkId;
        chunkMessageIds[chunk.index] = chunk.messageId || null;
      }
    }
    if (chunkIds.some(id => !id)) {
      skipped.push({ id, reason: 'missing chunk indexes' });
      continue;
    }

    const now = new Date().toISOString();
    const metadata: ObjectMetadata = {
      namespaceId: DEFAULT_NAMESPACE_ID,
      id,
      userId: 'imported',
      name: String(manifest.data.name || fileChunks[0]?.name || id),
      size: Number(manifest.data.size || 0),
      chunks: total,
      chunkSize: Number(manifest.data.chunkSize || 0) || undefined,
      chunkIds,
      chunkMessageIds,
      manifestMessageId: manifest.messageId,
      expiresAt: manifest.data.expiresAt || null,
      type: String(manifest.data.type || fileChunks[0]?.type || 'application/octet-stream'),
      uploadedAt: validDate(manifest.data.uploadedAt) || now,
      updatedAt: now,
      path: String(manifest.data.path || '/'),
      tags: Array.isArray(manifest.data.tags) ? manifest.data.tags : [],
      collectionIds: Array.isArray(manifest.data.collectionIds) ? manifest.data.collectionIds : [],
      description: typeof manifest.data.description === 'string' ? manifest.data.description : undefined,
      backend: TELEGRAM_BACKEND,
      createdByTokenId: 'imported',
    };

    if (!dryRun) {
      await saveObjectMetadata(c.env.FILES, metadata);
    }
    imported.push(id);
  }

  return c.json({
    Code: 1,
    Message: dryRun ? 'Telegram import dry run complete' : 'Telegram import complete',
    scanned,
    imported,
    skipped,
    nextOffset,
  });
}

function parseTaggedPayload(value: string, marker: string, kind: 'manifest' | 'chunk'): any | null {
  const prefix = `${marker}:${kind}:v1`;
  const index = value.indexOf(prefix);
  if (index !== -1) {
    let payload = value.slice(index + prefix.length).trim();
    if (payload.startsWith('\n')) {
      payload = payload.trimStart();
    }
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }

  const oneLiner = parseOneLiner(value, marker);
  if (oneLiner && kind === 'manifest' && (oneLiner.kind === 'file' || oneLiner.kind === 'manifest')) {
    return parseHumanManifest(value, marker);
  }
  if (oneLiner && kind === 'chunk' && oneLiner.kind.startsWith('chunk-')) {
    const parsed = parseHumanChunk(value, marker);
    if (parsed) return parsed;
    const match = oneLiner.kind.match(/^chunk-(\d+)-of-(\d+)$/);
    return match ? { id: oneLiner.id, part: parseInt(match[1], 10), total: parseInt(match[2], 10) } : null;
  }

  if (kind === 'manifest' && value.startsWith(`${marker} file\n`)) {
    return parseHumanManifest(value, marker);
  }
  if (kind === 'chunk' && value.startsWith(`${marker} chunk `)) {
    return parseHumanChunk(value, marker);
  }
  return null;
}

function parseHumanManifest(value: string, marker: string): any | null {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const oneLiner = parseOneLiner(value, marker);
  const legacy = lines[0] === `${marker} file`;
  if (!legacy && !oneLiner) return null;

  const fields = parseLabelLines(lines.slice(legacy ? 2 : 1));
  const id = fields.id || oneLiner?.id;
  if (!id) return null;
  return {
    id,
    namespaceId: fields.namespace || DEFAULT_NAMESPACE_ID,
    name: fields.name || (legacy ? lines[1] : oneLiner?.name || id),
    path: fields.path || '/',
    tags: parseTags(fields.tags),
    size: parseByteLabel(fields.size),
    chunks: parseInt(fields.chunks || '1', 10),
  };
}

function parseHumanChunk(value: string, marker: string): any | null {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const oneLiner = parseOneLiner(value, marker);
  const legacyMatch = lines[0]?.match(new RegExp(`^${escapeRegExp(marker)} chunk (\\d+)/(\\d+)$`));
  const oneLinerMatch = oneLiner?.kind.match(/^chunk-(\d+)-of-(\d+)$/);
  const match = legacyMatch || oneLinerMatch;
  if (!match) return null;

  const fields = parseLabelLines(lines.slice(legacyMatch ? 2 : 1));
  const id = fields.id || oneLiner?.id;
  if (!id) return null;
  return {
    id,
    namespaceId: fields.namespace || DEFAULT_NAMESPACE_ID,
    part: parseInt(match[1], 10),
    total: parseInt(match[2], 10),
    name: legacyMatch ? lines[1] : oneLiner?.name || id,
    path: fields.path || '/',
    tags: parseTags(fields.tags),
  };
}

function parseOneLiner(value: string, marker: string): { id: string; name: string; kind: string } | null {
  const line = value.split(/\r?\n/, 1)[0]?.trim();
  const prefix = `${marker} `;
  if (!line?.startsWith(prefix)) return null;
  const compact = line.slice(prefix.length).replace(/^recovery\s+/, '');
  const lastDash = compact.lastIndexOf('-');
  if (lastDash === -1) return null;
  const subject = compact.slice(0, lastDash);
  const kind = compact.slice(lastDash + 1);
  const firstDot = subject.indexOf('.');
  const secondDot = subject.indexOf('.', firstDot + 1);
  if (firstDot === -1 || secondDot === -1) return null;
  return {
    id: subject.slice(0, firstDot),
    name: subject.slice(firstDot + 1, secondDot).replace(/_/g, ' '),
    kind,
  };
}

function parseLabelLines(lines: string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return fields;
}

function parseTags(value: string | undefined): string[] {
  if (!value || value === '-') return [];
  return value.split(',').map(tag => tag.trim()).filter(Boolean);
}

function parseByteLabel(value: string | undefined): number {
  if (!value) return 0;
  const match = value.match(/^([\d.]+)\s*(B|KiB|MiB|GiB|TiB)$/i);
  if (!match) return parseInt(value, 10) || 0;
  const amount = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 'tib' ? 1024 ** 4 : unit === 'gib' ? 1024 ** 3 : unit === 'mib' ? 1024 ** 2 : unit === 'kib' ? 1024 : 1;
  return Math.round(amount * multiplier);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return isNaN(Date.parse(value)) ? null : value;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.max(min, Math.min(max, value));
}
