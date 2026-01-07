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
        
        
        // Добавляем треки (можно расширить)
        this.tracks = [
            {
                id: 'main',
                url: 'audio/1.mp3',
                bpm: 120
            }
        ];

        // Устанавливаем первый трек
        if (this.tracks.length > 0) {
            this.setTrack(this.tracks[0]);
        }
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
        
        // Останавливаем все эффекты
        if (this.forwardEffect) this.forwardEffect.pause();
        if (this.backEffect) this.backEffect.pause();
        
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
        this.updatePlaybackRate(1.0);
    }
}
