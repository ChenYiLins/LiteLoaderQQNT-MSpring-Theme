const fs = require("fs");
const path = require("path");
const { BrowserWindow, ipcMain, shell, net } = require("electron");

function log(...args) {
    console.log(`[MSpring Theme]`, ...args);
}

function openWeb(url) {
    shell.openExternal(url);
}

function fetchData(url) {
    return new Promise((resolve, reject) => {
        const request = net.request({
            method: 'GET',
            url: url,
            redirect: 'follow' // 处理重定向
        });

        request.on('response', (response) => {
            const finalUrl = response.headers.location || response.url;
            let data = '';

            response.on('data', (chunk) => {
                data += chunk;
            });

            response.on('end', () => {
                resolve({ url: finalUrl, content: data });
            });
        });

        request.on('error', (error) => {
            reject(error);
        });

        request.end();
    });
}

// 防抖函数
function debounce(fn, time) {
    let timer = null;
    return function (...args) {
        timer && clearTimeout(timer);
        timer = setTimeout(() => {
            fn.apply(this, args);
        }, time);
    }
}

/**
 * 将十六进制颜色值转换为 RGB 值
 * @param {string} hex 表示十六进制颜色的字符串，例如 "#ff0000"
 * @returns {Array} 包含 RGB 值的数组，例如 [255, 0, 0]
 */
function hexToRGB(hex) {
    // 分别提取并转换红色、绿色、蓝色的十六进制值到整数
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
}

/**
 * 将 RGB 值转换为十六进制颜色值
 * @param {Array} rgb 包含 RGB 值的数组，例如 [255, 0, 0]
 * @returns {string} 表示十六进制颜色的字符串，例如 "#ff0000"
 */
function RGBToHex(rgb) {
    var r = rgb[0].toString(16).padStart(2, '0');
    var g = rgb[1].toString(16).padStart(2, '0');
    var b = rgb[2].toString(16).padStart(2, '0');
    return '#' + r + g + b;
}

/**
 * 混合两个颜色的 RGB 值
 * @param {Array} color1 第一个颜色的 RGB 值数组
 * @param {Array} color2 第二个颜色的 RGB 值数组
 * @param {number} ratio 混合比率，范围在 0 到 1 之间
 * @returns {Array} 混合后的 RGB 值数组
 */
function blendColors(color1, color2, ratio) {
    var blendedColor = [];
    for (var i = 0; i < 3; i++) {
        blendedColor[i] = Math.round(color1[i] * (1 - ratio) + color2[i] * ratio);
    }
    return blendedColor;
}

/**
 * 计算给定RGB颜色的亮度
 * @param {number} r - 红色通道的值（0-255）
 * @param {number} g - 绿色通道的值（0-255）
 * @param {number} b - 蓝色通道的值（0-255）
 * @returns {number} - 该颜色的亮度值
 */
function luminance(r, g, b) {
    const a = [r, g, b].map(function (v) {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

/**
 * 根据背景颜色的十六进制值判断最佳文字颜色（黑色或白色）
 * @param {string} hexColor - 十六进制表示的背景颜色，如 "#FFFFFF"
 * @returns {string} - 最佳文字颜色，'black' 或 'white'
 */
function getBestTextColor(hexColor) {
    const [r, g, b] = hexToRGB(hexColor);
    const lum = luminance(r, g, b);
    return lum > 0.5 ? 'black' : 'white';
}


// 更新样式
function updateStyle(webContents, settingsPath) {
    // 读取settings.json
    const data = fs.readFileSync(settingsPath, "utf-8");
    const config = JSON.parse(data);
    const themeColor = config.themeColor;
    // 将themeColorDark1设置成themeColor和10%的黑色的混合色
    const themeColorDark1 = RGBToHex(blendColors(hexToRGB(themeColor), [0, 0, 0], 0.1));
    // 将themeColorDark2设置成themeColor和20%的黑色的混合色
    const themeColorDark2 = RGBToHex(blendColors(hexToRGB(themeColor), [0, 0, 0], 0.2));
    const backgroundOpacity = config.backgroundOpacity;
    // 将backgroundOpacity(是个0-100的整数值)转为两位hex值作为RGBA的透明度（注意不要出现小数）
    const backgroundOpacityHex = Math.round(backgroundOpacity * 2.55).toString(16).padStart(2, "0");

    const onThemeTextColor = getBestTextColor(themeColor) === "black" ? "#000000" : "#FFFFFF";

    const csspath = path.join(__dirname, "src/style.css");
    fs.readFile(csspath, "utf-8", (err, data) => {
        if (err) {
            return;
        }

        let preloadString = `:root {
            --theme-color: ${themeColor};
            --theme-color-dark1: ${themeColorDark1};
            --theme-color-dark2: ${themeColorDark2};
            --theme-color-alpha: ${themeColor + "3f"};
            --background-color-light: #FFFFFF${backgroundOpacityHex};
            --background-color-dark: #171717${backgroundOpacityHex};
            --theme-tag-color: ${themeColor + "3f"};
            --text-selected-color: ${themeColor + "7f"};
            --on-theme-text-color: ${onThemeTextColor};
        }`

        webContents.send(
            "LiteLoader.mspring_theme.updateStyle",
            // 将主题色插入到style.css中
            preloadString + "\n\n" + data
        );
    });
}


// 监听CSS修改-开发时候用的
function watchCSSChange(webContents, settingsPath) {
    const filepath = path.join(__dirname, "src/style.css");
    fs.watch(filepath, "utf-8", debounce(() => {
        updateStyle(webContents, settingsPath);
    }, 100));
}


// 监听配置文件修改
function watchSettingsChange(webContents, settingsPath) {
    fs.watch(settingsPath, "utf-8", debounce(() => {
        updateStyle(webContents, settingsPath);
    }, 100));
}

// 加载插件时触发
const pluginDataPath = LiteLoader.plugins["mspring_theme"].path.data;
const settingsPath = path.join(pluginDataPath, "settings.json");

// fs判断插件路径是否存在，如果不存在则创建（同时创建父目录（如果不存在的话））
if (!fs.existsSync(pluginDataPath)) {
    fs.mkdirSync(pluginDataPath, { recursive: true });
}
// 判断settings.json是否存在，如果不存在则创建
if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, JSON.stringify({
        "themeColor": "#cb82be",
        "backgroundOpacity": "70",
        "heti": false,
        "forceHostBubbleColor": false,
    }));
} else {
    const data = fs.readFileSync(settingsPath, "utf-8");
    const config = JSON.parse(data);
    // 判断后来加入的backgroundOpacity是否存在，如果不存在则添加
    if (!config.backgroundOpacity) {
        config.backgroundOpacity = "70";
        fs.writeFileSync(settingsPath, JSON.stringify(config));
    }
    // 判断后来加入的heti是否存在，如果不存在则添加
    if (!config.heti) {
        config.heti = false;
        fs.writeFileSync(settingsPath, JSON.stringify(config));
    }
    // 判断后来加入的forceHostBubbleColor是否存在，如果不存在则添加
    if (!config.forceHostBubbleColor) {
        config.forceHostBubbleColor = false;
        fs.writeFileSync(settingsPath, JSON.stringify(config));
    }
}

ipcMain.on(
    "LiteLoader.mspring_theme.rendererReady",
    (event, message) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        updateStyle(window.webContents, settingsPath);
    }
);

// 监听渲染进程的updateStyle事件
ipcMain.on(
    "LiteLoader.mspring_theme.updateStyle",
    (event, settingsPath) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        updateStyle(window.webContents, settingsPath);
    });

// 监听渲染进程的watchCSSChange事件
ipcMain.on(
    "LiteLoader.mspring_theme.watchCSSChange",
    (event, settingsPath) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        watchCSSChange(window.webContents, settingsPath);
    });

// 监听渲染进程的watchSettingsChange事件
ipcMain.on(
    "LiteLoader.mspring_theme.watchSettingsChange",
    (event, settingsPath) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        watchSettingsChange(window.webContents, settingsPath);
    });

ipcMain.handle(
    "LiteLoader.mspring_theme.getSettings",
    (event, message) => {
        try {
            const data = fs.readFileSync(settingsPath, "utf-8");
            const config = JSON.parse(data);
            return config;
        } catch (error) {
            log(error);
            return {};
        }
    }
);

ipcMain.handle(
    "LiteLoader.mspring_theme.setSettings",
    (event, content) => {
        try {
            const new_config = JSON.stringify(content);
            fs.writeFileSync(settingsPath, new_config, "utf-8");
        } catch (error) {
            log(error);
        }
    }
);

ipcMain.on("LiteLoader.mspring_theme.openWeb", (event, ...message) =>
    openWeb(...message)
);

ipcMain.handle("LiteLoader.mspring_theme.logToMain", (event, ...args) => {
    log(...args);
}
);

ipcMain.handle("LiteLoader.mspring_theme.fetchData", (event, url) => {
    return fetchData(url);
});

// 创建窗口时触发
module.exports.onBrowserWindowCreated = window => {
    const settingsPath = path.join(pluginDataPath, "settings.json");
    window.on("ready-to-show", () => {
        const url = window.webContents.getURL();
        if (url.includes("app://./renderer/index.html")) {
            watchCSSChange(window.webContents, settingsPath);
            watchSettingsChange(window.webContents, settingsPath);
        }
    });
}