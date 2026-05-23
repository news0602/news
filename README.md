# Team Leave / WFH Planner

12 人小團隊用的請假與 WFH 規劃系統。整套跑在 Google Apps Script + 一個
Google Sheet 上,免額外伺服器、免費。

## 角色

- **MEMBER**:看日曆與統計;點日期可以試探「能不能請」,系統回覆可/不可,
  但**不寫入任何資料**。要實際登記請通知管理員。
- **ADMIN**(預設 `linkei1983@gmail.com`):唯一可以寫入日曆紀錄的人;規則檢查
  仍會跑但可覆蓋;能匯入年度國定假日、管理員工名單與切換其他管理員。
- 未在 `Employees` 表內的 Gmail 開啟網址會看到「請聯絡管理員開通」畫面。

## 檔案結構

```
appsscript.json   Apps Script 資訊清單
Code.gs           doGet / API endpoints
auth.gs           登入者識別與權限
data.gs           Sheet CRUD
rules.gs          14 條請假/WFH 規則引擎(純函式)
stats.gs          月度統計
admin.gs          行事曆 CSV 匯入
test.gs           runAllTests() 自我測試(無框架)
Calendar.html     主畫面(三月並排日曆 + 統計 + 對話框)
AdminPanel.html   匯入行事曆 / 員工管理
styles.html       CSS(由模板 include 進主畫面)
client.html       前端 JS(google.script.run)
DEPLOY.md         部署步驟
```

## 規則一覽

1. 顧問組同日 WFH 上限 3 人
2. 顧問組同日 leave + WFH 上限 4 人
3. 顧問組週一至週四,當日請假已滿 3 人 → 不再開放 WFH
4. 每人每月週五 WFH 上限 2 次
5. 同人同一週幾連續第三週 → 拒
6. WFH 不可橫跨週末(週五 WFH + 下週一 WFH → 拒)
7. WFH 不可排週六日 / 國定假日
8. 連假前後若加上 WFH 造成 5+ 天不在辦公室 → 拒
9. 4 天以上連假前後不開放純 WFH(請與主管討論)
10. Carol↔JJ、James↔News 對撞組合,同日已有對方紀錄 → 拒
11. 維護組 Edison 不可與其他維護組成員同日不在辦公室
12. 同人同日不可重複申請

管理員可在警告對話框點「仍要覆蓋寫入」強制儲存(會在 `note` 標註 `OVERRIDE`)。

## 部署

詳見 [DEPLOY.md](./DEPLOY.md)。
