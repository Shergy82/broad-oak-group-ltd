"use client";

import { useEffect, useMemo, useState } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = typeof window !== "undefined" ? atob(base64) : "";
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

export default function PushDebugPage() {
  const envKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const [copied, setCopied] = useState(false);

  const decoded = useMemo(() => {
    try {
      if (!envKey) return null;
      const arr = urlBase64ToUint8Array(envKey.trim());
      return { length: arr.length, firstBytes: Array.from(arr.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join(" ") };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [envKey]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div style={{ padding: 24, fontFamily: "Inter, system-ui, Arial" }}>
      <h1 style={{ marginBottom: 12 }}>Push Debug</h1>
      <p style={{ marginBottom: 8 }}>This page shows the VAPID public key used by the client (for testing).</p>

      <div style={{ marginBottom: 12 }}>
        <strong>Public key (NEXT_PUBLIC_VAPID_PUBLIC_KEY):</strong>
        <div style={{ marginTop: 6, wordBreak: "break-all", background: "#f7f7f8", padding: 12, borderRadius: 6 }}>
          {envKey || <em>Not set</em>}
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <strong>Decoded info:</strong>
        <div style={{ marginTop: 6, background: "#f7f7f8", padding: 12, borderRadius: 6 }}>
          {envKey ? (
            decoded && !(decoded as any).error ? (
              <div>
                <div>Length: {(decoded as any).length}</div>
                <div>First bytes (hex): {(decoded as any).firstBytes}</div>
                <div style={{ marginTop: 8, color: "#555" }}>Valid uncompressed P-256 keys are 65 bytes and start with 0x04.</div>
              </div>
            ) : (
              <div>Error decoding key: {(decoded as any).error}</div>
            )
          ) : (
            <div><em>No key provided.</em></div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => {
            if (!envKey) return;
            navigator.clipboard.writeText(envKey);
            setCopied(true);
          }}
          disabled={!envKey}
          style={{ padding: "8px 12px", borderRadius: 6 }}
        >
          {copied ? "Copied" : "Copy public key"}
        </button>

        <a href="/" style={{ padding: "8px 12px", borderRadius: 6, background: "#eee", textDecoration: "none", color: "inherit" }}>Back</a>
      </div>
    </div>
  );
}
