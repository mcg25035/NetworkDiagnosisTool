const network = require('./lib/network');
const traceroute = require('./lib/traceroute');
const mtr = require('./lib/mtr');

/**
 * Main Network Diagnosis Tool Class.
 * Orchestrates DNS, Traceroute, and MTR logic.
 */
class NetworkDiagnosisTool {
    /**
     * @param {string[]} targetDomains - List of domains to diagnose.
     * @param {number} mtrDuration - Number of MTR cycles (approx seconds).
     */
    constructor(targetDomains, mtrDuration) {
        this.targetDomains = targetDomains;
        this.mtrDuration = mtrDuration || 10;
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
     * @returns {Promise<Object>} - The full JSON report.
     */
    async run(callback) {
        const cb = callback || (() => {});
        
        // 1. Get Local Info
        cb({ step: 'local_info', status: 'starting' });
        this.results.localNetwork = network.getLocalNetworkInfo();
        
        // 1b. Get Public IP
        try {
            cb({ step: 'public_ip', status: 'fetching' });
            const publicIps = await network.getPublicIps();
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
                dns: { resolved: false, addresses: [], error: null },
                mtr: { executed: false, hops: [], error: null }
            };

            // 2a. DNS Resolution
            let targetIP = null;
            try {
                cb({ step: 'dns_lookup', domain, status: 'resolving' });
                const addresses = await network.resolveDNS(domain);
                targetResult.dns.resolved = true;
                targetResult.dns.addresses = addresses;
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
                    
                    // Phase 1: Traceroute Discovery
                    const hops = await traceroute.runTraceroute(targetIP);
                    
                    // Force Target Append Logic
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

                    // Phase 2: MTR Cycles Analysis
                    // Passing 1000ms as interval to avoid duplicate sampling
                    const detailedHops = await mtr.runMtrCycles(hops, this.mtrDuration, (progress) => {
                         cb({ 
                             step: 'mtr_ping_progress', 
                             domain, 
                             ...progress 
                         });
                    }, 1000);
                    
                    targetResult.mtr.executed = true;
                    targetResult.mtr.hops = detailedHops;
                    cb({ step: 'mtr_ping', domain, status: 'completed', data: detailedHops });
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
     * Static helper to check system requirements
     */
    static async checkDependencies() {
        return network.checkDependencies();
    }
}

module.exports = NetworkDiagnosisTool;