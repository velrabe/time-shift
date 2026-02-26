class RendererUI {
    constructor() {
        this.leaderboardModal = document.getElementById('leaderboard-modal');
        this.leaderboardListEl = document.getElementById('leaderboard-list');
        this.leaderboardTableBody = document.getElementById('leaderboard-table-body');
        this.leaderboardMeEl = document.getElementById('leaderboard-me');
        this.leaderboardCloseBtn = document.getElementById('leaderboard-close-btn');
        this.el = {
            scoreValue: document.getElementById('score-value'),
            bestScore: document.getElementById('best-score'),
            bestRank: document.getElementById('best-rank'),
            streakProgress: document.getElementById('streak-progress'),
            coinRushCounter: document.getElementById('coin-rush-counter'),
            coinRushButton: document.getElementById('coin-rush-button'),
            slowdownBtn: document.getElementById('slowdown-btn'),
            soundBtn: document.getElementById('sound-btn'),
            slowWrap: document.getElementById('slow-btn-wrap'),
            shieldWrap: document.getElementById('shield-btn-wrap'),
            shieldBtn: document.getElementById('shield-btn'),
            perksCoins: document.getElementById('perks-coins-count'),
            pauseSoundIcon: document.getElementById('pause-sound-icon'),
            pauseSoundText: document.getElementById('pause-sound-text')
        };
        this.el.coinRushSegments = this.el.streakProgress?.querySelectorAll('.coin-rush-segment-fill') || [];
        this.el.slowCount = this.el.slowWrap?.querySelector('.action-spell-count') || null;
        this.el.shieldCount = this.el.shieldWrap?.querySelector('.action-spell-count') || null;
        this.el.soundIcon = this.el.soundBtn?.querySelector('img') || null;
        this._lastStreak = 0;
        this._boundUpdateLeaderboardFade = this._updateLeaderboardFadeOverlays.bind(this);
        if (this.leaderboardListEl && this.leaderboardTableBody) {
            this.leaderboardListEl.addEventListener('scroll', this._boundUpdateLeaderboardFade, { passive: true });
        }
        this._streakAnimTimeoutId = null;
        this.perksModal = document.getElementById('perks-modal');
        this.perksGrid = document.getElementById('perks-grid');
        this.perksCloseBtn = document.getElementById('perks-close-btn');
        this._perksBoundClose = null;
        this._perksBoundUpgrade = null;
    }

    updateUI(state) {
        const scoreValueEl = this.el.scoreValue;
        const bestScoreEl = this.el.bestScore;
        const bestRankEl = this.el.bestRank;
        const streakProgressEl = this.el.streakProgress;
        const coinRushCounterEl = this.el.coinRushCounter;
        const coinRushSegments = this.el.coinRushSegments;
        const coinRushButton = this.el.coinRushButton;
        const slowdownBtn = this.el.slowdownBtn;
        const soundBtn = this.el.soundBtn;

        const score = Math.floor(state?.score ?? 0);
        const best = Math.floor(state?.bestScore ?? 0);
        const rushProgress = Math.max(0, Math.floor(state?.coinRushProgress ?? state?.streakPoints ?? 0));
        const rushTarget = Math.max(10, Math.floor(state?.coinRushTarget ?? 20));
        const rushReady = rushProgress >= rushTarget && !state?.coinRushActive;
        const rank = typeof state?.leaderboardRank === 'number' ? state.leaderboardRank : null;
        const slowCooldownSec = Math.ceil(Math.max(0, state?.slowCooldownRemainingMs || 0) / 1000);
        const shieldCooldownSec = Math.ceil(Math.max(0, state?.shieldCooldownRemainingMs || 0) / 1000);

        if (scoreValueEl) {
            const txt = String(score);
            if (scoreValueEl.textContent !== txt) scoreValueEl.textContent = txt;
        }
        if (bestScoreEl) {
            const txt = String(best);
            if (bestScoreEl.textContent !== txt) bestScoreEl.textContent = txt;
        }
        if (bestRankEl) {
            const txt = rank && rank > 0 ? `#${rank}` : '#—';
            if (bestRankEl.textContent !== txt) bestRankEl.textContent = txt;
        }

        if (coinRushCounterEl) {
            const txt = state?.coinRushActive ? 'RUSH!' : `${rushProgress}/${rushTarget}`;
            if (coinRushCounterEl.textContent !== txt) coinRushCounterEl.textContent = txt;
        }
        const segmentCount = Math.max(1, coinRushSegments.length || 1);
        const ratio = Math.max(0, Math.min(1, rushTarget > 0 ? (rushProgress / rushTarget) : 0));
        coinRushSegments.forEach((fillEl, i) => {
            const segmentStart = i / segmentCount;
            const segmentEnd = (i + 1) / segmentCount;
            const local = ratio <= segmentStart ? 0 : Math.min(1, (ratio - segmentStart) / Math.max(0.0001, (segmentEnd - segmentStart)));
            if (!fillEl) return;
            const width = `${(local * 100).toFixed(2)}%`;
            if (fillEl.style.width !== width) fillEl.style.width = width;
        });

        if (streakProgressEl) {
            const prev = this._lastStreak ?? 0;
            // Кнопка показывается только во время активного Coin Rush
            if (state?.coinRushActive) {
                if (coinRushButton) {
                    coinRushButton.classList.remove('hidden');
                    coinRushButton.classList.add('coin-rush-active');
                }
                streakProgressEl.classList.add('coin-rush-filled');
            } else {
                if (coinRushButton) {
                    coinRushButton.classList.add('hidden');
                    coinRushButton.classList.remove('coin-rush-active');
                }
                streakProgressEl.classList.remove('coin-rush-filled', 'coin-rush-ready');
                if (rushReady) {
                    streakProgressEl.classList.add('coin-rush-ready');
                }
            }
            this._lastStreak = rushProgress;
        }

        const slowSpellCount = Math.max(0, state?.slowSpellCount ?? 1);
        const shieldSpellCount = Math.max(0, state?.shieldSpellCount ?? 1);

        if (slowdownBtn) {
            const canUse = state?.gameStatus === 'RUNNING' && slowSpellCount > 0 && slowCooldownSec <= 0;
            slowdownBtn.disabled = !canUse;
            slowdownBtn.classList.toggle('ready', canUse);
            slowdownBtn.title = slowCooldownSec > 0 ? `Slow cooldown: ${slowCooldownSec}s` : 'Slow time';
        }

        const slowWrap = this.el.slowWrap;
        const shieldWrap = this.el.shieldWrap;
        const shieldBtn = this.el.shieldBtn;
        const slowCountEl = this.el.slowCount;
        const shieldCountEl = this.el.shieldCount;

        if (slowWrap) {
            slowWrap.classList.toggle('depleted', slowSpellCount <= 0);
        }
        if (shieldWrap) {
            shieldWrap.classList.toggle('depleted', shieldSpellCount <= 0);
        }
        if (slowCountEl) {
            const txt = `x${slowSpellCount}`;
            if (slowCountEl.textContent !== txt) slowCountEl.textContent = txt;
            slowCountEl.dataset.count = String(slowSpellCount);
        }
        if (shieldCountEl) {
            const txt = `x${shieldSpellCount}`;
            if (shieldCountEl.textContent !== txt) shieldCountEl.textContent = txt;
            shieldCountEl.dataset.count = String(shieldSpellCount);
        }
        if (shieldBtn) {
            const canUseShield = state?.gameStatus === 'RUNNING' && shieldSpellCount > 0 && !state?.shieldActive && shieldCooldownSec <= 0;
            shieldBtn.disabled = !canUseShield;
            shieldBtn.classList.toggle('ready', canUseShield);
            shieldBtn.title = state?.shieldActive
                ? `Shield active (${Math.max(0, state?.shieldHitsRemaining || 0)} hit left)`
                : (shieldCooldownSec > 0 ? `Shield cooldown: ${shieldCooldownSec}s` : 'Shield');
        }

        const perksCoinsEl = this.el.perksCoins;
        if (perksCoinsEl) {
            const txt = String(Math.max(0, state?.coins ?? 0));
            if (perksCoinsEl.textContent !== txt) perksCoinsEl.textContent = txt;
        }

        if (soundBtn) {
            const icon = this.el.soundIcon;
            if (icon) {
                const src = state?.soundMuted ? 'img/ui/sound-off.svg' : 'img/ui/sound-on.svg';
                if (icon.getAttribute('src') !== src) icon.src = src;
            }
            soundBtn.classList.toggle('is-muted', !!state?.soundMuted);
        }

        const pauseSoundIcon = this.el.pauseSoundIcon;
        const pauseSoundText = this.el.pauseSoundText;
        if (pauseSoundIcon) {
            const src = state?.soundMuted ? 'img/ui/sound-off.svg' : 'img/ui/sound-on.svg';
            if (pauseSoundIcon.getAttribute('src') !== src) pauseSoundIcon.src = src;
        }
        if (pauseSoundText) {
            const muted = !!state?.soundMuted;
            let text;
            if (window.I18N && typeof window.I18N.t === 'function') {
                text = window.I18N.t(muted ? 'PAUSE_SOUND_OFF' : 'PAUSE_SOUND_ON');
            } else {
                text = muted ? 'SOUND: OFF' : 'SOUND: ON';
            }
            if (pauseSoundText.textContent !== text) pauseSoundText.textContent = text;
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

    isPerksModalOpen() {
        return !!(this.perksModal && !this.perksModal.classList.contains('hidden'));
    }

    showPerksModal() {
        if (!this.perksModal) return;
        this.perksModal.classList.remove('hidden');
    }

    hidePerksModal() {
        if (!this.perksModal) return;
        this.perksModal.classList.add('hidden');
    }

    bindPerksModalActions({ onClose, onUpgrade } = {}) {
        if (this._perksBoundClose && this.perksCloseBtn) {
            this.perksCloseBtn.removeEventListener('click', this._perksBoundClose);
        }
        this._perksBoundClose = () => onClose?.();
        this.perksCloseBtn?.addEventListener('click', this._perksBoundClose);

        if (this._perksBoundUpgrade && this.perksGrid) {
            this.perksGrid.removeEventListener('click', this._perksBoundUpgrade);
        }
        this._perksBoundUpgrade = (e) => {
            const btn = e.target?.closest?.('.perks-upgrade-btn');
            if (!btn) return;
            const perkId = btn.dataset?.perkId;
            if (!perkId) return;
            onUpgrade?.(perkId);
        };
        this.perksGrid?.addEventListener('click', this._perksBoundUpgrade);
    }

    renderPerksModal(state, catalog) {
        if (!this.perksGrid) return;
        const coins = Math.max(0, state?.coins ?? 0);
        const coinsEl = document.getElementById('perks-modal-coins');
        if (coinsEl) coinsEl.textContent = String(coins);

        const perks = state?.perks;
        const items = Object.values(catalog || {}).sort((a, b) => a.tier - b.tier);
        this.perksGrid.innerHTML = '';

        items.forEach((cfg) => {
            const level = perks?.getPerkLevel?.(cfg.id) || 0;
            const maxLevel = cfg.maxLevel || 1;
            const unlocked = perks?.isPerkUnlocked?.(cfg.id) || false;
            const nextCost = perks?.getPerkNextCost?.(cfg.id);
            const canUpgrade = perks?.canUpgradePerk?.(cfg.id) || false;

            const card = document.createElement('div');
            card.className = `perks-card${unlocked ? '' : ' is-locked'}`;
            card.innerHTML = `
                <div class="perks-card-tier">Tier ${cfg.tier}</div>
                <div class="perks-card-title">${cfg.title}</div>
                <div class="perks-card-level">${level}/${maxLevel}</div>
                <button class="perks-upgrade-btn" data-perk-id="${cfg.id}" ${canUpgrade ? '' : 'disabled'}>
                    ${level >= maxLevel ? 'MAX' : `BUY ${Number.isFinite(nextCost) ? nextCost : '-'}`}
                </button>
            `;
            this.perksGrid.appendChild(card);
        });
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
            if (window.I18N && typeof window.I18N.t === 'function') {
                youSpan.textContent = window.I18N.t('LEADERBOARD_YOU_SUFFIX');
            } else {
                youSpan.textContent = ' (You)';
            }
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
            const apiScore = this._lbGetScore(me);
            const displayBest = Math.floor(Number(data?.displayBestScore) || 0);
            const score = Math.max(apiScore, displayBest);
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
        const slowCost = state?.spellShopCosts?.slow;
        const shieldCost = state?.spellShopCosts?.shield;

        if (buySlowBtn) {
            const priceEl = buySlowBtn.querySelector('span[data-price]');
            if (priceEl) priceEl.textContent = typeof slowCost === 'number' ? String(slowCost) : '—';
            buySlowBtn.disabled = typeof slowCost !== 'number' || coins < slowCost;
        }
        if (buyShieldBtn) {
            const priceEl = buyShieldBtn.querySelector('span[data-price]');
            if (priceEl) priceEl.textContent = typeof shieldCost === 'number' ? String(shieldCost) : '—';
            buyShieldBtn.disabled = typeof shieldCost !== 'number' || coins < shieldCost;
        }
    }

    hideStartScreen() {
        const startScreen = document.getElementById('start-screen');
        if (startScreen) startScreen.classList.add('hidden');
    }
}
