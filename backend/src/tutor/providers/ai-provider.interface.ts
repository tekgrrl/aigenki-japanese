export type AiMessageRole = 'user' | 'model';

export type AiMessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; callId: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; callId: string; name: string; result: unknown };

export interface AiMessage {
  role: AiMessageRole;
  parts: AiMessagePart[];
  /** Opaque provider-specific raw turn data. When present, providers should
   *  use it verbatim instead of reconstructing from parts. Used by
   *  GeminiProvider to preserve thought_signature across multi-turn calls. */
  _raw?: unknown;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface AiToolCall {
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

export type AiResponse =
  | { type: 'tool_use'; calls: AiToolCall[]; modelTurn: AiMessage }
  | { type: 'end_turn'; content: string };

// Abstract class (not interface) so NestJS can emit decorator metadata for it
export abstract class AiProvider {
  abstract readonly modelLabel: string;
  abstract chat(params: {
    system: string;
    messages: AiMessage[];
    tools: AiToolDefinition[];
  }): Promise<AiResponse>;
}
