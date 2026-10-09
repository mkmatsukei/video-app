// youtube-player.js
// YouTube IFrame Player API ラッパー（Android Chrome 向け：幅100%・エラー通知付き）

class YouTubePlayerController {
  constructor(elementId, videoId, onReadyCallback, onStateChangeCallback, onErrorCallback) {
    this.elementId = elementId;
    this.videoId = videoId;
    this.onReadyCallback = onReadyCallback;
    this.onStateChangeCallback = onStateChangeCallback;
    this.onErrorCallback = onErrorCallback;
    this.player = null;
    this.init();
  }

  init() {
    if (window.YT && window.YT.Player) {
      this.createPlayer();
      return;
    }
    window.onYouTubeIframeAPIReady = () => this.createPlayer();
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => {
      if (this.onErrorCallback) this.onErrorCallback('api-load');
    };
    document.head.appendChild(tag);
  }

  createPlayer() {
    this.player = new YT.Player(this.elementId, {
      width: '100%',
      height: '100%',
      videoId: this.videoId,
      playerVars: { playsinline: 1, controls: 1, rel: 0, origin: location.origin },
      events: {
        onReady: (e) => { if (this.onReadyCallback) this.onReadyCallback(e); },
        onStateChange: (e) => { if (this.onStateChangeCallback) this.onStateChangeCallback(e); },
        onError: (e) => { if (this.onErrorCallback) this.onErrorCallback(e.data); }
      }
    });
  }

  play() { if (this.player && this.player.playVideo) this.player.playVideo(); }
  pause() { if (this.player && this.player.pauseVideo) this.player.pauseVideo(); }
  getCurrentTime() {
    return (this.player && this.player.getCurrentTime) ? this.player.getCurrentTime() : 0;
  }
  getDuration() {
    return (this.player && this.player.getDuration) ? this.player.getDuration() : 0;
  }
  seekTo(seconds) { if (this.player && this.player.seekTo) this.player.seekTo(seconds, true); }
  isPlaying() {
    if (this.player && this.player.getPlayerState) {
      return this.player.getPlayerState() === YT.PlayerState.PLAYING;
    }
    return false;
  }
}
