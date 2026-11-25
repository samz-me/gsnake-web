/* GSNAKE — Phaser 3 base build.
 * Mechanics ported 1:1 from the Godot 4 / C# project (scripts/SnakeSim.cs + scripts/GameBalance.cs)
 * so the web entry plays like the phone build: 12x17 grid, walls kill, combo ramp, telegraphed rocks,
 * speed-up per point. Portrait 720x1280, touch + keyboard, no external assets (everything is drawn).
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- balance (mirrors GameBalance.cs)
  const COLS = 12;
  const ROWS = 17;
  const CELL = 60;                       // 720 / 12
  const BOARD_X = 0;
  const BOARD_Y = 140;                   // HUD above the board
  const BOARD_W = COLS * CELL;
  const BOARD_H = ROWS * CELL;           // 1020 -> board ends at y 1160
  const W = 720;
  const H = 1280;

  const BAL = {
    moveStart: 0.19,
    moveFloor: 0.085,
    actIMin: 0.16,
    actII: 8,                            // score at which rocks start
    actIII: 20,
    scoreScale: 0.0025,
    comboWindow: 4.5,
    comboMax: 5,
    maxRocks: 10,
    rockWarnTicks: 2,
    rockMinHeadDist: 3,
    swipeMin: 30,
  };

  const C = {
    bg: 0x070b12,
    board: 0x131c2b,
    grid: 0x1b2740,
    frame: 0x2a3a55,
    head: 0xf6f0dd,
    bodyA: 0x9ad9ff,
    bodyB: 0x4b9fd6,
    eye: 0x0b1220,
    food: 0xe0453a,
    foodHi: 0xff7a63,
    leaf: 0x63b75c,
    rock: 0x46536b,
    rockHi: 0x5f7091,
    warn: 0xffb347,
    danger: 0xff5470,
    text: 0xf6f0dd,
    dim: 0x7b8aa5,
  };

  const moveIntervalForScore = (score) => {
    const raw = BAL.moveStart - score * BAL.scoreScale;
    const floor = score < BAL.actII ? BAL.actIMin : BAL.moveFloor;
    return Math.max(floor, raw);
  };

  const rockTargetForScore = (score) => {
    if (score < BAL.actII) return 0;
    if (score < BAL.actIII) return 1 + Math.floor((score - BAL.actII) / 4);
    return Math.min(BAL.maxRocks, 4 + Math.floor((score - BAL.actIII) / 2));
  };

  const cellToPx = (cx, cy) => ({
    x: BOARD_X + cx * CELL + CELL / 2,
    y: BOARD_Y + cy * CELL + CELL / 2,
  });

  const lerpColor = (a, b, t) => {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return ((Math.round(ar + (br - ar) * t) << 16) |
            (Math.round(ag + (bg - ag) * t) << 8) |
            Math.round(ab + (bb - ab) * t));
  };

  const DIR = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  // ---------------------------------------------------------------- scene
  class GSGame extends Phaser.Scene {
    constructor() {
      super('gs');
    }

    create() {
      this.g = this.add.graphics();
      this.shakeT = 0;

      this.scoreText = this.add.text(36, 44, '0', {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: '64px', color: '#f6f0dd', fontStyle: 'bold',
      }).setOrigin(0, 0.5);

      this.scoreLabel = this.add.text(38, 88, 'SCORE', {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: '22px', color: '#7b8aa5', letterSpacing: 4,
      }).setOrigin(0, 0.5);

      this.comboText = this.add.text(W - 36, 60, '', {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: '34px', color: '#9ad9ff', fontStyle: 'bold',
      }).setOrigin(1, 0.5);

      this.lenText = this.add.text(38, BOARD_Y + BOARD_H + 34, '', {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: '22px', color: '#4d5a72', letterSpacing: 3,
      }).setOrigin(0, 0.5);

      this.hintText = this.add.text(W / 2, H - 44, 'SWIPE TO TURN', {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: '24px', color: '#4d5a72', letterSpacing: 3,
      }).setOrigin(0.5, 0.5);

      this.startText = this.add.text(W / 2, BOARD_Y + BOARD_H * 0.5, 'TAP TO START', {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: '34px', color: '#9ad9ff', letterSpacing: 4,
      }).setOrigin(0.5).setAlpha(0.9);

      this.overlay = this.add.container(0, 0).setVisible(false);
      const ovBg = this.add.rectangle(0, BOARD_Y, W, BOARD_H, 0x070b12, 0.86).setOrigin(0, 0);
      this.ovTitle = this.add.text(W / 2, BOARD_Y + BOARD_H * 0.34, 'GAME OVER', {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: '52px', color: '#ff5470', fontStyle: 'bold',
      }).setOrigin(0.5);
      this.ovReason = this.add.text(W / 2, BOARD_Y + BOARD_H * 0.34 + 56, '', {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: '26px', color: '#7b8aa5',
      }).setOrigin(0.5);
      this.ovScore = this.add.text(W / 2, BOARD_Y + BOARD_H * 0.34 + 126, '', {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: '40px', color: '#f6f0dd', fontStyle: 'bold',
      }).setOrigin(0.5);
      this.ovTap = this.add.text(W / 2, BOARD_Y + BOARD_H * 0.34 + 210, 'TAP TO RESTART', {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: '26px', color: '#9ad9ff', letterSpacing: 2,
      }).setOrigin(0.5);
      this.overlay.add([ovBg, this.ovTitle, this.ovReason, this.ovScore, this.ovTap]);

      this.bindInput();
      this.reset();
      this.exposeDebugApi();
    }

    // ------------------------------------------------------------ state
    reset() {
      const midY = Math.floor(ROWS / 2);
      this.cells = [
        { x: 5, y: midY }, { x: 4, y: midY }, { x: 3, y: midY },
      ];
      this.prevCells = this.cells.map((c) => ({ ...c }));
      this.dir = { ...DIR.right };
      this.queued = [];
      this.score = 0;
      this.combo = 1;
      this.sinceEat = 99;
      this.rocks = [];
      this.warnRocks = [];          // [{cell, ticks}]
      this.alive = true;
      this.started = false;       // first tap/swipe starts the run, so nobody dies at page load
      this.interval = BAL.moveStart;
      this.tickAcc = 0;
      this.deaths = 0;
      this.spawnFood();
      this.overlay.setVisible(false);
      this.hintText.setVisible(false);
      this.startText.setVisible(true);
      this.syncHud();
    }

    exposeDebugApi() {
      // Read-only-ish hooks so a headless run (or an agent) can verify the sim without pixels.
      window.__gsnake = {
        state: () => ({
          alive: this.alive,
          started: this.started,
          score: this.score,
          combo: this.combo,
          length: this.cells.length,
          interval: Number(this.interval.toFixed(4)),
          head: { ...this.cells[0] },
          dir: { ...this.dir },
          food: { ...this.food },
          rocks: this.rocks.map((c) => ({ ...c })),
          warn: this.warnRocks.map((w) => ({ ...w.cell, ticks: w.ticks })),
          deaths: this.deaths,
        }),
        press: (d) => this.requestDir(d),
        step: (n = 1) => {
          for (let i = 0; i < n && this.alive; i++) this.stepOnce();
          return this.alive;
        },
        restart: () => this.reset(),
        start: () => this.startRun(),
        kill: () => this.die('debug'),
        scene: () => this,
      };
    }

    bindInput() {
      this.input.on('pointerdown', (p) => {
        if (this.alive && !this.started) { this.startRun(); return; }
        this.pStart = { x: p.x, y: p.y, t: this.time.now };
      });
      this.input.on('pointerup', (p) => {
        const s = this.pStart;
        this.pStart = null;
        if (!s) return;
        const dx = p.x - s.x;
        const dy = p.y - s.y;
        const dist = Math.hypot(dx, dy);
        if (dist < BAL.swipeMin) {
          if (!this.alive) this.reset();
          return;
        }
        if (Math.abs(dx) > Math.abs(dy)) this.requestDir(dx > 0 ? 'right' : 'left');
        else this.requestDir(dy > 0 ? 'down' : 'up');
      });

      const kb = this.input.keyboard;
      if (kb) {
        kb.on('keydown', (e) => {
          const map = {
            ArrowUp: 'up', KeyW: 'up',
            ArrowDown: 'down', KeyS: 'down',
            ArrowLeft: 'left', KeyA: 'left',
            ArrowRight: 'right', KeyD: 'right',
          };
          if (map[e.code]) {
            e.preventDefault();
            this.requestDir(map[e.code]);
          } else if (e.code === 'Space' || e.code === 'Enter') {
            e.preventDefault();
            if (!this.alive) this.reset();
          }
        });
      }
    }

    requestDir(name) {
      const d = DIR[name];
      if (!d) return;
      const last = this.queued.length ? this.queued[this.queued.length - 1] : this.dir;
      if (d.x + last.x === 0 && d.y + last.y === 0) return;   // no 180s
      if (d.x === last.x && d.y === last.y) return;
      if (this.queued.length < 2) this.queued.push(d);
      if (!this.started) this.startRun();
      this.hintText.setVisible(true);
    }

    // ------------------------------------------------------------ sim
    spawnFood() {
      const free = [];
      for (let x = 0; x < COLS; x++) {
        for (let y = 0; y < ROWS; y++) {
          if (this.cells.some((c) => c.x === x && c.y === y)) continue;
          if (this.rocks.some((c) => c.x === x && c.y === y)) continue;
          if (this.warnRocks.some((w) => w.cell.x === x && w.cell.y === y)) continue;
          free.push({ x, y });
        }
      }
      if (!free.length) return false;
      this.food = free[Math.floor(Math.random() * free.length)];
      return true;
    }

    scheduleRock() {
      const head = this.cells[0];
      const cand = [];
      for (let x = 0; x < COLS; x++) {
        for (let y = 0; y < ROWS; y++) {
          if (this.cells.some((c) => c.x === x && c.y === y)) continue;
          if (this.rocks.some((c) => c.x === x && c.y === y)) continue;
          if (this.warnRocks.some((w) => w.cell.x === x && w.cell.y === y)) continue;
          if (this.food && this.food.x === x && this.food.y === y) continue;
          if (Math.abs(x - head.x) + Math.abs(y - head.y) < BAL.rockMinHeadDist) continue;
          cand.push({ x, y });
        }
      }
      if (!cand.length) return false;
      this.warnRocks.push({ cell: cand[Math.floor(Math.random() * cand.length)], ticks: BAL.rockWarnTicks });
      return true;
    }

    advanceWarnRocks() {
      const next = [];
      for (const w of this.warnRocks) {
        w.ticks -= 1;
        if (w.ticks <= 0) this.rocks.push(w.cell);
        else next.push(w);
      }
      this.warnRocks = next;
    }

    stepOnce() {
      if (!this.alive) return;

      this.sinceEat += this.interval;
      if (this.queued.length) this.dir = this.queued.shift();

      const head = this.cells[0];
      const nx = head.x + this.dir.x;
      const ny = head.y + this.dir.y;

      this.prevCells = this.cells.map((c) => ({ ...c }));

      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
        this.die('WALL');
        return;
      }
      if (this.rocks.some((r) => r.x === nx && r.y === ny)) {
        this.die('ROCK');
        return;
      }
      // Self hit (tail cell frees this tick when not eating)
      const eats = this.food && nx === this.food.x && ny === this.food.y;
      const body = eats ? this.cells : this.cells.slice(0, -1);
      if (body.some((c) => c.x === nx && c.y === ny)) {
        this.die('TAIL');
        return;
      }

      this.cells.unshift({ x: nx, y: ny });
      if (eats) {
        this.combo = this.sinceEat < BAL.comboWindow ? Math.min(this.combo + 1, BAL.comboMax) : 1;
        this.score += this.combo;
        this.sinceEat = 0;
        this.interval = moveIntervalForScore(this.score);
        this.punch = 1;

        const target = rockTargetForScore(this.score);
        let pending = this.rocks.length + this.warnRocks.length;
        while (pending < target) {
          if (!this.scheduleRock()) break;
          pending = this.rocks.length + this.warnRocks.length;
        }
        if (!this.spawnFood()) {
          this.die('PERFECT');
          return;
        }
        this.advanceWarnRocks();          // eat tick also advances the telegraph
      } else {
        this.cells.pop();
        if (this.sinceEat > BAL.comboWindow && this.combo !== 1) this.combo = 1;
        this.advanceWarnRocks();
      }

      this.syncHud();
    }

    startRun() {
      this.started = true;
      this.tickAcc = 0;
      this.startText.setVisible(false);
      this.hintText.setVisible(true);
    }

    die(reason) {
      this.alive = false;
      this.deaths += 1;
      this.hintText.setVisible(false);
      this.ovReason.setText(reason);
      this.ovScore.setText('SCORE ' + this.score + '   LEN ' + this.cells.length);
      this.overlay.setVisible(true);
      this.punch = 1.6;
      this.shakeT = 0.28;
      this.deathCell = { ...this.cells[0] };
    }

    syncHud() {
      this.scoreText.setText(String(this.score));
      this.comboText.setText(this.combo > 1 ? 'x' + this.combo : '');
      const speed = Math.max(0, Math.min(100, Math.round(
        (BAL.moveStart - moveIntervalForScore(this.score)) / (BAL.moveStart - BAL.moveFloor) * 100)));
      this.lenText.setText('LEN ' + this.cells.length + '   SPEED ' + speed + '%');
    }

    // ------------------------------------------------------------ loop
    update(time, delta) {
      const dt = delta / 1000;
      if (this.alive && this.started) {
        this.tickAcc += dt;
        let guard = 0;
        while (this.alive && this.tickAcc >= this.interval && guard++ < 4) {
          this.tickAcc -= this.interval;
          this.stepOnce();
        }
      }

      if (this.punch !== undefined && this.punch > 0) {
        this.punch = Math.max(0, this.punch - dt * 6);
      }

      let sx = 0, sy = 0;
      if (this.shakeT > 0) {
        this.shakeT = Math.max(0, this.shakeT - dt);
        const k = this.shakeT / 0.28;
        sx = (Math.random() - 0.5) * 16 * k;
        sy = (Math.random() - 0.5) * 16 * k;
      }
      this.cameras.main.setScroll(sx, sy);

      this.render(dt, time);
    }

    render(dt, time) {
      const g = this.g;
      g.clear();

      // board
      g.fillStyle(C.board, 1);
      g.fillRoundedRect(BOARD_X + 4, BOARD_Y + 4, BOARD_W - 8, BOARD_H - 8, 18);
      g.lineStyle(2, C.frame, 0.5);
      g.strokeRoundedRect(BOARD_X + 4, BOARD_Y + 4, BOARD_W - 8, BOARD_H - 8, 18);
      g.lineStyle(1, C.grid, 0.55);
      for (let x = 1; x < COLS; x++) {
        g.lineBetween(BOARD_X + x * CELL, BOARD_Y + 10, BOARD_X + x * CELL, BOARD_Y + BOARD_H - 10);
      }
      for (let y = 1; y < ROWS; y++) {
        g.lineBetween(BOARD_X + 10, BOARD_Y + y * CELL, BOARD_W - 10, BOARD_Y + y * CELL);
      }

      // warn rocks (telegraph): pulsing danger outline
      const pulse = 0.5 + 0.5 * Math.sin(time / 90);
      for (const w of this.warnRocks) {
        const p = cellToPx(w.cell.x, w.cell.y);
        const s = CELL * (0.62 + 0.06 * pulse);
        g.lineStyle(3, C.warn, 0.35 + 0.45 * pulse);
        g.strokeRoundedRect(p.x - s / 2, p.y - s / 2, s, s, 10);
        g.fillStyle(C.warn, 0.10 + 0.12 * pulse);
        g.fillRoundedRect(p.x - s / 2, p.y - s / 2, s, s, 10);
      }

      // rocks
      for (const r of this.rocks) {
        const p = cellToPx(r.x, r.y);
        const s = CELL * 0.86;
        g.fillStyle(C.rock, 1);
        g.fillRoundedRect(p.x - s / 2, p.y - s / 2, s, s, 14);
        g.fillStyle(C.rockHi, 0.55);
        g.fillRoundedRect(p.x - s / 2 + 7, p.y - s / 2 + 7, s - 22, s - 30, 9);
      }

      // food
      if (this.food) {
        const p = cellToPx(this.food.x, this.food.y);
        const k = 0.5 + 0.5 * Math.sin(time / 160);
        const r = CELL * (0.24 + 0.02 * k);
        g.fillStyle(C.food, 1);
        g.fillCircle(p.x, p.y, r);
        g.fillStyle(C.foodHi, 0.85);
        g.fillCircle(p.x - r * 0.3, p.y - r * 0.35, r * 0.35);
        g.fillStyle(C.leaf, 1);
        g.fillEllipse(p.x + r * 0.45, p.y - r * 0.95, r * 0.9, r * 0.42);
      }

      // snake (interpolated between ticks)
      const t = this.alive ? Math.min(1, this.tickAcc / this.interval) : 1;
      const n = this.cells.length;
      const punch = this.punch || 0;

      for (let i = n - 1; i >= 0; i--) {
        const a = this.prevCells[i] || this.cells[i];
        const b = this.cells[i];
        const cx = a.x + (b.x - a.x) * t;
        const cy = a.y + (b.y - a.y) * t;
        const p = cellToPx(cx, cy);
        const f = n > 1 ? i / (n - 1) : 0;
        const isHead = i === 0;
        const scale = isHead ? 1 + punch * 0.16 : 1 - f * 0.18;
        const s = CELL * 0.88 * scale;
        const col = isHead ? C.head : lerpColor(C.bodyA, C.bodyB, f);

        g.fillStyle(0x000000, 0.25);
        g.fillRoundedRect(p.x - s / 2 + 3, p.y - s / 2 + 4, s, s, s * 0.32);
        g.fillStyle(col, 1);
        g.fillRoundedRect(p.x - s / 2, p.y - s / 2, s, s, s * 0.32);

        if (isHead) {
          // eyes look along the current heading
          const ex = this.dir.x * s * 0.16;
          const ey = this.dir.y * s * 0.16;
          const spread = s * 0.20;
          g.fillStyle(C.eye, 1);
          if (this.dir.x !== 0) {
            g.fillCircle(p.x + ex, p.y - spread, s * 0.11);
            g.fillCircle(p.x + ex, p.y + spread, s * 0.11);
          } else {
            g.fillCircle(p.x - spread, p.y + ey, s * 0.11);
            g.fillCircle(p.x + spread, p.y + ey, s * 0.11);
          }
        }
      }
    }
  }

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: W,
    height: H,
    backgroundColor: C.bg,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: { activePointers: 2 },
    scene: [GSGame],
  });
})();
