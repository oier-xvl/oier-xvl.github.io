import { getRealmIndex, getStageDefinition, ITEM_BY_ID, SHOP_CATEGORIES } from "./config.js";
import { clamp, finiteNumber } from "./numbers.js";

export const TASK_WINDOW_MS = 600_000;
export const TASK_ARCHIVE_LIMIT = 8;
export const TASK_ARCHIVE_TTL_MS = 86_400_000;
const CLAIM_HISTORY_LIMIT = 80;

function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function makeRandom(seedText) {
  let value = hashString(seedText) || 0x9e3779b9;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
function randomInt(random, min, max) {
  return Math.floor(min + random() * (max - min + 1));
}
function pick(random, entries) {
  return entries[Math.floor(random() * entries.length)];
}
function roundUseful(value) {
  const safe = Math.max(1, value);
  const power = Math.pow(10, Math.max(0, Math.floor(Math.log10(safe)) - 1));
  return Math.max(1, Math.round(safe / power) * power);
}
function level(state, id) {
  return Math.max(0, Math.floor(finiteNumber(state.run.upgrades[id])));
}
function categoryTotal(state, categoryId) {
  return SHOP_CATEGORIES[categoryId].items.reduce((sum, item) => sum + level(state, item.id), 0);
}
function taskSnapshot(state, stats) {
  const cap = stats.stage.cap;
  const room = Math.max(0, cap - state.run.qi);
  return {
    realmIndex: stats.stage.realmIndex,
    stageIndex: state.run.stageIndex,
    cap,
    room,
    qps: stats.qps,
    clickYield: stats.clickYield,
    critChance: stats.critChance,
    hasRoots: SHOP_CATEGORIES.roots.items.some((item) => level(state, item.id) < item.maxLevel && stats.stage.realmIndex >= item.unlockRealm),
    hasArts: SHOP_CATEGORIES.arts.items.some((item) => level(state, item.id) < item.maxLevel && stats.stage.realmIndex >= item.unlockRealm),
    hasNonRoot: ["arrays", "treasures", "pills"].some((category) => SHOP_CATEGORIES[category].items.some((item) => stats.stage.realmIndex >= item.unlockRealm)),
    hasPill: Object.values(state.run.inventory).some((count) => count > 0),
    canEncounter: true,
    canCrit: stats.critChance > 0,
    canBreakthrough: !stats.stage.isFinal,
    progress: cap ? state.run.qi / cap : 1,
    artLevels: categoryTotal(state, "arts")
  };
}
function qiTarget(snapshot, random, secondsMin, secondsMax) {
  const reference = Math.max(snapshot.clickYield * 8, snapshot.qps * randomInt(random, secondsMin, secondsMax));
  const lower = snapshot.cap * 0.03;
  const upper = snapshot.cap * 0.25;
  return roundUseful(Math.min(snapshot.room, clamp(reference, lower, upper)));
}

const TEMPLATES = [
  { id: "manual_click", always: true, available: () => true, make: (s, r) => ({ name: "吐纳不辍", description: "亲手吐纳，稳固道心。", event: "manualClick", target: randomInt(r, 12, 28), difficulty: 1 }) },
  { id: "gain_qi", available: (s) => s.room >= s.cap * 0.03, make: (s, r) => ({ name: "纳气归元", description: "获得实际存入灵气，任何真实来源均可。", event: "qiStored", target: qiTarget(s, r, 30, 90), difficulty: 1 }) },
  { id: "idle_qi", available: (s) => s.qps > 0 && s.room >= s.cap * 0.03, make: (s, r) => ({ name: "静候周天", description: "由功法或法宝自动产出实际存入灵气。", event: "qiStored:idle", target: qiTarget(s, r, 45, 120), difficulty: 1.2 }) },
  { id: "critical", available: (s) => s.canCrit, make: (s, r) => ({ name: "灵机迸发", description: "触发暴击。", event: "critical", target: randomInt(r, 2, Math.max(3, Math.round(4 + s.realmIndex))), difficulty: 1.3 }) },
  { id: "buy_root", available: (s) => s.hasRoots, make: () => ({ name: "洗炼灵根", description: "购买任意灵根。", event: "purchase:roots", target: 1, difficulty: 1.1 }) },
  { id: "learn_art", available: (s) => s.hasArts, make: () => ({ name: "参悟功法", description: "学习任意功法。", event: "purchase:arts", target: 1, difficulty: 1.2 }) },
  { id: "buy_non_root", available: (s) => s.hasNonRoot, make: () => ({ name: "整备洞府", description: "购买任意非灵根商品。", event: "purchase:nonRoot", target: 1, difficulty: 1.1 }) },
  { id: "reach_eighty", available: (s) => s.progress < 0.8 && s.room >= s.cap * 0.03, make: () => ({ name: "将臻圆满", description: "令本阶灵气达到上限的80%。", event: "stageProgress", target: 0.8, difficulty: 1.2, absolute: true }) },
  { id: "attempt_break", available: (s) => s.canBreakthrough && s.progress >= 0.55, make: () => ({ name: "叩问关隘", description: "尝试一次突破。", event: "breakthroughAttempt", target: 1, difficulty: 1.4 }) },
  { id: "success_break", available: (s) => s.canBreakthrough && s.progress >= 0.8, make: () => ({ name: "更上层楼", description: "成功突破一次。", event: "breakthroughSuccess", target: 1, difficulty: 1.8 }) },
  { id: "consume_pill", available: (s) => s.hasPill, make: () => ({ name: "丹火温养", description: "服用一枚丹药。", event: "consumePill", target: 1, difficulty: 1.2 }) },
  { id: "encounter", available: (s) => s.canEncounter, make: () => ({ name: "应缘而行", description: "解决一次奇遇。", event: "encounter", target: 1, difficulty: 1.4 }) },
  { id: "combat_demonic", available: (s) => s.realmIndex >= 1, make: (s, r) => ({ name: "击败魔教修士", description: "挑战并击败一名魔教修士。", event: "combatVictory:demonic", target: 1, difficulty: 1.8, combat: { enemyType: "demonic", strength: 0.88 + s.realmIndex * 0.025, seedPart: randomInt(r, 1, 2_000_000_000) } }) },
  { id: "combat_beast", available: (s) => s.realmIndex >= 1, make: (s, r) => ({ name: "击败灵兽", description: "挑战并击败一头狡猾灵兽。", event: "combatVictory:beast", target: 1, difficulty: 1.9, combat: { enemyType: "beast", strength: 0.9 + s.realmIndex * 0.025, seedPart: randomInt(r, 1, 2_000_000_000) } }) }
];
export const TASK_TEMPLATE_IDS = new Set(TEMPLATES.map((entry) => entry.id));
const TASK_EVENT_BY_TEMPLATE = Object.fromEntries(TEMPLATES.map((template) => {
  const probe = template.make({ realmIndex: 0 }, () => 0);
  return [template.id, probe.event];
}));
const VALID_TASK_EVENTS = new Set([...Object.values(TASK_EVENT_BY_TEMPLATE), "purchase:nonRoot"]);
const COMBAT_TASK_TYPES = new Set(["demonic", "beast"]);

export function createTaskState(profileSeed = "", now = Date.now()) {
  return { profileSeed: profileSeed || `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`, windowId: -1, highestWindow: -1, lastObservedAt: now, claimCooldownUntil: 0, active: [], archive: [], claimedIds: [] };
}
export function getEffectiveWindowId(taskState, now = Date.now()) {
  const observed = Math.max(0, finiteNumber(taskState.lastObservedAt, now));
  const effectiveNow = Math.max(now, observed);
  return Math.max(Math.floor(effectiveNow / TASK_WINDOW_MS), Math.floor(finiteNumber(taskState.highestWindow, -1)));
}
export function generateTasks(state, stats, windowId) {
  const random = makeRandom(`${state.tasks.profileSeed}:${windowId}`);
  const snapshot = taskSnapshot(state, stats);
  const available = TEMPLATES.filter((template) => template.available(snapshot));
  const selected = [];
  const guaranteed = available.filter((template) => template.always);
  selected.push(pick(random, guaranteed.length ? guaranteed : available));
  while (selected.length < 3) {
    const choices = available.filter((template) => !selected.includes(template));
    selected.push(choices.length ? pick(random, choices) : TEMPLATES[0]);
  }
  return selected.map((template, slot) => {
    const detail = template.make(snapshot, random);
    const reward = Math.max(1, Math.min(5, Math.round(detail.difficulty + snapshot.realmIndex * 0.22 + random() * 0.55)));
    return { id: `${windowId}:${slot}`, windowId, slot, templateId: template.id, ...detail, reward, progress: detail.absolute && detail.event === "stageProgress" ? snapshot.progress : 0, completedAt: detail.absolute && snapshot.progress >= detail.target ? Date.now() : 0, claimedAt: 0, createdAt: windowId * TASK_WINDOW_MS, retryAt: 0, completedBattleId: "" };
  });
}
function archiveOldTasks(taskState, now) {
  for (const task of taskState.active) {
    if (task.completedAt && !task.claimedAt) taskState.archive.unshift({ ...task, archivedAt: now });
  }
  taskState.archive = taskState.archive.filter((task) => !task.claimedAt && now - task.completedAt <= TASK_ARCHIVE_TTL_MS).slice(0, TASK_ARCHIVE_LIMIT);
}
export function syncTaskWindow(state, stats, now = Date.now()) {
  const taskState = state.tasks;
  const previousObserved = finiteNumber(taskState.lastObservedAt, now);
  const rawWindow = Math.floor(now / TASK_WINDOW_MS);
  const previousHighest = Math.floor(finiteNumber(taskState.highestWindow, -1));
  const abnormalForward = previousObserved > 0 && now - previousObserved > TASK_ARCHIVE_TTL_MS;
  const effectiveWindow = Math.max(rawWindow, previousHighest);
  if (abnormalForward) {
    taskState.active = [];
    taskState.claimCooldownUntil = Math.max(taskState.claimCooldownUntil, now + 120_000);
  }
  if (taskState.windowId !== effectiveWindow) {
    archiveOldTasks(taskState, now);
    taskState.windowId = effectiveWindow;
    taskState.active = generateTasks(state, stats, effectiveWindow);
  }
  taskState.highestWindow = Math.max(previousHighest, effectiveWindow);
  taskState.lastObservedAt = Math.max(previousObserved, now);
  taskState.archive = taskState.archive.filter((task) => now - task.completedAt <= TASK_ARCHIVE_TTL_MS).slice(0, TASK_ARCHIVE_LIMIT);
  taskState.claimedIds = taskState.claimedIds.slice(-CLAIM_HISTORY_LIMIT);
  return effectiveWindow;
}
export function updateTaskProgress(state, event, amount = 1, detail = {}) {
  const tasks = state.tasks?.active || [];
  for (const task of tasks) {
    if (task.completedAt || task.claimedAt) continue;
    let matches = task.event === event;
    if (task.event === "purchase:nonRoot" && event.startsWith("purchase:") && event !== "purchase:roots") matches = true;
    if (task.event === "qiStored" && event.startsWith("qiStored")) matches = true;
    if (task.event === "qiStored:idle" && event === "qiStored" && detail.source === "idle") matches = true;
    if (task.event === "stageProgress" && event === "stageProgress") {
      task.progress = Math.max(task.progress, clamp(amount, 0, 1));
      matches = false;
    }
    if (matches) task.progress = clamp(task.progress + Math.max(0, finiteNumber(amount)), 0, task.target);
    if (task.progress >= task.target) task.completedAt = Date.now();
  }
}
export function getTaskChallenge(state, taskId, now = Date.now()) {
  const task = state.tasks.active.find((entry) => entry.id === taskId);
  if (!task?.combat || !COMBAT_TASK_TYPES.has(task.combat.enemyType)) return { ok: false, reason: "该任务无法挑战" };
  if (task.windowId !== state.tasks.windowId) return { ok: false, reason: "任务窗口已经失效" };
  if (task.completedAt) return { ok: false, reason: "该任务已经完成" };
  if (task.retryAt > now) return { ok: false, reason: `重试冷却尚余 ${Math.ceil((task.retryAt - now) / 1000)} 秒` };
  return { ok: true, task, options: { source: "task", taskId: task.id, taskWindowId: task.windowId, enemyType: task.combat.enemyType, strength: task.combat.strength, seed: `${state.tasks.profileSeed}:${task.windowId}:${task.slot}:${task.combat.seedPart}` } };
}

export function applyTaskCombatResult(state, result, now = Date.now()) {
  if (result.source !== "task") return { ok: false, reason: "并非任务战结果" };
  const task = state.tasks.active.find((entry) => entry.id === result.taskId);
  if (!task || !task.combat || task.windowId !== result.taskWindowId || task.windowId !== state.tasks.windowId) return { ok: false, reason: "原任务窗口已经失效" };
  if (task.completedAt || task.completedBattleId) return { ok: false, reason: "任务战结果已处理" };
  if (task.combat.enemyType !== result.enemyType) return { ok: false, reason: "敌人参数不匹配" };
  if (result.victory) {
    task.progress = task.target;
    task.completedAt = now;
    task.completedBattleId = String(result.battleId).slice(0, 120);
    task.retryAt = 0;
    return { ok: true, completed: true, task };
  }
  task.retryAt = now + 30_000;
  return { ok: true, completed: false, task };
}

export function claimTask(state, taskId, now = Date.now()) {
  if (state.tasks.claimCooldownUntil > now) return { ok: false, reason: "时间异常防护中，暂不可领取" };
  if (state.tasks.claimedIds.includes(taskId)) return { ok: false, reason: "该任务奖励已领取" };
  const collections = [state.tasks.active, state.tasks.archive];
  let task = null;
  for (const collection of collections) task ||= collection.find((entry) => entry.id === taskId);
  if (!task || !task.completedAt) return { ok: false, reason: "任务尚未完成或已失效" };
  if (task.claimedAt) return { ok: false, reason: "该任务奖励已领取" };
  task.claimedAt = now;
  state.spiritStones += task.reward;
  state.permanentStats.spiritStonesEarned += task.reward;
  state.permanentStats.tasksCompleted += 1;
  state.permanentStats.tasksClaimed += 1;
  state.tasks.claimedIds.push(task.id);
  state.tasks.claimedIds = state.tasks.claimedIds.slice(-CLAIM_HISTORY_LIMIT);
  state.tasks.archive = state.tasks.archive.filter((entry) => entry.id !== task.id);
  return { ok: true, task, reward: task.reward };
}
export function getTaskCountdown(state, now = Date.now()) {
  const next = (state.tasks.windowId + 1) * TASK_WINDOW_MS;
  return Math.max(0, next - now);
}
export function sanitizeTasks(raw, now = Date.now()) {
  const fallback = createTaskState("", now);
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const sanitizeTask = (task) => {
    if (!task || !TASK_TEMPLATE_IDS.has(task.templateId) || typeof task.id !== "string") return null;
    const event = String(task.event || "").slice(0, 40);
    if (!VALID_TASK_EVENTS.has(event) || event !== TASK_EVENT_BY_TEMPLATE[task.templateId]) return null;
    const target = clamp(task.target, 0.0001, 1e300);
    const completedAt = clamp(task.completedAt, 0, now);
    const claimedAt = clamp(task.claimedAt, 0, now);
    if (claimedAt && (!completedAt || claimedAt < completedAt)) return null;
    return {
      id: task.id.slice(0, 80), windowId: Math.floor(finiteNumber(task.windowId, -1)), slot: Math.floor(clamp(task.slot, 0, 2)), templateId: task.templateId,
      name: String(task.name || "任务").slice(0, 40), description: String(task.description || "").slice(0, 160), event,
      target, difficulty: clamp(task.difficulty, 0, 10), reward: Math.floor(clamp(task.reward, 1, 5)), progress: clamp(task.progress, 0, target),
      completedAt, claimedAt, createdAt: clamp(task.createdAt, 0, now), archivedAt: clamp(task.archivedAt, 0, now), absolute: task.templateId === "reach_eighty",
      combat: task.templateId.startsWith("combat_") && COMBAT_TASK_TYPES.has(task.combat?.enemyType) ? { enemyType: task.combat.enemyType, strength: clamp(task.combat.strength, 0.75, 1.45), seedPart: Math.floor(clamp(task.combat.seedPart, 1, 2_000_000_000)) } : null,
      retryAt: clamp(task.retryAt, 0, now + TASK_ARCHIVE_TTL_MS), completedBattleId: completedAt ? String(task.completedBattleId || "").slice(0, 120) : ""
    };
  };
  const windowId = Math.floor(finiteNumber(source.windowId, -1));
  const claimedIds = [...new Set((Array.isArray(source.claimedIds) ? source.claimedIds : []).slice(-CLAIM_HISTORY_LIMIT).map((id) => String(id).slice(0, 80)))];
  const seen = new Set(claimedIds);
  const active = [];
  for (const task of (Array.isArray(source.active) ? source.active : []).slice(0, 3).map(sanitizeTask).filter(Boolean)) {
    if (task.windowId !== windowId || seen.has(task.id)) continue;
    seen.add(task.id);
    active.push(task);
  }
  const archive = [];
  for (const task of (Array.isArray(source.archive) ? source.archive : []).slice(0, TASK_ARCHIVE_LIMIT).map(sanitizeTask).filter(Boolean)) {
    if (task.windowId >= windowId || seen.has(task.id) || !task.completedAt || task.claimedAt) continue;
    seen.add(task.id);
    archive.push(task);
  }
  return {
    profileSeed: String(source.profileSeed || fallback.profileSeed).slice(0, 100), windowId, highestWindow: Math.floor(finiteNumber(source.highestWindow, -1)),
    lastObservedAt: clamp(source.lastObservedAt, 0, now + TASK_ARCHIVE_TTL_MS), claimCooldownUntil: clamp(source.claimCooldownUntil, 0, now + TASK_ARCHIVE_TTL_MS),
    active, archive, claimedIds
  };
}
