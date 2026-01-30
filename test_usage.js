const Diagnosis = require('./index');

(async () => {
    console.log('Checking dependencies...');
    const depStatus = await Diagnosis.checkDependencies();
    console.log('Dependency Check:', depStatus);

    if (!depStatus.available) {
        console.error('Missing required system dependencies (ping or traceroute/tracepath). Aborting.');
        return;
    }

    const domains = ['google.com'];
    const duration = 3; // 3 cycles ~ 3 seconds

    console.log('\nInitializing Diagnosis...');
    const tool = new Diagnosis(domains, duration);

    console.log('Running with Promise chain...');
    tool.run((step) => {
        // Stepwise callback
        if (step.step === 'mtr_ping_progress') {
            const pct = Math.round((step.current / step.total) * 100);
            process.stdout.write(`\r[MTR Ping] Progress: ${step.current}/${step.total} (${pct}%) - Last: ${step.ip} (${step.status})   `);
            if (step.current === step.total) console.log(); // Newline on finish
        } 
        else if (step.status === 'starting' || step.status === 'resolving' || step.status === 'running') {
            console.log(`[Callback] ${step.step} - ${step.domain || ''}: ${step.status} ${step.total ? `(Total Hops: ${step.total})` : ''}`);
        } 
        else if (step.status === 'completed' || step.status === 'resolved') {
            console.log(`[Callback] ${step.step} - ${step.domain || ''}: ${step.status} ${step.count ? `(Count: ${step.count})` : ''}`);
        } 
        else if (step.status === 'failed') {
            console.error(`[Callback] ${step.step} - ${step.domain || ''}: ${step.status} - ${step.error}`);
        }
        else if (step.status === 'skipped') {
            console.log(`[Callback] ${step.step} - ${step.domain || ''}: ${step.status}`);
        }
    }).then((report) => {
        console.log('\n\n--- Final Report ---');
        console.log(JSON.stringify(report, null, 2));
    }).catch((err) => {
        console.error('Fatal Error:', err);
    });
})();

