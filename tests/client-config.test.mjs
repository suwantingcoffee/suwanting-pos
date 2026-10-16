import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = await readFile(new URL('../frontend/src/lib/supabase-config.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
const { validateSupabaseConfig: validate } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const key = 'sb_publishable_development_public_key';
const jwt = role => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
test('client accepts public keys and localhost; missing config remains optional', () => {
  assert.equal(validate(), null);
  assert.equal(validate('https://example.supabase.co', key).url, 'https://example.supabase.co');
  assert.ok(validate('http://127.0.0.1:54321', jwt('anon')));
});
test('client rejects server secrets, incomplete config, insecure and credential URLs', () => {
  for (const value of ['sb_secret_server_key', jwt('service_role'), 'eyJbroken', 'invalid']) {
    assert.throws(() => validate('https://example.supabase.co', value));
  }
  for (const url of ['http://remote.test', 'https://user:password@remote.test', 'ftp://localhost', 'https://remote.test?key=1']) {
    assert.throws(() => validate(url, key));
  }
  assert.throws(() => validate('https://example.supabase.co'));
});
