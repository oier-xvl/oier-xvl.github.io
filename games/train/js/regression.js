import { ENCOUNTER_TTL_MS, ITEM_BY_ID, REALMS, SHOP_CATEGORIES, SKIRMISH_TTL_MS, getStageDefinition } from "./config.js";
import { ACHIEVEMENT_BY_ID, claimAchievement, evaluateAchievements } from "./achievements.js";
import {
  closeSettledCombat, playerAction, runEnemyTurn, sanitizeCombatState, settleCombat, startCombat,
  startAvailableSkirmish, updateSkirmishAvailability
} from "./combat.js";
import { ENCOUNTERS, resolveEncounter, validatePendingEncounter } from "./events.js";
import { advanceTime, attemptBreakthrough, canBreakthrough, getDerivedStats, getItemCost, manualCultivate, performRebirth, purchaseItem } from "./mechanics.js";
import { createDefaultState, grantQi, loseQi, sanitizeState } from "./state.js";
import { applyTaskCombatResult, calculateTaskReward, claimTask, generateTasks, getTaskChallenge, syncTaskWindow, TASK_WINDOW_MS, updateTaskProgress } from "./tasks.js";
function assert(condition, message) { if (!condition) throw new Error(message); }
function assertEqual(actual, expected, message) { assert(actual === expected, `${message}：期望 ${expected}，实际 ${actual}`); }
function assertNear(actual, expected, tolerance, message) { assert(Math.abs(actual - expected) <= tolerance, `${message}：期望约 ${expected}，实际 ${actual}`); }
function cappedState(qi = 95, now = 1_000_000) { const state = createDefaultState(now); state.run.qi = qi; state.run.lifespanRemaining = 10_000; return state; }

const BALANCED_INVESTMENT_PLANS = [
  { arts: [7, 0, 0, 0, 0], arrays: [2, 0, 0, 0] },
  { arts: [7, 2, 0, 0, 0], arrays: [3, 0, 0, 0] },
  { arts: [11, 5, 2, 0, 0], arrays: [5, 1, 0, 0] },
  { arts: [15, 8, 4, 1, 0], arrays: [7, 2, 0, 0] },
  { arts: [19, 11, 7, 3, 0], arrays: [9, 4, 1, 0] },
  { arts: [23, 14, 10, 6, 1], arrays: [11, 6, 2, 0] },
  { arts: [27, 18, 13, 9, 3], arrays: [13, 8, 4, 1] },
  { arts: [31, 22, 16, 12, 6], arrays: [15, 10, 6, 3] },
  { arts: [35, 26, 20, 16, 10], arrays: [17, 12, 8, 5] }
];

function applyInvestmentPlan(state, plan) {
  SHOP_CATEGORIES.arts.items.forEach((item, index) => { state.run.upgrades[item.id] = Math.min(item.maxLevel, plan.arts[index] || 0); });
  SHOP_CATEGORIES.arrays.items.forEach((item, index) => { state.run.upgrades[item.id] = Math.min(item.maxLevel, plan.arrays[index] || 0); });
}

function getPlanStoneCost(realmIndex, plan, now) {
  const state = createDefaultState(now);
  state.run.stageIndex = realmIndex * 4;
  let total = 0;
  for (const categoryId of ["arts", "arrays"]) {
    const levels = plan[categoryId];
    SHOP_CATEGORIES[categoryId].items.forEach((item, itemIndex) => {
      const target = Math.min(item.maxLevel, levels[itemIndex] || 0);
      for (let level = 0; level < target; level += 1) {
        total += getItemCost(state, item).stones;
        state.run.upgrades[item.id] += 1;
      }
    });
  }
  return total;
}

export function analyzeBalanceCurve(now = 1_800_000_000_000) {
  const stages = [];
  for (let realmIndex = 0; realmIndex < REALMS.length; realmIndex += 1) {
    const plan = BALANCED_INVESTMENT_PLANS[realmIndex];
    const state = createDefaultState(now);
    state.run.stageIndex = realmIndex * 4;
    applyInvestmentPlan(state, plan);
    const stats = getDerivedStats(state, now);
    const stoneCost = getPlanStoneCost(realmIndex, plan, now);
    const rewardPerTask = calculateTaskReward(realmIndex, 1.35, 0.5);
    const taskWindows = Math.ceil(stoneCost / Math.max(1, rewardPerTask * 3));
    for (let substage = 0; substage < 4; substage += 1) {
      const stage = getStageDefinition(realmIndex * 4 + substage);
      const fillSeconds = stage.cap / stats.qps;
      stages.push({
        stageIndex: stage.index, name: stage.name, cap: stage.cap, qps: stats.qps,
        fillSeconds, lifespanSeconds: stats.maxLifespan, lifespanRatio: fillSeconds / stats.maxLifespan,
        stoneCost, rewardPerTask, taskWindows
      });
    }
  }
  return stages;
}

export function runBalanceAssertions() {
  const stages = analyzeBalanceCurve();
  assertEqual(stages.length, 36, "平衡模型覆盖全部36阶");
  for (const stage of stages) {
    assert(Number.isFinite(stage.cap) && stage.cap > 0, `${stage.name}灵气上限安全`);
    assert(Number.isFinite(stage.qps) && stage.qps > 0, `${stage.name}均衡投资产出有效`);
    assert(Number.isFinite(stage.fillSeconds) && stage.fillSeconds > 0, `${stage.name}填充时间安全`);
    assert(stage.lifespanRatio <= 0.5, `${stage.name}单阶填充不超过寿元预算一半`);
    assert(stage.taskWindows <= 50, `${stage.name}均衡投资可在50个任务窗口内形成`);
  }
  for (let realmIndex = 0; realmIndex < REALMS.length; realmIndex += 1) {
    const realmStages = stages.filter((stage) => Math.floor(stage.stageIndex / 4) === realmIndex);
    const totalFill = realmStages.reduce((sum, stage) => sum + stage.fillSeconds, 0);
    assert(totalFill <= realmStages[0].lifespanSeconds * 0.75, `${REALMS[realmIndex].name}四阶总填充保留突破与操作余量`);
  }
  return stages;
}

export function runRegressionAssertions() {
  const now = 1_800_000_000_000;
  const roots = createDefaultState(now); roots.run.upgrades.root_mortal = 10; roots.run.upgrades.root_earth = 2; roots.run.upgrades.root_heaven = 1; roots.run.upgrades.root_chaos = 1; const rootStats = getDerivedStats(roots, now); assertNear(rootStats.baseClick, 9, 1e-9, "凡品聚合基础点击"); assertNear(rootStats.rootMultiplier, Math.pow(1 + .32 + .28 + .45, .72), 1e-9, "灵根聚合倍率"); assertEqual(rootStats.clickIntervalMs, 234, "灵根吐纳间隔聚合");
  roots.run.upgrades.root_mortal = 15; roots.run.upgrades.root_earth = 10; assertEqual(getDerivedStats(roots, now).clickIntervalMs, 180, "吐纳间隔下限180ms"); assertEqual(getItemCost(roots, ITEM_BY_ID.root_mortal).qi, Math.floor(30 * Math.pow(1.75, 15) * (1 + .12 * 49)), "灵根软上限价格");
  const array = createDefaultState(now); array.run.upgrades.array_heaven = 10; assertNear(getDerivedStats(array, now).arrayMultiplier, 1 + 3.4 / (1 + 3.4 / 4), 1e-9, "阵法软上限公式"); assert(getDerivedStats(array, now).arrayMultiplier < 5, "阵法倍率低于渐近上限5");
  const realm = createDefaultState(now); realm.run.stageIndex = 5; assertNear(getDerivedStats(realm, now).globalMultiplier, 1.45, 1e-9, "同一大境界倍率只乘一次");
  const bell = createDefaultState(now); bell.run.stageIndex = 4; bell.run.upgrades.treasure_bell = 1; bell.run.lastTreasureClickAt = now - 12_000; const bellStats = getDerivedStats(bell, now); const bellResult = advanceTime(bell, 12, now); assertNear(bellResult.qi, bellStats.autoClickYield, 1e-6, "玄钟仅获得35%普通点击"); assertEqual(bell.run.stats.criticalClicks, 0, "玄钟不产生暴击");
  const dual = createDefaultState(now); dual.spiritStones = 2; dual.run.qi = 39; const beforeStones = dual.spiritStones; const failedDual = purchaseItem(dual, "art_breath", now); assertEqual(failedDual.ok, false, "功法双资源不足拒绝购买"); assertEqual(dual.spiritStones, beforeStones, "双资源购买失败不扣灵石"); assertEqual(dual.run.qi, 39, "双资源购买失败不扣灵气"); dual.run.qi = 40; assertEqual(purchaseItem(dual, "art_breath", now).ok, true, "功法双资源原子购买成功");
  const foundation = createDefaultState(now); foundation.run.stageIndex = 3; foundation.run.qi = getDerivedStats(foundation, now).stage.cap; assertEqual(canBreakthrough(foundation, now).ok, false, "大境界边界检查道基"); attemptBreakthrough(foundation, now, () => 0); assertEqual(foundation.run.stats.breakthroughAttempts, 0, "道基不满足不计突破尝试"); foundation.run.upgrades.art_breath = 3; assertEqual(canBreakthrough(foundation, now).ok, true, "道基满足可跨大境界"); const minor = createDefaultState(now); minor.run.qi = 100; assertEqual(canBreakthrough(minor, now).ok, true, "小阶段突破无道基要求");
  const rebirth = createDefaultState(now); rebirth.spiritStones = 17; performRebirth(rebirth, "测试", now); assertEqual(rebirth.spiritStones, 17, "轮回保留灵石");
  const stable = createDefaultState(now); stable.tasks.profileSeed = "fixed-seed"; const tasksA = generateTasks(stable, getDerivedStats(stable, now), 12345); const tasksB = generateTasks(stable, getDerivedStats(stable, now), 12345); assertEqual(JSON.stringify(tasksA.map(({ completedAt, ...task }) => task)), JSON.stringify(tasksB.map(({ completedAt, ...task }) => task)), "同种子同窗口任务稳定"); assertEqual(new Set(tasksA.map((task) => task.templateId)).size, 3, "同窗口模板不重复"); assert(calculateTaskReward(8, 1.8, 0.5) > calculateTaskReward(0, 1.8, 0.5) * 500, "任务灵石奖励随境界受控成长");
  stable.tasks.active = [{ ...tasksA[0], target: 1, progress: 0, completedAt: 0 }]; updateTaskProgress(stable, stable.tasks.active[0].event, 1); stable.tasks.active[0].completedAt ||= now; const firstClaim = claimTask(stable, stable.tasks.active[0].id, now); const secondClaim = claimTask(stable, stable.tasks.active[0].id, now); assertEqual(firstClaim.ok, true, "任务可领取"); assertEqual(secondClaim.ok, false, "任务领取幂等");
  const rollover = createDefaultState(now); rollover.tasks.profileSeed = "roll"; rollover.tasks.windowId = Math.floor(now / TASK_WINDOW_MS); rollover.tasks.highestWindow = rollover.tasks.windowId; rollover.tasks.lastObservedAt = now; rollover.tasks.active = [{ ...generateTasks(rollover, getDerivedStats(rollover, now), rollover.tasks.windowId)[0], completedAt: now, claimedAt: 0 }]; syncTaskWindow(rollover, getDerivedStats(rollover, now), now + TASK_WINDOW_MS); assertEqual(rollover.tasks.archive.length, 1, "跨窗口已完成未领取进入归档"); const high = rollover.tasks.highestWindow; syncTaskWindow(rollover, getDerivedStats(rollover, now), now - TASK_WINDOW_MS); assertEqual(rollover.tasks.highestWindow, high, "时间回拨不重开旧窗口");
  const achievement = createDefaultState(now); achievement.permanentStats.totalClicks = 100; evaluateAchievements(achievement, now); assertEqual(Boolean(achievement.achievements.entries.click_100.unlockedAt), true, "成就可由可靠统计回溯解锁"); const ac1 = claimAchievement(achievement, "click_100", now), ac2 = claimAchievement(achievement, "click_100", now); assertEqual(ac1.ok, true, "成就可领取"); assertEqual(ac2.ok, false, "成就领取幂等"); achievement.permanentStats.highestStage = 8; evaluateAchievements(achievement, now); claimAchievement(achievement, "reach_core", now); assertNear(achievement.achievements.bonuses.breakthrough, .01, 1e-9, "成就永久突破奖励受控");
  const migrated = sanitizeState({ version: 1, run: { qi: 10, stageIndex: 0 }, permanentStats: {} }, now); assertEqual(migrated.spiritStones, 5, "v1迁移赠送5灵石"); const migratedAgain = sanitizeState(migrated, now); assertEqual(migratedAgain.spiritStones, 5, "v1迁移补偿只发一次");
  const bounded = sanitizeState({ version: 2, talents: { talent_root: 99 }, run: { upgrades: { root_mortal: 999 }, inventory: { pill_gather: 999 } } }, now); assertEqual(bounded.talents.talent_root, 5, "天赋等级按配置上限清洗"); assertEqual(bounded.run.upgrades.root_mortal, 15, "养成等级按配置上限清洗"); assertEqual(bounded.run.inventory.pill_gather, 99, "丹药库存按配置上限清洗");
  const forgedTask = sanitizeState({ version: 2, tasks: { active: [{ id: "1:0", templateId: "manual_click", event: "encounter", target: 1, reward: 20, progress: 1, completedAt: now }] }, run: {} }, now); assertEqual(forgedTask.tasks.active.length, 0, "模板事件不一致的任务被清洗");
  const forgedBonus = sanitizeState({ version: 2, achievements: { bonuses: { clickMultiplier: 1.05, offlineExtraSeconds: 7_200, breakthrough: .01 } }, run: {} }, now); assertEqual(forgedBonus.achievements.bonuses.clickMultiplier, 1, "未领取成就不能注入永久加成");
  const manual = cappedState(99, now); manual.run.lastManualClickAt = 0; const manualResult = manualCultivate(manual, now, () => 1); assertEqual(manualResult.amount, 1, "手动点击只记录实际存入"); assertEqual(manual.run.qi, 100, "手动点击不超上限");
  const qps = cappedState(95, now); qps.run.upgrades.art_breath = 1; const qpsResult = advanceTime(qps, 10, now + 10_000); assertEqual(qpsResult.qi, 5, "QPS只结算实际存入");
  const restored = sanitizeState({ run: { qi: 999, stageIndex: 0 } }, now); assertEqual(restored.run.qi, 100, "存档灵气按上限清洗"); const negative = cappedState(-50, now); loseQi(negative, 10); assertEqual(negative.run.qi, 0, "灵气不低于零"); const breakthrough = cappedState(100, now); const result = attemptBreakthrough(breakthrough, now, () => 0); assertEqual(result.success, true, "小阶段突破成功"); assertEqual(grantQi(breakthrough, 200), 200, "突破后使用新阶段上限");

  const encounter = createDefaultState(now); encounter.run.encounterAvailable = true; encounter.run.activeEncounterId = ENCOUNTERS[0].id; encounter.run.encounterExpiresAt = now + ENCOUNTER_TTL_MS; const encounterFirst = resolveEncounter(encounter, 0, now); const encounterSecond = resolveEncounter(encounter, 0, now); assertEqual(encounterFirst.ok, true, "机缘首次原子消费成功"); assertEqual(encounterSecond.ok, false, "机缘不可双击重复结算"); assertEqual(encounter.permanentStats.encountersResolved, 1, "机缘统计只增加一次"); const expiredEncounter = createDefaultState(now); expiredEncounter.run.encounterAvailable = true; expiredEncounter.run.activeEncounterId = ENCOUNTERS[0].id; expiredEncounter.run.encounterExpiresAt = now - 1; assertEqual(validatePendingEncounter(expiredEncounter, now).cleared, true, "过期机缘立即清理"); assertEqual(expiredEncounter.run.encounterAvailable, false, "过期机缘重新调度");

  const firstBattle = createDefaultState(now); firstBattle.run.lifespanRemaining = 10_000; const secondBattle = createDefaultState(now); secondBattle.run.lifespanRemaining = 10_000; const combatOptions = { source: "skirmish", enemyType: "demonic", seed: "deterministic", strength: 1 }; assertEqual(startCombat(firstBattle, combatOptions, now).ok, true, "战斗可开始"); assertEqual(startCombat(secondBattle, combatOptions, now).ok, true, "同参数战斗可开始"); assertEqual(firstBattle.run.combat.status, "playerTurn", "玩家永远先手"); assertEqual(firstBattle.run.combat.player.resolve, 3, "开战战意为3"); playerAction(firstBattle, "attack", {}, now + 1); playerAction(secondBattle, "attack", {}, now + 1); assertEqual(firstBattle.run.combat.enemy.hp, secondBattle.run.combat.enemy.hp, "同种子玩家伤害确定"); runEnemyTurn(firstBattle, now + 2); runEnemyTurn(secondBattle, now + 2); assertEqual(firstBattle.run.combat.player.hp, secondBattle.run.combat.player.hp, "同种子敌方行动确定"); assertEqual(firstBattle.run.combat.cursor, secondBattle.run.combat.cursor, "确定性随机游标一致");

  const pillBattle = createDefaultState(now); pillBattle.run.stageIndex = 4; pillBattle.run.lifespanRemaining = 10_000; pillBattle.run.inventory.pill_edge = 1; startCombat(pillBattle, { source: "skirmish", enemyType: "demonic", seed: "pill" }, now); playerAction(pillBattle, "pill", { pillId: "pill_edge" }, now + 1); assertEqual(pillBattle.run.combat.player.buffs.pill_edge.turns, 3, "烈锋丹服用回合不提前衰减"); runEnemyTurn(pillBattle, now + 2); assertEqual(pillBattle.run.combat.player.buffs.pill_edge.turns, 3, "敌方回合不消耗玩家回合丹药"); playerAction(pillBattle, "attack", {}, now + 3); assertEqual(pillBattle.run.combat.player.buffs.pill_edge.turns, 2, "玩家后续行动消耗一回合丹药"); assertEqual(pillBattle.permanentStats.pillsConsumed, 1, "战斗丹药计入永久服丹统计");

  const guardBattle = createDefaultState(now); guardBattle.run.lifespanRemaining = 10_000; startCombat(guardBattle, { source: "skirmish", enemyType: "boss", seed: "guard" }, now); guardBattle.run.combat.player.guarding = true; guardBattle.run.combat.enemy.hp = Math.floor(guardBattle.run.combat.enemy.maxHp * 0.2); guardBattle.run.combat.status = "enemyTurn"; runEnemyTurn(guardBattle, now + 1); assertEqual(guardBattle.run.combat.enemy.enraged, true, "首领低生命首次狂暴"); assertEqual(guardBattle.run.combat.player.guarding, true, "敌方非伤害行动保留下一次受伤减免");

  const settlement = createDefaultState(now); settlement.run.lifespanRemaining = 10_000; settlement.tasks.active = [{ id: "qi", windowId: settlement.tasks.windowId, slot: 0, templateId: "gain_qi", name: "纳气", description: "", event: "qiStored", target: 1, difficulty: 1, reward: 1, progress: 0, completedAt: 0, claimedAt: 0, createdAt: now, retryAt: 0, completedBattleId: "" }]; startCombat(settlement, { source: "task", taskId: "x", taskWindowId: settlement.tasks.windowId, enemyType: "demonic", seed: "settle" }, now); settlement.run.combat.enemy.hp = 0; settlement.run.combat.status = "victory"; const settled = settleCombat(settlement, now + 1); assertEqual(settled.ok, true, "终局首次结算成功"); assertEqual(settlement.tasks.active[0].progress, 1, "战斗实际存入灵气推进任务"); assertEqual(settleCombat(settlement, now + 2).ok, false, "同一战斗不可重复结算"); assertEqual(settlement.permanentStats.combatWins, 1, "胜场统计幂等"); assertEqual(closeSettledCombat(settlement), true, "已结算战斗可关闭"); const statusSettlement = createDefaultState(now); statusSettlement.run.lifespanRemaining = 10_000; startCombat(statusSettlement, { source: "skirmish", enemyType: "demonic", seed: "terminal-status" }, now); statusSettlement.run.combat.status = "victory"; statusSettlement.run.combat.enemy.hp = 1; const statusResult = settleCombat(statusSettlement, now + 1); assertEqual(statusResult.victory, true, "结算严格使用终局状态"); assertEqual(statusResult.retreated, false, "胜利状态不因异常生命值误记撤退");

  const skirmish = createDefaultState(now); skirmish.run.lifespanRemaining = 10_000; skirmish.run.skirmish.nextAt = now - 1; const appeared = updateSkirmishAvailability(skirmish, now); assertEqual(appeared.appeared, true, "随机切磋按调度出现"); assertEqual(skirmish.run.skirmish.expiresAt, now + SKIRMISH_TTL_MS, "随机切磋写入过期时间"); skirmish.run.skirmish.expiresAt = now - 1; assertEqual(startAvailableSkirmish(skirmish, now).ok, false, "过期切磋不可开始"); assertEqual(skirmish.run.skirmish.available, false, "过期切磋重新调度"); const blockedSkirmish = createDefaultState(now); blockedSkirmish.run.lifespanRemaining = 0; blockedSkirmish.run.skirmish = { nextAt: now - 1, available: true, expiresAt: now + SKIRMISH_TTL_MS, enemyType: "demonic", seed: "blocked", announcedId: "blocked", cooldownUntil: 0 }; assertEqual(startAvailableSkirmish(blockedSkirmish, now).ok, false, "寿尽时不可开始随机切磋"); assertEqual(blockedSkirmish.run.skirmish.available, true, "启动失败不消费随机切磋邀约"); assertEqual(blockedSkirmish.run.skirmish.seed, "blocked", "启动失败保留切磋确定性种子");

  const taskCombat = createDefaultState(now); taskCombat.run.stageIndex = 4; taskCombat.run.lifespanRemaining = 10_000; taskCombat.tasks.windowId = Math.floor(now / TASK_WINDOW_MS); taskCombat.tasks.highestWindow = taskCombat.tasks.windowId; const combatTask = { id: `${taskCombat.tasks.windowId}:0`, windowId: taskCombat.tasks.windowId, slot: 0, templateId: "combat_demonic", name: "战斗", description: "", event: "combatVictory:demonic", target: 1, difficulty: 1.8, reward: 2, progress: 0, completedAt: 0, claimedAt: 0, createdAt: now, combat: { enemyType: "demonic", strength: 1, seedPart: 7 }, retryAt: 0, completedBattleId: "" }; taskCombat.tasks.active = [combatTask]; const challenge = getTaskChallenge(taskCombat, combatTask.id, now); assertEqual(challenge.ok, true, "当前窗口任务战可挑战"); const failedTaskResult = applyTaskCombatResult(taskCombat, { source: "task", taskId: combatTask.id, taskWindowId: combatTask.windowId, enemyType: "demonic", victory: false }, now); assertEqual(failedTaskResult.ok, true, "任务战失败结果可处理"); assertEqual(getTaskChallenge(taskCombat, combatTask.id, now + 29_999).ok, false, "任务战失败后30秒内不可重试"); assertEqual(getTaskChallenge(taskCombat, combatTask.id, now + 30_000).ok, true, "任务战冷却结束可重试"); assertEqual(applyTaskCombatResult(taskCombat, { source: "task", taskId: combatTask.id, taskWindowId: combatTask.windowId - 1, enemyType: "demonic", victory: true }, now + 30_001).ok, false, "跨窗口结果不可完成任务"); const wonTaskResult = applyTaskCombatResult(taskCombat, { source: "task", taskId: combatTask.id, taskWindowId: combatTask.windowId, enemyType: "demonic", victory: true, battleId: "battle-win" }, now + 30_002); assertEqual(wonTaskResult.completed, true, "当前窗口胜利完成任务"); assertEqual(applyTaskCombatResult(taskCombat, { source: "task", taskId: combatTask.id, taskWindowId: combatTask.windowId, enemyType: "demonic", victory: true, battleId: "battle-repeat" }, now + 30_003).ok, false, "任务战完成结果幂等");

  const maliciousCombat = sanitizeCombatState({ status: "playerTurn", battleId: "bad", seed: "bad", startedAt: now, playerTurnNumber: 1, player: { maxHp: 100, hp: 999, attack: 10, defense: 4, critChance: 99, resolve: 99, buffs: { pill_edge: { turns: 99, attackMultiplier: 99 }, forged: { turns: 99 } } }, enemy: { type: "demonic", maxHp: 100, hp: 100, attack: 10, defense: 4 }, flags: {}, logs: [] }, now); assertEqual(maliciousCombat.player.hp, 100, "战斗生命按上限清洗"); assertEqual(maliciousCombat.player.critChance, 0.35, "战斗暴击率白名单清洗"); assertEqual(maliciousCombat.player.resolve, 6, "战意按上限清洗"); assertEqual(maliciousCombat.player.buffs.pill_edge.turns, 3, "战斗丹药回合按配置清洗"); assertEqual(Boolean(maliciousCombat.player.buffs.forged), false, "伪造战斗Buff被移除"); assertEqual(sanitizeCombatState({ ...maliciousCombat, status: "settling", resultApplied: false }, now).status, "idle", "未应用结果的损坏结算态被丢弃");

  const rebirthCombat = createDefaultState(now); rebirthCombat.run.lifespanRemaining = 10_000; startCombat(rebirthCombat, { source: "skirmish", enemyType: "beast", seed: "rebirth" }, now); performRebirth(rebirthCombat, "测试轮回", now + 1); assertEqual(rebirthCombat.run.combat.status, "idle", "轮回取消未结束战斗"); assertEqual(rebirthCombat.permanentStats.combatLosses, 0, "轮回取消不计战斗失败");
  runBalanceAssertions();
}
