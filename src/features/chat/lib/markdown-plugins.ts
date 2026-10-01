import type { Options } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

type PluggableList = NonNullable<Options['remarkPlugins']>;

const BASIC_REMARK_PLUGINS: PluggableList = [remarkGfm];
const MATH_REMARK_PLUGINS: PluggableList = [remarkGfm, remarkMath];
const BASIC_REHYPE_PLUGINS: PluggableList = [];
const CODE_REHYPE_PLUGINS: PluggableList = [rehypeHighlight];
const MATH_REHYPE_PLUGINS: PluggableList = [rehypeKatex];
const CODE_AND_MATH_REHYPE_PLUGINS: PluggableList = [rehypeHighlight, rehypeKatex];

export function getMarkdownPlugins(markdown: string, isStreaming: boolean) {
    // Let the math parser decide whether dollar markers form an equation,
    // including an unclosed display fence at EOF. False positives are safe.
    const hasMath = markdown.includes('$');
    // Syntax coloring runs once at completion. Avoid traversing and rewriting
    // every code block repeatedly as its source grows. Match nested fences too.
    const hasCode = !isStreaming && /`{3,}|~{3,}|^(?: {4}|\t)/m.test(markdown);

    let rehypePlugins = BASIC_REHYPE_PLUGINS;
    if (hasCode && hasMath) rehypePlugins = CODE_AND_MATH_REHYPE_PLUGINS;
    else if (hasCode) rehypePlugins = CODE_REHYPE_PLUGINS;
    else if (hasMath) rehypePlugins = MATH_REHYPE_PLUGINS;

    return {
        remarkPlugins: hasMath ? MATH_REMARK_PLUGINS : BASIC_REMARK_PLUGINS,
        rehypePlugins,
    };
}
