class RendererUI {
    constructor() {
        this.leaderboardModal = document.getElementById('leaderboard-modal');
        this.leaderboardListEl = document.getElementById('leaderboard-list');
        this.leaderboardMeEl = document.getElementById('leaderboard-me');
        this.leaderboardCloseBtn = document.getElementById('leaderboard-close-btn');

        this._lastStreak = 0;
        this._streakAnimTimeoutId = null;
    }

    updateUI(state) {
        const scoreValueEl = document.getElementById('score-value');
        const bestScoreEl = document.getElementById('best-score');
        const bestRankEl = document.getElementById('best-rank');
        const bestHintEl = document.getElementById('best-hint');
        const streakFillEl = document.getElementById('streak-fill');
        const streakTextEl = document.getElementById('streak-text');
        const streakProgressEl = document.getElementById('streak-progress');
        const slowdownBtn = document.getElementById('slowdown-btn');
        const soundBtn = document.getElementById('sound-btn');

        const score = Math.floor(state?.score ?? 0);
        const best = Math.floor(state?.bestScore ?? 0);
        const streak = Math.max(0, Math.min(50, Math.floor(state?.streakPoints ?? state?.dangerPassedStreak ?? 0)));
        const rank = typeof state?.leaderboardRank === 'number' ? state.leaderboardRank : null;

        if (scoreValueEl) scoreValueEl.textContent = score;
        if (bestScoreEl) bestScoreEl.textContent = best;
        if (bestRankEl) {
            bestRankEl.textContent = rank && rank > 0 ? `#${rank}` : '#—';
        }

        if (bestHintEl) {
            const iconBox = bestHintEl.querySelector('.hud-chip-icon-large');
            if (iconBox) {
                const h = Math.round(iconBox.getBoundingClientRect().height || 0);
                if (h > 0) {
                    const px = `${h}px`;
                    iconBox.style.width = px;
                    iconBox.style.minWidth = px;
                    iconBox.style.maxWidth = px;
                    iconBox.style.flexBasis = px;
                }
            }
        }

        if (streakFillEl) {
            streakFillEl.style.width = `${(streak / 50) * 100}%`;
            const fillRadius = Math.min(streak, 8);
            streakFillEl.style.setProperty('--streak-fill-radius', `${fillRadius}px`);
        }
        if (streakTextEl) {
            streakTextEl.textContent = `${streak}/50`;
        }

        if (streakProgressEl) {
            const prev = this._lastStreak ?? 0;
            if (streak > prev) {
                streakProgressEl.classList.remove('streak-loss');
                streakProgressEl.classList.add('streak-hit');
                if (this._streakAnimTimeoutId) {
                    window.clearTimeout(this._streakAnimTimeoutId);
                }
                this._streakAnimTimeoutId = window.setTimeout(() => {
                    streakProgressEl.classList.remove('streak-hit');
                }, 220);
            } else if (streak < prev) {
                streakProgressEl.classList.remove('streak-hit');
                streakProgressEl.classList.add('streak-loss');
                if (this._streakAnimTimeoutId) {
                    window.clearTimeout(this._streakAnimTimeoutId);
                }
                this._streakAnimTimeoutId = window.setTimeout(() => {
                    streakProgressEl.classList.remove('streak-loss');
                }, 280);
            }
            this._lastStreak = streak;
        }

        if (slowdownBtn) {
            const canUse = state?.gameStatus === 'RUNNING' && streak >= 10;
            slowdownBtn.disabled = !canUse;
            slowdownBtn.classList.toggle('ready', canUse);
        }

        if (soundBtn) {
            const icon = soundBtn.querySelector('img');
            if (icon) {
                icon.src = state?.soundMuted ? 'img/ui/sound-off.svg' : 'img/ui/sound-on.svg';
            }
            soundBtn.classList.toggle('is-muted', !!state?.soundMuted);
        }
    }

    showPauseScreen() {
        const pauseScreen = document.getElementById('pause-screen');
        if (pauseScreen) pauseScreen.classList.remove('hidden');
    }

    hidePauseScreen() {
        const pauseScreen = document.getElementById('pause-screen');
        if (pauseScreen) pauseScreen.classList.add('hidden');
    }

    isLeaderboardModalOpen() {
        return !!(this.leaderboardModal && !this.leaderboardModal.classList.contains('hidden'));
    }

    showLeaderboardModal() {
        if (!this.leaderboardModal) return;
        this.leaderboardModal.classList.remove('hidden');
    }

    hideLeaderboardModal() {
        if (!this.leaderboardModal) return;
        this.leaderboardModal.classList.add('hidden');
    }

    _lbGetName(p) {
        return p?.name || p?.nickname || p?.publicName || p?.username || p?.login || p?.id || 'Player';
    }

    _lbGetScore(p) {
        const v =
            (typeof p?.score === 'number' ? p.score : null) ??
            (typeof p?.data?.score === 'number' ? p.data.score : null) ??
            (typeof p?.fields?.score === 'number' ? p.fields.score : null) ??
            (typeof p?.player?.score === 'number' ? p.player.score : null) ??
            0;
        return Math.max(0, Math.floor(Number(v) || 0));
    }

    _lbGetRank(p, fallbackRank) {
        const r =
            (typeof p?.rank === 'number' ? p.rank : null) ??
            (typeof p?.place === 'number' ? p.place : null) ??
            (typeof p?.position === 'number' ? p.position : null) ??
            (typeof p?.rating === 'number' ? p.rating : null) ??
            fallbackRank;
        return Math.max(1, Math.floor(Number(r) || fallbackRank || 1));
    }

    _lbMakeRow({ rank, name, score, isMe = false }) {
        const row = document.createElement('div');
        row.className = `leaderboard-row${isMe ? ' leaderboard-row--me' : ''}`;
        row.setAttribute('role', 'row');

        const cRank = document.createElement('div');
        cRank.className = 'lb-col lb-col--rank';
        cRank.setAttribute('role', 'cell');
        cRank.textContent = String(rank);

        const cName = document.createElement('div');
        cName.className = 'lb-col lb-col--name';
        cName.setAttribute('role', 'cell');
        cName.textContent = String(name || '');

        const cScore = document.createElement('div');
        cScore.className = 'lb-col lb-col--score';
        cScore.setAttribute('role', 'cell');
        cScore.textContent = String(score);

        row.appendChild(cRank);
        row.appendChild(cName);
        row.appendChild(cScore);
        return row;
    }

    renderLeaderboardModal(data) {
        if (!this.leaderboardListEl || !this.leaderboardMeEl) return;

        const topPlayers = Array.isArray(data?.topPlayers) ? data.topPlayers : [];
        const me = data?.player || null;
        const error = data?.error || null;
        const overrideName = data?.playerName || null;
        const nameHintSeen = !!data?.nameHintSeen;

        this.leaderboardListEl.innerHTML = '';
        this.leaderboardMeEl.innerHTML = '';

        if (error) {
            const msg = document.createElement('div');
            msg.className = 'leaderboard-empty';
            msg.textContent = 'Leaderboard unavailable';
            this.leaderboardListEl.appendChild(msg);
        } else if (topPlayers.length === 0) {
            const msg = document.createElement('div');
            msg.className = 'leaderboard-empty';
            msg.textContent = 'No results yet';
            this.leaderboardListEl.appendChild(msg);
        } else {
            topPlayers.slice(0, 10).forEach((p, idx) => {
                const rank = this._lbGetRank(p, idx + 1);
                const name = this._lbGetName(p);
                const score = this._lbGetScore(p);
                this.leaderboardListEl.appendChild(this._lbMakeRow({ rank, name, score, isMe: false }));
            });
        }

        if (me) {
            const rank = this._lbGetRank(me, 0);
            const name = overrideName || this._lbGetName(me);
            const score = this._lbGetScore(me);
            this.leaderboardMeEl.appendChild(this._lbMakeRow({ rank, name, score, isMe: true }));
        } else {
            const msg = document.createElement('div');
            msg.className = 'leaderboard-empty';
            msg.textContent = 'Your position is not available yet';
            this.leaderboardMeEl.appendChild(msg);
        }

        const hintEl = document.getElementById('leaderboard-name-hint');
        if (hintEl) {
            if (!nameHintSeen) {
                hintEl.textContent = 'We gave you a name. You can change it anytime.';
            } else if (overrideName) {
                hintEl.textContent = `Your name is ${overrideName}. You can change it anytime.`;
            } else {
                hintEl.textContent = 'You can change your name anytime.';
            }
        }
    }

    showGameOverScreen(score, canContinue) {
        const gameOverScreen = document.getElementById('game-over-screen');
        const finalScoreEl = document.getElementById('final-score');
        const continueBtn = document.getElementById('continue-btn');

        if (gameOverScreen) gameOverScreen.classList.remove('hidden');
        if (finalScoreEl) finalScoreEl.textContent = `Score: ${Math.floor(score)}`;
        if (continueBtn) continueBtn.disabled = !canContinue;
    }

    hideGameOverScreen() {
        const gameOverScreen = document.getElementById('game-over-screen');
        if (gameOverScreen) gameOverScreen.classList.add('hidden');
    }

    async showCountdown() {
        const countdownOverlay = document.getElementById('countdown-overlay');
        const countdownText = document.getElementById('countdown-text');
        if (!countdownOverlay || !countdownText) return;

        countdownOverlay.classList.remove('hidden');
        for (let i = 3; i > 0; i--) {
            countdownText.textContent = i;
            countdownText.style.animation = 'none';
            setTimeout(() => {
                countdownText.style.animation = 'countdownPulse 0.1s ease-in-out';
            }, 10);
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        countdownText.textContent = 'GO!';
        await new Promise((resolve) => setTimeout(resolve, 50));
        countdownOverlay.classList.add('hidden');
    }

    showStartScreen() {
        const startScreen = document.getElementById('start-screen');
        if (startScreen) startScreen.classList.remove('hidden');
    }

    hideStartScreen() {
        const startScreen = document.getElementById('start-screen');
        if (startScreen) startScreen.classList.add('hidden');
    }
}
