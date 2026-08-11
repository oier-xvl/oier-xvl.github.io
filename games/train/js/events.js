import { ENCOUNTER_TTL_MS, getStageDefinition } from "./config.js";
import { clamp, integerBetween, randomBetween, safeMultiply } from "./numbers.js";
import { getDerivedStats } from "./mechanics.js";
import { addLog, grantQi as grantCurrentQi, loseQi, scheduleNextEncounter } from "./state.js";
import { updateTaskProgress } from "./tasks.js";

function fortuneMultiplier(state) {
  const level = Math.max(0, Math.floor(state.talents.talent_fortune || 0));
  return Math.pow(1.3, level);
}

function encounterSpeed(state) {
  const level = Math.max(0, Math.floor(state.talents.talent_fortune || 0));
  return Math.min(0.6, level * 0.08);
}

function qiScale(state, factor = 1) {
  const stats = getDerivedStats(state);
  const capPart = stats.stage.cap * factor;
  const productionPart = stats.qps * 90 * factor;
  return Math.max(25, capPart, productionPart);
}

function grantQi(state, amount) {
  return grantCurrentQi(state, clamp(amount * fortuneMultiplier(state)), "other");
}

function multiplyBonus(state, key, multiplier) {
  const limits = { globalMultiplier: 1.6, clickMultiplier: 1.6, qpsMultiplier: 1.75, lifespanMultiplier: 1.5 };
  state.run.eventBonuses[key] = Math.min(limits[key] || 2, safeMultiply(state.run.eventBonuses[key], multiplier));
}

export const ENCOUNTERS = [
  {
    id: "ancient_cave",
    title: "前辈洞府",
    description: "山壁因雷雨崩裂，露出一座尘封洞府。石门内灵光隐现，也有禁制低鸣。",
    choices: [
      {
        label: "破禁而入",
        resolve(state) {
          if (Math.random() < 0.64) {
            const amount = grantQi(state, qiScale(state, randomBetween(0.42, 0.8)));
            return { positive: true, text: `你寻得前辈遗藏，收获 ${Math.floor(amount)} 灵气。` };
          }
          const loss = loseQi(state, qiScale(state, 0.18));
          state.run.weakUntil = Math.max(state.run.weakUntil, Date.now() + 50_000);
          return { positive: false, text: `禁制反噬，损失 ${Math.floor(loss)} 灵气，并陷入短暂虚弱。` };
        }
      },
      {
        label: "静坐参悟门上道纹",
        resolve(state) {
          multiplyBonus(state, "qpsMultiplier", 1.08);
          return { positive: true, text: "你未取一物，却从道纹中悟得吐纳真意，本世自动产出永久 +8%。" };
        }
      }
    ]
  },
  {
    id: "demonic_robber",
    title: "魔修劫道",
    description: "血雾横在山道，一名负伤魔修索要灵石买路。他气息不稳，却杀意凛然。",
    choices: [
      {
        label: "正面斗法",
        resolve(state) {
          const realm = getStageDefinition(state.run.stageIndex).realmIndex;
          const chance = Math.min(0.82, 0.48 + realm * 0.04);
          if (Math.random() < chance) {
            const amount = grantQi(state, qiScale(state, randomBetween(0.55, 0.95)));
            return { positive: true, text: `你斩退魔修，炼化其残余修为，获得 ${Math.floor(amount)} 灵气。` };
          }
          const loss = loseQi(state, state.run.qi * 0.22);
          return { positive: false, text: `你负伤退走，被夺去 ${Math.floor(loss)} 灵气。` };
        }
      },
      {
        label: "舍财避祸",
        resolve(state) {
          const loss = loseQi(state, state.run.qi * 0.1);
          state.run.eventBonuses.breakthrough = clamp(state.run.eventBonuses.breakthrough + 0.01, -0.5, 0.5);
          return { positive: true, text: `你舍去 ${Math.floor(loss)} 灵气，却由进退之道悟得一线天机，本世破境率 +1%。` };
        }
      }
    ]
  },
  {
    id: "broken_ring",
    title: "残破古戒",
    description: "溪边泥沙中躺着一枚无主古戒。戒面裂痕遍布，内里却传来若有若无的神念。",
    choices: [
      {
        label: "以神识温养",
        resolve(state) {
          const cost = loseQi(state, qiScale(state, 0.12));
          multiplyBonus(state, "clickMultiplier", 1.12);
          return { positive: true, text: `你耗费 ${Math.floor(cost)} 灵气唤醒残灵，本世点击收益永久 +12%。` };
        }
      },
      {
        label: "直接炼化",
        resolve(state) {
          if (Math.random() < 0.5) {
            state.run.eventBonuses.critChance = clamp(state.run.eventBonuses.critChance + 0.04, -0.5, 0.8);
            return { positive: true, text: "古戒化作一道锋芒，本世暴击率永久 +4%。" };
          }
          state.run.eventBonuses.critDamage = clamp(state.run.eventBonuses.critDamage + 1, 0, 100);
          return { positive: true, text: "残灵虽散，其战意融入识海，本世暴击伤害永久 +100%。" };
        }
      }
    ]
  },
  {
    id: "spirit_spring",
    title: "地脉灵泉",
    description: "林中白鹿引你来到一眼新生灵泉。泉水可洗炼经脉，也可封入丹囊慢慢炼化。",
    choices: [
      {
        label: "入泉洗髓",
        resolve(state) {
          const stats = getDerivedStats(state);
          const restore = Math.min(stats.maxLifespan * 0.18 * fortuneMultiplier(state), stats.maxLifespan * 0.4);
          state.run.lifespanRemaining = clamp(state.run.lifespanRemaining + restore, 0, stats.maxLifespan * 1.5);
          return { positive: true, text: `灵泉洗去暗伤，你恢复了 ${Math.floor(restore)} 秒寿元。` };
        }
      },
      {
        label: "引泉入阵",
        resolve(state) {
          multiplyBonus(state, "globalMultiplier", 1.1);
          return { positive: true, text: "灵泉汇入洞府地脉，本世全部灵气收益永久 +10%。" };
        }
      }
    ]
  },
  {
    id: "heavenly_stela",
    title: "无字天碑",
    description: "夜半星落，荒野立起一方无字石碑。凝视越久，识海中的轰鸣便越响。",
    choices: [
      {
        label: "观碑一夜",
        resolve(state) {
          if (Math.random() < 0.72) {
            state.run.eventBonuses.breakthrough = clamp(state.run.eventBonuses.breakthrough + 0.025, -0.5, 0.5);
            return { positive: true, text: "晨光初现时，你窥见境界之间的缝隙，本世破境率 +2.5%。" };
          }
          state.run.weakUntil = Math.max(state.run.weakUntil, Date.now() + 75_000);
          return { positive: false, text: "天碑道意过于浩瀚，你神识受创，陷入虚弱。" };
        }
      },
      {
        label: "拓下碑形后离去",
        resolve(state) {
          const amount = grantQi(state, qiScale(state, 0.32));
          return { positive: true, text: `拓印在洞府中自然聚灵，为你带来 ${Math.floor(amount)} 灵气。` };
        }
      }
    ]
  },
  {
    id: "mortal_village",
    title: "山下疫村",
    description: "山下凡人村落疫气弥漫。村民向你叩首求药，而你丹囊中的灵气也并不充裕。",
    choices: [
      {
        label: "耗费修为救治",
        resolve(state) {
          const loss = loseQi(state, qiScale(state, 0.16));
          multiplyBonus(state, "globalMultiplier", 1.06);
          return { positive: true, text: `你耗去 ${Math.floor(loss)} 灵气平息疫病，冥冥功德令本世收益永久 +6%。` };
        }
      },
      {
        label: "传下药方",
        resolve(state) {
          const amount = grantQi(state, qiScale(state, 0.12));
          return { positive: true, text: `村民以祖传灵药相赠，你炼得 ${Math.floor(amount)} 灵气。` };
        }
      }
    ]
  },
  {
    id: "dream_teacher",
    title: "梦中授法",
    description: "吐纳时，一位面目模糊的道人踏月而来，只问你愿学快法，还是愿守拙功。",
    choices: [
      {
        label: "学一夕速成之法",
        resolve(state) {
          const amount = grantQi(state, qiScale(state, randomBetween(0.7, 1.1)));
          const stats = getDerivedStats(state);
          const cost = Math.min(state.run.lifespanRemaining, stats.maxLifespan * 0.06);
          state.run.lifespanRemaining = clamp(state.run.lifespanRemaining - cost);
          return { positive: true, text: `你骤得 ${Math.floor(amount)} 灵气，却燃去 ${Math.floor(cost)} 秒寿元。` };
        }
      },
      {
        label: "守一门水磨功夫",
        resolve(state) {
          multiplyBonus(state, "qpsMultiplier", 1.1);
          multiplyBonus(state, "clickMultiplier", 1.04);
          return { positive: true, text: "梦醒后法诀犹在，本世自动产出 +10%、点击收益 +4%。" };
        }
      }
    ]
  }
];

export function getEncounterById(id) {
  return ENCOUNTERS.find((encounter) => encounter.id === id) || null;
}

export function validatePendingEncounter(state, now = Date.now()) {
  if (!state.run.encounterAvailable) return { valid: false, reason: "机缘尚未出现" };
  const encounter = getEncounterById(state.run.activeEncounterId);
  if (!encounter || state.run.encounterExpiresAt <= now) {
    scheduleNextEncounter(state, now, encounterSpeed(state));
    return { valid: false, reason: encounter ? "机缘已经消散" : "机缘状态无效", cleared: true };
  }
  return { valid: true, encounter };
}

export function makeEncounterAvailable(state, now = Date.now()) {
  if (state.run.encounterAvailable) {
    validatePendingEncounter(state, now);
    return null;
  }
  if (now < state.run.nextEncounterAt) return null;
  const encounter = ENCOUNTERS[integerBetween(0, ENCOUNTERS.length - 1)];
  state.run.encounterAvailable = true;
  state.run.activeEncounterId = encounter.id;
  state.run.encounterExpiresAt = now + ENCOUNTER_TTL_MS;
  state.run.encounterAnnouncedId = `${state.generation}:${encounter.id}:${state.run.encounterExpiresAt}`;
  return encounter;
}

export function resolveEncounter(state, choiceIndex, now = Date.now()) {
  const validation = validatePendingEncounter(state, now);
  if (!validation.valid) return { ok: false, reason: validation.reason };
  const encounter = validation.encounter;
  const choice = encounter.choices?.[choiceIndex];
  if (!choice) {
    scheduleNextEncounter(state, now, encounterSpeed(state));
    return { ok: false, reason: "此念无从落下" };
  }

  scheduleNextEncounter(state, now, encounterSpeed(state));
  const outcome = choice.resolve(state);
  state.run.stats.encounters += 1;
  state.permanentStats.encountersResolved += 1;
  updateTaskProgress(state, "encounter", 1);
  addLog(state, encounter.title, outcome.text, now);
  return { ok: true, encounter, choice, ...outcome };
}

export function dismissLostEncounter(state, now = Date.now()) {
  scheduleNextEncounter(state, now, encounterSpeed(state));
}
