import { getRealmIndex, ITEM_BY_ID, SHOP_CATEGORIES, TALENTS } from "./config.js";
import { clamp, finiteNumber } from "./numbers.js";

export const ACHIEVEMENTS = [
  { id: "click_100", category: "修炼", name: "百次吐纳", guide: "手动吐纳100次。", metric: "totalClicks", target: 100, reward: { stones: 2 } },
  { id: "click_1000", category: "修炼", name: "千息归一", guide: "手动吐纳1000次。", metric: "totalClicks", target: 1_000, reward: { stones: 5 } },
  { id: "crit_100", category: "修炼", name: "灵光百现", guide: "累计暴击100次。", metric: "criticalClicks", target: 100, reward: { stones: 4 } },
  { id: "qi_1k", category: "积累", name: "灵气初聚", guide: "累计实际存入1千灵气。", metric: "totalQiAllTime", target: 1_000, reward: { stones: 2 } },
  { id: "qi_1m", category: "积累", name: "灵海成潮", guide: "累计实际存入1百万灵气。", metric: "totalQiAllTime", target: 1e6, reward: { stones: 5 } },
  { id: "qi_1t", category: "积累", name: "周天浩瀚", guide: "累计实际存入1万亿灵气。", metric: "totalQiAllTime", target: 1e12, reward: { crystals: 2 } },
  { id: "first_root", category: "养成", name: "灵根初成", guide: "首次购买灵根。", metric: "purchasesRoots", target: 1, reward: { stones: 2 } },
  { id: "first_art", category: "养成", name: "法门入心", guide: "首次学习功法。", metric: "purchasesArts", target: 1, reward: { stones: 2 } },
  { id: "first_array", category: "养成", name: "布阵聚灵", guide: "首次购买阵法。", metric: "purchasesArrays", target: 1, reward: { stones: 2 } },
  { id: "first_treasure", category: "养成", name: "法宝认主", guide: "首次购买法宝。", metric: "purchasesTreasures", target: 1, reward: { stones: 3 } },
  { id: "purchase_50", category: "养成", name: "洞府丰足", guide: "累计购买50件商品。", metric: "totalPurchases", target: 50, reward: { stones: 6 } },
  { id: "first_break", category: "境界", name: "初破关隘", guide: "首次成功突破。", metric: "totalBreakthroughs", target: 1, reward: { stones: 3 } },
  { id: "reach_core", category: "境界", name: "金丹大道", guide: "抵达金丹境。", metric: "highestRealm", target: 2, reward: { stones: 6, bonus: "breakthrough" } },
  { id: "reach_nascent", category: "境界", name: "元婴初生", guide: "抵达元婴境。", metric: "highestRealm", target: 3, reward: { crystals: 1 } },
  { id: "break_25", category: "境界", name: "百炼道心", guide: "累计成功突破25次。", metric: "totalBreakthroughs", target: 25, reward: { crystals: 2 } },
  { id: "task_1", category: "事务", name: "初领差事", guide: "完成并领取1项任务。", metric: "tasksCompleted", target: 1, reward: { stones: 2 } },
  { id: "task_20", category: "事务", name: "执事熟手", guide: "完成并领取20项任务。", metric: "tasksCompleted", target: 20, reward: { stones: 6 } },
  { id: "task_100", category: "事务", name: "功德满堂", guide: "完成并领取100项任务。", metric: "tasksCompleted", target: 100, reward: { crystals: 3 } },
  { id: "encounter_1", category: "奇遇", name: "一线机缘", guide: "解决1次奇遇。", metric: "encountersResolved", target: 1, reward: { stones: 2 } },
  { id: "encounter_20", category: "奇遇", name: "缘法相随", guide: "解决20次奇遇。", metric: "encountersResolved", target: 20, reward: { stones: 6 } },
  { id: "pill_1", category: "丹道", name: "丹香初闻", guide: "服用1枚丹药。", metric: "pillsConsumed", target: 1, reward: { stones: 2 } },
  { id: "pill_20", category: "丹道", name: "药理通明", guide: "服用20枚丹药。", metric: "pillsConsumed", target: 20, reward: { stones: 6 } },
  { id: "combat_1", category: "斗法", name: "初战告捷", guide: "赢得1场战斗。", metric: "combatWins", target: 1, reward: { stones: 2 } },
  { id: "combat_10", category: "斗法", name: "十战砺锋", guide: "累计赢得10场战斗。", metric: "combatWins", target: 10, reward: { stones: 4 } },
  { id: "combat_50", category: "斗法", name: "百炼之途", guide: "累计赢得50场战斗。", metric: "combatWins", target: 50, reward: { crystals: 1 } },
  { id: "boss_1", category: "斗法", name: "斩将破阵", guide: "首次击败首领。", metric: "bossWins", target: 1, reward: { stones: 3 } },
  { id: "no_pill_win", category: "斗法", name: "清心制胜", guide: "不使用战斗丹药赢得1场战斗。", metric: "noPillWins", target: 1, reward: { stones: 2 } },
  { id: "rebirth_1", category: "轮回", name: "再世为人", guide: "完成1次轮回。", metric: "totalRebirths", target: 1, reward: { stones: 4, bonus: "offline" } },
  { id: "rebirth_10", category: "轮回", name: "十世问道", guide: "完成10次轮回。", metric: "totalRebirths", target: 10, reward: { crystals: 3 } },
  { id: "talent_1", category: "天道", name: "天赋初醒", guide: "首次购买天赋。", metric: "talentsPurchased", target: 1, reward: { stones: 3 } },
  { id: "talent_max", category: "天道", name: "一道圆满", guide: "将任一天赋提升至满级。", metric: "maxedTalents", target: 1, reward: { crystals: 2, bonus: "click" } }
];
export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((entry) => [entry.id, entry]));

export function createAchievementState() {
  return { entries: {}, bonuses: { clickMultiplier: 1, offlineExtraSeconds: 0, breakthrough: 0 } };
}
function totalLevels(state, category) {
  return SHOP_CATEGORIES[category].items.reduce((sum, item) => sum + Math.max(0, Math.floor(finiteNumber(state.run.upgrades[item.id]))), 0);
}
export function getAchievementMetric(state, metric) {
  if (metric === "highestRealm") return getRealmIndex(state.permanentStats.highestStage);
  if (metric === "maxedTalents") return TALENTS.some((talent) => finiteNumber(state.talents[talent.id]) >= talent.maxLevel) ? 1 : 0;
  if (metric === "purchasesRoots" && !finiteNumber(state.permanentStats.purchasesRoots)) return totalLevels(state, "roots") > 0 ? 1 : 0;
  if (metric === "purchasesArts" && !finiteNumber(state.permanentStats.purchasesArts)) return totalLevels(state, "arts") > 0 ? 1 : 0;
  if (metric === "purchasesArrays" && !finiteNumber(state.permanentStats.purchasesArrays)) return totalLevels(state, "arrays") > 0 ? 1 : 0;
  if (metric === "purchasesTreasures" && !finiteNumber(state.permanentStats.purchasesTreasures)) return totalLevels(state, "treasures") > 0 ? 1 : 0;
  return clamp(state.permanentStats[metric]);
}
export function evaluateAchievements(state, now = Date.now()) {
  let changed = false;
  for (const achievement of ACHIEVEMENTS) {
    const entry = state.achievements.entries[achievement.id] || { unlockedAt: 0, claimedAt: 0 };
    if (!entry.unlockedAt && getAchievementMetric(state, achievement.metric) >= achievement.target) {
      entry.unlockedAt = now;
      changed = true;
    }
    state.achievements.entries[achievement.id] = entry;
  }
  return changed;
}
function applyBonus(state, bonus) {
  if (bonus === "click") state.achievements.bonuses.clickMultiplier = Math.max(state.achievements.bonuses.clickMultiplier, 1.05);
  if (bonus === "offline") state.achievements.bonuses.offlineExtraSeconds = Math.max(state.achievements.bonuses.offlineExtraSeconds, 7_200);
  if (bonus === "breakthrough") state.achievements.bonuses.breakthrough = Math.max(state.achievements.bonuses.breakthrough, 0.01);
}
export function claimAchievement(state, id, now = Date.now()) {
  const achievement = ACHIEVEMENT_BY_ID[id];
  const entry = state.achievements.entries[id];
  if (!achievement || !entry?.unlockedAt) return { ok: false, reason: "成就尚未解锁" };
  if (entry.claimedAt) return { ok: false, reason: "成就奖励已领取" };
  entry.claimedAt = now;
  const stones = Math.floor(clamp(achievement.reward.stones, 0, 20));
  const crystals = Math.floor(clamp(achievement.reward.crystals, 0, 10));
  state.spiritStones += stones;
  state.crystals += crystals;
  state.permanentStats.spiritStonesEarned += stones;
  if (achievement.reward.bonus) applyBonus(state, achievement.reward.bonus);
  return { ok: true, achievement, stones, crystals, bonus: achievement.reward.bonus || "" };
}
export function getAchievementProgress(state, achievement) {
  return Math.min(achievement.target, getAchievementMetric(state, achievement.metric));
}
export function sanitizeAchievements(raw, now = Date.now()) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const entries = {};
  const bonuses = createAchievementState().bonuses;
  const rawEntries = source.entries && typeof source.entries === "object" && !Array.isArray(source.entries) ? source.entries : {};
  for (const achievement of ACHIEVEMENTS) {
    const entry = rawEntries[achievement.id];
    const unlockedAt = clamp(entry?.unlockedAt, 0, now);
    const rawClaimedAt = unlockedAt ? clamp(entry?.claimedAt, 0, now) : 0;
    const claimedAt = rawClaimedAt >= unlockedAt ? rawClaimedAt : 0;
    entries[achievement.id] = { unlockedAt, claimedAt };
    if (claimedAt && achievement.reward.bonus) {
      if (achievement.reward.bonus === "click") bonuses.clickMultiplier = 1.05;
      if (achievement.reward.bonus === "offline") bonuses.offlineExtraSeconds = 7_200;
      if (achievement.reward.bonus === "breakthrough") bonuses.breakthrough = 0.01;
    }
  }
  return { entries, bonuses };
}
