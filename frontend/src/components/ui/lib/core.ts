import { capitalize, formatBytes, generateId } from './utils';

export type AccordionType = 'single' | 'multiple';

/**
 * 框架无关的 Accordion 基础 Props (仅包含组件库自定义属性)
 */
export interface AccordionBaseProps {
	type?: AccordionType;
	value?: string | string[];
	defaultValue?: string | string[];
	onValueChange?: (value: string | string[]) => void;
	collapsible?: boolean;
}

export interface AccordionItemBaseProps {
	value?: string;
	disabled?: boolean;
}

export interface AccordionTriggerBaseProps {}
export interface AccordionContentBaseProps {}

/**
 * AlertDialog 尺寸
 */
export type AlertDialogSize = 'default' | 'sm';

/**
 * 框架无关的 AlertDialog 基础 Props (仅包含组件库自定义属性)
 */
export interface AlertDialogBaseProps {}

export type AlertVariant = 'default' | 'destructive';

/**
 * 框架无关的 Alert 基础 Props（仅包含组件库自定义属性）
 */
export interface AlertBaseProps {
	/**
	 * 提示样式变体
	 */
	variant?: AlertVariant;
}

/**
 * 附件上传/展示状态
 */
export type AttachmentState = 'idle' | 'uploading' | 'processing' | 'error' | 'done';

/**
 * 附件尺寸
 */
export type AttachmentSize = 'default' | 'sm' | 'xs';

/**
 * 附件排版方向
 */
export type AttachmentOrientation = 'horizontal' | 'vertical';

/**
 * 附件媒体区变体
 */
export type AttachmentMediaVariant = 'icon' | 'image';

/**
 * 附件文件类型（用于图标映射）
 */
export type AttachmentFileKind = 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'archive' | 'code' | 'generic';

/**
 * 框架无关的 Attachment 基础 Props
 */
export interface AttachmentBaseProps {
	state?: AttachmentState;
	size?: AttachmentSize;
	orientation?: AttachmentOrientation;
}

/**
 * 框架无关的 AttachmentCard Props
 */
export interface AttachmentCardBaseProps {
	name?: string;
	size?: number;
	state?: AttachmentState;
	orientation?: AttachmentOrientation;
	downloading?: boolean;
}

/**
 * 头像图片加载状态
 */
export type AvatarImageStatus = 'loading' | 'loaded' | 'error';

/**
 * Avatar 组件样式类名键
 */
export const avatarStyleKeys = {
	root: 'root',
	image: 'image',
	fallback: 'fallback',
	badge: 'badge',
	group: 'group',
	groupCount: 'groupCount',
} as const;

/**
 * 根据图片加载状态判断是否显示 Fallback
 */
export function shouldShowAvatarFallback(status: AvatarImageStatus | undefined, hasImage: boolean): boolean {
	return !hasImage || status !== 'loaded';
}

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';

/**
 * 框架无关的 Badge 基础 Props (仅包含组件库自定义属性)
 */
export interface BadgeBaseProps {
	variant?: BadgeVariant;
	asChild?: boolean;
}

/** 聊天气泡样式变体 */
export type BubbleVariant = 'default' | 'secondary' | 'muted' | 'tinted' | 'outline' | 'ghost' | 'destructive';

/** 气泡水平对齐方式 */
export type BubbleAlign = 'start' | 'end';

/** 气泡反应气泡的垂直位置 */
export type BubbleReactionsSide = 'top' | 'bottom';

/**
 * 框架无关的 Bubble 基础 Props (仅包含组件库自定义属性)
 */
export interface BubbleBaseProps {
	/** 气泡样式变体 */
	variant?: BubbleVariant;
	/** 水平对齐方式 */
	align?: BubbleAlign;
}

/**
 * 框架无关的 BubbleContent 基础 Props (仅包含组件库自定义属性)
 */
export interface BubbleContentBaseProps {
	/** 是否合并渲染到子元素上 (需唯一根节点) */
	asChild?: boolean;
}

/**
 * 框架无关的 BubbleReactions 基础 Props (仅包含组件库自定义属性)
 */
export interface BubbleReactionsBaseProps {
	/** 相对气泡的垂直位置 */
	side?: BubbleReactionsSide;
	/** 水平对齐方式 */
	align?: BubbleAlign;
}

export type ButtonGroupOrientation = 'horizontal' | 'vertical';

/**
 * 框架无关的 ButtonGroup 基础 Props（仅包含组件库自定义属性）
 */
export interface ButtonGroupBaseProps {
	/**
	 * 按钮组排列方向
	 */
	orientation?: ButtonGroupOrientation;
}

/**
 * 框架无关的 ButtonGroupText 基础 Props（仅包含组件库自定义属性）
 */
export interface ButtonGroupTextBaseProps {
	/**
	 * 是否将根元素渲染为子元素（Slot 模式）
	 */
	asChild?: boolean;
}

/**
 * 框架无关的 ButtonGroupSeparator 基础 Props（仅包含组件库自定义属性）
 */
export interface ButtonGroupSeparatorBaseProps {
	/**
	 * 分隔线方向
	 */
	orientation?: ButtonGroupOrientation;
}

export type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
export type ButtonSize = 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg';

/**
 * 框架无关的 Button 基础 Props (仅包含组件库自定义属性)
 */
export interface ButtonBaseProps {
	variant?: ButtonVariant;
	size?: ButtonSize;
	loading?: boolean;
	asChild?: boolean;
}

/**
 * 支持的图表类型
 */
export type ChartType = 'line' | 'bar' | 'area';

/**
 * 主题色 (亮色 / 暗色)
 */
export interface ChartThemeColor {
	light: string;
	dark: string;
}

/**
 * ChartConfig 中单个数据项配置
 */
export interface ChartConfigItem {
	/** 展示名称 */
	label?: string;
	/** 固定颜色 */
	color?: string;
	/** 按主题区分的颜色 (优先于 color) */
	theme?: ChartThemeColor;
}

/**
 * 图表配置：键名对应数据字段名
 */
export type ChartConfig = Record<string, ChartConfigItem>;

/**
 * 系列配置：指定要绘制的数据字段
 */
export interface ChartSeriesItem {
	/** 数据字段名 (对应 ChartConfig 中的键) */
	key: string;
	/** 覆盖系列名称 (默认取 config.label) */
	name?: string;
	/** 覆盖系列颜色 (默认取 config.color/theme) */
	color?: string;
	/** 覆盖系列类型 (默认取容器 type) */
	type?: ChartType;
}

/**
 * 图表数据行：字段值为数字或分类值 (x 轴分类允许为字符串)
 */
export type ChartDatum = Record<string, number | string>;

/**
 * 图表内边距
 */
export interface ChartPadding {
	top?: number;
	right?: number;
	bottom?: number;
	left?: number;
}

/**
 * 图表布局计算入参
 */
export interface ChartLayoutOptions {
	/** 图表配置 */
	config: ChartConfig;
	/** 数据 */
	data: ChartDatum[];
	/** 系列配置 */
	series: ChartSeriesItem[];
	/** X 轴分类字段 */
	xKey: string;
	/** 图表类型 (line/bar/area) */
	type: ChartType;
	/** 画布宽度 */
	width: number;
	/** 画布高度 */
	height: number;
	/** 内边距 */
	padding?: ChartPadding;
	/** Y 轴刻度数量 */
	yTickCount?: number;
	/** 是否仅显示整数刻度 */
	integerOnly?: boolean;
	/** 当前主题 (light/dark，用于取 theme 颜色) */
	theme?: 'light' | 'dark';
	/** 图表专属 CSS 变量作用域，避免嵌套图表之间继承颜色 */
	cssVariableScope?: string;
}

/**
 * 单个映射后的数据点坐标
 */
export interface ChartPoint {
	/** 数据索引 */
	index: number;
	/** X 坐标 */
	x: number;
	/** Y 坐标 */
	y: number;
	/** 原始数值 */
	value: number;
}

/**
 * 系列布局结果
 */
export interface ChartSeriesLayout {
	/** 数据字段名 */
	key: string;
	/** 展示名称 */
	name: string;
	/** 颜色 */
	color: string;
	/** 类型 */
	type: ChartType;
	/** 映射后的点 */
	points: ChartPoint[];
}

/**
 * 图表完整布局结果
 */
export interface ChartLayout {
	/** 画布宽度 */
	width: number;
	/** 画布高度 */
	height: number;
	/** 有效绘图区域 */
	innerWidth: number;
	innerHeight: number;
	padding: Required<ChartPadding>;
	/** X 轴分类标签 */
	xLabels: Array<number | string>;
	/** X 轴刻度 X 坐标 */
	xTickX: number[];
	/** Y 轴数值刻度 */
	yTicks: number[];
	/** Y 轴刻度 Y 坐标 */
	yTickY: number[];
	/** 数值范围 */
	yMin: number;
	yMax: number;
	/** 各系列映射结果 */
	series: ChartSeriesLayout[];
}

/**
 * Tooltip 中单个条目
 */
export interface ChartTooltipEntry {
	/** 系列名 */
	name: string;
	/** 数据字段 */
	dataKey: string;
	/** 数值 */
	value: number;
	/** 颜色 */
	color: string;
	/** 原始数据行 */
	payload: ChartDatum;
}

/**
 * 柱状图单个矩形条
 */
export interface ChartBarRect {
	/** 数据索引 */
	index: number;
	/** 矩形左上角 X */
	x: number;
	/** 矩形左上角 Y */
	y: number;
	/** 矩形宽度 */
	width: number;
	/** 矩形高度 */
	height: number;
	/** 原始数值 */
	value: number;
}

/**
 * 图例条目
 */
export interface ChartLegendItem {
	/** 数据字段名 */
	key: string;
	/** 展示名称 */
	name: string;
	/** 颜色 */
	color: string;
}

/**
 * ChartContainer 基础 Props (框架无关部分)
 */
export interface ChartContainerBaseProps {
	/** 图表配置 */
	config: ChartConfig;
	/** 图表数据 */
	data?: ChartDatum[];
	/** 数据行中的分类字段 */
	xKey?: string;
	/** 系列配置 (缺省时根据 config 自动生成) */
	series?: ChartSeriesItem[];
	/** 图表类型 */
	type?: ChartType;
	/** 初始尺寸 (容器未测量时的兜底值) */
	initialDimension?: { width: number; height: number };
	/** 是否显示图例 */
	showLegend?: boolean;
	/** 是否显示 Tooltip */
	showTooltip?: boolean;
	/** 是否显示网格线 */
	showGrid?: boolean;
	/** 是否显示坐标轴刻度 */
	showAxis?: boolean;
}

/**
 * 图表组件样式类名键
 */
export const chartStyleKeys = {
	root: 'root',
	surface: 'surface',
	gridLine: 'gridLine',
	axisLine: 'axisLine',
	legend: 'legend',
	legendItem: 'legendItem',
	legendSwatch: 'legendSwatch',
	tooltip: 'tooltip',
	tooltipLabel: 'tooltipLabel',
	tooltipGrid: 'tooltipGrid',
	tooltipItem: 'tooltipItem',
	tooltipItemName: 'tooltipItemName',
	tooltipItemValue: 'tooltipItemValue',
	tooltipIndicator: 'tooltipIndicator',
} as const;

/** 默认初始尺寸 */
export const CHART_INITIAL_DIMENSION = { width: 320, height: 200 } as const;

/** 主题模式 */
export const CHART_THEMES = { light: '', dark: '.dark' } as const;

/** 默认内边距 */
export const CHART_DEFAULT_PADDING: Required<ChartPadding> = { top: 16, right: 16, bottom: 32, left: 40 };

/**
 * 默认调色板 (按系列顺序依次取色)
 */
export const CHART_DEFAULT_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4'] as const;

const CHART_CSS_PALETTE_SIZE = 5;

/**
 * 根据主题取配置项颜色
 */
export function getChartConfigColor(item: ChartConfigItem | undefined, theme: 'light' | 'dark' = 'light'): string | undefined {
	return item?.theme?.[theme] ?? item?.color;
}

/**
 * 获取系列颜色 (优先系列自定义颜色，其次 config，最后默认调色板)
 */
export function getChartSeriesColor(config: ChartConfig, series: ChartSeriesItem, index: number, theme: 'light' | 'dark' = 'light', cssVariableScope?: string): string {
	if (series.color) {
		return series.color;
	}
	const paletteIndex = index % CHART_CSS_PALETTE_SIZE;
	const paletteFallback = `var(--chart-${paletteIndex + 1}, ${CHART_DEFAULT_COLORS[paletteIndex]})`;
	const fallback = getChartConfigColor(config[series.key], theme) ?? paletteFallback;
	return `var(${getChartCssVarName(series.key, cssVariableScope)}, ${fallback})`;
}

/**
 * 获取系列展示名称
 */
export function getChartSeriesName(config: ChartConfig, series: ChartSeriesItem): string {
	return series.name ?? config[series.key]?.label ?? series.key;
}

/**
 * 根据 config 生成默认系列列表
 */
export function getChartDefaultSeries(config: ChartConfig, type: ChartSeriesItem['type']): ChartSeriesItem[] {
	return Object.keys(config).map((key) => ({ key, type }));
}

/**
 * 收集所有数值字段值，计算数值范围
 */
export function getChartExtents(data: ChartDatum[], yKeys: string[]): { min: number; max: number } {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;

	for (const row of data) {
		for (const key of yKeys) {
			const value = row[key];
			if (typeof value !== 'number' || Number.isNaN(value)) {
				continue;
			}
			if (value < min) min = value;
			if (value > max) max = value;
		}
	}

	if (!Number.isFinite(min)) {
		min = 0;
	}
	if (!Number.isFinite(max)) {
		max = 1;
	}

	return { min, max };
}

/**
 * 计算某数值的 10 的幂次步长
 */
export function getChartStepSize(range: number, targetTicks: number): number {
	const rawStep = range / Math.max(1, targetTicks - 1);
	const magnitude = 10 ** Math.floor(Math.log10(rawStep));
	const residual = rawStep / magnitude;

	if (residual <= 1) return magnitude;
	if (residual <= 2) return 2 * magnitude;
	if (residual <= 5) return 5 * magnitude;
	return 10 * magnitude;
}

/**
 * 生成 "好看" 的刻度数组 (上限下限向外取整)
 */
export function getNiceChartTicks(min: number, max: number, tickCount: number = 5, integerOnly: boolean = false): number[] {
	if (min === max) {
		const span = Math.abs(min) * 0.1 || 1;
		return getNiceChartTicks(min - span, max + span, tickCount, integerOnly);
	}

	const step = getChartStepSize(max - min, tickCount);
	const floor = Math.floor(min / step) * step;
	const ceil = Math.ceil(max / step) * step;
	const ticks: number[] = [];

	for (let value = floor; value <= ceil + step / 2; value += step) {
		const tick = integerOnly ? Math.round(value) : value;
		const rounded = Number.parseFloat(tick.toFixed(6));
		if (!ticks.includes(rounded)) {
			ticks.push(rounded);
		}
	}

	return ticks;
}

/**
 * 计算 Y 轴刻度位置 (SVG Y 坐标)
 */
export function getChartYAxisLayout(ticks: number[], min: number, max: number, innerHeight: number, paddingTop: number): { yTickY: number[]; yMin: number; yMax: number } {
	let yMin = min;
	let yMax = max;
	const first = ticks[0];
	const last = ticks[ticks.length - 1];

	if (first !== undefined && first < min) yMin = first;
	if (last !== undefined && last > max) yMax = last;

	const span = yMax - yMin || 1;
	const yTickY = ticks.map((tick) => paddingTop + innerHeight - ((tick - yMin) / span) * innerHeight);

	return { yTickY, yMin, yMax };
}

/**
 * 将数值线性映射到绘图区域
 */
export function mapChartValue(value: number, min: number, max: number, innerHeight: number, paddingTop: number): number {
	const span = max - min || 1;
	return paddingTop + innerHeight - ((value - min) / span) * innerHeight;
}

/**
 * 获取零值基线，并将超出数据范围的零线限制在绘图区边缘
 */
export function getChartBaselineY(layout: ChartLayout): number {
	const plotTop = layout.padding.top;
	const plotBottom = plotTop + layout.innerHeight;
	return Math.min(plotBottom, Math.max(plotTop, mapChartValue(0, layout.yMin, layout.yMax, layout.innerHeight, plotTop)));
}

/**
 * 计算完整图表布局 (纯数学，供两个框架复用)
 */
export function computeChartLayout(options: ChartLayoutOptions): ChartLayout {
	const { data, config, series, xKey, type, width, height, yTickCount = 5, integerOnly = false, theme = 'light', cssVariableScope } = options;
	const padding: Required<ChartPadding> = { ...CHART_DEFAULT_PADDING, ...options.padding };

	const innerWidth = Math.max(0, width - padding.left - padding.right);
	const innerHeight = Math.max(0, height - padding.top - padding.bottom);

	const resolvedSeries = series.length > 0 ? series : getChartDefaultSeries(config, type);
	const yKeys = resolvedSeries.map((item) => item.key);
	const { min, max } = getChartExtents(data, yKeys);
	const ticks = getNiceChartTicks(min, max, yTickCount, integerOnly);
	const { yTickY, yMin, yMax } = getChartYAxisLayout(ticks, min, max, innerHeight, padding.top);

	const xLabels = data.map((row) => row[xKey]);
	const categoryWidth = innerWidth / Math.max(1, data.length);
	const xTickX = data.map((_row, index) => padding.left + (index + 0.5) * categoryWidth);

	const seriesLayout = resolvedSeries.map((item, index) => {
		const points: ChartPoint[] = data.map((row, dataIndex) => {
			const value = typeof row[item.key] === 'number' ? (row[item.key] as number) : 0;
			return {
				index: dataIndex,
				x: xTickX[dataIndex] ?? padding.left,
				y: mapChartValue(value, yMin, yMax, innerHeight, padding.top),
				value,
			};
		});
		return {
			key: item.key,
			name: getChartSeriesName(config, item),
			color: getChartSeriesColor(config, item, index, theme, cssVariableScope),
			type: item.type ?? type,
			points,
		};
	});

	return {
		width,
		height,
		innerWidth,
		innerHeight,
		padding,
		xLabels,
		xTickX,
		yTicks: ticks,
		yTickY,
		yMin,
		yMax,
		series: seriesLayout,
	};
}

/**
 * 构建 Tooltip 条目列表 (基于悬浮的数据索引)
 */
export function getChartTooltipEntries(layout: ChartLayout, config: ChartConfig, data: ChartDatum[], activeIndex: number | null): ChartTooltipEntry[] {
	if (activeIndex === null) {
		return [];
	}

	const entries: ChartTooltipEntry[] = [];

	for (const item of layout.series) {
		const point = item.points[activeIndex];
		if (!point) {
			continue;
		}
		entries.push({
			name: item.name,
			dataKey: item.key,
			value: point.value,
			color: item.color,
			payload: data[activeIndex] ?? {},
		});
	}

	return entries;
}

/**
 * 生成系列路径数据 (line/area 使用)
 */
export function getChartPathD(points: ChartPoint[], closed: boolean = false): string {
	const d = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');

	if (!closed || points.length === 0) {
		return d;
	}

	const first = points[0];
	const last = points[points.length - 1];
	return `${d} L${last.x},${first.y} L${first.x},${first.y} Z`;
}

/**
 * 查找与当前坐标最近的 X 轴数据索引
 */
export function findChartNearestIndex(layout: ChartLayout, mouseX: number): number {
	let nearest = 0;
	let minDistance = Number.POSITIVE_INFINITY;

	layout.xTickX.forEach((x, index) => {
		const distance = Math.abs(x - mouseX);
		if (distance < minDistance) {
			minDistance = distance;
			nearest = index;
		}
	});

	return nearest;
}

/**
 * 生成面积图路径数据 (沿基线闭合)
 */
export function getChartAreaPathD(points: ChartPoint[], baselineY: number): string {
	if (points.length === 0) {
		return '';
	}

	const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');
	const first = points[0];
	const last = points[points.length - 1];

	return `${line} L${last.x},${baselineY} L${first.x},${baselineY} Z`;
}

/**
 * 计算柱状图矩形条布局 (多系列时在分类宽度内并排分组)
 */
export function getChartBarRects(layout: ChartLayout, seriesIndex: number, seriesCount: number, barGapRatio: number = 0.2): ChartBarRect[] {
	const series = layout.series[seriesIndex];
	if (!series) {
		return [];
	}

	const categoryCount = Math.max(1, layout.xLabels.length);
	const categoryWidth = layout.innerWidth / categoryCount;
	const groupWidth = categoryWidth * (1 - barGapRatio);
	const barWidth = groupWidth / Math.max(1, seriesCount);
	const barSeriesIndex = layout.series.slice(0, seriesIndex).filter((item) => item.type === 'bar').length;
	const groupOffset = barSeriesIndex * barWidth - groupWidth / 2;
	const baseline = getChartBaselineY(layout);

	return series.points.map((point) => {
		const yTop = Math.min(point.y, baseline);
		const yBottom = Math.max(point.y, baseline);

		return {
			index: point.index,
			x: point.x + groupOffset,
			y: yTop,
			width: barWidth,
			height: yBottom - yTop,
			value: point.value,
		};
	});
}

/**
 * 获取系列的图例条目 (名称 + 颜色)
 */
export function getChartLegendItems(layout: ChartLayout): ChartLegendItem[] {
	return layout.series.map((item) => ({
		key: item.key,
		name: item.name,
		color: item.color,
	}));
}

/**
 * 获取配置键对应的 CSS 变量名 (如 `--color-desktop`)
 */
export function getChartCssVarName(key: string, scope?: string): string {
	const toIdentifier = (value: string, fallback: string) =>
		Array.from(value, (character) => (/^[a-zA-Z0-9-]$/.test(character) ? character : `_u${character.codePointAt(0)?.toString(16)}_`)).join('') || fallback;
	const keyIdentifier = toIdentifier(key, 'series');
	return scope ? `--chart-${toIdentifier(scope, 'scope')}-color-${keyIdentifier}` : `--color-${keyIdentifier}`;
}

function getSafeChartCssValue(value: string | undefined): string | undefined {
	return value && !/[;{}\r\n]/.test(value) ? value : undefined;
}

/**
 * 生成 ChartStyle 注入的主题 CSS (每个图表使用独立变量，主题边界通过继承就近生效)
 */
export function buildChartThemeCss(id: string, config: ChartConfig): string {
	const colorConfig = Object.entries(config).filter(([, item]) => item.theme ?? item.color);

	if (colorConfig.length === 0) {
		return '';
	}

	const declarations = (theme: keyof typeof CHART_THEMES) =>
		colorConfig
			.map(([key, item]) => {
				const color = getSafeChartCssValue(getChartConfigColor(item, theme));
				return color ? `  ${getChartCssVarName(key, id)}: ${color};` : null;
			})
			.filter((line): line is string => line !== null)
			.join('\n');
	const lightDeclarations = declarations('light');
	const darkDeclarations = declarations('dark');

	// Supply the light config when no mode boundary exists, without overriding inherited
	// dark variables on the chart itself. Each nested boundary still wins by inheritance.
	const css = [`:root {\n${lightDeclarations}\n}`, `.light, [data-theme="light"] {\n${lightDeclarations}\n}`, `.dark, [data-theme="dark"] {\n${darkDeclarations}\n}`].join('\n');

	// style 元素是 HTML raw-text，上屏前转义 `<`，同时由 CSS 解析器还原原值。
	return css.replace(/</g, '\\3c ');
}

/**
 * 计算 Tooltip 的展示位置 (限制在容器内)
 */
export function getChartTooltipPosition(layout: ChartLayout, mouseX: number, mouseY: number): { left: number; top: number } {
	const tooltipWidth = 160;
	const tooltipHeight = 80;
	const margin = 8;

	let left = mouseX + margin;
	let top = mouseY + margin;

	if (left + tooltipWidth > layout.width) {
		left = mouseX - tooltipWidth - margin;
	}
	if (top + tooltipHeight > layout.height) {
		top = mouseY - tooltipHeight - margin;
	}

	return { left: Math.max(0, left), top: Math.max(0, top) };
}

/**
 * Calendar 选择模式：单选 / 多选 / 范围选择
 */
export type CalendarMode = 'single' | 'multiple' | 'range';

/**
 * 范围选择的起止日期
 */
export interface CalendarRange {
	from?: Date;
	to?: Date;
}

/**
 * Calendar 的选中值（随模式不同而不同）
 */
export type CalendarSelection = Date | Date[] | CalendarRange | undefined;

/**
 * 禁用日期匹配函数：返回 true 表示该日期不可选
 */
export type CalendarDisabledMatcher = (date: Date) => boolean;

/**
 * 框架无关的 Calendar 基础 Props (仅包含组件库自定义属性)
 */
export interface CalendarBaseProps {
	/** 选择模式，默认 'single' */
	mode?: CalendarMode;
	/** 受控选中值 */
	selected?: CalendarSelection;
	/** 非受控初始选中值 */
	defaultSelected?: CalendarSelection;
	/** 初始展示的月份（仅控制起始月份，选中后跟随选择变化） */
	defaultMonth?: Date;
	/** 是否展示相邻月份的天数，默认 true */
	showOutsideDays?: boolean;
	/** 禁用日期匹配函数 */
	disabled?: CalendarDisabledMatcher;
	/** 选中变化回调 */
	onSelect?: (selection: CalendarSelection) => void;
}

/**
 * Calendar 单个日期的修饰状态
 */
export interface CalendarDayModifiers {
	/** 是否被选中 */
	selected: boolean;
	/** 是否为范围起点 */
	rangeStart: boolean;
	/** 是否为范围终点 */
	rangeEnd: boolean;
	/** 是否为范围中间 */
	rangeMiddle: boolean;
	/** 是否属于相邻月份 */
	outside: boolean;
	/** 是否被禁用 */
	disabled: boolean;
	/** 是否为今天 */
	today: boolean;
}

export type CardElement = 'div' | 'article' | 'section';

/**
 * 框架无关的 Card 基础 Props (仅包含组件库自定义属性)
 */
export interface CardBaseProps {
	as?: CardElement;
}

export interface CardHeaderBaseProps {}
export interface CardTitleBaseProps {}
export interface CardDescriptionBaseProps {}
export interface CardActionBaseProps {}
export interface CardContentBaseProps {}
export interface CardFooterBaseProps {}

/**
 * Carousel 滚动方向
 */
export type CarouselOrientation = 'horizontal' | 'vertical';

/**
 * 框架无关的 Carousel 基础 Props (仅包含组件库自定义属性)
 */
export interface CarouselBaseProps {
	/** 滚动方向，默认 'horizontal' */
	orientation?: CarouselOrientation;
}

export type CheckboxCheckedState = boolean | 'indeterminate';

/**
 * 框架无关的 Checkbox 基础 Props (仅包含组件库自定义属性)
 */
export interface CheckboxBaseProps {}

/**
 * Combobox 单项配置
 */
export interface ComboboxItem {
	/** 唯一值 */
	value: string;
	/** 展示文本 */
	label: string;
	/** 是否禁用 */
	disabled?: boolean;
	/** 额外搜索关键字 */
	keywords?: string[];
}

/**
 * Combobox 过滤结果
 */
export interface ComboboxFilterResult {
	/** 匹配项 (受 maxItems 限制) */
	items: ComboboxItem[];
	/** 匹配总数 (不含 maxItems 截断) */
	total: number;
}

/**
 * Combobox 基础 Props (框架无关部分)
 */
export interface ComboboxBaseProps {
	/** 全部候选项 */
	items: ComboboxItem[];
	/** 选中值 */
	value?: string;
	/** 选中值变化回调 */
	onValueChange?: (value: string) => void;
	/** 触发器占位文本 */
	placeholder?: string;
	/** 搜索框占位文本 */
	searchPlaceholder?: string;
	/** 无任何候选项时显示的文本 */
	emptyText?: string;
	/** 搜索无匹配时显示的文本 */
	notFoundText?: string;
	/** 下拉列表最大展示条数 */
	maxItems?: number;
	/** 是否禁用 */
	disabled?: boolean;
	/** 自定义匹配函数 */
	filter?: (item: ComboboxItem, query: string) => boolean;
}

/**
 * Command 单项配置 (供命令式数据驱动使用)
 */
export interface CommandItemDef {
	/** 唯一值 */
	value: string;
	/** 展示文本 */
	label?: string;
	/** 搜索关键字 */
	keywords?: string[];
	/** 是否禁用 */
	disabled?: boolean;
	/** 所属分组 */
	group?: string;
	/** 快捷键文本 */
	shortcut?: string;
}

/**
 * 命令分组定义
 */
export interface CommandGroupDef {
	/** 分组值 */
	value: string;
	/** 分组标题 */
	label?: string;
	/** 该分组下的项 */
	items: CommandItemDef[];
}

/**
 * Command 过滤结果
 */
export interface CommandFilterResult {
	/** 命中分组 */
	groups: CommandGroupDef[];
	/** 全部命中项 (扁平) */
	items: CommandItemDef[];
	/** 是否为空 */
	empty: boolean;
}

/**
 * 自定义过滤函数签名 (与 cmdk 类似)
 */
export type CommandFilterFn = (value: string, search: string, keywords?: string[]) => boolean;

/**
 * Command 基础 Props (框架无关部分)
 */
export interface CommandBaseProps {
	/** 候选项 */
	items?: CommandItemDef[];
	/** 分组 */
	groups?: CommandGroupDef[];
	/** 自定义过滤函数 */
	filter?: CommandFilterFn;
	/** 是否循环导航 */
	loop?: boolean;
}

/** 文档阅读方向 */
export type DirectionValue = 'ltr' | 'rtl';

/**
 * 框架无关的 DirectionProvider 基础 Props (仅包含组件库自定义属性)
 */
export interface DirectionBaseProps {
	/** 阅读方向 */
	dir?: DirectionValue;
}

/**
 * Drawer 弹出方向
 */
export type DrawerDirection = 'top' | 'bottom' | 'left' | 'right';

/**
 * 框架无关的 Drawer 基础 Props (仅包含组件库自定义属性)
 */
export interface DrawerBaseProps {
	/**
	 * 弹出方向
	 */
	direction?: DrawerDirection;
	/**
	 * 是否模态 (模态时展示遮罩并拦截遮罩点击关闭)
	 */
	modal?: boolean;
	/**
	 * 受控打开状态
	 */
	open?: boolean;
	/**
	 * 非受控初始打开状态
	 */
	defaultOpen?: boolean;
	/**
	 * 打开状态变化回调
	 */
	onOpenChange?: (open: boolean) => void;
}

/**
 * DropdownMenu 弹出方向
 */
export type DropdownMenuSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * DropdownMenu 与触发元素主轴方向的对齐方式
 */
export type DropdownMenuAlign = 'start' | 'center' | 'end';

/**
 * DropdownMenu 开关状态
 */
export type DropdownMenuState = 'open' | 'closed';

/**
 * DropdownMenu 选中/勾选状态
 */
export type DropdownMenuCheckState = 'checked' | 'unchecked';

/**
 * DropdownMenu 菜单项样式变体
 */
export type DropdownMenuItemVariant = 'default' | 'destructive';

/**
 * 框架无关的 DropdownMenu 基础 Props (仅包含组件库自定义属性)
 */
export interface DropdownMenuBaseProps {
	/** 是否受控打开 */
	open?: boolean;
	/** 默认是否打开 (非受控) */
	defaultOpen?: boolean;
	/** 打开状态变化时的回调 */
	onOpenChange?: (open: boolean) => void;
}

/**
 * 框架无关的 DropdownMenuTrigger 基础 Props
 */
export interface DropdownMenuTriggerBaseProps {
	/** 是否合并渲染到子元素上 (需唯一根节点) */
	asChild?: boolean;
}

/**
 * 框架无关的 DropdownMenuContent 基础 Props
 */
export interface DropdownMenuContentBaseProps {
	/** 弹出方向 */
	side?: DropdownMenuSide;
	/** 与触发元素主轴方向的对齐方式 */
	align?: DropdownMenuAlign;
	/** 与触发元素之间的间距 (px) */
	sideOffset?: number;
	/** 对齐方向上的额外偏移 (px) */
	alignOffset?: number;
}

/**
 * 框架无关的 DropdownMenuItem 基础 Props
 */
export interface DropdownMenuItemBaseProps {
	/** 是否缩进 (配合前置图标使用) */
	inset?: boolean;
	/** 样式变体 */
	variant?: DropdownMenuItemVariant;
	/** 是否禁用 */
	disabled?: boolean;
	/** 选中触发时的回调 */
	onSelect?: (event: Event) => void;
}

/**
 * 框架无关的 DropdownMenuCheckboxItem 基础 Props
 */
export interface DropdownMenuCheckboxItemBaseProps {
	/** 是否受控勾选 */
	checked?: boolean;
	/** 默认是否勾选 (非受控) */
	defaultChecked?: boolean;
	/** 勾选状态变化时的回调 */
	onCheckedChange?: (checked: boolean) => void;
	/** 是否禁用 */
	disabled?: boolean;
	/** 选中触发时的回调 */
	onSelect?: (event: Event) => void;
}

/**
 * 框架无关的 DropdownMenuRadioGroup 基础 Props
 */
export interface DropdownMenuRadioGroupBaseProps {
	/** 受控选中值 */
	value?: string;
	/** 默认选中值 (非受控) */
	defaultValue?: string;
	/** 选中值变化时的回调 */
	onValueChange?: (value: string) => void;
}

/**
 * 框架无关的 DropdownMenuRadioItem 基础 Props
 */
export interface DropdownMenuRadioItemBaseProps {
	/** 该项对应的值 */
	value: string;
	/** 是否禁用 */
	disabled?: boolean;
	/** 选中触发时的回调 */
	onSelect?: (event: Event) => void;
}

/**
 * 框架无关的 DropdownMenuLabel 基础 Props
 */
export interface DropdownMenuLabelBaseProps {
	/** 是否缩进 */
	inset?: boolean;
}

/**
 * 框架无关的 DropdownMenuSub 基础 Props
 */
export interface DropdownMenuSubBaseProps {
	/** 是否受控展开 */
	open?: boolean;
	/** 默认是否展开 (非受控) */
	defaultOpen?: boolean;
	/** 展开状态变化时的回调 */
	onOpenChange?: (open: boolean) => void;
}

/**
 * 框架无关的 DropdownMenuSubTrigger 基础 Props
 */
export interface DropdownMenuSubTriggerBaseProps {
	/** 是否缩进 */
	inset?: boolean;
	/** 是否禁用 */
	disabled?: boolean;
}

export type EmptyMediaVariant = 'default' | 'icon';

/**
 * 框架无关的 EmptyMedia 基础 Props（仅包含组件库自定义属性）
 */
export interface EmptyMediaBaseProps {
	/**
	 * 媒体区（图标容器）变体
	 */
	variant?: EmptyMediaVariant;
}

export type FieldMessageVariant = 'default' | 'error' | 'warning' | 'success' | 'info';

/**
 * 框架无关的 Field 基础 Props（仅包含组件库自定义属性）
 */
export interface FieldBaseProps {
	/**
	 * 字段名称，用于生成稳定的辅助 ID
	 */
	name?: string;
	/**
	 * 是否处于无效状态
	 */
	invalid?: boolean;
	/**
	 * 是否必填
	 */
	required?: boolean;
}

/**
 * 框架无关的 FieldLabel 基础 Props（仅包含组件库自定义属性）
 */
export interface FieldLabelBaseProps {
	/**
	 * 标签关联的控件 ID，默认使用 Field 生成的 ID
	 */
	htmlFor?: string;
}

/**
 * 框架无关的 FieldDescription 基础 Props（仅包含组件库自定义属性）
 */
export interface FieldDescriptionBaseProps {}

/**
 * 框架无关的 FieldMessage 基础 Props（仅包含组件库自定义属性）
 */
export interface FieldMessageBaseProps {
	/**
	 * 消息样式变体
	 */
	variant?: FieldMessageVariant;
}

/**
 * 表单字段值集合
 */
export type FormValues = Record<string, unknown>;

/**
 * 表单字段错误信息
 */
export interface FormFieldError {
	/** 错误类型 */
	type?: string;
	/** 错误消息 */
	message?: string;
}

/**
 * 表单错误集合 (键为字段路径)
 */
export type FormErrors = Record<string, FormFieldError>;

/**
 * 单个校验规则
 */
export interface FormValidationRule<T = unknown> {
	/** 规则值 */
	value: T;
	/** 错误消息 */
	message?: string;
}

/**
 * 自定义校验函数 (返回 string 表示错误消息，false 表示失败，true 表示通过；支持异步)
 */
export type FormValidateFunction = (value: unknown, values: FormValues) => string | boolean | Promise<string | boolean>;

/**
 * 字段注册选项
 */
export interface FormRegisterOptions {
	/** 必填校验 */
	required?: string | boolean;
	/** 正则校验 */
	pattern?: FormValidationRule<RegExp>;
	/** 最小长度 */
	minLength?: FormValidationRule<number>;
	/** 最大长度 */
	maxLength?: FormValidationRule<number>;
	/** 最小值 */
	min?: FormValidationRule<number>;
	/** 最大值 */
	max?: FormValidationRule<number>;
	/** 自定义校验 */
	validate?: FormValidateFunction | Record<string, FormValidateFunction>;
	/** 依赖字段 (变更时触发本字段重校验) */
	deps?: string[];
	/** 将输入转为数字 */
	valueAsNumber?: boolean;
}

/**
 * 字段注册结果 (框架无关)
 */
export interface FormRegistration {
	name: string;
	/** 变更处理器 (入参为事件对象或原始值) */
	onChange: (value: unknown) => void;
	/** 失焦处理器 */
	onBlur: () => void;
	/** 字段名称 (框架可据此生成 DOM ref) */
	ref: string;
	/** 注销本次注册；同名字段并存时仅移除当前注册 */
	unregister: () => void;
}

/**
 * 字段状态
 */
export interface FormFieldState {
	/** 当前错误 */
	error?: FormFieldError;
	/** 是否已触碰 */
	isTouched: boolean;
	/** 是否已修改 */
	isDirty: boolean;
	/** 字段值 */
	value: unknown;
}

/**
 * 表单快照 (供 React useSyncExternalStore / Vue reactive 使用)
 */
export interface FormSnapshot {
	values: FormValues;
	errors: FormErrors;
	touched: Record<string, boolean>;
	dirty: Record<string, boolean>;
	isSubmitting: boolean;
	isSubmitted: boolean;
	submitCount: number;
	version: number;
}

/**
 * formState 派生状态 (与 react-hook-form formState 对齐)
 */
export interface FormFormState {
	errors: FormErrors;
	/** 已触碰字段集合 */
	touched: Record<string, boolean>;
	/** 已修改字段集合 */
	dirty: Record<string, boolean>;
	isSubmitting: boolean;
	isSubmitted: boolean;
	/** 是否存在已修改字段 */
	isDirty: boolean;
	/** 当前是否有错误 */
	isValid: boolean;
	submitCount: number;
}

/**
 * setValue 选项
 */
export interface FormSetValueOptions {
	shouldValidate?: boolean;
	shouldDirty?: boolean;
	shouldTouch?: boolean;
}

/**
 * reset 选项
 */
export interface FormResetOptions {
	/** 保留当前值 */
	keepValues?: boolean;
	keepErrors?: boolean;
	keepDirty?: boolean;
	keepTouched?: boolean;
	/** 保留已提交标记 */
	keepIsSubmitted?: boolean;
	/** 保留提交次数 */
	keepSubmitCount?: boolean;
}

/**
 * setError 选项
 */
export interface FormSetErrorOptions {
	/** 是否聚焦到出错的字段 (需要框架提供元素引用) */
	shouldFocus?: boolean;
}

/**
 * handleSubmit 参数 (与 react-hook-form 兼容)
 */
export interface FormSubmitHandler {
	/** 校验通过时的回调 */
	onValid: (values: FormValues, event?: unknown) => void | Promise<void>;
	/** 校验失败时的回调 */
	onInvalid?: (errors: FormErrors, event?: unknown) => void | Promise<void>;
}

/**
 * 表单字段 ID 集合
 */
export interface FormFieldIds {
	/** 表单项根 ID */
	id: string;
	/** 控件 ID */
	formItemId: string;
	/** 描述 ID */
	formDescriptionId: string;
	/** 消息 ID */
	formMessageId: string;
}

/**
 * Form 基础 Props (框架无关部分)
 */
export interface FormBaseProps {
	/** 初始值 */
	defaultValues?: FormValues;
	/** 校验解析器 (整体校验，返回错误集合；支持异步) */
	resolver?: (values: FormValues) => FormErrors | Promise<FormErrors>;
	/** 表单实例 */
	form?: unknown;
}

/**
 * useForm 配置
 */
export interface UseFormOptions<TValues extends FormValues = FormValues> {
	/** 初始值 (支持惰性初始化) */
	defaultValues?: TValues | (() => TValues);
	/** 整体校验解析器 (支持异步) */
	resolver?: (values: TValues) => FormErrors | Promise<FormErrors>;
}

/**
 * 数组字段条目 (带稳定 id，供渲染 key 使用)
 */
export interface FormFieldArrayItem {
	/** 稳定 id */
	id: string;
	/** 数组元素原始值 (对象元素通过展开字段呈现) */
	value?: unknown;
	/** 对象元素的字段 (若原始值是对象则展开) */
	[key: string]: unknown;
}

/**
 * 控制器字段渲染入参 (供 React render prop / Vue 作用域插槽使用)
 */
export interface FormControllerField {
	name: string;
	value: unknown;
	onChange: (value: unknown) => void;
	onBlur: () => void;
	/** 字段名称 (框架据此生成 DOM ref) */
	ref: string;
}

/**
 * Form 组件样式类名键
 */
export const formStyleKeys = {
	item: 'item',
	label: 'label',
	control: 'control',
	description: 'description',
	message: 'message',
} as const;

/**
 * 默认表单 ID 前缀
 */
export const FORM_DEFAULT_ID = 'tile-form';

/**
 * 根据表单项根 ID 生成相关的辅助 ID
 */
export function getFormFieldIds(id: string = FORM_DEFAULT_ID): FormFieldIds {
	return {
		id,
		formItemId: `${id}-form-item`,
		formDescriptionId: `${id}-form-item-description`,
		formMessageId: `${id}-form-item-message`,
	};
}

/**
 * 按点路径读取值 (支持嵌套)
 */
export function getInValue(values: FormValues, path: string): unknown {
	if (!path) {
		return undefined;
	}

	let current: unknown = values;
	for (const segment of path.split('.')) {
		if (current === null || current === undefined) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

/**
 * 按点路径写入值 (返回新对象)
 */
export function setInValue(values: FormValues, path: string, value: unknown): FormValues {
	const segments = path.split('.');
	const isIndex = (segment: string) => /^\d+$/.test(segment);
	const update = (current: unknown, index: number): unknown => {
		if (index === segments.length) return value;
		const segment = segments[index];
		const container = Array.isArray(current)
			? [...current]
			: current !== null && typeof current === 'object'
				? { ...(current as Record<string, unknown>) }
				: isIndex(segment)
					? []
					: {};
		const child = (container as Record<string, unknown>)[segment];
		(container as Record<string, unknown>)[segment] = update(child, index + 1);
		return container;
	};

	return update(values, 0) as FormValues;
}

/**
 * 数组字段追加元素 (纯函数，返回新值集合)
 */
export function appendToFieldArray(values: FormValues, path: string, item: unknown): FormValues {
	const current = getInValue(values, path);
	const array = Array.isArray(current) ? current : [];
	return setInValue(values, path, [...array, item]);
}

/**
 * 数组字段头部插入元素 (纯函数)
 */
export function prependToFieldArray(values: FormValues, path: string, item: unknown): FormValues {
	const current = getInValue(values, path);
	const array = Array.isArray(current) ? current : [];
	return setInValue(values, path, [item, ...array]);
}

/**
 * 数组字段移除元素 (纯函数)
 */
export function removeFromFieldArray(values: FormValues, path: string, index: number): FormValues {
	const current = getInValue(values, path);
	const array = Array.isArray(current) ? current : [];
	return setInValue(
		values,
		path,
		array.filter((_item, itemIndex) => itemIndex !== index),
	);
}

/**
 * 数组字段插入元素 (纯函数)
 */
export function insertIntoFieldArray(values: FormValues, path: string, index: number, item: unknown): FormValues {
	const current = getInValue(values, path);
	const array = Array.isArray(current) ? current : [];
	const next = [...array];
	next.splice(index, 0, item);
	return setInValue(values, path, next);
}

/**
 * 数组字段交换元素 (纯函数)
 */
export function swapFieldArrayItems(values: FormValues, path: string, from: number, to: number): FormValues {
	const current = getInValue(values, path);
	const array = Array.isArray(current) ? current : [];
	if (from === to || from < 0 || to < 0 || from >= array.length || to >= array.length) {
		return values;
	}
	const next = [...array];
	[next[from], next[to]] = [next[to], next[from]];
	return setInValue(values, path, next);
}

/**
 * 数组字段移动元素 (纯函数)
 */
export function moveInFieldArray(values: FormValues, path: string, from: number, to: number): FormValues {
	const current = getInValue(values, path);
	const array = Array.isArray(current) ? current : [];
	if (from === to || from < 0 || to < 0 || from >= array.length || to >= array.length) {
		return values;
	}
	const next = [...array];
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item);
	return setInValue(values, path, next);
}

/**
 * 数组字段更新元素 (纯函数)
 */
export function updateInFieldArray(values: FormValues, path: string, index: number, item: unknown): FormValues {
	const current = getInValue(values, path);
	const array = Array.isArray(current) ? current : [];
	if (index < 0 || index >= array.length) {
		return values;
	}
	const next = [...array];
	next[index] = item;
	return setInValue(values, path, next);
}

/**
 * 数组字段整体替换 (纯函数)
 */
export function replaceFieldArray(values: FormValues, path: string, items: unknown[]): FormValues {
	return setInValue(values, path, Array.isArray(items) ? [...items] : []);
}

/**
 * 将输入归一化为提交值 (支持事件对象/原始值/数字转换)
 */
export function normalizeFormValue(value: unknown, valueAsNumber: boolean = false): unknown {
	if (value !== null && typeof value === 'object' && 'target' in value) {
		const target = (value as { target: { value: unknown } }).target;
		value = target.value;
	}
	if (valueAsNumber) {
		return typeof value === 'number' ? value : Number(value);
	}
	return value;
}

/**
 * 校验单个字段，返回错误 (支持同步与异步校验)
 */
export async function validateFormField(fieldName: string, value: unknown, allValues: FormValues, options?: FormRegisterOptions): Promise<FormFieldError | undefined> {
	if (!options) {
		return undefined;
	}

	const { required, pattern, minLength, maxLength, min, max, validate } = options;

	if (required) {
		const isEmpty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
		if (isEmpty) {
			return { type: 'required', message: typeof required === 'string' ? required : undefined };
		}
	}

	if (pattern && typeof value === 'string' && !pattern.value.test(value)) {
		return { type: 'pattern', message: pattern.message };
	}

	if (typeof value === 'string') {
		if (minLength !== undefined && value.length < minLength.value) {
			return { type: 'minLength', message: minLength.message };
		}
		if (maxLength !== undefined && value.length > maxLength.value) {
			return { type: 'maxLength', message: maxLength.message };
		}
	}

	if (typeof value === 'number') {
		if (min !== undefined && value < min.value) {
			return { type: 'min', message: min.message };
		}
		if (max !== undefined && value > max.value) {
			return { type: 'max', message: max.message };
		}
	}

	if (validate) {
		if (typeof validate === 'function') {
			const result = await validate(value, allValues);
			if (typeof result === 'string' && result) {
				return { type: 'validate', message: result };
			}
			if (result === false) {
				return { type: 'validate', message: 'Validation failed' };
			}
		} else {
			for (const ruleKey of Object.keys(validate)) {
				const result = await validate[ruleKey](value, allValues);
				if (typeof result === 'string' && result) {
					return { type: ruleKey, message: result };
				}
				if (result === false) {
					return { type: ruleKey, message: 'Validation failed' };
				}
			}
		}
	}

	return undefined;
}

/**
 * 将原始数组转换为带稳定 id 的字段数组条目
 */
export function toFieldArrayItems(array: unknown[], ids: string[]): FormFieldArrayItem[] {
	return array.map((item, index) => {
		const id = ids[index];
		if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
			return { ...(item as Record<string, unknown>), id };
		}
		return { id, value: item };
	});
}

/**
 * 字段路径解析器 (供 useForm 内部使用)
 */
export type FormPathResolver = (name: string) => string;

function cloneFormValue<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((item) => cloneFormValue(item)) as T;
	}
	if (value instanceof Date) {
		return new Date(value.getTime()) as T;
	}
	if (value instanceof RegExp) {
		return new RegExp(value.source, value.flags) as T;
	}
	if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneFormValue(item)])) as T;
	}
	return value;
}

interface FormRegistrationEntry {
	id: number;
	path: string;
	options: FormRegisterOptions;
}

/**
 * 最小化表单状态引擎 (纯逻辑 + 订阅模型，供两个框架复用)
 */
export class FormStore {
	private readonly defaultValues: FormValues;
	private values: FormValues;
	private errors: FormErrors = {};
	private touched: Record<string, boolean> = {};
	private dirty: Record<string, boolean> = {};
	private rules: Record<string, FormRegisterOptions> = {};
	private registrations = new Map<string, FormRegistrationEntry[]>();
	private depsMap: Record<string, string[]> = {};
	private arrayIds = new Map<string, string[]>();
	private isSubmitting = false;
	private isSubmitted = false;
	private submitCount = 0;
	private activeSubmissions = 0;
	private validationEpoch = 0;
	private wholeValidationGeneration = 0;
	private fieldValidationGenerations = new Map<string, number>();
	private registrationId = 0;
	private version = 0;
	private snapshotVersion = -1;
	private snapshotCache: FormSnapshot | null = null;
	private listeners = new Set<() => void>();
	private fieldListeners = new Map<string, Set<() => void>>();
	private resolver?: (values: FormValues) => FormErrors | Promise<FormErrors>;
	private resolvePath: FormPathResolver;

	constructor(defaultValues: FormValues = {}, resolver?: (values: FormValues) => FormErrors | Promise<FormErrors>, resolvePath: FormPathResolver = (name) => name) {
		this.defaultValues = cloneFormValue(defaultValues);
		this.values = cloneFormValue(this.defaultValues);
		this.resolver = resolver;
		this.resolvePath = resolvePath;
	}

	/** 订阅全局变化 */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** 订阅指定字段变化 */
	subscribeField(name: string, listener: () => void): () => void {
		const path = this.resolvePath(name);
		let set = this.fieldListeners.get(path);
		if (!set) {
			set = new Set();
			this.fieldListeners.set(path, set);
		}
		set.add(listener);
		return () => {
			set?.delete(listener);
		};
	}

	/** 获取表单快照 (内部缓存，仅版本变更时重建) */
	getSnapshot(): FormSnapshot {
		if (this.version !== this.snapshotVersion) {
			this.snapshotCache = {
				values: this.values,
				errors: this.errors,
				touched: this.touched,
				dirty: this.dirty,
				isSubmitting: this.isSubmitting,
				isSubmitted: this.isSubmitted,
				submitCount: this.submitCount,
				version: this.version,
			};
			this.snapshotVersion = this.version;
		}
		return this.snapshotCache as FormSnapshot;
	}

	/** 获取 formState 派生状态 */
	getFormState(): FormFormState {
		return {
			errors: this.errors,
			touched: this.touched,
			dirty: this.dirty,
			isSubmitting: this.isSubmitting,
			isSubmitted: this.isSubmitted,
			isDirty: this.isDirty(),
			isValid: this.isValid(),
			submitCount: this.submitCount,
		};
	}

	/** 是否包含已修改字段 */
	isDirty(): boolean {
		return Object.values(this.dirty).some(Boolean);
	}

	/** 是否有错误 */
	isValid(): boolean {
		return Object.keys(this.errors).length === 0;
	}

	/** 获取全部值或指定字段值 */
	getValues(name?: string): FormValues | unknown {
		return name === undefined ? this.values : getInValue(this.values, this.resolvePath(name));
	}

	/** 获取指定字段值 */
	getValue(name: string): unknown {
		return getInValue(this.values, this.resolvePath(name));
	}

	/** 监听字段或整个表单 (返回当前值快照) */
	watch(name?: string): FormValues | unknown {
		return name === undefined ? { ...this.values } : getInValue(this.values, this.resolvePath(name));
	}

	/** 设置字段值 */
	setValue(name: string, value: unknown, options: FormSetValueOptions = {}): void {
		const path = this.resolvePath(name);
		this.invalidateValidation();
		this.values = setInValue(this.values, path, value);

		if (options.shouldDirty) {
			this.dirty[path] = true;
		}
		if (options.shouldTouch) {
			this.touched[path] = true;
		}

		const dependents = this.depsMap[path] ?? [];
		for (const dependent of dependents) {
			void this.validateField(dependent);
		}

		if (options.shouldValidate) {
			void this.validateField(path);
		}

		this.notify(path);
	}

	/** 获取字段状态 */
	getFieldState(name: string): FormFieldState {
		const path = this.resolvePath(name);
		return {
			error: this.errors[path],
			isTouched: !!this.touched[path],
			isDirty: !!this.dirty[path],
			value: getInValue(this.values, path),
		};
	}

	/** 注册字段 */
	registerField(name: string, options: FormRegisterOptions = {}): FormRegistration {
		const path = this.resolvePath(name);
		const entry = { id: ++this.registrationId, path, options: cloneFormValue(options) };
		const entries = this.registrations.get(path) ?? [];
		entries.push(entry);
		this.registrations.set(path, entries);
		this.fieldValidationGenerations.set(path, (this.fieldValidationGenerations.get(path) ?? 0) + 1);
		this.invalidateValidation();
		this.rebuildRegistrationState();
		let active = true;
		const unregister = () => {
			if (!active) return;
			active = false;
			this.removeRegistration(entry.path, entry.id);
		};

		return {
			name,
			ref: name,
			unregister,
			onChange: (value: unknown) => {
				this.setValue(entry.path, normalizeFormValue(value, entry.options.valueAsNumber));
			},
			onBlur: () => {
				this.blurField(entry.path);
			},
		};
	}

	/** 注销字段 */
	unregisterField(name: string): void {
		const path = this.resolvePath(name);
		const entries = this.registrations.get(path);
		const entry = entries?.at(-1);
		if (entry) this.removeRegistration(path, entry.id);
	}

	/** 标记字段已触碰 */
	blurField(name: string): void {
		const path = this.resolvePath(name);
		this.touched[path] = true;
		this.notify(path);
	}

	/** 校验单个字段 */
	async validateField(name: string): Promise<FormFieldError | undefined> {
		const path = this.resolvePath(name);
		const generation = (this.fieldValidationGenerations.get(path) ?? 0) + 1;
		this.fieldValidationGenerations.set(path, generation);
		this.wholeValidationGeneration += 1;
		const epoch = this.validationEpoch;
		const value = getInValue(this.values, path);
		const values = cloneFormValue(this.values);
		const error = await validateFormField(path, value, values, this.rules[path]);

		if (epoch === this.validationEpoch && generation === this.fieldValidationGenerations.get(path)) {
			if (error) {
				this.errors[path] = error;
			} else {
				delete this.errors[path];
			}
			this.notify(path);
		}
		return error;
	}

	/** 校验全部已注册字段 */
	async validateFields(): Promise<FormErrors> {
		return (await this.runWholeValidation()).errors;
	}

	private async runWholeValidation(): Promise<{ errors: FormErrors; values: FormValues; current: boolean }> {
		const generation = ++this.wholeValidationGeneration;
		const epoch = this.validationEpoch;
		for (const path of this.registrations.keys()) {
			this.fieldValidationGenerations.set(path, (this.fieldValidationGenerations.get(path) ?? 0) + 1);
		}
		const values = cloneFormValue(this.values);
		const rules = { ...this.rules };
		const paths = [...this.registrations.keys()];
		const errors: FormErrors = {};
		for (const path of paths) {
			const value = getInValue(values, path);
			const error = await validateFormField(path, value, values, rules[path]);
			if (error) {
				errors[path] = error;
			}
		}

		if (this.resolver) {
			const resolvedErrors = await this.resolver(values);
			Object.assign(errors, resolvedErrors);
		}

		const current = epoch === this.validationEpoch && generation === this.wholeValidationGeneration;
		if (current) {
			this.errors = errors;
			this.notify();
		}
		return { errors, values, current };
	}

	/** 触发校验 (缺省校验全部，返回是否通过) */
	async trigger(name?: string): Promise<boolean> {
		if (name) {
			const error = await this.validateField(name);
			return !error;
		}
		const errors = await this.validateFields();
		return Object.keys(errors).length === 0;
	}

	/** 手动设置错误 */
	setError(name: string, error: string | FormFieldError, _options?: FormSetErrorOptions): void {
		const path = this.resolvePath(name);
		this.invalidateValidation();
		this.errors[path] = typeof error === 'string' ? { type: 'manual', message: error } : error;
		this.notify(path);
	}

	/** 清除错误 (缺省清除全部) */
	clearErrors(name?: string): void {
		this.invalidateValidation();
		if (name) {
			delete this.errors[this.resolvePath(name)];
		} else {
			this.errors = {};
		}
		this.notify();
	}

	/** 重置表单 */
	reset(nextValues?: FormValues, options: FormResetOptions = {}): void {
		this.invalidateValidation();
		if (!options.keepValues) {
			this.values = cloneFormValue(nextValues ?? this.defaultValues);
			this.arrayIds.clear();
		} else if (nextValues) {
			this.values = { ...this.values, ...cloneFormValue(nextValues) };
		}
		if (!options.keepErrors) {
			this.errors = {};
		}
		if (!options.keepDirty) {
			this.dirty = {};
		}
		if (!options.keepTouched) {
			this.touched = {};
		}
		if (!options.keepIsSubmitted) {
			this.isSubmitted = false;
		}
		if (!options.keepSubmitCount) {
			this.submitCount = 0;
		}
		this.isSubmitting = this.activeSubmissions > 0;
		this.notify();
	}

	/** 创建提交处理器 */
	createSubmitHandler(onValid: FormSubmitHandler['onValid'], onInvalid?: FormSubmitHandler['onInvalid']): (event?: unknown) => Promise<void> {
		return async (event?: unknown) => {
			const preventDefault = (event as { preventDefault?: () => void } | undefined)?.preventDefault;
			if (typeof preventDefault === 'function') {
				preventDefault.call(event);
			}

			this.submitCount += 1;
			this.isSubmitted = true;
			this.activeSubmissions += 1;
			this.isSubmitting = true;
			this.notify();

			try {
				// 每次提交都消费自己的值与错误快照；仅最新且未失效的校验会发布到全局 errors。
				const result = await this.runWholeValidation();
				if (Object.keys(result.errors).length === 0) {
					await onValid(result.values, event);
				} else {
					await onInvalid?.(result.errors, event);
				}
			} finally {
				this.activeSubmissions -= 1;
				this.isSubmitting = this.activeSubmissions > 0;
				this.notify();
			}
		};
	}

	private invalidateValidation(): void {
		this.validationEpoch += 1;
		this.wholeValidationGeneration += 1;
	}

	private rebuildRegistrationState(): void {
		this.rules = {};
		this.depsMap = {};
		for (const [path, entries] of this.registrations) {
			const merged: FormRegisterOptions = {};
			const deps = new Set<string>();
			for (const entry of entries) {
				for (const [key, value] of Object.entries(entry.options)) {
					if (key !== 'deps' && value !== undefined) (merged as Record<string, unknown>)[key] = value;
				}
				for (const dep of entry.options.deps ?? []) deps.add(dep);
			}
			if (deps.size > 0) merged.deps = [...deps];
			this.rules[path] = merged;
			for (const dep of deps) {
				const depPath = this.resolvePath(dep);
				const dependents = this.depsMap[depPath] ?? [];
				if (!dependents.includes(path)) dependents.push(path);
				this.depsMap[depPath] = dependents;
			}
		}
	}

	private removeRegistration(path: string, id: number): void {
		const entries = this.registrations.get(path);
		if (!entries) return;
		const next = entries.filter((entry) => entry.id !== id);
		if (next.length > 0) {
			this.registrations.set(path, next);
		} else {
			this.registrations.delete(path);
			delete this.errors[path];
			delete this.touched[path];
			delete this.dirty[path];
		}
		this.fieldValidationGenerations.set(path, (this.fieldValidationGenerations.get(path) ?? 0) + 1);
		this.invalidateValidation();
		this.rebuildRegistrationState();
		this.notify(path);
	}

	/** 读取数组字段 (路径 + 原始数组) */
	private readArray(name: string): { path: string; array: unknown[] } {
		const path = this.resolvePath(name);
		const raw = getInValue(this.values, path);
		return { path, array: Array.isArray(raw) ? raw : [] };
	}

	/** 写入数组字段并通知 */
	private setFieldArray(path: string, next: unknown[], nextIds: string[]): void {
		this.invalidateValidation();
		this.values = setInValue(this.values, path, next);
		this.arrayIds.set(path, nextIds);
		this.notify(path);
	}

	private getFieldArrayIds(path: string, length: number): string[] {
		let ids = this.arrayIds.get(path);
		if (!ids) {
			ids = [];
			this.arrayIds.set(path, ids);
		}
		while (ids.length < length) ids.push(generateId('field'));
		if (ids.length > length) ids.length = length;
		return ids;
	}

	private rebaseFieldArrayDescendants(path: string, mapIndex: (index: number) => number | undefined): void {
		const rebasePath = (candidate: string): string | undefined => {
			const prefix = `${path}.`;
			if (!candidate.startsWith(prefix)) return candidate;
			const remainder = candidate.slice(prefix.length);
			const separator = remainder.indexOf('.');
			const indexSegment = separator === -1 ? remainder : remainder.slice(0, separator);
			if (!/^\d+$/.test(indexSegment)) return candidate;
			const nextIndex = mapIndex(Number(indexSegment));
			if (nextIndex === undefined) return undefined;
			return `${prefix}${nextIndex}${separator === -1 ? '' : remainder.slice(separator)}`;
		};
		const rebaseRecord = <T>(record: Record<string, T>): Record<string, T> => {
			const next: Record<string, T> = {};
			for (const [key, value] of Object.entries(record)) {
				const rebased = rebasePath(key);
				if (rebased !== undefined) next[rebased] = value;
			}
			return next;
		};
		const rebaseMap = <T>(source: Map<string, T>): Map<string, T> => {
			const next = new Map<string, T>();
			for (const [key, value] of source) {
				const rebased = rebasePath(key);
				if (rebased !== undefined) next.set(rebased, value);
			}
			return next;
		};

		const registrations = new Map<string, FormRegistrationEntry[]>();
		for (const [key, entries] of this.registrations) {
			const rebased = rebasePath(key);
			if (rebased === undefined) {
				for (const entry of entries) entry.path = `\0removed:${entry.id}`;
				continue;
			}
			for (const entry of entries) {
				entry.path = rebased;
				if (entry.options.deps) entry.options.deps = entry.options.deps.map(rebasePath).filter((dep): dep is string => dep !== undefined);
			}
			registrations.set(rebased, entries);
		}
		this.registrations = registrations;
		this.errors = rebaseRecord(this.errors);
		this.touched = rebaseRecord(this.touched);
		this.dirty = rebaseRecord(this.dirty);
		this.arrayIds = rebaseMap(this.arrayIds);
		this.fieldValidationGenerations = rebaseMap(this.fieldValidationGenerations);
		this.fieldListeners = rebaseMap(this.fieldListeners);
		this.rebuildRegistrationState();
	}

	/** 获取数组字段条目 (带稳定 id) */
	getFieldArray(name: string): FormFieldArrayItem[] {
		const { path, array } = this.readArray(name);
		const ids = this.getFieldArrayIds(path, array.length);
		return toFieldArrayItems(array, ids);
	}

	/** 数组字段追加元素 */
	append(name: string, item: unknown): void {
		const { path, array } = this.readArray(name);
		const ids = [...this.getFieldArrayIds(path, array.length), generateId('field')];
		this.setFieldArray(path, [...array, item], ids);
	}

	/** 数组字段头部插入元素 */
	prepend(name: string, item: unknown): void {
		const { path, array } = this.readArray(name);
		const ids = [generateId('field'), ...this.getFieldArrayIds(path, array.length)];
		this.rebaseFieldArrayDescendants(path, (index) => index + 1);
		this.setFieldArray(path, [item, ...array], ids);
	}

	/** 数组字段插入元素 */
	insert(name: string, index: number, item: unknown): void {
		const { path, array } = this.readArray(name);
		const next = [...array];
		const ids = [...this.getFieldArrayIds(path, array.length)];
		next.splice(index, 0, item);
		ids.splice(index, 0, generateId('field'));
		this.rebaseFieldArrayDescendants(path, (current) => (current >= index ? current + 1 : current));
		this.setFieldArray(path, next, ids);
	}

	/** 数组字段移除元素 */
	remove(name: string, index: number): void {
		const { path, array } = this.readArray(name);
		const ids = this.getFieldArrayIds(path, array.length).filter((_id, itemIndex) => itemIndex !== index);
		this.rebaseFieldArrayDescendants(path, (current) => (current === index ? undefined : current > index ? current - 1 : current));
		this.setFieldArray(
			path,
			array.filter((_item, itemIndex) => itemIndex !== index),
			ids,
		);
	}

	/** 数组字段交换元素 */
	swap(name: string, from: number, to: number): void {
		const { path, array } = this.readArray(name);
		if (from === to || from < 0 || to < 0 || from >= array.length || to >= array.length) {
			return;
		}
		const next = [...array];
		const ids = [...this.getFieldArrayIds(path, array.length)];
		[next[from], next[to]] = [next[to], next[from]];
		[ids[from], ids[to]] = [ids[to], ids[from]];
		this.rebaseFieldArrayDescendants(path, (index) => (index === from ? to : index === to ? from : index));
		this.setFieldArray(path, next, ids);
	}

	/** 数组字段移动元素 */
	move(name: string, from: number, to: number): void {
		const { path, array } = this.readArray(name);
		if (from === to || from < 0 || to < 0 || from >= array.length || to >= array.length) return;
		const next = [...array];
		const ids = [...this.getFieldArrayIds(path, array.length)];
		const [item] = next.splice(from, 1);
		const [id] = ids.splice(from, 1);
		next.splice(to, 0, item);
		ids.splice(to, 0, id);
		this.rebaseFieldArrayDescendants(path, (index) => {
			if (index === from) return to;
			if (from < to && index > from && index <= to) return index - 1;
			if (from > to && index >= to && index < from) return index + 1;
			return index;
		});
		this.setFieldArray(path, next, ids);
	}

	/** 数组字段更新元素 */
	update(name: string, index: number, item: unknown): void {
		const { path, array } = this.readArray(name);
		if (index < 0 || index >= array.length) {
			return;
		}
		const next = [...array];
		const ids = [...this.getFieldArrayIds(path, array.length)];
		next[index] = item;
		ids[index] = generateId('field');
		this.rebaseFieldArrayDescendants(path, (current) => (current === index ? undefined : current));
		this.setFieldArray(path, next, ids);
	}

	/** 数组字段整体替换 */
	replace(name: string, items: unknown[]): void {
		const path = this.resolvePath(name);
		const next = Array.isArray(items) ? [...items] : [];
		this.rebaseFieldArrayDescendants(path, () => undefined);
		this.setFieldArray(
			path,
			next,
			next.map(() => generateId('field')),
		);
	}

	/** 触发通知 */
	private notify(path?: string): void {
		this.version += 1;
		this.listeners.forEach((listener) => listener());
		if (path) {
			this.fieldListeners.get(path)?.forEach((listener) => listener());
		}
	}
}

/**
 * 创建表单存储实例 (供框架 useForm 包装)
 */
export function createFormStore(
	defaultValues: FormValues = {},
	resolver?: (values: FormValues) => FormErrors | Promise<FormErrors>,
	resolvePath: FormPathResolver = (name) => name,
): FormStore {
	return new FormStore(defaultValues, resolver, resolvePath);
}

export type HoverCardSide = 'top' | 'right' | 'bottom' | 'left';

export type HoverCardAlign = 'start' | 'center' | 'end';

export type HoverCardState = 'open' | 'closed';

/**
 * 框架无关的 HoverCard 基础 Props (仅包含组件库自定义属性)
 */
export interface HoverCardBaseProps {
	/** 是否受控打开 */
	open?: boolean;
	/** 默认是否打开 (非受控) */
	defaultOpen?: boolean;
	/** hover/focus 后延迟打开的毫秒数 */
	openDelay?: number;
	/** 移出后延迟关闭的毫秒数 */
	closeDelay?: number;
	/** 打开状态变化时的回调 */
	onOpenChange?: (open: boolean) => void;
}

/**
 * 框架无关的 HoverCardTrigger 基础 Props (仅包含组件库自定义属性)
 */
export interface HoverCardTriggerBaseProps {
	/** 是否合并渲染到子元素上 (需唯一根节点) */
	asChild?: boolean;
}

/**
 * 框架无关的 HoverCardContent 基础 Props (仅包含组件库自定义属性)
 */
export interface HoverCardContentBaseProps {
	/** 弹出方向 */
	side?: HoverCardSide;
	/** 与触发元素主轴方向的对齐方式 */
	align?: HoverCardAlign;
	/** 与触发元素之间的间距 (px) */
	sideOffset?: number;
}

/**
 * 框架无关的 Input 基础 Props (仅包含组件库自定义属性)
 */
export interface InputBaseProps {
	label?: string;
	error?: string;
	helperText?: string;
	/** Visual control size; independent of the native numeric HTML `size` attribute. */
	controlSize?: 'default' | 'xs' | 'sm' | 'lg';
}

export type InputGroupVariant = 'default' | 'outline';
export type InputGroupAddonAlign = 'inline-start' | 'inline-end' | 'block-start' | 'block-end';

/**
 * 框架无关的 InputGroup 基础 Props（仅包含组件库自定义属性）
 */
export interface InputGroupBaseProps {
	/**
	 * 输入组样式变体
	 */
	variant?: InputGroupVariant;
}

/**
 * 框架无关的 InputGroupAddon 基础 Props（仅包含组件库自定义属性）
 */
export interface InputGroupAddonBaseProps {
	/**
	 * 附加内容样式变体
	 */
	variant?: InputGroupVariant;
	/**
	 * 附加内容对齐方式
	 */
	align?: InputGroupAddonAlign;
}

/**
 * 框架无关的 InputGroupButton 基础 Props（仅包含组件库自定义属性）
 */
export interface InputGroupButtonBaseProps {}

/**
 * 框架无关的 InputGroupText 基础 Props（仅包含组件库自定义属性）
 */
export interface InputGroupTextBaseProps {}

/**
 * 框架无关的 InputGroupInput 基础 Props（仅包含组件库自定义属性）
 */
export interface InputGroupInputBaseProps {}

/**
 * 框架无关的 InputGroupTextarea 基础 Props（仅包含组件库自定义属性）
 */
export interface InputGroupTextareaBaseProps {}

/** OTP 输入模式 */
export type InputOtpMode = 'numeric' | 'alphanumeric' | 'text';

/**
 * 框架无关的 InputOTP 基础 Props (仅包含组件库自定义属性)
 */
export interface InputOtpBaseProps {
	/** 当前值 (受控字符串) */
	value?: string;
	/** 默认值 (非受控) */
	defaultValue?: string;
	/** 最大长度 (槽位数) */
	maxLength?: number;
	/** 是否禁用 */
	disabled?: boolean;
	/** 值变化回调 */
	onChange?: (value: string) => void;
	/** 输入完成 (填满所有槽位) 回调 */
	onComplete?: (value: string) => void;
	/** 输入模式 */
	mode?: InputOtpMode;
	/** 粘贴/输入时是否过滤非法字符 */
	allowPaste?: boolean;
}

/**
 * 框架无关的 InputOTPSlot 基础 Props (仅包含组件库自定义属性)
 */
export interface InputOtpSlotBaseProps {
	/** 槽位索引 (从 0 开始) */
	index: number;
}

export type ItemVariant = 'default' | 'outline' | 'muted';
export type ItemSize = 'default' | 'sm';
export type ItemMediaVariant = 'default' | 'icon' | 'image';

/**
 * 框架无关的 Item 基础 Props（仅包含组件库自定义属性）
 */
export interface ItemBaseProps {
	/**
	 * 条目样式变体
	 */
	variant?: ItemVariant;
	/**
	 * 条目尺寸
	 */
	size?: ItemSize;
	/**
	 * 是否将根元素渲染为子元素（Slot 模式）
	 */
	asChild?: boolean;
}

/**
 * 框架无关的 ItemMedia 基础 Props（仅包含组件库自定义属性）
 */
export interface ItemMediaBaseProps {
	/**
	 * 媒体区变体
	 */
	variant?: ItemMediaVariant;
}

export type MarkerVariant = 'default' | 'separator' | 'border';

/**
 * 框架无关的 Marker 基础 Props（仅包含组件库自定义属性）
 */
export interface MarkerBaseProps {
	/**
	 * 标记颜色变体
	 */
	variant?: MarkerVariant;
	/**
	 * 是否将根元素渲染为子元素（Slot 模式）
	 */
	asChild?: boolean;
}

/**
 * Menubar 弹出方向
 */
export type MenubarSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * Menubar 与触发元素主轴方向的对齐方式
 */
export type MenubarAlign = 'start' | 'center' | 'end';

/**
 * Menubar 开关状态
 */
export type MenubarState = 'open' | 'closed';

/**
 * Menubar 选中/勾选状态
 */
export type MenubarCheckState = 'checked' | 'unchecked';

/**
 * Menubar 菜单项样式变体
 */
export type MenubarItemVariant = 'default' | 'destructive';

/**
 * 框架无关的 Menubar 基础 Props (仅包含组件库自定义属性)
 */
export interface MenubarBaseProps {
	/** 当前打开的菜单值 */
	value?: string;
	/** 默认打开的菜单值 (非受控) */
	defaultValue?: string;
	/** 打开的菜单值变化时的回调 */
	onValueChange?: (value: string | undefined) => void;
}

/**
 * 框架无关的 MenubarMenu 基础 Props
 */
export interface MenubarMenuBaseProps {
	/** 菜单标识值 */
	value: string;
}

/**
 * 框架无关的 MenubarTrigger 基础 Props
 */
export interface MenubarTriggerBaseProps {
	/** 是否禁用 */
	disabled?: boolean;
}

/**
 * 框架无关的 MenubarContent 基础 Props
 */
export interface MenubarContentBaseProps {
	/** 弹出方向 */
	side?: MenubarSide;
	/** 与触发元素主轴方向的对齐方式 */
	align?: MenubarAlign;
	/** 与触发元素之间的间距 (px) */
	sideOffset?: number;
	/** 对齐方向上的额外偏移 (px) */
	alignOffset?: number;
}

/**
 * 框架无关的 MenubarItem 基础 Props
 */
export interface MenubarItemBaseProps {
	/** 是否缩进 (配合前置图标使用) */
	inset?: boolean;
	/** 样式变体 */
	variant?: MenubarItemVariant;
	/** 是否禁用 */
	disabled?: boolean;
	/** 选中触发时的回调 */
	onSelect?: (event: Event) => void;
}

/**
 * 框架无关的 MenubarCheckboxItem 基础 Props
 */
export interface MenubarCheckboxItemBaseProps {
	/** 是否受控勾选 */
	checked?: boolean;
	/** 默认是否勾选 (非受控) */
	defaultChecked?: boolean;
	/** 勾选状态变化时的回调 */
	onCheckedChange?: (checked: boolean) => void;
	/** 是否禁用 */
	disabled?: boolean;
}

/**
 * 框架无关的 MenubarRadioGroup 基础 Props
 */
export interface MenubarRadioGroupBaseProps {
	/** 受控选中值 */
	value?: string;
	/** 默认选中值 (非受控) */
	defaultValue?: string;
	/** 选中值变化时的回调 */
	onValueChange?: (value: string) => void;
}

/**
 * 框架无关的 MenubarRadioItem 基础 Props
 */
export interface MenubarRadioItemBaseProps {
	/** 该项对应的值 */
	value: string;
	/** 是否禁用 */
	disabled?: boolean;
}

/**
 * 框架无关的 MenubarLabel 基础 Props
 */
export interface MenubarLabelBaseProps {
	/** 是否缩进 */
	inset?: boolean;
}

/**
 * 框架无关的 MenubarSub 基础 Props
 */
export interface MenubarSubBaseProps {
	/** 是否受控展开 */
	open?: boolean;
	/** 默认是否展开 (非受控) */
	defaultOpen?: boolean;
	/** 展开状态变化时的回调 */
	onOpenChange?: (open: boolean) => void;
}

/**
 * 框架无关的 MenubarSubTrigger 基础 Props
 */
export interface MenubarSubTriggerBaseProps {
	/** 是否缩进 */
	inset?: boolean;
	/** 是否禁用 */
	disabled?: boolean;
}

/** 消息行水平对齐方式 */
export type MessageAlign = 'start' | 'end';

/**
 * 框架无关的 Message 基础 Props (仅包含组件库自定义属性)
 */
export interface MessageBaseProps {
	/** 水平对齐方式 */
	align?: MessageAlign;
}

/** 滚动按钮方向 */
export type MessageScrollerDirection = 'start' | 'end';

/**
 * 框架无关的 MessageScrollerItem 基础 Props (仅包含组件库自定义属性)
 */
export interface MessageScrollerItemBaseProps {
	/** 是否作为滚动锚点 (新消息到来时保持视口锚定在该条目) */
	scrollAnchor?: boolean;
}

/**
 * 框架无关的 MessageScrollerButton 基础 Props (仅包含组件库自定义属性)
 */
export interface MessageScrollerButtonBaseProps {
	/** 滚动方向 */
	direction?: MessageScrollerDirection;
}

export type NativeSelectSize = 'sm' | 'default';

/**
 * 框架无关的 NativeSelect 基础 Props（仅包含组件库自定义属性）
 */
export interface NativeSelectBaseProps {
	/**
	 * 选择器尺寸
	 */
	size?: NativeSelectSize;
}

/**
 * 框架无关的 NativeSelectOption 基础 Props（仅包含组件库自定义属性）
 */
export interface NativeSelectOptionBaseProps {}

/**
 * 框架无关的 NativeSelectOptGroup 基础 Props（仅包含组件库自定义属性）
 */
export interface NativeSelectOptGroupBaseProps {}

export type PaginationSize = 'default' | 'sm' | 'lg' | 'icon';

/**
 * 框架无关的 Pagination 基础 Props (仅包含组件库自定义属性)
 */
export interface PaginationBaseProps {}

export interface PaginationContentBaseProps {}
export interface PaginationItemBaseProps {}

export interface PaginationLinkBaseProps {
	isActive?: boolean;
	size?: PaginationSize;
}

export interface PaginationEllipsisBaseProps {}

export type PopoverSide = 'top' | 'right' | 'bottom' | 'left';

export type PopoverAlign = 'start' | 'center' | 'end';

export type PopoverState = 'open' | 'closed';

/**
 * 框架无关的 Popover 基础 Props (仅包含组件库自定义属性)
 */
export interface PopoverBaseProps {
	/** 是否受控打开 */
	open?: boolean;
	/** 默认是否打开 (非受控) */
	defaultOpen?: boolean;
	/** 打开状态变化时的回调 */
	onOpenChange?: (open: boolean) => void;
}

/**
 * 框架无关的 PopoverTrigger 基础 Props (仅包含组件库自定义属性)
 */
export interface PopoverTriggerBaseProps {
	/** 是否合并渲染到子元素上 (需唯一根节点) */
	asChild?: boolean;
}

/**
 * 框架无关的 PopoverContent 基础 Props (仅包含组件库自定义属性)
 */
export interface PopoverContentBaseProps {
	/** 弹出方向 */
	side?: PopoverSide;
	/** 与触发元素主轴方向的对齐方式 */
	align?: PopoverAlign;
	/** 与触发元素之间的间距 (px) */
	sideOffset?: number;
}

export type RadioGroupOrientation = 'horizontal' | 'vertical';

/**
 * 框架无关的 RadioGroup 基础 Props (仅包含组件库自定义属性)
 */
export interface RadioGroupBaseProps {
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	orientation?: RadioGroupOrientation;
	name?: string;
	disabled?: boolean;
}

export interface RadioGroupItemBaseProps {
	value?: string;
	disabled?: boolean;
}

/**
 * Resizable 分割方向
 */
export type ResizableDirection = 'horizontal' | 'vertical';

/**
 * 框架无关的 ResizablePanelGroup 基础 Props
 */
export interface ResizablePanelGroupBaseProps {
	/** 分割方向，默认 'horizontal' */
	direction?: ResizableDirection;
	/** 可选持久化标识 (用于 localStorage 记住各面板尺寸) */
	id?: string;
}

/**
 * 侧边栏展开状态
 */
export type SidebarState = 'expanded' | 'collapsed';

/**
 * 侧边栏位置
 */
export type SidebarSide = 'left' | 'right';

/**
 * 侧边栏变体
 */
export type SidebarVariant = 'sidebar' | 'floating' | 'inset';

/**
 * 折叠方式
 */
export type SidebarCollapsible = 'offcanvas' | 'icon' | 'none';

/**
 * 菜单按钮尺寸
 */
export type SidebarMenuButtonSize = 'default' | 'sm' | 'lg';

/**
 * 菜单按钮变体
 */
export type SidebarMenuButtonVariant = 'default' | 'outline';

/**
 * 子菜单按钮尺寸
 */
export type SidebarMenuSubButtonSize = 'sm' | 'md';

/**
 * 嵌套菜单项
 */
export interface SidebarMenuItemDef {
	/** 唯一值 */
	value: string;
	/** 子项 */
	children?: SidebarMenuItemDef[];
}

/**
 * 侧边栏展开状态设置器 (支持函数式更新)
 */
export type SidebarSetOpen = (open: boolean | ((open: boolean) => boolean)) => void;

/**
 * 侧边栏上下文值 (框架无关部分)
 */
export interface SidebarContextValue {
	state: SidebarState;
	open: boolean;
	setOpen: SidebarSetOpen;
	isMobile: boolean;
	openMobile: boolean;
	setOpenMobile: (open: boolean) => void;
	toggleSidebar: () => void;
}

/**
 * Sidebar 基础 Props (框架无关部分)
 */
export interface SidebarBaseProps {
	side?: SidebarSide;
	variant?: SidebarVariant;
	collapsible?: SidebarCollapsible;
}

/**
 * SidebarProvider 基础 Props
 */
export interface SidebarProviderBaseProps {
	/** 默认是否展开 (非受控) */
	defaultOpen?: boolean;
	/** 受控展开状态 */
	open?: boolean;
	/** 展开状态变化回调 */
	onOpenChange?: (open: boolean) => void;
}

/**
 * 当前激活项索引计算结果
 */
export interface SidebarActiveIndexResult {
	/** 一级项索引 (无命中为 -1) */
	itemIndex: number;
	/** 子项索引 (无子项命中为 -1) */
	subIndex: number;
	/** 是否命中子项 */
	activeSub: boolean;
}

/**
 * 侧边栏键盘快捷键事件描述 (纯结构，便于跨框架复用)
 */
export interface SidebarShortcutEvent {
	/** 按键名 */
	key: string;
	/** 是否按下 Meta (Cmd) 键 */
	metaKey?: boolean;
	/** 是否按下 Ctrl 键 */
	ctrlKey?: boolean;
}

/**
 * 侧边栏相关常量
 */
export const SIDEBAR_COOKIE_NAME = 'sidebar_state';
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
export const SIDEBAR_WIDTH = '16rem';
export const SIDEBAR_WIDTH_MOBILE = '18rem';
export const SIDEBAR_WIDTH_ICON = '3rem';
export const SIDEBAR_KEYBOARD_SHORTCUT = 'b';
export const SIDEBAR_MOBILE_BREAKPOINT = 768;
export const SIDEBAR_MEDIA_QUERY = `(max-width: ${SIDEBAR_MOBILE_BREAKPOINT - 1}px)`;

/**
 * 侧边栏样式类名键
 */
export const sidebarStyleKeys = {
	wrapper: 'wrapper',
	sidebar: 'sidebar',
	gap: 'gap',
	container: 'container',
	inner: 'inner',
	content: 'content',
	header: 'header',
	footer: 'footer',
	group: 'group',
	groupLabel: 'groupLabel',
	groupAction: 'groupAction',
	groupContent: 'groupContent',
	menu: 'menu',
	menuItem: 'menuItem',
	menuButton: 'menuButton',
	menuAction: 'menuAction',
	menuBadge: 'menuBadge',
	menuSub: 'menuSub',
	menuSubItem: 'menuSubItem',
	menuSubButton: 'menuSubButton',
	trigger: 'trigger',
	rail: 'rail',
	inset: 'inset',
	separator: 'separator',
	input: 'input',
	link: 'link',
	skeleton: 'skeleton',
	skeletonIcon: 'skeletonIcon',
	skeletonText: 'skeletonText',
	sheetOverlay: 'sheetOverlay',
	sheetContent: 'sheetContent',
	srOnly: 'srOnly',
} as const;

/**
 * 根据布尔值获取侧边栏状态
 */
export function getSidebarState(open: boolean): SidebarState {
	return open ? 'expanded' : 'collapsed';
}

/**
 * 判断视口宽度是否为移动端
 */
export function isMobileViewport(width: number, breakpoint: number = SIDEBAR_MOBILE_BREAKPOINT): boolean {
	return width < breakpoint;
}

/**
 * 判断键盘事件是否触发侧边栏折叠快捷键 (Cmd/Ctrl + b)
 */
export function matchesSidebarToggleShortcut(event: SidebarShortcutEvent): boolean {
	return event.key.toLowerCase() === SIDEBAR_KEYBOARD_SHORTCUT && Boolean(event.metaKey || event.ctrlKey);
}

/**
 * 创建媒体查询监听器 (框架无关；返回取消订阅函数)
 */
export function createMediaQueryWatcher(query: string, onChange: (matches: boolean) => void): () => void {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
		onChange(false);
		return () => {};
	}

	const media = window.matchMedia(query);
	const listener = (event: MediaQueryListEvent) => {
		onChange(event.matches);
	};
	media.addEventListener('change', listener);
	onChange(media.matches);

	return () => {
		media.removeEventListener('change', listener);
	};
}

/**
 * 获取 Sidebar 主体样式类名键 (按变体)
 */
export function getSidebarStyleKeys(variant: SidebarVariant = 'sidebar') {
	return {
		base: 'sidebar',
		variant: `variant${capitalize(variant)}`,
	};
}

/**
 * 获取 SidebarMenuButton 样式类名键
 */
export function getSidebarMenuButtonStyleKeys(variant: SidebarMenuButtonVariant = 'default', size: SidebarMenuButtonSize = 'default') {
	return {
		base: 'menuButton',
		variant: `variant${capitalize(variant)}`,
		size: `size${capitalize(size)}`,
	};
}

/**
 * 获取 SidebarMenuSubButton 样式类名键
 */
export function getSidebarMenuSubButtonStyleKeys(size: 'sm' | 'md' = 'md') {
	return {
		base: 'menuSubButton',
		size: `size${capitalize(size)}`,
	};
}

/**
 * 在嵌套菜单中查找激活项索引
 */
export function findSidebarActiveIndex(items: SidebarMenuItemDef[], activeValue: string): SidebarActiveIndexResult {
	const result: SidebarActiveIndexResult = { itemIndex: -1, subIndex: -1, activeSub: false };

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		const item = items[itemIndex];
		if (item.value === activeValue) {
			result.itemIndex = itemIndex;
			return result;
		}
		const children = item.children ?? [];
		for (let subIndex = 0; subIndex < children.length; subIndex++) {
			if (children[subIndex].value === activeValue) {
				result.itemIndex = itemIndex;
				result.subIndex = subIndex;
				result.activeSub = true;
				return result;
			}
		}
	}

	return result;
}

/** 提示条展示位置 */
export type SonnerPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center';

/** 提示条类型 */
export type SonnerType = 'default' | 'success' | 'info' | 'warning' | 'error' | 'loading';

/** 提示条主题 */
export type SonnerTheme = 'light' | 'dark' | 'system';

/**
 * 单个提示条实例
 */
export interface SonnerToast {
	id: string;
	type: SonnerType;
	title?: string;
	description?: string;
	position?: SonnerPosition;
	duration?: number;
	dismissible?: boolean;
	richColors?: boolean;
	/** 是否正在消失 (用于退出动画) */
	dismissing?: boolean;
}

/** 提示条可更新字段；实例 ID 与消失状态由存储生命周期管理。 */
export type SonnerToastUpdate = Partial<Omit<SonnerToast, 'id' | 'dismissing'>>;

/**
 * 创建提示条的输入参数
 */
export interface SonnerAddInput {
	id?: string;
	type?: SonnerType;
	title?: string;
	description?: string;
	position?: SonnerPosition;
	duration?: number;
	dismissible?: boolean;
	richColors?: boolean;
}

/**
 * 框架无关的 Toaster 基础 Props (仅包含组件库自定义属性)
 */
export interface SonnerToasterBaseProps {
	/** 默认展示位置 */
	position?: SonnerPosition;
	/** 默认自动消失时长 (ms) */
	duration?: number;
	/** 是否显示关闭按钮 */
	closeButton?: boolean;
	/** 是否使用富色 (按类型着色) */
	richColors?: boolean;
	/** 主题；未指定时继承宿主主题 */
	theme?: SonnerTheme;
}

/**
 * Sonner 组件样式类名键
 */
export const sonnerStyleKeys = {
	root: 'root',
	toast: 'toast',
	icon: 'icon',
	content: 'content',
	title: 'title',
	description: 'description',
	close: 'close',
	actions: 'actions',
	action: 'action',
} as const;

/**
 * 默认自动消失时长 (ms)
 */
export const SONNER_DEFAULT_DURATION = 4000;

/**
 * 退出动画时长 (ms)
 */
export const SONNER_DISMISS_DURATION = 200;

/** 将 system 主题解析为当前系统主题，未指定时继续继承宿主主题 */
export function resolveSonnerTheme(theme: SonnerTheme | undefined, prefersDark: boolean): 'light' | 'dark' | undefined {
	return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
}

function toPascal_sonner(value: string): string {
	return value.split('-').map(capitalize).join('');
}

/**
 * 获取 Toaster 位置样式类名键
 */
export function getSonnerPositionStyleKeys(position: SonnerPosition = 'bottom-right') {
	return {
		base: sonnerStyleKeys.root,
		position: `position${toPascal_sonner(position)}`,
	};
}

/**
 * 框架无关的提示条队列存储 (含自动消失定时器)
 */
export interface SonnerStore {
	getToasts(): SonnerToast[];
	subscribe(listener: () => void): () => void;
	add(input: SonnerAddInput): string;
	update(id: string, patch: SonnerToastUpdate): void;
	dismiss(id: string): void;
	remove(id: string): void;
	dismissAll(): void;
	setDefaultDuration(duration: number): void;
}

/**
 * 创建提示条队列存储
 */
export function createSonnerStore(): SonnerStore {
	let toasts: SonnerToast[] = [];
	let defaultDuration = SONNER_DEFAULT_DURATION;
	const listeners = new Set<() => void>();
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

	function notify() {
		for (const listener of listeners) {
			listener();
		}
	}

	function remove(id: string) {
		if (!toasts.some((toast) => toast.id === id)) return;
		toasts = toasts.filter((toast) => toast.id !== id);
		const timer = timers.get(id);
		if (timer) {
			clearTimeout(timer);
			timers.delete(id);
		}
		const dismissTimer = dismissTimers.get(id);
		if (dismissTimer) {
			clearTimeout(dismissTimer);
			dismissTimers.delete(id);
		}
		notify();
	}

	function dismiss(id: string) {
		const current = toasts.find((toast) => toast.id === id);
		if (!current || current.dismissing) return;
		const timer = timers.get(id);
		if (timer) {
			clearTimeout(timer);
			timers.delete(id);
		}
		toasts = toasts.map((toast) => (toast.id === id ? { ...toast, dismissing: true } : toast));
		notify();
		dismissTimers.set(
			id,
			setTimeout(() => {
				dismissTimers.delete(id);
				remove(id);
			}, SONNER_DISMISS_DURATION),
		);
	}

	function schedule(id: string, duration: number) {
		const existing = timers.get(id);
		if (existing) {
			clearTimeout(existing);
			timers.delete(id);
		}
		if (duration <= 0) {
			return;
		}
		timers.set(
			id,
			setTimeout(() => dismiss(id), duration),
		);
	}

	function add(input: SonnerAddInput): string {
		const id = input.id ?? generateId('toast');
		const duration = input.duration ?? defaultDuration;
		const existing = toasts.find((toast) => toast.id === id);
		if (existing) {
			const dismissTimer = dismissTimers.get(id);
			if (dismissTimer) {
				clearTimeout(dismissTimer);
				dismissTimers.delete(id);
			}
			toasts = toasts.map((toast) => (toast.id === id ? { ...toast, ...input, duration, dismissing: false } : toast));
		} else {
			const toast: SonnerToast = {
				id,
				type: 'default',
				duration,
				dismissible: true,
				...input,
			};
			toasts = [...toasts, toast];
		}
		notify();
		schedule(id, duration);
		return id;
	}

	function update(id: string, patch: SonnerToastUpdate) {
		const current = toasts.find((toast) => toast.id === id);
		if (!current) return;
		const { id: _ignoredId, dismissing: _ignoredDismissing, ...safePatch } = patch as SonnerToastUpdate & { id?: string; dismissing?: boolean };
		toasts = toasts.map((toast) => (toast.id === id ? { ...toast, ...safePatch } : toast));
		notify();
		if (safePatch.duration !== undefined && !current.dismissing) schedule(id, safePatch.duration);
	}

	function dismissAll() {
		const ids = toasts.filter((toast) => !toast.dismissing).map((toast) => toast.id);
		if (ids.length === 0) return;
		const idSet = new Set(ids);
		for (const id of ids) {
			const timer = timers.get(id);
			if (timer) clearTimeout(timer);
			timers.delete(id);
		}
		toasts = toasts.map((toast) => (idSet.has(toast.id) ? { ...toast, dismissing: true } : toast));
		notify();
		for (const id of ids) {
			dismissTimers.set(
				id,
				setTimeout(() => {
					dismissTimers.delete(id);
					remove(id);
				}, SONNER_DISMISS_DURATION),
			);
		}
	}

	return {
		getToasts: () => toasts,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		add,
		update,
		dismiss,
		remove,
		dismissAll,
		setDefaultDuration: (duration: number) => {
			defaultDuration = duration;
		},
	};
}

/** toast 函数的调用签名 */
export interface SonnerToastApi {
	(input: string | SonnerAddInput, options?: Omit<SonnerAddInput, 'title'>): string;
	success: (input: string | SonnerAddInput, options?: Omit<SonnerAddInput, 'title'>) => string;
	info: (input: string | SonnerAddInput, options?: Omit<SonnerAddInput, 'title'>) => string;
	warning: (input: string | SonnerAddInput, options?: Omit<SonnerAddInput, 'title'>) => string;
	error: (input: string | SonnerAddInput, options?: Omit<SonnerAddInput, 'title'>) => string;
	loading: (input: string | SonnerAddInput, options?: Omit<SonnerAddInput, 'title'>) => string;
	dismiss: (id?: string) => void;
	dismissAll: () => void;
}

function resolveInput(input: string | SonnerAddInput, options?: Omit<SonnerAddInput, 'title'>): SonnerAddInput {
	if (typeof input === 'string') {
		return { title: input, ...options };
	}
	return input;
}

/**
 * 基于存储构建 toast 编程式 API (框架无关)
 */
export function buildSonnerToastApi(store: SonnerStore): SonnerToastApi {
	function create(type: SonnerType) {
		return (input: string | SonnerAddInput, options?: Omit<SonnerAddInput, 'title'>) => store.add({ ...resolveInput(input, options), type });
	}

	const api = ((input: string | SonnerAddInput, options?: Omit<SonnerAddInput, 'title'>) => store.add(resolveInput(input, options))) as SonnerToastApi;
	api.success = create('success');
	api.info = create('info');
	api.warning = create('warning');
	api.error = create('error');
	api.loading = create('loading');
	api.dismiss = (id?: string) => {
		if (id) {
			store.dismiss(id);
		} else {
			store.dismissAll();
		}
	};
	api.dismissAll = () => store.dismissAll();
	return api;
}

export type ScrollBarOrientation = 'vertical' | 'horizontal';

/**
 * 框架无关的 ScrollArea 基础 Props (仅包含组件库自定义属性)
 */
export interface ScrollAreaBaseProps {}

export interface ScrollBarBaseProps {
	orientation?: ScrollBarOrientation;
}

/**
 * Select 弹出方向
 */
export type SelectSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * Select 与触发元素主轴方向的对齐方式
 */
export type SelectAlign = 'start' | 'center' | 'end';

/**
 * Select 开关状态
 */
export type SelectState = 'open' | 'closed';

/**
 * Select 选中/勾选状态
 */
export type SelectCheckState = 'checked' | 'unchecked';

/**
 * Select 触发按钮尺寸
 */
export type SelectTriggerSize = 'sm' | 'default';

/**
 * Select 内容定位策略
 */
export type SelectPosition = 'item-aligned' | 'popper';

/**
 * 框架无关的 Select 基础 Props (仅包含组件库自定义属性)
 */
export interface SelectBaseProps {
	/** 是否受控打开 */
	open?: boolean;
	/** 默认是否打开 (非受控) */
	defaultOpen?: boolean;
	/** 打开状态变化时的回调 */
	onOpenChange?: (open: boolean) => void;
	/** 受控选中值 */
	value?: string;
	/** 默认选中值 (非受控) */
	defaultValue?: string;
	/** 选中值变化时的回调 */
	onValueChange?: (value: string) => void;
}

/**
 * 框架无关的 SelectTrigger 基础 Props
 */
export interface SelectTriggerBaseProps {
	/** 触发按钮尺寸 */
	size?: SelectTriggerSize;
}

/**
 * 框架无关的 SelectContent 基础 Props
 */
export interface SelectContentBaseProps {
	/** 定位策略 (item-aligned 将选中项对齐到触发元素，popper 锚定触发元素) */
	position?: SelectPosition;
	/** 与触发元素主轴方向的对齐方式 */
	align?: SelectAlign;
	/** 与触发元素之间的间距 (px) */
	sideOffset?: number;
}

/**
 * 框架无关的 SelectItem 基础 Props
 */
export interface SelectItemBaseProps {
	/** 该项对应的值 */
	value: string;
	/** 是否禁用 */
	disabled?: boolean;
}

export type SeparatorOrientation = 'horizontal' | 'vertical';

/**
 * 框架无关的 Separator 基础 Props (仅包含组件库自定义属性)
 */
export interface SeparatorBaseProps {
	orientation?: SeparatorOrientation;
	decorative?: boolean;
}

/**
 * Sheet 弹出方向
 */
export type SheetSide = 'left' | 'right' | 'top' | 'bottom';

/**
 * 框架无关的 Sheet 基础 Props (仅包含组件库自定义属性)
 */
export interface SheetBaseProps {}

export type SliderOrientation = 'horizontal' | 'vertical';

/**
 * 框架无关的 Slider 基础 Props (仅包含组件库自定义属性)
 */
export interface SliderBaseProps {
	orientation?: SliderOrientation;
	min?: number;
	max?: number;
	step?: number;
	value?: number;
	defaultValue?: number;
	onValueChange?: (value: number) => void;
	disabled?: boolean;
}

export type SpinnerSize = 'sm' | 'default' | 'lg';

/**
 * 框架无关的 Spinner 基础 Props（仅包含组件库自定义属性）
 */
export interface SpinnerBaseProps {
	/**
	 * 加载指示器尺寸
	 */
	size?: SpinnerSize;
}

export type SwitchSize = 'default' | 'sm';

/**
 * 框架无关的 Switch 基础 Props (仅包含组件库自定义属性)
 */
export interface SwitchBaseProps {
	size?: SwitchSize;
}

export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

export type TooltipState = 'open' | 'closed';

/**
 * 框架无关的 TooltipProvider 基础 Props (仅包含组件库自定义属性)
 */
export interface TooltipProviderBaseProps {
	/** 延迟打开的毫秒数 (hover/focus 后多久显示) */
	delayDuration?: number;
}

/**
 * 框架无关的 Tooltip 基础 Props (仅包含组件库自定义属性)
 */
export interface TooltipBaseProps {
	/** 是否受控打开 */
	open?: boolean;
	/** 默认是否打开 (非受控) */
	defaultOpen?: boolean;
	/** 打开状态变化时的回调 */
	onOpenChange?: (open: boolean) => void;
}

/**
 * 框架无关的 TooltipTrigger 基础 Props (仅包含组件库自定义属性)
 */
export interface TooltipTriggerBaseProps {
	/** 是否合并渲染到子元素上 (需唯一根节点) */
	asChild?: boolean;
}

/**
 * 框架无关的 TooltipContent 基础 Props (仅包含组件库自定义属性)
 */
export interface TooltipContentBaseProps {
	/** 弹出方向 */
	side?: TooltipSide;
	/** 与触发元素之间的间距 (px) */
	sideOffset?: number;
}

/**
 * Tooltip 组件样式类名键
 */
export const tooltipStyleKeys = {
	root: 'root',
	trigger: 'trigger',
	content: 'content',
	arrow: 'arrow',
} as const;

/** 触发元素矩形信息 (与 DOMRect 结构兼容，由框架测量传入) */
export interface TooltipRect {
	top: number;
	right: number;
	bottom: number;
	left: number;
	width: number;
	height: number;
}

/** 内容尺寸 */
export interface TooltipSize {
	width: number;
	height: number;
}

/** 视口尺寸 */
export interface TooltipViewport {
	width: number;
	height: number;
}

/** 定位输入参数 */
export interface TooltipPositionInput {
	triggerRect: TooltipRect;
	contentSize: TooltipSize;
	side: TooltipSide;
	sideOffset: number;
	viewport: TooltipViewport;
}

/** 定位结果 (position: fixed 坐标) */
export interface TooltipPosition {
	top: number;
	left: number;
}

/** 内容与视口边缘的最小间距 */
export const TOOLTIP_VIEWPORT_MARGIN = 4;

/** 指针移出触发元素/内容后延迟关闭的毫秒数 (用于平滑过渡到内容悬停) */
export const TOOLTIP_CLOSE_DELAY_MS = 100;

/**
 * 根据 RTL 解析物理方向 (RTL 下左右互换)
 */
export function resolveTooltipSide(side: TooltipSide, rtl: boolean = false): TooltipSide {
	if (!rtl) {
		return side;
	}
	if (side === 'left') {
		return 'right';
	}
	if (side === 'right') {
		return 'left';
	}
	return side;
}

/**
 * 获取 side 对应的方向向量 (x 表示水平偏移方向，y 表示垂直偏移方向)
 */
export function getTooltipSideOffsetPlacement(side: TooltipSide): { x: number; y: number } {
	switch (side) {
		case 'top':
			return { x: 0, y: -1 };
		case 'right':
			return { x: 1, y: 0 };
		case 'bottom':
			return { x: 0, y: 1 };
		case 'left':
			return { x: -1, y: 0 };
	}
}

/**
 * 根据布尔值获取 Tooltip 的状态标识
 */
export function getTooltipState(open: boolean): TooltipState {
	return open ? 'open' : 'closed';
}

/**
 * 计算 Tooltip 内容定位 (fixed 坐标，基于触发元素矩形居中放置)
 */
export function getTooltipPosition(input: TooltipPositionInput): TooltipPosition {
	const { triggerRect, contentSize, side, sideOffset, viewport } = input;

	let top = 0;
	let left = 0;

	switch (side) {
		case 'top':
			top = triggerRect.top - contentSize.height - sideOffset;
			left = triggerRect.left + triggerRect.width / 2 - contentSize.width / 2;
			break;
		case 'right':
			left = triggerRect.right + sideOffset;
			top = triggerRect.top + triggerRect.height / 2 - contentSize.height / 2;
			break;
		case 'bottom':
			top = triggerRect.bottom + sideOffset;
			left = triggerRect.left + triggerRect.width / 2 - contentSize.width / 2;
			break;
		case 'left':
			left = triggerRect.left - contentSize.width - sideOffset;
			top = triggerRect.top + triggerRect.height / 2 - contentSize.height / 2;
			break;
	}

	const margin = TOOLTIP_VIEWPORT_MARGIN;
	const maxLeft = Math.max(margin, viewport.width - contentSize.width - margin);
	const maxTop = Math.max(margin, viewport.height - contentSize.height - margin);

	return {
		left: Math.min(Math.max(left, margin), maxLeft),
		top: Math.min(Math.max(top, margin), maxTop),
	};
}

export type TabsOrientation = 'horizontal' | 'vertical';
export type TabsListVariant = 'default' | 'line';

/**
 * 框架无关的 Tabs 基础 Props (仅包含组件库自定义属性)
 */
export interface TabsBaseProps {
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	orientation?: TabsOrientation;
}

export interface TabsListBaseProps {
	variant?: TabsListVariant;
}

export interface TabsTriggerBaseProps {
	value?: string;
	disabled?: boolean;
}

export interface TabsContentBaseProps {
	value?: string;
}

export type ToggleVariant = 'default' | 'outline' | 'ghost';
export type ToggleSize = 'sm' | 'default' | 'lg';

/**
 * 框架无关的 Toggle 基础 Props（仅包含组件库自定义属性）
 */
export interface ToggleBaseProps {
	/**
	 * 切换按钮样式变体
	 */
	variant?: ToggleVariant;
	/**
	 * 切换按钮尺寸
	 */
	size?: ToggleSize;
}

export type ToggleGroupType = 'single' | 'multiple';

/**
 * 框架无关的 ToggleGroup 基础 Props（仅包含组件库自定义属性）
 */
export interface ToggleGroupBaseProps {
	/**
	 * 选择模式：单选或多选
	 */
	type?: ToggleGroupType;
}

/**
 * 框架无关的 ToggleGroupItem 基础 Props（仅包含组件库自定义属性）
 */
export interface ToggleGroupItemBaseProps {
	/**
	 * 选项值
	 */
	value: string;
	/**
	 * 选项样式变体
	 */
	variant?: ToggleVariant;
	/**
	 * 选项尺寸
	 */
	size?: ToggleSize;
}

export type AccordionState = 'open' | 'closed';

/**
 * 根据展开状态获取 Accordion 的状态标识
 */
export function getAccordionState(open: boolean): AccordionState {
	return open ? 'open' : 'closed';
}

/**
 * 在列表中切换某个值（存在则移除，不存在则追加）
 */
export function getAccordionNextValues(value: string, list: string[]): string[] {
	if (list.includes(value)) {
		return list.filter((item) => item !== value);
	}
	return [...list, value];
}

/**
 * Accordion 组件样式类名键
 */
export const accordionStyleKeys = {
	root: 'root',
	item: 'item',
	header: 'header',
	trigger: 'trigger',
	chevron: 'chevron',
	content: 'content',
	contentInner: 'contentInner',
} as const;

/**
 * Calendar 组件样式类名键
 */
export const calendarStyleKeys = {
	root: 'root',
	header: 'header',
	nav: 'nav',
	navButton: 'navButton',
	navPrev: 'navPrev',
	navNext: 'navNext',
	monthCaption: 'monthCaption',
	weekdays: 'weekdays',
	weekday: 'weekday',
	weeks: 'weeks',
	week: 'week',
	day: 'day',
	dayButton: 'dayButton',
	icon: 'icon',
} as const;

/**
 * 在当前日期上增加若干天（纯函数）
 */
export function addDays(date: Date, days: number): Date {
	const result = new Date(date);
	result.setDate(result.getDate() + days);
	return result;
}

/**
 * 在当前日期上增加若干月（自动修正日溢出，如 1/31 加一个月得到 2/28）
 */
export function addMonths(date: Date, count: number): Date {
	const result = new Date(date);
	const targetDay = result.getDate();
	result.setDate(1);
	result.setMonth(result.getMonth() + count);
	const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
	result.setDate(Math.min(targetDay, lastDay));
	return result;
}

/**
 * 返回某日期所在月份的第一天（时间归零）
 */
export function startOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * 判断两个日期是否为同一天（仅比较年月日）
 */
export function isSameDay(a: Date, b: Date | undefined): boolean {
	if (!b) {
		return false;
	}
	return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * 判断两个日期是否在同一月份
 */
export function isSameMonth(a: Date, b: Date | undefined): boolean {
	if (!b) {
		return false;
	}
	return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/**
 * 判断某日期是否是今天
 */
export function isToday(date: Date): boolean {
	return isSameDay(date, new Date());
}

/**
 * 判断日期是否位于 from 与 to 之间（含端点）
 */
export function isDateBetween(date: Date, from: Date, to: Date): boolean {
	const time = date.getTime();
	return time >= from.getTime() && time <= to.getTime();
}

/**
 * 判断日期是否落在范围 {from, to} 内（含端点，from 缺省时返回 false）
 */
export function isDateInRange(date: Date, range: CalendarRange | undefined): boolean {
	if (!range?.from) {
		return false;
	}
	if (!range.to) {
		return isSameDay(date, range.from);
	}
	if (range.from.getTime() > range.to.getTime()) {
		return isDateBetween(date, range.to, range.from);
	}
	return isDateBetween(date, range.from, range.to);
}

/**
 * 生成月份网格：6 行 x 7 列，从周日起排。showOutsideDays 为 false 时相邻月份的天以 null 占位
 */
export function getMonthGrid(month: Date, showOutsideDays: boolean = true): Array<Array<Date | null>> {
	const first = startOfMonth(month);
	const gridStart = addDays(first, -first.getDay());

	return Array.from({ length: 6 }, (_, w) =>
		Array.from({ length: 7 }, (_, d) => {
			const date = addDays(gridStart, w * 7 + d);
			if (!showOutsideDays && !isSameMonth(date, first)) {
				return null;
			}
			return date;
		}),
	);
}

function toCalendarFormatDate(date: Date): Date {
	return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

const calendarFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getCalendarFormatter(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const resolvedOptions = { ...options, timeZone: 'UTC' };
	const optionsKey = Object.entries(resolvedOptions)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}:${String(value)}`)
		.join(',');
	const cacheKey = `${locale ?? ''}|${optionsKey}`;
	let formatter = calendarFormatterCache.get(cacheKey);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat(locale, resolvedOptions);
		calendarFormatterCache.set(cacheKey, formatter);
	}
	return formatter;
}

function formatCalendarDate(date: Date, locale: string | undefined, options: Intl.DateTimeFormatOptions): string {
	return getCalendarFormatter(locale, options).format(toCalendarFormatDate(date));
}

/**
 * 生成星期表头标签（从周日开始，如 ['Sun', 'Mon', ...]）
 */
export function getWeekdayLabels(locale?: string): string[] {
	const sunday = new Date(2024, 0, 7);
	return Array.from({ length: 7 }, (_, i) => formatCalendarDate(addDays(sunday, i), locale, { weekday: 'short' }));
}

/**
 * 生成月份标题（如 "August 2026"）
 */
export function getMonthCaption(month: Date, locale?: string): string {
	return formatCalendarDate(month, locale, { month: 'long', year: 'numeric' });
}

/**
 * 生成日期的完整可访问名称（如 "Thursday, February 29, 2024"）
 */
export function getCalendarDayLabel(date: Date, locale?: string): string {
	return formatCalendarDate(date, locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * 从选中值中提取一个代表日期（用于初始化展示月份）
 */
export function getCalendarFirstSelectedDate(selection: CalendarSelection): Date | undefined {
	if (!selection) {
		return undefined;
	}
	if (selection instanceof Date) {
		return selection;
	}
	if (Array.isArray(selection)) {
		return selection[0];
	}
	return selection.from ?? selection.to;
}

/**
 * 计算某日期的修饰状态（选中 / 范围 / 禁用 / 今天等）
 */
export function getCalendarDayModifiers(
	day: Date,
	month: Date,
	selection: CalendarSelection,
	showOutsideDays: boolean = true,
	disabled?: CalendarDisabledMatcher,
	today: Date = new Date(),
): CalendarDayModifiers {
	const outside = !isSameMonth(day, month);
	let selected = false;
	let rangeStart = false;
	let rangeEnd = false;
	let rangeMiddle = false;

	if (selection) {
		if (Array.isArray(selection)) {
			selected = selection.some((item) => isSameDay(day, item));
		} else if (selection instanceof Date) {
			selected = isSameDay(day, selection);
		} else {
			const from = selection.from;
			const to = selection.to;
			selected = isDateInRange(day, selection);
			rangeStart = !!from && isSameDay(day, from);
			rangeEnd = !!to && isSameDay(day, to);
			rangeMiddle = !!from && !!to && selected && !rangeStart && !rangeEnd;
		}
	}

	return {
		selected,
		rangeStart,
		rangeEnd,
		rangeMiddle,
		outside,
		disabled: disabled ? disabled(day) : false,
		today: isSameDay(day, today),
	};
}

/**
 * 根据模式与当前选中值计算点击某天后新的选中值（纯函数）
 */
export function selectCalendarDay(mode: CalendarMode, selection: CalendarSelection, day: Date): CalendarSelection {
	if (mode === 'single') {
		return day;
	}

	if (mode === 'multiple') {
		const list = Array.isArray(selection) ? selection : [];
		return isSameDay(
			day,
			list.find((item) => isSameDay(day, item)),
		)
			? list.filter((item) => !isSameDay(day, item))
			: [...list, day];
	}

	// range 模式
	const range: CalendarRange = selection && !Array.isArray(selection) && !(selection instanceof Date) ? selection : {};
	if (range.from && range.to) {
		return { from: day };
	}
	if (range.from) {
		if (day.getTime() < range.from.getTime()) {
			return { from: day };
		}
		return { from: range.from, to: day };
	}
	return { from: day };
}

/**
 * AlertDialog 组件样式类名键
 */
export const alertDialogStyleKeys = {
	overlay: 'overlay',
	content: 'content',
	header: 'header',
	footer: 'footer',
	title: 'title',
	description: 'description',
} as const;

/**
 * AlertDialog 弹层开关状态
 */
export type AlertDialogState = 'open' | 'closed';

/**
 * 根据开关状态获取弹层状态标识 (open | closed)
 */
export function getAlertDialogState(open: boolean): AlertDialogState {
	return open ? 'open' : 'closed';
}

/**
 * Alert 组件样式类名键
 */
export const alertStyleKeys = {
	title: 'title',
	description: 'description',
} as const;

/**
 * 获取 Alert 的样式类名键
 */
export function getAlertStyleKeys(variant: AlertVariant = 'default') {
	return {
		base: 'alert',
		variant: `variant${capitalize(variant)}`,
	};
}

/**
 * AspectRatio 组件样式类名键
 */
export const aspectRatioStyleKeys = {
	root: 'root',
	content: 'content',
} as const;

/**
 * 根据宽高比计算 padding-top 百分比（1 / ratio * 100）
 */
export function getAspectRatioPadding(ratio: number = 1): number {
	if (!Number.isFinite(ratio) || ratio <= 0) {
		return 100;
	}

	return (1 / ratio) * 100;
}

/**
 * Attachment 组件样式类名键
 */
export const attachmentStyleKeys = {
	root: 'attachment',
	group: 'group',
	media: 'media',
	content: 'content',
	title: 'title',
	description: 'description',
	actions: 'actions',
	action: 'action',
	trigger: 'trigger',
	card: 'card',
} as const;

/**
 * 获取 Attachment 根节点样式类名键
 */
export function getAttachmentStyleKeys(size: AttachmentSize = 'default', orientation: AttachmentOrientation = 'horizontal') {
	return {
		base: attachmentStyleKeys.root,
		size: `size${capitalize(size)}`,
		orientation: `orientation${capitalize(orientation)}`,
	};
}

/**
 * 获取 AttachmentMedia 样式类名键
 */
export function getAttachmentMediaStyleKeys(variant: AttachmentMediaVariant = 'icon') {
	return {
		base: attachmentStyleKeys.media,
		variant: `variant${capitalize(variant)}`,
	};
}

/**
 * 按扩展名映射到文件类型
 */
const EXTENSION_KIND_MAP: Record<string, AttachmentFileKind> = {
	png: 'image',
	jpg: 'image',
	jpeg: 'image',
	gif: 'image',
	webp: 'image',
	svg: 'image',
	bmp: 'image',
	avif: 'image',
	ico: 'image',
	mp4: 'video',
	webm: 'video',
	mov: 'video',
	mkv: 'video',
	avi: 'video',
	m4v: 'video',
	mp3: 'audio',
	wav: 'audio',
	ogg: 'audio',
	flac: 'audio',
	m4a: 'audio',
	aac: 'audio',
	pdf: 'pdf',
	txt: 'document',
	md: 'document',
	doc: 'document',
	docx: 'document',
	rtf: 'document',
	odt: 'document',
	xls: 'spreadsheet',
	xlsx: 'spreadsheet',
	csv: 'spreadsheet',
	ppt: 'presentation',
	pptx: 'presentation',
	key: 'presentation',
	zip: 'archive',
	rar: 'archive',
	'7z': 'archive',
	tar: 'archive',
	gz: 'archive',
	bz2: 'archive',
	js: 'code',
	ts: 'code',
	tsx: 'code',
	jsx: 'code',
	html: 'code',
	css: 'code',
	scss: 'code',
	json: 'code',
	py: 'code',
	java: 'code',
	go: 'code',
	rs: 'code',
	c: 'code',
	cpp: 'code',
	h: 'code',
	sh: 'code',
};

/**
 * 按 MIME 前缀映射到文件类型
 */
const MIME_PREFIX_KIND_MAP: Array<[string, AttachmentFileKind]> = [
	['image/', 'image'],
	['video/', 'video'],
	['audio/', 'audio'],
	['application/pdf', 'pdf'],
	['text/plain', 'document'],
	['application/zip', 'archive'],
	['application/x-rar-compressed', 'archive'],
	['application/x-7z-compressed', 'archive'],
	['application/x-tar', 'archive'],
	['application/gzip', 'archive'],
];

/**
 * 提取文件名扩展名（小写、去掉点号）
 */
export function getAttachmentFileExtension(filename?: string): string {
	if (!filename) {
		return '';
	}
	const dot = filename.lastIndexOf('.');
	if (dot < 0) {
		return '';
	}
	return filename.slice(dot + 1).toLowerCase();
}

/**
 * 根据文件名 / MIME 类型推导附件文件类型
 */
export function getAttachmentFileKind(filename?: string, mimeType?: string): AttachmentFileKind {
	const byMime = mimeType ? MIME_PREFIX_KIND_MAP.find(([prefix]) => mimeType.toLowerCase().startsWith(prefix)) : undefined;
	if (byMime) {
		return byMime[1];
	}
	return EXTENSION_KIND_MAP[getAttachmentFileExtension(filename)] ?? 'generic';
}

/**
 * 格式化附件大小（字节 → 人类可读）
 */
export function formatAttachmentSize(bytes?: number): string {
	if (bytes === undefined || bytes === null || Number.isNaN(bytes)) {
		return '';
	}
	return formatBytes(bytes, 1);
}

/**
 * 截断附件名称，超长部分以省略号结尾
 */
export function truncateAttachmentName(name: string, maxLength: number = 40): string {
	const normalized = name.trim();
	if (normalized.length <= maxLength) {
		return normalized;
	}
	const extension = getAttachmentFileExtension(normalized);
	const extSuffix = extension ? `.${extension}` : '';
	const keepLength = Math.max(maxLength - extSuffix.length - 1, 4);
	const stem = normalized.slice(0, normalized.length - extSuffix.length);
	return `${stem.slice(0, keepLength)}\u2026${extSuffix}`;
}

/**
 * 附件下载/操作状态
 */
export type AttachmentActionState = 'idle' | 'downloading' | 'error';

/**
 * 根据下载状态与错误状态推导操作状态
 */
export function getAttachmentActionState(downloading?: boolean, hasError?: boolean): AttachmentActionState {
	if (hasError) {
		return 'error';
	}
	if (downloading) {
		return 'downloading';
	}
	return 'idle';
}

/**
 * 附件是否可执行操作（非上传/处理中）
 */
export function isAttachmentActionable(state?: string): boolean {
	return state === undefined || state === 'done' || state === 'idle';
}

/**
 * Breadcrumb 组件样式类名键
 */
export const breadcrumbStyleKeys = {
	root: 'root',
	list: 'list',
	item: 'item',
	link: 'link',
	page: 'page',
	separator: 'separator',
	ellipsis: 'ellipsis',
	ellipsisIcon: 'ellipsisIcon',
	srOnly: 'srOnly',
} as const;

/**
 * Bubble 组件样式类名键
 */
export const bubbleStyleKeys = {
	group: 'group',
	root: 'bubble',
	content: 'content',
	reactions: 'reactions',
} as const;

/**
 * 获取 Bubble 根节点样式类名键
 */
export function getBubbleStyleKeys(variant: BubbleVariant = 'default') {
	return {
		base: bubbleStyleKeys.root,
		variant: `variant${capitalize(variant)}`,
	};
}

/**
 * ButtonGroup 组件样式类名键
 */
export const buttonGroupStyleKeys = {
	base: 'buttonGroup',
	text: 'text',
	separator: 'separator',
} as const;

/**
 * 获取 ButtonGroup 的样式类名键（含排列方向）
 */
export function getButtonGroupStyleKeys(orientation: ButtonGroupOrientation = 'horizontal') {
	return {
		base: 'buttonGroup',
		orientation: `orientation${capitalize(orientation)}`,
	};
}

/**
 * Card 组件样式类名键
 */
export const cardStyleKeys = {
	card: 'card',
	header: 'cardHeader',
	title: 'cardTitle',
	description: 'cardDescription',
	action: 'cardAction',
	content: 'cardContent',
	footer: 'cardFooter',
} as const;

/**
 * Carousel 组件样式类名键
 */
export const carouselStyleKeys = {
	root: 'root',
	viewport: 'viewport',
	container: 'container',
	item: 'item',
	previous: 'previous',
	next: 'next',
} as const;

/**
 * 获取滚动容器当前的滚动位置 (水平: scrollLeft / 垂直: scrollTop)
 */
export function getCarouselScrollPosition(element: HTMLElement, orientation: CarouselOrientation): number {
	return orientation === 'horizontal' ? element.scrollLeft : element.scrollTop;
}

/**
 * 获取滚动容器单页尺寸 (水平: clientWidth / 垂直: clientHeight)
 */
export function getCarouselScrollSize(element: HTMLElement, orientation: CarouselOrientation): number {
	return orientation === 'horizontal' ? element.clientWidth : element.clientHeight;
}

/**
 * 获取 item 相对首个 item 的滚动目标位置，保持容器 gutter 一致
 */
export function getCarouselItemScrollPosition(firstItem: HTMLElement, item: HTMLElement, orientation: CarouselOrientation): number {
	const firstItemRect = firstItem.getBoundingClientRect();
	const itemRect = item.getBoundingClientRect();
	return orientation === 'horizontal' ? itemRect.left - firstItemRect.left : itemRect.top - firstItemRect.top;
}

/**
 * 获取滚动容器最大可滚动距离
 */
export function getCarouselMaxScroll(element: HTMLElement, orientation: CarouselOrientation): number {
	return orientation === 'horizontal' ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight;
}

/**
 * 判断是否可以向前滚动 (位置大于 0)
 */
export function getCarouselCanScrollPrev(position: number): boolean {
	return position > 0;
}

/**
 * 判断是否可以向后滚动 (位置小于最大滚动距离)
 */
export function getCarouselCanScrollNext(position: number, maxScroll: number): boolean {
	return position < maxScroll;
}

/**
 * 根据滚动位置与单页尺寸计算当前激活的 item 索引
 */
export function getCarouselSelectedIndex(position: number, itemSize: number): number {
	if (itemSize <= 0) {
		return 0;
	}
	return Math.round(position / itemSize);
}

/**
 * 将滚动位置限制在 [0, maxScroll] 区间内
 */
export function clampCarouselScroll(position: number, maxScroll: number): number {
	return Math.max(0, Math.min(position, maxScroll));
}

export type CheckboxState = 'checked' | 'unchecked' | 'mixed';

/**
 * 根据选中状态获取 Checkbox 的状态标识
 */
export function getCheckboxState(checked: CheckboxCheckedState): CheckboxState {
	if (checked === 'indeterminate') {
		return 'mixed';
	}
	return checked ? 'checked' : 'unchecked';
}

/**
 * 计算点击后 Checkbox 的下一个选中状态
 */
export function getNextCheckboxState(checked: CheckboxCheckedState): CheckboxCheckedState {
	return checked === true ? false : true;
}

/**
 * Checkbox 组件样式类名键
 */
export const checkboxStyleKeys = {
	root: 'root',
	indicator: 'indicator',
} as const;

/**
 * 将 Slider 值限制在 [min, max] 区间内
 */
export function clampSliderValue(value: number, min: number = 0, max: number = 100): number {
	if (Number.isNaN(value)) {
		return min;
	}
	return Math.min(max, Math.max(min, value));
}

/**
 * 计算 Slider 值在 [min, max] 区间内对应的百分比（0-100）
 */
export function getSliderPercent(value: number, min: number = 0, max: number = 100): number {
	const clamped = clampSliderValue(value, min, max);
	const range = max - min;
	if (range <= 0) {
		return 0;
	}
	return ((clamped - min) / range) * 100;
}

/**
 * 计算 Slider 拇指的定位样式（水平: left / 垂直: top 百分比）
 */
export function getSliderOffsetStyle(value: number, min: number = 0, max: number = 100, orientation: SliderOrientation = 'horizontal') {
	const percent = getSliderPercent(value, min, max);
	if (orientation === 'vertical') {
		return { top: `${percent}%` };
	}
	return { left: `${percent}%` };
}

/**
 * Slider 组件样式类名键
 */
export const sliderStyleKeys = {
	root: 'root',
	track: 'track',
	range: 'range',
	thumb: 'thumb',
} as const;

export type CollapsibleState = 'open' | 'closed';

/**
 * 根据布尔值获取 Collapsible 的状态标识
 */
export function getCollapsibleState(open: boolean): CollapsibleState {
	return open ? 'open' : 'closed';
}

/**
 * 计算切换后的展开状态
 */
export function getNextCollapsibleOpen(open: boolean): boolean {
	return !open;
}

/**
 * Collapsible 组件样式类名键
 */
export const collapsibleStyleKeys = {
	root: 'root',
	trigger: 'trigger',
	content: 'content',
	contentInner: 'contentInner',
} as const;

/**
 * Combobox 组件样式类名键
 */
export const comboboxStyleKeys = {
	root: 'root',
	trigger: 'trigger',
	triggerValue: 'triggerValue',
	triggerIcon: 'triggerIcon',
	content: 'content',
	list: 'list',
	item: 'item',
	itemIndicator: 'itemIndicator',
	empty: 'empty',
	group: 'group',
	label: 'label',
	separator: 'separator',
	search: 'search',
	searchInput: 'searchInput',
} as const;

/** 默认最大展示条数 */
export const COMBOBOX_DEFAULT_MAX_ITEMS = 8;

/**
 * 归一化搜索查询 (去空白、转小写)
 */
export function normalizeComboboxQuery(query: string): string {
	return query.trim().toLowerCase();
}

/**
 * 默认匹配函数：标签、值、关键字包含即匹配
 */
export function matchComboboxItem(item: ComboboxItem, query: string): boolean {
	if (!query) {
		return true;
	}
	const normalized = normalizeComboboxQuery(query);
	if (item.label.toLowerCase().includes(normalized)) {
		return true;
	}
	if (item.value.toLowerCase().includes(normalized)) {
		return true;
	}
	return (item.keywords ?? []).some((keyword) => keyword.toLowerCase().includes(normalized));
}

/**
 * 过滤候选项 (支持自定义 filter，受 maxItems 限制)
 */
export function filterComboboxItems(
	items: ComboboxItem[],
	query: string,
	maxItems: number = COMBOBOX_DEFAULT_MAX_ITEMS,
	filter?: (item: ComboboxItem, query: string) => boolean,
): ComboboxItem[] {
	const predicate = filter ?? matchComboboxItem;
	return items.filter((item) => predicate(item, query)).slice(0, maxItems);
}

/**
 * 统计匹配总数
 */
export function countComboboxMatches(items: ComboboxItem[], query: string, filter?: (item: ComboboxItem, query: string) => boolean): number {
	const predicate = filter ?? matchComboboxItem;
	if (!query) {
		return items.length;
	}
	return items.filter((item) => predicate(item, query)).length;
}

/**
 * 计算键盘导航下一个索引 (支持环绕)
 */
export function moveComboboxIndex(current: number, direction: 1 | -1, length: number, wrap: boolean = true): number {
	if (length === 0) {
		return -1;
	}
	if (current === -1) {
		return direction === 1 ? 0 : length - 1;
	}
	const next = current + direction;
	if (next < 0) {
		return wrap ? length - 1 : 0;
	}
	if (next >= length) {
		return wrap ? 0 : length - 1;
	}
	return next;
}

/**
 * Command 组件样式类名键
 */
export const commandStyleKeys = {
	root: 'root',
	inputWrapper: 'inputWrapper',
	input: 'input',
	inputIcon: 'inputIcon',
	list: 'list',
	empty: 'empty',
	group: 'group',
	groupLabel: 'groupLabel',
	groupContent: 'groupContent',
	item: 'item',
	separator: 'separator',
	shortcut: 'shortcut',
	dialogOverlay: 'dialogOverlay',
	dialogContent: 'dialogContent',
	dialogTitle: 'dialogTitle',
	dialogDescription: 'dialogDescription',
	dialogClose: 'dialogClose',
} as const;

/**
 * 默认匹配函数 (与 cmdk 语义一致：值/关键字包含即匹配)
 */
export function matchCommandItem(item: CommandItemDef, query: string): boolean {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return true;
	}
	if (item.value.toLowerCase().includes(normalized)) {
		return true;
	}
	if ((item.label ?? '').toLowerCase().includes(normalized)) {
		return true;
	}
	return (item.keywords ?? []).some((keyword) => keyword.toLowerCase().includes(normalized));
}

/**
 * 过滤命令项 (支持自定义 filter)
 */
export function filterCommandItems(items: CommandItemDef[], query: string, filter?: CommandFilterFn): CommandItemDef[] {
	const predicate: CommandFilterFn = filter ?? ((value, search, keywords) => matchCommandItem({ value, keywords }, search));
	return items.filter((item) => predicate(item.value, query, item.keywords));
}

/**
 * 过滤并分组 (返回分组结构与扁平项列表)
 */
export function filterCommandGroups(groups: CommandGroupDef[], query: string, filter?: CommandFilterFn): CommandFilterResult {
	const result: CommandFilterResult = { groups: [], items: [], empty: false };

	for (const group of groups) {
		const matchedItems = filterCommandItems(group.items, query, filter);
		if (matchedItems.length === 0) {
			continue;
		}
		result.groups.push({ ...group, items: matchedItems });
		result.items.push(...matchedItems);
	}

	result.empty = result.items.length === 0;
	return result;
}

/**
 * 扁平列表 (含分组标题，用于键盘导航索引计算)
 */
export function flattenCommandGroups(
	groups: CommandGroupDef[],
	query: string,
	filter?: CommandFilterFn,
): Array<{ type: 'group' | 'item'; item?: CommandItemDef; group?: CommandGroupDef }> {
	const filtered = filterCommandGroups(groups, query, filter);
	const flat: Array<{ type: 'group' | 'item'; item?: CommandItemDef; group?: CommandGroupDef }> = [];

	for (const group of filtered.groups) {
		flat.push({ type: 'group', group });
		for (const item of group.items) {
			flat.push({ type: 'item', item });
		}
	}

	return flat;
}

/**
 * 计算键盘导航下一个索引 (仅统计可聚焦项，支持环绕)
 */
export function moveCommandIndex(current: number, direction: 1 | -1, length: number, loop: boolean = true): number {
	if (length === 0) {
		return -1;
	}
	if (current === -1) {
		return direction === 1 ? 0 : length - 1;
	}
	const next = current + direction;
	if (next < 0) {
		return loop ? length - 1 : 0;
	}
	if (next >= length) {
		return loop ? 0 : length - 1;
	}
	return next;
}

/**
 * Resizable 组件样式类名键
 */
export const resizableStyleKeys = {
	group: 'group',
	panel: 'panel',
	handle: 'handle',
	handleBar: 'handleBar',
} as const;

/** 单个面板最小尺寸 (百分比) */
export const RESIZABLE_MIN_SIZE = 10;

/** localStorage 存储键前缀 */
export const RESIZABLE_STORAGE_PREFIX = 'tile-resizable';

/**
 * 生成持久化存储键
 */
export function getResizableStorageKey(id: string): string {
	return `${RESIZABLE_STORAGE_PREFIX}:${id}`;
}

/**
 * 根据拖动增量重新计算相邻两个面板的尺寸 (保持总比例不变，且不小于最小尺寸)
 */
export function computeResizableSizes(sizes: number[], index: number, delta: number, min: number = RESIZABLE_MIN_SIZE): number[] {
	const next = sizes.slice();
	const a = next[index] ?? 0;
	const b = next[index + 1] ?? 0;
	const sum = a + b;
	const nextA = Math.max(min, Math.min(sum - min, a + delta));
	next[index] = nextA;
	next[index + 1] = sum - nextA;
	return next;
}

/**
 * 获取拖拽时的鼠标光标样式
 */
export function getResizableDirectionCursor(direction: ResizableDirection): string {
	return direction === 'horizontal' ? 'col-resize' : 'row-resize';
}

/**
 * ContextMenu 开关状态
 */
export type ContextMenuState = 'open' | 'closed';

/**
 * ContextMenu 选中/勾选状态
 */
export type ContextMenuCheckState = 'checked' | 'unchecked';

/**
 * ContextMenu 菜单项样式变体
 */
export type ContextMenuItemVariant = 'default' | 'destructive';

/**
 * 框架无关的 ContextMenu 基础 Props (仅包含组件库自定义属性)
 */
export interface ContextMenuBaseProps {
	/** 是否受控打开 */
	open?: boolean;
	/** 默认是否打开 (非受控) */
	defaultOpen?: boolean;
	/** 打开状态变化时的回调 */
	onOpenChange?: (open: boolean) => void;
}

/**
 * 框架无关的 ContextMenuTrigger 基础 Props
 */
export interface ContextMenuTriggerBaseProps {
	/** 是否合并渲染到子元素上 (需唯一根节点) */
	asChild?: boolean;
}

/**
 * 框架无关的 ContextMenuItem 基础 Props
 */
export interface ContextMenuItemBaseProps {
	/** 是否缩进 (配合前置图标使用) */
	inset?: boolean;
	/** 样式变体 */
	variant?: ContextMenuItemVariant;
	/** 是否禁用 */
	disabled?: boolean;
	/** 选中触发时的回调 */
	onSelect?: (event: Event) => void;
}

/**
 * 框架无关的 ContextMenuCheckboxItem 基础 Props
 */
export interface ContextMenuCheckboxItemBaseProps {
	/** 是否受控勾选 */
	checked?: boolean;
	/** 默认是否勾选 (非受控) */
	defaultChecked?: boolean;
	/** 勾选状态变化时的回调 */
	onCheckedChange?: (checked: boolean) => void;
	/** 是否禁用 */
	disabled?: boolean;
}

/**
 * 框架无关的 ContextMenuRadioGroup 基础 Props
 */
export interface ContextMenuRadioGroupBaseProps {
	/** 受控选中值 */
	value?: string;
	/** 默认选中值 (非受控) */
	defaultValue?: string;
	/** 选中值变化时的回调 */
	onValueChange?: (value: string) => void;
}

/**
 * 框架无关的 ContextMenuRadioItem 基础 Props
 */
export interface ContextMenuRadioItemBaseProps {
	/** 该项对应的值 */
	value: string;
	/** 是否禁用 */
	disabled?: boolean;
}

/**
 * 框架无关的 ContextMenuLabel 基础 Props
 */
export interface ContextMenuLabelBaseProps {
	/** 是否缩进 */
	inset?: boolean;
}

/**
 * 框架无关的 ContextMenuSub 基础 Props
 */
export interface ContextMenuSubBaseProps {
	/** 是否受控展开 */
	open?: boolean;
	/** 默认是否展开 (非受控) */
	defaultOpen?: boolean;
	/** 展开状态变化时的回调 */
	onOpenChange?: (open: boolean) => void;
}

/**
 * 框架无关的 ContextMenuSubTrigger 基础 Props
 */
export interface ContextMenuSubTriggerBaseProps {
	/** 是否缩进 */
	inset?: boolean;
	/** 是否禁用 */
	disabled?: boolean;
}

/**
 * ContextMenu 组件样式类名键
 */
export const contextMenuStyleKeys = {
	root: 'root',
	trigger: 'trigger',
	content: 'content',
	group: 'group',
	item: 'item',
	checkboxItem: 'checkboxItem',
	radioGroup: 'radioGroup',
	radioItem: 'radioItem',
	indicator: 'indicator',
	label: 'label',
	separator: 'separator',
	shortcut: 'shortcut',
	subTrigger: 'subTrigger',
	subContent: 'subContent',
	chevron: 'chevron',
	checkIcon: 'checkIcon',
	radioIcon: 'radioIcon',
} as const;

/**
 * 根据布尔值获取 ContextMenu 的开关状态
 */
export function getContextMenuState(open: boolean): ContextMenuState {
	return open ? 'open' : 'closed';
}

/**
 * 根据勾选状态获取 ContextMenu 的勾选标识
 */
export function getContextMenuCheckState(checked: boolean): ContextMenuCheckState {
	return checked ? 'checked' : 'unchecked';
}

/**
 * 计算菜单内键盘导航的下一个索引 (支持循环)
 * @param currentIndex 当前聚焦项索引
 * @param itemCount 可导航项总数
 * @param direction 方向 (1 向下/右, -1 向上/左)
 * @param loop 是否循环 (越界时回到另一端)
 */
export function getContextMenuNextIndex(currentIndex: number, itemCount: number, direction: 1 | -1, loop: boolean = true): number {
	if (itemCount <= 0) {
		return -1;
	}
	if (loop) {
		return (currentIndex + direction + itemCount) % itemCount;
	}
	return Math.min(Math.max(currentIndex + direction, 0), itemCount - 1);
}

/** 右键菜单打开位置 (来自 contextmenu 事件坐标) */
export interface ContextMenuPosition {
	top: number;
	left: number;
}

/**
 * 将 contextmenu 事件坐标限制在视口内
 * @param x 事件 clientX
 * @param y 事件 clientY
 * @param contentSize 内容尺寸
 * @param viewport 视口尺寸
 */
export function getContextMenuPosition(input: {
	x: number;
	y: number;
	contentSize: { width: number; height: number };
	viewport: { width: number; height: number };
}): ContextMenuPosition {
	const { x, y, contentSize, viewport } = input;
	const margin = 8;
	const maxLeft = Math.max(margin, viewport.width - contentSize.width - margin);
	const maxTop = Math.max(margin, viewport.height - contentSize.height - margin);

	return {
		left: Math.min(Math.max(x, margin), maxLeft),
		top: Math.min(Math.max(y, margin), maxTop),
	};
}

/**
 * Dialog 组件样式类名键
 */
export const dialogStyleKeys = {
	overlay: 'overlay',
	content: 'content',
	close: 'close',
	header: 'header',
	footer: 'footer',
	title: 'title',
	description: 'description',
	xIcon: 'xIcon',
} as const;

/**
 * Dialog 弹层开关状态
 */
export type DialogState = 'open' | 'closed';

/**
 * 根据开关状态获取弹层状态标识 (open | closed)
 */
export function getDialogState(open: boolean): DialogState {
	return open ? 'open' : 'closed';
}

/**
 * Drawer 组件样式类名键
 */
export const drawerStyleKeys = {
	overlay: 'overlay',
	content: 'content',
	handle: 'handle',
	header: 'header',
	footer: 'footer',
	title: 'title',
	description: 'description',
	close: 'close',
	xIcon: 'xIcon',
} as const;

/**
 * Drawer 弹层开关状态
 */
export type DrawerState = 'open' | 'closed';

/**
 * 根据开关状态获取弹层状态标识 (open | closed)
 */
export function getDrawerState(open: boolean): DrawerState {
	return open ? 'open' : 'closed';
}

/**
 * 根据弹出方向获取 Drawer 内容初始位移动画 (transform) 值
 */
export function getDrawerTranslateStyle(direction: DrawerDirection): string {
	switch (direction) {
		case 'left':
			return 'translateX(-100%)';
		case 'right':
			return 'translateX(100%)';
		case 'top':
			return 'translateY(-100%)';
		case 'bottom':
			return 'translateY(100%)';
	}
}

/**
 * 获取 Drawer 内容样式类名键 (按方向变体)
 */
export function getDrawerStyleKeys(direction: DrawerDirection = 'right') {
	return {
		base: 'content',
		variant: `direction${capitalize(direction)}`,
	};
}

/**
 * DropdownMenu 组件样式类名键
 */
export const dropdownMenuStyleKeys = {
	root: 'root',
	trigger: 'trigger',
	content: 'content',
	group: 'group',
	item: 'item',
	checkboxItem: 'checkboxItem',
	radioGroup: 'radioGroup',
	radioItem: 'radioItem',
	indicator: 'indicator',
	label: 'label',
	separator: 'separator',
	shortcut: 'shortcut',
	subTrigger: 'subTrigger',
	subContent: 'subContent',
	chevron: 'chevron',
	checkIcon: 'checkIcon',
	radioIcon: 'radioIcon',
} as const;

/**
 * 根据布尔值获取 DropdownMenu 的开关状态
 */
export function getDropdownMenuState(open: boolean): DropdownMenuState {
	return open ? 'open' : 'closed';
}

/**
 * 根据勾选状态获取 DropdownMenu 的勾选标识
 */
export function getDropdownMenuCheckState(checked: boolean): DropdownMenuCheckState {
	return checked ? 'checked' : 'unchecked';
}

/**
 * 计算菜单内键盘导航的下一个索引 (支持循环)
 * @param currentIndex 当前聚焦项索引
 * @param itemCount 可导航项总数
 * @param direction 方向 (1 向下/右, -1 向上/左)
 * @param loop 是否循环 (越界时回到另一端)
 */
export function getDropdownMenuNextIndex(currentIndex: number, itemCount: number, direction: 1 | -1, loop: boolean = true): number {
	if (itemCount <= 0) {
		return -1;
	}
	if (loop) {
		return (currentIndex + direction + itemCount) % itemCount;
	}
	return Math.min(Math.max(currentIndex + direction, 0), itemCount - 1);
}

/** 触发元素矩形信息 (与 DOMRect 结构兼容，由框架测量传入) */
export interface DropdownMenuRect {
	top: number;
	right: number;
	bottom: number;
	left: number;
	width: number;
	height: number;
}

/** 内容尺寸 */
export interface DropdownMenuSize {
	width: number;
	height: number;
}

/** 视口尺寸 */
export interface DropdownMenuViewport {
	width: number;
	height: number;
}

/** 定位输入参数 */
export interface DropdownMenuPositionInput {
	triggerRect: DropdownMenuRect;
	contentSize: DropdownMenuSize;
	side: DropdownMenuSide;
	align?: DropdownMenuAlign;
	sideOffset: number;
	alignOffset?: number;
	viewport: DropdownMenuViewport;
	/** 是否处于 RTL 文档 (用于 start/end 对齐互换) */
	rtl?: boolean;
}

/** 定位结果 (position: fixed 坐标) */
export interface DropdownMenuPosition {
	top: number;
	left: number;
}

/** 内容与视口边缘的最小间距 */
export const DROPDOWN_MENU_VIEWPORT_MARGIN = 8;

/**
 * 根据 RTL 解析物理方向 (RTL 下左右互换)
 */
export function resolveDropdownMenuSide(side: DropdownMenuSide, rtl: boolean = false): DropdownMenuSide {
	if (!rtl) {
		return side;
	}
	if (side === 'left') {
		return 'right';
	}
	if (side === 'right') {
		return 'left';
	}
	return side;
}

/**
 * 计算主轴为水平方向时内容的对齐坐标
 */
function resolveHorizontalAlign_dropdown_menu(rect: DropdownMenuRect, contentWidth: number, align: DropdownMenuAlign, alignOffset: number, rtl: boolean): number {
	if (align === 'center') {
		return rect.left + rect.width / 2 - contentWidth / 2;
	}
	if (rtl) {
		return align === 'start' ? rect.right - contentWidth - alignOffset : rect.left + alignOffset;
	}
	return align === 'start' ? rect.left + alignOffset : rect.right - contentWidth - alignOffset;
}

/**
 * 计算主轴为垂直方向时内容的对齐坐标
 */
function resolveVerticalAlign_dropdown_menu(rect: DropdownMenuRect, contentHeight: number, align: DropdownMenuAlign, alignOffset: number): number {
	if (align === 'center') {
		return rect.top + rect.height / 2 - contentHeight / 2;
	}
	return align === 'start' ? rect.top + alignOffset : rect.bottom - contentHeight - alignOffset;
}

/**
 * 计算 DropdownMenu 内容定位 (fixed 坐标，支持 side + align + sideOffset + alignOffset)
 */
export function getDropdownMenuPosition(input: DropdownMenuPositionInput): DropdownMenuPosition {
	const { triggerRect, contentSize, side, sideOffset, viewport } = input;
	const align = input.align ?? 'center';
	const alignOffset = input.alignOffset ?? 0;
	const rtl = input.rtl ?? false;

	let top = 0;
	let left = 0;

	switch (side) {
		case 'top':
			top = triggerRect.top - contentSize.height - sideOffset;
			left = resolveHorizontalAlign_dropdown_menu(triggerRect, contentSize.width, align, alignOffset, rtl);
			break;
		case 'bottom':
			top = triggerRect.bottom + sideOffset;
			left = resolveHorizontalAlign_dropdown_menu(triggerRect, contentSize.width, align, alignOffset, rtl);
			break;
		case 'left':
			left = triggerRect.left - contentSize.width - sideOffset;
			top = resolveVerticalAlign_dropdown_menu(triggerRect, contentSize.height, align, alignOffset);
			break;
		case 'right':
			left = triggerRect.right + sideOffset;
			top = resolveVerticalAlign_dropdown_menu(triggerRect, contentSize.height, align, alignOffset);
			break;
	}

	const margin = DROPDOWN_MENU_VIEWPORT_MARGIN;
	const maxLeft = Math.max(margin, viewport.width - contentSize.width - margin);
	const maxTop = Math.max(margin, viewport.height - contentSize.height - margin);

	return {
		left: Math.min(Math.max(left, margin), maxLeft),
		top: Math.min(Math.max(top, margin), maxTop),
	};
}

/**
 * Empty 组件样式类名键
 */
export const emptyStyleKeys = {
	root: 'root',
	header: 'header',
	media: 'media',
	title: 'title',
	description: 'description',
	content: 'content',
} as const;

/**
 * 获取 EmptyMedia 的变体类名键
 */
export function getEmptyMediaVariantKey(variant: EmptyMediaVariant = 'default'): string {
	return `variant${capitalize(variant)}`;
}

/**
 * Field 相关辅助 ID 集合
 */
export interface FieldIds {
	id: string;
	labelId: string;
	descriptionId: string;
	messageId: string;
}

/**
 * 根据名称生成 Field 相关的辅助 ID（纯函数）
 */
export function getFieldIds(name?: string): FieldIds {
	const base = name ?? 'field';
	return {
		id: base,
		labelId: `${base}-label`,
		descriptionId: `${base}-description`,
		messageId: `${base}-message`,
	};
}

/**
 * Field 组件样式类名键
 */
export const fieldStyleKeys = {
	root: 'root',
	label: 'label',
	description: 'description',
	message: 'message',
} as const;

/**
 * 获取 FieldMessage 的样式类名键（含变体）
 */
export function getFieldMessageStyleKeys(variant: FieldMessageVariant = 'default') {
	return {
		base: 'message',
		variant: `variant${capitalize(variant)}`,
	};
}

/**
 * 获取 Badge 的样式类名键
 */
export function getBadgeStyleKeys(variant: BadgeVariant = 'default') {
	return {
		base: 'badge',
		variant: `variant${capitalize(variant)}`,
	};
}

/**
 * 将短横线分隔的值转换为 PascalCase（如 icon-xs -> IconXs）
 */
function toPascal_button(value: string): string {
	return value.split('-').map(capitalize).join('');
}

/**
 * 获取 Button 的样式类名键
 */
export function getButtonStyleKeys(variant: ButtonVariant = 'default', size: ButtonSize = 'default') {
	return {
		base: 'button',
		variant: `variant${toPascal_button(variant)}`,
		size: `size${toPascal_button(size)}`,
	};
}

/**
 * 判断 Button 是否处于禁用状态
 */
export function isButtonDisabled(disabled?: boolean, loading?: boolean): boolean {
	return !!disabled || !!loading;
}

/**
 * HoverCard 组件样式类名键
 */
export const hoverCardStyleKeys = {
	root: 'root',
	trigger: 'trigger',
	content: 'content',
} as const;

/** 触发元素矩形信息 (与 DOMRect 结构兼容，由框架测量传入) */
export interface HoverCardRect {
	top: number;
	right: number;
	bottom: number;
	left: number;
	width: number;
	height: number;
}

/** 内容尺寸 */
export interface HoverCardSize {
	width: number;
	height: number;
}

/** 视口尺寸 */
export interface HoverCardViewport {
	width: number;
	height: number;
}

/** 定位输入参数 */
export interface HoverCardPositionInput {
	triggerRect: HoverCardRect;
	contentSize: HoverCardSize;
	side: HoverCardSide;
	align?: HoverCardAlign;
	sideOffset: number;
	viewport: HoverCardViewport;
	/** 是否处于 RTL 文档 (用于 start/end 对齐互换) */
	rtl?: boolean;
}

/** 定位结果 (position: fixed 坐标) */
export interface HoverCardPosition {
	top: number;
	left: number;
}

/** 内容与视口边缘的最小间距 */
export const HOVER_CARD_VIEWPORT_MARGIN = 8;

/**
 * 根据 RTL 解析物理方向 (RTL 下左右互换)
 */
export function resolveHoverCardSide(side: HoverCardSide, rtl: boolean = false): HoverCardSide {
	if (!rtl) {
		return side;
	}
	if (side === 'left') {
		return 'right';
	}
	if (side === 'right') {
		return 'left';
	}
	return side;
}

/**
 * 获取 side 对应的方向向量 (x 表示水平偏移方向，y 表示垂直偏移方向)
 */
export function getHoverCardSideOffsetPlacement(side: HoverCardSide): { x: number; y: number } {
	switch (side) {
		case 'top':
			return { x: 0, y: -1 };
		case 'right':
			return { x: 1, y: 0 };
		case 'bottom':
			return { x: 0, y: 1 };
		case 'left':
			return { x: -1, y: 0 };
	}
}

/**
 * 根据布尔值获取 HoverCard 的状态标识
 */
export function getHoverCardState(open: boolean): HoverCardState {
	return open ? 'open' : 'closed';
}

/**
 * 计算主轴为水平方向时内容的对齐坐标
 */
function resolveHorizontalAlign_hover_card(rect: HoverCardRect, contentWidth: number, align: HoverCardAlign, rtl: boolean): number {
	if (align === 'center') {
		return rect.left + rect.width / 2 - contentWidth / 2;
	}
	if (rtl) {
		return align === 'start' ? rect.right - contentWidth : rect.left;
	}
	return align === 'start' ? rect.left : rect.right - contentWidth;
}

/**
 * 计算主轴为垂直方向时内容的对齐坐标
 */
function resolveVerticalAlign_hover_card(rect: HoverCardRect, contentHeight: number, align: HoverCardAlign): number {
	if (align === 'center') {
		return rect.top + rect.height / 2 - contentHeight / 2;
	}
	return align === 'start' ? rect.top : rect.bottom - contentHeight;
}

/**
 * 计算 HoverCard 内容定位 (fixed 坐标，支持 side + align + sideOffset)
 */
export function getHoverCardPosition(input: HoverCardPositionInput): HoverCardPosition {
	const { triggerRect, contentSize, side, sideOffset, viewport } = input;
	const align = input.align ?? 'center';
	const rtl = input.rtl ?? false;

	let top = 0;
	let left = 0;

	switch (side) {
		case 'top':
			top = triggerRect.top - contentSize.height - sideOffset;
			left = resolveHorizontalAlign_hover_card(triggerRect, contentSize.width, align, rtl);
			break;
		case 'bottom':
			top = triggerRect.bottom + sideOffset;
			left = resolveHorizontalAlign_hover_card(triggerRect, contentSize.width, align, rtl);
			break;
		case 'left':
			left = triggerRect.left - contentSize.width - sideOffset;
			top = resolveVerticalAlign_hover_card(triggerRect, contentSize.height, align);
			break;
		case 'right':
			left = triggerRect.right + sideOffset;
			top = resolveVerticalAlign_hover_card(triggerRect, contentSize.height, align);
			break;
	}

	const margin = HOVER_CARD_VIEWPORT_MARGIN;
	const maxLeft = Math.max(margin, viewport.width - contentSize.width - margin);
	const maxTop = Math.max(margin, viewport.height - contentSize.height - margin);

	return {
		left: Math.min(Math.max(left, margin), maxLeft),
		top: Math.min(Math.max(top, margin), maxTop),
	};
}

/**
 * 根据 ID 生成 Input 相关的辅助 ID
 */
export function getInputIds(id: string) {
	return {
		input: id,
		error: `${id}-error`,
		helper: `${id}-helper`,
	};
}

/**
 * 获取 Input 的 ARIA 属性
 */
export function getInputAriaProps(ids: ReturnType<typeof getInputIds>, error?: string, helperText?: string) {
	return {
		'aria-invalid': !!error || undefined,
		'aria-describedby': error ? ids.error : helperText ? ids.helper : undefined,
	};
}

/**
 * InputGroup 组件样式类名键
 */
export const inputGroupStyleKeys = {
	base: 'inputGroup',
	addon: 'addon',
	button: 'button',
	text: 'text',
	input: 'input',
	textarea: 'textarea',
} as const;

/**
 * 获取 InputGroup 的样式类名键（含变体）
 */
export function getInputGroupStyleKeys(variant: InputGroupVariant = 'default') {
	return {
		base: 'inputGroup',
		variant: `variant${capitalize(variant)}`,
	};
}

/**
 * 获取 InputGroupAddon 的样式类名键（含变体）
 */
export function getInputGroupAddonStyleKeys(variant: InputGroupVariant = 'default') {
	return {
		base: 'addon',
		variant: `variant${capitalize(variant)}`,
	};
}

/**
 * Item 组件样式类名键
 */
export const itemStyleKeys = {
	group: 'group',
	separator: 'separator',
	item: 'item',
	media: 'media',
	content: 'content',
	title: 'title',
	description: 'description',
	actions: 'actions',
	header: 'header',
	footer: 'footer',
} as const;

/**
 * 获取 Item 的变体类名键
 */
export function getItemVariantKey(variant: ItemVariant = 'default'): string {
	return `variant${capitalize(variant)}`;
}

/**
 * 获取 Item 的尺寸类名键
 */
export function getItemSizeKey(size: ItemSize = 'default'): string {
	return `size${capitalize(size)}`;
}

/**
 * 获取 ItemMedia 的变体类名键
 */
export function getItemMediaVariantKey(variant: ItemMediaVariant = 'default'): string {
	return `variant${capitalize(variant)}`;
}

/**
 * 获取 Label 的样式类名数组
 */
export function getLabelClassKeys(required?: boolean) {
	return {
		base: 'label',
		required: required ? 'required' : undefined,
	};
}

/**
 * Marker 组件样式类名键
 */
export const markerStyleKeys = {
	root: 'marker',
	icon: 'markerIcon',
	content: 'markerContent',
} as const;

/**
 * 获取 Marker 的变体类名键
 */
export function getMarkerVariantKey(variant: MarkerVariant = 'default'): string {
	return `variant${capitalize(variant)}`;
}

/**
 * Menubar 组件样式类名键
 */
export const menubarStyleKeys = {
	root: 'root',
	menu: 'menu',
	trigger: 'trigger',
	content: 'content',
	group: 'group',
	item: 'item',
	checkboxItem: 'checkboxItem',
	radioGroup: 'radioGroup',
	radioItem: 'radioItem',
	indicator: 'indicator',
	label: 'label',
	separator: 'separator',
	shortcut: 'shortcut',
	subTrigger: 'subTrigger',
	subContent: 'subContent',
	chevron: 'chevron',
	checkIcon: 'checkIcon',
	radioIcon: 'radioIcon',
} as const;

/**
 * 根据布尔值获取 Menubar 的开关状态
 */
export function getMenubarState(open: boolean): MenubarState {
	return open ? 'open' : 'closed';
}

/**
 * 根据勾选状态获取 Menubar 的勾选标识
 */
export function getMenubarCheckState(checked: boolean): MenubarCheckState {
	return checked ? 'checked' : 'unchecked';
}

/**
 * 计算菜单内键盘导航的下一个索引 (支持循环)
 * @param currentIndex 当前聚焦项索引
 * @param itemCount 可导航项总数
 * @param direction 方向 (1 向下/右, -1 向上/左)
 * @param loop 是否循环 (越界时回到另一端)
 */
export function getMenubarNextIndex(currentIndex: number, itemCount: number, direction: 1 | -1, loop: boolean = true): number {
	if (itemCount <= 0) {
		return -1;
	}
	if (loop) {
		return (currentIndex + direction + itemCount) % itemCount;
	}
	return Math.min(Math.max(currentIndex + direction, 0), itemCount - 1);
}

/** 触发元素矩形信息 (与 DOMRect 结构兼容，由框架测量传入) */
export interface MenubarRect {
	top: number;
	right: number;
	bottom: number;
	left: number;
	width: number;
	height: number;
}

/** 内容尺寸 */
export interface MenubarSize {
	width: number;
	height: number;
}

/** 视口尺寸 */
export interface MenubarViewport {
	width: number;
	height: number;
}

/** 定位输入参数 */
export interface MenubarPositionInput {
	triggerRect: MenubarRect;
	contentSize: MenubarSize;
	side: MenubarSide;
	align?: MenubarAlign;
	sideOffset: number;
	alignOffset?: number;
	viewport: MenubarViewport;
	/** 是否处于 RTL 文档 (用于 start/end 对齐互换) */
	rtl?: boolean;
}

/** 定位结果 (position: fixed 坐标) */
export interface MenubarPosition {
	top: number;
	left: number;
}

/** 内容与视口边缘的最小间距 */
export const MENUBAR_VIEWPORT_MARGIN = 8;

/**
 * 根据 RTL 解析物理方向 (RTL 下左右互换)
 */
export function resolveMenubarSide(side: MenubarSide, rtl: boolean = false): MenubarSide {
	if (!rtl) {
		return side;
	}
	if (side === 'left') {
		return 'right';
	}
	if (side === 'right') {
		return 'left';
	}
	return side;
}

/**
 * 计算主轴为水平方向时内容的对齐坐标
 */
function resolveHorizontalAlign_menubar(rect: MenubarRect, contentWidth: number, align: MenubarAlign, alignOffset: number, rtl: boolean): number {
	if (align === 'center') {
		return rect.left + rect.width / 2 - contentWidth / 2;
	}
	if (rtl) {
		return align === 'start' ? rect.right - contentWidth - alignOffset : rect.left + alignOffset;
	}
	return align === 'start' ? rect.left + alignOffset : rect.right - contentWidth - alignOffset;
}

/**
 * 计算主轴为垂直方向时内容的对齐坐标
 */
function resolveVerticalAlign_menubar(rect: MenubarRect, contentHeight: number, align: MenubarAlign, alignOffset: number): number {
	if (align === 'center') {
		return rect.top + rect.height / 2 - contentHeight / 2;
	}
	return align === 'start' ? rect.top + alignOffset : rect.bottom - contentHeight - alignOffset;
}

/**
 * 计算 Menubar 内容定位 (fixed 坐标，支持 side + align + sideOffset + alignOffset)
 */
export function getMenubarPosition(input: MenubarPositionInput): MenubarPosition {
	const { triggerRect, contentSize, side, sideOffset, viewport } = input;
	const align = input.align ?? 'center';
	const alignOffset = input.alignOffset ?? 0;
	const rtl = input.rtl ?? false;

	let top = 0;
	let left = 0;

	switch (side) {
		case 'top':
			top = triggerRect.top - contentSize.height - sideOffset;
			left = resolveHorizontalAlign_menubar(triggerRect, contentSize.width, align, alignOffset, rtl);
			break;
		case 'bottom':
			top = triggerRect.bottom + sideOffset;
			left = resolveHorizontalAlign_menubar(triggerRect, contentSize.width, align, alignOffset, rtl);
			break;
		case 'left':
			left = triggerRect.left - contentSize.width - sideOffset;
			top = resolveVerticalAlign_menubar(triggerRect, contentSize.height, align, alignOffset);
			break;
		case 'right':
			left = triggerRect.right + sideOffset;
			top = resolveVerticalAlign_menubar(triggerRect, contentSize.height, align, alignOffset);
			break;
	}

	const margin = MENUBAR_VIEWPORT_MARGIN;
	const maxLeft = Math.max(margin, viewport.width - contentSize.width - margin);
	const maxTop = Math.max(margin, viewport.height - contentSize.height - margin);

	return {
		left: Math.min(Math.max(left, margin), maxLeft),
		top: Math.min(Math.max(top, margin), maxTop),
	};
}

/**
 * MessageScroller 组件样式类名键
 */
export const messageScrollerStyleKeys = {
	root: 'root',
	viewport: 'viewport',
	content: 'content',
	item: 'item',
	button: 'button',
} as const;

/**
 * 获取 MessageScrollerButton 方向样式类名键
 */
export function getMessageScrollerButtonStyleKeys(direction: MessageScrollerDirection = 'end') {
	return {
		base: messageScrollerStyleKeys.button,
		direction: `direction${direction === 'start' ? 'Start' : 'End'}`,
	};
}

/**
 * 判断视口是否接近底部 (用于自动吸底与按钮显隐)
 */
export function isScrollerNearBottom(element: HTMLElement, threshold: number = 80): boolean {
	const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
	return distance <= threshold;
}

/**
 * 滚动视口到底部
 */
export function scrollScrollerToEnd(element: HTMLElement, behavior: ScrollBehavior = 'smooth'): void {
	element.scrollTo({ top: element.scrollHeight, behavior });
}

/**
 * 滚动视口到顶部
 */
export function scrollScrollerToStart(element: HTMLElement, behavior: ScrollBehavior = 'smooth'): void {
	element.scrollTo({ top: 0, behavior });
}

/**
 * Message 组件样式类名键
 */
export const messageStyleKeys = {
	group: 'group',
	root: 'message',
	avatar: 'avatar',
	content: 'content',
	header: 'header',
	footer: 'footer',
} as const;

/**
 * 获取 Message 根节点对齐样式类名键
 */
export function getMessageStyleKeys(align: MessageAlign = 'start') {
	return {
		base: messageStyleKeys.root,
		align: `align${capitalize(align)}`,
	};
}

export type NativeSelectState = 'empty' | 'selected';

/**
 * 根据当前值获取 NativeSelect 的状态标识
 */
export function getNativeSelectState(value?: string): NativeSelectState {
	return value ? 'selected' : 'empty';
}

/**
 * NativeSelect 组件样式类名键
 */
export const nativeSelectStyleKeys = {
	wrapper: 'wrapper',
	select: 'select',
	icon: 'icon',
	option: 'option',
	optGroup: 'optGroup',
} as const;

/**
 * NavigationMenu 开关状态
 */
export type NavigationMenuState = 'open' | 'closed';

/**
 * NavigationMenu 激活状态
 */
export type NavigationMenuActiveState = 'active' | 'inactive';

/**
 * 框架无关的 NavigationMenu 基础 Props (仅包含组件库自定义属性)
 */
export interface NavigationMenuBaseProps {
	/** 是否使用集中式视口 (默认 true；false 时内容直接渲染在菜单项下方) */
	viewport?: boolean;
	/** 当前激活的菜单项值 */
	value?: string;
	/** 默认激活的菜单项值 (非受控) */
	defaultValue?: string;
	/** 激活的菜单项值变化时的回调 */
	onValueChange?: (value: string | undefined) => void;
}

/**
 * 框架无关的 NavigationMenuItem 基础 Props
 */
export interface NavigationMenuItemBaseProps {
	/** 菜单项标识值 */
	value: string;
}

/**
 * 框架无关的 NavigationMenuLink 基础 Props
 */
export interface NavigationMenuLinkBaseProps {
	/** 是否为激活链接 */
	active?: boolean;
	/** 是否合并渲染到子元素上 (需唯一根节点) */
	asChild?: boolean;
}

/**
 * 导航菜单内容尺寸 (由框架测量传入，用于视口动画)
 */
export interface NavigationMenuContentSize {
	width: number;
	height: number;
}

/**
 * 导航菜单触发器位置 (相对根节点，用于指示器定位)
 */
export interface NavigationMenuTriggerRect {
	left: number;
	width: number;
}

/**
 * NavigationMenu 组件样式类名键
 */
export const navigationMenuStyleKeys = {
	root: 'root',
	list: 'list',
	item: 'item',
	trigger: 'trigger',
	content: 'content',
	link: 'link',
	viewport: 'viewport',
	viewportInner: 'viewportInner',
	indicator: 'indicator',
	indicatorArrow: 'indicatorArrow',
	chevron: 'chevron',
} as const;

/**
 * 根据布尔值获取 NavigationMenu 的开关状态
 */
export function getNavigationMenuState(open: boolean): NavigationMenuState {
	return open ? 'open' : 'closed';
}

/**
 * 根据布尔值获取 NavigationMenu 的激活标识
 */
export function getNavigationMenuActiveState(active: boolean): NavigationMenuActiveState {
	return active ? 'active' : 'inactive';
}

/**
 * 计算菜单内键盘导航的下一个索引 (支持循环)
 * @param currentIndex 当前聚焦项索引
 * @param itemCount 可导航项总数
 * @param direction 方向 (1 向下/右, -1 向上/左)
 * @param loop 是否循环 (越界时回到另一端)
 */
export function getNavigationMenuNextIndex(currentIndex: number, itemCount: number, direction: 1 | -1, loop: boolean = true): number {
	if (itemCount <= 0) {
		return -1;
	}
	if (loop) {
		return (currentIndex + direction + itemCount) % itemCount;
	}
	return Math.min(Math.max(currentIndex + direction, 0), itemCount - 1);
}

/**
 * 计算指示器的定位样式 (相对根节点的 left / translateX)
 */
export function getNavigationMenuIndicatorStyle(rect: NavigationMenuTriggerRect | null): { left: number; width: number } | null {
	if (!rect) {
		return null;
	}
	return {
		left: rect.left,
		width: rect.width,
	};
}

/**
 * InputOTP 组件样式类名键
 */
export const inputOtpStyleKeys = {
	root: 'root',
	group: 'group',
	slot: 'slot',
	caret: 'caret',
	separator: 'separator',
} as const;

/**
 * 默认 OTP 长度
 */
export const INPUT_OTP_DEFAULT_LENGTH = 4;

/**
 * 拆分 OTP 字符串为字符数组 (仅保留前 maxLength 个字符)
 */
export function splitOtpValue(value: string, maxLength: number = INPUT_OTP_DEFAULT_LENGTH): string[] {
	const chars = Array.from(value).slice(0, maxLength);
	const result: string[] = [];
	for (let i = 0; i < maxLength; i++) {
		result.push(chars[i] ?? '');
	}
	return result;
}

/**
 * 拼接字符数组为 OTP 字符串
 */
export function joinOtpValue(chars: string[], maxLength: number = INPUT_OTP_DEFAULT_LENGTH): string {
	return chars.slice(0, maxLength).join('');
}

/**
 * 根据输入模式判断字符是否合法
 */
export function isOtpCharAllowed(char: string, mode: InputOtpMode = 'alphanumeric'): boolean {
	if (char.length !== 1) {
		return false;
	}
	switch (mode) {
		case 'numeric':
			return /[0-9]/.test(char);
		case 'alphanumeric':
			return /[a-zA-Z0-9]/.test(char);
		default:
			return true;
	}
}

/**
 * 计算下一个可聚焦的槽位索引
 */
export function getNextOtpIndex(index: number, maxLength: number): number | null {
	const next = index + 1;
	return next < maxLength ? next : null;
}

/**
 * 计算上一个可聚焦的槽位索引
 */
export function getPrevOtpIndex(index: number): number | null {
	const prev = index - 1;
	return prev >= 0 ? prev : null;
}

/**
 * 获取 Pagination 尺寸样式类名键
 */
export function getPaginationSizeKey(size: PaginationSize): string {
	return `size${capitalize(size)}`;
}

/**
 * Pagination 组件样式类名键
 */
export const paginationStyleKeys = {
	root: 'root',
	content: 'content',
	item: 'item',
	link: 'link',
	ellipsis: 'ellipsis',
	ellipsisIcon: 'ellipsisIcon',
	srOnly: 'srOnly',
} as const;

/**
 * Popover 组件样式类名键
 */
export const popoverStyleKeys = {
	root: 'root',
	trigger: 'trigger',
	content: 'content',
} as const;

/** 触发元素矩形信息 (与 DOMRect 结构兼容，由框架测量传入) */
export interface PopoverRect {
	top: number;
	right: number;
	bottom: number;
	left: number;
	width: number;
	height: number;
}

/** 内容尺寸 */
export interface PopoverSize {
	width: number;
	height: number;
}

/** 视口尺寸 */
export interface PopoverViewport {
	width: number;
	height: number;
}

/** 定位输入参数 */
export interface PopoverPositionInput {
	triggerRect: PopoverRect;
	contentSize: PopoverSize;
	side: PopoverSide;
	align?: PopoverAlign;
	sideOffset: number;
	viewport: PopoverViewport;
	/** 是否处于 RTL 文档 (用于 start/end 对齐互换) */
	rtl?: boolean;
}

/** 定位结果 (position: fixed 坐标) */
export interface PopoverPosition {
	top: number;
	left: number;
}

/** 内容与视口边缘的最小间距 */
export const POPOVER_VIEWPORT_MARGIN = 8;

/**
 * 根据 RTL 解析物理方向 (RTL 下左右互换)
 */
export function resolvePopoverSide(side: PopoverSide, rtl: boolean = false): PopoverSide {
	if (!rtl) {
		return side;
	}
	if (side === 'left') {
		return 'right';
	}
	if (side === 'right') {
		return 'left';
	}
	return side;
}

/**
 * 获取 side 对应的方向向量 (x 表示水平偏移方向，y 表示垂直偏移方向)
 */
export function getPopoverSideOffsetPlacement(side: PopoverSide): { x: number; y: number } {
	switch (side) {
		case 'top':
			return { x: 0, y: -1 };
		case 'right':
			return { x: 1, y: 0 };
		case 'bottom':
			return { x: 0, y: 1 };
		case 'left':
			return { x: -1, y: 0 };
	}
}

/**
 * 根据布尔值获取 Popover 的状态标识
 */
export function getPopoverState(open: boolean): PopoverState {
	return open ? 'open' : 'closed';
}

/**
 * 计算主轴为水平方向时内容的对齐坐标
 */
function resolveHorizontalAlign_popover(rect: PopoverRect, contentWidth: number, align: PopoverAlign, rtl: boolean): number {
	if (align === 'center') {
		return rect.left + rect.width / 2 - contentWidth / 2;
	}
	if (rtl) {
		return align === 'start' ? rect.right - contentWidth : rect.left;
	}
	return align === 'start' ? rect.left : rect.right - contentWidth;
}

/**
 * 计算主轴为垂直方向时内容的对齐坐标
 */
function resolveVerticalAlign_popover(rect: PopoverRect, contentHeight: number, align: PopoverAlign): number {
	if (align === 'center') {
		return rect.top + rect.height / 2 - contentHeight / 2;
	}
	return align === 'start' ? rect.top : rect.bottom - contentHeight;
}

/**
 * 计算 Popover 内容定位 (fixed 坐标，支持 side + align + sideOffset)
 */
export function getPopoverPosition(input: PopoverPositionInput): PopoverPosition {
	const { triggerRect, contentSize, side, sideOffset, viewport } = input;
	const align = input.align ?? 'center';
	const rtl = input.rtl ?? false;

	let top = 0;
	let left = 0;

	switch (side) {
		case 'top':
			top = triggerRect.top - contentSize.height - sideOffset;
			left = resolveHorizontalAlign_popover(triggerRect, contentSize.width, align, rtl);
			break;
		case 'bottom':
			top = triggerRect.bottom + sideOffset;
			left = resolveHorizontalAlign_popover(triggerRect, contentSize.width, align, rtl);
			break;
		case 'left':
			left = triggerRect.left - contentSize.width - sideOffset;
			top = resolveVerticalAlign_popover(triggerRect, contentSize.height, align);
			break;
		case 'right':
			left = triggerRect.right + sideOffset;
			top = resolveVerticalAlign_popover(triggerRect, contentSize.height, align);
			break;
	}

	const margin = POPOVER_VIEWPORT_MARGIN;
	const maxLeft = Math.max(margin, viewport.width - contentSize.width - margin);
	const maxTop = Math.max(margin, viewport.height - contentSize.height - margin);

	return {
		left: Math.min(Math.max(left, margin), maxLeft),
		top: Math.min(Math.max(top, margin), maxTop),
	};
}

/**
 * 将进度值限制在 [min, max] 区间内
 */
export function clampProgressValue(value: number | undefined, min: number = 0, max: number = 100): number {
	if (value === undefined || Number.isNaN(value)) {
		return min;
	}
	return Math.min(max, Math.max(min, value));
}

/**
 * 计算 Progress 指示器需要平移的百分比偏移
 */
export function getProgressOffset(value: number | undefined, min: number = 0, max: number = 100): number {
	const clamped = clampProgressValue(value, min, max);
	const range = max - min;
	if (range <= 0) {
		return 0;
	}
	return ((clamped - min) / range) * 100;
}

/**
 * Progress 组件样式类名键
 */
export const progressStyleKeys = {
	root: 'root',
	indicator: 'indicator',
} as const;

export type RadioGroupState = 'checked' | 'unchecked';

/**
 * 根据选中状态获取 RadioGroup 的状态标识
 */
export function getRadioState(checked: boolean): RadioGroupState {
	return checked ? 'checked' : 'unchecked';
}

/**
 * RadioGroup 组件样式类名键
 */
export const radioGroupStyleKeys = {
	root: 'root',
	label: 'label',
	input: 'input',
	item: 'item',
	indicator: 'indicator',
	dot: 'dot',
} as const;

/**
 * 滚动条尺寸键（对应 SCSS 中的尺寸类名）
 */
export type ScrollBarSizeKey = 'vertical' | 'horizontal';

/**
 * 根据滚动条方向获取尺寸键
 */
export function getScrollBarSizeKey(orientation: ScrollBarOrientation): ScrollBarSizeKey {
	return orientation;
}

/**
 * ScrollArea 组件样式类名键
 */
export const scrollAreaStyleKeys = {
	root: 'root',
	viewport: 'viewport',
	scrollbar: 'scrollbar',
	thumb: 'thumb',
	vertical: 'vertical',
	horizontal: 'horizontal',
} as const;

/**
 * Select 组件样式类名键
 */
export const selectStyleKeys = {
	root: 'root',
	trigger: 'trigger',
	content: 'content',
	group: 'group',
	value: 'value',
	viewport: 'viewport',
	item: 'item',
	indicator: 'indicator',
	label: 'label',
	separator: 'separator',
	scrollButton: 'scrollButton',
	chevron: 'chevron',
	checkIcon: 'checkIcon',
} as const;

/**
 * 根据布尔值获取 Select 的开关状态
 */
export function getSelectState(open: boolean): SelectState {
	return open ? 'open' : 'closed';
}

/**
 * 根据勾选状态获取 Select 的勾选标识
 */
export function getSelectCheckState(checked: boolean): SelectCheckState {
	return checked ? 'checked' : 'unchecked';
}

/**
 * 计算下拉列表内键盘导航的下一个索引 (支持循环)
 * @param currentIndex 当前聚焦项索引
 * @param itemCount 可导航项总数
 * @param direction 方向 (1 向下, -1 向上)
 * @param loop 是否循环 (越界时回到另一端)
 */
export function getSelectNextIndex(currentIndex: number, itemCount: number, direction: 1 | -1, loop: boolean = true): number {
	if (itemCount <= 0) {
		return -1;
	}
	if (loop) {
		return (currentIndex + direction + itemCount) % itemCount;
	}
	return Math.min(Math.max(currentIndex + direction, 0), itemCount - 1);
}

/** 触发元素矩形信息 (与 DOMRect 结构兼容，由框架测量传入) */
export interface SelectRect {
	top: number;
	right: number;
	bottom: number;
	left: number;
	width: number;
	height: number;
}

/** 内容尺寸 */
export interface SelectSize {
	width: number;
	height: number;
}

/** 视口尺寸 */
export interface SelectViewport {
	width: number;
	height: number;
}

/** 定位输入参数 */
export interface SelectPositionInput {
	triggerRect: SelectRect;
	contentSize: SelectSize;
	align?: SelectAlign;
	sideOffset: number;
	viewport: SelectViewport;
	/** 是否处于 RTL 文档 (用于 start/end 对齐互换) */
	rtl?: boolean;
}

/** 定位结果 (position: fixed 坐标) */
export interface SelectPositionResult {
	top: number;
	left: number;
}

/** 内容与视口边缘的最小间距 */
export const SELECT_VIEWPORT_MARGIN = 8;

/**
 * 计算 Select 内容定位 (fixed 坐标，默认 bottom + center 对齐)
 */
export function getSelectPosition(input: SelectPositionInput): SelectPositionResult {
	const { triggerRect, contentSize, sideOffset, viewport } = input;
	const align = input.align ?? 'center';
	const rtl = input.rtl ?? false;

	let top = triggerRect.bottom + sideOffset;
	let left = 0;

	if (align === 'center') {
		left = triggerRect.left + triggerRect.width / 2 - contentSize.width / 2;
	} else if (rtl) {
		left = align === 'start' ? triggerRect.right - contentSize.width : triggerRect.left;
	} else {
		left = align === 'start' ? triggerRect.left : triggerRect.right - contentSize.width;
	}

	const margin = SELECT_VIEWPORT_MARGIN;
	const maxLeft = Math.max(margin, viewport.width - contentSize.width - margin);
	const maxTop = Math.max(margin, viewport.height - contentSize.height - margin);

	return {
		left: Math.min(Math.max(left, margin), maxLeft),
		top: Math.min(Math.max(top, margin), maxTop),
	};
}

/**
 * 获取 Separator 的样式类名键
 */
export function getSeparatorStyleKeys(orientation: SeparatorOrientation = 'horizontal') {
	return {
		base: 'separator',
		orientation: `orientation${orientation === 'horizontal' ? 'Horizontal' : 'Vertical'}`,
	};
}

/**
 * Sheet 组件样式类名键
 */
export const sheetStyleKeys = {
	overlay: 'overlay',
	content: 'content',
	close: 'close',
	header: 'header',
	footer: 'footer',
	title: 'title',
	description: 'description',
	xIcon: 'xIcon',
} as const;

/**
 * Sheet 弹层开关状态
 */
export type SheetState = 'open' | 'closed';

/**
 * 根据开关状态获取弹层状态标识 (open | closed)
 */
export function getSheetState(open: boolean): SheetState {
	return open ? 'open' : 'closed';
}

/**
 * 根据弹出方向获取 Sheet 内容初始位移动画 (transform) 值
 */
export function getSheetTranslateStyle(side: SheetSide): string {
	switch (side) {
		case 'left':
			return 'translateX(-100%)';
		case 'right':
			return 'translateX(100%)';
		case 'top':
			return 'translateY(-100%)';
		case 'bottom':
			return 'translateY(100%)';
	}
}

/**
 * Spinner 组件样式类名键
 */
export const spinnerStyleKeys = {
	root: 'root',
} as const;

/**
 * 归一化 Spinner 尺寸
 */
export function getSpinnerSize(size: SpinnerSize = 'default'): SpinnerSize {
	return size;
}

export type SwitchState = 'checked' | 'unchecked';

/**
 * 根据布尔值获取 Switch 的状态标识
 */
export function getSwitchState(checked: boolean): SwitchState {
	return checked ? 'checked' : 'unchecked';
}

/**
 * Switch 组件样式类名键
 */
export const switchStyleKeys = {
	root: 'root',
	thumb: 'thumb',
} as const;

export type TabsState = 'active' | 'inactive';

/**
 * 根据激活状态获取 Tabs 的状态标识
 */
export function getTabsState(active: boolean): TabsState {
	return active ? 'active' : 'inactive';
}

/**
 * 获取 TabsList 的变体类名键
 */
export function getTabsListVariantKey(variant: TabsListVariant = 'default'): string {
	return `variant${capitalize(variant)}`;
}

/**
 * Tabs 组件样式类名键
 */
export const tabsStyleKeys = {
	root: 'root',
	list: 'list',
	trigger: 'trigger',
	content: 'content',
} as const;

/**
 * 根据 ID 生成 Textarea 相关的辅助 ID
 */
export function getTextareaIds(id: string) {
	return {
		textarea: id,
		error: `${id}-error`,
		helper: `${id}-helper`,
	};
}

/**
 * 获取 Textarea 的 ARIA 属性
 */
export function getTextareaAriaProps(ids: ReturnType<typeof getTextareaIds>, error?: string, helperText?: string) {
	return {
		'aria-invalid': !!error || undefined,
		'aria-describedby': error ? ids.error : helperText ? ids.helper : undefined,
	};
}

export type ToggleGroupItemState = 'on' | 'off';

/**
 * 根据选中状态获取 ToggleGroupItem 的状态标识
 */
export function getToggleGroupItemState(selected: boolean): ToggleGroupItemState {
	return selected ? 'on' : 'off';
}

/**
 * 在列表中添加或移除指定值（纯函数）
 */
export function toggleValueInList(value: string, list: string[]): string[] {
	return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * ToggleGroup 组件样式类名键
 */
export const toggleGroupStyleKeys = {
	root: 'root',
	item: 'item',
} as const;

export type ToggleState = 'on' | 'off';

/**
 * 根据按压状态获取 Toggle 的状态标识
 */
export function getToggleState(pressed: boolean): ToggleState {
	return pressed ? 'on' : 'off';
}

/**
 * Toggle 组件样式类名键
 */
export const toggleStyleKeys = {
	base: 'toggle',
} as const;

/**
 * 获取 Toggle 的样式类名键（含变体与尺寸）
 */
export function getToggleStyleKeys(variant: ToggleVariant = 'default', size: ToggleSize = 'default') {
	return {
		base: 'toggle',
		variant: `variant${capitalize(variant)}`,
		size: `size${capitalize(size)}`,
	};
}

/**
 * Kbd 组件样式类名键
 */
export const kbdStyleKeys = {
	base: 'kbd',
	group: 'kbdGroup',
} as const;

/**
 * Direction 组件样式类名键 (方向切换通常无需样式，仅保留占位)
 */
export const directionStyleKeys = {
	root: 'root',
} as const;

/**
 * 规范化阅读方向 (非法值回退到 ltr)
 */
export function normalizeDirection(dir: DirectionValue | undefined): DirectionValue {
	return dir === 'rtl' ? 'rtl' : 'ltr';
}

/** Browser-only measurement lifecycle; importing this module is safe during SSR. */
export function observeTabsIndicator(list: HTMLElement, indicator: HTMLElement): { update: () => void; disconnect: () => void } {
	const view = list.ownerDocument.defaultView;
	let disposed = false;
	let observed: HTMLElement[] = [];
	const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => update());

	function update() {
		if (disposed) return;
		// A nested TabsList owns its own triggers and must never move this indicator.
		const triggers = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')).filter((trigger) => trigger.closest('[role="tablist"]') === list);
		if (triggers.length !== observed.length || triggers.some((trigger, index) => trigger !== observed[index])) {
			resize?.disconnect();
			resize?.observe(list);
			triggers.forEach((trigger) => resize?.observe(trigger));
			observed = triggers;
		}
		const active = triggers.find((trigger) => trigger.getAttribute('aria-selected') === 'true');
		const rect = active?.getBoundingClientRect();
		if (!rect || !rect.width || !rect.height) {
			indicator.dataset.state = 'hidden';
			return;
		}
		const parent = list.getBoundingClientRect();
		// Convert viewport coordinates back to the list's padding box. Physical left
		// works for both LTR and RTL (including negative RTL scrollLeft), and vertical lists.
		const css = view?.getComputedStyle(list);
		const borderBoxSize = (axis: 'width' | 'height') => {
			const size = parseFloat(css?.[axis] ?? '');
			if (!Number.isFinite(size)) return axis === 'width' ? list.offsetWidth : list.offsetHeight;
			if (css?.boxSizing === 'border-box') return size;
			const sides = axis === 'width' ? (['Left', 'Right'] as const) : (['Top', 'Bottom'] as const);
			return (
				size +
				sides.reduce(
					(extra, side) =>
						extra +
						(parseFloat(css?.getPropertyValue(`padding-${side.toLowerCase()}`) ?? '') || 0) +
						(parseFloat(css?.getPropertyValue(`border-${side.toLowerCase()}-width`) ?? '') || 0),
					0,
				)
			);
		};
		// offsetWidth/Height round fractional tab widths and can distort the indicator.
		const width = borderBoxSize('width');
		const height = borderBoxSize('height');
		const scaleX = width ? parent.width / width || 1 : 1;
		const scaleY = height ? parent.height / height || 1 : 1;
		const values = {
			left: (rect.left - parent.left) / scaleX - list.clientLeft + list.scrollLeft,
			top: (rect.top - parent.top) / scaleY - list.clientTop + list.scrollTop,
			width: rect.width / scaleX,
			height: rect.height / scaleY,
		};
		for (const [key, value] of Object.entries(values)) {
			const property = `--tile-tabs-indicator-${key}`;
			const next = `${value}px`;
			if (indicator.style.getPropertyValue(property) !== next) indicator.style.setProperty(property, next);
		}
		indicator.dataset.state = 'visible';
	}

	const mutations =
		typeof MutationObserver === 'undefined'
			? undefined
			: new MutationObserver((records) => {
					if (
						records.some((record) => {
							const target = record.target.nodeType === 1 ? (record.target as Element) : record.target.parentElement;
							return target !== indicator && target?.closest('[role="tablist"]') === list;
						})
					)
						update();
				});
	mutations?.observe(list, {
		subtree: true,
		childList: true,
		characterData: true,
		attributes: true,
		attributeFilter: ['aria-selected', 'data-state', 'data-orientation', 'class', 'style', 'dir', 'hidden'],
	});
	resize?.observe(list);
	view?.addEventListener('resize', update);
	const fonts = list.ownerDocument.fonts;
	void fonts?.ready.then(() => update());
	fonts?.addEventListener('loadingdone', update);
	update();

	return {
		update,
		disconnect() {
			disposed = true;
			resize?.disconnect();
			mutations?.disconnect();
			view?.removeEventListener('resize', update);
			fonts?.removeEventListener('loadingdone', update);
			observed = [];
		},
	};
}

/**
 * Skeleton 组件样式类名键
 */
export const skeletonStyleKeys = {
	base: 'skeleton',
} as const;

/**
 * Table 组件样式类名键
 */
export const tableStyleKeys = {
	container: 'container',
	table: 'table',
	header: 'header',
	body: 'body',
	footer: 'footer',
	row: 'row',
	head: 'head',
	cell: 'cell',
	caption: 'caption',
} as const;
