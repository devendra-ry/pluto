import { fromHtml, type Options } from 'hast-util-from-html';
import { removePosition } from 'unist-util-remove-position';

// Same DOM-free semantics as hast-util-from-html-isomorphic's worker export.
// Turbopack currently selects its DOMParser-based browser export for workers.
export function fromHtmlIsomorphic(value: string, options?: Pick<Options, 'fragment'>) {
    const tree = fromHtml(value, options);
    removePosition(tree, { force: true });
    delete tree.data;
    return tree;
}
