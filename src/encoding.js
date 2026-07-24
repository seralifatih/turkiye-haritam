// Share-link state encoding for the 81-province map.
//
// State layout (see CLAUDE.md "State encoding"):
//   81 provinces x 4 states = 2 bits each = 162 bits = 21 bytes.
//   A single version character ("1") is prepended, then the 21 bytes are
//   base64url-encoded. Result is ~29 chars, comfortably URL-sized.
//
// States, by value:
//   0 = gitmedim (unvisited)
//   1 = geçtim
//   2 = gezdim
//   3 = yaşadım
//
// Province order is fixed by plate number 1..81 and MUST NOT change: bit
// position i*2 corresponds to plate (i+1). Reordering breaks every old link.
//
// The public state shape is a plain array indexed by PLATE NUMBER (1..81),
// so states[plate] lines up with src/provinces.js and the TopoJSON `plate`
// key. Index 0 is an unused placeholder (always 0).
//
// Works in both Node and the browser: no Buffer, no atob/btoa (base64url is
// implemented by hand over a Uint8Array).

export const VERSION = "1";
export const PROVINCE_COUNT = 81;

// Number of bytes needed to hold 81 * 2 = 162 bits.
const STATE_BYTES = Math.ceil((PROVINCE_COUNT * 2) / 8); // 21

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// Reverse lookup: base64url char code -> 6-bit value, or -1 if not a b64url char.
const B64URL_INV = (() => {
  const inv = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64URL.length; i++) inv[B64URL.charCodeAt(i)] = i;
  return inv;
})();

/**
 * An empty map: every province unvisited (0). Indexed by plate 1..81, index 0
 * is an unused placeholder. Returns a fresh array each call (safe to mutate).
 */
export function emptyStates() {
  return new Array(PROVINCE_COUNT + 1).fill(0);
}

// base64url-encode a Uint8Array without padding.
function bytesToBase64url(bytes) {
  let out = "";
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64URL[(n >>> 18) & 63] + B64URL[(n >>> 12) & 63] +
           B64URL[(n >>> 6) & 63] + B64URL[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64URL[(n >>> 18) & 63] + B64URL[(n >>> 12) & 63];
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64URL[(n >>> 18) & 63] + B64URL[(n >>> 12) & 63] + B64URL[(n >>> 6) & 63];
  }
  return out;
}

// base64url-decode into a Uint8Array. Returns null on any invalid character or
// an impossible length (a lone leftover 6-bit group cannot form a byte).
function base64urlToBytes(str) {
  const len = str.length;
  if (len % 4 === 1) return null; // 6 bits left over -> not a whole byte
  const outLen = Math.floor((len * 6) / 8);
  const bytes = new Uint8Array(outLen);
  let acc = 0, bits = 0, o = 0;
  for (let i = 0; i < len; i++) {
    const code = str.charCodeAt(i);
    const v = code < 128 ? B64URL_INV[code] : -1;
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[o++] = (acc >>> bits) & 0xff;
    }
  }
  return bytes;
}

/**
 * Pack a states array (indexed by plate 1..81) into a share string:
 * VERSION char + base64url of 21 packed bytes.
 *
 * State values are clamped to 0..3; anything out of range (or missing) is
 * treated as 0 (unvisited), so encoding never throws.
 */
export function encode(states) {
  const bytes = new Uint8Array(STATE_BYTES);
  for (let plate = 1; plate <= PROVINCE_COUNT; plate++) {
    let s = states != null ? states[plate] : 0;
    s = (s | 0) & 3; // coerce to a 2-bit value; non-numbers -> 0
    const bitPos = (plate - 1) * 2;
    const byteIdx = bitPos >>> 3;      // which byte
    const shift = 6 - (bitPos & 7);    // states packed MSB-first within each byte
    bytes[byteIdx] |= s << shift;
  }
  return VERSION + bytesToBase64url(bytes);
}

/**
 * Decode a share string back into a states array (indexed by plate 1..81).
 *
 * Tolerates garbage: any malformed input (wrong version, bad characters, wrong
 * length, null/undefined) returns an empty map rather than throwing. Trailing
 * bits beyond the 81 provinces are ignored.
 */
export function decode(str) {
  if (typeof str !== "string" || str.length < 1) return emptyStates();
  if (str[0] !== VERSION) return emptyStates();

  const bytes = base64urlToBytes(str.slice(1));
  if (bytes === null || bytes.length < STATE_BYTES) return emptyStates();

  const states = emptyStates();
  for (let plate = 1; plate <= PROVINCE_COUNT; plate++) {
    const bitPos = (plate - 1) * 2;
    const byteIdx = bitPos >>> 3;
    const shift = 6 - (bitPos & 7);
    states[plate] = (bytes[byteIdx] >>> shift) & 3;
  }
  return states;
}
