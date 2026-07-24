// Round-trip tests for the share-link encoding.
// Run: node src/encoding.test.js   (plain Node, no test framework)

import {
  encode, decode, emptyStates, VERSION, PROVINCE_COUNT,
} from "./encoding.js";

let passed = 0;
let failed = 0;

function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error("  FAIL: " + msg); }
}

function sameStates(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// --- empty map -------------------------------------------------------------
{
  const empty = emptyStates();
  const s = encode(empty);
  ok(s[0] === VERSION, "empty: has version prefix");
  ok(s.length <= 32, "empty: encoded string is URL-short (got " + s.length + ")");
  ok(sameStates(decode(s), empty), "empty: round-trips to empty map");
  // an empty map is all zeros -> every char after version is 'A'
  ok(/^1A+$/.test(s), "empty: encodes to version + all-'A' (got " + s + ")");
}

// --- fully full map (every province = yaşadım = 3) -------------------------
{
  const full = emptyStates();
  for (let p = 1; p <= PROVINCE_COUNT; p++) full[p] = 3;
  const s = encode(full);
  const back = decode(s);
  ok(sameStates(back, full), "full: round-trips with all-3");
  ok(back[0] === 0, "full: index 0 placeholder stays 0");
  for (let p = 1; p <= PROVINCE_COUNT; p++) {
    if (back[p] !== 3) { ok(false, "full: plate " + p + " != 3"); break; }
  }
}

// --- each single state value round-trips -----------------------------------
{
  for (const val of [0, 1, 2, 3]) {
    const st = emptyStates();
    for (let p = 1; p <= PROVINCE_COUNT; p++) st[p] = val;
    ok(sameStates(decode(encode(st)), st), "uniform state " + val + " round-trips");
  }
}

// --- boundary provinces (plate 1 and plate 81) set independently -----------
{
  const st = emptyStates();
  st[1] = 3;   // first province
  st[81] = 2;  // last province
  const back = decode(encode(st));
  ok(back[1] === 3 && back[81] === 2, "endpoints: plate 1 and 81 set independently");
  // nothing else leaked
  let clean = true;
  for (let p = 2; p <= 80; p++) if (back[p] !== 0) clean = false;
  ok(clean, "endpoints: middle provinces stay 0");
}

// --- 100 random maps -------------------------------------------------------
{
  let allOk = true;
  for (let t = 0; t < 100; t++) {
    const st = emptyStates();
    for (let p = 1; p <= PROVINCE_COUNT; p++) st[p] = (Math.random() * 4) | 0; // 0..3
    const back = decode(encode(st));
    if (!sameStates(back, st)) {
      allOk = false;
      console.error("  random case " + t + " mismatch");
      break;
    }
  }
  ok(allOk, "100 random maps round-trip exactly");
}

// --- garbage input -> empty map, never throws ------------------------------
{
  const empty = emptyStates();
  const garbage = [
    null,
    undefined,
    "",
    "1",                       // version only, no payload
    "2AAAAAAAAAAAAAAAAAAAAAAAAAAAA", // wrong version
    "1!!!invalid!!!",          // invalid base64url chars
    "1AAA",                    // too short (fewer than 21 bytes)
    "1" + "A".repeat(1),       // length %4 == 1 payload -> invalid
    "banana",                  // arbitrary text
    "1AB CD",                  // space is not base64url
    "1AAAA+AAAA/AAAA=",        // '+' '/' '=' are base64 but NOT base64url
    42,                        // not a string
    {},                        // not a string
    [],                        // not a string
    "1çğş",     // non-ASCII (Turkish chars)
  ];
  let allEmpty = true;
  for (const g of garbage) {
    let res;
    try {
      res = decode(g);
    } catch (e) {
      allEmpty = false;
      console.error("  garbage threw for input: " + JSON.stringify(g) + " -> " + e.message);
      continue;
    }
    if (!sameStates(res, empty)) {
      allEmpty = false;
      console.error("  garbage did not yield empty map for: " + JSON.stringify(g));
    }
  }
  ok(allEmpty, "all garbage inputs return empty map without throwing");
}

// --- encode tolerates out-of-range / missing state values ------------------
{
  const st = emptyStates();
  st[1] = 5;      // out of range -> masked to 5 & 3 = 1
  st[2] = -1;     // -1 & 3 = 3
  st[3] = 1.9;    // (1.9 | 0) & 3 = 1
  st[4] = "x";    // NaN -> ("x" | 0) = 0
  const back = decode(encode(st));
  ok(back[1] === 1, "coerce: 5 -> 1 (masked)");
  ok(back[2] === 3, "coerce: -1 -> 3 (masked)");
  ok(back[3] === 1, "coerce: 1.9 -> 1 (truncated)");
  ok(back[4] === 0, "coerce: non-number -> 0");
  ok(decode(encode(null)) && sameStates(decode(encode(null)), emptyStates()),
     "encode(null) is safe and round-trips to empty");
}

// --- encoded length matches spec (~29 chars) -------------------------------
{
  const full = emptyStates();
  for (let p = 1; p <= PROVINCE_COUNT; p++) full[p] = 3;
  const s = encode(full);
  // 21 bytes -> base64url(21) = 28 chars, + 1 version char = 29
  ok(s.length === 29, "length: encoded string is 29 chars (got " + s.length + ")");
}

// --- report ----------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
