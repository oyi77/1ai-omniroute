import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.config', 'omniroute');
const db = new Database(path.join(DATA_DIR, 'storage.sqlite'));

const combos = [
  {
    name: '1ai/claude-premium',
    strategy: 'fallback',
    timeout_ms: 20000,
    description: 'Premium Claude access with multi-provider fallback',
    models: [
      { provider: 'antigravity', model: 'claude-sonnet-4-6', weight: 5 },
      { provider: 'antigravity', model: 'claude-sonnet-4-5', weight: 5 },
      { provider: 'antigravity', model: 'claude-opus-4', weight: 4 },
      { provider: 'zai', model: 'claude-3-7-sonnet-20250219', weight: 3 },
      { provider: 'kiro', model: 'claude-sonnet-4', weight: 3 },
      { provider: 'openai-compatible-chat', model: 'claude-3-7-sonnet-20250219', weight: 2 },
      { provider: 'anthropic', model: 'claude-sonnet-4-6', weight: 1 },
    ]
  },
  {
    name: '1ai/gpt-premium',
    strategy: 'fallback',
    timeout_ms: 15000,
    description: 'Premium GPT-4o access with fallback',
    models: [
      { provider: 'antigravity', model: 'gpt-4o', weight: 5 },
      { provider: 'antigravity', model: 'gpt-4o-mini', weight: 4 },
      { provider: 'zai', model: 'gpt-4o', weight: 3 },
      { provider: 'openai-compatible-chat', model: 'gpt-4o', weight: 2 },
    ]
  },
  {
    name: '1ai/coding-pro',
    strategy: 'fallback',
    timeout_ms: 25000,
    description: 'Optimized for coding tasks with extended context',
    models: [
      { provider: 'antigravity', model: 'claude-sonnet-4-6', weight: 5 },
      { provider: 'kimi-coding', model: 'kimi-k2-5', weight: 5 },
      { provider: 'nvidia', model: 'moonshotai/kimi-k2.5', weight: 4 },
      { provider: 'antigravity', model: 'claude-sonnet-4-5', weight: 4 },
      { provider: 'antigravity', model: 'deepseek-v3', weight: 3 },
      { provider: 'zai', model: 'claude-3-7-sonnet-20250219', weight: 3 },
      { provider: 'ollama-cloud', model: 'deepseek-v3.2', weight: 2 },
    ]
  },
  {
    name: '1ai/reasoning-pro',
    strategy: 'fallback',
    timeout_ms: 30000,
    description: 'For complex reasoning and analysis tasks',
    models: [
      { provider: 'antigravity', model: 'claude-opus-4', weight: 5 },
      { provider: 'antigravity', model: 'o3-mini', weight: 4 },
      { provider: 'antigravity', model: 'claude-sonnet-4-6', weight: 4 },
      { provider: 'nvidia', model: 'moonshotai/kimi-k2-thinking', weight: 3 },
      { provider: 'ollama-cloud', model: 'deepseek-r1', weight: 2 },
    ]
  },
  {
    name: '1ai/vision-pro',
    strategy: 'fallback',
    timeout_ms: 15000,
    description: 'For image understanding and vision tasks',
    models: [
      { provider: 'antigravity', model: 'claude-sonnet-4-6', weight: 5 },
      { provider: 'antigravity', model: 'gemini-2.5-pro', weight: 4 },
      { provider: 'antigravity', model: 'gpt-4o', weight: 4 },
      { provider: 'glm', model: 'glm-4v-plus', weight: 3 },
      { provider: 'gemini', model: 'gemini-1.5-pro', weight: 2 },
    ]
  },
  {
    name: '1ai/general-pro',
    strategy: 'fallback',
    timeout_ms: 15000,
    description: 'Best all-purpose models with automatic fallback',
    models: [
      { provider: 'antigravity', model: 'claude-sonnet-4-6', weight: 5 },
      { provider: 'antigravity', model: 'gemini-2.5-pro', weight: 4 },
      { provider: 'antigravity', model: 'gpt-4o', weight: 4 },
      { provider: 'zai', model: 'claude-3-7-sonnet-20250219', weight: 3 },
      { provider: 'kimi-coding', model: 'kimi-k2-5', weight: 3 },
      { provider: 'glm', model: 'glm-4-plus', weight: 2 },
      { provider: 'xai', model: 'grok-2', weight: 2 },
    ]
  },
  {
    name: '1ai/fast-pro',
    strategy: 'priority',
    timeout_ms: 8000,
    description: 'Fast responses with good quality',
    models: [
      { provider: 'antigravity', model: 'gemini-2.5-flash', weight: 5 },
      { provider: 'antigravity', model: 'claude-haiku-4-5', weight: 4 },
      { provider: 'antigravity', model: 'gpt-4o-mini', weight: 4 },
      { provider: 'ollama-cloud', model: 'gemma3:27b', weight: 3 },
      { provider: 'glm', model: 'glm-4-flash', weight: 2 },
    ]
  },
  {
    name: '1ai/economy',
    strategy: 'priority',
    timeout_ms: 10000,
    description: 'Cost-effective for everyday tasks',
    models: [
      { provider: 'antigravity', model: 'gpt-4o-mini', weight: 5 },
      { provider: 'ollama-cloud', model: 'gemma3:27b', weight: 4 },
      { provider: 'ollama-cloud', model: 'qwen2.5:14b', weight: 3 },
      { provider: 'glm', model: 'glm-4-flash', weight: 3 },
      { provider: 'antigravity', model: 'claude-haiku-4-5', weight: 2 },
    ]
  },
  {
    name: '1ai/ultra-fast',
    strategy: 'priority',
    timeout_ms: 5000,
    description: 'Ultra fast responses for simple queries',
    models: [
      { provider: 'antigravity', model: 'gemini-2.5-flash', weight: 5 },
      { provider: 'glm', model: 'glm-4-flash', weight: 4 },
      { provider: 'ollama-cloud', model: 'gemma3:4b', weight: 3 },
    ]
  },
];

const stmt = db.prepare(`
  INSERT INTO combos (id, name, data, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(name) DO UPDATE SET
    data = excluded.data,
    updated_at = excluded.updated_at
`);

const now = new Date().toISOString();

for (const combo of combos) {
  const id = crypto.randomUUID();
  const data = JSON.stringify({
    id,
    name: combo.name,
    strategy: combo.strategy,
    timeout_ms: combo.timeout_ms,
    models: combo.models.map(m => ({ model: `${m.provider}/${m.model}`, weight: m.weight }))
  });
  
  stmt.run(id, combo.name, data, now, now);
  console.log(`Created/Updated combo: ${combo.name} (${combo.strategy}) - ${combo.description}`);
}

console.log('\nAll 1ai combos updated successfully!');
db.close();
