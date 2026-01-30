#  Network Diagnosis Tool

[中文說明 (Traditional Chinese)](README_zh.md)

A Node.js package for diagnosing network connection quality. It supports retrieving local network information, DNS resolution, and performing MTR (My Traceroute) tests.

[GitHub](https://github.com/mcg25035/NetworkDiagnosisTool)

## Features

1.  **Local Network Info**: Automatically retrieves local IPv4, IPv6 addresses, and system DNS servers.
2.  **DNS Resolution**: Resolves target domains to obtain target IP addresses.
3.  **MTR Testing**: Performs MTR-like analysis using system `ping` to analyze connection status for each hop.
4.  **Dual Mode Support**: Supports both Promise Chain (Async/Await) and Stepwise Callback execution patterns.
5.  **Report Generation**: Generates a complete JSON diagnosis report.

## Requirements

This package relies on the system's `ping` command, which is typically pre-installed on most operating systems.

- **Windows**: `ping` is built-in.
- **Linux**: `iputils-ping` or similar (usually pre-installed).
- **macOS**: `ping` is built-in.

Install package dependencies:

```bash
npm install
```

## Usage Examples

### 1. Promise (Async/Await) Version

Suitable for simple scripts or scenarios where only the final report is needed.

```javascript
const Diagnosis = require('./index');

const domains = ['google.com', 'github.com'];
const duration = 5; // MTR test duration (cycles)

const tool = new Diagnosis(domains, duration);

async function main() {
    try {
        console.log('Diagnosis starting...');
        const report = await tool.run();
        console.log('Diagnosis completed!');
        console.log(JSON.stringify(report, null, 2));
    } catch (err) {
        console.error('Error during diagnosis:', err);
    }
}

main();
```

### 2. Callback Version (Stepwise Progress)

Suitable for scenarios like frontend UIs where real-time progress updates (e.g., "Resolving DNS", "Running MTR") are needed.

```javascript
const Diagnosis = require('./index');

const domains = ['google.com'];
const duration = 3;

const tool = new Diagnosis(domains, duration);

tool.run((progress) => {
    const { step, status, domain, data, error } = progress;
    
    switch (status) {
        case 'starting':
            console.log(`[Start] Step: ${step} ${domain ? `for ${domain}` : ''}`);
            break;
        case 'completed':
            console.log(`[Done] Step: ${step} successful.`);
            if (step === 'finished') {
                console.log('Final report generated.');
            }
            break;
        case 'failed':
            console.error(`[Error] Step: ${step} failed: ${error}`);
            break;
        default:
            // Handle other statuses like 'resolving', 'running', etc.
            break;
    }
}).then((finalReport) => {
    // Even with Callback, run() still returns a Promise resolving to the final report
    console.log('All tasks finished.');
});
```

## Report Structure (JSON)

```json
{
  "timestamp": "ISO-8601 Timestamp",
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

