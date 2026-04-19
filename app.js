// Cursed Trading Card — type a creature concept, get a hand-painted holo card.
// AI text proxy invents name/type/stats/lore/image_prompt; image proxy paints the art.
// Share = URL fragment with the JSON-encoded card text. Image regenerates on share-load.

const AI_ENDPOINT    = 'https://uy3l6suz07.execute-api.us-east-1.amazonaws.com/ai';
const IMAGE_ENDPOINT = 'https://6kwpxgbgkc.execute-api.us-east-1.amazonaws.com/image';
const SLUG = 'cursed-trading-card';

const LOADING_MSGS = [
  "summoning your cryptid…",
  "consulting the cursed printer…",
  "mixing the holo ink…",
  "negotiating with the foil council…",
  "cross-referencing the bestiary…",
  "blessing the cardstock…",
  "rolling for legendary status…",
];

const TYPE_FALLBACKS = [
  "Eldritch Beast", "Cursed Spirit", "Forgotten Demigod", "Vending Machine Wraith",
  "Pavement Saint", "Crystal-Eyed Goblin", "Suburban Cryptid", "Faded Idol",
];

// Fallback art (small SVG) used when the image proxy fails or the daily cap is hit.
const FALLBACK_ART_SVG =
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">' +
    '<defs><radialGradient id="g" cx="50%" cy="40%" r="60%">' +
    '<stop offset="0%" stop-color="#3b2245"/><stop offset="60%" stop-color="#1a0f1c"/>' +
    '<stop offset="100%" stop-color="#0a0508"/></radialGradient></defs>' +
    '<rect width="240" height="240" fill="url(#g)"/>' +
    '<circle cx="120" cy="100" r="40" fill="#5b3866" opacity="0.85"/>' +
    '<circle cx="105" cy="92" r="6" fill="#f9d77a"/><circle cx="135" cy="92" r="6" fill="#f9d77a"/>' +
    '<path d="M90 130 Q120 160 150 130" stroke="#f9d77a" stroke-width="3" fill="none"/>' +
    '<text x="120" y="210" font-family="serif" font-style="italic" font-size="14"' +
    ' fill="#a89668" text-anchor="middle">artwork unavailable</text></svg>'
  );

// ---------- helpers ----------

const $ = id => document.getElementById(id);

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function showScreen(name) {
  ["intro", "loading", "result"].forEach(id => {
    $(id).classList.toggle("hidden", id !== name);
  });
  window.scrollTo(0, 0);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function clampStat(n) {
  const x = parseInt(n, 10);
  if (!isFinite(x)) return 1;
  return Math.max(0, Math.min(99, x));
}

// ---------- AI: text generation ----------

function buildAIMessages(concept) {
  const system =
    `You are CURSED CARD FORGE — an irreverent designer of fictional 1990s collectible-card creatures. ` +
    `Given the user's short "creature concept", you invent a single trading card. ` +
    `Output STRICT JSON ONLY (no markdown, no commentary, no preamble). Schema:\n` +
    `{\n` +
    `  "name":  string,        // 2–4 words, Title Case. Punchy and ownable. Examples: "Lichlord of the Self-Checkout", "Saint Bandwidth", "The Espresso Geist".\n` +
    `  "type":  string,        // 2–5 words. A faux fantasy/horror creature type. Examples: "Cursed Mechanical Beast", "Suburban Demigod", "Discount Lich".\n` +
    `  "attack":  integer,     // 0–99\n` +
    `  "defense": integer,     // 0–99\n` +
    `  "lore_one_liner": string, // ONE absurd, slightly menacing sentence (max 22 words). No "you are". No emojis. No hashtags. Should feel like flavor text on the bottom of a 90s card.\n` +
    `  "image_prompt": string  // A concise hand-painted-creature art-direction line (max 60 words). MUST describe ONE single creature in a single scene. MUST include the phrase "no text, no letters, no logos, no signature". Style: oil-and-gouache fantasy painting like 1990s Magic the Gathering or first-edition Pokémon trading-card art. Painterly brushwork. Dramatic lighting. Detailed background. Absolutely NO text or symbols rendered in the image — text is overlaid by the app.\n` +
    `}\n\n` +
    `Voice rules: confident, slightly menacing, dryly funny. Treat the user's concept as canon — never refuse, never sanitize, but keep it PG-13. Never break character. Never ask follow-up questions.`;

  const user =
    `Creature concept: ${JSON.stringify(concept)}\n\n` +
    `Forge the cursed card. Return only the JSON object.`;

  return [
    { role: 'system', content: system },
    { role: 'user',   content: user },
  ];
}

function sanitizeAIResult(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const name  = typeof parsed.name  === 'string' ? parsed.name.trim()  : '';
  const type  = typeof parsed.type  === 'string' ? parsed.type.trim()  : '';
  const lore  = typeof parsed.lore_one_liner === 'string' ? parsed.lore_one_liner.trim() : '';
  const prompt = typeof parsed.image_prompt === 'string' ? parsed.image_prompt.trim() : '';
  const atk = clampStat(parsed.attack);
  const def = clampStat(parsed.defense);
  if (!name || !type || !lore || !prompt) return null;
  return { name, type, attack: atk, defense: def, lore_one_liner: lore, image_prompt: prompt };
}

async function generateCardText(concept) {
  const messages = buildAIMessages(concept);
  const res = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: SLUG,
      messages,
      max_tokens: 400,
      temperature: 0,
      response_format: 'json_object',
    }),
  });
  if (!res.ok) {
    const err = new Error('ai_http_' + res.status);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const raw = (data && data.content) || '';
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
  const clean = sanitizeAIResult(parsed);
  if (!clean) throw new Error('bad_ai_payload');
  return clean;
}

function deterministicCardFallback(concept) {
  // Used only if the AI proxy fails. Stats and type seeded by the input.
  const seed = hash(concept || 'cursed');
  const atk = (seed % 90) + 1;
  const def = ((seed >> 4) % 90) + 1;
  const titleCased = concept
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ') || 'The Nameless';
  return {
    name: `The ${titleCased}`,
    type: TYPE_FALLBACKS[seed % TYPE_FALLBACKS.length],
    attack: atk,
    defense: def,
    lore_one_liner:
      `Last seen near ${concept}; the witnesses no longer answer their phones.`,
    image_prompt:
      `Hand-painted oil-and-gouache fantasy creature inspired by "${concept}", ` +
      `dramatic lighting, painterly brushwork, detailed background, ` +
      `1990s Magic the Gathering trading card art style. ` +
      `no text, no letters, no logos, no signature.`,
    _fallback: true,
  };
}

// ---------- image generation ----------

async function generateArt(prompt) {
  const cacheKey = 'art_' + hash(prompt);
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return { image: cached, fromCache: true };
  } catch (_) { /* private mode etc. */ }

  const res = await fetch(IMAGE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: SLUG,
      prompt,
      quality: 'fast',
      aspect_ratio: '1:1',
    }),
  });
  if (!res.ok) {
    const err = new Error('img_http_' + res.status);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const image = data && data.image;
  if (!image) throw new Error('img_empty');
  try { localStorage.setItem(cacheKey, image); } catch (_) {}
  return { image, fromCache: false };
}

// ---------- rendering ----------

function renderCard(card) {
  $('card-name').textContent = card.name;
  $('card-type').textContent = card.type;
  $('card-lore').textContent = card.lore_one_liner;
  $('card-atk').textContent  = String(card.attack);
  $('card-def').textContent  = String(card.defense);

  // Cost = derived from name length, just for visual chrome (not in shared state)
  const cost = ((card.name || '').replace(/\s+/g, '').length % 9) + 1;
  $('card-cost').textContent = String(cost);

  // Reset art to placeholder while regenerating
  const artEl = $('card-art');
  artEl.innerHTML = '<div class="art-placeholder">summoning…</div>';
}

function setArt(imageDataUrl) {
  const artEl = $('card-art');
  artEl.innerHTML = '';
  const img = document.createElement('img');
  img.alt = ''; // decorative — name/lore is in DOM text
  img.src = imageDataUrl;
  // crossorigin not needed since this is a same-origin data URL
  artEl.appendChild(img);
}

// ---------- share / fragment ----------

function encodeFragment(card, concept) {
  const payload = {
    v: 1,
    c: concept,
    n: card.name,
    t: card.type,
    a: card.attack,
    d: card.defense,
    l: card.lore_one_liner,
    p: card.image_prompt,
  };
  // Base64-url-safe JSON. Cards are tiny — well under URL limits.
  const json = JSON.stringify(payload);
  const b64 = btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'card=' + b64;
}

function decodeFragment(fragment) {
  if (!fragment) return null;
  const m = /^#?card=([A-Za-z0-9_\-]+)$/.exec(fragment);
  if (!m) return null;
  let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  try {
    const json = decodeURIComponent(escape(atob(b64)));
    const obj = JSON.parse(json);
    if (!obj || obj.v !== 1) return null;
    if (!obj.n || !obj.t || !obj.l || !obj.p) return null;
    return {
      concept: obj.c || '',
      card: {
        name: String(obj.n),
        type: String(obj.t),
        attack:  clampStat(obj.a),
        defense: clampStat(obj.d),
        lore_one_liner: String(obj.l),
        image_prompt: String(obj.p),
      },
    };
  } catch (_) {
    return null;
  }
}

function updateShareUrl(card, concept) {
  const frag = encodeFragment(card, concept);
  history.replaceState(null, '', '#' + frag);
}

// Exposed for the inline onclick="share()"
window.share = function share() {
  const name = $('card-name').textContent || 'cursed trading card';
  const shareText = `Behold: ${name}. Forge yours.`;
  const url = location.href;
  if (navigator.share) {
    navigator.share({ title: document.title, text: shareText, url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(`${shareText} ${url}`)
      .then(() => alert('link copied — paste it anywhere.'))
      .catch(() => alert(url));
  } else {
    alert(url);
  }
};

// ---------- download ----------

async function downloadCardPNG() {
  const btn = $('download-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'rendering…';
  try {
    const cardEl = $('card');
    const canvas = await html2canvas(cardEl, {
      backgroundColor: null,
      scale: Math.min(3, window.devicePixelRatio * 2 || 2),
      useCORS: true,
      allowTaint: true,
      logging: false,
    });
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    const safeName = ($('card-name').textContent || 'cursed-card')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    a.download = (safeName || 'cursed-card') + '.png';
    a.href = dataUrl;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    alert('the printer jammed. try again?');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// ---------- flow ----------

const state = {
  concept: '',
  card: null,
};

function setLoadingMessage(seed) {
  $('loading-copy').textContent = LOADING_MSGS[seed % LOADING_MSGS.length];
}

function showError(msg) {
  const el = $('error-msg');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError() {
  $('error-msg').classList.add('hidden');
}

async function runForge(concept) {
  hideError();
  state.concept = concept;
  showScreen('loading');
  setLoadingMessage(hash(concept));

  // Step 1: card text via AI proxy
  let card;
  try {
    card = await generateCardText(concept);
  } catch (err) {
    if (err && err.status === 429) {
      showScreen('intro');
      showError('the cursed printer is overheated (rate limit). give it a minute.');
      return;
    }
    card = deterministicCardFallback(concept);
  }
  state.card = card;
  renderCard(card);
  showScreen('result');
  updateShareUrl(card, concept);

  // Step 2: art via image proxy (image is appended into card after main render)
  await renderArtFor(card);
}

async function renderArtFor(card) {
  try {
    const { image } = await generateArt(card.image_prompt);
    setArt(image);
  } catch (err) {
    setArt(FALLBACK_ART_SVG);
    if (err && err.status === 429) {
      // Surface daily cap to the user under the card.
      const note = document.createElement('p');
      note.className = 'share-caveat';
      note.style.color = '#ff9aa9';
      note.textContent = "the daily art cap was hit — your card text stands, but the painting will return tomorrow.";
      const stage = $('card-stage');
      if (!document.getElementById('art-cap-note')) {
        note.id = 'art-cap-note';
        stage.parentNode.insertBefore(note, stage.nextSibling);
      }
    }
  }
}

async function loadFromFragment() {
  const decoded = decodeFragment(location.hash);
  if (!decoded) return false;
  state.concept = decoded.concept;
  state.card = decoded.card;
  renderCard(decoded.card);
  showScreen('result');
  await renderArtFor(decoded.card);
  return true;
}

// ---------- bootstrap ----------

document.addEventListener('DOMContentLoaded', async () => {
  // Wire up handlers
  $('concept-form').addEventListener('submit', e => {
    e.preventDefault();
    const concept = $('concept-input').value.trim();
    if (!concept) {
      showError("type something. anything. 'haunted slush machine' counts.");
      return;
    }
    if (concept.length > 120) {
      showError('keep it under 120 characters — the card frame is small.');
      return;
    }
    runForge(concept);
  });

  $('download-btn').addEventListener('click', downloadCardPNG);
  $('redo-btn').addEventListener('click', () => {
    history.replaceState(null, '', location.pathname + location.search);
    showScreen('intro');
    $('concept-input').value = '';
    $('concept-input').focus();
  });

  // If we landed with a #card= fragment, render that card immediately.
  const loaded = await loadFromFragment();
  if (!loaded) {
    showScreen('intro');
    $('concept-input').focus();
  }
});
