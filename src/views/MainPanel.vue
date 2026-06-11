<template>
    <div class="panel-container">
        <header class="panel-header">
            <div class="brand">
                <img src="../assets/logo.png" class="logo-icon">
                <div>
                    <h1>NetSpeed Dynamic</h1>
                    <p class="subtitle">NSD 桌面动态组件 v1.0.0</p>
                </div>
            </div>

            <div class="header-controls">
                <span class="status-badge" :class="{ 'is-active': isWidgetVisible }">
                    {{ isWidgetVisible ? '已开启' : '已关闭' }}
                </span>
                <label class="switch header-switch">
                    <input type="checkbox" :checked="isWidgetVisible" @change="toggleWidget">
                    <span class="slider"></span>
                </label>
            </div>
        </header>

        <hr class="divider" />

        <div class="main-content">
            <div class="card status-card">
                <h3>当前实时状态</h3>
                <div class="speed-monitor">
                    <div class="speed-item">
                        <span class="arrow up">
                            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path
                                    d="M16 4C16.8 4 17.5 4.3 18.1 4.9L28.1 14.9C29.3 16.1 29.3 18 28.1 19.1C26.9 20.3 25 20.3 23.9 19.1L18 13.2V26C18 27.7 16.7 29 15 29C13.3 29 12 27.7 12 26V13.2L6.1 19.1C4.9 20.3 3 20.3 1.9 19.1C0.7 18 0.7 16.1 1.9 14.9L11.9 4.9C12.5 4.3 13.2 4 14 4H16Z"
                                    fill="currentColor" />
                            </svg>
                        </span>
                        <div class="speed-info">
                            <span class="label">上传速度</span>
                            <span class="value">{{ uploadSpeed }}</span>
                        </div>
                    </div>
                    <div class="speed-item">
                        <span class="arrow down">
                            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path
                                    d="M16 28C15.2 28 14.5 27.7 13.9 27.1L3.9 17.1C2.7 15.9 2.7 14 3.9 12.9C5.1 11.7 7 11.7 8.1 12.9L14 18.8V6C14 4.3 15.3 3 17 3C18.7 3 20 4.3 20 6V18.8L25.9 12.9C27.1 11.7 29 11.7 30.1 12.9C31.3 14 31.3 15.9 30.1 17.1L20.1 27.1C19.5 27.7 18.8 28 18 28H16Z"
                                    fill="currentColor" />
                            </svg>
                        </span>
                        <div class="speed-info">
                            <span class="label">下载速度</span>
                            <span class="value">{{ downloadSpeed }}</span>
                        </div>
                    </div>
                </div>
                <div ref="chartRef" class="mini-chart"></div>
            </div>

            <div class="card settings-card">
                <h3>常规设置</h3>

                <div class="setting-item is-disabled">
                    <div class="item-meta">
                        <span class="item-title">开机自动启动 <span class="tag-dev">未实现</span></span>
                        <span class="item-desc">跟随系统启动 NSD</span>
                    </div>
                    <label class="switch">
                        <input type="checkbox" v-model="autoStart" disabled>
                        <span class="slider"></span>
                    </label>
                </div>

                <div class="setting-item slider-item">
                    <div class="item-meta">
                        <span class="item-title">悬浮窗不透明度</span>
                        <span class="item-desc">调节灵动岛的外观透明度 ({{ opacity }}%)</span>
                    </div>
                    <input type="range" min="0" max="100" v-model="opacity" class="range-input" />
                </div>
            </div>
        </div>

        <footer class="panel-footer">
            <span>&copy; 2026 Ryen. All rights reserved.</span>
            <span class="action-link" @click="checkUpdate">检查更新</span>
        </footer>

        <Transition name="fade">
            <div v-if="dialog.visible" class="modal-overlay" @click.self="closeDialog">
                <div class="modal-card">
                    <div class="modal-header">
                        <h4>{{ dialog.title }}</h4>
                    </div>
                    <div class="modal-body">
                        <p>{{ dialog.message }}</p>
                    </div>
                    <div class="modal-footer">
                        <button v-if="dialog.isConfirm" class="btn btn-secondary" @click="closeDialog">取消</button>
                        <button class="btn btn-primary" @click="handleDialogConfirm">确定</button>
                    </div>
                </div>
            </div>
        </Transition>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';

const echarts = (window as any).echarts;

const isWidgetVisible = ref(false);
const autoStart = ref(false);
const opacity = ref(Number(localStorage.getItem('nsd_island_opacity') || '100'));

const uploadSpeed = ref('0 B/s');
const downloadSpeed = ref('0 B/s');

// 统一的弹窗状态控制
const dialog = ref({
    visible: false,
    title: 'NetSpeed Dynamic',
    message: '',
    isConfirm: false,
    callback: null as (() => void) | null
});

const showDialog = (title: string, message: string, isConfirm = false, onConfirm: (() => void) | null = null) => {
    dialog.value = { visible: true, title, message, isConfirm, callback: onConfirm };
};

const closeDialog = () => {
    dialog.value.visible = false;
};

const handleDialogConfirm = () => {
    if (dialog.value.callback) dialog.value.callback();
    closeDialog();
};

const parseVersion = (v: string) => {
    return v.replace(/^v/i, '').split('.').map(Number);
};

let lastRx = 0;
let lastTx = 0;
let speedTimer: number;

const chartRef = ref<HTMLElement | null>(null);
let chartInstance: any = null;
const chartDataQueue: number[] = Array(15).fill(0);

const formatSpeed = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B/s';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB/s';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB/s';
};

const initChart = () => {
    if (!chartRef.value || !echarts) return;
    chartInstance = echarts.init(chartRef.value);

    const option = {
        grid: { top: 5, bottom: 5, left: 0, right: 0 },
        xAxis: { type: 'category', boundaryGap: false, show: false },
        yAxis: { type: 'value', show: false, min: 0 },
        series: [
            {
                data: chartDataQueue,
                type: 'line',
                smooth: true,
                symbol: 'none',
                lineStyle: { color: '#3b82f6', width: 2 },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(59, 130, 246, 0.4)' },
                        { offset: 1, color: 'rgba(59, 130, 246, 0.0)' }
                    ]),
                },
            },
        ],
    };
    chartInstance.setOption(option);
};

const fetchSpeedStats = async () => {
    try {
        const [currentRx, currentTx] = await invoke<[number, number]>('get_network_stats');
        if (lastRx !== 0) {
            const rxDiff = currentRx - lastRx;
            const txDiff = currentTx - lastTx;
            downloadSpeed.value = formatSpeed(rxDiff);
            uploadSpeed.value = formatSpeed(txDiff);
            const speedMB = rxDiff / (1024 * 1024);

            chartDataQueue.push(Number(speedMB.toFixed(2)));
            if (chartDataQueue.length > 15) chartDataQueue.shift();

            chartInstance?.setOption({ series: [{ data: chartDataQueue }] });
        }
        lastRx = currentRx;
        lastTx = currentTx;
    } catch (error) {
        console.error('控制台流量获取失败:', error);
    }
};

// 【已升级】完美适配自定义 UI 的版本检测逻辑
const checkUpdate = async () => {
    try {
        const localVersionStr = await getVersion();
        const response = await fetch('https://api.github.com/repos/GEORGEWWWU/NetSpeed-Dynamic/releases/latest', {
            method: 'GET',
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Tauri-App-NetSpeed-Dynamic'
            }
        });

        if (response.status === 404) {
            showDialog('检查更新', '未找到可用发行版');
            return;
        }

        if (!response.ok) {
            showDialog('检查更新', '检查更新失败，请稍后再试');
            return;
        }

        const data = await response.json();
        const remoteVersionStr = data.tag_name;
        const local = parseVersion(localVersionStr);
        const remote = parseVersion(remoteVersionStr);

        let hasNewVersion = false;
        for (let i = 0; i < 3; i++) {
            const rNum = remote[i] || 0;
            const lNum = local[i] || 0;
            if (rNum > lNum) {
                hasNewVersion = true;
                break;
            } else if (rNum < lNum) {
                break;
            }
        }

        if (hasNewVersion) {
            showDialog(
                '发现新版本',
                `发现新版本 ${remoteVersionStr}！当前版本为 v${localVersionStr}。是否前往 GitHub 下载更新？`,
                true,
                () => { window.open(data.html_url, '_blank'); }
            );
        } else {
            showDialog('提示', '当前已是最新版本！');
        }
    } catch (error) {
        console.error('检查更新时出错:', error);
        showDialog('网络错误', '请求失败，请检查您的网络连接');
    }
};

watch(opacity, async (newVal) => {
    localStorage.setItem('nsd_island_opacity', newVal.toString());
    await emit('control-island-opacity', { opacity: newVal });
});

onMounted(async () => {
    initChart();
    fetchSpeedStats();
    speedTimer = setInterval(fetchSpeedStats, 1000) as unknown as number;
    window.addEventListener('resize', () => chartInstance?.resize());

    await listen<{ visible: boolean }>('island-status-sync', (event) => {
        isWidgetVisible.value = event.payload.visible;
    });

    for (let i = 0; i < 6; i++) {
        try {
            const visible = await invoke<boolean>('is_widget_visible');
            if (visible) {
                isWidgetVisible.value = true;
                return;
            }
        } catch { /* 忽略 */ }
        await new Promise(r => setTimeout(r, 200));
    }
    isWidgetVisible.value = false;
});

onUnmounted(() => {
    clearInterval(speedTimer);
    chartInstance?.dispose();
});

const toggleWidget = async () => {
    const nextState = !isWidgetVisible.value;
    await emit('control-island-visibility', { show: nextState });
    isWidgetVisible.value = nextState;
};
</script>

<style scoped>
/* 全局样式基础重置 */
:global(body) {
    background-color: #f8fafc;
    color: #1e293b;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
    margin: 0;
    padding: 0;
    user-select: none;
    -webkit-font-smoothing: antialiased;
}

.panel-container {
    padding: 28px 32px;
    max-width: 800px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    min-height: calc(100vh - 56px);
}

.panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
}

.brand {
    display: flex;
    align-items: center;
    gap: 16px;
}

.logo-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.brand h1 {
    font-size: 20px;
    margin: 0;
    font-weight: 700;
    letter-spacing: 0.2px;
    color: #0f172a;
}

.subtitle {
    font-size: 13px;
    color: #64748b;
    margin: 4px 0 0 0;
}

.header-controls {
    display: flex;
    align-items: center;
    gap: 16px;
    background: #ffffff;
    padding: 8px 12px 8px 16px;
    border-radius: 24px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    border: 1px solid #e2e8f0;
}

.status-badge {
    font-size: 13px;
    font-weight: 600;
    color: #94a3b8;
    transition: all 0.3s;
}

.status-badge.is-active {
    color: #2b2b2b;
}

.divider {
    border: none;
    border-top: 1px solid #e2e8f0;
    margin-bottom: 24px;
}

.main-content {
    display: grid;
    grid-template-columns: 1fr 1.3fr;
    gap: 24px;
    flex-grow: 1;
}

.card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 20px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.03);
    transition: transform 0.2s, box-shadow 0.2s;
}

.card:hover {
    box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.06);
}

.card h3 {
    font-size: 15px;
    color: #334155;
    margin: 0 0 20px 0;
    font-weight: 600;
}

.speed-monitor {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-bottom: 24px;
}

.speed-item {
    display: flex;
    align-items: center;
    gap: 16px;
}

.arrow {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 16px;
}

.arrow svg {
    width: 20px;
    height: 20px;
}

.arrow.up {
    background: #eff6ff;
    color: #3b82f6;
}

.arrow.down {
    background: #ecfdf5;
    color: #10b981;
}

.speed-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.speed-info .label {
    font-size: 12px;
    color: #64748b;
    font-weight: 500;
}

.speed-info .value {
    font-size: 18px;
    font-weight: 700;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: #0f172a;
    letter-spacing: -0.5px;
}

/* 波动图表 Canvas 容器 */
.mini-chart {
    width: 100%;
    height: 80px;
    margin-top: auto;
    padding-top: 16px;
    border-top: 1px solid #f1f5f9;
}

.setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 0;
    border-bottom: 1px solid #f1f5f9;
}

.setting-item:last-child {
    border-bottom: none;
    padding-bottom: 0;
}

.slider-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
}

.item-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.item-title {
    font-size: 14px;
    font-weight: 600;
    color: #1e293b;
    display: flex;
    align-items: center;
    gap: 8px;
}

.tag-dev {
    font-size: 10px;
    background: #f1f5f9;
    color: #64748b;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: normal;
}

.item-desc {
    font-size: 13px;
    color: #64748b;
}

.is-disabled {
    opacity: 0.5;
    pointer-events: none;
}

.switch {
    position: relative;
    display: inline-block;
    width: 48px;
    height: 28px;
}

.switch input {
    opacity: 0;
    width: 0;
    height: 0;
}

.slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #cbd5e1;
    transition: 0.4s cubic-bezier(0.4, 0.0, 0.2, 1);
    border-radius: 28px;
}

.slider:before {
    position: absolute;
    content: "";
    height: 22px;
    width: 22px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    transition: 0.4s cubic-bezier(0.4, 0.0, 0.2, 1);
    border-radius: 50%;
}

input:checked+.slider {
    background-color: #2b2b2b;
}

input:checked+.slider:before {
    transform: translateX(20px);
}

input:disabled+.slider {
    background-color: #e2e8f0;
    cursor: not-allowed;
}

.range-input {
    width: 100%;
    -webkit-appearance: none;
    appearance: none;
    background: #e2e8f0;
    height: 6px;
    border-radius: 3px;
    outline: none;
}

.range-input::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #ffffff;
    border: 2px solid #2b2b2b;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    transition: transform 0.1s;
}

.range-input::-webkit-slider-thumb:hover {
    transform: scale(1.1);
}

.panel-footer {
    margin-top: 32px;
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: #94a3b8;
    font-weight: 500;
}

.action-link {
    color: #2b2b2b89;
    cursor: pointer;
    transition: color 0.2s;
}

.action-link:hover {
    color: #2b2b2b89;
    text-decoration: underline;
}

/* 自定义弹窗核心样式 */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(15, 23, 42, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
}

.modal-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 20px;
    width: 360px;
    padding: 24px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
}

.modal-header h4 {
    margin: 0 0 12px 0;
    font-size: 16px;
    font-weight: 700;
    color: #0f172a;
}

.modal-body p {
    margin: 0 0 24px 0;
    font-size: 14px;
    color: #64748b;
    line-height: 1.5;
}

.modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
}

/* 按钮组样式，呼应你的页面 input:checked 的纯黑科技风 */
.btn {
    padding: 8px 18px;
    font-size: 13px;
    font-weight: 600;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    outline: none;
}

.btn-secondary {
    background: #f1f5f9;
    color: #64748b;
    border: 1px solid #e2e8f0;
}

.btn-secondary:hover {
    background: #e2e8f0;
    color: #334155;
}

.btn-primary {
    background: #2b2b2b;
    /* 对应你代码中开关按钮的黑色 */
    color: #ffffff;
    border: 1px solid #2b2b2b;
}

.btn-primary:hover {
    background: #1a1a1a;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* 弹窗渐变动效 */
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.25s ease, transform 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

.fade-enter-from .modal-card {
    transform: scale(0.95);
}

.fade-leave-to .modal-card {
    transform: scale(0.95);
}
</style>