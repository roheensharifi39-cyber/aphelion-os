import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createServer } from 'vite';
import config from '../vite.config.ts';
import { Markdown } from '../src/components/Markdown.tsx';

describe('untrusted content privacy boundaries', () => {
  it('serves the browser preview without framing or cross-origin read permission', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aphelion-privacy-'));
    let server;
    try {
      await writeFile(join(root, 'index.html'), '<!doctype html><title>Privacy fixture</title>');
      server = await createServer({ ...config, configFile: false, root, plugins: [], server: { ...config.server, port: 0 }, logLevel: 'silent' });
      await server.listen();
      expect(server.httpServer.address().address).toBe('127.0.0.1');
      const response = await fetch('http://127.0.0.1:' + server.httpServer.address().port, { headers: { Origin: 'https://untrusted.example' } });
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    } finally {
      await server?.close();
      expect(resolve(root).startsWith(resolve(tmpdir()) + sep + 'aphelion-privacy-')).toBe(true);
      await rm(root, { recursive: true, force: true });
    }
  }, 15000);
  it('renders note HTML and script links as inert text', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { children: '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[run](javascript:alert(1))' }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
  });
});
