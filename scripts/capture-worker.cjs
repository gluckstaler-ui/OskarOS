var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// lib/scout-paths.ts
var scout_paths_exports = {};
__export(scout_paths_exports, {
  MEDIA_ROOT: () => MEDIA_ROOT,
  SHARED_BUCKET: () => SHARED_BUCKET,
  asciiFold: () => asciiFold,
  captureDir: () => captureDir,
  captureFile: () => captureFile,
  captureFileName: () => captureFileName,
  captureServeUrl: () => captureServeUrl,
  domainOf: () => domainOf,
  firstnameSlug: () => firstnameSlug,
  plzOrRegion: () => plzOrRegion,
  siteSlug: () => siteSlug,
  slugChunk: () => slugChunk
});
function asciiFold(s) {
  return (s || "").toLowerCase().replace(/[äöüßéèêëàâáôóîíïûçñ]/g, (c) => FOLD[c] ?? c).normalize("NFKD").replace(/[̀-ͯ]/g, "");
}
function slugChunk(s) {
  return asciiFold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}
function domainOf(url) {
  const raw = (url || "").trim();
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    return u.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  }
}
function siteSlug(url) {
  const host = domainOf(url);
  const labels = host.split(".");
  const noTld = labels.length > 1 ? labels.slice(0, -1).join("-") : host;
  return slugChunk(noTld);
}
function firstnameSlug(name) {
  const toks = (name || "").trim().split(/\s+/).filter(Boolean);
  const first = toks.find((t) => !TITLE.test(t.replace(/\.$/, "").toLowerCase())) || toks[0] || "unknown";
  return slugChunk(first);
}
function plzOrRegion(rp) {
  const plz = String(rp?.plz ?? "").trim();
  if (/^\d{4}$/.test(plz)) return plz;
  const text = ["adr", "adresse", "address", "ort"].map((k) => typeof rp?.[k] === "string" ? rp[k] : "").join(" ");
  const m = text.match(/\b(\d{4})\s+[A-ZÄÖÜ]/);
  if (m && +m[1] >= 1e3 && +m[1] <= 9999) return m[1];
  const region = String(rp?.bezirk ?? rp?.region ?? "").replace(/\(\?\)/g, "").trim();
  return region ? slugChunk(region) : "unknown";
}
function captureDir(t) {
  const top = t.sharedSiteCount && t.sharedSiteCount >= 2 ? SHARED_BUCKET : t.plzOrRegion;
  return import_path2.default.join(MEDIA_ROOT, top, t.slug);
}
function captureFileName(t, kind, disambig = "") {
  return `${t.firstname}${disambig ? "-" + disambig : ""}${SUFFIX[kind]}.jpg`;
}
function captureFile(t, kind, disambig = "") {
  return import_path2.default.join(captureDir(t), captureFileName(t, kind, disambig));
}
function captureServeUrl(fsPath) {
  const rel = import_path2.default.relative(MEDIA_ROOT, fsPath).split(import_path2.default.sep).join("/");
  return `/api/admin/scout/capture/${rel}`;
}
var import_path2, MEDIA_ROOT, FOLD, TITLE, SUFFIX, SHARED_BUCKET;
var init_scout_paths = __esm({
  "lib/scout-paths.ts"() {
    import_path2 = __toESM(require("path"));
    MEDIA_ROOT = import_path2.default.join(process.cwd(), "media");
    FOLD = {
      \u00E4: "ae",
      \u00F6: "oe",
      \u00FC: "ue",
      \u00DF: "ss",
      \u00E9: "e",
      \u00E8: "e",
      \u00EA: "e",
      \u00EB: "e",
      \u00E0: "a",
      \u00E2: "a",
      \u00E1: "a",
      \u00F4: "o",
      \u00F3: "o",
      \u00EE: "i",
      \u00ED: "i",
      \u00EF: "i",
      \u00FB: "u",
      \u00E7: "c",
      \u00F1: "n"
    };
    TITLE = /^(dr|prof|med|dipl|phil|lic|msc|ba|ma|fmh|fsp|dipl\.-psych|psych)$/;
    SUFFIX = { main: "", inner: "-inner", profile: "-profile" };
    SHARED_BUCKET = "_shared";
  }
});

// scripts/capture-worker-entry.ts
var import_node_fs = require("node:fs");

// lib/screenshot.ts
var import_fs2 = require("fs");
var import_path3 = require("path");
var import_dns = require("dns");
var import_puppeteer = __toESM(require("puppeteer"));

// lib/cli-paths.ts
var import_fs = require("fs");
var import_path = require("path");
var HOME = process.env.HOME || "";
var CANDIDATE_PATHS = {
  claude: [
    process.env.CLAUDE_BIN,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/usr/bin/claude",
    "/snap/bin/claude",
    (0, import_path.join)(HOME, ".npm-global/bin/claude"),
    (0, import_path.join)(HOME, "node_modules/.bin/claude"),
    "claude"
  ],
  gemini: [
    process.env.GEMINI_BIN,
    "/opt/homebrew/bin/gemini",
    "/usr/local/bin/gemini",
    "/usr/bin/gemini",
    "/snap/bin/gemini",
    (0, import_path.join)(HOME, ".npm-global/bin/gemini"),
    "gemini"
  ],
  // NOTE: the chromium resolver is defined here and READY, but the two Chromium
  // launchers (lib/thumbnail-generator.ts, app/api/mcp/screenshot/route.ts) are
  // deliberately NOT yet wired to it — that is WP-128 (split from WP-40).
  chromium: [
    process.env.CHROMIUM_BIN,
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/opt/homebrew/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/snap/bin/chromium",
    "chromium"
  ]
};
function findBinary(name) {
  for (const p of CANDIDATE_PATHS[name]) {
    if (!p) continue;
    if (p === name || (0, import_fs.existsSync)(p)) return p;
  }
  return name;
}

// lib/process-scheduling.ts
var import_os = require("os");
function elevatePriority(pid = 0) {
  const tiers = [
    import_os.constants.priority.PRIORITY_HIGHEST,
    import_os.constants.priority.PRIORITY_HIGH,
    import_os.constants.priority.PRIORITY_ABOVE_NORMAL,
    import_os.constants.priority.PRIORITY_NORMAL
  ];
  for (const tier of tiers) {
    try {
      (0, import_os.setPriority)(pid, tier);
      return tier;
    } catch {
    }
  }
  return null;
}

// lib/screenshot.ts
var REGISTRY_KEY = /* @__PURE__ */ Symbol.for("oskar.scout-screenshot.open-browsers");
var gReg = globalThis;
function getRegistry() {
  let reg = gReg[REGISTRY_KEY];
  if (!reg) {
    reg = { set: /* @__PURE__ */ new Set(), wired: false };
    gReg[REGISTRY_KEY] = reg;
  }
  if (!reg.wired) {
    reg.wired = true;
    const teardown = () => {
      const r = gReg[REGISTRY_KEY];
      if (!r) return;
      for (const b of Array.from(r.set)) {
        try {
          void b.close();
        } catch {
        }
      }
      r.set.clear();
    };
    process.once("SIGINT", () => {
      teardown();
      process.exit(130);
    });
    process.once("SIGTERM", () => {
      teardown();
      process.exit(143);
    });
    process.once("exit", teardown);
  }
  return reg;
}
var LAUNCH_SLOTS = 16;
var STAGGER_MS = 30;
var launchCounter = 0;
async function spawnBrowser() {
  let executablePath = findBinary("chromium");
  if (!(0, import_fs2.existsSync)(executablePath)) {
    try {
      executablePath = await import_puppeteer.default.executablePath();
    } catch {
    }
  }
  if (!(0, import_fs2.existsSync)(executablePath)) {
    throw new Error(
      `Chromium not found (resolved "${executablePath}"). Install it \u2014 macOS: drop Chromium.app in /Applications; Linux/WSL: \`apt install chromium-browser\` or \`npx puppeteer browsers install chrome\` \u2014 or set CHROMIUM_BIN.`
    );
  }
  const slot = launchCounter++ % LAUNCH_SLOTS;
  if (slot > 0) await new Promise((r) => setTimeout(r, slot * STAGGER_MS));
  const reg = getRegistry();
  const browser = await import_puppeteer.default.launch({
    headless: true,
    executablePath,
    // Chrome's vendored .so files live in ~/lib on the server, but the Next
    // process env doesn't carry LD_LIBRARY_PATH — so set it for the Chrome
    // child here. Harmless on macOS (the dir just doesn't exist → ignored).
    env: { ...process.env, LD_LIBRARY_PATH: [(0, import_path3.join)(process.env.HOME || "", "lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") },
    // WebSocket transport (the Puppeteer default). I tried `pipe: true`
    // here to give Chromium a kernel-level link to Node's life — but
    // pipe mode introduced flakiness with our --no-sandbox / --disable-*
    // flag set: launches got slower and capture failure rate went up.
    // Sticking with WebSocket. Orphan reaping is now handled by the
    // 3-second-bounded `browser.close()` in the finally block PLUS the
    // SIGKILL fallback on `browser.process()` — even a wedged Chromium
    // gets killed within 3s of finally entering, instead of pinning the
    // route handler forever.
    //
    // For Scout we don't care about cert validity — we're screenshotting a
    // public page, not transferring sensitive data. The SSRF guard vets
    // the resolved IP, so network-side protection stays intact.
    acceptInsecureCerts: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--ignore-certificate-errors",
      // Anti-bot evasion — Vercel/Cloudflare detect headless via subtle
      // signals and serve a 429 challenge instead of the real site.
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-web-security",
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });
  reg.set.add(browser);
  browser.once("disconnected", () => {
    reg.set.delete(browser);
  });
  const cp = browser.process();
  if (cp?.pid) elevatePriority(cp.pid);
  return browser;
}
function isPrivateIPv4(ip) {
  const parts = ip.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 0) return true;
  return false;
}
function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(lower)) return true;
  if (/^fe[89ab][0-9a-f]?:/.test(lower)) return true;
  const v4mapped = lower.match(/^::ffff:([0-9.]+)$/);
  if (v4mapped) return isPrivateIPv4(v4mapped[1]);
  return false;
}
function normalizeUrl(raw) {
  let trimmed = (raw || "").trim();
  if (!trimmed) return null;
  if (!/[a-z0-9]/i.test(trimmed)) return null;
  if (/^\d[\d\s+().-]*$/.test(trimmed)) return null;
  if (/^(n\/?a|none|tba|tbd|—|–|-)$/i.test(trimmed)) return null;
  trimmed = trimmed.replace(/^(?:https?:\/\/)+/i, "");
  trimmed = trimmed.split(/[,;\s]+/)[0] || trimmed;
  if (!trimmed) return null;
  try {
    const candidate = `https://${trimmed}`;
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    if (!/\./.test(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}
async function ssrfGuard(url) {
  try {
    const [v4, v6] = await Promise.all([
      import_dns.promises.resolve4(url.hostname).catch(() => []),
      import_dns.promises.resolve6(url.hostname).catch(() => [])
    ]);
    if (v4.length === 0 && v6.length === 0) {
      return { ok: false, reason: `DNS resolution failed for ${url.hostname}` };
    }
    for (const ip of v4) {
      if (isPrivateIPv4(ip)) return { ok: false, reason: `SSRF blocked: ${url.hostname} \u2192 ${ip} is private/loopback` };
    }
    for (const ip of v6) {
      if (isPrivateIPv6(ip)) return { ok: false, reason: `SSRF blocked: ${url.hostname} \u2192 ${ip} is private/loopback` };
    }
    return { ok: true, ip: v4[0] || v6[0] };
  } catch (err) {
    return { ok: false, reason: `SSRF guard error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
var TOTAL_TIMEOUT_MS = 24e4;
var NAV_TIMEOUT_MS = 25e3;
var REJECT_PATHS = [
  "/standorte",
  "/standort",
  "/kosten",
  "/preise",
  "/angebot",
  "/angebote",
  "/kontakt",
  "/impressum",
  "/datenschutz",
  "/about",
  "/uber-uns",
  "/ueber-uns",
  "/join",
  "/jobs",
  "/karriere",
  "/news",
  "/blog"
];
function stripLangPrefix(pathname) {
  const m = pathname.match(/^(\/[a-z]{2}(?:-[a-z]{2})?)(\/.*|$)/i);
  if (m) return { lang: m[1], rest: m[2] || "/" };
  return { lang: "", rest: pathname || "/" };
}
function isRootLikePath(rest) {
  return rest === "" || rest === "/";
}
function isRejectPath(rest) {
  const low = rest.toLowerCase();
  return REJECT_PATHS.some((r) => low === r || low.startsWith(r + "/"));
}
async function captureUrl(rawUrl, ctx) {
  const startedAt = Date.now();
  const url = normalizeUrl(rawUrl);
  if (!url) return { ok: false, url: rawUrl || null, reason: "invalid URL" };
  const guard = await ssrfGuard(url);
  if (guard.ok === false) return { ok: false, url: url.href, reason: guard.reason };
  const { captureDir: captureDir2, captureFile: captureFile2, captureServeUrl: captureServeUrl2 } = await Promise.resolve().then(() => (init_scout_paths(), scout_paths_exports));
  const sharp = (await import("sharp")).default;
  const dir = captureDir2(ctx);
  if (!(0, import_fs2.existsSync)(dir)) (0, import_fs2.mkdirSync)(dir, { recursive: true });
  const profilePath = captureFile2(ctx, "profile");
  const isShared = !!(ctx.sharedSiteCount && ctx.sharedSiteCount >= 2);
  let fullPath = isShared ? (0, import_path3.join)(dir, "_site-home.jpg") : captureFile2(ctx, "main");
  const writeMainShot = (buf) => {
    if (!isShared) {
      (0, import_fs2.writeFileSync)(fullPath, buf);
      return fullPath;
    }
    if (!(0, import_fs2.existsSync)(fullPath)) {
      (0, import_fs2.writeFileSync)(fullPath, buf);
    } else {
      console.log(`[capture] ${url.href} \xB7 shared-site \xB7 ${fullPath} exists \u2192 skip write`);
    }
    return fullPath;
  };
  const metaPath = (0, import_path3.join)(dir, `${ctx.firstname}.meta.json`);
  let browser;
  try {
    browser = await spawnBrowser();
  } catch (err) {
    return { ok: false, url: url.href, reason: `browser-launch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  let page = null;
  async function spaSettle(pg, navigatedUrl) {
    await new Promise((r) => setTimeout(r, 300));
    const isSpaWaiting = await pg.evaluate(() => {
      const text = (document.body?.innerText || "").trim().toLowerCase();
      if (text.length < 60) return true;
      if (/(^|\s)(loading|wird geladen|chargement|caricamento)\.{0,3}$/i.test(text)) return true;
      if (document.querySelector("#nuxt-loading, #__nuxt > .nuxt-progress, .spa-loader")) return true;
      return false;
    }).catch(() => false);
    if (!isSpaWaiting) {
      try {
        await Promise.race([
          pg.evaluate(() => {
            window.stop();
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("stop timed out")), 1500))
        ]);
      } catch {
      }
      return;
    }
    console.log(`[capture] ${navigatedUrl} \xB7 SPA detected \xB7 waiting for content+images\u2026`);
    const maxWaitMs = 6e3;
    const pollMs = 400;
    const startedWait = Date.now();
    while (Date.now() - startedWait < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollMs));
      const ready = await pg.evaluate((startedAtMs) => {
        const text = (document.body?.innerText || "").trim();
        if (text.length < 200) return false;
        const elapsed = Date.now() - startedAtMs;
        const imgs = Array.from(document.images);
        for (const img of imgs) {
          if (!img.src) continue;
          const aged = elapsed > 2e3;
          if (!aged && (!img.complete || !img.naturalWidth)) return false;
        }
        const all = Array.from(document.querySelectorAll("*"));
        for (const el of all) {
          if (!el.offsetWidth || !el.offsetHeight) continue;
          const bg = getComputedStyle(el).backgroundImage;
          if (!bg || !/^url\(/.test(bg)) continue;
          if (el.offsetWidth * el.offsetHeight < 2e5) continue;
          const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
          if (!m) continue;
          const probe = new Image();
          probe.src = m[1];
          const aged = elapsed > 2e3;
          if (!aged && (!probe.complete || !probe.naturalWidth)) return false;
          break;
        }
        return true;
      }, startedWait).catch(() => true);
      if (ready) break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    const captured = await Promise.race([
      (async () => {
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
        await page.setUserAgent(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
        );
        console.log(`[capture] ${url.href} \xB7 goto\u2026`);
        const response = await page.goto(url.href, {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT_MS
        });
        if (!response) {
          return { ok: false, url: url.href, reason: "no response from server" };
        }
        console.log(`[capture] ${url.href} \xB7 goto OK \xB7 settle\u2026`);
        await spaSettle(page, url.href);
        let renderedHtml = null;
        try {
          renderedHtml = await page.content();
        } catch {
        }
        try {
          const dismissResult = await Promise.race([
            page.evaluate(async () => {
              const KNOWN_SELECTORS = [
                // OneTrust (used by ~30% of EU sites)
                "#onetrust-accept-btn-handler",
                'button[id^="onetrust-accept"]',
                // Cookiebot
                "#CybotCookiebotDialogBodyButtonAccept",
                "#CybotCookiebotDialogBodyLevelButtonAcceptAll",
                "#CybotCookiebotDialogBodyLevelButtonAccept",
                // Axeptio
                "#axeptio_btn_acceptAll",
                "button.axeptio-btn-accept-all",
                // Didomi
                "#didomi-notice-agree-button",
                'button[aria-label*="Agree to all" i]',
                // HubSpot
                "#hs-eu-confirmation-button",
                "#hs-eu-cookie-confirmation .hs-eu-confirmation-button",
                // CookieConsent (Insites Cookieconsent / Klaro / OSano)
                ".cc-btn.cc-allow",
                ".cc-btn.cc-dismiss",
                ".klaro .cm-btn-accept-all",
                // Termly
                "#termly-code-snippet-support-modal-accept",
                // Drupal EU Cookie Compliance
                ".agree-button.eu-cookie-compliance-default-button",
                // Generic data-testid + aria-label
                'button[data-testid*="accept-all" i]',
                'button[data-test*="accept-all" i]',
                'button[aria-label*="accept all" i]',
                'button[aria-label*="alle akzeptieren" i]',
                // Usercentrics (very common on DE/CH sites)
                'button[data-testid="uc-accept-all-button"]',
                '#usercentrics-root button[data-testid="uc-accept-all-button"]',
                // Borlabs Cookie (German WordPress staple)
                "a.brlbs-btn-accept-all",
                "button.brlbs-btn-accept-all",
                "[data-borlabs-cookie-accept]",
                // Iubenda
                ".iubenda-cs-accept-btn",
                // Complianz
                ".cmplz-accept",
                "button.cmplz-btn.cmplz-accept",
                // CookieYes
                ".cky-btn-accept",
                // Real Cookie Banner
                ".rcb-btn-accept-all",
                '[data-rcb-action="accept-all"]',
                // Cookie Notice / GDPR Cookie Consent (WP)
                "#cn-accept-cookie",
                "#cookie-notice .cn-set-cookie"
              ];
              const ACCEPT_TEXTS = [
                /^accept all( cookies)?$/i,
                /^accept( all)?$/i,
                /^agree( to all)?$/i,
                /^i agree$/i,
                /^allow all( cookies)?$/i,
                /^got it$/i,
                /^ok$/i,
                /^okay$/i,
                /^alles klar$/i,
                /^ok,? (verstanden|got it)$/i,
                /^continue$/i,
                /^alle akzeptieren$/i,
                /^alles akzeptieren$/i,
                /^akzeptieren$/i,
                /^einverstanden$/i,
                /^zustimmen$/i,
                /^verstanden$/i,
                /^ich stimme zu$/i,
                /^tout accepter$/i,
                /^accepter$/i,
                /^accepter tout$/i,
                /^j'accepte( tout)?$/i,
                /^d'accord$/i,
                /^accetta tutto$/i,
                /^accetta$/i,
                /^ho capito$/i,
                /^accetto$/i
              ];
              const ACCEPT_PARTIAL = /(akzeptier|zustimm|einverstanden|annehmen|alle.*(erlaub|zulass)|accept|agree|allow all|allow cookies|got it|tout accepter|accepter|d.?accord|accetta|accetto|ho capito)/i;
              const DENY_OR_CONFIG = /(ablehn|reject|decline|nur (notwendige|essenzielle|technisch|erforderlich)|essential only|necessary only|einstellung|preferenc|präferenz|settings|verwalten|manage|configure|konfigurier|individuell|auswahl|customi[sz]e|anpassen|optionen|\boptions\b|mehr (info|erfahren)|details|impressum|datenschutz|weiterlesen)/i;
              for (let i = 0; i < 10; i++) {
                for (const sel of KNOWN_SELECTORS) {
                  const el = document.querySelector(sel);
                  if (el && el.offsetParent !== null) {
                    el.click();
                    return { hit: true, via: "selector", selector: sel };
                  }
                }
                const clickable = Array.from(document.querySelectorAll(
                  'button, a[role="button"], [role="button"], input[type="button"], input[type="submit"], a[href="#"]'
                ));
                for (const el of clickable) {
                  if (!el.offsetParent) continue;
                  const label = (el.value || el.innerText || el.textContent || "").trim();
                  if (!label || label.length > 60) continue;
                  if (ACCEPT_TEXTS.some((re) => re.test(label))) {
                    el.click();
                    return { hit: true, via: "text", label };
                  }
                }
                for (const el of clickable) {
                  if (!el.offsetParent) continue;
                  const label = (el.value || el.innerText || el.textContent || "").trim();
                  if (!label || label.length > 60) continue;
                  if (DENY_OR_CONFIG.test(label)) continue;
                  if (ACCEPT_PARTIAL.test(label)) {
                    el.click();
                    return { hit: true, via: "text-partial", label };
                  }
                }
                await new Promise((res) => setTimeout(res, 250));
              }
              return { hit: false };
            }),
            new Promise((_, rej) => setTimeout(() => rej(new Error("cookie dismiss timed out")), 3500))
          ]);
          await new Promise((r) => setTimeout(r, 250));
          const dr = dismissResult;
          if (dr?.hit) {
            const detail = dr.via === "selector" ? dr.selector : dr.label;
            console.log(`[capture] ${url.href} \xB7 cookie banner dismissed (${dr.via}: ${detail})`);
          }
        } catch {
        }
        console.log(`[capture] ${url.href} \xB7 screenshot\u2026`);
        const mainPng = await Promise.race([
          page.screenshot({ type: "png" }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("screenshot timed out")), 3e4))
        ]);
        const mainJpeg = await sharp(mainPng).jpeg({ quality: 85 }).toBuffer();
        fullPath = writeMainShot(mainJpeg);
        console.log(`[capture] ${url.href} \xB7 screenshot done (${mainJpeg.length} B) \u2192 ${fullPath}`);
        const finalUrl = page.url();
        const innerFinalUrl = null;
        let profileOk = false;
        let profileFinalUrl = null;
        let mainUrlAfterFix = null;
        if (ctx.sharedSiteCount && ctx.sharedSiteCount >= 2) {
          try {
            const inputUrl = new URL(url.href);
            const { lang, rest } = stripLangPrefix(inputUrl.pathname);
            const isRoot = isRootLikePath(rest);
            const isReject = isRejectPath(rest);
            const isDeepLink = !isRoot && !isReject;
            const rootHref = `${inputUrl.protocol}//${inputUrl.host}${lang || "/"}`;
            const PROBE_PATHS = ["team", "therapeuten", "psychotherapeuten"];
            const probeUrls = [];
            for (const p of PROBE_PATHS) {
              if (lang) probeUrls.push(`${inputUrl.protocol}//${inputUrl.host}${lang}/${p}`);
              probeUrls.push(`${inputUrl.protocol}//${inputUrl.host}/${p}`);
            }
            const tokens = (ctx.nameTokens || [ctx.firstname]).map((t) => t.toLowerCase()).filter((t) => t.length >= 3);
            const firstTok = tokens[0] || "";
            const lastTok = tokens[1] || "";
            const findBest = async () => {
              return await page.evaluate((args) => {
                const { first, last, REJECT } = args;
                const here = location.host;
                const links = Array.from(document.querySelectorAll("a[href]"));
                let best = null;
                for (const a of links) {
                  let u;
                  try {
                    u = new URL(a.href);
                  } catch {
                    continue;
                  }
                  if (u.host !== here) continue;
                  const text = (a.innerText || a.textContent || "").toLowerCase();
                  const pathLow = u.pathname.toLowerCase();
                  const langStripped = pathLow.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/, "") || "/";
                  if (REJECT.some((r) => langStripped === r || langStripped.startsWith(r + "/"))) continue;
                  const lastSeg = pathLow.split("/").filter(Boolean).slice(-1)[0] || "";
                  let score = 0;
                  if (first && last) {
                    if (lastSeg.includes(first) && lastSeg.includes(last)) score = 100;
                    else if (lastSeg.includes(first) && last.length >= 4) score = 70;
                    else if (pathLow.includes(first) && pathLow.includes(last)) score = 50;
                    else if (last && pathLow.includes(last)) score = 25;
                    else if (first && text.includes(first) && last && text.includes(last)) score = 15;
                    else if (last && text.includes(last)) score = 5;
                  } else if (first) {
                    if (lastSeg.includes(first)) score = 30;
                    else if (pathLow.includes(first)) score = 10;
                  }
                  if (score === 0) continue;
                  if (!best || score > best.score || score === best.score && a.href.length < best.href.length) {
                    best = { href: a.href, score };
                  }
                }
                return best?.href ?? null;
              }, { first: firstTok, last: lastTok, REJECT: REJECT_PATHS });
            };
            const shoot = async (label) => {
              const png = await Promise.race([
                page.screenshot({ type: "png" }),
                new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} screenshot timed out`)), 2e4))
              ]);
              return await sharp(png).jpeg({ quality: 85 }).toBuffer();
            };
            if (isDeepLink) {
              console.log(`[capture] ${url.href} \xB7 shared-site \xB7 deep-link \u2192 PROFILE=this, MAIN=root (${rootHref})`);
              (0, import_fs2.writeFileSync)(profilePath, mainJpeg);
              profileOk = true;
              profileFinalUrl = url.href;
              await page.goto(rootHref, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
              await spaSettle(page, rootHref);
              fullPath = writeMainShot(await shoot("root-after-deeplink"));
              mainUrlAfterFix = page.url();
            } else if (isReject) {
              console.log(`[capture] ${url.href} \xB7 shared-site \xB7 REJECT-path input \u2192 re-shoot root (${rootHref}) for MAIN, then search`);
              await page.goto(rootHref, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
              await spaSettle(page, rootHref);
              fullPath = writeMainShot(await shoot("root-after-reject"));
              mainUrlAfterFix = page.url();
            }
            if (isRoot || isReject) {
              let profileTargetUrl = await findBest();
              if (!profileTargetUrl) {
                for (const probeUrl of probeUrls) {
                  try {
                    await page.goto(probeUrl, { waitUntil: "domcontentloaded", timeout: 1e4 });
                    await spaSettle(page, probeUrl);
                    const found = await findBest();
                    if (found) {
                      profileTargetUrl = found;
                      break;
                    }
                  } catch {
                  }
                }
              }
              if (profileTargetUrl) {
                console.log(`[capture] ${url.href} \xB7 shared-site \xB7 PROFILE \u2192 ${profileTargetUrl}`);
                await page.goto(profileTargetUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
                await spaSettle(page, profileTargetUrl);
                (0, import_fs2.writeFileSync)(profilePath, await shoot("profile"));
                profileOk = true;
                profileFinalUrl = page.url();
              } else {
                console.log(`[capture] ${url.href} \xB7 shared-site \xB7 PROFILE link not found (tokens=${tokens.join(",")}) \u2014 no -profile.jpg written`);
              }
            }
          } catch (err) {
            console.log(`[capture] ${url.href} \xB7 profile errored: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        const existingShots = (0, import_fs2.existsSync)(dir) ? (0, import_fs2.readdirSync)(dir).filter((f) => /\.(jpg|png|webp)$/i.test(f)).length : 0;
        if (existingShots >= 2) {
          let sweepPage = null;
          try {
            const su = new URL(url.href);
            const { lang: sweepLang } = stripLangPrefix(su.pathname);
            const sweepRoot = `${su.protocol}//${su.host}${sweepLang || "/"}`;
            sweepPage = await browser.newPage();
            await sweepPage.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
            await sweepPage.goto(sweepRoot, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
            await spaSettle(sweepPage, sweepRoot);
            const navLinks = await sweepPage.evaluate((REJECT) => {
              const here = location.host;
              let anchors = Array.from(document.querySelectorAll('header a[href], nav a[href], [role="navigation"] a[href]'));
              if (anchors.length < 3) anchors = Array.from(document.querySelectorAll("a[href]"));
              const seen = /* @__PURE__ */ new Set();
              const out = [];
              for (const a of anchors) {
                let u;
                try {
                  u = new URL(a.href);
                } catch {
                  continue;
                }
                if (u.host !== here) continue;
                if (u.hash) continue;
                if (/\.(pdf|zip|docx?|xlsx?|jpg|png|gif|webp|mp4)$/i.test(u.pathname)) continue;
                const stripped = u.pathname.toLowerCase().replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/, "") || "/";
                if (stripped === "/" || stripped === "") continue;
                if (stripped.split("/").filter(Boolean).length !== 1) continue;
                if (REJECT.some((r) => stripped === r || stripped.startsWith(r + "/"))) continue;
                if (seen.has(stripped)) continue;
                seen.add(stripped);
                const slug = stripped.replace(/^\//, "").replace(/\/$/, "").replace(/\//g, "-").replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "page";
                out.push({ href: u.href, slug });
              }
              return out;
            }, REJECT_PATHS);
            const missing = navLinks.filter((l) => !(0, import_fs2.existsSync)((0, import_path3.join)(dir, `_site-${l.slug}.jpg`)));
            if (navLinks.length === 0) {
              console.log(`[capture] ${url.href} \xB7 site-sweep \xB7 no internal nav links found on homepage`);
            } else if (missing.length === 0) {
              console.log(`[capture] ${url.href} \xB7 site-sweep \xB7 all ${navLinks.length} nav pages already shot`);
            } else {
              console.log(`[capture] ${url.href} \xB7 site-sweep \xB7 ${missing.length}/${navLinks.length} nav pages missing \u2192 capturing`);
              for (const link of missing) {
                try {
                  await sweepPage.goto(link.href, { waitUntil: "domcontentloaded", timeout: 12e3 });
                  await spaSettle(sweepPage, link.href);
                  const png = await Promise.race([
                    sweepPage.screenshot({ type: "png" }),
                    new Promise((_, rej) => setTimeout(() => rej(new Error("sweep screenshot timed out")), 2e4))
                  ]);
                  (0, import_fs2.writeFileSync)((0, import_path3.join)(dir, `_site-${link.slug}.jpg`), await sharp(png).jpeg({ quality: 85 }).toBuffer());
                  console.log(`[capture] ${url.href} \xB7 site-sweep \xB7 _site-${link.slug} \u2190 ${link.href}`);
                } catch (err) {
                  console.log(`[capture] ${url.href} \xB7 site-sweep \xB7 _site-${link.slug} failed: ${err instanceof Error ? err.message : String(err)}`);
                }
              }
            }
          } catch (err) {
            console.log(`[capture] ${url.href} \xB7 site-sweep errored: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            if (sweepPage) {
              try {
                await sweepPage.close();
              } catch {
              }
            }
          }
        }
        const result = {
          ok: true,
          url: url.href,
          // Ralph 2026-06-05 — when the deep-link swap or REJECT-path branch
          // re-shot the root as main, the meta's `finalUrl` should reflect
          // what the MAIN JPEG actually contains (root), not the initial nav.
          finalUrl: mainUrlAfterFix ?? finalUrl,
          resolvedIp: guard.ip,
          fullPagePath: fullPath,
          innerPagePath: null,
          profilePagePath: profileOk ? profilePath : null,
          fullPageUrl: captureServeUrl2(fullPath),
          innerPageUrl: null,
          profilePageUrl: profileOk ? captureServeUrl2(profilePath) : null,
          pages: 1 + (profileOk ? 1 : 0),
          capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
          html: renderedHtml
        };
        const { html: _omitHtml, ...metaResult } = result;
        (0, import_fs2.writeFileSync)(metaPath, JSON.stringify({ ...metaResult, innerFinalUrl, profileFinalUrl, durationMs: Date.now() - startedAt }, null, 2));
        return result;
      })(),
      new Promise(
        (resolve) => setTimeout(() => resolve({ ok: false, url: url.href, reason: `timeout after ${TOTAL_TIMEOUT_MS}ms` }), TOTAL_TIMEOUT_MS)
      )
    ]);
    return captured;
  } catch (err) {
    return { ok: false, url: url.href, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
      }
    }
    try {
      await Promise.race([
        browser.close(),
        new Promise((res) => setTimeout(res, 3e3))
      ]);
    } catch {
    }
    try {
      const cp = browser.process();
      if (cp && !cp.killed && cp.exitCode === null) {
        cp.kill("SIGKILL");
      }
    } catch {
    }
  }
}

// scripts/capture-worker-entry.ts
async function main() {
  const arg = process.argv[2];
  if (!arg) {
    process.stderr.write("capture-worker: missing payload arg\n");
    process.exit(2);
  }
  const { rawUrl, ctx, resultPath } = JSON.parse(arg);
  const result = await captureUrl(rawUrl, ctx);
  (0, import_node_fs.writeFileSync)(resultPath, JSON.stringify(result));
}
main().catch((e) => {
  process.stderr.write("capture-worker fatal: " + (e && e.stack ? e.stack : String(e)) + "\n");
  process.exit(1);
});
