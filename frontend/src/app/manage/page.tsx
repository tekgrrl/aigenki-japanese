"use client";

import React, { useState, useEffect, useRef, FormEvent } from "react";
import { KnowledgeUnit, ReviewFacet } from "@/types";
import Link from "next/link";
import EditKnowledgeUnitModal from "@/components/EditKnowledgeUnitModal";
import { apiFetch } from "@/lib/api-client";

const kuTypes: KnowledgeUnit["type"][] = [
  "Vocab",
  "Kanji",
  "Grammar",
  "Concept",
  "ExampleSentence",
];

export default function KnowledgeManagementPage() {
  const [kus, setKus] = useState<KnowledgeUnit[]>([]);
  const [facets, setFacets] = useState<ReviewFacet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- Form State ---
  const [newKuType, setNewKuType] = useState<KnowledgeUnit["type"]>("Vocab");
  const [newKuContent, setNewKuContent] = useState("");
  const [newKuReading, setNewKuReading] = useState("");
  const [newKuDefinition, setNewKuDefinition] = useState("");
  const [newKuJlptLevel, setNewKuJlptLevel] = useState("");
  const [newKuWanikaniLevel, setNewKuWanikaniLevel] = useState<number | "">("");
  const [newKuNotes, setNewKuNotes] = useState(""); // Personal Notes
  const [newUserNotes, setNewUserNotes] = useState(""); // User Notes (Context)
  const [generatingFacetKuId, setGeneratingFacetKuId] = useState<string | null>(
    null,
  );

  // --- Edit Modal State ---
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingKu, setEditingKu] = useState<KnowledgeUnit | null>(null);

  // --- Delete State ---
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // --- Search & Enroll State ---
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KnowledgeUnit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [enrollingId, setEnrollingId] = useState<string | null>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- VALIDATION ---
  // Derived state to determine if the form is valid.
  // This is recalculated on every render.
  const isContentValid = newKuContent.trim() !== "";
  let isFormValid = isContentValid; // Base requirement

  if (newKuType === "Vocab") {
    // Reading and Definition are now optional for Vocab
    isFormValid = isContentValid;
  }
  // For other types, only 'Content' is required.
  // --- END VALIDATION ---

  // --- Data Fetching ---
  const fetchData = async () => {
    try {
      setError(null);
      setIsLoading(true);

      const [kuResponse, facetResponse] = await Promise.all([
        apiFetch("/api/knowledge-units/get-all?status=user"),
        apiFetch("/api/reviews/facets"),
      ]);

      if (!kuResponse.ok) throw new Error("Failed to fetch knowledge units");
      if (!facetResponse.ok) throw new Error("Failed to fetch review facets");

      const kuData = await kuResponse.json();
      const facetData = await facetResponse.json();

      setKus(kuData);
      setFacets(facetData);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      else setError("An unknown error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- Form Handling ---
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); // Clear previous errors

    // --- VALIDATION ---
    // Double-check validation on submit
    if (!isFormValid) {
      setError("Please fill out all required fields.");
      return;
    }
    // --- END VALIDATION ---

    let kuData: Record<string, any> = {};
    if (newKuType === "Vocab") {
      kuData.reading = newKuReading;
      kuData.definition = newKuDefinition;
      if (newKuJlptLevel !== "") kuData.jlptLevel = newKuJlptLevel;
      if (newKuWanikaniLevel !== "") kuData.wanikaniLevel = Number(newKuWanikaniLevel);
    }

    try {
      // TODO needs nextjs rewrite
      const response = await apiFetch("/api/knowledge-units", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: newKuType,
          content: newKuContent,
          data: kuData,
          personalNotes: newKuNotes,
          userNotes: newUserNotes,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to add new unit");
      }

      // Reset form fields
      setNewKuContent("");
      setNewKuType("Vocab");
      setNewKuReading("");
      setNewKuDefinition("");
      setNewKuJlptLevel("");
      setNewKuWanikaniLevel("");
      setNewKuNotes("");
      setNewUserNotes("");

      await fetchData(); // Refetch all data

      // Dispatch a custom event to tell the Header to refresh its stats
      window.dispatchEvent(new CustomEvent("refreshStats"));
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      else setError("An unknown error occurred");
    }
  };

  // --- Edit Handler ---
  const handleEditClick = (ku: KnowledgeUnit) => {
    setEditingKu(ku);
    setIsEditModalOpen(true);
  };

  const handleSaveKu = async (id: string, updates: Partial<KnowledgeUnit>) => {
    try {
      // TODO needs nextjs rewrite
      const response = await apiFetch(`/api/knowledge-units/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error("Failed to update unit");
      }

      await fetchData(); // Refetch all data to show updates
      window.dispatchEvent(new CustomEvent("refreshStats"));
    } catch (err) {
      console.error(err);
      alert("Failed to save changes"); // Simple alert for now
    }
  };

  // --- Delete Handler ---
  const handleDelete = async (kuId: string) => {
    setDeletingId(kuId);
    try {
      const res = await apiFetch(`/api/knowledge-units/${kuId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      await fetchData();
      window.dispatchEvent(new CustomEvent("refreshStats"));
    } catch (err) {
      setError("Failed to delete unit — please try again.");
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  // --- Search & Enroll Handlers ---
  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchDebounce.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await apiFetch(`/api/knowledge-units/search?q=${encodeURIComponent(q.trim())}`);
        if (res.ok) setSearchResults(await res.json());
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  };

  const handleEnroll = async (ku: KnowledgeUnit) => {
    setEnrollingId(ku.id);
    try {
      const res = await apiFetch("/api/knowledge-units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: ku.type, content: ku.content }),
      });
      if (!res.ok) throw new Error();
      await fetchData();
      window.dispatchEvent(new CustomEvent("refreshStats"));
    } catch {
      setError("Failed to add unit — please try again.");
    } finally {
      setEnrollingId(null);
    }
  };

  // --- Render Logic ---
  const renderKuList = () => {
    if (isLoading) {
      return <p className="text-center text-gray-400">Loading units...</p>;
    }
    if (error && kus.length === 0) {
      return <p className="text-center text-red-400">Error: {error}</p>;
    }
    if (kus.length === 0) {
      return (
        <p className="text-center text-gray-400">
          No knowledge units added yet.
        </p>
      );
    }

    return (
      <ul className="space-y-4">
        {kus.map((ku) => {
          const kuFacets = facets.filter((f) => f.kuId === ku.id);
          return (
            <li key={ku.id} className="p-4 bg-gray-700 rounded-lg shadow">
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl font-semibold text-white break-all">
                  {ku.content}
                </span>

                <Link
                  href={`/learn/${ku.id}?source=review`}
                  className="text-sm inline-block px-4 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700"
                >
                  Review lesson
                </Link>

                <span className="font-mono text-sm bg-gray-900 text-gray-100 px-2 py-1 rounded ml-2 flex-shrink-0">
                  {ku.type}
                </span>

                <button
                  onClick={() => handleEditClick(ku)}
                  className="ml-2 text-sm px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
                >
                  Edit
                </button>

                {confirmDeleteId === ku.id ? (
                  <div className="ml-2 flex items-center gap-1">
                    <button
                      onClick={() => handleDelete(ku.id)}
                      disabled={deletingId === ku.id}
                      className="text-sm px-3 py-1 bg-red-600 hover:bg-red-700 disabled:bg-red-900 text-white rounded transition-colors"
                    >
                      {deletingId === ku.id ? "Deleting…" : "Confirm"}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-sm px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(ku.id)}
                    className="ml-2 text-sm px-3 py-1 bg-gray-700 hover:bg-red-700 text-gray-300 hover:text-white rounded transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>

              {ku.type === "Vocab" && ku.data.reading && (
                <p className="text-lg text-gray-300 break-all">
                  <span className="font-semibold">Reading:</span>{" "}
                  {ku.data.reading}
                </p>
              )}
              {ku.type === "Vocab" && ku.data.definition && (
                <p className="text-lg text-gray-300 break-all">
                  <span className="font-semibold">Definition:</span>{" "}
                  {ku.data.definition}
                </p>
              )}
              {ku.personalNotes && (
                <p className="mt-2 p-3 bg-gray-600 rounded text-gray-200 italic break-words">
                  {ku.personalNotes}
                </p>
              )}

              <div className="mt-4 pt-4 border-t border-gray-600">
                <h4 className="text-sm font-semibold text-gray-400 mb-2">
                  Review Facets
                </h4>
                {kuFacets.length > 0 ? (
                  <ul className="space-y-1">
                    {kuFacets.map((facet) => (
                      <li
                        key={facet.id}
                        className="text-sm text-gray-300 flex justify-between items-center"
                      >
                        <span>{facet.facetType}</span>
                        <span className="text-xs font-mono bg-gray-600 px-2 py-0.5 rounded">
                          Stage: {facet.srsStage}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500 italic">
                    No facets generated.
                  </p>
                )}
              </div>

              <p className="text-xs text-gray-500 font-mono mt-3 break-all">
                {ku.id}
              </p>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <main className="container mx-auto max-w-4xl p-8">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Manage Knowledge</h1>
          <p className="text-xl text-gray-400">Your personal knowledge graph.</p>
        </div>
        <Link
          href="/manage/scenarios"
          className="shrink-0 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Import Conversation →
        </Link>
      </header>

      {/* Show form-level error messages here */}
      {error && (
        <div className="bg-red-800 border border-red-600 text-red-100 p-4 rounded-md mb-6">
          {error}
        </div>
      )}

      {/* "Encounter & Capture" (Journey 1.1) form */}
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-8">
        <h2 className="text-2xl font-semibold mb-4 text-white">
          Add New Knowledge Unit
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* --- Core Fields --- */}
          <div>
            <label
              htmlFor="kuType"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              Type
            </label>
            <select
              id="kuType"
              value={newKuType}
              onChange={(e) =>
                setNewKuType(e.target.value as KnowledgeUnit["type"])
              }
              className="w-full p-3 bg-gray-700 border-gray-600 text-white rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
            >
              {kuTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="kuContent"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              Content
            </label>
            <input
              type="text"
              id="kuContent"
              value={newKuContent}
              onChange={(e) => setNewKuContent(e.target.value)}
              placeholder="e.g., 食べる, 家族, 〜なければならない"
              className="w-full p-3 bg-gray-700 border-gray-600 text-white rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
              required // --- VALIDATION ---
            />
          </div>

          {/* --- Conditional Fields: Vocab --- */}
          {newKuType === "Vocab" && (
            <>
              <div>
                <label
                  htmlFor="kuReading"
                  className="block text-sm font-medium text-gray-300 mb-1"
                >
                  Reading (Hiragana)
                </label>
                <input
                  type="text"
                  id="kuReading"
                  value={newKuReading}
                  onChange={(e) => setNewKuReading(e.target.value)}
                  placeholder="e.g., たべる, かぞく"
                  className="w-full p-3 bg-gray-700 border-gray-600 text-white rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  // required removed
                />
              </div>
              <div>
                <label
                  htmlFor="kuDefinition"
                  className="block text-sm font-medium text-gray-300 mb-1"
                >
                  Definition
                </label>
                <input
                  type="text"
                  id="kuDefinition"
                  value={newKuDefinition}
                  onChange={(e) => setNewKuDefinition(e.target.value)}
                  placeholder="e.g., To eat, Family"
                  className="w-full p-3 bg-gray-700 border-gray-600 text-white rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  // required removed
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="kuJlptLevel"
                    className="block text-sm font-medium text-gray-300 mb-1"
                  >
                    JLPT Level
                  </label>
                  <select
                    id="kuJlptLevel"
                    value={newKuJlptLevel}
                    onChange={(e) => setNewKuJlptLevel(e.target.value)}
                    className="w-full p-3 bg-gray-700 border-gray-600 text-white rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">None</option>
                    <option value="N5">N5</option>
                    <option value="N4">N4</option>
                    <option value="N3">N3</option>
                    <option value="N2">N2</option>
                    <option value="N1">N1</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="kuWanikaniLevel"
                    className="block text-sm font-medium text-gray-300 mb-1"
                  >
                    WaniKani Level
                  </label>
                  <input
                    type="number"
                    id="kuWanikaniLevel"
                    min="1"
                    max="60"
                    placeholder="1-60"
                    value={newKuWanikaniLevel}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewKuWanikaniLevel(val === "" ? "" : Number(val));
                    }}
                    className="w-full p-3 bg-gray-700 border-gray-600 text-white rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </>
          )}

          {/* --- Common Fields --- */}
          <div>
            <label
              htmlFor="kuUserNotes"
              className="block text-sm font-medium text-gray-300 mb-1 flex items-center gap-2"
            >
              User Notes
              <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded-full font-normal normal-case">
                AI Context
              </span>
            </label>
            <textarea
              id="kuUserNotes"
              value={newUserNotes}
              onChange={(e) => setNewUserNotes(e.target.value)}
              rows={2}
              placeholder="Context instructions for Gemini (e.g., 'Focus on polite forms')..."
              className="w-full p-3 bg-gray-700 border-gray-600 text-white rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="kuNotes"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              Personal Notes
            </label>
            <textarea
              id="kuNotes"
              value={newKuNotes}
              onChange={(e) => setNewKuNotes(e.target.value)}
              rows={3}
              placeholder="e.g., Mnemonic, context where I found this, related to..."
              className="w-full p-3 bg-gray-700 border-gray-600 text-white rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <button
            type="submit"
            // --- VALIDATION ---
            disabled={!isFormValid}
            className="w-full px-4 py-3 bg-blue-600 text-white font-semibold rounded-md shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:bg-gray-500 disabled:cursor-not-allowed" // --- VALIDATION ---
          >
            Add Unit
          </button>
        </form>
      </div>

      {/* Search & Enroll */}
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-8">
        <h2 className="text-2xl font-semibold mb-4 text-white">Search Existing Vocab</h2>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Type Japanese or kana to search the corpus…"
          className="w-full p-3 bg-gray-700 border-gray-600 text-white rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 mb-3"
        />

        {searchLoading && (
          <p className="text-sm text-gray-400 animate-pulse">Searching…</p>
        )}

        {!searchLoading && searchResults.length > 0 && (
          <ul className="space-y-2">
            {searchResults.map((result) => {
              const alreadyEnrolled = kus.some((k) => k.id === result.id);
              const isEnrolling = enrollingId === result.id;
              const hint = result.type === "Vocab"
                ? [result.data.reading, result.data.definition].filter(Boolean).join(" · ")
                : result.type === "Kanji"
                  ? result.data.meaning
                  : (result.data as any).title ?? "";

              return (
                <li key={result.id} className="flex items-center justify-between gap-4 bg-gray-700 rounded-lg px-4 py-3">
                  <div className="min-w-0">
                    <span className="text-white font-semibold mr-2">{result.content}</span>
                    <span className="text-xs font-mono bg-gray-600 text-gray-300 px-1.5 py-0.5 rounded mr-2">{result.type}</span>
                    {hint && <span className="text-sm text-gray-400 truncate">{hint}</span>}
                  </div>
                  {alreadyEnrolled ? (
                    <span className="text-xs text-green-400 shrink-0">In queue</span>
                  ) : (
                    <button
                      onClick={() => handleEnroll(result)}
                      disabled={isEnrolling}
                      className="shrink-0 text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 text-white rounded transition-colors"
                    >
                      {isEnrolling ? "Adding…" : "Add"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!searchLoading && searchQuery.trim() && searchResults.length === 0 && (
          <p className="text-sm text-gray-500 italic">No results — use the form above to add a new unit.</p>
        )}
      </div>

      {/* "Explore & Connect" (Journey 1.3) list */}
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
        <h2 className="text-2xl font-semibold mb-4 text-white">
          My Knowledge Units
        </h2>
        {renderKuList()}
      </div>

      <EditKnowledgeUnitModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSave={handleSaveKu}
        knowledgeUnit={editingKu}
      />
    </main>
  );
}
