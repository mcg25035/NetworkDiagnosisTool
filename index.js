const os = require('os');
const dns = require('dns');
const { spawn } = require('child_process');
const ping = require('ping');

/**
 * @typedef {Object} PublicIps
 * @property {string|null} ipv4 - The public IPv4 address.
 * @property {string|null} ipv6 - The public IPv6 address.
 * @property {string} [error] - Error message if fetching public IPs failed.
 */

/**
 * @typedef {Object} LocalNetworkInfo
 * @property {string[]} ipv4 - List of local IPv4 addresses.
 * @property {string[]} ipv6 - List of local IPv6 addresses.
 * @property {string[]} dnsServers - List of configured DNS servers.
 * @property {PublicIps} [publicIps] - Public IP information.
 */

/**
 * @typedef {Object} MtrHop
 * @property {string} host - Hostname or IP of the hop.
 * @property {string} [ip] - IP address of the hop.
 * @property {number} [loss] - Packet loss percentage.
 * @property {number} [avg] - Average round-trip time.
 * @property {number} [best] - Best round-trip time.
 * @property {number} [worst] - Worst round-trip time.
 * @property {number} [stdev] - Standard deviation of round-trip times.
 */

/**
 * @typedef {Object} TargetDiagnosis
 * @property {string} domain - The target domain.
 * @property {Object} dns - DNS resolution results.
 * @property {boolean} dns.resolved - Whether DNS resolution was successful.
 * @property {string[]} dns.addresses - Resolved IP addresses.
 * @property {string|null} dns.error - Error message if DNS resolution failed.
 * @property {Object} mtr - MTR test results.
 * @property {boolean} mtr.executed - Whether MTR was executed.
 * @property {MtrHop[]} mtr.hops - List of MTR hops.
 * @property {string|null} mtr.error - Error message if MTR failed.
 */

/**
 * @typedef {Object} DiagnosisReport
 * @property {string} timestamp - ISO timestamp of the diagnosis.
 * @property {LocalNetworkInfo} localNetwork - Local network configuration and status.
 * @property {TargetDiagnosis[]} diagnosis - Results for each target domain.
 */

class NetworkDiagnosisTool {
    /**
     * @param {string[]} targetDomains - List of domains to diagnose.
     * @param {number} mtrDuration - MTR test duration (used as cycles/count).
     */
    constructor(targetDomains, mtrDuration) {
        this.targetDomains = targetDomains;
        this.mtrDuration = mtrDuration;
        /** @type {DiagnosisReport} */
        this.results = {
            timestamp: new Date().toISOString(),
            localNetwork: {
                ipv4: [],
                ipv6: [],
                dnsServers: []
            },
            diagnosis: []
        };
    }

    /**
     * Run the diagnosis.
     * @param {function} [callback] - Stepwise callback (optional).
     * @returns {Promise<DiagnosisReport>} - The full JSON report.
     */
    async run(callback) {
        const cb = callback || (() => {});
        
        // 1. Get Local Info
        cb({ step: 'local_info', status: 'starting' });
        this.results.localNetwork = this._getLocalNetworkInfo();
        
        // 1b. Get Public IP (Optional but highly recommended based on user focus)
        try {
            cb({ step: 'public_ip', status: 'fetching' });
            const publicIps = await this._getPublicIps();
            this.results.localNetwork.publicIps = publicIps;
            cb({ step: 'public_ip', status: 'completed', data: publicIps });
        } catch (err) {
            this.results.localNetwork.publicIps = { error: err.message };
            cb({ step: 'public_ip', status: 'failed', error: err.message });
        }
        
        cb({ step: 'local_info', status: 'completed', data: this.results.localNetwork });

        // 2. Process Targets
        for (const domain of this.targetDomains) {
            cb({ step: 'target_diagnosis', domain, status: 'starting' });
            
            const targetResult = {
                domain,
                dns: {
                    resolved: false,
                    addresses: [],
                    error: null
                },
                mtr: {
                    executed: false,
                    hops: [],
                    error: null
                }
            };

            // 2a. DNS Resolution
            let targetIP = null;
            try {
                cb({ step: 'dns_lookup', domain, status: 'resolving' });
                const addresses = await this._resolveDNS(domain);
                targetResult.dns.resolved = true;
                targetResult.dns.addresses = addresses;
                
                // Pick the first IPv4 or IPv6 to trace
                targetIP = addresses[0]; 
                
                cb({ step: 'dns_lookup', domain, status: 'resolved', data: addresses });
            } catch (err) {
                targetResult.dns.error = err.message;
                cb({ step: 'dns_lookup', domain, status: 'failed', error: err.message });
            }

                        // 2b. Simulated MTR (Traceroute + Ping)
                        if (targetIP) {
                            try {
                                cb({ step: 'mtr_trace', domain, ip: targetIP, status: 'running' });
                                // First, run traceroute to discover hops
                                const hops = await this._runTraceroute(targetIP);
                                
                                // FORCE TARGET: Ensure the destination IP is always in the list, 
                                // even if tracepath timed out or hit a firewall before reaching it.
                                const lastHop = hops[hops.length - 1];
                                if (!lastHop || lastHop.ip !== targetIP) {
                                    hops.push({
                                        hop: (lastHop ? lastHop.hop : 0) + 1,
                                        ip: targetIP,
                                        rtt1: '0 ms'
                                    });
                                }
            
                                cb({ step: 'mtr_trace', domain, status: 'completed', count: hops.length });
                                
                                cb({ step: 'mtr_ping', domain, status: 'running', total: hops.length });
            
                                // Then, ping each hop to gather statistics in parallel
                                const detailedHops = await this._analyzeHops(hops, (progress) => {
                                     cb({ 
                                         step: 'mtr_ping_progress', 
                                         domain, 
                                         ...progress 
                                     });
                                });
                                
                                targetResult.mtr.executed = true;
                                targetResult.mtr.hops = detailedHops;
                                cb({ step: 'mtr_ping', domain, status: 'completed', data: detailedHops });
                            } catch (err) {
                                targetResult.mtr.error = err.message;
                                cb({ step: 'mtr_test', domain, status: 'failed', error: err.message });
                            }
                        } else {                targetResult.mtr.error = "Skipped due to DNS failure";
                cb({ step: 'mtr_test', domain, status: 'skipped' });
            }

            this.results.diagnosis.push(targetResult);
            cb({ step: 'target_diagnosis', domain, status: 'completed' });
        }

        cb({ step: 'finished', data: this.results });
        return this.results;
    }

    /**
     * Get local network interface information.
     * @returns {LocalNetworkInfo}
     * @private
     */
    _getLocalNetworkInfo() {
        const interfaces = os.networkInterfaces();
        const ipv4 = [];
        const ipv6 = [];
        
        for (const name in interfaces) {
            for (const iface of interfaces[name]) {
                if (!iface.internal) {
                    if (iface.family === 'IPv4') ipv4.push(iface.address);
                    if (iface.family === 'IPv6') ipv6.push(iface.address);
                }
            }
        }

        const dnsServers = dns.getServers();

        return { ipv4, ipv6, dnsServers };
    }

    /**
     * Get public IPv4 and IPv6 addresses.
     * @returns {Promise<PublicIps>}
     * @private
     */
    async _getPublicIps() {
        const https = require('https');
        
        const fetchIp = (url, family = 0) => {
            return new Promise((resolve, reject) => {
                const options = { timeout: 3000 };
                // explicitly set family if provided
                if (family === 4) options.family = 4;
                if (family === 6) options.family = 6;

                const req = https.get(url, options, (res) => {
                    if (res.statusCode !== 200) {
                        res.resume();
                        return reject(new Error(`Status Code: ${res.statusCode}`));
                    }
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => resolve(data.trim()));
                });
                req.on('error', (err) => reject(err));
                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('Timeout'));
                });
            });
        };

        const results = { ipv4: null, ipv6: null };

        try {
            results.ipv4 = await fetchIp('https://api.ipify.org', 4);
        } catch (e) {
            // Fallback or ignore
        }

        try {
            results.ipv6 = await fetchIp('https://api64.ipify.org', 6);
        } catch (e) {
            // Ignore if v6 not available
        }

        return results;
    }

    /**
     * Resolve a domain name to IP addresses.
     * @param {string} domain - The domain to resolve.
     * @returns {Promise<string[]>}
     * @private
     */
    _resolveDNS(domain) {
        return new Promise((resolve, reject) => {
            dns.resolve(domain, (err, addresses) => {
                if (err) return reject(err);
                resolve(addresses);
            });
        });
    }

    async _runTraceroute(targetIP) {
        const MAX_HOPS = 30;
        const BATCH_SIZE = 10; // Run 10 probes in parallel
        const hops = [];
        let targetReached = false;

        // Helper to run a single TTL probe
        const probeHop = async (ttl) => {
            return new Promise((resolve) => {
                const isWin = os.platform() === 'win32';
                const isMac = os.platform() === 'darwin';
                
                // Construct command based on OS
                let args = [];
                const cmd = 'ping';
                
                // Force English output on Linux/Mac to simplify parsing
                // Windows doesn't support LC_ALL, so we need robust parsing there
                const spawnOpts = {
                    env: { ...process.env, LC_ALL: 'C' }
                };
                
                if (isWin) {
                    // Windows: -n 1 (count), -w 1000 (ms), -i TTL
                    args = ['-n', '1', '-w', '1000', '-i', ttl.toString(), targetIP];
                } else if (isMac) {
                    // Mac: -c 1 (count), -W 1000 (ms), -m TTL
                    args = ['-c', '1', '-W', '1000', '-m', ttl.toString(), targetIP];
                } else {
                    // Linux: -c 1 (count), -W 1 (sec), -t TTL
                    args = ['-4', '-c', '1', '-W', '1', '-t', ttl.toString(), targetIP];
                }

                const childProc = spawn(cmd, args, spawnOpts);
                let output = '';

                childProc.stdout.on('data', (data) => { output += data.toString(); });
                // Windows ping might verify errors on stderr or just stdout. 
                
                childProc.on('close', () => {
                    let discoveredIp = '*';
                    let reachedDest = false;
                    
                    const lines = output.split(/\r?\n/);
                    
                    for (const line of lines) {
                        // Extract any IPv4 address from the line
                        const ipMatch = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
                        if (!ipMatch) continue;
                        
                        const foundIp = ipMatch[1];
                        
                        // Rule 1: If we found an IP that is NOT the target, it's a Hop (TTL Exceeded response).
                        // (e.g., "Reply from 192.168.1.1: TTL expired...")
                        if (foundIp !== targetIP) {
                            discoveredIp = foundIp;
                            break; // We found our hop, stop parsing
                        }
                        
                        // Rule 2: If we found the Target IP, we need to be careful.
                        // It could be the header: "Pinging 8.8.8.8 with 32 bytes of data:"
                        // Or the success reply: "Reply from 8.8.8.8: bytes=32 time=10ms..."
                        if (foundIp === targetIP) {
                            // Look for timing information to confirm it's a reply
                            // Supports: time=, time<, time, ms, 时间= (CN), 時間= (TW), Zeit= (DE)
                            const hasTime = line.match(/(?:time|ms|时间|時間|zeit)[=<]?\s*\d+/i);
                            
                            // Also check for "bytes=" or "seq=" as secondary confirmation
                            const hasBytes = line.match(/(?:bytes|seq|icmp_seq)[=<]\d+/i);

                            if (hasTime || hasBytes) {
                                discoveredIp = targetIP;
                                reachedDest = true;
                                break;
                            }
                        }
                    }

                    resolve({
                        hop: ttl,
                        ip: discoveredIp,
                        reached: reachedDest
                    });
                });

                childProc.on('error', () => resolve({ hop: ttl, ip: '*', reached: false }));
            });
        };

        // Execution Loop (Batched)
        for (let i = 1; i <= MAX_HOPS; i += BATCH_SIZE) {
            if (targetReached) break;

            const promises = [];
            const endTtl = Math.min(i + BATCH_SIZE - 1, MAX_HOPS);

            for (let ttl = i; ttl <= endTtl; ttl++) {
                promises.push(probeHop(ttl));
            }

            const results = await Promise.all(promises);

            for (const res of results) {
                if (res.ip !== '*') {
                    hops.push(res);
                }
                if (res.reached || res.ip === targetIP) {
                    targetReached = true;
                }
            }
            
            // If target found in this batch, we stop future batches.
            // But we still keep the results from this batch (even if some are unordered, we sort later).
        }

        // Sort by hop number
        hops.sort((a, b) => a.hop - b.hop);

        // Fill in gaps with "*" if necessary? 
        // Logic: The previous code expected a list of objects.
        // We return the raw list. If a hop is completely missing (timeout), it won't be in the array if we filtered '*'.
        // Let's keep the filter `res.ip !== '*'` above to avoid cluttering the list with timeouts, 
        // matching typical MTR behavior which just shows known hops.
        
        return hops;
    }

    // _runTracepathFallback is no longer needed.
    // _analyzeHops remains the same.

    /**
     * Ping each hop to gather MTR-like statistics in parallel.
     * @param {Object[]} hops - The hops discovered by traceroute.
     * @param {function} [progressCallback] - Callback for progress updates.
     * @returns {Promise<MtrHop[]>}
     * @private
     */
    async _analyzeHops(hops, progressCallback) {
        let completedCount = 0;
        const totalHops = hops.length;
        const reportProgress = (hopIp, status) => {
            if (progressCallback) {
                progressCallback({
                    ip: hopIp,
                    current: completedCount,
                    total: totalHops,
                    status
                });
            }
        };

        const pingPromises = hops.map(async (hop) => {
            const hopIp = hop.ip || hop.address;
            
            // Invalid IP handling
            if (!hopIp || hopIp === '*') {
                completedCount++;
                reportProgress(hopIp || '???', 'skipped');
                return {
                    host: '???',
                    ip: null,
                    loss: 100,
                    avg: 0,
                    best: 0,
                    worst: 0,
                    stdev: 0
                };
            }

            try {
                // Execute Ping
                const res = await ping.promise.probe(hopIp, {
                    timeout: 2, 
                    min_reply: this.mtrDuration 
                });

                completedCount++;
                reportProgress(hopIp, 'completed');

                return {
                    host: res.host,
                    ip: res.numeric_host || hopIp,
                    loss: parseFloat(res.packetLoss),
                    avg: parseFloat(res.avg),
                    best: parseFloat(res.min),
                    worst: parseFloat(res.max),
                    stdev: parseFloat(res.stddev)
                };
            } catch (err) {
                completedCount++;
                reportProgress(hopIp, 'failed');
                return {
                    host: hopIp,
                    ip: hopIp,
                    loss: 100,
                    avg: 0,
                    best: 0,
                    worst: 0,
                    stdev: 0
                };
            }
        });

        return Promise.all(pingPromises);
    }
    
    /**
     * Check if necessary system dependencies are installed.
     * @returns {Promise<{available: boolean, details: Object}>}
     */
    static async checkDependencies() {
        const { exec } = require('child_process');
        const platform = os.platform();
        
        const checkCommand = (cmd) => new Promise(resolve => {
            exec(cmd, (err) => resolve(!err));
        });

        const results = {
            platform,
            ping: await checkCommand(platform === 'win32' ? 'where ping' : 'which ping'),
            traceroute: false, // Will be checked below
            tracepath: false   // Will be checked below
        };

        if (platform === 'win32') {
            results.traceroute = await checkCommand('where tracert');
            // tracepath is not on windows usually
        } else {
            results.traceroute = await checkCommand('which traceroute');
            results.tracepath = await checkCommand('which tracepath');
        }

        // We need at least ping AND (traceroute OR tracepath OR tracert)
        const hasTraceTool = results.traceroute || results.tracepath;
        const available = results.ping && hasTraceTool;

        return { available, details: results };
    }
}

module.exports = NetworkDiagnosisTool;
