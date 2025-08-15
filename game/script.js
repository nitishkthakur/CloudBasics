/* Airplane Shooter - Vanilla JS Canvas
   Controls: WASD/Arrows move, Space / Mouse / Touch to fire, P pause, M mute
*/
(() => {
  // Canvas setup
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  // Enable image smoothing for scaled sprites
  ctx.imageSmoothingEnabled = true;

  // Asset loading (level-based planes and backgrounds)
  function loadImage(src) { const img = new Image(); img.src = src; return img; }
  const assets = {
    planes: {
      1: loadImage('assets/level_1_plane.png'),
      2: loadImage('assets/level_2_plane.png'),
    },
    bgs: {
      1: loadImage('assets/level_1_background.png'),
      2: loadImage('assets/level_2_background.png'),
    }
  };
  function currentPlaneImg() { return assets.planes[level] || assets.planes[1]; }
  function currentBgImg() { return assets.bgs[level] || assets.bgs[1]; }

  let vw = 0, vh = 0, dpr = 1;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = Math.max(320, window.innerWidth);
    vh = Math.max(480, window.innerHeight);
    canvas.width = Math.floor(vw * dpr);
    canvas.height = Math.floor(vh * dpr);
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // UI elements
  const scoreEl = document.getElementById('score');
  const levelEl = document.getElementById('level');
  const hpFill = document.getElementById('hpbar-fill');
  const overlay = document.getElementById('overlay');
  const gameOverEl = document.getElementById('gameOver');
  const finalScoreEl = document.getElementById('finalScore');
  const startBtn = document.getElementById('startBtn');
  const restartBtn = document.getElementById('restartBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const muteBtn = document.getElementById('muteBtn');
  const howBtn = document.getElementById('howBtn');
  const howPanel = document.getElementById('how');

  howBtn?.addEventListener('click', () => howPanel?.classList.toggle('hidden'));

  // Audio
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;
  let masterGain = null;
  let muted = false;
  function initAudio() {
    if (audioCtx) return;
    try {
      audioCtx = new AudioCtx();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.2;
      masterGain.connect(audioCtx.destination);
    } catch (e) {
      // ignore if not allowed
    }
  }
  function playBeep(freq = 440, duration = 0.06, type = 'square', gain = 0.12) {
    if (!audioCtx || muted) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g).connect(masterGain);
    o.start();
    o.stop(audioCtx.currentTime + duration);
  }
  function playNoise(duration = 0.12, gain = 0.1) {
    if (!audioCtx || muted) return;
    const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const g = audioCtx.createGain(); g.gain.value = gain;
    const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
    src.connect(f).connect(g).connect(masterGain);
    src.start();
  }

  // Input
  const input = { up: false, down: false, left: false, right: false, fire: false };
  function setKey(e, down) {
    const k = e.key;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", "W", "A", "S", "D", " ", "Space"].includes(k)) {
      e.preventDefault();
    }
    if (k === 'ArrowUp' || k === 'w' || k === 'W') input.up = down;
    if (k === 'ArrowDown' || k === 's' || k === 'S') input.down = down;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') input.left = down;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') input.right = down;
    if (k === ' ' || k === 'Space') input.fire = down;
    if (down && (k === 'p' || k === 'P')) togglePause();
    if (down && (k === 'm' || k === 'M')) toggleMute();
  }
  window.addEventListener('keydown', (e) => setKey(e, true), { passive: false });
  window.addEventListener('keyup', (e) => setKey(e, false), { passive: false });
  canvas.addEventListener('mousedown', () => { input.fire = true; initAudio(); });
  canvas.addEventListener('mouseup', () => input.fire = false);
  canvas.addEventListener('mouseleave', () => input.fire = false);
  // Touch: drag to move, hold to fire
  let touchActive = false;
  function handleTouch(e) {
    if (!player) return;
    const t = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const x = (t.clientX - rect.left);
    const y = (t.clientY - rect.top);
    player.targetX = x; // soft follow
    player.targetY = y;
  }
  canvas.addEventListener('touchstart', (e) => { touchActive = true; input.fire = true; initAudio(); handleTouch(e); }, { passive: true });
  canvas.addEventListener('touchmove', (e) => { handleTouch(e); }, { passive: true });
  canvas.addEventListener('touchend', () => { touchActive = false; input.fire = false; });

  pauseBtn?.addEventListener('click', () => togglePause());
  muteBtn?.addEventListener('click', () => toggleMute());

  function toggleMute() {
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔈';
  }
  function togglePause() {
    if (!started || gameOver) return;
    paused = !paused;
    pauseBtn.textContent = paused ? '▶' : '⏸';
    if (!paused) lastTime = performance.now();
  }

  // Entities
  class Entity {
    constructor(x, y, w, h) { this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.w = w; this.h = h; this.alive = true; }
    get rect() { return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h }; }
    update(dt) { this.x += this.vx * dt; this.y += this.vy * dt; }
    draw() {}
  }

  class Particle extends Entity {
    constructor(x, y, vx, vy, life, color) { super(x, y, 2, 2); this.vx = vx; this.vy = vy; this.life = life; this.color = color; this.alpha = 1; }
    update(dt) { super.update(dt); this.life -= dt; this.alpha = Math.max(0, this.life * 2); if (this.life <= 0) this.alive = false; }
    draw() { ctx.globalAlpha = this.alpha; ctx.fillStyle = this.color; ctx.fillRect(this.x, this.y, 2, 2); ctx.globalAlpha = 1; }
  }

  class Bullet extends Entity {
    constructor(x, y, vy, friendly = true, angle = 0) {
      super(x, y, 4, 10);
      const speed = friendly ? -600 : 280;
      this.vx = Math.sin(angle) * speed;
      this.vy = Math.cos(angle) * speed * (friendly ? 1 : 1);
      this.friendly = friendly;
      this.damage = friendly ? 1 : 10;
      this.color = friendly ? '#8bf' : '#ff8844';
    }
    update(dt) {
      super.update(dt);
      if (this.y < -20 || this.y > vh + 40 || this.x < -50 || this.x > vw + 50) this.alive = false;
    }
    draw() {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.fillStyle = this.color;
      ctx.fillRect(-1.5, -8, 3, 14);
      ctx.fillStyle = '#fff8';
      ctx.fillRect(-0.8, -8, 1.6, 8);
      ctx.restore();
    }
  }

  class PowerUp extends Entity {
    constructor(x, y, kind) { super(x, y, 20, 20); this.kind = kind; this.vy = 60; }
    draw() {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.fillStyle = '#113a77aa';
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#46d3ff'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const map = { rapid: 'R', spread: 'S', shield: '⛨', repair: '+' };
      ctx.fillText(map[this.kind] || '?', 0, 1);
      ctx.restore();
    }
  }

  class Enemy extends Entity {
    constructor(x, y, type = 'grunt') {
      const cfg = Enemy.configs[type];
      super(x, y, cfg.w, cfg.h);
      this.type = type;
      this.hp = cfg.hp;
      this.score = cfg.score;
      this.timer = 0;
      this.baseX = x;
      this.vy = cfg.speed;
      this.cooldown = 0;
    }
    update(dt) {
      this.timer += dt;
      const cfg = Enemy.configs[this.type];
      // Path
      if (cfg.sine) this.x = this.baseX + Math.sin(this.timer * cfg.sine.freq) * cfg.sine.amp;
      this.y += this.vy * dt;
      // Shooting
      this.cooldown -= dt;
      if (cfg.shoot && this.cooldown <= 0 && this.y > 0 && this.y < vh) {
        this.cooldown = cfg.shoot.rate;
        const bx = this.x; const by = this.y + this.h / 2;
        if (cfg.shoot.pattern === 'straight') {
          bullets.push(new Bullet(bx, by, 220, false, 0));
        } else if (cfg.shoot.pattern === 'spread') {
          bullets.push(new Bullet(bx, by, 220, false, 0));
          bullets.push(new Bullet(bx - 10, by, 220, false, 0.15));
          bullets.push(new Bullet(bx + 10, by, 220, false, -0.15));
        }
      }
      if (this.y > vh + 50) this.alive = false;
    }
    draw() {
      ctx.save();
      ctx.translate(this.x, this.y);
      // Body
      const bodyGrad = ctx.createLinearGradient(0, -this.h / 2, 0, this.h / 2);
      bodyGrad.addColorStop(0, '#20355a');
      bodyGrad.addColorStop(1, '#0d1b35');
      ctx.fillStyle = bodyGrad;
      roundRect(-this.w / 2, -this.h / 2, this.w, this.h, 8, true, true);
      // Glow cockpit
      ctx.fillStyle = '#6cf8';
      ctx.beginPath(); ctx.ellipse(0, -this.h / 4, this.w / 4, this.h / 6, 0, 0, Math.PI * 2); ctx.fill();
      // Wings
      ctx.fillStyle = '#1b2a4a';
      ctx.fillRect(-this.w / 2 - 6, -6, this.w + 12, 12);
      // Health bar (small)
      ctx.fillStyle = '#0008'; ctx.fillRect(-this.w / 2, this.h / 2 + 6, this.w, 4);
      const hpw = (this.hp / Enemy.configs[this.type].hp) * this.w;
      ctx.fillStyle = '#f55'; ctx.fillRect(-this.w / 2, this.h / 2 + 6, hpw, 4);
      ctx.restore();
    }
    hit(dmg) {
      this.hp -= dmg;
      playBeep(220 + Math.random() * 40, 0.04, 'sawtooth', 0.08);
      if (this.hp <= 0) {
        this.alive = false;
        score += Enemy.configs[this.type].score;
        spawnExplosion(this.x, this.y, 18, '#ff9955');
        // Power-up drop chance
        if (Math.random() < 0.12) {
          const types = ['rapid', 'spread', 'shield', 'repair'];
          const kind = types[Math.floor(Math.random() * types.length)];
          powerups.push(new PowerUp(this.x, this.y, kind));
        }
      }
    }
  }
  Enemy.configs = {
    grunt: { w: 34, h: 28, hp: 3, speed: 90, score: 25, sine: { freq: 3, amp: 40 }, shoot: null },
    shooter: { w: 40, h: 34, hp: 5, speed: 80, score: 40, sine: { freq: 2.2, amp: 60 }, shoot: { rate: 1.2, pattern: 'straight' } },
    elite: { w: 50, h: 40, hp: 12, speed: 70, score: 120, sine: { freq: 1.8, amp: 80 }, shoot: { rate: 1.8, pattern: 'spread' } },
  };

  class Player extends Entity {
    constructor() { super(vw / 2, vh - 80, 36, 40); this.speed = 300; this.cooldown = 0; this.hp = 100; this.maxHp = 100; this.spread = 0; this.rapid = 0; this.shield = 0; this.targetX = null; this.targetY = null; }
    update(dt) {
      // Keyboard move
      let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      const len = Math.hypot(dx, dy) || 1;
      this.x += (dx / len) * this.speed * dt;
      this.y += (dy / len) * this.speed * dt;
      // Touch follow
      if (touchActive && (this.targetX != null)) {
        const lerp = (a, b, t) => a + (b - a) * t;
        this.x = lerp(this.x, this.targetX, 0.2);
        this.y = lerp(this.y, this.targetY, 0.2);
      }
      // Bounds
      this.x = Math.max(this.w / 2 + 6, Math.min(vw - this.w / 2 - 6, this.x));
      this.y = Math.max(this.h / 2 + 6, Math.min(vh - this.h / 2 - 6, this.y));
      // Timers
      this.cooldown -= dt;
      if (this.rapid > 0) this.rapid -= dt;
      if (this.shield > 0) this.shield -= dt;
      // Fire
      if (input.fire && this.cooldown <= 0) {
        this.shoot();
      }
    }
    shoot() {
      const rate = this.rapid > 0 ? 0.08 : 0.18;
      this.cooldown = rate;
      bullets.push(new Bullet(this.x, this.y - this.h / 2, -600, true, 0));
      if (this.spread >= 1) bullets.push(new Bullet(this.x - 10, this.y - this.h / 2, -600, true, 0.15));
      if (this.spread >= 1) bullets.push(new Bullet(this.x + 10, this.y - this.h / 2, -600, true, -0.15));
      if (this.spread >= 2) bullets.push(new Bullet(this.x - 16, this.y - this.h / 2, -600, true, 0.28));
      if (this.spread >= 2) bullets.push(new Bullet(this.x + 16, this.y - this.h / 2, -600, true, -0.28));
      playBeep(660, 0.04, 'square', 0.1);
    }
    damage(amount) {
      if (this.shield > 0) {
        spawnShieldSpark(this.x, this.y);
        playBeep(300, 0.05, 'triangle', 0.08);
        return;
      }
      this.hp -= amount;
      spawnExplosion(this.x, this.y, 8, '#66d9ff');
      playNoise(0.08, 0.08);
      if (this.hp <= 0) {
        this.hp = 0;
        endGame();
      }
    }
    draw() {
      ctx.save();
      ctx.translate(this.x, this.y);
      // Thruster glow behind the sprite
      const thr = Math.sin(perf * 15) * 2 + 6;
      ctx.fillStyle = '#3cf8';
      ctx.beginPath(); ctx.moveTo(-6, this.h / 2); ctx.lineTo(0, this.h / 2 + thr); ctx.lineTo(6, this.h / 2); ctx.closePath(); ctx.fill();

      // Draw plane sprite for current level
      const img = currentPlaneImg();
      if (img && img.complete && img.naturalWidth) {
        ctx.drawImage(img, -this.w / 2, -this.h / 2, this.w, this.h);
      } else {
        // Fallback shape until image loads
        const g = ctx.createLinearGradient(0, -this.h / 2, 0, this.h / 2);
        g.addColorStop(0, '#4fa3ff'); g.addColorStop(1, '#1a3f86');
        ctx.fillStyle = g;
        roundRect(-this.w / 2, -this.h / 2, this.w, this.h, 10, true, true);
      }

      // Shield effect overlay
      if (this.shield > 0) {
        ctx.strokeStyle = `rgba(70,211,255,${0.5 + 0.5 * Math.sin(perf * 6)})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, this.w * 0.9, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Helpers
  function roundRect(x, y, w, h, r, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  function aabb(a, b) {
    return (Math.abs(a.x - b.x) * 2 < (a.w + b.w)) && (Math.abs(a.y - b.y) * 2 < (a.h + b.h));
  }

  function spawnExplosion(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 180;
      particles.push(new Particle(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.6 + Math.random() * 0.6, color));
    }
  }
  function spawnShieldSpark(x, y) {
    for (let i = 0; i < 10; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 120;
      particles.push(new Particle(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.25 + Math.random() * 0.3, '#46d3ff'));
    }
  }

  // Game state
  let started = false;
  let gameOver = false;
  let paused = false;
  let score = 0; let level = 1;
  // Level transition state
  let levelTransitionPending = false; // message showing
  let levelTransitionDone = false;    // completed once
  let levelMsgTimer = 0;              // seconds remaining for message
<<<<<<< HEAD
=======
  // Score submit guard
  let scorePosted = false;
>>>>>>> bbc2850 (fic)
  let player = null;
  const enemies = []; const bullets = []; const particles = []; const powerups = [];

  function setHpUi() {
    const pct = player ? Math.max(0, Math.min(1, player.hp / player.maxHp)) : 0;
    hpFill.style.width = (pct * 100).toFixed(0) + '%';
    hpFill.style.background = pct > 0.5 ? 'linear-gradient(90deg,#4cd964,#9be15a)' : pct > 0.25 ? 'linear-gradient(90deg,#ffcb3b,#ffd86b)' : 'linear-gradient(90deg,#ff5577,#ff88aa)';
  }
  function setUi() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    setHpUi();
  }

  function startGame() {
    initAudio();
    started = true; gameOver = false; paused = false;
    score = 0; level = 1; lastSpawn = 0; timeSinceStart = 0; perf = 0;
    levelTransitionPending = false; levelTransitionDone = false; levelMsgTimer = 0;
<<<<<<< HEAD
=======
    scorePosted = false;
>>>>>>> bbc2850 (fic)
    bgOffset = 0;
    player = new Player();
    enemies.length = 0; bullets.length = 0; particles.length = 0; powerups.length = 0;
    // resetStars(); // not used with image background
    overlay.classList.remove('visible');
    overlay.classList.add('hidden');
    gameOverEl.classList.add('hidden');
    setUi();
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }
  function endGame() {
    gameOver = true;
    finalScoreEl.textContent = String(score);
    gameOverEl.classList.remove('hidden');
    // Submit score to backend once
    if (!scorePosted) {
      scorePosted = true;
      postScore(score).catch(() => {});
    }
  }

  startBtn?.addEventListener('click', startGame);
  restartBtn?.addEventListener('click', startGame);

  // Spawning
  let lastSpawn = 0; let timeSinceStart = 0;
  function doSpawns(dt) {
    lastSpawn += dt; timeSinceStart += dt;
    const baseRate = Math.max(0.35, 1.2 - level * 0.08);
    if (lastSpawn > baseRate) {
      lastSpawn = 0;
      const lanes = 6;
      const x = (Math.floor(Math.random() * lanes) + 0.5) * (vw / lanes);
      const r = Math.random();
      let type = 'grunt';
      if (r > 0.75) type = 'shooter';
      if (r > 0.93) type = 'elite';
      enemies.push(new Enemy(x, -30, type));
    }
    // Level 1 -> Level 2 transition trigger after 15s
    if (level === 1 && !levelTransitionPending && !levelTransitionDone && timeSinceStart >= 15) {
      levelTransitionPending = true;
      levelMsgTimer = 5; // show message for 5 seconds
    }
  }

  // Power-up pickup effects
  function applyPowerUp(kind) {
    switch (kind) {
      case 'rapid':
        player.rapid = Math.min(12, player.rapid + 6);
        playBeep(880, 0.08, 'sine', 0.12);
        break;
      case 'spread':
        player.spread = Math.min(2, player.spread + 1);
        playBeep(740, 0.08, 'sine', 0.12);
        break;
      case 'shield':
        player.shield = Math.min(10, player.shield + 6);
        playBeep(520, 0.12, 'triangle', 0.12);
        break;
      case 'repair':
        player.hp = Math.min(player.maxHp, player.hp + 30);
        playBeep(620, 0.08, 'square', 0.12);
        break;
    }
    setHpUi();
  }

  // Loop
  let lastTime = 0; let perf = 0;
  function loop(ts) {
    if (!started) return;
    if (paused) { requestAnimationFrame(loop); return; }
    const dt = Math.min(0.033, (ts - lastTime) / 1000 || 0.016);
    lastTime = ts; perf += dt;

    // Update background scroll (replaces starfield update)
    updateBackground(dt);

    // Spawns
    doSpawns(dt);

    // Update entities
    player?.update(dt);
    for (const e of enemies) e.update(dt);
    for (const b of bullets) b.update(dt);
    for (const p of particles) p.update(dt);
    for (const u of powerups) u.update?.(dt);

    // Collisions
    // Player bullets -> enemies
    for (const b of bullets) if (b.friendly) {
      for (const e of enemies) if (e.alive && aabb(b, e)) { e.hit(b.damage); b.alive = false; break; }
    }
    // Enemy bullets -> player
    for (const b of bullets) if (!b.friendly && player && aabb(b, player)) { b.alive = false; player.damage(10); }
    // Enemies -> player
    for (const e of enemies) if (player && e.alive && aabb(e, player)) { e.alive = false; player.damage(20); spawnExplosion(e.x, e.y, 12, '#ff9955'); }
    // Power-ups -> player
    for (const u of powerups) if (player && aabb(u, player)) { u.alive = false; applyPowerUp(u.kind); }

    // Handle level transition timing
    if (levelTransitionPending) {
      levelMsgTimer -= dt;
      if (levelMsgTimer <= 0) {
        levelTransitionPending = false;
        levelTransitionDone = true;
        level = 2; // advance to level 2 after the message
      }
    }

    // Cleanup
    cleanup(enemies); cleanup(bullets); cleanup(particles); cleanup(powerups);

    // Draw
    ctx.clearRect(0, 0, vw, vh);
    drawBackground();
    for (const u of powerups) u.draw();
    for (const e of enemies) e.draw();
    for (const b of bullets) b.draw();
    player?.draw();
    for (const p of particles) p.draw();

    // Level message overlay (top)
    if (levelTransitionPending) {
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.font = 'bold 28px Rajdhani, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 12;
      ctx.fillText('Level 1 complete!', vw / 2, 48);
      ctx.restore();
    }

    // UI update
    setUi();

    if (!gameOver) requestAnimationFrame(loop);
  }

  function cleanup(arr) { for (let i = arr.length - 1; i >= 0; i--) if (!arr[i].alive || arr[i].y < -1000 || arr[i].y > vh + 1000) arr.splice(i, 1); }

  // Scrolling background (image-based)
  let bgOffset = 0;
  function getBgDrawHeight() {
    const img = currentBgImg();
    if (!img || !img.complete || !img.naturalWidth) return vh;
    const scale = vw / img.naturalWidth;
    return img.naturalHeight * scale;
  }
  function updateBackground(dt) {
    const speed = 60 + level * 15;
    bgOffset = (bgOffset + speed * dt) % Math.max(1, getBgDrawHeight());
  }

  function drawBackground() {
    const img = currentBgImg();
    if (img && img.complete && img.naturalWidth) {
      const scale = vw / img.naturalWidth;
      const drawH = img.naturalHeight * scale;
      let y = -bgOffset;
      while (y < vh) {
        ctx.drawImage(img, 0, Math.floor(y), Math.floor(vw), Math.floor(drawH));
        y += drawH;
      }
    } else {
      // Fallback solid color until image loads
      ctx.fillStyle = '#050a18';
      ctx.fillRect(0, 0, vw, vh);
    }
  }

  // Initial splash
  overlay.classList.remove('hidden');
  gameOverEl.classList.add('hidden');
  setUi();
})();
