"use client";

import { useState, useEffect, useCallback } from "react";
import { ApiLog } from "@/types";
import { JsonDisplay } from "@/components/JSONDisplay";
import { apiFetch } from "@/lib/api-client";

interface LatencyStat {
  route: string;
  count: number;
  avgMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

export default function LogsPage() {
  const [activeTab, setActiveTab] = useState<"logs" | "latency">("logs");

  // Logs state
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(50);
  const [route, setRoute] = useState("");
  const [status, setStatus] = useState<"" | "success" | "error">("");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Latency state
  const [latencyStats, setLatencyStats] = useState<LatencyStat[]>([]);
  const [latencyLoading, setLatencyLoading] = useState(false);
  const [latencyLoaded, setLatencyLoaded] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("limit", limit.toString());
      if (route) params.append("route", route);
      if (status) params.append("status", status);
      const res = await apiFetch(`/api/apilogs?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch logs");
      setLogs(await res.json());
    } catch (error) {
      console.error("Error fetching logs:", error);
    } finally {
      setLoading(false);
    }
  }, [limit, route, status]);

  const fetchLatency = useCallback(async () => {
    setLatencyLoading(true);
    try {
      const res = await apiFetch("/api/apilogs/latency");
      if (!res.ok) throw new Error("Failed to fetch latency stats");
      setLatencyStats(await res.json());
      setLatencyLoaded(true);
    } catch (error) {
      console.error("Error fetching latency:", error);
    } finally {
      setLatencyLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    if (activeTab === "latency" && !latencyLoaded) {
      fetchLatency();
    }
  }, [activeTab]);

  const toggleExpand = (id: string) => {
    setExpandedLogId(expandedLogId === id ? null : id);
  };

  const latencyBarColor = (ms: number) => {
    if (ms < 3000) return "bg-green-500";
    if (ms < 8000) return "bg-yellow-400";
    return "bg-red-500";
  };

  const latencyTextColor = (ms: number) => {
    if (ms < 3000) return "text-green-700";
    if (ms < 8000) return "text-yellow-700";
    return "text-red-700";
  };

  const formatMs = (ms: number) =>
    ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;

  const maxAvg = Math.max(...latencyStats.map((s) => s.avgMs), 1);

  return (
    <div className="container mx-auto p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-4">API Logs</h1>
        <div className="flex border-b border-gray-200">
          <button
            className={`py-2 px-4 font-medium focus:outline-none ${activeTab === "logs" ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500 hover:text-gray-700"}`}
            onClick={() => setActiveTab("logs")}
          >
            Log Viewer
          </button>
          <button
            className={`py-2 px-4 font-medium focus:outline-none ${activeTab === "latency" ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500 hover:text-gray-700"}`}
            onClick={() => setActiveTab("latency")}
          >
            Latency
          </button>
        </div>
      </div>

      {/* ── Log Viewer Tab ── */}
      {activeTab === "logs" && (
        <>
          <div className="bg-white p-4 rounded-lg shadow mb-6 border border-gray-200 flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Route</label>
              <input
                type="text"
                className="border border-gray-300 rounded-md p-2 w-64 focus:ring-blue-500 focus:border-blue-500"
                placeholder="/api/..."
                value={route}
                onChange={(e) => setRoute(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                className="border border-gray-300 rounded-md p-2 w-40 focus:ring-blue-500 focus:border-blue-500"
                value={status}
                onChange={(e) => setStatus(e.target.value as "" | "success" | "error")}
              >
                <option value="">All</option>
                <option value="success">Success</option>
                <option value="error">Error</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Limit</label>
              <select
                className="border border-gray-300 rounded-md p-2 w-24 focus:ring-blue-500 focus:border-blue-500"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
            <button
              onClick={fetchLogs}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ml-auto"
            >
              Refresh
            </button>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Route</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Latency</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Model</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">Loading logs...</td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">No logs found.</td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <>
                      <tr
                        key={log.id}
                        className={`hover:bg-gray-50 cursor-pointer ${expandedLogId === log.id ? "bg-blue-50" : ""}`}
                        onClick={() => toggleExpand(log.id!)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {log.route}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            log.status === "success"
                              ? "bg-green-100 text-green-800"
                              : log.status === "error"
                                ? "bg-red-100 text-red-800"
                                : "bg-yellow-100 text-yellow-800"
                          }`}>
                            {log.status}
                          </span>
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm ${
                          log.durationMs
                            ? latencyTextColor(log.durationMs)
                            : "text-gray-400"
                        }`}>
                          {log.durationMs ? formatMs(log.durationMs) : "-"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {log.modelUsed || "-"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <span className="text-blue-600 hover:text-blue-900">
                            {expandedLogId === log.id ? "Hide Details" : "View Details"}
                          </span>
                        </td>
                      </tr>

                      {expandedLogId === log.id && (
                        <tr className="bg-gray-50">
                          <td colSpan={6} className="px-6 py-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="border rounded-md bg-white p-3">
                                <h3 className="font-semibold text-gray-700 mb-2 border-b pb-1">Request Data</h3>
                                <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono overflow-auto max-h-96">
                                  <JsonDisplay data={log.requestData} />
                                </pre>
                              </div>
                              <div className="border rounded-md bg-white p-3">
                                <h3 className="font-semibold text-gray-700 mb-2 border-b pb-1">Response / Error Data</h3>
                                {log.errorData ? (
                                  <div className="text-red-600">
                                    <p className="font-bold">Error:</p>
                                    <pre className="text-xs whitespace-pre-wrap font-mono overflow-auto max-h-96">
                                      <JsonDisplay data={log.errorData} />
                                    </pre>
                                  </div>
                                ) : (
                                  <pre className="text-xs text-green-700 whitespace-pre-wrap font-mono overflow-auto max-h-96">
                                    <JsonDisplay data={log.responseData} />
                                  </pre>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Latency Tab ── */}
      {activeTab === "latency" && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-gray-500">
              Aggregated over last 200 logged calls. Color: green &lt; 3s, yellow &lt; 8s, red ≥ 8s.
            </p>
            <button
              onClick={() => { setLatencyLoaded(false); fetchLatency(); }}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm"
            >
              Refresh
            </button>
          </div>

          {latencyLoading ? (
            <p className="text-gray-400 text-sm">Loading latency data...</p>
          ) : latencyStats.length === 0 ? (
            <p className="text-gray-400 text-sm">No latency data available yet.</p>
          ) : (
            <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">Route</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-16">n</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-20">Avg</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-20">P95</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Distribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {latencyStats.map((stat) => {
                    const avgPct = Math.round((stat.avgMs / maxAvg) * 100);
                    const p95Pct = Math.round((stat.p95Ms / maxAvg) * 100);
                    return (
                      <tr key={stat.route} className="hover:bg-gray-50">
                        <td className="px-6 py-3 text-sm font-mono text-gray-800 truncate max-w-xs" title={stat.route}>
                          {stat.route}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-gray-500">{stat.count}</td>
                        <td className={`px-4 py-3 text-right text-sm font-semibold ${latencyTextColor(stat.avgMs)}`}>
                          {formatMs(stat.avgMs)}
                        </td>
                        <td className={`px-4 py-3 text-right text-sm ${latencyTextColor(stat.p95Ms)}`}>
                          {formatMs(stat.p95Ms)}
                        </td>
                        <td className="px-6 py-3">
                          <div className="relative h-5 bg-gray-100 rounded overflow-hidden w-full">
                            {/* P95 bar (lighter, background) */}
                            <div
                              className={`absolute top-0 left-0 h-full opacity-30 rounded ${latencyBarColor(stat.p95Ms)}`}
                              style={{ width: `${p95Pct}%` }}
                            />
                            {/* Avg bar (solid, foreground) */}
                            <div
                              className={`absolute top-0 left-0 h-full rounded ${latencyBarColor(stat.avgMs)}`}
                              style={{ width: `${avgPct}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
