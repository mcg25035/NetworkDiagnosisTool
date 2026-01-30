const os = require('os');
const { spawn } = require('child_process');

/**
 * Execute a single ping to the target IP.
 * @param {string} ip - IP address to ping.
 * @returns {Promise<{alive: boolean, time: number|null}>}
 */
function executePing(ip) {
    return new Promise((resolve) => {
        const isWin = os.platform() === 'win32';
        const isMac = os.platform() === 'darwin';
        
        const cmd = 'ping';
        let args = [];
        
        // Force English on Linux/Mac
        const spawnOpts = {
            env: { ...process.env, LC_ALL: 'C' }
        };

        if (isWin) {
            // Windows: -n 1, -w 2000 (ms)
            args = ['-n', '1', '-w', '2000', ip];
        } else if (isMac) {
            // Mac: -c 1, -W 2000 (ms)
            args = ['-c', '1', '-W', '2000', ip];
        } else {
            // Linux: -c 1, -W 2 (sec)
            // Removed -4 to allow IPv6
            args = ['-c', '1', '-W', '2', ip];
        }

        const childProc = spawn(cmd, args, spawnOpts);
        let output = '';

        childProc.stdout.on('data', (data) => { output += data.toString(); });
        
        childProc.on('error', () => {
            resolve({ alive: false, time: null });
        });

        childProc.on('close', (code) => {
            // Check for success code first (0 usually means success, but output parsing is safer for RTT)
            
            // Parsing Logic
            // 1. Check for RTT
            // We focus on "ms" unit to avoid encoding issues with "time/時間" labels.
            // Matches: "=15ms", "<1ms", " 15ms"
            // The (\d+(?:\.\d+)?) captures the value (integer or float)
            const timeMatch = output.match(/([<>=]|\s)(\d+(?:\.\d+)?)\s*ms/i);
            
            // 2. Double check strict "Reply from <IP>" logic if needed, but RTT presence is usually enough proof of life.
            // On Windows, failed pings might show "Destination host unreachable" (no time=) or "Request timed out".
            
            if (timeMatch) {
                // If the match was "<1ms", typically it means 0ms or close to 0. 
                // But parseFloat will just take the number.
                resolve({ 
                    alive: true, 
                    time: parseFloat(timeMatch[2]) 
                });
            } else {
                resolve({ alive: false, time: null });
            }
        });
    });
}

/**
 * Ping each hop to gather MTR-like statistics using a cycle-based approach.
 * @param {Object[]} hops - The hops discovered by traceroute.
 * @param {number} cycles - Number of cycles to run.
 * @param {function} [progressCallback] - Callback for progress updates.
 * @param {number} [interval=1000] - Delay between cycles in ms.
 * @returns {Promise<Object[]>} - Final MTR statistics.
 */
async function runMtrCycles(hops, cycles, progressCallback, interval = 1000) {
    // 1. Initialize Stats for all hops
    const hopStats = hops.map(hop => ({
        ...hop,
        sent: 0,
        received: 0,
        rtts: [],
        best: Infinity,
        worst: 0,
        sum: 0,
        avg: 0,
        loss: 0,
        stdev: 0,
        isDead: !hop.ip || hop.ip === '*'
    }));

    const calculateStDev = (rtts, avg) => {
        if (rtts.length < 2) return 0;
        const squareDiffs = rtts.map(rtt => Math.pow(rtt - avg, 2));
        const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / rtts.length;
        return Math.sqrt(avgSquareDiff);
    };

    // 2. Run Cycles
    for (let cycle = 1; cycle <= cycles; cycle++) {
        const promises = hopStats.map(async (stat) => {
            if (stat.isDead) {
                stat.sent++;
                stat.loss = 100;
                return;
            }

            try {
                stat.sent++;
                
                // Use custom executePing instead of node-ping
                const res = await executePing(stat.ip);

                if (res.alive) {
                    stat.received++;
                    const time = res.time;
                    
                    if (time !== null && !isNaN(time)) {
                        stat.rtts.push(time);
                        stat.sum += time;
                        if (time < stat.best) stat.best = time;
                        if (time > stat.worst) stat.worst = time;
                    }
                } 
            } catch (err) {
                // Packet lost
            }

            // Recalculate Derived Stats
            if (stat.received > 0) {
                stat.avg = stat.sum / stat.received;
                stat.stdev = calculateStDev(stat.rtts, stat.avg);
                stat.loss = ((stat.sent - stat.received) / stat.sent) * 100;
            } else {
                stat.loss = 100;
            }
        });

        // Wait for this cycle's pings to finish
        await Promise.all(promises);

        // Report Progress
        if (progressCallback) {
            const currentSnapshot = hopStats.map(stat => ({
                hop: stat.hop,
                ip: stat.ip,
                loss: parseFloat(stat.loss.toFixed(1)),
                avg: parseFloat(stat.avg.toFixed(1)),
                best: stat.best === Infinity ? 0 : parseFloat(stat.best.toFixed(1)),
                worst: parseFloat(stat.worst.toFixed(1)),
                stdev: parseFloat(stat.stdev.toFixed(1)),
                sent: stat.sent
            }));

            progressCallback({
                type: 'cycle_update',
                cycle: cycle,
                totalCycles: cycles,
                hops: currentSnapshot
            });
        }

        // Delay between cycles (Simulate MTR interval)
        if (cycle < cycles) {
            await new Promise(r => setTimeout(r, interval));
        }
    }

    // 3. Final Format
    return hopStats.map(stat => ({
        host: stat.host || stat.ip,
        ip: stat.ip,
        loss: parseFloat(stat.loss.toFixed(1)),
        avg: parseFloat(stat.avg.toFixed(1)),
        best: stat.best === Infinity ? 0 : parseFloat(stat.best.toFixed(1)),
        worst: parseFloat(stat.worst.toFixed(1)),
        stdev: parseFloat(stat.stdev.toFixed(1))
    }));
}

module.exports = { runMtrCycles };
