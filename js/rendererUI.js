class RendererUI {
    constructor() {
        this.leaderboardModal = document.getElementById('leaderboard-modal');
        this.leaderboardListEl = document.getElementById('leaderboard-list');
        this.leaderboardTableBody = document.getElementById('leaderboard-table-body');
        this.leaderboardMeEl = document.getElementById('leaderboard-me');
        this.leaderboardCloseBtn = document.getElementById('leaderboard-close-btn');

        this._lastStreak = 0;
        this._boundUpdateLeaderboardFade = this._updateLeaderboardFadeOverlays.bind(this);
        if (this.leaderboardListEl && this.leaderboardTableBody) {
            this.leaderboardListEl.addEventListener('scroll', this._boundUpdateLeaderboardFade, { passive: true });
        }
        this._streakAnimTimeoutId = null;
    }

    updateUI(state) {
        const scoreValueEl = document.getElementById('score-value');
        const bestScoreEl = document.getElementById('best-score');
        const bestRankEl = document.getElementById('best-rank');
        const bestHintEl = document.getElementById('best-hint');
        const streakProgressEl = document.getElementById('streak-progress');
        const coinRushCounterEl = document.getElementById('coin-rush-counter');
        const coinRushSegments = streakProgressEl?.querySelectorAll('.coin-rush-segment-fill') || [];
        const coinRushButton = document.getElementById('coin-rush-button');
        const slowdownBtn = document.getElementById('slowdown-btn');
        const soundBtn = document.getElementById('sound-btn');

        const score = Math.floor(state?.score ?? 0);
        const best = Math.floor(state?.bestScore ?? 0);
        const streak = Math.max(0, Math.min(20, Math.floor(state?.streakPoints ?? state?.dangerPassedStreak ?? 0)));
        const rank = typeof state?.leaderboardRank === 'number' ? state.leaderboardRank : null;

        if (scoreValueEl) scoreValueEl.textContent = score;
        if (bestScoreEl) bestScoreEl.textContent = best;
        if (bestRankEl) {
            bestRankEl.textContent = rank && rank > 0 ? `#${rank}` : '#—';
        }

        if (coinRushCounterEl) {
            coinRushCounterEl.textContent = `${streak}/20`;
        }
        coinRushSegments.forEach((fillEl, i) => {
            const segmentStart = i * 10;
            const segmentEnd = (i + 1) * 10;
            const fillPct = streak <= segmentStart ? 0 : Math.min(100, ((streak - segmentStart) / 10) * 100);
            if (fillEl) fillEl.style.width = `${fillPct}%`;
        });

        if (streakProgressEl) {
            const prev = this._lastStreak ?? 0;
            if (streak >= 20) {
                streakProgressEl.classList.add('coin-rush-filled');
                if (prev < 20) {
                    if (this._streakAnimTimeoutId) window.clearTimeout(this._streakAnimTimeoutId);
                    this._streakAnimTimeoutId = window.setTimeout(() => {
                        streakProgressEl.classList.add('coin-rush-ready');
                        if (coinRushButton) coinRushButton.classList.remove('hidden');
                    }, 400);
                }
            } else {
                streakProgressEl.classList.remove('coin-rush-filled', 'coin-rush-ready');
                if (coinRushButton) coinRushButton.classList.add('hidden');
                if (this._streakAnimTimeoutId) {
                    window.clearTimeout(this._streakAnimTimeoutId);
                    this._streakAnimTimeoutId = null;
                }
            }
            this._lastStreak = streak;
        }

        const slowSpellCount = Math.max(0, state?.slowSpellCount ?? 1);
        const shieldSpellCount = Math.max(0, state?.shieldSpellCount ?? 1);

        if (slowdownBtn) {
            const canUse = state?.gameStatus === 'RUNNING' && streak >= 10 && slowSpellCount > 0;
            slowdownBtn.disabled = !canUse;
            slowdownBtn.classList.toggle('ready', canUse);
        }

        const slowWrap = document.getElementById('slow-btn-wrap');
        const shieldWrap = document.getElementById('shield-btn-wrap');
        const shieldBtn = document.getElementById('shield-btn');
        const slowCountEl = slowWrap?.querySelector('.action-spell-count');
        const shieldCountEl = shieldWrap?.querySelector('.action-spell-count');

        if (slowWrap) {
            slowWrap.classList.toggle('depleted', slowSpellCount <= 0);
        }
        if (shieldWrap) {
            shieldWrap.classList.toggle('depleted', shieldSpellCount <= 0);
        }
        if (slowCountEl) {
            slowCountEl.textContent = `x${slowSpellCount}`;
            slowCountEl.dataset.count = String(slowSpellCount);
        }
        if (shieldCountEl) {
            shieldCountEl.textContent = `x${shieldSpellCount}`;
            shieldCountEl.dataset.count = String(shieldSpellCount);
        }
        if (shieldBtn) {
            shieldBtn.disabled = !(state?.gameStatus === 'RUNNING' && shieldSpellCount > 0);
        }

        const perksCoinsEl = document.getElementById('perks-coins-count');
        if (perksCoinsEl) {
            perksCoinsEl.textContent = Math.max(0, state?.coins ?? 0);
        }

        if (soundBtn) {
            const icon = soundBtn.querySelector('img');
            if (icon) {
                icon.src = state?.soundMuted ? 'img/ui/sound-off.svg' : 'img/ui/sound-on.svg';
            }
            soundBtn.classList.toggle('is-muted', !!state?.soundMuted);
        }

        const pauseSoundIcon = document.getElementById('pause-sound-icon');
        const pauseSoundText = document.getElementById('pause-sound-text');
        if (pauseSoundIcon) {
            pauseSoundIcon.src = state?.soundMuted ? 'img/ui/sound-off.svg' : 'img/ui/sound-on.svg';
        }
        if (pauseSoundText) {
            pauseSoundText.textContent = state?.soundMuted ? 'SOUND: OFF' : 'SOUND: ON';
        }
    }

    showPauseScreen() {
        const pauseScreen = document.getElementById('pause-screen');
        if (pauseScreen) pauseScreen.classList.remove('hidden');
    }

    hidePauseScreen() {
        const pauseScreen = document.getElementById('pause-screen');
        const languageScreen = document.getElementById('language-screen');
        if (pauseScreen) pauseScreen.classList.add('hidden');
        if (languageScreen) languageScreen.classList.add('hidden');
    }

    showLanguageScreen() {
        const pauseScreen = document.getElementById('pause-screen');
        const languageScreen = document.getElementById('language-screen');
        if (pauseScreen) pauseScreen.classList.add('hidden');
        if (languageScreen) languageScreen.classList.remove('hidden');
    }

    hideLanguageScreen() {
        const pauseScreen = document.getElementById('pause-screen');
        const languageScreen = document.getElementById('language-screen');
        if (languageScreen) languageScreen.classList.add('hidden');
        if (pauseScreen) pauseScreen.classList.remove('hidden');
    }

    isLeaderboardModalOpen() {
        return !!(this.leaderboardModal && !this.leaderboardModal.classList.contains('hidden'));
    }

    showLeaderboardModal() {
        if (!this.leaderboardModal) return;
        this.leaderboardModal.classList.remove('hidden');
        requestAnimationFrame(() => this._updateLeaderboardFadeOverlays());
    }

    _updateLeaderboardFadeOverlays() {
        const body = this.leaderboardTableBody;
        const list = this.leaderboardListEl;
        if (!body || !list) return;
        const { scrollTop, clientHeight, scrollHeight } = list;
        const atTop = scrollTop <= 0;
        const atBottom = scrollHeight <= clientHeight || scrollTop + clientHeight >= scrollHeight - 1;
        body.classList.toggle('scrolled-from-top', !atTop);
        body.classList.toggle('scrolled-to-bottom', atBottom);
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
        if (isMe) {
            cName.innerHTML = '';
            const nameSpan = document.createElement('span');
            nameSpan.textContent = String(name || '');
            const youSpan = document.createElement('span');
            youSpan.className = 'lb-you';
            youSpan.textContent = ' (You)';
            const penImg = document.createElement('img');
            penImg.src = 'img/ui/pen.svg';
            penImg.alt = '';
            penImg.className = 'lb-pen-icon';
            penImg.setAttribute('aria-hidden', 'true');
            cName.appendChild(nameSpan);
            cName.appendChild(youSpan);
            cName.appendChild(penImg);
        } else {
            cName.textContent = String(name || '');
        }

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

        requestAnimationFrame(() => this._updateLeaderboardFadeOverlays());
    }

    showGameOverScreen(score, bestScore = 0, coins = 0) {
        const gameOverScreen = document.getElementById('game-over-screen');
        const finalScoreEl = document.getElementById('final-score');
        const finalBestScoreEl = document.getElementById('final-best-score');
        const finalCoinsEl = document.getElementById('final-coins');

        if (gameOverScreen) gameOverScreen.classList.remove('hidden');
        if (finalScoreEl) finalScoreEl.textContent = Math.floor(score);
        if (finalBestScoreEl) finalBestScoreEl.textContent = Math.floor(bestScore);
        if (finalCoinsEl) finalCoinsEl.textContent = Math.floor(coins);
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

    updateStartGameScreen(state) {
        const coinsEl = document.getElementById('start-game-coins-count');
        const slowCountEl = document.getElementById('start-slow-count');
        const shieldCountEl = document.getElementById('start-shield-count');
        const buySlowBtn = document.querySelector('.start-buy-btn[data-spell="slow"]');
        const buyShieldBtn = document.querySelector('.start-buy-btn[data-spell="shield"]');
        const coins = Math.max(0, state?.coins ?? 0);

        if (coinsEl) coinsEl.textContent = coins;
        if (slowCountEl) slowCountEl.textContent = Math.max(0, state?.slowSpellCount ?? 1);
        if (shieldCountEl) shieldCountEl.textContent = Math.max(0, state?.shieldSpellCount ?? 1);
        if (buySlowBtn) buySlowBtn.disabled = coins < 10;
        if (buyShieldBtn) buyShieldBtn.disabled = coins < 5;
    }

    hideStartScreen() {
        const startScreen = document.getElementById('start-screen');
        if (startScreen) startScreen.classList.add('hidden');
    }
}
