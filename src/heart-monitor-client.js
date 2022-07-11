class HeartMonitorClient {
  constructor({ appId, autoStart = true, port = 7777, url = 'localhost', interval = 1000 }) {
    this.appId = appId;
    this.autoStart = autoStart;
    this.port = port;
    this.url = url;
    this.fullUrl = `ws://${url}:${port}/`;
    this.interval = interval;
    // TODO setup reconnecting websocket
    this.ws = new ReconnectingWebSocket(this.fullUrl);
    this.ws.addEventListener('open', this.handelOpen.bind(this));
  }
  handelOpen() {
    if (this.autoStart) {
      this.start();
    }
  }
  start() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.timeoutId = setTimeout(this.autoUpdate.bind(this), this.interval)
  }
  stop() {
    clearTimeout(this.timeoutId);
  }
  autoUpdate() {
    this.update()
    this.timeoutId = setTimeout(this.autoUpdate.bind(this), this.interval)
  }
  update() {
    this.ws.send(JSON.stringify({ n: this.appId }))
  }
}
