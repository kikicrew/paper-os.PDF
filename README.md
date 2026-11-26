# PaperOS

**한국어** | [English](README.en.md)

**PDF 한 장 안에서 돌아가는 작은 운영체제.** 화면은 PDF 양식 필드(텍스트 칸·버튼)이고, 동작은 PDF에 넣은 JavaScript가 합니다. 이미지가 아니라 실제로 키보드·마우스 입력을 받아 실행됩니다.

*A tiny OS that lives inside a single PDF: form fields are the screen, embedded PDF JavaScript is the kernel.*

## 들어 있는 것

| 앱 | 내용 |
|---|---|
| Terminal | 명령줄 (`HELP`, `DIR`, `TYPE`, `FILES`, `SETTINGS`, `C` …) |
| Files | 파일 목록, 열기·새로 만들기·삭제·폴더 이동 |
| Notes | 메모장 |
| Calculator | 계산기 |
| Python | Python 부분집합 인터프리터 |
| C | 포인터·구조체·`printf`/`scanf`/`malloc` 를 지원하는 C 인터프리터와 줄 번호 편집기 |
| Snake · BLOCKS · Dodge | 간단한 게임 |
| Settings | 테마 4종(밝게/어둡게), 12/24시간 시계 |

파일과 설정은 PDF 안의 숨은 필드에 저장되므로, 뷰어에서 **저장(Ctrl+S)** 하면 PDF 파일 자체에 남습니다.

## 실행

1. [Node.js](https://nodejs.org) 설치 (외부 패키지 필요 없음)
2. PDF 만들기
   ```
   node build.js
   ```
3. `PaperOS.pdf` 를 **Microsoft Edge** 로 엽니다. Windows에서는 `PaperOS 실행.bat` 이 Edge 앱 창으로 크게 열어 줍니다.

> PDF JavaScript와 양식 필드를 지원하는 뷰어가 필요합니다. Edge에서 가장 잘 동작하고, Chromium 계열(PDFium) 뷰어는 일부만 됩니다. 이미지형 뷰어나 JavaScript를 끈 뷰어에서는 동작하지 않습니다.

## 테스트

```
node test.js
```

`os.js` 를 Node의 `vm` 에서 가짜 양식 필드와 함께 실행해 터미널, 앱, C·Python 인터프리터, 저장을 검사합니다.

## 구조

| 파일 | 역할 |
|---|---|
| `os.js` | OS 전체 (입력 처리, 창·Dock, 앱, 인터프리터, 저장). PDF에 그대로 들어가므로 ASCII만 사용 |
| `build.js` | 의존성 없이 PDF를 직접 써 내는 생성기 (배경 그림, 필드 배치, 스크립트 삽입) |
| `test.js` | Node 테스트 |
| `PaperOS 실행.bat` | Windows용 실행기 |

**작동 원리:** 각 줄의 텍스트 필드가 화면 역할을 하고, 화면 밖 입력 칸이 키 입력을 받습니다. PDF 타이머(`app.setInterval`)가 시계·게임·C 프로그램 실행을 조금씩 진행시키고, 버튼 필드의 표시/숨김으로 창과 테마를 바꿉니다.

## 보안 · 개인정보

- 네트워크 접근, 외부 파일 읽기, 외부 코드 내려받기가 **없습니다.** 모든 코드는 PDF 안에 있습니다.
- 직접 빌드·저장한 PDF에는 자신이 만든 파일과 설정이 들어가므로, 저장소에는 PDF를 올리지 않도록 `.gitignore` 로 제외했습니다.

## 저작권

모든 코드와 그림은 이 프로젝트에서 새로 만든 것이며 외부 라이브러리·폰트·이미지를 포함하지 않습니다 (글꼴은 PDF 표준 내장 글꼴 Courier/Helvetica 참조만 사용). 게임은 일반적인 장르 규칙만 따르며 특정 상표·캐릭터를 쓰지 않습니다. Microsoft Edge 등은 각 소유자의 상표이며, 이 프로젝트와 관련이 없습니다.

[MIT License](LICENSE)
