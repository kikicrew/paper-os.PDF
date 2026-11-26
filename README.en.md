# PaperOS

[한국어](README.md) | **English**

**A tiny operating system that runs inside a single PDF.** The screen is made of PDF form fields (text boxes and buttons), and the PDF's embedded JavaScript does the work. It is not a picture: it takes real keyboard and mouse input and runs programs.

## What's inside

| App | What it does |
|---|---|
| Terminal | Command line (`HELP`, `DIR`, `TYPE`, `FILES`, `SETTINGS`, `C` …) |
| Files | File list: open, create, delete, move between folders |
| Notes | Notepad |
| Calculator | Calculator |
| Python | Interpreter for a subset of Python |
| C | C interpreter with pointers, structs, `printf`/`scanf`/`malloc`, plus a line-numbered editor |
| Snake · BLOCKS · Dodge | Small games |
| Settings | 4 themes (light/dark), 12/24-hour clock |

Files and settings are kept in hidden fields inside the PDF, so **saving in the viewer (Ctrl+S)** stores them in the PDF file itself.

## Running it

1. Install [Node.js](https://nodejs.org) (no packages needed)
2. Build the PDF
   ```
   node build.js
   ```
3. Open `PaperOS.pdf` in **Microsoft Edge**. On Windows, `PaperOS 실행.bat` ("Run PaperOS") opens it in a large Edge app window.

> You need a viewer that supports PDF JavaScript and form fields. It works best in Edge; Chromium-based (PDFium) viewers work only in part. It does not work in image-only viewers or with JavaScript turned off.

## Tests

```
node test.js
```

Runs `os.js` in Node's `vm` with fake form fields and checks the terminal, the apps, the C and Python interpreters, and saving.

## Layout

| File | Role |
|---|---|
| `os.js` | The whole OS (input, windows and Dock, apps, interpreters, saving). It goes into the PDF as is, so it is ASCII only |
| `build.js` | Dependency-free generator that writes the PDF directly (background art, field layout, script) |
| `test.js` | Node tests |
| `PaperOS 실행.bat` | Windows launcher |

**How it works:** each screen line is a text field, and an input box takes the key presses. A PDF timer (`app.setInterval`) advances the clock, the games and running C programs a little at a time, and showing or hiding button fields switches windows and themes.

## Security and privacy

- No network access, no reading outside files, no downloaded code. All code lives inside the PDF.
- A PDF you build and save holds your own files and settings, so `.gitignore` keeps PDFs out of the repository.

## Copyright

All code and artwork were made for this project; no outside libraries, fonts or images are included (fonts are only referenced by name: the standard PDF fonts Courier and Helvetica). The games follow common genre rules and use no trademarks or characters. Microsoft Edge and other names are trademarks of their owners and are not affiliated with this project.

[MIT License](LICENSE)
