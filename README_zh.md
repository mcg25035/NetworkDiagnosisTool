#  Network Diagnosis Tool

一個用於診斷網路連線品質的 Node.js 套件。支援取得本機網路資訊、DNS 解析以及 MTR (My Traceroute) 測試。

[GitHub](https://github.com/mcg25035/NetworkDiagnosisTool)

## 功能特點

1.  **本機資訊收集**：自動取得本機 IPv4、IPv6 以及系統使用的 DNS 伺服器地址。
2.  **DNS 解析**：針對目標網域進行解析，取得目標 IP。
3.  **MTR 測試**：使用系統 `ping` 模擬 MTR 檢測，分析每一跳 (Hop) 的連線狀況。
4.  **雙模式支援**：提供 Promise Chain (Async/Await) 與 Stepwise Callback 兩種調用方式。
5.  **報表生成**：最終輸出完整的 JSON 診斷報告。

## 安裝需求

此套件依賴系統中的 `ping` 指令，這在大多數作業系統中已預先安裝。

- **Windows**: 內建 `ping`。
- **Linux**: `iputils-ping` 或類似工具 (通常已安裝)。
- **macOS**: 內建 `ping`。

安裝套件依賴：

```bash
npm install
```

## 使用範例

### 1. Promise (Async/Await) 版本

適合用於簡單的腳本或只需要最終報表的場景。

```javascript
const Diagnosis = require('./index');

const domains = ['google.com', 'github.com'];
const duration = 5; // MTR 測試週期 (次數)

const tool = new Diagnosis(domains, duration);

async function main() {
    try {
        console.log('正在開始診斷...');
        const report = await tool.run();
        console.log('診斷完成！');
        console.log(JSON.stringify(report, null, 2));
    } catch (err) {
        console.error('診斷過程中發生錯誤:', err);
    }
}

main();
```

### 2. Callback 版本 (階段式回傳)

適合用於前端 UI 需要即時顯示當前進度（如：正在解析 DNS、正在跑 MTR）的場景。

```javascript
const Diagnosis = require('./index');

const domains = ['google.com'];
const duration = 3;

const tool = new Diagnosis(domains, duration);

tool.run((progress) => {
    const { step, status, domain, data, error } = progress;
    
    switch (status) {
        case 'starting':
            console.log(`[開始] 執行步驟: ${step} ${domain ? `對於 ${domain}` : ''}`);
            break;
        case 'completed':
            console.log(`[完成] 步驟: ${step} 成功。`);
            if (step === 'finished') {
                console.log('最終報表已產生。');
            }
            break;
        case 'failed':
            console.error(`[錯誤] 步驟: ${step} 失敗: ${error}`);
            break;
        default:
            // 處理其他狀態如 'resolving', 'running' 等
            break;
    }
}).then((finalReport) => {
    // 即使使用了 Callback，run() 依然會回傳一個最終 report 的 Promise
    console.log('所有任務執行完畢。');
});
```

## 報表格式 (JSON Report Structure)

```json
{
  "timestamp": "ISO-8601 時間戳記",
  "localNetwork": {
    "ipv4": ["192.168.1.100"],
    "ipv6": ["fe80::..."],
    "dnsServers": ["1.1.1.1"]
  },
  "diagnosis": [
    {
      "domain": "google.com",
      "dns": {
        "resolved": true,
        "addresses": ["142.250.204.46"],
        "error": null
      },
      "mtr": {
        "executed": true,
        "hops": [
          { 
            "host": "192.168.1.1", 
            "ip": "192.168.1.1", 
            "loss": 0, 
            "avg": 1.5, 
            "best": 1.2, 
            "worst": 2.1, 
            "stdev": 0.3 
          }
        ],
        "error": null
      }
    }
  ]
}
```

