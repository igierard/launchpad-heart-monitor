//TODO search up the file tree
const launchpadConfig = require('../launchpad.json');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
var ss = require('stream-stream');
const pm2 = require('pm2');
const express = require('express');
const { WebSocketServer } = require('ws');

const logger = {
  log: (...params) => {
    params = params.map(v => {
      if (typeof v === 'object') {
        return JSON.stringify(v)
      }
      return v;
    });
    console.log(`HeartMonitor: ${params.join(' ')}`)
  },
  error: (...params) => {
    params = params.map(v => {
      if (typeof v === 'object') {
        return JSON.stringify(v)
      }
      return v;
    });
    console.log(`HeartMonitor: ERROR ${params.join(' ')}`)
  }
}


const apps = launchpadConfig?.monitor?.apps || [];
const monitoredAppsList = apps.filter((app) => app?.heartMonitor);

const monitoredApps = monitoredAppsList.reduce((m, v) => {
  const name = v.pm2.name;
  m[name] = v.heartMonitor;
  const app = m[name];
  app.startupTimeoutMs = app?.startupTimeoutMs || -1;
  app.timeoutMs = app?.timeoutMs || -1;
  // TODO consider reading also from PM2
  app.restartDelayMs = app?.restartDelayMs || 0;
  // TODO exponential back off
  // app?.restartDelayStrategy = app?.restartDelayStrategy || 'constant';
  app.restartPending = -1;
  app.startMs = Date.now();
  app.lastHb = -1;
  app.started = false;
  return m;
}, {});

const app = express();

const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (socket) => {
  logger.log('websocket connection started')
  socket.on('message', function message(data, isBinary) {
    if (isBinary) {
      return;
    }
    const json = JSON.parse(data);
    if (json?.n && monitoredApps[json.n]) {
      const app = monitoredApps[json.n];
      app.lastHb = Date.now();
      if(!app.started){
        logger.log(`first connection by ${json.n}`)
      }
      app.started = true;
      // reset restart if pending
      app.restartPending = -1;
    }
  });
});
// self serve the 
app.get('/heart-monitor-client.js', (req, res) => {
  res.setHeader("content-type", "text/javascript");
  var stream = ss();
  // append reconnecting websocket lib
  stream.write(fs.createReadStream(require.resolve('reconnecting-websocket').replace('cjs', 'iife.min')));
  // append simple monitor client
  stream.write(fs.createReadStream(path.join(__dirname, 'heart-monitor-client.js')));

  if ('appId' in req.query && req.query.appId.match(/^[a-zA-Z0-9]+$/)) {
    const jsStringStream = new Readable();
    jsStringStream.push(`const HMC = new HeartMonitorClient({appId:'${req.query.appId}'})`);
    jsStringStream.push(null);
    stream.write(jsStringStream);
  }
  stream.end();
  stream.pipe(res);
})
const server = app.listen(7777);
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, socket => {
    wss.emit('connection', socket, request);
  });
});

logger.log(monitoredApps);

pm2.connect(function (err) {
  if (err) {
    console.error(err)
    process.exit(2)
  }
  logger.log('connected to PM2')
  setInterval(() => {
    const now = Date.now();
    for (let name in monitoredApps) {
      const app = monitoredApps[name];
      function restart() {
        logger.log(`restarting application "${name}"`)
        app.lastHb = -1;
        app.startMs = now;
        app.restartPending = -1;
        pm2.restart(name);
      }
      if (app.restartPending != -1) {
        if (now > app.restartPending) {
          restart();
        }
      }
      else if (app.lastHb <= -1) {
        // initial startup
        if (app.startupTimeoutMs !== -1 &&
          now - app.startMs > app.startupTimeoutMs) {
          logger.log(`application "${name}" failed to send a heartbeat within ${(app.startupTimeoutMs / 1000).toFixed(2)}sec `)
          logger.log('restarting now');
          restart();
        }
      }
      else if (now - app.lastHb > app.timeoutMs) {
        logger.log(`application "${name}" failed to send a heartbeat message for ${(app.timeoutMs / 1000).toFixed(2)}sec`)
        if (app.restartDelayMs <= 0) {
          logger.log('restarting now');
          restart();
          continue;
        }
        logger.log(`restarting in ${(app.restartDelayMs / 1000).toFixed(2)}sec`)
        app.restartPending = now + app.restartDelayMs;
      }
    }
  }, 100);
});
