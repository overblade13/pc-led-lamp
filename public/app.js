const DEVICE_ID = 'c4957cfd-0a7e-4c37-8053-f9621610048e';
const API_URL = 'http://localhost:3000/api';

// Состояние
let currentMode = 'OFF';
let currentColor = '#3b82f6';
let currentBrightness = 80;
let syncSimulateActive = false;

// Таймеры для локальной анимации монитора
let visualTimer = null;
let networkSyncTimer = null;
let hueCounter = 0;

// DOM элементы
const statusBadge = document.getElementById('status-badge');
const eventsBody = document.getElementById('events-body');
const monitorFrame = document.getElementById('monitor-frame');
const screenContent = document.getElementById('screen-content');

// Панель параметров
const paramsPanel = document.getElementById('params-panel');
const colorPickerGroup = document.getElementById('color-picker-group');
const colorPicker = document.getElementById('color-picker');
const colorValLabel = document.getElementById('color-val');
const brightnessSlider = document.getElementById('brightness-slider');
const brightnessValLabel = document.getElementById('brightness-val');

// Симуляция SYNC
const syncControlGroup = document.getElementById('sync-control-group');
const syncSimulationToggle = document.getElementById('sync-simulation-toggle');

// Датчики
const ldrValueLabel = document.getElementById('ldr-value');
const ldrProgressBar = document.getElementById('ldr-progress');
const potValueLabel = document.getElementById('pot-value');

// Кнопки режимов
const modeButtons = {
    'OFF': document.getElementById('btn-mode-off'),
    'STATIC': document.getElementById('btn-mode-static'),
    'RAINBOW': document.getElementById('btn-mode-rainbow'),
    'AUTO': document.getElementById('btn-mode-auto'),
    'SYNC': document.getElementById('btn-mode-sync')
};

// ==========================================
// 1. Управление режимами и отправка команд
// ==========================================

// Изменение режима на клиенте
function setLocalMode(mode) {
    currentMode = mode;
    
    // Снимаем класс active со всех кнопок и вешаем на выбранную
    Object.keys(modeButtons).forEach(m => {
        modeButtons[m].classList.remove('active');
    });
    modeButtons[mode].classList.add('active');
    
    // Обновляем плашку статуса
    statusBadge.className = `status-${mode.toLowerCase()}`;
    
    let modeText = 'Выключен';
    if (mode === 'STATIC') modeText = 'Статический';
    else if (mode === 'RAINBOW') modeText = 'Радуга';
    else if (mode === 'AUTO') modeText = 'Автояркость';
    else if (mode === 'SYNC') modeText = 'Синхронизация';
    statusBadge.innerText = `Режим: ${modeText}`;

    // Отображение нужных настроек
    if (mode === 'STATIC') {
        colorPickerGroup.style.display = 'block';
        syncControlGroup.style.display = 'none';
    } else if (mode === 'SYNC') {
        colorPickerGroup.style.display = 'none';
        syncControlGroup.style.display = 'block';
    } else {
        colorPickerGroup.style.display = 'none';
        syncControlGroup.style.display = 'none';
    }

    // Перезапуск локального визуализатора
    startLocalVisualizer();
}

// Отправка состояния на сервер
async function sendStateCommand(additionalParams = {}) {
    const stateObj = {
        mode: currentMode,
        brightness: currentBrightness,
        color: currentColor,
        ...additionalParams
    };

    try {
        const response = await fetch(`${API_URL}/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                device_id: DEVICE_ID,
                command: JSON.stringify(stateObj)
            })
        });
        const result = await response.json();
        console.log('Команда отправлена:', stateObj, result);
    } catch (err) {
        console.error('Ошибка отправки команды:', err);
    }
}

// Обработчики кнопок выбора режимов
Object.keys(modeButtons).forEach(mode => {
    modeButtons[mode].addEventListener('click', () => {
        // Выключаем симуляцию при смене режима с SYNC
        if (mode !== 'SYNC' && syncSimulateActive) {
            syncSimulationToggle.checked = false;
            handleSyncSimulationChange();
        }
        setLocalMode(mode);
        sendStateCommand();
    });
});

// Изменение цвета
colorPicker.addEventListener('input', (e) => {
    currentColor = e.target.value;
    colorValLabel.innerText = currentColor.toUpperCase();
    updateMonitorVisuals();
});

colorPicker.addEventListener('change', () => {
    sendStateCommand();
});

// Изменение яркости
brightnessSlider.addEventListener('input', (e) => {
    currentBrightness = parseInt(e.target.value);
    brightnessValLabel.innerText = `${currentBrightness}%`;
    updateMonitorVisuals();
});

brightnessSlider.addEventListener('change', () => {
    sendStateCommand();
});

// ==========================================
// 2. Симуляция экрана в режиме SYNC
// ==========================================

syncSimulationToggle.addEventListener('change', handleSyncSimulationChange);

function handleSyncSimulationChange() {
    syncSimulateActive = syncSimulationToggle.checked;
    
    if (syncSimulateActive && currentMode === 'SYNC') {
        // Локальное быстрое обновление экрана и свечения монитора (каждые 300мс)
        visualTimer = setInterval(() => {
            hueCounter = (hueCounter + 15) % 360;
            updateMonitorVisuals();
        }, 300);

        // Отправка цветов на сервер с пониженной частотой (раз в 1000мс), чтобы не спамить БД
        networkSyncTimer = setInterval(() => {
            const colors = generateSimulatedColors();
            sendStateCommand({ colors });
        }, 1000);
    } else {
        clearInterval(visualTimer);
        clearInterval(networkSyncTimer);
        updateMonitorVisuals();
    }
}

// Генерация 4-х гармонично меняющихся цветов для сторон монитора
function generateSimulatedColors() {
    const colors = [];
    for (let i = 0; i < 4; i++) {
        const offset = i * 60;
        const h = (hueCounter + offset) % 360;
        colors.push(hslToHex(h, 90, 50));
    }
    return colors;
}

// ==========================================
// 3. Визуализатор монитора (Web UI)
// ==========================================

function startLocalVisualizer() {
    clearInterval(visualTimer);
    
    if (currentMode === 'RAINBOW') {
        visualTimer = setInterval(() => {
            hueCounter = (hueCounter + 2) % 360;
            updateMonitorVisuals();
        }, 30);
    } else {
        updateMonitorVisuals();
    }
}

function updateMonitorVisuals() {
    const opacity = currentBrightness / 100;
    
    if (currentMode === 'OFF') {
        setGlowColors('rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)');
        screenContent.style.backgroundColor = '#020617';
    } 
    else if (currentMode === 'STATIC') {
        const glowColor = hexToRgba(currentColor, opacity * 0.7);
        setGlowColors(glowColor, glowColor, glowColor, glowColor);
        screenContent.style.backgroundColor = hexToRgba(currentColor, 0.15);
    } 
    else if (currentMode === 'RAINBOW') {
        const cTop = `hsla(${hueCounter % 360}, 90%, 50%, ${opacity * 0.7})`;
        const cRight = `hsla(${(hueCounter + 90) % 360}, 90%, 50%, ${opacity * 0.7})`;
        const cBottom = `hsla(${(hueCounter + 180) % 360}, 90%, 50%, ${opacity * 0.7})`;
        const cLeft = `hsla(${(hueCounter + 270) % 360}, 90%, 50%, ${opacity * 0.7})`;
        
        setGlowColors(cTop, cRight, cBottom, cLeft);
        screenContent.style.backgroundColor = `hsla(${hueCounter % 360}, 90%, 20%, 0.15)`;
    } 
    else if (currentMode === 'AUTO') {
        // Изменяем оттенок свечения в зависимости от текущего показания LDR
        const ldrVal = parseInt(ldrValueLabel.innerText) || 2000;
        let r, g, b;
        if (ldrVal < 1500) { r = 255; g = 140; b = 40; } // Теплый
        else if (ldrVal < 3000) { r = 255; g = 220; b = 180; } // Нейтральный
        else { r = 220; g = 240; b = 255; } // Холодный
        
        const glow = `rgba(${r}, ${g}, ${b}, ${opacity * 0.7})`;
        setGlowColors(glow, glow, glow, glow);
        screenContent.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 0.08)`;
    } 
    else if (currentMode === 'SYNC') {
        if (syncSimulateActive) {
            const colors = generateSimulatedColors();
            setGlowColors(
                hexToRgba(colors[0], opacity * 0.7),
                hexToRgba(colors[1], opacity * 0.7),
                hexToRgba(colors[2], opacity * 0.7),
                hexToRgba(colors[3], opacity * 0.7)
            );
            screenContent.style.backgroundColor = hexToRgba(colors[0], 0.15);
        } else {
            // Фолбэк на приятное синее свечение, когда симуляция не запущена
            const defaultBlue = hexToRgba('#06b6d4', opacity * 0.7);
            setGlowColors(defaultBlue, defaultBlue, defaultBlue, defaultBlue);
            screenContent.style.backgroundColor = 'rgba(6, 182, 212, 0.05)';
        }
    }
}

function setGlowColors(top, right, bottom, left) {
    monitorFrame.style.setProperty('--glow-top', top);
    monitorFrame.style.setProperty('--glow-right', right);
    monitorFrame.style.setProperty('--glow-bottom', bottom);
    monitorFrame.style.setProperty('--glow-left', left);
}

// ==========================================
// 4. Поллинг и обновление данных
// ==========================================

async function updateStatus() {
    try {
        const response = await fetch(`${API_URL}/status?device_id=${DEVICE_ID}`);
        const data = await response.json();
        
        // Синхронизируем режим и настройки с сервером (только если локально не запущена активная симуляция)
        if (data.state && !syncSimulateActive) {
            const s = data.state;
            if (s.mode && s.mode !== currentMode) {
                setLocalMode(s.mode);
            }
            if (s.brightness !== undefined && Math.abs(s.brightness - currentBrightness) > 2) {
                currentBrightness = s.brightness;
                brightnessSlider.value = currentBrightness;
                brightnessValLabel.innerText = `${currentBrightness}%`;
            }
            if (s.color && s.color !== currentColor) {
                currentColor = s.color;
                colorPicker.value = currentColor;
                colorValLabel.innerText = currentColor.toUpperCase();
            }
            updateMonitorVisuals();
        }
        
        // Обновляем показания датчиков (пришедшие из телеметрии через события)
        updateSensorsFromEvents(data.events);
        
        // Рендерим последние события
        renderEvents(data.events);
    } catch (err) {
        console.error('Ошибка поллинга статуса:', err);
    }
}

// Парсинг телеметрии LDR и потенциометра из последних событий
function updateSensorsFromEvents(events) {
    const ldrEvent = events.find(e => e.sensor === 'LDR');
    if (ldrEvent) {
        // Сообщение имеет вид: "Light: 1450 | Pot: 2048 | Mode: STATIC"
        const lightMatch = ldrEvent.message.match(/Light:\s*(\d+)/);
        if (lightMatch) {
            const ldrVal = parseInt(lightMatch[1]);
            ldrValueLabel.innerText = ldrVal;
            // Процент для прогресс-бара LDR
            const pct = Math.min(100, Math.max(0, (ldrVal / 4095) * 100));
            ldrProgressBar.style.width = `${pct}%`;
        }
        
        const potMatch = ldrEvent.message.match(/Pot:\s*(\d+)/);
        if (potMatch) {
            const potVal = parseInt(potMatch[1]);
            potValueLabel.innerText = potVal;
        }
    }
}

function renderEvents(events) {
    eventsBody.innerHTML = '';
    
    if (events.length === 0) {
        eventsBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #64748b;">Событий нет</td></tr>';
        return;
    }
    
    events.forEach(event => {
        const row = document.createElement('tr');
        const date = new Date(event.created_at).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        row.innerHTML = `
            <td>${date}</td>
            <td><strong>${event.sensor}</strong></td>
            <td>${event.message}</td>
        `;
        eventsBody.appendChild(row);
    });
}

// ==========================================
// 5. Вспомогательные утилиты цвета
// ==========================================

function hexToRgba(hex, opacity) {
    let c = hex.substring(1);
    if(c.length === 3){
        c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
    }
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function hslToHex(h, s, l) {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

// Регулярный опрос
setInterval(updateStatus, 2500);
updateStatus();
