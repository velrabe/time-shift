// Audio система с динамическим playbackRate
class AudioSystem {
    constructor() {
        this.audioContext = null;
        this.currentTrack = null;
        this.audioElement = null;
        this.tracks = [];
        this.isPlaying = false;
        this.basePlaybackRate = 1.0;
    }

    // Инициализация
    init() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('WebAudio API not supported, using HTML5 audio');
        }

        // Создаем audio элемент
        this.audioElement = document.createElement('audio');
        this.audioElement.loop = true;
        this.audioElement.preload = 'auto';
        
        // Добавляем треки (можно расширить)
        this.tracks = [
            {
                id: 'main',
                url: 'audio/main.mp3', // нужно будет добавить файл
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
        this.audioElement.src = track.url;
    }

    // Воспроизведение
    play() {
        if (!this.audioElement) return;
        
        // Проверка наличия источника
        if (!this.audioElement.src || this.audioElement.src === window.location.href) {
            console.warn('Audio file not found, skipping playback');
            return;
        }
        
        this.audioElement.play().catch(e => {
            console.warn('Audio play failed:', e);
        });
        this.isPlaying = true;
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

    // Обработка событий
    onEvent(event, data) {
        switch (event) {
            case 'PAUSE':
                this.pause();
                break;
            case 'RESUME':
                if (this.isPlaying) {
                    this.play();
                }
                break;
            case 'TICK_STEP':
                if (data && data.stepDuration) {
                    const speedMultiplier = 1.0 / data.stepDuration;
                    this.updatePlaybackRate(speedMultiplier);
                }
                break;
        }
    }

    // Сброс
    reset() {
        this.pause();
        if (this.audioElement) {
            this.audioElement.currentTime = 0;
        }
        this.updatePlaybackRate(1.0);
    }
}

