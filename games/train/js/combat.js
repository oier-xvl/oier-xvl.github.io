import {
  getRealmIndex, getStageDefinition, ITEM_BY_ID, MAX_SKIRMISH_SECONDS, MIN_SKIRMISH_SECONDS,
  SKIRMISH_TTL_MS
} from "./config.js";
import { clamp, finiteNumber } from "./numbers.js";
import { updateTaskProgress } from "./tasks.js";

export const COMBAT_STATES = new Set(["idle", "playerTurn", "enemyTurn", "victory", "defeat", "retreated", "settling"]);
export const ACTIVE_COMBAT_STATES = new Set(["playerTurn", "enemyTurn"]);
export const TERMINAL_COMBAT_STATES = new Set(["victory", "defeat", "retreated", "settling"]);
export const ENEMY_TYPES = new Set(["demonic", "guardian", "beast", "boss"]);
const COMBAT_LOG_LIMIT = 8;
const MAX_BATTLE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededValue(seed, cursor) {
  let value = (hashString(String(seed)) + Math.imul(cursor + 1, 0x6d2b79f5)) >>> 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function random(combat) {
  const value = seededValue(combat.seed, combat.cursor);
  combat.cursor += 1;
  return value;
}

function randomRange(combat, min, max) {
  return min + random(combat) * (max - min);
}

function weightedChoice(combat, entries) {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  let roll = random(combat) * total;
  for (const entry of entries) {
    roll -= Math.max(0, entry.weight);
    if (roll <= 0) return entry.id;
  }
  return entries[entries.length - 1]?.id || "normal";
}

function level(state, id) {
  return Math.max(0, Math.floor(finiteNumber(state.run.upgrades[id])));
}

function categoryLevels(state, category) {
  return Object.values(ITEM_BY_ID).filter((item) => item.category === category && !item.buffId).reduce((sum, item) => sum + level(state, item.id), 0);
}

function swordAttack(levelValue) {
  return Math.min(4, levelValue) * 2 + Math.max(0, levelValue - 4);
}

export function createCombatState() {
  return {
    status: "idle", battleId: "", seed: "", cursor: 0, source: null, taskId: "", taskWindowId: -1,
    startedAt: 0, updatedAt: 0, playerTurnNumber: 0, enemyTurnNumber: 0, resultApplied: false,
    player: null, enemy: null, flags: { usedPill: false }, logs: []
  };
}

export function createSkirmishState(now = Date.now()) {
  return { nextAt: scheduleTimestamp(now), available: false, expiresAt: 0, enemyType: "", seed: "", announcedId: "", cooldownUntil: 0 };
}

export function isCombatActive(state) {
  return ACTIVE_COMBAT_STATES.has(state?.run?.combat?.status);
}

export function isCombatBlocking(state) {
  return state?.run?.combat?.status !== "idle";
}

export function getCombatPlayerSnapshot(state) {
  const stage = getStageDefinition(state.run.stageIndex);
  const artLevels = categoryLevels(state, "arts");
  const arrayLevels = categoryLevels(state, "arrays");
  const swordLevel = level(state, "treasure_sword");
  const sealLevel = level(state, "treasure_seal");
  const maxHp = Math.floor(80 + 22 * stage.realmIndex + 6 * stage.substage + 8 * Math.sqrt(artLevels));
  const attack = Math.floor(10 + 4 * stage.realmIndex + stage.substage + 1.5 * Math.sqrt(artLevels) + swordAttack(swordLevel) + sealLevel);
  const defense = Math.floor(4 + 2 * stage.realmIndex + 0.6 * Math.sqrt(arrayLevels) + sealLevel * 2);
  const inheritedCrit = 0.05 + level(state, "root_heaven") * 0.006 + finiteNumber(state.run.eventBonuses.critChance);
  const inheritedCritDamage = 1.5 + level(state, "root_chaos") * 0.08 + finiteNumber(state.run.eventBonuses.critDamage) * 0.08 + finiteNumber(state.talents.talent_thunder) * 0.08;
  return {
    name: "道友", maxHp, hp: maxHp, attack: Math.max(1, attack), defense: Math.max(0, defense),
    critChance: clamp(inheritedCrit, 0, 0.35), critDamage: clamp(inheritedCritDamage, 1.5, 2.2),
    spellIgnore: clamp(0.25 + sealLevel * 0.03, 0.25, 0.43), resolve: 3, maxResolve: 6,
    spellCooldown: 0, guarding: false, chargeAttack: false, chargeVulnerable: false, buffs: {}
  };
}

const ENEMY_TEMPLATES = {
  demonic: { name: "激进魔修", hp: 0.9, attack: 1.15, defense: 0.8 },
  guardian: { name: "防守修士", hp: 1.1, attack: 0.9, defense: 1.2 },
  beast: { name: "狡猾灵兽", hp: 1, attack: 1, defense: 0.95 },
  boss: { name: "赤煞魔君", hp: 1.45, attack: 1.08, defense: 1.12, boss: true }
};

function createEnemy(player, type, strength = 1) {
  const template = ENEMY_TEMPLATES[type] || ENEMY_TEMPLATES.demonic;
  const boundedStrength = clamp(strength, 0.75, 1.45);
  const maxHp = Math.max(24, Math.floor(player.maxHp * template.hp * boundedStrength));
  return {
    type, name: template.name, maxHp, hp: maxHp,
    attack: Math.max(5, Math.floor(player.attack * template.attack * boundedStrength)),
    defense: Math.max(1, Math.floor(player.defense * template.defense * boundedStrength)),
    guarding: false, consecutiveGuards: 0, charging: false, enraged: false, boss: Boolean(template.boss)
  };
}

function appendLog(combat, text) {
  combat.logs.push(String(text).slice(0, 160));
  combat.logs = combat.logs.slice(-COMBAT_LOG_LIMIT);
}

export function startCombat(state, options = {}, now = Date.now()) {
  if (isCombatBlocking(state)) return { ok: false, reason: "已有一场战斗尚未结束" };
  if (state.run.lifespanRemaining <= 0) return { ok: false, reason: "寿元已尽" };
  const type = ENEMY_TYPES.has(options.enemyType) ? options.enemyType : "demonic";
  const seed = String(options.seed || `${now}:${type}:${state.generation}`).slice(0, 120);
  const battleId = `${state.generation}:${now}:${hashString(seed).toString(36)}`;
  const player = getCombatPlayerSnapshot(state);
  state.run.combat = {
    ...createCombatState(), status: "playerTurn", battleId, seed, source: options.source === "task" ? "task" : "skirmish",
    taskId: options.source === "task" ? String(options.taskId || "").slice(0, 80) : "",
    taskWindowId: options.source === "task" ? Math.floor(finiteNumber(options.taskWindowId, -1)) : -1,
    startedAt: now, updatedAt: now, playerTurnNumber: 1, player,
    enemy: createEnemy(player, type, options.strength), flags: { usedPill: false }, logs: []
  };
  appendLog(state.run.combat, `${state.run.combat.enemy.name}现身，你先手应战。`);
  return { ok: true, combat: state.run.combat };
}

function playerAttackValue(combat) {
  let multiplier = 1;
  for (const buff of Object.values(combat.player.buffs)) multiplier *= finiteNumber(buff.attackMultiplier, 1);
  return combat.player.attack * multiplier;
}

function consumeChargeAttack(combat) {
  if (!combat.player.chargeAttack) return 1;
  combat.player.chargeAttack = false;
  return 1.35;
}

function calculatePlayerDamage(combat, coefficient = 1, ignoreDefense = 0) {
  const attack = playerAttackValue(combat) * coefficient * consumeChargeAttack(combat);
  const defense = combat.enemy.defense * (1 - clamp(ignoreDefense, 0, 0.9));
  let damage = Math.max(1, Math.floor(attack * randomRange(combat, 0.9, 1.1) - defense * 0.55));
  const critical = random(combat) < combat.player.critChance;
  if (critical) damage = Math.max(1, Math.floor(damage * combat.player.critDamage));
  if (combat.enemy.guarding) {
    damage = Math.max(1, Math.floor(damage * 0.55));
    combat.enemy.guarding = false;
  }
  return { damage, critical };
}

function finishIfEnemyDefeated(combat, now) {
  if (combat.enemy.hp > 0) return false;
  combat.enemy.hp = 0;
  combat.status = "victory";
  combat.updatedAt = now;
  appendLog(combat, `${combat.enemy.name}败退。`);
  return true;
}

function tickPlayerBuffs(combat) {
  for (const [id, buff] of Object.entries(combat.player.buffs)) {
    buff.turns -= 1;
    if (buff.turns <= 0) delete combat.player.buffs[id];
  }
}

function beginEnemyTurn(combat, now) {
  combat.status = "enemyTurn";
  combat.updatedAt = now;
}

function canPlayerAct(combat) {
  return combat?.status === "playerTurn" && combat.player?.hp > 0 && combat.enemy?.hp > 0;
}

export function playerAction(state, action, payload = {}, now = Date.now()) {
  const combat = state.run.combat;
  if (!canPlayerAct(combat)) return { ok: false, reason: "当前不是你的回合" };
  if (action === "attack") {
    const hit = calculatePlayerDamage(combat);
    combat.enemy.hp = Math.max(0, combat.enemy.hp - hit.damage);
    combat.player.resolve = Math.min(6, combat.player.resolve + 1);
    appendLog(combat, `普通攻击造成 ${hit.damage} 点伤害${hit.critical ? "，触发暴击" : ""}。`);
  } else if (action === "defend") {
    combat.player.guarding = true;
    combat.player.resolve = Math.min(6, combat.player.resolve + 2);
    appendLog(combat, "你稳守门户，下一次敌方伤害降低45%。");
  } else if (action === "charge") {
    combat.player.chargeAttack = true;
    combat.player.chargeVulnerable = true;
    combat.player.resolve = Math.min(6, combat.player.resolve + 3);
    appendLog(combat, "你凝聚战意，下一次攻击增强35%，但下一次受伤增加15%。");
  } else if (action === "spell") {
    if (combat.player.resolve < 3) return { ok: false, reason: "战意不足" };
    if (combat.player.spellCooldown > 0) return { ok: false, reason: `术法尚需冷却 ${combat.player.spellCooldown} 回合` };
    combat.player.resolve -= 3;
    const hit = calculatePlayerDamage(combat, 1.65, combat.player.spellIgnore);
    combat.enemy.hp = Math.max(0, combat.enemy.hp - hit.damage);
    combat.player.spellCooldown = 2;
    appendLog(combat, `术法命中，造成 ${hit.damage} 点伤害${hit.critical ? "，触发暴击" : ""}。`);
  } else if (action === "pill") {
    const pillId = String(payload.pillId || "");
    const pill = ITEM_BY_ID[pillId];
    if (!pill?.combatPill) return { ok: false, reason: "此丹不可用于战斗" };
    if (state.run.inventory[pillId] <= 0) return { ok: false, reason: "丹药库存不足" };
    state.run.inventory[pillId] -= 1;
    state.run.stats.pillsConsumed += 1;
    state.permanentStats.pillsConsumed += 1;
    updateTaskProgress(state, "consumePill", 1);
    combat.flags.usedPill = true;
    if (pillId === "pill_edge") combat.player.buffs[pillId] = { name: pill.name, attackMultiplier: 1.25, turns: 3 };
    if (pillId === "pill_blood") {
      const healed = Math.min(combat.player.maxHp - combat.player.hp, Math.max(1, Math.floor(combat.player.maxHp * 0.2)));
      combat.player.hp += healed;
      combat.player.buffs[pillId] = { name: pill.name, attackMultiplier: 1.15, turns: 2 };
      appendLog(combat, `${pill.name}恢复 ${healed} 点生命，药力刷新。`);
    } else appendLog(combat, `${pill.name}生效，药力刷新。`);
  } else if (action === "retreat") {
    const chance = combat.playerTurnNumber <= 2 ? 0.7 : 0.85;
    if (random(combat) < chance) {
      combat.status = "retreated";
      combat.updatedAt = now;
      appendLog(combat, "你寻隙脱身，成功撤退。 ");
      return { ok: true, terminal: true, status: combat.status };
    }
    appendLog(combat, "撤退失败，敌人截住了去路。 ");
  } else return { ok: false, reason: "未知战斗动作" };
  combat.updatedAt = now;
  if (action !== "pill") tickPlayerBuffs(combat);
  if (finishIfEnemyDefeated(combat, now)) return { ok: true, terminal: true, status: combat.status };
  beginEnemyTurn(combat, now);
  return { ok: true, terminal: false, status: combat.status };
}

export function chooseEnemyAction(combat) {
  const enemy = combat.enemy;
  if (enemy.boss && !enemy.enraged && enemy.hp / enemy.maxHp < 0.3) return "enrage";
  if (enemy.type === "demonic") {
    const strong = combat.player.hp / combat.player.maxHp < 0.35 ? 55 : 30;
    return weightedChoice(combat, [{ id: "normal", weight: 60 }, { id: "strong", weight: strong }, { id: "defend", weight: 10 }]);
  }
  if (enemy.type === "guardian") {
    const guardWeight = !enemy.guarding && enemy.consecutiveGuards < 2 ? (enemy.hp / enemy.maxHp < 0.45 ? 60 : 40) : 0;
    return weightedChoice(combat, [{ id: "defend", weight: guardWeight }, { id: "normal", weight: 100 - guardWeight }]);
  }
  if (enemy.type === "beast") {
    if (enemy.charging) return "heavy";
    if ((combat.enemyTurnNumber + 1) % 3 === 0) return "prepare";
    if (combat.player.guarding) return "pierce";
    return weightedChoice(combat, [{ id: "normal", weight: 72 }, { id: "strong", weight: 28 }]);
  }
  return weightedChoice(combat, [{ id: "normal", weight: 65 }, { id: "strong", weight: 25 }, { id: "defend", weight: 10 }]);
}

function enemyDamage(combat, coefficient = 1, pierceGuard = false) {
  let damage = Math.max(1, Math.floor(combat.enemy.attack * coefficient * randomRange(combat, 0.9, 1.1) - combat.player.defense * 0.45));
  if (combat.player.guarding && !pierceGuard) damage = Math.max(1, Math.floor(damage * 0.55));
  if (combat.player.chargeVulnerable) {
    damage = Math.max(1, Math.floor(damage * 1.15));
    combat.player.chargeVulnerable = false;
  }
  combat.player.guarding = false;
  return damage;
}

export function runEnemyTurn(state, now = Date.now()) {
  const combat = state.run.combat;
  if (combat?.status !== "enemyTurn") return { ok: false, reason: "当前不是敌方回合" };
  combat.enemyTurnNumber += 1;
  const action = chooseEnemyAction(combat);
  if (action === "enrage") {
    combat.enemy.enraged = true;
    combat.enemy.attack = Math.max(1, Math.floor(combat.enemy.attack * 1.2));
    combat.enemy.defense = Math.max(0, Math.floor(combat.enemy.defense * 0.85));
    appendLog(combat, `${combat.enemy.name}生命低于三成，首次进入狂暴。`);
  } else if (action === "defend") {
    combat.enemy.guarding = true;
    combat.enemy.consecutiveGuards += 1;
    appendLog(combat, `${combat.enemy.name}转攻为守。`);
  } else if (action === "prepare") {
    combat.enemy.charging = true;
    combat.enemy.consecutiveGuards = 0;
    appendLog(combat, `${combat.enemy.name}压低身形，开始蓄势。`);
  } else {
    combat.enemy.consecutiveGuards = 0;
    if (action === "heavy") combat.enemy.charging = false;
    const coefficients = { normal: 1, strong: 1.35, heavy: 1.65, pierce: 1.05 };
    const damage = enemyDamage(combat, coefficients[action] || 1, action === "pierce");
    combat.player.hp = Math.max(0, combat.player.hp - damage);
    const names = { normal: "攻击", strong: "强攻", heavy: "蓄势重击", pierce: "破防攻击" };
    appendLog(combat, `${combat.enemy.name}施展${names[action] || "攻击"}，造成 ${damage} 点伤害。`);
  }
  combat.updatedAt = now;
  if (combat.player.hp <= 0) {
    combat.status = "defeat";
    appendLog(combat, "你已无力再战。 ");
    return { ok: true, terminal: true, status: combat.status };
  }
  combat.player.spellCooldown = Math.max(0, combat.player.spellCooldown - 1);
  combat.playerTurnNumber += 1;
  combat.status = "playerTurn";
  return { ok: true, terminal: false, status: combat.status };
}

function actualGrantQi(state, amount) {
  const cap = getStageDefinition(state.run.stageIndex).cap;
  const before = clamp(state.run.qi, 0, cap);
  const actual = Math.min(Math.max(0, amount), cap - before);
  state.run.qi = before + actual;
  state.run.totalQi = clamp(state.run.totalQi + actual);
  state.permanentStats.totalQiAllTime = clamp(state.permanentStats.totalQiAllTime + actual);
  if (actual > 0) updateTaskProgress(state, "qiStored", actual, { source: "combat" });
  return actual;
}

function actualLoseQi(state, ratio) {
  const before = clamp(state.run.qi, 0, getStageDefinition(state.run.stageIndex).cap);
  const actual = Math.min(before, before * ratio);
  state.run.qi = before - actual;
  return actual;
}

export function settleCombat(state, now = Date.now()) {
  const combat = state.run.combat;
  if (!TERMINAL_COMBAT_STATES.has(combat?.status) || combat.status === "settling") return { ok: false, reason: "战斗尚未结束" };
  if (combat.resultApplied) return { ok: false, reason: "战斗结果已经结算" };
  const terminalStatus = combat.status;
  const victory = terminalStatus === "victory";
  const defeat = terminalStatus === "defeat";
  combat.status = "settling";
  combat.resultApplied = true;
  combat.updatedAt = now;
  const result = combat.logs.at(-1) || "战斗结束。";
  let qi = 0;
  let loss = 0;
  let weakSeconds = 0;
  if (combat.source === "skirmish") {
    if (victory) {
      qi = actualGrantQi(state, getStageDefinition(state.run.stageIndex).cap * randomRange(combat, 0.02, 0.04));
      state.run.skirmish.cooldownUntil = Math.max(state.run.skirmish.cooldownUntil, now + 90_000);
    } else if (defeat) {
      loss = actualLoseQi(state, 0.03);
      weakSeconds = 30;
    } else loss = actualLoseQi(state, 0.02);
  } else if (victory) {
    qi = actualGrantQi(state, getStageDefinition(state.run.stageIndex).cap * 0.01);
  } else if (defeat) {
    loss = actualLoseQi(state, 0.05);
    weakSeconds = 60;
  } else loss = actualLoseQi(state, 0.02);
  if (weakSeconds) state.run.weakUntil = Math.max(state.run.weakUntil, now + weakSeconds * 1000);
  if (victory) {
    state.permanentStats.combatWins += 1;
    state.permanentStats.combatWinStreak += 1;
    state.permanentStats.bestCombatWinStreak = Math.max(state.permanentStats.bestCombatWinStreak, state.permanentStats.combatWinStreak);
    if (combat.enemy.boss) state.permanentStats.bossWins += 1;
    if (!combat.flags.usedPill) state.permanentStats.noPillWins += 1;
  } else {
    state.permanentStats.combatWinStreak = 0;
    if (defeat) state.permanentStats.combatLosses += 1;
    else state.permanentStats.combatRetreats += 1;
  }
  state.run.stats.combatWins += victory ? 1 : 0;
  state.run.stats.combatLosses += defeat ? 1 : 0;
  state.run.stats.combatRetreats += !victory && !defeat ? 1 : 0;
  return { ok: true, battleId: combat.battleId, source: combat.source, taskId: combat.taskId, taskWindowId: combat.taskWindowId, enemyType: combat.enemy.type, boss: combat.enemy.boss, victory, defeat, retreated: !victory && !defeat, qi, loss, weakSeconds, usedPill: combat.flags.usedPill, result };
}

export function closeSettledCombat(state) {
  if (state.run.combat?.status !== "settling" || !state.run.combat.resultApplied) return false;
  state.run.combat = createCombatState();
  return true;
}

export function cancelCombat(state) {
  state.run.combat = createCombatState();
}

function scheduleTimestamp(now) {
  const span = MAX_SKIRMISH_SECONDS - MIN_SKIRMISH_SECONDS + 1;
  return now + (MIN_SKIRMISH_SECONDS + Math.floor(Math.random() * span)) * 1000;
}

export function scheduleNextSkirmish(state, now = Date.now()) {
  state.run.skirmish.nextAt = scheduleTimestamp(now);
  state.run.skirmish.available = false;
  state.run.skirmish.expiresAt = 0;
  state.run.skirmish.enemyType = "";
  state.run.skirmish.seed = "";
  state.run.skirmish.announcedId = "";
}

export function updateSkirmishAvailability(state, now = Date.now()) {
  const skirmish = state.run.skirmish;
  if (skirmish.available && skirmish.expiresAt <= now) {
    scheduleNextSkirmish(state, now);
    return { expired: true, available: false };
  }
  if (skirmish.available || now < skirmish.nextAt || now < skirmish.cooldownUntil) return { available: skirmish.available };
  const seed = `${state.generation}:${skirmish.nextAt}:${state.run.stageIndex}`;
  const types = ["demonic", "guardian", "beast", "boss"];
  const roll = seededValue(seed, 0);
  skirmish.available = true;
  skirmish.expiresAt = now + SKIRMISH_TTL_MS;
  skirmish.enemyType = types[Math.min(types.length - 1, Math.floor(roll * (roll > 0.92 ? 4 : 3)))];
  skirmish.seed = seed;
  skirmish.announcedId = `${seed}:${skirmish.enemyType}`;
  return { available: true, appeared: true, enemyType: skirmish.enemyType, announcedId: skirmish.announcedId };
}

export function startAvailableSkirmish(state, now = Date.now()) {
  const skirmish = state.run.skirmish;
  if (!skirmish.available || skirmish.expiresAt <= now) {
    if (skirmish.available) scheduleNextSkirmish(state, now);
    return { ok: false, reason: "切磋邀约已经失效" };
  }
  if (now < skirmish.cooldownUntil) return { ok: false, reason: "挑战冷却尚未结束" };
  const snapshot = { enemyType: skirmish.enemyType, seed: skirmish.seed };
  const result = startCombat(state, { source: "skirmish", ...snapshot, strength: 0.9 + getRealmIndex(state.run.stageIndex) * 0.015 }, now);
  if (result.ok) scheduleNextSkirmish(state, now);
  return result;
}

function sanitizeUnit(raw, fallback = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const maxHp = Math.floor(clamp(source.maxHp, 1, 1_000_000));
  return {
    ...fallback,
    name: String(source.name || fallback.name || "").slice(0, 40),
    maxHp,
    hp: Math.floor(clamp(source.hp, 0, maxHp)),
    attack: Math.floor(clamp(source.attack, 1, 1_000_000)),
    defense: Math.floor(clamp(source.defense, 0, 1_000_000))
  };
}

function sanitizeCombatBuffs(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result = {};
  for (const id of ["pill_edge", "pill_blood"]) {
    const buff = raw[id];
    if (!buff || typeof buff !== "object") continue;
    result[id] = {
      name: ITEM_BY_ID[id].name,
      attackMultiplier: id === "pill_edge" ? 1.25 : 1.15,
      turns: Math.floor(clamp(buff.turns, 1, id === "pill_edge" ? 3 : 2))
    };
  }
  return result;
}

export function sanitizeCombatState(raw, now = Date.now()) {
  const fallback = createCombatState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !COMBAT_STATES.has(raw.status) || raw.status === "idle") return fallback;
  if (!raw.battleId || !raw.seed || now - finiteNumber(raw.startedAt) > MAX_BATTLE_AGE_MS) return fallback;
  const enemyType = ENEMY_TYPES.has(raw.enemy?.type) ? raw.enemy.type : null;
  if (!enemyType) return fallback;
  if (raw.status === "settling" && !raw.resultApplied) return fallback;
  const status = raw.status;
  return {
    status, battleId: String(raw.battleId).slice(0, 120), seed: String(raw.seed).slice(0, 120), cursor: Math.floor(clamp(raw.cursor, 0, 1_000_000)),
    source: raw.source === "task" ? "task" : "skirmish", taskId: String(raw.taskId || "").slice(0, 80), taskWindowId: Math.floor(finiteNumber(raw.taskWindowId, -1)),
    startedAt: clamp(raw.startedAt, 0, now), updatedAt: clamp(raw.updatedAt, 0, now), playerTurnNumber: Math.floor(clamp(raw.playerTurnNumber, 1, 100_000)), enemyTurnNumber: Math.floor(clamp(raw.enemyTurnNumber, 0, 100_000)), resultApplied: Boolean(raw.resultApplied),
    player: sanitizeUnit(raw.player, { name: "道友", critChance: clamp(raw.player?.critChance, 0, 0.35), critDamage: clamp(raw.player?.critDamage, 1.5, 2.2), spellIgnore: clamp(raw.player?.spellIgnore, 0.25, 0.43), resolve: Math.floor(clamp(raw.player?.resolve, 0, 6)), maxResolve: 6, spellCooldown: Math.floor(clamp(raw.player?.spellCooldown, 0, 2)), guarding: Boolean(raw.player?.guarding), chargeAttack: Boolean(raw.player?.chargeAttack), chargeVulnerable: Boolean(raw.player?.chargeVulnerable), buffs: sanitizeCombatBuffs(raw.player?.buffs) }),
    enemy: sanitizeUnit(raw.enemy, { type: enemyType, name: ENEMY_TEMPLATES[enemyType].name, guarding: Boolean(raw.enemy?.guarding), consecutiveGuards: Math.floor(clamp(raw.enemy?.consecutiveGuards, 0, 2)), charging: Boolean(raw.enemy?.charging), enraged: Boolean(raw.enemy?.enraged), boss: enemyType === "boss" }),
    flags: { usedPill: Boolean(raw.flags?.usedPill) }, logs: (Array.isArray(raw.logs) ? raw.logs : []).slice(-COMBAT_LOG_LIMIT).map((entry) => String(entry).slice(0, 160))
  };
}

export function sanitizeSkirmishState(raw, now = Date.now()) {
  const fallback = createSkirmishState(now);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const available = Boolean(raw.available) && ENEMY_TYPES.has(raw.enemyType) && finiteNumber(raw.expiresAt) > now;
  return {
    nextAt: clamp(raw.nextAt, 0, now + MAX_SKIRMISH_SECONDS * 2000) || fallback.nextAt,
    available, expiresAt: available ? clamp(raw.expiresAt, now + 1, now + SKIRMISH_TTL_MS) : 0,
    enemyType: available ? raw.enemyType : "", seed: available ? String(raw.seed || "").slice(0, 120) : "",
    announcedId: available ? String(raw.announcedId || "").slice(0, 160) : "", cooldownUntil: clamp(raw.cooldownUntil, 0, now + 7 * 24 * 60 * 60 * 1000)
  };
}
