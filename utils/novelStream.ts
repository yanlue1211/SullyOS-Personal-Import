export interface NovelStreamPreview {
    body: string;
    comment: string;
    analysis: string;
    bookMeta?: { title?: string; summary?: string };
}

interface JsonString {
    value: string;
    end: number;
    complete: boolean;
}

function readString(raw: string, start: number): JsonString {
    let end = start + 1;
    for (; end < raw.length; end++) {
        if (raw[end] === '"') break;
        if (raw[end] === '\\') {
            if (!raw[end + 1]) break;
            const width = raw[end + 1] === 'u' ? 6 : 2;
            if (end + width > raw.length) break;
            end += width - 1;
        }
    }
    const complete = raw[end] === '"';
    try {
        const value: string = JSON.parse(`"${raw.slice(start + 1, end)}"`);
        return { value: value.replace(/[\uD800-\uDBFF]$/, ''), end: end + Number(complete), complete };
    } catch {
        return { value: '', end, complete: false };
    }
}

/** Read only the requested fields, suppressing JSON syntax and incomplete escape sequences. */
export function readNovelStreamPreview(raw: string): NovelStreamPreview {
    const preview: NovelStreamPreview = { body: '', comment: '', analysis: '' };
    const start = /^\s*(?:```(?:json)?\s*)?\{/.exec(raw)?.[0].length;
    if (start === undefined) return preview;

    const stack: string[] = [''];
    let key = '';
    let expectingKey = true;
    let reaction = '';
    for (let index = start; index < raw.length; index++) {
        const character = raw[index];
        if (character === '"') {
            const token = readString(raw, index);
            if (expectingKey) {
                if (!token.complete) break;
                key = token.value;
                expectingKey = false;
            } else if (stack.length === 2) {
                const object = stack[1];
                if (object === 'writer' && key === 'content') preview.body = token.value;
                if (object === 'comment' && key === 'content') preview.comment = token.value;
                if (object === 'analysis' && key === 'reaction') reaction = token.value;
                if (object === 'analysis' && key === 'critique') preview.analysis = token.value;
                if (object === 'bookMeta' && token.complete && (key === 'title' || key === 'summary')) {
                    (preview.bookMeta ??= {})[key] = token.value;
                }
            }
            if (!token.complete) break;
            index = token.end - 1;
        } else if (character === '{' || character === '[') {
            stack.push(character === '{' ? key : '');
            expectingKey = character === '{';
        } else if (character === '}' || character === ']') {
            stack.pop();
            if (!stack.length) break;
            expectingKey = false;
        } else if (character === ',') {
            expectingKey = true;
        }
    }
    if (!preview.analysis) preview.analysis = reaction;
    return preview;
}
