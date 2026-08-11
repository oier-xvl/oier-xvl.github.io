export const SAVE_KEY = "wendao-changsheng-save-v1";
export const SAVE_VERSION = 3;
export const AUTOSAVE_MS = 10_000;
export const MAX_OFFLINE_SECONDS = 24 * 60 * 60;
export const LOG_LIMIT = 40;
export const MAX_SAFE_VALUE = 1e300;
export const MIN_ENCOUNTER_SECONDS = 180;
export const MAX_ENCOUNTER_SECONDS = 600;
export const ENCOUNTER_TTL_MS = 10 * 60 * 1000;
export const MIN_SKIRMISH_SECONDS = 6 * 60;
export const MAX_SKIRMISH_SECONDS = 12 * 60;
export const SKIRMISH_TTL_MS = 5 * 60 * 1000;

export const REALMS = [
  { name: "练气", baseCap: 100, lifespan: 900, multiplier: 1, success: 1 },
  { name: "筑基", baseCap: 1_400, lifespan: 1_800, multiplier: 1.45, success: 1 },
  { name: "金丹", baseCap: 28_000, lifespan: 3_600, multiplier: 1.7, success: 0.86 },
  { name: "元婴", baseCap: 760_000, lifespan: 7_200, multiplier: 2, success: 0.78 },
  { name: "化神", baseCap: 28_000_000, lifespan: 14_400, multiplier: 2.35, success: 0.7 },
  { name: "炼虚", baseCap: 1.4e9, lifespan: 28_800, multiplier: 2.75, success: 0.62 },
  { name: "合体", baseCap: 9.5e10, lifespan: 57_600, multiplier: 3.2, success: 0.55 },
  { name: "大乘", baseCap: 8.5e12, lifespan: 115_200, multiplier: 3.7, success: 0.48 },
  { name: "渡劫", baseCap: 1.05e15, lifespan: 230_400, multiplier: 4.3, success: 0.4 }
];
export const STAGES = ["前期", "中期", "后期", "大圆满"];
export const FINAL_STAGE_INDEX = REALMS.length * STAGES.length - 1;

export function getRealmIndex(stageIndex) {
  return Math.min(REALMS.length - 1, Math.max(0, Math.floor(stageIndex / STAGES.length)));
}
export function getStageInRealm(stageIndex) {
  return Math.min(STAGES.length - 1, Math.max(0, stageIndex % STAGES.length));
}
export function getStageDefinition(stageIndex) {
  const safeStage = Math.min(FINAL_STAGE_INDEX, Math.max(0, Math.floor(stageIndex)));
  const realmIndex = getRealmIndex(safeStage);
  const substage = getStageInRealm(safeStage);
  const realm = REALMS[realmIndex];
  return {
    index: safeStage, realmIndex, substage, realm,
    name: `${realm.name} · ${STAGES[substage]}`,
    cap: realm.baseCap * Math.pow(3.2, substage),
    success: Math.max(0.25, realm.success - (realmIndex >= 2 ? substage * 0.035 : 0)),
    isFinal: safeStage === FINAL_STAGE_INDEX
  };
}

export const SHOP_CATEGORIES = {
  roots: { label: "灵根", items: [
    { id: "root_mortal", category: "roots", currency: "qi", glyph: "根", name: "凡品灵根", description: "基础点击每级 +0.8，吐纳间隔每级 -6ms", baseCost: 30, growth: 1.75, maxLevel: 15, softCap: 8, unlockRealm: 0 },
    { id: "root_earth", category: "roots", currency: "qi", glyph: "地", name: "地脉灵根", description: "灵根原值每级 +0.16，吐纳间隔每级 -3ms", baseCost: 1_800, growth: 2.1, maxLevel: 10, softCap: 5, unlockRealm: 1 },
    { id: "root_heaven", category: "roots", currency: "qi", glyph: "天", name: "天一灵根", description: "灵根原值每级 +0.28，暴击率每级 +0.6%", baseCost: 120_000, growth: 2.35, maxLevel: 8, softCap: 4, unlockRealm: 2 },
    { id: "root_chaos", category: "roots", currency: "qi", glyph: "混", name: "混沌道根", description: "灵根原值每级 +0.45，暴击伤害每级 +0.25", baseCost: 18_000_000, growth: 2.65, maxLevel: 6, softCap: 3, unlockRealm: 4 }
  ]},
  arts: { label: "功法", items: [
    { id: "art_breath", category: "arts", currency: "dual", glyph: "息", name: "引气诀", description: "功法主产出，每级基础每息 1", qps: 1, stoneCost: 2, stoneGrowth: 1.28, qiCost: 40, qiGrowth: 1.42, maxLevel: 40, unlockRealm: 0 },
    { id: "art_cloud", category: "arts", currency: "dual", glyph: "云", name: "流云经", description: "功法主产出，每级基础每息 16", qps: 16, stoneCost: 8, stoneGrowth: 1.32, qiCost: 2_500, qiGrowth: 1.46, maxLevel: 32, unlockRealm: 1 },
    { id: "art_sun", category: "arts", currency: "dual", glyph: "阳", name: "大日真经", description: "功法主产出，每级基础每息 300", qps: 300, stoneCost: 30, stoneGrowth: 1.36, qiCost: 90_000, qiGrowth: 1.5, maxLevel: 26, unlockRealm: 2 },
    { id: "art_void", category: "arts", currency: "dual", glyph: "虚", name: "太虚玄典", description: "功法主产出，每级基础每息 8k", qps: 8_000, stoneCost: 100, stoneGrowth: 1.4, qiCost: 3_000_000, qiGrowth: 1.54, maxLevel: 20, unlockRealm: 3 },
    { id: "art_star", category: "arts", currency: "dual", glyph: "星", name: "周天星衍录", description: "功法主产出，每级基础每息 320k", qps: 320_000, stoneCost: 360, stoneGrowth: 1.44, qiCost: 180_000_000, qiGrowth: 1.58, maxLevel: 16, unlockRealm: 5 }
  ]},
  arrays: { label: "阵法", items: [
    { id: "array_spirit", category: "arrays", currency: "stones", glyph: "聚", name: "聚灵阵", description: "阵法强度每级 +0.08", arrayPower: 0.08, baseCost: 5, growth: 1.42, maxLevel: 20, unlockRealm: 0 },
    { id: "array_stars", category: "arrays", currency: "stones", glyph: "斗", name: "七星阵", description: "阵法强度每级 +0.14", arrayPower: 0.14, baseCost: 25, growth: 1.48, maxLevel: 15, unlockRealm: 2 },
    { id: "array_time", category: "arrays", currency: "stones", glyph: "宙", name: "岁时阵", description: "阵法强度每级 +0.22，寿元上限每级 +1.5%", arrayPower: 0.22, lifespanPerLevel: 0.015, baseCost: 100, growth: 1.54, maxLevel: 12, unlockRealm: 4 },
    { id: "array_heaven", category: "arrays", currency: "stones", glyph: "天", name: "小周天大阵", description: "阵法强度每级 +0.34", arrayPower: 0.34, baseCost: 420, growth: 1.6, maxLevel: 10, unlockRealm: 6 }
  ]},
  treasures: { label: "法宝", items: [
    { id: "treasure_bell", category: "treasures", currency: "stones", glyph: "钟", name: "太清玄钟", description: "每 12 秒触发一次35%普通点击，升级最低缩至6秒", baseCost: 18, growth: 2, maxLevel: 8, unlockRealm: 1, mechanism: "autoClick" },
    { id: "treasure_sword", category: "treasures", currency: "stones", glyph: "剑", name: "青锋剑", description: "战斗法器：1-4级每级攻击+2，5-8级每级攻击+1", baseCost: 28, growth: 1.85, maxLevel: 8, unlockRealm: 1, mechanism: "combatWeapon" },
    { id: "treasure_mirror", category: "treasures", currency: "stones", glyph: "镜", name: "照劫宝镜", description: "破境成功率每级 +3%", baseCost: 85, growth: 2.2, maxLevel: 6, unlockRealm: 2, mechanism: "breakthrough" },
    { id: "treasure_seal", category: "treasures", currency: "stones", glyph: "印", name: "镇岳印", description: "战斗法器：每级攻击+1、防御+2、术法额外忽略防御3%", baseCost: 110, growth: 2.1, maxLevel: 6, unlockRealm: 2, mechanism: "combatWeapon" },
    { id: "treasure_cauldron", category: "treasures", currency: "stones", glyph: "鼎", name: "万化丹鼎", description: "丹药持续每级 +15%，服丹恢复每级20秒寿元", baseCost: 320, growth: 2.5, maxLevel: 5, unlockRealm: 3, mechanism: "pillMastery" }
  ]},
  pills: { label: "丹药", items: [
    { id: "pill_gather", category: "pills", currency: "stones", glyph: "灵", name: "聚灵丹", description: "5 分钟全部灵气收益 ×1.6", baseCost: 4, growth: 1.18, maxStock: 99, unlockRealm: 0, duration: 300, multiplier: 1.6, buffId: "gather" },
    { id: "pill_edge", category: "pills", currency: "stones", glyph: "锋", name: "烈锋丹", description: "仅战斗：攻击+25%，持续3个玩家回合", baseCost: 7, growth: 1.2, maxStock: 30, unlockRealm: 1, combatPill: true, buffId: "combat_edge" },
    { id: "pill_break", category: "pills", currency: "stones", glyph: "破", name: "破境丹", description: "3 分钟破境成功率 +12%", baseCost: 12, growth: 1.22, maxStock: 30, unlockRealm: 2, duration: 180, breakthrough: 0.12, buffId: "break" },
    { id: "pill_blood", category: "pills", currency: "stones", glyph: "血", name: "战血丹", description: "仅战斗：恢复20%生命，攻击+15%持续2回合", baseCost: 16, growth: 1.24, maxStock: 20, unlockRealm: 2, combatPill: true, buffId: "combat_blood" },
    { id: "pill_heaven", category: "pills", currency: "stones", glyph: "元", name: "混元丹", description: "2 分钟全部灵气收益 ×2.5，暴击率 +8%", baseCost: 35, growth: 1.28, maxStock: 20, unlockRealm: 4, duration: 120, multiplier: 2.5, critChance: 0.08, buffId: "heaven" }
  ]}
};
export const ALL_SHOP_ITEMS = Object.values(SHOP_CATEGORIES).flatMap((category) => category.items);
export const ITEM_BY_ID = Object.fromEntries(ALL_SHOP_ITEMS.map((item) => [item.id, item]));

export const FOUNDATION_REQUIREMENTS = {
  1: [{ type: "upgrade", id: "art_breath", amount: 3, label: "引气诀 3级" }],
  2: [{ type: "upgrade", id: "art_cloud", amount: 1, label: "流云经 1级" }, { type: "upgrade", id: "array_spirit", amount: 2, label: "聚灵阵 2级" }],
  3: [{ type: "upgrade", id: "art_sun", amount: 1, label: "大日真经 1级" }, { type: "upgrade", id: "array_stars", amount: 1, label: "七星阵 1级" }, { type: "upgrade", id: "treasure_mirror", amount: 1, label: "照劫宝镜 1级" }],
  4: [{ type: "upgrade", id: "art_void", amount: 1, label: "太虚玄典 1级" }, { type: "upgrade", id: "treasure_cauldron", amount: 1, label: "万化丹鼎 1级" }, { type: "runStat", id: "pillsConsumed", amount: 1, label: "本世服丹 1次" }],
  5: [{ type: "categoryTotal", id: "arts", amount: 20, label: "功法总级 20" }, { type: "categoryTotal", id: "arrays", amount: 8, label: "阵法总级 8" }, { type: "categoryTotal", id: "treasures", amount: 4, label: "法宝总级 4" }],
  6: [{ type: "upgrade", id: "art_star", amount: 1, label: "周天星衍录 1级" }, { type: "categoryTotal", id: "arrays", amount: 12, label: "阵法总级 12" }, { type: "permanentStat", id: "tasksCompleted", amount: 10, label: "累计完成任务 10" }],
  7: [{ type: "categoryTotal", id: "arts", amount: 32, label: "功法总级 32" }, { type: "categoryTotal", id: "treasures", amount: 8, label: "法宝总级 8" }, { type: "runStat", id: "encounters", amount: 5, label: "本世奇遇 5次" }],
  8: [{ type: "categoryTotal", id: "arts", amount: 45, label: "功法总级 45" }, { type: "categoryTotal", id: "arrays", amount: 20, label: "阵法总级 20" }, { type: "inventory", id: "pill_break", amount: 1, label: "持有破境丹 1枚" }]
};

export const TALENTS = [
  { id: "talent_root", glyph: "根", name: "先天道体", description: "每级使点击收益 ×1.6，并令今世自带凡品灵根", baseCost: 2, growth: 3, maxLevel: 5, clickMultiplier: 1.6, startingRoot: 1 },
  { id: "talent_flow", glyph: "泉", name: "灵泉伴生", description: "每级使自动产出 ×1.5", baseCost: 2, growth: 3, maxLevel: 6, qpsMultiplier: 1.5 },
  { id: "talent_fate", glyph: "命", name: "逆天改命", description: "每级使破境成功率永久 +4%", baseCost: 3, growth: 3.5, maxLevel: 5, breakthrough: 0.04 },
  { id: "talent_thunder", glyph: "雷", name: "雷劫淬心", description: "每级使暴击伤害 +100%", baseCost: 3, growth: 3.2, maxLevel: 5, critDamage: 1 },
  { id: "talent_longevity", glyph: "寿", name: "长生种", description: "每级使寿元上限 +20%", baseCost: 4, growth: 3.4, maxLevel: 5, lifespanMultiplier: 1.2 },
  { id: "talent_fortune", glyph: "缘", name: "福缘深厚", description: "每级强化奇遇并缩短间隔，奇遇本世增益受上限约束", baseCost: 5, growth: 3.6, maxLevel: 5, encounterMultiplier: 1.3, encounterSpeed: 0.08 },
  { id: "talent_rebirth", glyph: "轮", name: "轮回真意", description: "每级使转生结晶收益 +25%", baseCost: 8, growth: 4, maxLevel: 4, rebirthMultiplier: 1.25 }
];
export const TALENT_BY_ID = Object.fromEntries(TALENTS.map((talent) => [talent.id, talent]));
export const DEFAULT_LOGS = [{ title: "初入仙途", text: "你于无名山中开辟洞府，吐纳天地灵机。", time: Date.now() }];
