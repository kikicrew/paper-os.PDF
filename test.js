// Runs os.js under Node with a fake PDF viewer and types commands at it.
// usage: node test.js
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');

const fields = {}, timers = new Map();
let nextId = 1;
const ctx = vm.createContext({
  getField: n => fields[n] || (fields[n] = { value: '', setFocus() { this.focused = (this.focused || 0) + 1; } }),
  display: { visible: 0, hidden: 1 },
  app: {
    setInterval: code => { timers.set(nextId, code); return nextId++; },
    clearInterval: id => timers.delete(id),
  },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'os.js'), 'utf8'), ctx);

const run = n => { for (let i = 0; i < n; i++) for (const code of [...timers.values()]) vm.runInContext(code, ctx); };
// Adobe-style events: Backspace is an empty change over the character before the caret.
const type = s => { for (const c of s) ctx.key(c === '\b' ? { change: '', selStart: 0, selEnd: 1 } : { change: c, selStart: 1, selEnd: 1 }); };
const screen = () => Array.from({ length: 20 }, (_, i) => fields['r' + i].value);
const row = t => assert.ok(screen().includes(t), `expected a row "${t}" on:\n${screen().join('\n')}`);
const noRow = t => assert.ok(!screen().includes(t), `unexpected row "${t}" on:\n${screen().join('\n')}`);
const BASE_TIMERS = 2;  // the scheduler and the periodic redraw

run(10);  // boot
row('Type HELP for a list of commands. Samples: CD DEMO, then DIR');
assert.strictEqual(screen().filter(r => r === 'New disk. Save the PDF (Ctrl+S) to keep your files.').length, 1, screen().join('\n'));
row('C:\\>_');

// files and directories
type('echo hello > a.txt\necho more >> A.TXT\ntype a.txt\n'); row('hello'); row('more');
type('md games\ncd GAMES\ncd\n'); row('C:\\GAMES');
type('echo x > f.txt\ncd ..\nrd games\n'); row('Directory not empty - games');
type('copy a.txt games\ntype games\\a.txt\n'); row('        1 file(s) copied.');
type('del games\\f.txt\ndel games\\a.txt\nrd games\ncls\ndir\n');
row(' Directory of C:\\'); row('A.TXT         10 bytes'); row('DEMO          <DIR>'); row('       2 File(s)   1 Dir(s)');
type('del games\n'); row('Could Not Find C:\\GAMES');
type('type nope\n'); row('The system cannot find the file specified.');
type('foo\n'); row('Bad command or file name');
type('cd \\\nverx\b\n'); row('PaperOS [Version 2.0] - DOS style shell');  // backspace

// calculator
type('calc 2+3*4\n'); row('14');
type('CALC (2+3)*-4\n'); row('-20');
type('calc 0.1+0.2\n'); row('0.3');
type('calc 1/0\n'); row('cannot calculate: 1/0');

// notepad
type('edit n.txt\nline one\n.\ntype n.txt\n'); row('Saved N.TXT'); row('line one');
type('edit n.txt\nlost\n:q\ntype n.txt\n'); noRow('lost');

// snake: starts at (5,8) heading right; a cell is 2 characters, the field starts at row 2, column 1
type('cls\nsnake\n'); row(' SNAKE   score 0');
run(1); assert.strictEqual(screen()[10].indexOf('@@'), 13);
type('s'); run(1); assert.strictEqual(screen()[11].indexOf('@@'), 13);
type('w'); run(1); assert.strictEqual(screen()[12].indexOf('@@'), 13, 'turning straight back is ignored');
run(40); assert.ok(screen()[0].includes('GAME OVER'));
type('x'); assert.ok(screen().some(r => r.startsWith('snake: score ')));
assert.strictEqual(timers.size, BASE_TIMERS, 'snake timer stopped');

// Chromium-style events (Whale, Chrome): Enter is an empty change with no selection,
// a pasted or typed "\r\n" is one Enter, and a focus-loss commit is ignored
type('cls\n');
for (const c of 'ver') ctx.key({ change: c, selStart: 1, selEnd: 1 });
ctx.key({ change: '', selStart: 4, selEnd: 4, willCommit: true });
ctx.key({ change: '', selStart: 4, selEnd: 4 });
row('PaperOS [Version 2.0] - DOS style shell');
ctx.key({ change: 'cls\r\n', selStart: 1, selEnd: 1 });
assert.strictEqual(screen()[0], 'C:\\>_');

// time and date
type('cls\ntime\ndate\n');
assert.ok(screen().some(r => /^The current time is: \d\d:\d\d:\d\d$/.test(r)), screen().join('\n'));
assert.ok(screen().some(r => /^The current date is: \w{3} \d{4}-\d\d-\d\d$/.test(r)), screen().join('\n'));

// blocks: with Math.random() = 0 every piece is the 4-long bar, spawned flat at columns 3-6
vm.runInContext('Math.random = function () { return 0; }', ctx);
type('blocks\n'); row(' BLOCKS   score 0   lines 0   level 1');
const bottom = () => screen()[18];
type('aaa '); assert.strictEqual(bottom(), '|[][][][] . . . . . .|');  // columns 0-3
type('d ');   assert.strictEqual(bottom(), '|[][][][][][][][] . .|');  // columns 4-7
type('wddd ');  // stood up, pushed to column 8
type('wdddd ');  // stood up, pushed to column 9: the bottom row is full and clears
row(' BLOCKS   score 100   lines 1   level 1');
assert.strictEqual(bottom(), '| . . . . . . . .[][]|');
run(4000); assert.ok(screen()[15].includes('GAME OVER'), screen().join('\n'));
type('x'); assert.ok(screen().some(r => r.startsWith('blocks: score 100, lines 1')));
assert.strictEqual(timers.size, BASE_TIMERS, 'blocks timer stopped');

// ---- shell: variables, pipes, redirection ----
type('cls\nset name=kim\necho hi %name% %nope%\n'); row('hi kim %nope%');
type('set\n'); row('NAME=kim');
type('set name=\nset\n');
type('cls\necho b > z.txt\necho c >> z.txt\necho a >> z.txt\ntype z.txt | sort\n');
assert.deepStrictEqual(screen().filter(r => /^[abc]$/.test(r)), ['a', 'b', 'c']);
type('cls\nsort /r z.txt\n');
assert.deepStrictEqual(screen().filter(r => /^[abc]$/.test(r)), ['c', 'b', 'a']);
type('cls\ntype z.txt | sort | find B > s.txt\ntype s.txt\n'); row('b'); noRow('a');
type('cls\ndir | find z.txt\n'); row('Z.TXT         5 bytes'); noRow('A.TXT         10 bytes');
type('find x\n'); row('FIND needs input:  DIR | FIND TXT   or   FIND text file');

// ---- batch files: arguments, IF, GOTO, CALL, nesting, break ----
type('cls\nedit t.bat\n@echo off\necho one %1\nif %1==x goto skip\necho two\n:skip\nif not exist nope.txt echo three\n.\n');
type('cls\nt x\n'); row('one x'); noRow('two'); row('three');
type('cls\nT.BAT y\n'); row('one y'); row('two'); row('three');
type('cls\nedit u.bat\necho before\ncall t x\necho after\n.\nu\n'); row('before'); row('one x'); row('after');
type('cls\ngoto x\n'); row('GOTO only works inside a batch file');
type('edit loop.bat\n:top\ngoto top\n.\ncls\nloop\n'); run(5);
type('`'); row('^C');
type('ver\n'); row('PaperOS [Version 2.0] - DOS style shell');
type('cls\nedit p.bat\necho a1\npause\necho a2\n.\np\n'); row('a1'); noRow('a2');
type('x'); run(1); row('a2');

// ---- BASIC: sample program with INPUT, run by name from a batch-style prompt ----
type('cls\ncd demo\nhello\n'); run(2);
row('YOUR NAME? _'); row('C:\\DEMO>hello');  // the program carries on below the terminal text
type('Kimx\b\n'); run(3);
assert.strictEqual(screen().filter(r => r === 'HELLO, Kim!').length, 3);
row('C:\\DEMO>_');
type('cd \\\n');

// the BASIC prompt: numbered lines, RUN, expressions, FOR, GOSUB, arrays, string functions
const basic = (lines, ticks = 3) => { type('new\n' + lines.join('\n') + '\nrun\n'); run(ticks); };
type('cls\nbasic\n');
type('print 2^10 mod 7; " "; -2^2; " "; 7/2; " "; (1+2)*3\n'); run(2); row('2 -4 3.5 9');
basic(['10 for i = 1 to 10 step 3', '20 s = s + i', '30 next i', '40 print "SUM"; s']); row('SUM22');
basic(['10 dim a(5)', '20 for i = 0 to 5: a(i) = i * i: next', '30 gosub 100',
  '40 print mid$("HELLO", 2, 3); len("abc"); a(5); left$("xyz", 1); right$("xyz", 2)', '50 end', '100 print "SUB": return']);
row('SUB'); row('ELL325xyz');
basic(['10 x = 5', '20 if x > 3 and not x = 9 then print "big" else print "small"',
  '30 if x < 3 then print "no" else print "else"', '40 if x = 5 then 60', '50 print "skipped"', '60 print "done"']);
row('big'); row('else'); noRow('skipped'); row('done');
type('new\n10 print "kept"\n20 print "gone"\n20\nlist\n'); row('10 print "kept"'); noRow('20 print "gone"');

// errors name the line; an endless loop does not hang and ` breaks it
basic(['10 print 1/0']); row('?Division by zero in line 10');
basic(['10 print "a" + 1']); row('?Type mismatch in line 10');
basic(['10 goto 99']); row('?Undefined line 99 in line 10');
basic(['10 next']); row('?NEXT without FOR in line 10');
basic(['10 a(11) = 1']); row('?Subscript out of range in line 10');
basic(['10 goto 10'], 5); type('`'); row('Break in line 10'); row('] _');

// system calls: files, SHELL, INKEY$, SLEEP
type('cls\n');
basic(['10 open "d.txt" for output as #1', '20 print #1, "x"; 1', '30 print #1, "y"', '40 close #1',
  '50 open "d.txt" for input as #1', '60 if eof(1) then 90', '70 input #1, l$: print "GOT "; l$', '80 goto 60', '90 close']);
row('GOT x1'); row('GOT y');
basic(['10 shell "ver"', '20 shell "snake"']); row('PaperOS [Version 2.0] - DOS style shell');
row('?SHELL runs built-in commands only in line 20');
type('cls\n');
basic(['10 k$ = inkey$: if k$ = "" then 10', '20 print "KEY "; k$']); type('z'); run(2); row('KEY z');
basic(['10 print "a";', '20 sleep 0', '30 locate 3, 5: print "b"']); run(2);

// SAVE, leave, and the saved program runs from the shell
type('new\n10 x = x + 1: goto 10\nsave spin\nsystem\ncls\ndir spin.bas\n'); row('SPIN.BAS      21 bytes');

// ---- processes: START runs in the background while the shell stays usable ----
type('start spin\n'); run(3);
assert.ok(screen().some(r => /^\[\d+\] SPIN started in the background$/.test(r)), screen().join('\n'));
type('ver\n'); row('PaperOS [Version 2.0] - DOS style shell');
type('cls\nstart demo\\alarm\n'); run(1); type('tasks\n');
const tasks = screen().filter(r => /^\d+ /.test(r));
assert.strictEqual(tasks.length, 2, screen().join('\n'));
assert.ok(/SPIN +run +10$/.test(tasks[0]) && /DEMO\\ALARM +sleep +10$/.test(tasks[1]), tasks.join('\n'));
for (const t of tasks) type('kill ' + t.split(' ')[0] + '\n');
run(1); type('cls\ntasks\nkill 999\n'); row('No programs are running.'); row('No such program - 999');
type('cls\nedit bg.bas\n10 print "from the background"\n.\nstart bg\n'); run(2);
row('from the background'); assert.ok(screen().some(r => /^\[\d+\] BG finished$/.test(r)));
type('cls\nedit ask.bas\n10 input a\n.\nstart ask\n'); run(2);
row('?INPUT needs the foreground (use RUN, not START) in line 10');
type('run nope\n'); row('File not found - nope');

// ---- Python: the >>> prompt keeps variables between lines and echoes expression values ----
const py = (src, ticks = 3) => { type(src + '\n'); run(ticks); };
type('cls\npython\n'); row('PaperOS Python (a small subset of Python 3). exit() leaves.');
py('x = 6'); py('x * 7'); row('42');
py('"ab" * 3 + str(len([1, 2]))'); row("'ababab2'");
py('7 // 2, 7 % 3, -7 // 2, 2 ** 10, 6 / 4'); row('[3, 1, -4, 1024, 1.5]');
py('1 < x <= 6 and not x == 5'); row('True');
py('print("a", 1, None, True, sep="-", end="!\\n")'); row('a-1-None-True!');
py('y = [3, 1, 2]'); py('y.append(0)'); py('y.sort()'); py('y, y[-1], y[1:3], len(y)'); row('[[0, 1, 2, 3], 3, [1, 2], 4]');
py('d = {"a": 1}'); py('d["b"] = 2'); py('d, d.get("c", 9), "a" in d, list(d.values())'); row("[{'a': 1, 'b': 2}, 9, True, [1, 2]]");
py('"x,y".split(","), " pad ".strip().upper(), "-".join(["a", "b"]), "hello".replace("l", "L")');
row("[['x', 'y'], 'PAD', 'a-b', 'heLLo']");
py('"A".isupper(), "a1".islower(), "1".isupper()'); row('[True, True, False]');
py('f"{x} squared is {x * x}, half is {x / 4:.2f}"'); row("'6 squared is 36, half is 1.50'");
py('3 if x > 5 else 4'); row('3');
// blocks: a line ending in ":" collects lines until an empty one
type('def fact(n):\n    if n <= 1:\n'); row('... _');
type('        return 1\n    return n * fact(n - 1)\n\n'); run(2);
py('fact(10)'); row('3628800');
type('for i, ch in enumerate("ab"):\n    print(i, ch)\n\n'); run(2); row('0 a'); row('1 b');
type('total = 0\nn = 0\nwhile True:\n    n += 1\n    if n % 2 == 0: continue\n    if n > 9: break\n    total += n\n\n');
run(2); py('total'); row('25');
py('import math, random'); py('math.sqrt(16), math.floor(2.7), round(3.14159, 2)'); row('[4, 2, 3.14]');
py('1 <= random.randint(1, 6) <= 6, random.choice([5]) == 5'); row('[True, True]');
py('g = 1'); type('def setg():\n    global g\n    g = 5\n\n'); run(2); py('setg()'); py('g'); row('5');
// errors name the line and do not end the prompt
py('1 / 0'); row('ZeroDivisionError: division by zero (line 1)');
py('nope'); row("NameError: name 'nope' is not defined (line 1)");
py('[1][5]'); row('IndexError: list index out of range (line 1)');
py('"a" + 1'); row("TypeError: unsupported operand type(s) for +: 'str' and 'int' (l");  // wraps at 64
py('int("x")'); row("ValueError: invalid literal for int(): 'x' (line 1)");
py('print(1'); row('SyntaxError: invalid syntax (line 1)');
py('class A: pass'); row("SyntaxError: 'class' is not supported here (line 1)");
py('import os'); row("ModuleNotFoundError: No module named 'os' (try paper) (line 1)");
type('def r(n):\n    return r(n + 1)\n\n'); run(2); py('r(0)', 10); row('RecursionError: maximum recursion depth exceeded (line 2)');
row('>>> _');
// input() waits for a typed line; an endless loop does not hang and ` breaks it
py('a = input("n? ")'); row('n? _'); type('hi\n'); run(2); py('a'); row("'hi'");
type('while True:\n    pass\n\n'); run(5); type('`'); row('KeyboardInterrupt (line 2)'); row('>>> _');
type('exit()\n'); row('C:\\>_');

// .PY files run by name, with RUN, or in the background with START
type('cls\ncd demo\nhello.py\n'); run(2); row('Your name? _'); type('Kim\n'); run(3);
row('Hello, Kim! (1)'); row('Hello, Kim! (3)');
type('cls\nfizz\n'); run(3); row('1 2 Fizz 4 Buzz Fizz 7 8 Fizz Buzz 11 Fizz 13 14 FizzBuzz');
type('cls\nrun words\n'); run(3); row('the ***'); row('and **');
type('cd \\\nedit tick.py\nimport time\nfor i in range(2):\n    time.sleep(0)\n    print("tick", i)\n.\nstart tick\n'); run(4);
row('tick 0'); row('tick 1'); assert.ok(screen().some(r => /^\[\d+\] TICK finished$/.test(r)));
type('edit in.py\ninput()\n.\ncls\nstart in\n'); run(2);
row('RuntimeError: input() needs RUN, not START (line 1)');
// a BASIC program can call the shell, which can run Python
type('cls\nedit two.py\nprint("from python")\n.\nbasic\nnew\n10 shell "type two.py"\nrun\n'); run(2); row('print("from python")');
type('system\n');

// ---- Python open(): write, append, read, readline(s), iterate, errors ----
type('cls\npython\n');
py('f = open("p.txt", "w")'); py('f.write("one\\n")'); py('f.write("two\\n")'); py('f.close()');
py('open("p.txt", "a").write("three")'); py('open("p.txt").read()'); row("'one\\ntwo\\nthree'");
py('g = open("p.txt")'); py('g.readline(), g.readlines()'); row("['one\\n', ['two\\n', 'three']]");
type('n = 0\nfor line in open("p.txt"):\n    n += len(line.strip())\n\n'); run(2); py('n'); row('11');
py('open("nope.txt")'); row("FileNotFoundError: No such file: 'nope.txt' (line 1)");
py('g.close()'); py('g.read()'); row('ValueError: I/O operation on closed file (line 1)');
py('open("p.txt").write("x")'); row('UnsupportedOperation: not writable (line 1)');
py('open("p.txt", "x")'); row("ValueError: invalid mode 'x' (use 'r', 'w' or 'a') (line 1)");
py('open("demo", "w")'); row('OSError: Access denied - demo is a directory (line 1)');
type('exit()\ncls\ntype p.txt\n'); row('one'); row('three');  // the shell sees what Python wrote
type('cls\ncd demo\nnotes\n'); run(2); type('buy milk\n'); run(3); row('1 buy milk');
type('notes\n'); run(2); type('call mom\n'); run(3); row('2 call mom'); type('cd \\\n');

// ---- the paper module: keys without waiting, cursor and screen control ----
type('cls\nedit k.py\nimport paper, time\npaper.cls()\npaper.locate(3, 5)\nprint("X", end="")\n' +
  'while True:\n    k = paper.key()\n    if k == "":\n        time.sleep(0)\n        continue\n' +
  '    paper.locate(1, 1)\n    print("got", k)\n    if k == "q":\n        break\n.\nk\n');
run(3); assert.strictEqual(screen()[2], '    X', screen().join('\n'));
type('z'); run(2); row('got z');
type('q'); run(2); row('got q'); row('C:\\>_');
type('cls\ncd demo\nwalk\n'); run(2); row('W A S D move, Q quits');
assert.strictEqual(screen()[9].indexOf('@'), 29);
// WALK.PY sleeps 0.05 s between empty key checks, so let real time pass between scheduler ticks
const nap = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const walk = () => { for (let i = 0; i < 4; i++) { nap(60); run(1); } };
type('dd'); walk(); assert.strictEqual(screen()[9].indexOf('@'), 31, screen().join('\n'));
type('s'); walk(); assert.strictEqual(screen()[10].indexOf('@'), 31, screen().join('\n'));
type('q'); walk(); row('C:\\DEMO>_'); type('cd \\\n');

// ---- programs run from any folder through C:\DEMO; a program in this folder wins ----
type('cls\nmd elsewhere\ncd elsewhere\nfizz\n'); run(3); row('1 2 Fizz 4 Buzz Fizz 7 8 Fizz Buzz 11 Fizz 13 14 FizzBuzz');
type('edit move.py\nprint("my own move")\n.\ncls\nmove\n'); run(3); row('my own move');
type('del move.py\ncd ..\nrd elsewhere\ncls\nnosuchprogram\nrun nosuch\n');
row('Bad command or file name'); row('File not found - nosuch');
type('cls\nstart alarm\n'); run(1); type('tasks\n'); assert.ok(screen().some(r => /ALARM +sleep/.test(r)), screen().join('\n'));
const alarm = screen().find(r => /ALARM +sleep/.test(r)).split(' ')[0];
type('kill ' + alarm + '\n'); run(1);

// ---- HELP topics ----
type('cls\nhelp python\n'); row('Modules: math random time paper');
type('cls\nhelp demo\n'); row('Read one with TYPE \\DEMO\\DODGE.PY');
type('cls\nhelp constructor\n'); row('No help on constructor. Topics: C PYTHON BASIC BATCH DEMO SAVE');
for (const t of ['', 'c', 'python', 'basic', 'batch', 'demo', 'save']) {
  type('cls\nhelp ' + t + '\n');
  assert.ok(vm.runInContext('lines.length', ctx) <= 19, 'help ' + t + ' fits on one screen');
}

// ---- Python: comprehensions, default and keyword arguments, try/except ----
type('cls\npython\n');
py('[x * x for x in range(5) if x % 2 == 0]'); row('[0, 4, 16]');
py('[(a, b) for a in [1, 2] for b in "xy" if a == 2]'); row("[[2, 'x'], [2, 'y']]");
py('[y for k, y in {"p": 7}.items()]'); row('[7]');
py('[[j for j in range(i)] for i in range(3)]'); row('[[], [0], [0, 1]]');
py('x = 5'); py('[x for x in range(3)]'); py('x'); row('5');  // the loop variable stays private
type('def f(a, b=2, c=a0):\n    pass\n\n'); run(2); row("NameError: name 'a0' is not defined (line 1)");
type('n0 = 10\ndef f(a, b=n0, c=3):\n    return a * 100 + b * 10 + c\n\n'); run(2);
py('n0 = 99'); py('f(1), f(1, 2), f(1, c=7), f(c=1, a=2, b=3)'); row('[203, 123, 207, 231]');
py('f()'); row("TypeError: f() missing argument 'a' (line 1)");
py('f(1, a=2)'); row("TypeError: f() got multiple values for 'a' (line 1)");
py('f(1, z=2)'); row("TypeError: f() got an unexpected argument 'z' (line 1)");
py('f(1, 2, 3, 4)'); row('TypeError: f() takes 3 argument(s) but 4 were given (line 1)');
type('try:\n    print(1 / 0)\nexcept ZeroDivisionError as e:\n    print("caught", e)\n\n'); run(2);
row('caught division by zero');
type('try:\n    [][1]\nexcept (KeyError, LookupError):\n    print("lookup")\n\n'); run(2); row('lookup');
type('try:\n    int("x")\nexcept KeyError:\n    print("wrong")\nexcept Exception as e:\n    print("any:", e)\n\n'); run(2);
row("any: invalid literal for int(): 'x'"); noRow('wrong');
type('try:\n    nope\nexcept KeyError:\n    print("wrong")\n\n'); run(2);
row("NameError: name 'nope' is not defined (line 2)");  // no handler matches: it still stops
type('def bad():\n    return 1 / 0\n\n'); run(2);
type('def safe():\n    try:\n        return bad()\n    except:\n        return "safe"\n\n'); run(2);
py('safe()'); row("'safe'");  // an error crosses function calls to the try that encloses it
type('t = 0\nfor i in range(4):\n    try:\n        if i == 1: continue\n        if i == 3: break\n        t += 10\n    except:\n        t = -1\n\n'); run(2);
py('1 / 0 if False else t'); row('20');  // break and continue leave the try block
type('try:\n    pass\n    1 / 0\nexcept:\n    pass\n\n'); run(2);
py('1 / 0'); row('ZeroDivisionError: division by zero (line 1)');  // a finished try no longer catches
type('c = 0\nwhile c < 5000:\n    c += 1\n    try:\n        1 / 0\n    except:\n        pass\n\n'); run(60); py('c', 5); row('5000');
py('try: 1'); row('SyntaxError: expected \'except\' (line 1)');
type('exit()\n');

// ---- DODGE.PY ----
type('cls\ndodge\n'); nap(150); run(2); assert.ok(screen()[0].startsWith('DODGE  score '), screen().join('\n'));
type('q'); for (let i = 0; i < 4; i++) { nap(150); run(1); }
assert.ok(screen().some(r => /^Game over\. Score: \d+$/.test(r)), screen().join('\n'));

// ---- desktop: icons open one app window, switching or closing ends the app that had the keyboard ----
type('cls\n');
ctx.openApp('FILES');
assert.strictEqual(fields.r0.display, 0); assert.strictEqual(fields.kbd.display, 0);
assert.strictEqual(fields.wbar.value, 'Files'); assert.ok(screen().some(r => r.startsWith('  DEMO\\') || r.startsWith('> DEMO\\')), screen().join('\n'));
const before = fields.kbd.focused || 0; run(2); assert.strictEqual(fields.kbd.focused, before + 1, 'the keyboard field takes focus');
ctx.openApp('SNAKE'); row(' SNAKE   score 0'); assert.strictEqual(timers.size, BASE_TIMERS + 1);
ctx.openApp('BLOCKS'); assert.ok(screen()[0].startsWith(' BLOCKS'), screen().join('\n')); assert.strictEqual(timers.size, BASE_TIMERS + 1);
ctx.openApp('DODGE'); assert.strictEqual(timers.size, BASE_TIMERS, 'the game timer stopped');
ctx.openApp('PYTHON'); row('>>> _');
ctx.openApp('NOTES'); assert.ok(!screen().some(r => r.startsWith('-- NOTES.TXT')), 'no terminal instructions in Notes');
ctx.openApp('CALC'); assert.ok(!screen().some(r => r.startsWith('C:\\>')), 'apps open in a clean window'); type('2+3\n'); row('5');
ctx.closeApp();
assert.strictEqual(fields.r0.display, 1); assert.strictEqual(fields.wclose.display, 1);
ctx.openApp('TERMINAL'); type('cls\nver\n'); row('PaperOS [Version 2.0] - DOS style shell');
ctx.openApp('NOPE'); assert.strictEqual(fields.wbar.value, 'Terminal');
ctx.closeApp(); run(1);
assert.ok(/^\d\d:\d\d$/.test(fields.clock.value), fields.clock.value);
assert.ok(/^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}$/.test(fields.gdate.value), fields.gdate.value);
assert.strictEqual(fields.gtip.display, 0, 'the tip shows on the empty desktop');
// Korean input mode: game keys arrive as Hangul and still steer; the hint appears and clears
assert.deepStrictEqual(['\u3148', '\u3141', '\u3134', '\u3147', '\uBBA4', '\uD55C', '\uAE00', '\u3143'].map(c => ctx.hangulKeys(c)),
  ['w', 'a', 's', 'd', 'ab', 'gks', 'rmf', 'Q']);
ctx.openApp('BLOCKS');
type('\u3141\u3141\u3141 '); assert.strictEqual(bottom(), '|[][][][] . . . . . .|', screen().join('\n'));  // ㅁ = A
assert.ok(fields.khint.value.includes('Han/Eng'), fields.khint.value);
type('a'); assert.ok(fields.khint.value.includes('Drop: Space'), fields.khint.value);
type('\u3142'); run(1);  // ㅂ = Q: the game ends, its window closes, the score stays in the menu bar
assert.ok(fields.mapp.value.startsWith('Blocks: score '), fields.mapp.value); assert.strictEqual(fields.r0.display, 1);
ctx.openApp('TERMINAL');
type('cls\nedit k2.py\nimport paper\nwhile paper.key() != "q":\n    pass\nprint("left")\n.\nk2\n'); run(1);
type('\u3142'); run(3); row('left');                                      // real-time programs get it too
type('cls\nedit k3.py\nx = input()\nprint(len(x))\n.\nk3\n'); run(1);
type('\u3142\n'); run(3); row('0');                                       // input() keeps text as text: no game keys
type('\u3142\n'); row('C:\\>_');                                          // the shell is unchanged

// ---- UX: leaving an app never loses work, and every state says what to do ----
ctx.closeApp();
type('cls\n'); ctx.openApp('TERMINAL'); type('echo keep me\n'); ctx.openApp('NOTES');
type('first line\nsecond unfinished'); ctx.closeApp();                 // closing saves, even the unfinished line
assert.strictEqual(ctx.lookup(['NOTES.TXT']).split('\n').slice(-2).join('|'), 'first line|second unfinished');
assert.strictEqual(fields.mapp.value, 'Saved NOTES.TXT');
ctx.openApp('TERMINAL'); row('keep me');                               // the terminal's history came back
ctx.openApp('NOTES'); type('switching'); ctx.openApp('CALC');           // so does switching apps
assert.ok(ctx.lookup(['NOTES.TXT']).endsWith('switching'));
ctx.openApp('NOTES'); const unchanged = ctx.lookup(['NOTES.TXT']); ctx.closeApp();
assert.strictEqual(ctx.lookup(['NOTES.TXT']), unchanged); assert.strictEqual(fields.mapp.value, '', 'nothing to report');
ctx.openApp('NOTES'); type('gone\n:q\n'); run(1);                      // an explicit cancel still cancels
assert.strictEqual(ctx.lookup(['NOTES.TXT']), unchanged); assert.strictEqual(fields.r0.display, 1);
ctx.openApp('SNAKE'); ctx.minimizeApp(); assert.strictEqual(fields.r0.display, 1); assert.strictEqual(timers.size, BASE_TIMERS + 1);
ctx.openApp('SNAKE'); assert.strictEqual(fields.r0.display, 0); assert.strictEqual(timers.size, BASE_TIMERS + 1, 'restored, not restarted');
ctx.closeApp(); assert.ok(fields.mapp.value.startsWith('Snake: score '), fields.mapp.value);
ctx.openApp('TERMINAL'); ctx.kbdFocus(false); assert.ok(fields.khint.value.includes('Click here to type.'), fields.khint.value);
ctx.kbdFocus(true); assert.ok(!fields.khint.value.includes('Click here'), fields.khint.value);
const f0 = fields.kbd.focused; ctx.focusKeyboard(); run(4); assert.strictEqual(fields.kbd.focused, f0 + 1, 'clicking the window refocuses');
for (const k of ['TERMINAL', 'FILES', 'NOTES', 'CALC', 'PYTHON', 'CLANG', 'SNAKE', 'BLOCKS', 'DODGE', 'SETTINGS'])
  assert.ok(vm.runInContext('APPS.' + k + '.hint.length', ctx) <= 80, k + ' hint fits the strip');

// ---- C: programs are written through the real keyboard path and checked on screen ----
const cRun = (name, src, input = '', ticks = 40) => {
  type('cls\n'); vm.runInContext('root[' + JSON.stringify(name) + '] = ' + JSON.stringify(src), ctx);
  type('cc ' + name + '\n'); run(ticks);
  if (input) { type(input); run(ticks); }
};
const cOut = () => screen().join('\n');
const cHas = t => assert.ok(cOut().includes(t), 'expected "' + t + '" on:\n' + cOut());
type('cd \\\ncls\nedit k.c\n#include <stdio.h>\nint main(void) { int a[3] = {10, 20, 30}; int *p = a;\nprintf("%d\\n", *(p + 1)); return 0; }\n.\ncc k.c\n'); run(5); row('20');
type('del k.c\n');
type('cls\npointer\n'); run(5); row('x=7 y=3'); cHas('= 40');
type('cls\nlinked\n'); run(5); row('25 -> 16 -> 9 -> 4 -> 1 -> NULL');
cRun('P.C', 'int main(){int a[2][3]={1,2,3,4,5,6};int (*r)[3]=a;int *q=&a[1][0];char s[]="abc";char *c=s;c[1]=88;' +
  'int **pp=&q;**pp=50;printf("%d %d %d %s %d %d\\n",r[1][2],*(*(a+1)+1),a[1][0],s,(int)sizeof a,(int)(&a[1][2]-&a[0][0]));return 0;}');
row('6 5 50 aXc 24 5');
cRun('B.C', 'int main(){int i=0x01020304;unsigned char *b=(unsigned char*)&i;printf("%d %d %d\\n",b[0],b[3],(int)sizeof(char*));return 0;}'); row('4 1 4');
cRun('S.C', 'typedef struct {int x; char n[8]; double d;} P;P mk(int v){P p;p.x=v;p.d=v/2.0;sprintf(p.n,"n%d",v);return p;}' +
  'void inc(P *p){p->x++;}int get(P p){p.x=99;return p.x;}int main(){P a=mk(5),b;b=a;inc(&b);printf("%d %d %s %.2f %d %d\\n",a.x,b.x,b.n,b.d,get(a),mk(8).x);' +
  'P l[2]={{1,"a",1.5},{.x=2,.n="b"}};printf("%d %s %d\\n",l[1].x,l[0].n,(int)sizeof(P));return 0;}');
row('5 6 n5 2.50 99 8'); row('2 a 24');
cRun('F.C', 'int add(int a,int b){return a+b;}int mul(int a,int b){return a*b;}int ap(int(*f)(int,int),int x){return f(x,3);}' +
  'int cmp(const void*a,const void*b){return *(int*)a-*(int*)b;}int fact(int n){return n<2?1:n*fact(n-1);}' +
  'int main(){int (*t[2])(int,int)={add,mul};int v[5]={5,2,9,1,3};qsort(v,5,sizeof(int),cmp);printf("%d %d %d %d %d\\n",t[0](2,3),ap(t[1],4),v[0],v[4],fact(10));return 0;}');
row('5 12 1 9 3628800');
cRun('M.C', '#include <stdlib.h>\n#include <string.h>\n#define MAX(a,b) ((a)>(b)?(a):(b))\n#define N 3\nenum c{R,G=5,B};int g[N]={7,8};static int cnt(void){static int k;return ++k;}' +
  'int main(void){char *s=malloc(16);strcpy(s,"hi");strcat(s," you");int *z=calloc(4,4);z=realloc(z,64);z[10]=4;cnt();' +
  'printf("%s %d %d %d %d %d %d\\n",s,(int)strlen(s),MAX(2,N),B,g[1],g[2],cnt());free(s);free(z);return 0;}');
row('hi you 6 3 6 8 0 2');
cRun('O.C', 'int main(){int i=2147483647;i++;unsigned u=0;u--;char c=200;short h=70000;printf("%d %u %d %d %d %d %5.1f|%-4d|%04d|%x|%c|%e|%g\\n",i,u,c,h,7/2,-7%3,3.14159,5,42,255,65,1500.0,0.5);return 0;}');
row('-2147483648 4294967295 -56 4464 3 -1   3.1|5   |0042|ff|A|1.5000'); row('00e+03|0.5');
cRun('L.C', 'int main(){int s=0,i=0;for(;;){i++;if(i%2)continue;if(i>10)break;s+=i;}do{s++;}while(s<31);switch(s){case 1:s=0;break;case 31:s=100;case 2:s++;break;default:s=-1;}' +
  'int n=3;int v[n];for(i=0;i<n;i++)v[i]=i*i;goto done;s=0;done:printf("%d %d %d\\n",s,v[2],(int)sizeof v);return 0;}');
row('101 4 12');
cRun('I.C', 'int main(){int a;double d;char w[16],c;printf("num? ");scanf("%d %lf",&a,&d);scanf("%s",w);scanf(" %c",&c);printf("%d %.1f %s %c\\n",a,d,w,c);return 0;}', '12 1.5\nword z\n');
row('12 1.5 word z');
cRun('W.C', '#include <stdio.h>\nint main(){FILE *f=fopen("OUT.TXT","w");fprintf(f,"line %d\\n",1);fputs("two\\n",f);fclose(f);char b[32];f=fopen("out.txt","r");while(fgets(b,32,f))printf("[%s",b);fclose(f);printf("%d\\n",fopen("nope.txt","r")==NULL);return 0;}'.replace(/\\\\n/g, '\\n'));
cHas('[line 1'); cHas('[two'); assert.strictEqual(vm.runInContext('root["OUT.TXT"]', ctx), 'line 1\ntwo\n');
// mistakes stop the program with a line number, and leave the OS working
cRun('E1.C', 'int main(){int *p=0;\n*p=1;return 0;}'); row('Runtime error, line 2: Segmentation fault: NULL pointer');
cRun('E2.C', 'int main(){char *s="x";\n\ns[0]=65;return 0;}'); row('Runtime error, line 3: Segmentation fault: string is read-only');
cRun('E3.C', 'int f(int n){return f(n+1)+1;}int main(){return f(0);}'); cHas('Stack overflow');
cRun('E4.C', 'int main(){int z=0;\nreturn 5/z;}'); row('Runtime error, line 2: Division by zero');
cRun('E5.C', '#include <stdlib.h>\nint main(){char *p=malloc(4);free(p);\nfree(p);return 0;}'); cHas('already freed');
cRun('E6.C', 'int main(){\nint x = 1\nreturn x;}'); row("E6.C: Line 2: expected ; before return");
cRun('E7.C', 'int main(){\nreturn y;}'); row('E7.C: Line 2: y is not declared');
cRun('E8.C', 'int f(int);int main(){return f(1);}'); cHas('function f has no body');
cRun('E9.C', 'int main(){return 3;}'); row('Program exited with code 3');
type('cls\necho alive\n'); row('alive');
// a loop cannot freeze the viewer: each tick runs a slice, and the break key ends it
type('cls\n'); vm.runInContext('root["X.C"] = "int main(){for(;;);}"', ctx); type('cc x.c\n'); run(3); assert.ok(vm.runInContext('!!mode', ctx)); type(String.fromCharCode(96)); run(1); assert.ok(vm.runInContext('!mode', ctx));
for (const k of ['P','B','S','F','M','O','L','I','W','E1','E2','E3','E4','E5','E6','E7','E8','E9','X']) vm.runInContext('delete root["' + k + '.C"]', ctx);
vm.runInContext('delete root["OUT.TXT"]', ctx);
type('cls\n');

// the C app: the code is a real text field; buttons act a tick later, after the viewer commits it
const code = () => vm.runInContext('root["MAIN.C"]', ctx);
ctx.openApp('CLANG');
assert.strictEqual(fields.cedit.display, 0); assert.strictEqual(fields.r0.display, 1); assert.strictEqual(fields.kbd.display, 1);
assert.ok(fields.cedit.value.includes('Hello, C!')); assert.ok(fields.cgut.value.startsWith('1\n2\n3'));
ctx.cKey({ value: 'a', change: '', selStart: 1, selEnd: 1 }); assert.strictEqual(fields.cgut.value, '1\n2', 'Enter adds a number');
ctx.cKey({ value: 'x'.repeat(70), change: 'y', selStart: 70, selEnd: 70 }); assert.strictEqual(fields.cgut.value, '1\n', 'a wrapped line has one number');
ctx.cKey({ value: 'ab\r\ncd', change: 'X', selStart: 4, selEnd: 4 }); assert.strictEqual(vm.runInContext('cEd.live', ctx), 'ab\ncXd', 'a line break is one offset');
assert.ok(fields.khint.value.includes('Last edit: Ln 2, Col 3'), fields.khint.value);
ctx.cKey({ value: 'a', change: '', selStart: 1, selEnd: 1 }); assert.ok(fields.khint.value.includes('Last edit: Ln 2, Col 1'), 'Enter: ' + fields.khint.value);
ctx.cKey({ value: 'ab\r\ncd', change: '', selStart: 2, selEnd: 3 }); assert.strictEqual(vm.runInContext('cEd.live', ctx), 'abcd', 'Backspace joins lines');
ctx.cKey({ value: Array(24).fill('x').join('\r\n'), change: '', selStart: 1, selEnd: 1 });
assert.strictEqual(vm.runInContext('cEd.live.split("\\n").length', ctx), 24, 'Enter on a full page adds nothing');
assert.ok(fields.khint.value.includes('page is full'), fields.khint.value);
vm.runInContext('cEd.live = undefined; cEd.full = false', ctx);
fields.cedit.value = fields.cedit.value.replace('return 0;', 'printf("sum=%d\\n", 2 + 3);\r\n    return 0;');
ctx.cAct('run'); run(3); row('Hello, C!'); row('sum=5');
assert.strictEqual(fields.cedit.display, 1); assert.strictEqual(fields.r0.display, 0); assert.strictEqual(fields.cback.display, 0);
assert.ok(code().includes('sum=') && !code().includes('\r'), 'run keeps the code');
type('x'); run(1); assert.strictEqual(fields.cedit.display, 0); assert.ok(fields.cedit.value.includes('sum='));
fields.cedit.value = 'int main(){\nreturn y;}'; ctx.cAct('run'); run(3); row('MAIN.C: Line 2: y is not declared');
ctx.cAct('back'); run(1); assert.strictEqual(fields.cedit.value, 'int main(){\nreturn y;}');
assert.ok(fields.khint.value.includes('Error on Ln 2'), fields.khint.value);
fields.cedit.value = Array.from({ length: 45 }, (_, i) => '// ' + (i + 1)).join('\n'); ctx.cAct('next'); run(4);
assert.ok(fields.cedit.value.startsWith('// 46') === false); assert.strictEqual(code().split('\n').length, 45);
assert.ok(fields.cedit.value.startsWith('// 1\n') === false, 'the next page'); assert.strictEqual(fields.cpage.value, '46-46 / 46');
ctx.cAct('prev'); run(4); assert.ok(fields.cedit.value.startsWith('// 26\n'), fields.cedit.value.slice(0, 20));
assert.ok(fields.cgut.value.startsWith('26\n27'), fields.cgut.value.slice(0, 10)); assert.strictEqual(fields.cpage.value, '26-45 / 45');
{ const keep = fields.cedit.value, gut = fields.cgut.value;
  ctx.cKey({ value: keep, change: 'y', selStart: 0, selEnd: 0 }); assert.ok(fields.khint.value.includes('Last edit: Ln 26, Col 2'), 'later page: ' + fields.khint.value);
  vm.runInContext('cEd.live = undefined; cEd.where = ""', ctx); fields.cgut.value = gut; fields.cpage.value = '26-45 / 45'; }
assert.strictEqual(fields.kbd.display, 1, 'the keyboard field is hidden again'); assert.strictEqual(code().split('\n').length, 45, 'turning pages copies nothing');
fields.cedit.value = fields.cedit.value + '\nint added;'; ctx.closeApp(); run(2);
assert.strictEqual(fields.mapp.value, 'Saved MAIN.C'); assert.ok(code().endsWith('int added;')); assert.strictEqual(fields.cedit.display, 1);
ctx.openApp('CLANG'); assert.ok(fields.cedit.value.startsWith('// 1\n')); ctx.minimizeApp(); assert.strictEqual(fields.cedit.display, 1);
ctx.openApp('CLANG'); assert.strictEqual(fields.cedit.display, 0, 'restored'); ctx.openApp('TERMINAL'); assert.strictEqual(fields.cedit.display, 1); assert.strictEqual(fields.r0.display, 0);
vm.runInContext('delete root["MAIN.C"]', ctx); ctx.closeApp();
ctx.openApp('TERMINAL'); type('cls\nc\n'); assert.strictEqual(fields.mapp.value, 'C'); assert.strictEqual(fields.cedit.display, 0);
ctx.closeApp(); run(2); vm.runInContext('delete root["MAIN.C"]', ctx); ctx.openApp('TERMINAL'); type('cls\n'); ctx.closeApp();

// ---- the disk: files are copied into the hidden field and come back when the PDF is opened again ----
run(1);  // the redraw timer saves the disk
const saved = fields.disk.value;
assert.ok(saved.includes('"P.TXT":"one\\ntwo\\nthree"'), 'disk holds the file system');
const reopened = {}, t2 = new Map();
let id2 = 1;
const ctx2 = vm.createContext({
  getField: n => reopened[n] || (reopened[n] = { value: n === 'disk' ? saved : n === 'sunsaved' || n === 'wchrome' ? 'left visible by a save' : '', display: 0 }),
  display: { visible: 0, hidden: 1 },
  app: { setInterval: c => { t2.set(id2, c); return id2++; }, clearInterval: i => t2.delete(i) },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'os.js'), 'utf8'), ctx2);
for (let i = 0; i < 10; i++) for (const c of [...t2.values()]) vm.runInContext(c, ctx2);
assert.strictEqual(reopened.wchrome.display, 1, 'a window saved open does not come back empty');
assert.strictEqual(reopened.sunsaved.display, 1, 'a reopened PDF is not reported as unsaved');
const screen2 = () => Array.from({ length: 20 }, (_, i) => reopened['r' + i].value);
assert.ok(screen2().some(r => /^Disk restored from this PDF: \d+ files$/.test(r)), screen2().join('\n'));
for (const c of 'type p.txt\n') ctx2.key({ change: c, selStart: 1, selEnd: 1 });
assert.ok(screen2().includes('three'), screen2().join('\n'));
// a damaged disk value is ignored rather than crashing the boot
const bad = {};
const ctx3 = vm.createContext({
  getField: n => bad[n] || (bad[n] = { value: n === 'disk' ? '{"A.TXT": 1, "B":[2], broken' : '' }),
  app: { setInterval: () => 0, clearInterval: () => {} },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'os.js'), 'utf8'), ctx3);
vm.runInContext('boot()', ctx3);
assert.ok(vm.runInContext('loadDisk()', ctx3) === false && vm.runInContext('countFiles(root)', ctx3) > 0);
assert.ok(vm.runInContext('root["RECOVERED.TXT"]', ctx3).includes('broken'), 'a damaged disk is kept, not overwritten');
vm.runInContext('disk.value = JSON.stringify({ "A.TXT": "a", "N": 5, "L": [1], "D": { "B.TXT": "b" } }); loadDisk()', ctx3);
assert.strictEqual(vm.runInContext('countFiles(root) + "," + Object.keys(root).join(" ")', ctx3), '2,A.TXT D');

// ---- Files: browse, open by type, come back, create, and delete only after asking ----
const inFT = js => vm.runInContext(js, ctx);
inFT('root.FT = dir(); root.FT["A.C"] = "int main(){puts(\\"hi\\");return 0;}"; root.FT["B.TXT"] = "note"; root.FT["C.PY"] = "print(\\"py ok\\")"; root.FT.SUB = dir();');
ctx.openApp('FILES'); assert.strictEqual(fields.fopen.display, 0); assert.strictEqual(fields.frow0.display, 0); assert.strictEqual(fields.cprev.display, 0);
inFT('fDir = ["FT"]; fState.sel = 0'); run(1); row('C:\\FT'); assert.ok(screen()[2].startsWith('> SUB\\'), screen()[2]); assert.ok(screen()[3].includes('C code'), screen()[3]);
ctx.fClick(1); run(1); assert.ok(screen()[3].startsWith('> A.C'), screen()[3]); assert.strictEqual(fields.fh1.display, 0); assert.strictEqual(fields.fh0.display, 1);
ctx.fClick(1); assert.strictEqual(fields.wbar.value, 'A.C'); assert.strictEqual(fields.cedit.display, 0); assert.ok(fields.cedit.value.includes('puts')); assert.strictEqual(fields.crun.display, 0); assert.strictEqual(fields.fopen.display, 1);
ctx.cAct('run'); run(3); row('hi'); ctx.cAct('back'); run(1); ctx.closeApp(); run(2); assert.strictEqual(fields.wbar.value, 'Files'); row('C:\\FT'); assert.strictEqual(fields.cedit.display, 1);
assert.ok(screen()[3].startsWith('> A.C'), 'back on the file just closed: ' + screen()[3]);
ctx.fClick(2); ctx.fClick(2); assert.strictEqual(fields.wbar.value, 'B.TXT'); assert.strictEqual(fields.crun.display, 1, 'text has no Run');
fields.cedit.value = 'edited'; ctx.closeApp(); run(2); assert.strictEqual(inFT('root.FT["B.TXT"]'), 'edited'); row('Updated B.TXT');
ctx.fClick(3); ctx.fClick(3); ctx.cAct('run'); run(3); row('py ok'); ctx.closeApp(); run(2);
ctx.fClick(0); ctx.fClick(0); run(1); row('C:\\FT\\SUB'); cHas('This folder is empty.'); type('\b'); run(1); row('C:\\FT');
ctx.cAct('f:file'); run(1); type('new.c\n'); run(1); assert.strictEqual(inFT('root.FT["NEW.C"]'), ''); row('Created NEW.C');
ctx.cAct('f:file'); run(1); type('new.c\n'); run(1); row('NEW.C already exists.');
ctx.cAct('f:folder'); run(1); type('a b\n'); run(1); row('Use letters, numbers, . _ or - only.'); assert.strictEqual(inFT('root.FT["A B"]'), undefined);
inFT('fState.sel = fItems().map(function (x) { return x.name; }).indexOf("NEW.C")');
ctx.cAct('f:del'); run(1); row('Delete NEW.C? Press Delete again.'); assert.strictEqual(inFT('root.FT["NEW.C"]'), '');
type('w'); ctx.cAct('f:del'); run(1); assert.ok(inFT('"NEW.C" in root.FT'), 'moving away disarms Delete'); type('s'); ctx.cAct('f:del'); run(1); ctx.cAct('f:del'); run(1); row('Deleted NEW.C'); assert.ok(!inFT('"NEW.C" in root.FT'));
inFT('fDir = []; fState.sel = fItems().map(function (x) { return x.name; }).indexOf("FT")'); run(1);
ctx.cAct('f:del'); run(1); row('FT is not empty. Delete its files first.'); assert.ok(inFT('!!root.FT'));
inFT('for (var n = 0; n < 20; n++) root.FT["P" + n + ".TXT"] = "x"; fDir = ["FT"]; fState.sel = 0'); run(1); assert.strictEqual(fields.cpage.value, '1 / 2');
ctx.cAct('next'); run(2); assert.strictEqual(fields.cpage.value, '2 / 2'); ctx.cAct('prev'); run(2); assert.strictEqual(fields.cpage.value, '1 / 2');
ctx.minimizeApp(); run(1); assert.strictEqual(fields.fh0.display, 1, 'the tint hides with the window'); ctx.openApp('FILES'); run(1); assert.strictEqual(fields.frow0.display, 0);
ctx.closeApp(); run(1); assert.strictEqual(fields.fopen.display, 1); inFT('delete root.FT; fDir = []'); ctx.openApp('TERMINAL'); type('cls\nfiles\n'); assert.strictEqual(fields.wbar.value, 'Files'); ctx.closeApp(); run(2);

// ---- Settings: wallpaper, dark twins of the text fields, clock, kept in SETTINGS.CFG ----
ctx.openApp('SETTINGS'); row('Wallpaper'); assert.strictEqual(fields.s_w0_on.display, 0); assert.strictEqual(fields.s_w0.display, 1); assert.strictEqual(fields.s_w1.display, 0);
ctx.cAct('s:w2'); run(2); assert.strictEqual(fields.th20.display, 0); assert.strictEqual(fields.s_w2_on.display, 0); assert.strictEqual(fields.s_w0_on.display, 1);
assert.strictEqual(JSON.parse(vm.runInContext('root["SETTINGS.CFG"]', ctx)).wallpaper, 2);
ctx.cAct('s:m1'); run(2); assert.strictEqual(fields.th21.display, 0); assert.strictEqual(fields.th20.display, 1);
assert.strictEqual(fields.wchromeD.display, 0); assert.strictEqual(fields.wchrome.display, 1); assert.strictEqual(fields.rD0.display, 0); assert.strictEqual(fields.r0.display, 1);
assert.strictEqual(fields.mappD.value, 'Settings'); assert.strictEqual(fields.mapp.display, 1); assert.strictEqual(fields.rD0.value, 'Wallpaper'); assert.strictEqual(fields.kbdD.display, 0); assert.strictEqual(fields.kbd.display, 1);
ctx.cAct('s:c1'); run(2); assert.ok(/^\d{1,2}:\d\d [AP]M$/.test(fields.clockD.value), fields.clockD.value);
ctx.openApp('TERMINAL'); type('cls\necho dark\n'); assert.strictEqual(fields.rD1.value, 'dark'); assert.strictEqual(fields.wbarD.value, 'Terminal');
ctx.openApp('FILES'); run(1); assert.strictEqual(fields.fd0.display, 0); assert.strictEqual(fields.fh0.display, 1); assert.strictEqual(fields.s_w0.display, 1, 'Settings buttons stay out of other apps');
ctx.openApp('SETTINGS'); ctx.minimizeApp(); assert.strictEqual(fields.s_m1_on.display, 1); ctx.openApp('SETTINGS'); assert.strictEqual(fields.s_m1_on.display, 0);
ctx.cAct('s:m0'); run(2); ctx.cAct('s:w0'); run(2); ctx.cAct('s:c0'); run(2);
assert.strictEqual(fields.r0.display, 0); assert.strictEqual(fields.rD0.display, 1); assert.strictEqual(fields.th21.display, 1); assert.strictEqual(fields.mappD.display, 1); assert.ok(/^\d\d:\d\d$/.test(fields.clock.value), fields.clock.value);
ctx.closeApp(); run(2); vm.runInContext('delete root["SETTINGS.CFG"]', ctx); run(2);
{ const f4 = {}, t4 = new Map(); let id4 = 1;
  const c4 = vm.createContext({ getField: n => f4[n] || (f4[n] = { value: n === 'disk' ? JSON.stringify({ 'SETTINGS.CFG': '{"wallpaper":3,"dark":true,"h12":true}' }) : '', display: 0 }),
    display: { visible: 0, hidden: 1 }, app: { setInterval: x => { t4.set(id4, x); return id4++; }, clearInterval: i => t4.delete(i) } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'os.js'), 'utf8'), c4);
  for (let i = 0; i < 10; i++) for (const x of [...t4.values()]) vm.runInContext(x, c4);
  assert.strictEqual(f4.th31.display, 0, 'settings come back when the PDF is reopened'); assert.strictEqual(f4.clock.display, 1); assert.ok(/M$/.test(f4.clockD.value), f4.clockD.value); assert.strictEqual(f4.wchromeD.display, 1); }

// a Dock click during startup is kept and opens the app when boot ends
{ const f5 = {}, t5 = new Map(); let id5 = 1;
  const c5 = vm.createContext({ getField: n => f5[n] || (f5[n] = { value: '', display: 0, setFocus() {} }), display: { visible: 0, hidden: 1 },
    app: { setInterval: x => { t5.set(id5, x); return id5++; }, clearInterval: i => t5.delete(i) } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'os.js'), 'utf8'), c5);
  c5.openApp('CALC'); assert.strictEqual(vm.runInContext('currentApp', c5), null, 'not yet');
  for (let i = 0; i < 12; i++) for (const x of [...t5.values()]) vm.runInContext(x, c5);
  assert.strictEqual(vm.runInContext('currentApp', c5), 'CALC'); assert.strictEqual(f5.wbar.value, 'Calculator'); assert.strictEqual(f5.wchrome.display, 0); }

// a window change also changes the invisible field that makes Edge repaint, and nothing else does
{ const v0 = fields.paint.value; ctx.openApp('TERMINAL'); const v1 = fields.paint.value; assert.notStrictEqual(v0, v1, 'opening repaints');
  run(14); const idle = fields.paint.value; run(5); assert.strictEqual(fields.paint.value, idle, 'an idle tick does not touch the PDF');
  ctx.minimizeApp(); assert.notStrictEqual(fields.paint.value, idle, 'minimizing repaints');
  ctx.openApp('TERMINAL'); const v2 = fields.paint.value; ctx.closeApp(); assert.notStrictEqual(fields.paint.value, v2, 'closing repaints'); run(14); }

// ---- save status: Saved appears only after the viewer really cleared its changed flag ----
const shows = (u, v) => { assert.strictEqual(fields.sunsaved.display === 0, u, 'Unsaved'); assert.strictEqual(fields.ssaved.display === 0, v, 'Saved'); };
vm.runInContext('C_EDGE = true', ctx);
type('cls\n'); ctx.dirty = true; run(3); ctx.dirty = false; run(2); ctx.dirty = true; run(2);
ctx.dirty = false; type('echo a > z.txt\n'); run(3); shows(true, false);   // a flag never seen set proves nothing
ctx.dirty = true; run(2); ctx.dirty = false; run(2); shows(false, true);
ctx.dirty = true; run(1); shows(false, true);    // the screen changing afterwards is not a file change
type('del z.txt\n'); run(2); shows(true, false);
ctx.dirty = true; run(2); ctx.dirty = false; run(2); shows(false, true);
ctx.dirty = true; type('edit q.txt\nunfinished\n'); run(3); shows(true, false);
ctx.dirty = false; run(2); shows(true, false);   // a note still being written is not in the PDF yet
ctx.dirty = true; type(':q\n'); run(2); ctx.dirty = false; run(2); shows(false, true);
ctx.dirty = true; ctx.openApp('CLANG'); run(2); ctx.cKey({ value: fields.cedit.value, change: 'x', selStart: 0, selEnd: 0 }); run(3); shows(true, false);
assert.ok(vm.runInContext('root["MAIN.C"].charAt(0)', ctx) === 'x', 'typed code reaches the disk without Run or close');
ctx.closeApp(); run(2); vm.runInContext('delete root["MAIN.C"]; C_EDGE = false', ctx); ctx.dirty = undefined; run(2);

assert.strictEqual(timers.size, BASE_TIMERS, 'no timer leaked');
console.log('all tests passed');
