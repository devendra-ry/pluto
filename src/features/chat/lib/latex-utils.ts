export const preprocessLaTeX = (text: string) => {
    if (!text) return text;
    return text
        // Replace block math: \[ ... \] or \\[ ... \\]
        .replace(/\\+\[([\s\S]*?)\\+\]/g, (_, equation) => `\n$$\n${equation}\n$$\n`)
        // Replace inline math: \( ... \) or \\( ... \\)
        .replace(/\\+\(([\s\S]*?)\\+\)/g, (_, equation) => `$${equation}$`);
};