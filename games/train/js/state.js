import {
  ALL_SHOP_ITEMS, DEFAULT_LOGS, ENCOUNTER_TTL_MS, FINAL_STAGE_INDEX, getStageDefinition, LOG_LIMIT,
  MAX_ENCOUNTER_SECONDS, MIN_ENCOUNTER_SECONDS, SAVE_KEY, SAVE_VERSION, TALENTS
} from "./config.js";
import { clamp, finiteNumber, integerBetween, safeAdd } from "./numbers.js";
import { createTaskState, sanitizeTasks, updateTaskProgress } from "./tasks.js";
import { createAchievementState, sanitizeAchievements } from "./achievements.js";
import { createCombatState, createSkirmishState, sanitizeCombatState, sanitizeSkirmishState } from "./combat.js";

const UPGRADE_ITEMS = ALL_SHOP_ITEMS.filter((item) => !item.buffId);
const PILL_ITEMS = ALL_SHOP_ITEMS.filter((item) => item.buffId);
const UPGRADE_IDS = UPGRADE_ITEMS.map((item) => item.id);
const PILL_IDS = PILL_ITEMS.map((item) => item.id);
const TALENT_IDS = TALENTS.map((talent) => talent.id);
const UPGRADE_LIMITS = Object.fromEntries(UPGRADE_ITEMS.map((item) => [item.id, item.maxLevel]));
const PILL_LIMITS = Object.fromEntries(PILL_ITEMS.map((item) => [item.id, item.maxStock]));
const TALENT_LIMITS = Object.fromEntries(TALENTS.map((talent) => [talent.id, talent.maxLevel]));
const PERMANENT_KEYS = ["totalRebirths", "totalQiAllTime", "highestStage", "encountersResolved", "totalClicks", "criticalClicks", "totalBreakthroughs", "breakthroughAttempts", "spiritStonesEarned", "spiritStonesSpent", "totalPurchases", "purchasesRoots", "purchasesArts", "purchasesArrays", "purchasesTreasures", "purchasesPills", "pillsConsumed", "tasksCompleted", "tasksClaimed", "talentsPurchased", "combatWins", "combatLosses", "combatRetreats", "bossWins", "noPillWins", "combatWinStreak", "bestCombatWinStreak"];
const RUN_STAT_KEYS = ["clicks", "criticalClicks", "breakthroughs", "breakthroughAttempts", "failedBreakthroughs", "encounters", "qiFromClicks", "qiFromIdle", "pillsConsumed", "purchasesRoots", "purchasesArts", "purchasesArrays", "purchasesTreasures", "purchasesPills", "combatWins", "combatLosses", "combatRetreats"];

function createNumberMap(ids, value = 0) { return Object.fromEntries(ids.map((id) => [id, value])); }
function nextEncounterTimestamp(now = Date.now()) { return now + integerBetween(MIN_ENCOUNTER_SECONDS, MAX_ENCOUNTER_SECONDS) * 1000; }
function zeroStats(keys) { return Object.fromEntries(keys.map((key) => [key, 0])); }

export function createDefaultState(now = Date.now()) {
  return {
    version: SAVE_VERSION, savedAt: now, lastTickAt: now, generation: 1, crystals: 0, spiritStones: 0,
    migration: { v1Compensated: false }, talents: createNumberMap(TALENT_IDS), permanentStats: zeroStats(PERMANENT_KEYS),
    tasks: createTaskState("", now), achievements: createAchievementState(), run: createDefaultRun(now)
  };
}
export function createDefaultRun(now = Date.now()) {
  return {
    qi: 0, totalQi: 0, stageIndex: 0, lifespanRemaining: 900, startedAt: now,
    upgrades: createNumberMap(UPGRADE_IDS), inventory: createNumberMap(PILL_IDS), pillsPurchased: createNumberMap(PILL_IDS), buffs: {}, weakUntil: 0,
    lastManualClickAt: 0, lastTreasureClickAt: now, nextEncounterAt: nextEncounterTimestamp(now), encounterAvailable: false, activeEncounterId: null, encounterExpiresAt: 0, encounterAnnouncedId: "",
    skirmish: createSkirmishState(now), combat: createCombatState(),
    eventBonuses: { globalMultiplier: 1, clickMultiplier: 1, qpsMultiplier: 1, breakthrough: 0, lifespanMultiplier: 1, critChance: 0, critDamage: 0 },
    logs: DEFAULT_LOGS.map((entry) => ({ ...entry, time: now })), stats: zeroStats(RUN_STAT_KEYS)
  };
}
function sanitizeInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) { return Math.floor(clamp(value, min, max)); }
function sanitizeNumberMap(raw, ids, limits = 1_000_000) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(ids.map((id) => {
    const max = typeof limits === "object" ? limits[id] : limits;
    return [id, sanitizeInteger(source[id], 0, max)];
  }));
}
function sanitizeBonuses(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return { globalMultiplier: clamp(source.globalMultiplier ?? 1, 0.25, 2.5), clickMultiplier: clamp(source.clickMultiplier ?? 1, 0.25, 2.5), qpsMultiplier: clamp(source.qpsMultiplier ?? 1, 0.25, 2.5), breakthrough: clamp(source.breakthrough, -0.2, 0.2), lifespanMultiplier: clamp(source.lifespanMultiplier ?? 1, 0.5, 2), critChance: clamp(source.critChance, -0.2, 0.25), critDamage: clamp(source.critDamage, 0, 3) };
}
function sanitizeBuffs(raw, now, activeAt = now) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result = {};
  for (const id of PILL_IDS) {
    const buff = raw[id];
    if (!buff || typeof buff !== "object") continue;
    const expiresAt = clamp(buff.expiresAt, 0, now + 7 * 86_400_000);
    if (expiresAt <= activeAt) continue;
    result[id] = { expiresAt, multiplier: clamp(buff.multiplier, 1, 3), breakthrough: clamp(buff.breakthrough, 0, 0.2), critChance: clamp(buff.critChance, 0, 0.2) };
  }
  return result;
}
function sanitizeLogs(raw, now) {
  if (!Array.isArray(raw)) return DEFAULT_LOGS.map((entry) => ({ ...entry, time: now }));
  return raw.slice(0, LOG_LIMIT).map((entry) => ({ title: String(entry?.title || "道途留痕").slice(0, 40), text: String(entry?.text || "").slice(0, 240), time: clamp(entry?.time, 0, now) }));
}
function sanitizeStats(raw, keys) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(keys.map((key) => [key, clamp(source[key])]));
}
export function getCurrentQiCap(state) { return getStageDefinition(state?.run?.stageIndex).cap; }
export function clampCurrentQi(state) { state.run.qi = clamp(state.run.qi, 0, getCurrentQiCap(state)); return state.run.qi; }
export function grantQi(state, amount, source = "other") {
  const requested = clamp(amount);
  const before = clampCurrentQi(state);
  const actual = Math.min(requested, Math.max(0, getCurrentQiCap(state) - before));
  state.run.qi = before + actual;
  state.run.totalQi = safeAdd(state.run.totalQi, actual);
  state.permanentStats.totalQiAllTime = safeAdd(state.permanentStats.totalQiAllTime, actual);
  if (source === "click") state.run.stats.qiFromClicks = safeAdd(state.run.stats.qiFromClicks, actual);
  if (source === "idle") state.run.stats.qiFromIdle = safeAdd(state.run.stats.qiFromIdle, actual);
  if (actual > 0) updateTaskProgress(state, "qiStored", actual, { source });
  return actual;
}
export function loseQi(state, amount) { const before = clampCurrentQi(state); const actual = Math.min(before, clamp(amount)); state.run.qi = Math.max(0, before - actual); return actual; }
export function spendSpiritStones(state, amount) {
  const cost = Math.floor(clamp(amount));
  if (state.spiritStones < cost) return false;
  state.spiritStones -= cost;
  state.permanentStats.spiritStonesSpent += cost;
  return true;
}

export function sanitizeState(raw, now = Date.now(), timedStateActiveAt = now) {
  const fallback = createDefaultState(now);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const runRaw = raw.run && typeof raw.run === "object" && !Array.isArray(raw.run) ? raw.run : {};
  const rawVersion = sanitizeInteger(raw.version, 1, SAVE_VERSION);
  const isV1 = rawVersion < 2;
  const isV2 = rawVersion === 2;
  const compensated = Boolean(raw.migration?.v1Compensated) || isV1;
  const stageIndex = sanitizeInteger(runRaw.stageIndex, 0, FINAL_STAGE_INDEX);
  const qiCap = getStageDefinition(stageIndex).cap;
  const permanentStats = sanitizeStats(raw.permanentStats, PERMANENT_KEYS);
  permanentStats.criticalClicks = Math.max(permanentStats.criticalClicks, clamp(runRaw.stats?.criticalClicks));
  permanentStats.breakthroughAttempts = Math.max(permanentStats.breakthroughAttempts, permanentStats.totalBreakthroughs + clamp(runRaw.stats?.failedBreakthroughs));
  const migratedEncounterExpiresAt = isV2 && runRaw.encounterAvailable && !runRaw.encounterExpiresAt ? Math.min(now + ENCOUNTER_TTL_MS, Math.max(now + 60_000, clamp(runRaw.nextEncounterAt, 0, now + ENCOUNTER_TTL_MS))) : runRaw.encounterExpiresAt;
  const encounterAvailable = Boolean(runRaw.encounterAvailable) && typeof runRaw.activeEncounterId === "string" && clamp(migratedEncounterExpiresAt, 0, now + ENCOUNTER_TTL_MS) > timedStateActiveAt;
  const state = {
    version: SAVE_VERSION, savedAt: clamp(raw.savedAt, 0, now), lastTickAt: clamp(raw.lastTickAt, 0, now), generation: sanitizeInteger(raw.generation, 1, 1_000_000), crystals: sanitizeInteger(raw.crystals, 0, 1e15),
    spiritStones: sanitizeInteger(raw.spiritStones, 0, 1e15) + (isV1 && !raw.migration?.v1Compensated ? 5 : 0), migration: { v1Compensated: compensated }, talents: sanitizeNumberMap(raw.talents, TALENT_IDS, TALENT_LIMITS), permanentStats,
    tasks: sanitizeTasks(raw.tasks, now), achievements: sanitizeAchievements(raw.achievements, now),
    run: {
      qi: clamp(runRaw.qi, 0, qiCap), totalQi: clamp(runRaw.totalQi), stageIndex, lifespanRemaining: clamp(runRaw.lifespanRemaining, 0, 1e10), startedAt: clamp(runRaw.startedAt, 0, now),
      upgrades: sanitizeNumberMap(runRaw.upgrades, UPGRADE_IDS, UPGRADE_LIMITS), inventory: sanitizeNumberMap(runRaw.inventory, PILL_IDS, PILL_LIMITS), pillsPurchased: sanitizeNumberMap(runRaw.pillsPurchased, PILL_IDS), buffs: sanitizeBuffs(runRaw.buffs, now, timedStateActiveAt),
      weakUntil: clamp(runRaw.weakUntil, 0, now + 7 * 86_400_000) > timedStateActiveAt ? clamp(runRaw.weakUntil, 0, now + 7 * 86_400_000) : 0,
      lastManualClickAt: clamp(runRaw.lastManualClickAt, 0, now), lastTreasureClickAt: clamp(runRaw.lastTreasureClickAt, 0, now), nextEncounterAt: clamp(runRaw.nextEncounterAt, 0, now + MAX_ENCOUNTER_SECONDS * 2000) || nextEncounterTimestamp(now), encounterAvailable, activeEncounterId: encounterAvailable ? runRaw.activeEncounterId.slice(0, 80) : null,
      encounterExpiresAt: encounterAvailable ? clamp(migratedEncounterExpiresAt, timedStateActiveAt + 1, now + ENCOUNTER_TTL_MS) : 0, encounterAnnouncedId: encounterAvailable ? String(runRaw.encounterAnnouncedId || "").slice(0, 120) : "",
      skirmish: sanitizeSkirmishState(runRaw.skirmish, timedStateActiveAt), combat: sanitizeCombatState(runRaw.combat, now),
      eventBonuses: sanitizeBonuses(runRaw.eventBonuses), logs: sanitizeLogs(runRaw.logs, now), stats: sanitizeStats(runRaw.stats, RUN_STAT_KEYS)
    }
  };
  if (isV1 && !raw.migration?.v1Compensated) state.permanentStats.spiritStonesEarned += 5;
  return state;
}
export function loadState(now = Date.now()) {
  try {
    const serialized = localStorage.getItem(SAVE_KEY);
    if (!serialized) return { state: createDefaultState(now), isNew: true, migratedFromV1: false, loadError: null };
    const parsed = JSON.parse(serialized);
    const savedAt = clamp(parsed?.savedAt, 0, now);
    const parsedVersion = sanitizeInteger(parsed?.version, 1, SAVE_VERSION);
    const migratedFromV1 = parsedVersion < 2 && !parsed?.migration?.v1Compensated;
    return { state: sanitizeState(parsed, now, savedAt), isNew: false, migratedFromV1, migratedFromV2: parsedVersion === 2, loadError: null };
  } catch (error) { console.warn("存档读取失败，已使用安全默认值。", error); return { state: createDefaultState(now), isNew: true, migratedFromV1: false, loadError: error }; }
}
export function saveState(state, now = Date.now()) {
  try { state.version = SAVE_VERSION; state.savedAt = now; state.lastTickAt = now; localStorage.setItem(SAVE_KEY, JSON.stringify(sanitizeState(state, now))); return true; }
  catch (error) { console.warn("存档写入失败。", error); return false; }
}
export function prepareRebirthState(state, now = Date.now()) {
  const clean = sanitizeState(state, now);
  return { version: SAVE_VERSION, savedAt: now, lastTickAt: now, generation: clean.generation + 1, crystals: clean.crystals, spiritStones: clean.spiritStones, migration: { ...clean.migration }, talents: { ...clean.talents }, permanentStats: { ...clean.permanentStats }, tasks: clean.tasks, achievements: clean.achievements, run: createDefaultRun(now) };
}
export function replaceState(target, source) { for (const key of Object.keys(target)) delete target[key]; Object.assign(target, source); return target; }
export function addLog(state, title, text, now = Date.now()) { state.run.logs.unshift({ title: String(title).slice(0, 40), text: String(text).slice(0, 240), time: finiteNumber(now, Date.now()) }); state.run.logs = state.run.logs.slice(0, LOG_LIMIT); }
export function scheduleNextEncounter(state, now = Date.now(), speedReduction = 0) { const seconds = integerBetween(MIN_ENCOUNTER_SECONDS, MAX_ENCOUNTER_SECONDS) * (1 - clamp(speedReduction, 0, 0.6)); state.run.nextEncounterAt = now + seconds * 1000; state.run.encounterAvailable = false; state.run.activeEncounterId = null; state.run.encounterExpiresAt = 0; state.run.encounterAnnouncedId = ""; }
