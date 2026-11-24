type ClassValue = string | number | boolean | null | undefined | ClassValue[] | Record<string, boolean | null | undefined>;

/**
 * 合并 CSS 类名
 * 支持条件类名和数组类名
 */
export function cn(...inputs: ClassValue[]): string {
	return inputs
		.flatMap((input) => {
			if (input === null || input === undefined || input === false) {
				return [];
			}
			if (typeof input === 'string' || typeof input === 'number') {
				return [String(input)];
			}
			if (Array.isArray(input)) {
				return input;
			}
			if (typeof input === 'object') {
				return Object.entries(input)
					.filter(([, value]) => value)
					.map(([key]) => key);
			}
			return [];
		})
		.filter(Boolean)
		.join(' ');
}

/**
 * 生成唯一的 ID
 */
export function generateId(prefix: string = 'tile'): string {
	return `${prefix}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 深度合并对象
 */
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
	const result = { ...target };

	for (const key in source) {
		if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
			result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>) as T[Extract<keyof T, string>];
		} else {
			result[key] = source[key] as T[Extract<keyof T, string>];
		}
	}

	return result;
}

/**
 * 格式化字节大小
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
	if (bytes === 0) return '0 Bytes';

	const k = 1024;
	const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * 延迟执行
 */
export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 检查是否是对象
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 从对象中提取指定键
 */
export function pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
	const result = {} as Pick<T, K>;

	for (const key of keys) {
		if (key in obj) {
			result[key] = obj[key];
		}
	}

	return result;
}

/**
 * 从对象中排除指定键
 */
export function omit<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
	const result = { ...obj };

	for (const key of keys) {
		delete result[key];
	}

	return result;
}

/**
 * 首字母大写
 */
export function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}
