// Точка входа
let game;
let loadingAnimationInterval = null;

// Анимация точек загрузки на кнопке PLAY
function startLoadingAnimation(playBtn) {
    if (!playBtn) return;
    
    let dotCount = 3;
    const updateText = () => {
        const dots = '.'.repeat(dotCount);
        playBtn.textContent = `Loading${dots}`;
        dotCount = dotCount === 1 ? 3 : dotCount - 1;
    };
    
    // Сразу показываем начальное состояние
    updateText();
    
    // Обновляем каждые 500ms (цикл: 3 -> 2 -> 1 -> 3)
    loadingAnimationInterval = setInterval(updateText, 500);
}

function stopLoadingAnimation(playBtn) {
    if (loadingAnimationInterval) {
        clearInterval(loadingAnimationInterval);
        loadingAnimationInterval = null;
    }
    if (playBtn) {
        playBtn.textContent = 'PLAY';
    }
}

async function init() {
    // На всякий случай: блокируем PLAY, пока идет асинхронная инициализация,
    // чтобы нельзя было стартовать игру "раньше времени" и получить два параллельных запуска.
    const playBtn = document.getElementById('play-btn');
    if (playBtn) {
        playBtn.disabled = true;
        // Запускаем анимацию загрузки
        startLoadingAnimation(playBtn);
    }

    try {
        game = new Game();
        await game.init();
        
        // Показываем стартовый экран (игра начнется по клику на PLAY)
        // Важно: если пользователь кликнул PLAY до завершения init(), Game сам запустится
        // после инициализации (pendingStart). В таком случае не показываем стартовый экран поверх игры.
        if (game && game.state === 'MENU') {
            game.renderer.showStartScreen(game.getGameState());
        }
    } catch (error) {
        console.error('Ошибка инициализации игры:', error);
    } finally {
        // Останавливаем анимацию загрузки в любом случае
        stopLoadingAnimation(playBtn);
        
        // Разблокируем PLAY после init (если мы все еще в меню).
        if (playBtn) {
            playBtn.disabled = !(game && game.state === 'MENU');
        }
    }
}

// Инициализация при загрузке
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

