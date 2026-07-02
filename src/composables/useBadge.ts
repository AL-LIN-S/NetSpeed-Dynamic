import { ref, computed } from 'vue';

/**
 * 统一角标插槽
 * 多个功能（番茄钟/久坐/喝水）共享网速岛右上角一个徽章位，
 * 按优先级排队显示，避免角标重叠。priority 数值越大越优先。
 */

export interface BadgeEntry {
    id: string;       // 'pomodoro' | 'sedentary' | 'water'
    text: string;     // 显示文本，如 "25:00"
    color: string;    // 文字颜色
    priority: number; // 越大越优先
}

// 模块级单例：同一 widget 窗口内多组件共享
const entries = ref<BadgeEntry[]>([]);

export function useBadge() {
    function setBadge(entry: BadgeEntry) {
        const idx = entries.value.findIndex(e => e.id === entry.id);
        if (idx >= 0) entries.value[idx] = entry;
        else entries.value.push(entry);
    }

    function removeBadge(id: string) {
        entries.value = entries.value.filter(e => e.id !== id);
    }

    // 始终只展示优先级最高的一条
    const activeBadge = computed<BadgeEntry | null>(() => {
        if (entries.value.length === 0) return null;
        return [...entries.value].sort((a, b) => b.priority - a.priority)[0];
    });

    return { activeBadge, setBadge, removeBadge };
}
