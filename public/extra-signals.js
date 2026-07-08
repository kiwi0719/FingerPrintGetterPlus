/**
 * 全量指纹信号采集 —— 对齐 Anthropic / Cloudflare Bot Management 级别
 * 分类:
 *   [硬件] GPU / WebGPU / 音频 / 屏幕 / 传感器 / 电池 / 存储配额
 *   [系统] 字体 / 时区 / 语言 / 平台 / UA-CH 高熵 / 键盘布局
 *   [浏览器] 编解码 / EME / 语音合成 / 权限 / MIME / 插件 / 媒体设备
 *   [渲染] Canvas 2D / Canvas emoji / WebGL 参数 / 文本度量 / CSS 媒体查询
 *   [网络] WebRTC IP+SDP 编解码
 *   [反自动化] webdriver / headless / 原生函数完整性 / 时钟抖动 / 错误栈引擎
 *   [行为] 触摸/指针/键盘/鼠标能力,减少动画偏好等
 */
export async function collectExtraSignals() {
  const [gpu, webgpu, audio, fonts, webrtc, media, voices, codecs, eme, keyboard, textMetrics] =
    await Promise.all([
      getGPU(), getWebGPU(), getAudioFingerprint(), getFontHash(),
      getWebRTCInfo(), getMediaDevices(), getSpeechVoices(),
      getMediaCodecs(), getEMESupport(), getKeyboardLayout(), getTextMetrics(),
    ]);

  return {
    // ---------- 硬件层 ----------
    gpu, webgpu, audio,
    screen: {
      resolution: `${screen.width}x${screen.height}`,
      available: `${screen.availWidth}x${screen.availHeight}`,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
      dpr: window.devicePixelRatio,
      orientation: screen.orientation?.type,
      innerSize: `${innerWidth}x${innerHeight}`,
      outerSize: `${outerWidth}x${outerHeight}`,
      scrollbarWidth: getScrollbarWidth(),
    },
    hardware: {
      cores: navigator.hardwareConcurrency || 0,
      memory: navigator.deviceMemory || 0,
      touchPoints: navigator.maxTouchPoints || 0,
      platform: navigator.platform,
      userAgentData: await getUserAgentDataHighEntropy(),
    },
    battery: await getBattery(),
    storage: await getStorageQuota(),
    storageAPIs: getStorageAvailability(),
    sensors: {
      accelerometer: 'Accelerometer' in window,
      gyroscope: 'Gyroscope' in window,
      magnetometer: 'Magnetometer' in window,
      ambientLight: 'AmbientLightSensor' in window,
      linearAcceleration: 'LinearAccelerationSensor' in window,
      absoluteOrientation: 'AbsoluteOrientationSensor' in window,
    },

    // ---------- 系统层 ----------
    fonts,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffset: new Date().getTimezoneOffset(),
    locale: Intl.DateTimeFormat().resolvedOptions(),
    numberingSystem: Intl.NumberFormat().resolvedOptions().numberingSystem,
    calendar: Intl.DateTimeFormat().resolvedOptions().calendar,
    languages: navigator.languages || [],
    language: navigator.language,
    keyboard,

    // ---------- 浏览器能力 ----------
    codecs, eme, voices, media,
    plugins: [...(navigator.plugins || [])].map((p) => ({ name: p.name, filename: p.filename, description: p.description })),
    mimeTypes: [...(navigator.mimeTypes || [])].map((m) => m.type),
    pdfViewerEnabled: navigator.pdfViewerEnabled ?? null,
    cookieEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack,
    globalPrivacyControl: navigator.globalPrivacyControl ?? null,
    permissions: await probePermissions(),
    apiPresence: {
      bluetooth: 'bluetooth' in navigator,
      usb: 'usb' in navigator,
      serial: 'serial' in navigator,
      hid: 'hid' in navigator,
      gamepad: 'getGamepads' in navigator,
      xr: 'xr' in navigator,
      wakeLock: 'wakeLock' in navigator,
      share: 'share' in navigator,
      contacts: 'contacts' in navigator,
      credentials: 'credentials' in navigator,
      geolocation: 'geolocation' in navigator,
      presentation: 'presentation' in navigator,
      serviceWorker: 'serviceWorker' in navigator,
      webAuthn: 'PublicKeyCredential' in window,
      paymentRequest: 'PaymentRequest' in window,
      speechSynthesis: 'speechSynthesis' in window,
      speechRecognition: 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window,
    },

    // ---------- 渲染层 ----------
    canvas2d: getCanvas2DHash(),
    canvasEmoji: getCanvasEmojiHash(),
    textMetrics,
    cssMedia: getCSSMediaQueries(),

    // ---------- 网络 ----------
    webrtc,
    connection: getNetworkInfo(),

    // ---------- 反自动化 ----------
    webdriver: !!navigator.webdriver,
    headless: detectHeadless(),
    incognito: await detectIncognito(),
    nativeFunctionIntegrity: checkNativeIntegrity(),
    clockJitter: await measureClockJitter(),
    errorEngine: detectErrorEngine(),
    automationHooks: detectAutomationHooks(),

    // ---------- 数学/精度指纹 ----------
    math: mathFingerprint(),

    // ---------- 采集元信息 ----------
    collectorVersion: 2,
    collectTime: Date.now(),
    performanceTiming: {
      timeOrigin: performance.timeOrigin,
      now: performance.now(),
    },
  };
}

/* ============ 硬件 ============ */

function getGPU() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { supported: false };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      supported: true,
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxCubeMap: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
      maxRenderBuffer: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      maxViewport: gl.getParameter(gl.MAX_VIEWPORT_DIMS),
      maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
      maxVaryingVectors: gl.getParameter(gl.MAX_VARYING_VECTORS),
      maxFragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
      aliasedLineWidthRange: gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE),
      aliasedPointSizeRange: gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE),
      redBits: gl.getParameter(gl.RED_BITS),
      greenBits: gl.getParameter(gl.GREEN_BITS),
      blueBits: gl.getParameter(gl.BLUE_BITS),
      alphaBits: gl.getParameter(gl.ALPHA_BITS),
      depthBits: gl.getParameter(gl.DEPTH_BITS),
      stencilBits: gl.getParameter(gl.STENCIL_BITS),
      antialias: gl.getContextAttributes()?.antialias,
      extensions: gl.getSupportedExtensions(),
    };
  } catch { return { supported: false }; }
}

async function getWebGPU() {
  try {
    if (!navigator.gpu) return { supported: false };
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { supported: true, adapter: null };
    const info = adapter.info || (await adapter.requestAdapterInfo?.().catch(() => null));
    return {
      supported: true,
      isFallback: adapter.isFallbackAdapter,
      features: [...(adapter.features || [])],
      limits: adapter.limits ? Object.fromEntries(Object.entries(adapter.limits)) : null,
      info: info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null,
    };
  } catch { return { supported: false }; }
}

async function getAudioFingerprint() {
  try {
    const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 5000, 44100);
    const osc = ctx.createOscillator();
    osc.type = 'triangle'; osc.frequency.value = 10000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -50; comp.knee.value = 40; comp.ratio.value = 12;
    comp.attack.value = 0; comp.release.value = 0.25;
    osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
    const buf = await ctx.startRendering();
    const data = buf.getChannelData(0);
    let sum = 0;
    for (let i = 4500; i < 5000; i++) sum += Math.abs(data[i]);
    const AC = window.AudioContext || window.webkitAudioContext;
    let sampleRate = null, baseLatency = null, outputLatency = null;
    try {
      const ac = new AC();
      sampleRate = ac.sampleRate;
      baseLatency = ac.baseLatency;
      outputLatency = ac.outputLatency;
      ac.close();
    } catch {}
    return { fingerprint: sum.toString(), sampleRate, baseLatency, outputLatency };
  } catch { return { fingerprint: null }; }
}

/* ============ 字体 & 文本度量 ============ */

function getFontHash() {
  const test = 'mmmmmmmmmmlliWi—@';
  const size = '72px';
  const baseFonts = ['monospace', 'sans-serif', 'serif'];
  const fonts = [
    'Arial','Arial Black','Arial Narrow','Helvetica','Helvetica Neue','Times New Roman','Times',
    'Courier New','Courier','Verdana','Georgia','Palatino','Palatino Linotype','Garamond','Bookman',
    'Comic Sans MS','Trebuchet MS','Impact','Consolas','Monaco','Lucida Console','Lucida Grande',
    'Lucida Sans Unicode','Tahoma','Century Gothic','Franklin Gothic','Rockwell','Copperplate',
    // CJK
    'PingFang SC','PingFang TC','PingFang HK','Microsoft YaHei','Microsoft JhengHei','SimSun','SimHei',
    'FangSong','KaiTi','STHeiti','STSong','STFangsong','Hiragino Sans','Hiragino Kaku Gothic Pro',
    'MS Gothic','MS Mincho','Yu Gothic','Meiryo','Noto Sans CJK JP','Noto Sans CJK SC','Noto Sans CJK KR',
    'Malgun Gothic','Batang','Gulim','Dotum',
    // 现代
    'Segoe UI','Segoe UI Symbol','Segoe UI Emoji','Roboto','Roboto Mono','San Francisco','SF Pro','SF Mono',
    'Menlo','Cascadia Code','Cascadia Mono','JetBrains Mono','Fira Code','Source Code Pro','Ubuntu',
    'Ubuntu Mono','DejaVu Sans','DejaVu Sans Mono','Liberation Sans','Liberation Mono','Inconsolata',
    // Apple/移动
    'Apple Color Emoji','Noto Color Emoji','Twemoji Mozilla',
  ];
  const body = document.body;
  const span = document.createElement('span');
  span.style.cssText = `position:absolute;left:-9999px;top:-9999px;font-size:${size};line-height:normal;visibility:hidden`;
  span.textContent = test;

  const baseline = {};
  for (const f of baseFonts) {
    span.style.fontFamily = f;
    body.appendChild(span);
    baseline[f] = { w: span.offsetWidth, h: span.offsetHeight };
    body.removeChild(span);
  }
  const detected = [];
  for (const f of fonts) {
    for (const b of baseFonts) {
      span.style.fontFamily = `'${f}',${b}`;
      body.appendChild(span);
      const match = span.offsetWidth !== baseline[b].w || span.offsetHeight !== baseline[b].h;
      body.removeChild(span);
      if (match) { detected.push(f); break; }
    }
  }
  return { list: detected, hash: detected.join('|'), count: detected.length };
}

function getTextMetrics() {
  try {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = '14px Arial, sans-serif';
    const m = ctx.measureText('Fingerprint测试🔒—Wgm@0OQ');
    return {
      width: m.width,
      actualBoundingBoxAscent: m.actualBoundingBoxAscent,
      actualBoundingBoxDescent: m.actualBoundingBoxDescent,
      actualBoundingBoxLeft: m.actualBoundingBoxLeft,
      actualBoundingBoxRight: m.actualBoundingBoxRight,
      fontBoundingBoxAscent: m.fontBoundingBoxAscent,
      fontBoundingBoxDescent: m.fontBoundingBoxDescent,
      hangingBaseline: m.hangingBaseline,
      alphabeticBaseline: m.alphabeticBaseline,
      ideographicBaseline: m.ideographicBaseline,
      emHeightAscent: m.emHeightAscent,
      emHeightDescent: m.emHeightDescent,
    };
  } catch { return null; }
}

/* ============ 网络 ============ */

function getWebRTCInfo() {
  return new Promise((resolve) => {
    try {
      const ips = new Set();
      const candidates = [];
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pc.createDataChannel('');
      pc.onicecandidate = async (e) => {
        if (!e.candidate) {
          const sdp = pc.localDescription?.sdp || '';
          const codecs = [...sdp.matchAll(/a=rtpmap:\d+ ([^\s/]+)/g)].map((m) => m[1]);
          pc.close();
          resolve({ ips: [...ips], candidates, codecs: [...new Set(codecs)] });
          return;
        }
        candidates.push(e.candidate.candidate);
        const m = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+|[a-f0-9:]+:[a-f0-9:]+)/i);
        if (m) ips.add(m[1]);
      };
      pc.createOffer().then((o) => pc.setLocalDescription(o));
      setTimeout(() => { try { pc.close(); } catch {} resolve({ ips: [...ips], candidates, codecs: [] }); }, 1500);
    } catch { resolve({ ips: [], candidates: [], codecs: [] }); }
  });
}

function getNetworkInfo() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return null;
  return {
    effectiveType: c.effectiveType,
    downlink: c.downlink,
    downlinkMax: c.downlinkMax,
    rtt: c.rtt,
    saveData: c.saveData,
    type: c.type,
  };
}

async function getMediaDevices() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    const counts = { audioinput: 0, videoinput: 0, audiooutput: 0 };
    const kinds = [];
    for (const d of list) {
      counts[d.kind] = (counts[d.kind] || 0) + 1;
      kinds.push({ kind: d.kind, hasLabel: !!d.label });
    }
    return { counts, kinds, total: list.length };
  } catch { return null; }
}

/* ============ 编解码 / EME ============ */

function getMediaCodecs() {
  const video = document.createElement('video');
  const audio = document.createElement('audio');
  const videoTests = [
    'video/mp4; codecs="avc1.42E01E"',        // H.264 baseline
    'video/mp4; codecs="avc1.640028"',        // H.264 high
    'video/mp4; codecs="hev1.1.6.L93.B0"',    // HEVC/H.265
    'video/mp4; codecs="av01.0.05M.08"',      // AV1
    'video/webm; codecs="vp8"',
    'video/webm; codecs="vp9"',
    'video/ogg; codecs="theora"',
  ];
  const audioTests = [
    'audio/mp4; codecs="mp4a.40.2"',          // AAC-LC
    'audio/mp4; codecs="mp4a.40.5"',          // HE-AAC
    'audio/mp4; codecs="ac-3"',               // Dolby AC-3
    'audio/mp4; codecs="ec-3"',               // Dolby E-AC-3
    'audio/mpeg',                              // MP3
    'audio/webm; codecs="opus"',
    'audio/webm; codecs="vorbis"',
    'audio/ogg; codecs="opus"',
    'audio/flac',
    'audio/wav; codecs="1"',
  ];
  const out = { video: {}, audio: {} };
  for (const t of videoTests) out.video[t] = video.canPlayType(t) || '';
  for (const t of audioTests) out.audio[t] = audio.canPlayType(t) || '';
  return out;
}

async function getEMESupport() {
  const systems = [
    'com.widevine.alpha',           // Widevine (Chrome/Firefox/Android)
    'com.microsoft.playready',      // PlayReady (Edge/Windows)
    'com.apple.fps.1_0',            // FairPlay (Safari)
    'com.apple.fps.2_0',
    'org.w3.clearkey',              // ClearKey (基础)
  ];
  const out = {};
  for (const s of systems) {
    try {
      const cfg = [{
        initDataTypes: ['cenc'],
        videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }],
        audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
      }];
      const access = await navigator.requestMediaKeySystemAccess(s, cfg);
      out[s] = { supported: true, robustness: access.getConfiguration?.() };
    } catch { out[s] = { supported: false }; }
  }
  return out;
}

function getSpeechVoices() {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve([]);
    const grab = () => {
      const v = speechSynthesis.getVoices();
      resolve(v.map((x) => ({ name: x.name, lang: x.lang, localService: x.localService, default: x.default })));
    };
    const initial = speechSynthesis.getVoices();
    if (initial.length) return resolve(initial.map((x) => ({ name: x.name, lang: x.lang, localService: x.localService, default: x.default })));
    speechSynthesis.onvoiceschanged = grab;
    setTimeout(grab, 500);
  });
}

/* ============ Canvas ============ */

function getCanvas2DHash() {
  try {
    const c = document.createElement('canvas');
    c.width = 280; c.height = 60;
    const ctx = c.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60'; ctx.fillRect(100, 1, 62, 20);
    ctx.fillStyle = '#069'; ctx.fillText('Fingerprint 🔒 Cmwm', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)'; ctx.fillText('Fingerprint 🔒 Cmwm', 4, 17);
    // 曲线,考验抗锯齿差异
    ctx.beginPath(); ctx.arc(50, 50, 50, 0, Math.PI * 2, true);
    ctx.closePath(); ctx.fillStyle = 'rgb(255,0,255)'; ctx.fill();
    return c.toDataURL().slice(-96);
  } catch { return null; }
}

function getCanvasEmojiHash() {
  try {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 40;
    const ctx = c.getContext('2d');
    ctx.font = '20px sans-serif';
    ctx.fillText('😀🌍🚀👨‍👩‍👧‍👦🏳️‍🌈', 0, 25);
    return c.toDataURL().slice(-96);
  } catch { return null; }
}

/* ============ CSS 媒体查询(prefers-*、色域等) ============ */

function getCSSMediaQueries() {
  const q = (s) => window.matchMedia(s).matches;
  return {
    colorScheme: q('(prefers-color-scheme: dark)') ? 'dark' : q('(prefers-color-scheme: light)') ? 'light' : 'no-preference',
    reducedMotion: q('(prefers-reduced-motion: reduce)'),
    reducedTransparency: q('(prefers-reduced-transparency: reduce)'),
    reducedData: q('(prefers-reduced-data: reduce)'),
    contrast: q('(prefers-contrast: more)') ? 'more' : q('(prefers-contrast: less)') ? 'less' : 'no-preference',
    forcedColors: q('(forced-colors: active)'),
    colorGamut: q('(color-gamut: rec2020)') ? 'rec2020' : q('(color-gamut: p3)') ? 'p3' : q('(color-gamut: srgb)') ? 'srgb' : 'none',
    dynamicRange: q('(dynamic-range: high)') ? 'high' : 'standard',
    hover: q('(hover: hover)') ? 'hover' : 'none',
    anyHover: q('(any-hover: hover)') ? 'hover' : 'none',
    pointer: q('(pointer: fine)') ? 'fine' : q('(pointer: coarse)') ? 'coarse' : 'none',
    anyPointer: q('(any-pointer: fine)') ? 'fine' : q('(any-pointer: coarse)') ? 'coarse' : 'none',
    invertedColors: q('(inverted-colors: inverted)'),
    displayMode: q('(display-mode: standalone)') ? 'standalone' : q('(display-mode: fullscreen)') ? 'fullscreen' : 'browser',
    monochrome: q('(monochrome)'),
    orientation: q('(orientation: portrait)') ? 'portrait' : 'landscape',
  };
}

/* ============ 键盘布局(高熵,跨浏览器稳定) ============ */

async function getKeyboardLayout() {
  try {
    if (!navigator.keyboard?.getLayoutMap) return null;
    const map = await navigator.keyboard.getLayoutMap();
    const out = {};
    for (const [code, key] of map) out[code] = key;
    return out;
  } catch { return null; }
}

/* ============ UA-CH 高熵 ============ */

async function getUserAgentDataHighEntropy() {
  try {
    if (!navigator.userAgentData) return null;
    const hi = await navigator.userAgentData.getHighEntropyValues([
      'architecture','bitness','model','platform','platformVersion','uaFullVersion','fullVersionList','wow64','formFactor',
    ]);
    return hi;
  } catch { return null; }
}

/* ============ 存储 ============ */

async function getStorageQuota() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}

function getStorageAvailability() {
  const test = (fn) => { try { return !!fn(); } catch { return false; } };
  return {
    localStorage: test(() => (localStorage.setItem('_t','1'), localStorage.removeItem('_t'), true)),
    sessionStorage: test(() => (sessionStorage.setItem('_t','1'), sessionStorage.removeItem('_t'), true)),
    indexedDB: 'indexedDB' in window,
    caches: 'caches' in window,
    openDatabase: 'openDatabase' in window, // WebSQL(旧,Safari 有)
  };
}

/* ============ 隐身/电池 ============ */

async function detectIncognito() {
  try { return (await navigator.storage.estimate()).quota < 120 * 1024 * 1024; }
  catch { return false; }
}

async function getBattery() {
  try {
    if (!navigator.getBattery) return null;
    const b = await navigator.getBattery();
    return { level: b.level, charging: b.charging, chargingTime: b.chargingTime, dischargingTime: b.dischargingTime };
  } catch { return null; }
}

/* ============ 权限探测 ============ */

async function probePermissions() {
  const out = {};
  const names = ['geolocation','notifications','camera','microphone','clipboard-read','clipboard-write',
    'persistent-storage','background-sync','midi','payment-handler','accelerometer','gyroscope',
    'magnetometer','ambient-light-sensor','screen-wake-lock','local-fonts'];
  await Promise.all(names.map(async (n) => {
    try { out[n] = (await navigator.permissions.query({ name: n })).state; }
    catch { out[n] = 'unsupported'; }
  }));
  return out;
}

/* ============ 反自动化 ============ */

function detectHeadless() {
  const ua = navigator.userAgent || '';
  return {
    userAgentHasHeadless: /headless/i.test(ua),
    webdriver: !!navigator.webdriver,
    languages0: (navigator.languages || []).length === 0,
    pluginsEmptyOnChrome: /chrome/i.test(ua) && (navigator.plugins || []).length === 0,
    // Chrome DevTools Protocol / Puppeteer 常见泄露
    permissionsNotify: (() => {
      try {
        const p = navigator.permissions;
        return !!p; // 只要在,再由具体 query 判断
      } catch { return null; }
    })(),
    outerDimensionsZero: outerWidth === 0 || outerHeight === 0,
  };
}

function checkNativeIntegrity() {
  // 原生函数的 toString 应包含 "[native code]",被 monkey-patch 后会露馅
  const check = (fn) => {
    try { return typeof fn === 'function' && /\[native code\]/.test(Function.prototype.toString.call(fn)); }
    catch { return false; }
  };
  return {
    fetch: check(window.fetch),
    XMLHttpRequest: check(window.XMLHttpRequest),
    setTimeout: check(window.setTimeout),
    Promise: check(window.Promise),
    Function: check(Function.prototype.bind),
    canvasGetContext: check(HTMLCanvasElement.prototype.getContext),
    canvasToDataURL: check(HTMLCanvasElement.prototype.toDataURL),
    dateNow: check(Date.now),
    performanceNow: check(performance.now),
    navigatorPermissions: check(navigator.permissions?.query?.bind?.(navigator.permissions)),
  };
}

/** 时钟抖动:performance.now 的最小步进 —— 硬件计时器精度、Spectre 缓解都会影响 */
async function measureClockJitter() {
  const N = 200;
  const diffs = [];
  let prev = performance.now();
  for (let i = 0; i < N; i++) {
    let cur = performance.now();
    while (cur === prev) cur = performance.now();
    diffs.push(cur - prev);
    prev = cur;
  }
  diffs.sort((a, b) => a - b);
  return {
    min: diffs[0],
    median: diffs[N / 2 | 0],
    max: diffs[N - 1],
    sample: diffs.slice(0, 5),
  };
}

function detectErrorEngine() {
  try {
    const e = new Error('probe');
    const stack = e.stack || '';
    return {
      hasStack: !!e.stack,
      // V8: "Error\n    at ..."; SpiderMonkey: "@..."; JavaScriptCore: "..."
      engine: /^Error/.test(stack) ? 'v8' : /@/.test(stack) ? 'spidermonkey' : 'jsc-or-other',
      stackHead: stack.split('\n').slice(0, 2).join('\n').slice(0, 200),
    };
  } catch { return null; }
}

function detectAutomationHooks() {
  const props = [
    '__webdriver_evaluate','__selenium_evaluate','__webdriver_script_function',
    '__webdriver_script_func','__webdriver_script_fn','__fxdriver_evaluate',
    '__driver_unwrapped','__webdriver_unwrapped','__driver_evaluate','__selenium_unwrapped',
    '__nightmare','_phantom','callPhantom','callSelenium',
    '_selenium','domAutomation','domAutomationController',
  ];
  const hits = props.filter((p) => p in window || p in document);
  return {
    windowChrome: !!window.chrome,
    hits,
    outerZero: outerWidth === 0,
    // Puppeteer 特征
    cdc: Object.keys(window).some((k) => /^cdc_[a-zA-Z0-9]+_(?:Array|Promise|Symbol)$/.test(k)),
  };
}

/* ============ 数学 ============ */

function mathFingerprint() {
  return {
    acos: Math.acos(0.123456789),
    asinh: Math.asinh(1e300),
    atanh: Math.atanh(0.5),
    tanh: Math.tanh(-1e300),
    expm1: Math.expm1(1),
    sinh: Math.sinh(1),
    cosh: Math.cosh(10),
    log1p: Math.log1p(10),
    // 浮点边界 & Firefox/Chrome/Safari 精度差异
    e: Math.exp(1),
    pi: Math.PI,
    epsilon: Number.EPSILON,
  };
}

/* ============ 杂项 ============ */

function getScrollbarWidth() {
  try {
    const o = document.createElement('div');
    o.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll';
    document.body.appendChild(o);
    const w = o.offsetWidth - o.clientWidth;
    document.body.removeChild(o);
    return w;
  } catch { return null; }
}
