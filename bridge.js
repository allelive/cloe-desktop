#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const HTTP_PORT = 19851;
const CLOE_GIFS = '/home/allelive/cloe-desktop/public/gifs';

const ACTIONS = {
    smile: 'smile.gif', kiss: 'kiss.gif', tease: 'tease.gif',
    nod: 'nod.gif', wave: 'wave.gif', think: 'think.gif',
    shake_head: 'shake_head.gif', shy: 'shy.gif', laugh: 'laugh.gif',
    clap: 'clap.gif', yawn: 'yawn.gif', working: 'working.gif',
    speak: 'speak.gif', blink: 'blink.gif', idle: 'blink.gif',
};

let currentAction = 'blink';

const server = http.createServer((req, res) => {
    const url = require('url').parse(req.url, true);
    const pathname = url.pathname;

    if (pathname === '/status') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ws_port: 19850, http_port: 19851, clients: 0, current_action: currentAction}));
        return;
    }

    if (pathname === '/action' && req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const action = data.action || 'blink';
                if (ACTIONS[action]) {
                    currentAction = action;
                    console.log(`[Cloe] Action: ${action}`);
                }
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({success: true, action}));
            } catch (e) {
                res.writeHead(400, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({success: false}));
            }
        });
        return;
    }

    if (pathname.startsWith('/gif/')) {
        const action = pathname.slice(5);
        const file = ACTIONS[action] || 'blink.gif';
        const filePath = path.join(CLOE_GIFS, file);
        if (fs.existsSync(filePath)) {
            res.writeHead(200, {'Content-Type': 'image/gif'});
            res.end(fs.readFileSync(filePath));
        } else {
            res.writeHead(404);
            res.end('Not found');
        }
        return;
    }

    if (pathname === '/actions') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({actions: Object.keys(ACTIONS)}));
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`[Cloe Bridge] HTTP su http://0.0.0.0:${HTTP_PORT}`);
});

// Non chiudere automaticamente
process.on('SIGTERM', () => process.exit(0));

console.log('[Cloe Bridge] Avviato e in esecuzione...');