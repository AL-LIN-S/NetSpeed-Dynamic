import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';

/**
 * 久坐 / 喝水健康提醒
 *
 * 久坐检测逻辑（基于真实闲置时间，避免"人已离开还催"）：
 * - idle < 30s：判定为"在场操作"，累计在场秒数
 * - idle >= 60s：判定为"已离开"，清零在场累计并复位提醒位
 * - 在场累计 >= SIT_INTERVAL 且本次未提醒过 → 触发久坐提醒
 *
 * 喝水：纯计时，每隔 WATER_INTERVAL 触发一次。
 *
 * 提醒通过 currentReminder 暴露，灵动岛 watch 后走全岛弹出通道；
 * 展示期间 currentReminder 非空，新提醒被跳过，实现互斥。
 */

export interface HealthReminder {
    title: string;
    body: string;
    color: string;
}

const SIT_INTERVAL = 45 * 60;   // 久坐阈值（秒）
const WATER_INTERVAL = 30 * 60; // 喝水间隔（秒）
const CHECK_INTERVAL = 5000;    // 每 5 秒检查一次

const sitEnabled = ref(false);
const waterEnabled = ref(false);
const currentReminder = ref<HealthReminder | null>(null);

let handle: number | null = null;
let presentAccum = 0;     // 在场累计秒数
let sitReminded = false;  // 本轮久坐是否已提醒
let lastWaterAt = 0;      // 上次喝水提醒/重置时间戳

async function check() {
    if (currentReminder.value) return; // 展示中，互斥跳过

    // 喝水提醒（纯计时）
    if (waterEnabled.value && lastWaterAt && Date.now() - lastWaterAt >= WATER_INTERVAL * 1000) {
        currentReminder.value = { title: '喝水提醒', body: '该喝杯水了 💧', color: '#339af0' };
        lastWaterAt = Date.now();
        return;
    }

    // 久坐提醒（基于真实闲置）
    if (sitEnabled.value) {
        try {
            const idle = await invoke<number>('get_idle_seconds');
            if (idle >= 60) {
                // 判定离开：清零累计并复位提醒位
                presentAccum = 0;
                sitReminded = false;
            } else if (idle < 30) {
                presentAccum += CHECK_INTERVAL / 1000;
                if (presentAccum >= SIT_INTERVAL && !sitReminded) {
                    currentReminder.value = { title: '久坐提醒', body: '已久坐 45 分钟，起身活动一下 🧍', color: '#ff6b6b' };
                    sitReminded = true;
                }
            }
        } catch { /* 闲置检测失败时静默，不影响喝水 */ }
    }
}

function ensureRunning() {
    if (handle !== null) return;
    lastWaterAt = Date.now();
    presentAccum = 0;
    sitReminded = false;
    handle = window.setInterval(check, CHECK_INTERVAL);
}

function stop() {
    if (handle !== null) {
        clearInterval(handle);
        handle = null;
    }
    currentReminder.value = null;
}

export function useHealthReminders() {
    function configure(sit: boolean, water: boolean) {
        sitEnabled.value = sit;
        waterEnabled.value = water;
        if (sit || water) {
            ensureRunning();
        } else {
            stop();
        }
    }

    function clearReminder() {
        currentReminder.value = null;
    }

    return { currentReminder, configure, clearReminder };
}
