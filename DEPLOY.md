# 部署步驟

## 一、建立 Google Sheet

1. 用你的 Gmail 登入 Google Drive,新建一個 Google Sheet,命名例如 `Leave-WFH-Tracker`。
2. 建立三個分頁,並用以下表頭(順序、名稱必須完全一致,大小寫不拘):

### `Employees` 分頁
| name_en | name_zh | team | email | is_admin | active |
|---|---|---|---|---|---|
| Ivan | | CONSULTANT | (Ivan 的 Gmail) | FALSE | TRUE |
| Albert | | CONSULTANT | | FALSE | TRUE |
| YP | | CONSULTANT | | FALSE | TRUE |
| Cheer | | CONSULTANT | | FALSE | TRUE |
| News | | CONSULTANT | | FALSE | TRUE |
| Laura | | CONSULTANT | | FALSE | TRUE |
| James | 永正 | CONSULTANT | | FALSE | TRUE |
| Jeremy | | CONSULTANT | | FALSE | TRUE |
| Joe | | CONSULTANT | | FALSE | TRUE |
| Carol | 秋明 | MAINTENANCE | | FALSE | TRUE |
| JJ | 菁菁 | MAINTENANCE | | FALSE | TRUE |
| Edison | 秉原 | MAINTENANCE | | FALSE | TRUE |
| (你) | | (留空或 ADMIN) | linkei1983@gmail.com | TRUE | TRUE |

> 第一次先把你自己列為 `is_admin = TRUE`。同事的 email 可以之後再補。
> `team` 必須是 `CONSULTANT` 或 `MAINTENANCE`。

### `Requests` 分頁
| id | name_en | date | type | created_at | created_by_email | note |
|---|---|---|---|---|---|---|

(只放表頭,程式會自動寫入)

### `Holidays` 分頁
| date | type | name |
|---|---|---|

(只放表頭,部署後從管理面板匯入 CSV)

## 二、建立 Apps Script 專案

### 方案 A:用 `clasp`(推薦給開發者)

```bash
npm i -g @google/clasp
clasp login
# 在這個 repo 根目錄:
clasp create --type sheets --title "Leave-WFH-Tracker" --rootDir .
# 編輯產生的 .clasp.json,把 scriptId 設成新建專案的 id
clasp push
```

### 方案 B:手動貼入(無需 Node)

1. 在你建好的 Google Sheet 上開 **擴充功能 → Apps Script**。
2. 把 repo 內每個檔案的內容貼到 Apps Script 編輯器:
   - `.gs` 檔案(`Code.gs`、`auth.gs`、`data.gs`、`rules.gs`、`stats.gs`、`admin.gs`、`test.gs`)→ 新增 Script 檔案
   - `.html` 檔案(`Calendar.html`、`AdminPanel.html`、`styles.html`、`client.html`)→ 新增 HTML 檔案
   - `appsscript.json` → 在「專案設定」勾選「在編輯器中顯示 appsscript.json 資訊清單檔案」,然後貼上內容
3. 儲存。

## 三、設定 Spreadsheet 連結

如果是用方案 A 的 `clasp create --type sheets`,專案會自動綁定到新建的 Sheet。
否則:

- **若 Apps Script 是從 Sheet 開的**(擴充功能 → Apps Script):自動綁定,無需設定。
- **若是獨立專案**:到「專案設定 → Script Properties」,新增 `SPREADSHEET_ID`,值為 Sheet URL 中 `/d/` 後面那段 ID。

## 四、部署 Web App

1. Apps Script 編輯器 → 右上角「部署 → 新增部署」。
2. 類型選 **網路應用程式**。
3. 設定:
   - **Execute as**:**User accessing the web app**(重要!)
   - **Who has access**:`Anyone with a Google account`(若公司有 Google Workspace 可改成 `Anyone within <domain>`)
4. 部署 → 授權 → 取得 URL。
5. 把 URL 給同事,要求第一次開時用自己的 Gmail 登入。

## 五、自我測試

在 Apps Script 編輯器選擇 `test.gs` 的 `runAllTests` 函式 → 執行 → 看 Logger 輸出,應該 13/13 PASS。

## 六、匯入年度國定假日

1. 用管理員身分開 Web App,點右上角「管理面板」。
2. 把行政院公告的 CSV 貼進文字框,點「匯入並覆寫」。CSV 格式:

```
date,type,name
2026-01-01,HOLIDAY,中華民國開國紀念日
2026-02-16,HOLIDAY,春節
2026-02-17,HOLIDAY,春節
2026-02-18,HOLIDAY,春節
2026-02-27,MAKEUP_WORKDAY,補行上班
2026-02-28,HOLIDAY,和平紀念日
...
```

## 七、之後新增管理員

直接到 Google Sheet 的 `Employees` 分頁,把該員工的 `is_admin` 改成 `TRUE`,儲存即可。下次他/她重新整理頁面就會看到 ADMIN 視角。

## 疑難排解

- **「Not authorized: NOT_LISTED」**:該 Gmail 不在 Employees 表的 email 欄裡。
- **「Not authorized: NOT_LOGGED_IN」**:Apps Script 未拿到 email — 確認部署設定是 **User accessing the web app**,且使用者已用 Google 帳號登入。
- **修改規則**:改 `rules.gs`,跑 `runAllTests()` 確認,再重新部署(新增部署版本或「管理部署」→ 編輯 → 新版本)。
