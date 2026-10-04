// Collects mono input frames and posts them to the page in ~2048-frame blocks.
// The node is created with channelCount 1 / explicit, so the engine already downmixed.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.len = 0;
    this.active = true;
    this.port.onmessage = (e) => {
      if (e.data === "stop") {
        this.flush();
        this.active = false;
        this.port.postMessage("stopped");
      }
    };
  }

  flush() {
    if (this.len === 0) return;
    const out = this.buf.slice(0, this.len);
    this.port.postMessage(out, [out.buffer]);
    this.len = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (this.active && channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buf[this.len++] = channel[i];
        if (this.len === this.buf.length) this.flush();
      }
    }
    return this.active;
  }
}

registerProcessor("pcm-capture", PcmCapture);
