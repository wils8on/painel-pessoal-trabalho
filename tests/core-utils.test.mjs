import test from "node:test";
import assert from "node:assert/strict";
import { clampPercent, checklistProgress, safeHttpUrl, nextRecurringDate, validateBackup } from "../js/core-utils.js";

test("clampPercent limita e normaliza valores", () => { assert.equal(clampPercent(-5), 0); assert.equal(clampPercent(135), 100); assert.equal(clampPercent("42"), 42); assert.equal(clampPercent("x"), 0); });
test("checklistProgress calcula itens concluídos", () => { assert.equal(checklistProgress([{done:true},{done:false},{done:true}]), 67); assert.equal(checklistProgress([], 35), 35); });
test("safeHttpUrl aceita apenas HTTP e HTTPS", () => { assert.match(safeHttpUrl("https://example.com"), /^https:/); assert.equal(safeHttpUrl("javascript:alert(1)"), ""); });
test("nextRecurringDate calcula semanal e mensal", () => { assert.equal(nextRecurringDate("2026-08-07", "semanal"), "2026-08-14"); assert.equal(nextRecurringDate("2026-08-07", "mensal"), "2026-09-07"); assert.equal(nextRecurringDate("2026-08-07", ""), null); });
test("validateBackup rejeita versões e coleções desconhecidas", () => { const allowed=["projects"]; assert.equal(validateBackup({version:1,collections:{projects:[]}},allowed),true); assert.equal(validateBackup({version:2,collections:{projects:[]}},allowed),false); assert.equal(validateBackup({version:1,collections:{unknown:[]}},allowed),false); });
