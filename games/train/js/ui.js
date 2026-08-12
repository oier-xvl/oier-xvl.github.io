import { getRealmIndex, ITEM_BY_ID, REALMS, SHOP_CATEGORIES, STAGES, TALENTS } from "./config.js";
import { formatDuration, formatNumber, formatPercent } from "./numbers.js";
import {
  canBreakthrough, canPurchaseItem, getAvailablePills, getDerivedStats, getFoundationRequirements,
  getItemCost, getItemLevel, getRebirthReward, getTalentCost
} from "./mechanics.js";
import { getEncounterById, validatePendingEncounter } from "./events.js";
import { ACHIEVEMENTS, getAchievementProgress } from "./achievements.js";
import { getTaskChallenge, getTaskCountdown } from "./tasks.js";
import { isCombatBlocking } from "./combat.js";

const byId = (id) => document.getElementById(id);
const elements = {
  qi: byId("qi-value"), qps: byId("qps-value"), stones: byId("stone-value"), lifespan: byId("lifespan-value"), crystals: byId("crystal-value"),
  saveStatus: byId("save-status"), globalMultiplier: byId("global-multiplier"), realmIndex: byId("realm-index"), realmName: byId("realm-name"), realmCap: byId("realm-cap"),
  progressValue: byId("progress-value"), progressTrack: document.querySelector(".progress-track"), progressFill: byId("progress-fill"), statusRow: byId("status-row"),
  cultivateButton: byId("cultivate-button"), clickYield: byId("click-yield"), breakthroughButton: byId("breakthrough-button"), breakthroughChance: byId("breakthrough-chance"),
  consumePillButton: byId("consume-pill-button"), pillQuickLabel: byId("pill-quick-label"), clickStat: byId("click-stat"), autoStat: byId("auto-stat"), critStat: byId("crit-stat"), intervalStat: byId("interval-stat"),
  foundationSummary: byId("foundation-summary"), foundationList: byId("foundation-list"), shopTabs: byId("shop-tabs"), shopList: byId("shop-list"), eventLog: byId("event-log"),
  encounterTimer: byId("encounter-timer"), generationLabel: byId("generation-label"), rebirthGain: byId("rebirth-gain"), rebirthHint: byId("rebirth-hint"), rebirthButton: byId("rebirth-button"),
  talentCount: byId("talent-count"), talentList: byId("talent-list"), encounterOrb: byId("encounter-orb"), combatOrb: byId("combat-orb"), floatingLayer: byId("floating-text-layer"),
  toastRegion: byId("toast-region"), encounterDialog: byId("encounter-dialog"), encounterTitle: byId("encounter-title"), encounterDescription: byId("encounter-description"), encounterChoices: byId("encounter-choices"),
  combatDialog: byId("combat-dialog"), combatSource: byId("combat-source"), combatTurnLabel: byId("combat-turn-label"), combatPlayerName: byId("combat-player-name"), combatPlayerHpText: byId("combat-player-hp-text"), combatPlayerHp: byId("combat-player-hp"),
  combatResolve: byId("combat-resolve"), combatPlayerStats: byId("combat-player-stats"), combatPlayerBuffs: byId("combat-player-buffs"), combatEnemyName: byId("combat-enemy-name"), combatEnemyHpText: byId("combat-enemy-hp-text"), combatEnemyHp: byId("combat-enemy-hp"),
  combatEnemyType: byId("combat-enemy-type"), combatEnemyStats: byId("combat-enemy-stats"), combatEnemyBuffs: byId("combat-enemy-buffs"), combatControls: byId("combat-controls"), combatSpellLabel: byId("combat-spell-label"), combatRetreatLabel: byId("combat-retreat-label"),
  combatPillToggle: byId("combat-pill-toggle"), combatPillLabel: byId("combat-pill-label"), combatPillList: byId("combat-pill-list"), combatLog: byId("combat-log"), combatFinishButton: byId("combat-finish-button"),
  confirmDialog: byId("confirm-dialog"), confirmTitle: byId("confirm-title"), confirmDescription: byId("confirm-description"), confirmAction: byId("confirm-action"),
  noticeDialog: byId("notice-dialog"), noticeEyebrow: byId("notice-eyebrow"), noticeTitle: byId("notice-title"), noticeContent: byId("notice-content"), helpDialog: byId("help-dialog"),
  saveButton: byId("save-button"), helpButton: byId("help-button"), taskList: byId("task-list"), taskArchive: byId("task-archive"), taskCountdown: byId("task-countdown"),
  achievementList: byId("achievement-list"), achievementSummary: byId("achievement-summary"), affairsClaimBadge: byId("affairs-claim-badge"), mobileClaimBadge: byId("mobile-claim-badge")
};

let activeShopTab = "roots";
let confirmationHandler = null;
let lastShopSignature = "";
let lastTalentSignature = "";
let lastLogSignature = "";
let lastTaskSignature = "";
let lastAchievementSignature = "";
let lastCombatPillSignature = "";
let combatPillsExpanded = false;
const pressedButtons = new WeakSet();

function escapeHtml(value) {
  const entities = { "&": "\u0026amp;", "<": "\u0026lt;", ">": "\u0026gt;", '"': "\u0026quot;", "'": "\u0026#039;" };
  return String(value).replace(/[&<>"']/g, (character) => entities[character]);
}

function setText(element, value) {
  if (element && element.textContent !== String(value)) element.textContent = value;
}

function setButtonDisabled(button, disabled) {
  if (button && !pressedButtons.has(button) && button.disabled !== disabled) button.disabled = disabled;
}

function rememberPressedButton(event) {
  const button = event.target.closest?.("button");
  if (button) pressedButtons.add(button);
}

function releasePressedButton(event) {
  const button = event.target.closest?.("button");
  if (button) window.setTimeout(() => pressedButtons.delete(button), 0);
}

function showDialog(dialog) {
  if (!dialog || dialog.open) return;
  for (const openDialog of document.querySelectorAll("dialog[open]")) {
    if (openDialog !== dialog) openDialog.close();
  }
  dialog.showModal();
}

function formatCost(cost) {
  return [cost.stones ? `${formatNumber(cost.stones)} 灵石` : "", cost.qi ? `${formatNumber(cost.qi)} 灵气` : ""].filter(Boolean).join(" + ");
}

export function render(state, now = Date.now(), force = false) {
  const stats = getDerivedStats(state, now);
  const stage = stats.stage;
  const progress = stage.cap > 0 ? Math.min(100, state.run.qi / stage.cap * 100) : 100;
  const breakthrough = canBreakthrough(state, now);
  const pills = getAvailablePills(state);
  const combatLocked = isCombatBlocking(state);
  setText(elements.qi, formatNumber(state.run.qi));
  setText(elements.qps, formatNumber(stats.qps));
  setText(elements.stones, formatNumber(state.spiritStones));
  setText(elements.lifespan, formatDuration(state.run.lifespanRemaining, true));
  setText(elements.crystals, formatNumber(state.crystals));
  setText(elements.globalMultiplier, `总倍率 ×${formatNumber(stats.globalMultiplier)}`);
  setText(elements.realmIndex, `第${stage.realmIndex + 1}境 · ${STAGES[stage.substage]}`);
  setText(elements.realmName, stage.name);
  setText(elements.realmCap, formatNumber(stage.cap));
  setText(elements.progressValue, `${formatNumber(state.run.qi)} / ${formatNumber(stage.cap)}`);
  elements.progressFill.style.width = `${progress}%`;
  elements.progressTrack.setAttribute("aria-valuenow", String(Math.round(progress)));
  setText(elements.clickYield, `每次 +${formatNumber(stats.clickYield)} 灵气`);
  setText(elements.clickStat, formatNumber(stats.clickYield));
  setText(elements.autoStat, `${formatNumber(stats.qps)} / 秒`);
  setText(elements.critStat, `${formatPercent(stats.critChance * 100, 1)} · ×${formatNumber(stats.critDamage, 1)}`);
  setText(elements.intervalStat, `${Math.round(stats.clickIntervalMs)}ms`);
  setText(elements.breakthroughChance, stage.isFinal ? "已证此世极境" : `成功率 ${formatPercent(stats.successChance * 100, 1)}`);
  setButtonDisabled(elements.breakthroughButton, !breakthrough.ok);
  elements.breakthroughButton.title = breakthrough.ok ? "消耗本阶上限灵气尝试破境" : breakthrough.reason;
  setButtonDisabled(elements.cultivateButton, state.run.lifespanRemaining <= 0 || combatLocked);
  elements.cultivateButton.title = combatLocked ? "战斗中无法吐纳" : "吐纳修炼";
  setButtonDisabled(elements.consumePillButton, pills.length === 0 || state.run.lifespanRemaining <= 0 || combatLocked);
  elements.consumePillButton.title = combatLocked ? "战斗中请使用战斗丹药" : "服用修炼丹药";
  setText(elements.pillQuickLabel, pills.length ? `${pills[0].name} ×${state.run.inventory[pills[0].id]}` : "暂无库存");
  setText(elements.generationLabel, `第 ${state.generation} 世`);
  setText(elements.rebirthGain, `可得 ${formatNumber(getRebirthReward(state))} 结晶`);
  setText(elements.rebirthHint, state.run.lifespanRemaining <= 0 ? "寿元已尽。轮回后灵石、任务、成就、结晶和永久天赋保留。" : "抵达更高境界、积累更多灵气，可凝聚更多天道结晶。");
  elements.rebirthButton.textContent = state.run.lifespanRemaining <= 0 ? "寿尽轮回" : "兵解重修";
  setButtonDisabled(elements.rebirthButton, combatLocked);
  elements.rebirthButton.title = combatLocked ? "请先完成当前战斗" : "结束本世并进入轮回";
  renderFoundation(state);
  renderStatuses(state, stats, now);
  renderEncounterIndicator(state, now);
  renderSkirmishIndicator(state, now);
  renderShop(state, force);
  renderTalents(state, force);
  renderLogs(state, force);
  renderTasks(state, now, force);
  renderAchievements(state, force);
  renderCombat(state, now);
}

function renderFoundation(state) {
  const requirements = getFoundationRequirements(state);
  if (!requirements.length) {
    setText(elements.foundationSummary, "小阶段无需额外道基");
    elements.foundationList.innerHTML = '<li class="met">灵气圆满即可尝试</li>';
    return;
  }
  const missing = requirements.filter((entry) => !entry.met).length;
  setText(elements.foundationSummary, missing ? `尚缺 ${missing} 项` : "道基已成");
  elements.foundationList.innerHTML = requirements.map((entry) => `<li class="${entry.met ? "met" : ""}">${entry.met ? "✓" : "○"} ${escapeHtml(entry.label)}（${formatNumber(entry.current)}/${formatNumber(entry.amount)}）</li>`).join("");
}

function renderStatuses(state, stats, now) {
  const chips = [];
  if (stats.isWeak) chips.push(`<span class="status-chip weak">虚弱 ${escapeHtml(formatDuration((state.run.weakUntil - now) / 1000, true))}</span>`);
  for (const [pillId, buff] of Object.entries(state.run.buffs)) {
    const pill = ITEM_BY_ID[pillId];
    if (pill && buff.expiresAt > now) chips.push(`<span class="status-chip buff">${escapeHtml(pill.name)} ${escapeHtml(formatDuration((buff.expiresAt - now) / 1000, true))}</span>`);
  }
  if (stats.autoClickInterval) chips.push(`<span class="status-chip">玄钟每 ${formatNumber(stats.autoClickInterval, 1)} 秒代为吐纳35%</span>`);
  if (isCombatBlocking(state)) chips.push('<span class="status-chip weak">斗法进行中</span>');
  elements.statusRow.innerHTML = (chips.length ? chips : ['<span class="status-chip">道心澄明</span>']).join("");
}

function renderEncounterIndicator(state, now) {
  const validation = state.run.encounterAvailable ? validatePendingEncounter(state, now) : { valid: false };
  const visible = validation.valid && !isCombatBlocking(state);
  elements.encounterOrb.hidden = !visible;
  setButtonDisabled(elements.encounterOrb, !visible);
  if (validation.valid) setText(elements.encounterTimer, isCombatBlocking(state) ? "战后可应缘" : `剩余 ${formatDuration((state.run.encounterExpiresAt - now) / 1000, true)}`);
  else setText(elements.encounterTimer, state.run.nextEncounterAt > now ? `约 ${formatDuration((state.run.nextEncounterAt - now) / 1000, true)}` : "天机将显");
}

function renderSkirmishIndicator(state, now) {
  const available = state.run.skirmish.available && state.run.skirmish.expiresAt > now;
  const visible = available && !isCombatBlocking(state) && now >= state.run.skirmish.cooldownUntil;
  elements.combatOrb.hidden = !visible;
  setButtonDisabled(elements.combatOrb, !visible);
  elements.combatOrb.title = visible ? `切磋邀约剩余 ${formatDuration((state.run.skirmish.expiresAt - now) / 1000, true)}` : "暂无可接受的切磋";
}

function renderShop(state, force) {
  const category = SHOP_CATEGORIES[activeShopTab];
  const signature = `${activeShopTab}|${category.items.map((item) => item.id).join("|")}`;
  if (signature !== lastShopSignature) {
    lastShopSignature = signature;
    elements.shopList.innerHTML = category.items.map((item) => `<article class="shop-item" data-shop-item="${item.id}"><span class="item-glyph" aria-hidden="true">${escapeHtml(item.glyph)}</span><div class="item-info"><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.description)} · <span class="item-level"></span></p></div><button class="buy-button" type="button" data-buy-item="${item.id}"><span class="button-label"></span><small></small></button></article>`).join("");
  }
  const realmIndex = getRealmIndex(state.run.stageIndex);
  for (const item of category.items) {
    const article = elements.shopList.querySelector(`[data-shop-item="${item.id}"]`);
    const button = article?.querySelector("[data-buy-item]");
    const level = getItemLevel(state, item);
    const cost = getItemCost(state, item);
    const check = canPurchaseItem(state, item);
    const locked = realmIndex < item.unlockRealm;
    const levelText = item.buffId ? `库存 ${level}/${item.maxStock}` : `等级 ${level}/${item.maxLevel}`;
    const buttonText = locked ? REALMS[item.unlockRealm].name : ["已至圆满", "库存已满"].includes(check.reason) ? (check.reason === "已至圆满" ? "圆满" : "已满") : check.ok ? "购置" : check.reason;
    setText(article?.querySelector(".item-level"), levelText);
    setText(button?.querySelector(".button-label"), buttonText);
    setText(button?.querySelector("small"), locked ? "尚未解锁" : formatCost(cost));
    setButtonDisabled(button, !check.ok);
    if (button) button.title = check.ok ? `消耗 ${formatCost(cost)}` : check.reason;
  }
}

function renderTalents(state, force) {
  const signature = TALENTS.map((talent) => talent.id).join("|");
  if (signature !== lastTalentSignature) {
    lastTalentSignature = signature;
    elements.talentList.innerHTML = TALENTS.map((talent) => `<div class="talent-item" data-talent-item="${talent.id}"><div><strong>${escapeHtml(talent.glyph)} · ${escapeHtml(talent.name)} <span class="item-level"></span></strong><p>${escapeHtml(talent.description)}</p></div><button type="button" data-buy-talent="${talent.id}"></button></div>`).join("");
  }
  const owned = TALENTS.reduce((sum, talent) => sum + Math.min(talent.maxLevel, state.talents[talent.id] || 0), 0);
  const total = TALENTS.reduce((sum, talent) => sum + talent.maxLevel, 0);
  setText(elements.talentCount, `${owned} / ${total}`);
  for (const talent of TALENTS) {
    const row = elements.talentList.querySelector(`[data-talent-item="${talent.id}"]`);
    const button = row?.querySelector("[data-buy-talent]");
    const level = Math.max(0, state.talents[talent.id] || 0);
    const maxed = level >= talent.maxLevel;
    const cost = getTalentCost(state, talent);
    const disabled = maxed || state.crystals < cost || isCombatBlocking(state);
    const title = isCombatBlocking(state) ? "战斗中无法参悟" : maxed ? "已完全点亮" : `消耗 ${formatNumber(cost)} 天道结晶`;
    row?.classList.toggle("owned", level > 0);
    setText(row?.querySelector(".item-level"), `${level}/${talent.maxLevel}`);
    setText(button, maxed ? "已悟" : formatNumber(cost));
    setButtonDisabled(button, disabled);
    if (button) button.title = title;
  }
}

function renderLogs(state, force) {
  const signature = `${state.run.logs.length}|${state.run.logs[0]?.time || 0}|${state.run.logs[0]?.text || ""}`;
  if (!force && signature === lastLogSignature) return;
  lastLogSignature = signature;
  elements.eventLog.innerHTML = state.run.logs.length ? state.run.logs.map((entry) => `<div class="log-entry"><strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(entry.text)}</span><time datetime="${new Date(entry.time).toISOString()}">${new Date(entry.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></div>`).join("") : '<p class="log-entry">道途尚无留痕。</p>';
}

function taskCard(task, archived = false) {
  const challenge = task.combat && !archived ? `<button class="challenge-button" type="button" data-challenge-task="${escapeHtml(task.id)}"></button>` : "";
  return `<article class="task-card" data-task-card="${escapeHtml(task.id)}"><header><strong>${escapeHtml(task.name)}</strong><span>${task.reward} 灵石</span></header><p>${escapeHtml(task.description)}</p><div class="task-progress"><span></span></div><div class="card-footer"><span class="task-progress-label"></span><span class="task-actions">${challenge}<button class="claim-button" type="button" data-claim-task="${escapeHtml(task.id)}"></button></span></div></article>`;
}

function updateTaskCard(state, task, now, archived = false) {
  const container = archived ? elements.taskArchive : elements.taskList;
  const card = [...container.querySelectorAll("[data-task-card]")].find((entry) => entry.dataset.taskCard === task.id);
  if (!card) return;
  const ratio = Math.min(1, task.progress / task.target);
  const complete = Boolean(task.completedAt);
  const label = task.event === "stageProgress" ? `${formatPercent(task.progress * 100, 0)} / ${formatPercent(task.target * 100, 0)}` : `${formatNumber(task.progress)} / ${formatNumber(task.target)}`;
  card.querySelector(".task-progress span").style.width = `${ratio * 100}%`;
  setText(card.querySelector(".task-progress-label"), `${label}${archived ? " · 已归档" : ""}`);
  const challengeButton = card.querySelector("[data-challenge-task]");
  if (challengeButton) {
    const check = getTaskChallenge(state, task.id, now);
    setText(challengeButton, complete ? "已完成" : task.retryAt > now ? `${Math.ceil((task.retryAt - now) / 1000)}秒` : "挑战");
    setButtonDisabled(challengeButton, !check.ok || isCombatBlocking(state));
    challengeButton.title = isCombatBlocking(state) ? "请先完成当前战斗" : check.ok ? "开始任务战" : check.reason;
  }
  const claimButton = card.querySelector("[data-claim-task]");
  setText(claimButton, task.claimedAt ? "已领" : complete ? "领取" : "进行中");
  setButtonDisabled(claimButton, !complete || Boolean(task.claimedAt) || isCombatBlocking(state));
}

function renderTasks(state, now, force) {
  setText(elements.taskCountdown, state.tasks.claimCooldownUntil > now ? `防护冷却 ${formatDuration((state.tasks.claimCooldownUntil - now) / 1000, true)}` : `${formatDuration(getTaskCountdown(state, now) / 1000, true)} 后刷新`);
  const signature = `${state.tasks.windowId}|${state.tasks.active.map((task) => task.id).join("|")}|${state.tasks.archive.map((task) => task.id).join("|")}`;
  if (signature !== lastTaskSignature) {
    lastTaskSignature = signature;
    elements.taskList.innerHTML = state.tasks.active.map((task) => taskCard(task)).join("") || '<p class="empty-state">当前窗口暂无可用任务。</p>';
    elements.taskArchive.innerHTML = state.tasks.archive.map((task) => taskCard(task, true)).join("") || '<p class="empty-state">暂无待领归档。</p>';
  }
  for (const task of state.tasks.active) updateTaskCard(state, task, now);
  for (const task of state.tasks.archive) updateTaskCard(state, task, now, true);
  updateClaimBadge(state);
}

function rewardText(reward) {
  return [reward.stones ? `${reward.stones}灵石` : "", reward.crystals ? `${reward.crystals}结晶` : "", reward.bonus === "click" ? "永久点击+5%" : "", reward.bonus === "offline" ? "离线上限+2小时" : "", reward.bonus === "breakthrough" ? "突破率+1%" : ""].filter(Boolean).join(" · ");
}

function renderAchievements(state, force) {
  const signature = ACHIEVEMENTS.map((achievement) => achievement.id).join("|");
  if (signature !== lastAchievementSignature) {
    lastAchievementSignature = signature;
    elements.achievementList.innerHTML = ACHIEVEMENTS.map((achievement) => `<article class="achievement-card" data-achievement-card="${achievement.id}"><header><strong>${escapeHtml(achievement.category)} · ${escapeHtml(achievement.name)}</strong><span>${escapeHtml(rewardText(achievement.reward))}</span></header><p>${escapeHtml(achievement.guide)}</p><div class="task-progress"><span></span></div><div class="card-footer"><span class="achievement-progress-label"></span><button class="claim-button" type="button" data-claim-achievement="${achievement.id}"></button></div></article>`).join("");
  }
  const unlocked = ACHIEVEMENTS.filter((achievement) => state.achievements.entries[achievement.id]?.unlockedAt).length;
  setText(elements.achievementSummary, `${unlocked} / ${ACHIEVEMENTS.length}`);
  for (const achievement of ACHIEVEMENTS) {
    const card = elements.achievementList.querySelector(`[data-achievement-card="${achievement.id}"]`);
    const entry = state.achievements.entries[achievement.id];
    const progress = getAchievementProgress(state, achievement);
    const complete = Boolean(entry?.unlockedAt);
    card.querySelector(".task-progress span").style.width = `${Math.min(1, progress / achievement.target) * 100}%`;
    setText(card.querySelector(".achievement-progress-label"), `${formatNumber(progress)} / ${formatNumber(achievement.target)}`);
    const button = card.querySelector("[data-claim-achievement]");
    setText(button, entry?.claimedAt ? "已领" : complete ? "领取" : "未解锁");
    setButtonDisabled(button, !complete || Boolean(entry?.claimedAt) || isCombatBlocking(state));
  }
  updateClaimBadge(state);
}

function updateClaimBadge(state) {
  const count = [...state.tasks.active, ...state.tasks.archive].filter((task) => task.completedAt && !task.claimedAt).length + ACHIEVEMENTS.filter((achievement) => { const entry = state.achievements.entries[achievement.id]; return entry?.unlockedAt && !entry.claimedAt; }).length;
  setText(elements.affairsClaimBadge, `可领 ${count}`);
  elements.mobileClaimBadge.hidden = count === 0;
}

function combatBuffMarkup(combat) {
  const buffs = [];
  if (combat.player.guarding) buffs.push("防御");
  if (combat.player.chargeAttack) buffs.push("蓄力攻势");
  if (combat.player.chargeVulnerable) buffs.push("蓄力易伤");
  for (const buff of Object.values(combat.player.buffs)) buffs.push(`${buff.name} ${buff.turns}回合`);
  return buffs.length ? buffs.map((buff) => `<span>${escapeHtml(buff)}</span>`).join("") : "<span>无</span>";
}

function enemyBuffMarkup(combat) {
  const buffs = [];
  if (combat.enemy.guarding) buffs.push("防御");
  if (combat.enemy.charging) buffs.push("蓄势");
  if (combat.enemy.enraged) buffs.push("狂暴");
  return buffs.length ? buffs.map((buff) => `<span>${escapeHtml(buff)}</span>`).join("") : "<span>无</span>";
}

function renderCombat(state) {
  const combat = state.run.combat;
  if (combat.status === "idle") {
    if (elements.combatDialog.open) elements.combatDialog.close();
    combatPillsExpanded = false;
    return;
  }
  if (elements.encounterDialog.open) elements.encounterDialog.close();
  showDialog(elements.combatDialog);
  const playerRatio = combat.player.maxHp ? combat.player.hp / combat.player.maxHp * 100 : 0;
  const enemyRatio = combat.enemy.maxHp ? combat.enemy.hp / combat.enemy.maxHp * 100 : 0;
  setText(elements.combatSource, combat.source === "task" ? "任务挑战" : "随机切磋");
  const stateLabels = { playerTurn: "玩家回合", enemyTurn: "敌方回合", victory: "胜利", defeat: "落败", retreated: "已撤退", settling: "战斗结算" };
  setText(elements.combatTurnLabel, stateLabels[combat.status] || "战斗中");
  setText(elements.combatPlayerName, combat.player.name);
  setText(elements.combatPlayerHpText, `${combat.player.hp} / ${combat.player.maxHp}`);
  elements.combatPlayerHp.style.width = `${playerRatio}%`;
  elements.combatPlayerHp.parentElement.setAttribute("aria-valuenow", String(Math.round(playerRatio)));
  setText(elements.combatResolve, `战意 ${combat.player.resolve} / 6`);
  setText(elements.combatPlayerStats, `攻 ${combat.player.attack} · 防 ${combat.player.defense}`);
  elements.combatPlayerBuffs.innerHTML = combatBuffMarkup(combat);
  setText(elements.combatEnemyName, combat.enemy.name);
  setText(elements.combatEnemyHpText, `${combat.enemy.hp} / ${combat.enemy.maxHp}`);
  elements.combatEnemyHp.style.width = `${enemyRatio}%`;
  elements.combatEnemyHp.parentElement.setAttribute("aria-valuenow", String(Math.round(enemyRatio)));
  setText(elements.combatEnemyType, combat.enemy.boss ? "首领" : "敌手");
  setText(elements.combatEnemyStats, `攻 ${combat.enemy.attack} · 防 ${combat.enemy.defense}`);
  elements.combatEnemyBuffs.innerHTML = enemyBuffMarkup(combat);
  const playerTurn = combat.status === "playerTurn";
  for (const button of elements.combatControls.querySelectorAll("[data-combat-action]")) {
    setButtonDisabled(button, !playerTurn || (button.dataset.combatAction === "spell" && (combat.player.resolve < 3 || combat.player.spellCooldown > 0)));
    button.title = !playerTurn ? "等待当前回合结束" : button.dataset.combatAction === "spell" && combat.player.resolve < 3 ? "战意不足" : button.dataset.combatAction === "spell" && combat.player.spellCooldown > 0 ? `冷却剩余 ${combat.player.spellCooldown} 回合` : "";
  }
  setText(elements.combatSpellLabel, combat.player.spellCooldown ? `冷却 ${combat.player.spellCooldown} 回合` : "消耗3战意");
  setText(elements.combatRetreatLabel, `成功率${combat.playerTurnNumber <= 2 ? 70 : 85}%`);
  const combatPills = SHOP_CATEGORIES.pills.items.filter((pill) => pill.combatPill);
  const stock = combatPills.reduce((sum, pill) => sum + state.run.inventory[pill.id], 0);
  setButtonDisabled(elements.combatPillToggle, !playerTurn || stock <= 0);
  setText(elements.combatPillLabel, stock ? `库存 ${stock}` : "无可用丹药");
  elements.combatPillList.hidden = !combatPillsExpanded || !playerTurn;
  const pillSignature = combatPills.map((pill) => pill.id).join("|");
  if (pillSignature !== lastCombatPillSignature) {
    lastCombatPillSignature = pillSignature;
    elements.combatPillList.innerHTML = combatPills.map((pill) => `<button type="button" data-combat-pill="${pill.id}"><span></span><br><small>${escapeHtml(pill.description)}</small></button>`).join("");
  }
  for (const pill of combatPills) {
    const button = elements.combatPillList.querySelector(`[data-combat-pill="${pill.id}"]`);
    setText(button?.querySelector("span"), `${pill.name} ×${state.run.inventory[pill.id]}`);
    setButtonDisabled(button, state.run.inventory[pill.id] <= 0 || !playerTurn);
  }
  const logMarkup = combat.logs.slice(-8).map((entry) => `<li>${escapeHtml(entry)}</li>`).join("");
  if (elements.combatLog.dataset.signature !== logMarkup) {
    elements.combatLog.dataset.signature = logMarkup;
    elements.combatLog.innerHTML = logMarkup;
  }
  elements.combatLog.scrollTop = elements.combatLog.scrollHeight;
  const terminal = ["victory", "defeat", "retreated"].includes(combat.status);
  elements.combatFinishButton.hidden = !terminal;
  setButtonDisabled(elements.combatFinishButton, !terminal);
  setText(elements.combatFinishButton, combat.status === "victory" ? "领取战果" : combat.status === "defeat" ? "接受落败" : "确认撤退");
}

function preventCombatDialogCancel(event) {
  event.preventDefault();
}

export function bindUI(state, actions) {
  document.addEventListener("pointerdown", rememberPressedButton, true);
  document.addEventListener("pointerup", releasePressedButton, true);
  document.addEventListener("pointercancel", releasePressedButton, true);
  elements.combatDialog.addEventListener("cancel", preventCombatDialogCancel);
  elements.cultivateButton.addEventListener("click", (event) => actions.onCultivate(event));
  elements.breakthroughButton.addEventListener("click", () => actions.onBreakthrough());
  elements.consumePillButton.addEventListener("click", () => { const pill = getAvailablePills(state)[0]; if (pill) actions.onConsumePill(pill.id); });
  elements.saveButton.addEventListener("click", () => actions.onSave(true));
  elements.helpButton.addEventListener("click", () => { if (!isCombatBlocking(state)) showDialog(elements.helpDialog); });
  elements.shopTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-shop-tab]");
    if (!button) return;
    activeShopTab = button.dataset.shopTab;
    for (const tab of elements.shopTabs.querySelectorAll("[data-shop-tab]")) tab.setAttribute("aria-selected", String(tab === button));
    renderShop(state, true);
  });
  elements.shopList.addEventListener("click", (event) => { const button = event.target.closest("[data-buy-item]"); if (button && !button.disabled) actions.onPurchase(button.dataset.buyItem); });
  elements.talentList.addEventListener("click", (event) => { const button = event.target.closest("[data-buy-talent]"); if (button && !button.disabled) actions.onPurchaseTalent(button.dataset.buyTalent); });
  elements.taskList.addEventListener("click", (event) => {
    const challenge = event.target.closest("[data-challenge-task]");
    if (challenge && !challenge.disabled) return actions.onChallengeTask(challenge.dataset.challengeTask);
    const claim = event.target.closest("[data-claim-task]");
    if (claim && !claim.disabled) actions.onClaimTask(claim.dataset.claimTask);
  });
  elements.taskArchive.addEventListener("click", (event) => { const button = event.target.closest("[data-claim-task]"); if (button && !button.disabled) actions.onClaimTask(button.dataset.claimTask); });
  elements.achievementList.addEventListener("click", (event) => { const button = event.target.closest("[data-claim-achievement]"); if (button && !button.disabled) actions.onClaimAchievement(button.dataset.claimAchievement); });
  for (const tab of document.querySelectorAll("[data-affairs-tab]")) tab.addEventListener("click", () => {
    for (const peer of document.querySelectorAll("[data-affairs-tab]")) peer.setAttribute("aria-selected", String(peer === tab));
    byId("tasks-view").classList.toggle("active", tab.dataset.affairsTab === "tasks");
    byId("achievements-view").classList.toggle("active", tab.dataset.affairsTab === "achievements");
  });
  elements.rebirthButton.addEventListener("click", () => actions.onRequestRebirth());
  elements.encounterOrb.addEventListener("click", () => openEncounter(state));
  elements.combatOrb.addEventListener("click", () => actions.onStartSkirmish());
  elements.encounterChoices.addEventListener("click", (event) => {
    const button = event.target.closest("[data-encounter-choice]");
    if (!button || button.disabled) return;
    for (const choice of elements.encounterChoices.querySelectorAll("[data-encounter-choice]")) choice.disabled = true;
    elements.encounterDialog.close();
    actions.onEncounterChoice(Number(button.dataset.encounterChoice));
  });
  elements.combatControls.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-combat-action]");
    if (actionButton && !actionButton.disabled) actions.onCombatAction(actionButton.dataset.combatAction);
  });
  elements.combatPillToggle.addEventListener("click", () => { combatPillsExpanded = !combatPillsExpanded; renderCombat(state); });
  elements.combatPillList.addEventListener("click", (event) => { const button = event.target.closest("[data-combat-pill]"); if (button && !button.disabled) { combatPillsExpanded = false; actions.onCombatAction("pill", { pillId: button.dataset.combatPill }); } });
  elements.combatFinishButton.addEventListener("click", () => actions.onFinishCombat());
  elements.confirmDialog.addEventListener("close", () => { if (elements.confirmDialog.returnValue === "confirm" && confirmationHandler) confirmationHandler(); confirmationHandler = null; });
  for (const tab of document.querySelectorAll(".mobile-tabs [data-panel]")) tab.addEventListener("click", () => {
    for (const peer of document.querySelectorAll(".mobile-tabs [data-panel]")) peer.classList.toggle("active", peer === tab);
    for (const panel of document.querySelectorAll("[data-game-panel]")) panel.classList.toggle("active", panel.id === tab.dataset.panel);
    byId(tab.dataset.panel)?.focus({ preventScroll: true });
  });
}

export function openEncounter(state, now = Date.now()) {
  if (isCombatBlocking(state)) return false;
  const validation = validatePendingEncounter(state, now);
  const encounter = validation.valid ? validation.encounter : getEncounterById(state.run.activeEncounterId);
  if (!validation.valid || !encounter) return false;
  setText(elements.encounterTitle, encounter.title);
  setText(elements.encounterDescription, encounter.description);
  elements.encounterChoices.innerHTML = encounter.choices.map((choice, index) => `<button class="choice-button" type="button" data-encounter-choice="${index}"><b>${index + 1}</b><span>${escapeHtml(choice.label)}</span></button>`).join("");
  showDialog(elements.encounterDialog);
  elements.encounterChoices.querySelector("button")?.focus();
  return true;
}

export function showConfirmation(title, description, actionLabel, handler) {
  setText(elements.confirmTitle, title);
  setText(elements.confirmDescription, description);
  setText(elements.confirmAction, actionLabel);
  confirmationHandler = handler;
  elements.confirmDialog.returnValue = "cancel";
  showDialog(elements.confirmDialog);
}

export function showNotice({ eyebrow = "重返洞府", title = "离线结算", html = "" }) {
  setText(elements.noticeEyebrow, eyebrow);
  setText(elements.noticeTitle, title);
  elements.noticeContent.innerHTML = html;
  showDialog(elements.noticeDialog);
}

export function showToast(message, type = "success", duration = 2600) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), duration);
}

export function showFloatingText(event, amount, critical = false) {
  const rect = elements.floatingLayer.getBoundingClientRect();
  const text = document.createElement("span");
  text.className = `float-text ${critical ? "critical" : ""}`;
  text.style.left = `${event?.clientX ? event.clientX - rect.left : rect.width / 2}px`;
  text.style.top = `${event?.clientY ? event.clientY - rect.top : rect.height / 2}px`;
  text.textContent = `${critical ? "暴击 " : ""}+${formatNumber(amount)} 灵气`;
  elements.floatingLayer.append(text);
  window.setTimeout(() => text.remove(), 950);
}

export function runRenderStabilityAssertions(state, now = Date.now()) {
  render(state, now, true);
  const selectors = [
    "#shop-list button", "#talent-list button", "#task-list button", "#task-archive button",
    "#achievement-list button", "#combat-pill-list button"
  ];
  const before = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
  render(state, now + 100, true);
  const after = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
  if (before.length !== after.length || before.some((button, index) => button !== after[index])) {
    throw new Error("重复渲染替换了交互按钮节点");
  }
  for (const button of before) {
    rememberPressedButton({ target: button });
    const original = button.disabled;
    setButtonDisabled(button, !original);
    if (button.disabled !== original) throw new Error("按压期间按钮禁用状态发生变化");
    pressedButtons.delete(button);
  }
  return { stableButtons: before.length, delegatedContainers: 6 };
}

export function updateSaveStatus(success, manual = false) {
  setText(elements.saveStatus, success ? `${manual ? "手动" : "自动"}存档 · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "存档失败 · 请检查浏览器权限");
}

export function invalidateDynamicLists() {
  lastShopSignature = "";
  lastTalentSignature = "";
  lastLogSignature = "";
  lastTaskSignature = "";
  lastAchievementSignature = "";
  lastCombatPillSignature = "";
}
