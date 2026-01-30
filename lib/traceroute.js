const os = require('os');
const { spawn } = require('child_process');

/**
 * Execute a parallel traceroute using system ping.
 * @param {string} targetIP - The destination IP.
 * @returns {Promise<Array>} - List of discovered hops.
 */
async function runTraceroute(targetIP) {
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
                // Removed -4 to allow IPv6 if system prefers it
                args = ['-c', '1', '-W', '1', '-t', ttl.toString(), targetIP];
            }

            const childProc = spawn(cmd, args, spawnOpts);
            let output = '';

            childProc.stdout.on('data', (data) => { output += data.toString(); });
            // childProc.stderr.on('data', (data) => { output += data.toString(); }); 
            
            childProc.on('close', () => {
                let discoveredIp = '*';
                let reachedDest = false;
                
                const lines = output.split(/\r?\n/);
                
                for (const line of lines) {
                    // Extract any IPv4 or IPv6 address from the line
                    // Matches standard IPv4 or IPv6 (at least 2 colons for v6 to avoid matching MACs or times easily)
                    const ipMatch = line.match(/((?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
                    if (!ipMatch) continue;
                    
                    let foundIp = ipMatch[1];
                    
                    // Filter out non-IP junk that might match (like "time=..." if regex is loose, but above regex is strict enough for : and .)
                    if (foundIp.length < 2) continue; // Minimal sanity check

                    // Cleanup: Remove potential trailing colon (common in some ping outputs like "from ::1:")
                    foundIp = foundIp.replace(/:$/, '');
                    
                    // Rule 1: If we found an IP that is NOT the target, it's a Hop.
                    if (foundIp !== targetIP) {
                        discoveredIp = foundIp;
                        break;
                    }
                    
                    // Rule 2: If we found the Target IP, check for timing info (success reply)
                    if (foundIp === targetIP) {
                        const hasTime = line.match(/(?:time|ms|时间|時間|zeit)[=<]?\s*\d+/i);
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
    }

    // Sort by hop number
    hops.sort((a, b) => a.hop - b.hop);
    
    // Truncate logic: Stop after the first occurrence of the target IP
    const finalHops = [];
    for (const hop of hops) {
        finalHops.push(hop);
        if (hop.ip === targetIP) break;
    }
    
    return finalHops;
}

module.exports = { runTraceroute };
