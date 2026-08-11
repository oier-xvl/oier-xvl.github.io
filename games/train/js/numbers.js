import { MAX_SAFE_VALUE } from "./config.js";

export function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clamp(value, min = 0, max = MAX_SAFE_VALUE) {
  return Math.min(max, Math.max(min, finiteNumber(value, min)));
}

export function safeAdd(left, right) {
  return clamp(finiteNumber(left) + finiteNumber(right));
}

export function safeMultiply(...values) {
  let result = 1;
  for (const value of values) {
    result *= finiteNumber(value, 1);
    if (!Number.isFinite(result) || result >= MAX_SAFE_VALUE) return MAX_SAFE_VALUE;
  }
  return clamp(result);
}

export function geometricCost(baseCost, growth, level) {
  return clamp(Math.ceil(finiteNumber(baseCost) * Math.pow(finiteNumber(growth, 1), Math.max(0, Math.floor(finiteNumber(level))))));
}

const SHORT_UNITS = ["", "k", "m", "b", "t"];
const SCIENTIFIC_THRESHOLD = 1_000 ** SHORT_UNITS.length;

function trimDecimal(value) {
  return value.replace(/\.0+$|(?<=\.[0-9])0+$/, "");
}

function formatScientific(number, digits) {
  const [mantissa, exponent] = number.toExponential(digits).split("e");
  return `${trimDecimal(mantissa)}e${exponent.replace(/^\+/, "")}`;
}

export function formatNumber(value, digits = 2) {
  const number = Number(value);
  const precision = Math.max(0, Math.floor(finiteNumber(digits, 2)));

  if (Number.isNaN(number)) return "NaN";
  if (!Number.isFinite(number)) return number < 0 ? "-Infinity" : "Infinity";

  const absolute = Math.abs(number);
  if (absolute < 1_000) {
    if (absolute >= 100 || Number.isInteger(number)) return Math.trunc(number).toLocaleString("zh-CN");
    return number.toLocaleString("zh-CN", { maximumFractionDigits: precision });
  }

  if (absolute >= SCIENTIFIC_THRESHOLD) return formatScientific(number, precision);

  let unitIndex = Math.min(Math.floor(Math.log10(absolute) / 3), SHORT_UNITS.length - 1);
  let scaled = number / 1_000 ** unitIndex;
  let scaledAbsolute = Math.abs(scaled);
  let decimalPlaces = scaledAbsolute >= 100 ? 0 : scaledAbsolute >= 10 ? Math.min(1, precision) : precision;
  let rounded = Number(scaled.toFixed(decimalPlaces));

  if (Math.abs(rounded) >= 1_000) {
    unitIndex += 1;
    if (unitIndex >= SHORT_UNITS.length) return formatScientific(number, precision);
    scaled = number / 1_000 ** unitIndex;
    scaledAbsolute = Math.abs(scaled);
    decimalPlaces = scaledAbsolute >= 100 ? 0 : scaledAbsolute >= 10 ? Math.min(1, precision) : precision;
    rounded = Number(scaled.toFixed(decimalPlaces));
  }

  return `${trimDecimal(rounded.toFixed(decimalPlaces))}${SHORT_UNITS[unitIndex]}`;
}

export function runFormatNumberAssertions() {
  const cases = [
    [0, "0"],
    [1, "1"],
    [999, "999"],
    [1_000, "1k"],
    [1_500, "1.5k"],
    [999_999, "1m"],
    [1e6, "1m"],
    [-1_500, "-1.5k"],
    [1e12, "1t"],
    [999e12, "999t"],
    [1e15, "1e15"],
    [1e300, "1e300"],
    [NaN, "NaN"],
    [Infinity, "Infinity"]
  ];

  for (const [input, expected] of cases) {
    console.assert(formatNumber(input) === expected, `formatNumber(${String(input)}) 应为 ${expected}，实际为 ${formatNumber(input)}`);
  }
}

export function formatPercent(value, digits = 0) {
  const safe = clamp(value, 0, 100);
  return `${safe.toFixed(digits).replace(/\.0+$/, "")}%`;
}

export function formatDuration(totalSeconds, compact = false) {
  const seconds = Math.max(0, Math.floor(finiteNumber(totalSeconds)));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;

  if (compact) {
    if (days > 0) return `${days}天${hours}时`;
    if (hours > 0) return `${hours}时${minutes}分`;
    if (minutes > 0) return `${minutes}分${rest}秒`;
    return `${rest}秒`;
  }

  const parts = [];
  if (days) parts.push(`${days} 天`);
  if (hours) parts.push(`${hours} 时`);
  if (minutes) parts.push(`${minutes} 分`);
  if (rest || parts.length === 0) parts.push(`${rest} 秒`);
  return parts.join(" ");
}

export function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

export function integerBetween(min, max) {
  return Math.floor(randomBetween(min, max + 1));
}
