// app.js
// 全体を統括するメインロジック（モード6 / モード7 のみ）

const VIDEO_ID = 'wK-rbvTOgZk';
const DATA_DIR = 'data';

const DEFAULTS = { volume: 1.0, rate: 1.0, mode6Max: 8, mode7Max: 8, mode7Cool: 5 };

document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  const tts = new TTSController();
  let player = null;
  let engine = null;
  let started = false;
  let wakeLock = null;

  const statusChip = $('status-chip');
  const touchArea = $('touch-area');
  const touchLabel = $('touch-label');
  const touchSub = $('touch-sub');
  const modeButtons = document.querySelectorAll('.mode-btn');
  const btnPlayPause = $('btn-play-pause');
  const logEl = $('log');

  // ---------- ログ ----------
  function addLog(msg) {
    const t = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    logEl.textContent += `[${t}] ${msg}\n`;
    if (logEl.textContent.length > 20000) logEl.textContent = logEl.textContent.slice(-12000);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setStatus(text, cls) {
    statusChip.textContent = text;
    statusChip.className = 'chip' + (cls ? ' ' + cls : '');
  }

  // ---------- プレイヤー & エンジン ----------
  player = new YouTubePlayerController(
    'yt-player', VIDEO_ID,
    () => { addLog('YouTubeプレイヤー準備完了'); updatePlayButton(); },
    () => updatePlayButton(),
    (code) => showVideoError(code)
  );

  engine = new CommentEngine(tts, player);
  engine.onLog = addLog;

  engine.setOnCommentSpeak((comment) => {
    $('current-comment-text').textContent = engine.stripHtml(comment.textOriginal || comment.text);
    $('current-comment-author').textContent = `投稿者: ${comment.author || '匿名'}`;
    touchArea.classList.add('speaking');
    setStatus('読み上げ中', 'speaking');
  });

  // 読み上げ表示を戻す（定期チェック）
  setInterval(() => {
    if (!tts.isSpeaking() && !tts.speakTimeout) {
      touchArea.classList.remove('speaking');
      if (started) setStatus(player && player.isPlaying() ? '再生中' : '停止中', 'ok');
    }
  }, 500);

  function showVideoError(code) {
    const box = $('video-error');
    box.hidden = false;
    const url = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
    if (code === 'api-load') {
      box.innerHTML = 'YouTube プレイヤーを読み込めませんでした。インターネット接続を確認してください。';
    } else {
      box.innerHTML = `動画を埋め込み再生できませんでした（エラー ${code}）。<a href="${url}" target="_blank" rel="noopener">YouTubeで開く</a>`;
    }
    addLog(`動画エラー: ${code}`);
  }

  function updatePlayButton() {
    btnPlayPause.textContent = player.isPlaying() ? '⏸ 一時停止' : '▶ 再生';
  }
  setInterval(updatePlayButton, 700);

  // ---------- データ読み込み ----------
  async function loadAll() {
    const loadStatus = $('load-status');
    try {
      const [comments, ai] = await Promise.all([
        fetch(`${DATA_DIR}/comments_${VIDEO_ID}.json`).then(r => { if (!r.ok) throw new Error('コメントデータが見つかりません'); return r.json(); }),
        fetch(`${DATA_DIR}/mode4_schedule_${VIDEO_ID}_ai.json`).then(r => { if (!r.ok) throw new Error('AI紐付けデータが見つかりません'); return r.json(); })
      ]);
      const list = Array.isArray(comments) ? comments : (comments.comments || []);
      engine.setComments(list);
      engine.setAiSchedule(ai);
      $('comment-count').textContent = list.length;
      $('schedule-count').textContent = ai.schedule ? ai.schedule.length : 0;
      addLog(`コメント ${list.length} 件 / AI紐付け ${ai.schedule ? ai.schedule.length : 0} 件を読み込みました`);

      loadStatus.textContent = `音声ファイルを読み込み中… 0/${list.length}`;
      const ok = await tts.preloadComments(`${DATA_DIR}/tts_${VIDEO_ID}`, list, (done, total) => {
        loadStatus.textContent = `音声ファイルを読み込み中… ${done}/${total}`;
      });
      addLog(`事前生成音声 ${ok}/${list.length} 件を使用（残りは端末の音声合成で読み上げ）`);
      loadStatus.textContent = `準備完了（音声 ${ok}/${list.length} 件）`;
      $('btn-start').disabled = false;
    } catch (err) {
      console.error(err);
      loadStatus.textContent = `読み込みエラー: ${err.message}`;
      addLog(`読み込みエラー: ${err.message}`);
    }
  }
  loadAll();

  // ---------- 起動ボタン（ユーザー操作で音声再生を許可） ----------
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* 非対応・拒否は無視 */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && started) requestWakeLock();
  });

  $('btn-start').addEventListener('click', () => {
    started = true;
    $('start-overlay').classList.add('hidden');
    requestWakeLock();
    setStatus('停止中', 'ok');
    // 無音再生で音声再生の許可を確定させる
    Object.values(tts.audioCache).slice(0, 1).forEach(a => {
      try { a.muted = true; const p = a.play(); if (p && p.then) p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; }); } catch (e) { /* 無視 */ }
    });
    announceMode(engine.mode);
  });

  // ---------- モード切替 ----------
  const MODE_TEXT = {
    mode6: 'モード6、タップで現在地より前で最も近い未読のAIコメントを読み上げ。',
    mode7: 'モード7、AI紐付けのタイミングで動画停止しコメント読み上げ。'
  };
  function announceMode(mode) { tts.speak(MODE_TEXT[mode]); }

  function applyModeUI(mode) {
    modeButtons.forEach(b => {
      const active = b.dataset.mode === mode;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (mode === 'mode6') {
      touchArea.classList.remove('auto');
      touchLabel.textContent = 'ここを押し続ける';
      touchSub.textContent = '押している間、動画が止まってコメントを読み上げます。離すと動画が再開します。';
    } else {
      touchArea.classList.add('auto');
      touchLabel.textContent = '自動モード';
      touchSub.textContent = '動画を再生すると、関連するタイミングで自動的に停止してコメントを読み上げます。';
    }
  }

  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      lsSet('last_mode', mode);
      engine.setMode(mode);
      applyModeUI(mode);
      if (started) announceMode(mode);
    });
  });

  // ---------- 再生コントロール ----------
  btnPlayPause.addEventListener('click', () => {
    if (player.isPlaying()) player.pause(); else player.play();
    setTimeout(updatePlayButton, 200);
  });

  $('btn-restart').addEventListener('click', () => {
    engine.reset();   // 読み上げ済み履歴・クールタイムをクリア
    player.seekTo(0);
    player.pause();
    $('current-comment-text').textContent = '（読み上げを開始すると表示されます）';
    $('current-comment-author').textContent = '';
    addLog('最初からやり直します（読み上げ履歴をリセット）');
    setTimeout(updatePlayButton, 300);
  });

  $('btn-tts-test').addEventListener('click', () => {
    tts.speak('音声合成のテストです。正常に読み上げられています。');
  });

  // ---------- タッチエリア（モード6: 押している間だけ動作） ----------
  let pressing = false;
  function pressStart(e) {
    e.preventDefault();
    if (!started || pressing) return;
    pressing = true;
    touchArea.classList.add('pressing');
    if (engine.mode === 'mode6') engine.handleMode6PressStart();
  }
  function pressEnd(e) {
    if (e) e.preventDefault();
    if (!pressing) return;
    pressing = false;
    touchArea.classList.remove('pressing');
    if (engine.mode === 'mode6') engine.handleMode6PressEnd();
  }
  touchArea.addEventListener('pointerdown', (e) => {
    try { touchArea.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
    pressStart(e);
  });
  touchArea.addEventListener('pointerup', pressEnd);
  touchArea.addEventListener('pointercancel', pressEnd);
  touchArea.addEventListener('contextmenu', (e) => e.preventDefault());
  // キーボード/スクリーンリーダー操作用（Space/Enter 長押し）
  touchArea.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) pressStart(e); });
  touchArea.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') pressEnd(e); });

  // ---------- 設定スライダー ----------
  const settings = [
    { id: 'tts-volume', key: 'tts_volume', def: DEFAULTS.volume, fmt: v => `${Math.round(v * 100)}%`, apply: v => tts.setVolume(v), init: () => tts.volume },
    { id: 'tts-rate', key: 'tts_rate', def: DEFAULTS.rate, fmt: v => `${v.toFixed(1)}x`, apply: v => tts.setRate(v), init: () => tts.rate },
    { id: 'mode6-max', key: 'mode6_max_duration', def: DEFAULTS.mode6Max, fmt: v => `${v}秒`, apply: v => engine.setMode6MaxDuration(v) },
    { id: 'mode7-max', key: 'mode7_max_duration', def: DEFAULTS.mode7Max, fmt: v => `${v}秒`, apply: v => engine.setMode7MaxDuration(v) },
    { id: 'mode7-cool', key: 'mode7_cool_time', def: DEFAULTS.mode7Cool, fmt: v => `${v}秒`, apply: v => engine.setMode7CoolTime(v) }
  ];

  settings.forEach(s => {
    const input = $(s.id);
    const out = $(`${s.id}-value`);
    const saved = s.init ? s.init() : parseFloat(lsGet(s.key, s.def));
    const initial = isFinite(saved) ? saved : s.def;
    input.value = initial;
    out.textContent = s.fmt(parseFloat(input.value));
    s.apply(parseFloat(input.value));

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      out.textContent = s.fmt(v);
      s.apply(v);
      if (!s.init) lsSet(s.key, v);
    });
  });

  document.querySelectorAll('.step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.target);
      const step = parseFloat(input.step) || 1;
      const delta = parseFloat(btn.dataset.delta);
      let v = parseFloat(input.value) + delta;
      v = Math.max(parseFloat(input.min), Math.min(parseFloat(input.max), v));
      // 浮動小数誤差を丸める
      const decimals = (String(step).split('.')[1] || '').length;
      input.value = v.toFixed(decimals);
      input.dispatchEvent(new Event('input'));
    });
  });

  $('btn-reset-settings').addEventListener('click', () => {
    const defs = { 'tts-volume': DEFAULTS.volume, 'tts-rate': DEFAULTS.rate, 'mode6-max': DEFAULTS.mode6Max, 'mode7-max': DEFAULTS.mode7Max, 'mode7-cool': DEFAULTS.mode7Cool };
    Object.entries(defs).forEach(([id, v]) => {
      const input = $(id);
      input.value = v;
      input.dispatchEvent(new Event('input'));
    });
    addLog('設定を初期値に戻しました');
  });

  // ---------- 初期モード ----------
  const lastMode = lsGet('last_mode', 'mode6');
  const initialMode = (lastMode === 'mode7') ? 'mode7' : 'mode6';
  engine.setMode(initialMode);
  applyModeUI(initialMode);

  // ---------- Service Worker（オフライン用キャッシュ） ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(err => addLog(`SW登録失敗: ${err.message}`));
  }

  // テスト用フック
  window.__app = { engine, tts, player };
});
