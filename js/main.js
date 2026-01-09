// Точка входа
let game;

async function init() {
    // На всякий случай: блокируем PLAY, пока идет асинхронная инициализация,
    // чтобы нельзя было стартовать игру "раньше времени" и получить два параллельных запуска.
    const playBtn = document.getElementById('play-btn');
    if (playBtn) {
        playBtn.disabled = true;
    }

    game = new Game();
    await game.init();
    
    // Показываем стартовый экран (игра начнется по клику на PLAY)
    // Важно: если пользователь кликнул PLAY до завершения init(), Game сам запустится
    // после инициализации (pendingStart). В таком случае не показываем стартовый экран поверх игры.
    if (game && game.state === 'MENU') {
        game.renderer.showStartScreen();
    }

    // Разблокируем PLAY после init (если мы все еще в меню).
    if (playBtn) {
        playBtn.disabled = !(game && game.state === 'MENU');
    }
}

// Инициализация при загрузке
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

