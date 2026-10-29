// Every colour written in a CSS value, for the neutral dark base gate (S43, R3.13, O-430, review
// finding 3). check-contrast.mjs reads each colour of a shadow list or an overlay and checks its
// HSL saturation; a colour it cannot read must fail the gate instead of slipping through.
//
// Mechanism: a small scanner walks the value left to right. It reads hex in all four lengths
// (#rgb, #rgba, #rrggbb, #rrggbbaa), rgb() and rgba() with numbers or percentages in comma or
// space syntax, hsl() and hsla() (converted to sRGB channels), and the neutral named colours
// (black, white, transparent and the CSS grays). It steps over numbers with their units, the
// shadow keyword inset and the math functions calc(), min(), max() and clamp(), whose insides it
// scans too. Anything else is unreadable and reported: another colour function (oklch(), lab(),
// color-mix() and so on), any other word (a named colour such as sienna, or currentcolor), a hex
// of the wrong length and an unclosed bracket. A var() is reported separately, since the caller
// says why it cannot follow one. No npm packages.

/** Named colours with no hue, as their sRGB channels (transparent is black at zero alpha). */
const NEUTRAL_NAMES = new Map([
  ["black", [0, 0, 0]],
  ["white", [255, 255, 255]],
  ["transparent", [0, 0, 0]],
  ["gray", [128, 128, 128]],
  ["grey", [128, 128, 128]],
  ["silver", [192, 192, 192]],
  ["gainsboro", [220, 220, 220]],
  ["whitesmoke", [245, 245, 245]],
  ["lightgray", [211, 211, 211]],
  ["lightgrey", [211, 211, 211]],
  ["darkgray", [169, 169, 169]],
  ["darkgrey", [169, 169, 169]],
  ["dimgray", [105, 105, 105]],
  ["dimgrey", [105, 105, 105]],
]);
/** Words in a shadow list that are not colours. */
const KEYWORDS = new Set(["inset"]);
/** Functions that hold lengths, not colours; their insides are scanned. */
const MATH_FUNCTIONS = new Set(["calc", "min", "max", "clamp"]);
const HEX_LENGTHS = new Set([3, 4, 6, 8]);

/** HSL saturation, 0 to 1, of sRGB channels 0 to 255. */
export function saturationOf(channels) {
  const [max, min] = [Math.max(...channels) / 255, Math.min(...channels) / 255];
  const lightness = (max + min) / 2;
  const span = 1 - Math.abs(2 * lightness - 1);
  return span === 0 ? 0 : (max - min) / span;
}

function hexChannels(digits) {
  const pairs = digits.length <= 4 ? [...digits].map((digit) => digit + digit) : digits.match(/../g);
  return pairs.slice(0, 3).map((pair) => Number.parseInt(pair, 16));
}

/** The arguments of a colour function: the parts before any "/ alpha", split on commas or spaces. */
function argumentsOf(inner) {
  return inner.split("/")[0].split(/[\s,]+/).filter((part) => part !== "");
}

/** An rgb() channel: a number 0 to 255 or a percentage; null when it is neither. */
function rgbChannel(part) {
  const match = /^(-?\d*\.?\d+)(%?)$/.exec(part);
  if (match === null) return null;
  const value = Number(match[1]) * (match[2] === "%" ? 2.55 : 1);
  return Math.round(Math.min(255, Math.max(0, value)));
}

function rgbOf(inner) {
  const channels = argumentsOf(inner).slice(0, 3).map(rgbChannel);
  return channels.length === 3 && channels.every((value) => value !== null) ? channels : null;
}

/** hsl() to sRGB channels; the hue may carry deg, saturation and lightness are percentages or numbers. */
function hslOf(inner) {
  const [hue, saturation, lightness] = argumentsOf(inner);
  const h = /^(-?\d*\.?\d+)(deg)?$/.exec(hue ?? "");
  const s = /^(\d*\.?\d+)%?$/.exec(saturation ?? "");
  const l = /^(\d*\.?\d+)%?$/.exec(lightness ?? "");
  if (h === null || s === null || l === null) return null;
  const [degrees, sat, light] = [((Number(h[1]) % 360) + 360) % 360, Math.min(1, Number(s[1]) / 100), Math.min(1, Number(l[1]) / 100)];
  // The CSS Color 4 hsl-to-rgb formula, for red (0), green (8) and blue (4).
  const amplitude = sat * Math.min(light, 1 - light);
  const at = (offset) => {
    const k = (offset + degrees / 30) % 12;
    return light - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [0, 8, 4].map((offset) => Math.round(255 * at(offset)));
}

/** The index of the bracket closing the one at `open`, or -1. */
function closingBracket(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] === ")") depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function colour(text, channels) {
  return { text, saturation: saturationOf(channels) };
}

/**
 * The colours of one CSS value: { colours: [{ text, saturation }], unreadable: [what], usesVar }.
 * A colour's text is how messages name it: hex as written, rgb() as its three channels, hsl() as written.
 */
export function scanColours(value) {
  const text = value.toLowerCase();
  const found = { colours: [], unreadable: [], usesVar: false };
  const scanFrom = (start, end) => {
    let index = start;
    while (index < end) {
      const rest = text.slice(index, end);
      const hex = /^#[0-9a-z]+/.exec(rest);
      const call = /^([a-z-]+)\(/.exec(rest);
      const number = /^[-+]?\d*\.?\d+[a-z%]*/.exec(rest);
      const word = /^[a-z-]+/.exec(rest);
      if (hex !== null) {
        const digits = hex[0].slice(1);
        if (HEX_LENGTHS.has(digits.length) && /^[0-9a-f]+$/.test(digits)) found.colours.push(colour(hex[0], hexChannels(digits)));
        else found.unreadable.push(hex[0]);
        index += hex[0].length;
      } else if (call !== null) {
        const open = index + call[0].length - 1;
        const close = closingBracket(text, open);
        if (close < 0 || close > end) {
          found.unreadable.push(`an unclosed ${call[1]}(`);
          return;
        }
        const inner = text.slice(open + 1, close);
        readFunction(call[1], inner, open + 1, close);
        index = close + 1;
      } else if (number !== null) {
        index += number[0].length;
      } else if (word !== null) {
        const channels = NEUTRAL_NAMES.get(word[0]);
        if (channels !== undefined) found.colours.push(colour(word[0], channels));
        else if (!KEYWORDS.has(word[0])) found.unreadable.push(`"${word[0]}"`);
        index += word[0].length;
      } else {
        index += 1;
      }
    }
  };
  const readFunction = (name, inner, start, end) => {
    if (name === "var") {
      found.usesVar = true;
      return;
    }
    if (MATH_FUNCTIONS.has(name)) {
      scanFrom(start, end);
      return;
    }
    const channels = name === "rgb" || name === "rgba" ? rgbOf(inner) : name === "hsl" || name === "hsla" ? hslOf(inner) : null;
    if (channels === null) {
      found.unreadable.push(`${name}()`);
      return;
    }
    found.colours.push(colour(name.startsWith("rgb") ? `rgb(${channels.join(" ")})` : `${name}(${inner.trim()})`, channels));
  };
  scanFrom(0, text.length);
  return found;
}
