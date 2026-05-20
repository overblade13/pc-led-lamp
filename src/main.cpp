#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>

// ==========================================
// 1. Настройки сети и сервера
// ==========================================
const char* ssid = "Wokwi-GUEST";
const char* password = "";
// IP вашего компьютера (сервера). Замените при необходимости.
const String serverUrl = "http://192.168.0.103:3000/api";
const String deviceId = "bl";

// ==========================================
// 2. Настройки пинов
// ==========================================
const int PIN_LED_STRIP = 13; // DIN светодиодной ленты
const int PIN_LDR = 34;       // Датчик освещенности (LDR)
const int PIN_POT = 35;       // Потенциометр
const int PIN_BTN = 14;       // Кнопка переключения режимов

// Настройки светодиодов
const int NUM_LEDS_TOP = 8;
const int NUM_LEDS_RIGHT = 4;
const int NUM_LEDS_BOTTOM = 8;
const int NUM_LEDS_LEFT = 4;
const int TOTAL_LEDS = NUM_LEDS_TOP + NUM_LEDS_RIGHT + NUM_LEDS_BOTTOM + NUM_LEDS_LEFT; // 24

Adafruit_NeoPixel strip(TOTAL_LEDS, PIN_LED_STRIP, NEO_GRB + NEO_KHZ800);

// ==========================================
// 3. Состояния подсветки
// ==========================================
enum LightMode { OFF, STATIC, RAINBOW, AUTO, SYNC };
LightMode currentMode = OFF;

// Текущие параметры
uint8_t globalBrightness = 80; // 0-255
uint8_t targetR = 255, targetG = 255, targetB = 255;

// Цвета для 4-х зон в режиме SYNC (Верх, Право, Низ, Лево)
uint8_t syncR[4] = {255, 255, 255, 255};
uint8_t syncG[4] = {255, 255, 255, 255};
uint8_t syncB[4] = {255, 255, 255, 255};

// Тайминги
unsigned long lastPollTime = 0;
const unsigned long pollInterval = 2000; // Опрос сервера каждые 2 сек

unsigned long lastTelemetryTime = 0;
const unsigned long telemetryInterval = 5000; // Отправка телеметрии каждые 5 сек

unsigned long lastEffectTime = 0;
uint16_t rainbowHue = 0;

// Дебаунс кнопки
unsigned long lastBtnPress = 0;
bool lastBtnState = HIGH;

// Последние отправленные данные
int lastLdrValue = -1;

// ==========================================
// 4. Прототипы функций
// ==========================================
void sendTelemetry(String type, String sensor, String msg);
void fetchStatus();
void updateLights();
void handleButton();
void runEffects();
void hexToRGB(String hex, uint8_t &r, uint8_t &g, uint8_t &b);
String getModeString(LightMode mode);
String serializeState();

// ==========================================
// 5. Инициализация
// ==========================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(PIN_LDR, INPUT);
  pinMode(PIN_POT, INPUT);
  pinMode(PIN_BTN, INPUT_PULLUP);

  strip.begin();
  strip.show(); // Отключить все диоды при старте

  Serial.print("Connecting to WiFi");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected!");

  // Отправляем телеметрию о запуске
  sendTelemetry("SYSTEM", "ESP32", "Monitor backlight system initialized");
  
  // Получаем начальное состояние
  fetchStatus();
}

// ==========================================
// 6. Основной цикл
// ==========================================
void loop() {
  unsigned long now = millis();

  // 1. Опрос физической кнопки (Дебаунс)
  handleButton();

  // 2. Периодический опрос сервера для синхронизации
  if (now - lastPollTime > pollInterval) {
    lastPollTime = now;
    fetchStatus();
  }

  // 3. Периодическая отправка телеметрии (уровень освещенности, потенциометр и режим)
  if (now - lastTelemetryTime > telemetryInterval) {
    lastTelemetryTime = now;
    int currentLdr = analogRead(PIN_LDR);
    int currentPot = analogRead(PIN_POT);
    if (abs(currentLdr - lastLdrValue) > 100 || lastLdrValue == -1) {
      lastLdrValue = currentLdr;
      String msg = "Light: " + String(currentLdr) + " | Pot: " + String(currentPot) + " | Mode: " + getModeString(currentMode);
      sendTelemetry("LIGHT_LEVEL", "LDR", msg);
    }
  }

  // 4. Отрисовка светодиодных эффектов (неблокирующая)
  runEffects();
}

// ==========================================
// 7. Обработка кнопки
// ==========================================
void handleButton() {
  unsigned long now = millis();
  bool btnState = digitalRead(PIN_BTN);
  
  if (btnState == LOW && lastBtnState == HIGH && (now - lastBtnPress > 300)) {
    lastBtnPress = now;
    
    // Циклическое переключение режимов
    int nextMode = (int)currentMode + 1;
    if (nextMode > 4) nextMode = 0;
    currentMode = (LightMode)nextMode;

    Serial.println("Button pressed. New mode: " + getModeString(currentMode));
    
    // Синхронизируем изменение с сервером
    String stateJson = serializeState();
    sendTelemetry("MODE_CHANGE", "BUTTON", stateJson);
    
    updateLights();
  }
  lastBtnState = btnState;
}

// ==========================================
// 8. Логика эффектов
// ==========================================
void runEffects() {
  unsigned long now = millis();
  
  // Для эффектов считываем скорость с потенциометра
  int potValue = analogRead(PIN_POT);
  int delayMs = map(potValue, 0, 4095, 10, 150); // Интервал для радуги
  
  if (currentMode == RAINBOW) {
    if (now - lastEffectTime > delayMs) {
      lastEffectTime = now;
      
      for (int i = 0; i < strip.numPixels(); i++) {
        int pixelHue = rainbowHue + (i * 65536L / strip.numPixels());
        strip.setPixelColor(i, strip.gamma32(strip.ColorHSV(pixelHue)));
      }
      strip.setBrightness(globalBrightness);
      strip.show();
      
      rainbowHue += 256;
    }
  }
  else if (currentMode == AUTO) {
    // В автоматическом режиме опрашиваем LDR и меняем яркость и оттенок
    if (now - lastEffectTime > 200) { // Обновляем раз в 200мс
      lastEffectTime = now;
      int ldrValue = analogRead(PIN_LDR);
      
      // Чем темнее в комнате, тем ниже яркость (чтобы беречь глаза)
      // Wokwi LDR: 0 (темно) до 4095 (ярко)
      uint8_t autoBright = map(ldrValue, 100, 4000, 30, 255);
      autoBright = constrain(autoBright, 30, 255);
      
      // Цветовая температура: теплый янтарный при слабом свете, холодный белый при ярком
      uint8_t r, g, b;
      if (ldrValue < 1500) {
        // Уютный теплый оранжевый/желтый
        r = 255;
        g = 140; 
        b = 40;
      } else if (ldrValue < 3000) {
        // Мягкий нейтральный белый
        r = 255;
        g = 220;
        b = 180;
      } else {
        // Яркий холодный белый
        r = 220;
        g = 240;
        b = 255;
      }
      
      for (int i = 0; i < strip.numPixels(); i++) {
        strip.setPixelColor(i, strip.Color(r, g, b));
      }
      strip.setBrightness(autoBright);
      strip.show();
    }
  }
}

// ==========================================
// 9. Управление диодами
// ==========================================
void updateLights() {
  strip.setBrightness(globalBrightness);
  
  if (currentMode == OFF) {
    strip.clear();
    strip.show();
  }
  else if (currentMode == STATIC) {
    for (int i = 0; i < strip.numPixels(); i++) {
      strip.setPixelColor(i, strip.Color(targetR, targetG, targetB));
    }
    strip.show();
  }
  else if (currentMode == SYNC) {
    // Распределяем цвета по 4-м зонам
    // 1. Верхняя зона (0-7)
    for (int i = 0; i < 8; i++) {
      strip.setPixelColor(i, strip.Color(syncR[0], syncG[0], syncB[0]));
    }
    // 2. Правая зона (8-11)
    for (int i = 8; i < 12; i++) {
      strip.setPixelColor(i, strip.Color(syncR[1], syncG[1], syncB[1]));
    }
    // 3. Нижняя зона (12-19)
    for (int i = 12; i < 20; i++) {
      strip.setPixelColor(i, strip.Color(syncR[2], syncG[2], syncB[2]));
    }
    // 4. Левая зона (20-23)
    for (int i = 20; i < 24; i++) {
      strip.setPixelColor(i, strip.Color(syncR[3], syncG[3], syncB[3]));
    }
    strip.show();
  }
}

// ==========================================
// 10. Функции работы с сетью
// ==========================================
void sendTelemetry(String type, String sensor, String msg) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl + "/telemetry");
    http.addHeader("Content-Type", "application/json");
    
    StaticJsonDocument<256> doc;
    doc["device_id"] = deviceId;
    doc["event_type"] = type;
    doc["sensor"] = sensor;
    doc["message"] = msg;
    
    String json;
    serializeJson(doc, json);
    http.POST(json);
    http.end();
  }
}

void fetchStatus() {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl + "/status?device_id=" + deviceId);
    int httpCode = http.GET();
    
    if (httpCode == 200) {
      String payload = http.getString();
      StaticJsonDocument<512> doc;
      deserializeJson(doc, payload);
      
      JsonObject state = doc["state"];
      String modeStr = state["mode"];
      
      LightMode newMode = currentMode;
      if (modeStr == "OFF") newMode = OFF;
      else if (modeStr == "STATIC") newMode = STATIC;
      else if (modeStr == "RAINBOW") newMode = RAINBOW;
      else if (modeStr == "AUTO") newMode = AUTO;
      else if (modeStr == "SYNC") newMode = SYNC;
      
      // Парсим общую яркость
      if (state.containsKey("brightness")) {
        int br = state["brightness"];
        globalBrightness = map(br, 0, 100, 0, 255);
      }
      
      // Парсим цвета
      if (newMode == STATIC && state.containsKey("color")) {
        String hexColor = state["color"];
        hexToRGB(hexColor, targetR, targetG, targetB);
      }
      else if (newMode == SYNC) {
        if (state.containsKey("colors")) {
          JsonArray colorsArr = state["colors"];
          for (int i = 0; i < 4 && i < colorsArr.size(); i++) {
            String hexColor = colorsArr[i];
            hexToRGB(hexColor, syncR[i], syncG[i], syncB[i]);
          }
        } else if (state.containsKey("color")) {
          // Фолбэк на один цвет
          String hexColor = state["color"];
          uint8_t r, g, b;
          hexToRGB(hexColor, r, g, b);
          for (int i = 0; i < 4; i++) {
            syncR[i] = r; syncG[i] = g; syncB[i] = b;
          }
        }
      }

      if (newMode != currentMode) {
        currentMode = newMode;
        Serial.println("Mode updated from server: " + getModeString(currentMode));
      }
      
      // Обновляем физическое состояние диодов
      updateLights();
    }
    http.end();
  }
}

// ==========================================
// 11. Вспомогательные утилиты
// ==========================================
void hexToRGB(String hex, uint8_t &r, uint8_t &g, uint8_t &b) {
  if (hex.startsWith("#")) {
    hex = hex.substring(1);
  }
  long number = strtol(hex.c_str(), NULL, 16);
  r = number >> 16;
  g = (number >> 8) & 0xFF;
  b = number & 0xFF;
}

String getModeString(LightMode mode) {
  switch (mode) {
    case OFF: return "OFF";
    case STATIC: return "STATIC";
    case RAINBOW: return "RAINBOW";
    case AUTO: return "AUTO";
    case SYNC: return "SYNC";
    default: return "OFF";
  }
}

String serializeState() {
  StaticJsonDocument<200> doc;
  doc["mode"] = getModeString(currentMode);
  doc["brightness"] = map(globalBrightness, 0, 255, 0, 100);
  
  char hexColor[8];
  sprintf(hexColor, "#%02X%02X%02X", targetR, targetG, targetB);
  doc["color"] = String(hexColor);
  
  String json;
  serializeJson(doc, json);
  return json;
}
