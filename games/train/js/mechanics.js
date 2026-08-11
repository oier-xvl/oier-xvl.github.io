import {
  ALL_SHOP_ITEMS, FINAL_STAGE_INDEX, FOUNDATION_REQUIREMENTS, getRealmIndex, getStageDefinition,
  ITEM_BY_ID, MAX_OFFLINE_SECONDS, REALMS, SHOP_CATEGORIES, TALENTS
} from "./config.js";
import { clamp, finiteNumber, geometricCost, safeAdd, safeMultiply } from "./numbers.js";
import { addLog, clampCurrentQi, grantQi, loseQi, prepareRebirthState, replaceState, spendSpiritStones } from "./state.js";
import { updateTaskProgress } from "./tasks.js";
import { cancelCombat, isCombatBlocking } from "./combat.js";

function getLevel(state, id) { return Math.max(0, Math.floor(finiteNumber(state.run.upgrades[id]))); }
function getTalentLevel(state, id) { return Math.max(0, Math.floor(finiteNumber(state.talents[id]))); }
function repeatedMultiplier(multiplier, level) { return Math.pow(finiteNumber(multiplier, 1), Math.max(0, level)); }
function categoryTotal(state, category) { return SHOP_CATEGORIES[category].items.reduce((sum, item) => sum + getLevel(state, item.id), 0); }
export function purgeExpiredTimedStates(state, now = Date.now()) {
  for (const [id, buff] of Object.entries(state.run.buffs)) if (!buff || finiteNumber(buff.expiresAt) <= now) delete state.run.buffs[id];
  if (state.run.weakUntil <= now) state.run.weakUntil = 0;
}
export function getRealmMultiplier(stageIndex) {
  const enteredRealm = getRealmIndex(stageIndex);
  let multiplier = 1;
  for (let index = 1; index <= enteredRealm; index += 1) multiplier = safeMultiply(multiplier, REALMS[index].multiplier);
  return multiplier;
}
export function getDerivedStats(state, now = Date.now()) {
  purgeExpiredTimedStates(state, now);
  const stage = getStageDefinition(state.run.stageIndex);
  const mortal = getLevel(state, "root_mortal");
  const earth = getLevel(state, "root_earth");
  const heaven = getLevel(state, "root_heaven");
  const chaos = getLevel(state, "root_chaos");
  const rootRaw = 1 + 0.16 * earth + 0.28 * heaven + 0.45 * chaos;
  const rootMultiplier = Math.pow(rootRaw, 0.72);
  const baseClick = 1 + 0.8 * mortal;
  let clickMultiplier = safeMultiply(rootMultiplier, finiteNumber(state.run.eventBonuses.clickMultiplier, 1), state.achievements?.bonuses?.clickMultiplier || 1);
  let qpsMultiplier = finiteNumber(state.run.eventBonuses.qpsMultiplier, 1);
  let globalMultiplier = safeMultiply(getRealmMultiplier(state.run.stageIndex), finiteNumber(state.run.eventBonuses.globalMultiplier, 1));
  let lifespanMultiplier = finiteNumber(state.run.eventBonuses.lifespanMultiplier, 1);
  let critChance = 0.05 + heaven * 0.006 + finiteNumber(state.run.eventBonuses.critChance);
  let critDamage = 2 + chaos * 0.25 + finiteNumber(state.run.eventBonuses.critDamage);
  let breakthroughBonus = finiteNumber(state.run.eventBonuses.breakthrough) + (state.achievements?.bonuses?.breakthrough || 0);
  let baseQps = 0;
  let artLevels = 0;
  for (const item of SHOP_CATEGORIES.arts.items) { const level = getLevel(state, item.id); baseQps += item.qps * level; artLevels += level; }
  baseQps *= 1 + 0.08 * Math.sqrt(artLevels);
  let arrayPower = 0;
  for (const item of SHOP_CATEGORIES.arrays.items) arrayPower += item.arrayPower * getLevel(state, item.id);
  const arrayMultiplier = 1 + arrayPower / (1 + arrayPower / 4);
  globalMultiplier = safeMultiply(globalMultiplier, arrayMultiplier);
  lifespanMultiplier *= 1 + getLevel(state, "array_time") * 0.015;
  for (const talent of TALENTS) {
    const level = getTalentLevel(state, talent.id);
    if (talent.clickMultiplier) clickMultiplier = safeMultiply(clickMultiplier, repeatedMultiplier(talent.clickMultiplier, level));
    if (talent.qpsMultiplier) qpsMultiplier = safeMultiply(qpsMultiplier, repeatedMultiplier(talent.qpsMultiplier, level));
    if (talent.breakthrough) breakthroughBonus += talent.breakthrough * level;
    if (talent.critDamage) critDamage += talent.critDamage * level;
    if (talent.lifespanMultiplier) lifespanMultiplier = safeMultiply(lifespanMultiplier, repeatedMultiplier(talent.lifespanMultiplier, level));
  }
  let pillMultiplier = 1;
  let pillBreakthrough = 0;
  let pillCritChance = 0;
  for (const buff of Object.values(state.run.buffs)) {
    pillMultiplier = Math.min(3.5, safeMultiply(pillMultiplier, finiteNumber(buff.multiplier, 1)));
    pillBreakthrough += finiteNumber(buff.breakthrough);
    pillCritChance += finiteNumber(buff.critChance);
  }
  const bellLevel = getLevel(state, "treasure_bell");
  const mirrorLevel = getLevel(state, "treasure_mirror");
  const cauldronLevel = getLevel(state, "treasure_cauldron");
  breakthroughBonus += mirrorLevel * 0.03;
  const weakMultiplier = state.run.weakUntil > now ? 0.45 : 1;
  const totalMultiplier = safeMultiply(globalMultiplier, pillMultiplier, weakMultiplier);
  return {
    stage, baseClick, rootMultiplier, arrayMultiplier, artLevels,
    clickYield: safeMultiply(baseClick, clickMultiplier, totalMultiplier),
    qps: safeMultiply(baseQps, qpsMultiplier, totalMultiplier),
    globalMultiplier: safeMultiply(globalMultiplier, pillMultiplier),
    clickIntervalMs: Math.max(180, 300 - 6 * mortal - 3 * earth),
    critChance: clamp(critChance + pillCritChance, 0, 0.8), critDamage: clamp(critDamage, 2, 100),
    successChance: stage.realmIndex < 2 ? 1 : clamp(stage.success + breakthroughBonus + pillBreakthrough, 0.05, 1),
    lifespanMultiplier, maxLifespan: REALMS[stage.realmIndex].lifespan * lifespanMultiplier, weakMultiplier,
    autoClickInterval: bellLevel ? Math.max(6, 12 - (bellLevel - 1) * (6 / 7)) : 0,
    autoClickYield: bellLevel ? safeMultiply(baseClick, clickMultiplier, totalMultiplier, 0.35) : 0,
    pillDurationMultiplier: 1 + cauldronLevel * 0.15, pillLifespanRestore: cauldronLevel * 20, isWeak: state.run.weakUntil > now
  };
}
export function initializeRunBonuses(state, now = Date.now()) {
  const roots = getTalentLevel(state, "talent_root");
  if (roots > 0 && getLevel(state, "root_mortal") === 0) state.run.upgrades.root_mortal = Math.min(roots, ITEM_BY_ID.root_mortal.maxLevel);
  const stats = getDerivedStats(state, now);
  if (!Number.isFinite(state.run.lifespanRemaining) || state.run.lifespanRemaining <= 0 || (state.run.stageIndex === 0 && state.run.totalQi === 0)) state.run.lifespanRemaining = stats.maxLifespan;
}
export function manualCultivate(state, now = Date.now(), random = Math.random) {
  const stats = getDerivedStats(state, now);
  if (isCombatBlocking(state)) return { ok: false, reason: "战斗中无法吐纳" };
  if (state.run.lifespanRemaining <= 0) return { ok: false, reason: "寿元已尽" };
  if (now - state.run.lastManualClickAt < stats.clickIntervalMs) return { ok: false, reason: "吐纳未稳" };
  state.run.lastManualClickAt = now;
  const critical = random() < stats.critChance;
  const amount = grantQi(state, stats.clickYield * (critical ? stats.critDamage : 1), "click");
  state.run.stats.clicks += 1; state.permanentStats.totalClicks += 1; updateTaskProgress(state, "manualClick", 1);
  if (critical) { state.run.stats.criticalClicks += 1; state.permanentStats.criticalClicks += 1; updateTaskProgress(state, "critical", 1); }
  updateTaskProgress(state, "stageProgress", state.run.qi / stats.stage.cap);
  return { ok: true, amount, critical, interval: stats.clickIntervalMs };
}
function applyAutoClicks(state, seconds, now) {
  const stats = getDerivedStats(state, now);
  if (!stats.autoClickInterval || seconds <= 0) return { count: 0, qi: 0 };
  const dueCount = Math.floor(Math.max(0, (now - state.run.lastTreasureClickAt) / 1000) / stats.autoClickInterval);
  const count = Math.min(dueCount, Math.max(1, Math.ceil(seconds / stats.autoClickInterval)));
  if (count <= 0) return { count: 0, qi: 0 };
  const qi = grantQi(state, stats.autoClickYield * count, "idle");
  state.run.lastTreasureClickAt += count * stats.autoClickInterval * 1000;
  return { count, qi };
}
export function advanceTime(state, seconds, now = Date.now()) {
  const maxOffline = MAX_OFFLINE_SECONDS + (state.achievements?.bonuses?.offlineExtraSeconds || 0);
  const safeSeconds = clamp(seconds, 0, maxOffline);
  if (safeSeconds <= 0 || state.run.lifespanRemaining <= 0) { purgeExpiredTimedStates(state, now); return { elapsed: 0, qi: 0, autoClicks: 0, expired: state.run.lifespanRemaining <= 0 }; }
  const aliveSeconds = Math.min(safeSeconds, state.run.lifespanRemaining);
  const start = now - safeSeconds * 1000, end = start + aliveSeconds * 1000;
  let cursor = start, idleQi = 0, autoClickQi = 0, autoClicks = 0;
  while (cursor < end) {
    const boundaries = [end];
    if (state.run.weakUntil > cursor && state.run.weakUntil < end) boundaries.push(state.run.weakUntil);
    for (const buff of Object.values(state.run.buffs)) if (buff?.expiresAt > cursor && buff.expiresAt < end) boundaries.push(buff.expiresAt);
    const segmentEnd = Math.min(...boundaries), segmentSeconds = Math.max(0, (segmentEnd - cursor) / 1000), stats = getDerivedStats(state, cursor);
    idleQi = safeAdd(idleQi, grantQi(state, stats.qps * segmentSeconds, "idle"));
    const auto = applyAutoClicks(state, segmentSeconds, segmentEnd); autoClicks += auto.count; autoClickQi = safeAdd(autoClickQi, auto.qi); cursor = segmentEnd;
  }
  purgeExpiredTimedStates(state, now); state.run.lifespanRemaining = clamp(state.run.lifespanRemaining - aliveSeconds, 0);
  const stats = getDerivedStats(state, now); updateTaskProgress(state, "stageProgress", state.run.qi / stats.stage.cap);
  return { elapsed: aliveSeconds, qi: safeAdd(idleQi, autoClickQi), autoClicks, expired: state.run.lifespanRemaining <= 0, truncatedByLifespan: aliveSeconds < safeSeconds };
}
export function calculateOfflineProgress(state, now = Date.now()) {
  const elapsed = Math.min(MAX_OFFLINE_SECONDS + (state.achievements?.bonuses?.offlineExtraSeconds || 0), Math.max(0, (now - clamp(state.savedAt, 0, now)) / 1000));
  if (elapsed < 5) return { elapsed: 0, qi: 0, autoClicks: 0, expired: false };
  const result = advanceTime(state, elapsed, now); state.lastTickAt = now; return result;
}
export function getItemCost(state, item) {
  const level = item.buffId ? state.run.pillsPurchased[item.id] : getLevel(state, item.id);
  if (item.currency === "dual") return { stones: geometricCost(item.stoneCost, item.stoneGrowth, level), qi: geometricCost(item.qiCost, item.qiGrowth, level) };
  if (item.currency === "qi") return { qi: Math.floor(item.baseCost * Math.pow(item.growth, level) * (1 + 0.12 * Math.pow(Math.max(0, level - item.softCap), 2))), stones: 0 };
  return { stones: geometricCost(item.baseCost, item.growth, level), qi: 0 };
}
export function getItemLevel(state, item) { return item.buffId ? state.run.inventory[item.id] : getLevel(state, item.id); }
export function canPurchaseItem(state, item) {
  if (isCombatBlocking(state)) return { ok: false, reason: "战斗中无法购买" };
  const realmIndex = getRealmIndex(state.run.stageIndex);
  if (realmIndex < item.unlockRealm) return { ok: false, reason: `需抵达${REALMS[item.unlockRealm].name}` };
  if (item.buffId && state.run.inventory[item.id] >= item.maxStock) return { ok: false, reason: "库存已满" };
  if (!item.buffId && getLevel(state, item.id) >= item.maxLevel) return { ok: false, reason: "已至圆满" };
  const cost = getItemCost(state, item), missing = [];
  if (state.run.qi < cost.qi) missing.push("灵气");
  if (state.spiritStones < cost.stones) missing.push("灵石");
  if (missing.length) return { ok: false, reason: `${missing.join("与")}不足`, cost, missing };
  return { ok: true, cost };
}
export function purchaseItem(state, itemId, now = Date.now()) {
  const item = ITEM_BY_ID[itemId];
  if (!item) return { ok: false, reason: "未知养成" };
  clampCurrentQi(state);
  const check = canPurchaseItem(state, item);
  if (!check.ok) return check;
  const previousLevel = item.buffId ? 0 : getLevel(state, item.id);
  if (state.run.qi < check.cost.qi || state.spiritStones < check.cost.stones) return { ok: false, reason: "资源状态已变化" };
  if (check.cost.qi) loseQi(state, check.cost.qi);
  if (check.cost.stones && !spendSpiritStones(state, check.cost.stones)) { state.run.qi += check.cost.qi; return { ok: false, reason: "灵石不足" }; }
  if (item.buffId) { state.run.inventory[item.id] += 1; state.run.pillsPurchased[item.id] += 1; } else { state.run.upgrades[item.id] += 1; if (item.mechanism === "autoClick" && previousLevel === 0) state.run.lastTreasureClickAt = now; }
  const statKey = `purchases${item.category[0].toUpperCase()}${item.category.slice(1)}`;
  state.run.stats[statKey] += 1; state.permanentStats[statKey] += 1; state.permanentStats.totalPurchases += 1;
  updateTaskProgress(state, `purchase:${item.category}`, 1);
  addLog(state, "洞府有成", `${item.name}${item.buffId ? "收入丹囊" : `提升至 ${getLevel(state, item.id)} 级`}。`, now);
  return { ok: true, item, cost: check.cost, level: getItemLevel(state, item) };
}
export function consumePill(state, pillId, now = Date.now()) {
  const pill = ITEM_BY_ID[pillId];
  if (isCombatBlocking(state)) return { ok: false, reason: "战斗中请使用战斗操作" };
  if (!pill?.buffId || pill.combatPill) return { ok: false, reason: "此丹仅可在战斗中使用" };
  if (state.run.inventory[pillId] <= 0) return { ok: false, reason: "丹囊中并无此丹" };
  const stats = getDerivedStats(state, now), existing = state.run.buffs[pillId], baseTime = existing?.expiresAt > now ? existing.expiresAt : now, duration = pill.duration * stats.pillDurationMultiplier;
  state.run.inventory[pillId] -= 1;
  state.run.buffs[pillId] = { expiresAt: baseTime + duration * 1000, multiplier: pill.multiplier || 1, breakthrough: pill.breakthrough || 0, critChance: pill.critChance || 0 };
  if (stats.pillLifespanRestore > 0) state.run.lifespanRemaining = clamp(state.run.lifespanRemaining + stats.pillLifespanRestore, 0, stats.maxLifespan * 1.5);
  state.run.stats.pillsConsumed += 1; state.permanentStats.pillsConsumed += 1; updateTaskProgress(state, "consumePill", 1);
  addLog(state, "丹药入腹", `${pill.name}化作暖流，药力将持续一段时间。`, now);
  return { ok: true, pill, duration, lifespanRestore: stats.pillLifespanRestore };
}
export function getAvailablePills(state) { return SHOP_CATEGORIES.pills.items.filter((pill) => !pill.combatPill && state.run.inventory[pill.id] > 0); }
export function getFoundationRequirements(state) {
  const stage = getStageDefinition(state.run.stageIndex);
  if (stage.substage !== 3 || stage.isFinal) return [];
  return (FOUNDATION_REQUIREMENTS[stage.realmIndex + 1] || []).map((requirement) => {
    let current = 0;
    if (requirement.type === "upgrade") current = getLevel(state, requirement.id);
    if (requirement.type === "inventory") current = state.run.inventory[requirement.id] || 0;
    if (requirement.type === "runStat") current = state.run.stats[requirement.id] || 0;
    if (requirement.type === "permanentStat") current = state.permanentStats[requirement.id] || 0;
    if (requirement.type === "categoryTotal") current = categoryTotal(state, requirement.id);
    return { ...requirement, current, met: current >= requirement.amount };
  });
}
export function canBreakthrough(state, now = Date.now()) {
  const stats = getDerivedStats(state, now);
  if (isCombatBlocking(state)) return { ok: false, reason: "战斗中无法突破", requirements: [] };
  if (stats.stage.isFinal) return { ok: false, reason: "已立于渡劫大圆满", requirements: [] };
  if (state.run.lifespanRemaining <= 0) return { ok: false, reason: "寿元已尽", requirements: [] };
  if (state.run.qi < stats.stage.cap) return { ok: false, reason: "灵气尚未圆满", requirements: getFoundationRequirements(state) };
  const requirements = getFoundationRequirements(state), missing = requirements.filter((entry) => !entry.met);
  if (missing.length) return { ok: false, reason: `道基未成：${missing.map((entry) => entry.label).join("、")}`, requirements };
  return { ok: true, stats, requirements };
}
export function attemptBreakthrough(state, now = Date.now(), random = Math.random) {
  clampCurrentQi(state);
  const check = canBreakthrough(state, now);
  if (!check.ok) return check;
  state.run.stats.breakthroughAttempts += 1;
  state.permanentStats.breakthroughAttempts += 1;
  updateTaskProgress(state, "breakthroughAttempt", 1);
  const { stats } = check, cost = stats.stage.cap;
  if (random() <= stats.successChance) {
    loseQi(state, cost); state.run.stageIndex = Math.min(FINAL_STAGE_INDEX, state.run.stageIndex + 1); clampCurrentQi(state);
    state.run.stats.breakthroughs += 1; state.permanentStats.totalBreakthroughs += 1; state.permanentStats.highestStage = Math.max(state.permanentStats.highestStage, state.run.stageIndex); updateTaskProgress(state, "breakthroughSuccess", 1);
    const nextStats = getDerivedStats(state, now); state.run.lifespanRemaining = Math.max(state.run.lifespanRemaining, nextStats.maxLifespan);
    const nextStage = getStageDefinition(state.run.stageIndex); addLog(state, "破境功成", `天地灵机汇聚，你已踏入${nextStage.name}。`, now); return { ok: true, success: true, nextStage, chance: stats.successChance };
  }
  const loss = loseQi(state, cost * (0.18 + random() * 0.17)), weakSeconds = 45 + stats.stage.realmIndex * 15;
  state.run.weakUntil = Math.max(state.run.weakUntil, now + weakSeconds * 1000); state.run.stats.failedBreakthroughs += 1; addLog(state, "破境受挫", `经脉震荡，损失部分灵气，并虚弱 ${weakSeconds} 秒。`, now);
  return { ok: true, success: false, loss, weakSeconds, chance: stats.successChance };
}
export function getTalentCost(state, talent) { return geometricCost(talent.baseCost, talent.growth, getTalentLevel(state, talent.id)); }
export function purchaseTalent(state, talentId, now = Date.now()) {
  if (isCombatBlocking(state)) return { ok: false, reason: "战斗中无法参悟天赋" };
  const talent = TALENTS.find((entry) => entry.id === talentId);
  if (!talent) return { ok: false, reason: "未知天赋" };
  const level = getTalentLevel(state, talent.id), cost = getTalentCost(state, talent);
  if (level >= talent.maxLevel) return { ok: false, reason: "已完全点亮" };
  if (state.crystals < cost) return { ok: false, reason: "天道结晶不足" };
  state.crystals -= cost; state.talents[talent.id] = level + 1; state.permanentStats.talentsPurchased += 1; initializeRunBonuses(state, now); addLog(state, "天道回响", `${talent.name}提升至 ${level + 1} 级。`, now);
  return { ok: true, talent, cost, level: level + 1 };
}
export function getRebirthReward(state) {
  const stageFactor = Math.pow(state.run.stageIndex + 1, 1.52), qiFactor = Math.max(0, Math.log10(Math.max(1, state.run.totalQi)) - 2), multiplier = repeatedMultiplier(1.25, getTalentLevel(state, "talent_rebirth"));
  return Math.max(0, Math.floor((stageFactor * 0.32 + qiFactor * 1.8) * multiplier));
}
export function performRebirth(state, reason = "主动兵解", now = Date.now()) {
  if (isCombatBlocking(state)) cancelCombat(state);
  const reward = getRebirthReward(state), previousStage = getStageDefinition(state.run.stageIndex);
  state.crystals = clamp(state.crystals + reward, 0, 1e15); state.permanentStats.totalRebirths += 1;
  const fresh = prepareRebirthState(state, now); replaceState(state, fresh); initializeRunBonuses(state, now); addLog(state, "轮回再启", `${reason}。前世止步于${previousStage.name}，凝得 ${reward} 枚天道结晶。`, now);
  return { reward, previousStage, reason };
}
