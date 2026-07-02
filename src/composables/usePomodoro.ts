import { ref, computed, onUnmounted, watch } from 'vue';
import { useBadge } from './useBadge';

/**
 * 番茄钟状态机——经典四阶段循环
 * Focus(25) → ShortBreak(5) → ...每4个专注后 LongBreak(15) → 循环
 *
 * 关键设计：
 * - 用 phaseEndsAt 时间戳校准，而非纯秒计数，避免休眠/后台漂移
 * - localStorage 持久化，窗口重开/崩溃可恢复
 * - 阶段结束自动衔接下一阶段（autostart），并触发 reminder 给灵动岛做全岛弹出
 * - 通过 useBadge 在网速岛右上角挂倒计时角标
 */

export type PomodoroPhase = 'focus' | 'short' | 'long' | 'idle';

interface PomodoroState {
    phase: PomodoroPhase;
    cycleCount: number;       // 已完成的专注段数（0~3 循环，到4进长休）
    isRunning: boolean;
    phaseEndsAt: number | null; // 毫秒时间戳
    remaining: number;        // 暂停时存的剩余秒
}

const STATE_KEY = 'nsd_pomodoro_state';

const DURATION: Record<PomodoroPhase, number> = {
    idle: 0,
    focus: 25 * 60,
    short: 5 * 60,
    long: 15 * 60,
};

const PHASE_META: Record<PomodoroPhase, { label: string; color: string; priority: number }> = {
    idle: { label: '待机', color: '#868e96', priority: 0 },
    focus: { label: '专注', color: '#ff6b6b', priority: 100 },
    short: { label: '短休', color: '#51cf66', priority: 100 },
    long: { label: '长休', color: '#339af0', priority: 100 },
};

export interface PomodoroReminder {
    phase: PomodoroPhase;
    title: string;
    body: string;
    color: string;
}

// 模块级单例状态
const phase = ref<PomodoroPhase>('idle');
const cycleCount = ref(0);
const isRunning = ref(false);
const remaining = ref(0);
const phaseEndsAt = ref<number | null>(null);
const currentReminder = ref<PomodoroReminder | null>(null);

let tickHandle: number | null = null;

function loadState(): PomodoroState | null {
    try {
        const raw = localStorage.getItem(STATE_KEY);
        return raw ? JSON.parse(raw) as PomodoroState : null;
    } catch {
        return null;
    }
}

function persist() {
    const state: PomodoroState = {
        phase: phase.value,
        cycleCount: cycleCount.value,
        isRunning: isRunning.value,
        phaseEndsAt: phaseEndsAt.value,
        remaining: remaining.value,
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

// 简单提示音：Web Audio 生成短促双 beep
let audioCtx: AudioContext | null = null;
function playBeep() {
    try {
        audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
        const ctx = audioCtx;
        const now = ctx.currentTime;
        [0, 0.18].forEach((offset, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = i === 0 ? 880 : 1100;
            osc.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.setValueAtTime(0.0001, now + offset);
            gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
            osc.start(now + offset);
            osc.stop(now + offset + 0.18);
        });
    } catch { /* 静默失败：音频不可用不影响计时 */ }
}

function nextPhaseOf(current: PomodoroPhase, completedFocus: number): Exclude<PomodoroPhase, 'idle'> {
    if (current === 'focus') {
        // 每4个专注进长休
        return completedFocus % 4 === 0 ? 'long' : 'short';
    }
    // short / long 之后回到专注
    return 'focus';
}

function startPhase(p: Exclude<PomodoroPhase, 'idle'>) {
    phase.value = p;
    remaining.value = DURATION[p];
    phaseEndsAt.value = Date.now() + DURATION[p] * 1000;
    isRunning.value = true;
    persist();
}

function advancePhase() {
    const finished = phase.value;
    if (finished === 'focus') {
        cycleCount.value += 1;
    }
    const nxt = nextPhaseOf(finished === 'idle' ? 'focus' : finished, cycleCount.value);

    // 触发提醒
    const meta = PHASE_META[nxt];
    const prevLabel = finished !== 'idle' ? PHASE_META[finished as Exclude<PomodoroPhase, 'idle'>].label : '';
    currentReminder.value = {
        phase: nxt,
        title: `${prevLabel}结束`,
        body: `开始${meta.label} · ${Math.round(DURATION[nxt] / 60)} 分钟`,
        color: meta.color,
    };
    playBeep();

    startPhase(nxt);
}

function tick() {
    if (!isRunning.value || phaseEndsAt.value === null) return;
    const ms = phaseEndsAt.value - Date.now();
    if (ms <= 0) {
        // 本阶段结束 → 推进
        advancePhase();
        return;
    }
    remaining.value = Math.ceil(ms / 1000);
    // 每5秒落盘一次（减少写）
    if (remaining.value % 5 === 0) persist();
}

function startTick() {
    if (tickHandle !== null) return;
    tickHandle = window.setInterval(tick, 1000);
}

function stopTick() {
    if (tickHandle !== null) {
        clearInterval(tickHandle);
        tickHandle = null;
    }
}

export function usePomodoro() {
    const { setBadge, removeBadge } = useBadge();

    const remainingText = computed(() => {
        const total = remaining.value;
        const m = Math.floor(total / 60).toString().padStart(2, '0');
        const s = (total % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    });

    const badgeColor = computed(() => {
        if (phase.value === 'idle') return '#868e96';
        return PHASE_META[phase.value as Exclude<PomodoroPhase, 'idle'>].color;
    });

    // 同步角标：运行中（含暂停的 idle 外阶段）挂角标
    watch([phase, isRunning], ([p, running]) => {
        if (p !== 'idle') {
            const meta = PHASE_META[p as Exclude<PomodoroPhase, 'idle'>];
            setBadge({
                id: 'pomodoro',
                text: remainingText.value,
                color: running ? meta.color : '#868e96',
                priority: meta.priority,
            });
        } else {
            removeBadge('pomodoro');
        }
    }, { immediate: true });

    // remaining 变化时同步角标文本
    watch(remainingText, (txt) => {
        if (phase.value !== 'idle') {
            const meta = PHASE_META[phase.value as Exclude<PomodoroPhase, 'idle'>];
            setBadge({
                id: 'pomodoro',
                text: txt,
                color: isRunning.value ? meta.color : '#868e96',
                priority: meta.priority,
            });
        }
    });

    function start() {
        if (phase.value === 'idle') {
            cycleCount.value = 0;
            startPhase('focus');
        } else {
            // 从暂停恢复
            phaseEndsAt.value = Date.now() + remaining.value * 1000;
            isRunning.value = true;
            persist();
        }
        startTick();
    }

    function pause() {
        isRunning.value = false;
        phaseEndsAt.value = null;
        persist();
        // 暂停不停止 tick，tick 内 isRunning=false 直接 return；保留 handle 以便恢复
    }

    function reset() {
        phase.value = 'idle';
        cycleCount.value = 0;
        isRunning.value = false;
        remaining.value = 0;
        phaseEndsAt.value = null;
        currentReminder.value = null;
        stopTick();
        removeBadge('pomodoro');
        localStorage.removeItem(STATE_KEY);
    }

    function skip() {
        // 手动跳过当前阶段
        if (phase.value === 'idle') return;
        advancePhase();
        startTick();
    }

    function clearReminder() {
        currentReminder.value = null;
    }

    // 恢复：组件 mount 时调用一次
    function restore() {
        const st = loadState();
        if (!st || st.phase === 'idle') return;
        phase.value = st.phase;
        cycleCount.value = st.cycleCount;
        if (st.isRunning && st.phaseEndsAt !== null) {
            const ms = st.phaseEndsAt - Date.now();
            if (ms <= 0) {
                // 恢复时本阶段已过期 → 直接推进
                remaining.value = 0;
                advancePhase();
            } else {
                remaining.value = Math.ceil(ms / 1000);
                phaseEndsAt.value = st.phaseEndsAt;
                isRunning.value = true;
            }
            startTick();
        } else {
            remaining.value = st.remaining;
            isRunning.value = false;
            phaseEndsAt.value = null;
        }
    }

    onUnmounted(() => {
        stopTick();
    });

    return {
        phase, isRunning, remaining, remainingText, badgeColor,
        cycleCount: computed(() => cycleCount.value),
        currentReminder,
        start, pause, reset, skip, clearReminder, restore,
    };
}
