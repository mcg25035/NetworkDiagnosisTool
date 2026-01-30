const Diagnosis = require('./index');

const domains = ['google.com'];
const duration = 3; // 3 cycles ~ 3 seconds

console.log('Initializing Diagnosis...');
const tool = new Diagnosis(domains, duration);

console.log('Running with Promise chain...');
tool.run((step) => {
    // Stepwise callback
    if (step.status === 'starting' || step.status === 'resolving' || step.status === 'running') {
        console.log(`[Callback] ${step.step} - ${step.domain || ''}: ${step.status}`);
    } else if (step.status === 'completed' || step.status === 'resolved') {
        console.log(`[Callback] ${step.step} - ${step.domain || ''}: ${step.status}`);
    } else if (step.status === 'failed') {
        console.error(`[Callback] ${step.step} - ${step.domain || ''}: ${step.status} - ${step.error}`);
    }
}).then((report) => {
    console.log('\n--- Final Report ---');
    console.log(JSON.stringify(report, null, 2));
}).catch((err) => {
    console.error('Fatal Error:', err);
});

