"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";

interface Preset {
  id: string;
  name: string;
  systemPrompt: string;
  exampleUserMessage: string;
  useTools: boolean;
  responseSchema?: Record<string, unknown>;
  description: string;
}

interface ToolCall {
  fn: string;
  args: Record<string, unknown>;
  response: Record<string, unknown>;
}

interface TestResult {
  rawText: string;
  parsedJson: unknown;
  toolCalls: ToolCall[];
  durationMs: number;
}

export default function PromptTesterPage() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [useTools, setUseTools] = useState(false);
  const [uid, setUid] = useState("");
  const [schemaText, setSchemaText] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedToolCall, setExpandedToolCall] = useState<number | null>(null);

  useEffect(() => {
    apiFetch("/api/apilogs/prompt-presets")
      .then((r) => r.json())
      .then(setPresets)
      .catch(console.error);
  }, []);

  const applyPreset = (id: string) => {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    setSelectedPresetId(id);
    setSystemPrompt(preset.systemPrompt);
    setUserMessage(preset.exampleUserMessage);
    setUseTools(preset.useTools);
    setSchemaText(
      preset.responseSchema ? JSON.stringify(preset.responseSchema, null, 2) : "",
    );
  };

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    setExpandedToolCall(null);

    let parsedSchema: Record<string, unknown> | undefined;
    if (schemaText.trim()) {
      try {
        parsedSchema = JSON.parse(schemaText);
      } catch {
        setError("Invalid JSON in Response Schema field.");
        setRunning(false);
        return;
      }
    }

    try {
      const res = await apiFetch("/api/apilogs/prompt-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt,
          userMessage,
          useTools,
          uid: uid || undefined,
          responseSchema: parsedSchema,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Server error ${res.status}: ${text}`);
      }

      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const latencyColor = (ms: number) => {
    if (ms < 3000) return "text-green-700 bg-green-50";
    if (ms < 8000) return "text-yellow-700 bg-yellow-50";
    return "text-red-700 bg-red-50";
  };

  return (
    <div className="container mx-auto p-4 max-w-screen-xl">
      <h1 className="text-2xl font-bold mb-6">Prompt Tester</h1>

      <div className="flex gap-6">
        {/* Left panel — inputs */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {/* Preset selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Preset
            </label>
            <select
              className="w-full border border-gray-300 rounded-md p-2 text-sm"
              value={selectedPresetId}
              onChange={(e) => applyPreset(e.target.value)}
            >
              <option value="">— select a preset —</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {selectedPresetId && (
              <p className="text-xs text-gray-500 mt-1">
                {presets.find((p) => p.id === selectedPresetId)?.description}
              </p>
            )}
          </div>

          {/* System prompt */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              System Prompt
            </label>
            <textarea
              className="w-full border border-gray-300 rounded-md p-2 text-sm font-mono"
              rows={14}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="System prompt..."
            />
          </div>

          {/* User message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              User Message
            </label>
            <textarea
              className="w-full border border-gray-300 rounded-md p-2 text-sm font-mono"
              rows={4}
              value={userMessage}
              onChange={(e) => setUserMessage(e.target.value)}
              placeholder="User message (leave empty to use system prompt only)..."
            />
          </div>

          {/* Tools + UID */}
          <div className="flex gap-4 items-start">
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="useTools"
                checked={useTools}
                onChange={(e) => setUseTools(e.target.checked)}
                className="w-4 h-4"
              />
              <label htmlFor="useTools" className="text-sm font-medium text-gray-700">
                Enable <code className="text-xs bg-gray-100 px-1 rounded">get_user_level</code> tool
              </label>
            </div>
            {useTools && (
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">
                  User UID (optional — defaults to N5 if blank)
                </label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-md p-2 text-sm font-mono"
                  value={uid}
                  onChange={(e) => setUid(e.target.value)}
                  placeholder="Firebase UID..."
                />
              </div>
            )}
          </div>

          {/* Response schema */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Response Schema{" "}
              <span className="text-gray-400 font-normal">(JSON — leave empty for raw text)</span>
            </label>
            <textarea
              className="w-full border border-gray-300 rounded-md p-2 text-sm font-mono"
              rows={6}
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
              placeholder='{ "type": "OBJECT", "properties": { ... }, "required": [...] }'
            />
          </div>

          <button
            onClick={handleRun}
            disabled={running || !systemPrompt.trim()}
            className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {running ? "Running..." : "Run"}
          </button>
        </div>

        {/* Right panel — results */}
        <div className="w-[480px] shrink-0 flex flex-col gap-4">
          {/* Status / latency */}
          {result && (
            <div className={`rounded-md px-3 py-2 text-sm font-mono font-semibold ${latencyColor(result.durationMs)}`}>
              {result.durationMs.toLocaleString()} ms
            </div>
          )}

          {error && (
            <div className="rounded-md px-3 py-2 text-sm bg-red-50 text-red-700 font-mono whitespace-pre-wrap">
              {error}
            </div>
          )}

          {running && (
            <div className="text-sm text-gray-400 animate-pulse">Waiting for response...</div>
          )}

          {/* Tool calls */}
          {result && result.toolCalls.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                Tool Calls ({result.toolCalls.length})
              </h3>
              <div className="space-y-2">
                {result.toolCalls.map((tc, i) => (
                  <div key={i} className="border border-gray-200 rounded-md overflow-hidden">
                    <button
                      className="w-full text-left px-3 py-2 bg-gray-50 hover:bg-gray-100 text-sm font-mono flex justify-between items-center"
                      onClick={() =>
                        setExpandedToolCall(expandedToolCall === i ? null : i)
                      }
                    >
                      <span className="text-blue-700">{tc.fn}()</span>
                      <span className="text-gray-400 text-xs">
                        {expandedToolCall === i ? "▲" : "▼"}
                      </span>
                    </button>
                    {expandedToolCall === i && (
                      <div className="p-3 space-y-2 bg-white">
                        {Object.keys(tc.args).length > 0 && (
                          <div>
                            <p className="text-xs text-gray-500 mb-1">Args</p>
                            <pre className="text-xs font-mono bg-gray-50 p-2 rounded overflow-auto max-h-40">
                              {JSON.stringify(tc.args, null, 2)}
                            </pre>
                          </div>
                        )}
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Response</p>
                          <pre className="text-xs font-mono bg-gray-50 p-2 rounded overflow-auto max-h-60">
                            {JSON.stringify(tc.response, null, 2)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Result</h3>
              <div className="border border-gray-200 rounded-md overflow-hidden">
                <pre className="text-sm font-mono p-3 bg-white whitespace-pre-wrap overflow-auto max-h-[500px]">
                  {result.parsedJson !== null
                    ? JSON.stringify(result.parsedJson, null, 2)
                    : result.rawText}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
