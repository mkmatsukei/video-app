// tts.js
// 事前生成MP3の再生 + Web Speech API (SpeechSynthesis) へのフォールバックを管理する。
// PC版 tts.js を Android(Chrome) 向けに移植したもの。
//  - MP3 は起動時に fetch して Blob 化（0バイトの壊れたファイルは自動的に除外 → 音声合成にフォールバック）
//  - 音量・速度は localStorage に保存

function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch (e) { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (e) { /* 無視 */ }
}

class TTSController {
  constructor() {
    this.synth = window.speechSynthesis || null;
    this.currentUtterance = null;
    this.onEndCallback = null;
    this.isCancelled = false;
    this.speakTimeout = null;

    this.audioCache = {};   // commentId -> HTMLAudioElement
    this.activeAudio = null;

    this.volume = parseFloat(lsGet('tts_volume', '1.0'));
    this.rate = parseFloat(lsGet('tts_rate', '1.0'));
    if (!isFinite(this.volume)) this.volume = 1.0;
    if (!isFinite(this.rate)) this.rate = 1.0;

    this.voices = [];
    if (this.synth) {
      this._loadVoices();
      if (this.synth.onvoiceschanged !== undefined) {
        this.synth.onvoiceschanged = () => this._loadVoices();
      }
    }
    window.ttsInstance = this;
  }

  _loadVoices() {
    try { this.voices = this.synth.getVoices(); } catch (e) { this.voices = []; }
  }

  setVolume(vol) {
    this.volume = Math.max(0.0, Math.min(1.0, parseFloat(vol)));
    lsSet('tts_volume', this.volume);
    if (this.currentUtterance) this.currentUtterance.volume = this.volume;
    if (this.activeAudio) this.activeAudio.volume = this.volume;
  }

  setRate(rate) {
    this.rate = Math.max(0.5, Math.min(5.0, parseFloat(rate)));
    lsSet('tts_rate', this.rate);
    if (this.currentUtterance) this.currentUtterance.rate = this.rate;
    if (this.activeAudio) this.activeAudio.playbackRate = this.rate;
  }

  // 事前生成MP3をすべて読み込む。onProgress(done, total, okCount)
  async preloadComments(baseUrl, comments, onProgress) {
    this.audioCache = {};
    if (!comments || comments.length === 0) return 0;
    let done = 0, ok = 0;
    await Promise.all(comments.map(async (comment, idx) => {
      const commentId = `comment_${idx}_${comment.publishedAt || idx}`;
      try {
        const res = await fetch(`${baseUrl}/comment_${idx}.mp3`);
        if (res.ok) {
          const blob = await res.blob();
          if (blob.size > 0) {
            const audio = new Audio(URL.createObjectURL(blob));
            audio.preload = 'auto';
            if ('preservesPitch' in audio) audio.preservesPitch = true;
            this.audioCache[commentId] = audio;
            ok++;
          }
        }
      } catch (e) { /* 取得失敗 → フォールバック */ }
      done++;
      if (onProgress) onProgress(done, comments.length, ok);
    }));
    return ok;
  }

  // IDで再生（MP3があれば使用、なければ音声合成）
  speakCommentId(commentId, fallbackText, callbackOnEnd = null) {
    this.cancel();

    const cachedAudio = this.audioCache[commentId];
    if (cachedAudio) {
      this.activeAudio = cachedAudio;
      cachedAudio.currentTime = 0;
      cachedAudio.volume = this.volume;
      cachedAudio.playbackRate = this.rate;

      cachedAudio.onended = () => {
        this.activeAudio = null;
        if (callbackOnEnd) callbackOnEnd();
      };
      cachedAudio.onerror = () => {
        this.activeAudio = null;
        this.speak(fallbackText, callbackOnEnd);
      };
      const p = cachedAudio.play();
      if (p && p.catch) {
        p.catch(err => {
          // cancel() による中断は正常動作
          if (this.activeAudio !== cachedAudio) return;
          console.warn('TTS: MP3再生失敗。音声合成にフォールバックします。', err);
          this.activeAudio = null;
          this.speak(fallbackText, callbackOnEnd);
        });
      }
    } else {
      this.speak(fallbackText, callbackOnEnd);
    }
  }

  speak(text, callbackOnEnd = null) {
    if (this.speakTimeout) { clearTimeout(this.speakTimeout); this.speakTimeout = null; }

    this.isCancelled = true;
    if (this.currentUtterance) {
      this.currentUtterance.onstart = null;
      this.currentUtterance.onend = null;
      this.currentUtterance.onerror = null;
      this.currentUtterance = null;
    }
    this.onEndCallback = null;

    if (!this.synth || !text) {
      if (this.synth) this.synth.cancel();
      if (callbackOnEnd) callbackOnEnd();
      return;
    }
    this.synth.cancel();

    // Chromium: cancel() 直後の speak() はフリーズすることがあるため少し待つ
    this.speakTimeout = setTimeout(() => {
      this.speakTimeout = null;
      this._doSpeak(text, callbackOnEnd);
    }, 50);
  }

  _doSpeak(text, callbackOnEnd) {
    this.isCancelled = false;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    utterance.volume = this.volume;
    utterance.rate = this.rate;
    utterance.pitch = 1.0;

    if (!this.voices.length) this._loadVoices();
    const jaVoice = this.voices.find(v => v.lang === 'ja-JP' || (v.lang && v.lang.includes('ja')));
    if (jaVoice) utterance.voice = jaVoice;

    this.currentUtterance = utterance;
    this.onEndCallback = callbackOnEnd;

    const finish = () => {
      this.currentUtterance = null;
      const cb = this.onEndCallback;
      this.onEndCallback = null;
      if (cb && !this.isCancelled) cb();
    };
    utterance.onend = finish;
    utterance.onerror = finish;

    if (this.synth.paused) this.synth.resume();
    this.synth.speak(utterance);
  }

  cancel() {
    this.isCancelled = true;
    if (this.speakTimeout) { clearTimeout(this.speakTimeout); this.speakTimeout = null; }

    if (this.activeAudio) {
      try {
        this.activeAudio.onended = null;
        this.activeAudio.onerror = null;
        this.activeAudio.pause();
      } catch (e) { /* 無視 */ }
      this.activeAudio = null;
    }
    if (this.currentUtterance) {
      this.currentUtterance.onstart = null;
      this.currentUtterance.onend = null;
      this.currentUtterance.onerror = null;
    }
    if (this.synth) this.synth.cancel();
    this.currentUtterance = null;
    this.onEndCallback = null;
  }

  isSpeaking() {
    return (this.synth && this.synth.speaking) || (this.activeAudio && !this.activeAudio.paused);
  }
}
