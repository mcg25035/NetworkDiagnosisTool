const os = require('os');
const dns = require('dns');
// Try to require 'mtr', if it fails handle gracefully? The user environment seems to have it now.
let Mtr;
try {
    Mtr = require('mtr').Mtr;
} catch (e) {
    console.error("Failed to load 'mtr' package. Please ensure it is installed.");
    process.exit(1);
}

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
                // mtr package takes an IP string.
                // We prefer IPv4 for stability usually, or just the first one.
                targetIP = addresses[0]; 
                
                cb({ step: 'dns_lookup', domain, status: 'resolved', data: addresses });
            } catch (err) {
                targetResult.dns.error = err.message;
                cb({ step: 'dns_lookup', domain, status: 'failed', error: err.message });
            }

            // 2b. MTR
            // We can only run MTR if we have an IP (since the mtr package requires it).
            if (targetIP) {
                try {
                    cb({ step: 'mtr_test', domain, ip: targetIP, status: 'running' });
                    const hops = await this._runMtr(targetIP);
                    targetResult.mtr.executed = true;
                    targetResult.mtr.hops = hops;
                    cb({ step: 'mtr_test', domain, status: 'completed', data: hops });
                } catch (err) {
                    targetResult.mtr.error = err.message;
                    cb({ step: 'mtr_test', domain, status: 'failed', error: err.message });
                }
            } else {
                targetResult.mtr.error = "Skipped due to DNS failure";
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

        // Try to get IPv4 (Force IPv4)
        try {
            results.ipv4 = await fetchIp('https://api.ipify.org', 4);
        } catch (e) {
            // Fallback or ignore
        }

        // Try to get IPv6 (Force IPv6)
        try {
            // api64.ipify.org supports both, so we must force family: 6
            results.ipv6 = await fetchIp('https://api64.ipify.org', 6);
        } catch (e) {
            // If forced v6 fails, it means no v6 connectivity to the internet
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

    /**
     * Run MTR (My TraceRoute) to a specific IP.
     * @param {string} ip - The IP address to trace.
     * @returns {Promise<MtrHop[]>}
     * @private
     */
    _runMtr(ip) {
        return new Promise((resolve, reject) => {
            // Options: reportCycles matches our 'duration' roughly.
            const mtr = new Mtr(ip, { reportCycles: this.mtrDuration });
            const hops = [];

            // The 'mtr' package wrapper we are using emits 'hop' events 
            // AFTER the process exits and it parses the output.
            mtr.on('hop', (hop) => {
                hops.push(hop);
            });

            mtr.on('end', () => {
                resolve(hops);
            });

            mtr.on('error', (err) => {
                reject(err);
            });

            try {
                mtr.traceroute();
            } catch (err) {
                reject(err);
            }
        });
    }
}

module.exports = NetworkDiagnosisTool;
