// comment-engine.js
// モード6（タップで過去のAIコメント）／モード7（AI関連・停止あり）の再生ロジック。
// PC版 comment-engine.js のモード6・7部分を、判定ロジックそのまま移植したもの。

class CommentEngine {
  constructor(ttsController, playerController) {
    this.tts = ttsController;
    this.player = playerController;

    this.comments = [];
    this.mode = 'mode6';

    this.currentIndex = 0;
    this.playedCommentIds = new Set();
    this.checkInterval = null;

    this.aiSchedule = null;
    this.isMode6Pressing = false;

    // 調整可能な設定値
    this.mode6MaxDuration = 8;   // モード6 読上時間上限(秒)
    this.mode7MaxDuration = 8;   // モード7 読上時間上限(秒)
    this.mode7CoolTime = 5;      // モード7 クールタイム(動画秒)
    this.lastMode7ReadAt = -999;

    this.excludedCommentIds = new Set();
    this.onCommentSpeakCallback = null;
    this.onLog = null;
  }

  log(msg) {
    console.log(msg);
    if (this.onLog) this.onLog(msg);
  }

  setComments(comments) {
    this.comments = comments || [];
    this.reset();
  }

  setAiSchedule(scheduleData) {
    this.aiSchedule = scheduleData;
  }

  setMode6MaxDuration(val) { this.mode6MaxDuration = this._num(val, 8); }
  setMode7MaxDuration(val) { this.mode7MaxDuration = this._num(val, 8); }
  setMode7CoolTime(val) { this.mode7CoolTime = this._num(val, 5); }

  _num(val, fallback) {
    const n = typeof val === 'number' ? val : parseFloat(val);
    return isFinite(n) ? n : fallback;
  }

  setMode(mode) {
    this.mode = mode;
    this.reset();
  }

  reset() {
    this.currentIndex = 0;
    this.playedCommentIds.clear();
    this.isMode6Pressing = false;
    this.lastMode7ReadAt = -999;
    this.tts.cancel();
    this.stopAutoCheck();
    if (this.mode === 'mode7') this.startAutoCheck();
  }

  setOnCommentSpeak(callback) { this.onCommentSpeakCallback = callback; }

  // ----------------------------------------------------
  // 自動監視（モード7）: 1秒ごとにチェック
  // ----------------------------------------------------
  startAutoCheck() {
    this.stopAutoCheck();
    this.checkInterval = setInterval(() => {
      if (!this.player.isPlaying()) return;
      const currentTime = Math.floor(this.player.getCurrentTime());
      if (this.mode === 'mode7') this.checkMode7(currentTime);
    }, 1000);
  }

  stopAutoCheck() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  // ----------------------------------------------------
  // モード6: 押している間、動画を止めて「現在位置より前で最も近い未読AIコメント」を読み上げる
  // ----------------------------------------------------
  handleMode6PressStart() {
    if (this.mode !== 'mode6') return;
    this.isMode6Pressing = true;
    this.player.pause();

    this.speakNearestAiComment(() => {
      // 読み上げ終了後も押し続けていれば、さらに一つ前のコメントを続けて読み上げる
      if (this.isMode6Pressing) this.handleMode6PressStart();
    });
  }

  handleMode6PressEnd() {
    if (this.mode !== 'mode6') return;
    this.isMode6Pressing = false;
    this.tts.cancel();
    this.player.play();
  }

  speakNearestAiComment(onEndCallback = null) {
    if (!this.aiSchedule || !this.aiSchedule.schedule || this.aiSchedule.schedule.length === 0) {
      this.log('モード6: AIスケジュールデータがありません。');
      this.speakNextComment(onEndCallback);
      return;
    }

    const currentTime = this.player.getCurrentTime();
    this.log(`モード6: 読み上げ探索。再生時間: ${currentTime.toFixed(1)}秒`);

    const candidates = [];
    this.aiSchedule.schedule.forEach((item, index) => {
      if (!item.comment) return;
      const originalIdx = this.comments.findIndex(c => c.textOriginal === item.comment.textOriginal && c.author === item.comment.author);
      const realIdx = originalIdx >= 0 ? originalIdx : index;
      const commentId = `comment_${realIdx}_${item.comment.publishedAt || realIdx}`;

      if (this.excludedCommentIds.has(commentId) || this.playedCommentIds.has(commentId)) return;
      if (item.readAt <= currentTime) {
        const estimatedDuration = this.estimateSpeakDuration(item.comment);
        if (estimatedDuration > this.mode6MaxDuration) {
          this.log(`モード6: 予測読上時間 ${estimatedDuration.toFixed(1)}秒 が上限 ${this.mode6MaxDuration}秒 を超えるためスキップ: "${this._head(item.comment)}"`);
          this.playedCommentIds.add(commentId);
          return;
        }
        candidates.push({ item, commentId, readAt: item.readAt });
      }
    });

    if (candidates.length === 0) {
      this.log('モード6: 現在の再生位置より以前の未読AIコメントはありません。');
      this.speakNextComment(onEndCallback);
      return;
    }

    // 現在地に最も近い（readAt が最大の）もの
    candidates.sort((a, b) => b.readAt - a.readAt);
    const target = candidates[0];
    this.log(`モード6: 読み上げ (readAt: ${target.readAt}秒): "${this._head(target.item.comment)}"`);

    this.playedCommentIds.add(target.commentId);
    this.speakComment(target.item.comment, target.commentId, onEndCallback);
  }

  // ----------------------------------------------------
  // モード7: AI紐付けタイミングで動画を一時停止してコメントを読み上げ、終わったら再開
  // ----------------------------------------------------
  checkMode7(currentTime) {
    if (!this.aiSchedule || !this.aiSchedule.schedule) return;

    // クールタイム判定（最後に読み上げた動画秒からの経過）
    if (this.lastMode7ReadAt !== -999 && (currentTime - this.lastMode7ReadAt) < this.mode7CoolTime) {
      return;
    }

    for (const item of this.aiSchedule.schedule) {
      if (!item.comment) continue;
      const targetTime = Math.floor(item.readAt);
      const key = `mode7_ai_${targetTime}`;
      if (this.playedCommentIds.has(key)) continue;

      if (Math.abs(currentTime - targetTime) <= 1) {
        const estimatedDuration = this.estimateSpeakDuration(item.comment);
        if (estimatedDuration > this.mode7MaxDuration) {
          this.log(`モード7: 予測読上時間 ${estimatedDuration.toFixed(1)}秒 が上限 ${this.mode7MaxDuration}秒 を超えるためスキップ: "${this._head(item.comment)}"`);
          this.playedCommentIds.add(key);
          continue;
        }

        this.playedCommentIds.add(key);
        this.lastMode7ReadAt = currentTime;
        this.log(`モード7: ${targetTime}秒 に到達。一時停止して読み上げ: "${this._head(item.comment)}"`);

        const originalIdx = this.comments.findIndex(c => c.textOriginal === item.comment.textOriginal && c.author === item.comment.author);
        const commentId = originalIdx >= 0 ? `comment_${originalIdx}_${item.comment.publishedAt || originalIdx}` : null;

        this.player.pause();
        this.speakComment(item.comment, commentId, () => {
          this.player.play();
        });
        return;
      }
    }
  }

  // ----------------------------------------------------
  // ヘルパー
  // ----------------------------------------------------
  estimateSpeakDuration(comment) {
    const text = this.stripHtml(comment.textOriginal || comment.text);
    // 1文字あたり0.15秒 + 開始バッファ1.5秒
    return (text.length * 0.15) + 1.5;
  }

  _head(comment) {
    const t = this.stripHtml(comment.textOriginal || comment.text);
    return t.length > 24 ? t.slice(0, 24) + '…' : t;
  }

  // 未読のAI候補が無いときのフォールバック（PC版と同じく、全コメントを順番に読む）
  speakNextComment(onEndCallback = null) {
    if (this.comments.length === 0) {
      if (onEndCallback) onEndCallback();
      return;
    }

    let attempts = 0;
    while (attempts < this.comments.length) {
      const comment = this.comments[this.currentIndex];
      const commentId = `comment_${this.currentIndex}_${comment.publishedAt || this.currentIndex}`;

      if (!this.excludedCommentIds.has(commentId)) {
        this.speakComment(comment, commentId, () => {
          this.currentIndex = (this.currentIndex + 1) % this.comments.length;
          if (onEndCallback) onEndCallback();
        });
        return;
      }
      this.currentIndex = (this.currentIndex + 1) % this.comments.length;
      attempts++;
    }
    if (onEndCallback) onEndCallback();
  }

  speakComment(comment, commentId = null, onEndCallback = null) {
    if (this.onCommentSpeakCallback) this.onCommentSpeakCallback(comment);

    const cleanText = this.stripHtml(comment.textOriginal || comment.text);

    if (!commentId) {
      const idx = this.comments.findIndex(c => c === comment);
      const realIdx = idx >= 0 ? idx : 0;
      commentId = `comment_${realIdx}_${comment.publishedAt || realIdx}`;
    }
    this.tts.speakCommentId(commentId, cleanText, onEndCallback);
  }

  stripHtml(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
  }
}
