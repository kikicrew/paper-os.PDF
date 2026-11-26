// PaperOS: a tiny terminal OS that runs inside a PDF viewer (Acrobat JavaScript API).
// build.js embeds this file into the PDF; test.js runs it under Node. Keep it ASCII and ES5.
var COLS = 64, ROWS = 20;

// ---- screen: one read-only text field per row. Keys arrive through key() from kbd, the invisible
// field over the screen ----
var rows = [], shown = [];
for (var i = 0; i < ROWS; i++) rows.push(this.getField("r" + i));

var lines = [];   // scrollback
var input = "";   // line being typed
var mode = null;  // the program that has the keyboard: { prompt, line(text) } or { key(ch), draw(), tick() }; null = shell

function print(s) {
  s = String(s).split("\n");
  for (var i = 0; i < s.length; i++) {
    var t = s[i];
    do { lines.push(t.slice(0, COLS)); t = t.slice(COLS); } while (t);
  }
  if (lines.length > 200) lines = lines.slice(-200);
}

function render() {
  var out = mode && mode.draw ? mode.draw()
    : lines.concat([(promptText() + input + "_").slice(-COLS)]).slice(-ROWS);
  for (var i = 0; i < ROWS; i++) {
    var t = out[i] || "";
    if (t !== shown[i]) { rows[i].value = t; shown[i] = t; }
  }
}

// ---- keyboard ----
function key(e) {
  if (e.willCommit) return;  // the field losing focus, not a key press
  var ch = e.change.replace(/\r\n?/g, "\n");
  // shortcut: Backspace only reaches us while the caret sits after a hidden character in the field, so a
  // character typed at caret 0 is let into the field; upgrade when viewers expose real key events.
  e.rc = e.selStart === 0 && e.selEnd === 0 && ch.length === 1 && ch >= " ";
  if (mode && mode.key && !(mode.typing && mode.typing()) && ch) {  // a game or real-time program
    var hangul = /[\u3131-\u3163\uAC00-\uD7A3]/.test(ch);
    if (hangul) ch = ch.replace(/[\u3131-\u3163\uAC00-\uD7A3]/g, hangulKeys);
    else if (!/[A-Za-z]/.test(ch)) hangul = hintKorean;  // space and digits say nothing about the mode
    keyHint(hangul);
    if (mode.digits) ch = ch.replace(/[8456]/g, function (d) { return { 8: "w", 4: "a", 5: "s", 6: "d" }[d]; });
  }
  // An empty change over a selection is Backspace. With no selection it is Enter in Chromium's
  // viewer (Whale, Chrome), which reports a line break that way; Adobe's sends "\n" instead.
  if (ch === "") onKey(e.selStart < e.selEnd ? "\b" : "\n");
  for (var i = 0; i < ch.length; i++) onKey(ch.charAt(i));
  if (!mode) runBatch();
  render();
}

// In Korean input mode W A S D arrive as Hangul. These turn it back into the keys pressed (2-set layout).
var JAMO_KEYS = ("r R rt s sw sg e E f fr fa fq ft fx fv fg a q Q qt t T d w W c z x v g " +  // U+3131..314E
  "k o i O j p u P h hk ho hl y n nj np nl b m ml l").split(" ");                             // U+314F..3163
var FIRST_KEYS = "r R s e E f a q Q t T d w W c z x v g".split(" ");
var VOWEL_KEYS = JAMO_KEYS.slice(30);
var LAST_KEYS = ". r R rt s sw sg e f fr fa fq ft fx fv fg a q qt t T d w c z x v g".split(" ");
function hangulKeys(c) {
  var n = c.charCodeAt(0);
  if (n < 0xAC00) return JAMO_KEYS[n - 0x3131];
  n -= 0xAC00;
  return FIRST_KEYS[Math.floor(n / 588)] + VOWEL_KEYS[Math.floor(n % 588 / 28)] + (n % 28 ? LAST_KEYS[n % 28] : "");
}

// The input method holds a Hangul key until the next one, so games lag a key: tell the user to switch.
var hintKorean = false, kbdFocused = false;
function keyHint(korean) {
  if (korean === hintKorean) return;
  hintKorean = korean;
  showHint();
}
function kbdFocus(on) {  // the keyboard field's focus and blur actions
  kbdFocused = on;
  showHint();
}
// The strip under the window says what to do now, and whether typing will reach the app.
function showHint() {
  var a = APPS[currentApp];
  if (!a) return;
  if (fState) { ui("khint").value = ""; return; }  // the strip holds the Files buttons
  if (cEd) {
    ui("khint").value = "  " + (!cEd.editing ? "Any key or Edit goes back to the code." :
      cEd.full ? "This page is full. Next adds room." : cEd.where || a.hint);
    return;
  }
  ui("khint").value = "  " + (kbdFocused ? "" : "Click here to type.  ") +
    (hintKorean ? "Korean input lags: use 8 4 5 6, or press the Han/Eng key" : a.hint);
}

function onKey(c) {
  if (mode && mode.key) mode.key(c);
  else if (c === "`" && batch.length) { batch = []; print("^C"); }  // break key
  else if (c === "\b") input = input.slice(0, -1);
  else if (c === "\n" || c === "\r") {
    var s = input;
    input = "";
    print(promptText() + s);
    if (mode) mode.line(s); else shell(s);
  } else if (c >= " " && c <= "~") input += c;  // the screen font only has ASCII
}


function tick() {
  if (mode && mode.tick) mode.tick();
  render();
}

// ---- memory file system: a directory is a prototype-less object, a file is a string ----
// Names are stored upper case, so lookups are case-insensitive like DOS.
function dir() { return Object.create(null); }
function isDir(n) { return typeof n === "object"; }

var root = dir(), cwd = [];
root["README.TXT"] = "PaperOS runs inside this PDF.\nYour files are stored in the PDF itself: save the PDF (Ctrl+S) to keep them.";

function resolve(p) {  // "C:\A\..\B" or "a/b" -> absolute list of upper-case names
  p = p.replace(/^[A-Za-z]:/, "");
  var segs = /^[\\/]/.test(p) ? [] : cwd.slice(), parts = p.split(/[\\/]/);
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === "..") segs.pop();
    else if (parts[i] && parts[i] !== ".") segs.push(parts[i].toUpperCase());
  }
  return segs;
}

function lookup(segs) {
  var n = root;
  for (var i = 0; i < segs.length && n !== undefined; i++) n = isDir(n) ? n[segs[i]] : undefined;
  return n;
}

function pathText(segs) { return "C:\\" + segs.join("\\"); }

// Returns an error message, or undefined on success.
function write(p, text, append) {
  var segs = resolve(p), name = segs.pop(), d = lookup(segs);
  if (!name || !isDir(d)) return "Path not found - " + p;
  if (isDir(d[name])) return "Access denied - " + p + " is a directory";
  d[name] = (append && d[name] ? d[name] + "\n" : "") + text;
}

function makeDir(a) {
  var segs = resolve(a[0] || ""), name = segs.pop(), d = lookup(segs);
  if (!name || !isDir(d)) return "Path not found - " + (a[0] || "");
  if (d[name] !== undefined) return "A file or directory " + a[0] + " already exists";
  d[name] = dir();
}

function removeDir(a) {
  var segs = resolve(a[0] || ""), name = segs.pop(), d = lookup(segs);
  if (!name || !isDir(d) || !isDir(d[name])) return "Invalid directory - " + (a[0] || "");
  for (var k in d[name]) return "Directory not empty - " + a[0];
  delete d[name];
  if (!isDir(lookup(cwd))) cwd = [];
}

function padRight(s, n) { while (s.length < n) s += " "; return s; }
function two(n) { return (n < 10 ? "0" : "") + n; }

// ---- shell: command names are case-insensitive ----
var env = dir();  // SET variables, used as %NAME%
var batch = [];   // running batch files, innermost last: { lines, pc, args }

// A file's text, or piped-in text when no file is named; undefined when there is neither.
function textOf(file, stdin) {
  if (file === undefined) return stdin;
  var t = lookup(resolve(file));
  return typeof t === "string" ? t : undefined;
}

// The text of program "name", trying it as typed and then with the extension added.
function findProgram(name, ext) {
  if (!name) return undefined;
  var t = name.toUpperCase().slice(-ext.length) === ext ? lookup(resolve(name)) : lookup(resolve(name + ext));
  return typeof t === "string" ? t : undefined;
}

// A program not found in this folder is looked up in C:\DEMO, like a one-entry PATH.
function onPath(name) {
  var exts = [".BAT", ".BAS", ".PY", ".C"];
  if (!name || /[\\\/:]/.test(name)) return name;
  for (var i = 0; i < exts.length; i++) if (findProgram(name, exts[i]) !== undefined) return name;
  return "\\DEMO\\" + name;
}

var HELP_TOPICS = {
  C: "C (or the C icon) opens the editor: arrows, mouse, copy, paste.\n" +
    "Run runs MAIN.C. Prev and Next turn pages of code.\n" +
    "Or: EDIT X.C, type the code, . saves, then CC X.C runs it.\n" +
    "Has: pointers, arrays, strings, struct, union, enum, typedef,\n" +
    "  function pointers, recursion, #define, malloc/free, scanf,\n" +
    "  printf, fopen, string.h, math.h, ctype.h, qsort\n" +
    "int and pointers are 4 bytes. Bad pointers stop with a line number.\n" +
    "No float bit tricks, threads, or other libraries. ` stops a program.\n" +
    "Samples: POINTER  LINKED  (read with TYPE \\DEMO\\POINTER.C)",
  PYTHON: "PYTHON opens the >>> prompt. A line ending in : starts a block,\n" +
    "and an empty line runs it. exit() leaves.\n" +
    "Programs: EDIT X.PY, type the code, . saves, then X runs it.\n" +
    "Has: def (default and keyword args), if, for, while, try/except,\n" +
    "  lists, dicts, f-strings, [x for x in y if z], open(), input()\n" +
    "Modules: math random time paper\n" +
    "  paper.key()  next key or \"\"     paper.cls()  clear screen\n" +
    "  paper.locate(row, col)  move the cursor\n" +
    "No classes, lambda, finally or raise.",
  BASIC: "BASIC opens the ] prompt. Type numbered lines, then RUN.\n" +
    "Prompt: LIST NEW SAVE file LOAD file SYSTEM\n" +
    "Has: PRINT INPUT IF THEN ELSE FOR NEXT GOTO GOSUB RETURN DIM\n" +
    "System: CLS LOCATE INKEY$ TIMER SLEEP SHELL\n" +
    "Files: OPEN f FOR INPUT/OUTPUT/APPEND AS #1, PRINT #1, INPUT #1",
  BATCH: "A .BAT file is a list of commands. EDIT T.BAT, then T.\n" +
    "Has: %1-%9 %NAME% REM :label GOTO CALL PAUSE\n" +
    "  IF [NOT] EXIST file command    IF [NOT] a==b command",
  DEMO: "Run these from any folder:\n" +
    "  DODGE  real-time game in Python    WALK   move with W A S D\n" +
    "  GUESS  guess the number            MOVE   the same in BASIC\n" +
    "  FIZZ  WORDS  NOTES  HELLO  INFO    START ALARM (background)\n" +
    "Read one with TYPE \\DEMO\\DODGE.PY",
  SAVE: "Your files live inside this PDF. Save the PDF (Ctrl+S) to keep\n" +
    "them; they come back when you open it again.\n" +
    "The top bar shows Unsaved until the PDF has been saved."
};

var cmds = {
  HELP: function (a) {
    var topic = (a[0] || "").toUpperCase();
    if (topic && !HELP_TOPICS.hasOwnProperty(topic)) return "No help on " + a[0] + ". Topics: C PYTHON BASIC BATCH DEMO SAVE";
    if (topic) return HELP_TOPICS[topic];
    return "Files:  DIR CD TYPE COPY DEL MD RD\n" +
      "System: CLS ECHO VER TIME DATE SET TASKS KILL\n" +
      "Pipes:  SORT FIND    DIR | FIND TXT    DIR | SORT > LIST.TXT\n" +
      "Apps:   FILES SETTINGS EDIT CALC SNAKE BLOCKS\n" +
      "Code:   BASIC  PYTHON  C  CC file.C  RUN file  START file\n" +
      "Batch:  name.BAT runs its commands (IF GOTO CALL PAUSE %1)\n" +
      "More:   HELP C, PYTHON, BASIC, BATCH, DEMO or SAVE\n" +
      "The ` key stops a running program.";
  },
  VER: function () { return "PaperOS [Version 2.0] - DOS style shell"; },
  TIME: function () {
    var d = new Date();
    return "The current time is: " + two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
  },
  DATE: function () {
    var d = new Date();
    return "The current date is: " + ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " +
      d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate());
  },
  DIR: function (a) {
    var segs = resolve(a[0] || "."), n = lookup(segs);
    if (n === undefined) return "File Not Found";
    if (!isDir(n)) return padRight(segs[segs.length - 1], 14) + n.length + " bytes";
    var out = [" Directory of " + pathText(segs), ""], files = 0, dirs = 0, names = [];
    for (var k in n) names.push(k);
    names.sort();
    for (var i = 0; i < names.length; i++) {
      if (isDir(n[names[i]])) { dirs++; out.push(padRight(names[i], 14) + "<DIR>"); }
      else { files++; out.push(padRight(names[i], 14) + n[names[i]].length + " bytes"); }
    }
    out.push("       " + files + " File(s)   " + dirs + " Dir(s)");
    return out.join("\n");
  },
  CD: function (a) {
    if (!a[0]) return pathText(cwd);
    var segs = resolve(a[0]);
    if (!isDir(lookup(segs))) return "The system cannot find the path specified.";
    cwd = segs;
  },
  TYPE: function (a) {
    var n = lookup(resolve(a[0] || ""));
    return typeof n === "string" ? n : "The system cannot find the file specified.";
  },
  COPY: function (a) {
    var src = resolve(a[0] || ""), text = lookup(src);
    if (typeof text !== "string" || !a[1]) return "The system cannot find the file specified.";
    var dst = isDir(lookup(resolve(a[1]))) ? a[1] + "\\" + src[src.length - 1] : a[1];
    return write(dst, text) || "        1 file(s) copied.";
  },
  DEL: function (a) {
    var segs = resolve(a[0] || ""), name = segs.pop(), d = lookup(segs);
    if (!name || !isDir(d) || d[name] === undefined) return "Could Not Find " + pathText(segs.concat(name || ""));
    if (isDir(d[name])) return "Access denied - use RD to remove a directory";
    delete d[name];
  },
  MD: makeDir, MKDIR: makeDir,
  RD: removeDir, RMDIR: removeDir,
  CLS: function () { lines = []; },
  ECHO: function (a, rest) { return /^(ON|OFF)$/i.test(rest) ? undefined : rest; },
  SET: function (a, rest) {
    var i = rest.indexOf("="), out = [], k;
    if (i < 0) {
      for (k in env) out.push(k + "=" + env[k]);
      return out.sort().join("\n");
    }
    k = rest.slice(0, i).replace(/\s+$/, "").toUpperCase();
    if (!/^\w+$/.test(k)) return "Syntax: SET NAME=VALUE";
    if (rest.slice(i + 1)) env[k] = rest.slice(i + 1); else delete env[k];
  },
  SORT: function (a, rest, stdin) {
    var rev = (a[0] || "").toUpperCase() === "/R";
    if (rev) a.shift();
    var t = textOf(a[0], stdin);
    if (t === undefined) return "SORT needs input:  DIR | SORT   or   SORT file";
    t = t.split("\n").sort();
    return (rev ? t.reverse() : t).join("\n");
  },
  FIND: function (a, rest, stdin) {
    var word = (a[0] || "").replace(/"/g, "").toUpperCase(), t = textOf(a[1], stdin), out = [];
    if (!word || t === undefined) return "FIND needs input:  DIR | FIND TXT   or   FIND text file";
    t = t.split("\n");
    for (var i = 0; i < t.length; i++) if (t[i].toUpperCase().indexOf(word) >= 0) out.push(t[i]);
    return out.join("\n");
  },

  // ---- batch file commands ----
  REM: function () {},
  CALL: function (a, rest) { shell(rest); },
  GOTO: function (a) {
    var f = batch[batch.length - 1], label = ":" + (a[0] || "").toUpperCase();
    if (!f) return "GOTO only works inside a batch file";
    for (var i = 0; i < f.lines.length; i++)
      if (f.lines[i].replace(/^\s+|\s+$/g, "").toUpperCase() === label) { f.pc = i; return; }
    batch.pop();
    return "Label not found - " + a[0];
  },
  IF: function (a, rest) {
    var m = /^(NOT\s+)?(?:EXIST\s+(\S+)|(\S+?)==(\S+))\s+(.+)$/i.exec(rest);
    if (!m) return "Syntax: IF [NOT] EXIST file command   or   IF [NOT] a==b command";
    var ok = m[2] ? lookup(resolve(m[2])) !== undefined : m[3].toUpperCase() === m[4].toUpperCase();
    if (ok !== !!m[1]) shell(m[5]);
  },
  PAUSE: function () {
    mode = { prompt: "Press any key to continue . . . ", key: function () { print(mode.prompt); mode = null; } };
  },

  // ---- programs ----
  EDIT: function (a) {
    if (!a[0]) return "Usage: EDIT <file>";
    var old = lookup(resolve(a[0]));
    if (isDir(old)) return "Access denied - " + a[0] + " is a directory";
    var buf = old ? old.split("\n") : [];
    print("-- " + a[0].toUpperCase() + ": '.' saves, ':q' cancels --");
    if (buf.length) print(buf.join("\n"));
    mode = { prompt: "> ", line: function (t) {
      if (t === ":q") mode = null;
      else if (t === ".") { mode = null; print(write(a[0], buf.join("\n")) || "Saved " + a[0].toUpperCase()); }
      else buf.push(t);
    }, changed: function () { return buf.join("\n") !== (old || ""); },
    autosave: function (typing) {  // the window is closing or switching: keep what was written
      if (typing) buf.push(typing);
      if (buf.join("\n") === (old || "")) mode = null; else this.line(".");
    } };
  },
  CALC: function (a, rest) {
    if (rest) return calc(rest);
    print("Calculator: type an expression, Q quits");
    mode = { prompt: "CALC> ", line: function (t) {
      if (t.toUpperCase() === "Q") mode = null; else if (t) print(calc(t));
    } };
  },
  SNAKE: function () { snake(); },
  BLOCKS: function () { blocks(); },
  BASIC: function () { basicPrompt(); },
  PYTHON: function () { pythonPrompt(); },
  PY: function () { pythonPrompt(); },
  RUN: function (a) { return launch(a[0], true, a.slice(1)); },
  START: function (a) { return launch(a[0], false, a.slice(1)); },
  SETTINGS: function () { if (currentApp !== "SETTINGS") openApp("SETTINGS"); else if (!sOpen) settingsApp(); },
  FILES: function () { if (currentApp !== "FILES") openApp("FILES"); else if (!fState) filesApp(); },
  C: function () { if (currentApp !== "CLANG") openApp("CLANG"); else if (!cEd) cWorkspace(); },
  CC: function (a) {
    if (!a[0]) return "Usage: CC file.C   (HELP C explains)";
    var t = findProgram(onPath(a[0]), ".C");
    if (t === undefined) return "File not found - " + a[0];
    var p = cProgram(a[0].replace(/^\\DEMO\\/, "").toUpperCase(), t, true, a.slice(1));
    return typeof p === "string" ? p : undefined;
  },
  TASKS: function () {
    var out = ["PID  NAME            STATE   LINE"];
    for (var i = 0; i < procs.length; i++)
      out.push(padRight(String(procs[i].pid), 5) + padRight(procs[i].name, 16) + padRight(procs[i].state(), 8) + procs[i].line());
    return procs.length ? out.join("\n") : "No programs are running.";
  },
  KILL: function (a) {
    for (var i = 0; i < procs.length; i++)
      if (String(procs[i].pid) === a[0]) { procs[i].kill(); return "[" + a[0] + "] killed"; }
    return "No such program - " + (a[0] || "(use KILL pid, see TASKS)");
  }
};

// SHELL in BASIC must not start these: they take over the keyboard.
var INTERACTIVE = { EDIT: 1, CALC: 1, SNAKE: 1, BLOCKS: 1, BASIC: 1, PYTHON: 1, PY: 1, RUN: 1, SETTINGS: 1, FILES: 1, C: 1, CC: 1, PAUSE: 1 };

function promptText() { return mode ? mode.prompt : pathText(cwd) + ">"; }

// %1..%9 are the running batch file's arguments; %NAME% is a SET variable (left alone if unset).
function expand(s) {
  var f = batch[batch.length - 1];
  if (f) s = s.replace(/%(\d)/g, function (m, d) { return f.args[d] || ""; });
  return s.replace(/%(\w+)%/g, function (m, n) { n = n.toUpperCase(); return n in env ? env[n] : m; });
}

// One command line: "a | b | c > file". Each command returns its output text.
function shell(s) {
  s = expand(s).replace(/^[\s@]+|\s+$/g, "");
  if (!s || s.charAt(0) === ":") return;  // blank line or batch label
  var m = /^(.*?)\s*(>>?)\s*(\S+)$/.exec(s), out;
  if (m) s = m[1];
  var parts = s.split("|");
  for (var i = 0; i < parts.length; i++) out = run1(parts[i].replace(/^\s+|\s+$/g, ""), out);
  if (m && out !== undefined) out = write(m[3], out, m[2] === ">>");
  if (out) print(out);
}

function run1(s, stdin) {
  var a = s.split(/\s+/), word = a.shift(), name = word.toUpperCase(), t;
  if (Object.prototype.hasOwnProperty.call(cmds, name)) return cmds[name](a, s.slice(word.length + 1), stdin);
  word = onPath(word);
  if ((t = findProgram(word, ".BAT")) !== undefined) {
    if (batch.length >= 16) { batch = []; return "Batch files nested too deep"; }
    batch.push({ lines: t.split("\n"), pc: 0, args: [word].concat(a) });
    return;
  }
  if (findProgram(word, ".BAS") !== undefined || findProgram(word, ".PY") !== undefined || findProgram(word, ".C") !== undefined) return launch(word, true, a);
  return "Bad command or file name";
}

// Runs waiting batch lines. Stops while a program has the keyboard, and after 50 lines so a looping
// batch file cannot freeze the viewer; sched() and key() call it again.
function runBatch() {
  for (var n = 0; n < 50 && batch.length && !mode; n++) {
    var f = batch[batch.length - 1];
    if (f.pc >= f.lines.length) batch.pop(); else shell(f.lines[f.pc++]);
  }
}

// ---- calculator: + - * / % and parentheses, by recursive descent (no eval) ----
function calc(src) {
  var s = src.replace(/\s+/g, ""), p = 0;
  function expr() {
    var v = term();
    while (s.charAt(p) === "+" || s.charAt(p) === "-") v = s.charAt(p++) === "+" ? v + term() : v - term();
    return v;
  }
  function term() {
    var v = factor(), op;
    while ((op = s.charAt(p)) === "*" || op === "/" || op === "%") {
      p++;
      var f = factor();
      v = op === "*" ? v * f : op === "/" ? v / f : v % f;
    }
    return v;
  }
  function factor() {
    if (s.charAt(p) === "-") { p++; return -factor(); }
    if (s.charAt(p) === "(") {
      p++;
      var v = expr();
      if (s.charAt(p++) !== ")") throw 0;
      return v;
    }
    var m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(p));
    if (!m) throw 0;
    p += m[0].length;
    return parseFloat(m[0]);
  }
  try {
    var v = expr();
    if (p < s.length || !isFinite(v)) throw 0;
    return String(parseFloat(v.toPrecision(12)));  // hides float noise such as 0.1+0.2
  } catch (e) {
    return "cannot calculate: " + src;
  }
}

// ---- snake: full-screen game; each cell is two characters wide ----
var GW = 30, GH = 16;

function snake() {
  var body = [[5, 8], [4, 8], [3, 8]], going = [1, 0], next = going, food, score = 0, over = false;
  var timer = app.setInterval("tick()", 160);
  function at(x, y) {
    for (var i = 0; i < body.length; i++) if (body[i][0] === x && body[i][1] === y) return true;
    return false;
  }
  function feed() {
    do food = [Math.floor(Math.random() * GW), Math.floor(Math.random() * GH)]; while (at(food[0], food[1]));
  }
  function stop() {
    over = true;
    if (timer) { app.clearInterval(timer); timer = null; }
  }
  feed();
  mode = {
    digits: true,
    key: function (c) {
      c = c.toLowerCase();
      if (c === "q" || over) { stop(); mode = null; print("snake: score " + score); return; }
      var d = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] }[c];
      if (d && (d[0] !== -going[0] || d[1] !== -going[1])) next = d;  // no turning straight back
    },
    tick: function () {
      if (over) return;
      going = next;
      var x = body[0][0] + going[0], y = body[0][1] + going[1];
      if (x < 0 || y < 0 || x >= GW || y >= GH || at(x, y)) return stop();
      body.unshift([x, y]);
      if (x !== food[0] || y !== food[1]) body.pop();
      else if (++score && body.length === GW * GH) stop();  // board full: nowhere left for food
      else feed();
    },
    draw: function () {
      var edge = "+" + new Array(GW * 2 + 1).join("-") + "+";
      var out = [" SNAKE   score " + score + (over ? "   GAME OVER - press any key" : ""), edge];
      for (var y = 0; y < GH; y++) {
        var r = "|";
        for (var x = 0; x < GW; x++)
          r += x === body[0][0] && y === body[0][1] ? "@@" : at(x, y) ? "oo"
            : x === food[0] && y === food[1] ? "**" : "  ";
        out.push(r + "|");
      }
      out.push(edge);
      return out;
    }
  };
}

// ---- blocks: falling-block puzzle; each cell is two characters wide ----
var BW = 10, BH = 18;
var SHAPES = [  // box size n, then the four cells inside an n x n box
  [4, [0, 1], [1, 1], [2, 1], [3, 1]],
  [2, [0, 0], [1, 0], [0, 1], [1, 1]],
  [3, [1, 0], [0, 1], [1, 1], [2, 1]],
  [3, [1, 0], [2, 0], [0, 1], [1, 1]],
  [3, [0, 0], [1, 0], [1, 1], [2, 1]],
  [3, [0, 0], [0, 1], [1, 1], [2, 1]],
  [3, [2, 0], [0, 1], [1, 1], [2, 1]]
];

function blocks() {
  var grid = [], score = 0, lines = 0, over = false, wait = 0, piece, next = newPiece();
  for (var y = 0; y < BH; y++) grid.push(emptyRow());
  var timer = app.setInterval("tick()", 100);
  function emptyRow() { var r = []; for (var x = 0; x < BW; x++) r.push(0); return r; }
  function newPiece() {
    var s = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    return { n: s[0], cells: s.slice(1), x: Math.floor((BW - s[0]) / 2), y: 0 };
  }
  function level() { return 1 + Math.floor(lines / 10); }
  function fits(cells, px, py) {
    for (var i = 0; i < cells.length; i++) {
      var x = px + cells[i][0], y = py + cells[i][1];
      if (x < 0 || x >= BW || y >= BH || grid[y][x]) return false;
    }
    return true;
  }
  function stop() {
    over = true;
    if (timer) { app.clearInterval(timer); timer = null; }
  }
  function spawn() {
    piece = next;
    next = newPiece();
    if (!fits(piece.cells, piece.x, piece.y)) stop();
  }
  function move(dx, dy) {
    if (!fits(piece.cells, piece.x + dx, piece.y + dy)) return false;
    piece.x += dx;
    piece.y += dy;
    return true;
  }
  function rotate() {  // clockwise inside the piece's box, nudged sideways if it hits a wall
    var r = [], kicks = [0, -1, 1, -2, 2];
    for (var i = 0; i < 4; i++) r.push([piece.n - 1 - piece.cells[i][1], piece.cells[i][0]]);
    for (var k = 0; k < kicks.length; k++)
      if (fits(r, piece.x + kicks[k], piece.y)) { piece.cells = r; piece.x += kicks[k]; return; }
  }
  function lock() {
    for (var i = 0; i < 4; i++) grid[piece.y + piece.cells[i][1]][piece.x + piece.cells[i][0]] = 1;
    var cleared = 0;
    for (var y = BH - 1; y >= 0; y--)
      if (grid[y].join("").indexOf("0") < 0) { grid.splice(y, 1); grid.unshift(emptyRow()); cleared++; y++; }
    lines += cleared;
    score += [0, 100, 300, 500, 800][cleared] * level();
    spawn();
  }
  function fall() {
    wait = 0;
    if (!move(0, 1)) lock();
  }
  function isPiece(x, y) {
    for (var i = 0; i < 4; i++) if (piece.x + piece.cells[i][0] === x && piece.y + piece.cells[i][1] === y) return true;
    return false;
  }
  spawn();
  mode = {
    digits: true,
    key: function (c) {
      c = c.toLowerCase();
      if (c === "q" || over) { stop(); mode = null; print("blocks: score " + score + ", lines " + lines); return; }
      if (c === "a") move(-1, 0);
      else if (c === "d") move(1, 0);
      else if (c === "w") rotate();
      else if (c === "s") fall();
      else if (c === " ") { while (move(0, 1)) {} fall(); }
    },
    tick: function () {
      if (!over && ++wait >= Math.max(1, 9 - level())) fall();  // speeds up every 10 lines
    },
    draw: function () {
      var side = ["", "  NEXT", "", "", "", "", "", "", "", "", "", "", "", "", over ? "  GAME OVER" : "", over ? "  press any key" : ""];
      for (var py = 0; py < 4; py++) {
        var p = "  ";
        for (var px = 0; px < 4; px++) {
          var hit = false;
          for (var i = 0; i < 4; i++) if (next.cells[i][0] === px && next.cells[i][1] === py) hit = true;
          p += hit ? "[]" : "  ";
        }
        side[2 + py] = p;
      }
      var out = [" BLOCKS   score " + score + "   lines " + lines + "   level " + level()];
      for (var y = 0; y < BH; y++) {
        var r = "|";
        for (var x = 0; x < BW; x++) r += grid[y][x] || isPiece(x, y) ? "[]" : " .";
        out.push(r + "|" + (side[y] || ""));
      }
      out.push("+" + new Array(BW * 2 + 1).join("-") + "+");
      return out;
    }
  };
}

// ---- processes: BASIC programs, each run a slice at a time by one scheduler timer ----
var procs = [], nextPid = 1;

function sched() {
  var now = new Date().getTime();
  for (var i = 0; i < procs.length; i++) if (!procs[i].step(now)) procs.splice(i--, 1);
  if (!mode) runBatch();
  render();
  desktopTick();
}

// ---- desktop: app icons, one app window, the taskbar clock ----
var bootOpen = "", doc = this, booted = false, focusIn = 0, clockText = "", currentApp = null, inApp = false, termLines = [];
var APPS = {
  TERMINAL: { title: "Terminal", hint: "Type a command and press Enter. HELP lists them." },
  FILES: { title: "Files", cmd: "FILES", hint: "" },
  NOTES: { title: "Notes", cmd: "EDIT NOTES.TXT", hint: "Enter adds the line. Closing the window saves it." },
  CALC: { title: "Calculator", cmd: "CALC", hint: "Type a sum like (2+3)*4 and press Enter." },
  PYTHON: { title: "Python", cmd: "PYTHON", hint: "Type Python and press Enter. An empty line runs a block." },
  CLANG: { title: "C", cmd: "C", hint: "Arrows and mouse move the cursor." },
  SNAKE: { title: "Snake", cmd: "SNAKE", hint: "Steer: W A S D or 8 4 5 6     Quit: Q" },
  BLOCKS: { title: "Blocks", cmd: "BLOCKS", hint: "Move: A D or 4 6    Turn: W or 8    Down: S or 5    Drop: Space    Quit: Q" },
  DODGE: { title: "Dodge", cmd: "DODGE", hint: "Move: A D or 4 6     Quit: Q" },
  SETTINGS: { title: "Settings", cmd: "SETTINGS", hint: "Choices apply at once. Ctrl+S keeps them in this PDF." }
};

function showWindow(on) {
  var editing = !!cEd && cEd.editing, output = !!cEd && !editing, i;
  winOn = on;
  function set(names, show) {
    for (var n = 0; n < names.length; n++) vis(uiName(names[n]), show);
  }
  set(["wchrome", "wbar", "wclose", "wmin", "khint"], on);
  set(["gtip"], !on);
  set(["wbody", "kbd"], on && !editing);
  set(["cgut", "cedit"], on && editing);
  set(["crun"], on && editing && !cEd.plain);
  set(["cprev", "cnext", "cpage"], on && (editing || !!fState));
  set(["cback"], on && output);
  set(F_BUTTONS, on && !!fState);
  set(F_MARKS, false);
  set(S_BUTTONS, false);
  if (on && sOpen) sShow();
  if (fState) { fState.hl = -1; fState.shown = on; }
  for (i = 0; i < ROWS; i++) vis((sDark ? "rD" : "r") + i, on && !editing);
}

// Ends whatever has the keyboard, saving a note in progress. START programs keep running.
function quitApp() {
  batch = [];
  if (mode && mode.autosave) mode.autosave(input);
  input = "";
  for (var n = 0; mode && n < 8; n++) {
    if (mode.key) mode.key(mode.quitKey || "q"); else mode = null;
  }
  mode = null;
  cEd = null;
  fState = null;
  sOpen = false;
  cPending = "";
}

// Apps get a clean window; the terminal's history comes back when the terminal does.
function leaveApp() {
  if (inApp) { lines = termLines; inApp = false; }
}

function openApp(id) {
  var a = APPS[id];
  if (!a) return;
  if (!booted) { bootOpen = id; return; }  // clicked while starting up: opened as soon as boot ends
  if (id === currentApp && (mode || !a.cmd)) {  // already running, perhaps minimized: bring it back
    showWindow(true);
    paintNow();
    focusIn = 2;
    return;
  }
  quitApp();
  leaveApp();
  if (a.cmd) { termLines = lines; lines = []; inApp = true; }
  currentApp = id;
  hintKorean = false;
  ui("wbar").value = a.title;
  ui("mapp").value = a.title;
  showHint();
  showWindow(true);
  if (a.cmd) shell(a.cmd);
  if (id === "NOTES") lines.shift();  // EDIT's banner explains terminal commands; the strip covers this
  render();
  paintNow();
  focusIn = 2;  // a viewer gives focus to the clicked icon after this action, so take it a moment later
}

function closeApp() {
  if (cEd && cEd.editing && !cEd.closing) {  // a tick later, so that what was just typed is committed
    cEd.closing = true;
    cPending = "close";
    return;
  }
  var back = !!(cEd && cEd.fromFiles);
  quitApp();
  // what the app last reported stays in the menu bar, since its window is gone
  var last = lines[lines.length - 1] || "", done = /^(Saved |snake: score|blocks: score|Game over)/.test(last);
  leaveApp();
  currentApp = null;
  if (back) {  // a file opened from Files closes back to its folder
    fMsg = done ? last.replace(/^Saved /, "Updated ") : "";  // "Saved" is reserved for the PDF itself
    openApp("FILES");
    return;
  }
  ui("mapp").value = done ? last.charAt(0).toUpperCase() + last.slice(1) : "";
  showWindow(false);
  render();
  paintNow();
}

// The app keeps running; its Dock icon brings the window back.
function minimizeApp() { showWindow(false); paintNow(); }

// A click anywhere in the window gives the keyboard back to the app.
function focusKeyboard() { focusIn = 4; }

function desktopTick() {
  saveTick();
  if (cPending) cDoPending();
  paintNow();
  paintTick();
  if (focusIn && !--focusIn) { try { (cEd && cEd.editing ? doc.getField("cedit") : ui("kbd")).setFocus(); } catch (e) {} }
  // an app that ended itself (Q, game over) closes rather than dropping the user at a C:\> prompt
  if (currentApp && !mode && APPS[currentApp].cmd) closeApp();
  var d = new Date(), hr = d.getHours(), t = sH12 ? (hr % 12 || 12) + ":" + two(d.getMinutes()) + (hr < 12 ? " AM" : " PM") : two(hr) + ":" + two(d.getMinutes());
  if (t !== clockText) {
    ui("clock").value = t;
    ui("gdate").value = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()] + ", " +
      ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][d.getMonth()] +
      " " + d.getDate();
    clockText = t;
  }
}

// What every program shares: an entry in procs and a console. In the foreground the console is the
// program's own screen and the keyboard; in the background its output is printed to the terminal.
// how.run(now) executes a slice, how.line() is the current line number, how.brk() the break message.
function program(name, fg, how) {
  var con = { done: false, wake: 0, asking: null, keys: "", scr: [], row: 0, col: 0 };
  var typed = "", pending = "", prev = mode, p;
  if (fg) {  // carry on below what the terminal shows; finish() hands these rows back
    con.scr = lines.splice(Math.max(0, lines.length - (ROWS - 1)));
    con.row = con.scr.length;
  }
  function newline() {
    con.col = 0;
    if (++con.row >= ROWS) { con.scr.shift(); con.row = ROWS - 1; }
  }
  con.emit = function (s) {
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i), r;
      if (!fg) {
        if (c === "\n") { print(pending); pending = ""; } else pending += c;
      } else if (c === "\n") newline();
      else {
        if (con.col >= COLS) newline();
        r = con.scr[con.row] || "";
        con.scr[con.row] = padRight(r, con.col).slice(0, con.col) + c + r.slice(con.col + 1);
        con.col++;
      }
    }
  };
  // Starts a new line unless the cursor is already at the start of one (for error messages).
  con.endLine = function () { if (fg ? con.col > 0 : pending) con.emit("\n"); };
  con.finish = function () {
    if (con.done) return;
    con.done = true;
    if (!fg) {
      if (pending) print(pending);
      print("[" + p.pid + "] " + name + " finished");
      return;
    }
    if (mode === p.mode) mode = prev;
    var last = -1, i;
    for (i = 0; i < ROWS; i++) if (con.scr[i]) last = i;
    for (i = 0; i <= last; i++) print(con.scr[i] || "");  // leave what it showed in the terminal
  };
  // Waits for a typed line and passes it to answer(text); answer returns false to ask again.
  con.ask = function (answer) { typed = ""; con.asking = answer; };
  p = {
    pid: nextPid++, name: name, kill: con.finish, line: how.line,
    // Returns false once the program has ended.
    step: function (now) {
      if (!con.done && !con.asking && con.wake <= now) how.run(now);
      return !con.done;
    },
    state: function () { return con.asking ? "input" : con.wake > new Date().getTime() ? "sleep" : "run"; },
    mode: {
      quitKey: "`",
      typing: function () { return !!con.asking; },  // input() takes text, not game keys
      key: function (c) {
        var a = con.asking;
        if (c === "`") { con.endLine(); con.emit(how.brk() + "\n"); con.finish(); }
        else if (!a) { if (con.keys.length < 16) con.keys += c; }  // kept for the program to read
        else if (c === "\b") {
          if (typed && con.col > 0) { typed = typed.slice(0, -1); con.col--; con.scr[con.row] = con.scr[con.row].slice(0, con.col); }
        } else if (c === "\n" || c === "\r") {
          con.emit("\n");
          c = typed;
          typed = "";
          con.asking = null;
          if (a(c) === false) con.asking = a;
        } else if (c >= " " && c <= "~") { typed += c; con.emit(c); }
      },
      draw: function () {
        var out = [];
        for (var i = 0; i < ROWS; i++) out.push(con.scr[i] || "");
        if (con.asking) out[con.row] = padRight(out[con.row], con.col) + "_";
        return out;
      }
    }
  };
  // A foreground program runs its first slice at once, so a short one is finished before the next key
  // arrives. A background one waits for the scheduler, so "started" is printed before its output.
  con.start = function () {
    if (!fg) procs.push(p);
    else {
      mode = p.mode;
      if (p.step(new Date().getTime())) procs.push(p);
    }
    return p;
  };
  return con;
}

// ---- BASIC ----
// Tokens: a number, { s: "text" } for a string literal, or an upper-case word / operator.
function basTokenize(s) {
  var out = [], m;
  while ((s = s.replace(/^\s+/, ""))) {
    if ((m = /^(\d+\.?\d*|\.\d+)/.exec(s))) out.push(parseFloat(m[0]));
    else if ((m = /^"([^"]*)"?/.exec(s))) out.push({ s: m[1] });
    else if ((m = /^[A-Za-z][A-Za-z0-9]*\$?/.exec(s))) {
      if (m[0].toUpperCase() === "REM") break;
      out.push(m[0].toUpperCase());
    } else if (s.charAt(0) === "'") break;
    else if ((m = /^(<>|<=|>=|[-+*\/^=<>(),;:#?])/.exec(s))) out.push(m[0] === "?" ? "PRINT" : m[0]);
    else throw "Bad character " + s.charAt(0);
    s = s.slice(m[0].length);
  }
  return out;
}

// Program text -> [{ n: line number, tk: tokens }] in line order. Unnumbered lines follow the one before.
function basLoad(text) {
  var prog = [], src = text.split("\n"), last = 0;
  for (var i = 0; i < src.length; i++) {
    var m = /^\s*(\d+)?\s*(.*)$/.exec(src[i]);
    if (!m[1] && !m[2]) continue;
    last = m[1] ? parseInt(m[1], 10) : last + 1;
    try { prog.push({ n: last, tk: basTokenize(m[2]) }); } catch (e) { throw e + " in line " + last; }
  }
  prog.sort(function (a, b) { return a.n - b.n; });
  return prog;
}

// Starts a program. fg = true: it owns the screen and keyboard until it ends; false: it runs in the
// background and its PRINT lines go to the terminal. Returns the process, or an error message.
function basic(name, text, fg) {
  var prog, pc = 0, tp = 0, tk = [], vars = {}, arrs = {}, fors = [], subs = [], files = {};
  try { prog = basLoad(text); } catch (e) { return "?" + e; }
  var con = program(name, fg, { run: run, line: line, brk: function () { return "Break" + where(); } });
  var emit = con.emit, finish = con.finish;
  function line() { return prog[pc] ? prog[pc].n : 0; }
  function where() { return prog[pc] ? " in line " + prog[pc].n : ""; }
  function fmt(n) { return String(parseFloat(n.toPrecision(12))); }

  // -- expressions (true is -1, false is 0) --
  function peek() { return tk[tp]; }
  function eat(t) { if (tk[tp] !== t) throw "Syntax error"; tp++; }
  function num(v) { if (typeof v !== "number") throw "Type mismatch"; return v; }
  function str(v) { if (typeof v !== "string") throw "Type mismatch"; return v; }
  function isStr(name) { return name.charAt(name.length - 1) === "$"; }
  function isName(t) { return typeof t === "string" && /^[A-Z]/.test(t); }
  function expr() {
    var v = andE(), r;
    while (peek() === "OR") { tp++; r = andE(); v = v || r ? -1 : 0; }
    return v;
  }
  function andE() {
    var v = notE(), r;
    while (peek() === "AND") { tp++; r = notE(); v = v && r ? -1 : 0; }
    return v;
  }
  function notE() {
    if (peek() === "NOT") { tp++; return notE() ? 0 : -1; }
    var v = sum(), op = peek(), r;
    if (op !== "=" && op !== "<>" && op !== "<" && op !== ">" && op !== "<=" && op !== ">=") return v;
    tp++;
    r = sum();
    if (typeof v !== typeof r) throw "Type mismatch";
    return (op === "=" ? v === r : op === "<>" ? v !== r : op === "<" ? v < r : op === ">" ? v > r
      : op === "<=" ? v <= r : v >= r) ? -1 : 0;
  }
  function sum() {
    var v = term(), op, r;
    while ((op = peek()) === "+" || op === "-") {
      tp++;
      r = term();
      if (typeof v !== typeof r || (op === "-" && typeof v === "string")) throw "Type mismatch";
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function term() {
    var v = unary(), op, r;
    while ((op = peek()) === "*" || op === "/" || op === "MOD") {
      tp++;
      r = num(unary());
      num(v);
      if (op !== "*" && r === 0) throw "Division by zero";
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  }
  function unary() {
    if (peek() === "-") { tp++; return -num(unary()); }
    var v = atom();
    if (peek() === "^") { tp++; v = Math.pow(num(v), num(unary())); }
    return v;
  }
  function args() {
    var a = [];
    eat("(");
    if (peek() !== ")") { a.push(expr()); while (peek() === ",") { tp++; a.push(expr()); } }
    eat(")");
    return a;
  }
  function fill(name, n) {
    if (n < 0 || n > 10000 || n !== Math.floor(n)) throw "Bad array size";
    var a = [];
    for (var i = 0; i <= n; i++) a.push(isStr(name) ? "" : 0);
    return a;
  }
  function cell(name, a) {  // index into array "name" (made with 10 elements if never DIMmed)
    var arr = arrs[name] || (arrs[name] = fill(name, 10)), i = num(a[0]);
    if (a.length !== 1 || i < 0 || i >= arr.length || i !== Math.floor(i)) throw "Subscript out of range";
    return i;
  }
  var fns = {
    ABS: function (x) { return Math.abs(num(x)); },
    INT: function (x) { return Math.floor(num(x)); },
    SQR: function (x) { if (num(x) < 0) throw "Illegal function call"; return Math.sqrt(x); },
    SIN: function (x) { return Math.sin(num(x)); },
    COS: function (x) { return Math.cos(num(x)); },
    LEN: function (s) { return str(s).length; },
    VAL: function (s) { return parseFloat(str(s)) || 0; },
    ASC: function (s) { return str(s).charCodeAt(0) || 0; },
    "STR$": function (x) { return fmt(num(x)); },
    "CHR$": function (x) { return String.fromCharCode(num(x)); },
    "LEFT$": function (s, n) { return str(s).slice(0, Math.max(0, num(n))); },
    "RIGHT$": function (s, n) { return num(n) > 0 ? str(s).slice(-n) : ""; },
    "MID$": function (s, i, n) { return str(s).substr(Math.max(0, num(i) - 1), n === undefined ? undefined : num(n)); },
    EOF: function (n) {
      var f = files[n];
      if (!f || f.w) throw "File not open for input";
      return f.pos >= f.lines.length ? -1 : 0;
    }
  };
  function atom() {
    var t = tk[tp++], a;
    if (typeof t === "number") return t;
    if (t && typeof t === "object") return t.s;
    if (t === "(") { a = expr(); eat(")"); return a; }
    if (!isName(t)) throw "Syntax error";
    if (t === "INKEY$") { a = con.keys.charAt(0); con.keys = con.keys.slice(1); return a; }
    if (t === "TIMER") {
      a = new Date();
      return a.getHours() * 3600 + a.getMinutes() * 60 + a.getSeconds() + a.getMilliseconds() / 1000;
    }
    if (t === "RND") { if (peek() === "(") args(); return Math.random(); }
    if (fns.hasOwnProperty(t)) return fns[t].apply(null, args());
    if (peek() === "(") { a = cell(t, args()); return arrs[t][a]; }
    return vars.hasOwnProperty(t) ? vars[t] : isStr(t) ? "" : 0;
  }
  // Parses a variable or array element at tp and returns a function that stores into it.
  function target() {
    var name = tk[tp++];
    if (!isName(name)) throw "Syntax error";
    var i = peek() === "(" ? cell(name, args()) : -1;
    return function (v) {
      if (typeof v !== (isStr(name) ? "string" : "number")) throw "Type mismatch";
      if (i < 0) vars[name] = v; else arrs[name][i] = v;
    };
  }

  // -- statements --
  function jump(n) {
    if (typeof n !== "number") throw "Syntax error";
    for (var i = 0; i < prog.length; i++) if (prog[i].n === n) { pc = i; tp = 0; tk = prog[i].tk; return; }
    throw "Undefined line " + n;
  }
  function printItems() {  // PRINT's item list -> text, with a newline unless it ends in ; or ,
    var s = "", nl = true, v;
    while (tp < tk.length && tk[tp] !== ":" && tk[tp] !== "ELSE") {
      if (tk[tp] === ";") { tp++; nl = false; }
      else if (tk[tp] === ",") { tp++; nl = false; do s += " "; while (s.length % 14); }
      else { v = expr(); s += typeof v === "number" ? fmt(v) : v; nl = true; }
    }
    return nl ? s + "\n" : s;
  }
  function fileNo() {
    if (peek() === "#") tp++;
    return num(expr());
  }
  function stmt() {
    var t = tk[tp++], v, a, f, i, n;
    switch (t) {
    case "PRINT":
      if (peek() !== "#") { emit(printItems()); break; }
      f = files[fileNo()];
      if (!f || !f.w) throw "File not open for output";
      eat(",");
      if ((v = write(f.name, printItems().replace(/\n$/, ""), true))) throw v;
      break;
    case "INPUT":
      if (peek() === "#") {
        f = files[fileNo()];
        if (!f || f.w) throw "File not open for input";
        eat(",");
        if (f.pos >= f.lines.length) throw "Input past end of file";
        n = isStr(String(peek()));
        v = f.lines[f.pos++];
        target()(n ? v : parseFloat(v) || 0);
        break;
      }
      if (!fg) throw "INPUT needs the foreground (use RUN, not START)";
      if (peek() && typeof peek() === "object") {
        emit(tk[tp++].s);
        if (peek() === ";" || peek() === ",") tp++;
      }
      emit("? ");
      n = isStr(String(peek()));
      f = target();
      con.ask(n ? f : function (typed) {
        if (isNaN(parseFloat(typed))) { emit("?Redo from start\n? "); return false; }
        f(parseFloat(typed));
      });
      break;
    case "IF":
      v = expr();
      eat("THEN");
      if (!v) {  // skip to this line's ELSE, or to the next line
        for (i = tp; i < tk.length && tk[i] !== "ELSE"; i++) {}
        if (i >= tk.length) { pc++; tp = 0; break; }
        tp = i + 1;
      }
      if (typeof tk[tp] === "number") jump(tk[tp]);
      break;
    case "ELSE": pc++; tp = 0; break;  // reached after a THEN part ran
    case "GOTO": jump(tk[tp]); break;
    case "GOSUB":
      if (subs.length >= 200) throw "Out of memory";
      subs.push([pc, tp + 1]);
      jump(tk[tp]);
      break;
    case "RETURN":
      if (!(a = subs.pop())) throw "RETURN without GOSUB";
      pc = a[0]; tp = a[1]; tk = prog[pc].tk;
      break;
    case "FOR":
      n = tk[tp];
      if (!isName(n) || isStr(n) || tk[tp + 1] !== "=") throw "Syntax error";
      tp += 2;
      vars[n] = num(expr());
      eat("TO");
      v = num(expr());
      a = 1;
      if (peek() === "STEP") { tp++; a = num(expr()); }
      for (i = fors.length; i--;) if (fors[i].name === n) fors.length = i;  // loop restarted
      fors.push({ name: n, lim: v, step: a, pc: pc, tp: tp });
      break;
    case "NEXT":
      if (isName(peek())) tp++;
      if (!(f = fors[fors.length - 1])) throw "NEXT without FOR";
      vars[f.name] += f.step;
      if (f.step >= 0 ? vars[f.name] <= f.lim : vars[f.name] >= f.lim) { pc = f.pc; tp = f.tp; tk = prog[pc].tk; }
      else fors.pop();
      break;
    case "DIM":
      do {
        n = tk[tp++];
        if (!isName(n)) throw "Syntax error";
        a = args();
        arrs[n] = fill(n, num(a[0]));
      } while (peek() === "," && tp++);
      break;
    case "END": case "STOP": finish(); break;
    case "CLS": con.scr = []; con.row = con.col = 0; break;
    case "LOCATE":
      v = num(expr());
      eat(",");
      a = num(expr());
      con.row = Math.min(ROWS, Math.max(1, Math.floor(v))) - 1;
      con.col = Math.min(COLS, Math.max(1, Math.floor(a))) - 1;
      break;
    case "SLEEP": con.wake = new Date().getTime() + num(expr()) * 1000; break;
    case "RANDOMIZE": if (tp < tk.length && peek() !== ":") expr(); break;
    case "SHELL":  // run an OS command and show what it prints
      v = str(expr());
      a = v.replace(/^\s+/, "").split(/\s+/)[0].toUpperCase();
      if (!Object.prototype.hasOwnProperty.call(cmds, a) || INTERACTIVE[a]) throw "SHELL runs built-in commands only";
      i = lines.length;
      shell(v);
      if (fg && lines.length > i) emit(lines.splice(i).join("\n") + "\n");
      break;
    case "OPEN":
      n = str(expr());
      eat("FOR");
      a = tk[tp++];
      eat("AS");
      i = fileNo();
      if (a === "INPUT") {
        v = lookup(resolve(n));
        if (typeof v !== "string") throw "File not found";
        files[i] = { lines: v ? v.split("\n") : [], pos: 0 };
      } else if (a === "OUTPUT" || a === "APPEND") {
        if (a === "OUTPUT" || lookup(resolve(n)) === undefined) if ((v = write(n, ""))) throw v;
        files[i] = { name: n, w: true };
      } else throw "Syntax error";
      break;
    case "CLOSE":
      if (tp < tk.length && peek() !== ":") delete files[fileNo()]; else files = {};
      break;
    default:  // [LET] variable = value
      if (t !== "LET") tp--;
      f = target();
      eat("=");
      f(expr());
    }
  }

  // Runs up to 300 statements.
  function run(now) {
    try {
      for (var n = 0; n < 300 && !con.done && !con.asking && con.wake <= now; n++) {
        if (pc >= prog.length) { finish(); break; }
        tk = prog[pc].tk;
        if (tp >= tk.length) { pc++; tp = 0; }
        else if (tk[tp] === ":") tp++;
        else stmt();
      }
    } catch (e) {
      con.endLine();
      emit("?" + (typeof e === "string" ? e : "Internal error") + where() + "\n");
      finish();
    }
  }
  return con.start();
}

// The BASIC command: keeps a program as numbered lines, like a home computer's prompt.
function basicPrompt() {
  var src = {};  // line number -> text
  function listing() {
    var nums = [], out = [], k;
    for (k in src) nums.push(parseInt(k, 10));
    nums.sort(function (a, b) { return a - b; });
    for (k = 0; k < nums.length; k++) out.push(nums[k] + " " + src[nums[k]]);
    return out.join("\n");
  }
  print("PaperBASIC. Type numbered lines, then RUN.\nAlso: LIST  NEW  SAVE file  LOAD file  SYSTEM (leave)");
  mode = { prompt: "] ", line: function (t) {
    var m = /^\s*(\d+)\s?(.*)$/.exec(t), a = t.replace(/^\s+|\s+$/g, "").split(/\s+/), c = a[0].toUpperCase(), r, i;
    if (m) { if (m[2]) src[parseInt(m[1], 10)] = m[2]; else delete src[parseInt(m[1], 10)]; }
    else if (c === "LIST") { if (listing()) print(listing()); }
    else if (c === "NEW") src = {};
    else if (c === "SYSTEM" || c === "EXIT") mode = null;
    else if (c === "SAVE" || c === "LOAD") {
      if (!a[1]) { print("Usage: " + c + " file"); return; }
      var f = a[1].replace(/"/g, "");
      if (f.indexOf(".") < 0) f += ".BAS";
      if (c === "SAVE") print(write(f, listing()) || "Saved " + f.toUpperCase());
      else if (typeof (r = lookup(resolve(f))) !== "string") print("File not found - " + f);
      else {
        src = {};
        r = r.split("\n");
        for (i = 0; i < r.length; i++) if ((m = /^\s*(\d+)\s?(.+)$/.exec(r[i]))) src[parseInt(m[1], 10)] = m[2];
        print("Loaded " + f.toUpperCase());
      }
    } else if (c) {  // RUN, or a statement to run right away
      r = basic("BASIC", c === "RUN" ? listing() : "0 " + t, true);
      if (typeof r === "string") print(r);
    }
  } };
}

// ---- Python: a small subset ----
// Source is compiled to instructions for a stack machine, so a program can be run a slice at a time
// and can stop to wait for input(). Values: number, string, true/false, null (None), Array (list and
// tuple), { keys, vals } (dict), { py } (function), a JS function (built-in), { mod } (module).
// shortcut: no classes, closures, raise or finally, and int and float are one number type (6 / 2
// prints 3); add them when programs need them.

var PY_KEYWORDS = {};
(function () {
  var k = ("if elif else while for def return break continue pass in not and or is global import True False None try except " +
    "class finally with lambda from raise assert del yield async await").split(" ");
  // the first 22 are supported; 2 marks the rest as "not supported here"
  for (var i = 0; i < k.length; i++) PY_KEYWORDS[k[i]] = i < 22 ? 1 : 2;
})();

// Text -> tokens { t: num | str | fstr | name | op | NEWLINE | INDENT | DEDENT | END, v, ln }
function pyLex(text) {
  var out = [], ind = [0], src = text.split("\n"), ln, s, m, n;
  function tok(t, v) { out.push({ t: t, v: v, ln: ln + 1 }); }
  function unescape1(x, c) { return c === "n" ? "\n" : c === "t" ? "\t" : c; }
  for (ln = 0; ln < src.length; ln++) {
    m = /^(\s*)(.*)$/.exec(src[ln].replace(/\t/g, "    "));
    s = m[2];
    if (!s || s.charAt(0) === "#") continue;
    n = m[1].length;
    if (n > ind[ind.length - 1]) { ind.push(n); tok("INDENT"); }
    while (n < ind[ind.length - 1]) { ind.pop(); tok("DEDENT"); }
    if (n !== ind[ind.length - 1]) throw "IndentationError: unindent does not match (line " + (ln + 1) + ")";
    while ((s = s.replace(/^\s+/, "")) && s.charAt(0) !== "#") {
      if ((m = /^(\d+\.\d*|\.\d+|\d+)/.exec(s))) tok("num", parseFloat(m[0]));
      else if ((m = /^([fF]?)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/.exec(s)))
        tok(m[1] ? "fstr" : "str", m[2].slice(1, -1).replace(/\\(.)/g, unescape1));
      else if ((m = /^[A-Za-z_]\w*/.exec(s))) tok("name", m[0]);
      else if ((m = /^(\*\*|\/\/|==|!=|<=|>=|\+=|-=|\*=|\/=|[-+*\/%<>=()\[\]{},:.])/.exec(s))) tok("op", m[0]);
      else throw "SyntaxError: invalid character '" + s.charAt(0) + "' (line " + (ln + 1) + ")";
      s = s.slice(m[0].length);
    }
    tok("NEWLINE");
  }
  ln = src.length - 1;
  while (ind.length > 1) { ind.pop(); tok("DEDENT"); }
  tok("END");
  return out;
}

// Text -> { ins: [[op, a, b]], ln: [line of each instruction] }. echo: show the value of expression
// statements, as the >>> prompt does.
function pyCompile(text, echo) {
  var toks = pyLex(text), pos = 0, line = 1, code = { ins: [], ln: [] }, loops = [], fn = null;
  var tries = 0, compId = 0;  // try blocks open at this point; comprehensions seen so far

  function is(v) { var t = toks[pos]; return (t.t === "op" || t.t === "name") && t.v === v; }
  function isT(t) { return toks[pos].t === t; }
  function accept(v) { if (is(v)) { pos++; return true; } return false; }
  function bad(msg) { throw "SyntaxError: " + (msg || "invalid syntax") + " (line " + toks[pos].ln + ")"; }
  function expect(v) { if (!accept(v)) bad(); }
  function name() { if (!isT("name") || PY_KEYWORDS[toks[pos].v]) bad(); return toks[pos++].v; }
  function out(op, a, b) { code.ins.push([op, a, b]); code.ln.push(line); return code.ins.length - 1; }
  function here() { return code.ins.length; }
  function patch(i) { code.ins[i][1] = here(); }

  // -- expressions -> tree --
  function exprList() {  // "a, b" is a tuple, kept as a list
    var e = expr(), items;
    if (!is(",")) return e;
    items = [e];
    while (accept(",") && !(isT("NEWLINE") || isT("END") || is("=") || is(")") || is(":"))) items.push(expr());
    return ["list", items];
  }
  function expr() {
    var a = orE(), c;
    if (!accept("if")) return a;
    c = orE();
    expect("else");
    return ["ifx", c, a, expr()];
  }
  function orE() { var a = andE(); while (accept("or")) a = ["or", a, andE()]; return a; }
  function andE() { var a = notE(); while (accept("and")) a = ["and", a, notE()]; return a; }
  function notE() { return accept("not") ? ["not", notE()] : cmp(); }
  function cmp() {  // a < b < c becomes (a < b) and (b < c)
    var a = arith(), res = null, op, b, one;
    for (;;) {
      if (is("==") || is("!=") || is("<") || is(">") || is("<=") || is(">=") || is("in")) op = toks[pos++].v;
      else if (is("not") && toks[pos + 1].v === "in" && toks[pos + 1].t === "name") { pos += 2; op = "not in"; }
      else if (accept("is")) op = accept("not") ? "!=" : "==";
      else return res || a;
      b = arith();
      one = ["cmp", op, a, b];
      res = res ? ["and", res, one] : one;
      a = b;
    }
  }
  function arith() {
    var a = term(), op;
    while (is("+") || is("-")) { op = toks[pos++].v; a = ["bin", op, a, term()]; }
    return a;
  }
  function term() {
    var a = unary(), op;
    while (is("*") || is("/") || is("//") || is("%")) { op = toks[pos++].v; a = ["bin", op, a, unary()]; }
    return a;
  }
  function unary() {
    if (accept("-")) return ["neg", unary()];
    if (accept("+")) return unary();
    var a = postfix();
    return accept("**") ? ["bin", "**", a, unary()] : a;
  }
  function postfix() {
    var a = atom(), args, kw, lo, t;
    for (;;) {
      if (accept("(")) {
        args = [];
        kw = [];
        while (!is(")")) {
          t = toks[pos];
          if (t.t === "name" && toks[pos + 1].t === "op" && toks[pos + 1].v === "=") { pos += 2; kw.push([t.v, expr()]); }
          else args.push(expr());
          if (!accept(",")) break;
        }
        expect(")");
        a = ["call", a, args, kw];
      } else if (accept("[")) {
        lo = is(":") ? null : expr();
        a = accept(":") ? ["slice", a, lo, is("]") ? null : expr()] : ["idx", a, lo];
        expect("]");
      } else if (accept(".")) {
        if (!isT("name")) bad();
        a = ["attr", a, toks[pos++].v];
      } else return a;
    }
  }
  function atom() {
    var t = toks[pos++], items, a;
    if (t.t === "num" || t.t === "str") return ["const", t.v];
    if (t.t === "fstr") return fstr(t.v);
    if (t.t === "name") {
      if (t.v === "True" || t.v === "False") return ["const", t.v === "True"];
      if (t.v === "None") return ["const", null];
      if (PY_KEYWORDS[t.v]) { pos--; bad(PY_KEYWORDS[t.v] === 2 ? "'" + t.v + "' is not supported here" : ""); }
      return ["name", t.v];
    }
    if (t.t === "op" && t.v === "(") {
      if (accept(")")) return ["list", []];
      a = exprList();
      expect(")");
      return a;
    }
    if (t.t === "op" && t.v === "[") {
      items = [];
      while (!is("]")) {
        items.push(expr());
        if (is("for") && items.length === 1) { a = comprehension(items[0]); expect("]"); return a; }
        if (!accept(",")) break;
      }
      expect("]");
      return ["list", items];
    }
    if (t.t === "op" && t.v === "{") {
      items = [];
      while (!is("}")) {
        a = expr();
        expect(":");
        items.push([a, expr()]);
        if (!accept(",")) break;
      }
      expect("}");
      return ["dict", items];
    }
    pos--;
    bad();
  }
  // [elem for x in src if cond ...]. Its loop variables get private names so they cannot overwrite
  // a variable of the same name outside, as in Python 3.
  function comprehension(elem) {
    var clauses = [], names = {}, prefix = ".c" + (compId++) + ".", c, t;
    while (accept("for")) {
      t = postfix();
      if (is(",")) { t = ["list", [t]]; while (accept(",")) t[1].push(postfix()); }
      expect("in");
      c = { target: t, src: orE(), conds: [] };
      while (accept("if")) c.conds.push(orE());
      clauses.push(c);
      collect(t);
    }
    function collect(n) {
      if (n[0] === "name") names[n[1]] = 1;
      else if (n[0] === "list") n[1].forEach(collect);
      else bad("cannot assign to that");
    }
    function rename(n) {
      if (n && n.conds) { rename(n.target); rename(n.src); n.conds.forEach(rename); return; }  // a nested clause
      if (!(n instanceof Array) || n[0] === "const") return;
      if (n[0] === "name" && typeof n[1] === "string") { if (names[n[1]]) n[1] = prefix + n[1]; return; }
      n.forEach(rename);
    }
    rename(elem);
    clauses.forEach(function (cl, i) {
      rename(cl.target);
      cl.conds.forEach(rename);
      if (i) rename(cl.src);  // the first source is evaluated outside the comprehension
    });
    return ["comp", elem, clauses];
  }
  function genComp(n, depth) {  // the result list sits under one iterator per enclosing clause
    if (depth === n[2].length) { gen(n[1]); out("APPEND", depth); return; }
    var c = n[2][depth], start, j;
    gen(c.src);
    out("ITER");
    start = here();
    j = out("FOR");
    store(c.target);
    for (var i = 0; i < c.conds.length; i++) { gen(c.conds[i]); out("JF", start); }
    genComp(n, depth + 1);
    out("JMP", start);
    patch(j);
  }
  function fstr(s) {  // f"a {x} b {y:.2f}"
    var parts = [], re = /\{([^{}]*)\}/g, m, last = 0, fix, save;
    while ((m = re.exec(s))) {
      if (m.index > last) parts.push(["const", s.slice(last, m.index)]);
      fix = /^(.*):\.(\d+)f$/.exec(m[1]);
      save = [toks, pos];
      toks = pyLex(fix ? fix[1] : m[1]);
      pos = 0;
      parts.push(fix ? ["fix", expr(), parseInt(fix[2], 10)] : expr());
      if (!isT("NEWLINE")) bad();
      toks = save[0];
      pos = save[1];
      last = re.lastIndex;
    }
    if (last < s.length) parts.push(["const", s.slice(last)]);
    return ["fstr", parts];
  }

  // -- tree -> instructions --
  function gen(n) {
    var i, j, k;
    switch (n[0]) {
    case "const": out("CONST", n[1]); break;
    case "name": out("LOAD", n[1]); break;
    case "bin": gen(n[2]); gen(n[3]); out("BIN", n[1]); break;
    case "cmp": gen(n[2]); gen(n[3]); out("CMP", n[1]); break;
    case "neg": gen(n[1]); out("NEG"); break;
    case "not": gen(n[1]); out("NOT"); break;
    case "and": case "or": gen(n[1]); j = out(n[0] === "and" ? "JFK" : "JTK"); gen(n[2]); patch(j); break;
    case "ifx": gen(n[1]); j = out("JF"); gen(n[2]); k = out("JMP"); patch(j); gen(n[3]); patch(k); break;
    case "list": for (i = 0; i < n[1].length; i++) gen(n[1][i]); out("LIST", n[1].length); break;
    case "comp": out("LIST", 0); genComp(n, 0); break;
    case "dict": for (i = 0; i < n[1].length; i++) { gen(n[1][i][0]); gen(n[1][i][1]); } out("DICT", n[1].length); break;
    case "fstr": for (i = 0; i < n[1].length; i++) gen(n[1][i]); out("FSTR", n[1].length); break;
    case "fix": gen(n[1]); out("FIX", n[2]); break;
    case "idx": gen(n[1]); gen(n[2]); out("INDEX"); break;
    case "slice": gen(n[1]); gen(n[2] || ["const", null]); gen(n[3] || ["const", null]); out("SLICE"); break;
    case "attr": gen(n[1]); out("ATTR", n[2]); break;
    case "call":
      gen(n[1]);
      k = [];
      for (i = 0; i < n[2].length; i++) gen(n[2][i]);
      for (i = 0; i < n[3].length; i++) { k.push(n[3][i][0]); gen(n[3][i][1]); }
      out("CALL", n[2].length, k);
      break;
    }
  }
  function store(n) {  // assigns the value on the stack to a name, an item, or a list of targets
    if (n[0] === "name") out(fn && !fn.globals[n[1]] ? "STOREL" : "STOREG", n[1]);
    else if (n[0] === "idx") { gen(n[1]); gen(n[2]); out("STOREIDX"); }
    else if (n[0] === "list" && n[1].length) { out("UNPACK", n[1].length); for (var i = 0; i < n[1].length; i++) store(n[1][i]); }
    else bad("cannot assign to that");
  }

  // -- statements --
  function block() {
    expect(":");
    if (!isT("NEWLINE")) { simple(); return; }  // "if x: y" on one line
    pos++;
    if (!isT("INDENT")) bad("expected an indented block");
    pos++;
    while (!isT("DEDENT")) stmt();
    pos++;
  }
  function loopBody(start) {  // returns the break jumps to patch
    var lp = { brk: [], cont: start, tries: tries };
    loops.push(lp);
    block();
    loops.pop();
    out("JMP", start);
    return lp.brk;
  }
  function leaveTries() { for (var i = loops[loops.length - 1].tries; i < tries; i++) out("ENDTRY"); }
  function tryStmt() {
    var h = out("TRY"), ends = [], names, next, as, catchAll;
    tries++;
    block();
    tries--;
    out("ENDTRY");
    ends.push(out("JMP"));
    patch(h);
    if (!is("except")) bad("expected 'except'");
    while (accept("except")) {  // the error text is on the stack here
      line = toks[pos - 1].ln;
      names = [];
      as = null;
      if (accept("(")) { do names.push(name()); while (accept(",")); expect(")"); }
      else if (!is(":")) names.push(name());
      if (names.length && accept("as")) as = name();
      next = names.length ? out("EXCEPT", 0, names) : -1;
      if (next < 0) catchAll = true;
      if (as) { out("EXCMSG"); store(["name", as]); } else out("POP");
      block();
      ends.push(out("JMP"));
      if (next >= 0) patch(next);
    }
    if (!catchAll) out("RERAISE");
    for (var k = 0; k < ends.length; k++) patch(ends[k]);
  }
  function stmt() {
    var j, k, start, ends, node, saved, params, nm, defs;
    line = toks[pos].ln;
    if (isT("INDENT")) bad("unexpected indent");
    if (accept("if")) {
      ends = [];
      for (;;) {
        gen(expr());
        j = out("JF");
        block();
        if (is("elif") || is("else")) ends.push(out("JMP"));
        patch(j);
        if (accept("elif")) continue;
        if (accept("else")) block();
        break;
      }
      for (k = 0; k < ends.length; k++) patch(ends[k]);
    } else if (accept("while")) {
      start = here();
      gen(expr());
      j = out("JF");
      ends = loopBody(start);
      patch(j);
      for (k = 0; k < ends.length; k++) patch(ends[k]);
    } else if (accept("for")) {
      node = postfix();
      if (is(",")) { node = ["list", [node]]; while (accept(",")) node[1].push(postfix()); }
      expect("in");
      gen(exprList());
      out("ITER");
      start = here();
      j = out("FOR");
      store(node);
      ends = loopBody(start);
      for (k = 0; k < ends.length; k++) patch(ends[k]);
      out("POP");  // break lands here to drop the iterator; running out of items skips it
      patch(j);
    } else if (accept("try")) tryStmt();
    else if (accept("def")) {
      nm = name();
      expect("(");
      params = [];
      defs = [];
      while (!is(")")) {
        params.push(name());
        if (accept("=")) defs.push(expr());
        else if (defs.length) bad("non-default argument follows default argument");
        if (!accept(",")) break;
      }
      expect(")");
      saved = [code, loops, fn, tries, line];
      code = { ins: [], ln: [] };
      loops = [];
      fn = { globals: {} };
      tries = 0;
      block();
      out("CONST", null);
      out("RET");
      node = { py: code, params: params, name: nm };
      code = saved[0];
      loops = saved[1];
      fn = saved[2];
      tries = saved[3];
      line = saved[4];
      for (k = 0; k < defs.length; k++) gen(defs[k]);  // defaults are evaluated when def runs
      out("MAKEFN", node, defs.length);
      store(["name", nm]);
    } else simple();
  }
  function simple() {
    var node, op, t = toks[pos];
    line = t.ln;
    if (accept("pass")) {}
    else if (accept("break")) {
      if (!loops.length) bad("'break' outside loop");
      leaveTries();
      loops[loops.length - 1].brk.push(out("JMP"));
    } else if (accept("continue")) {
      if (!loops.length) bad("'continue' outside loop");
      leaveTries();
      out("JMP", loops[loops.length - 1].cont);
    } else if (accept("return")) {
      if (!fn) bad("'return' outside function");
      if (isT("NEWLINE") || isT("END")) out("CONST", null); else gen(exprList());
      out("RET");
    } else if (accept("global")) {
      if (!fn) bad("'global' outside function");
      do fn.globals[name()] = 1; while (accept(","));
    } else if (accept("import")) {
      do { op = name(); out("IMPORT", op); store(["name", op]); } while (accept(","));
    } else {
      node = exprList();
      if (accept("=")) { gen(exprList()); store(node); }
      else if (is("+=") || is("-=") || is("*=") || is("/=")) {
        op = toks[pos++].v.charAt(0);
        gen(node);
        gen(exprList());
        out("BIN", op);
        store(node);
      } else { gen(node); out(echo && !fn ? "ECHO" : "POP"); }
    }
    if (isT("NEWLINE")) pos++; else if (!isT("END")) bad();
  }

  while (!isT("END")) stmt();
  return code;
}

// -- values --
function pyType(v) {
  return v === null ? "NoneType" : typeof v === "boolean" ? "bool" : typeof v === "string" ? "str"
    : typeof v === "number" ? (v === Math.floor(v) ? "int" : "float") : v instanceof Array ? "list"
    : v.ks ? "dict" : v.mod ? "module" : v.file !== undefined ? "file" : "function";
}
function pyIsNum(v) { return typeof v === "number" || typeof v === "boolean"; }
function pyTruth(v) {
  return v === null ? false : typeof v === "string" || v instanceof Array ? v.length > 0 : v.ks ? v.ks.length > 0 : !!v;
}
function pyStr(v) {
  var out = [], i;
  if (v === null) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "string") return v;
  if (typeof v === "number") return v === Math.floor(v) && Math.abs(v) < 1e21 ? String(v) : String(parseFloat(v.toPrecision(12)));
  if (v instanceof Array) { for (i = 0; i < v.length; i++) out.push(pyRepr(v[i])); return "[" + out.join(", ") + "]"; }
  if (v.ks) { for (i = 0; i < v.ks.length; i++) out.push(pyRepr(v.ks[i]) + ": " + pyRepr(v.vals[i])); return "{" + out.join(", ") + "}"; }
  if (v.file !== undefined) return "<file '" + v.file + "' mode '" + v.mode + "'>";
  return v.mod ? "<module '" + v.mod + "'>" : "<function " + (v.name || "built-in") + ">";
}
function pyRepr(v) {
  if (typeof v !== "string") return pyStr(v);
  return "'" + v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/'/g, "\\'") + "'";
}
function pyEq(a, b) {
  if (pyIsNum(a) && pyIsNum(b)) return +a === +b;
  if (!(a instanceof Array) || !(b instanceof Array)) return a === b;
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (!pyEq(a[i], b[i])) return false;
  return true;
}
function pyFind(d, k) {  // position of key k in dict d, or -1
  for (var i = 0; i < d.ks.length; i++) if (pyEq(d.ks[i], k)) return i;
  return -1;
}
function pySet(d, k, v) {
  var i = pyFind(d, k);
  if (i < 0) { d.ks.push(k); d.vals.push(v); } else d.vals[i] = v;
}
function pyCmp(op, a, b) {
  var i;
  if (op === "==") return pyEq(a, b);
  if (op === "!=") return !pyEq(a, b);
  if (op === "in" || op === "not in") {
    if (typeof b === "string") {
      if (typeof a !== "string") throw "TypeError: 'in <string>' requires string as left operand";
      i = b.indexOf(a) >= 0;
    } else if (b instanceof Array) { for (i = b.length; i-- && !pyEq(b[i], a);) {} i = i >= 0; }
    else if (b && b.ks) i = pyFind(b, a) >= 0;
    else throw "TypeError: argument of type '" + pyType(b) + "' is not iterable";
    return op === "in" ? i : !i;
  }
  if (!(pyIsNum(a) && pyIsNum(b)) && !(typeof a === "string" && typeof b === "string"))
    throw "TypeError: '" + op + "' not supported between '" + pyType(a) + "' and '" + pyType(b) + "'";
  if (pyIsNum(a)) { a = +a; b = +b; }
  return op === "<" ? a < b : op === ">" ? a > b : op === "<=" ? a <= b : a >= b;
}
function pyBin(op, a, b) {
  var i, out;
  if (pyIsNum(a) && pyIsNum(b)) {
    a = +a;
    b = +b;
    if ((op === "/" || op === "//" || op === "%") && b === 0) throw "ZeroDivisionError: division by zero";
    return op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : op === "/" ? a / b
      : op === "//" ? Math.floor(a / b) : op === "%" ? a - b * Math.floor(a / b) : Math.pow(a, b);
  }
  if (op === "+" && typeof a === "string" && typeof b === "string") return a + b;
  if (op === "+" && a instanceof Array && b instanceof Array) return a.concat(b);
  if (op === "*" && pyIsNum(a)) { i = a; a = b; b = i; }  // 3 * "ab"
  if (op === "*" && pyIsNum(b) && (typeof a === "string" || a instanceof Array)) {
    if (a.length * b > 100000) throw "MemoryError: result is too big";
    for (out = typeof a === "string" ? "" : [], i = 0; i < b; i++) out = out.concat(a);
    return out;
  }
  throw "TypeError: unsupported operand type(s) for " + op + ": '" + pyType(a) + "' and '" + pyType(b) + "'";
}
function pyIndex(a, i) {
  if (a && a.ks) {
    if ((i = pyFind(a, i)) < 0) throw "KeyError: key not found";
    return a.vals[i];
  }
  if (typeof a !== "string" && !(a instanceof Array)) throw "TypeError: '" + pyType(a) + "' object is not subscriptable";
  if (typeof i !== "number" || i !== Math.floor(i)) throw "TypeError: indices must be integers";
  if (i < 0) i += a.length;
  if (i < 0 || i >= a.length) throw "IndexError: " + pyType(a) + " index out of range";
  return typeof a === "string" ? a.charAt(i) : a[i];
}
function pyIter(a) {
  if (typeof a === "string") return a.split("");
  if (a instanceof Array) return a.slice();
  if (a && a.ks) return a.ks.slice();
  if (a && a.file !== undefined) return PY_METHODS.file.readlines(a);  // for line in f
  throw "TypeError: '" + pyType(a) + "' object is not iterable";
}
function pyNum(v, what) {
  if (!pyIsNum(v)) throw "TypeError: " + what + " needs a number, not '" + pyType(v) + "'";
  return +v;
}
function pySorted(a) {
  return pyIter(a).sort(function (x, y) { return pyCmp("<", x, y) ? -1 : pyCmp("<", y, x) ? 1 : 0; });
}

function pyOpenFor(f, m) {
  if (f.closed) throw "ValueError: I/O operation on closed file";
  if (f.mode !== m) throw "UnsupportedOperation: not " + (m === "r" ? "readable" : "writable");
}
// open(name, mode): "r" reads, "w" starts the file empty, "a" adds to its end.
function pyOpen(a, kw) {
  var name = a[0], m = String(a.length > 1 ? a[1] : "mode" in kw ? kw.mode : "r").replace("t", ""), t, err;
  if (typeof name !== "string") throw "TypeError: open() needs a file name";
  if (m === "r") {
    t = lookup(resolve(name));
    if (typeof t !== "string") throw "FileNotFoundError: No such file: '" + name + "'";
    return { file: name, mode: "r", text: t, pos: 0 };
  }
  if (m !== "w" && m !== "a") throw "ValueError: invalid mode '" + m + "' (use 'r', 'w' or 'a')";
  t = m === "a" ? lookup(resolve(name)) : "";
  if (typeof t !== "string") t = "";
  if ((err = write(name, t))) throw "OSError: " + err;
  return { file: name, mode: "w", text: t, pos: 0 };
}

// Methods: PY_METHODS[type][name](self, args)
var PY_METHODS = {
  str: {
    upper: function (s) { return s.toUpperCase(); },
    lower: function (s) { return s.toLowerCase(); },
    strip: function (s) { return s.replace(/^\s+|\s+$/g, ""); },
    split: function (s, a) {
      if (a.length) return s.split(String(a[0]));
      s = s.replace(/^\s+|\s+$/g, "");
      return s ? s.split(/\s+/) : [];
    },
    join: function (s, a) {
      var items = pyIter(a[0]);
      for (var i = 0; i < items.length; i++) if (typeof items[i] !== "string") throw "TypeError: join() needs strings";
      return items.join(s);
    },
    replace: function (s, a) { return s.split(String(a[0])).join(String(a[1])); },
    find: function (s, a) { return s.indexOf(String(a[0])); },
    count: function (s, a) { return a[0] === "" ? s.length + 1 : s.split(String(a[0])).length - 1; },
    startswith: function (s, a) { return s.indexOf(String(a[0])) === 0; },
    endswith: function (s, a) { a = String(a[0]); return s.slice(s.length - a.length) === a; },
    isdigit: function (s) { return /^\d+$/.test(s); },
    isalpha: function (s) { return /^[A-Za-z]+$/.test(s); },
    isupper: function (s) { return /[A-Z]/.test(s) && !/[a-z]/.test(s); },
    islower: function (s) { return /[a-z]/.test(s) && !/[A-Z]/.test(s); }
  },
  list: {
    append: function (l, a) { l.push(a[0]); return null; },
    extend: function (l, a) { var x = pyIter(a[0]); for (var i = 0; i < x.length; i++) l.push(x[i]); return null; },
    insert: function (l, a) { l.splice(pyNum(a[0], "insert()"), 0, a[1]); return null; },
    pop: function (l, a) {
      if (!l.length) throw "IndexError: pop from empty list";
      if (!a.length) return l.pop();
      pyIndex(l, a[0]);
      return l.splice(a[0], 1)[0];
    },
    remove: function (l, a) {
      for (var i = 0; i < l.length; i++) if (pyEq(l[i], a[0])) { l.splice(i, 1); return null; }
      throw "ValueError: list.remove(x): x not in list";
    },
    index: function (l, a) {
      for (var i = 0; i < l.length; i++) if (pyEq(l[i], a[0])) return i;
      throw "ValueError: value is not in list";
    },
    count: function (l, a) { var n = 0; for (var i = 0; i < l.length; i++) if (pyEq(l[i], a[0])) n++; return n; },
    sort: function (l) { var s = pySorted(l); for (var i = 0; i < s.length; i++) l[i] = s[i]; return null; },
    reverse: function (l) { l.reverse(); return null; },
    clear: function (l) { l.length = 0; return null; },
    copy: function (l) { return l.slice(); }
  },
  // Files from open(). Every write goes straight to the file system, so a missing close() loses nothing.
  file: {
    read: function (f) { pyOpenFor(f, "r"); var s = f.text.slice(f.pos); f.pos = f.text.length; return s; },
    readline: function (f) {
      pyOpenFor(f, "r");
      var i = f.text.indexOf("\n", f.pos), e = i < 0 ? f.text.length : i + 1, s = f.text.slice(f.pos, e);
      f.pos = e;
      return s;
    },
    readlines: function (f) { var out = [], s; while ((s = PY_METHODS.file.readline(f))) out.push(s); return out; },
    write: function (f, a) {
      pyOpenFor(f, "w");
      if (typeof a[0] !== "string") throw "TypeError: write() argument must be str, not " + pyType(a[0]);
      f.text += a[0];
      var err = write(f.file, f.text);
      if (err) throw "OSError: " + err;
      return a[0].length;
    },
    close: function (f) { f.closed = true; return null; }
  },
  dict: {
    keys: function (d) { return d.ks.slice(); },
    values: function (d) { return d.vals.slice(); },
    items: function (d) { var out = []; for (var i = 0; i < d.ks.length; i++) out.push([d.ks[i], d.vals[i]]); return out; },
    get: function (d, a) { var i = pyFind(d, a[0]); return i < 0 ? (a.length > 1 ? a[1] : null) : d.vals[i]; }
  }
};

// Starts a Python program; the same contract as basic(). globals: a dict shared by the >>> prompt.
function python(name, text, fg, globals, echo) {
  var code, G = globals || dir(), B = dir(), WAIT = {}, cur = 0, errLine = 0, frames, con;
  try { code = pyCompile(text, echo); } catch (e) { return typeof e === "string" ? e : "SyntaxError: invalid syntax"; }
  frames = [{ code: code, pc: 0, st: [], loc: null }];
  con = program(name, fg, { run: run, line: function () { return cur; },
    brk: function () { return "KeyboardInterrupt (line " + cur + ")"; } });

  function number(s, isInt) {  // int("12") and float("1.5")
    if (pyIsNum(s)) return isInt ? (s < 0 ? Math.ceil(+s) : Math.floor(+s)) : +s;
    if (typeof s !== "string" || !(isInt ? /^\s*[-+]?\d+\s*$/ : /^\s*[-+]?(\d+\.?\d*|\.\d+)\s*$/).test(s))
      throw "ValueError: invalid literal for " + (isInt ? "int" : "float") + "(): " + pyRepr(s);
    return parseFloat(s);
  }
  function best(a, pick) {  // min and max
    var items = a.length === 1 ? pyIter(a[0]) : a, m, i;
    if (!items.length) throw "ValueError: empty sequence";
    for (m = items[0], i = 1; i < items.length; i++) if (pyCmp(pick, items[i], m)) m = items[i];
    return m;
  }
  B.print = function (a, kw) {
    var out = [];
    for (var i = 0; i < a.length; i++) out.push(pyStr(a[i]));
    con.emit(out.join("sep" in kw ? pyStr(kw.sep) : " ") + ("end" in kw ? pyStr(kw.end) : "\n"));
    return null;
  };
  B.input = function (a) {
    if (!fg) throw "RuntimeError: input() needs RUN, not START";
    if (a.length) con.emit(pyStr(a[0]));
    con.ask(function (typed) { frames[frames.length - 1].st.push(typed); });
    return WAIT;
  };
  B.len = function (a) {
    if (typeof a[0] === "string" || a[0] instanceof Array) return a[0].length;
    if (a[0] && a[0].ks) return a[0].ks.length;
    throw "TypeError: object of type '" + pyType(a[0]) + "' has no len()";
  };
  B.str = function (a) { return a.length ? pyStr(a[0]) : ""; };
  B.int = function (a) { return a.length ? number(a[0], true) : 0; };
  B.float = function (a) { return a.length ? number(a[0], false) : 0; };
  B.bool = function (a) { return pyTruth(a.length ? a[0] : null); };
  B.abs = function (a) { return Math.abs(pyNum(a[0], "abs()")); };
  B.round = function (a) { var m = Math.pow(10, a.length > 1 ? pyNum(a[1], "round()") : 0); return Math.round(pyNum(a[0], "round()") * m) / m; };
  B.min = function (a) { return best(a, "<"); };
  B.max = function (a) { return best(a, ">"); };
  B.sum = function (a) { var x = pyIter(a[0]), s = 0; for (var i = 0; i < x.length; i++) s += pyNum(x[i], "sum()"); return s; };
  B.range = function (a) {
    var lo = a.length > 1 ? pyNum(a[0], "range()") : 0, hi = pyNum(a[a.length > 1 ? 1 : 0], "range()");
    var step = a.length > 2 ? pyNum(a[2], "range()") : 1, out = [];
    if (step === 0) throw "ValueError: range() step must not be zero";
    if ((hi - lo) / step > 100000) throw "MemoryError: range is too big";
    for (; step > 0 ? lo < hi : lo > hi; lo += step) out.push(lo);
    return out;
  };
  B.list = function (a) { return a.length ? pyIter(a[0]) : []; };
  B.sorted = function (a) { return pySorted(a[0]); };
  B.reversed = function (a) { return pyIter(a[0]).reverse(); };
  B.enumerate = function (a) { var x = pyIter(a[0]), out = []; for (var i = 0; i < x.length; i++) out.push([i, x[i]]); return out; };
  B.chr = function (a) { return String.fromCharCode(pyNum(a[0], "chr()")); };
  B.ord = function (a) { if (typeof a[0] !== "string" || a[0].length !== 1) throw "TypeError: ord() needs one character"; return a[0].charCodeAt(0); };
  B.type = function (a) { return "<class '" + pyType(a[0]) + "'>"; };
  B.open = pyOpen;

  function module(m) {
    if (m === "random") return { mod: m, m: {
      random: function () { return Math.random(); },
      randint: function (a) { var lo = pyNum(a[0], "randint()"); return lo + Math.floor(Math.random() * (pyNum(a[1], "randint()") - lo + 1)); },
      choice: function (a) { var x = pyIter(a[0]); if (!x.length) throw "IndexError: cannot choose from an empty sequence"; return x[Math.floor(Math.random() * x.length)]; },
      shuffle: function (a) {
        var l = a[0], i, j, t;
        if (!(l instanceof Array)) throw "TypeError: shuffle() needs a list";
        for (i = l.length - 1; i > 0; i--) { j = Math.floor(Math.random() * (i + 1)); t = l[i]; l[i] = l[j]; l[j] = t; }
        return null;
      }
    } };
    if (m === "math") return { mod: m, m: {
      pi: Math.PI,
      sqrt: function (a) { if (pyNum(a[0], "sqrt()") < 0) throw "ValueError: math domain error"; return Math.sqrt(a[0]); },
      floor: function (a) { return Math.floor(pyNum(a[0], "floor()")); },
      ceil: function (a) { return Math.ceil(pyNum(a[0], "ceil()")); },
      sin: function (a) { return Math.sin(pyNum(a[0], "sin()")); },
      cos: function (a) { return Math.cos(pyNum(a[0], "cos()")); },
      pow: function (a) { return Math.pow(pyNum(a[0], "pow()"), pyNum(a[1], "pow()")); }
    } };
    if (m === "time") return { mod: m, m: {
      time: function () { return new Date().getTime() / 1000; },
      sleep: function (a) { con.wake = new Date().getTime() + pyNum(a[0], "sleep()") * 1000; return null; }
    } };
    // PaperOS's own module: the screen and the keyboard, for real-time programs
    if (m === "paper") return { mod: m, m: {
      key: function () { var c = con.keys.charAt(0); con.keys = con.keys.slice(1); return c; },  // "" if none
      cls: function () { con.scr = []; con.row = con.col = 0; return null; },
      locate: function (a) {  // row 1-20, column 1-64, like BASIC's LOCATE
        con.row = Math.min(ROWS, Math.max(1, Math.floor(pyNum(a[0], "locate()")))) - 1;
        con.col = Math.min(COLS, Math.max(1, Math.floor(pyNum(a[1], "locate()")))) - 1;
        return null;
      }
    } };
    throw "ModuleNotFoundError: No module named '" + m + "' (try paper)";
  }
  function attr(o, n) {  // o.n: a module member, or a method bound to o
    var t = pyType(o), tab = PY_METHODS[t];
    if (t === "module" && n in o.m) return o.m[n];
    if (!tab || !tab.hasOwnProperty(n)) throw "AttributeError: '" + t + "' object has no attribute '" + n + "'";
    return function (a) { return tab[n](o, a); };
  }

  // Hands error e to the innermost try block, in this function or a caller. False if there is none.
  function unwind(e) {
    if (typeof e !== "string") return false;  // a bug in the interpreter, not a Python error
    for (var d = frames.length - 1; d >= 0; d--) {
      var t = frames[d].tries;
      if (t && t.length) {
        errLine = cur;
        var h = t.pop(), f = frames[d];
        frames.length = d + 1;
        f.st.length = h.sp;
        f.st.push(e);
        f.pc = h.pc;
        return true;
      }
    }
    return false;
  }
  function excMatches(e, names) {
    var kind = e.split(":")[0], parent = { ZeroDivisionError: "ArithmeticError", IndexError: "LookupError",
      KeyError: "LookupError", FileNotFoundError: "OSError", ModuleNotFoundError: "ImportError" }[kind];
    for (var i = 0; i < names.length; i++)
      if (names[i] === "Exception" || names[i] === kind || names[i] === parent) return true;
    return false;
  }

  // Runs up to 2000 instructions.
  function run(now) {
    var f, ins, st, a, b, c, i, j, n = 0;
    for (;;) try {
      for (; n < 2000 && !con.done && !con.asking && con.wake <= now; n++) {
        f = frames[frames.length - 1];
        if (f.pc >= f.code.ins.length) { con.finish(); break; }  // the end of the program
        cur = f.code.ln[f.pc];
        ins = f.code.ins[f.pc++];
        st = f.st;
        switch (ins[0]) {
        case "CONST": st.push(ins[1]); break;
        case "LOAD":
          a = ins[1];
          if (f.loc && a in f.loc) st.push(f.loc[a]);
          else if (a in G) st.push(G[a]);
          else if (a in B) st.push(B[a]);
          else throw "NameError: name '" + a + "' is not defined";
          break;
        case "STOREL": f.loc[ins[1]] = st.pop(); break;
        case "STOREG": G[ins[1]] = st.pop(); break;
        case "POP": st.pop(); break;
        case "ECHO": a = st.pop(); if (a !== null) con.emit(pyRepr(a) + "\n"); break;
        case "BIN": b = st.pop(); a = st.pop(); st.push(pyBin(ins[1], a, b)); break;
        case "CMP": b = st.pop(); a = st.pop(); st.push(pyCmp(ins[1], a, b)); break;
        case "NEG": st.push(-pyNum(st.pop(), "-")); break;
        case "NOT": st.push(!pyTruth(st.pop())); break;
        case "JMP": f.pc = ins[1]; break;
        case "JF": if (!pyTruth(st.pop())) f.pc = ins[1]; break;
        case "JFK": if (!pyTruth(st[st.length - 1])) f.pc = ins[1]; else st.pop(); break;  // and
        case "JTK": if (pyTruth(st[st.length - 1])) f.pc = ins[1]; else st.pop(); break;   // or
        case "LIST": st.push(st.splice(st.length - ins[1], ins[1])); break;
        case "DICT":
          a = st.splice(st.length - 2 * ins[1], 2 * ins[1]);
          b = { ks: [], vals: [] };
          for (i = 0; i < a.length; i += 2) pySet(b, a[i], a[i + 1]);
          st.push(b);
          break;
        case "FSTR":
          a = st.splice(st.length - ins[1], ins[1]);
          for (b = "", i = 0; i < a.length; i++) b += pyStr(a[i]);
          st.push(b);
          break;
        case "FIX": st.push(pyNum(st.pop(), "the f format").toFixed(ins[1])); break;
        case "INDEX": b = st.pop(); a = st.pop(); st.push(pyIndex(a, b)); break;
        case "SLICE":
          c = st.pop(); b = st.pop(); a = st.pop();
          if (typeof a !== "string" && !(a instanceof Array)) throw "TypeError: '" + pyType(a) + "' object is not subscriptable";
          st.push(a.slice(b === null ? 0 : pyNum(b, "a slice"), c === null ? a.length : pyNum(c, "a slice")));
          break;
        case "STOREIDX":
          b = st.pop(); a = st.pop(); c = st.pop();
          if (a && a.ks) pySet(a, b, c);
          else if (a instanceof Array) { pyIndex(a, b); a[b < 0 ? b + a.length : b] = c; }
          else throw "TypeError: '" + pyType(a) + "' object does not support item assignment";
          break;
        case "ATTR": st.push(attr(st.pop(), ins[1])); break;
        case "CALL":
          c = st.splice(st.length - ins[2].length, ins[2].length);
          b = st.splice(st.length - ins[1], ins[1]);
          a = st.pop();
          if (a && a.py) {
            if (b.length + c.length > a.params.length)
              throw "TypeError: " + a.name + "() takes " + a.params.length + " argument(s) but " + (b.length + c.length) + " were given";
            if (frames.length >= 200) throw "RecursionError: maximum recursion depth exceeded";
            f = { code: a.py, pc: 0, st: [], loc: dir() };
            for (i = 0; i < b.length; i++) f.loc[a.params[i]] = b[i];
            for (i = 0; i < c.length; i++) {
              j = ins[2][i];
              if (a.params.indexOf(j) < 0) throw "TypeError: " + a.name + "() got an unexpected argument '" + j + "'";
              if (j in f.loc) throw "TypeError: " + a.name + "() got multiple values for '" + j + "'";
              f.loc[j] = c[i];
            }
            for (i = 0; i < a.params.length; i++) {
              if (a.params[i] in f.loc) continue;
              j = i - (a.params.length - a.defaults.length);
              if (j < 0) throw "TypeError: " + a.name + "() missing argument '" + a.params[i] + "'";
              f.loc[a.params[i]] = a.defaults[j];
            }
            frames.push(f);
          } else if (typeof a === "function") {
            f = dir();
            for (i = 0; i < c.length; i++) f[ins[2][i]] = c[i];
            a = a(b, f);
            if (a !== WAIT) st.push(a === undefined ? null : a);
          } else throw "TypeError: '" + pyType(a) + "' object is not callable";
          break;
        case "RET": a = st.pop(); frames.pop(); frames[frames.length - 1].st.push(a); break;
        case "ITER": st.push({ items: pyIter(st.pop()), i: 0 }); break;
        case "FOR":
          a = st[st.length - 1];
          if (a.i < a.items.length) st.push(a.items[a.i++]); else { st.pop(); f.pc = ins[1]; }
          break;
        case "UNPACK":
          a = st.pop();
          if (!(a instanceof Array) || a.length !== ins[1]) throw "ValueError: cannot unpack into " + ins[1] + " names";
          for (i = a.length; i--;) st.push(a[i]);
          break;
        case "IMPORT": st.push(module(ins[1])); break;
        case "APPEND": a = st.pop(); st[st.length - 1 - ins[1]].push(a); break;
        case "MAKEFN":
          st.push({ py: ins[1].py, params: ins[1].params, name: ins[1].name,
                    defaults: st.splice(st.length - ins[2], ins[2]) });
          break;
        case "TRY": (f.tries || (f.tries = [])).push({ pc: ins[1], sp: st.length }); break;
        case "ENDTRY": f.tries.pop(); break;
        case "EXCEPT": if (!excMatches(st[st.length - 1], ins[2])) f.pc = ins[1]; break;
        case "EXCMSG": a = st.pop(); st.push(a.slice(a.indexOf(":") + 2)); break;
        case "RERAISE": cur = errLine; throw st.pop();  // report the line that failed, not the except
        }
      }
      return;
    } catch (e) {
      n++;
      if (unwind(e)) continue;
      con.endLine();
      con.emit((typeof e === "string" ? e : "InternalError: " + e) + " (line " + cur + ")\n");
      con.finish();
      return;
    }
  }
  return con.start();
}

// The PYTHON command: the >>> prompt. A line ending in ":" starts a block, finished by an empty line.
function pythonPrompt() {
  var G = dir(), buf = [];
  print("PaperOS Python (a small subset of Python 3). exit() leaves.");
  mode = { prompt: ">>> ", line: function (t) {
    var r;
    if (!buf.length && /^\s*(exit|quit)\(\)\s*$/.test(t)) { mode = null; return; }
    if (buf.length ? t !== "" : /:\s*$/.test(t)) { buf.push(t); this.prompt = "... "; return; }
    if (buf.length) { t = buf.join("\n"); buf = []; this.prompt = ">>> "; }
    if (!/\S/.test(t)) return;
    r = python("PYTHON", t, true, G, true);
    if (typeof r === "string") print(r);
  } };
}

// ---- C: a subset compiled to bytecode and run on byte-addressed memory, so pointers are real ----
// Memory: 0-4095 unmapped (NULL), read-only strings, globals, heap, then the stack growing down.
var C_MEM = 524288, C_RO = 4096, C_DATA = 20480, C_STACK = 131072, C_FN = 0x40000000;
// value kinds: i8 u8 i16 u16 i32 u32 i64 f32 f64 bool. long long is kept in a double, exact to 2^53.
var C_SIZE = [1, 1, 2, 2, 4, 4, 8, 4, 8, 1];
var C_F32 = typeof Float32Array === "undefined" ? null : new Float32Array(1);
var C_NOTCONST = {};
var C_OP = {};
(function () {
  var names = ("PUSH LEA LOAD STORE COPY ZERO POP DUP SWAP OVER ADD SUB MUL IMUL DIV IDIV MOD AND OR XOR SHL SHR USHR " +
    "EQ NE LT LE GT GE NOT NEG BNOT NORM JMP JZ JNZ CALL CALLI RET BUILTIN ENTER ALLOCA").split(" ");
  for (var n = 0; n < names.length; n++) C_OP[names[n]] = n;
})();

function cNumT(name, n, s, fl, rank) { return { k: "num", name: name, n: n, s: s, al: s, fl: fl, rank: rank }; }
var CT = {
  vd: { k: "void", name: "void", s: 1, al: 1 },
  ch: cNumT("char", 0, 1, false, 1), uc: cNumT("unsigned char", 1, 1, false, 1),
  sh: cNumT("short", 2, 2, false, 1), us: cNumT("unsigned short", 3, 2, false, 1),
  "in": cNumT("int", 4, 4, false, 2), ui: cNumT("unsigned int", 5, 4, false, 3),
  ll: cNumT("long long", 6, 8, false, 4), fl: cNumT("float", 7, 4, true, 5),
  db: cNumT("double", 8, 8, true, 6), bo: cNumT("bool", 9, 1, false, 1),
  file: { k: "struct", name: "FILE", f: [], s: 4, al: 4, done: true }
};
function cPtr(t) { return { k: "ptr", to: t, s: 4, al: 4 }; }
function cArr(t, len) { return { k: "arr", to: t, len: len, s: len < 0 ? 0 : len * t.s, al: t.al }; }
function cFun(ret, ps, names, va, np) { return { k: "fn", ret: ret, ps: ps, names: names, va: va, np: np, s: 1, al: 1 }; }
function cWords(s) { var d = dir(), w = s.split(" "); for (var n = 0; n < w.length; n++) d[w[n]] = 1; return d; }
var C_TYPEWORDS = cWords("void char short int long float double signed unsigned struct union enum const volatile static extern register auto inline typedef");
var C_HEADERS = cWords("stdio.h stdlib.h string.h math.h ctype.h time.h stdbool.h limits.h stddef.h");
var C_BINARY = { "*": 10, "/": 10, "%": 10, "+": 9, "-": 9, "<<": 8, ">>": 8, "<": 7, ">": 7, "<=": 7, ">=": 7,
  "==": 6, "!=": 6, "&": 5, "^": 4, "|": 3, "&&": 2, "||": 1 };
var C_MACROS = ["NULL ((void*)0)", "EOF (-1)", "EXIT_SUCCESS 0", "EXIT_FAILURE 1", "RAND_MAX 32767", "INT_MAX 2147483647",
  "INT_MIN (-2147483647-1)", "UINT_MAX 4294967295U", "CHAR_MAX 127", "CHAR_MIN (-128)", "SHRT_MAX 32767", "SHRT_MIN (-32768)",
  "LONG_MAX 2147483647", "LONG_MIN (-2147483647-1)", "CLOCKS_PER_SEC 1000", "M_PI 3.14159265358979323846", "true 1", "false 0"];
// Library functions: name, return type, parameters (. = variable). i int, u size_t, d double, s char*, p void*, F FILE*.
var C_SIGS = dir(), C_NAMES = [];
(function () {
  var list = ("printf i s.;puts i s;putchar i i;getchar i;scanf i s.;sprintf i ss.;snprintf i sus.;sscanf i ss.;gets s s;" +
    "fopen F ss;fclose i F;fgetc i F;getc i F;fputc i iF;putc i iF;fgets s siF;fputs i sF;fprintf i Fs.;fscanf i Fs.;feof i F;fflush i F;" +
    "malloc p u;calloc p uu;realloc p pu;free v p;exit v i;abs i i;labs i i;atoi i s;atol i s;atof d s;rand i;srand v u;" +
    "strlen u s;strcpy s ss;strncpy s ssu;strcat s ss;strncat s ssu;strcmp i ss;strncmp i ssu;strchr s si;strrchr s si;strstr s ss;" +
    "memset p piu;memcpy p ppu;memmove p ppu;memcmp i ppu;" +
    "isalpha i i;isdigit i i;isalnum i i;isspace i i;isupper i i;islower i i;ispunct i i;toupper i i;tolower i i;" +
    "sqrt d d;pow d dd;sin d d;cos d d;tan d d;asin d d;acos d d;atan d d;atan2 d dd;exp d d;log d d;log10 d d;floor d d;ceil d d;fabs d d;fmod d dd;" +
    "time i p;clock i").split(";");
  for (var n = 0; n < list.length; n++) {
    var w = list[n].split(" ");
    C_SIGS[w[0]] = { ret: w[1], ps: (w[2] || "").replace(".", ""), va: /\./.test(w[2] || ""), i: n };
    C_NAMES.push(w[0]);
  }
})();
var C_QSORT = "void qsort(void *b, size_t n, size_t s, int (*c)(const void *, const void *)) {" +
  " char *a = b, t; size_t i, j, k; for (i = 1; i < n; i++) for (j = i; j > 0 && c(a + (j - 1) * s, a + j * s) > 0; j--)" +
  " for (k = 0; k < s; k++) { t = a[(j - 1) * s + k]; a[(j - 1) * s + k] = a[j * s + k]; a[j * s + k] = t; } }";

function cNorm(v, k) {
  switch (k) {
    case 0: return v << 24 >> 24;
    case 1: return v & 255;
    case 2: return v << 16 >> 16;
    case 3: return v & 65535;
    case 4: return v | 0;
    case 5: return v >>> 0;
    case 6:
      if (v !== v) return 0;
      v = v < 0 ? Math.ceil(v) : Math.floor(v);
      if (v > 9007199254740992 || v < -9007199254740992) throw "long long overflow (PaperOS limit is 2^53)";
      return v;
    case 7: C_F32[0] = v; return C_F32[0];
    case 9: return v ? 1 : 0;
  }
  return v;
}
function cImul(a, b) {
  var ah = (a >>> 16) & 65535, al = a & 65535, bh = (b >>> 16) & 65535, bl = b & 65535;
  return (al * bl + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
}

// -- preprocessor and tokens --
function cStrip(s) {  // removes comments, keeping line numbers
  var out = [], i = 0, n = s.length, c, q, j;
  while (i < n) {
    c = s.charAt(i);
    if (c === '"' || c === "'") {
      q = c; out.push(c); i++;
      while (i < n && s.charAt(i) !== q && s.charAt(i) !== "\n") {
        if (s.charAt(i) === "\\") out.push(s.charAt(i++));
        out.push(s.charAt(i++));
      }
      if (s.charAt(i) === q) { out.push(q); i++; }
    } else if (c === "/" && s.charAt(i + 1) === "/") {
      while (i < n && s.charAt(i) !== "\n") i++;
    } else if (c === "/" && s.charAt(i + 1) === "*") {
      j = s.indexOf("*/", i + 2);
      if (j < 0) throw "Line " + (s.slice(0, i).split("\n").length) + ": comment is never closed";
      out.push(" " + s.slice(i, j).replace(/[^\n]/g, ""));
      i = j + 2;
    } else { out.push(c); i++; }
  }
  return out.join("");
}
function cUnescape(s, ln) {
  var out = "", i = 0, c, m;
  while (i < s.length) {
    c = s.charAt(i++);
    if (c !== "\\") { out += c; continue; }
    c = s.charAt(i++);
    if ((m = /^[0-7]{1,3}/.exec(s.slice(i - 1)))) { out += String.fromCharCode(parseInt(m[0], 8) & 255); i += m[0].length - 1; }
    else if (c === "x" && (m = /^[0-9a-fA-F]{1,2}/.exec(s.slice(i)))) { out += String.fromCharCode(parseInt(m[0], 16)); i += m[0].length; }
    else if ("ntrabfv\\'\"?".indexOf(c) >= 0 && c) out += { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", f: "\f", v: "\v", "\\": "\\", "'": "'", '"': '"', "?": "?" }[c];
    else throw "Line " + ln + ": unknown escape \\" + c;
  }
  return out;
}
function cNumber(s) {
  var hex = /^0[xX]/.test(s), suf = (hex ? /[uUlL]*$/ : /[uUlLfF]*$/).exec(s)[0], body = s.slice(0, s.length - suf.length), v;
  if (!hex && /[.eE]/.test(body)) return { k: "num", v: parseFloat(body), ty: /[fF]/.test(suf) ? CT.fl : CT.db };
  v = hex ? parseInt(body, 16) : /^0\d/.test(body) ? parseInt(body, 8) : parseFloat(body);
  return { k: "num", v: v, ty: /[lL][lL]/.test(suf) || v > 4294967295 ? CT.ll : /[uU]/.test(suf) || (hex && v > 2147483647) ? CT.ui : v > 2147483647 ? CT.ll : CT["in"] };
}
function cLexLine(s, ln, out) {
  var re = /\s+|([A-Za-z_]\w*)|(0[xX][0-9a-fA-F]+[uUlL]*|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?[uUlLfF]*)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)+')|(\.\.\.|<<=|>>=|->|\+\+|--|<<|>>|<=|>=|==|!=|&&|\|\||[-+*\/%&|^]=|[-+*\/%&|^~!<>=?:;,.(){}\[\]#])/g;
  var pos = 0, m, t, c;
  while (pos < s.length) {
    re.lastIndex = pos;
    m = re.exec(s);
    if (!m || m.index !== pos) throw "Line " + ln + ": stray character " + s.charAt(pos);
    pos = re.lastIndex;
    if (m[1]) t = { k: "id", v: m[1] };
    else if (m[2]) t = cNumber(m[2]);
    else if (m[3]) t = { k: "str", v: cUnescape(m[3].slice(1, -1), ln) };
    else if (m[4]) {
      c = cUnescape(m[4].slice(1, -1), ln);
      if (c.length !== 1) throw "Line " + ln + ": a char constant holds one character";
      t = { k: "num", v: cNorm(c.charCodeAt(0), 0), ty: CT["in"] };
    } else if (m[5]) t = { k: "op", v: m[5] };
    else continue;
    t.ln = ln;
    out.push(t);
  }
  return out;
}
function cPreprocess(text) {
  var macros = dir(), out = [], cond = [], src = cStrip(text.replace(/\r/g, "")).split("\n"), i, s, m, w, a, ln;
  for (i = 0; i < C_MACROS.length; i++) {
    w = C_MACROS[i].indexOf(" ");
    macros[C_MACROS[i].slice(0, w)] = { body: cLexLine(C_MACROS[i].slice(w + 1), 0, []) };
  }
  function active() { for (var j = 0; j < cond.length; j++) if (!cond[j].on) return false; return true; }
  function test(e) {
    var d = /^(!?)\s*defined\s*\(?\s*(\w+)\s*\)?$/.exec(e);
    if (d) return !!macros[d[2]] !== !!d[1];
    if (/^\d+$/.test(e)) return +e !== 0;
    throw "Line " + ln + ": #if only understands 0, 1 and defined(X)";
  }
  function expand(list, hide) {
    var res = [], n, t, mac, h, k, args, depth, cur;
    for (n = 0; n < list.length; n++) {
      t = list[n];
      mac = t.k === "id" && !hide[t.v] ? macros[t.v] : undefined;
      if (!mac) { res.push(t); continue; }
      h = dir();
      for (k in hide) h[k] = 1;
      h[t.v] = 1;
      if (!mac.params) { res = res.concat(relabel(expand(mac.body, h), t.ln)); continue; }
      if (!list[n + 1] || list[n + 1].v !== "(" || list[n + 1].k !== "op") { res.push(t); continue; }
      args = []; cur = []; depth = 0;
      for (n += 2; n < list.length; n++) {
        k = list[n].k === "op" ? list[n].v : "";
        if (k === ")" && !depth) break;
        if (k === "," && !depth) { args.push(cur); cur = []; continue; }
        if (k === "(") depth++;
        if (k === ")") depth--;
        cur.push(list[n]);
      }
      if (n >= list.length) throw "Line " + t.ln + ": macro " + t.v + " call is not closed";
      if (cur.length || args.length) args.push(cur);
      if (args.length !== mac.params.length) throw "Line " + t.ln + ": macro " + t.v + " needs " + mac.params.length + " arguments";
      var body = [];
      for (k = 0; k < mac.body.length; k++) {
        var at = mac.body[k].k === "id" ? mac.params.indexOf(mac.body[k].v) : -1;
        if (at >= 0) body = body.concat(expand(args[at], hide)); else body.push(mac.body[k]);
      }
      res = res.concat(relabel(expand(body, h), t.ln));
    }
    return res;
  }
  function relabel(list, l) {
    var r = [];
    for (var n = 0; n < list.length; n++) {
      var c = {}, k;
      for (k in list[n]) c[k] = list[n][k];
      c.ln = l;
      r.push(c);
    }
    return r;
  }
  for (i = 0; i < src.length; i++) {
    ln = i + 1;
    s = src[i];
    while (/\\\s*$/.test(s) && i + 1 < src.length) s = s.replace(/\\\s*$/, " ") + src[++i];
    m = /^\s*#\s*(\w*)\s*(.*?)\s*$/.exec(s);
    if (!m) { if (active()) out = out.concat(expand(cLexLine(s, ln, []), dir())); continue; }
    w = m[1]; a = m[2];
    if (w === "ifdef" || w === "ifndef" || w === "if") {
      var on = !active() ? false : w === "if" ? test(a) : !!macros[a] === (w === "ifdef");
      cond.push({ on: on, taken: on });
    } else if (w === "else") {
      if (!cond.length) throw "Line " + ln + ": #else without #if";
      var top = cond[cond.length - 1];
      top.on = !top.taken; top.taken = true;
    } else if (w === "endif") {
      if (!cond.length) throw "Line " + ln + ": #endif without #if";
      cond.pop();
    } else if (!active() || w === "pragma" || !w) continue;
    else if (w === "include") {
      var h = /^[<"]([\w.]+)[>"]$/.exec(a);
      if (!h || !C_HEADERS[h[1].toLowerCase()]) throw "Line " + ln + ": cannot include " + a + " (standard headers only)";
    } else if (w === "define") {
      var d = /^([A-Za-z_]\w*)(\(([^)]*)\))?\s*(.*)$/.exec(a);
      if (!d) throw "Line " + ln + ": bad #define";
      macros[d[1]] = { body: cLexLine(d[4], ln, []), params: d[2] ? (d[3].replace(/\s/g, "") ? d[3].replace(/\s/g, "").split(",") : []) : null };
    } else if (w === "undef") delete macros[a];
    else if (w === "error") throw "Line " + ln + ": #error " + a;
    else throw "Line " + ln + ": unknown directive #" + w;
  }
  if (cond.length) throw "Line " + src.length + ": #if without #endif";
  return out;
}

// -- compiler: parses to typed expression trees, and emits statements as it goes --
function cCompile(text) {
  if (typeof DataView === "undefined" || !C_F32) throw "C needs a newer PDF viewer";
  var buf = new ArrayBuffer(C_MEM), mv = new DataView(buf), bytes = new Uint8Array(buf);
  var toks = cPreprocess(text), last = toks.length ? toks[toks.length - 1].ln : 1;
  if (/\bqsort\b/.test(text)) toks = relabelLib(cPreprocess(C_QSORT)).concat(toks);
  toks.push({ k: "eof", v: "end of file", ln: last });
  var p = 0, tok = toks[0], C = [], A = [], L = [], cl = 1, ro = C_RO, gp = C_DATA, strs = dir();
  var funcs = [], scopes = [dir()], tags = [dir()], fn = null, npCalls = [], pend = null;
  scopes[0].size_t = { c: "type", ty: CT.ui };
  scopes[0].time_t = { c: "type", ty: CT["in"] };
  scopes[0].clock_t = { c: "type", ty: CT["in"] };
  scopes[0].FILE = { c: "type", ty: CT.file };
  scopes[0].bool = { c: "type", ty: CT.bo };
  scopes[0]._Bool = { c: "type", ty: CT.bo };
  scopes[0].stdin = { c: "enum", v: 1, ty: cPtr(CT.file) };
  scopes[0].stdout = { c: "enum", v: 2, ty: cPtr(CT.file) };
  scopes[0].stderr = { c: "enum", v: 3, ty: cPtr(CT.file) };

  function relabelLib(list) { for (var n = 0; n < list.length; n++) list[n].ln = 0; return list; }
  function err(m, l) { throw "Line " + (l === undefined ? tok.ln : l) + ": " + m; }
  function next() { var t = tok; tok = toks[++p] || tok; return t; }
  function is(v) { return (tok.k === "op" || tok.k === "id") && tok.v === v; }
  function peekIs(v) { var t = toks[p + 1]; return !!t && (t.k === "op" || t.k === "id") && t.v === v; }
  function accept(v) { if (is(v)) { next(); return true; } return false; }
  function shown() { return tok.k === "str" ? "string" : String(tok.v); }
  function expect(v) {
    if (is(v)) return next();
    err("expected " + v + " before " + shown(), v === ";" && p > 0 ? toks[p - 1].ln : tok.ln);
  }
  function emit(op, a) { C.push(C_OP[op]); A.push(a === undefined ? 0 : a); L.push(cl); return C.length - 1; }
  function patch(i) { A[i] = C.length; }
  function patchAll(list) { for (var n = 0; n < list.length; n++) patch(list[n]); }
  function lookupSym(name) { for (var n = scopes.length - 1; n >= 0; n--) if (scopes[n][name]) return scopes[n][name]; }
  function lookupTag(name) { for (var n = tags.length - 1; n >= 0; n--) if (tags[n][name]) return tags[n][name]; }
  function isType(t) {
    if (t.k !== "id") return false;
    if (C_TYPEWORDS[t.v]) return true;
    var s = lookupSym(t.v);
    return !!s && s.c === "type";
  }
  function pushScope() { scopes.push(dir()); tags.push(dir()); }
  function popScope() { scopes.pop(); tags.pop(); }
  function alignUp(n, a) { return Math.ceil(n / a) * a; }
  function complete(t) {
    if (t.k === "arr") return t.len >= 0 && complete(t.to);
    if (t.k === "struct") return !!t.done;
    return t.k !== "void" && t.k !== "fn";
  }
  function typeName(t) {
    if (t.k === "ptr") return typeName(t.to) + "*";
    if (t.k === "arr") return typeName(t.to) + "[]";
    if (t.k === "fn") return "function";
    if (t.k === "struct") return (t.un ? "union " : "struct ") + (t.name || "");
    return t.name;
  }
  function kindOf(t) { return t.k === "num" ? t.n : 5; }
  function loadable(t) { return t.k === "num" || t.k === "ptr"; }

  // -- types --
  function spec() {
    var s = { st: false, td: false, ext: false, ty: null }, base = null, word = "", un = false, sg = false, lng = 0, sht = false, w, sym;
    while (tok.k === "id") {
      w = tok.v;
      if (w === "const" || w === "volatile" || w === "register" || w === "auto" || w === "inline" || w === "restrict") next();
      else if (w === "static") { s.st = true; next(); }
      else if (w === "extern") { s.ext = true; next(); }
      else if (w === "typedef") { s.td = true; next(); }
      else if (w === "unsigned") { un = true; next(); }
      else if (w === "signed") { sg = true; next(); }
      else if (w === "long") { lng++; next(); }
      else if (w === "short") { sht = true; next(); }
      else if (w === "int" || w === "char" || w === "float" || w === "double" || w === "void") { word = w; next(); }
      else if (w === "struct" || w === "union") base = structSpec(w === "union");
      else if (w === "enum") base = enumSpec();
      else if (!base && !word && !un && !sg && !lng && !sht && (sym = lookupSym(w)) && sym.c === "type") { base = sym.ty; next(); }
      else break;
    }
    if (base) s.ty = base;
    else if (word === "void") s.ty = CT.vd;
    else if (word === "float") s.ty = CT.fl;
    else if (word === "double") s.ty = CT.db;
    else if (word === "char") s.ty = un ? CT.uc : CT.ch;
    else if (sht) s.ty = un ? CT.us : CT.sh;
    else if (lng > 1) s.ty = CT.ll;
    else if (word || un || sg || lng) s.ty = un ? CT.ui : CT["in"];
    else err("expected a type before " + shown());
    return s;
  }
  function structSpec(isUnion) {
    next();
    var name = tok.k === "id" ? next().v : null, t = name ? lookupTag(name) : null, top = tags.length - 1;
    if (is("{")) {
      if (!t || t.done || !tags[top][name]) { t = { k: "struct", name: name, un: isUnion, f: [], s: 0, al: 1, done: false }; if (name) tags[top][name] = t; }
      next();
      var off = 0, max = 0;
      while (!accept("}")) {
        var s = spec();
        if (accept(";")) continue;
        do {
          var d = declarator(s.ty);
          if (!d.name) err("a member needs a name");
          if (!complete(d.ty)) err("member " + d.name + " has an incomplete type");
          off = isUnion ? 0 : alignUp(off, d.ty.al);
          t.f.push({ name: d.name, ty: d.ty, off: off });
          off += d.ty.s;
          if (off > max) max = off;
          if (d.ty.al > t.al) t.al = d.ty.al;
        } while (accept(","));
        expect(";");
      }
      t.s = alignUp(max, t.al);
      t.done = true;
    } else if (!name) err("struct needs a name or a body");
    else if (!t) { t = { k: "struct", name: name, un: isUnion, f: [], s: 0, al: 1, done: false }; tags[top][name] = t; }
    return t;
  }
  function enumSpec() {
    next();
    if (tok.k === "id") next();
    if (accept("{")) {
      var v = 0;
      while (!accept("}")) {
        if (tok.k !== "id") err("expected an enum name");
        var name = next().v;
        if (accept("=")) v = constant(assign());
        scopes[scopes.length - 1][name] = { c: "enum", v: v, ty: CT["in"] };
        v++;
        if (!accept(",")) { expect("}"); break; }
      }
    }
    return CT["in"];
  }
  function replaceHold(t, h, b) {
    if (t === h) return b;
    if (t.k === "ptr") return cPtr(replaceHold(t.to, h, b));
    if (t.k === "arr") { var r = cArr(replaceHold(t.to, h, b), t.len); r.vla = t.vla; return r; }
    if (t.k === "fn") return cFun(replaceHold(t.ret, h, b), t.ps, t.names, t.va, t.np);
    return t;
  }
  function declarator(base) {
    var name = null, ty;
    while (accept("*")) {
      base = cPtr(base);
      while (is("const") || is("volatile") || is("restrict")) next();
    }
    if (is("(") && toks[p + 1] && !peekIs(")") && !isType(toks[p + 1])) {
      next();
      var hold = { k: "hold", s: 0, al: 1 }, inner = declarator(hold);
      expect(")");
      return { name: inner.name, ty: replaceHold(inner.ty, hold, suffix(base)) };
    }
    if (tok.k === "id" && !C_TYPEWORDS[tok.v]) name = next().v;
    ty = suffix(base);
    return { name: name, ty: ty };
  }
  function suffix(b) {
    if (accept("[")) {
      var n = -1, vla = null, e, r, t;
      while (is("static") || is("const")) next();
      if (!is("]")) {
        e = assign();
        try { n = ev(e); if (n <= 0) err("array size must be positive"); }
        catch (x) { if (x !== C_NOTCONST) throw x; vla = e; n = 0; }
      }
      expect("]");
      r = suffix(b);
      if (r.k === "arr" && (r.len < 0 || r.vla)) err("only the first array size may be empty or variable");
      if (r.k === "void" || r.k === "fn") err("bad array element type");
      t = cArr(r, n);
      if (vla) t.vla = vla;
      return t;
    }
    if (accept("(")) return params(b);
    return b;
  }
  function params(ret) {
    var ps = [], names = [], va = false, s, d, t;
    if (accept(")")) return cFun(ret, ps, names, false, true);
    if (is("void") && peekIs(")")) { next(); next(); return cFun(ret, ps, names, false, false); }
    pushScope();  // so that int a[n] can name an earlier parameter
    do {
      if (accept("...")) { va = true; break; }
      s = spec();
      d = declarator(s.ty);
      t = d.ty;
      if (t.k === "arr") t = cPtr(t.to);
      else if (t.k === "fn") t = cPtr(t);
      ps.push(t);
      names.push(d.name);
      if (d.name) scopes[scopes.length - 1][d.name] = { c: "var", ty: t, off: 0 };
    } while (accept(","));
    popScope();
    expect(")");
    return cFun(ret, ps, names, va, false);
  }

  // -- expressions --
  function num(v, ty) { return { o: "num", v: v, ty: ty || CT["in"] }; }
  function deref(a, ty) { return { o: "deref", a: a, ty: ty }; }
  function addrOf(n, ty) {
    if (n.o === "deref") return { o: "retype", a: n.a, ty: ty };
    if (n.ty.k === "struct") return { o: "retype", a: n, ty: ty };  // a struct value is its address
    err("needs a variable (an lvalue)");
  }
  function rv(n) {
    if (n.ty.k === "arr") return addrOf(n, cPtr(n.ty.to));
    if (n.ty.k === "fn") return addrOf(n, cPtr(n.ty));
    return n;
  }
  function cast(n, ty) {
    n = rv(n);
    if (n.ty === ty) return n;
    if (ty.k === "void") return { o: "cast", a: n, ty: ty };
    if (ty.k === "struct" || n.ty.k === "struct" || n.ty.k === "void") err("cannot convert " + typeName(n.ty) + " to " + typeName(ty));
    if (ty.k === "ptr" && n.ty.k === "num" && n.ty.fl) err("cannot convert a float to a pointer");
    if (n.ty.k === "ptr" && ty.k === "num" && ty.fl) err("cannot convert a pointer to a float");
    if (n.o === "num" && ty.k === "num") return num(cNorm(n.v, ty.n), ty);
    return { o: "cast", a: n, ty: ty };
  }
  function promote(t) { return t.rank < 2 ? CT["in"] : t; }
  function usual(a, b) { a = promote(a); b = promote(b); return a.rank >= b.rank ? a : b; }
  function bin(op, a, b, ty) { return { o: "bin", op: op, a: a, b: b, ty: ty }; }
  function scale(i, t) {
    if (i.ty.k !== "num" || i.ty.fl) err("a pointer can only move by an integer");
    if (!complete(t) && t.k !== "void") err("pointer to an incomplete type");
    i = cast(i, CT["in"]);
    if (i.o === "num") return num(i.v * t.s);
    return t.s === 1 ? i : bin("*", i, num(t.s), CT["in"]);
  }
  function mkBin(op, a, b) {
    a = rv(a); b = rv(b);
    var pa = a.ty.k === "ptr", pb = b.ty.k === "ptr", t;
    if ((!pa && a.ty.k !== "num") || (!pb && b.ty.k !== "num")) err("invalid operands to " + op);
    if (op === "&&" || op === "||") return { o: "logic", op: op, a: a, b: b, ty: CT["in"] };
    if (C_BINARY[op] === 7 || C_BINARY[op] === 6) {
      if (!pa && !pb) { t = usual(a.ty, b.ty); a = cast(a, t); b = cast(b, t); }
      return bin(op, a, b, CT["in"]);
    }
    if (pa || pb) {
      if (op === "+" && pa !== pb) return pa ? bin("+", a, scale(b, a.ty.to), a.ty) : bin("+", b, scale(a, b.ty.to), b.ty);
      if (op === "-" && pa && !pb) return bin("-", a, scale(b, a.ty.to), a.ty);
      if (op === "-" && pa && pb) return mkBin("/", bin("-", a, b, CT["in"]), num(a.ty.to.s || 1));
      err("invalid pointer operation " + op);
    }
    if (op === "<<" || op === ">>") {
      t = promote(a.ty);
      if (t.fl || b.ty.fl) err("shift needs integers");
      if (t.n === 6) err("shift on long long is not supported");
      return bin(op, cast(a, t), cast(b, CT["in"]), t);
    }
    t = usual(a.ty, b.ty);
    if ((op === "%" || op === "&" || op === "|" || op === "^") && t.fl) err(op + " needs integers");
    if ((op === "&" || op === "|" || op === "^") && t.n === 6) err(op + " on long long is not supported");
    return bin(op, cast(a, t), cast(b, t), t);
  }
  function calc(op, a, b, ty) {
    var v;
    switch (op) {
      case "+": v = a + b; break;
      case "-": v = a - b; break;
      case "*": v = ty.k === "num" && (ty.fl || ty.n === 6) ? a * b : cImul(a, b); break;
      case "/":
        if (!ty.fl && b === 0) err("division by zero");
        v = a / b;
        if (!ty.fl) v = v < 0 ? Math.ceil(v) : Math.floor(v);
        break;
      case "%": if (b === 0) err("division by zero"); v = a % b; break;
      case "&": v = a & b; break;
      case "|": v = a | b; break;
      case "^": v = a ^ b; break;
      case "<<": v = a << b; break;
      case ">>": v = ty.n === 5 ? a >>> b : a >> b; break;
      case "==": return a === b ? 1 : 0;
      case "!=": return a !== b ? 1 : 0;
      case "<": return a < b ? 1 : 0;
      case "<=": return a <= b ? 1 : 0;
      case ">": return a > b ? 1 : 0;
      case ">=": return a >= b ? 1 : 0;
    }
    return ty.k === "num" ? cNorm(v, ty.n) : v;
  }
  function ev(n) {  // the value of a constant expression; addresses are already known
    var v;
    switch (n.o) {
      case "num": case "addr": return n.v;
      case "retype": return ev(n.a);
      case "cast": v = ev(n.a); return n.ty.k === "num" ? cNorm(v, n.ty.n) : n.ty.k === "ptr" ? v >>> 0 : v;
      case "neg": return cNorm(-ev(n.a), n.ty.n);
      case "bnot": return cNorm(~ev(n.a), n.ty.n);
      case "not": return ev(n.a) ? 0 : 1;
      case "bin": return calc(n.op, ev(n.a), ev(n.b), n.ty);
      case "logic": v = ev(n.a); return n.op === "&&" ? (v && ev(n.b) ? 1 : 0) : (v || ev(n.b) ? 1 : 0);
      case "cond": return ev(n.c) ? ev(n.a) : ev(n.b);
    }
    throw C_NOTCONST;
  }
  function constant(e) {
    try { return ev(e); } catch (x) { if (x === C_NOTCONST) err("needs a constant value"); throw x; }
  }
  function intern(s) {
    if (strs[s] !== undefined) return strs[s];
    if (ro + s.length + 1 > C_DATA) err("too many string constants");
    var a = ro;
    for (var n = 0; n < s.length; n++) bytes[ro++] = s.charCodeAt(n) & 255;
    bytes[ro++] = 0;
    strs[s] = a;
    return a;
  }
  function readStr() { var s = ""; while (tok.k === "str") s += next().v; return s; }
  function primary() {
    var t = tok, s, e;
    if (t.k === "num") { next(); return num(t.v, t.ty); }
    if (t.k === "str") {
      s = readStr();
      return deref({ o: "addr", v: intern(s), ty: cPtr(CT.ch) }, cArr(CT.ch, s.length + 1));
    }
    if (accept("(")) { e = expr(); expect(")"); return e; }
    if (t.k !== "id") err("unexpected " + shown());
    next();
    s = lookupSym(t.v);
    if (!s) {
      if (C_SIGS[t.v] && is("(")) return { o: "lib", name: t.v, ty: CT["in"] };
      err(t.v + " is not declared", t.ln);
    }
    if (s.c === "enum") return num(s.v, s.ty);
    if (s.c === "type") err("unexpected type name " + t.v, t.ln);
    if (s.c === "fn") {
      funcs[s.i].used = t.ln || 1;
      return deref({ o: "addr", v: C_FN + s.i, ty: cPtr(funcs[s.i].ty) }, funcs[s.i].ty);
    }
    e = deref(s.addr !== undefined ? { o: "addr", v: s.addr, ty: cPtr(s.ty) } : { o: "lea", v: s.off, ty: cPtr(s.ty) }, s.ty);
    if (s.vs !== undefined) e.vs = s.vs;
    return e;
  }
  function libType(c) {
    return c === "i" ? CT["in"] : c === "u" ? CT.ui : c === "d" ? CT.db : c === "s" ? cPtr(CT.ch) : c === "F" ? cPtr(CT.file) : c === "v" ? CT.vd : cPtr(CT.vd);
  }
  function vaArg(e) {
    e = rv(e);
    if (e.ty.k === "struct" || e.ty.k === "void") err("cannot pass " + typeName(e.ty) + " here");
    if (e.ty.k === "num") return cast(e, e.ty.fl ? CT.db : promote(e.ty));
    return e;
  }
  function callExpr(f) {
    var args = [], l = tok.ln, n, ft, sig;
    next();
    if (!accept(")")) { do { args.push(assign()); } while (accept(",")); expect(")"); }
    if (f.o === "lib") {
      sig = C_SIGS[f.name];
      if (args.length < sig.ps.length || (!sig.va && args.length > sig.ps.length)) err(f.name + " needs " + sig.ps.length + " arguments", l);
      if (args.length > 60) err("too many arguments", l);
      for (n = 0; n < args.length; n++) args[n] = n < sig.ps.length ? cast(args[n], libType(sig.ps.charAt(n))) : vaArg(args[n]);
      return { o: "call", bi: sig.i, args: args, ty: libType(sig.ret) };
    }
    ft = f.ty.k === "ptr" ? f.ty.to : f.ty;
    if (ft.k !== "fn") err("this is not a function", l);
    if (!ft.np && (args.length < ft.ps.length || (!ft.va && args.length > ft.ps.length))) err("function needs " + ft.ps.length + " arguments, got " + args.length, l);
    for (n = 0; n < args.length; n++) args[n] = n < ft.ps.length ? (ft.ps[n].k === "struct" ? same(args[n], ft.ps[n]) : cast(args[n], ft.ps[n])) : vaArg(args[n]);
    if (f.o === "deref" && f.a.o === "addr" && f.a.v >= C_FN) {
      if (ft.np) npCalls.push({ i: f.a.v - C_FN, n: args.length, ln: l });
      return { o: "call", fi: f.a.v - C_FN, args: args, ty: ft.ret };
    }
    return { o: "call", f: rv(f), args: args, ty: ft.ret };
  }
  function same(e, ty) {
    if (e.ty !== ty) err("expected " + typeName(ty) + ", got " + typeName(e.ty));
    return e;
  }
  function member(base, name, l) {
    var t = base.ty, n;
    if (t.k !== "struct" || !t.done) err("left side is not a complete struct", l);
    for (n = 0; n < t.f.length; n++) {
      if (t.f[n].name === name) {
        var a = base.o === "deref" ? base.a : base;
        return deref(t.f[n].off ? bin("+", { o: "retype", a: a, ty: cPtr(CT.ch) }, num(t.f[n].off), cPtr(t.f[n].ty)) : { o: "retype", a: a, ty: cPtr(t.f[n].ty) }, t.f[n].ty);
      }
    }
    err(typeName(t) + " has no member " + name, l);
  }
  function lvalue(n, l) {
    if (n.o !== "deref" || n.ty.k === "arr" || n.ty.k === "fn") err("left side cannot be assigned to", l);
    return n;
  }
  function incDec(n, op, post) {
    lvalue(n, tok.ln);
    var top = { o: "top", ty: n.ty }, v = cast(mkBin(op, top, num(1)), n.ty);
    return { o: post ? "post" : "opa", a: n, b: v, ty: n.ty };
  }
  function postfix() {
    var e = primary(), l, i;
    for (;;) {
      l = tok.ln;
      if (is("(")) e = callExpr(e);
      else if (e.o === "lib") err(e.name + " must be called");
      else if (accept("[")) {
        i = expr();
        expect("]");
        e = mkBin("+", e, i);
        if (e.ty.k !== "ptr" || e.ty.to.k === "void") err("this cannot be indexed", l);
        e = deref(e, e.ty.to);
      } else if (accept(".")) {
        if (tok.k !== "id") err("expected a member name");
        e = member(e, next().v, l);
      } else if (accept("->")) {
        if (tok.k !== "id") err("expected a member name");
        e = rv(e);
        if (e.ty.k !== "ptr") err("-> needs a pointer", l);
        e = member(deref(e, e.ty.to), next().v, l);
      } else if (is("++") || is("--")) { i = next().v; e = incDec(e, i.charAt(0), true); }
      else return e;
    }
  }
  function typeName2() { var s = spec(); return declarator(s.ty).ty; }
  function unary() {
    var t, e, l = tok.ln;
    if (tok.k === "op") {
      if (is("++") || is("--")) { t = next().v; return incDec(unary(), t.charAt(0), false); }
      if (accept("+")) { e = rv(unary()); return e.ty.k === "num" ? cast(e, promote(e.ty)) : err("bad operand to +", l); }
      if (accept("-")) {
        e = rv(unary());
        if (e.ty.k !== "num") err("bad operand to -", l);
        e = cast(e, promote(e.ty));
        return e.o === "num" ? num(cNorm(-e.v, e.ty.n), e.ty) : { o: "neg", a: e, ty: e.ty };
      }
      if (accept("!")) { e = rv(unary()); if (e.ty.k === "struct") err("bad operand to !", l); return { o: "not", a: e, ty: CT["in"] }; }
      if (accept("~")) {
        e = rv(unary());
        if (e.ty.k !== "num" || e.ty.fl || e.ty.n === 6) err("~ needs an int", l);
        e = cast(e, promote(e.ty));
        return { o: "bnot", a: e, ty: e.ty };
      }
      if (accept("*")) {
        e = rv(unary());
        if (e.ty.k !== "ptr") err("* needs a pointer, got " + typeName(e.ty), l);
        if (e.ty.to.k === "void") err("cannot dereference void*", l);
        if (e.ty.to.k === "struct" && !e.ty.to.done) err("pointer to an incomplete struct", l);
        return deref(e, e.ty.to);
      }
      if (accept("&")) {
        e = unary();
        if (e.ty.k === "fn") return rv(e);
        if (e.o !== "deref") err("& needs a variable", l);
        return addrOf(e, cPtr(e.ty));
      }
      if (is("(") && isType(toks[p + 1])) {
        next();
        t = typeName2();
        expect(")");
        return cast(unary(), t);
      }
    } else if (is("sizeof")) {
      next();
      if (is("(") && isType(toks[p + 1])) {
        next();
        t = typeName2();
        expect(")");
      } else {
        e = unary();
        if (e.vs !== undefined) return deref({ o: "lea", v: e.vs, ty: cPtr(CT.ui) }, CT.ui);
        t = e.ty;
      }
      if (!complete(t) && t.k !== "void") err("sizeof an incomplete type", l);
      return num(t.s, CT.ui);
    }
    return postfix();
  }
  function binary(min) {
    var a = unary(), op, pr;
    for (;;) {
      pr = tok.k === "op" ? C_BINARY[tok.v] : undefined;
      if (!pr || pr < min) return a;
      op = next().v;
      a = mkBin(op, a, binary(pr + 1));
    }
  }
  function conditional() {
    var c = binary(1), a, b, t;
    if (!accept("?")) return c;
    a = rv(expr());
    expect(":");
    b = rv(conditional());
    if (a.ty.k === "num" && b.ty.k === "num") { t = usual(a.ty, b.ty); a = cast(a, t); b = cast(b, t); }
    else if (a.ty.k === "ptr" && b.ty.k === "num") { b = cast(b, a.ty); t = a.ty; }
    else if (b.ty.k === "ptr" && a.ty.k === "num") { a = cast(a, b.ty); t = b.ty; }
    else if (a.ty.k === "ptr" && b.ty.k === "ptr") t = a.ty;
    else if (a.ty === b.ty) t = a.ty;
    else err("the two sides of ?: have different types");
    return { o: "cond", c: rv(c), a: a, b: b, ty: t };
  }
  function assign() {
    var a = conditional(), l = tok.ln, op, v;
    if (tok.k !== "op") return a;
    if (accept("=")) {
      lvalue(a, l);
      v = assign();
      v = a.ty.k === "struct" ? same(v, a.ty) : cast(v, a.ty);
      return { o: "set", a: a, b: v, ty: a.ty };
    }
    if (/^(\+|-|\*|\/|%|&|\||\^|<<|>>)=$/.test(tok.v)) {
      op = next().v.slice(0, -1);
      lvalue(a, l);
      return { o: "opa", a: a, b: cast(mkBin(op, { o: "top", ty: a.ty }, assign()), a.ty), ty: a.ty };
    }
    return a;
  }
  function expr() {
    var a = assign();
    while (accept(",")) { var b = assign(); a = { o: "comma", a: a, b: b, ty: b.ty }; }
    return a;
  }

  // -- code generation: every expression leaves exactly one value; a struct value is its address --
  function store(t) { if (loadable(t)) emit("STORE", kindOf(t)); else emit("COPY", t.s); }
  function norm(t) { if (t.k === "num" && t.n !== 8) emit("NORM", t.n); }
  function alloc(size, al) {
    fn.size = alignUp(fn.size, al);
    var off = fn.size;
    fn.size += size;
    return off;
  }
  function gen(n) {
    var i, j, k;
    switch (n.o) {
      case "num": case "addr": emit("PUSH", n.v); break;
      case "lea": emit("LEA", n.v); break;
      case "top": break;
      case "retype": gen(n.a); break;
      case "deref": gen(n.a); if (loadable(n.ty)) emit("LOAD", kindOf(n.ty)); break;
      case "cast":
        gen(n.a);
        if (n.ty.k === "num") { if (n.a.ty.k !== "num" || n.a.ty.n !== n.ty.n) emit("NORM", n.ty.n); }
        else if (n.ty.k === "ptr" && n.a.ty.k === "num") emit("NORM", 5);
        break;
      case "neg": gen(n.a); emit("NEG"); norm(n.ty); break;
      case "bnot": gen(n.a); emit("BNOT"); norm(n.ty); break;
      case "not": gen(n.a); emit("NOT"); break;
      case "comma": gen(n.a); emit("POP"); gen(n.b); break;
      case "set": gen(n.a.a); gen(n.b); store(n.ty); break;
      case "opa": gen(n.a.a); emit("DUP"); emit("LOAD", kindOf(n.ty)); gen(n.b); store(n.ty); break;
      case "post":
        gen(n.a.a); emit("DUP"); emit("LOAD", kindOf(n.ty)); emit("SWAP"); emit("OVER"); gen(n.b); store(n.ty); emit("POP");
        break;
      case "logic":
        gen(n.a);
        i = emit(n.op === "&&" ? "JZ" : "JNZ");
        gen(n.b);
        j = emit(n.op === "&&" ? "JZ" : "JNZ");
        emit("PUSH", n.op === "&&" ? 1 : 0);
        k = emit("JMP");
        patch(i); patch(j);
        emit("PUSH", n.op === "&&" ? 0 : 1);
        patch(k);
        break;
      case "cond":
        gen(n.c);
        i = emit("JZ");
        gen(n.a);
        j = emit("JMP");
        patch(i);
        gen(n.b);
        patch(j);
        break;
      case "bin":
        gen(n.a); gen(n.b);
        switch (n.op) {
          case "+": emit("ADD"); norm(n.ty); break;
          case "-": emit("SUB"); norm(n.ty); break;
          case "*": emit(n.ty.fl || n.ty.n === 6 ? "MUL" : "IMUL"); norm(n.ty); break;
          case "/": emit(n.ty.fl ? "DIV" : "IDIV"); norm(n.ty); break;
          case "%": emit("MOD"); norm(n.ty); break;
          case "&": emit("AND"); norm(n.ty); break;
          case "|": emit("OR"); norm(n.ty); break;
          case "^": emit("XOR"); norm(n.ty); break;
          case "<<": emit("SHL"); norm(n.ty); break;
          case ">>": emit(n.ty.n === 5 ? "USHR" : "SHR"); norm(n.ty); break;
          case "==": emit("EQ"); break;
          case "!=": emit("NE"); break;
          case "<": emit("LT"); break;
          case "<=": emit("LE"); break;
          case ">": emit("GT"); break;
          case ">=": emit("GE"); break;
        }
        break;
      case "call":
        for (i = 0; i < n.args.length; i++) gen(n.args[i]);
        if (n.bi !== undefined) emit("BUILTIN", n.bi * 64 + n.args.length);
        else if (n.fi !== undefined) emit("CALL", n.fi);
        else { gen(n.f); emit("CALLI"); }
        if (n.ty.k === "struct") {  // keep the returned struct: the callee's frame is about to be reused
          k = alloc(n.ty.s, n.ty.al);
          emit("LEA", k); emit("SWAP"); emit("COPY", n.ty.s);
        }
        break;
      case "lib": err(n.name + " must be called"); break;
      default: err("cannot compile this expression");
    }
  }
  function scalar(e) {
    e = rv(e);
    if (e.ty.k !== "num" && e.ty.k !== "ptr") err("a condition must be a number or pointer");
    return e;
  }

  // -- initializers --
  function setLen(ty, n) { ty.len = n; ty.s = n * ty.to.s; }
  function initExpr() { var e = pend || assign(); pend = null; return e; }
  function pInit(ty, off, out) {
    var br, i, n, e, fs, idx;
    if (ty.k === "arr") {
      if (!pend && ty.to.k === "num" && ty.to.s === 1 && (tok.k === "str" || (is("{") && toks[p + 1].k === "str"))) {
        br = accept("{");
        e = readStr();
        if (br) { accept(","); expect("}"); }
        if (ty.len < 0) setLen(ty, e.length + 1);
        if (e.length > ty.len) err("string is too long for the array");
        out.push({ off: off, ty: ty, str: e });
        return;
      }
      br = !pend && accept("{");
      if (!br && ty.len < 0) err("an array needs { } here");
      for (i = 0, n = 0; br ? !is("}") : i < ty.len;) {
        if (br && accept("[")) { i = constant(assign()); expect("]"); expect("="); }
        if (ty.len >= 0 && i >= ty.len) err("too many initializers");
        pInit(ty.to, off + i * ty.to.s, out);
        i++;
        if (i > n) n = i;
        if (br) { if (!accept(",")) break; }
        else if (i >= ty.len || !is(",") || toks[p + 1].v === "}") break;
        else next();
      }
      if (br) expect("}");
      if (ty.len < 0) setLen(ty, n);
      return;
    }
    if (ty.k === "struct") {
      if (pend || !is("{")) {
        e = initExpr();
        if (e.ty === ty) { out.push({ off: off, ty: ty, e: e }); return; }
        pend = e;
        br = false;
      } else { next(); br = true; }
      fs = ty.f;
      for (idx = 0; br ? !is("}") : idx < fs.length;) {
        if (br && accept(".")) {
          e = tok.v; next(); expect("=");
          for (idx = 0; idx < fs.length && fs[idx].name !== e; idx++);
          if (idx >= fs.length) err(typeName(ty) + " has no member " + e);
        }
        if (idx >= fs.length) err("too many initializers");
        pInit(fs[idx].ty, off + fs[idx].off, out);
        idx = ty.un ? fs.length : idx + 1;
        if (br) { if (!accept(",")) break; }
        else if (idx >= fs.length || !is(",") || toks[p + 1].v === "}") break;
        else next();
      }
      if (br) expect("}");
      return;
    }
    br = !pend && accept("{");
    e = initExpr();
    if (br) { accept(","); expect("}"); }
    out.push({ off: off, ty: ty, e: e });
  }
  function wr(a, k, v) {
    switch (k) {
      case 0: case 1: case 9: mv.setUint8(a, v & 255); break;
      case 2: case 3: mv.setUint16(a, v & 65535, true); break;
      case 4: case 5: mv.setInt32(a, v | 0, true); break;
      case 7: mv.setFloat32(a, v, true); break;
      default: mv.setFloat64(a, v, true);
    }
  }
  function gAlloc(t) {
    gp = alignUp(gp, t.al);
    var a = gp;
    gp += t.s;
    if (gp > C_MEM - C_STACK - 4096) err("too much global data");
    return a;
  }

  // -- declarations --
  function declareFn(name, ty) {
    var s = scopes[0][name];
    if (s && s.c !== "fn") err(name + " is already declared");
    if (!s) { funcs.push({ name: name, ty: ty, pc: -1, used: 0, lib: false }); s = scopes[0][name] = { c: "fn", i: funcs.length - 1 }; }
    else if (!ty.np || funcs[s.i].ty.np) funcs[s.i].ty = ty;
    return funcs[s.i];
  }
  function localVar(d) {
    var t = d.ty, off, sz, s, out, n, o;
    if (scopes[scopes.length - 1][d.name]) err(d.name + " is already declared");
    if (t.vla) {
      if (is("=")) err("a variable-size array cannot have an initializer");
      off = alloc(4, 4); sz = alloc(4, 4);
      scopes[scopes.length - 1][d.name] = { c: "var", ty: cPtr(t.to), off: off, vs: sz };
      emit("LEA", sz);
      gen(mkBin("*", cast(t.vla, CT["in"]), num(t.to.s)));
      emit("STORE", 4); emit("POP");
      emit("LEA", off); emit("LEA", sz); emit("LOAD", 4); emit("ALLOCA", off); emit("STORE", 5); emit("POP");
      return;
    }
    if (!accept("=")) {
      if (!complete(t)) err(d.name + " needs a complete type");
      scopes[scopes.length - 1][d.name] = { c: "var", ty: t, off: alloc(t.s, t.al) };
      return;
    }
    s = { c: "var", ty: t };
    if (complete(t)) { s.off = alloc(t.s, t.al); scopes[scopes.length - 1][d.name] = s; }
    out = [];
    pInit(t, 0, out);
    if (s.off === undefined) { s.off = alloc(t.s, t.al); scopes[scopes.length - 1][d.name] = s; }
    if (t.k === "arr" || t.k === "struct") {
      if (!(out.length === 1 && out[0].ty === t && out[0].e)) { emit("LEA", s.off); emit("ZERO", t.s); }
    }
    for (n = 0; n < out.length; n++) {
      o = out[n];
      emit("LEA", s.off + o.off);
      if (o.str !== undefined) { emit("PUSH", intern(o.str)); emit("COPY", Math.min(o.str.length + 1, o.ty.len)); }
      else { gen(o.ty.k === "struct" ? same(o.e, o.ty) : cast(o.e, o.ty)); store(o.ty); }
      emit("POP");
    }
  }
  function globalVar(d, st) {
    var t = d.ty, out = [], s = st && fn ? undefined : scopes[0][d.name], n, o, v;
    if (t.vla) err("array size must be a constant");
    if (s && s.c !== "var") err(d.name + " is already declared");
    if (accept("=")) {
      if (s && s.inited) err(d.name + " is initialized twice");
      pInit(t, 0, out);
    }
    if (!complete(t)) err(d.name + " needs a complete type");
    if (!s) {
      s = { c: "var", ty: t, addr: gAlloc(t) };
      if (!(st && fn)) scopes[0][d.name] = s;
    }
    if (fn) scopes[scopes.length - 1][d.name] = s;
    if (out.length) s.inited = true;
    for (n = 0; n < out.length; n++) {
      o = out[n];
      if (o.str !== undefined) {
        for (v = 0; v < o.ty.len; v++) bytes[s.addr + o.off + v] = v < o.str.length ? o.str.charCodeAt(v) & 255 : 0;
      } else {
        if (!loadable(o.ty)) err("a global struct needs { } values");
        wr(s.addr + o.off, kindOf(o.ty), constant(cast(o.e, o.ty)));
      }
    }
  }
  function declaration(s) {
    var d, f;
    if (accept(";")) return;
    do {
      d = declarator(s.ty);
      if (!d.name) err("expected a name before " + shown());
      if (s.td) scopes[scopes.length - 1][d.name] = { c: "type", ty: d.ty };
      else if (d.ty.k === "fn") {
        if (is("{")) {
          if (fn) err("a function cannot be defined inside a function");
          defineFn(d);
          return;
        }
        if (!C_SIGS[d.name] || scopes[0][d.name]) declareFn(d.name, d.ty);  // a library prototype changes nothing
      } else if (d.ty.k === "void") err(d.name + " cannot be void");
      else if (fn && !s.st && !s.ext) localVar(d);
      else globalVar(d, s.st);
    } while (accept(","));
    expect(";");
  }
  function defineFn(d) {
    var isLib = tok.ln === 0, f = declareFn(d.name, d.ty), en, n, off, t;
    if (f.pc >= 0 && !f.lib) err(d.name + " is defined twice");
    f.ty = d.ty; f.lib = isLib; f.pc = C.length;
    if (d.ty.ret.k === "struct" && !d.ty.ret.done) err("return type is incomplete");
    fn = { size: 0, ret: d.ty.ret, labels: dir(), gotos: [], brk: [], cont: [], sw: [] };
    cl = tok.ln;
    en = emit("ENTER");
    pushScope();
    var offs = [];
    for (n = 0; n < d.ty.ps.length; n++) {
      t = d.ty.ps[n];
      if (!d.ty.names[n]) err("parameter " + (n + 1) + " of " + d.name + " needs a name");
      if (!complete(t)) err("parameter " + d.ty.names[n] + " has an incomplete type");
      off = alloc(t.s, t.al);
      offs.push(off);
      scopes[scopes.length - 1][d.ty.names[n]] = { c: "var", ty: t, off: off };
    }
    for (n = d.ty.ps.length - 1; n >= 0; n--) { emit("LEA", offs[n]); emit("SWAP"); store(d.ty.ps[n]); emit("POP"); }
    expect("{");
    while (!is("}")) { if (tok.k === "eof") err("missing } at the end of " + d.name); statement(); }
    cl = tok.ln;
    next();
    popScope();
    emit("PUSH", 0);
    emit("RET");
    A[en] = alignUp(fn.size, 8);
    for (n = 0; n < fn.gotos.length; n++) {
      if (fn.labels[fn.gotos[n].name] === undefined) err("label " + fn.gotos[n].name + " is not defined", fn.gotos[n].ln);
      A[fn.gotos[n].at] = fn.labels[fn.gotos[n].name];
    }
    fn = null;
  }

  // -- statements --
  function block() {
    pushScope();
    next();
    while (!is("}")) { if (tok.k === "eof") err("missing }"); statement(); }
    next();
    popScope();
  }
  function loopBody() {
    fn.brk.push([]); fn.cont.push([]);
    statement();
    return { brk: fn.brk.pop(), cont: fn.cont.pop() };
  }
  function statement() {
    var l = tok.ln, e, a, b, c, top, jz, s, n;
    cl = l;
    if (is("{")) return block();
    if (accept(";")) return;
    if (tok.k === "id") {
      if (is("if")) {
        next(); expect("("); e = scalar(expr()); expect(")");
        gen(e); jz = emit("JZ");
        statement();
        if (accept("else")) { a = emit("JMP"); patch(jz); statement(); patch(a); }
        else patch(jz);
        return;
      }
      if (is("while")) {
        next(); expect("("); e = scalar(expr()); expect(")");
        top = C.length;
        gen(e); jz = emit("JZ");
        s = loopBody();
        for (n = 0; n < s.cont.length; n++) A[s.cont[n]] = top;
        cl = l; emit("JMP", top);
        patch(jz); patchAll(s.brk);
        return;
      }
      if (is("do")) {
        next();
        top = C.length;
        s = loopBody();
        expect("while"); expect("("); e = scalar(expr()); expect(")"); expect(";");
        patchAll(s.cont);
        cl = l; gen(e); emit("JNZ", top);
        patchAll(s.brk);
        return;
      }
      if (is("for")) {
        next(); expect("(");
        pushScope();
        if (!accept(";")) {
          if (isType(tok)) declaration(spec());
          else { gen(expr()); emit("POP"); expect(";"); }
        }
        c = is(";") ? null : scalar(expr());
        expect(";");
        b = is(")") ? null : expr();
        expect(")");
        top = C.length;
        cl = l;
        if (c) { gen(c); jz = emit("JZ"); }
        s = loopBody();
        patchAll(s.cont);
        cl = l;
        if (b) { gen(b); emit("POP"); }
        emit("JMP", top);
        if (c) patch(jz);
        patchAll(s.brk);
        popScope();
        return;
      }
      if (is("switch")) {
        next(); expect("("); e = rv(expr()); expect(")");
        if (e.ty.k !== "num" || e.ty.fl) err("switch needs an integer", l);
        e = cast(e, e.ty.n === 6 ? CT.ll : CT["in"]);
        a = alloc(8, 8);
        emit("LEA", a); gen(e); emit("STORE", kindOf(e.ty)); emit("POP");
        jz = emit("JMP");
        c = { cases: [], def: -1 };
        fn.sw.push(c); fn.brk.push([]);
        statement();
        s = fn.brk.pop(); fn.sw.pop();
        b = emit("JMP");
        patch(jz);
        cl = l;
        for (n = 0; n < c.cases.length; n++) {
          emit("LEA", a); emit("LOAD", kindOf(e.ty)); emit("PUSH", c.cases[n].v); emit("EQ"); emit("JNZ", c.cases[n].pc);
        }
        if (c.def >= 0) emit("JMP", c.def);
        patch(b); patchAll(s);
        return;
      }
      if (is("case") || is("default")) {
        if (!fn.sw.length) err(tok.v + " outside a switch");
        c = fn.sw[fn.sw.length - 1];
        if (accept("default")) {
          if (c.def >= 0) err("two default labels", l);
          c.def = C.length;
        } else {
          next();
          a = constant(conditional());
          for (n = 0; n < c.cases.length; n++) if (c.cases[n].v === a) err("duplicate case " + a, l);
          c.cases.push({ v: a, pc: C.length });
        }
        expect(":");
        if (is("}")) return;
        return statement();
      }
      if (is("break")) {
        next(); expect(";");
        if (!fn.brk.length) err("break outside a loop or switch", l);
        fn.brk[fn.brk.length - 1].push(emit("JMP"));
        return;
      }
      if (is("continue")) {
        next(); expect(";");
        if (!fn.cont.length) err("continue outside a loop", l);
        fn.cont[fn.cont.length - 1].push(emit("JMP"));
        return;
      }
      if (is("return")) {
        next();
        if (accept(";")) { emit("PUSH", 0); emit("RET"); return; }
        e = expr();
        expect(";");
        if (fn.ret.k === "void") { gen(e); emit("POP"); emit("PUSH", 0); }
        else gen(fn.ret.k === "struct" ? same(e, fn.ret) : cast(e, fn.ret));
        emit("RET");
        return;
      }
      if (is("goto")) {
        next();
        if (tok.k !== "id") err("goto needs a label");
        fn.gotos.push({ name: tok.v, at: emit("JMP"), ln: l });
        next(); expect(";");
        return;
      }
      if (peekIs(":") && !isType(tok)) {
        if (fn.labels[tok.v] !== undefined) err("label " + tok.v + " is defined twice");
        fn.labels[tok.v] = C.length;
        next(); next();
        if (is("}")) return;
        return statement();
      }
      if (isType(tok)) return declaration(spec());
    }
    e = expr();
    expect(";");
    gen(e);
    emit("POP");
  }

  while (tok.k !== "eof") declaration(spec());
  for (var n = 0; n < funcs.length; n++)
    if (funcs[n].pc < 0 && funcs[n].used) err("function " + funcs[n].name + " has no body", funcs[n].used);
  for (n = 0; n < npCalls.length; n++)
    if (funcs[npCalls[n].i].ty.ps.length !== npCalls[n].n && !funcs[npCalls[n].i].ty.np)
      err(funcs[npCalls[n].i].name + " needs " + funcs[npCalls[n].i].ty.ps.length + " arguments", npCalls[n].ln);
  var ms = scopes[0].main;
  if (!ms || ms.c !== "fn" || funcs[ms.i].pc < 0) throw "No main() function";
  return { C: C, A: A, L: L, funcs: funcs, main: funcs[ms.i], mv: mv, bytes: bytes, heap: alignUp(gp, 8) };
}

// -- the machine: runs a slice per scheduler tick, so loops and input never freeze the viewer --
function cProgram(name, text, fg, argv) {
  var P, con;
  try { P = cCompile(text); }
  catch (e) {
    if (typeof e === "string") return name + ": " + e;
    return name + ": program is too complex to compile";
  }
  var C = P.C, A = P.A, L = P.L, funcs = P.funcs, mv = P.mv, bytes = P.bytes;
  var pc = P.main.pc, fp = C_MEM, sp = C_MEM, st = [], t = -1, rs = [], vl = null, WAIT = {};
  var hBase = P.heap, hEnd = C_MEM - C_STACK, blocks = [], freed = {}, seed = new Date().getTime() % 32768;
  var stdin = { buf: "", pos: 0, more: true, eof: false }, fh = [null, stdin, { out: true }, { out: true }];
  con = program(name, fg, { run: run, line: function () { return L[Math.max(0, pc - 1)] || 0; },
    brk: function () { flushFiles(); return "^C (line " + (L[Math.max(0, pc - 1)] || 0) + ")"; } });

  function fault(a) {
    throw "Segmentation fault: " + (a < 4096 && a >= 0 ? "NULL pointer" : "bad address 0x" + (a >>> 0).toString(16));
  }
  function rd(a, k) {
    if (!(a >= C_RO) || a + C_SIZE[k] > C_MEM) fault(a);
    switch (k) {
      case 0: return mv.getInt8(a);
      case 1: case 9: return bytes[a];
      case 2: return mv.getInt16(a, true);
      case 3: return mv.getUint16(a, true);
      case 4: return mv.getInt32(a, true);
      case 5: return mv.getUint32(a, true);
      case 7: return mv.getFloat32(a, true);
    }
    return mv.getFloat64(a, true);
  }
  function wr(a, k, v) {
    if (!(a >= C_DATA) || a + C_SIZE[k] > C_MEM) {
      if (a >= C_RO && a < C_DATA) throw "Segmentation fault: string is read-only";
      fault(a);
    }
    switch (k) {
      case 0: case 1: case 9: bytes[a] = v & 255; break;
      case 2: case 3: mv.setUint16(a, v & 65535, true); break;
      case 4: case 5: mv.setInt32(a, v | 0, true); break;
      case 7: mv.setFloat32(a, v, true); break;
      default: mv.setFloat64(a, v, true);
    }
  }
  function canRead(a, n) { if (n > 0 && (!(a >= C_RO) || a + n > C_MEM)) fault(a); }
  function canWrite(a, n) {
    if (n <= 0) return;
    if (a >= C_RO && a < C_DATA) throw "Segmentation fault: string is read-only";
    if (!(a >= C_DATA) || a + n > C_MEM) fault(a);
  }
  function copy(d, s, n) {
    var i;
    canRead(s, n); canWrite(d, n);
    if (d <= s) for (i = 0; i < n; i++) bytes[d + i] = bytes[s + i];
    else for (i = n - 1; i >= 0; i--) bytes[d + i] = bytes[s + i];
  }
  function cstr(a) {
    var out = [], c;
    for (;;) {
      if (!(a >= C_RO) || a >= C_MEM) fault(a);
      c = bytes[a++];
      if (!c) return out.join("");
      out.push(String.fromCharCode(c));
    }
  }
  function putStr(a, s) {
    canWrite(a, s.length + 1);
    for (var i = 0; i < s.length; i++) bytes[a + i] = s.charCodeAt(i) & 255;
    bytes[a + s.length] = 0;
  }
  function hAlloc(n) {
    if (n > hEnd - hBase) return 0;
    n = Math.max(8, Math.ceil(n / 8) * 8);
    var at = hBase, i;
    for (i = 0; i < blocks.length; i++) {
      if (blocks[i].a - at >= n) break;
      at = blocks[i].a + blocks[i].n;
    }
    if (at + n > hEnd) return 0;
    blocks.splice(i, 0, { a: at, n: n, want: n });
    delete freed[at];
    return at;
  }
  function hFind(a) {
    for (var i = 0; i < blocks.length; i++) if (blocks[i].a === a) return i;
    throw freed[a] ? "free(): this memory was already freed" : "free(): not a pointer from malloc";
  }
  function output(s) { con.emit(s.replace(/\r/g, "").replace(/\t/g, "    ")); }
  function needInput() {
    if (!fg) throw "input needs RUN, not START";
    con.ask(function (typed) {
      stdin.buf = stdin.buf.slice(stdin.pos) + typed + "\n";
      stdin.pos = 0;
      run();  // at once, so the next scanf is already listening for type-ahead
    });
    return WAIT;
  }
  function floatText(v, c, prec, alt) {
    var low = c.toLowerCase(), a = Math.abs(v), s, e, P;
    if (v !== v) s = "nan";
    else if (a === Infinity) s = "inf";
    else {
      prec = prec < 0 ? 6 : Math.min(prec, 20);
      if (low === "f") s = a.toFixed(prec);
      else if (low === "e") s = expText(a, prec);
      else {
        P = prec === 0 ? 1 : prec;
        e = a === 0 ? 0 : parseInt(a.toExponential(P - 1).split("e")[1], 10);
        if (e < -4 || e >= P) {
          s = expText(a, P - 1);
          if (!alt) s = s.replace(/\.?0+e/, "e");
        } else {
          s = a.toFixed(P - 1 - e);
          if (!alt && s.indexOf(".") >= 0) s = s.replace(/\.?0+$/, "");
        }
      }
    }
    return c === low ? s : s.toUpperCase();
  }
  function expText(a, prec) {
    return a.toExponential(prec).replace(/e([-+])(\d+)$/, function (m, g, d) { return "e" + g + (d.length < 2 ? "0" + d : d); });
  }
  function format(f, a, at) {
    function arg() {
      if (at >= a.length) throw "printf: format needs more arguments";
      return a[at++];
    }
    return cstr(f).replace(/%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d*))?(hh|h|ll|l|L|z|j|t)?([a-zA-Z%])/g, function (m, flags, w, pr, len, c) {
      if (c === "%") return "%";
      var left = flags.indexOf("-") >= 0, zero = flags.indexOf("0") >= 0, plus = flags.indexOf("+") >= 0, space = flags.indexOf(" ") >= 0;
      var alt = flags.indexOf("#") >= 0, width = w === "*" ? arg() : +(w || 0), prec = pr === undefined ? -1 : pr === "*" ? arg() : +(pr || 0);
      var sign = "", body, v, isInt = false;
      if (width < 0) { left = true; width = -width; }
      switch (c) {
        case "d": case "i":
          v = arg();
          v = len === "ll" ? cNorm(v, 6) : v | 0;
          sign = v < 0 ? "-" : plus ? "+" : space ? " " : "";
          body = String(Math.abs(v));
          isInt = true;
          break;
        case "u": case "x": case "X": case "o":
          v = arg();
          v = len === "ll" ? Math.abs(cNorm(v, 6)) : v >>> 0;
          body = v.toString(c === "u" ? 10 : c === "o" ? 8 : 16);
          if (c === "X") body = body.toUpperCase();
          if (alt && v && c !== "u") sign = c === "o" ? "0" : "0" + c;
          isInt = true;
          break;
        case "c": body = String.fromCharCode(arg() & 255); zero = false; break;
        case "s":
          v = arg();
          body = v === 0 ? "(null)" : cstr(v);
          if (prec >= 0) body = body.slice(0, prec);
          zero = false;
          break;
        case "f": case "F": case "e": case "E": case "g": case "G":
          v = +arg();
          sign = v < 0 || (v === 0 && 1 / v < 0) ? "-" : plus ? "+" : space ? " " : "";
          body = floatText(v, c, prec, alt);
          if (!isFinite(v)) zero = false;
          break;
        case "p": v = arg() >>> 0; body = (v + 4294967296).toString(16).slice(1); sign = "0x"; zero = false; break;
        default: return m;
      }
      if (isInt && prec >= 0) { while (body.length < prec) body = "0" + body; zero = false; }
      var fill = width - sign.length - body.length;
      if (fill <= 0) return sign + body;
      var pad = new Array(fill + 1).join(zero && !left ? "0" : " ");
      return left ? sign + body + pad : zero ? sign + pad + body : pad + sign + body;
    });
  }
  function isWs(c) { return c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f" || c === "\v"; }
  // scanf family. Nothing is consumed until it finishes, so a call that must wait for a line simply runs again.
  function scan(src, f, a, at) {
    var fmt = cstr(f), i = 0, pos = src.pos, count = 0, s = src.buf, c;
    function ended() {
      if (src.more) return needInput();
      src.eof = true;
      src.pos = pos;
      return count ? count : -1;
    }
    while (i < fmt.length) {
      c = fmt.charAt(i);
      if (isWs(c)) {
        while (pos < s.length && isWs(s.charAt(pos))) pos++;
        i++;
        continue;
      }
      if (c !== "%" || fmt.charAt(i + 1) === "%") {
        if (c === "%") i++;
        if (pos >= s.length) return ended();
        if (s.charAt(pos) !== c) { src.pos = pos; return count; }
        pos++; i++;
        continue;
      }
      var m = /^%(\*?)(\d*)(hh|h|ll|l|L|z)?(\[\^?\]?[^\]]*\]|[a-zA-Z])/.exec(fmt.slice(i));
      if (!m) throw "scanf: bad format";
      i += m[0].length;
      var skip = !!m[1], width = m[2] ? +m[2] : 0, len = m[3] || "", conv = m[4].charAt(0), piece, k;
      if (conv !== "c" && conv !== "[" && conv !== "n") while (pos < s.length && isWs(s.charAt(pos))) pos++;
      if (conv === "n") { if (!skip) wr(argOf(), 4, pos - src.pos); continue; }
      if (pos >= s.length) return ended();
      if (conv === "c") {
        k = width || 1;
        if (pos + k > s.length) return ended();
        if (!skip) { var to = argOf(); canWrite(to, k); for (var j = 0; j < k; j++) bytes[to + j] = s.charCodeAt(pos + j) & 255; count++; }
        pos += k;
      } else if (conv === "s" || conv === "[") {
        var neg = conv === "[" && m[4].charAt(1) === "^", set = conv === "[" ? m[4].slice(neg ? 2 : 1, -1) : "";
        k = pos;
        while (k < s.length && (!width || k - pos < width) &&
          (conv === "s" ? !isWs(s.charAt(k)) : (set.indexOf(s.charAt(k)) >= 0) !== neg)) k++;
        if (k === pos) { src.pos = pos; return count; }
        if (!skip) { putStr(argOf(), s.slice(pos, k)); count++; }
        pos = k;
      } else {
        var rest = width ? s.slice(pos, pos + width) : s.slice(pos), r, v;
        if (conv === "d" || conv === "u" || conv === "i") r = /^[-+]?\d+/.exec(rest);
        else if (conv === "x" || conv === "X") r = /^[-+]?(?:0[xX])?[0-9a-fA-F]+/.exec(rest);
        else if (conv === "o") r = /^[-+]?[0-7]+/.exec(rest);
        else if ("fFeEgG".indexOf(conv) >= 0) r = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(rest);
        else throw "scanf: unknown %" + conv;
        if (!r) { src.pos = pos; return count; }
        pos += r[0].length;
        if ("fFeEgG".indexOf(conv) >= 0) {
          v = parseFloat(r[0]);
          if (!skip) { wr(argOf(), len === "l" || len === "L" ? 8 : 7, v); count++; }
        } else {
          v = conv === "x" || conv === "X" ? parseInt(r[0], 16) : conv === "o" ? parseInt(r[0], 8) : parseInt(r[0], 10);
          if (!skip) { wr(argOf(), len === "hh" ? 1 : len === "h" ? 3 : len === "ll" ? 6 : 4, v); count++; }
        }
      }
    }
    src.pos = pos;
    return count;
    function argOf() {
      if (at >= a.length) throw "scanf: format needs more arguments";
      return a[at++];
    }
  }
  function fileOf(h) {
    var f = fh[h];
    if (!f) throw "bad FILE pointer";
    return f;
  }
  function fileWrite(h, s) {
    var f = fileOf(h);
    if (f.out) { output(s); return s.length; }
    if (!f.w) return -1;
    f.buf += s;
    return s.length;
  }
  function fileChar(h) {
    var f = fileOf(h);
    if (f.out) return -1;
    if (f.pos >= f.buf.length) {
      if (f.more) return needInput();
      f.eof = true;
      return -1;
    }
    return f.buf.charCodeAt(f.pos++) & 255;
  }
  function readLine(f, a, max, keep) {
    if (f.out) return 0;
    var nl = f.buf.indexOf("\n", f.pos), end;
    if (nl < 0 && f.more) return needInput();
    if (f.pos >= f.buf.length) { f.eof = true; return 0; }
    end = nl < 0 ? f.buf.length : nl + 1;
    if (max > 0 && end - f.pos > max) end = f.pos + max;
    var s = f.buf.slice(f.pos, end);
    f.pos = end;
    if (!keep) s = s.replace(/\n$/, "");
    putStr(a, s);
    return a;
  }
  function flushFiles() {
    for (var i = 4; i < fh.length; i++) {
      if (fh[i] && fh[i].w) write(fh[i].path, fh[i].buf);
      fh[i] = null;
    }
  }
  function ctype(re) { return function (a) { return a[0] >= 0 && a[0] < 128 && re.test(String.fromCharCode(a[0])) ? 1 : 0; }; }
  function maths(f) { return function (a) { return f(a[0], a[1]); }; }
  function compare(x, y) { return x < y ? -1 : x > y ? 1 : 0; }
  var lib = {
    printf: function (a) { var s = format(a[0], a, 1); output(s); return s.length; },
    puts: function (a) { output(cstr(a[0]) + "\n"); return 0; },
    putchar: function (a) { output(String.fromCharCode(a[0] & 255)); return a[0] & 255; },
    getchar: function () { return fileChar(1); },
    scanf: function (a) { return scan(stdin, a[0], a, 1); },
    sprintf: function (a) { var s = format(a[1], a, 2); putStr(a[0], s); return s.length; },
    snprintf: function (a) {
      var s = format(a[2], a, 3);
      if (a[1] > 0) putStr(a[0], s.slice(0, a[1] - 1));
      return s.length;
    },
    sscanf: function (a) { return scan({ buf: cstr(a[0]), pos: 0, more: false }, a[1], a, 2); },
    gets: function (a) { return readLine(stdin, a[0], 0, false); },
    fopen: function (a) {
      var path = cstr(a[0]), m = cstr(a[1]), kind = m.charAt(0), old = lookup(resolve(path));
      if (m.indexOf("+") >= 0 || "rwa".indexOf(kind) < 0 || !kind) return 0;
      if (isDir(old)) return 0;
      if (kind === "r") {
        if (typeof old !== "string") return 0;
        fh.push({ buf: old, pos: 0, more: false, eof: false });
      } else {
        if (write(path, kind === "a" && old ? old : "")) return 0;
        fh.push({ w: true, path: path, buf: kind === "a" && old ? old : "", pos: 0, more: false, eof: false });
      }
      return fh.length - 1;
    },
    fclose: function (a) {
      var f = fileOf(a[0]);
      if (f.w) write(f.path, f.buf);
      if (a[0] > 3) fh[a[0]] = null;
      return 0;
    },
    fgetc: function (a) { return fileChar(a[0]); },
    getc: function (a) { return fileChar(a[0]); },
    fputc: function (a) { fileWrite(a[1], String.fromCharCode(a[0] & 255)); return a[0] & 255; },
    putc: function (a) { fileWrite(a[1], String.fromCharCode(a[0] & 255)); return a[0] & 255; },
    fgets: function (a) { return a[1] < 2 ? 0 : readLine(fileOf(a[2]), a[0], a[1] - 1, true); },
    fputs: function (a) { return fileWrite(a[1], cstr(a[0])); },
    fprintf: function (a) { return fileWrite(a[0], format(a[1], a, 2)); },
    fscanf: function (a) { return scan(fileOf(a[0]), a[1], a, 2); },
    feof: function (a) { return fileOf(a[0]).eof ? 1 : 0; },
    fflush: function () { return 0; },
    malloc: function (a) { return hAlloc(a[0]); },
    calloc: function (a) {
      var n = a[0] * a[1], at = hAlloc(n);
      for (var i = 0; at && i < n; i++) bytes[at + i] = 0;
      return at;
    },
    realloc: function (a) {
      if (!a[0]) return hAlloc(a[1]);
      var b = blocks[hFind(a[0])], at, old = b.n;
      if (a[1] <= old) return a[0];
      at = hAlloc(a[1]);
      if (!at) return 0;
      copy(at, a[0], old);
      blocks.splice(hFind(a[0]), 1);
      freed[a[0]] = 1;
      return at;
    },
    free: function (a) {
      if (!a[0]) return;
      blocks.splice(hFind(a[0]), 1);
      freed[a[0]] = 1;
    },
    exit: function (a) { end(a[0]); return WAIT; },
    abs: function (a) { return Math.abs(a[0]) | 0; },
    labs: function (a) { return Math.abs(a[0]) | 0; },
    atoi: function (a) { return parseInt(cstr(a[0]), 10) | 0; },
    atol: function (a) { return parseInt(cstr(a[0]), 10) | 0; },
    atof: function (a) { return parseFloat(cstr(a[0])) || 0; },
    rand: function () { seed = (cImul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 16) & 32767; },
    srand: function (a) { seed = a[0] >>> 0; },
    strlen: function (a) { return cstr(a[0]).length; },
    strcpy: function (a) { putStr(a[0], cstr(a[1])); return a[0]; },
    strncpy: function (a) {
      var s = cstr(a[1]), i;
      canWrite(a[0], a[2]);
      for (i = 0; i < a[2]; i++) bytes[a[0] + i] = i < s.length ? s.charCodeAt(i) & 255 : 0;
      return a[0];
    },
    strcat: function (a) { putStr(a[0] + cstr(a[0]).length, cstr(a[1])); return a[0]; },
    strncat: function (a) { putStr(a[0] + cstr(a[0]).length, cstr(a[1]).slice(0, a[2])); return a[0]; },
    strcmp: function (a) { return compare(cstr(a[0]), cstr(a[1])); },
    strncmp: function (a) { return compare(cstr(a[0]).slice(0, a[2]), cstr(a[1]).slice(0, a[2])); },
    strchr: function (a) {
      var s = cstr(a[0]), c = a[1] & 255, i = c ? s.indexOf(String.fromCharCode(c)) : s.length;
      return i < 0 ? 0 : a[0] + i;
    },
    strrchr: function (a) {
      var s = cstr(a[0]), c = a[1] & 255, i = c ? s.lastIndexOf(String.fromCharCode(c)) : s.length;
      return i < 0 ? 0 : a[0] + i;
    },
    strstr: function (a) { var i = cstr(a[0]).indexOf(cstr(a[1])); return i < 0 ? 0 : a[0] + i; },
    memset: function (a) {
      canWrite(a[0], a[2]);
      for (var i = 0; i < a[2]; i++) bytes[a[0] + i] = a[1] & 255;
      return a[0];
    },
    memcpy: function (a) { copy(a[0], a[1], a[2]); return a[0]; },
    memmove: function (a) { copy(a[0], a[1], a[2]); return a[0]; },
    memcmp: function (a) {
      canRead(a[0], a[2]); canRead(a[1], a[2]);
      for (var i = 0; i < a[2]; i++) if (bytes[a[0] + i] !== bytes[a[1] + i]) return bytes[a[0] + i] < bytes[a[1] + i] ? -1 : 1;
      return 0;
    },
    isalpha: ctype(/[A-Za-z]/), isdigit: ctype(/[0-9]/), isalnum: ctype(/[A-Za-z0-9]/), isspace: ctype(/[ \t\n\r\f\v]/),
    isupper: ctype(/[A-Z]/), islower: ctype(/[a-z]/), ispunct: ctype(/[!-\/:-@\[-`{-~]/),
    toupper: function (a) { return a[0] >= 97 && a[0] <= 122 ? a[0] - 32 : a[0]; },
    tolower: function (a) { return a[0] >= 65 && a[0] <= 90 ? a[0] + 32 : a[0]; },
    sqrt: maths(Math.sqrt), pow: maths(Math.pow), sin: maths(Math.sin), cos: maths(Math.cos), tan: maths(Math.tan),
    asin: maths(Math.asin), acos: maths(Math.acos), atan: maths(Math.atan), atan2: maths(Math.atan2), exp: maths(Math.exp),
    log: maths(Math.log), log10: maths(function (x) { return Math.log(x) / Math.LN10; }), floor: maths(Math.floor),
    ceil: maths(Math.ceil), fabs: maths(Math.abs), fmod: maths(function (x, y) { return x % y; }),
    time: function (a) {
      var v = Math.floor(new Date().getTime() / 1000);
      if (a[0]) wr(a[0], 4, v);
      return v;
    },
    clock: function () { return (new Date().getTime() - started) | 0; }
  };
  var started = new Date().getTime(), libs = [];
  for (var li = 0; li < C_NAMES.length; li++) libs.push(lib[C_NAMES[li]]);

  function end(code) {
    flushFiles();
    if (code) { con.endLine(); con.emit("Program exited with code " + code + "\n"); }
    con.finish();
  }
  function die(msg) {
    flushFiles();
    con.endLine();
    con.emit("Runtime error, line " + (L[Math.max(0, pc - 1)] || 0) + ": " + msg + "\n");
    con.finish();
  }
  function run() {
    var n = 40000, a, b, r, f;
    try {
      while (n-- > 0) {
        switch (C[pc++]) {
          case 0: st[++t] = A[pc - 1]; break;
          case 1: st[++t] = fp + A[pc - 1]; break;
          case 2: st[t] = rd(st[t], A[pc - 1]); break;
          case 3: b = st[t--]; wr(st[t], A[pc - 1], b); st[t] = b; break;
          case 4: b = st[t--]; copy(st[t], b, A[pc - 1]); break;
          case 5: a = st[t--]; canWrite(a, A[pc - 1]); for (b = 0; b < A[pc - 1]; b++) bytes[a + b] = 0; break;
          case 6: t--; break;
          case 7: st[t + 1] = st[t]; t++; break;
          case 8: a = st[t]; st[t] = st[t - 1]; st[t - 1] = a; break;
          case 9: st[t + 1] = st[t - 1]; t++; break;
          case 10: b = st[t--]; st[t] += b; break;
          case 11: b = st[t--]; st[t] -= b; break;
          case 12: b = st[t--]; st[t] *= b; break;
          case 13: b = st[t--]; st[t] = cImul(st[t], b); break;
          case 14: b = st[t--]; st[t] /= b; break;
          case 15:
            b = st[t--];
            if (b === 0) throw "Division by zero";
            a = st[t] / b;
            st[t] = a < 0 ? Math.ceil(a) : Math.floor(a);
            break;
          case 16:
            b = st[t--];
            if (b === 0) throw "Division by zero";
            st[t] %= b;
            break;
          case 17: b = st[t--]; st[t] &= b; break;
          case 18: b = st[t--]; st[t] |= b; break;
          case 19: b = st[t--]; st[t] ^= b; break;
          case 20: b = st[t--]; st[t] <<= b; break;
          case 21: b = st[t--]; st[t] >>= b; break;
          case 22: b = st[t--]; st[t] >>>= b; break;
          case 23: b = st[t--]; st[t] = st[t] === b ? 1 : 0; break;
          case 24: b = st[t--]; st[t] = st[t] !== b ? 1 : 0; break;
          case 25: b = st[t--]; st[t] = st[t] < b ? 1 : 0; break;
          case 26: b = st[t--]; st[t] = st[t] <= b ? 1 : 0; break;
          case 27: b = st[t--]; st[t] = st[t] > b ? 1 : 0; break;
          case 28: b = st[t--]; st[t] = st[t] >= b ? 1 : 0; break;
          case 29: st[t] = st[t] ? 0 : 1; break;
          case 30: st[t] = -st[t]; break;
          case 31: st[t] = ~st[t]; break;
          case 32: st[t] = cNorm(st[t], A[pc - 1]); break;
          case 33: pc = A[pc - 1]; break;
          case 34: if (!st[t--]) pc = A[pc - 1]; break;
          case 35: if (st[t--]) pc = A[pc - 1]; break;
          case 36: case 37:
            if (C[pc - 1] === 36) f = funcs[A[pc - 1]];
            else {
              a = st[t--];
              f = funcs[a - C_FN];
              if (!f || f.pc < 0) fault(a);
            }
            if (rs.length >= 40000) throw "Stack overflow (recursion too deep)";
            rs.push(pc, fp, sp, vl);
            vl = null;
            pc = f.pc;
            break;
          case 38:
            if (!rs.length) { end(st[t] | 0); return; }
            vl = rs.pop(); sp = rs.pop(); fp = rs.pop(); pc = rs.pop();
            break;
          case 39:
            a = A[pc - 1] % 64;
            r = libs[(A[pc - 1] - a) / 64](st.slice(t - a + 1, t + 1));
            if (r === WAIT) { pc--; return; }
            t -= a;
            st[++t] = r === undefined ? 0 : r;
            break;
          case 40:
            sp -= A[pc - 1];
            if (sp < C_MEM - C_STACK) throw "Stack overflow (recursion too deep)";
            fp = sp;
            break;
          case 41:
            if (!vl) vl = {};
            if (vl[A[pc - 1]] === undefined) vl[A[pc - 1]] = sp; else sp = vl[A[pc - 1]];
            if (st[t] <= 0) throw "variable-size array needs a positive size";
            sp = Math.floor((sp - st[t]) / 8) * 8;
            if (sp < C_MEM - C_STACK) throw "Stack overflow (array too big)";
            st[t] = sp;
            break;
        }
      }
    } catch (e) {
      if (typeof e !== "string") throw e;
      die(e);
    }
  }

  // main(argc, argv)
  var mainArgs = P.main.ty.ps.length;
  if (mainArgs) {
    var words = [name].concat(argv || []), vec = hAlloc((words.length + 1) * 4);
    for (var wi = 0; wi < words.length; wi++) {
      var sa = hAlloc(words[wi].length + 1);
      putStr(sa, words[wi]);
      mv.setUint32(vec + wi * 4, sa, true);
    }
    st[++t] = words.length;
    if (mainArgs > 1) st[++t] = vec;
  }
  return con.start();
}

// The C app: the code is a real multi-line text field, so the viewer provides arrow keys, clicks,
// selection and paste. A page holds C_PAGE lines plus room for C_SPARE new ones, because the field cannot scroll:
// a scrolled field would slide away from its line numbers, and a script cannot read the scroll position.
var C_PAGE = 20, C_SPARE = 4, C_WRAP = 58, cEd = null, cPending = "";
// Edge edits in its own overlay with a wider line pitch: a page is shorter there, and the line numbers,
// which would point at the wrong rows, are shown only while the cursor is outside the code.
var C_EDGE = app.viewerType === "msdcpdf";
if (C_EDGE) { C_PAGE = 14; C_SPARE = 4; }
function cFocus(on) {
  if (C_EDGE) vis("cgut", !on && !!cEd && cEd.editing);
}
var C_START = ["#include <stdio.h>", "", "int main(void) {", "    printf(\"Hello, C!\\n\");", "    return 0;", "}"];

function cText(v) { return String(v === undefined || v === null ? "" : v).replace(/\r\n?/g, "\n"); }
// One number per code line, and a blank row for each row a long line wraps onto.
function cGutter(text) {
  var t = text.split("\n"), out = [], i, k;
  for (i = 0; i < t.length && out.length < C_PAGE + C_SPARE; i++) {
    out.push(String(cEd.s + i + 1));
    for (k = C_WRAP; k < t[i].length; k += C_WRAP) out.push("");
  }
  doc.getField("cgut").value = out.join("\n");
}
function cKey(e) {  // the code field's keystroke action: only keeps the line numbers current
  if (!cEd) return;
  // Whale's field.value stays stale while typing, so the text is followed here. Caret offsets count a line break as one.
  var v = cText(e.value), ch = cText(e.change), full = cRows(v) >= C_PAGE + C_SPARE;
  if (!e.willCommit) {
    if (ch === "" && e.selStart === e.selEnd) ch = full ? "" : "\n";  // Chromium's viewer reports Enter as an empty change
    v = v.slice(0, e.selStart) + ch + v.slice(e.selEnd);
    // Arrow keys and clicks send no event, so this is honestly the last edit rather than the live cursor.
    var head = v.slice(0, e.selStart + ch.length).split("\n");
    cEd.where = "Last edit: Ln " + (cEd.s + head.length) + ", Col " + (head[head.length - 1].length + 1);
  }
  cEd.live = v;
  cEd.full = cRows(v) >= C_PAGE + C_SPARE;
  showHint();
  cGutter(v);
  var k = v.split("\n").length;
  ui("cpage").value = (cEd.s + 1) + "-" + (cEd.s + k) + " / " + (cEd.code.length - cEd.n + k);
}
function cRows(text) {  // screen rows the text takes, counting wrapped lines
  for (var t = text.split("\n"), n = 0, i = 0; i < t.length; i++) n += Math.max(1, Math.ceil(t[i].length / C_WRAP));
  return n;
}
function cShowPage() {
  var c = cEd.code, text;
  cEd.s = Math.max(0, Math.min(cEd.s, c.length));
  cEd.n = Math.min(C_PAGE, c.length - cEd.s);
  text = c.slice(cEd.s, cEd.s + cEd.n).join("\n");
  doc.getField("cedit").value = text;
  cEd.live = undefined;
  cEd.full = false;
  cEd.where = "";
  cGutter(text);
  ui("cpage").value = (cEd.s + 1) + "-" + (cEd.s + Math.max(cEd.n, 1)) + " / " + Math.max(c.length, cEd.s + 1);
}
// Copies the page back into the program and keeps it on the disk.
function cPull() {
  var t = cEd.live !== undefined ? cEd.live : cText(doc.getField("cedit").value);
  var p = t === "" && !cEd.n ? [] : t.split("\n"), before = cEd.code.join("\n");
  Array.prototype.splice.apply(cEd.code, [cEd.s, cEd.n].concat(p));
  cEd.n = p.length;
  if (cEd.code.join("\n") !== before) { write(cEd.path, cEd.code.join("\n")); cEd.dirty = true; }
}
// Opens MAIN.C, or the file Files asked for. C, Python and BASIC files can run; anything else is plain text.
var cNext = "";
function cWorkspace() {
  var where = cNext || "\\MAIN.C", segs = resolve(where), name = segs[segs.length - 1], old = lookup(segs), fromFiles = !!cNext;
  var ext = (/\.(\w+)$/.exec(name) || [])[1] || "";
  cNext = "";
  cEd = { path: where, name: name, ext: ext, plain: ext !== "C" && ext !== "PY" && ext !== "BAS", fromFiles: fromFiles,
    code: typeof old === "string" && old ? old.split("\n") : ext === "C" ? C_START.slice() : [""], s: 0, n: 0, editing: true, dirty: false };
  if (old === undefined) write(where, cEd.code.join("\n"));
  cEd.mode = mode = { prompt: "", quitKey: "\0", draw: function () { return lines.slice(-ROWS); },
    key: function (c) { if (c !== "\0") cBack(); },
    autosave: function () {
      if (cEd.editing) cPull();
      if (cEd.dirty) print("Saved " + cEd.name);
      mode = null;
    } };
  if (fromFiles) {
    ui("wbar").value = name;
    ui("mapp").value = name;
  }
  cShowPage();
  showWindow(true);
  showHint();
}
function cRun() {
  if (!cEd || !cEd.editing || cEd.plain) return;
  cPull();
  cEd.editing = false;
  lines = [];
  showWindow(true);
  showHint();
  var text = cEd.code.join("\n");
  var r = cEd.ext === "PY" ? python(cEd.name, text, true) : cEd.ext === "BAS" ? basic(cEd.name, text, true) : cProgram(cEd.name, text, true, []);
  if (typeof r === "string") print(r);
  focusIn = 2;
}
function cBack() {
  if (!cEd || cEd.editing) return;
  if (mode !== cEd.mode && mode && mode.key) mode.key("`");  // still running: stop it
  for (var i = lines.length - 1, m, bad = 0; i >= 0; i--) {  // open the page with the line an error names
    m = /^Runtime error, line (\d+)/.exec(lines[i]);
    if (!m && lines[i].indexOf(cEd.name + ": Line ") === 0) m = /Line (\d+)/.exec(lines[i]);
    if (m) { bad = +m[1]; cEd.s = Math.floor(Math.max(bad - 1, 0) / C_PAGE) * C_PAGE; break; }
  }
  cEd.editing = true;
  lines = [];
  cShowPage();
  if (bad) cEd.where = "Error on Ln " + bad;
  showWindow(true);
  showHint();
  focusIn = 2;
}
function cFlip(dir) {
  if (!cEd || !cEd.editing || cEd.closing) return;
  cPull();
  if (dir > 0) { if (cEd.s + cEd.n < cEd.code.length || cEd.n >= C_PAGE) cEd.s += cEd.n; }
  else cEd.s = Math.max(0, cEd.s - C_PAGE);
  // Whale ignores a new value while the field has focus, so park the focus for one tick first.
  var k = ui("kbd");
  vis(uiName("kbd"), true);
  k.setFocus();
  cPending = "show";
}
// Buttons act a tick later, once the viewer has committed what was typed in the code field.
function cAct(what) { cPending = what; }
function cDoPending() {
  var w = cPending;
  cPending = "";
  if (w.slice(0, 2) === "s:") { sAct(w.slice(2)); render(); }
  else if (w.slice(0, 2) === "f:") { fAct(w.slice(2)); render(); }
  else if (fState && (w === "next" || w === "prev")) { fPage(w === "next" ? 1 : -1); render(); }
  else if (w === "run") cRun();
  else if (w === "back") cBack();
  else if (w === "next") cFlip(1);
  else if (w === "prev") cFlip(-1);
  else if (w === "close") closeApp();
  else if (w === "repaint") fRepaint();
  else if (w === "show" && cEd) {
    cShowPage();
    vis(uiName("kbd"), false);
    focusIn = 2;
  }
}

// ---- Settings: wallpaper, light or dark, clock. Kept in C:\SETTINGS.CFG, so they travel with the PDF. ----
// Viewers cannot recolour text at run time, so what sits on the background has a dark twin field named with a D.
var sTheme = 0, sDark = false, sH12 = false, sOpen = false, winOn = false, sPainted = false, rowsL = rows, rowsD = [];
var UI_DARK = { wchrome: 1, wbar: 1, khint: 1, cpage: 1, mapp: 1, clock: 1, gdate: 1, gtip: 1, kbd: 1 };
var S_OPTS = ["w0", "w1", "w2", "w3", "m0", "m1", "c0", "c1"], S_BUTTONS = [];
(function () {
  for (var n = 0; n < S_OPTS.length; n++) S_BUTTONS.push("s_" + S_OPTS[n], "s_" + S_OPTS[n] + "_on");
  for (n = 0; n < ROWS; n++) rowsD.push(doc.getField("rD" + n));
})();
function uiName(n) {
  if (sDark) {
    if (UI_DARK[n]) return n + "D";
    if (/^fh\d/.test(n)) return "fd" + n.slice(2);
  }
  return n;
}
function ui(n) { return doc.getField(uiName(n)); }
// Each display change is slow in Edge and a window switch names over a hundred fields, so only real changes are sent.
var visNow = dir();
function vis(name, on) {
  on = !!on;
  if (visNow[name] === on) return;
  var f = doc.getField(name), want = on ? display.visible : display.hidden, first = visNow[name] === undefined;
  visNow[name] = on;
  // At startup almost everything is already right. Rewriting it all kept Edge's buttons dead for over ten seconds.
  if (first && f.display === want) return;
  f.display = want;
  visDirty = true;
}
// Edge does not repaint after a display change until some field's text changes or the mouse moves, so a click
// on a Dock icon looked dead. Changing this invisible field makes it paint at once.
var visDirty = false, paintFlip = false;
var paintTicks = 0;
function paintFlipField() {
  paintFlip = !paintFlip;
  doc.getField("paint").value = paintFlip ? " " : "  ";
}
function paintNow() {
  if (visDirty) {
    visDirty = false;
    paintTicks = 12;  // Edge applies a large change gradually, so nudge it again a little later
    paintFlipField();
  }
}
function paintTick() {
  if (!paintTicks) return;
  paintTicks--;
  if (paintTicks === 9 || paintTicks === 5 || paintTicks === 0) paintFlipField();
}
function sLoad() {
  var t = root["SETTINGS.CFG"], o = null;
  if (typeof t !== "string") return;
  try { o = JSON.parse(t); } catch (e) { return; }
  if (!o || typeof o !== "object") return;
  if (o.wallpaper === 0 || o.wallpaper === 1 || o.wallpaper === 2 || o.wallpaper === 3) sTheme = o.wallpaper;
  sDark = o.dark === true;
  sH12 = o.h12 === true;
}
// Shows the current wallpaper and moves the on-screen text to the light or dark set of fields.
function sApply() {
  var i, k, t, dk, from, to;
  for (k in UI_DARK) {
    from = doc.getField(sDark ? k : k + "D");
    to = doc.getField(sDark ? k + "D" : k);
    if (k !== "wchrome" && sPainted !== sDark) to.value = from.value;
    vis(sDark ? k : k + "D", false);
  }
  sPainted = sDark;
  for (i = 0; i < ROWS; i++) vis((sDark ? "r" : "rD") + i, false);
  rows = sDark ? rowsD : rowsL;
  shown = [];
  for (i = 0; i < F_ROWS; i++) { vis("fh" + i, false); vis("fd" + i, false); }
  for (t = 0; t < 4; t++) for (dk = 0; dk < 2; dk++)
    if (t || dk) vis("th" + t + dk, t === sTheme && dk === (sDark ? 1 : 0));
  vis(uiName("mapp"), true);
  vis(uiName("clock"), true);
  vis(uiName("gdate"), true);
  clockText = "";
  showWindow(winOn);
}
function settingsApp() {
  sOpen = true;
  mode = { prompt: "", quitKey: "\0", draw: sDraw, key: function () {} };
  showWindow(true);
  showHint();
}
function sDraw() {
  var out = [], i;
  for (i = 0; i < ROWS; i++) out.push("");
  out[0] = "Wallpaper";
  out[4] = "Appearance";
  out[8] = "Clock";
  out[12] = "Storage";
  out[13] = countFiles(root) + " files, " + Math.round(diskText.length / 102.4) / 10 + " KB in this PDF";
  out[14] = saveShown === "unsaved" ? "Changes are not saved yet. Press Ctrl+S." : "No unsaved changes.";
  out[16] = "About";
  out[17] = "PaperOS 2.0, running inside this PDF.";
  return out;
}
function sShow() {
  for (var n = 0; n < S_OPTS.length; n++) {
    var id = S_OPTS[n], v = +id.charAt(1), k = id.charAt(0);
    var on = k === "w" ? v === sTheme : k === "m" ? (v === 1) === sDark : (v === 1) === sH12;
    vis("s_" + id, !on);
    vis("s_" + id + "_on", on);
  }
}
function sAct(id) {
  var k = id.charAt(0), v = +id.charAt(1);
  if (!sOpen) return;
  if (k === "w") sTheme = v;
  else if (k === "m") sDark = v === 1;
  else if (k === "c") sH12 = v === 1;
  write("\\SETTINGS.CFG", JSON.stringify({ wallpaper: sTheme, dark: sDark, h12: sH12 }));
  sApply();
  focusIn = 2;
}
// ---- Files: folders first, one click selects, a click on the selected row (or Enter) opens ----
var F_ROWS = 16, fDir = [], fState = null, fMsg = "", fLast = "", F_BUTTONS = ["fup", "fopen", "fnew", "fdir", "fdel"], F_MARKS = [];
(function () { for (var n = 0; n < F_ROWS; n++) { F_BUTTONS.push("frow" + n); F_MARKS.push("fh" + n); } })();

function filesApp() {
  fState = { sel: 0, clicked: false, naming: null, typed: "", arm: "", msg: fMsg, hl: -1, shown: true, pg: "" };
  fMsg = "";
  for (var it = fItems(), n = 0; n < it.length; n++) if (it[n].name === fLast) fState.sel = n;  // back on the file just closed
  fLast = "";
  mode = { prompt: "", quitKey: "\0", digits: true, typing: function () { return !!fState && !!fState.naming; }, draw: fDraw, key: fKey };
  showWindow(true);
  showHint();
}
function fItems() {
  var d = lookup(fDir), out = [], k;
  if (d === undefined || !isDir(d)) { fDir = []; d = root; }
  for (k in d) out.push({ name: k, dir: isDir(d[k]), size: isDir(d[k]) ? 0 : d[k].length });
  return out.sort(function (a, b) { return a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name < b.name ? -1 : 1; });
}
function fKind(it) {
  if (it.dir) return "Folder";
  var e = (/\.(\w+)$/.exec(it.name) || [])[1];
  return { C: "C code", PY: "Python", BAS: "BASIC", BAT: "Batch", TXT: "Text" }[e] || "File";
}
function fDraw() {
  var s = fState, it = fItems(), out = [pathText(fDir), "  " + padRight("NAME", 28) + padRight("TYPE", 10) + "SIZE"], i, first, h, pg;
  s.sel = Math.max(0, Math.min(s.sel, it.length - 1));
  first = Math.floor(s.sel / F_ROWS) * F_ROWS;
  for (i = first; i < first + F_ROWS && i < it.length; i++)
    out.push((i === s.sel ? "> " : "  ") + padRight(it[i].name + (it[i].dir ? "\\" : ""), 28) + padRight(fKind(it[i]), 10) + (it[i].dir ? "" : it[i].size + " B"));
  if (!it.length) out.push("  This folder is empty.");
  while (out.length < ROWS - 1) out.push("");
  out.push(s.naming ? "New " + s.naming + " name" + (s.naming === "file" ? " (like HELLO.C)" : "") + ": " + s.typed + "_" : s.msg);
  h = it.length && s.shown ? s.sel - first : -1;
  if (h !== s.hl) {
    if (s.hl >= 0) vis(uiName("fh" + s.hl), false);
    if (h >= 0) vis(uiName("fh" + h), true);
    s.hl = h;
  }
  pg = (Math.floor(s.sel / F_ROWS) + 1) + " / " + Math.max(1, Math.ceil(it.length / F_ROWS));
  if (pg !== s.pg) { ui("cpage").value = pg; s.pg = pg; }
  return out;
}
function fKey(c) {
  var s = fState;
  if (!s || c === "\0") return;
  if (s.naming) {
    if (c === "\n" || c === "\r") fCreate();
    else if (c === "\b") s.typed = s.typed.slice(0, -1);
    else if (c === "`") { s.naming = null; s.msg = ""; }
    else if (c >= " " && c <= "~" && s.typed.length < 24) s.typed += c;
    return;
  }
  s.arm = "";
  if (c === "w" || c === "W") { s.sel--; s.clicked = false; s.msg = ""; }
  else if (c === "s" || c === "S") { s.sel++; s.clicked = false; s.msg = ""; }
  else if (c === "\n" || c === "\r") fOpen();
  else if (c === "\b") fUp();
}
function fClick(row) {
  var s = fState;
  if (!s) return;
  var at = Math.floor(s.sel / F_ROWS) * F_ROWS + row;
  focusKeyboard();
  if (at >= fItems().length) return;
  s.naming = null;
  s.arm = "";
  s.msg = "";
  if (at === s.sel && s.clicked) { s.clicked = false; fOpen(); }
  else { s.sel = at; s.clicked = true; }
  render();
}
function fPage(dir) {
  var s = fState, n = fItems().length;
  s.sel = Math.max(0, Math.min(n - 1, (Math.floor(s.sel / F_ROWS) + dir) * F_ROWS));
  s.clicked = false;
  focusIn = 2;
}
function fAct(w) {
  var s = fState;
  if (!s) return;
  focusIn = 2;
  if (w !== "del") s.arm = "";
  if (w === "file" || w === "folder") { s.naming = w; s.typed = ""; s.msg = ""; return; }
  s.naming = null;
  if (w === "open") fOpen();
  else if (w === "up") fUp();
  else if (w === "del") fDelete();
}
function fOpen() {
  var s = fState, it = fItems()[s.sel];
  if (!it) return;
  s.msg = "";
  if (it.dir) { fDir.push(it.name); s.sel = 0; s.clicked = false; return; }
  cNext = "\\" + fDir.concat(it.name).join("\\");
  fLast = it.name;
  openApp("CLANG");
  cPending = "repaint";
}
// Edge can leave fields it changed during a window switch unpainted, so write them once more on the next tick.
function fRepaint() {
  if (!cEd) return;
  var names = ["wbar", "mapp", "khint", "cpage"], f, v, i;
  for (i = 0; i < names.length; i++) { f = ui(names[i]); v = f.value; f.value = ""; f.value = v; }
}
function fUp() {
  var s = fState;
  if (!fDir.length) { s.msg = "This is the top folder."; return; }
  var came = fDir.pop(), it = fItems();
  s.msg = "";
  s.clicked = false;
  for (s.sel = 0; s.sel < it.length - 1 && it[s.sel].name !== came; s.sel++);
}
function fCreate() {
  var s = fState, name = s.typed.replace(/^\s+|\s+$/g, "").toUpperCase(), d = lookup(fDir), it, i;
  if (!/^[A-Z0-9_.-]{1,24}$/.test(name) || /^\.+$/.test(name)) { s.msg = "Use letters, numbers, . _ or - only."; s.naming = null; return; }
  if (d[name] !== undefined) { s.msg = name + " already exists."; s.naming = null; return; }
  d[name] = s.naming === "folder" ? dir() : "";
  s.naming = null;
  s.msg = "Created " + name;
  for (it = fItems(), i = 0; i < it.length; i++) if (it[i].name === name) s.sel = i;
  s.clicked = true;
}
// Deleting asks once: the first press only arms it, and doing anything else disarms it.
function fDelete() {
  var s = fState, it = fItems()[s.sel], d = lookup(fDir), k;
  if (!it) return;
  if (it.dir) for (k in d[it.name]) { s.msg = it.name + " is not empty. Delete its files first."; return; }
  if (s.arm !== it.name) { s.arm = it.name; s.msg = "Delete " + it.name + "? Press Delete again."; return; }
  delete d[it.name];
  if (!isDir(lookup(cwd))) cwd = [];
  s.arm = "";
  s.msg = "Deleted " + it.name;
}

// RUN and START: a .BAS, .PY or .C program, in the foreground or the background.
function launch(file, fg, args) {
  var name = (file || "").replace(/^\\DEMO\\/, "").toUpperCase(), where = onPath(file), t = findProgram(where, ".BAS"), p;
  if (t !== undefined) p = basic(name, t, fg);
  else if ((t = findProgram(where, ".PY")) !== undefined) p = python(name, t, fg);
  else if ((t = findProgram(where, ".C")) !== undefined) p = cProgram(name, t, fg, args);
  else return "File not found - " + (file || "(name a .BAS, .PY or .C file)");
  if (typeof p !== "string" && /^(DODGE|WALK|MOVE)(\.|$)/.test(name)) p.mode.digits = true;
  return typeof p === "string" ? p : fg ? undefined : "[" + p.pid + "] " + p.name + " started in the background";
}

// ---- sample programs ----
root.DEMO = dir();
root.DEMO["HELLO.BAS"] = '10 INPUT "YOUR NAME"; N$\n20 FOR I = 1 TO 3\n30 PRINT "HELLO, "; N$; "!"\n40 NEXT I';
root.DEMO["GUESS.BAS"] = '10 N = INT(RND * 100) + 1 : T = 0\n20 INPUT "GUESS 1-100"; G\n30 T = T + 1\n' +
  '40 IF G < N THEN PRINT "TOO LOW" : GOTO 20\n50 IF G > N THEN PRINT "TOO HIGH" : GOTO 20\n' +
  '60 PRINT "RIGHT IN "; T; " TRIES"';
root.DEMO["MOVE.BAS"] = '10 CLS : X = 30 : Y = 10\n20 LOCATE 1, 1 : PRINT "W A S D MOVE, Q QUITS";\n' +
  '30 LOCATE Y, X : PRINT "@";\n40 K$ = INKEY$ : IF K$ = "" THEN SLEEP 0.05 : GOTO 40\n50 LOCATE Y, X : PRINT " ";\n' +
  '60 IF K$ = "a" AND X > 1 THEN X = X - 1\n70 IF K$ = "d" AND X < 64 THEN X = X + 1\n' +
  '80 IF K$ = "w" AND Y > 2 THEN Y = Y - 1\n90 IF K$ = "s" AND Y < 20 THEN Y = Y + 1\n100 IF K$ <> "q" THEN GOTO 30';
root.DEMO["ALARM.BAS"] = '10 SLEEP 10\n20 PRINT "*** ALARM: 10 SECONDS HAVE PASSED ***"';
root.DEMO["HELLO.PY"] = 'name = input("Your name? ")\nfor i in range(3):\n    print(f"Hello, {name}! ({i + 1})")';
root.DEMO["FIZZ.PY"] = 'def fizz(n):\n    if n % 15 == 0:\n        return "FizzBuzz"\n    elif n % 3 == 0:\n' +
  '        return "Fizz"\n    elif n % 5 == 0:\n        return "Buzz"\n    return str(n)\n\n' +
  'out = []\nfor n in range(1, 16):\n    out.append(fizz(n))\nprint(" ".join(out))';
root.DEMO["WORDS.PY"] = '# counts words: dicts, sorting and string methods\n' +
  'text = "the cat and the dog and the bird"\ncounts = {}\nfor w in text.split():\n    counts[w] = counts.get(w, 0) + 1\n' +
  'for w in sorted(counts.keys()):\n    print(w, "*" * counts[w])';
root.DEMO["NOTES.PY"] = '# adds a line to NOTES.TXT and shows them all\nnote = input("New note? ")\n' +
  'f = open("NOTES.TXT", "a")\nf.write(note + "\\n")\nf.close()\nn = 0\nfor line in open("NOTES.TXT"):\n' +
  '    n += 1\n    print(n, line.strip())';
root.DEMO["WALK.PY"] ='import paper, time\nx = 30\ny = 10\npaper.cls()\n' +
  'print("W A S D move, Q quits", end="")\nwhile True:\n    paper.locate(y, x)\n' +
  '    print("@", end="")\n    k = paper.key()\n    if k == "":\n        time.sleep(0.05)\n        continue\n' +
  '    paper.locate(y, x)\n    print(" ", end="")\n    if k == "q":\n        break\n    if k == "a" and x > 1:\n        x -= 1\n' +
  '    if k == "d" and x < 64:\n        x += 1\n    if k == "w" and y > 2:\n        y -= 1\n    if k == "s" and y < 20:\n        y += 1';
root.DEMO["DODGE.PY"] = ["# DODGE: A and D move, Q quits. Real-time keys come from the paper module.","import paper, random, time","W = 40","H = 18","x = 20","rocks = []","score = 0","alive = True","while alive:","    k = paper.key()","    while k != \"\":","        if k == \"q\":","            alive = False","        if k == \"a\" and x > 1:","            x -= 1","        if k == \"d\" and x < W:","            x += 1","        k = paper.key()","    before = len(rocks)","    rocks = [[r[0], r[1] + 1] for r in rocks if r[1] < H]","    score += before - len(rocks)","    if random.random() < 0.6:","        rocks.append([random.randint(1, W), 2])","    paper.cls()","    print(f\"DODGE  score {score}\", end=\"\")","    for r in rocks:","        paper.locate(r[1], r[0])","        print(\"*\", end=\"\")","        if r[1] == H and r[0] == x:","            alive = False","    paper.locate(H, x)","    print(\"@\", end=\"\")","    time.sleep(0.12)","paper.cls()","print(\"Game over. Score:\", score)"].join("\n");
root.DEMO["POINTER.C"] = "#include <stdio.h>\n\nvoid swap(int *a, int *b) {\n    int t = *a;\n    *a = *b;\n    *b = t;\n}\n\nint main(void) {\n    int x = 3, y = 7;\n    int nums[4] = {10, 20, 30, 40};\n    int *p = nums;\n    swap(&x, &y);\n    printf(\"x=%d y=%d\\n\", x, y);\n    for (int i = 0; i < 4; i++)\n        printf(\"p+%d at %p = %d\\n\", i, (void *)(p + i), *(p + i));\n    return 0;\n}";
root.DEMO["LINKED.C"] = "#include <stdio.h>\n#include <stdlib.h>\n\nstruct node {\n    int value;\n    struct node *next;\n};\n\nstruct node *push(struct node *head, int v) {\n    struct node *n = malloc(sizeof *n);\n    n->value = v;\n    n->next = head;\n    return n;\n}\n\nint main(void) {\n    struct node *head = NULL, *n;\n    for (int i = 1; i <= 5; i++)\n        head = push(head, i * i);\n    for (n = head; n; n = n->next)\n        printf(\"%d -> \", n->value);\n    puts(\"NULL\");\n    while (head) {\n        n = head->next;\n        free(head);\n        head = n;\n    }\n    return 0;\n}";
root.DEMO["INFO.BAT"] = "@ECHO OFF\nREM usage: INFO yourname\nECHO Hello %1\nVER\nTIME\nIF EXIST \\README.TXT ECHO README.TXT is on drive C:";

// ---- disk: the whole file system as JSON in the hidden "disk" field, so saving the PDF keeps it ----
var disk = this.getField("disk"), diskText = "", diskBad = false;

function toDir(o) {  // parsed JSON -> directory tree; anything that is not a string or folder is dropped
  var d = dir();
  for (var k in o) {
    if (typeof o[k] === "string") d[k] = o[k];
    else if (o[k] && typeof o[k] === "object" && !(o[k] instanceof Array)) d[k] = toDir(o[k]);
  }
  return d;
}
function countFiles(d) {
  var n = 0;
  for (var k in d) n += isDir(d[k]) ? countFiles(d[k]) : 1;
  return n;
}
// Replaces the file system with the one saved in this PDF. Returns false when there is none.
function loadDisk() {
  var t = disk ? String(disk.value || "") : "", o;
  if (!t) return false;
  try { o = JSON.parse(t); } catch (e) { o = null; }
  if (!o || typeof o !== "object" || o instanceof Array) {  // never overwrite what could not be read
    root["RECOVERED.TXT"] = t;
    diskBad = true;
    return false;
  }
  root = toDir(o);
  diskText = t;
  return true;
}
function saveDisk() {
  if (!diskRead) return;  // before the saved disk is loaded, writing would replace it with the default files
  if (cEd && cEd.editing && cEd.live !== undefined) cPull();  // the code being typed counts as a change too
  var t = JSON.stringify(root);
  if (disk && t !== diskText) { disk.value = t; diskText = t; dirtySeen = false; }
}
// The top bar says whether the PDF holds the latest files. Edge clears doc.dirty when the PDF is saved. That only
// counts once the flag has been seen set after the last disk write, so a save is never reported that did not happen.
// Other viewers give no such signal: they keep showing Unsaved after a change rather than guess.
var savedBase = "", dirtySeen = false, justSaved = false, saveShown = "";
function saveTick() {
  var draft = !!(mode && mode.changed && mode.changed()), state;
  if (C_EDGE) {
    if (doc.dirty === true) dirtySeen = true;
    else if (doc.dirty === false && dirtySeen && diskText && !draft) {
      savedBase = diskText;
      dirtySeen = false;
      justSaved = true;
    }
  }
  state = draft || (diskText && diskText !== savedBase) ? "unsaved" : justSaved ? "saved" : "";
  if (state === saveShown) return;
  saveShown = state;
  vis("sunsaved", state === "unsaved");
  vis("ssaved", state === "saved");
}

// ---- boot ----
var bootLog = ["Starting PaperOS...", "", "PaperOS [Version 2.0]", "", "",
  "Type HELP for a list of commands. Samples: CD DEMO, then DIR", ""];
mode = { key: function () {}, draw: function () { return lines.slice(-ROWS); } };
// Boot runs from a timer, not at load: the viewer resets fields that are set while the file opens.
var bootTimer = app.setInterval("boot()", 150);

var diskRead = false;
function boot() {
  if (!diskRead) {  // the first tick, after the viewer has finished loading field values
    diskRead = true;
    bootLog[3] = loadDisk() ? "Disk restored from this PDF: " + countFiles(root) + " files"
      : diskBad ? "Disk was damaged. Its data is kept in RECOVERED.TXT"
      : "New disk. Save the PDF (Ctrl+S) to keep your files.";
    savedBase = diskBad ? "" : JSON.stringify(root);
  }
  if (bootLog.length) print(bootLog.shift());
  else {
    app.clearInterval(bootTimer);
    mode = null;
    booted = true;
    // A saved PDF also keeps what was on screen: start from a clean desktop, with an empty keyboard buffer.
    sLoad();
    sApply();
    ui("mapp").value = "";
    ui("kbd").value = " ";
    saveShown = null;
    shown = [];  // Edge can drop field updates while it is starting up, so write every row once more
    if (bootOpen) { var waiting = bootOpen; bootOpen = ""; openApp(waiting); }
  }
  render();
}

app.setInterval("sched()", 50);

app.setInterval("saveDisk()", 300);
