// Builds PaperOS.pdf: a one-page PDF whose form fields are the screen and whose script is os.js.
// usage: node build.js   (no dependencies)
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const js = fs.readFileSync(path.join(__dirname, 'os.js'), 'latin1');
if (/[^\x00-\x7f]/.test(js)) throw new Error('os.js must be plain ASCII');
const size = /var COLS = (\d+), ROWS = (\d+)/.exec(js);
if (!size) throw new Error('os.js must declare "var COLS = n, ROWS = n"');
const COLS = +size[1], ROWS = +size[2];

// ---- layout, in points; "top" values are measured down from the top edge ----
const FONT = 11, LH = 15, PAD = 14, MENU = 28, TITLE = 40, INPUT = 34, SHADOW = 16, RADIUS = 24;
// Edge ignores fit-to-page but shrinks a page wider than its window, so the page is built larger than a screen.
const SCALE = 1.5;
const W = 1000, TILE = 44, TILE_GAP = 11, DOCK_H = 72;
const winW = Math.ceil(COLS * FONT * 0.6) + 2 * PAD, winH = TITLE + ROWS * LH + 16 + INPUT;  // Courier is 0.6 em wide
const winX = (W - winW) / 2, winY = MENU + 10, dockTop = winY + winH + 12, H = dockTop + DOCK_H + 10;
const Y = top => H - top;  // PDF y grows upward
const box = (x, top, w, h) => [x, Y(top + h), x + w, Y(top)];
const rgb = hex => hex.match(/../g).map(h => +(parseInt(h, 16) / 255).toFixed(3)).join(' ');

const K = 0.5523;  // Bezier handle length for a quarter circle
function roundRect(x, y, w, h, r, op = 'f') {  // y = bottom edge; op is the paint operator
  const c = r * K, R = x + w, T = y + h;
  return `${x + r} ${y} m ${R - r} ${y} l ${R - r + c} ${y} ${R} ${y + r - c} ${R} ${y + r} c ` +
    `${R} ${T - r} l ${R} ${T - r + c} ${R - r + c} ${T} ${R - r} ${T} c ` +
    `${x + r} ${T} l ${x + r - c} ${T} ${x} ${T - r + c} ${x} ${T - r} c ` +
    `${x} ${y + r} l ${x} ${y + r - c} ${x + r - c} ${y} ${x + r} ${y} c ${op}\n`;
}
const dot = (cx, cy, r, op = 'f') => roundRect(cx - r, cy - r, 2 * r, 2 * r, r, op);
const text = (font, pt, x, y, s) => `BT /${font} ${pt} Tf ${x} ${y} Td (${s}) Tj ET\n`;

// ---- the apps in the Dock: container colour, icon colour, glyph. Each glyph is a list of polylines on a 24-unit box, y up. ----
const APPS = [
  ['TERMINAL', 'Terminal', '2F3A34', 'E8F3EC', [[-11, 7, -3, 0, -11, -7], [1, -8, 11, -8]]],
  ['FILES', 'Files', 'D9E3FF', '1C3A73', [[-12, 8, -4, 8, -1, 4, 12, 4, 12, -9, -12, -9, -12, 8]]],
  ['NOTES', 'Notes', 'FFE3A6', '5A3E00', [[-8, 11, 8, 11, 8, -11, -8, -11, -8, 11], [-4, 5, 4, 5], [-4, 0, 4, 0], [-4, -5, 1, -5]]],
  ['CALC', 'Calculator', 'FFD7C2', '6A2A08', [[-9, 11, 9, 11, 9, -11, -9, -11, -9, 11], [-5, 6, 5, 6], [-5, 0, -3, 0], [-1, 0, 1, 0],
    [3, 0, 5, 0], [-5, -6, -3, -6], [-1, -6, 1, -6], [3, -6, 5, -6]]],
  ['PYTHON', 'Python', 'C8E9E1', '0D4A40', [[-5, 10, -11, 0, -5, -10], [5, 10, 11, 0, 5, -10], [2, 9, -2, -9]]],
  ['CLANG', 'C', 'DDD6FA', '33206E', [[-5, 11, -8, 10, -8, 3, -12, 0, -8, -3, -8, -10, -5, -11], [5, 11, 8, 10, 8, 3, 12, 0, 8, -3, 8, -10, 5, -11],
    [0, 4, 0, -4], [-3.5, 2, 3.5, -2], [-3.5, -2, 3.5, 2]]],
  ['SNAKE', 'Snake', 'CFEBC5', '1E4A16', [[-11, -8, 7, -8, 7, 0, -7, 0, -7, 8, 11, 8]]],
  ['BLOCKS', 'Blocks', 'EAD8F7', '4B2170', [[-10, 9, 10, 9, 10, 2, 3, 2, 3, -9, -3, -9, -3, 2, -10, 2, -10, 9]]],
  ['DODGE', 'Dodge', 'FFD6DE', '7A1230', [[-9, 10, -9, 7], [0, 11, 0, 8], [9, 9, 9, 6], [-4, 2, -4, -1], [5, 1, 5, -2], [-7, -10, 0, -4, 7, -10, -7, -10]]],
  ['SETTINGS', 'Settings', 'E4E2DC', '3F3D38', [[-11, 6, 11, 6], [-11, 0, 11, 0], [-11, -6, 11, -6], [5, 9, 5, 3], [-5, 3, -5, -3], [2, -3, 2, -9]]],
];
const dockW = APPS.length * (TILE + TILE_GAP) + TILE_GAP + 6, dockX = (W - dockW) / 2;
const iconX = i => dockX + 3 + TILE_GAP + i * (TILE + TILE_GAP), iconTop = dockTop + 7;

// ---- the page: soft tonal wallpaper, status bar, app bar. Each wallpaper has a light and a dark version. ----
const INK = '1D1B20', SURFACE = 'FBF8F1', TONAL = 'E9E4D9';
const NIGHT = { ink: 'F1EFE9', sub: 'D4D1C9', date: 'DCEFE5', surface: '242625', tonal: '343634', tint: '2F4B3E' };
const DAY = { ink: INK, sub: '3F3D38', date: '1F3A2D', surface: SURFACE, tonal: TONAL, tint: 'D7E8DF' };
const THEMES = [
  ['Sage', ['F5F0E8', 'CFE6DA', 'F9D8C3', 'E3DBF5', 'A9D3BF'], ['151A18', '24382F', '3D2C25', '2C2740', '335344']],
  ['Peach', ['FBEFE6', 'FFD9C2', 'F7C6CF', 'FFE9B8', 'F4B393'], ['1C1614', '43291F', '3F2630', '3F351F', '6B4030']],
  ['Lilac', ['F3F0FA', 'DDD6F7', 'CFE3F7', 'F3D9EE', 'BDB2EE'], ['17151E', '332C55', '233750', '40283C', '4A4080']],
  ['Ocean', ['EAF4F7', 'BFE3EA', 'CFDDF7', 'D3EFDF', '8FCBD6'], ['121A1D', '1E3F47', '243453', '224236', '2C5F6B']],
];
function art(theme, dark) {
  const p = THEMES[theme][dark ? 2 : 1], ui = dark ? NIGHT : DAY;
  let s = `${rgb(p[0])} rg 0 0 ${W} ${H} re f\n`;
  s += `${rgb(p[1])} rg ${W * 0.58} ${H} m ${W * 0.62} ${H * 0.72} ${W * 0.78} ${H * 0.62} ${W} ${H * 0.68} c ${W} ${H} l h f\n`;
  s += `${rgb(p[2])} rg 0 0 m 0 ${H * 0.46} l ${W * 0.16} ${H * 0.52} ${W * 0.3} ${H * 0.3} ${W * 0.42} ${H * 0.18} c ${W * 0.5} ${H * 0.08} ${W * 0.52} ${H * 0.03} ${W * 0.54} 0 c h f\n`;
  s += `${rgb(p[3])} rg ${W} 0 m ${W} ${H * 0.42} l ${W * 0.86} ${H * 0.5} ${W * 0.74} ${H * 0.26} ${W * 0.62} ${H * 0.14} c ${W * 0.56} ${H * 0.07} ${W * 0.54} ${H * 0.03} ${W * 0.52} 0 c h f\n`;
  s += `${rgb(p[4])} rg ` + dot(W * 0.87, H * 0.8, 46);
  s += `${rgb(ui.ink)} rg ` + text('F2', 11, 22, Y(19), 'PaperOS');
  for (let g = 8; g > 0; g -= 2) s += 'q /A07 gs 0 0 0 rg ' + roundRect(dockX - g, Y(dockTop + DOCK_H) - g - 1, dockW + 2 * g, DOCK_H + 2 * g, 30 + g) + 'Q\n';
  s += `${rgb(ui.surface)} rg ` + roundRect(dockX, Y(dockTop + DOCK_H), dockW, DOCK_H, 30);
  APPS.forEach(([, label, c0, c1, glyph], i) => {
    const x = iconX(i), cx = x + TILE / 2, cy = Y(iconTop + TILE / 2);
    s += `${rgb(c0)} rg ` + dot(cx, cy, TILE / 2);
    s += `q ${rgb(c1)} RG 1.7 w 1 J 1 j\n`;
    for (const l of glyph) {   // the glyph is drawn a little smaller so that it sits inside the circle
      for (let k = 0; k < l.length; k += 2) s += `${cx + l[k] * 0.8} ${cy + l[k + 1] * 0.8} ${k ? 'l' : 'm'} `;
      s += 'S\n';
    }
    s += `Q\n${rgb(ui.ink)} rg ` + text('F1', 9, cx - label.length * 2.25, Y(iconTop + TILE + 12), label);
  });
  return s.replace(/\d+\.\d{3,}/g, n => (+n).toFixed(2));
}
const page = `${SCALE} 0 0 ${SCALE} 0 0 cm\n` + art(0, false);

// ---- the app window: soft shadow, large corners, round controls on the right, tonal hint strip ----
const fw = winW + 2 * SHADOW, fh = winH + 2 * SHADOW;
function windowLook(ui) {
  let c = '';
  for (let g = SHADOW; g > 0; g -= 3)
    c += 'q /S gs 0 0 0 rg ' + roundRect(SHADOW - g, SHADOW - g - 3, winW + 2 * g, winH + 2 * g, RADIUS + g) + 'Q\n';
  c += `${rgb(ui.surface)} rg ` + roundRect(SHADOW, SHADOW, winW, winH, RADIUS);
  c += `${rgb(ui.tonal)} rg ` + roundRect(SHADOW + 8, SHADOW + 6, winW - 16, INPUT - 10, 12);
  const ctlY = SHADOW + winH - TITLE / 2, closeX = SHADOW + winW - 24, minX = closeX - 34;
  c += `${rgb(ui.tonal)} rg ` + dot(closeX, ctlY, 13) + dot(minX, ctlY, 13);
  c += `${rgb(ui.ink)} RG 1.5 w 1 J ${closeX - 4} ${ctlY - 4} m ${closeX + 4} ${ctlY + 4} l S ${closeX - 4} ${ctlY + 4} m ${closeX + 4} ${ctlY - 4} l S\n`;
  c += `${minX - 5} ${ctlY} m ${minX + 5} ${ctlY} l S\n`;
  return c.replace(/\d+\.\d{3,}/g, n => (+n).toFixed(2));
}

// ---- objects ----
const stream = (s, dict = '') => `<< ${dict} /Length ${Buffer.byteLength(s, 'latin1')} >>\nstream\n${s}\nendstream`;
const font = name => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} >>`;
const objs = [null, null, null, font('Courier-Bold'), font('Helvetica'), font('Helvetica-Bold'),
  '<< /S /JavaScript /JS 8 0 R >>', stream(js), stream(page)];
const add = body => { objs.push(body); return objs.length; };
const chromeRefs = [DAY, NIGHT].map(ui => add(stream(windowLook(ui), `/Type /XObject /Subtype /Form /BBox [0 0 ${fw} ${fh}] /Resources << /ExtGState << /S << /ca 0.018 >> >> >>`)));

const fields = [];
const widget = (type, name, rect, extra, flags = 4) => {  // flags: 4 = print, 2 = hidden until os.js shows it
  const r = rect.map(v => +(v * SCALE).toFixed(2)).join(' ');
  extra = extra.replace(/\/(Cour|Helv) ([\d.]+) Tf/g, (m, f, pt) => `/${f} ${+(pt * SCALE).toFixed(2)} Tf`);
  fields.push(`${add(`<< /Type /Annot /Subtype /Widget /FT /${type} /T (${name}) /Rect [${r}] /F ${flags} /P 3 0 R ${extra} >>`)} 0 R`);
};
const HIDDEN = 2, READONLY = 1, PUSH = 65536;
const js1 = s => `<< /S /JavaScript /JS (${s}) >>`;

// The other wallpapers lie over the page, under everything else. Viewers cannot recolour text at run time (Edge ignores
// it), so each text field that sits on the background also exists as a dark twin named with a D.
const artRes = '/Font << /F1 5 0 R /F2 6 0 R >> /ExtGState << /A07 << /ca 0.025 >> >>';
THEMES.forEach((th, t) => [0, 1].forEach(dk => {
  if (!t && !dk) return;   // the page itself is Sage, light
  const ref = add(stream(art(t, !!dk), `/Type /XObject /Subtype /Form /BBox [0 0 ${W} ${H}] /Resources << ${artRes} >>`));
  widget('Btn', `th${t}${dk}`, [0, 0, W, H], `/Ff ${PUSH + READONLY} /H /N /BS << /W 0 >> /MK << /TP 1 /I ${ref} 0 R >> /AP << /N ${ref} 0 R >>`, HIDDEN);
}));
const TWINS = [['', DAY, 4], ['D', NIGHT, HIDDEN]];
// Dock icons are push buttons with no look of their own: the page draws them, and viewers do not tint buttons.
APPS.forEach(([id, label], i) => widget('Btn', 'app_' + id, box(iconX(i) - 4, iconTop - 3, TILE + 8, TILE + 17),
  `/TU (Open ${label}) /Ff ${PUSH} /H /N /AA << /U ${js1(`openApp("${id}")`)} >>`));
TWINS.forEach(([s, ui, flag]) => {
  widget('Tx', 'mapp' + s, box(76, 6, 340, 18), `/Ff ${READONLY} /DA (/Helv 10 Tf ${rgb(ui.ink)} rg)`, flag);
  // The at-a-glance widget on the wallpaper; the tip disappears while a window is open.
  widget('Tx', 'clock' + s, box(36, 62, 220, 62), `/Ff ${READONLY} /DA (/Helv 46 Tf ${rgb(ui.date)} rg)`, flag);
  widget('Tx', 'gdate' + s, box(38, 124, 220, 22), `/Ff ${READONLY} /DA (/Helv 13 Tf ${rgb(ui.date)} rg)`, flag);
  widget('Tx', 'gtip' + s, box(38, 148, 220, 20), `/Ff ${READONLY} /V (Choose an app below) /DA (/Helv 10.5 Tf ${rgb(ui.sub)} rg)`, flag);
});

// The app window, hidden until an icon opens it.
TWINS.forEach(([s], n) => widget('Btn', 'wchrome' + s, box(winX - SHADOW, winY - SHADOW, fw, fh),
  // the look is also the button's icon (/MK /I, icon only): the viewer rebuilds the button from it when shown
  `/Ff ${PUSH + READONLY} /H /N /BS << /W 0 >> /MK << /TP 1 /I ${chromeRefs[n]} 0 R >> /AP << /N ${chromeRefs[n]} 0 R >>`, HIDDEN));
TWINS.forEach(([s, ui]) => widget('Tx', 'wbar' + s, box(winX + 16, winY + 9, 200, 22), `/Ff ${READONLY} /DA (/Helv 13 Tf ${rgb(ui.ink)} rg)`, HIDDEN));
// Mouse down (/D): Whale's viewer does not deliver mouse up to these two buttons.
widget('Btn', 'wclose', box(winX + winW - 39, winY + 5, 30, 30), `/TU (Close window) /Ff ${PUSH} /H /N /AA << /D ${js1('closeApp()')} >>`, HIDDEN);
widget('Btn', 'wmin', box(winX + winW - 73, winY + 5, 30, 30), `/TU (Minimize window) /Ff ${PUSH} /H /N /AA << /D ${js1('minimizeApp()')} >>`, HIDDEN);
// Files: the selected row's tint sits under the text, so these come before the rows.
const F_ROWS = 16, fRowTop = i => winY + TITLE + 8 + (i + 2) * LH, fRowW = winW - 2 * PAD + 8;
[['fh', DAY], ['fd', NIGHT]].forEach(([prefix, ui]) => {
  const tint = add(stream(`${rgb(ui.tint)} rg ` + roundRect(0, 0, fRowW, LH, 6), `/Type /XObject /Subtype /Form /BBox [0 0 ${fRowW} ${LH}]`));
  for (let i = 0; i < F_ROWS; i++) widget('Btn', prefix + i, box(winX + PAD - 4, fRowTop(i), fRowW, LH),
    `/Ff ${PUSH + READONLY} /H /N /BS << /W 0 >> /MK << /TP 1 /I ${tint} 0 R >> /AP << /N ${tint} 0 R >>`, HIDDEN);
});
TWINS.forEach(([s, ui]) => {
  for (let i = 0; i < ROWS; i++) widget('Tx', 'r' + s + i, box(winX + PAD - 2, winY + TITLE + 8 + i * LH, winW - 2 * PAD + 4, LH),
    `/Ff ${READONLY} /DA (/Cour ${FONT} Tf ${rgb(ui.ink)} rg)`, HIDDEN);
});
widget('Btn', 'wbody', box(winX, winY + TITLE, winW, winH - TITLE - INPUT),
  `/TU (Click to type) /Ff ${PUSH} /H /N /AA << /D ${js1('focusKeyboard()')} >>`, HIDDEN);
TWINS.forEach(([s, ui]) => widget('Tx', 'khint' + s, box(winX + 12, winY + winH - 29, winW - 24, 22),
  `/Ff ${READONLY} /V (  Click here, then type) /DA (/Helv 9.5 Tf ${rgb(ui.sub)} rg)`, HIDDEN));
// kbd takes the keys. Its text is invisible (1pt, the strip's colour) and starts as one space: os.js
// needs a character there for Backspace to register.
// Ff = multiline (4096) + no spell check (4194304). It must scroll: a full field turns every key into Enter.
TWINS.forEach(([s, ui]) => widget('Tx', 'kbd' + s, box(winX + 12, winY + winH - 29, winW - 24, 22),
  `/TU (Keyboard input) /V ( ) /Ff 4198400 /DA (/Cour 1 Tf ${rgb(ui.tonal)} rg) /AA << /K << /S /JavaScript /JS (key(event)) >> /Fo ${js1('kbdFocus(true)')} /Bl ${js1('kbdFocus(false)')} >>`, HIDDEN));
// The C editor. The numbers use the same font and box height as the code, so the viewer spaces their rows alike.
// Ff for the code = multiline + no spell check + no scroll (see os.js: a scrolled field would leave its numbers).
const GUT = 32, edTop = winY + TITLE + 8, edH = ROWS * LH;
// The editor is light because Whale always draws the text cursor black.
widget('Tx', 'cgut', box(winX + PAD - 4, edTop, GUT + 4, edH), `/Ff ${READONLY + 4096} /Q 2 /MK << /BG [${rgb(TONAL)}] >> /DA (/Cour ${FONT} Tf ${rgb('4E4B44')} rg)`, HIDDEN);
widget('Tx', 'cedit', box(winX + PAD + GUT, edTop, winW - 2 * PAD - GUT + 4, edH),
  `/TU (C code) /Ff ${4096 + 4194304 + 8388608} /MK << /BG [${rgb('FFFDF8')}] >> /DA (/Cour ${FONT} Tf ${rgb(INK)} rg) /AA << /K ${js1('cKey(event)')} /Fo ${js1('cFocus(true)')} /Bl ${js1('cFocus(false)')} >>`, HIDDEN);
// Pill buttons: the shape and label are the button's icon, as with the window above.
const cBtn = (name, label, x, top, w, h, bg, fg, act) => {
  const look = `${rgb(bg)} rg ` + roundRect(0, 0, w, h, h / 2) + `${rgb(fg)} rg ` + text('F', 10.5, (w - label.length * 5.7) / 2, (h - 7.5) / 2, label);
  const ref = add(stream(look, `/Type /XObject /Subtype /Form /BBox [0 0 ${w} ${h}] /Resources << /Font << /F 6 0 R >> >>`));
  widget('Btn', name, box(x, top, w, h), `/TU (${label}) /Ff ${act ? PUSH : PUSH + READONLY} /H /N /BS << /W 0 >> /MK << /TP 1 /I ${ref} 0 R >> /AP << /N ${ref} 0 R >>${act ? ` /AA << /D ${js1(`cAct("${act}")`)} >>` : ''}`, HIDDEN);
};
cBtn('crun', 'Run', winX + winW - 156, winY + 7, 72, 26, '1F6B4F', 'FFFFFF', 'run');
cBtn('cback', 'Edit', winX + winW - 156, winY + 7, 72, 26, 'D7E8DF', '123F2F', 'back');
for (let i = 0; i < F_ROWS; i++) widget('Btn', 'frow' + i, box(winX + PAD - 4, fRowTop(i), fRowW, LH),
  `/TU (File row ${i + 1}) /Ff ${PUSH} /H /N /AA << /D ${js1(`fClick(${i})`)} >>`, HIDDEN);
cBtn('fopen', 'Open', winX + winW - 156, winY + 7, 72, 26, '1F6B4F', 'FFFFFF', 'f:open');
cBtn('fup', 'Up', winX + winW - 214, winY + 7, 52, 26, 'D7E8DF', '123F2F', 'f:up');
const stripTop = winY + winH - 28;
cBtn('fnew', 'New File', winX + 14, stripTop, 68, 20, SURFACE, INK, 'f:file');
cBtn('fdir', 'New Folder', winX + 86, stripTop, 82, 20, SURFACE, INK, 'f:folder');
cBtn('fdel', 'Delete', winX + 172, stripTop, 58, 20, 'FFD6DE', '7A1230', 'f:del');
cBtn('cprev', 'Prev', winX + winW - 186, stripTop, 52, 20, SURFACE, INK, 'prev');
TWINS.forEach(([s, ui]) => widget('Tx', 'cpage' + s, box(winX + winW - 133, stripTop, 68, 20), `/Ff ${READONLY} /Q 1 /DA (/Helv 9.5 Tf ${rgb(ui.sub)} rg)`, HIDDEN));
cBtn('cnext', 'Next', winX + winW - 64, stripTop, 52, 20, SURFACE, INK, 'next');
// Settings: each choice is a pair of pills, plain and selected; os.js shows one of the two.
const sTop = r => winY + TITLE + 8 + r * LH + 2;
[...THEMES.map((t, i) => ['w' + i, t[0], i, 1]), ['m0', 'Light', 0, 5], ['m1', 'Dark', 1, 5], ['c0', '24-hour', 0, 9], ['c1', '12-hour', 1, 9]].forEach(([id, label, col, row]) => {
  const x = winX + 16 + col * 98;
  cBtn('s_' + id, label, x, sTop(row), 90, 26, 'E9E4D9', INK, 's:' + id);
  cBtn('s_' + id + '_on', '* ' + label, x, sTop(row), 90, 26, '1F6B4F', 'FFFFFF', 's:' + id);
});
// Save status in the top bar: words as well as colour. os.js shows at most one.
cBtn('sunsaved', 'Unsaved - Ctrl+S', W - 148, 5, 128, 20, 'FFE3A6', '5A3E00', null);
cBtn('ssaved', 'Saved', W - 84, 5, 64, 20, 'CFE6DA', '123F2F', null);
// Holds only spaces. os.js changes it after a show/hide, because that is what makes Edge repaint.
widget('Tx', 'paint', [0, 0, 2, 2], `/Ff ${READONLY} /V ( ) /DA (/Helv 1 Tf 0 0 0 rg)`);
// The file system lives in this hidden field (os.js saveDisk/loadDisk), so saving the PDF keeps it.
widget('Tx', 'disk', [0, 0, 0, 0], '/Ff 4096 /V ()', HIDDEN);

objs[0] = `<< /Type /Catalog /Pages 2 0 R /PageMode /UseNone /PageLayout /SinglePage /OpenAction [3 0 R /Fit] /Lang (en) ` +
  `/ViewerPreferences << /DisplayDocTitle true >> /Names << /JavaScript << /Names [(os) 7 0 R] >> >> ` +
  `/AcroForm << /Fields [${fields.join(' ')}] /DR << /Font << /Cour 4 0 R /Helv 5 0 R >> >> /DA (/Cour ${FONT} Tf 0 g) /NeedAppearances true >> >>`;
objs[1] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
objs[2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W * SCALE} ${H * SCALE}] /Contents 9 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> ` +
  `/ExtGState << /A07 << /ca 0.025 >> >> >> /Annots [${fields.join(' ')}] >>`;

// ---- file ----
let out = '%PDF-1.7\n';
const infoRef = add('<< /Title (PaperOS) >>');
const offsets = objs.map((body, i) => {
  const at = Buffer.byteLength(out, 'latin1');
  out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  return at;
});
const xref = Buffer.byteLength(out, 'latin1');
out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
  offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
  `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${infoRef} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const pdf = path.join(__dirname, 'PaperOS.pdf'), mark = path.join(__dirname, '.last-build');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
if (fs.existsSync(pdf) && (!fs.existsSync(mark) || fs.readFileSync(mark, 'utf8') !== sha(fs.readFileSync(pdf)))) {
  const keep = path.join(__dirname, 'PaperOS-saved-' + new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '.pdf');
  fs.copyFileSync(pdf, keep);
  console.log('PaperOS.pdf was saved by a viewer; kept it as ' + path.basename(keep));
}
fs.writeFileSync(pdf, out, 'latin1');
fs.writeFileSync(mark, sha(fs.readFileSync(pdf)));
console.log(`PaperOS.pdf written (${out.length} bytes, page ${W}x${H}pt, screen ${COLS}x${ROWS})`);
