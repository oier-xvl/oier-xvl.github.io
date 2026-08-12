import { AUTOSAVE_MS } from "./config.js";
import { formatDuration, formatNumber } from "./numbers.js";
import {
  advanceTime, attemptBreakthrough, calculateOfflineProgress, consumePill, getDerivedStats, getRebirthReward,
  initializeRunBonuses, manualCultivate, performRebirth, purchaseItem, purchaseTalent
} from "./mechanics.js";
import { makeEncounterAvailable, resolveEncounter, validatePendingEncounter } from "./events.js";
import { loadState, saveState } from "./state.js";
import { applyTaskCombatResult, claimTask, getTaskChallenge, syncTaskWindow } from "./tasks.js";
import { claimAchievement, evaluateAchievements } from "./achievements.js";
import {
  cancelCombat, closeSettledCombat, isCombatBlocking, playerAction, runEnemyTurn, settleCombat,
  startAvailableSkirmish, startCombat, updateSkirmishAvailability
} from "./combat.js";
import {
  bindUI, invalidateDynamicLists, render, showConfirmation, showFloatingText, showNotice, showToast, updateSaveStatus
} from "./ui.js";

const startupNow = Date.now();
const loaded = loadState(startupNow);
const state = loaded.state;
initializeRunBonuses(state, startupNow);
syncTaskWindow(state, getDerivedStats(state, startupNow), startupNow);
evaluateAchievements(state, startupNow);
validatePendingEncounter(state, startupNow);
updateSkirmishAvailability(state, startupNow);
const offline = loaded.isNew ? null : calculateOfflineProgress(state, startupNow);
if (state.run.combat.status === "enemyTurn") {
  runEnemyTurn(state, startupNow);
  saveState(state, startupNow);
}
let lastFrameAt = startupNow;
let operationLocked = false;
let pageHiddenAt = document.visibilityState === "hidden" ? startupNow : 0;
let deathHandled = false;
let lastRenderAt = 0;
let lastTaskSecond = -1;
let lastEncounterNotice = state.run.encounterAvailable ? state.run.encounterAnnouncedId : "";
let lastSkirmishNotice = state.run.skirmish.available ? state.run.skirmish.announcedId : "";

function withOperationLock(callback) {
  if (operationLocked) return false;
  operationLocked = true;
  try {
    callback();
    return true;
  } catch (error) {
    console.error("游戏操作执行失败，操作锁已释放。", error);
    throw error;
  } finally {
    operationLocked = false;
  }
}

function persist(manual = false) {
  const success = saveState(state, Date.now());
  updateSaveStatus(success, manual);
  if (manual) showToast(success ? "云篆已封，存档完成。" : "存档失败，请检查浏览器存储权限。", success ? "success" : "warn");
  return success;
}

function persistIfVisible() {
  if (document.visibilityState !== "hidden") persist(false);
}

function afterCriticalAction(message, type = "success") {
  evaluateAchievements(state, Date.now());
  invalidateDynamicLists();
  render(state, Date.now(), true);
  persist(false);
  if (message) showToast(message, type);
}

function rejectDuringCombat(reason = "请先完成当前战斗") {
  if (!isCombatBlocking(state)) return false;
  showToast(reason, "warn");
  return true;
}

function beginCombat(result) {
  if (!result.ok) return showToast(result.reason, "warn");
  invalidateDynamicLists();
  render(state, Date.now(), true);
  persist(false);
}

function finishCombat() {
  const result = settleCombat(state, Date.now());
  if (!result.ok) return showToast(result.reason, "warn");
  if (result.source === "task") applyTaskCombatResult(state, result, Date.now());
  evaluateAchievements(state, Date.now());
  const parts = [];
  if (result.qi) parts.push(`获得 ${formatNumber(result.qi)} 灵气`);
  if (result.loss) parts.push(`损失 ${formatNumber(result.loss)} 灵气`);
  if (result.weakSeconds) parts.push(`虚弱 ${result.weakSeconds} 秒`);
  const message = result.victory ? `战斗胜利${parts.length ? `，${parts.join("，")}` : ""}。` : result.defeat ? `战斗落败${parts.length ? `，${parts.join("，")}` : ""}。` : `你已撤退${parts.length ? `，${parts.join("，")}` : ""}。`;
  closeSettledCombat(state);
  invalidateDynamicLists();
  render(state, Date.now(), true);
  persist(false);
  showToast(message, result.victory ? "success" : "warn", 4200);
}

const actions = {
  onCultivate(event) {
    const result = manualCultivate(state, Date.now());
    if (!result.ok) return;
    evaluateAchievements(state);
    showFloatingText(event, result.amount, result.critical);
    render(state, Date.now());
  },
  onBreakthrough() {
    if (rejectDuringCombat()) return;
    withOperationLock(() => {
      const result = attemptBreakthrough(state, Date.now());
      if (!result.ok) return showToast(result.reason, "warn");
      result.success ? afterCriticalAction(`破境功成，踏入${result.nextStage.name}！`) : afterCriticalAction(`破境失败，损失 ${formatNumber(result.loss)} 灵气，虚弱 ${result.weakSeconds} 秒。`, "warn");
    });
  },
  onPurchase(itemId) {
    if (rejectDuringCombat()) return;
    withOperationLock(() => {
      const result = purchaseItem(state, itemId, Date.now());
      if (!result.ok) return showToast(result.reason, "warn");
      afterCriticalAction(`${result.item.name}${result.item.buffId ? "已收入丹囊" : `提升至 ${result.level} 级`}。`);
    });
  },
  onConsumePill(pillId) {
    if (rejectDuringCombat()) return;
    withOperationLock(() => {
      const result = consumePill(state, pillId, Date.now());
      if (!result.ok) return showToast(result.reason, "warn");
      afterCriticalAction(`${result.pill.name}药力生效，持续 ${formatDuration(result.duration, true)}${result.lifespanRestore ? `，恢复 ${formatNumber(result.lifespanRestore)} 秒寿元` : ""}。`);
    });
  },
  onPurchaseTalent(talentId) {
    if (rejectDuringCombat()) return;
    withOperationLock(() => {
      const result = purchaseTalent(state, talentId, Date.now());
      if (!result.ok) return showToast(result.reason, "warn");
      afterCriticalAction(`${result.talent.name}已提升至 ${result.level} 级。`);
    });
  },
  onClaimTask(taskId) {
    if (rejectDuringCombat("战斗中无法领取任务奖励")) return;
    withOperationLock(() => {
      const result = claimTask(state, taskId, Date.now());
      if (!result.ok) return showToast(result.reason, "warn");
      afterCriticalAction(`任务奖励已领取：${result.reward} 灵石。`);
    });
  },
  onClaimAchievement(id) {
    if (rejectDuringCombat("战斗中无法领取成就奖励")) return;
    withOperationLock(() => {
      const result = claimAchievement(state, id, Date.now());
      if (!result.ok) return showToast(result.reason, "warn");
      const rewards = [result.stones ? `${result.stones}灵石` : "", result.crystals ? `${result.crystals}结晶` : "", result.bonus ? "永久加成" : ""].filter(Boolean).join("、");
      afterCriticalAction(`成就奖励已领取：${rewards}。`);
    });
  },
  onRequestRebirth() {
    if (rejectDuringCombat("战斗中无法主动轮回")) return;
    const reward = getRebirthReward(state);
    const exhausted = state.run.lifespanRemaining <= 0;
    showConfirmation(exhausted ? "寿尽轮回" : "兵解重修", `${exhausted ? "寿元已尽" : "主动兵解将结束此世"}。本世灵气、境界、养成、丹药与临时状态会重置；灵石、任务、成就、结晶与永久天赋保留。本次可得 ${formatNumber(reward)} 枚天道结晶。`, exhausted ? "入轮回" : "确认兵解", () => withOperationLock(() => {
      const result = performRebirth(state, exhausted ? "寿元耗尽" : "主动兵解", Date.now());
      syncTaskWindow(state, getDerivedStats(state), Date.now());
      deathHandled = false;
      lastEncounterNotice = "";
      lastSkirmishNotice = "";
      afterCriticalAction(`轮回再启，凝得 ${formatNumber(result.reward)} 枚天道结晶。`);
    }));
  },
  onEncounterChoice(choiceIndex) {
    if (rejectDuringCombat("战斗中无法处理机缘")) return;
    withOperationLock(() => {
      const result = resolveEncounter(state, choiceIndex, Date.now());
      if (!result.ok) return showToast(result.reason, "warn");
      afterCriticalAction(result.text, result.positive ? "success" : "warn");
    });
  },
  onStartSkirmish() {
    if (rejectDuringCombat()) return;
    withOperationLock(() => beginCombat(startAvailableSkirmish(state, Date.now())));
  },
  onChallengeTask(taskId) {
    if (rejectDuringCombat()) return;
    withOperationLock(() => {
      const challenge = getTaskChallenge(state, taskId, Date.now());
      if (!challenge.ok) return showToast(challenge.reason, "warn");
      beginCombat(startCombat(state, challenge.options, Date.now()));
    });
  },
  onCombatAction(action, payload = {}) {
    withOperationLock(() => {
      const result = playerAction(state, action, payload, Date.now());
      if (!result.ok) return showToast(result.reason, "warn");
      render(state, Date.now(), true);
      persist(false);
      if (!result.terminal && state.run.combat.status === "enemyTurn") {
        const enemyResult = runEnemyTurn(state, Date.now());
        if (!enemyResult.ok) showToast(enemyResult.reason, "warn");
        render(state, Date.now(), true);
        persist(false);
      }
    });
  },
  onFinishCombat() {
    withOperationLock(finishCombat);
  },
  onSave(manual) {
    persist(manual);
  }
};

bindUI(state, actions);
render(state, startupNow, true);
if (loaded.loadError) showToast("原存档无法读取，已启用安全的新存档。", "warn", 5000);
if (loaded.migratedFromV1) showToast("旧存档已迁移至第三版，原有第二版补偿规则保持不变。", "success", 5000);
if (offline?.elapsed > 0) {
  showNotice({ eyebrow: "重返洞府", title: offline.expired ? "一世已尽" : "离线结算", html: `<p>闭关 ${formatDuration(offline.elapsed)}，自动获得 <strong>${formatNumber(offline.qi)}</strong> 灵气${offline.autoClicks ? `，玄钟代为吐纳 ${formatNumber(offline.autoClicks)} 次` : ""}。</p>${offline.truncatedByLifespan ? "<p>离线期间寿元耗尽，收益只结算至寿尽时刻。</p>" : ""}` });
  persist(false);
}

function handleDeath() {
  if (deathHandled || state.run.lifespanRemaining > 0) return;
  deathHandled = true;
  if (isCombatBlocking(state)) cancelCombat(state);
  const result = performRebirth(state, "寿元耗尽", Date.now());
  syncTaskWindow(state, getDerivedStats(state), Date.now());
  evaluateAchievements(state);
  invalidateDynamicLists();
  render(state, Date.now(), true);
  persist(false);
  showNotice({ eyebrow: "大道无常", title: "寿尽轮回", html: `<p>前世止步于<strong>${result.previousStage.name}</strong>，凝得 <strong>${formatNumber(result.reward)}</strong> 枚天道结晶。</p><p>未结束战斗已无奖励取消；今世养成已重置，灵石、任务、成就与永久内容仍在。</p>` });
  deathHandled = false;
  lastEncounterNotice = "";
  lastSkirmishNotice = "";
}

function gameLoop(timestamp) {
  const now = Date.now();
  const deltaSeconds = Math.min(24 * 60 * 60, Math.max(0, (now - lastFrameAt) / 1000));
  if (now > lastFrameAt) lastFrameAt = now;
  if (deltaSeconds > 0 && document.visibilityState !== "hidden") advanceTime(state, deltaSeconds, now);
  const second = Math.floor(now / 1000);
  if (second !== lastTaskSecond) {
    const oldWindow = state.tasks.windowId;
    syncTaskWindow(state, getDerivedStats(state, now), now);
    evaluateAchievements(state, now);
    if (oldWindow !== state.tasks.windowId) {
      invalidateDynamicLists();
      persistIfVisible();
    }
    lastTaskSecond = second;
  }
  const encounter = makeEncounterAvailable(state, now);
  if (encounter && state.run.encounterAnnouncedId !== lastEncounterNotice) {
    lastEncounterNotice = state.run.encounterAnnouncedId;
    showToast(`一缕天机掠过：${encounter.title}`, "success", 3500);
    persistIfVisible();
  }
  const skirmish = updateSkirmishAvailability(state, now);
  if (skirmish.appeared && skirmish.announcedId !== lastSkirmishNotice) {
    lastSkirmishNotice = skirmish.announcedId;
    showToast("有人递来切磋邀约。", "success", 3000);
    persistIfVisible();
  }
  handleDeath();
  if (timestamp - lastRenderAt >= 100) {
    render(state, now);
    lastRenderAt = timestamp;
  }
  window.requestAnimationFrame(gameLoop);
}

window.requestAnimationFrame(gameLoop);
window.setInterval(persistIfVisible, AUTOSAVE_MS);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    pageHiddenAt = Date.now();
    persist(false);
  } else {
    const now = Date.now();
    const hiddenSeconds = Math.min(24 * 60 * 60, Math.max(0, (now - (pageHiddenAt || lastFrameAt)) / 1000));
    if (hiddenSeconds > 0) advanceTime(state, hiddenSeconds, now);
    pageHiddenAt = 0;
    lastFrameAt = now;
    syncTaskWindow(state, getDerivedStats(state, now), now);
    evaluateAchievements(state, now);
    validatePendingEncounter(state, now);
    updateSkirmishAvailability(state, now);
    handleDeath();
    render(state, now, true);
  }
});
window.addEventListener("pagehide", persistIfVisible);
