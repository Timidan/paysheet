import { useEffect, useState } from "react";

export const EXPLORER = "https://sepolia.basescan.org";
export const short = (h, a = 6, b = 4) => (h && h.length > a + b + 2 ? `${h.slice(0, a)}…${h.slice(-b)}` : h || "");
// Two decimals at least, more only when the amount needs them: 0.03, 12.00, 0.025.
export const usdc = (n) => Number(n).toFixed(6).replace(/0+$/, "").replace(/\.$/, "").replace(/^(\d+)$/, "$1.00").replace(/\.(\d)$/, ".$10");
export const day = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const time = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export async function api(path, body) {
  const res = await fetch(`/api${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "That did not work. Try again.");
  return data;
}

// { sample, sampleRows, limits, miners, payer }. null while loading, { error } if it failed.
export function useHome() {
  const [home, setHome] = useState(null);
  useEffect(() => { api("/home").then(setHome).catch((e) => setHome({ error: e.message })); }, []);
  return home;
}

export const tokenKey = (id) => `paysheet:token:${id}`;
