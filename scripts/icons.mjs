#!/usr/bin/env node
// Génère les icônes PNG de la PWA à partir de `icon.svg` (marque vitruvienne).
// Sortie (à la racine, committée — aucune génération au runtime) :
//   icon-192.png / icon-512.png            → purpose "any"      (coins arrondis, fond transparent)
//   maskable-192.png / maskable-512.png    → purpose "maskable" (plein cadre, marque en zone de sûreté)
//   apple-touch-icon.png (180×180)         → iOS (opaque, coins arrondis par le système)
//
// Un seul rendu Chromium headless en 512px (taille fiable), puis redimensionnement en pur Node
// (décodage/ré-encodage PNG via zlib) — aucune dépendance npm ajoutée.
// Régénérer après modification de `icon.svg` :  node scripts/icons.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { inflateSync, deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = 512; // taille de rendu fiable en headless ; les autres tailles en découlent par resampling

/* ---------- Chromium ---------- */
function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "google-chrome-stable", "google-chrome", "chromium", "chromium-browser",
  ].filter(Boolean);
  for (const c of candidates) {
    try { execFileSync(c, ["--version"], { stdio: "ignore" }); return c; } catch {}
  }
  try {
    const b = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
    for (const d of readdirSync(b)) {
      const p = join(b, d, "chrome-linux", "chrome");
      if (existsSync(p)) return p;
    }
  } catch {}
  throw new Error("Chromium introuvable : installe Chrome/Chromium ou pose $CHROME_BIN.");
}

function renderSvg512(svg, chrome, work) {
  const html = `<!doctype html><meta charset="utf-8">` +
    `<style>*{margin:0;padding:0}html,body{width:${BASE}px;height:${BASE}px}` +
    `svg{width:${BASE}px;height:${BASE}px;display:block}</style>${svg}`;
  const page = join(work, `p-${Math.random().toString(36).slice(2)}.html`);
  const out = join(work, `o-${Math.random().toString(36).slice(2)}.png`);
  writeFileSync(page, html);
  // La fenêtre headless réserve de la hauteur : on rend plus haut (BASE+256) puis on recadre
  // le carré BASE×BASE ancré en haut à gauche, où se trouve tout le SVG.
  execFileSync(chrome, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
    "--force-device-scale-factor=1", "--default-background-color=00000000",
    `--window-size=${BASE},${BASE + 256}`, `--screenshot=${out}`, "file://" + page,
  ], { stdio: "ignore" });
  return crop(decodePng(readFileSync(out)), BASE, BASE);
}

// Recadre le coin haut-gauche (tw×th) d'une image décodée.
function crop(img, tw, th) {
  const { w: sw, data: s } = img, out = new Uint8Array(tw * th * 4);
  for (let y = 0; y < th; y++) {
    Buffer.from(s.buffer, s.byteOffset + y * sw * 4, tw * 4).copy(Buffer.from(out.buffer), y * tw * 4);
  }
  return { w: tw, h: th, data: out };
}

/* ---------- PNG : décodage (RGBA 8 bits) ---------- */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("PNG invalide");
  let off = 8, w = 0, h = 0, ct = 0, bd = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bd !== 8 || ct !== 6) throw new Error(`PNG attendu 8 bits RGBA (reçu bd=${bd} ct=${ct})`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4, out = new Uint8Array(w * h * 4);
  const pa = (a, b, c) => { const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c); return da <= db && da <= dc ? a : db <= dc ? b : c; };
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const v = raw[pos++];
      const a = x >= 4 ? out[y * stride + x - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      let r;
      switch (f) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: r = v + pa(a, b, c); break;
        default: throw new Error("filtre PNG inconnu " + f);
      }
      out[y * stride + x] = r & 0xff;
    }
  }
  return { w, h, data: out };
}

/* ---------- Redimensionnement (moyenne d'aire, pour réduction) ---------- */
function resize(img, tw, th) {
  const { w: sw, h: sh, data: s } = img;
  const out = new Uint8Array(tw * th * 4);
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor(ty * sh / th), y1 = Math.max(y0 + 1, Math.floor((ty + 1) * sh / th));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor(tx * sw / tw), x1 = Math.max(x0 + 1, Math.floor((tx + 1) * sw / tw));
      let ar = 0, ag = 0, ab = 0, aa = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * sw + x) * 4, al = s[i + 3];
        // pré-multiplie par alpha pour un fondu correct des bords
        ar += s[i] * al; ag += s[i + 1] * al; ab += s[i + 2] * al; aa += al; n++;
      }
      const o = (ty * tw + tx) * 4;
      if (aa > 0) { out[o] = Math.round(ar / aa); out[o + 1] = Math.round(ag / aa); out[o + 2] = Math.round(ab / aa); }
      out[o + 3] = Math.round(aa / n);
    }
  }
  return { w: tw, h: th, data: out };
}

/* ---------- PNG : encodage ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng({ w, h, data }) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- Génération ---------- */
const svgAny = readFileSync(join(ROOT, "icon.svg"), "utf8").trim();
const svgMaskable = svgAny.replace(/rx="\d+"\s*/, ""); // même marque, fond plein cadre

const chrome = findChrome();
const work = mkdtempSync(join(tmpdir(), "fv-icons-"));
try {
  const any = renderSvg512(svgAny, chrome, work);
  const mask = renderSvg512(svgMaskable, chrome, work);
  const jobs = [
    [any,  512, "icon-512.png"],
    [any,  192, "icon-192.png"],
    [mask, 512, "maskable-512.png"],
    [mask, 192, "maskable-192.png"],
    [mask, 180, "apple-touch-icon.png"],
  ];
  for (const [src, size, name] of jobs) {
    const img = size === BASE ? src : resize(src, size, size);
    writeFileSync(join(ROOT, name), encodePng(img));
    console.log(`  ✓ ${name} (${size}×${size})`);
  }
  console.log("Icônes régénérées.");
} finally {
  rmSync(work, { recursive: true, force: true });
}
