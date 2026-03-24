import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.config', 'omniroute');
const db = new Database(path.join(DATA_DIR, 'storage.sqlite'));

const updatedCombos = [
  {
    name: 'auto/pro-claude',
    strategy: 'fallback',
    timeout_ms: 15000,
    models: [
      { provider: 'antigravity', model: 'claude-sonnet-4-6', weight: 5 },
      { provider: 'antigravity', model: 'claude-sonnet-4-5', weight: 5 },
      { provider: 'zai', model: 'claude-3-7-sonnet-20250219', weight: 3 },
      { provider: 'openai-compatible-chat', model: 'claude-3-7-sonnet-20250219', weight: 2 },
      { provider: 'kiro', model: 'claude-sonnet-4', weight: 2 },
      { provider: 'anthropic', model: 'claude-sonnet-4-6', weight: 1 },
    ]
  },
  {
    name: 'auto/pro-chat',
    strategy: 'fallback', 
    timeout_ms: 12000,
    models: [
      { provider: 'antigravity', model: 'claude-sonnet-4-6', weight: 5 },
      { provider: 'antigravity', model: 'gemini-2.5-pro', weight: 4 },
      { provider: 'antigravity', model: 'claude-sonnet-4-5', weight: 4 },
      { provider: 'zai', model: 'claude-3-7-sonnet-20250219', weight: 3 },
      { provider: 'openai-compatible-chat', model: 'claude-3-7-sonnet-20250219', weight: 2 },
      { provider: 'glm', model: 'glm-4-plus', weight: 2 },
      { provider: 'kiro', model: 'claude-sonnet-4', weight: 2 },
      { provider: 'anthropic', model: 'claude-sonnet-4-6', weight: 1 },
      { provider: 'xai', model: 'grok-2', weight: 1 },
    ]
  },
  {
    name: 'auto/pro-coding',
    strategy: 'fallback',
    timeout_ms: 20000,
    models: [
      { provider: 'antigravity', model: 'claude-sonnet-4-6', weight: 5 },
      { provider: 'kimi-coding', model: 'kimi-k2-5', weight: 4 },
      { provider: 'antigravity', model: 'claude-sonnet-4-5', weight: 4 },
      { provider: 'nvidia', model: 'moonshotai/kimi-k2.5', weight: 3 },
      { provider: 'zai', model: 'claude-3-7-sonnet-20250219', weight: 3 },
      { provider: 'openai-compatible-chat', model: 'claude-3-7-sonnet-20250219', weight: 2 },
      { provider: 'anthropic', model: 'claude-sonnet-4-6', weight: 1 },
    ]
  },
  {
    name: 'auto/chat',
    strategy: 'priority',
    timeout_ms: 10000,
    models: [
      { provider: 'antigravity', model: 'claude-sonnet-4-6', weight: 5 },
      { provider: 'antigravity', model: 'gemini-2.5-flash', weight: 5 },
      { provider: 'antigravity', model: 'claude-sonnet-4-5', weight: 4 },
      { provider: 'ollama-cloud', model: 'deepseek-v3.2', weight: 3 },
      { provider: 'zai', model: 'claude-3-7-sonnet-20250219', weight: 3 },
      { provider: 'glm', model: 'glm-4-plus', weight: 2 },
      { provider: 'kiro', model: 'claude-sonnet-4', weight: 2 },
      { provider: 'xai', model: 'grok-2', weight: 1 },
    ]
  },
  {
    name: 'auto/fast',
    strategy: 'priority',
    timeout_ms: 5000,
    models: [
      { provider: 'antigravity', model: 'gemini-2.5-flash', weight: 5 },
      { provider: 'antigravity', model: 'claude-haiku-4-5', weight: 4 },
      { provider: 'ollama-cloud', model: 'gemma3:27b', weight: 3 },
      { provider: 'glm', model: 'glm-4-flash', weight: 2 },
    ]
  }
];

const stmt = db.prepare(`
  INSERT INTO combos (id, name, data, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(name) DO UPDATE SET
    data = excluded.data,
    updated_at = excluded.updated_at
`);

const now = new Date().toISOString();

for (const combo of updatedCombos) {
  const id = crypto.randomUUID();
  const data = JSON.stringify({
    id,
    name: combo.name,
    strategy: combo.strategy,
    timeout_ms: combo.timeout_ms,
    models: combo.models.map(m => ({ model: `${m.provider}/${m.model}`, weight: m.weight }))
  });
  
  stmt.run(id, combo.name, data, now, now);
  console.log(`Updated combo: ${combo.name} (${combo.strategy} strategy)`);
}

console.log('\nCombo update complete!');
db.close();
