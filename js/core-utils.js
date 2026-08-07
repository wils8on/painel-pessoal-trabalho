export function clampPercent(value) {
  const number = Number(value);
  return Math.max(0, Math.min(100, Number.isFinite(number) ? number : 0));
}

export function checklistProgress(items = [], fallback = 0) {
  if (!Array.isArray(items) || !items.length) return clampPercent(fallback);
  return Math.round(items.filter((item) => item?.done).length / items.length * 100);
}

export function safeHttpUrl(raw = "") {
  try {
    const url = new URL(String(raw).trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

export function nextRecurringDate(dateString, recurrence, now = new Date()) {
  const date = dateString ? new Date(`${dateString}T12:00:00`) : new Date(now);
  if (Number.isNaN(date.getTime())) return null;
  if (recurrence === "semanal") date.setDate(date.getDate() + 7);
  else if (recurrence === "mensal") date.setMonth(date.getMonth() + 1);
  else return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function validateBackup(backup, allowedCollections) {
  if (!backup || typeof backup !== "object" || backup.version !== 1 || !backup.collections || typeof backup.collections !== "object") return false;
  return Object.entries(backup.collections).every(([name, items]) => allowedCollections.includes(name) && Array.isArray(items) && items.length <= 10000);
}
