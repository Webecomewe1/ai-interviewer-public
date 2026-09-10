(function (global) {
  'use strict';

  var SAMPLE_RATE = 16000;
  var LEVEL_THRESHOLD = 0.015;
  var MAX_PLAYBACK_CHUNK = 0x8000;

  function VoiceSession(callbacks) {
    this.cb = callbacks || {};
    this.audioCtx = null;
    this.stream = null;
    this.source = null;
    this.workletNode = null;
    this.ws = null;
    this.muted = false;
    this.playing = false;
    this.playQueue = [];
    this.state = 'idle';
    this.holding = false;
    this.pingInterval = null;
    this.waitingReady = false;
    this.audioBuffer = [];
    this.turnBuffering = false;
    this.pendingComplete = false;
  }

  VoiceSession.prototype.connect = function (interviewId) {
    var self = this;
    this.setReady = false;
    return navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then(function (stream) {
        self.stream = stream;
        self.state = 'connecting';
        self.emit('state', self.state);
        return self._ensureAudioContext();
      })
      .then(function () {
        return self._setupCapture();
      })
      .then(function () {
        self._openSocket(interviewId);
        return self;
      });
  };

  VoiceSession.prototype._ensureAudioContext = function () {
    var self = this;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!self.audioCtx) self.audioCtx = new Ctx();
    if (self.audioCtx.state === 'suspended') {
      return self.audioCtx.resume();
    }
    return Promise.resolve();
  };

  VoiceSession.prototype._setupCapture = function () {
    var self = this;
    if (!window.AudioWorkletNode) {
      return Promise.reject(new Error('AudioWorklet is not supported in this browser.'));
    }
    return self.audioCtx.audioWorklet
      .addModule(new URL('./pcm.js', import.meta.url).href)
      .then(function () {
        self.source = self.audioCtx.createMediaStreamSource(self.stream);
        self.workletNode = new AudioWorkletNode(self.audioCtx, 'pcm-processor', {
          processorOptions: { targetRate: SAMPLE_RATE },
          numberOfOutputs: 0,
        });
        self.workletNode.port.onmessage = function (e) {
          self._onPcm(e.data);
        };
        self.source.connect(self.workletNode);
      })
      .catch(function (err) {
        console.error('Failed to load worklet module js/pcm.js:', err);
        throw err;
      });
  };

  VoiceSession.prototype._onPcm = function (chunk) {
    if (this.state !== 'active' || this.muted) return;

    var sum = 0;
    for (var i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    var rms = Math.sqrt(sum / chunk.length);
    this.emit('level', rms);

    if (!this.holding) return;

    var ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'audio',
          data: this._toBase64(chunk),
          sampleRate: SAMPLE_RATE,
        })
      );
    }
  };

  VoiceSession.prototype._toBase64 = function (chunk) {
    var len = chunk.length;
    var ab = new ArrayBuffer(len * 2);
    var view = new DataView(ab);
    for (var i = 0; i < len; i++) {
      var s = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    var bytes = new Uint8Array(ab);
    var binary = '';
    for (var j = 0; j < bytes.length; j += MAX_PLAYBACK_CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(j, j + MAX_PLAYBACK_CHUNK));
    }
    return btoa(binary);
  };

  VoiceSession.prototype._openSocket = function (interviewId) {
    var self = this;
    var baseUrl = typeof __API_BASE__ !== 'undefined' && __API_BASE__ ? __API_BASE__ : '';
    var url;
    if (baseUrl) {
      url = baseUrl.replace(/^http/, 'ws') + '/live/' + interviewId;
    } else {
      var proto = location.protocol === 'https:' ? 'wss' : 'ws';
      url = proto + '://' + location.host + '/live/' + interviewId;
    }
    var token = window.Auth ? window.Auth.getToken() : null;
    if (token) url += '?token=' + encodeURIComponent(token);
    var ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = function () {
      self.state = 'active';
      self.emit('state', self.state);
      self.pingInterval = setInterval(function () {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 20000);
    };

    ws.onmessage = function (e) {
      var msg;
      try {
        msg = JSON.parse(e.data);
      } catch (err) {
        return;
      }
      self._handle(msg);
    };

    ws.onclose = function () {
      clearInterval(self.pingInterval);
      self.pingInterval = null;
      if (self.state === 'active' || self.state === 'connecting') {
        self.state = 'ended';
        self.emit('wsClosed', {});
      }
    };
  };

  VoiceSession.prototype._handle = function (msg) {
    switch (msg.type) {
      case 'ready':
        this.emit('ready', msg);
        break;
      case 'audio':
        this._bufferAudio(msg.data, msg.mimeType);
        break;
      case 'modelText':
        this.emit('aiText', { text: msg.text, final: msg.final });
        break;
      case 'candidateText':
        this.emit('candidateText', { text: msg.text, final: msg.final });
        break;
      case 'turnComplete':
        this._flushBuffer();
        this.emit('turnComplete', { questionNumber: msg.questionNumber });
        break;
      case 'assessmentPrompt':
        this.holding = false;
        this._flushBuffer();
        this.emit('assessmentPrompt', { questionCount: msg.questionCount });
        break;
      case 'interrupted':
        this._abortBuffer();
        this._clearPlayback();
        break;
      case 'generationComplete':
        break;
      case 'complete':
        this._flushBuffer();
        this.pendingComplete = true;
        this._maybeComplete();
        break;
      case 'error':
        this._abortBuffer();
        this.emit('error', { message: msg.message });
        break;
      case 'closed':
        this._abortBuffer();
        this.emit('wsClosed', { reason: msg.reason });
        break;
      case 'pong':
        break;
    }
  };

  VoiceSession.prototype._bufferAudio = function (dataB64, mimeType) {
    if (this.holding) {
      this.holding = false;
      this.emit('holding', false);
    }
    if (!this.turnBuffering) {
      this.turnBuffering = true;
      this.emit('aiGenerating', true);
    }
    this.audioBuffer.push({ data: dataB64, mimeType: mimeType });
  };

  VoiceSession.prototype._flushBuffer = function () {
    if (this.turnBuffering) {
      this.turnBuffering = false;
      this.emit('aiGenerating', false);
    }
    var pending = this.audioBuffer;
    this.audioBuffer = [];
    for (var i = 0; i < pending.length; i++) {
      this._playAudio(pending[i].data, pending[i].mimeType);
    }
  };

  VoiceSession.prototype._abortBuffer = function () {
    if (this.turnBuffering) {
      this.turnBuffering = false;
      this.emit('aiGenerating', false);
    }
    this.audioBuffer = [];
  };

  VoiceSession.prototype._maybeComplete = function () {
    if (this.pendingComplete && !this.playing && this.audioBuffer.length === 0) {
      this.pendingComplete = false;
      this.emit('complete', {});
    }
  };

  VoiceSession.prototype._playAudio = function (dataB64, mimeType) {
    var self = this;
    if (!this.audioCtx) return;

    var rateMatch = mimeType && mimeType.match(/rate=(\d+)/);
    var rate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;

    var binary = atob(dataB64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    var frameCount = bytes.length / 2;
    var buffer = this.audioCtx.createBuffer(1, frameCount, rate);
    var data = buffer.getChannelData(0);
    var view = new DataView(bytes.buffer);
    for (var j = 0; j < frameCount; j++) {
      data[j] = view.getInt16(j * 2, true) / 32768;
    }

    var source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioCtx.destination);
    this.playQueue.push(source);
    if (!this.playing) this._startNext();
  };

  VoiceSession.prototype._startNext = function () {
    var self = this;
    var src = this.playQueue[0];
    if (!src) {
      this.playing = false;
      this.emit('aiSpeaking', false);
      this._maybeComplete();
      return;
    }
    this.playing = true;
    this.emit('aiSpeaking', true);
    src.onended = function () {
      self.playQueue.shift();
      self._startNext();
    };
    src.start(0);
  };

  VoiceSession.prototype._clearPlayback = function () {
    while (this.playQueue.length) {
      var src = this.playQueue.pop();
      try {
        src.stop();
      } catch (e) {
        /* ignore */
      }
    }
    this.playing = false;
    this.emit('aiSpeaking', false);
  };

  VoiceSession.prototype.setMuted = function (muted) {
    this.muted = !!muted;
  };

  VoiceSession.prototype.isMuted = function () {
    return !!this.muted;
  };

  VoiceSession.prototype.isHolding = function () {
    return this.holding;
  };

  VoiceSession.prototype.startTurn = function () {
    if (this.state === 'ended') return false;
    this.holding = true;
    this.emit('holding', true);
    return true;
  };

  VoiceSession.prototype.endTurn = function () {
    if (!this.holding) return;
    this.holding = false;
    this.emit('holding', false);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'audioEnd' }));
      } catch (e) {
        /* ignore */
      }
    }
  };

  VoiceSession.prototype.chooseAssessment = function (yes) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({ type: 'assessmentChoice', value: yes ? 'yes' : 'no' })
      );
    }
  };

  VoiceSession.prototype.end = function () {
    var self = this;
    this.holding = false;
    this.turnBuffering = false;
    this.audioBuffer = [];
    this.pendingComplete = false;
    clearInterval(this.pingInterval);
    this.pingInterval = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        /* ignore */
      }
      this.ws = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch (e) {
        /* ignore */
      }
      this.source = null;
    }
    if (this.workletNode) {
      try {
        this.workletNode.port.close();
      } catch (e) {
        /* ignore */
      }
      this.workletNode = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(function (t) {
        t.stop();
      });
      this.stream = null;
    }
    this._clearPlayback();
    if (this.audioCtx) {
      try {
        this.audioCtx.close();
      } catch (e) {
        /* ignore */
      }
      this.audioCtx = null;
    }
    this.state = 'ended';
    this.emit('state', this.state);
    return Promise.resolve();
  };

  VoiceSession.prototype.emit = function (name, payload) {
    if (this.cb[name]) this.cb[name](payload);
  };

  global.VoiceSession = VoiceSession;
})(window);