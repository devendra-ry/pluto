import type { Root } from 'hast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { visit } from 'unist-util-visit';
import { urlAttributes } from 'html-url-attributes';
import { defaultUrlTransform } from 'react-markdown';
import { getMarkdownPlugins } from './markdown-plugins';
import { preprocessMarkdownSource } from './markdown-source';

/** Produce structured data, never executable HTML. Match ReactMarkdown's defaults. */
export function parseMarkdown(content: string, isStreaming: boolean): Root {
    const markdown = preprocessMarkdownSource(content);
    const { remarkPlugins, rehypePlugins } = getMarkdownPlugins(markdown, isStreaming);
    const processor = unified().use(remarkParse).use(remarkPlugins)
        .use(remarkRehype, { allowDangerousHtml: true }).use(rehypePlugins);
    const tree = processor.runSync(processor.parse(markdown));
    visit(tree, (node, index, parent) => {
        if (node.type === 'raw' && parent && index !== undefined) {
            parent.children[index] = { type: 'text', value: node.value };
            return index;
        }
        if (node.type === 'element') {
            for (const [key, tags] of Object.entries(urlAttributes)) {
                if (Object.hasOwn(node.properties, key) && (tags === null || tags.includes(node.tagName))) {
                    node.properties[key] = defaultUrlTransform(String(node.properties[key] || ''));
                }
            }
        }
    });
    return tree;
}
