const os = require('os');
const dns = require('dns');
const https = require('https');
const { exec } = require('child_process');

/**
 * Get local network interface information.
 * @returns {Object}
 */
function getLocalNetworkInfo() {
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
 * @returns {Promise<Object>}
 */
async function getPublicIps() {
    const fetchIp = (url, family = 0) => {
        return new Promise((resolve, reject) => {
            const options = { timeout: 3000 };
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
    } catch (e) { /* Ignore */ }

    try {
        results.ipv6 = await fetchIp('https://api64.ipify.org', 6);
    } catch (e) { /* Ignore */ }

    return results;
}

/**
 * Resolve a domain name to IP addresses using system lookup (respects OS IPv4/v6 preference).
 * @param {string} domain 
 * @returns {Promise<string[]>}
 */
function resolveDNS(domain) {
    return new Promise((resolve, reject) => {
        // Use dns.lookup to respect system configuration (hosts file, nsswitch, IPv6 preference)
        dns.lookup(domain, { all: true }, (err, addresses) => {
            if (err) return reject(err);
            // addresses is an array of { address, family } objects
            resolve(addresses.map(a => a.address));
        });
    });
}

/**
 * Check if necessary system dependencies are installed.
 * @returns {Promise<{available: boolean, details: Object}>}
 */
async function checkDependencies() {
    const platform = os.platform();
    
    const checkCommand = (cmd) => new Promise(resolve => {
        exec(cmd, (err) => resolve(!err));
    });

    const results = {
        platform,
        ping: await checkCommand(platform === 'win32' ? 'where ping' : 'which ping'),
        traceroute: false,
        tracepath: false
    };

    if (platform === 'win32') {
        results.traceroute = await checkCommand('where tracert');
    } else {
        results.traceroute = await checkCommand('which traceroute');
        results.tracepath = await checkCommand('which tracepath');
    }

    const hasTraceTool = results.traceroute || results.tracepath;
    const available = results.ping && hasTraceTool;

    return { available, details: results };
}

module.exports = {
    getLocalNetworkInfo,
    getPublicIps,
    resolveDNS,
    checkDependencies
};
