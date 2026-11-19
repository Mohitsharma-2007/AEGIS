import { z } from 'zod';

// AEGIS (W-GEN): canonical definitions for the two CopilotKit frontend
// tools whose live cards render in chat (GenerativeCards.tsx). They
// follow the exact pattern of page-review.ts / connection-types.ts:
// the client registers them with useFrontendTool (Zod schemas below),
// and DotAgent only forwards a call to the model when the client
// actually offered the tool, substituting THESE canonical definitions
// for whatever the client sent   so a forged client copy cannot change
// the name, description, or parameters the model sees.
// NOT a no-argument schema: an empty-object client tool is converted
// to strict-mode JSON Schema with `required: []` / empty `properties`,
// which strict validators reject   verified live by W-GEN: Groq
// answered 400 "'required' present but 'properties' is missing" for
// show_provider_status, failing the whole turn (the same hazard W-AI
// documented for server tools in page-tools.ts). The tool therefore
// takes one real optional argument: the provider to focus in the card.
export const providerStatusSchema = z
  .object({
    provider_id: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe(
        'Optional provider id (e.g. "groq") to focus in the card when the user asks about one specific provider. Omit for the overall status.',
      ),
  })
  .strict();
export type ProviderStatusInput = z.infer<typeof providerStatusSchema>;
export const providerStatusTool = {
  name: 'show_provider_status',
  description:
    'Show the owner a live card with the model provider status: the active provider and model, which favourite providers are configured (have a key), and whether the provider catalogue came from the live models.dev feed or the bundled snapshot. Call this when the user asks which provider or model is active, or about provider setup/configuration status. It runs in the browser, reads the real /api/providers state, and its result is that real state.',
  parameters: z.toJSONSchema(providerStatusSchema),
};

export const memorySourcesSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe('The topic or question to look up in Aegis memory.'),
  })
  .strict();
export type MemorySourcesInput = z.infer<typeof memorySourcesSchema>;
export const memorySourcesTool = {
  name: 'show_memory_sources',
  description:
    'Show the owner a live card with the top Aegis memory captures matching a query, each with its provenance (source and capture id), so the owner can see the memory sources behind an answer. Call this when you answer using remembered information, or when the user asks what you remember or asks for your sources. It runs in the browser, searches the real Aegis daemon memory, and its result is that real search result.',
  parameters: z.toJSONSchema(memorySourcesSchema),
};
