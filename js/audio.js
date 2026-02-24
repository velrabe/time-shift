// Audio система с динамическим playbackRate
class AudioSystem {
    constructor() {
        this.currentTrack = null;
        this.audioElement = null;
        this.tracks = [];
        this.isPlaying = false;
        this.basePlaybackRate = 1.0;
        this.volume = 0.5; // Громкость по умолчанию (50%)
        
        // Эффекты перемотки
        this.forwardEffect = null;
        this.backEffect = null;

        // Короткие звуковые эффекты (SFX)
        this.effects = {};
    }

    // Инициализация
    init() {
        // Создаем audio элемент для основного трека
        this.audioElement = document.createElement('audio');
        this.audioElement.loop = true;
        this.audioElement.preload = 'auto';
        this.audioElement.crossOrigin = 'anonymous';
        this.audioElement.volume = this.volume;
        
        // Создаем элементы для эффектов
        this.forwardEffect = document.createElement('audio');
        this.forwardEffect.preload = 'auto';
        this.forwardEffect.volume = this.volume * 0.3; // 30% от текущей громкости
        
        this.backEffect = document.createElement('audio');
        this.backEffect.preload = 'auto';
        this.backEffect.volume = this.volume * 0.3; // 30% от текущей громкости
        
        // Загружаем эффекты
        const forwardUrl = new URL('audio/forward.wav', window.location.href);
        const backUrl = new URL('audio/back.wav', window.location.href);
        this.forwardEffect.src = forwardUrl.href;
        this.backEffect.src = backUrl.href;
        
        // Обработчики окончания эффектов не нужны - звуки могут накладываться
        
        // Обработчик ошибок загрузки
        this.audioElement.addEventListener('error', (e) => {
            console.error('Audio load error:', e, 'src:', this.audioElement.src);
        });
        
        // Загружаем короткие игровые эффекты
        this.effects = {
            swallow: this._createEffectElement('audio/swallow.mp3', 0.9),
            jawOpen: this._createEffectElement('audio/open-jaw.mp3', 0.9),
            jawClose: this._createEffectElement('audio/close-jaw.mp3', 0.9),
            frontCrush: this._createEffectElement('audio/front-crush.mp3', 1.0),
            jawBroke: this._createEffectElement('audio/jaw-broke.mp3', 1.0),
            gameOver: this._createEffectElement('audio/game-over.mp3', 1.0),
            coinRush: this._createEffectElement('audio/2.mp3', 0.9),
            coinBite: this._createEffectElement('audio/bite-coin.mp3', 0.9),
            buy: this._createEffectElement('audio/buy.mp3', 0.9),
            slow: this._createEffectElement('audio/slow.mp3', 0.9),
            shield: this._createEffectElement('audio/sheild.mp3', 0.9),
            shieldAbsorb: this._createEffectElement('audio/shield-absorb.mp3', 0.9),
            press: this._createEffectElement('audio/press.mp3', 0.9)
        };
        
        // Фоновая музыка временно отключена: не добавляем основной трек.
        this.tracks = [];
    }

    // Установка трека
    setTrack(track) {
        if (!track || !this.audioElement) return;
        
        this.currentTrack = track;
        // Используем абсолютный путь относительно текущей страницы
        const url = new URL(track.url, window.location.href);
        this.audioElement.src = url.href;
        
        // Загружаем трек
        this.audioElement.load();
    }

    // Воспроизведение
    play() {
        if (!this.audioElement) {
            console.warn('Audio element not initialized');
            return;
        }

        // Если фоновый трек не выбран — оставляем тишину.
        if (!this.currentTrack) {
            return;
        }
        
        // Проверка наличия источника
        if (!this.audioElement.src || this.audioElement.src === window.location.href) {
            console.warn('Audio file not found, src:', this.audioElement.src);
            return;
        }
        
        // Проверяем готовность
        if (this.audioElement.readyState < 2) {
            this.audioElement.addEventListener('canplay', () => {
                this.audioElement.play().catch(e => {
                    console.error('Audio play failed after load:', e);
                });
            }, { once: true });
            return;
        }
        
        const playPromise = this.audioElement.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                this.isPlaying = true;
            }).catch(e => {
                // Это нормально, если пользователь еще не взаимодействовал
                if (e.name !== 'NotAllowedError') {
                    console.error('Audio play failed:', e);
                }
            });
        }
    }

    // Пауза
    pause() {
        if (!this.audioElement) return;

        this.audioElement.pause();
        this.isPlaying = false;
    }

    // Обновление скорости воспроизведения
    updatePlaybackRate(speedMultiplier) {
        if (!this.audioElement) return;
        
        // Ограничиваем диапазон
        const minRate = 1.0;
        const maxRate = 3.33; // S0 / Smax = 1.0 / 0.3
        
        const rate = Math.max(minRate, Math.min(maxRate, speedMultiplier));
        this.audioElement.playbackRate = rate;
        this.basePlaybackRate = rate;
    }

    // Получение текущей скорости
    getPlaybackRate() {
        return this.audioElement ? this.audioElement.playbackRate : 1.0;
    }

    // Воспроизведение звука перемотки назад (без перемотки трека)
    playBackSound() {
        if (!this.backEffect) return;
        
        // Воспроизводим эффект обратной перемотки (с наложением, если предыдущий еще играет)
        this.backEffect.currentTime = 0;
        this.backEffect.play().catch(e => {
            console.error('Failed to play back effect:', e);
        });
    }

    // Воспроизведение звука перемотки вперед (без перемотки трека)
    playForwardSound() {
        if (!this.forwardEffect) return;
        
        // Воспроизводим эффект перемотки вперед (с наложением, если предыдущий еще играет)
        this.forwardEffect.currentTime = 0;
        this.forwardEffect.play().catch(e => {
            console.error('Failed to play forward effect:', e);
        });
    }

    // Установка громкости
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        if (this.audioElement) {
            this.audioElement.volume = this.volume;
        }
        if (this.forwardEffect) {
            this.forwardEffect.volume = this.volume * 0.3; // 30% от текущей громкости
        }
        if (this.backEffect) {
            this.backEffect.volume = this.volume * 0.3; // 30% от текущей громкости
        }
        if (this.effects) {
            Object.values(this.effects).forEach((el) => {
                if (!el) return;
                const mult = typeof el._volumeMultiplier === 'number' ? el._volumeMultiplier : 1;
                el.volume = this.volume * mult;
            });
        }
    }

    // Вспомогательный метод создания элемента эффекта
    _createEffectElement(relativeUrl, volumeMultiplier = 1.0) {
        const el = document.createElement('audio');
        el.preload = 'auto';
        el.crossOrigin = 'anonymous';
        el._volumeMultiplier = volumeMultiplier;
        el.volume = this.volume * volumeMultiplier;
        const url = new URL(relativeUrl, window.location.href);
        el.src = url.href;
        return el;
    }

    // Вспомогательный метод воспроизведения эффекта
    _playEffect(key) {
        const el = this.effects && this.effects[key];
        if (!el) return;
        try {
            el.currentTime = 0;
            const playPromise = el.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch((e) => {
                    if (e.name !== 'NotAllowedError') {
                        console.error(`Failed to play effect "${key}":`, e);
                    }
                });
            }
        } catch (e) {
            console.error(`Failed to play effect "${key}":`, e);
        }
    }

    // Публичные методы для игровых эффектов
    playSwallow() {
        this._playEffect('swallow');
    }

    playJawOpen() {
        this._playEffect('jawOpen');
    }

    playJawClose() {
        this._playEffect('jawClose');
    }

    playFrontCrush() {
        this._playEffect('frontCrush');
    }

    playJawBroke() {
        this._playEffect('jawBroke');
    }

    playGameOverJingle() {
        this._playEffect('gameOver');
    }

    playCoinRush() {
        const el = this.effects && this.effects.coinRush;
        if (!el) return;
        // Делаем CoinRush зацикленным фоновым эффектом на время режима.
        el.loop = true;
        if (!el.paused) return;
        try {
            el.currentTime = 0;
            const playPromise = el.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch((e) => {
                    if (e.name !== 'NotAllowedError') {
                        console.error('Failed to play effect "coinRush":', e);
                    }
                });
            }
        } catch (e) {
            console.error('Failed to play effect "coinRush":', e);
        }
    }

    stopCoinRush() {
        const el = this.effects && this.effects.coinRush;
        if (!el) return;
        try {
            el.pause();
            el.currentTime = 0;
        } catch (e) {
            console.error('Failed to stop effect "coinRush":', e);
        }
    }

    playCoinBite() {
        this._playEffect('coinBite');
    }

    playBuy() {
        this._playEffect('buy');
    }

    playSlowSpell() {
        this._playEffect('slow');
    }

    playShieldSpell() {
        this._playEffect('shield');
    }

    playShieldAbsorb() {
        this._playEffect('shieldAbsorb');
    }

    playPress() {
        this._playEffect('press');
    }

    // Получение громкости
    getVolume() {
        return this.volume;
    }

    // Сброс
    reset() {
        this.pause();
        if (this.audioElement) {
            this.audioElement.currentTime = 0;
        }
        if (this.forwardEffect) {
            this.forwardEffect.currentTime = 0;
        }
        if (this.backEffect) {
            this.backEffect.currentTime = 0;
        }
        if (this.effects) {
            Object.values(this.effects).forEach((el) => {
                if (!el) return;
                try {
                    el.pause();
                } catch (e) {
                    // ignore
                }
                el.currentTime = 0;
            });
        }
        this.updatePlaybackRate(1.0);
    }
}
