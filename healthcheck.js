/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('node:http');

const HOST = process.env.HEALTH_HOST || '127.0.0.1';
const PORT = process.env.PORT || 3000;
const PATH = process.env.HEALTH_PATH || '/api/health';

const options = {
    host: HOST,
    port: PORT,
    path: PATH,
    timeout: 5000
};

const req = http.request(options, res => {
    if (res.statusCode === 200) process.exit(0);
    else process.exit(1);
});

req.on('error', () => process.exit(1));
req.on('timeout', () => {
    req.destroy();
    process.exit(1);
});

req.end();
