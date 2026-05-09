"use client";

import { useState, useEffect, useRef } from "react";
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

interface KuSearchResult {
  id: string;
  content: string;
  type: string;
  data?: { title?: string };
}

function GrammarLessonLoader({ onLoad }: {
  onLoad: (userMessage: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KuSearchResult[]>([]);
  const [selected, setSelected] = useState<KuSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiFetch(`/api/knowledge-units/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const all: KuSearchResult[] = await res.json();
          setResults(all.filter(k => k.type === "Grammar"));
        }
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [query]);

  const handleSelect = (ku: KuSearchResult) => {
    setSelected(ku);
    setQuery(ku.content);
    setResults([]);
  };

  const handleLoad = async () => {
    if (!selected) return;
    setLoadingPrompt(true);
    try {
      const res = await apiFetch(`/api/lessons/grammar-lesson-prompt?kuId=${selected.id}`);
      if (res.ok) {
        const data = await res.json();
        onLoad(data.userMessage);
      }
    } finally {
      setLoadingPrompt(false);
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-700">Grammar Lesson</span>
        <span className="text-xs text-gray-400">Search a pattern, load its built prompt</span>
      </div>

      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelected(null); }}
          placeholder="Search grammar pattern (e.g. ～てください)…"
          className="w-full border border-gray-300 rounded-md p-2 text-sm font-mono pr-8"
        />
        {loading && (
          <span className="absolute right-2 top-2.5 text-gray-400 text-xs animate-pulse">…</span>
        )}
      </div>

      {results.length > 0 && (
        <div className="border border-gray-200 rounded-md bg-white divide-y divide-gray-100 max-h-48 overflow-y-auto">
          {results.map(ku => (
            <button
              key={ku.id}
              onClick={() => handleSelect(ku)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors"
            >
              <span className="font-mono text-sm text-gray-900">{ku.content}</span>
              {ku.data?.title && (
                <span className="ml-2 text-xs text-gray-400 truncate">{ku.data.title}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-mono truncate flex-1">
            {selected.content}{selected.data?.title ? ` — ${selected.data.title}` : ""}
          </span>
          <button
            onClick={handleLoad}
            disabled={loadingPrompt}
            className="shrink-0 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loadingPrompt ? "Loading…" : "Load Prompt →"}
          </button>
        </div>
      )}
    </div>
  );
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

  const handleGrammarLoad = (builtMessage: string) => {
    setSelectedPresetId("");
    setSystemPrompt("");
    setSchemaText("");
    setUseTools(false);
    setUserMessage(builtMessage);
    setResult(null);
    setError(null);
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

          {/* Grammar lesson loader */}
          <GrammarLessonLoader onLoad={handleGrammarLoad} />

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
              placeholder="System prompt…"
            />
          </div>

          {/* User message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              User Message
            </label>
            <textarea
              className="w-full border border-gray-300 rounded-md p-2 text-sm font-mono"
              rows={10}
              value={userMessage}
              onChange={(e) => setUserMessage(e.target.value)}
              placeholder="User message (leave empty to use system prompt only)…"
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
                  placeholder="Firebase UID…"
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
            disabled={running || (!systemPrompt.trim() && !userMessage.trim())}
            className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {running ? "Running..." : "Run"}
          </button>
        </div>

        {/* Right panel — results */}
        <div className="w-[480px] shrink-0 flex flex-col gap-4">
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
                      onClick={() => setExpandedToolCall(expandedToolCall === i ? null : i)}
                    >
                      <span className="text-blue-700">{tc.fn}()</span>
                      <span className="text-gray-400 text-xs">{expandedToolCall === i ? "▲" : "▼"}</span>
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

          {result && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Result</h3>
              <div className="border border-gray-200 rounded-md overflow-hidden">
                <pre className="text-sm font-mono p-3 bg-white whitespace-pre-wrap overflow-auto max-h-[600px]">
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
