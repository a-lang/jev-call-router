# jev-call-router

<p align="center">
  <img src="assets/cover.zh-TW.png" alt="jev-call-router：智慧分流，不該靠按鍵" width="100%">
</p>

<p align="center">
  <strong>繁體中文</strong> · <a href="README.en.md">English</a>
</p>

**讓來電者說一句話，就能接到正確的佇列或分機。**

jev-call-router 是一個 TypeScript 服務與函式庫：把電話語音轉成文字，交給 [Jev by TypeSafe AI](https://typesafe.ai) 判斷意圖，再由你的 PBX 執行一個你事先定義好的動作。

Jev 只回傳「這是哪一類」與信心分數，不碰 PBX。你能執行的動作只有三種：轉接、回到 dialplan、掛斷。

`Bun 1.3+` · `TypeScript` · `MIT` · `Asterisk / FreePBX`

---

## 這是什麼

傳統 IVR 要求來電者記住按鍵；讓 LLM 直接控制交換機，則等於把任意指令的入口交給一個會自由生成內容的模型。

這個專案走第三條路：把「理解」和「執行」分開。

- 來電者自然說話，不需要記選單。
- 你把可接受的結果定義成 routes（名稱 + 描述 + 動作）。
- Jev 只做選擇題：從這份清單裡挑一個，回傳路由名稱與信心分數，不生成自由文字。
- 信心不足、服務中斷、逾時、聽不懂，一律走你指定的 fallback；也可以依失敗原因另外設定，例如連續靜音直接掛斷。

因為 Jev 的輸出被限制在已知的 routes 內，它不會編造出一個不存在的分機、動作或指令。清單外的值會被判為 `invalid-decision` 並直接 fallback。它仍可能判斷錯意圖，但錯誤的影響範圍就是你事先寫在 `router.config.ts` 裡的那幾條路徑。

> **邊界很清楚**：Jev 不會產生 dialplan、不會決定分機號碼、也不會呼叫 ARI。所有可執行的動作都由你事先定義。

一句話版本：把 IVR 的按鍵換成自然語言，但保留 IVR 的可預測性。

## 什麼情況適合

這個專案不是通用語音助理。適不適合，主要取決於你的來電能不能事先分類，以及你願不願意讓 PBX 保留最後的執行權。

| 情境 | 判斷 | 原因 |
|---|---|---|
| 已經有 Asterisk / FreePBX，想用自然語言取代多層 IVR | 適合 | 直接接 ARI；可以先讓一條 DID 走 Jev，不必一次換掉整個總機 |
| 來電意圖可以事先列舉（訂單、退換貨、帳務、真人） | 適合 | Jev 只能從你給的清單選；3–6 類最容易維持穩定，更多類別需要自行驗證 |
| 需要 VIP、營業時間、特定號碼直通 | 適合 | `routeDirectly()` 在 Jev 之前執行，這些規則不會被模型改寫 |
| 想把結果送進 CRM、工單或 dashboard | 適合 | 每通電話都有 `RoutingResult`、webhook 與 SSE 事件 |
| 需要多輪自由對話、打斷、即時串流語音 | 不適合 | 流程是「播放 → 錄音 → 判斷」，一次處理一段話，不是持續對話 |
| 想讓模型直接執行任意 PBX 指令 | 不適合 | 設計上只允許你定義的 routes 與三種 action |
| 要求完全離線或毫秒級延遲 | 不適合 | 需要外部 STT 與 Jev API，無法離線，也壓不到毫秒級 |
| 沒有電話系統，只想做網站 chatbot | 不適合 | 這是 PBX 前的分流層，不是對話機器人框架 |

實際適合的場景：

- **電商客服**：訂單進度、退換貨、商品諮詢、真人客服
- **SaaS 客服台**：業務、技術支援、帳務、真人
- **中小企業總機**：預約、報價、售後、櫃檯
- **任何「按鍵選單已經長到沒人想聽完」的來電流程**

## 和傳統 IVR、LLM agent 的差別

| | 傳統 IVR | LLM 直接控制 PBX | jev-call-router |
|---|---|---|---|
| 來電者體驗 | 記按鍵、聽長選單 | 自然對話 | 自然說一句話 |
| 動作範圍 | 固定選單 | 模型可能產生任意指令 | 只能執行你定義的 route |
| 失敗處理 | 重聽或掛斷 | 難以預測 | 明確的 fallback 與原因碼 |
| 可觀測性 | 低 | 視實作而定 | 每次通話都有結構化結果與事件 |
| 幻覺風險 | 無模型 | 可能編造不存在的指令 | 只能從 routes 選，未知值直接拒絕 |
| 維護 | 改選單就要改流程 | 要不斷調 prompt | 改一份 routes 設定 |

## 一通電話會發生什麼

系統位置：

```
來電 ──▶ PBX（Asterisk / FreePBX）
         │ Stasis(jev-router)
         ▼
         jev-call-router ──▶ 語音轉文字 ──▶ Jev（只回傳分類）
         │                                  │
         └──── 執行你定義的 action ◀────────┘
               轉接 / 回 dialplan / 掛斷
```

決策路徑：

```
routeDirectly() 命中 ──▶ 直接路由（不呼叫 Jev）
  │ 沒有
  ▼
  播放問候 → 錄音 → 語音轉文字
  ▼
  Jev 從你定義的 routes 中選一個
  ▼
  是已知 route，且信心 ≥ minConfidence？
    ├─ 否 / 需要更多資訊 → 重問（最多 maxAttempts）
    └─ 是 → 執行動作
  任何階段失敗 → fallbackRoute（可用 fallbackRouteByReason 依原因改道）→ 仍失敗 → 回 dialplan
```

## 快速開始

需求：

- [Bun](https://bun.sh) 1.3+
- TypeSafe API key（Jev）
- 語音轉文字服務：任何 OpenAI 相容的 `/audio/transcriptions`，或 ElevenLabs Scribe
- Asterisk 16+ 或 FreePBX 16/17（只有要接真電話時需要）

### 第 1 步：看視覺化 demo（不需要 PBX、不需要 STT）

```bash
git clone https://github.com/rayanweragala/jev-call-router
cd jev-call-router
bun install
cp .env.example .env       # 填入 TYPESAFE_API_KEY
bun run demo               # http://localhost:3000
```

你會看到 10 條來電線路、5 個目的佇列，以及每通電話從 Ringing → Transcribing → Classifying → 路由的過程。頁面透過 SSE 接真實路由事件；沒有事件時會自動切到瀏覽器內的模擬模式。

### 第 2 步：用文字模擬一通電話（真的呼叫 Jev）

```bash
bun run simulate "我上週訂的耳機還沒到"
bun run simulate "我要退貨" "訂單編號 A12345"
bun run simulate "我要找真人客服"
bun run simulate "這個月發票金額好像不對"
```

第二句會回答重試提示。輸出包含 `played`（播放了哪些語音）、`executed`（執行了哪個動作）與完整的 `result`。

### 第 3 步：接上電話系統

補齊 `.env` 的 ARI 與 STT 設定，然後：

```bash
bun start
```

這會同時啟動 ARI 連線與 HTTP 服務（視覺化與 SSE，預設 `http://localhost:3000`）。Asterisk 與 FreePBX 的完整設定步驟見 [INTEGRATION.md](INTEGRATION.md)。

## 定義你的 routes

一個 route 就是三個欄位：

```ts
interface Route {
  description?: string;   // 給 Jev 看的判斷依據
  action: CallAction;     // 真正執行的動作
  announcement?: string;  // 執行前先播放的語音（可選）
}
```

- 只有**有 `description`** 的 route 會被提供給 Jev。
- 沒有 `description` 的 route 只能透過 `routeDirectly()` 或作為 fallback（`fallbackRoute` / `fallbackRouteByReason`）進入。
- `action` 只有三種：

| 動作 | 效果 |
|---|---|
| `{ type: "transfer", destination: "context,extension,priority" }` | 把通道交回 dialplan 的指定位置 |
| `{ type: "continue" }` | 從 `Stasis()` 的下一行繼續執行 |
| `{ type: "hangup" }` | 掛斷 |

### 範例：電商平台客服總機

把下面這段放進 `router.config.ts`，換掉預設的 routes 即可：

```ts
export const routes: Record<string, Route> = {
  "order-status": {
    description: "查詢訂單進度、出貨狀態或配送異常。",
    action: { type: "transfer", destination: "ext-queues,300,1" },
  },
  returns: {
    description: "辦理退貨、換貨或詢問退款進度。",
    action: { type: "transfer", destination: "ext-queues,301,1" },
  },
  product: {
    description: "詢問商品規格、尺寸、庫存或到貨時間。",
    action: { type: "transfer", destination: "ext-queues,302,1" },
  },
  "human-agent": {
    description: "想直接找真人客服。",
    action: { type: "transfer", destination: "from-did-direct,100,1" },
  },
  "after-hours": {
    action: { type: "continue" },
  },
  // 沒有 description，Jev 看不到；只有 fallbackRouteByReason 會用到
  hangup: {
    action: { type: "hangup" },
    announcement: "sound:custom/jev-no-speech",
  },
};

export const fallbackRoute = "human-agent";

// 連續靜音時先播提示音再掛斷；其餘失敗仍走 fallbackRoute
export const fallbackRouteByReason = {
  "no-speech": "hangup",
};
```

對應上面 routes 的來電語音範例：

| 來電者可能說 | 預期 route | 說明 |
|---|---|---|
| 「我上週訂的耳機還沒到，想問什麼時候會出貨」 | `order-status` | 出貨與配送進度 |
| 「我要退貨，訂單編號 A12345」 | `returns` | 退貨、退款 |
| 「這雙鞋有 26 公分的嗎？」 | `product` | 商品規格、庫存 |
| 「我要找真人客服」 | `human-agent` | 明確要求真人 |
| 「請問你們過年有營業嗎？」 | `human-agent` | 沒有對應 route，走 `fallbackRoute` |
| （連續靜音，沒有說話） | `hangup` | `no-speech` fallback，先播提示音再掛斷 |

寫 `description` 時，直接把來電者可能說的用詞放進去，比只寫抽象分類名稱更容易命中。

搭配一條不經過 Jev 的直通規則：

```ts
routeDirectly: (call) =>
  call.variables.jev === "off" ? "after-hours" : undefined,
```

`after-hours` 沒有 `description`，所以 Jev 看不到它；只有當 dialplan 傳來 `jev=off` 時才會被選中。這就是「可預測性優先」的用法。

規則：

- route 名稱必須符合 `^[a-z0-9][a-z0-9_-]*$`。
- `need-more-information` 與 `no-matching-route` 是保留名稱。
- `fallbackRoute` 必填，而且必須是已定義的 route。
- `fallbackRouteByReason` 的 key 必須是合法的失敗原因，指向的 route 必須已定義，否則啟動時報錯。
- 至少一個 route 要有 `description`，否則啟動時會直接報錯。

更多完整設定（VIP 直通、營業時間、隱私摘要）見 [examples/routing-scenarios.ts](examples/routing-scenarios.ts)。

## 環境變數

完整範例見 [.env.example](.env.example)。

**Jev**

| 變數 | 必填 | 說明 |
|---|---|---|
| `TYPESAFE_API_KEY` | 是 | Jev API key |
| `TYPESAFE_DEFAULT_MODEL` | 否 | 固定模型版本（SDK 預設 `jev-latest`） |

**語音轉文字**

| 變數 | 必填 | 說明 |
|---|---|---|
| `STT_API_KEY` | 是 | STT 服務金鑰 |
| `STT_BASE_URL` | 是 | OpenAI 相容服務填到 `/v1`，例如 `https://api.openai.com/v1` |
| `STT_MODEL` | 是 | 轉錄模型名稱 |
| `STT_PROVIDER` | 否 | 設為 `elevenlabs` 時改用 ElevenLabs Scribe |
| `STT_LANGUAGE` | 否 | ISO-639-1 語言提示，例如 `zh` |
| `STT_DEBUG` | 否 | `1` 或 `true` 時把轉錄結果印到終端機 |

ElevenLabs 設定：

```bash
STT_PROVIDER=elevenlabs
STT_BASE_URL=https://api.elevenlabs.io
STT_MODEL=scribe_v2
```

**Asterisk（只有 `bun start` 需要）**

| 變數 | 必填 | 說明 |
|---|---|---|
| `ARI_URL` | 是 | 例如 `http://127.0.0.1:8088` |
| `ARI_USERNAME` | 是 | ARI 使用者 |
| `ARI_PASSWORD` | 是 | ARI 密碼 |
| `ARI_APP` | 否 | Stasis app 名稱（預設 `jev-router`） |
| `RECORD_MAX_SECONDS` | 否 | 單次錄音上限秒數（預設 `15`） |
| `RECORD_MAX_SILENCE_SECONDS` | 否 | 靜音幾秒後停止錄音（預設 `2`） |

**選用**

| 變數 | 說明 |
|---|---|
| `ANTHROPIC_API_KEY` | 啟用 Claude interpreter 時需要 |
| `WEBHOOK_URL` | 每通電話結束後 POST 路由結果 |
| `WEBHOOK_SECRET` | 用 HMAC-SHA256 簽署 webhook |
| `PORT` | HTTP 服務埠（預設 `3000`） |

## 接上 Asterisk / FreePBX

一句話：dialplan 把通話交給 `Stasis(jev-router)`，router 應答、播音、錄音、判斷，最後用 ARI 的 `continue` 回到你指定的 dialplan 位置。

### Asterisk：最小可運作設定

以下設定可以直接複製；對應的完整檔案在 [`examples/asterisk/`](examples/asterisk/)。

**`/etc/asterisk/http.conf`**

```ini
[general]
enabled = yes
bindaddr = 127.0.0.1
bindport = 8088
```

**`/etc/asterisk/ari.conf`**

```ini
[general]
enabled = yes
pretty = no

[jev]
type = user
read_only = no                       ; 需要 answer / play / record，不能唯讀
password = 換成長一點的隨機字串         ; openssl rand -hex 24
```

**`/etc/asterisk/extensions.conf`**

```ini
[jev-router]
exten => s,1,NoOp(Jev routing for ${CALLERID(num)})
 same => n,Stasis(jev-router,line=main)
 same => n,NoOp(Stasis returned: ${STASISSTATUS})
 same => n,Goto(internal,100,1)      ; 保底：router 沒接手時的目的地

[from-pstn]
exten => 8000,1,Goto(jev-router,s,1)
```

`Stasis()` 的下一行是保底目的地：router 沒在跑、連線中斷，或 route 動作執行失敗時，通話會落到這裡。`Stasis()` 後面接的 `key=value` 會變成 `call.variables`，可用於 `routeDirectly`。

**`.env`**

```ini
ARI_URL=http://127.0.0.1:8088
ARI_USERNAME=jev
ARI_PASSWORD=<ari.conf 裡設定的密碼>
ARI_APP=jev-router
```

**提示音**

四組提示音的台詞：

| 提示音 | 文字 |
|---|---|
| `jev-greeting` | 您好，請問您需要什麼服務呢？ |
| `jev-retry` | 抱歉！我沒聽清楚，請再說一次 |
| `jev-connecting` | 正在為你轉接，請稍後 |
| `jev-no-speech` | 抱歉，沒有聽到您的回應，請稍後再撥 |

現成錄音放在 `assets/sounds/tw/`（台灣華語）與 `assets/sounds/en/`（英文），各有 `jev-greeting.mp3`、`jev-retry.mp3`、`jev-connecting.mp3`、`jev-no-speech.mp3`。把這四個名稱放進 `/var/lib/asterisk/sounds/custom/`；建議轉成 8 kHz 單聲道：

```bash
# 從 WAV
sox greeting-raw.wav -r 8000 -c 1 -b 16 /var/lib/asterisk/sounds/custom/jev-greeting.wav

# 從現成的 MP3 批次轉檔（英文版把 tw 改成 en）
SOUNDS_DIR=assets/sounds/tw
for f in "$SOUNDS_DIR"/jev-*.mp3; do
  lame --decode "$f" - | sox -t wav - -t wav -b 16 -r 8000 -c 1 \
    "/var/lib/asterisk/sounds/custom/$(basename "${f%.mp3}").wav"
done
```

需要先安裝 `lame` 與 `sox`（例如 `sudo apt install lame sox`），且寫入 `/var/lib/asterisk/sounds/custom/` 需要對應權限。

`router.config.ts` 以 `sound:custom/jev-greeting` 引用，不加副檔名。

**重新載入與檢查**

```bash
asterisk -rx "module reload res_ari.so"
asterisk -rx "dialplan reload"
asterisk -rx "http show status"     # ARI 應掛在 /ari
asterisk -rx "ari show users"       # 應看到 jev

bun start

asterisk -rx "ari show apps"        # 應出現 jev-router
```

### 純 Asterisk 的 destination

`router.config.ts` 的預設 destination 是 FreePBX 的 context。純 Asterisk 沒有 `ext-queues`、`from-did-direct`，要改成你自己的 context，否則每條 route 都會轉接失敗並落到 `fallbackRoute`。

| 要去的地方 | 純 Asterisk | FreePBX |
|---|---|---|
| 分機 100 | `internal,100,1` | `from-did-direct,100,1` |
| Queue 400 | `queues,400,1` | `ext-queues,400,1` |
| 響鈴群組 600 | 自行定義 context | `ext-group,600,1` |
| 分機 100 的語音信箱 | `internal,vm100,1` | `ext-local,vmu100,1` |

表中的 `internal`、`queues` 是範例，換成你實際的 context。用 `asterisk -rx "dialplan show <context>"` 確認目標存在。

### FreePBX

FreePBX 就是 Asterisk，沒有專屬程式碼。差異只在設定位置：

1. 在 Settings > Advanced Settings 確認 mini-HTTP server 與 ARI 已啟用。不要直接改 `ari.conf`；要自訂使用者時寫在 `ari_additional_custom.conf`。
2. 把 `[jev-router]` 貼進 `extensions_custom.conf`，執行 `fwconsole reload`。
3. 建一個 Custom Destination 指向 `jev-router,s,1`。
4. 把要使用 Jev 的 DID 目的地設成這個 Custom Destination。
5. 在 System Recordings 建立四個提示音（`jev-greeting`、`jev-retry`、`jev-connecting`、`jev-no-speech`）。
6. route 目的地使用 FreePBX context，例如 `ext-queues,400,1`、`ext-group,600,1`、`from-did-direct,100,1`、`ext-local,vmu100,1`。

### 接不起來時先看這裡

| 症狀 | 先查 |
|---|---|
| 來電立刻回保底 | `ari show apps` 沒有 `jev-router`，代表 `bun start` 沒連上：檢查 `ARI_USERNAME`、`ARI_PASSWORD`、`ARI_APP` 與 8088 連通性 |
| 有錄音但轉接失敗 | destination 的 context 或 extension 不存在，用 `dialplan show <context>` 確認 |
| 播音失敗 | 音檔不在 `/var/lib/asterisk/sounds/custom/`，或格式不對 |

逐步設定與檢查指令見 [INTEGRATION.md](INTEGRATION.md)。

## 失敗時會怎樣

`fallbackRoute` 必填。以下情況都會落到它（可用 `fallbackRouteByReason` 為特定原因指定別的 route）：

- **語音階段**：沒聽到聲音（預設設定改掛斷，見下方）、STT 失敗、STT 逾時（8 秒）
- **理解階段**：interpreter 失敗或逾時（6 秒）
- **決策階段**：Jev 失敗或逾時（5 秒）、回傳不存在的 route、信心低於 `minConfidence`、重問後仍需要更多資訊、無對應 route
- **執行階段**：轉接失敗、PBX 錯誤

如果 fallback 的動作也失敗，router 會把通話交回 dialplan（`continue`），由你 `Stasis()` 下一行的保底邏輯接手。來電者在過程中掛斷的話，不會執行任何動作。

預設的 `router.config.ts` 用 `fallbackRouteByReason` 把 `no-speech` 導向 `hangup` route：連續靜音時先播 `sound:custom/jev-no-speech` 再掛斷，不轉真人；其他原因仍轉 `human-agent`。注意掛斷不經過 dialplan，`Stasis()` 下一行的保底不會被觸發；若掛斷本身失敗，router 仍會把通話交回 dialplan。

每次通話都會產生一個 `RoutingResult`，包含 `outcome`（`jev` / `direct` / `fallback` / `caller-hung-up`）、選中的 route、fallback 原因、Jev 的選擇與機率、嘗試次數，以及各階段耗時。

---

# 開發者指南

以下內容給要修改程式、接別的 PBX、或整合進自家系統的人。

## 架構

```
src/
  router.ts        決策流程；不認識任何 PBX
  types.ts         公開型別（route、action、session、result）
  config.ts        設定驗證、預設值、requireEnv
  jev.ts           DecisionProvider：官方 @typesafe-ai/sdk
  providers/
    speech.ts      OpenAI 相容 STT 與 ElevenLabs Scribe
    interpreter.ts 選用的 Claude 摘要器（去識別化）
  pbx/asterisk/    ARI adapter（fetch + WebSocket）
  http.ts          /events、/simulate、/api/health、視覺化
  events.ts        SSE 事件匯流排
  webhook.ts       簽章 webhook 遞送
  testing.ts       scripted session、textSpeech（測試與 simulate）
  server.ts        bun start 進入點
  demo-server.ts   bun run demo 進入點
router.config.ts   你的 routes、providers、fallback
public/index.html  即時視覺化
assets/sounds/     現成的台灣華語與英文提示音 MP3
```

核心（`router.ts`、`jev.ts`、`types.ts`）不知道 Asterisk 的存在。PBX adapter 只要實作 `CallSession`，就能接上同一套決策流程。

使用方式：Bun 直接執行 TypeScript，沒有 build step。套件匯出點只有 `./src/index.ts`。

## 核心抽象

```ts
interface CallSession {
  readonly call: CallInfo;
  play(media: string): Promise<void>;
  recordUtterance(): Promise<CallerAudio | undefined>;
  execute(action: CallAction): Promise<void>;
}

interface DecisionProvider {
  decide(context: DecisionContext, signal: AbortSignal): Promise<Decision>;
}

interface SpeechToText {
  transcribe(audio: CallerAudio, signal: AbortSignal): Promise<string>;
}

// 選用：先把逐字稿整理成不含個人資料的摘要
interface CallInterpreter {
  interpret(utterances: string[], signal: AbortSignal): Promise<CallInterpretation>;
}
```

`DecisionContext` 只包含：逐字稿（或摘要）、你的 route 描述、`facts(call)` 回傳的事實。來電號碼與通道資訊不會送給 Jev，除非你放進 `facts`。

## 決策規則

1. `routeDirectly(call)` 先跑。回傳 route 就跳過 Jev，適合 VIP、營業時間、dialplan 旗標。
2. 只有有 `description` 的 route 會提供給 Jev，加上兩個保留結果：`need-more-information`、`no-matching-route`。
3. Jev 只看到最小上下文：`utterances`（或 interpreter 的 `summary`）與 `facts`。
4. 決策必須是已知 route，且信心 ≥ `minConfidence`。低信心或 `need-more-information` 會重問，最多 `maxAttempts` 次。
5. 無效結果、`no-matching-route`、逾時、例外，直接走 fallback。

`evaluateDecision()` 有獨立匯出，方便在自己的測試裡驗證決策規則。

## 擴充點

| 想做的事 | 動哪裡 |
|---|---|
| 接另一個 PBX | 實作 `CallSession`，每通電話呼叫 `router.handleCall(session)` |
| 換決策模型 | 實作 `DecisionProvider`，傳給 `createCallRouter({ decider })` |
| 換語音轉文字 | 實作 `SpeechToText`；內建 OpenAI 相容與 ElevenLabs |
| 只做決策、不碰語音 | `router.routeTranscript(call, utterances)` |
| 減少送給 Jev 的個資 | 加上 `interpreter: createClaudeInterpreter()` |
| 接 CRM / 工單 | 用 `onResult` 接 `sendWebhook`，或自己寫 |
| 做自己的 dashboard | 訂閱 `eventHub`，或接 `GET /events` |
| 加測試 | 用 `createScriptedSession` 與 `textSpeech`，不需要真的 PBX |

## createCallRouter 選項

| 選項 | 預設 | 說明 |
|---|---|---|
| `routes` | 必填 | 你的分流結果；只有有 `description` 的會給 Jev |
| `fallbackRoute` | 必填 | 無法安全完成時使用的 route |
| `fallbackRouteByReason` | 無 | 依失敗原因改走指定 route；未設定的原因仍用 `fallbackRoute` |
| `prompts.greeting` | 必填 | 第一次播放的語音 |
| `prompts.retry` | 同 greeting | 重問時播放的語音 |
| `maxAttempts` | `2` | 最多聽幾次 |
| `minConfidence` | `0.7` | 低於此值就重問或 fallback |
| `timeouts` | STT 8s / interpreter 6s / Jev 5s | 各階段逾時 |
| `routeDirectly(call)` | 無 | 回傳 route 名稱即可跳過 Jev |
| `facts(call)` | 無 | 額外給 Jev 的事實，例如 `{ afterHours: true }` |
| `interpreter` | 無 | 先把逐字稿摘要再給 Jev |
| `onResult(result)` | 無 | 每通電話的 `RoutingResult` |
| `logger` | 靜默 | `createJsonLogger()` 輸出 JSON lines |
| `debugTranscript` | `false` | 把逐字稿印到日誌 |

## CLI 與 HTTP 端點

```bash
bun start                                    # 接 Asterisk 並開始路由
bun run demo                                 # 視覺化 + 模擬輸入
bun run simulate "我要退貨" "訂單 A12345"      # 文字代替語音，真的呼叫 Jev
bun test                                     # 單元與整合測試
bun run typecheck                            # tsc --noEmit（strict）
```

`bun start` 與 `bun run demo` 都會啟動 HTTP 服務：

| 端點 | 說明 |
|---|---|
| `GET /` | 視覺化頁面 |
| `GET /events` | SSE 事件串流；連線時先送一個 `connected` 事件 |
| `POST /simulate` | 用 scripted session 跑一次完整流程（真的呼叫 Jev） |
| `GET /api/health` | `{ status: "ok", subscribers }` |

`POST /simulate` 範例：

```bash
curl -X POST http://localhost:3000/simulate \
  -H "Content-Type: application/json" \
  -d '{"utterances": ["你好？", "我要退貨，訂單 A12345"]}'
```

回應：

```json
{ "ok": true, "result": { "callId": "simulated-...", "outcome": "jev", "route": "returns" } }
```

## Webhook

設定 `WEBHOOK_URL` 後，每通電話結束會收到一個 POST。`data` 就是完整的 `RoutingResult`：

```json
{
  "event": "call.result",
  "timestamp": "2026-11-04T08:00:00.000Z",
  "data": {
    "callId": "1743321234.42",
    "outcome": "jev",
    "route": "returns",
    "action": { "type": "transfer", "destination": "ext-queues,301,1" },
    "decision": {
      "outcome": "returns",
      "confidence": 0.94,
      "probabilities": { "returns": 0.94, "order-status": 0.04 },
      "model": "jev-latest"
    },
    "offeredRoutes": ["order-status", "returns", "product", "human-agent"],
    "attempts": 1,
    "timings": { "speechMs": 1180, "decisionMs": 420, "totalMs": 1850 }
  }
}
```

注意 `data.route` 的值域：`fallbackRouteByReason` 可讓 fallback 走到 `hangup` 這類 route；若 fallback 動作執行失敗而回 dialplan，`route` 會是 `undefined`。統計端不應假設值域固定。

有 `WEBHOOK_SECRET` 時，會多一個 `X-Jev-Signature` header，內容是原始 body 的 HMAC-SHA256 hex：

```ts
import { createHmac } from "crypto";

const expected = createHmac("sha256", process.env.WEBHOOK_SECRET!)
  .update(rawBody)
  .digest("hex");

if (expected !== req.headers["x-jev-signature"]) {
  throw new Error("invalid signature");
}
```

遞送在背景執行，4 秒逾時，不會阻擋通話結束。失敗只記 warning。

## SSE

`GET /events` 會送這些事件：

| 事件 | 時機 | 主要欄位 |
|---|---|---|
| `connected` | 連線建立 | `time` |
| `call.started` | 通話進入 Stasis | `callId`, `caller`, `dialed` |
| `call.speaking` | 轉錄完成 | `callId`, `transcript` |
| `call.thinking` | 送出分類 | `callId`, `offeredRoutes`, `utterancesCount` |
| `call.routed` | 選中 route | `callId`, `route`, `destination`, `confidence`, `probabilities`, `timings` |
| `call.fallback` | 轉向 fallback | `callId`, `reason`, `route`, `destination`, `error` |
| `call.ended` | 通話結束 | `callId`, `outcome`, `route`, `fallbackReason`, `timings` |

`destination` 欄位放的是該 route 的 action 物件（例如 `{ "type": "transfer", "destination": "ext-queues,301,1" }`）。

```js
const events = new EventSource("http://localhost:3000/events");
events.addEventListener("call.routed", (e) => {
  const { callId, route, confidence } = JSON.parse(e.data);
  console.log(callId, "->", route, confidence);
});
```

## 測試

```bash
bun test
```

涵蓋 router 決策、所有 fallback 路徑、上下文最小化、動作失敗後的恢復、來電者掛斷，以及 ARI adapter 對 mock server 送出的實際請求。decision provider 另有 Jev 請求與回應契約測試。

## 授權

[MIT](LICENSE)
