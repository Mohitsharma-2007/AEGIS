import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../src/client/api', () => ({ api: vi.fn() }));
import {
  BrowserActivityCard,
  MemorySourcesCard,
  ProviderStatusCard,
  browseEngineLabel,
} from '../src/client/GenerativeCards';
import { ComputerToolCard } from '../src/client/ComputerToolCard';

// Fixtures are shaped like the real payloads: the read_public_page
// browser result (research.ts browserResponse + dot-agent.ts return),
// the GET /api/providers response (app.ts + shared ProviderOption /
// CatalogueProviderOption), and the daemon memory search response
// enriched by the show_memory_sources handler in Chat.tsx.

it('renders a browser activity card with the engine label and inline screenshot', () => {
  const html = renderToStaticMarkup(
    <BrowserActivityCard
      name="read_public_page"
      toolCallId="browse-1"
      status="complete"
      args={{ url: 'https://example.com/' }}
      result={JSON.stringify({
        title: 'Example Domain',
        url: 'https://example.com/',
        text: 'This domain is for use in documentation examples.',
        engine: 'playwright',
        screenshot: 'data:image/jpeg;base64,/9j/fixture',
      })}
    />,
  );
  expect(html).toContain('Example Domain');
  expect(html).toContain('https://example.com/');
  expect(html).toContain('Finished');
  expect(html).toContain('Engine: playwright');
  expect(html).toContain('This domain is for use in documentation examples.');
  expect(html).toContain('<img');
  expect(html).toContain('data:image/jpeg;base64,/9j/fixture');
});

it('labels engines without inventing a fallback, and loads the preview via the proxy when the result has no screenshot', () => {
  expect(
    browseEngineLabel({
      engine: 'playwright',
      requestedEngine: 'playwright',
      engineFallback: false,
    }),
  ).toBe('Engine: playwright');
  const html = renderToStaticMarkup(
    <BrowserActivityCard
      name="read_public_page"
      toolCallId="browse-2"
      status="complete"
      args={{ url: 'https://example.org/page' }}
      result={JSON.stringify({
        title: 'No Screenshot Page',
        url: 'https://example.org/page',
        text: 'Body text.',
        engine: 'playwright',
        requestedEngine: 'auto',
        engineFallback: false,
      })}
    />,
  );
  expect(html).toContain('Engine: playwright');
  expect(html).not.toContain('bypass');
  // No screenshot in the result: the card wires the live preview
  // through /api/browse-preview (effect-driven; SSR shows its state).
  expect(html).toContain('Live preview via browse preview');
  expect(html).toContain('Opening the live preview');
  expect(html).not.toContain('<img');
});

const providersFixture = {
  providers: [
    {
      id: 'groq',
      label: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      defaultModel: 'llama-3.3-70b-versatile',
      models: ['llama-3.3-70b-versatile'],
      configured: true,
      apiType: 'openai',
      keyEnv: 'GROQ_API_KEY',
    },
    {
      id: 'openrouter',
      label: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'openai/gpt-oss-20b:free',
      models: ['openai/gpt-oss-20b:free'],
      configured: false,
      apiType: 'openai',
      keyEnv: 'OPENROUTER_API_KEY',
    },
  ],
  catalogue: [
    {
      id: 'groq',
      label: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiType: 'openai',
      env: ['GROQ_API_KEY'],
      configured: true,
      favourite: true,
      modelCount: 12,
      defaultModel: 'llama-3.3-70b-versatile',
      runnable: true,
    },
  ],
  catalogueSource: 'live',
  active: {
    providerId: 'groq',
    model: 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1',
  },
};

it('renders the provider status card from a real-shaped /api/providers result', () => {
  const html = renderToStaticMarkup(
    <ProviderStatusCard
      status="complete"
      args={{ provider_id: 'openrouter' }}
      result={JSON.stringify(providersFixture)}
    />,
  );
  expect(html).toContain('Provider status');
  expect(html).toContain('Live');
  expect(html).toContain('Groq');
  expect(html).toContain('llama-3.3-70b-versatile');
  expect(html).toContain('models.dev (live)');
  expect(html).toContain('Configured');
  expect(html).toContain('OpenRouter');
  expect(html).toContain('Not configured · focus of this question');
});

it('shows an honest checking state for the provider card before the handler returns', () => {
  const html = renderToStaticMarkup(<ProviderStatusCard status="executing" />);
  expect(html).toContain('Checking provider status');
  expect(html).not.toContain('Configured');
});

it('renders memory sources with provenance (source + capture id) from the enriched search result', () => {
  const html = renderToStaticMarkup(
    <MemorySourcesCard
      status="complete"
      args={{ query: 'desktop app plan' }}
      result={JSON.stringify({
        reachable: true,
        query: 'desktop app plan',
        results: [
          {
            text: 'The desktop app is Tauri 2 with a React shell.',
            capture_id: 'cap-123',
            score: 0.91,
            source: 'user',
            kind: 'note',
          },
        ],
        citations: ['cap-123'],
        abstained: false,
      })}
    />,
  );
  expect(html).toContain('Memory sources');
  expect(html).toContain('1 capture');
  expect(html).toContain('desktop app plan');
  expect(html).toContain('user · capture cap-123');
  expect(html).toContain('score 0.91');
  expect(html).toContain('The desktop app is Tauri 2 with a React shell.');
});

it('states honestly when the memory daemon is unreachable or nothing matches', () => {
  const offline = renderToStaticMarkup(
    <MemorySourcesCard
      status="complete"
      result={JSON.stringify({
        reachable: false,
        results: [],
        citations: [],
        abstained: true,
      })}
    />,
  );
  expect(offline).toContain('Daemon offline');
  expect(offline).toContain('not reachable');
  const empty = renderToStaticMarkup(
    <MemorySourcesCard
      status="complete"
      result={JSON.stringify({
        reachable: true,
        results: [],
        citations: [],
        abstained: true,
      })}
    />,
  );
  expect(empty).toContain('No memory matches that closely enough to cite.');
});

it('renders a computer screenshot returned in the tool result itself', () => {
  const html = renderToStaticMarkup(
    <ComputerToolCard
      name="computer_screenshot"
      toolCallId="shot-1"
      status="complete"
      dotId="scout"
      dotName="Scout"
      showScreen={false}
      running={false}
      result={JSON.stringify({
        base64: 'aGVsbG8td29ybGQ=',
        width: 1200,
        height: 800,
        url: 'https://example.com/',
        capturedAt: 1,
      })}
    />,
  );
  expect(html).toContain('Viewing browser');
  expect(html).toContain('Finished');
  expect(html).toContain('Screenshot returned by this action');
  expect(html).toContain('<img');
  expect(html).toContain('data:image/png;base64,aGVsbG8td29ybGQ=');
  expect(html).toContain('https://example.com/');
});
