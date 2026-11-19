// Tiny OpenAI-compatible stub LLM server (node, no dependencies).
// Implements POST /v1/chat/completions with SSE streaming and plain JSON,
// always returning the canned assistant message. Used by the Aegis boot
// test so OpenDots can complete a real agent turn with only a dummy
// provider key. If STUB_LOG is set, each request's model is appended to
// that file so tests can verify which model the server actually called.
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CANNED_REPLY = 'Hello from the Aegis stub.';

export function createStubServer() {
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname.endsWith('/models')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [] }));
      return;
    }
    if (
      request.method !== 'POST' ||
      !url.pathname.endsWith('/chat/completions')
    ) {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Not found.' }));
      return;
    }
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        // Keep the stub permissive; a malformed body still gets a reply.
      }
      if (process.env.STUB_LOG)
        appendFileSync(process.env.STUB_LOG, `${body.model ?? ''}\n`);
      const model = body.model ?? 'stub-model';
      if (body.stream) {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        const chunk = (delta, finishReason = null) =>
          `data: ${JSON.stringify({
            id: 'chatcmpl-stub',
            object: 'chat.completion.chunk',
            created: 1,
            model,
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          })}\n\n`;
        response.write(chunk({ role: 'assistant', content: '' }));
        response.write(chunk({ content: 'Hello from the ' }));
        response.write(chunk({ content: 'Aegis stub.' }));
        response.write(chunk({}, 'stop'));
        response.end('data: [DONE]\n\n');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'chatcmpl-stub',
          object: 'chat.completion',
          created: 1,
          model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: CANNED_REPLY },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.STUB_PORT ?? 24390);
  createStubServer().listen(port, '127.0.0.1', () => {
    console.log(`STUB_READY ${port}`);
  });
}
